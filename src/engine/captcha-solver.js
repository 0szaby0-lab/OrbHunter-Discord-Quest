// language: JavaScript, file: src/engine/captcha-solver.js, runtime: Node.js 18+
// Automated hCaptcha Enterprise solver integration for CapSolver, 2Captcha, Anti-Captcha

export class CaptchaSolver {
  constructor() {
    this.capsolverKey = process.env.CAPSOLVER_API_KEY || null;
    this.twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || null;
    this.antiCaptchaKey = process.env.ANTICAPTCHA_API_KEY || null;
  }

  isConfigured() {
    return !!(this.capsolverKey || this.twoCaptchaKey || this.antiCaptchaKey);
  }

  async solve({ sitekey, rqdata, rqtoken, websiteUrl = 'https://discord.com' }) {
    if (this.capsolverKey) {
      return this.solveWithCapSolver({ sitekey, rqdata, rqtoken, websiteUrl });
    }
    if (this.twoCaptchaKey) {
      return this.solveWith2Captcha({ sitekey, rqdata, websiteUrl });
    }
    if (this.antiCaptchaKey) {
      return this.solveWithAntiCaptcha({ sitekey, rqdata, websiteUrl });
    }
    throw new Error('Nincs beállítva captcha-megoldó API kulcs (.env: CAPSOLVER_API_KEY).');
  }

  async solveWithCapSolver({ sitekey, rqdata, rqtoken, websiteUrl }) {
    console.log('[CaptchaSolver] CapSolver feladat indítása...');
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.capsolverKey,
        task: {
          type: 'HCaptchaEnterpriseTaskProxyLess',
          websiteURL: websiteUrl,
          websiteKey: sitekey,
          enterprisePayload: rqdata ? { rqdata } : undefined,
        },
      }),
    });

    const createData = await createRes.json();
    if (createData.errorId && createData.errorId !== 0) {
      throw new Error(`CapSolver createTask hiba: ${createData.errorDescription || createData.errorCode}`);
    }

    const taskId = createData.taskId;
    if (!taskId) throw new Error('Nem érkezett taskId a CapSolvertől.');

    // Poll for solution (up to 45 seconds)
    const startTime = Date.now();
    while (Date.now() - startTime < 45000) {
      await new Promise(r => setTimeout(r, 2000));
      const resultRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.capsolverKey, taskId }),
      });
      const resultData = await resultRes.json();

      if (resultData.status === 'ready') {
        const token = resultData.solution?.gRecaptchaResponse || resultData.solution?.token;
        if (!token) throw new Error('CapSolver ready, de hiányzik a megoldás-token.');
        console.log('[CaptchaSolver] ✅ CapSolver hCaptcha sikeresen megoldva!');
        return token;
      }

      if (resultData.status === 'failed' || (resultData.errorId && resultData.errorId !== 0)) {
        throw new Error(`CapSolver feloldás sikertelen: ${resultData.errorDescription || 'Ismeretlen hiba'}`);
      }
    }

    throw new Error('CapSolver időtúllépés (timeout 45s).');
  }

  async solveWith2Captcha({ sitekey, rqdata, websiteUrl }) {
    console.log('[CaptchaSolver] 2Captcha feladat indítása...');
    const params = new URLSearchParams({
      key: this.twoCaptchaKey,
      method: 'hcaptcha',
      sitekey,
      pageurl: websiteUrl,
      json: '1',
    });
    if (rqdata) params.append('data', rqdata);

    const inRes = await fetch(`https://2captcha.com/in.php?${params.toString()}`);
    const inData = await inRes.json();
    if (inData.status !== 1) throw new Error(`2Captcha hiba: ${inData.request}`);

    const reqId = inData.request;
    const startTime = Date.now();
    while (Date.now() - startTime < 50000) {
      await new Promise(r => setTimeout(r, 4000));
      const res = await fetch(`https://2captcha.com/res.php?key=${this.twoCaptchaKey}&action=get&id=${reqId}&json=1`);
      const resData = await res.json();
      if (resData.status === 1) {
        console.log('[CaptchaSolver] ✅ 2Captcha hCaptcha sikeresen megoldva!');
        return resData.request;
      }
      if (resData.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha hiba: ${resData.request}`);
      }
    }
    throw new Error('2Captcha időtúllépés (timeout 50s).');
  }

  async solveWithAntiCaptcha({ sitekey, rqdata, websiteUrl }) {
    console.log('[CaptchaSolver] Anti-Captcha feladat indítása...');
    const createRes = await fetch('https://api.anti-captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.antiCaptchaKey,
        task: {
          type: 'HCaptchaEnterpriseTaskProxyLess',
          websiteURL: websiteUrl,
          websiteKey: sitekey,
          enterprisePayload: rqdata ? { rqdata } : undefined,
        },
      }),
    });
    const createData = await createRes.json();
    if (createData.errorId !== 0) throw new Error(`Anti-Captcha hiba: ${createData.errorDescription}`);

    const taskId = createData.taskId;
    const startTime = Date.now();
    while (Date.now() - startTime < 45000) {
      await new Promise(r => setTimeout(r, 3000));
      const res = await fetch('https://api.anti-captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.antiCaptchaKey, taskId }),
      });
      const data = await res.json();
      if (data.status === 'ready') return data.solution.gRecaptchaResponse;
      if (data.errorId !== 0) throw new Error(`Anti-Captcha hiba: ${data.errorDescription}`);
    }
    throw new Error('Anti-Captcha időtúllépés.');
  }
}

export const solver = new CaptchaSolver();
