import { chromium } from 'playwright';

const rawAppUrl = process.env.APP_URL || 'http://localhost:3010';
const appUrl = rawAppUrl.includes('#') || /\/app(?:\/|$)/.test(rawAppUrl)
  ? rawAppUrl
  : `${rawAppUrl.replace(/\/$/, '')}/app`;

const consoleEntries = [];
const pageErrors = [];
const failedRequests = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', async (msg) => {
  const values = [];
  for (const arg of msg.args()) {
    try {
      values.push(await arg.jsonValue());
    } catch {
      values.push(await arg.evaluate((v) => String(v)));
    }
  }
  consoleEntries.push({
    type: msg.type(),
    text: msg.text(),
    values,
  });
});

page.on('pageerror', (error) => {
  pageErrors.push(String(error));
});

page.on('requestfailed', (request) => {
  failedRequests.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure()?.errorText || 'unknown',
  });
});

await context.addInitScript(() => {
  window.__bbMetrics = {
    micCalls: 0,
    displayCalls: 0,
  };

  const makeVideoStream = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let tick = 0;

    const draw = () => {
      if (!ctx) return;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText('Playwright Fake Screen', 60, 120);
      ctx.fillStyle = '#f5f5f5';
      ctx.font = '32px sans-serif';
      ctx.fillText(`tick ${tick}`, 60, 190);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(60 + ((tick * 17) % 800), 280, 220, 120);
      tick += 1;
      requestAnimationFrame(draw);
    };

    draw();
    return canvas.captureStream(8);
  };

  const makeAudioStream = () => {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    oscillator.type = 'sine';
    oscillator.frequency.value = 220;
    gain.gain.value = 0.03;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();

    return destination.stream;
  };

  navigator.mediaDevices.getDisplayMedia = async () => {
    window.__bbMetrics.displayCalls += 1;
    return makeVideoStream();
  };

  navigator.mediaDevices.getUserMedia = async (constraints) => {
    window.__bbMetrics.micCalls += 1;
    if (constraints?.audio) {
      return makeAudioStream();
    }
    return new MediaStream();
  };
});

try {
  const start = Date.now();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const shareButton = page.getByRole('button', { name: 'Share Tab/Screen' });
  if (!(await shareButton.isVisible().catch(() => false))) {
    const tryItNow = page.getByRole('link', { name: /Try It Now/i }).first();
    if (await tryItNow.isVisible().catch(() => false)) {
      await tryItNow.click();
      await page.waitForLoadState('networkidle');
    }
  }

  await shareButton.click();
  await page.waitForFunction(() => document.body.innerText.includes('Stop Sharing'));

  await page.getByRole('button', { name: 'Start Companion' }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes('Connected to Live Audio. You can talk now!') || document.body.innerText.includes('Live audio reconnected.'),
    undefined,
    { timeout: 20000 }
  );
  const connectedAt = Date.now();

  await page.getByTitle('Mute Microphone').click();
  await page.getByRole('button', { name: 'Force Comment' }).click();
  await sleep(12000);

  const transcriptTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('p'))
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean);
  });

  const metrics = await page.evaluate(() => window.__bbMetrics);
  const liveEventLogs = consoleEntries.filter((entry) => entry.text.includes('Live API event'));
  const reconnectLogs = consoleEntries.filter((entry) => entry.text.includes('Reconnecting in'));

  console.log(JSON.stringify({
    ok: true,
    appUrl,
    connectLatencyMs: connectedAt - start,
    transcriptTexts,
    metrics,
    consoleSummary: {
      total: consoleEntries.length,
      liveEvents: liveEventLogs.length,
      reconnectMessages: reconnectLogs.length,
      pageErrors,
      failedRequests,
    },
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    appUrl,
    pageErrors,
    failedRequests,
    consoleEntries,
    error: String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
