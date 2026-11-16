// Every canvas drawing operation for Wispwarden. The renderer never changes
// simulation state: it reads the world, the fixed-step counter and the
// presentation clock, and draws. The HUD and overlays stay stationary while
// the world layer shakes under a player hit.

import {
  LOGICAL_WIDTH, LOGICAL_HEIGHT, ARENA, EMBER, COLORS, ENEMY, UPGRADES,
} from './config.js';
import { shakeOffset } from './particles.js';

// Deterministic 0..1 hash of an integer, for star and ripple placement.
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, str, x, y, size, color, align = 'left', weight = 700) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// ---------------------------------------------------------------- layout

export const CARD = { w: 300, h: 260, gap: 24, y: 196 };

export function cardRects() {
  const total = CARD.w * 3 + CARD.gap * 2;
  const x0 = (LOGICAL_WIDTH - total) / 2;
  return [0, 1, 2].map((i) => ({
    x: x0 + i * (CARD.w + CARD.gap), y: CARD.y, w: CARD.w, h: CARD.h,
  }));
}

// Button rectangles, shared by the renderer and the click dispatcher so a
// button is always where it looks. All coordinates are logical 1280x720.
export function buttonRects(screen) {
  const cx = LOGICAL_WIDTH / 2;
  const rects = {
    start: { x: cx - 160, y: 512, w: 320, h: 72 },
    restart: { x: cx - 160, y: 556, w: 320, h: 72 },
    resume: { x: cx - 140, y: 430, w: 280, h: 64 },
    takeGift: { x: cx - 130, y: 500, w: 260, h: 56 },
    cards: cardRects(),
  };
  return rects;
}

export function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function drawButton(ctx, rect, label, enabled = true, accent = false) {
  ctx.save();
  ctx.globalAlpha = enabled ? 1 : 0.45;
  ctx.fillStyle = accent ? '#8A6D2B' : '#24365E';
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
  ctx.fill();
  ctx.strokeStyle = accent ? COLORS.gold : COLORS.teal;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1, 24, enabled ? COLORS.text : COLORS.textDim, 'center');
  ctx.restore();
}

// ---------------------------------------------------------------- background

function drawBackground(ctx, world) {
  const t = world.visualTime;
  // Dark lagoon gradient, brightest near the Ember.
  const g = ctx.createRadialGradient(EMBER.x, EMBER.y, 60, EMBER.x, EMBER.y, 900);
  g.addColorStop(0, '#1B2C52');
  g.addColorStop(0.45, COLORS.lagoon);
  g.addColorStop(1, COLORS.outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Sparse stars and reflections.
  for (let i = 0; i < 90; i++) {
    const x = hash01(i) * LOGICAL_WIDTH;
    const y = hash01(i + 1000) * (LOGICAL_HEIGHT - 200) + 20;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.02 + i));
    ctx.globalAlpha = 0.25 + 0.45 * tw;
    ctx.fillStyle = '#DCE8FF';
    ctx.beginPath();
    ctx.arc(x, y, 1 + hash01(i + 500) * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Broad fog ribbons drifting with presentation time.
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const fx = ((t * (6 + i * 3) + i * 420) % 1500) - 120;
    const fy = 220 + i * 150;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#9FC8E8';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 320, 42, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Elliptical water ripples around the Ember.
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const phase = ((t * 0.35 + i * 30) % 120) / 120;
    ctx.globalAlpha = 0.14 * (1 - phase);
    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(EMBER.x, EMBER.y + 30, 90 + phase * 260, 34 + phase * 90, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Arena-edge shading: a soft inner border for the playable floor.
  ctx.save();
  ctx.strokeStyle = 'rgba(100, 231, 210, 0.18)';
  ctx.lineWidth = 2;
  roundRect(ctx, ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0, 18);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- entities

function drawEmber(ctx, world) {
  const t = world.visualTime;
  const flick = Math.sin(t * 0.11) * 3 + Math.sin(t * 0.043 + 1.3) * 2;
  // Three soft halos, brightest near the flame.
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.05 * i;
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(EMBER.x, EMBER.y - 18, 46 + i * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Pedestal.
  ctx.fillStyle = '#2A3550';
  ctx.beginPath();
  ctx.moveTo(EMBER.x - 22, EMBER.y + 26);
  ctx.lineTo(EMBER.x + 22, EMBER.y + 26);
  ctx.lineTo(EMBER.x + 14, EMBER.y - 6);
  ctx.lineTo(EMBER.x - 14, EMBER.y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Gold flame.
  ctx.fillStyle = COLORS.emberFlame;
  ctx.beginPath();
  ctx.moveTo(EMBER.x, EMBER.y - 52 + flick);
  ctx.bezierCurveTo(EMBER.x + 14, EMBER.y - 30, EMBER.x + 10, EMBER.y - 12, EMBER.x, EMBER.y - 8);
  ctx.bezierCurveTo(EMBER.x - 10, EMBER.y - 12, EMBER.x - 14, EMBER.y - 30, EMBER.x, EMBER.y - 52 + flick);
  ctx.fill();
  ctx.fillStyle = COLORS.emberCore;
  ctx.beginPath();
  ctx.arc(EMBER.x, EMBER.y - 20, 6, 0, Math.PI * 2);
  ctx.fill();
  // Ember damage flash.
  if (world.emberFlash > 0) {
    ctx.globalAlpha = Math.min(0.6, world.emberFlash / 10);
    ctx.strokeStyle = COLORS.hurt;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(EMBER.x, EMBER.y - 14, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawPlayer(ctx, world) {
  const p = world.player;
  // Invulnerability blink: skip the body every other 4 steps.
  if (p.invuln > 0 && Math.floor(world.playStep / 4) % 2 === 0) return;
  const t = world.visualTime;
  const bob = Math.sin(t * 0.08) * 2;
  // Trailing teal ribbon.
  ctx.strokeStyle = COLORS.teal;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x - Math.cos(p.aim) * 12, p.y - Math.sin(p.aim) * 12 + bob);
  ctx.quadraticCurveTo(
    p.x - Math.cos(p.aim) * 30, p.y - Math.sin(p.aim) * 30 + Math.sin(t * 0.15) * 6 + bob,
    p.x - Math.cos(p.aim) * 44, p.y - Math.sin(p.aim) * 44 + Math.sin(t * 0.15 + 1) * 8 + bob,
  );
  ctx.stroke();
  // Rounded lantern body.
  ctx.fillStyle = '#F4E3B2';
  roundRect(ctx, p.x - 13, p.y - 15 + bob, 26, 30, 10);
  ctx.fill();
  ctx.strokeStyle = '#8A6D2B';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Handle.
  ctx.strokeStyle = '#8A6D2B';
  ctx.beginPath();
  ctx.arc(p.x, p.y - 15 + bob, 8, Math.PI, 0);
  ctx.stroke();
  // Gold core.
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.arc(p.x, p.y + bob, 6.5, 0, Math.PI * 2);
  ctx.fill();
  // Two dark eyes, looking along the aim.
  const ex = Math.cos(p.aim) * 3;
  const ey = Math.sin(p.aim) * 3;
  ctx.fillStyle = '#2A2438';
  ctx.beginPath();
  ctx.arc(p.x - 5 + ex, p.y - 4 + ey + bob, 2.2, 0, Math.PI * 2);
  ctx.arc(p.x + 5 + ex, p.y - 4 + ey + bob, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // Damage flash ring.
  if (p.flash > 0) {
    ctx.globalAlpha = Math.min(0.8, p.flash / 12);
    ctx.strokeStyle = COLORS.hurt;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Muzzle glow for four steps after a volley.
  if (world.fx.muzzle > 0) {
    const mx = p.x + Math.cos(p.aim) * 22;
    const my = p.y + Math.sin(p.aim) * 22 + bob;
    ctx.globalAlpha = 0.5 * (world.fx.muzzle / 4);
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawEyes(ctx, x, y, dx, dy, spread, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - spread + dx, y + dy, r, 0, Math.PI * 2);
  ctx.arc(x + spread + dx, y + dy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(ctx, world, e) {
  const t = world.visualTime;
  ctx.save();
  // Soft shadow under every entity.
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + e.radius * 0.85, e.radius * 0.8, e.radius * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (e.kind === 'driftwisp' || e.kind === 'splitterChild') {
    // Droplet silhouette with a short smoky tail.
    ctx.fillStyle = 'rgba(102, 82, 141, 0.5)';
    ctx.beginPath();
    ctx.arc(e.x - e.moveX * 16, e.y - e.moveY * 16, e.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.shade;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.radius);
    ctx.bezierCurveTo(e.x + e.radius, e.y - e.radius * 0.4, e.x + e.radius * 0.8, e.y + e.radius * 0.7, e.x, e.y + e.radius);
    ctx.bezierCurveTo(e.x - e.radius * 0.8, e.y + e.radius * 0.7, e.x - e.radius, e.y - e.radius * 0.4, e.x, e.y - e.radius);
    ctx.fill();
    drawEyes(ctx, e.x, e.y - 2, e.moveX * 3, e.moveY * 3, 5, 2.4, COLORS.eye);
  } else if (e.kind === 'dartshade') {
    // Sharp dart; compressed and bright-eyed during the pre-dash telegraph.
    const squash = e.telegraph ? 0.72 : 1;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.facing);
    ctx.scale(1, squash);
    ctx.fillStyle = '#7A5EA8';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = e.telegraph ? '#FFFFFF' : COLORS.eye;
    ctx.beginPath();
    ctx.arc(6, -3.5, e.telegraph ? 3 : 2.2, 0, Math.PI * 2);
    ctx.arc(6, 3.5, e.telegraph ? 3 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'bulwark') {
    // Heavy disc with a prominent curved shield plate on its facing side.
    ctx.fillStyle = '#4E3E6E';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3A2E55';
    ctx.lineWidth = 3;
    ctx.stroke();
    const halfArc = (ENEMY.bulwark.shieldArcDegrees / 2) * (Math.PI / 180);
    ctx.strokeStyle = '#C9A7FF';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius + 4, e.facing - halfArc, e.facing + halfArc);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 215, 130, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius + 8, e.facing - halfArc, e.facing + halfArc);
    ctx.stroke();
    drawEyes(ctx, e.x, e.y, Math.cos(e.facing) * 4, Math.sin(e.facing) * 4, 8, 3, COLORS.eye);
  } else if (e.kind === 'splitter') {
    // Two-lobed blob, wobbling with its lateral oscillation.
    const wob = Math.sin(t * 0.09 + e.phase) * 3;
    ctx.fillStyle = '#5D4A86';
    ctx.beginPath();
    ctx.arc(e.x - 9, e.y + wob, e.radius * 0.62, 0, Math.PI * 2);
    ctx.arc(e.x + 9, e.y - wob, e.radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    drawEyes(ctx, e.x, e.y - 3, e.moveX * 3, e.moveY * 3, 7, 2.8, COLORS.eye);
  } else if (e.kind === 'herald') {
    // Crown-like boss: dark disc, gold crown points, purple glow.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#8A5CFF';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius + 10 + Math.sin(t * 0.06) * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3D2C5E';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    // Crown points.
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.42;
      const px = e.x + Math.cos(a) * (e.radius + 12);
      const py = e.y + Math.sin(a) * (e.radius + 12);
      const bx = e.x + Math.cos(a + 0.2) * e.radius;
      const by = e.y + Math.sin(a + 0.2) * e.radius;
      ctx.moveTo(e.x + Math.cos(a - 0.2) * e.radius, e.y + Math.sin(a - 0.2) * e.radius);
      ctx.lineTo(px, py);
      ctx.lineTo(bx, by);
    }
    ctx.fill();
    drawEyes(ctx, e.x, e.y + 2, 0, 0, 12, 4, COLORS.eye);
    // Burst telegraph: a growing purple ring.
    if (e.telegraph) {
      const prog = 1 - e.burstTimer / ENEMY.herald.telegraphSeconds;
      ctx.globalAlpha = 0.35 + 0.45 * prog;
      ctx.strokeStyle = COLORS.eye;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 8 + prog * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // Damage flash.
  if (e.flash > 0) {
    ctx.globalAlpha = Math.min(0.85, e.flash / 5);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Bulwark and Herald HP pips.
  if ((e.kind === 'bulwark' || e.kind === 'herald') && e.hp < e.maxHp) {
    const w = e.radius * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 5);
    ctx.fillStyle = COLORS.hurt;
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 5);
  }
  ctx.restore();
}

function drawBolts(ctx, world) {
  for (const b of world.bolts) {
    ctx.strokeStyle = 'rgba(100, 231, 210, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#FFE9A8';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.teal;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOrbs(ctx, world) {
  for (const o of world.orbs) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#8A5CFF';
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.eye;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMotes(ctx, world) {
  const t = world.visualTime;
  for (const m of world.motes) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 0.12 + m.id);
    ctx.globalAlpha = 0.55 + 0.45 * pulse;
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawParticles(ctx, world) {
  for (const p of world.fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const ft of world.fx.texts) {
    const a = Math.max(0, ft.life / ft.maxLife);
    ctx.globalAlpha = a;
    text(ctx, ft.str, ft.x, ft.y, ft.big ? 30 : 20, ft.color, 'center');
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- HUD

function drawHeart(ctx, x, y, filled, pulse) {
  const s = filled ? 1 + (pulse ? 0.18 : 0) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = filled ? COLORS.hurt : 'rgba(255, 120, 142, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.bezierCurveTo(-11, -2, -8, -11, 0, -5);
  ctx.bezierCurveTo(8, -11, 11, -2, 0, 8);
  ctx.fill();
  ctx.restore();
}

function drawUpgradeIcon(ctx, icon, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const s = size / 2;
  if (icon === 'bolt' || icon === 'pierce') {
    ctx.beginPath();
    ctx.moveTo(2, -s); ctx.lineTo(-4, 2); ctx.lineTo(0, 2); ctx.lineTo(-2, s); ctx.lineTo(5, -2); ctx.lineTo(1, -2);
    ctx.closePath(); ctx.fill();
  } else if (icon === 'twin') {
    ctx.beginPath(); ctx.arc(-s * 0.45, 0, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.45, 0, s * 0.4, 0, Math.PI * 2); ctx.fill();
  } else if (icon === 'fan') {
    for (const a of [-0.5, 0, 0.5]) {
      ctx.beginPath(); ctx.moveTo(0, s * 0.6); ctx.lineTo(Math.sin(a) * s, -Math.cos(a) * s); ctx.stroke();
    }
  } else if (icon === 'heart') {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.7);
    ctx.bezierCurveTo(-s, -s * 0.1, -s * 0.7, -s, 0, -s * 0.4);
    ctx.bezierCurveTo(s * 0.7, -s, s, -s * 0.1, 0, s * 0.7);
    ctx.fill();
  } else if (icon === 'flame') {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.8, -s * 0.2, s * 0.6, s * 0.6, 0, s * 0.7);
    ctx.bezierCurveTo(-s * 0.6, s * 0.6, -s * 0.8, -s * 0.2, 0, -s);
    ctx.fill();
  } else if (icon === 'magnet') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.8, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.8, 0); ctx.lineTo(-s * 0.8, s * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.8, 0); ctx.lineTo(s * 0.8, s * 0.5); ctx.stroke();
  } else if (icon === 'boots') {
    ctx.beginPath(); ctx.moveTo(-s * 0.5, -s); ctx.lineTo(s * 0.3, -s); ctx.lineTo(s * 0.3, s * 0.4); ctx.lineTo(s * 0.7, s * 0.6); ctx.lineTo(-s * 0.5, s * 0.6); ctx.closePath(); ctx.fill();
  } else if (icon === 'ward') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.5); ctx.stroke();
  } else if (icon === 'combo') {
    text(ctx, 'x3', 0, 1, size * 0.8, color, 'center');
  } else {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawHUD(ctx, world) {
  // Dark translucent panel with a gold divider.
  ctx.fillStyle = 'rgba(7, 11, 28, 0.72)';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, 96);
  ctx.fillStyle = 'rgba(255, 215, 130, 0.6)';
  ctx.fillRect(0, 96, LOGICAL_WIDTH, 2);

  // Row 1: SCORE / BEST / WAVE left, hearts center, Ember bar right.
  text(ctx, 'SCORE', 32, 22, 13, COLORS.textDim, 'left', 600);
  text(ctx, String(world.score), 32, 48, 28, COLORS.text);
  text(ctx, 'BEST', 190, 22, 13, COLORS.textDim, 'left', 600);
  text(ctx, String(Math.max(world.best, world.score)), 190, 48, 28, COLORS.text);
  text(ctx, 'WAVE', 320, 22, 13, COLORS.textDim, 'left', 600);
  text(ctx, String(Math.max(1, world.wave)), 320, 48, 28, COLORS.text);

  const heartPulse = world.player.flash > 0;
  for (let i = 0; i < world.heartCap; i++) {
    drawHeart(ctx, 590 + i * 30, 40, i < world.hearts, heartPulse);
  }

  text(ctx, 'LAST EMBER', 1060, 22, 13, COLORS.textDim, 'left', 600);
  const barX = 1060;
  const barW = 150;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, barX, 34, barW, 16, 8);
  ctx.fill();
  ctx.fillStyle = world.emberHp > 30 ? COLORS.gold : COLORS.hurt;
  roundRect(ctx, barX, 34, barW * Math.max(0, world.emberHp / 100), 16, 8);
  ctx.fill();
  text(ctx, String(world.emberHp), barX + barW + 10, 42, 22, COLORS.text);

  // Row 2: combo, acquired upgrades, hints.
  const comboActive = world.streak > 0 && world.playStep <= world.comboDeadline;
  const windowLeft = comboActive ? Math.max(0, world.comboDeadline - world.playStep) : 0;
  const windowMax = world.upgrades.keeper >= 1 ? 300 : 150;
  const pulse = world.comboPulse > 0 ? 1.15 : 1;
  ctx.save();
  ctx.translate(32, 76);
  ctx.scale(pulse, pulse);
  text(ctx, `COMBO x${world.combo}`, 0, 0, 20, comboActive ? COLORS.gold : COLORS.textDim);
  ctx.restore();
  if (comboActive) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(150, 70, 120, 8);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(150, 70, 120 * (windowLeft / windowMax), 8);
  }

  // Acquired upgrade icons, at most eight, then a +N indicator.
  const owned = UPGRADES.filter((d) => (world.upgrades[d.id] || 0) > 0);
  let ix = 320;
  owned.slice(0, 8).forEach((def) => {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, ix - 11, 65, 22, 22, 5);
    ctx.fill();
    drawUpgradeIcon(ctx, def.icon, ix, 76, 15, COLORS.teal);
    const rank = world.upgrades[def.id];
    if (rank > 1) text(ctx, String(rank), ix + 9, 84, 12, COLORS.gold, 'left');
    ix += 28;
  });
  if (owned.length > 8) text(ctx, `+${owned.length - 8}`, ix, 76, 16, COLORS.textDim, 'left');

  text(ctx, 'P PAUSE · M SOUND', 1248, 76, 15, COLORS.textDim, 'right', 600);

  // Boss HP bar for a living Herald.
  const herald = world.enemies.find((e) => e.kind === 'herald');
  if (herald) {
    const bw = 320;
    const bx = (LOGICAL_WIDTH - bw) / 2;
    text(ctx, 'GLOOM HERALD', LOGICAL_WIDTH / 2, 116, 14, COLORS.eye, 'center', 600);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, bx, 124, bw, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#8A5CFF';
    roundRect(ctx, bx, 124, bw * (herald.hp / herald.maxHp), 10, 5);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- overlays

function wash(ctx, alpha, color = '#070B1C') {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  ctx.globalAlpha = 1;
}

function drawTitle(ctx, world) {
  wash(ctx, 0.45);
  const t = world.visualTime;
  const bob = Math.sin(t * 0.05) * 6;
  // Decorative Wispwarden floating beside the title (presentation only).
  const dx = 250;
  const dy = 210 + bob;
  ctx.fillStyle = '#F4E3B2';
  roundRect(ctx, dx - 22, dy - 26, 44, 52, 16);
  ctx.fill();
  ctx.strokeStyle = '#8A6D2B';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.arc(dx, dy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2A2438';
  ctx.beginPath();
  ctx.arc(dx - 9, dy - 7, 3.5, 0, Math.PI * 2);
  ctx.arc(dx + 9, dy - 7, 3.5, 0, Math.PI * 2);
  ctx.fill();

  text(ctx, 'WISPWARDEN', LOGICAL_WIDTH / 2, 190, 88, COLORS.gold, 'center');
  text(ctx, 'Guard the Last Ember', LOGICAL_WIDTH / 2, 258, 30, COLORS.text, 'center', 400);
  if (world.best > 0) text(ctx, `BEST  ${world.best}`, LOGICAL_WIDTH / 2, 300, 22, COLORS.textDim, 'center', 600);

  const rects = buttonRects(world.screen);
  drawButton(ctx, rects.start, 'START', true, true);
  text(ctx, 'WASD / arrows move · Mouse aims', LOGICAL_WIDTH / 2, 620, 20, COLORS.textDim, 'center', 400);
  text(ctx, 'Hold click / Space to fire', LOGICAL_WIDTH / 2, 648, 20, COLORS.textDim, 'center', 400);
  text(ctx, 'Protect the Ember · Choose a gift after each wave', LOGICAL_WIDTH / 2, 676, 20, COLORS.textDim, 'center', 400);
}

function drawGameOver(ctx, world) {
  wash(ctx, 0.62, '#0B1030');
  const cx = LOGICAL_WIDTH / 2;
  ctx.fillStyle = 'rgba(24, 36, 64, 0.92)';
  roundRect(ctx, cx - 300, 150, 600, 380, 18);
  ctx.fill();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, 'THE LIGHT RESTS', cx, 205, 52, COLORS.gold, 'center');
  text(ctx, 'SCORE', cx, 268, 15, COLORS.textDim, 'center', 600);
  text(ctx, String(world.score), cx, 312, 64, COLORS.text, 'center');
  text(ctx, `BEST  ${Math.max(world.best, world.score)}`, cx, 368, 20, COLORS.textDim, 'center', 600);
  text(ctx, `WAVE  ${Math.max(1, world.wave)}    ·    KILLS  ${world.kills}`, cx, 402, 20, COLORS.textDim, 'center', 600);
  const rects = buttonRects(world.screen);
  drawButton(ctx, rects.restart, 'PLAY AGAIN', true, true);
  text(ctx, 'PLAY AGAIN · R OR ENTER', cx, 660, 20, COLORS.textDim, 'center', 400);
}

// Upgrade screen: wash, heading, three offer cards in one row and the
// TAKE GIFT confirmation button. A card is selected by click or by keys 1-3;
// selection only highlights it — TAKE GIFT (or Enter) applies it once.
function drawUpgradeScreen(ctx, world) {
  wash(ctx, 0.45);
  text(ctx, 'CHOOSE A GIFT', LOGICAL_WIDTH / 2, 130, 52, COLORS.gold, 'center');
  text(ctx, `Wave ${world.wave} cleared — the Ember holds. Pick one gift.`, LOGICAL_WIDTH / 2, 172, 20, COLORS.textDim, 'center', 400);
  const rects = buttonRects(world.screen);
  rects.cards.forEach((r, i) => {
    const offer = world.offers[i];
    const selected = world.selectedOffer === i;
    ctx.fillStyle = selected ? '#2A4068' : 'rgba(24, 36, 64, 0.92)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.fill();
    ctx.strokeStyle = selected ? COLORS.gold : 'rgba(184, 200, 217, 0.5)';
    ctx.lineWidth = selected ? 3 : 2;
    ctx.stroke();
    if (!offer) return;
    // Numbered badge.
    ctx.fillStyle = selected ? COLORS.gold : '#24365E';
    ctx.beginPath();
    ctx.arc(r.x + 30, r.y + 30, 17, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, String(i + 1), r.x + 30, r.y + 31, 20, selected ? '#182440' : COLORS.text, 'center');
    // Procedural icon.
    drawUpgradeIcon(ctx, offer.icon, r.x + r.w / 2, r.y + 84, 44, COLORS.teal);
    // Name, rank and one-line effect.
    text(ctx, offer.name, r.x + r.w / 2, r.y + 140, 26, COLORS.text, 'center');
    const rankLabel = offer.max > 0
      ? `Rank ${(offer.rank || 0) + 1} of ${offer.max}`
      : (offer.fallback ? 'Gift' : 'Repeatable');
    text(ctx, rankLabel, r.x + r.w / 2, r.y + 172, 16, COLORS.textDim, 'center', 600);
    // Wrap the effect line at the card width.
    const words = offer.effect.split(' ');
    const lines = [''];
    for (const w of words) {
      const test = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
      ctx.font = '400 18px system-ui, -apple-system, "Segoe UI", sans-serif';
      if (ctx.measureText(test).width > r.w - 36 && lines[lines.length - 1]) {
        lines.push(w);
      } else {
        lines[lines.length - 1] = test;
      }
    }
    lines.slice(0, 3).forEach((line, li) => {
      text(ctx, line, r.x + r.w / 2, r.y + 204 + li * 24, 18, COLORS.textDim, 'center', 400);
    });
    if (selected) {
      text(ctx, 'SELECTED', r.x + r.w / 2, r.y + r.h - 14, 14, COLORS.gold, 'center', 600);
    }
  });
  drawButton(ctx, rects.takeGift, 'TAKE GIFT', world.selectedOffer >= 0, true);
  text(ctx, 'Click a card or press 1 / 2 / 3, then Enter to take it', LOGICAL_WIDTH / 2, 580, 18, COLORS.textDim, 'center', 400);
}

// Pause overlay: over PLAY it is a centered panel listing the upgrades owned
// so far; over UPGRADE it is a compact bottom bar that leaves the cards,
// their names and effects, and the confirmation area readable.
function drawPauseOverlay(ctx, world) {
  const cx = LOGICAL_WIDTH / 2;
  if (world.pausedFrom === 'UPGRADE') {
    // The cleared battlefield and its cards stay visible underneath.
    drawUpgradeScreen(ctx, world);
    ctx.fillStyle = 'rgba(7, 11, 28, 0.85)';
    ctx.fillRect(0, 616, LOGICAL_WIDTH, 104);
    ctx.fillStyle = 'rgba(255, 215, 130, 0.6)';
    ctx.fillRect(0, 616, LOGICAL_WIDTH, 2);
    text(ctx, 'PAUSED', 32, 668, 28, COLORS.text, 'left');
    text(ctx, 'P / ENTER TO RESUME', LOGICAL_WIDTH / 2, 668, 20, COLORS.textDim, 'center', 600);
    const resume = { x: 1060, y: 640, w: 160, h: 56 };
    drawButton(ctx, resume, 'RESUME', true, true);
    return;
  }
  wash(ctx, 0.5);
  ctx.fillStyle = 'rgba(24, 36, 64, 0.95)';
  roundRect(ctx, cx - 260, 180, 520, 340, 18);
  ctx.fill();
  ctx.strokeStyle = COLORS.teal;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, 'PAUSED', cx, 236, 52, COLORS.text, 'center');
  text(ctx, 'P / ENTER TO RESUME', cx, 292, 22, COLORS.textDim, 'center', 600);
  const owned = UPGRADES.filter((d) => (world.upgrades[d.id] || 0) > 0);
  text(ctx, owned.length ? 'YOUR GIFTS' : 'NO GIFTS YET', cx, 340, 15, COLORS.textDim, 'center', 600);
  owned.slice(0, 6).forEach((def, i) => {
    const y = 368 + i * 24;
    drawUpgradeIcon(ctx, def.icon, cx - 130, y, 16, COLORS.teal);
    text(ctx, `${def.name} — ${def.effect}`, cx - 108, y, 16, COLORS.text, 'left', 400);
  });
  const rects = buttonRects(world.screen);
  const resume = { x: rects.resume.x, y: 440, w: rects.resume.w, h: rects.resume.h };
  drawButton(ctx, resume, 'RESUME', true, true);
}

// ---------------------------------------------------------------- entry

// Draw one frame. The world layer shakes under a hit; the HUD and overlays
// are drawn after the shake transform is restored and never move.
export function drawGame(ctx, world) {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  const shake = shakeOffset(world.fx, world.playStep);
  ctx.save();
  if (shake.x !== 0 || shake.y !== 0) ctx.translate(shake.x, shake.y);
  drawBackground(ctx, world);
  drawEmber(ctx, world);
  drawMotes(ctx, world);
  for (const e of world.enemies) drawEnemy(ctx, world, e);
  drawPlayer(ctx, world);
  drawBolts(ctx, world);
  drawOrbs(ctx, world);
  drawParticles(ctx, world);
  ctx.restore();

  // Player-hit white-gold flash over the world, under the HUD.
  if (world.fx.flash > 0) {
    ctx.globalAlpha = Math.min(0.45, world.fx.flash / 8);
    ctx.fillStyle = '#FFF6D8';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.globalAlpha = 1;
  }

  drawHUD(ctx, world);
  if (world.screen === 'TITLE') drawTitle(ctx, world);
  else if (world.screen === 'UPGRADE') drawUpgradeScreen(ctx, world);
  else if (world.screen === 'GAME_OVER') drawGameOver(ctx, world);
  else if (world.screen === 'PAUSED') drawPauseOverlay(ctx, world);
}
