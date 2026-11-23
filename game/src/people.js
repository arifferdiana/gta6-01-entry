// SOLMARINA — pedestrians.
// People walk the sidewalks, cross at corners, and run when shots ring
// out. They are simple figures: a body, a head, and two swinging legs.

import * as THREE from 'three';
import { CONFIG, clamp, dist2d } from './config.js';
import { streetLines } from './city.js';

const SHIRT_COLORS = [0xd85a5a, 0x5a8ad8, 0x5ad88a, 0xd8c25a, 0xb05ad8, 0x5ad8c2, 0xe8e8e8, 0x3a3a3a];
const SKIN_COLORS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0];

/** Build one pedestrian's mesh. */
function makePersonMesh(rng) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: rng.pick(SHIRT_COLORS), roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: rng.pick(SKIN_COLORS), roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: rng.pick([0x2e3a4a, 0x3a2e2e, 0x2e2e2e]), roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 8), shirt);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), pants);
  legL.position.set(-0.13, 0.35, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), pants);
  legR.position.set(0.13, 0.35, 0);
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), shirt);
  armL.position.set(-0.38, 1.1, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), shirt);
  armR.position.set(0.38, 1.1, 0);
  group.add(armR);
  group.userData.legs = { legL, legR, armL, armR };
  return group;
}

/** A point on a sidewalk, beside a street (just outside the road). */
function sidewalkPoint(rng) {
  const lines = streetLines();
  const line = rng.pick(lines);
  const along = rng.range(-CONFIG.halfWorld + 20, CONFIG.halfWorld - 20);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = CONFIG.roadWidth / 2 + CONFIG.sidewalk / 2 + 1;
  if (rng.chance(0.5)) return { x: along, z: line + side * off };
  return { x: line + side * off, z: along };
}

/** One walker with a destination and a walking speed. */
class Walker {
  constructor(scene, rng) {
    this.mesh = makePersonMesh(rng);
    scene.add(this.mesh);
    this.rng = rng;
    const start = sidewalkPoint(rng);
    this.x = start.x;
    this.z = start.z;
    this.target = sidewalkPoint(rng);
    this.speed = rng.range(1.2, CONFIG.people.walkSpeed + 0.6);
    this.fleeing = false;
    this.fleeTimer = 0;
    this.phase = rng.range(0, Math.PI * 2);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
  }

  update(dt, playerPos, gunshot) {
    if (gunshot) {
      const d = dist2d(this.x, this.z, gunshot.x, gunshot.z);
      if (d < 40) {
        this.fleeing = true;
        this.fleeTimer = 3;
        const away = Math.atan2(this.x - gunshot.x, this.z - gunshot.z);
        this.target = {
          x: clamp(this.x + Math.sin(away) * 60, -300, 300),
          z: clamp(this.z + Math.cos(away) * 60, -300, 300),
        };
      }
    }
    if (this.fleeTimer > 0) this.fleeTimer -= dt;
    else this.fleeing = false;
    const dx = this.target.x - this.x;
    const dz = this.target.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 2) {
      this.target = sidewalkPoint(this.rng);
      return;
    }
    const speed = this.fleeing ? CONFIG.people.fleeSpeed : this.speed;
    this.x += (dx / d) * speed * dt;
    this.z += (dz / d) * speed * dt;
    this.mesh.rotation.y = Math.atan2(dx, dz);
    // A simple walk cycle: legs and arms swing opposite each other.
    this.phase += dt * speed * 4;
    const swing = Math.sin(this.phase) * 0.5;
    const legs = this.mesh.userData.legs;
    legs.legL.rotation.x = swing;
    legs.legR.rotation.x = -swing;
    legs.armL.rotation.x = -swing * 0.7;
    legs.armR.rotation.x = swing * 0.7;
    this.syncMesh();
  }
}

/** The crowd: a dozen walkers spread across the sidewalks. */
export function createCrowd(scene, rng) {
  const walkers = [];
  for (let i = 0; i < CONFIG.people.count; i++) walkers.push(new Walker(scene, rng));
  return {
    walkers,

    /** Positions for the minimap. */
    positions() {
      return walkers.map((w) => ({ x: w.x, z: w.z }));
    },

    update(dt, playerPos, gunshot) {
      for (const w of walkers) w.update(dt, playerPos, gunshot);
    },
  };
}
