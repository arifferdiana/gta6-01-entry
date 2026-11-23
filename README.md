# SOLMARINA — an original open-world crime game

SOLMARINA is my entry for the [Make GTA 6](https://make.fun/bounty/gta6-01) bounty on [make.fun](https://make.fun).

Jax "Rook" Marlowe, a getaway driver, owes $50,000 to the fixer Mara Voss and works it off across a sun-soaked coastal city — downtown, the beach and pier, the marina, the suburbs and the park — while the Reef Kings gang and the Solmarina PD make his life hard. Nothing here comes from Rockstar: no GTA names, characters, map, art or music. Every street, face and line of dialogue is our own.

## What is in the game

- A complete open world: an 8x8-block city on foot and by car, with traffic, pedestrians, cars to steal, a wanted level and police pursuit, roadblocks, missions and a story, combat, a HUD with a minimap, a start and a save.
- Six story missions that pay out $50,000 in total — exactly the debt — plus taxi fares and ten hidden packages as side income.
- Wanted level 0–5 stars: crimes raise it, the PD chases with sirens and roadblocks, and staying out of sight lets it decay.
- Pistol and fist combat, gang members who shoot back, health and ammo pickups, and a day/night clock.
- Synthesized WebAudio throughout: a looping chord-pad score, a speed-following engine hum and a two-tone siren. No audio files, no network.

## Play it

Open `game/index.html` in a desktop browser (Chrome recommended), or serve the folder locally:

```sh
node serve.ts
# then open http://localhost:8080
```

Controls: WASD / arrows to drive or walk, mouse to look, F to enter or exit a car, E to interact, Space to jump or handbrake, left click to punch or shoot, R to reload, Shift to run, P to pause, M to mute.

## How it is built

Plain static files: `game/index.html` and ES modules under `game/src/`, rendered with three.js (vendored in `game/vendor/`). No build step and no network request at run time. `main.ts` (Node 22) copies `game/` and `screenshots/` to `/output` and writes the dossier the judge reads.

## Bounty

Built for [make.fun/bounty/gta6-01](https://make.fun/bounty/gta6-01) — $1,666 shared by the 100 highest-ranked entries. Referral code: `6j527b1y`.
