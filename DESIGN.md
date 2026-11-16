# Wispwarden — Guard the Last Ember

A complete original 2D canvas arcade survival game. You are the Wispwarden,
a small lantern keeper, and the last Ember in a dark lagoon is going out.
Waves of shades drift in from the dark to swallow it. Hold the light.

## How to play

- **Move:** WASD or arrow keys. **Aim:** mouse. **Fire:** hold click or Space.
- **Pause:** P or Escape. **Sound:** M. **Restart:** R or Enter on the results screen.
- **Goal:** protect the Ember. A shade that reaches it bites off 8 health;
  at 0 the light rests and the run ends. You have 3 hearts; a touch costs 1.
- **Score:** kills build a combo multiplier (up to x8) while you keep killing
  within the window; golden motes feed the combo meter and are worth 10 each.
  Clearing a wave pays 500 + 100 per wave.
- **Gifts:** after every cleared wave, pick one of three upgrade cards, then
  press Enter or TAKE GIFT. Ten gifts: faster bolts, twin shots, piercing,
  a wide fan, spare hearts, Ember mends, a mote magnet, swift boots, an
  Ember Ward that burns nearby shades, and a Combo Keeper.

## Enemies

- **Driftwisp** — slow droplet, drifts toward the Ember.
- **Dartshade** — hunts you; telegraphs, then dashes.
- **Bulwark** — armored, 4 HP, with a frontal shield that deflects bolts.
  Hit it from the side or behind.
- **Splitter** — breaks into two quick children when destroyed.
- **Gloom Herald** — every fifth wave: a crowned boss that orbits the Ember
  and fires rings of ten purple orbs.

## Implementation outline

Vanilla JavaScript ES modules, Canvas 2D and synthesized WebAudio — no
assets, no libraries, no build step, no network. Fixed 1/60 s simulation
with deterministic mulberry32 streams (spawn, loot, upgrades, cosmetics),
swept bolt collision, and a five-screen machine (title, play, upgrade,
paused, game over). Screenshots are staged by an autopilot playing the real
game through the same inputs a human uses, from seed 7.
