// Enemy construction and AI for Wispwarden. Each kind has its own movement
// shape: Driftwisps drift sinusoidally toward the Ember, Dartshades telegraph
// then dash at the player, Bulwarks advance behind a frontal shield, Splitters
// break into children, and the Gloom Herald orbits the Ember firing radial
// bursts. All movement is per fixed step and reads only the world's streams.

import { EMBER, ARENA, ENEMY, WAVE, STEP_SECONDS } from './config.js';

// Build one enemy. Ordinary speeds scale with the wave; HP never scales.
// `phase` seeds each enemy's sinusoidal drift so siblings do not move in lockstep.
export function makeEnemy(kind, id, x, y, wave, rng) {
  const def = ENEMY[kind];
  const ordinary = kind !== 'herald';
  const speed = ordinary ? def.speed * WAVE.speedMultiplier(wave) : def.speed;
  return {
    id, kind,
    x, y,
    hp: def.hp, maxHp: def.hp,
    radius: def.radius,
    speed,
    score: def.score,
    motes: def.motes,
    phase: rng() * Math.PI * 2,
    t: 0, // seconds alive; drives the Dartshade cycle and Herald timers
    facing: -Math.PI / 2, // movement direction; the Bulwark shield centers here
    moveX: 0, moveY: -1, // last normalized movement direction
    dashing: false,
    dashX: 0, dashY: 0, // captured dash direction, held for the dash duration
    telegraph: false, // Dartshade pre-dash compression / Herald burst warning
    contactCd: 0, // steps until this enemy may damage the player again
    flash: 0, // steps of white damage flash remaining
    // Herald-only state:
    state: kind === 'herald' ? 'approach' : '',
    orbitAngle: -Math.PI / 2,
    burstTimer: ENEMY.herald.burstIntervalSeconds,
    burstIndex: 0,
  };
}

// Is the impact point (hx, hy) inside this Bulwark's frontal shield arc?
// The arc is 110 degrees wide, centered on the enemy's facing. The incoming
// side is the direction from the enemy center to the bolt impact.
export function bulwarkBlocked(enemy, hx, hy) {
  const halfArc = (ENEMY.bulwark.shieldArcDegrees / 2) * (Math.PI / 180);
  const toHit = Math.atan2(hy - enemy.y, hx - enemy.x);
  let diff = toHit - enemy.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) < halfArc;
}

// Spawn a Splitter's two children, offset 22 px perpendicular to the parent's
// travel direction and clamped inside the arena. Children cannot split.
export function spawnSplitterChildren(world, parent) {
  const def = ENEMY.splitter;
  const px = -parent.moveY;
  const py = parent.moveX;
  for (const sign of [-1, 1]) {
    const x = Math.max(ARENA.x0 + def.childRadius,
      Math.min(ARENA.x1 - def.childRadius, parent.x + px * def.childOffset * sign));
    const y = Math.max(ARENA.y0 + def.childRadius,
      Math.min(ARENA.y1 - def.childRadius, parent.y + py * def.childOffset * sign));
    world.enemies.push(makeEnemy('splitterChild', world.nextId++, x, y, world.wave, world.streams.spawn));
  }
}

// One fixed step of enemy movement and boss attacks, in ascending ID order.
// The array is kept sorted because IDs only increase and children are appended.
export function updateEnemies(world) {
  const dt = STEP_SECONDS;
  for (const e of world.enemies) {
    e.t += dt;
    if (e.flash > 0) e.flash--;
    if (e.contactCd > 0) e.contactCd--;

    if (e.kind === 'driftwisp' || e.kind === 'splitterChild') {
      moveTowardWithDrift(world, e, EMBER.x, EMBER.y, ENEMY[e.kind].drift, dt);
    } else if (e.kind === 'dartshade') {
      updateDartshade(world, e, dt);
    } else if (e.kind === 'bulwark') {
      moveTowardWithDrift(world, e, EMBER.x, EMBER.y, 0, dt);
    } else if (e.kind === 'splitter') {
      moveTowardWithDrift(world, e, EMBER.x, EMBER.y, ENEMY.splitter.lateral, dt);
    } else if (e.kind === 'herald') {
      updateHerald(world, e, dt);
    }
  }
}

// Seek (tx, ty) at the enemy's speed with a sinusoidal perpendicular drift.
function moveTowardWithDrift(world, e, tx, ty, drift, dt) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const sway = Math.sin(world.playStep * 0.06 + e.phase) * drift;
  const vx = ux * e.speed + -uy * sway;
  const vy = uy * e.speed + ux * sway;
  e.x += vx * dt;
  e.y += vy * dt;
  const m = Math.hypot(vx, vy) || 1;
  e.moveX = vx / m;
  e.moveY = vy / m;
  e.facing = Math.atan2(vy, vx);
}

// Dartshade cycle: 1.2 s cruising at the player, then a 0.6 s dash at 185 px/s
// along the direction captured when the dash begins. The final 0.2 s before
// the dash compresses the body and brightens the eyes (telegraph).
function updateDartshade(world, e, dt) {
  const def = ENEMY.dartshade;
  const cyc = e.t % def.cycleSeconds;
  const p = world.player;
  if (cyc < def.cruiseSeconds) {
    e.dashing = false;
    e.telegraph = cyc >= def.cruiseSeconds - def.telegraphSeconds;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    e.x += (dx / dist) * e.speed * dt;
    e.y += (dy / dist) * e.speed * dt;
    e.moveX = dx / dist;
    e.moveY = dy / dist;
    e.facing = Math.atan2(dy, dx);
  } else {
    if (!e.dashing) {
      e.dashing = true;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.dashX = dx / dist;
      e.dashY = dy / dist;
    }
    e.telegraph = false;
    e.x += e.dashX * def.dashSpeed * dt;
    e.y += e.dashY * def.dashSpeed * dt;
    e.moveX = e.dashX;
    e.moveY = e.dashY;
    e.facing = Math.atan2(e.dashY, e.dashX);
  }
}

// Herald: approach to 190 px above the Ember, then orbit at radius 190 with
// angular speed 0.28 rad/s. Every 2.4 s it telegraphs for 0.55 s, then emits
// ten equally spaced orbs; the pattern rotates 18 degrees after each burst.
function updateHerald(world, e, dt) {
  const def = ENEMY.herald;
  if (e.state === 'approach') {
    const tx = EMBER.x;
    const ty = EMBER.y - def.orbitRadius;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 4) {
      e.state = 'orbit';
      e.orbitAngle = Math.atan2(e.y - EMBER.y, e.x - EMBER.x);
    } else {
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
      e.moveX = dx / dist;
      e.moveY = dy / dist;
      e.facing = Math.atan2(dy, dx);
    }
  } else {
    e.orbitAngle += def.orbitSpeed * dt;
    e.x = EMBER.x + Math.cos(e.orbitAngle) * def.orbitRadius;
    e.y = EMBER.y + Math.sin(e.orbitAngle) * def.orbitRadius;
    e.moveX = -Math.sin(e.orbitAngle);
    e.moveY = Math.cos(e.orbitAngle);
    e.facing = Math.atan2(e.y - EMBER.y, e.x - EMBER.x);
  }

  e.burstTimer -= dt;
  e.telegraph = e.burstTimer <= def.telegraphSeconds && e.burstTimer > 0;
  if (e.burstTimer <= 0) {
    const baseAngle = (e.burstIndex * def.burstRotationDegrees * Math.PI) / 180;
    for (let i = 0; i < def.burstCount; i++) {
      const a = baseAngle + (i / def.burstCount) * Math.PI * 2;
      world.orbs.push({
        id: world.nextId++,
        x: e.x + Math.cos(a) * (e.radius + 6),
        y: e.y + Math.sin(a) * (e.radius + 6),
        vx: Math.cos(a) * def.orbSpeed,
        vy: Math.sin(a) * def.orbSpeed,
        radius: def.orbRadius,
        life: def.orbLifeSteps,
      });
    }
    e.burstIndex++;
    e.burstTimer = def.burstIntervalSeconds;
    e.telegraph = false;
  }
}
