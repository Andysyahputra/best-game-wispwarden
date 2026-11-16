// Deterministic autopilot and screenshot staging for Wispwarden.
// Every scene starts from ordinary world initialization and is staged by
// feeding input to the same transition and simulation functions a human
// player uses. Nothing here assigns fabricated scores, health, populations,
// offers or screen states. A scene that cannot reach its predicate within
// the hard step limit fails with a diagnostic instead of inventing a scene.

import { EMBER, ARENA, MAX_SHOT_STEPS, SHOT_TITLE_STEPS, SHOT_PAUSE_STEPS, SHOT_END_STEPS } from './config.js';
import { createInput, queueAction } from './input.js';
import { updateWorld, startRun, snapshot } from './world.js';
import { bulwarkBlocked } from './enemies.js';

// FNV-1a digest of the debug snapshot: the validation compares staged scenes
// across two fresh contexts by this digest and the captured step.
export function digestSnapshot(world) {
  const s = JSON.stringify(snapshot(world));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Upgrade preference order for the autopilot's card choices.
const PREFERENCE = [
  'ward', 'twin', 'fan', 'quicklight', 'through',
  'magnet', 'boots', 'keeper', 'wick', 'mend', 'glow',
];

function preferredOfferIndex(world) {
  let bestIdx = -1;
  let bestRank = Infinity;
  world.offers.forEach((offer, i) => {
    const rank = PREFERENCE.indexOf(offer.id);
    if (rank >= 0 && rank < bestRank) { bestRank = rank; bestIdx = i; }
  });
  return bestIdx === -1 ? 0 : bestIdx;
}

// ---------------------------------------------------------------- autopilot

// The autopilot writes into a synthetic input object: movement keys for the
// desired direction, pointer position for the aim, pointer hold for fire, and
// queued one-shot actions. It never touches world state directly.
function autopilotInput(world, input, opts = {}) {
  const p = world.player;
  const burstFire = !!opts.burstFire;
  // Reset the synthetic input for this step.
  input.keys.clear();
  input.pointerDown = false;
  input.pointerInside = true;

  // Nearest danger for repulsion (inside 100 px).
  let danger = null;
  let dangerDist = Infinity;
  for (const e of world.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < dangerDist) { dangerDist = d; danger = e; }
  }

  // Desired movement: flee nearby danger, collect a nearby mote when safe,
  // otherwise circle the Ember at a preferred radius of 150 px.
  let tx = EMBER.x + Math.cos(world.playStep * 0.004) * 150;
  let ty = EMBER.y + Math.sin(world.playStep * 0.004) * 150;
  if (danger && dangerDist < 100) {
    const dx = p.x - danger.x;
    const dy = p.y - danger.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = p.x + (dx / d) * 160;
    ty = p.y + (dy / d) * 160;
  } else {
    let nearestMote = null;
    let moteDist = Infinity;
    for (const m of world.motes) {
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < moteDist) { moteDist = d; nearestMote = m; }
    }
    if (nearestMote && moteDist < 320) {
      tx = nearestMote.x;
      ty = nearestMote.y;
    }
  }
  // If the only target is a frontal Bulwark, circle around its side instead
  // of standing in front of the shield.
  let target = nearestTarget(world);
  if (target && target.kind === 'bulwark' && onlyBulwarkTarget(world)) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = p.x + (-dy / d) * 120;
    ty = p.y + (dx / d) * 120;
  }

  // Clamp the desired point inside the arena and convert to movement keys.
  tx = Math.max(ARENA.x0 + 16, Math.min(ARENA.x1 - 16, tx));
  ty = Math.max(ARENA.y0 + 16, Math.min(ARENA.y1 - 16, ty));
  const mx = tx - p.x;
  const my = ty - p.y;
  if (mx > 24) input.keys.add('KeyD');
  else if (mx < -24) input.keys.add('KeyA');
  if (my > 24) input.keys.add('KeyS');
  else if (my < -24) input.keys.add('KeyW');

  // Aim at the nearest unshielded target; hold fire unless the only target
  // is a frontal Bulwark (then keep moving around its side).
  if (target) {
    const blocked = target.kind === 'bulwark' && bulwarkBlocked(target, p.x, p.y);
    input.pointerX = target.x;
    input.pointerY = target.y;
    if (!blocked) {
      if (burstFire) input.pointerDown = (world.playStep % 40) < 25;
      else input.pointerDown = true;
    }
  } else {
    input.pointerX = p.x;
    input.pointerY = p.y - 100;
  }
}

// Nearest living enemy, preferring unshielded ones: a frontal Bulwark is only
// returned when no other target exists.
function nearestTarget(world) {
  const p = world.player;
  let best = null;
  let bestD = Infinity;
  let fallback = null;
  let fallbackD = Infinity;
  for (const e of world.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const frontal = e.kind === 'bulwark' && bulwarkBlocked(e, p.x, p.y);
    if (frontal) {
      if (d < fallbackD) { fallbackD = d; fallback = e; }
    } else if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best || fallback;
}

function onlyBulwarkTarget(world) {
  const t = nearestTarget(world);
  return !!t && t.kind === 'bulwark';
}

// ---------------------------------------------------------------- staging

// Stage one screenshot scene. Returns a stager: call step() until it reports
// done or failed. The stager counts its own steps against the hard limit.
export function stageScreenshot(world, scene) {
  const input = createInput();
  const stager = {
    scene,
    steps: 0,
    status: 'running', // running | done | failed
    failReason: null,
    digest: null,
    phase: 'init',
    phaseSteps: 0,
    upgradeStep: -1, // per-upgrade-screen step counter, reset between screens
    started: false,
  };

  function fail(reason) {
    stager.status = 'failed';
    stager.failReason = reason;
    return stager;
  }

  function done() {
    stager.status = 'done';
    stager.digest = digestSnapshot(world);
    return stager;
  }

  // One autopilot step: drive the synthetic input, then advance the world.
  function playStep(opts) {
    autopilotInput(world, input, opts);
    updateWorld(world, input);
  }

  // Handle an open UPGRADE screen during clearing phases: select the
  // preferred offer on one step, confirm it on the next. The counter resets
  // between screens so every upgrade screen gets its own select+confirm pair.
  function handleUpgradeDuringClear() {
    if (world.screen !== 'UPGRADE') {
      stager.upgradeStep = -1;
      return false;
    }
    if (stager.upgradeStep <= 0) {
      const idx = preferredOfferIndex(world);
      queueAction(input, `select${idx + 1}`);
      stager.upgradeStep = 1;
    } else {
      queueAction(input, 'confirm');
      stager.upgradeStep = -1;
    }
    updateWorld(world, input);
    return true;
  }

  stager.step = function step() {
    if (stager.status !== 'running') return stager;
    stager.steps++;
    if (stager.steps > MAX_SHOT_STEPS) {
      return fail(`step limit ${MAX_SHOT_STEPS} reached in scene ${scene} (screen ${world.screen}, wave ${world.wave})`);
    }

    if (scene === 'start') {
      // TITLE with isolated best score zero; advance visual time exactly 120 steps.
      updateWorld(world, input);
      if (stager.steps >= SHOT_TITLE_STEPS) return done();
      return stager;
    }

    if (scene === 'play') {
      if (!stager.started) {
        queueAction(input, 'confirm');
        updateWorld(world, input);
        stager.started = true;
        return stager;
      }
      if (world.screen === 'GAME_OVER') {
        return fail(`autopilot died during play scene (wave ${world.wave}, score ${world.score})`);
      }
      if (world.screen === 'UPGRADE') {
        if (handleUpgradeDuringClear()) return stager;
      }
      if (world.screen === 'PLAY' && world.wave >= 4) {
        // Framing: short fire bursts once the wave-4 conditions exist.
        playStep({ burstFire: true });
        const hasBulwark = world.enemies.some((e) => e.kind === 'bulwark');
        const hasSplitter = world.enemies.some((e) => e.kind === 'splitter');
        const hasOther = world.enemies.some((e) => e.kind === 'driftwisp' || e.kind === 'dartshade' || e.kind === 'splitterChild');
        const upgradesTaken = Object.values(world.upgrades).reduce((a, b) => a + b, 0);
        if (
          world.screen === 'PLAY' && world.wave === 4
          && hasBulwark && hasSplitter && hasOther
          && world.motes.length >= 1 && world.bolts.length >= 1
          && world.hearts >= 1 && world.emberHp > 0
          && upgradesTaken >= 2 && world.fx.flash === 0
        ) return done();
        return stager;
      }
      playStep({});
      return stager;
    }

    if (scene === 'upgrade') {
      if (!stager.started) {
        queueAction(input, 'confirm');
        updateWorld(world, input);
        stager.started = true;
        stager.phase = 'clearing';
        return stager;
      }
      if (stager.phase === 'clearing') {
        if (world.screen === 'GAME_OVER') {
          return fail(`autopilot died during upgrade scene (wave ${world.wave}, score ${world.score})`);
        }
        if (world.screen === 'UPGRADE' && world.wave === 3) {
          // Real upgrade screen after wave three: select card two, do not confirm.
          stager.phase = 'selecting';
          stager.phaseSteps = 0;
          return stager;
        }
        if (world.screen === 'UPGRADE') {
          if (handleUpgradeDuringClear()) return stager;
        }
        playStep({});
        return stager;
      }
      if (stager.phase === 'selecting') {
        if (stager.phaseSteps === 0) {
          queueAction(input, 'select2');
          stager.phaseSteps++;
          updateWorld(world, input);
          return stager;
        }
        // Next step: pause over the open upgrade screen.
        queueAction(input, 'pause');
        updateWorld(world, input);
        stager.phase = 'paused';
        stager.phaseSteps = 0;
        return stager;
      }
      if (stager.phase === 'paused') {
        // Freeze after 30 presentation steps of the PAUSED overlay, without
        // advancing the underlying world (PAUSED steps are no-ops).
        updateWorld(world, input);
        stager.phaseSteps++;
        if (stager.phaseSteps >= SHOT_PAUSE_STEPS) return done();
        return stager;
      }
      return stager;
    }

    if (scene === 'end') {
      if (!stager.started) {
        queueAction(input, 'confirm');
        updateWorld(world, input);
        stager.started = true;
        stager.phase = 'clearing';
        return stager;
      }
      if (stager.phase === 'clearing') {
        if (world.screen === 'GAME_OVER') {
          return fail(`autopilot died too early in end scene (wave ${world.wave})`);
        }
        if (world.screen === 'UPGRADE') {
          if (handleUpgradeDuringClear()) return stager;
        }
        if (world.screen === 'PLAY' && world.wave >= 4) {
          // Entered the next wave: release movement and fire, let the
          // ordinary simulation run until the player or the Ember dies.
          stager.phase = 'idle';
          return stager;
        }
        playStep({});
        return stager;
      }
      if (stager.phase === 'idle') {
        input.keys.clear();
        input.pointerDown = false;
        updateWorld(world, input);
        if (world.screen === 'GAME_OVER') {
          stager.phase = 'settling';
          stager.phaseSteps = 0;
        }
        return stager;
      }
      if (stager.phase === 'settling') {
        updateWorld(world, input);
        stager.phaseSteps++;
        if (stager.phaseSteps >= SHOT_END_STEPS) return done();
        return stager;
      }
      return stager;
    }

    return fail(`unknown scene ${scene}`);
  };

  return stager;
}
