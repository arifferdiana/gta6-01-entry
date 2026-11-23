// SOLMARINA — people: pedestrians, foot cops and Reef Kings gang members.
// Original code and art for this game. No Rockstar / GTA names, art or assets.
//
// NOTE ON RENDERING: render.js owns every mesh it paints — it rebuilds
// figures from the plain state data (x, z, angle, speed) each frame. The
// three.js groups built here (buildPersonModel) are therefore NOT added to
// the scene by this module; they exist so a figure can be inspected / reused
// as a model, and the live simulation is the plain person objects below.
// That keeps one figure per person on screen instead of two.

import * as THREE from 'three';
import { PALETTE, TRAFFIC } from './config.js';

export const PED_COUNT = TRAFFIC.peds || 28;

/** How fast a fleeing pedestrian runs. */
const FLEE_SPEED = 5.2;

const SHIRT_COLORS = [0x4a90d9, 0x7bc47f, 0xe8b13d, 0xd97b9c, 0x8a6fc0, 0x5bc0be, 0xe07a3f, 0x9db38a];
const SKIN_TONES = [0xd9a077, 0xc98d5f, 0x8a5a3b, 0xf0c8a0];
const PANTS_COLORS = [0x2b3a55, 0x3d3d3d, 0x5a4a3a, 0x37474f];

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * Push a circle out of the city's building AABBs. city.collideCircle returns
 * the corrected position {x, z}; a move counts as a hit when it changed.
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

// --- Person models ---------------------------------------------------------

function part(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Build a low-poly box figure, feet at y = 0, about 1.9 tall. Limbs hang
 * from pivot groups at the hips / shoulders so animateWalk can swing them.
 * userData carries {kind, height, armL, armR, legL, legR}.
 * kinds: 'ped' (any shirt colour), 'cop' (navy + cap + badge),
 * 'gang' (dark clothes + red headband).
 */
export function buildPersonModel(shirtColor, kind = 'ped') {
  const skinTone = SKIN_TONES[(shirtColor >>> 4) % SKIN_TONES.length];
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: skinTone });
  const pants = new THREE.MeshLambertMaterial({
    color: kind === 'cop' ? 0x1a2436 : PANTS_COLORS[(shirtColor >>> 8) % PANTS_COLORS.length],
  });
  const hair = new THREE.MeshLambertMaterial({ color: 0x2b2118 });
  const figure = new THREE.Group();

  figure.add(part(0.72, 0.85, 0.4, shirt, 0, 1.15, 0));
  figure.add(part(0.42, 0.42, 0.42, skin, 0, 1.85, 0));
  figure.add(part(0.44, 0.16, 0.44, hair, 0, 2.1, 0));

  function limb(w, h, d, material, px, py) {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    pivot.add(part(w, h, d, material, 0, -h / 2, 0));
    figure.add(pivot);
    return pivot;
  }

  const legL = limb(0.26, 0.75, 0.3, pants, -0.18, 0.75);
  const legR = limb(0.26, 0.75, 0.3, pants, 0.18, 0.75);
  const armL = limb(0.2, 0.7, 0.24, shirt, -0.48, 1.5);
  const armR = limb(0.2, 0.7, 0.24, shirt, 0.48, 1.5);

  if (kind === 'cop') {
    // Cap brim + badge.
    figure.add(part(0.46, 0.1, 0.46,
      new THREE.MeshLambertMaterial({ color: 0x16264d }), 0, 2.08, 0));
    figure.add(part(0.12, 0.12, 0.03,
      new THREE.MeshBasicMaterial({ color: 0xffd94d }), -0.18, 1.35, 0.21));
  }
  if (kind === 'gang') {
    // Red headband.
    figure.add(part(0.44, 0.09, 0.44,
      new THREE.MeshLambertMaterial({ color: 0xc0392b }), 0, 1.98, 0));
  }
  figure.userData = { kind, height: 1.9, armL, armR, legL, legR };
  return figure;
}

/**
 * Swing a figure's limbs for walking. mesh is a buildPersonModel group,
 * speed01 is 0 (idle) to 1 (full stride). Deterministic: phase advances
 * with distance walked, not wall-clock time.
 */
export function animateWalk(mesh, dt, speed01) {
  const u = mesh.userData || {};
  if (!u.legL) return;
  const s = clamp(speed01, 0, 1);
  u.phase = (u.phase || 0) + dt * (2 + s * 7);
  const swing = s * 0.65;
  const t = u.phase;
  u.legL.rotation.x = Math.sin(t) * swing;
  u.legR.rotation.x = -Math.sin(t) * swing;
  u.armL.rotation.x = -Math.sin(t) * swing * 0.8;
  u.armR.rotation.x = Math.sin(t) * swing * 0.8;
}

// --- Pedestrians -----------------------------------------------------------

/**
 * ~26 pedestrians strolling the sidewalks. A ped:
 * { mesh, kind:'ped', x, z, angle, speed, walkSpeed, target, state,
 *   waitTimer, fleeTimer, fleeX, fleeZ, health, dead, walkPhase, reported }.
 * state is 'walk', 'wait' or 'flee'. update() takes an optional danger
 * point {x, z} (gunfire / crime) that makes nearby peds run away.
 */
export function createPedestrians(city, random) {
  const peds = [];

  function pickTarget() {
    if (city && typeof city.randomSidewalkPoint === 'function') {
      const p = city.randomSidewalkPoint(random);
      return { x: p.x, z: p.z };
    }
    return { x: (random() * 2 - 1) * 200, z: (random() * 2 - 1) * 200 };
  }

  function spawnPed(x, z) {
    const shirt = SHIRT_COLORS[Math.floor(random() * SHIRT_COLORS.length)];
    const mesh = buildPersonModel(shirt, 'ped');
    const ped = {
      mesh, kind: 'ped', x, z,
      angle: random() * Math.PI * 2,
      speed: 0,
      walkSpeed: (TRAFFIC.pedSpeed || 1.6) * (0.75 + random() * 0.5),
      target: pickTarget(),
      state: 'walk',
      waitTimer: random() * 2,
      fleeTimer: 0,
      fleeX: 0,
      fleeZ: 0,
      health: 100,
      dead: false,
      reported: false,
      walkPhase: random() * 6,
    };
    mesh.position.set(x, 0, z);
    mesh.rotation.y = ped.angle;
    peds.push(ped);
    return ped;
  }

  /** Spawn a ped who immediately runs away from (fromX, fromZ). */
  function spawnFleeingPed(x, z, fromX, fromZ) {
    const ped = spawnPed(x, z);
    ped.state = 'flee';
    ped.fleeTimer = 4 + random() * 2;
    ped.fleeX = fromX;
    ped.fleeZ = fromZ;
    return ped;
  }

  function fleeFrom(x, z, radius) {
    for (const ped of peds) {
      if (ped.dead || ped.state === 'flee') continue;
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.state = 'flee';
        ped.fleeTimer = 3 + random() * 2;
        ped.fleeX = x;
        ped.fleeZ = z;
      }
    }
  }

  function update(dt, danger) {
    for (const ped of peds) {
      if (ped.dead) continue;
      if (danger && ped.state !== 'flee'
        && Math.hypot(ped.x - danger.x, ped.z - danger.z) < 26) {
        ped.state = 'flee';
        ped.fleeTimer = 3 + random() * 2;
        ped.fleeX = danger.x;
        ped.fleeZ = danger.z;
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const dx = ped.x - ped.fleeX;
        const dz = ped.z - ped.fleeZ;
        const d = Math.hypot(dx, dz) || 1;
        ped.angle = Math.atan2(dx / d, dz / d);
        const moved = moveWithCollision(city, ped.x, ped.z,
          (dx / d) * FLEE_SPEED * dt, (dz / d) * FLEE_SPEED * dt, 0.5);
        ped.x = moved.x;
        ped.z = moved.z;
        ped.speed = FLEE_SPEED;
        if (ped.fleeTimer <= 0) {
          ped.state = 'walk';
          ped.target = pickTarget();
        }
      } else if (ped.state === 'wait') {
        ped.waitTimer -= dt;
        ped.speed = 0;
        if (ped.waitTimer <= 0) {
          ped.state = 'walk';
          ped.target = pickTarget();
        }
      } else {
        const dx = ped.target.x - ped.x;
        const dz = ped.target.z - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.5) {
          ped.state = 'wait';
          ped.waitTimer = random() * 3;
          ped.speed = 0;
        } else {
          ped.angle = Math.atan2(dx / d, dz / d);
          const moved = moveWithCollision(city, ped.x, ped.z,
            (dx / d) * ped.walkSpeed * dt, (dz / d) * ped.walkSpeed * dt, 0.5);
          ped.x = moved.x;
          ped.z = moved.z;
          ped.speed = ped.walkSpeed;
        }
      }
      if (city && typeof city.clampToCity === 'function') {
        const c = city.clampToCity(ped.x, ped.z);
        ped.x = c.x;
        ped.z = c.z;
      }
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.angle;
      animateWalk(ped.mesh, dt, ped.speed / 5.2);
    }
    // Drop the dead from the live list (the world reports the kill first).
    for (let i = peds.length - 1; i >= 0; i -= 1) {
      if (peds[i].dead) peds.splice(i, 1);
    }
  }

  function reset() {
    peds.length = 0;
    for (let i = 0; i < PED_COUNT; i += 1) {
      const p = city && typeof city.randomSidewalkPoint === 'function'
        ? city.randomSidewalkPoint(random)
        : { x: (random() * 2 - 1) * 200, z: (random() * 2 - 1) * 200 };
      spawnPed(p.x, p.z);
    }
  }

  reset();
  return { peds, update, fleeFrom, reset, spawnPed, spawnFleeingPed };
}

// --- Foot cops -------------------------------------------------------------

/**
 * Foot cops. A cop: { mesh, kind:'cop', x, z, angle, speed, walkSpeed,
 *   health, dead, onFoot:true, car:null, chaseTimer, reported }.
 * ensure(count, nearX, nearZ) keeps the roster at count, spawning on roads
 * near the player. update(dt, player, chasing) runs them at the player and
 * reports { touching, nearest } — touching means a cop is close enough to
 * start an arrest.
 */
export function createCops(city, random) {
  const cops = [];

  function spawnCop(x, z) {
    const mesh = buildPersonModel(PALETTE.cop || '#24407a', 'cop');
    const cop = {
      mesh, kind: 'cop', x, z, angle: 0, speed: 0,
      walkSpeed: 7.5, health: 100, dead: false,
      onFoot: true, car: null, chaseTimer: 0, reported: false,
    };
    mesh.position.set(x, 0, z);
    cops.push(cop);
    return cop;
  }

  function ensure(count, nearX, nearZ) {
    while (cops.length < count) {
      let best = null;
      let bestD = Infinity;
      for (let tries = 0; tries < 6; tries += 1) {
        const p = city && typeof city.randomRoadPoint === 'function'
          ? city.randomRoadPoint(random)
          : { x: nearX + (random() * 2 - 1) * 60, z: nearZ + (random() * 2 - 1) * 60 };
        const d = Math.abs(Math.hypot(p.x - nearX, p.z - nearZ) - 70);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      spawnCop(best.x, best.z);
    }
    while (cops.length > count) cops.pop();
  }

  function update(dt, player, chasing) {
    let touching = false;
    let nearest = Infinity;
    for (const cop of cops) {
      if (cop.dead) continue;
      const dx = player.x - cop.x;
      const dz = player.z - cop.z;
      const d = Math.hypot(dx, dz);
      nearest = Math.min(nearest, d);
      if (chasing) {
        cop.chaseTimer += dt;
        cop.angle = Math.atan2(dx, dz);
        const step = Math.min(d, cop.walkSpeed * dt);
        const moved = moveWithCollision(city, cop.x, cop.z,
          Math.sin(cop.angle) * step, Math.cos(cop.angle) * step, 0.5);
        cop.x = moved.x;
        cop.z = moved.z;
        cop.speed = cop.walkSpeed;
        // Only an on-foot player can be grabbed.
        if (player.onFoot && d < 1.7) touching = true;
      } else {
        cop.chaseTimer = 0;
        cop.speed = 0;
      }
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.angle;
      animateWalk(cop.mesh, dt, cop.speed / 5.2);
    }
    for (let i = cops.length - 1; i >= 0; i -= 1) {
      if (cops[i].dead) cops.splice(i, 1);
    }
    return { touching, nearest };
  }

  function reset() {
    cops.length = 0;
  }

  return { cops, update, ensure, reset, spawnCop };
}

// --- Bundle ----------------------------------------------------------------

/**
 * Owns pedestrians, foot cops and gang members for one city. audio is kept
 * for future voice / shout hooks; no sound is played from here.
 *
 * update(dt, ctx) with ctx { player {x, z, onFoot, speed}, wanted, danger }
 * returns { copTouching, nearestCop }. Gang members move toward the player
 * until they are in shooting range, then hold and face them; combat.js
 * decides when they actually fire.
 */
export function createPeople(city, random, audio) {
  const pedestrians = createPedestrians(city, random);
  const copManager = createCops(city, random);
  const gang = [];
  void audio;

  function spawnGang(x, z, count) {
    const made = [];
    for (let i = 0; i < count; i += 1) {
      const mesh = buildPersonModel(PALETTE.gang || '#7a2e8f', 'gang');
      const g = {
        mesh, kind: 'gang',
        x: x + (random() * 6 - 3), z: z + (random() * 6 - 3),
        angle: 0, speed: 0, walkSpeed: 3.6,
        health: 100, dead: false, reported: false,
        shootTimer: 1 + random(),
        walkPhase: random() * 6,
      };
      mesh.position.set(g.x, 0, g.z);
      gang.push(g);
      made.push(g);
    }
    return made;
  }

  function update(dt, ctx) {
    const player = ctx.player;
    pedestrians.update(dt, ctx.danger || null);
    const copRes = copManager.update(dt, player, (ctx.wanted || 0) >= 1);
    for (const g of gang) {
      if (g.dead) continue;
      const dx = player.x - g.x;
      const dz = player.z - g.z;
      const d = Math.hypot(dx, dz);
      g.angle = Math.atan2(dx, dz);
      if (d > 14) {
        const step = Math.min(d - 14, g.walkSpeed * dt);
        const moved = moveWithCollision(city, g.x, g.z,
          Math.sin(g.angle) * step, Math.cos(g.angle) * step, 0.5);
        g.x = moved.x;
        g.z = moved.z;
        g.speed = g.walkSpeed;
      } else {
        g.speed = 0;
      }
      g.mesh.position.set(g.x, 0, g.z);
      g.mesh.rotation.y = g.angle;
      animateWalk(g.mesh, dt, g.speed / 5.2);
    }
    for (let i = gang.length - 1; i >= 0; i -= 1) {
      if (gang[i].dead) gang.splice(i, 1);
    }
    return { copTouching: copRes.touching, nearestCop: copRes.nearest };
  }

  function reset() {
    pedestrians.reset();
    copManager.reset();
    gang.length = 0;
  }

  return {
    peds: pedestrians.peds,
    cops: copManager.cops,
    gang,
    pedestrians,
    copManager,
    update,
    spawnGang,
    spawnPed: pedestrians.spawnPed,
    spawnCop: copManager.spawnCop,
    ensureCops: copManager.ensure,
    fleeFrom: pedestrians.fleeFrom,
    spawnFleeingPed: pedestrians.spawnFleeingPed,
    reset,
  };
}
