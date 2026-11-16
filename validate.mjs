// Wispwarden validation: filesystem limits, reference audit, screenshot
// checks and byte-identical dossier runs. Run after capture-shots.mjs:
//   node validate.mjs
// Exits non-zero on the first failed check, printing what failed.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// ---------------------------------------------------------------- game tree

let entries = 0;
let bytes = 0;
const gameFiles = [];
(function walk(dir, rel) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const childRel = rel ? `${rel}/${name}` : name;
    const st = lstatSync(full);
    entries++;
    if (st.isSymbolicLink()) check(`game/: no symlinks (${childRel})`, false);
    else if (st.isDirectory()) walk(full, childRel);
    else if (st.isFile()) {
      bytes += st.size;
      gameFiles.push(childRel);
      check(`game/: path <= 1000 UTF-8 bytes (${childRel})`, Buffer.byteLength(childRel, 'utf8') <= 1000);
    } else {
      check(`game/: regular file (${childRel})`, false);
    }
  }
})(gameDir, '');
check('game/: <= 993 entries', entries <= 993, `${entries} entries`);
check('game/: <= 48 MiB', bytes <= 50331648, `${bytes} bytes`);
const indexStat = statSync(join(gameDir, 'index.html'));
check('game/: index.html regular and <= 1 MiB', indexStat.isFile() && indexStat.size <= 1048576, `${indexStat.size} bytes`);

// ---------------------------------------------------------------- references

// Every reachable script/module and the page itself must name nothing outside
// game/: no http/https URLs, no protocol-relative URLs, and every import
// specifier must be relative or a data: URI.
const urlPattern = /https?:\/\/|\/\/[a-zA-Z0-9]/;
let refsOk = true;
for (const rel of gameFiles) {
  if (!/\.(html|js|mjs)$/.test(rel)) continue;
  const text = readFileSync(join(gameDir, rel), 'utf8');
  if (urlPattern.test(text)) {
    console.log(`FAIL  references: URL in game/${rel}`);
    refsOk = false;
  }
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('data:')) {
      console.log(`FAIL  references: non-relative import ${spec} in game/${rel}`);
      refsOk = false;
    }
  }
  for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1];
    if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('data:')) {
      console.log(`FAIL  references: non-relative dynamic import ${spec} in game/${rel}`);
      refsOk = false;
    }
  }
}
check('game/: no external references', refsOk);

// ---------------------------------------------------------------- screenshots

const shotNames = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
check('screenshots/: exactly 4 files', shotNames.length === 4, shotNames.join(', '));
for (const name of shotNames) {
  const buf = readFileSync(join(shotsDir, name));
  const size = jpegSize(buf);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  check(`screenshots/${name}: JPEG, 1280x720, <= 256 KiB`,
    isJpeg && size !== null && size.width === 1280 && size.height === 720 && buf.length <= 262144,
    `${buf.length} bytes${size ? `, ${size.width}x${size.height}` : ''}`);
}
check('screenshots/: names are 1-4 in order',
  JSON.stringify(shotNames) === JSON.stringify(['1-start.jpg', '2-play.jpg', '3-upgrade.jpg', '4-end.jpg']));

// ---------------------------------------------------------------- dossier runs

function runMain(outDir) {
  const res = spawnSync('node', ['main.ts'], {
    cwd: repoRoot,
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    encoding: 'utf8',
  });
  return res;
}

const tmpA = mkdtempSync(join(tmpdir(), 'wisp-out-a-'));
const tmpB = mkdtempSync(join(tmpdir(), 'wisp-out-b-'));
try {
  const r1 = runMain(tmpA);
  check('main.ts: first run exits 0', r1.status === 0, r1.stderr.trim().split('\n').pop() || '');
  check('main.ts: dossier.json exists', existsSync(join(tmpA, 'dossier.json')));
  const r2 = runMain(tmpA); // second run into the same destination
  check('main.ts: second run to same dir exits 0', r2.status === 0);
  const r3 = runMain(tmpB); // clean second destination
  check('main.ts: run to clean dir exits 0', r3.status === 0);
  const diff = spawnSync('diff', ['-r', tmpA, tmpB], { encoding: 'utf8' });
  check('main.ts: two runs byte-identical', diff.status === 0, diff.stdout.trim().slice(0, 200));
  const dossier = readFileSync(join(tmpA, 'dossier.json'));
  check('main.ts: dossier.json <= 1.5 MiB', dossier.length <= 1572864, `${dossier.length} bytes`);
} finally {
  rmSync(tmpA, { recursive: true, force: true });
  rmSync(tmpB, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`validate.mjs: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('validate.mjs: all checks passed');
