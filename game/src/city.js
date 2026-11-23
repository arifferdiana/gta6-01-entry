// SOLMARINA — the procedural city.
// One seeded pass lays out the street grid, the buildings with lit
// windows, the sidewalks, the streetlights and the palms. It also hands
// back the collision boxes every moving thing in the game uses.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { RNG, CITY_SEED } from './random.js';

/** Make a facade texture: a dark wall with a grid of lit windows. */
function facadeTexture(rng, baseColor, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 128, 256);
  // Slight vertical shading so the top reads darker against the dusk sky.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 12;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rng.chance(litRatio);
      const warm = rng.chance(0.7);
      g.fillStyle = lit ? (warm ? '#ffd27a' : '#9fd8ff') : '#14141c';
      g.fillRect(8 + c * 20, 10 + r * 20, 12, 13);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The street lines: where the roads run, in world coordinates. */
export function streetLines() {
  const lines = [];
  const half = CONFIG.halfWorld;
  const step = CONFIG.block + CONFIG.roadWidth;
  for (let v = -half; v <= half + 1; v += step) lines.push(v);
  return lines;
}

/** Build the city into the scene. Returns colliders and a per-frame update. */
export function createCity(scene) {
  const rng = new RNG(CITY_SEED);
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const half = CONFIG.halfWorld;
  const step = CONFIG.block + CONFIG.roadWidth;
  const lines = streetLines();

  // --- Road markings: centre dashes on every street.
  const dashMat = new THREE.MeshBasicMaterial({ color: CONFIG.colors.roadLine });
  const dashGeo = new THREE.BoxGeometry(4, 0.06, 0.7);
  for (const v of lines) {
    for (let s = -half + 8; s < half - 4; s += 12) {
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.position.set(s, 0.06, v);
      group.add(dash);
      const dash2 = new THREE.Mesh(dashGeo, dashMat);
      dash2.rotation.y = Math.PI / 2;
      dash2.position.set(v, 0.06, s);
      group.add(dash2);
    }
  }

  // --- Sidewalks: pale strips along every block edge.
  const walkMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.sidewalk, roughness: 1 });
  const walkGeo = new THREE.BoxGeometry(CONFIG.block + CONFIG.roadWidth, 0.12, CONFIG.sidewalk);
  for (const bx of lines) {
    for (const bz of lines) {
      // Each intersection's four sidewalk edges: strips just outside the
      // road (the road spans line +/- 7, the buildings start at line + 14).
      for (const [dx, dz, rot] of [
        [32, 2.5, 0],
        [32, 61.5, 0],
        [2.5, 32, Math.PI / 2],
        [61.5, 32, Math.PI / 2],
      ]) {
        const w = new THREE.Mesh(walkGeo, walkMat);
        w.rotation.y = rot;
        w.position.set(bx + CONFIG.roadWidth / 2 + dx, 0.06, bz + CONFIG.roadWidth / 2 + dz);
        w.receiveShadow = true;
        group.add(w);
      }
    }
  }

  // --- Buildings: one to three per block, heights rising toward downtown.
  const facades = [
    facadeTexture(rng, '#565064', 0.55),
    facadeTexture(rng, '#5d4a4a', 0.5),
    facadeTexture(rng, '#454a5e', 0.6),
    facadeTexture(rng, '#5a4a38', 0.48),
  ];
  const roofMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.buildingRoof, roughness: 1 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const bx of lines) {
    for (const bz of lines) {
      const cx = bx + CONFIG.roadWidth / 2 + CONFIG.block / 2;
      const cz = bz + CONFIG.roadWidth / 2 + CONFIG.block / 2;
      // The beach strip stays open; the marina corner stays open.
      if (cx > CONFIG.beachX - 20) continue;
      if (cx > 200 && cz > 200) continue;
      // Downtown (near the centre) builds taller.
      const downtown = Math.abs(cx) < 130 && Math.abs(cz) < 130;
      const count = rng.int(1, downtown ? 3 : 2);
      for (let i = 0; i < count; i++) {
        const w = rng.range(18, 30);
        const d = rng.range(18, 30);
        const h = downtown ? rng.range(26, 68) : rng.range(12, 34);
        const ox = rng.range(-10, 10);
        const oz = rng.range(-10, 10);
        const mat = new THREE.MeshStandardMaterial({
          map: facades[rng.int(0, facades.length - 1)],
          roughness: 0.85,
        });
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(w, h, d);
        b.position.set(cx + ox, h / 2, cz + oz);
        b.castShadow = true;
        b.receiveShadow = true;
        group.add(b);
        // A rooftop box: vents and a water tank silhouette.
        const roof = new THREE.Mesh(boxGeo, roofMat);
        roof.scale.set(w * 0.3, 2.4, d * 0.3);
        roof.position.set(cx + ox + w * 0.2, h + 1.2, cz + oz - d * 0.15);
        group.add(roof);
        colliders.push({
          minX: cx + ox - w / 2,
          maxX: cx + ox + w / 2,
          minZ: cz + oz - d / 2,
          maxZ: cz + oz + d / 2,
        });
      }
    }
  }

  // --- Streetlights at every other intersection, with a few real lights.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc94d, emissiveIntensity: 1.6 });
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 7, 6);
  const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
  const realLights = [];
  let lightCount = 0;
  for (let ix = 0; ix < lines.length; ix++) {
    for (let iz = 0; iz < lines.length; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      const x = lines[ix] + CONFIG.roadWidth / 2 + 2;
      const z = lines[iz] + CONFIG.roadWidth / 2 + 2;
      if (x > CONFIG.beachX - 10) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      group.add(pole);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 7.1, z);
      group.add(lamp);
      if (lightCount < 6) {
        const light = new THREE.PointLight(0xffc94d, 18, 42, 1.6);
        light.position.set(x, 6.8, z);
        scene.add(light);
        realLights.push(light);
        lightCount++;
      }
    }
  }

  // --- Palms along the beach front.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1 });
  for (let z = -280; z <= 280; z += 40) {
    const x = CONFIG.beachX - 8 + rng.range(-2, 2);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 9, 6), trunkMat);
    trunk.position.set(x, 4.5, z);
    trunk.rotation.z = rng.range(-0.12, 0.12);
    trunk.castShadow = true;
    group.add(trunk);
    for (let f = 0; f < 5; f++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 5), leafMat);
      const a = (f / 5) * Math.PI * 2;
      frond.position.set(x + Math.cos(a) * 1.6, 9.6, z + Math.sin(a) * 1.6);
      frond.rotation.z = Math.cos(a) * 1.1;
      frond.rotation.x = -Math.sin(a) * 1.1;
      group.add(frond);
    }
  }

  return {
    colliders,
    /** Push a ground circle out of every building it overlaps. */
    resolveCircle(pos, radius) {
      for (const c of colliders) {
        const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
        const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
        const dx = pos.x - nx;
        const dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 < 0.0001) {
            // Dead centre: push out along the smallest penetration axis.
            const pl = Math.min(pos.x - c.minX, c.maxX - pos.x);
            const pd = Math.min(pos.z - c.minZ, c.maxZ - pos.z);
            if (pl < pd) pos.x = pos.x - c.minX < c.maxX - pos.x ? c.minX - radius : c.maxX + radius;
            else pos.z = pos.z - c.minZ < c.maxZ - pos.z ? c.minZ - radius : c.maxZ + radius;
          } else {
            const d = Math.sqrt(d2);
            pos.x = nx + (dx / d) * radius;
            pos.z = nz + (dz / d) * radius;
          }
        }
      }
    },

    /** True when a ground point is inside the drivable street area. */
    onStreet(x, z) {
      const half = CONFIG.halfWorld;
      if (x < -half || x > half || z < -half || z > half) return false;
      return true;
    },

    update(dt, t) {
      // The streetlights breathe almost imperceptibly with the dusk.
      for (let i = 0; i < realLights.length; i++) {
        realLights[i].intensity = 18 + Math.sin(t * 1.4 + i * 1.7) * 1.5;
      }
    },
  };
}
