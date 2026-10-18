import { fetch as uFetch, ProxyAgent } from 'undici';
import { isWarpReady, getWarpProxyUrl } from './warp-manager.js';

const PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=4000&country=all&ssl=yes&anonymity=elite',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/roosterkid/openproxies/main/HTTPS_RAW.txt',
];

export const TARGET_COUNTRIES = [
  { code: 'US', name: 'Egyesült Államok', flag: '🇺🇸' },
  { code: 'GB', name: 'Egyesült Királyság', flag: '🇬🇧' },
  { code: 'DE', name: 'Németország', flag: '🇩🇪' },
  { code: 'FR', name: 'Franciaország', flag: '🇫🇷' },
  { code: 'JP', name: 'Japán', flag: '🇯🇵' },
  { code: 'CA', name: 'Kanada', flag: '🇨🇦' },
  { code: 'BR', name: 'Brazília', flag: '🇧🇷' },
];

export class ProxyManager {
  constructor() {
    this.workingProxies = [];
    this.isHarvesting = false;
    this.lastHarvestTime = 0;
    this.countryCache = new Map(); // code -> { item, timestamp }
  }

  getConfiguredProxy() {
    const custom = process.env.LOGIN_PROXY || process.env.PROXY_URL;
    if (custom && custom.trim()) {
      let p = custom.trim();
      if (!p.startsWith('http://') && !p.startsWith('https://') && !p.startsWith('socks5://')) {
        p = `http://${p}`;
      }
      return p;
    }
    return null;
  }

  async testProxy(proxyUrl, timeoutMs = 3000) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const agent = new ProxyAgent(proxyUrl);
      const res = await uFetch('https://discord.com/api/v9/experiments', {
        dispatcher: agent,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
      });

      clearTimeout(timer);
      const latency = Date.now() - start;

      // Status 200, 400, 401, or 429 means the proxy reached Discord without tunnel failure
      if ([200, 400, 401, 429].includes(res.status)) {
        return { ok: true, latency, status: res.status };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async fetchCandidateProxies() {
    const list = new Set();
    for (const url of PROXY_SOURCES) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const text = await res.text();
        const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b/g) || [];
        for (const m of matches) {
          list.add(m);
        }
      } catch {
        /* ignore failed feed */
      }
    }
    return Array.from(list);
  }

  async harvestAndFind(maxTest = 45) {
    if (this.isHarvesting) return;
    this.isHarvesting = true;
    this.lastHarvestTime = Date.now();

    try {
      console.log('[ProxyManager] 🔍 Searching for public login proxies...');
      const candidates = await this.fetchCandidateProxies();
      console.log(`[ProxyManager] 📋 Harvested ${candidates.length} candidates. Testing sample...`);

      // Shuffle array
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      const sample = candidates.slice(0, maxTest);
      const chunkSize = 15;

      for (let i = 0; i < sample.length; i += chunkSize) {
        const chunk = sample.slice(i, i + chunkSize);
        const results = await Promise.all(
          chunk.map(async (ipPort) => {
            const url = `http://${ipPort}`;
            const res = await this.testProxy(url, 3000);
            return res.ok ? { url, latency: res.latency } : null;
          })
        );

        for (const r of results) {
          if (r) {
            console.log(`[ProxyManager] 🚀 Found functional proxy: ${r.url} (${r.latency}ms)`);
            this.workingProxies.push(r);
          }
        }

        if (this.workingProxies.length >= 2) break;
      }

      this.workingProxies.sort((a, b) => a.latency - b.latency);
      console.log(`[ProxyManager] ✅ Hunt complete. Active proxies available: ${this.workingProxies.length}`);
    } catch (err) {
      console.error('[ProxyManager] Harvest error:', err.message);
    } finally {
      this.isHarvesting = false;
    }
  }

  /**
   * Keres és tesztel működő proxykat különböző országokból
   * Cache-eli az eredményt 10 percig a villámgyors használat érdekében.
   */
  async findWorkingCountryProxies(forceRefresh = false) {
    const now = Date.now();
    const CACHE_TTL = 10 * 60 * 1000; // 10 perc

    // Mindig elérhető a helyi (Direct) kapcsolat
    const active = [
      { code: 'DIRECT', name: 'Helyi / Globális IP', flag: '🌍', proxyUrl: null, latency: 0, status: 200 }
    ];

    // Ha van Cloudflare WARP, azt is hozzáadjuk
    if (isWarpReady()) {
      const warp = getWarpProxyUrl();
      active.push({ code: 'WARP', name: 'Cloudflare WARP (Residential)', flag: '🛡️', proxyUrl: warp, latency: 50, status: 200 });
    }

    const promises = TARGET_COUNTRIES.map(async (c) => {
      // Ellenőrizzük a cache-t
      if (!forceRefresh && this.countryCache.has(c.code)) {
        const cached = this.countryCache.get(c.code);
        if (now - cached.timestamp < CACHE_TTL) {
          return cached.item;
        }
      }

      try {
        const url = `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/${c.code}/data.json`;
        const ctrl = new AbortController();
        const feedTimer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(feedTimer);

        if (!res.ok) return null;
        const list = await res.json();
        const httpList = list.filter(p => p.protocol === 'http').slice(0, 30);
        if (!httpList.length) return null;

        // Párhuzamos versenyfutás a jelöltek között
        const winner = await Promise.race([
          ...httpList.map(async (p) => {
            const proxyUrl = `http://${p.ip}:${p.port}`;
            const pStart = Date.now();
            try {
              const agent = new ProxyAgent(proxyUrl);
              const testCtrl = new AbortController();
              const timer = setTimeout(() => testCtrl.abort(), 2000);
              const resp = await uFetch('https://discord.com/api/v9/experiments', {
                dispatcher: agent,
                signal: testCtrl.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                },
              });
              clearTimeout(timer);
              if ([200, 400, 401, 429].includes(resp.status)) {
                return {
                  code: c.code,
                  name: c.name,
                  flag: c.flag,
                  proxyUrl,
                  latency: Date.now() - pStart,
                  status: resp.status,
                };
              }
            } catch {}
            return new Promise(() => {}); // sikertelen esetén nem oldja fel
          }),
          new Promise(r => setTimeout(() => r(null), 2500)),
        ]);

        if (winner) {
          this.countryCache.set(c.code, { item: winner, timestamp: now });
        }
        return winner;
      } catch {
        return null;
      }
    });

    const countryResults = await Promise.all(promises);
    for (const r of countryResults) {
      if (r) active.push(r);
    }

    return active;
  }

  async getLoginProxy() {
    // Priority 1: Explicit environment proxy
    const configured = this.getConfiguredProxy();
    if (configured) {
      console.log(`[ProxyManager] 🔧 Using configured proxy: ${configured}`);
      return configured;
    }

    // Priority 2: Cloudflare WARP (free, residential IP)
    if (isWarpReady()) {
      const warpProxy = getWarpProxyUrl();
      console.log(`[ProxyManager] 🌐 Using Cloudflare WARP proxy: ${warpProxy}`);
      return warpProxy;
    }

    // Priority 3: Direct connection (may trigger captcha on datacenter IPs)
    console.log('[ProxyManager] ⚡ No proxy available, using direct connection.');
    return null;
  }
}

export const proxyManager = new ProxyManager();
