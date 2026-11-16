// Bootstrap for Wispwarden: query parsing, runtime construction, the
// fixed-step loop, input dispatch, canvas resizing and screenshot-mode
// integration. The simulation itself lives in world.js; this file only feeds
// it input and draws the latest completed state, without interpolation.

import { LOGICAL_WIDTH, LOGICAL_HEIGHT, MAX_FRAME_MS, MAX_STEPS_PER_FRAME, SHOT_SEED } from './config.js';
import { parseSeed } from './random.js';
import { createInput, keyDown, keyUp, queueAction, clientToLogical, clearHeld, ACTIONS } from './input.js';
import { createWorld, updateWorld, snapshot, createMemoryStore } from './world.js';
import { drawGame, buttonRects, pointInRect } from './render.js';
import { stageScreenshot, digestSnapshot } from './shots.js';
import { ensureAudio } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusLine = document.getElementById('status');

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot'); // start | play | upgrade | end, or null
const shotMode = shotName !== null;
const seed = parseSeed(params.get('seed') ?? (shotMode ? String(SHOT_SEED) : undefined));

const world = createWorld({
  seed,
  shotMode,
  store: shotMode ? createMemoryStore(0) : undefined, // isolated best score 0
});
const input = createInput();

// ---------------------------------------------------------------- canvas size

let backingScale = 1;

function resize() {
  const availW = window.innerWidth;
  const availH = window.innerHeight - (statusLine ? statusLine.offsetHeight : 0) - 8;
  const scale = Math.min(availW / LOGICAL_WIDTH, availH / LOGICAL_HEIGHT);
  const cssW = Math.max(320, Math.floor(LOGICAL_WIDTH * scale));
  const cssH = Math.max(180, Math.floor(LOGICAL_HEIGHT * scale));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  // Backing resolution capped at devicePixelRatio 2 in normal play; forced
  // to 1 for screenshots so captures are exactly 1280x720.
  backingScale = shotMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = LOGICAL_WIDTH * backingScale;
  canvas.height = LOGICAL_HEIGHT * backingScale;
}

window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- input

function firstGesture() {
  if (!shotMode) ensureAudio(world.audio);
}

window.addEventListener('keydown', (ev) => {
  firstGesture();
  if (keyDown(input, ev.code)) {
    ev.preventDefault();
    return;
  }
  if (ev.code === 'Enter') { queueAction(input, ACTIONS.CONFIRM); ev.preventDefault(); }
  else if (ev.code === 'KeyP' || ev.code === 'Escape') queueAction(input, ACTIONS.PAUSE);
  else if (ev.code === 'KeyM') queueAction(input, ACTIONS.MUTE);
  else if (ev.code === 'KeyR') queueAction(input, ACTIONS.RESTART);
  else if (ev.code === 'Digit1') queueAction(input, ACTIONS.SELECT_1);
  else if (ev.code === 'Digit2') queueAction(input, ACTIONS.SELECT_2);
  else if (ev.code === 'Digit3') queueAction(input, ACTIONS.SELECT_3);
});

window.addEventListener('keyup', (ev) => keyUp(input, ev.code));

canvas.addEventListener('pointermove', (ev) => {
  clientToLogical(input, canvas, ev.clientX, ev.clientY);
});

canvas.addEventListener('pointerdown', (ev) => {
  firstGesture();
  clientToLogical(input, canvas, ev.clientX, ev.clientY);
  if (handleButtonClick(input.pointerX, input.pointerY)) return;
  input.pointerDown = true;
});

window.addEventListener('pointerup', () => {
  input.pointerDown = false;
});

// Buttons are hit-tested against the same rectangles the renderer draws.
function handleButtonClick(x, y) {
  const rects = buttonRects(world.screen);
  if (world.screen === 'TITLE' && pointInRect(x, y, rects.start)) {
    queueAction(input, ACTIONS.CONFIRM);
    return true;
  }
  if (world.screen === 'GAME_OVER' && pointInRect(x, y, rects.restart)) {
    queueAction(input, ACTIONS.RESTART);
    return true;
  }
  if (world.screen === 'PAUSED') {
    if (world.pausedFrom === 'UPGRADE') {
      const resume = { x: 1060, y: 640, w: 160, h: 56 };
      if (pointInRect(x, y, resume)) { queueAction(input, ACTIONS.PAUSE); return true; }
    } else if (pointInRect(x, y, { ...rects.resume, y: 440 })) {
      queueAction(input, ACTIONS.PAUSE);
      return true;
    }
    return true; // clicks elsewhere on the pause panel do nothing
  }
  if (world.screen === 'UPGRADE') {
    for (let i = 0; i < rects.cards.length; i++) {
      if (pointInRect(x, y, rects.cards[i])) {
        queueAction(input, i === 0 ? ACTIONS.SELECT_1 : i === 1 ? ACTIONS.SELECT_2 : ACTIONS.SELECT_3);
        return true;
      }
    }
    if (pointInRect(x, y, rects.takeGift)) {
      queueAction(input, ACTIONS.CONFIRM);
      return true;
    }
    return true; // clicks elsewhere on the upgrade screen do nothing
  }
  return false;
}

// Focus loss or a hidden tab: clear held inputs and pause an active run, and
// clear accumulated wall-clock time before resuming (the loop drops its
// accumulator whenever the tab was hidden).
function onFocusLost() {
  clearHeld(input);
  if (world.screen === 'PLAY' || world.screen === 'UPGRADE') {
    queueAction(input, ACTIONS.PAUSE);
    // Apply the pause immediately so the run stops even before the next frame.
    updateWorld(world, input);
  }
  lastFrame = 0;
}
window.addEventListener('blur', onFocusLost);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
});

// ---------------------------------------------------------------- diagnostics

// Read-only debug snapshot, refreshed every frame. No setters are exposed:
// nothing here creates enemies, changes score or forces screens.
window.__wispDebug = snapshot(world);
function refreshDebug() {
  window.__wispDebug = snapshot(world);
}

// Deterministic replay for validation: a fresh world from the seed, driven by
// a recorded per-step input script, stepped synchronously. Returns snapshots
// taken every 600 steps and at the final step. The controller generates the
// inputs; it never bypasses health, spawning or screen transitions.
window.__wispTest = {
  replay(seedValue, script, steps) {
    const rw = createWorld({ seed: seedValue, shotMode: true, store: createMemoryStore(0) });
    const ri = createInput();
    const snaps = [];
    queueAction(ri, ACTIONS.CONFIRM); // start the run
    for (let s = 0; s < steps; s++) {
      const entry = script[s] || {};
      ri.keys.clear();
      if (entry.mx < 0) ri.keys.add('KeyA');
      if (entry.mx > 0) ri.keys.add('KeyD');
      if (entry.my < 0) ri.keys.add('KeyW');
      if (entry.my > 0) ri.keys.add('KeyS');
      if (entry.ax !== undefined && entry.ay !== undefined) {
        ri.pointerInside = true;
        ri.pointerX = entry.ax;
        ri.pointerY = entry.ay;
      }
      ri.pointerDown = !!entry.fire;
      if (entry.act) queueAction(ri, entry.act);
      updateWorld(rw, ri);
      if ((s + 1) % 600 === 0 || s === steps - 1) snaps.push(snapshot(rw));
    }
    return snaps;
  },
};

// ---------------------------------------------------------------- loop

let lastFrame = 0;
let accumulator = 0;
let stager = null;
let frozenFrames = 0;

if (shotMode) {
  stager = stageScreenshot(world, shotName);
  window.__shotReady = false;
  window.__shotDigest = null;
  window.__shotStep = null;
}

function draw() {
  ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  drawGame(ctx, world);
  refreshDebug();
}

function frame(now) {
  if (shotMode) {
    // Screenshot mode advances explicit steps without wall-clock input.
    if (stager.status === 'running') {
      // Bounded work per frame so the page stays responsive.
      for (let i = 0; i < 2000 && stager.status === 'running'; i++) stager.step();
      draw();
      if (stager.status === 'failed') {
        window.__shotError = stager.failReason;
        throw new Error(`screenshot staging failed: ${stager.failReason}`);
      }
    } else if (stager.status === 'done') {
      // Freeze the simulation, draw the same frozen state on two consecutive
      // animation frames, and only then publish readiness.
      draw();
      frozenFrames++;
      if (frozenFrames >= 2 && !window.__shotReady) {
        window.__shotReady = true;
        window.__shotDigest = stager.digest;
        window.__shotStep = stager.steps;
      }
    }
    requestAnimationFrame(frame);
    return;
  }

  if (lastFrame === 0) lastFrame = now;
  let elapsed = now - lastFrame;
  lastFrame = now;
  if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS;
  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= 1000 / 60 && steps < MAX_STEPS_PER_FRAME) {
    updateWorld(world, input);
    accumulator -= 1000 / 60;
    steps++;
  }
  if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0; // drop backlog, never spiral
  draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
