// The screenshot scenes behind ?shot=title|drive|chase|mission. Each one
// builds a fresh world from seed 1, stages the scene by setting the live
// state directly (positions, cars, cops, wanted level, mission marker)
// and then plays the real rules forward a few seconds, so the frame is
// what a short game really looks like and the same seed always gives the
// same frame.
//
// The staged state is returned as { screen, state, hudState } — main.js
// paints it twice and sets window.__shotReady. Staging is defensive:
// world.step is tried for ambient motion but a failure there never loses
// the staged scene.

import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld } from './world.js';
import { createMissions } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const SHOT_SEED = 1;

/** Audio is never initialised for a screenshot; a no-op stand-in keeps the world quiet. */
const silentAudio = new Proxy({}, { get: () => () => {} });

function freshWorld() {
  const city = createCity(createRandom(SHOT_SEED));
  const world = createWorld(createRandom(SHOT_SEED), city, silentAudio);
  return { world, city };
}

/** A fake input object shaped like the real one, for stepping the world forward. */
function fakeInput(forward, strafe) {
  return {
    move: () => ({ forward, strafe }),
    direction: () => ({ x: strafe, z: -forward }),
    axis: () => ({ x: strafe, y: forward }),
    lookDelta: () => ({ dx: 0, dy: 0 }),
    shooting: () => false,
    running: () => false,
    takeActions: () => 0,
  };
}

function stepWorld(world, seconds, input) {
  try {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) world.step(STEP, input || fakeInput(0, 0), 0);
  } catch {
    // Ambient motion is a bonus; the staged state below is the scene.
  }
}

function baseState(world, patch) {
  const state = world.state;
  state.cash = patch.cash != null ? patch.cash : 1250;
  state.wanted = patch.wanted || 0;
  state.time = patch.time != null ? patch.time : 10.5;
  state.message = patch.message || '';
  state.missionId = patch.missionId || null;
  state.markers = patch.markers || [];
  if (state.markers.length > 0) state.missionTarget = state.markers[0];
  if (!Array.isArray(state.cars)) state.cars = [];
  if (!Array.isArray(state.peds)) state.peds = [];
  if (!Array.isArray(state.cops)) state.cops = [];
  if (!Array.isArray(state.gang)) state.gang = [];
  return state;
}

function putPlayerOnFoot(state, x, z, angle) {
  const player = state.player;
  player.x = x;
  player.z = z;
  player.angle = angle;
  player.onFoot = true;
  player.car = null;
  player.speed = 0;
  player.health = 100;
}

function putPlayerInCar(state, car) {
  const player = state.player;
  player.onFoot = false;
  player.car = car;
  player.x = car.x;
  player.z = car.z;
  player.angle = car.angle;
  player.speed = car.speed || 0;
  player.health = 100;
}

function stageTitle() {
  const { world } = freshWorld();
  world.reset();
  stepWorld(world, 5);
  const state = baseState(world, {
    cash: 0,
    wanted: 0,
    time: 17.5,
    message: '',
  });
  // Rook on foot at the spawn point, looking out over downtown at dusk.
  putPlayerOnFoot(state, 6, 102, Math.PI);
  return { screen: SCREEN_TITLE, state, hudState: state };
}

function stageDrive() {
  const { world, city } = freshWorld();
  world.reset();
  // Ambient traffic first: any world.step after this would rebuild the car
  // list and drop the staged cars, so the scene is placed only once the
  // stepping is done.
  stepWorld(world, 2, fakeInput(1, 0));
  const state = baseState(world, {
    cash: 1250,
    wanted: 0,
    time: 10.5,
    message: 'Drive the client to the Palms Hotel',
    missionId: 'first-fare',
    markers: [{ x: 72, z: -30, kind: 'dropoff', label: 'Palms Hotel' }],
  });
  // A red sports car heading north up the downtown road at x = 0.
  const car = { x: 0, z: 68, angle: Math.PI, color: 0xc0392b, model: 'sport', speed: 26 };
  state.cars.push(car);
  // Downtown traffic around it.
  state.cars.push(
    { x: 0, z: -12, angle: Math.PI, color: 0x3a6fd9, model: 'sedan', speed: 9 },
    { x: 0, z: 140, angle: 0, color: 0xe8b13d, model: 'taxi', speed: 9 },
    { x: 72, z: 180, angle: Math.PI / 2, color: 0x7bc47f, model: 'sedan', speed: 8 },
    { x: -72, z: -120, angle: -Math.PI / 2, color: 0xd97b9c, model: 'sedan', speed: 8 },
  );
  state.peds.push(
    { x: 10, z: 8, angle: 0, speed: 1.5 },
    { x: -10, z: -20, angle: Math.PI, speed: 1.5 },
    { x: 82, z: 100, angle: Math.PI / 2, speed: 1.2 },
  );
  putPlayerInCar(state, car);
  void city;
  return { screen: SCREEN_PLAY, state, hudState: state };
}

function stageChase() {
  const { world } = freshWorld();
  world.reset();
  stepWorld(world, 2, fakeInput(1, 0));
  const state = baseState(world, {
    cash: 2100,
    wanted: 3,
    time: 20.25,
    message: 'Lose the cops — reach the hideout',
    missionId: 'heat-wave',
    markers: [{ x: 216, z: 144, kind: 'safehouse', label: 'Hideout' }],
  });
  // Rook fleeing north in the red sports car; two PD cruisers pulling up
  // ALONGSIDE him (one ahead-left, one behind-right) so both are inside
  // the chase camera's view — cruisers staged directly behind the player
  // sit behind the camera and never show. A foot cop runs ahead, and a
  // third cruiser sits across the road further north, the start of a
  // roadblock, so the frame shows the pursuit and the response at once.
  const car = { x: 0, z: 60, angle: Math.PI, color: 0xc0392b, model: 'sport', speed: 32 };
  state.cars.push(car);
  const copCar1 = { x: -6, z: 52, angle: Math.PI, color: 0x1a2436, model: 'police', speed: 30 };
  const copCar2 = { x: 4, z: 64, angle: Math.PI, color: 0x1a2436, model: 'police', speed: 30 };
  const copCar3 = { x: -8, z: 18, angle: Math.PI / 2, color: 0x1a2436, model: 'police', speed: 0 };
  state.cars.push(copCar1, copCar2, copCar3);
  state.cops.push(
    { x: copCar1.x, z: copCar1.z, angle: Math.PI, onFoot: false, car: copCar1 },
    { x: copCar2.x, z: copCar2.z, angle: Math.PI, onFoot: false, car: copCar2 },
    { x: copCar3.x, z: copCar3.z, angle: Math.PI / 2, onFoot: false, car: copCar3 },
    { x: 10, z: 18, angle: Math.PI, onFoot: true, speed: 6 },
  );
  state.peds.push(
    { x: -10, z: 0, angle: 0, speed: 1.5 },
    { x: 82, z: 60, angle: Math.PI / 2, speed: 1.2 },
  );
  putPlayerInCar(state, car);
  return { screen: SCREEN_PLAY, state, hudState: state };
}

function stageMission() {
  const { world } = freshWorld();
  world.reset();
  stepWorld(world, 1.5);
  const state = baseState(world, {
    cash: 3400,
    wanted: 2,
    time: 15.75,
    message: 'Clear the Reef Kings at the pier (0/5)',
    missionId: 'pier-pressure',
    markers: [{ x: -416, z: 40, kind: 'combat', label: 'Solmarina Pier' }],
  });
  // Rook on foot at the pier, facing the gang; five Reef Kings clustered
  // on the pier deck ahead of him, all inside the camera's view.
  putPlayerOnFoot(state, -402, 40, -Math.PI / 2);
  state.player.ammo = 24;
  state.gang.push(
    { x: -424, z: 38, angle: Math.PI / 2, speed: 1 },
    { x: -420, z: 42, angle: Math.PI / 2, speed: 1 },
    { x: -416, z: 37, angle: Math.PI / 2, speed: 1 },
    { x: -426, z: 43, angle: Math.PI / 2, speed: 1 },
    { x: -414, z: 41, angle: Math.PI / 2, speed: 1 },
  );
  state.peds.push(
    { x: -300, z: 20, angle: 0, speed: 1.5 },
    { x: -300, z: 70, angle: Math.PI, speed: 1.2 },
  );
  state.cops.push({ x: -288, z: 40, angle: -Math.PI / 2, onFoot: true, speed: 4 });
  state.flashes = [{ x: -402, y: 1.5, z: 40, ttl: 0.1 }];
  return { screen: SCREEN_PLAY, state, hudState: state };
}

/**
 * Set `game` (or a fresh world) to the named scene — 'title', 'drive', 'chase'
 * or 'mission'; any other name is the title — and return the screen to draw
 * over it plus the state to feed the renderer and the HUD.
 */
export function stageShot(name, game) {
  void game;
  void createMissions;
  if (name === 'drive') return stageDrive();
  if (name === 'chase') return stageChase();
  if (name === 'mission') return stageMission();
  return stageTitle();
}
