// SOLMARINA — boot and the one loop: input is read every frame, the world advances
// in fixed 1/60 s steps (several in a slow frame, none in a fast one), missions and
// the HUD update with it, and the renderer paints what is there. The game moves
// between four screens: title, play, paused and game over.
//
// ?seed=N fixes the city and traffic. ?shot=title|drive|chase|mission (with
// &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot. Shot mode always uses seed 1 unless a seed
// is given, so the frame is repeatable.
//
// The gameplay modules (world, vehicles, people, police, combat, missions, hud,
// save) are wired here by the contract in the task: world owns the simulation,
// missions owns the story, hud owns the DOM, save owns localStorage. The vehicle /
// people / police / combat modules are imported as namespaces and attached when
// they export an attach/init hook; the world may equally own them internally.

import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createAudio } from './audio.js';
import {
  ACTION_CAMERA, ACTION_CONFIRM, ACTION_ENTER_CAR, ACTION_HORN, ACTION_INTERACT,
  ACTION_JUMP, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_RELOAD, createInput,
} from './input.js';
import { createWorld } from './world.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { loadGame, saveGame } from './save.js';
import {
  CAMERA_CINEMATIC, CAMERA_DRIVE, CAMERA_FOLLOW, createRenderer,
  SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE,
} from './render.js';
import { stageShot } from './shots.js';
import * as vehicles from './vehicles.js';
import * as people from './people.js';
import * as police from './police.js';
import * as combat from './combat.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** Autosave at most this often while playing (seconds); pausing always saves. */
const AUTOSAVE_SECONDS = 30;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam)
  ? seedParam
  : (shot ? 1 : Math.floor(Math.random() * 4294967296));

const canvas = document.getElementById('game');
const status = document.getElementById('status');

/** Call a gameplay module's attach/init hook when it provides one. */
function attachModule(module, world, label) {
  try {
    if (typeof module.attach === 'function') module.attach(world);
    else if (typeof module.init === 'function') module.init(world);
  } catch (error) {
    console.warn('SOLMARINA: ' + label + ' hook failed, continuing without it.', error);
  }
}

function buildGame() {
  const random = createRandom(seed);
  const city = createCity(createRandom(seed));
  const audio = createAudio();
  const world = createWorld(random, city, audio);
  attachModule(vehicles, world, 'vehicles');
  attachModule(people, world, 'people');
  attachModule(police, world, 'police');
  attachModule(combat, world, 'combat');
  const renderer = createRenderer(canvas, city);
  const hud = createHud(document);
  const missions = createMissions(world);
  // The world forwards gameplay events (enter-car, steal, kill, arrive,
  // escape) to the missions only once they are wired in here.
  world.setMissions(missions);
  return { random, city, audio, world, renderer, hud, missions };
}

const game = buildGame();
const { audio, world, renderer, hud, missions } = game;

/** Map the renderer's screen names onto the HUD's screen names. */
function hudScreen(screen) {
  if (screen === SCREEN_PLAY) return 'game';
  if (screen === SCREEN_PAUSED) return 'pause';
  if (screen === SCREEN_OVER) return 'gameover';
  return 'title';
}

function runShot(name) {
  const staged = stageShot(name, game);
  const screen = staged.screen || SCREEN_TITLE;
  const state = staged.state || staged.hudState || world.state;
  hud.setScreen(hudScreen(screen));
  hud.update(state);
  // The follow camera orbits on camYaw, which the live loop snaps behind
  // the player's facing every frame — a staged shot has no loop, so snap it
  // here or the camera keeps its default (north) view and the action the
  // player faces can sit off-frame (the pier shot once showed only the
  // beacon's edge while the gang stood out of view to the west).
  if (screen !== SCREEN_TITLE && state.player) {
    renderer.snapBehind(state.player.angle || 0);
  }
  let painted = 0;
  function paint() {
    renderer.draw(state, screen);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let muted = false;
  let autosaveTimer = 0;
  let lastMessage = '';
  let lastMissionsDone = 0;
  let wasOnFoot = true;
  let lastWanted = 0;
  let savedSnapshot = loadGame();

  function announce(message) {
    status.textContent = message;
  }

  function snapshot() {
    const player = world.state.player || {};
    const base = {
      cash: world.state.cash || 0,
      missionsDone: Array.isArray(world.state.missionsDone) ? world.state.missionsDone.slice() : [],
      x: player.x || 0,
      z: player.z || 0,
      time: world.state.time || 0,
      health: player.health == null ? 100 : player.health,
    };
    if (typeof missions.snapshot === 'function') return { ...base, ...missions.snapshot() };
    return base;
  }

  function saveNow() {
    saveGame(snapshot());
  }

  function applySave(saved) {
    if (!saved) return;
    const player = world.state.player || {};
    player.x = saved.x;
    player.z = saved.z;
    if (typeof player.health === 'number') player.health = saved.health;
    world.state.cash = saved.cash;
    world.state.time = saved.time;
    if (typeof missions.restore === 'function') missions.restore(saved);
    else if (Array.isArray(saved.missionsDone)) world.state.missionsDone = saved.missionsDone.slice();
  }

  function setScreen(next) {
    screen = next;
    hud.setScreen(hudScreen(next));
    renderer.setCameraMode(next === SCREEN_TITLE ? CAMERA_CINEMATIC
      : (world.state.player && world.state.player.onFoot === false ? CAMERA_DRIVE : CAMERA_FOLLOW));
    if (next === SCREEN_PAUSED) saveNow();
  }

  function startGame(fromSave) {
    audio.init();
    audio.startMusic();
    world.reset();
    if (fromSave && savedSnapshot) applySave(savedSnapshot);
    lastMissionsDone = (world.state.missionsDone || []).length;
    // Fresh episode: forget the last objective line, so the first mission's
    // message toasts again instead of being swallowed as a repeat.
    lastMessage = '';
    if (!missions.active && typeof missions.startNext === 'function') missions.startNext();
    accumulator = 0;
    autosaveTimer = 0;
    wasOnFoot = world.state.player ? world.state.player.onFoot !== false : true;
    lastWanted = world.state.wanted || 0;
    setScreen(SCREEN_PLAY);
    announce(fromSave ? 'Playing. Save loaded.' : 'Playing. Mara Voss is waiting — follow the yellow marker.');
    hud.showMessage(fromSave ? 'Save loaded — welcome back, Rook.' : 'Mara: Rook. You owe me fifty grand. Drive.');
  }

  function endGame(busted) {
    setScreen(SCREEN_OVER);
    audio.setSiren(false);
    audio.setEngine(0);
    if (busted) {
      audio.busted();
      announce('Busted by the Solmarina PD.');
    } else {
      audio.wasted();
      announce('Wasted. The debt is still waiting.');
    }
    saveNow();
  }

  function togglePause() {
    if (screen === SCREEN_PLAY) {
      setScreen(SCREEN_PAUSED);
      audio.setSiren(false);
      audio.setEngine(0);
      announce('Paused. Progress saved.');
    } else if (screen === SCREEN_PAUSED) {
      setScreen(SCREEN_PLAY);
      announce('Playing.');
    }
  }

  // Gameplay flags (enter car, interact, punch, reload, jump) are taken once per
  // frame here and handed to the first fixed step, so a press between two frames
  // is never lost and never counted twice.
  let pendingActions = 0;
  const GAMEPLAY_ACTIONS = ACTION_ENTER_CAR | ACTION_INTERACT | ACTION_PUNCH | ACTION_RELOAD | ACTION_JUMP;

  function handleActions(actions) {
    if (!actions) return;
    if (actions & ACTION_MUTE) {
      muted = !muted;
      audio.setMuted(muted);
      hud.showMessage(muted ? 'Sound muted (M to unmute).' : 'Sound on.');
    }
    if (actions & ACTION_HORN) audio.horn();
    if (actions & ACTION_CAMERA) {
      renderer.setCameraMode(CAMERA_FOLLOW);
      hud.showMessage('Camera reset.');
    }
    pendingActions |= actions & GAMEPLAY_ACTIONS;
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER) {
      if (actions & ACTION_CONFIRM) startGame(false);
      return;
    }
    if (actions & ACTION_PAUSE) togglePause();
    else if (screen === SCREEN_PAUSED && (actions & ACTION_CONFIRM)) togglePause();
  }

  // HUD buttons dispatch 'solmarina' CustomEvents on the document.
  document.addEventListener('solmarina', (event) => {
    const action = event.detail && event.detail.action;
    if (action === 'new-game') startGame(false);
    else if (action === 'continue') startGame(true);
    else if (action === 'resume') togglePause();
    else if (action === 'retry') startGame(false);
    else if (action === 'to-title') {
      saveNow();
      savedSnapshot = loadGame();
      setScreen(SCREEN_TITLE);
      announce('SOLMARINA. Press Enter or click New Game to start.');
    }
  });

  // First gesture unlocks audio (browsers require it); clicks also confirm on menus.
  function firstGesture() {
    audio.init();
    if (screen === SCREEN_TITLE) audio.startMusic();
  }
  window.addEventListener('pointerdown', firstGesture, { once: false });
  window.addEventListener('keydown', firstGesture, { once: false });

  function forwardWorldEvents() {
    const player = world.state.player || {};
    const onFoot = player.onFoot !== false;
    if (wasOnFoot && !onFoot) {
      missions.onEvent('enter-car', { kind: 'car' });
      renderer.snapBehind(player.angle || 0);
    }
    wasOnFoot = onFoot;
    const wanted = world.state.wanted || 0;
    if (lastWanted > 0 && wanted === 0) missions.onEvent('escape', {});
    lastWanted = wanted;
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      // Ambient title backdrop: traffic moves, nothing can hurt the player.
      const idle = { move: () => ({ forward: 0, strafe: 0 }), direction: () => ({ x: 0, z: 0 }), axis: () => ({ x: 0, y: 0 }), lookDelta: () => ({ dx: 0, dy: 0 }), shooting: () => false, running: () => false, takeActions: () => 0 };
      world.step(STEP, idle, 0);
      return;
    }
    const actions = pendingActions;
    pendingActions = 0;
    // The world may return gameplay events; forward what it gives.
    // (world.step also calls missions.update itself now that the missions
    // are wired in, so this loop must not update them a second time.)
    const events = world.step(STEP, input, actions);
    if (Array.isArray(events)) {
      for (const event of events) {
        if (typeof event === 'string') missions.onEvent(event, {});
        else if (event && typeof event.name === 'string') missions.onEvent(event.name, event.data || {});
      }
    }
    forwardWorldEvents();

    // Driving changes the camera; entering a car snaps the orbit behind it.
    const player = world.state.player || {};
    renderer.setCameraMode(player.onFoot === false ? CAMERA_DRIVE : CAMERA_FOLLOW);

    // Sound follows the game: engine with speed, siren while wanted.
    audio.setEngine(player.onFoot === false ? Math.abs(player.speed || 0) : 0, 55);
    audio.setSiren((world.state.wanted || 0) > 0);

    // Fresh objective / message lines become toasts as well as the HUD line.
    const message = world.state.message || '';
    if (message && message !== lastMessage) {
      lastMessage = message;
      if ((world.state.missionsDone || []).length > lastMissionsDone) {
        lastMissionsDone = (world.state.missionsDone || []).length;
        audio.missionComplete();
        saveNow();
      }
    }

    autosaveTimer += STEP;
    if (autosaveTimer >= AUTOSAVE_SECONDS) {
      autosaveTimer = 0;
      saveNow();
    }

    if (screen === SCREEN_PLAY && world.state.over) {
      // Wasted / busted: the world sets state.over and the game-over
      // screen waits here until Retry; the screen guard keeps this firing
      // once per episode.
      endGame(world.state.over === 'busted');
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions(input.takeActions());
    // The world owns the camera yaw (it consumed the mouse drag in step);
    // sync the renderer from it and forward only the pitch drag. Reading
    // input.lookDelta() here as well would steal the drag from the world.
    renderer.snapBehind(world.state.cameraYaw || 0);
    renderer.addLook(0, world.state.lookDY || 0);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen);
    hud.update(world.state);
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      setScreen(SCREEN_PAUSED);
      audio.setSiren(false);
      audio.setEngine(0);
      announce('Paused.');
    }
  });

  // Enter-key / click confirm also starts from the title screen (input handles it).
  hud.setScreen('title');
  announce('SOLMARINA. Press Enter or click New Game to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
