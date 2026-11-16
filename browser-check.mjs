// Wispwarden browser validation: the real user interface is exercised in
// headless Chromium (start, move, fire a real kill, clear a wave, pick an
// upgrade, pause/resume, mute, real defeat, restart by button and by key),
// then a deterministic replay is run twice and compared, and each screenshot
// is staged twice in fresh contexts and compared by digest, step and bytes.
// Any console error, page error or failed request fails the run.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/hatch/workspace/makefun/threejs-fps-01/browser-tool/node_modules/playwright-core');

const repoRoot = dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/home/hatch/.hermes/tools/chromium-1208/chrome-linux64/chrome';
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = JSON.parse(readFileSync(join(repoRoot, 'shots.json'), 'utf8'));
const SHOT_REPORT = JSON.parse(readFileSync(join(repoRoot, 'shots-report.json'), 'utf8'));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('local server did not come up');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// mulberry32 for the deterministic replay script (same algorithm as the game).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildReplayScript(steps) {
  const rng = mulberry32(1234);
  const script = [];
  for (let s = 0; s < steps; s++) {
    const a = s * 0.011;
    const aim = s * 0.05;
    script.push({
      mx: Math.sin(a) > 0.3 ? 1 : Math.sin(a) < -0.3 ? -1 : 0,
      my: Math.cos(a * 0.7) > 0.3 ? 1 : Math.cos(a * 0.7) < -0.3 ? -1 : 0,
      ax: 640 + Math.cos(aim) * 260,
      ay: 400 + Math.sin(aim) * 200,
      fire: (s % 30) < 22,
      act: s === 0 ? 'confirm'
        : s === 1800 ? 'select1' : s === 1801 ? 'confirm'
        : s === 3000 ? 'select2' : s === 3001 ? 'confirm' : null,
    });
    void rng;
  }
  return script;
}

async function main() {
  const server = spawn('node', ['serve.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    await waitForServer();

    // ------------------------------------------------------------ UI steps
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));
    page.on('response', (res) => { if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`); });

    const debug = () => page.evaluate(() => window.__wispDebug);
    const toClient = async (lx, ly) => {
      const box = await page.locator('#game').boundingBox();
      return { x: box.x + (lx / 1280) * box.width, y: box.y + (ly / 720) * box.height };
    };
    const aimAtNearest = async () => {
      const d = await debug();
      if (!d.enemies.length) return false;
      let best = null;
      let bestDist = Infinity;
      for (const e of d.enemies) {
        const dist = Math.hypot(e.x - d.player.x, e.y - d.player.y);
        if (dist < bestDist) { bestDist = dist; best = e; }
      }
      const c = await toClient(best.x, best.y);
      await page.mouse.move(c.x, c.y);
      return true;
    };

    // 1. Load the normal title page and verify its start control.
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__wispDebug !== undefined);
    let d = await debug();
    check('1. title screen loads', d.screen === 'TITLE', `screen=${d.screen}`);

    // 2. Start with Enter.
    await page.keyboard.press('Enter');
    await sleep(300);
    d = await debug();
    check('2. Enter starts the run', d.screen === 'PLAY' && d.wave === 1, `screen=${d.screen} wave=${d.wave}`);

    // 3. Move with keyboard input and verify bounded movement. Headless
    // Chromium throttles rAF until the page paints, so wiggle the mouse to
    // drive frames and poll until the simulation has actually stepped.
    const x0 = (await debug()).player.x;
    const step0 = (await debug()).step;
    await page.keyboard.down('KeyD');
    let moved = false;
    const tMove = Date.now();
    while (Date.now() - tMove < 15000) {
      await page.mouse.move(640, 400);
      await sleep(100);
      d = await debug();
      if (d.step >= step0 + 30) { moved = d.player.x > x0 + 50; break; }
    }
    await page.keyboard.up('KeyD');
    d = await debug();
    check('3. keyboard movement moves the player', moved && d.player.x <= 1248 - 13, `x ${x0} -> ${d.player.x} (step ${step0} -> ${d.step})`);

    // 4. Hold fire while aiming at a visible shade: a real kill, score up.
    let killed = false;
    const t0 = Date.now();
    await aimAtNearest();
    await page.mouse.down();
    while (Date.now() - t0 < 20000) {
      d = await debug();
      if (d.kills >= 1 && d.score > 0) { killed = true; break; }
      await aimAtNearest();
      await sleep(150);
    }
    check('4. firing kills a shade and scores', killed, `kills=${d.kills} score=${d.score}`);
    await page.mouse.up();

    // 5. Continue through a wave clear.
    let cleared = false;
    const t1 = Date.now();
    await page.mouse.down();
    while (Date.now() - t1 < 240000) {
      d = await debug();
      if (d.screen === 'UPGRADE') { cleared = true; break; }
      if (d.screen === 'GAME_OVER') break;
      await aimAtNearest();
      await sleep(150);
    }
    await page.mouse.up();
    check('5. wave clears to the upgrade screen', cleared, `screen=${d.screen} wave=${d.wave} score=${d.score}`);
    const scoreAfterWave1 = d.score;

    // 6. Select an upgrade with a number key and confirm with Enter.
    await page.keyboard.press('Digit1');
    await sleep(200);
    await page.keyboard.press('Enter');
    d = await debug();
    {
      const tEnd = Date.now() + 10000;
      while (d.screen !== 'PLAY' && Date.now() < tEnd) {
        await page.mouse.move(640, 400);
        await sleep(150);
        d = await debug();
      }
    }
    check('6. number-key select + Enter confirms, wave 2 begins',
      d.screen === 'PLAY' && d.wave === 2, `screen=${d.screen} wave=${d.wave}`);

    // 7. Pause and verify the simulation snapshot remains unchanged.
    await page.keyboard.press('KeyP');
    let paused = await debug();
    {
      const tEnd = Date.now() + 10000;
      while (paused.screen !== 'PAUSED' && Date.now() < tEnd) {
        await page.mouse.move(640, 400);
        await sleep(150);
        paused = await debug();
      }
    }
    await sleep(1000);
    const pausedLater = await debug();
    check('7. pause freezes the simulation',
      paused.screen === 'PAUSED' && paused.step === pausedLater.step,
      `step ${paused.step} -> ${pausedLater.step}`);

    // 8. Resume and verify it advances again.
    await page.keyboard.press('KeyP');
    await sleep(600);
    d = await debug();
    check('8. resume advances the simulation', d.screen === 'PLAY' && d.step > pausedLater.step,
      `step ${pausedLater.step} -> ${d.step}`);

    // 9. Toggle mute.
    await page.keyboard.press('KeyM');
    await sleep(200);
    check('9. mute toggles without error', problems.length === 0, problems.join(' | '));

    // 10. Stop defending and wait for a real defeat.
    let defeated = false;
    const t2 = Date.now();
    while (Date.now() - t2 < 300000) {
      d = await debug();
      if (d.screen === 'GAME_OVER') { defeated = true; break; }
      await sleep(500);
    }
    check('10. undefended run ends in real defeat', defeated, `screen=${d.screen} wave=${d.wave} score=${d.score}`);

    // 11. Restart through the visible button: fresh hearts, Ember, wave, score.
    const restartAt = await toClient(640, 592);
    await page.mouse.click(restartAt.x, restartAt.y);
    await sleep(300);
    d = await debug();
    check('11. RESTART button starts a fresh run',
      d.screen === 'PLAY' && d.wave === 1 && d.score === 0 && d.hearts === 3 && d.emberHp === 100,
      `screen=${d.screen} wave=${d.wave} score=${d.score} hearts=${d.hearts} ember=${d.emberHp}`);
    void scoreAfterWave1;

    // 12. Restart through the R key (from the pause screen, same restart path).
    await page.keyboard.press('KeyP');
    await sleep(200);
    await page.keyboard.press('KeyR');
    await sleep(300);
    d = await debug();
    check('12. R key restarts the run',
      d.screen === 'PLAY' && d.wave === 1 && d.score === 0,
      `screen=${d.screen} wave=${d.wave} score=${d.score}`);
    await page.close();

    check('browser: no console/page/request errors during UI play', problems.length === 0, problems.join(' | '));

    // ------------------------------------------------------------ replay
    const replayPage = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await replayPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await replayPage.waitForFunction(() => window.__wispTest !== undefined);
    const script = buildReplayScript(3600);
    const run1 = await replayPage.evaluate(([s, n]) => window.__wispTest.replay(7, s, n), [script, 3600]);
    const run2 = await replayPage.evaluate(([s, n]) => window.__wispTest.replay(7, s, n), [script, 3600]);
    check('replay: two 3600-step runs with identical seed+inputs match',
      JSON.stringify(run1) === JSON.stringify(run2),
      `run1 final=${JSON.stringify(run1[run1.length - 1])}`);
    console.log(`replay final snapshot: ${JSON.stringify(run1[run1.length - 1])}`);
    await replayPage.close();

    // ------------------------------------------------------------ re-stage shots
    for (const shot of SHOTS) {
      const runs = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
        const sp = await ctx.newPage();
        const probs = [];
        sp.on('pageerror', (err) => probs.push(err.message));
        sp.on('console', (msg) => { if (msg.type() === 'error') probs.push(msg.text()); });
        await sp.goto(`${BASE}/${shot.url}`, { waitUntil: 'load' });
        await sp.waitForFunction(() => window.__shotReady === true, null, { timeout: 240000 });
        const digest = await sp.evaluate(() => window.__shotDigest);
        const step = await sp.evaluate(() => window.__shotStep);
        const dataUrl = await sp.evaluate(() => document.getElementById('game').toDataURL('image/jpeg', 0.88));
        await ctx.close();
        runs.push({ digest, step, bytes: Buffer.from(dataUrl.split(',')[1], 'base64') });
        check(`${shot.name}: staging attempt ${attempt + 1} has no errors`, probs.length === 0, probs.join(' | '));
      }
      const reported = SHOT_REPORT.find((r) => r.name === shot.name);
      check(`${shot.name}: digest matches capture run`,
        runs[0].digest === reported.digest && runs[1].digest === reported.digest,
        `${runs[0].digest} vs ${reported.digest}`);
      check(`${shot.name}: step matches capture run`,
        runs[0].step === reported.step && runs[1].step === reported.step,
        `${runs[0].step} vs ${reported.step}`);
      check(`${shot.name}: two fresh stagings are byte-identical`,
        runs[0].bytes.equals(runs[1].bytes),
        `${runs[0].bytes.length} vs ${runs[1].bytes.length} bytes`);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures > 0) {
    console.error(`browser-check.mjs: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('browser-check.mjs: all checks passed');
}

main().catch((err) => {
  console.error(`browser-check.mjs: ${err.message}`);
  process.exit(1);
});
