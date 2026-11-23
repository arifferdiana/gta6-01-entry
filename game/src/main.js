// SOLMARINA — bootstrap: the game object, the player, and the wiring.
// This file creates every system, loads the save, shows the start screen,
// and hands the loop its first frame. The player character (on foot) is
// built here: a dark-jacketed figure with a pistol, seen from behind.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { liveRng } from './random.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createCity } from './city.js';
import { PlayerCar, createTraffic } from './vehicles.js';
import { createCrowd } from './people.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions, MISSIONS } from './missions.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { loadSave, writeSave, clearSave, freshSave } from './save.js';
import { applyShot } from './shots.js';
import { createLoop } from './render.js';

/** The player's on-foot figure: jacket, jeans, head, and a pistol. */
function makePlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x4a7fd4, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2e3a4a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.9, 8), jacket);
  body.position.y = 1.08;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
  head.position.y = 1.74;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.27, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
  );
  cap.position.y = 1.92;
  group.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.72, 0.19), jeans);
  legL.position.set(-0.14, 0.36, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.72, 0.19), jeans);
  legR.position.set(0.14, 0.36, 0);
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), jacket);
  armL.position.set(-0.4, 1.12, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), jacket);
  armR.position.set(0.4, 1.12, 0);
  group.add(armR);
  const pistol = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.12, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.6 }),
  );
  pistol.position.set(0.42, 0.95, 0.3);
  group.add(pistol);
  return group;
}

// --- The save and the shared game state.
const save = loadSave();
const game = {
  state: 'title',
  money: save.money,
  health: CONFIG.player.health,
  ammo: CONFIG.combat.magSize,
  reserveAmmo: CONFIG.combat.reserveAmmo,
  wanted: 0,
  missionIndex: Math.min(save.missionIndex, MISSIONS.length - 1),
  missionsDone: save.missionsDone.slice(),
  objective: 'Welcome to Solmarina.',
  muted: save.muted,
  reloading: false,
  reloadTimer: 0,
  deaths: 0,
  lastGunshot: null,
  shotCamera: null,
  onDeath: null,
  player: {
    mode: 'foot',
    x: save.player.x,
    z: save.player.z,
    heading: save.player.heading,
    yaw: save.player.heading,
    pitch: 0,
    moving: false,
  },
};

// --- The systems.
const world = createWorld();
const city = createCity(world.scene);
const audio = createAudio();
audio.setMuted(save.muted);
const input = createInput(world.renderer.domElement);
const hud = createHud();
const car = new PlayerCar(world.scene, city, 0xc23b3b);
car.place(8, -8, 0);
const traffic = createTraffic(world.scene, liveRng, city);
const crowd = createCrowd(world.scene, liveRng);
const police = createPolice(world.scene, city, audio, game);
const combat = createCombat(world.scene, liveRng, city, audio, game);
const playerMesh = makePlayerMesh();
world.scene.add(playerMesh);
const systems = { world, city, traffic, crowd, police, combat, audio, input, hud, car, missions: null, playerMesh };
const missions = createMissions(world.scene, game, systems);
systems.missions = missions;
const loop = createLoop(game, systems);

// --- Death: the hospital, a cut of the money, back on the street.
game.onDeath = () => {
  game.state = 'dead';
  audio.thud();
  hud.showDeath(() => {
    game.player.mode = 'foot';
    game.player.x = CONFIG.hospital.x;
    game.player.z = CONFIG.hospital.z;
    game.player.heading = 0;
    game.player.yaw = 0;
    game.state = 'playing';
    hud.toast('You woke up at St. Marina Hospital');
  });
};

// --- Shooting: a mouse click fires from the camera toward the crosshair.
world.renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (game.state !== 'playing' || game.player.mode !== 'foot') return;
  if (game.reloading || game.ammo <= 0) return;
  const dir = new THREE.Vector3();
  world.camera.getWorldDirection(dir);
  const origin = world.camera.position;
  const len = Math.hypot(dir.x, dir.z) || 1;
  const shot = combat.shoot({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x / len, z: dir.z / len });
  police.addHeat(shot.hit ? CONFIG.wanted.shootHeat : CONFIG.wanted.shootHeat * 0.5);
});

// --- Mute toggle.
window.addEventListener('keydown', (e) => {
  if (e.code === CONFIG.keys.mute[0]) {
    audio.setMuted(!audio.isMuted);
    game.muted = audio.isMuted;
  }
});

// --- Autosave while playing, and once more on exit.
setInterval(() => {
  if (game.state === 'playing') writeSave(game);
}, 10000);
window.addEventListener('beforeunload', () => writeSave(game));

// --- Start: a screenshot pose, or the start screen over the live city.
const params = new URLSearchParams(window.location.search);
const shot = parseInt(params.get('shot') || '0', 10);
if (shot >= 1 && shot <= 4) {
  applyShot(shot, game, systems);
  if (shot === 1) {
    hud.showStart(false, () => {}, () => {});
  } else {
    hud.hideStart();
  }
} else {
  const hasSave = save.missionsDone.length > 0 || save.money !== 500 || save.missionIndex > 0;
  hud.showStart(
    hasSave,
    () => {
      audio.resume();
      audio.click();
      hud.hideStart();
      input.requestLock();
      game.state = 'playing';
      if (!missions.active) missions.start(game.missionIndex);
    },
    () => {
      clearSave();
      const fresh = freshSave();
      game.money = fresh.money;
      game.missionIndex = 0;
      game.missionsDone = [];
      game.player.x = fresh.player.x;
      game.player.z = fresh.player.z;
      game.player.heading = 0;
      game.player.yaw = 0;
      audio.resume();
      hud.hideStart();
      input.requestLock();
      game.state = 'playing';
      missions.start(0);
    },
  );
}

loop.start();
