// Keyboard and pointer input for Wispwarden.
// The simulation reads only this object: held movement keys, the pointer aim in
// logical canvas coordinates, whether fire is held, and a queue of one-shot
// actions (start, confirm, pause, mute, select, restart). Focus loss clears
// held state so a run never keeps moving or firing while the tab is hidden.

import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from './config.js';

// One-shot action names. The world consumes them once per fixed step.
export const ACTIONS = {
  START: 'start',
  CONFIRM: 'confirm',
  PAUSE: 'pause',
  MUTE: 'mute',
  RESTART: 'restart',
  SELECT_1: 'select1',
  SELECT_2: 'select2',
  SELECT_3: 'select3',
};

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput() {
  return {
    keys: new Set(), // currently held physical key codes
    pointerX: LOGICAL_WIDTH / 2, // logical aim point; straight up until first entry
    pointerY: 0,
    pointerInside: false,
    pointerDown: false, // primary pointer held: fires the weapon
    actions: [], // queued one-shot action names, consumed in order
  };
}

// Convert a client (page) coordinate into logical canvas coordinates using the
// canvas element's displayed rectangle. The canvas is letterboxed at 16:9, so
// the mapping is a uniform scale plus an offset.
export function clientToLogical(input, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;
  input.pointerX = (clientX - rect.left) * scaleX;
  input.pointerY = (clientY - rect.top) * scaleY;
  input.pointerInside = true;
}

export function keyDown(input, code) {
  if (MOVEMENT_KEYS.has(code)) {
    input.keys.add(code);
    return true; // handled: movement keys never scroll the page
  }
  if (code === 'Space') {
    input.keys.add(code);
    return true;
  }
  return false;
}

export function keyUp(input, code) {
  input.keys.delete(code);
}

export function queueAction(input, action) {
  input.actions.push(action);
}

// Drain the queued one-shot actions. The world calls this once per fixed step
// so an action is consumed exactly once even if several steps run per frame.
export function takeActions(input) {
  const taken = input.actions;
  input.actions = [];
  return taken;
}

// Normalized movement vector from the held keys: -1..1 on each axis, with
// diagonals normalized so diagonal movement is no faster than straight.
export function movementVector(input) {
  let x = 0;
  let y = 0;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) x -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) x += 1;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) y -= 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) y += 1;
  if (x !== 0 && y !== 0) {
    const inv = 1 / Math.SQRT2;
    x *= inv;
    y *= inv;
  }
  return { x, y };
}

export function fireHeld(input) {
  return input.pointerDown || input.keys.has('Space');
}

// Focus loss or a hidden tab: clear every held key and pointer state, and drop
// queued actions so nothing fires on return.
export function clearHeld(input) {
  input.keys.clear();
  input.pointerDown = false;
  input.actions = [];
}
