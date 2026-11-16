// Wispwarden entrypoint: copy game/ and screenshots/ into the output
// directory and write the dossier buildDossier produces from them.
// Node standard library only, plus the required local vendor import.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function fail(message: string): never {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

function resolveOutputDir(): string {
  const raw = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  return resolve(process.cwd(), raw);
}

function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

// Validate a source tree before copying: no symlinks, only regular files and
// directories, path and size limits, traversal in fixed lexical order.
function validateTree(dir: string, label: string, maxFiles: number, maxBytes: number): void {
  let entries = 0;
  let bytes = 0;
  const walk = (current: string, rel: string): void => {
    const names = readdirSync(current).sort();
    for (const name of names) {
      const full = join(current, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(full);
      entries++;
      if (entries > maxFiles) fail(`${label}: more than ${maxFiles} entries`);
      if (Buffer.byteLength(childRel, 'utf8') > 1000) fail(`${label}: path over 1000 UTF-8 bytes: ${childRel}`);
      if (st.isSymbolicLink()) fail(`${label}: symlink not allowed: ${childRel}`);
      if (st.isDirectory()) {
        walk(full, childRel);
      } else if (st.isFile()) {
        bytes += st.size;
        if (bytes > maxBytes) fail(`${label}: more than ${maxBytes} bytes`);
      } else {
        fail(`${label}: non-regular file: ${childRel}`);
      }
    }
  };
  walk(dir, '');
}

function main(): void {
  const outDir = resolveOutputDir();
  for (const src of [gameDir, shotsDir, join(repoRoot, 'vendor')]) {
    if (pathsOverlap(outDir, src)) fail(`output directory overlaps source: ${outDir}`);
  }
  if (outDir === repoRoot) fail('output directory must not be the repository root');
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) fail('game/ is missing');
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) fail('screenshots/ is missing');

  validateTree(gameDir, 'game/', CAPS.game_max_files, CAPS.game_max_bytes);
  validateTree(shotsDir, 'screenshots/', 4, 4 * CAPS.screenshots.max_bytes);

  // The vendor file must be the kit's byte-for-byte copy (kit.json sha256).
  const vendorBytes = readFileSync(join(repoRoot, 'vendor', 'makefun-game.ts'));
  const vendorHash = createHash('sha256').update(vendorBytes).digest('hex');
  if (vendorHash !== 'dc67187521b24025ff952f8c231485a6eb92d6d71d29edd2a08154ffb4376129') {
    fail('vendor/makefun-game.ts does not match the kit hash');
  }

  // Remove stale contents only from the owned output subdirectories, then
  // copy fresh. Unrelated files in an explicitly supplied output directory
  // are preserved.
  mkdirSync(outDir, { recursive: true });
  for (const sub of ['game', 'screenshots']) {
    const target = join(outDir, sub);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
  }
  cpSync(gameDir, join(outDir, 'game'), { recursive: true });
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

  // The dossier is exactly what buildDossier writes from the copied game and
  // screenshots. No hand-constructed lookalike, no rewritten schema.
  const dossier = buildDossier(outDir, CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`wrote ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
}

main();
