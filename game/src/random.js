// Deterministic random streams for Wispwarden.
// Gameplay never uses Math.random, Date.now or rendering cadence: every random
// decision comes from one of the four streams below, each derived from the run
// seed by XOR with a fixed constant. Identical seed + identical inputs therefore
// reproduce identical simulation state.

// Parse a seed as an unsigned decimal integer 0..4294967295; anything malformed
// or out of range falls back to seed 7.
export function parseSeed(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295) {
    return value >>> 0;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 4294967295) return n >>> 0;
  }
  return 7;
}

// mulberry32, implemented with exact JavaScript unsigned 32-bit arithmetic.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The four independent streams, each XOR-derived from the base seed.
export function makeStreams(seed) {
  return {
    spawn: mulberry32((seed ^ 0xa341316c) >>> 0),
    loot: mulberry32((seed ^ 0xc8013ea4) >>> 0),
    upgrade: mulberry32((seed ^ 0xad90777d) >>> 0),
    cosmetic: mulberry32((seed ^ 0x7e95761e) >>> 0),
  };
}

// Helpers that read from a stream function and stay inside [0, 1).
export function randomRange(rng, min, max) {
  return min + rng() * (max - min);
}

export function randomInt(rng, min, max) {
  // Inclusive integer in [min, max].
  return min + Math.floor(rng() * (max - min + 1));
}

// Pick one entry from a [[value, weight], ...] table using the given stream.
export function weightedPick(rng, table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = rng() * total;
  for (const [value, w] of table) {
    roll -= w;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
}
