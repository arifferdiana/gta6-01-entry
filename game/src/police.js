// SOLMARINA — the wanted system and the police.
// Heat rises when the player commits crimes; stars are heat divided by
// twenty. Cruisers spawn per star and chase the player, roadblocks appear
// at three stars, and heat decays once no cruiser can see the player.

import * as THREE from 'three';
import { CONFIG, clamp, wrapAngle, dist2d } from './config.js';
import { makeCarMesh } from './vehicles.js';

/** A police cruiser chasing the player. */
class Cruiser {
  constructor(scene, colliders, x, z) {
    this.mesh = makeCarMesh('police', 0x1a1a1a);
    // A white door band over the black body reads as a cruiser at a glance.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(2.02, 0.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
    );
    band.position.set(0, 0.62, -0.2);
    this.mesh.add(band);
    scene.add(this.mesh);
    this.colliders = colliders;
    this.x = x;
    this.z = z;
    this.heading = 0;
    this.speed = 0;
    this.flash = 0;
    this.stuckTimer = 0;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  /** Steer toward the player and ram them; push out of buildings. */
  update(dt, player) {
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const want = Math.atan2(dx, dz);
    const diff = wrapAngle(want - this.heading);
    const steerRate = d < 12 ? 2.6 : 1.7;
    this.heading += clamp(diff, -steerRate * dt, steerRate * dt);
    const targetSpeed = d < 6 ? 6 : 26;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 1.2);
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const pos = { x: nx, z: nz };
    this.colliders.resolveCircle(pos, 2.1);
    const blocked = Math.abs(pos.x - nx) > 0.01 || Math.abs(pos.z - nz) > 0.01;
    if (blocked) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        // Back out of the wall and try a new angle.
        this.heading += Math.PI * 0.6;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.x = pos.x;
    this.z = pos.z;
    // Flash the light bar, red and blue alternating.
    this.flash += dt;
    const bar = this.mesh.userData.lightBar;
    if (bar) {
      const red = Math.floor(this.flash * 6) % 2 === 0;
      bar.red.material.emissiveIntensity = red ? 3.5 : 0.2;
      bar.blue.material.emissiveIntensity = red ? 0.2 : 3.5;
    }
    this.syncMesh();
  }

  remove(scene) {
    scene.remove(this.mesh);
  }
}

/** The police system: wanted level, cruisers, roadblocks, sirens. */
export function createPolice(scene, colliders, audio, game) {
  const cruisers = [];
  let heat = 0;
  let roadblock = null;
  let roadblockTimer = 0;

  function stars() {
    return Math.min(CONFIG.wanted.maxStars, Math.floor(heat / CONFIG.wanted.heatPerStar));
  }

  function spawnCruiser(x, z) {
    const c = new Cruiser(scene, colliders, x, z);
    cruisers.push(c);
    return c;
  }

  function clearRoadblock() {
    if (!roadblock) return;
    for (const c of roadblock) c.remove(scene);
    roadblock = null;
  }

  return {
    get heat() {
      return heat;
    },
    get stars() {
      return stars();
    },
    cruisers,

    /** Add heat for a crime: stealing, shooting, speeding past police. */
    addHeat(n) {
      heat = Math.min(CONFIG.wanted.maxStars * CONFIG.wanted.heatPerStar, heat + n);
    },

    setHeat(n) {
      heat = clamp(n, 0, CONFIG.wanted.maxStars * CONFIG.wanted.heatPerStar);
    },

    clear() {
      heat = 0;
      for (const c of cruisers) c.remove(scene);
      cruisers.length = 0;
      clearRoadblock();
    },

    /** Positions for the minimap. */
    positions() {
      return cruisers.map((c) => ({ x: c.x, z: c.z }));
    },

    update(dt, player) {
      const want = stars();
      // Keep one cruiser per star on the street, up to the cap.
      const targetCount = Math.min(want * CONFIG.wanted.cruiserPerStar, CONFIG.wanted.maxCruisers);
      while (cruisers.length < targetCount) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 55 + Math.random() * 30;
        spawnCruiser(
          clamp(player.x + Math.sin(angle) * dist, -300, 300),
          clamp(player.z + Math.cos(angle) * dist, -300, 300),
        );
      }
      while (cruisers.length > targetCount) {
        const c = cruisers.pop();
        c.remove(scene);
      }
      // A cruiser sees the player within 70 units; heat decays only unseen.
      let seen = false;
      for (const c of cruisers) {
        if (dist2d(c.x, c.z, player.x, player.z) < 70) seen = true;
      }
      if (!seen && want > 0) heat = Math.max(0, heat - CONFIG.wanted.decayPerSec * dt);
      for (const c of cruisers) c.update(dt, player);
      // Roadblocks at three stars: two cruisers parked across the road ahead.
      if (want >= CONFIG.wanted.roadblockAtStars) {
        roadblockTimer -= dt;
        if (!roadblock && roadblockTimer <= 0) {
          const ahead = 46;
          const fx = player.x + Math.sin(player.heading || 0) * ahead;
          const fz = player.z + Math.cos(player.heading || 0) * ahead;
          roadblock = [
            spawnCruiser(fx - 5, fz),
            spawnCruiser(fx + 5, fz),
          ];
          for (const c of roadblock) {
            c.speed = 0;
            c.heading = (player.heading || 0) + Math.PI / 2;
            c.syncMesh();
          }
          roadblockTimer = 24;
        }
      } else {
        clearRoadblock();
        roadblockTimer = 0;
      }
      // Sirens while any cruiser is close.
      let near = false;
      for (const c of cruisers) {
        if (dist2d(c.x, c.z, player.x, player.z) < 90) near = true;
      }
      audio.siren(near, dt);
      game.wanted = want;
    },
  };
}
