// Wispwarden configuration: palette, dimensions, tuning, enemy and upgrade tables.
// Every number here is a design decision from the game design; the simulation
// modules read these values and never hard-code their own copies.

export const LOGICAL_WIDTH = 1280;
export const LOGICAL_HEIGHT = 720;

// Playable arena. The HUD owns the top 96 pixels; the arena floor starts below it.
export const ARENA = { x0: 32, y0: 112, x1: 1248, y1: 688 };

// The Last Ember: the lighthouse flame the player protects.
export const EMBER = { x: 640, y: 400, radius: 30, maxHp: 100 };

// Where a fresh run places the Wispwarden.
export const PLAYER_START = { x: 640, y: 530 };

export const PLAYER = {
  radius: 13,
  baseSpeed: 230, // pixels per second
  hearts: 3,
  heartCap: 3,
  maxHeartCap: 5,
  invulnSeconds: 1.1,
  knockback: 22,
  contactCooldownSeconds: 0.6, // per-enemy cooldown after it bites the player
};

export const BOLT = {
  radius: 4,
  baseSpeed: 600,
  damage: 1,
  lifeSteps: 75, // 1.25 seconds at 60 steps per second
  baseIntervalSeconds: 0.22,
  spawnOffset: 18, // pixels ahead of the player center
};

export const MOTE = {
  radius: 5,
  score: 10,
  lifeSteps: 720,
  collectRadius: 20,
  baseAttractRadius: 56,
  baseAttractSpeed: 280,
  scatterMin: 30,
  scatterMax: 60,
};

export const COMBO = {
  baseWindowSteps: 150,
  keeperWindowSteps: 300,
  maxMultiplier: 8,
  moteExtensionSteps: 6,
};

export const WAVE = {
  // Ordinary enemies in wave N: 6 + 3N. Every fifth wave adds one Gloom Herald.
  count: (n) => 6 + 3 * n,
  // Seconds between ordinary spawns, rounded to whole steps by the spawner.
  intervalSeconds: (n) => Math.max(0.24, 0.85 - 0.045 * (n - 1)),
  // Ordinary-enemy movement multiplier, capped at 1.8.
  speedMultiplier: (n) => Math.min(1.8, 1 + 0.045 * (n - 1)),
  clearBonus: (n) => 500 + 100 * n,
  graceSteps: 90, // collection grace after the last enemy dies
  heraldEvery: 5,
};

export const ENEMY = {
  driftwisp: {
    kind: 'driftwisp', name: 'Driftwisp', radius: 15, hp: 1, speed: 44,
    score: 100, motes: 1, drift: 12, // sinusoidal perpendicular drift, px/s
  },
  dartshade: {
    kind: 'dartshade', name: 'Dartshade', radius: 12, hp: 1, speed: 62,
    score: 150, motes: 2,
    cycleSeconds: 1.8, cruiseSeconds: 1.2, dashSeconds: 0.6, dashSpeed: 185,
    telegraphSeconds: 0.2, // compress + brighten before the dash
  },
  bulwark: {
    kind: 'bulwark', name: 'Bulwark', radius: 25, hp: 4, speed: 30,
    score: 350, motes: 4, shieldArcDegrees: 110,
  },
  splitter: {
    kind: 'splitter', name: 'Splitter', radius: 20, hp: 2, speed: 39,
    score: 250, motes: 2, lateral: 20, // lateral oscillation, px/s
    childOffset: 22, childRadius: 11, childSpeed: 57,
  },
  splitterChild: {
    kind: 'splitterChild', name: 'Wisp Mote', radius: 11, hp: 1, speed: 57,
    score: 50, motes: 1, drift: 12,
  },
  herald: {
    kind: 'herald', name: 'Gloom Herald', radius: 42, hp: 30, speed: 24,
    score: 2000, motes: 12,
    orbitRadius: 190, orbitSpeed: 0.28, // radians per second
    burstIntervalSeconds: 2.4, burstCount: 10, orbSpeed: 88, orbRadius: 8,
    orbLifeSteps: 420, // 7 seconds
    telegraphSeconds: 0.55, burstRotationDegrees: 18,
  },
};

export const ORB = { radius: 8, damageHearts: 1 };

// Weighted pick tables for the non-guaranteed ordinary spawns, per wave band.
export const SPAWN_WEIGHTS = {
  2: [['driftwisp', 75], ['dartshade', 25]],
  3: [['driftwisp', 60], ['dartshade', 25], ['bulwark', 15]],
  4: [['driftwisp', 45], ['dartshade', 25], ['bulwark', 15], ['splitter', 15]],
};

// Guaranteed opening sequences (spawn indices 0..). Wave 1 is Driftwisps only.
export const OPENING = {
  2: ['driftwisp', 'driftwisp', 'dartshade'],
  3: ['driftwisp', 'driftwisp', 'bulwark', 'dartshade'],
  4: ['driftwisp', 'bulwark', 'dartshade', 'splitter'],
};

export const SPAWN = {
  edgeX: [40, 1240],
  edgeY: [120, 680],
  edgeSpanX: [52, 1228], // x range when spawning on a horizontal edge
  edgeSpanY: [132, 668], // y range when spawning on a vertical edge
  minPlayerDistance: 140,
  maxTries: 8,
};

// ---------------------------------------------------------------- upgrades

// Ten upgrades. `max` is the highest rank; 0 means repeatable while eligible.
// `icon` names the procedural glyph the renderer draws on the card and HUD.
export const UPGRADES = [
  { id: 'quicklight', name: 'Quicklight', max: 3, icon: 'bolt',
    effect: 'Bolts fly 25% faster and fire 10% quicker.' },
  { id: 'twin', name: 'Twin Lantern', max: 1, icon: 'twin',
    effect: 'Every volley fires one extra bolt.' },
  { id: 'through', name: 'Throughglow', max: 2, icon: 'pierce',
    effect: 'Each bolt pierces one more enemy.' },
  { id: 'fan', name: 'Dawn Fan', max: 1, icon: 'fan',
    effect: 'Two more bolts per volley, spread wide.' },
  { id: 'wick', name: 'Spare Wick', max: 0, icon: 'heart',
    effect: '+1 heart capacity (max 5) and heal 1 heart.' },
  { id: 'mend', name: 'Ember Mend', max: 0, icon: 'flame',
    effect: 'Restore 30 Ember health.' },
  { id: 'magnet', name: 'Mote Magnet', max: 2, icon: 'magnet',
    effect: 'Motes fly to you from much farther away.' },
  { id: 'boots', name: 'Swift Boots', max: 2, icon: 'boots',
    effect: 'Move 25% faster.' },
  { id: 'ward', name: 'Ember Ward', max: 2, icon: 'ward',
    effect: 'The Ember itself burns nearby shades.' },
  { id: 'keeper', name: 'Combo Keeper', max: 1, icon: 'combo',
    effect: 'Combo window doubles to 300 steps.' },
];

export const FALLBACK_UPGRADE = {
  id: 'glow', name: 'Restorative Glow', max: 0, icon: 'glow',
  effect: 'Heal 1 heart, mend the Ember, or gain 300 points.',
};

// Volley patterns, in degrees around the aim direction.
export const VOLLEY = {
  base: [0],
  twin: [-5, 5],
  fan: [-14, 0, 14],
  twinFan: [-18, -6, 6, 18],
};

export const WARD = {
  radius: 76,
  intervalSeconds: 0.75,
  damageByRank: [0, 1, 2],
};

// ---------------------------------------------------------------- palette

export const COLORS = {
  outer: '#070B1C',
  lagoon: '#101A36',
  panel: '#182440',
  panelSoft: '#1B2C52',
  teal: '#64E7D2',
  gold: '#FFD782',
  text: '#F4F1DE',
  textDim: '#B8C8D9',
  shade: '#66528D',
  eye: '#D5A0FF',
  hurt: '#FF788E',
  emberCore: '#FFE9A8',
  emberFlame: '#FFB347',
  white: '#FFFFFF',
};

// ---------------------------------------------------------------- simulation

export const STEPS_PER_SECOND = 60;
export const STEP_SECONDS = 1 / 60;
export const MAX_FRAME_MS = 250; // wall-clock accepted from one animation frame
export const MAX_STEPS_PER_FRAME = 15;

export const BEST_KEY = 'wispwarden.best.v1';

// Screenshot staging limits.
export const SHOT_SEED = 7;
export const MAX_SHOT_STEPS = 120000;
export const SHOT_TITLE_STEPS = 120; // title visual time before the start shot
export const SHOT_PAUSE_STEPS = 30; // paused-overlay presentation steps
export const SHOT_END_STEPS = 90; // game-over presentation steps
