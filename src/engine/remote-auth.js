import { EventEmitter } from 'events';
import crypto from 'crypto';
import https from 'https';
import WebSocket from 'ws';
import QRCode from 'qrcode';
import { HttpsProxyAgent } from 'https-proxy-agent';

const GATEWAY_URL = 'wss://remote-auth-gateway.discord.gg/?v=2';
const API_LOGIN_URL = 'https://discord.com/api/v9/users/@me/remote-auth/login';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9200 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36';

function sendPostJson(urlStr, data, proxyUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(data);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': DESKTOP_UA,
        Origin: 'https://discord.com',
      },
    };

    if (proxyUrl) {
      try {
        options.agent = new HttpsProxyAgent(proxyUrl);
      } catch (err) {
        console.warn(`[RemoteAuth] Failed to configure HttpsProxyAgent for login: ${err.message}`);
      }
    }

    const req = https.request(url, options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => chunks,
          json: async () => JSON.parse(chunks),
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export class RemoteAuthSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.proxyUrl = options.proxyUrl || null;
    this.ws = null;
    this.heartbeatTimer = null;
    this.timeoutTimer = null;
    this.keyPair = null;
    this.isClosed = false;
  }

  start() {
    this.keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyDer = this.keyPair.publicKey.export({ type: 'spki', format: 'der' });

    const wsOptions = {
      headers: {
        Origin: 'https://discord.com',
        'User-Agent': DESKTOP_UA,
      },
    };

    if (this.proxyUrl) {
      try {
        wsOptions.agent = new HttpsProxyAgent(this.proxyUrl);
        console.log(`[RemoteAuth] Routing gateway WebSocket through proxy: ${this.proxyUrl}`);
      } catch (err) {
        console.warn(`[RemoteAuth] Failed to configure HttpsProxyAgent: ${err.message}`);
      }
    }

    this.ws = new WebSocket(GATEWAY_URL, wsOptions);

    this.ws.on('open', () => {
      // connected to remote auth gateway
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await this.handleMessage(msg, publicKeyDer);
      } catch (err) {
        this.emit('error', err);
        this.cleanup();
      }
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
      this.cleanup();
    });

    this.ws.on('close', (code, reason) => {
      if (!this.isClosed) {
        this.cleanup();
      }
    });
  }

  async handleMessage(msg, publicKeyDer) {
    switch (msg.op) {
      case 'hello': {
        const interval = msg.heartbeat_interval || 41250;
        const timeoutMs = msg.timeout_ms || 120000;

        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'heartbeat' }));
          }
        }, interval);

        this.timeoutTimer = setTimeout(() => {
          this.emit('timeout');
          this.cleanup();
        }, timeoutMs);

        this.ws.send(JSON.stringify({
          op: 'init',
          encoded_public_key: publicKeyDer.toString('base64'),
        }));
        break;
      }

      case 'nonce_proof': {
        const decryptedNonce = crypto.privateDecrypt(
          {
            key: this.keyPair.privateKey,
            oaepHash: 'sha256',
          },
          Buffer.from(msg.encrypted_nonce, 'base64')
        );

        const proof = crypto
          .createHash('sha256')
          .update(decryptedNonce)
          .digest('base64url');

        this.ws.send(JSON.stringify({
          op: 'nonce_proof',
          proof,
        }));
        break;
      }

      case 'pending_remote_init': {
        const fingerprint = msg.fingerprint;
        const qrUrl = `https://discord.com/ra/${fingerprint}`;

        const qrBuffer = await QRCode.toBuffer(qrUrl, {
          width: 340,
          margin: 2,
          color: {
            dark: '#1e1f22',
            light: '#ffffff',
          },
        });

        this.emit('qr', { buffer: qrBuffer, url: qrUrl, fingerprint });
        break;
      }

      case 'pending_ticket': {
        let userInfo = null;
        if (msg.encrypted_user_payload) {
          try {
            const dec = crypto.privateDecrypt(
              {
                key: this.keyPair.privateKey,
                oaepHash: 'sha256',
              },
              Buffer.from(msg.encrypted_user_payload, 'base64')
            ).toString('utf-8');
            const parts = dec.split(':');
            userInfo = {
              id: parts[0],
              discriminator: parts[1],
              avatar: parts[2],
              username: parts[3],
            };
          } catch {
            /* ignore payload decode error if discord format shifts */
          }
        }
        this.emit('scanned', { user: userInfo });
        break;
      }

      case 'pending_login': {
        const ticket = msg.ticket;
        if (!ticket) {
          throw new Error('Ticket missing in pending_login packet');
        }

        if (this.proxyUrl) {
          console.log(`[RemoteAuth] Routing ticket exchange through proxy: ${this.proxyUrl}`);
        }

        const res = await sendPostJson(API_LOGIN_URL, { ticket }, this.proxyUrl);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Remote auth login failed (${res.status}): ${errText}`);
        }

        const resData = await res.json();
        if (!resData.encrypted_token) {
          throw new Error('Encrypted token missing from login response');
        }

        const decryptedToken = crypto.privateDecrypt(
          {
            key: this.keyPair.privateKey,
            oaepHash: 'sha256',
          },
          Buffer.from(resData.encrypted_token, 'base64')
        ).toString('utf-8');

        this.emit('finish', { token: decryptedToken });
        this.cleanup();
        break;
      }

      case 'cancel': {
        this.emit('cancel');
        this.cleanup();
        break;
      }

      default:
        break;
    }
  }

  cleanup() {
    this.isClosed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch { /* ignore */ }
      this.ws = null;
    }
  }

  cancel() {
    this.cleanup();
  }
}
