import { EventEmitter } from 'events';
import crypto from 'crypto';
import https from 'https';
import WebSocket from 'ws';
import QRCode from 'qrcode';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { hasCaptchaSolver, solveCaptcha } from './captcha-solver.js';

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks://')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

const GATEWAY_URL = 'wss://remote-auth-gateway.discord.gg/?v=2';
const API_LOGIN_URL = 'https://discord.com/api/v9/users/@me/remote-auth/login';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9200 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36';

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
].join(':');

function superProperties() {
  return Buffer.from(JSON.stringify({
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: '1.0.9200',
    os_version: '10.0.26100',
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'hu-HU',
    has_client_mods: false,
    client_build_number: 610373,
    native_build_number: 65000,
    client_event_source: null,
  })).toString('base64');
}

function sendPostJson(urlStr, data, proxyUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(data);
    const options = {
      method: 'POST',
      ciphers: CHROME_CIPHERS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': DESKTOP_UA,
        Origin: 'https://discord.com',
        Referer: 'https://discord.com/',
        'X-Super-Properties': superProperties(),
        'X-Discord-Locale': 'hu',
        'X-Discord-Timezone': 'Europe/Budapest',
        'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="134", "Electron";v="35"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...extraHeaders,
      },
    };

    if (proxyUrl) {
      try {
        options.agent = createProxyAgent(proxyUrl);
      } catch (err) {
        console.warn(`[RemoteAuth] Failed to configure HttpsProxyAgent for login: ${err.message}`);
      }
    }

    const req = https.request(url, options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        const rawCookies = res.headers['set-cookie'] || [];
        const cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          cookies,
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
        wsOptions.agent = createProxyAgent(this.proxyUrl);
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
          let json = null;
          try { json = JSON.parse(errText); } catch {}

          if (json && json.captcha_key && json.captcha_key.includes('captcha-required')) {
            console.log('[RemoteAuth] 🧩 Captcha required by Discord.');

            // ────────────────────────────────────────────
            // TIER 1: Automatic solver (CapSolver / 2Captcha)
            // ────────────────────────────────────────────
            if (hasCaptchaSolver()) {
              console.log('[RemoteAuth] 🤖 Tier 1: Attempting automatic captcha solve...');
              this.emit('captcha_status', { tier: 1, message: 'Automatikus captcha megoldás folyamatban (CapSolver)...' });

              try {
                const solvedToken = await solveCaptcha({
                  sitekey: json.captcha_sitekey,
                  rqdata: json.captcha_rqdata,
                  pageUrl: 'https://discord.com/login',
                  userAgent: DESKTOP_UA,
                });

                console.log('[RemoteAuth] ✅ Tier 1 solved. Submitting to Discord...');
                const success = await this._submitCaptchaToken(ticket, solvedToken, json, res.cookies);
                if (success) return;
                // If submission failed, fall through to next tier
                console.log('[RemoteAuth] ⚠️ Tier 1 token rejected. Falling through...');
              } catch (solverErr) {
                console.error('[RemoteAuth] ⚠️ Tier 1 failed:', solverErr.message);
              }
            }

            // ────────────────────────────────────────────
            // TIER 2/3: Browser relay (manual solve)
            // Emits captcha_required so the command handler
            // can show the relay link to the user.
            // ────────────────────────────────────────────
            console.log('[RemoteAuth] 🌐 Falling back to browser relay (manual solve)...');
            this.emit('captcha_required', {
              sitekey: json.captcha_sitekey,
              rqdata: json.captcha_rqdata,
              rqtoken: json.captcha_rqtoken,
              sessionId: json.captcha_session_id,
              ticket,
              cookies: res.cookies,
              solve: async (captchaKey) => {
                return this._submitCaptchaToken(ticket, captchaKey, json, res.cookies);
              },
            });
            return;
          }

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

  /**
   * Submit a solved captcha token to Discord's remote-auth/login endpoint.
   * Returns true if login succeeded and 'finish' event was emitted.
   */
  async _submitCaptchaToken(ticket, captchaKey, captchaJson, cookies) {
    console.log(`[RemoteAuth] Submitting solved captcha_key to Discord...`);

    const retryBody = {
      ticket,
      captcha_key: captchaKey,
    };
    if (captchaJson.captcha_rqtoken) {
      retryBody.captcha_rqtoken = captchaJson.captcha_rqtoken;
    }

    const retryHeaders = {};
    if (cookies) {
      retryHeaders['Cookie'] = cookies;
    }

    const retryRes = await sendPostJson(API_LOGIN_URL, retryBody, this.proxyUrl, retryHeaders);

    if (!retryRes.ok) {
      const retryErr = await retryRes.text();
      const msg = `Captcha jóváhagyása sikertelen (${retryRes.status}): ${retryErr}`;
      console.error(`[RemoteAuth] ❌ ${msg}`);
      throw new Error(msg);
    }

    const retryData = await retryRes.json();
    if (!retryData.encrypted_token) {
      throw new Error('Encrypted token hiányzik a captcha válaszból.');
    }

    const decryptedToken = crypto.privateDecrypt(
      {
        key: this.keyPair.privateKey,
        oaepHash: 'sha256',
      },
      Buffer.from(retryData.encrypted_token, 'base64')
    ).toString('utf-8');

    this.emit('finish', { token: decryptedToken });
    this.cleanup();
    return true;
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
