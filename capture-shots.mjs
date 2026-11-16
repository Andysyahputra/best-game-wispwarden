// Capture the four Wispwarden screenshots as real renders of the submitted
// code: serve game/ locally, stage each scene in headless Chromium, wait for
// window.__shotReady, and capture the canvas itself at exactly 1280x720.
// Any console error, page error, failed request or readiness timeout fails
// the run. JPEG quality starts at 88 and steps down to 60 when a file would
// exceed 262,144 bytes; images are never resized or composited.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/hatch/workspace/makefun/threejs-fps-01/browser-tool/node_modules/playwright-core');

const repoRoot = dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/home/hatch/.hermes/tools/chromium-1208/chrome-linux64/chrome';
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_BYTES = 262144;
const QUALITIES = [88, 80, 72, 65, 60];
const SHOTS = JSON.parse(readFileSync(join(repoRoot, 'shots.json'), 'utf8'));

// JPEG dimensions from the SOF0/SOF2 marker (big-endian height then width).
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
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

async function main() {
  mkdirSync(join(repoRoot, 'screenshots'), { recursive: true });
  const server = spawn('node', ['serve.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const results = [];
  try {
    await waitForServer();
    for (const shot of SHOTS) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
      const problems = [];
      page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText || ''}`));
      page.on('response', (res) => { if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`); });

      await page.goto(`${BASE}/${shot.url}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 240000 });
      if (problems.length > 0) throw new Error(`shot ${shot.name}: ${problems.join(' | ')}`);

      const digest = await page.evaluate(() => window.__shotDigest);
      const step = await page.evaluate(() => window.__shotStep);
      const canvas = page.locator('#game');

      // Capture the canvas element; verify 1280x720 from the JPEG itself and
      // fall back to the canvas backing store if the element box ever differs.
      let chosen = null;
      for (const q of QUALITIES) {
        let buf = await canvas.screenshot({ type: 'jpeg', quality: q });
        let size = jpegSize(buf);
        if (!size || size.width !== 1280 || size.height !== 720) {
          const dataUrl = await page.evaluate((quality) => {
            const c = document.getElementById('game');
            return c.toDataURL('image/jpeg', quality);
          }, q / 100);
          buf = Buffer.from(dataUrl.split(',')[1], 'base64');
          size = jpegSize(buf);
        }
        if (size && size.width === 1280 && size.height === 720 && buf.length <= MAX_BYTES) {
          chosen = { buf, quality: q };
          break;
        }
        if (size && size.width === 1280 && size.height === 720) {
          // Too big at this quality; try the next lower one.
          continue;
        }
        throw new Error(`shot ${shot.name}: capture is not 1280x720`);
      }
      if (!chosen) throw new Error(`shot ${shot.name}: still over ${MAX_BYTES} bytes at quality 60`);
      writeFileSync(join(repoRoot, 'screenshots', shot.name), chosen.buf);
      results.push({ name: shot.name, bytes: chosen.buf.length, quality: chosen.quality, digest, step });
      console.log(`${shot.name}: ${chosen.buf.length} bytes at quality ${chosen.quality}, step ${step}, digest ${digest}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`captured ${results.length} screenshots`);
  writeFileSync(join(repoRoot, 'shots-report.json'), JSON.stringify(results, null, 2) + '\n');
  return results;
}

main().catch((err) => {
  console.error(`capture-shots: ${err.message}`);
  process.exit(1);
});
