// language: JavaScript, file: captcha-solver.js, target: Node.js 18+
// CapSolver / 2Captcha integration for hCaptcha Enterprise (Discord)

const CAPSOLVER_API = 'https://api.capsolver.com';
const TWOCAPTCHA_API = 'https://api.2captcha.com';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // ~2 min max wait

function getApiKey() {
  return process.env.CAPSOLVER_API_KEY || process.env.TWOCAPTCHA_API_KEY || null;
}

function getProvider() {
  if (process.env.CAPSOLVER_API_KEY) return 'capsolver';
  if (process.env.TWOCAPTCHA_API_KEY) return 'twocaptcha';
  return null;
}

export function hasCaptchaSolver() {
  return !!getApiKey();
}

/**
 * Solve an hCaptcha Enterprise challenge via CapSolver or 2Captcha.
 *
 * @param {object} params
 * @param {string} params.sitekey - hCaptcha sitekey from Discord's 400 response
 * @param {string} params.rqdata  - Enterprise rqdata blob from Discord
 * @param {string} [params.pageUrl] - The page URL context (default: https://discord.com)
 * @param {string} [params.userAgent] - User agent to pass to the solver
 * @returns {Promise<string>} Solved captcha token (h-captcha-response)
 */
export async function solveCaptcha({ sitekey, rqdata, pageUrl, userAgent }) {
  const provider = getProvider();
  const apiKey = getApiKey();

  if (!provider || !apiKey) {
    throw new Error('Nincs captcha solver konfigurálva. Állítsd be a CAPSOLVER_API_KEY vagy TWOCAPTCHA_API_KEY env változót.');
  }

  console.log(`[CaptchaSolver] 🧩 Solving hCaptcha Enterprise via ${provider}...`);

  if (provider === 'capsolver') {
    return solveViaCapsolver({ apiKey, sitekey, rqdata, pageUrl, userAgent });
  }
  return solveViaTwoCaptcha({ apiKey, sitekey, rqdata, pageUrl, userAgent });
}

async function solveViaCapsolver({ apiKey, sitekey, rqdata, pageUrl, userAgent }) {
  const createRes = await fetch(`${CAPSOLVER_API}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: pageUrl || 'https://discord.com',
        websiteKey: sitekey,
        isEnterprise: true,
        enterprisePayload: {
          rqdata: rqdata || '',
        },
        userAgent: userAgent || undefined,
      },
    }),
  });

  const createData = await createRes.json();

  if (createData.errorId && createData.errorId !== 0) {
    throw new Error(`CapSolver task létrehozás sikertelen: ${createData.errorDescription || JSON.stringify(createData)}`);
  }

  const taskId = createData.taskId;
  if (!taskId) {
    throw new Error(`CapSolver nem adott task ID-t: ${JSON.stringify(createData)}`);
  }

  console.log(`[CaptchaSolver] ⏳ Task created: ${taskId}, polling...`);

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${CAPSOLVER_API}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId,
      }),
    });

    const pollData = await pollRes.json();

    if (pollData.status === 'ready') {
      const token = pollData.solution?.gRecaptchaResponse;
      if (!token) {
        throw new Error('CapSolver kész, de nincs token a válaszban.');
      }
      console.log(`[CaptchaSolver] ✅ Solved in ${(i + 1) * 3}s`);
      return token;
    }

    if (pollData.status === 'failed' || (pollData.errorId && pollData.errorId !== 0)) {
      throw new Error(`CapSolver megoldás sikertelen: ${pollData.errorDescription || JSON.stringify(pollData)}`);
    }
  }

  throw new Error('CapSolver timeout: nem sikerült megoldani a captchát időben.');
}

async function solveViaTwoCaptcha({ apiKey, sitekey, rqdata, pageUrl, userAgent }) {
  // 2Captcha API — create task
  const createRes = await fetch(`${TWOCAPTCHA_API}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: pageUrl || 'https://discord.com',
        websiteKey: sitekey,
        isEnterprise: true,
        enterprisePayload: {
          rqdata: rqdata || '',
        },
        userAgent: userAgent || undefined,
      },
    }),
  });

  const createData = await createRes.json();

  if (createData.errorId && createData.errorId !== 0) {
    throw new Error(`2Captcha task létrehozás sikertelen: ${createData.errorDescription || JSON.stringify(createData)}`);
  }

  const taskId = createData.taskId;
  if (!taskId) {
    throw new Error(`2Captcha nem adott task ID-t: ${JSON.stringify(createData)}`);
  }

  console.log(`[CaptchaSolver] ⏳ Task created: ${taskId}, polling...`);

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${TWOCAPTCHA_API}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId,
      }),
    });

    const pollData = await pollRes.json();

    if (pollData.status === 'ready') {
      const token = pollData.solution?.gRecaptchaResponse || pollData.solution?.token;
      if (!token) {
        throw new Error('2Captcha kész, de nincs token a válaszban.');
      }
      console.log(`[CaptchaSolver] ✅ Solved in ${(i + 1) * 3}s`);
      return token;
    }

    if (pollData.status === 'failed' || (pollData.errorId && pollData.errorId !== 0)) {
      throw new Error(`2Captcha megoldás sikertelen: ${pollData.errorDescription || JSON.stringify(pollData)}`);
    }
  }

  throw new Error('2Captcha timeout: nem sikerült megoldani a captchát időben.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
