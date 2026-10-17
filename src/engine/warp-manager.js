// language: JavaScript, file: warp-manager.js, target: Node.js 18+
// Manages Cloudflare WARP via wgcf + wireproxy (userspace SOCKS5)
// 100% free, no NET_ADMIN, works on Render free tier

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const WARP_DIR = process.env.WARP_DIR || '/tmp/warp';
const WIREPROXY_PORT = parseInt(process.env.WIREPROXY_PORT || '1080', 10);
const WGCF_URL = 'https://github.com/ViRb3/wgcf/releases/latest/download/wgcf_linux_amd64';

let wireproxyProcess = null;
let warpReady = false;

function isLinux() {
  return process.platform === 'linux';
}

function downloadBinary(url, dest) {
  console.log(`[WARP] ⬇️  Downloading ${path.basename(dest)}...`);
  execSync(`curl -fsSL -o "${dest}" "${url}"`, { stdio: 'pipe' });
  execSync(`chmod +x "${dest}"`, { stdio: 'pipe' });
}

async function getWireproxyUrl() {
  try {
    const res = await fetch('https://api.github.com/repos/octeep/wireproxy/releases/latest');
    const data = await res.json();
    const tag = data.tag_name || 'v1.0.9';
    return {
      tag,
      url: `https://github.com/octeep/wireproxy/releases/download/${tag}/wireproxy_linux_amd64.tar.gz`,
    };
  } catch {
    return {
      tag: 'v1.0.9',
      url: 'https://github.com/octeep/wireproxy/releases/download/v1.0.9/wireproxy_linux_amd64.tar.gz',
    };
  }
}

function parseWgcfProfile(profilePath) {
  const content = readFileSync(profilePath, 'utf-8');
  const lines = content.split('\n');
  const result = { addresses: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('PrivateKey')) result.privateKey = trimmed.split('=').slice(1).join('=').trim();
    else if (trimmed.startsWith('PublicKey')) result.publicKey = trimmed.split('=').slice(1).join('=').trim();
    else if (trimmed.startsWith('Endpoint')) result.endpoint = trimmed.split('=').slice(1).join('=').trim();
    else if (trimmed.startsWith('Address')) result.addresses.push(trimmed.split('=').slice(1).join('=').trim());
  }

  return result;
}

function generateWireproxyConfig(profile) {
  return `[Interface]
PrivateKey = ${profile.privateKey}
Address = ${profile.addresses[0] || '172.16.0.2/32'}
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = ${profile.publicKey}
Endpoint = ${profile.endpoint || 'engage.cloudflareclient.com:2408'}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:${WIREPROXY_PORT}
`;
}

export async function startWarp() {
  if (!isLinux()) {
    console.log('[WARP] ⏭️  Skipping WARP setup (not Linux).');
    return false;
  }

  try {
    mkdirSync(WARP_DIR, { recursive: true });

    const wgcfPath = path.join(WARP_DIR, 'wgcf');
    const wireproxyPath = path.join(WARP_DIR, 'wireproxy');
    const accountPath = path.join(WARP_DIR, 'wgcf-account.toml');
    const profilePath = path.join(WARP_DIR, 'wgcf-profile.conf');
    const wireproxyConfPath = path.join(WARP_DIR, 'wireproxy.conf');

    // Download wgcf
    if (!existsSync(wgcfPath)) {
      downloadBinary(WGCF_URL, wgcfPath);
    }

    // Download wireproxy
    if (!existsSync(wireproxyPath)) {
      const { tag, url } = await getWireproxyUrl();
      console.log(`[WARP] ⬇️  Downloading wireproxy ${tag}...`);
      const tarPath = path.join(WARP_DIR, 'wireproxy.tar.gz');
      execSync(`curl -fsSL -o "${tarPath}" "${url}"`, { stdio: 'pipe' });
      execSync(`tar -xzf "${tarPath}" -C "${WARP_DIR}"`, { stdio: 'pipe' });
      execSync(`chmod +x "${wireproxyPath}"`, { stdio: 'pipe' });
      try { execSync(`rm -f "${tarPath}"`, { stdio: 'pipe' }); } catch {}
    }

    // Register WARP account
    if (!existsSync(accountPath)) {
      console.log('[WARP] 🔑 Registering Cloudflare WARP account (free)...');
      execSync(`"${wgcfPath}" register --accept-tos`, { cwd: WARP_DIR, stdio: 'pipe' });
    }

    // Generate WireGuard profile
    if (!existsSync(profilePath)) {
      console.log('[WARP] 📄 Generating WireGuard profile...');
      execSync(`"${wgcfPath}" generate`, { cwd: WARP_DIR, stdio: 'pipe' });
    }

    // Parse and create wireproxy config
    const profile = parseWgcfProfile(profilePath);
    const wpConfig = generateWireproxyConfig(profile);
    writeFileSync(wireproxyConfPath, wpConfig, 'utf-8');

    // Start wireproxy
    console.log(`[WARP] 🚀 Starting wireproxy SOCKS5 on 127.0.0.1:${WIREPROXY_PORT}...`);
    wireproxyProcess = spawn(wireproxyPath, ['-c', wireproxyConfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    wireproxyProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[WARP/wireproxy] ${msg}`);
    });

    wireproxyProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[WARP/wireproxy] ${msg}`);
    });

    wireproxyProcess.on('exit', (code) => {
      console.log(`[WARP] ⚠️  wireproxy exited with code ${code}`);
      warpReady = false;
      wireproxyProcess = null;
    });

    // Wait for proxy to come up
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (wireproxyProcess && !wireproxyProcess.killed) {
      warpReady = true;
      console.log(`[WARP] ✅ SOCKS5 proxy active on 127.0.0.1:${WIREPROXY_PORT}`);
      return true;
    }

    console.log('[WARP] ⚠️  wireproxy failed to start.');
    return false;
  } catch (err) {
    console.error(`[WARP] ❌ Setup failed: ${err.message}`);
    return false;
  }
}

export function isWarpReady() {
  return warpReady && wireproxyProcess && !wireproxyProcess.killed;
}

export function getWarpProxyUrl() {
  if (!isWarpReady()) return null;
  return `socks5://127.0.0.1:${WIREPROXY_PORT}`;
}

export function stopWarp() {
  if (wireproxyProcess) {
    try {
      wireproxyProcess.kill('SIGTERM');
    } catch {}
    wireproxyProcess = null;
    warpReady = false;
    console.log('[WARP] 🛑 wireproxy stopped.');
  }
}
