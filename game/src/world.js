// SOLMARINA — world: the simulation glue.
// Original code for this game. No Rockstar / GTA names, art or assets.
//
// Owns the player, the clock, crime, death / bust, pickups and the mission
// hooks, and steps the four subsystems (vehicles, people, police, combat)
// every fixed step. It draws nothing: render.js paints state, hud.js reads
// state, missions.js reads state and drives the story.
//
// Contracts it honours (read from the real modules, not assumed):
//   config.js  PLAYER / CAR / HEAT / WANTED_MAX / PALETTE.
//   city.js    createCity -> { spawns, isRoad, clampToCity, collideCircle,
//              nearestRoadPoint, randomRoadPoint, randomSidewalkPoint }.
//              collideCircle(x, z, r) returns the corrected {x, z}.
//   input.js   input.move() -> {forward, strafe}; input.lookDelta() ->
//              {dx, dy} (cleared on read); input.shooting(); input.running();
//              input.takeActions() -> ACTION_* flags.
//   audio.js   setEngine(speed, maxSpeed), setSiren(on), gunshot, punch,
//              pickup, click, horn, missionComplete, busted, wasted.
//   missions.js createMissions(world) -> { list, active, start(id),
//              update(dt), onEvent(name, data) }; it reads state.cash,
//              state.wanted, state.missionId, state.message, state.markers,
//              state.missionsDone and writes state.cash / .message /
//              .markers / .missionId. It also FORCES state.wanted (heat-wave
//              / big-score), so the police adopt state.wanted each step.
//   render.js  paints state.player {x,y,z,angle,health,onFoot,car,speed},
//              state.cars[] {x,z,angle,color,model}, state.peds[],
//              state.cops[] {x,z,angle,speed,onFoot,car}, state.markers[],
//              state.flashes[] {x,y,z}, state.effects[].
//   hud.js     reads state.player.ammo, state.cars, state.cops, state.gang,
//              state.markers, state.wanted, state.cash, state.time,
//              state.message, state.missionId.
//   save.js    snapshot shape { cash, missionsDone, x, z, time, health }.
//
// Camera: the world owns state.cameraYaw (mouse drag turns it) and exposes
// state.lookDY (the pitch drag consumed this step). main.js must sync the
// renderer each frame — renderer.snapBehind(world.state.cameraYaw) and
// renderer.addLook(0, world.state.lookDY) — and must NOT also read
// input.lookDelta(), because the world already consumed it.
// Cash lives on state.cash (missions / hud / save all read it there), not
// on the player. Missions are wired with world.setMissions(createMissions
// (world)); every onEvent call is guarded, so the world also runs when
// missions.js is absent.

import { CAR, HEAT, PLAYER } from './config.js';
import {
  ACTION_ENTER_CAR, ACTION_HORN, ACTION_INTERACT, ACTION_JUMP,
  ACTION_MUTE, ACTION_RELOAD,
} from './input.js';
import { createVehicles, buildCarModel } from './vehicles.js';
import { createPeople } from './people.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';

const STEP_ARRIVE_RADIUS = 14;
const WASTED_CASH_LOSS = 0.1;
const RESPAWN_SECONDS = 5;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function cssColor(str, fallback) {
  if (typeof str === 'string' && str[0] === '#') {
    const n = Number.parseInt(str.slice(1), 16);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function call(audio, name, ...args) {
  if (audio && typeof audio[name] === 'function') audio[name](...args);
}

/** Push a circle out of building AABBs; returns corrected {x, z, hit}. */
function moveWithCollision(city, x, z, dx, dz, r) {
  if (!city || typeof city.collideCircle !== 'function') {
    return { x: x + dx, z: z + dz, hit: false };
  }
  let hit = false;
  let nx = x + dx;
  let nz = z;
  let out = city.collideCircle(nx, nz, r);
  if (out && typeof out.x === 'number' && typeof out.z === 'number') {
    if (out.x !== nx || out.z !== nz) hit = true;
    nx = out.x;
    nz = out.z;
  }
  const mx = nx;
  nz = z + dz;
  out = city.collideCircle(mx, nz, r);
  if (out && typeof out.x === 'number' && typeof out.z === 'number') {
    if (out.x !== mx || out.z !== nz) hit = true;
    nx = out.x;
    nz = out.z;
  }
  return { x: nx, z: nz, hit };
}

function clampToCity(city, x, z) {
  if (city && typeof city.clampToCity === 'function') {
    const c = city.clampToCity(x, z);
    if (c && typeof c.x === 'number' && typeof c.z === 'number') return c;
  }
  return { x, z };
}

export function createWorld(random, city, audio) {
  const vehicles = createVehicles(city, random, audio);
  const people = createPeople(city, random, audio);
  const police = createPolice(city, random, audio);
  const combat = createCombat(audio, random);
  let missions = null;

  const state = {
    player: {
      x: 0, z: 0, y: 0, vy: 0, angle: 0,
      health: PLAYER.health, armor: 0,
      onFoot: true, car: null, speed: 0, ammo: null,
      grounded: true,
    },
    cars: [],
    peds: people.peds,
    cops: people.cops,
    gang: people.gang,
    pickups: combat.pickups,
    wanted: 0,
    time: 9,
    day: 1,
    cash: 200,
    missionId: null,
    message: '',
    markers: [],
    missionsDone: [],
    storyComplete: false,
    cameraYaw: 0,
    lookDY: 0,
    flashes: [],
    effects: [],
    over: null,
    overTimer: 0,
    stats: { kills: 0, carsStolen: 0, distance: 0 },
  };

  let messageTimer = 0;
  let handbrakeTimer = 0;
  let ramCooldown = 0;
  let lastAttack = 'shoot';
  let prevWanted = 0;
  let lastSyncedWanted = 0;
  let prevMissionId = null;
  let lastMarkerKey = '';
  let pierGangSpawned = false;

  function spawnPoint(name, fallback) {
    if (city && city.spawns && city.spawns[name]) return city.spawns[name];
    return fallback;
  }

  function setMessage(text, seconds) {
    state.message = text;
    messageTimer = seconds || 3;
  }

  function missionEvent(name, data) {
    if (missions && typeof missions.onEvent === 'function') {
      missions.onEvent(name, data || {});
    }
  }

  /** The two mission vehicles: the Comet GT and the armored van. */
  function ensureMissionCars() {
    const parked = vehicles.parkedCars;
    if (!parked.some((c) => c.missionKind === 'comet')) {
      const at = city && typeof city.nearestRoadPoint === 'function'
        ? city.nearestRoadPoint(60, 80)
        : { x: 60, z: 72 };
      const mesh = buildCarModel(0xd43d2a, 'sports');
      mesh.position.set(at.x, 0, at.z);
      mesh.rotation.y = Math.PI / 2;
      parked.push({
        mesh, kind: 'sports', model: 'sport', color: 0xd43d2a,
        missionKind: 'comet', x: at.x, z: at.z, angle: Math.PI / 2,
        speed: 0, parked: true, occupied: false, health: 100, disabled: false,
      });
    }
    if (!parked.some((c) => c.missionKind === 'armored')) {
      const at = city && typeof city.nearestRoadPoint === 'function'
        ? city.nearestRoadPoint(-60, -140)
        : { x: -60, z: -144 };
      const mesh = buildCarModel(0x2c3e50, 'van');
      mesh.position.set(at.x, 0, at.z);
      mesh.rotation.y = Math.PI / 2;
      parked.push({
        mesh, kind: 'van', model: 'van', color: 0x2c3e50,
        missionKind: 'armored', x: at.x, z: at.z, angle: Math.PI / 2,
        speed: 0, parked: true, occupied: false, health: 100, disabled: false,
      });
    }
  }

  function pickupSpots() {
    const spots = [];
    const put = (name, kind) => {
      const p = spawnPoint(name, null);
      if (p) spots.push({ x: p.x, z: p.z, kind });
    };
    put('hospital', 'health');
    put('pier', 'health');
    put('hideout', 'ammo');
    put('policeStation', 'ammo');
    put('marina', 'ammo');
    return spots;
  }

  function rebuildCarList() {
    state.cars = vehicles.parkedCars
      .concat(vehicles.traffic.cars, police.policeCars);
  }

  function reset() {
    const spawn = spawnPoint('playerSpawn', { x: 0, z: 0 });
    const p = state.player;
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = 0;
    p.vy = 0;
    p.angle = 0;
    p.health = PLAYER.health;
    p.armor = 0;
    p.onFoot = true;
    p.car = null;
    p.speed = 0;
    p.ammo = combat.state.ammo;
    p.grounded = true;
    state.wanted = 0;
    state.time = 9;
    state.day = 1;
    state.cash = 200;
    state.missionId = null;
    state.message = '';
    state.markers = [];
    state.missionsDone = [];
    state.storyComplete = false;
    state.cameraYaw = 0;
    state.lookDY = 0;
    state.flashes = [];
    state.effects = [];
    state.over = null;
    state.overTimer = 0;
    state.stats.kills = 0;
    state.stats.carsStolen = 0;
    state.stats.distance = 0;
    messageTimer = 0;
    handbrakeTimer = 0;
    ramCooldown = 0;
    prevWanted = 0;
    lastSyncedWanted = 0;
    prevMissionId = null;
    lastMarkerKey = '';
    pierGangSpawned = false;
    vehicles.reset();
    people.reset();
    police.reset();
    combat.reset();
    combat.spawnPickups(pickupSpots());
    ensureMissionCars();
    rebuildCarList();
    setMessage('Welcome to Solmarina. Steal a car, mind the law.', 4);
  }

  // --- Crime, damage, death -------------------------------------------------

  function handleKill(target) {
    state.stats.kills += 1;
    if (target.kind === 'ped') {
      police.addWanted(HEAT.killPed || 2, 'pedestrian killed');
      setMessage('A pedestrian is down. The PD is coming.', 3);
    } else if (target.kind === 'cop') {
      police.addWanted(HEAT.killCop || 2, 'officer killed');
      setMessage('An officer is down. The whole PD is coming.', 3);
    } else if (target.kind === 'gang') {
      state.cash += 25;
      setMessage('Reef King down. +$25.', 2);
    }
    state.wanted = police.state.stars;
    missionEvent('kill', { kind: target.kind });
  }

  function handleHit(target) {
    if (!target || target.dead) return;
    if (target.kind === 'ped' || target.kind === 'cop') {
      // One assault report per victim: repeated hits on the same person
      // don't stack stars (the kill itself adds killPed / killCop).
      if (!target.reported) {
        target.reported = true;
        police.addWanted(lastAttack === 'punch' ? (HEAT.punchPed || 1) : (HEAT.shoot || 1), 'assault');
        state.wanted = police.state.stars;
      }
    }
  }

  function damagePlayer(amount, from) {
    const p = state.player;
    if (state.over) return;
    let dmg = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, dmg);
      p.armor -= absorbed;
      dmg -= absorbed;
    }
    p.health -= dmg;
    void from;
    if (p.health <= 0) {
      p.health = 0;
      wasted();
    }
  }

  function wasted() {
    const loss = Math.floor(state.cash * WASTED_CASH_LOSS);
    state.cash -= loss;
    state.over = 'wasted';
    state.overTimer = RESPAWN_SECONDS;
    police.setWanted(0);
    state.wanted = 0;
    call(audio, 'wasted');
    setMessage(`WASTED. The hospital took $${loss}.`, 5);
    missionEvent('wasted', {});
  }

  function handleBust(kind) {
    const p = state.player;
    const fine = Math.min(state.cash, 100 + 50 * Math.max(1, prevWanted));
    state.cash -= fine;
    if (p.car) {
      p.car.speed = 0;
      p.car.parked = true;
      p.car = null;
    }
    p.onFoot = true;
    p.speed = 0;
    state.over = 'busted';
    state.overTimer = RESPAWN_SECONDS;
    police.setWanted(0);
    state.wanted = 0;
    call(audio, 'busted');
    setMessage(`BUSTED (${kind}). Fine $${fine}.`, 5);
    missionEvent('busted', { kind });
  }

  /** Respawn after wasted / busted (also the HUD Retry button's target). */
  function respawn() {
    const p = state.player;
    const wasOver = state.over;
    const spot = wasOver === 'busted'
      ? spawnPoint('policeStation', { x: 42, z: 150 })
      : spawnPoint('hospital', { x: -102, z: -102 });
    if (p.car) {
      p.car.speed = 0;
      p.car.parked = true;
      p.car = null;
    }
    p.x = spot.x;
    p.z = spot.z;
    p.y = 0;
    p.vy = 0;
    p.angle = 0;
    p.health = PLAYER.health;
    p.onFoot = true;
    p.speed = 0;
    p.grounded = true;
    state.over = null;
    state.overTimer = 0;
    setMessage(wasOver === 'busted'
      ? 'Released. The debt is still waiting.'
      : 'Patched up. The debt is still waiting.', 4);
  }

  // --- Entering / leaving cars ----------------------------------------------

  function nearestParkedCar(maxDist) {
    const p = state.player;
    let best = null;
    let bestD = maxDist;
    for (const car of vehicles.parkedCars) {
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  function tryEnterCar() {
    const p = state.player;
    const car = nearestParkedCar(3.6);
    if (!car) {
      setMessage('No car nearby.', 2);
      return;
    }
    if (car.disabled) {
      setMessage('That car is wrecked.', 2);
      return;
    }
    const wasOccupied = car.occupied;
    if (wasOccupied) {
      // The driver bails and runs.
      people.spawnFleeingPed(car.x + 2, car.z + 1, car.x, car.z);
      car.occupied = false;
      const witnessed = people.peds.some((ped) => !ped.dead
        && Math.hypot(ped.x - car.x, ped.z - car.z) < 30)
        || people.cops.some((cop) => !cop.dead
          && Math.hypot(cop.x - car.x, cop.z - car.z) < 30);
      if (witnessed) {
        police.addWanted(HEAT.stealCar || 1, 'car stolen');
        state.wanted = police.state.stars;
        setMessage('Car stolen! Someone saw that.', 3);
      } else {
        setMessage('Car stolen. Nobody saw.', 2);
      }
    } else {
      setMessage('You took the car.', 2);
    }
    car.parked = false;
    p.car = car;
    p.onFoot = false;
    p.speed = 0;
    p.angle = car.angle;
    state.cameraYaw = car.angle;
    state.stats.carsStolen += 1;
    missionEvent('enter-car', { kind: car.kind });
    missionEvent('steal', { kind: car.missionKind || car.kind, model: car.model });
    call(audio, 'click');
  }

  function exitCar() {
    const p = state.player;
    const car = p.car;
    if (!car) return;
    car.speed = 0;
    car.parked = true;
    const sideX = Math.cos(car.angle);
    const sideZ = -Math.sin(car.angle);
    const spot = moveWithCollision(city, car.x, car.z, sideX * 2.2, sideZ * 2.2, PLAYER.radius);
    p.x = spot.x;
    p.z = spot.z;
    p.y = 0;
    p.vy = 0;
    p.angle = car.angle;
    p.onFoot = true;
    p.car = null;
    p.speed = 0;
    p.grounded = true;
    call(audio, 'click');
  }

  // --- Save shape ------------------------------------------------------------

  function snapshot() {
    return {
      cash: Math.floor(state.cash),
      missionsDone: state.missionsDone.slice(),
      x: state.player.x,
      z: state.player.z,
      time: state.time,
      health: state.player.health,
    };
  }

  function restoreSave(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.cash === 'number') state.cash = data.cash;
    if (typeof data.x === 'number') state.player.x = data.x;
    if (typeof data.z === 'number') state.player.z = data.z;
    if (typeof data.time === 'number') state.time = data.time;
    if (typeof data.health === 'number') {
      state.player.health = clamp(data.health, 0, PLAYER.health);
    }
    if (Array.isArray(data.missionsDone)) state.missionsDone = data.missionsDone.slice();
    return true;
  }

  // --- The step ---------------------------------------------------------------

  function step(dt, input, actions) {
    const events = { wasted: false, busted: false, killed: null, stole: false, enteredCar: false };
    const p = state.player;

    // Clock: one real second is one game minute.
    state.time += dt / 60;
    if (state.time >= 24) {
      state.time -= 24;
      state.day += 1;
    }
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0 && !state.missionId) state.message = '';
    }
    if (ramCooldown > 0) ramCooldown -= dt;

    const acts = typeof actions === 'number'
      ? actions
      : (input && typeof input.takeActions === 'function' ? input.takeActions() : 0);

    // Camera: the world owns the yaw (mouse drag); lookDelta is consumed
    // here and the pitch drag is handed back as state.lookDY for main.js
    // to forward to renderer.addLook(0, lookDY).
    if (input && typeof input.lookDelta === 'function') {
      const look = input.lookDelta();
      if (look) {
        if (typeof look.dx === 'number') state.cameraYaw -= look.dx * 0.005;
        state.lookDY = typeof look.dy === 'number' ? look.dy : 0;
      } else {
        state.lookDY = 0;
      }
    }

    // Wasted / busted: the world keeps simmering behind the game-over
    // screen, then respawns on its own (HUD Retry calls respawn() early).
    if (state.over) {
      state.overTimer -= dt;
      vehicles.update(dt, null, p.x, p.z);
      people.update(dt, { player: p, wanted: 0, danger: null });
      rebuildCarList();
      if (state.overTimer <= 0) {
        const was = state.over;
        respawn();
        if (was === 'wasted') events.wasted = true;
        else events.busted = true;
      }
      return events;
    }

    const move = input && typeof input.move === 'function'
      ? input.move()
      : { forward: 0, strafe: 0 };
    const fwd = clamp(move.forward || 0, -1, 1);
    const strafe = clamp(move.strafe || 0, -1, 1);
    const running = !!(input && typeof input.running === 'function' && input.running());
    const shooting = !!(input && typeof input.shooting === 'function' && input.shooting());

    if (acts & ACTION_MUTE) {
      if (audio && typeof audio.isMuted === 'function' && typeof audio.setMuted === 'function') {
        audio.setMuted(!audio.isMuted());
      }
    }
    if (acts & ACTION_HORN) call(audio, 'horn');

    if (acts & ACTION_ENTER_CAR) {
      if (p.onFoot) {
        tryEnterCar();
        events.enteredCar = !p.onFoot;
        if (events.enteredCar) events.stole = true;
      } else {
        exitCar();
      }
    }
    if (acts & ACTION_INTERACT) {
      missionEvent('interact', { x: p.x, z: p.z });
    }

    // --- On foot ------------------------------------------------------------
    if (p.onFoot) {
      const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
      // Camera-relative movement: W walks away from the camera.
      const mx = Math.sin(state.cameraYaw) * fwd + Math.cos(state.cameraYaw) * strafe;
      const mz = Math.cos(state.cameraYaw) * fwd - Math.sin(state.cameraYaw) * strafe;
      const len = Math.hypot(mx, mz);
      let movedDist = 0;
      if (len > 0.01) {
        const nx = mx / Math.max(1, len);
        const nz = mz / Math.max(1, len);
        p.angle = Math.atan2(nx, nz);
        const moved = moveWithCollision(city, p.x, p.z, nx * speed * dt, nz * speed * dt, PLAYER.radius);
        movedDist = Math.hypot(moved.x - p.x, moved.z - p.z);
        p.x = moved.x;
        p.z = moved.z;
        const c = clampToCity(city, p.x, p.z);
        p.x = c.x;
        p.z = c.z;
        p.speed = speed;
      } else {
        p.speed = 0;
      }
      state.stats.distance += movedDist;

      // Jump (Space, one-shot).
      if ((acts & ACTION_JUMP) && p.grounded) {
        p.vy = PLAYER.jumpSpeed;
        p.grounded = false;
      }
      if (!p.grounded) {
        p.vy -= PLAYER.gravity * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          p.grounded = true;
        }
      }

      // Combat: hold LMB to shoot (pistol) or punch (fists); R reloads.
      if (acts & ACTION_RELOAD) combat.reload();
      if (shooting) {
        if (combat.state.weapon === 'pistol' && combat.state.ammo <= 0 && combat.state.reserve > 0) {
          combat.reload();
        } else {
          lastAttack = combat.state.weapon === 'pistol' ? 'shoot' : 'punch';
          p.angle = state.cameraYaw;
          const res = combat.shoot(combatCtx());
          if (res && res.target) handleHit(res.target);
          if (res && res.targets) {
            for (const t of res.targets) handleHit(t);
          }
        }
      }
      call(audio, 'setEngine', 0, CAR.maxSpeed);
    } else if (p.car) {
      // --- Driving ----------------------------------------------------------
      if (acts & ACTION_JUMP) handbrakeTimer = 0.4;
      if (handbrakeTimer > 0) handbrakeTimer -= dt;
      const car = p.car;
      car.others = vehicles.traffic.cars
        .concat(vehicles.parkedCars.filter((c) => c !== car), police.policeCars);
      const speedBefore = car.speed;
      const res = vehicles.playerCarPhysics(car,
        { forward: fwd, strafe, handbrake: handbrakeTimer > 0 }, dt);
      p.x = car.x;
      p.z = car.z;
      p.angle = car.angle;
      p.speed = car.speed;
      state.stats.distance += Math.abs(car.speed) * dt;
      if (res.crashed && Math.abs(speedBefore) > 12) {
        damagePlayer(6, 'crash');
        car.health -= 8;
        if (car.health <= 0) car.disabled = true;
      }
      call(audio, 'setEngine', Math.abs(car.speed), CAR.maxSpeed);
    }

    // --- Subsystems -----------------------------------------------------------
    vehicles.update(dt, p.onFoot ? null : p.car, p.x, p.z);
    const peopleRes = people.update(dt, { player: p, wanted: police.state.stars, danger: null });
    // Wanted sync. The police own the stars; state.wanted is the mirror
    // the HUD / missions read. But missions.js also WRITES state.wanted
    // directly (heat-wave / big-score force 2-3 stars), so the world can
    // tell a mission's write apart from its own mirror: if state.wanted
    // differs from the last value the world mirrored, a mission changed
    // it and the police adopt it; otherwise the police keep their stars
    // and the mirror follows them. (Adopting state.wanted blindly would
    // clobber any direct police.addWanted / setWanted with a stale mirror.)
    if (state.wanted !== lastSyncedWanted) {
      police.setWanted(state.wanted);
    }
    const combatRes = combatCtx();
    combat.update(dt, combatRes);
    const policeEvents = police.update(dt,
      { x: p.x, z: p.z, angle: p.angle, speed: p.speed, onFoot: p.onFoot, car: p.car },
      { copTouching: peopleRes.copTouching, nearestCopDist: peopleRes.nearestCop });
    prevWanted = state.wanted;
    state.wanted = police.state.stars;
    lastSyncedWanted = state.wanted;
    if (prevWanted > 0 && state.wanted === 0) missionEvent('escape', {});
    if (policeEvents.rammed && ramCooldown <= 0) {
      ramCooldown = 1;
      damagePlayer(8, 'ram');
    }
    if (policeEvents.busted) {
      handleBust(policeEvents.busted);
      events.busted = true;
    }

    // Mission: Reef Kings at the pier for 'Pier Pressure'.
    if (state.missionId !== prevMissionId) {
      prevMissionId = state.missionId;
      if (state.missionId === 'pier-pressure' && !pierGangSpawned) {
        pierGangSpawned = true;
        const pier = spawnPoint('pier', { x: -416, z: 40 });
        people.spawnGang(pier.x, pier.z, 5);
      }
    }

    // Arrive / deliver: edge-triggered when the player reaches the marker.
    if (state.markers && state.markers.length > 0) {
      const m = state.markers[0];
      const key = `${m.x},${m.z},${m.kind}`;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < STEP_ARRIVE_RADIUS && lastMarkerKey !== key) {
        lastMarkerKey = key;
        missionEvent('arrive', { x: p.x, z: p.z });
        if (m.kind === 'dropoff') missionEvent('deliver', { kind: m.kind });
      } else if (d >= STEP_ARRIVE_RADIUS && lastMarkerKey === key) {
        lastMarkerKey = '';
      }
    }

    // Muzzle flash + ammo HUD sync.
    state.flashes = combat.state.flashTimer > 0
      ? [{ x: combat.state.flash.x, y: combat.state.flash.y, z: combat.state.flash.z }]
      : [];
    p.ammo = combat.state.weapon === 'pistol' ? combat.state.ammo : null;

    rebuildCarList();
    if (missions && typeof missions.update === 'function') missions.update(dt);
    return events;

    function combatCtx() {
      return {
        origin: { x: p.x, y: 1.5 + p.y, z: p.z },
        angle: state.cameraYaw,
        player: p,
        peds: people.peds,
        cops: people.cops,
        gang: people.gang,
        cars: state.cars,
        wanted: police.state.stars,
        onKill: handleKill,
        onHit: handleHit,
        onShoot: (origin) => people.fleeFrom(origin.x, origin.z, 30),
        onEnemyShoot: (origin) => people.fleeFrom(origin.x, origin.z, 25),
        onPlayerDamage: (amount, from) => damagePlayer(amount, from),
        onPickup: (kind) => {
          if (kind === 'health') {
            p.health = Math.min(PLAYER.health, p.health + 50);
            setMessage('Health +50.', 2);
          } else {
            combat.giveAmmo(24);
            setMessage('Ammo +24.', 2);
          }
        },
      };
    }
  }

  function setMissions(m) {
    missions = m || null;
  }

  reset();

  return {
    state, reset, step, respawn, snapshot, restoreSave, setMissions,
    get missions() {
      return missions;
    },
    vehicles, people, police, combat,
  };
}
