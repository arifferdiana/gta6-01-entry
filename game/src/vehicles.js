// SOLMARINA — vehicles: car models, street traffic, parked cars, driving.
// Original code and art for this game. No Rockstar / GTA names, art or assets.
//
// render.js owns every mesh it paints: it rebuilds cars from the plain
// state data (x, z, angle, color, model) each frame. The three.js groups
// built by buildCarModel are therefore NOT added to the scene here; they
// exist so a car can be inspected or reused as a model. The live simulation
// is the plain car objects below, which keeps one car per car on screen.

import * as THREE from 'three';
import { CAR, CITY, TRAFFIC } from './config.js';

export const CAR_KINDS = ['sedan', 'taxi', 'sports', 'van', 'police', 'truck'];

/** Per-kind tuning. Sedan and sports read their top speeds from CAR. */
export const CAR_STATS = {
  sedan: { length: 4.4, width: 1.9, bodyH: 0.62, topSpeed: CAR.maxSpeed, accel: CAR.accel, color: 0x3a7bd5 },
  taxi: { length: 4.4, width: 1.9, bodyH: 0.62, topSpeed: 40, accel: CAR.accel, color: 0xf2c94c },
  sports: { length: 4.3, width: 2.0, bodyH: 0.5, topSpeed: CAR.sportMaxSpeed, accel: 26, color: 0xd43d2a },
  van: { length: 5.1, width: 2.1, bodyH: 1.05, topSpeed: 32, accel: 16, color: 0x8b93a3 },
  police: { length: 4.5, width: 1.95, bodyH: 0.62, topSpeed: 46, accel: 24, color: 0x1c2733 },
  truck: { length: 6.6, width: 2.4, bodyH: 0.9, topSpeed: 28, accel: 14, color: 0x4a7a4f },
};

export const TRAFFIC_COLORS = [
  0x3a7bd5, 0xd43d2a, 0x4a7a4f, 0xf2c94c, 0x8e44ad,
  0xe67e22, 0x16a085, 0xecf0f1, 0x2c3e50, 0xc0c8d0,
];

const TRAFFIC_COUNT = TRAFFIC.cars || 14;
const PARKED_COUNT = 10;
/** How far right of a road centre line a lane sits (right-hand traffic). */
const LANE_OFFSET = 3;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

/** Interior road centre lines: -216, -144, ..., 216 across the grid. */
function roadLines() {
  const lines = [];
  for (let p = -CITY.half + CITY.pitch; p < CITY.half - 1; p += CITY.pitch) lines.push(p);
  return lines;
}

/** Read a -1..1 axis from a plain input object, or from input.move(). */
function readAxis(input, names, fallback) {
  if (!input) return fallback;
  for (const name of names) {
    const v = input[name];
    if (typeof v === 'number' && Number.isFinite(v)) return clamp(v, -1, 1);
  }
  if (typeof input.move === 'function') {
    const m = input.move();
    if (m) {
      if (names.includes('forward') && typeof m.forward === 'number') return clamp(m.forward, -1, 1);
      if (names.includes('strafe') && typeof m.strafe === 'number') return clamp(m.strafe, -1, 1);
    }
  }
  if (input.axes) {
    for (const name of names) {
      const v = input.axes[name];
      if (typeof v === 'number' && Number.isFinite(v)) return clamp(v, -1, 1);
    }
  }
  if (names.includes('strafe') && typeof input.direction === 'function') return input.direction();
  return fallback;
}

function readBool(input, names, fallback) {
  if (!input) return fallback;
  for (const name of names) {
    if (typeof input[name] === 'boolean') return input[name];
  }
  return fallback;
}

/**
 * Push a circle out of the city's building AABBs, axis by axis so a car
 * slides along a wall instead of sticking to it. city.collideCircle returns
 * the corrected position {x, z}; the move counts as a hit when it changed.
 */
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

// --- Car models ------------------------------------------------------------

function part(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function makeWheel(tyreMat, hubMat, x, y, z) {
  const tyreGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14);
  tyreGeo.rotateZ(Math.PI / 2);
  const wheel = new THREE.Mesh(tyreGeo, tyreMat);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10);
  hubGeo.rotateZ(Math.PI / 2);
  wheel.add(new THREE.Mesh(hubGeo, hubMat));
  wheel.position.set(x, y, z);
  return wheel;
}

/**
 * Build a low-poly car from three.js boxes. Model forward is +z, wheels
 * touch y = 0. userData carries {kind, length, width, wheels} so the
 * simulation can spin the wheels.
 */
export function buildCarModel(color, kind = 'sedan') {
  const spec = CAR_STATS[kind] || CAR_STATS.sedan;
  const paint = new THREE.MeshStandardMaterial({
    color: color ?? spec.color, roughness: 0.35, metalness: 0.5,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.12, metalness: 0.7 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.8 });
  const headlight = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  const taillight = new THREE.MeshBasicMaterial({ color: 0xd43d2a });
  const group = new THREE.Group();
  const L = spec.length;
  const W = spec.width;
  const H = spec.bodyH;
  const bodyY = 0.34 + H / 2;

  // Main body slab, plus dark bumpers at both ends.
  group.add(part(W, H, L, paint, 0, bodyY, 0));
  group.add(part(W * 0.98, 0.16, 0.18, tyre, 0, 0.42, L / 2));
  group.add(part(W * 0.98, 0.16, 0.18, tyre, 0, 0.42, -L / 2));

  if (kind === 'truck') {
    // Cab up front, tall cargo box behind it.
    group.add(part(W * 0.94, 0.85, L * 0.26, paint, 0, bodyY + H / 2 + 0.42, L * 0.36));
    group.add(part(W * 0.8, 0.5, 0.08, glass, 0, bodyY + H / 2 + 0.5, L * 0.5));
    group.add(part(W * 0.96, 1.15, L * 0.58,
      new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.6, metalness: 0.4 }),
      0, bodyY + H / 2 + 0.55, -L * 0.2));
  } else if (kind === 'van') {
    // One tall box body with a windscreen and side windows.
    group.add(part(W * 0.94, 0.95, L * 0.72, paint, 0, bodyY + H / 2 + 0.47, -L * 0.08));
    group.add(part(W * 0.8, 0.55, 0.08, glass, 0, bodyY + H / 2 + 0.62, L * 0.3));
    group.add(part(0.08, 0.5, L * 0.5, glass, W * 0.47, bodyY + H / 2 + 0.55, -L * 0.08));
    group.add(part(0.08, 0.5, L * 0.5, glass, -W * 0.47, bodyY + H / 2 + 0.55, -L * 0.08));
  } else {
    // Cabin glass plus a roof panel over it.
    group.add(part(W * 0.8, 0.52, L * 0.46, glass, 0, bodyY + H / 2 + 0.26, -L * 0.04));
    group.add(part(W * 0.84, 0.09, L * 0.5, paint, 0, bodyY + H / 2 + 0.56, -L * 0.04));
  }

  // Headlights and taillights.
  group.add(part(0.36, 0.13, 0.07, headlight, -W * 0.3, bodyY + 0.05, L / 2 + 0.01));
  group.add(part(0.36, 0.13, 0.07, headlight, W * 0.3, bodyY + 0.05, L / 2 + 0.01));
  group.add(part(0.36, 0.13, 0.07, taillight, -W * 0.3, bodyY + 0.05, -L / 2 - 0.01));
  group.add(part(0.36, 0.13, 0.07, taillight, W * 0.3, bodyY + 0.05, -L / 2 - 0.01));

  if (kind === 'taxi') {
    // Roof sign.
    group.add(part(0.72, 0.16, 0.3,
      new THREE.MeshStandardMaterial({ color: 0xfff6c9, roughness: 0.4 }),
      0, bodyY + H / 2 + 0.68, -L * 0.04));
  }
  if (kind === 'police') {
    // White roof panel and a red/blue light bar.
    group.add(part(W * 0.86, 0.1, L * 0.52,
      new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4 }),
      0, bodyY + H / 2 + 0.6, -L * 0.04));
    group.add(part(0.5, 0.12, 0.3, new THREE.MeshBasicMaterial({ color: 0xe0392c }),
      -0.26, bodyY + H / 2 + 0.72, -L * 0.04));
    group.add(part(0.5, 0.12, 0.3, new THREE.MeshBasicMaterial({ color: 0x2f6fe0 }),
      0.26, bodyY + H / 2 + 0.72, -L * 0.04));
  }

  const wheels = [];
  const wz = L / 2 - 0.85;
  const wx = W / 2 - 0.06;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = makeWheel(tyre, hub, sx * wx, 0.34, sz * wz);
      group.add(wheel);
      wheels.push(wheel);
    }
  }
  group.userData = { kind, length: L, width: W, wheels };
  return group;
}

// --- Traffic ---------------------------------------------------------------

/**
 * Traffic manager: a fixed pool of cars driving the road grid on right-hand
 * lanes. Cars slow for the car ahead, sometimes pause at intersections,
 * brake for the player's car, and despawn / respawn near the player so the
 * streets around them always feel busy.
 *
 * A traffic car: { mesh, kind, model, color, axis, dir, lane, pos,
 *   x, z, angle, speed, targetSpeed, stopTimer, disabled }.
 * Forward is (sin(angle), cos(angle)): angle 0 is +z, PI/2 is +x.
 */
export function createTraffic(city, random) {
  const cars = [];
  const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'sports', 'van', 'van', 'truck'];

  function placeOnRoad(car) {
    car.x = car.axis === 'x' ? car.pos : car.lane;
    car.z = car.axis === 'x' ? car.lane : car.pos;
    car.angle = car.axis === 'x'
      ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (car.dir > 0 ? 0 : Math.PI);
    if (car.mesh) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.angle;
    }
  }

  /** (Re)spawn a car on a road lane. nearPlayer keeps traffic around the action. */
  function spawnCar(car, nearPlayer) {
    const lines = roadLines();
    car.axis = random() < 0.5 ? 'x' : 'z';
    car.dir = random() < 0.5 ? 1 : -1;
    const line = lines[Math.floor(random() * lines.length)];
    car.lane = line + (car.dir > 0 ? LANE_OFFSET : -LANE_OFFSET);
    const half = CITY.half;
    if (nearPlayer && car.playerX !== undefined) {
      const along = car.axis === 'x' ? car.playerX : car.playerZ;
      car.pos = clamp(along + (random() * 2 - 1) * (TRAFFIC.spawnRadius || 220), -half + 12, half - 12);
    } else {
      car.pos = (random() * 2 - 1) * (half - 24);
    }
    car.kind = kinds[Math.floor(random() * kinds.length)];
    car.model = car.kind === 'sports' ? 'sport' : car.kind;
    car.color = TRAFFIC_COLORS[Math.floor(random() * TRAFFIC_COLORS.length)];
    car.speed = 6 + random() * 6;
    car.targetSpeed = (TRAFFIC.cruiseSpeed || 9) + (random() * 4 - 1);
    car.stopTimer = 0;
    car.disabled = false;
    if (!car.mesh || car.mesh.userData.kind !== car.kind || car.mesh.userData.color !== car.color) {
      car.mesh = buildCarModel(car.color, car.kind);
      car.mesh.userData.color = car.color;
    }
    placeOnRoad(car);
  }

  function crossingAhead(car) {
    if (!city || typeof city.isRoad !== 'function') return false;
    const ahead = car.pos + car.dir * 9;
    const px = car.axis === 'x' ? ahead : car.lane + 9;
    const pz = car.axis === 'x' ? car.lane + 9 : ahead;
    return city.isRoad(px, pz);
  }

  function update(dt, playerCar, playerX, playerZ) {
    const half = CITY.half;
    for (const car of cars) {
      car.playerX = playerX;
      car.playerZ = playerZ;
      let want = car.disabled ? 0 : car.targetSpeed;
      if (!car.disabled) {
        // Car ahead in the same lane: match its speed, or stop if close.
        for (const other of cars) {
          if (other === car || other.axis !== car.axis || other.dir !== car.dir) continue;
          if (Math.abs(other.lane - car.lane) > 1.5) continue;
          const gap = (other.pos - car.pos) * car.dir;
          if (gap > 0 && gap < 12) want = Math.min(want, gap < 5 ? 0 : Math.max(0, other.speed - 1));
        }
        // The player's car ahead in the same lane.
        if (playerCar) {
          const along = car.axis === 'x' ? playerCar.x : playerCar.z;
          const lane = car.axis === 'x' ? playerCar.z : playerCar.x;
          if (Math.abs(lane - car.lane) < 2.5) {
            const gap = (along - car.pos) * car.dir;
            if (gap > 0 && gap < 12) want = Math.min(want, gap < 5 ? 0 : 3);
          }
        }
        // Sometimes pause at an intersection.
        if (car.stopTimer > 0) {
          car.stopTimer -= dt;
          want = 0;
        } else if (crossingAhead(car) && random() < 0.004) {
          car.stopTimer = 0.8 + random() * 2.2;
          want = 0;
        }
      }
      if (car.speed < want) car.speed = Math.min(want, car.speed + 7 * dt);
      else car.speed = Math.max(want, car.speed - 14 * dt);
      car.pos += car.dir * car.speed * dt;
      // Too far from the player (or past the edge): respawn near the player.
      const dx = playerX === undefined ? 0 : car.x - playerX;
      const dz = playerZ === undefined ? 0 : car.z - playerZ;
      const far = playerX !== undefined && Math.hypot(dx, dz) > (TRAFFIC.despawnRadius || 260);
      if (Math.abs(car.pos) > half - 8 || far) {
        spawnCar(car, playerX !== undefined);
      } else {
        placeOnRoad(car);
        const spin = (car.speed * dt) / 0.34;
        for (const wheel of car.mesh.userData.wheels || []) wheel.rotation.x += spin;
      }
    }
  }

  function nearest(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of cars) {
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  function reset() {
    for (const car of cars) spawnCar(car, false);
  }

  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const car = { mesh: null };
    spawnCar(car, false);
    cars.push(car);
  }

  return { cars, update, reset, nearest, spawnCar };
}

// --- Parked cars -----------------------------------------------------------

/**
 * Cars parked at the kerb that the player can take. A car:
 * { mesh, kind, model, color, x, z, angle, speed, parked, occupied,
 *   health, disabled }. Occupied cars have a driver who flees when stolen.
 */
export function spawnParkedCars(city, random, count = PARKED_COUNT) {
  const parked = [];
  const lines = roadLines();
  const kinds = ['sedan', 'sedan', 'taxi', 'sports', 'van', 'sports'];
  for (let i = 0; i < count; i += 1) {
    const axis = random() < 0.5 ? 'x' : 'z';
    const line = lines[Math.floor(random() * lines.length)];
    const side = random() < 0.5 ? 1 : -1;
    const curb = line + side * (CITY.road / 2 + 1.6);
    const along = (random() * 2 - 1) * (CITY.half - 30);
    const kind = kinds[Math.floor(random() * kinds.length)];
    const color = TRAFFIC_COLORS[Math.floor(random() * TRAFFIC_COLORS.length)];
    const mesh = buildCarModel(color, kind);
    const angle = axis === 'x'
      ? (side > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (side > 0 ? 0 : Math.PI);
    const x = axis === 'x' ? along : curb;
    const z = axis === 'x' ? curb : along;
    mesh.position.set(x, 0, z);
    mesh.rotation.y = angle;
    parked.push({
      mesh, kind, model: kind === 'sports' ? 'sport' : kind, color,
      x, z, angle, speed: 0, parked: true, occupied: random() < 0.3,
      health: 100, disabled: false,
    });
  }
  // The starter car: one guaranteed parked car on the kerb just SOUTH of
  // the player's spawn, so the first mission ("Get in a car") is always
  // completable without hunting the whole city. South is the way the
  // player spawns facing (angle 0), so W walks straight at it. The kerb
  // offset matches the generator's own (road/2 + 1.6), so it sits on the
  // same clear strip as every other parked car.
  {
    const color = 0xe8b13d;
    const mesh = buildCarModel(color, 'sedan');
    mesh.position.set(7.6, 0, 112);
    mesh.rotation.y = 0;
    parked.push({
      mesh, kind: 'sedan', model: 'sedan', color,
      x: 7.6, z: 112, angle: 0, speed: 0, parked: true, occupied: false,
      health: 100, disabled: false,
    });
  }
  return parked;
}

// --- Player driving --------------------------------------------------------

/**
 * Arcade driving for the player's car. input is the world-normalised drive
 * input { forward (-1..1), strafe (-1..1), handbrake (bool) }; a raw input
 * object with move()/axis() also works. Buildings stop the car through
 * city.collideCircle, other cars (car.others) bump it, and the city edge
 * clamps it. Returns { crashed, speed, drifting }.
 */
export function playerCarPhysics(car, input, dt, cityArg) {
  const city = cityArg || car.city || null;
  const spec = CAR_STATS[car.kind] || CAR_STATS.sedan;
  const mesh = car.mesh || null;
  const fwd = readAxis(input, ['forward', 'moveY', 'throttle'], 0);
  const steer = readAxis(input, ['strafe', 'moveX', 'steer'], 0);
  const handbrake = readBool(input, ['handbrake', 'jumpHeld', 'spaceHeld', 'jump'], false);
  const maxSpeed = car.disabled ? 0 : spec.topSpeed;
  const speedBefore = car.speed;

  if (handbrake) {
    car.speed = approach(car.speed, 0, 22 * dt);
    car.drifting = Math.abs(car.speed) > 4;
  } else if (fwd > 0.1) {
    car.speed = Math.min(maxSpeed, car.speed + spec.accel * fwd * dt);
    car.drifting = false;
  } else if (fwd < -0.1) {
    if (car.speed > 0.5) car.speed = Math.max(0, car.speed - CAR.brake * dt);
    else car.speed = Math.max(-CAR.maxReverse, car.speed + CAR.reverseAccel * fwd * dt);
    car.drifting = false;
  } else {
    car.speed = approach(car.speed, 0, 5 * dt);
    car.drifting = false;
  }
  if (car.disabled) car.speed = approach(car.speed, 0, 10 * dt);

  const speed01 = Math.min(Math.abs(car.speed) / Math.max(1, maxSpeed), 1);
  const turnBoost = handbrake ? CAR.handbrakeTurn / CAR.turnRate : 1;
  const turnRate = steer * (CAR.turnRate - speed01 * 0.9) * turnBoost;
  const moving = Math.min(Math.abs(car.speed) / 6, 1);
  car.angle += turnRate * moving * (car.speed < 0 ? -1 : 1) * dt;
  if (handbrake && Math.abs(car.speed) > 3) car.speed *= (1 - 0.3 * dt);

  const stepX = Math.sin(car.angle) * car.speed * dt;
  const stepZ = Math.cos(car.angle) * car.speed * dt;
  const moved = moveWithCollision(city, car.x, car.z, stepX, stepZ, CAR.radius);
  const crashed = moved.hit && Math.abs(speedBefore) > 3;
  if (moved.hit) car.speed *= 0.45;
  car.x = moved.x;
  car.z = moved.z;
  if (city && typeof city.clampToCity === 'function') {
    const c = city.clampToCity(car.x, car.z);
    if (c && typeof c.x === 'number' && typeof c.z === 'number') {
      car.x = c.x;
      car.z = c.z;
    }
  }

  // Bump other cars (traffic, parked, police) instead of passing through
  // them. Both cars are shoved apart so the overlap actually clears, and
  // the speed cut is rate-limited — otherwise a car parked bumper-to-bumper
  // with another would cut the player's speed every single frame.
  car.bumpCooldown = Math.max(0, (car.bumpCooldown || 0) - dt);
  if (car.others) {
    for (const other of car.others) {
      if (!other || other === car || other.disabled) continue;
      const dx = car.x - other.x;
      const dz = car.z - other.z;
      const d2 = dx * dx + dz * dz;
      const min = 2.6;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        car.x += ux * push;
        car.z += uz * push;
        if (other.axis) {
          // Traffic car: shove it along its lane so it stays on the road.
          other.pos += (other.axis === 'x' ? -ux : -uz) * push;
        } else {
          other.x -= ux * push;
          other.z -= uz * push;
        }
        if (car.bumpCooldown <= 0) {
          car.speed *= 0.6;
          car.bumpCooldown = 0.5;
        }
      }
    }
  }

  if (mesh) {
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.angle;
    const spin = (car.speed * dt) / 0.34;
    for (const wheel of mesh.userData.wheels || []) wheel.rotation.x += spin;
  }
  return { crashed, speed: car.speed, drifting: !!car.drifting };
}

// --- Bundle ----------------------------------------------------------------

/**
 * Owns the traffic pool and the parked cars for one city. audio is kept for
 * future engine/horn hooks; driving sound is driven by the world instead.
 */
export function createVehicles(city, random, audio) {
  const traffic = createTraffic(city, random);
  let parkedCars = spawnParkedCars(city, random, PARKED_COUNT);
  void audio;

  function reset() {
    traffic.reset();
    parkedCars = spawnParkedCars(city, random, PARKED_COUNT);
  }

  return {
    traffic,
    get parkedCars() {
      return parkedCars;
    },
    buildCarModel,
    playerCarPhysics: (car, input, dt) => playerCarPhysics(car, input, dt, city),
    spawnParkedCars: (n) => spawnParkedCars(city, random, n),
    /** Nearest parked car to (x, z) within maxDist, or null. */
    nearestParked(x, z, maxDist) {
      let best = null;
      let bestD = maxDist;
      for (const car of parkedCars) {
        const d = Math.hypot(car.x - x, car.z - z);
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      return best;
    },
    update(dt, playerCar, playerX, playerZ) {
      traffic.update(dt, playerCar, playerX, playerZ);
    },
    reset,
  };
}
