// Cosmetic feedback for Wispwarden: bounded particle pools, floating score
// text, impact flashes and deterministic camera shake. Cosmetic randomness uses
// only the cosmetic stream and never touches gameplay streams; the shake offset
// is a pure function of the simulation step, so it is reproducible.

export const MAX_PARTICLES = 600;
export const MAX_TEXTS = 48;

export function createFx() {
  return {
    particles: [], // {x, y, vx, vy, life, maxLife, size, color}
    texts: [], // {x, y, life, maxLife, str, color, big}
    flash: 0, // player-hit white-gold flash, steps remaining
    muzzle: 0, // muzzle glow, steps remaining
    shakeT: 0, // shake steps remaining
    shakeAmp: 0, // shake amplitude in pixels
  };
}

function pushParticle(fx, p) {
  if (fx.particles.length >= MAX_PARTICLES) fx.particles.shift(); // discard oldest
  fx.particles.push(p);
}

// A burst of sparks at (x, y). Counts follow the design: 12 ordinary kills,
// 20 for Bulwarks and Splitters, 48 for the Herald.
export function burst(fx, rng, x, y, count, color, speed = 160) {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const s = speed * (0.35 + rng() * 0.65);
    pushParticle(fx, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 22 + Math.floor(rng() * 14),
      maxLife: 36,
      size: 2 + rng() * 3,
      color,
    });
  }
}

// A short gold-purple deflection spark for a blocked Bulwark hit.
export function deflectSpark(fx, rng, x, y) {
  burst(fx, rng, x, y, 6, '#D5A0FF', 120);
  burst(fx, rng, x, y, 4, '#FFD782', 90);
}

export function addText(fx, x, y, str, color, big = false) {
  if (fx.texts.length >= MAX_TEXTS) fx.texts.shift();
  fx.texts.push({ x, y, life: 48, maxLife: 48, str, color, big });
}

// Player hit: white-gold flash for 8 steps and an 18-step shake at amplitude 7.
export function playerHitFeedback(fx) {
  fx.flash = 8;
  fx.shakeT = 18;
  fx.shakeAmp = 7;
}

export function muzzleFlash(fx) {
  fx.muzzle = 4;
}

export function updateFx(fx) {
  for (const p of fx.particles) {
    p.x += p.vx / 60;
    p.y += p.vy / 60;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life--;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  for (const t of fx.texts) {
    t.y -= 28 / 48; // rise 28 pixels over its 48-step life
    t.life--;
  }
  fx.texts = fx.texts.filter((t) => t.life > 0);
  if (fx.flash > 0) fx.flash--;
  if (fx.muzzle > 0) fx.muzzle--;
  if (fx.shakeT > 0) fx.shakeT--;
}

// Deterministic shake offset for the current step: a pure function of the step
// counter and the remaining amplitude, decaying linearly. The HUD and overlays
// are drawn without this offset and stay stationary.
export function shakeOffset(fx, step) {
  if (fx.shakeT <= 0) return { x: 0, y: 0 };
  const amp = fx.shakeAmp * (fx.shakeT / 18);
  const sx = Math.sin(step * 12.9898) * 43758.5453;
  const sy = Math.sin(step * 7.2331 + 1.7) * 24634.6345;
  const fx1 = sx - Math.floor(sx);
  const fy = sy - Math.floor(sy);
  return { x: (fx1 * 2 - 1) * amp, y: (fy * 2 - 1) * amp };
}
