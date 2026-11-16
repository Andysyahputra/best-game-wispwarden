// The world: screen machine, fixed-step simulation, spawning, collisions,
// scoring, combo, motes, waves and upgrade offers for Wispwarden.
// One fixed step is 1/60 s. Every PLAY step runs in the design's exact order:
// actions, spawning, player, bolts, enemies, bolt hits, contacts, orbs, motes,
// cleanup, then defeat before wave completion. A dead enemy cannot act later
// in the same step.

import {
  ARENA, EMBER, PLAYER_START, PLAYER, BOLT, MOTE, COMBO, WAVE, ENEMY, SPAWN,
  SPAWN_WEIGHTS, OPENING, UPGRADES, FALLBACK_UPGRADE, WARD, BEST_KEY,
  STEP_SECONDS, STEPS_PER_SECOND,
} from './config.js';
import { parseSeed, makeStreams, weightedPick, randomRange } from './random.js';
import { takeActions } from './input.js';
import { makeEnemy, updateEnemies, bulwarkBlocked, spawnSplitterChildren } from './enemies.js';
import { createPlayerState, updatePlayer, damagePlayer, applyUpgrade, comboWindow, magnetRadius, magnetSpeed } from './player.js';
import { createFx, burst, deflectSpark, addText, updateFx } from './particles.js';
import { createAudio, setMuted, playKill, playHurt, playHorn, playUpgrade, playGameOver } from './audio.js';

// ---------------------------------------------------------------- best score

export function createMemoryStore(initial = 0) {
  let best = Math.max(0, Math.floor(initial) || 0);
  return {
    getBest: () => best,
    setBest: (n) => { best = Math.max(0, Math.floor(n) || 0); },
  };
}

// localStorage-backed best score; falls back to memory when storage is
// unavailable or holds an invalid value.
export function createBestStore() {
  const mem = createMemoryStore(0);
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) mem.setBest(n);
    }
    return {
      getBest: () => mem.getBest(),
      setBest: (n) => {
        mem.setBest(n);
        try { window.localStorage.setItem(BEST_KEY, String(mem.getBest())); } catch { /* ignore */ }
      },
    };
  } catch {
    return mem;
  }
}

// ---------------------------------------------------------------- creation

export function createWorld(opts = {}) {
  const seed = parseSeed(opts.seed);
  const store = opts.store || createBestStore();
  const world = {
    seed,
    store,
    shotMode: !!opts.shotMode,
    streams: makeStreams(seed),
    audio: createAudio(),
    fx: createFx(),
    screen: 'TITLE', // TITLE | PLAY | UPGRADE | PAUSED | GAME_OVER
    pausedFrom: null, // screen remembered under PAUSED
    playStep: 0, // PLAY steps elapsed in this run
    visualTime: 0, // presentation steps; frozen while paused
    wave: 0,
    score: 0,
    best: store.getBest(),
    kills: 0,
    combo: 1,
    comboDeadline: 0, // playStep by which the next kill must land
    streak: 0, // kills in the current combo chain
    comboPulse: 0, // steps of combo-bar pulse left (mote feedback)
    hearts: PLAYER.hearts,
    heartCap: PLAYER.heartCap,
    emberHp: EMBER.maxHp,
    emberFlash: 0, // steps of Ember damage flash remaining
    player: createPlayerState(),
    enemies: [],
    bolts: [],
    orbs: [],
    motes: [],
    nextId: 1,
    spawnList: [], // ordinary kinds in spawn order for the current wave
    spawnIndex: 0,
    spawnTimer: 0, // steps until the next ordinary spawn
    spawnIntervalSteps: 51,
    heraldAt: -1, // ordinary-spawn index at which the Herald joins
    heraldSpawned: false,
    grace: 0, // wave-clear collection grace, steps remaining
    graceActive: false,
    upgrades: {
      quicklight: 0, twin: 0, through: 0, fan: 0, wick: 0,
      mend: 0, magnet: 0, boots: 0, ward: 0, keeper: 0, glow: 0,
    },
    offers: [], // three upgrade offers on the UPGRADE screen
    selectedOffer: -1,
    stats: { shotsFired: 0, upgradesTaken: 0 },
  };
  world.player.x = PLAYER_START.x;
  world.player.y = PLAYER_START.y;
  return world;
}

// ---------------------------------------------------------------- run control

// Reset every run-specific value and begin wave 1. Best score and mute
// preference survive; random streams restart from the run seed.
export function startRun(world) {
  world.streams = makeStreams(world.seed);
  world.playStep = 0;
  world.visualTime = 0;
  world.wave = 0;
  world.score = 0;
  world.kills = 0;
  world.combo = 1;
  world.comboDeadline = 0;
  world.streak = 0;
  world.comboPulse = 0;
  world.hearts = PLAYER.hearts;
  world.heartCap = PLAYER.heartCap;
  world.emberHp = EMBER.maxHp;
  world.emberFlash = 0;
  world.player = createPlayerState();
  world.player.x = PLAYER_START.x;
  world.player.y = PLAYER_START.y;
  world.enemies = [];
  world.bolts = [];
  world.orbs = [];
  world.motes = [];
  world.nextId = 1;
  world.grace = 0;
  world.graceActive = false;
  world.upgrades = {
    quicklight: 0, twin: 0, through: 0, fan: 0, wick: 0,
    mend: 0, magnet: 0, boots: 0, ward: 0, keeper: 0, glow: 0,
  };
  world.offers = [];
  world.selectedOffer = -1;
  world.stats = { shotsFired: 0, upgradesTaken: 0 };
  world.fx = createFx();
  world.screen = 'PLAY';
  world.pausedFrom = null;
  beginWave(world, 1);
}

export function pauseWorld(world) {
  if (world.screen === 'PLAY' || world.screen === 'UPGRADE') {
    world.pausedFrom = world.screen;
    world.screen = 'PAUSED';
  }
}

export function resumeWorld(world) {
  if (world.screen === 'PAUSED' && world.pausedFrom) {
    world.screen = world.pausedFrom;
    world.pausedFrom = null;
  }
}

function gameOver(world) {
  if (world.screen === 'GAME_OVER') return;
  world.screen = 'GAME_OVER';
  world.pausedFrom = null;
  saveBest(world);
  playGameOver(world.audio);
}

// ---------------------------------------------------------------- waves

function buildSpawnList(world, n) {
  const total = WAVE.count(n);
  const list = [];
  const opening = n === 1 ? [] : (OPENING[n] || OPENING[4]);
  for (let i = 0; i < total; i++) {
    if (i < opening.length) {
      list.push(opening[i]);
    } else if (n === 1) {
      list.push('driftwisp');
    } else {
      const weights = SPAWN_WEIGHTS[n >= 4 ? 4 : n];
      list.push(weightedPick(world.streams.spawn, weights));
    }
  }
  return list;
}

export function beginWave(world, n) {
  world.wave = n;
  world.combo = 1; // combo resets to x1 when the next wave begins
  world.streak = 0;
  world.comboDeadline = 0;
  world.spawnList = buildSpawnList(world, n);
  world.spawnIndex = 0;
  world.spawnTimer = 0; // the first enemy spawns immediately
  world.spawnIntervalSteps = Math.max(1, Math.round(WAVE.intervalSeconds(n) * STEPS_PER_SECOND));
  world.heraldAt = Math.floor(world.spawnList.length / 2);
  world.heraldSpawned = false;
  world.grace = 0;
  world.graceActive = false;
  playHorn(world.audio);
}

function pickSpawnPosition(world) {
  const rng = world.streams.spawn;
  const p = world.player;
  let best = null;
  let bestDist = -1;
  for (let attempt = 0; attempt < SPAWN.maxTries; attempt++) {
    let x, y;
    if (rng() < 0.5) {
      x = rng() < 0.5 ? SPAWN.edgeX[0] : SPAWN.edgeX[1];
      y = randomRange(rng, SPAWN.edgeSpanY[0], SPAWN.edgeSpanY[1]);
    } else {
      y = rng() < 0.5 ? SPAWN.edgeY[0] : SPAWN.edgeY[1];
      x = randomRange(rng, SPAWN.edgeSpanX[0], SPAWN.edgeSpanX[1]);
    }
    const d = Math.hypot(x - p.x, y - p.y);
    if (d >= SPAWN.minPlayerDistance) return { x, y };
    if (d > bestDist) { bestDist = d; best = { x, y }; }
  }
  return best;
}

function spawnOrdinary(world, kind) {
  const pos = pickSpawnPosition(world);
  world.enemies.push(makeEnemy(kind, world.nextId++, pos.x, pos.y, world.wave, world.streams.spawn));
}

function spawnHerald(world) {
  const x = randomRange(world.streams.spawn, SPAWN.edgeSpanX[0], SPAWN.edgeSpanX[1]);
  world.enemies.push(makeEnemy('herald', world.nextId++, x, SPAWN.edgeY[0], world.wave, world.streams.spawn));
  world.heraldSpawned = true;
}

function advanceSpawning(world) {
  if (world.graceActive) return;
  if (world.wave % WAVE.heraldEvery === 0 && !world.heraldSpawned
    && world.spawnIndex >= world.heraldAt) {
    spawnHerald(world);
  }
  if (world.spawnIndex >= world.spawnList.length) return;
  if (world.spawnTimer > 0) {
    world.spawnTimer--;
    return;
  }
  spawnOrdinary(world, world.spawnList[world.spawnIndex]);
  world.spawnIndex++;
  world.spawnTimer = world.spawnIntervalSteps;
}

// ---------------------------------------------------------------- combat

function spawnMotes(world, x, y, count) {
  const rng = world.streams.loot;
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const s = randomRange(rng, MOTE.scatterMin, MOTE.scatterMax);
    world.motes.push({
      id: world.nextId++,
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      radius: MOTE.radius,
      life: MOTE.lifeSteps,
    });
  }
}

// Score, combo, drops and feedback for a weapon or ward kill. Splitter
// parents release two children; an Ember bite never reaches this function.
function killEnemy(world, enemy, cause) {
  enemy.dead = true;
  world.kills++;
  // Combo: a kill inside the window raises the multiplier by one (cap x8);
  // the first kill of a fresh chain starts at x1. Every kill refreshes the
  // deadline. Same-step kills resolve in ID order, building sequentially.
  if (world.streak > 0 && world.playStep <= world.comboDeadline) {
    world.combo = Math.min(COMBO.maxMultiplier, world.combo + 1);
  } else {
    world.combo = 1;
    world.streak = 0;
  }
  world.streak++;
  world.comboDeadline = world.playStep + comboWindow(world);
  const gained = enemy.score * world.combo;
  world.score += gained;
  addText(world.fx, enemy.x, enemy.y - 18, `+${gained}`, '#FFD782');
  const burstCount = enemy.kind === 'herald' ? 48
    : (enemy.kind === 'bulwark' || enemy.kind === 'splitter') ? 20 : 12;
  burst(world.fx, world.streams.cosmetic, enemy.x, enemy.y, burstCount, '#D5A0FF');
  playKill(world.audio, world.combo);
  spawnMotes(world, enemy.x, enemy.y, enemy.motes);
  if (enemy.kind === 'splitter' && (cause === 'bolt' || cause === 'ward')) {
    spawnSplitterChildren(world, enemy);
  }
}

function damageEnemy(world, enemy, dmg, cause) {
  enemy.hp -= dmg;
  enemy.flash = 5;
  if (enemy.hp <= 0) killEnemy(world, enemy, cause);
}

// Ember Ward: once every 0.75 s per enemy within 76 px of the Ember, deal one
// damage (rank 1) or two (rank 2). The first pulse on entering range is
// immediate. Ward damage resolves before Ember contact in the same step.
function applyWard(world) {
  const rank = world.upgrades.ward;
  if (rank <= 0) return;
  const dmg = WARD.damageByRank[rank];
  for (const e of world.enemies) {
    if (e.dead || e.kind === 'herald') continue;
    const d = Math.hypot(e.x - EMBER.x, e.y - EMBER.y);
    if (d <= WARD.radius + e.radius) {
      if (e.wardCd === undefined || e.wardCd === null) e.wardCd = 0;
      if (e.wardCd <= 0) {
        damageEnemy(world, e, dmg, 'ward');
        e.wardCd = Math.round(WARD.intervalSeconds * STEPS_PER_SECOND);
      }
    } else {
      e.wardCd = 0; // leaving range re-arms the immediate first pulse
    }
  }
}

// Swept segment-versus-circle test for one bolt against one enemy.
function segmentHitsCircle(px, py, x, y, cx, cy, r) {
  const dx = x - px;
  const dy = y - py;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) t = Math.max(0, Math.min(1, ((cx - px) * dx + (cy - py) * dy) / lenSq));
  const ix = px + dx * t;
  const iy = py + dy * t;
  const dist = Math.hypot(cx - ix, cy - iy);
  return { hit: dist <= r, t, ix, iy };
}

function resolveBoltHits(world) {
  for (const bolt of world.bolts) {
    if (bolt.dead) continue;
    // Candidate hits, sorted by distance along the bolt path, then enemy ID.
    const hits = [];
    for (const e of world.enemies) {
      if (e.dead || bolt.hitIds.has(e.id)) continue;
      const res = segmentHitsCircle(bolt.px, bolt.py, bolt.x, bolt.y, e.x, e.y, e.radius + bolt.radius);
      if (res.hit) hits.push({ enemy: e, t: res.t, ix: res.ix, iy: res.iy });
    }
    hits.sort((a, b) => (a.t - b.t) || (a.enemy.id - b.enemy.id));
    for (const h of hits) {
      if (bolt.pierceLeft <= 0) break;
      if (h.enemy.kind === 'bulwark' && bulwarkBlocked(h.enemy, h.ix, h.iy)) {
        // Blocked: the bolt is consumed even if piercing, and sparks harmlessly.
        deflectSpark(world.fx, world.streams.cosmetic, h.ix, h.iy);
        bolt.pierceLeft = 0;
        bolt.dead = true;
        break;
      }
      bolt.hitIds.add(h.enemy.id);
      bolt.pierceLeft--;
      damageEnemy(world, h.enemy, bolt.damage, 'bolt');
      if (bolt.pierceLeft <= 0) { bolt.dead = true; break; }
    }
  }
}

function resolveContacts(world) {
  const p = world.player;
  for (const e of world.enemies) {
    if (e.dead) continue;
    // Ember contact: 8 damage and the shade dies without kill credit, motes
    // or (for Splitters) children. The Herald cannot bite the Ember.
    if (e.kind !== 'herald') {
      const de = Math.hypot(e.x - EMBER.x, e.y - EMBER.y);
      if (de < e.radius + EMBER.radius) {
        e.dead = true;
        world.emberHp = Math.max(0, world.emberHp - 8);
        world.emberFlash = 10;
        burst(world.fx, world.streams.cosmetic, e.x, e.y, 10, '#FF788E');
        continue;
      }
    }
    // Player contact: one heart, 1.1 s invulnerability, a 22 px push. The
    // shade survives and waits out its 0.6 s contact cooldown.
    const dp = Math.hypot(e.x - p.x, e.y - p.y);
    if (dp < e.radius + PLAYER.radius && e.contactCd <= 0) {
      if (damagePlayer(world, e.x, e.y)) {
        playHurt(world.audio);
        e.contactCd = Math.round(PLAYER.contactCooldownSeconds * STEPS_PER_SECOND);
      }
    }
  }
}

function resolveOrbs(world) {
  const p = world.player;
  for (const o of world.orbs) {
    if (o.dead) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < o.radius + PLAYER.radius) {
      o.dead = true; // orbs vanish on contact even during invulnerability
      if (damagePlayer(world, o.x, o.y)) playHurt(world.audio);
    }
  }
}

function updateMotes(world) {
  const p = world.player;
  const attractR = magnetRadius(world);
  const attractS = magnetSpeed(world);
  for (const m of world.motes) {
    if (m.dead) continue;
    m.life--;
    if (m.life <= 0) { m.dead = true; continue; }
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d <= MOTE.collectRadius) {
      m.dead = true;
      world.score += MOTE.score;
      // A mote feeds the combo meter without raising its multiplier: it adds
      // six steps to an unexpired deadline, capped at the window beyond now.
      if (world.streak > 0 && world.playStep <= world.comboDeadline) {
        world.comboDeadline = Math.min(
          world.comboDeadline + COMBO.moteExtensionSteps,
          world.playStep + comboWindow(world),
        );
        world.comboPulse = 12;
      }
      continue;
    }
    if (d <= attractR && d > 0.001) {
      const pull = Math.min(attractS, (attractS * (attractR - d)) / attractR + 60);
      m.vx = (dx / d) * pull;
      m.vy = (dy / d) * pull;
    } else {
      m.vx *= 0.96;
      m.vy *= 0.96;
    }
    m.x += m.vx * STEP_SECONDS;
    m.y += m.vy * STEP_SECONDS;
  }
}

function cleanup(world) {
  world.enemies = world.enemies.filter((e) => !e.dead);
  world.bolts = world.bolts.filter((b) => !b.dead && b.life > 0);
  world.orbs = world.orbs.filter((o) => !o.dead && o.life > 0);
  world.motes = world.motes.filter((m) => !m.dead);
}

function saveBest(world) {
  if (world.score > world.best) {
    world.best = world.score;
    world.store.setBest(world.best);
  }
}

// ---------------------------------------------------------------- upgrades

function eligibleUpgrades(world) {
  const u = world.upgrades;
  const list = [];
  for (const def of UPGRADES) {
    if (def.id === 'quicklight' && u.quicklight < def.max) list.push(def);
    else if (def.id === 'twin' && u.twin < def.max) list.push(def);
    else if (def.id === 'through' && u.through < def.max) list.push(def);
    else if (def.id === 'fan' && u.fan < def.max) list.push(def);
    else if (def.id === 'wick' && world.heartCap < PLAYER.maxHeartCap) list.push(def);
    else if (def.id === 'mend' && world.emberHp < EMBER.maxHp) list.push(def);
    else if (def.id === 'magnet' && u.magnet < def.max) list.push(def);
    else if (def.id === 'boots' && u.boots < def.max) list.push(def);
    else if (def.id === 'ward' && u.ward < def.max) list.push(def);
    else if (def.id === 'keeper' && u.keeper < def.max) list.push(def);
  }
  return list;
}

// Roll three different eligible offers without replacement. Vacant positions
// fall back to Restorative Glow with distinct I / II / III labels.
export function rollOffers(world) {
  const rng = world.streams.upgrade;
  const pool = eligibleUpgrades(world);
  const offers = [];
  const taken = new Set();
  while (offers.length < 3 && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    const def = pool.splice(idx, 1)[0];
    if (taken.has(def.id)) continue;
    taken.add(def.id);
    offers.push({
      id: def.id, name: def.name, effect: def.effect, icon: def.icon,
      rank: world.upgrades[def.id] || 0, max: def.max, fallback: null,
    });
  }
  const roman = ['I', 'II', 'III'];
  while (offers.length < 3) {
    offers.push({
      id: 'glow', name: `Restorative Glow ${roman[offers.length]}`,
      effect: FALLBACK_UPGRADE.effect, icon: FALLBACK_UPGRADE.icon,
      rank: 0, max: 0, fallback: roman[offers.length],
    });
  }
  world.offers = offers;
  world.selectedOffer = -1;
}

export function confirmUpgrade(world) {
  if (world.screen !== 'UPGRADE' || world.selectedOffer < 0) return false;
  const offer = world.offers[world.selectedOffer];
  if (!offer) return false;
  applyUpgrade(world, offer.id);
  playUpgrade(world.audio);
  world.screen = 'PLAY';
  beginWave(world, world.wave + 1);
  return true;
}

// ---------------------------------------------------------------- step

function handleActions(world, actions) {
  for (const action of actions) {
    if (action === 'mute') {
      setMuted(world.audio, !world.audio.muted);
      continue;
    }
    if (action === 'pause') {
      if (world.screen === 'PAUSED') resumeWorld(world);
      else pauseWorld(world);
      continue;
    }
    if (action === 'confirm') {
      if (world.screen === 'TITLE' || world.screen === 'GAME_OVER') startRun(world);
      else if (world.screen === 'UPGRADE') confirmUpgrade(world);
      else if (world.screen === 'PAUSED') resumeWorld(world);
      continue;
    }
    if (action === 'restart') {
      if (world.screen === 'GAME_OVER' || world.screen === 'PAUSED') startRun(world);
      continue;
    }
    if (action === 'select1' || action === 'select2' || action === 'select3') {
      if (world.screen === 'UPGRADE') {
        world.selectedOffer = Number(action.slice(-1)) - 1;
      }
    }
  }
}

// One fixed 1/60 s step. Screens other than PLAY advance presentation time
// only; PAUSED advances nothing at all.
export function updateWorld(world, input) {
  const actions = takeActions(input);
  handleActions(world, actions);

  if (world.screen === 'PAUSED') return;

  if (world.screen === 'TITLE' || world.screen === 'GAME_OVER') {
    world.visualTime++;
    updateFx(world.fx);
    return;
  }

  if (world.screen === 'UPGRADE') {
    world.visualTime++;
    updateFx(world.fx);
    return;
  }

  // PLAY step, in the design's exact order.
  world.playStep++;
  world.visualTime++;
  if (world.emberFlash > 0) world.emberFlash--;
  if (world.comboPulse > 0) world.comboPulse--;

  // 1-2. Wave clocks and spawning.
  advanceSpawning(world);

  // 3-4. Player movement and firing (bolts spawn inside updatePlayer).
  updatePlayer(world, input);

  // 5. Enemy movement, facing and boss attacks.
  updateEnemies(world);

  // 6. Move bolts and hostile orbs.
  for (const b of world.bolts) {
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * STEP_SECONDS;
    b.y += b.vy * STEP_SECONDS;
    b.life--;
    if (b.x < -20 || b.x > 1280 + 20 || b.y < -20 || b.y > 720 + 20) b.dead = true;
  }
  for (const o of world.orbs) {
    o.x += o.vx * STEP_SECONDS;
    o.y += o.vy * STEP_SECONDS;
    o.life--;
    if (o.x < -20 || o.x > 1280 + 20 || o.y < -20 || o.y > 720 + 20) o.dead = true;
  }

  // 7. Player-bolt collisions (swept, sorted along the bolt path).
  resolveBoltHits(world);

  // 8. Ward damage first, then surviving enemy contacts with Ember/player.
  applyWard(world);
  resolveContacts(world);

  // 9. Hostile-orb contacts.
  resolveOrbs(world);

  // 10. Motes, combo expiry and feedback.
  updateMotes(world);
  if (world.streak > 0 && world.playStep > world.comboDeadline) {
    world.combo = 1;
    world.streak = 0;
  }
  updateFx(world.fx);

  // 11. Remove dead objects.
  cleanup(world);

  // 12. Defeat takes precedence over wave completion.
  if (world.hearts <= 0 || world.emberHp <= 0) {
    gameOver(world);
    return;
  }

  // Wave completion: after the last enemy and all scheduled spawns are gone,
  // allow 90 steps of collection grace (orbs removed, attacks stopped), then
  // auto-collect remaining motes, award the bonus and open UPGRADE.
  const spawnsDone = world.spawnIndex >= world.spawnList.length
    && (world.wave % WAVE.heraldEvery !== 0 || world.heraldSpawned);
  if (!world.graceActive && spawnsDone && world.enemies.length === 0) {
    world.graceActive = true;
    world.grace = WAVE.graceSteps;
    world.orbs = [];
  }
  if (world.graceActive) {
    world.grace--;
    if (world.grace <= 0) {
      for (const m of world.motes) {
        if (!m.dead) { world.score += MOTE.score; m.dead = true; }
      }
      world.motes = [];
      const bonus = WAVE.clearBonus(world.wave);
      world.score += bonus;
      addText(world.fx, EMBER.x, EMBER.y - 70, `WAVE ${world.wave} CLEAR  +${bonus}`, '#FFD782', true);
      saveBest(world);
      rollOffers(world);
      world.screen = 'UPGRADE';
      world.graceActive = false;
    }
  }
}

// ---------------------------------------------------------------- diagnostics

// Read-only snapshot for the debug object and the deterministic replay checks.
// No setters: nothing here creates enemies, changes score or forces screens.
export function snapshot(world) {
  return {
    seed: world.seed,
    screen: world.screen,
    step: world.playStep,
    wave: world.wave,
    score: world.score,
    combo: world.combo,
    hearts: world.hearts,
    emberHp: world.emberHp,
    best: world.best,
    kills: world.kills,
    player: {
      x: Math.round(world.player.x * 100) / 100,
      y: Math.round(world.player.y * 100) / 100,
    },
    enemies: world.enemies.map((e) => ({
      id: e.id, kind: e.kind,
      x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, hp: e.hp,
    })),
    bolts: world.bolts.length,
    orbs: world.orbs.length,
    motes: world.motes.length,
  };
}
