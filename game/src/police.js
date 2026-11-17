// SOLMARINA — police: the wanted system, pursuit cars and roadblocks.
// Original code for this game. No Rockstar / GTA names, art or assets.
//
// Wanted level 0-5 stars. Crimes raise it (addWanted), the heat decays one
// star at a time after the player stays out of every cop's sight for
// POLICE.decaySeconds, and a bust happens when a foot cop holds the player
// for 1.5 s or a police car pins the player's car for 3 s.
//
// NOTE ON RENDERING: render.js owns every mesh it paints — it rebuilds cars
// from the plain state data (x, z, angle, color, model) each frame. The
// three.js groups built here are therefore NOT added to the scene; the live
// simulation is the plain police-car objects, which the world merges into
// state.cars so render.js can draw them with flashing light bars.

import { POLICE, WANTED_MAX } from './config.js';
import { buildCarModel } from './vehicles.js';

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

/** Push a circle out of the city's building AABBs (axis-separated, slides). */
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

function call(audio, name, ...args) {
  if (audio && typeof audio[name] === 'function') audio[name](...args);
}

/**
 * createPolice(city, random, audio)
 *
 * state: { stars, heat, bustTimer, pinTimer, unseenTimer }.
 *   stars     0-5 wanted level (the HUD reads world.state.wanted, mirrored).
 *   heat      0-100, rises with crimes, falls as stars decay.
 *   bustTimer seconds a foot cop has held the on-foot player (1.5 = bust).
 *   pinTimer  seconds a police car has pinned the player's car (3 = bust).
 *   unseenTimer seconds since any cop last saw the player.
 *
 * policeCars: plain car objects { mesh, kind:'police', model:'police',
 *   color, x, z, angle, speed, mode:'chase'|'block'|'leave',
 *   health, disabled, parked, occupied }.
 */
export function createPolice(city, random, audio) {
  const state = { stars: 0, heat: 0, bustTimer: 0, pinTimer: 0, unseenTimer: 0 };
  const policeCars = [];
  let sirenOn = false;
  let roadblockTimer = 0;

  function setSiren(on) {
    if (on === sirenOn) return;
    sirenOn = on;
    call(audio, 'setSiren', on);
  }

  function addWanted(n, reason) {
    if (!n) return state.stars;
    state.stars = clamp(state.stars + n, 0, WANTED_MAX);
    state.heat = clamp(state.heat + n * 25, 0, 100);
    state.unseenTimer = 0;
    void reason;
    return state.stars;
  }

  function setWanted(n) {
    state.stars = clamp(n, 0, WANTED_MAX);
    state.heat = Math.max(state.heat, state.stars * 20);
    if (state.stars === 0) state.unseenTimer = 0;
    return state.stars;
  }

  function spawnPoliceCar(x, z) {
    const mesh = buildCarModel(0x1c2733, 'police');
    const car = {
      mesh, kind: 'police', model: 'police', color: 0x1c2733,
      x, z, angle: 0, speed: 10, mode: 'chase',
      health: 100, disabled: false, parked: false, occupied: false,
    };
    mesh.position.set(x, 0, z);
    policeCars.push(car);
    return car;
  }

  /** Spawn a pursuit car on a road near the player (roughly 40-130 m away). */
  function spawnNearPlayer(player) {
    let best = null;
    let bestScore = Infinity;
    for (let tries = 0; tries < 8; tries += 1) {
      const p = city && typeof city.randomRoadPoint === 'function'
        ? city.randomRoadPoint(random)
        : { x: player.x + (random() * 2 - 1) * 90, z: player.z + (random() * 2 - 1) * 90 };
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      const score = Math.abs(d - 80);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return spawnPoliceCar(best.x, best.z);
  }

  /** Two cars parked across the road ahead of the player, at 3+ stars. */
  function placeRoadblock(player) {
    const aheadX = player.x + Math.sin(player.angle || 0) * 45;
    const aheadZ = player.z + Math.cos(player.angle || 0) * 45;
    const point = city && typeof city.nearestRoadPoint === 'function'
      ? city.nearestRoadPoint(aheadX, aheadZ)
      : { x: aheadX, z: aheadZ };
    const roadAngle = Math.abs(point.x - aheadX) < Math.abs(point.z - aheadZ)
      ? Math.PI / 2
      : 0;
    let placed = 0;
    for (const car of policeCars) {
      if (car.mode !== 'block') continue;
      const side = placed === 0 ? -3 : 3;
      car.x = point.x + Math.cos(roadAngle) * side;
      car.z = point.z + Math.sin(roadAngle) * side;
      car.angle = roadAngle;
      car.speed = 0;
      if (car.mesh) {
        car.mesh.position.set(car.x, 0, car.z);
        car.mesh.rotation.y = car.angle;
      }
      placed += 1;
    }
  }

  function ensureCars(player, dt) {
    const wantChase = Math.min(state.stars, POLICE.cars || 4);
    const wantBlock = state.stars >= 3 ? 2 : 0;
    let chase = 0;
    let block = 0;
    for (const car of policeCars) {
      if (car.mode === 'block') block += 1;
      else if (car.mode === 'chase') chase += 1;
    }
    while (chase < wantChase) {
      spawnNearPlayer(player);
      chase += 1;
    }
    while (block < wantBlock) {
      const car = spawnNearPlayer(player);
      car.mode = 'block';
      car.speed = 0;
      block += 1;
    }
    // Too many: send the farthest ones away instead of deleting them.
    const active = policeCars.filter((c) => c.mode !== 'leave');
    const keep = wantChase + wantBlock;
    if (active.length > keep) {
      active.sort((a, b) =>
        Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z));
      for (let i = keep; i < active.length; i += 1) active[i].mode = 'leave';
    }
    if (wantBlock > 0) {
      roadblockTimer -= dt;
      if (roadblockTimer <= 0) {
        placeRoadblock(player);
        roadblockTimer = 6;
      }
    }
  }

  /**
   * One step. player: { x, z, angle, speed, onFoot, car }.
   * info: { copTouching (a foot cop is holding the player),
   *   nearestCopDist }. The wanted level itself is owned here and mirrored
   * to the world by the caller — missions force it by writing the world's
   * state.wanted, which the world adopts via setWanted before calling this.
   * Returns { busted: null | 'arrest' | 'pinned', rammed: bool,
   *   nearestDist }.
   */
  function update(dt, player, info) {
    const events = { busted: null, rammed: false, nearestDist: Infinity };

    if (state.stars > 0) {
      setSiren(true);
      ensureCars(player, dt);
    } else {
      setSiren(false);
      for (const car of policeCars) {
        if (car.mode !== 'leave') car.mode = 'leave';
      }
    }

    const chaseSpeed = Math.min(POLICE.chaseSpeed || 30, 16 + state.stars * 3);
    for (let i = policeCars.length - 1; i >= 0; i -= 1) {
      const car = policeCars[i];
      const dx = player.x - car.x;
      const dz = player.z - car.z;
      const d = Math.hypot(dx, dz);
      events.nearestDist = Math.min(events.nearestDist, d);

      if (car.mode === 'leave') {
        // Drive away from the player, then disappear off the map.
        car.angle = angleLerp(car.angle, Math.atan2(-dx, -dz), 2 * dt);
        car.speed = Math.min(POLICE.cruiseSpeed || 13, car.speed + 8 * dt);
        const moved = moveWithCollision(city, car.x, car.z,
          Math.sin(car.angle) * car.speed * dt, Math.cos(car.angle) * car.speed * dt, 1.6);
        car.x = moved.x;
        car.z = moved.z;
        if (d > 170) policeCars.splice(i, 1);
      } else if (car.mode === 'block') {
        car.speed = 0;
        // A roadblock car still counts as a pin if it traps the player car.
        if (!player.onFoot && d < 4 && Math.abs(player.speed || 0) < 1.5) {
          state.pinTimer += dt;
        }
      } else {
        // Chase: steer at the player, faster with more stars.
        const wantAngle = Math.atan2(dx, dz);
        car.angle = angleLerp(car.angle, wantAngle, 2.4 * dt);
        const target = player.onFoot ? chaseSpeed * 0.55 : chaseSpeed;
        car.speed = Math.min(target, car.speed + 10 * dt);
        const moved = moveWithCollision(city, car.x, car.z,
          Math.sin(car.angle) * car.speed * dt, Math.cos(car.angle) * car.speed * dt, 1.6);
        car.x = moved.x;
        car.z = moved.z;
        if (city && typeof city.clampToCity === 'function') {
          const c = city.clampToCity(car.x, car.z);
          car.x = c.x;
          car.z = c.z;
        }
        if (!player.onFoot && d < 5) {
          // Ram: shove the player's car and slow it.
          events.rammed = true;
          if (player.car) player.car.speed *= 0.94;
          if (d < 3.5 && Math.abs(player.speed || 0) < 1.5) {
            state.pinTimer += dt;
          }
        }
      }
      if (car.mesh) {
        car.mesh.position.set(car.x, 0, car.z);
        car.mesh.rotation.y = car.angle;
      }
    }

    // Pin bust: a police car holding the player's car still for 3 s.
    const pinning = policeCars.some((c) => c.mode !== 'leave')
      && !player.onFoot
      && events.nearestDist < 4
      && Math.abs(player.speed || 0) < 1.5;
    if (!pinning) state.pinTimer = Math.max(0, state.pinTimer - dt);
    if (state.pinTimer >= 3) {
      events.busted = 'pinned';
      state.pinTimer = 0;
    }

    // Arrest bust: a foot cop holding the on-foot player for 1.5 s.
    if (info && info.copTouching && player.onFoot) {
      state.bustTimer += dt;
    } else {
      state.bustTimer = Math.max(0, state.bustTimer - dt * 2);
    }
    if (state.bustTimer >= 1.5) {
      events.busted = 'arrest';
      state.bustTimer = 0;
    }

    // Decay: out of every cop's sight for POLICE.decaySeconds loses a star.
    const nearestCop = info && typeof info.nearestCopDist === 'number'
      ? Math.min(events.nearestDist, info.nearestCopDist)
      : events.nearestDist;
    if (state.stars > 0) {
      if (nearestCop > 45) state.unseenTimer += dt;
      else state.unseenTimer = 0;
      if (state.unseenTimer >= (POLICE.decaySeconds || 25)) {
        state.stars -= 1;
        state.heat = Math.max(0, state.heat - 25);
        state.unseenTimer = 0;
      }
    }
    return events;
  }

  function reset() {
    state.stars = 0;
    state.heat = 0;
    state.bustTimer = 0;
    state.pinTimer = 0;
    state.unseenTimer = 0;
    policeCars.length = 0;
    roadblockTimer = 0;
    setSiren(false);
  }

  return {
    state, policeCars,
    addWanted, setWanted, update, reset,
  };
}
