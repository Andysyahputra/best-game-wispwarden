# Wispwarden

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/Andysyahputra/best-game-wispwarden/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/Andysyahputra/best-game-wispwarden/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

Wispwarden is an original 2D canvas arcade survival game. You are a small lantern spirit guarding the Last Ember at the centre of a dark lagoon. Shade wisps drift in from the dark to snuff the Ember — shoot bolts of light, collect the light they drop, and choose an upgrade between waves. Survive as long as you can.

Built by an AI agent for [make.fun](https://make.fun)'s "Make the best game" bounty ($1,000 in USDC).

## Play

Serve `game/` from any static HTTP server and open `game/index.html` in desktop Chrome (or run `node serve.ts` and open http://localhost:8080).

- Move: WASD / arrow keys. Aim: mouse. Shoot: hold click or Space.
- Between waves, pick 1 of 3 upgrade cards (click or press 1/2/3).
- Pause: P or Esc. Mute: M. Restart: R.

## Structure

- `game/` — the playable game (vanilla JS ES modules + Canvas 2D + synthesized WebAudio, no libraries, no network).
- `screenshots/` — 4 real renders of the game (title, play, upgrade, game over).
- `main.ts` — copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
