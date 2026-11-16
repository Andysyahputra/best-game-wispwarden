// The Wispwarden: movement, aiming, weapon patterns, firing cadence, heart
// state and upgrade application. Derived stats (bolt speed, fire interval,
// volley shape, movement speed, pierce, magnet reach) are pure functions of
// the owned upgrade ranks, so the world and the HUD always agree.

import {
  ARENA, EMBER, PLAYER, BOLT, MOTE, COMBO, VOLLEY, WARD,
  STEP_SECONDS,
} from './config.js';
import { movementVector, fireHeld } from './input.js';
import { muzzleFlash, playerHitFeedback } from './particles.js';
import { playShoot } from './audio.js';

export function boltSpeed(world) {
  return BOLT.baseSpeed * Math.pow(1.25, world.upgrades.quicklight);
}

export function fireInterval(world) {
  return BOLT.baseIntervalSeconds * Math.pow(0.9, world.upgrades.quicklight);
}

export function moveSpeed(world) {
  return PLAYER.baseSpeed * (1 + 0.25 * world.upgrades.boots);
}

export function pierceCapacity(world) {
  return 1 + world.upgrades.through;
}

export function magnetRadius(world) {
  if (world.upgrades.magnet >= 2) return 240;
  if (world.upgrades.magnet >= 1) return 150;
  return MOTE.baseAttractRadius;
}

export function magnetSpeed(world) {
  return world.upgrades.magnet >= 1 ? 420 : MOTE.baseAttractSpeed;
}

export function comboWindow(world) {
  return world.upgrades.keeper >= 1 ? COMBO.keeperWindowSteps : COMBO.baseWindowSteps;
}

// Symmetrical volley angles (degrees) around the aim direction.
export function volleyAngles(world) {
  const twin = world.upgrades.twin >= 1;
  const fan = world.upgrades.fan >= 1;
  if (twin && fan) return VOLLEY.twinFan;
  if (fan) return VOLLEY.fan;
  if (twin) return VOLLEY.twin;
  return VOLLEY.base;
}

export function createPlayerState() {
  return {
    x: 640, y: 530, // set from PLAYER_START by the world
    aim: -Math.PI / 2, // straight up until the pointer enters the canvas
    fireCooldown: 0, // seconds until the next volley may fire
    invuln: 0, // steps of damage invulnerability remaining
    flash: 0, // steps of red damage flash on the player
  };
}

// Move the player, clamp to the arena, slide around the solid Ember, aim at
// the pointer and fire volleys on cadence. Called once per PLAY step.
export function updatePlayer(world, input) {
  const p = world.player;
  const speed = moveSpeed(world);
  const mv = movementVector(input);
  p.x += mv.x * speed * STEP_SECONDS;
  p.y += mv.y * speed * STEP_SECONDS;

  // Clamp the center inside the arena with the player radius inset.
  p.x = Math.max(ARENA.x0 + PLAYER.radius, Math.min(ARENA.x1 - PLAYER.radius, p.x));
  p.y = Math.max(ARENA.y0 + PLAYER.radius, Math.min(ARENA.y1 - PLAYER.radius, p.y));

  // The Ember is a solid obstacle: project the player outside the combined radii.
  const dx = p.x - EMBER.x;
  const dy = p.y - EMBER.y;
  const dist = Math.hypot(dx, dy);
  const minDist = EMBER.radius + PLAYER.radius;
  if (dist < minDist && dist > 0.0001) {
    p.x = EMBER.x + (dx / dist) * minDist;
    p.y = EMBER.y + (dy / dist) * minDist;
  }

  // Aim: keep the last valid aim when the pointer sits exactly on the player.
  if (input.pointerInside) {
    const adx = input.pointerX - p.x;
    const ady = input.pointerY - p.y;
    if (Math.hypot(adx, ady) > 2) p.aim = Math.atan2(ady, adx);
  }

  if (p.fireCooldown > 0) p.fireCooldown -= STEP_SECONDS;
  if (p.invuln > 0) p.invuln--;
  if (p.flash > 0) p.flash--;

  // A held trigger cannot accumulate shots during pauses or card screens: the
  // cooldown only ticks here, inside PLAY, and firing happens below.
  if (fireHeld(input) && p.fireCooldown <= 0) {
    fireVolley(world);
    p.fireCooldown = fireInterval(world);
  }
}

function fireVolley(world) {
  const p = world.player;
  const speed = boltSpeed(world);
  const pierce = pierceCapacity(world);
  for (const deg of volleyAngles(world)) {
    const a = p.aim + (deg * Math.PI) / 180;
    world.bolts.push({
      id: world.nextId++,
      x: p.x + Math.cos(a) * BOLT.spawnOffset,
      y: p.y + Math.sin(a) * BOLT.spawnOffset,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      radius: BOLT.radius,
      damage: BOLT.damage,
      life: BOLT.lifeSteps,
      pierceLeft: pierce,
      hitIds: new Set(), // enemies this bolt has already damaged
      px: p.x + Math.cos(a) * BOLT.spawnOffset, // previous position, for swept tests
      py: p.y + Math.sin(a) * BOLT.spawnOffset,
    });
  }
  world.stats.shotsFired++;
  muzzleFlash(world.fx);
  playShoot(world.audio);
}

// One heart of damage from an attacker at (sx, sy): invulnerability, a 22px
// push away from the attacker, flash and shake. No stacking during invuln.
export function damagePlayer(world, sx, sy) {
  const p = world.player;
  if (p.invuln > 0 || world.hearts <= 0) return false;
  world.hearts--;
  p.invuln = Math.round(PLAYER.invulnSeconds * 60);
  p.flash = 12;
  const dx = p.x - sx;
  const dy = p.y - sy;
  const dist = Math.hypot(dx, dy) || 1;
  p.x += (dx / dist) * PLAYER.knockback;
  p.y += (dy / dist) * PLAYER.knockback;
  p.x = Math.max(ARENA.x0 + PLAYER.radius, Math.min(ARENA.x1 - PLAYER.radius, p.x));
  p.y = Math.max(ARENA.y0 + PLAYER.radius, Math.min(ARENA.y1 - PLAYER.radius, p.y));
  playerHitFeedback(world.fx);
  return true;
}

// Apply one confirmed upgrade. Ranks are stored on the world; derived stats
// read them, so application is a small rank bump plus the immediate effects
// (heals and Ember mends) that cannot be expressed as a stat.
export function applyUpgrade(world, id) {
  const u = world.upgrades;
  switch (id) {
    case 'quicklight': u.quicklight++; break;
    case 'twin': u.twin = 1; break;
    case 'through': u.through++; break;
    case 'fan': u.fan = 1; break;
    case 'wick':
      u.wick++;
      world.heartCap = Math.min(PLAYER.maxHeartCap, world.heartCap + 1);
      world.hearts = Math.min(world.heartCap, world.hearts + 1);
      break;
    case 'mend':
      u.mend++;
      world.emberHp = Math.min(EMBER.maxHp, world.emberHp + 30);
      break;
    case 'magnet': u.magnet++; break;
    case 'boots': u.boots++; break;
    case 'ward': u.ward++; break;
    case 'keeper': u.keeper = 1; break;
    case 'glow':
      u.glow = (u.glow || 0) + 1;
      if (world.hearts < world.heartCap) {
        world.hearts++;
      } else if (world.emberHp < EMBER.maxHp) {
        world.emberHp = Math.min(EMBER.maxHp, world.emberHp + 15);
      } else {
        world.score += 300;
      }
      break;
    default:
      break;
  }
  world.stats.upgradesTaken++;
}
