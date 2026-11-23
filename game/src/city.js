// SOLMARINA — the procedural city.
//
// One seeded build lays out the whole map: an 8x8 grid of blocks split by
// 12-unit roads, tall towers in the centre, low houses out east, a park in
// the north-east corner, a sand beach and open ocean along the west edge, a
// wooden pier jutting out at z = 40, and a marina with moored boats along
// the south edge. Everything the gameplay needs to know about the city is
// plain data: colliders are {x, z, hx, hz} boxes, so the world can push the
// player and the cars out of buildings without touching three.js at all.

import * as THREE from 'three';
import { CITY, DISTRICTS, PALETTE } from './config.js';

const PITCH = CITY.pitch;
const HALF = CITY.half;
const ROAD_HALF = CITY.road / 2;

/** Road centre lines run at -288, -216, ..., 288 on both axes. */
function roadCentre(k) {
  return -HALF + k * PITCH;
}

/** Centre of block (i, j) in the 8x8 grid. */
function blockCentre(i) {
  return -HALF + CITY.road + CITY.block / 2 + i * PITCH;
}

/** Distance from one coordinate to the nearest road centre line. */
function roadDistance(v) {
  const u = (((v + HALF) % PITCH) + PITCH) % PITCH;
  return Math.min(u, PITCH - u);
}

/** A building face: a grid of windows, a few of them lit warm yellow. */
function makeWindowTexture(random, base, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 256);
  const cols = 8;
  const rows = 16;
  const cw = 128 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      ctx.fillStyle = random() < litRatio ? '#ffd97a' : '#2e4a63';
      ctx.fillRect(c * cw + 3, r * rh + 4, cw - 6, rh - 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The ground seen from above: grass everywhere, the sand strip west of the
 * grid, a darker green park, pale sidewalk slabs on every block, dark road
 * strips on every grid line with dashed centre lines.
 */
function makeGroundTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // World x/z in [-360, 360] maps onto the 1024px canvas.
  const toPx = (v) => ((v + 360) / 720) * size;
  const scale = size / 720;
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, size, size);
  // Sand beach west of the road grid.
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, 0, toPx(-HALF), size);
  // The park blocks stay deep green.
  ctx.fillStyle = '#4c8a3f';
  ctx.fillRect(
    toPx(DISTRICTS.park.x0), toPx(DISTRICTS.park.z0),
    (DISTRICTS.park.x1 - DISTRICTS.park.x0) * scale,
    (DISTRICTS.park.z1 - DISTRICTS.park.z0) * scale,
  );
  // One sidewalk slab per block.
  ctx.fillStyle = PALETTE.sidewalk;
  for (let i = 0; i < CITY.blocks; i += 1) {
    for (let j = 0; j < CITY.blocks; j += 1) {
      const cx = blockCentre(i);
      const cz = blockCentre(j);
      ctx.fillRect(
        toPx(cx - CITY.block / 2), toPx(cz - CITY.block / 2),
        CITY.block * scale, CITY.block * scale,
      );
    }
  }
  // Roads: dark strips along every grid line, then dashed centre lines.
  ctx.fillStyle = PALETTE.road;
  for (let k = 0; k <= CITY.blocks; k += 1) {
    const c = roadCentre(k);
    ctx.fillRect(toPx(c - ROAD_HALF), 0, CITY.road * scale, size);
    ctx.fillRect(0, toPx(c - ROAD_HALF), size, CITY.road * scale);
  }
  ctx.fillStyle = PALETTE.roadLine;
  for (let k = 0; k <= CITY.blocks; k += 1) {
    const c = roadCentre(k);
    for (let d = -HALF; d < HALF; d += 24) {
      ctx.fillRect(toPx(c - 0.7), toPx(d), 1.4 * scale, 10 * scale);
      ctx.fillRect(toPx(d), toPx(c - 0.7), 10 * scale, 1.4 * scale);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createCity(random) {
  const group = new THREE.Group();
  const colliders = [];
  const buildings = [];

  // --- Ground, ocean and beach --------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(720, 720),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Two stacked ocean planes: a slightly transparent top sheet over a
  // deeper sheet, so the water reads as a flat sea rather than a void.
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.oceanWidth, 760),
    new THREE.MeshLambertMaterial({ color: PALETTE.ocean, transparent: true, opacity: 0.92 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-HALF - CITY.beachWidth - CITY.oceanWidth / 2, 0.05, 0);
  group.add(ocean);
  const oceanDeep = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.oceanWidth, 760),
    new THREE.MeshLambertMaterial({ color: PALETTE.oceanDeep }),
  );
  oceanDeep.rotation.x = -Math.PI / 2;
  oceanDeep.position.set(-HALF - CITY.beachWidth - CITY.oceanWidth / 2, -0.4, 0);
  group.add(oceanDeep);

  // --- Shared building materials -------------------------------------------
  const wallMats = PALETTE.building.slice(0, 3).map((base) =>
    new THREE.MeshLambertMaterial({ map: makeWindowTexture(random, base, 0.35) }));
  const roofMat = new THREE.MeshLambertMaterial({ color: '#6b6259' });
  const houseMat = new THREE.MeshLambertMaterial({ color: '#e8d3b3' });
  const houseRoofMat = new THREE.MeshLambertMaterial({ color: '#a4553f' });

  function addBuilding(x, z, w, d, h, matIndex) {
    const wall = wallMats[matIndex % wallMats.length];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [wall, wall, roofMat, roofMat, wall, wall],
    );
    mesh.position.set(x, h / 2, z);
    group.add(mesh);
    colliders.push({ x, z, hx: w / 2, hz: d / 2 });
    buildings.push({ x, z, hx: w / 2, hz: d / 2, h });
    return mesh;
  }

  function addHouse(x, z, w, d, h) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), houseMat);
    mesh.position.set(x, h / 2, z);
    group.add(mesh);
    // A four-sided pyramid roof, turned 45 degrees so its ridge runs
    // diagonally across the house.
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 3, 4), houseRoofMat);
    roof.position.set(x, h + 1.5, z);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    colliders.push({ x, z, hx: w / 2, hz: d / 2 });
    buildings.push({ x, z, hx: w / 2, hz: d / 2, h });
  }

  // --- The blocks -----------------------------------------------------------
  // Downtown (the central 4x4 blocks) gets one tall tower, sometimes a
  // second shorter one. The eastern suburbs get two to four small houses
  // per block. Everywhere else gets a single mid-rise. The park blocks
  // stay empty — trees are planted there instead.
  let matIndex = 0;
  for (let i = 0; i < CITY.blocks; i += 1) {
    for (let j = 0; j < CITY.blocks; j += 1) {
      const cx = blockCentre(i);
      const cz = blockCentre(j);
      const downtown = Math.abs(cx) < 144 && Math.abs(cz) < 144;
      const park = cx >= DISTRICTS.park.x0 && cx < DISTRICTS.park.x1
        && cz >= DISTRICTS.park.z0 && cz < DISTRICTS.park.z1;
      const suburb = cx >= 144;
      if (park) continue;
      if (downtown) {
        const h = 40 + random() * 50;
        const w = 30 + random() * 14;
        addBuilding(
          cx + (random() - 0.5) * 8, cz + (random() - 0.5) * 8,
          w, w * (0.8 + random() * 0.4), h, matIndex,
        );
        matIndex += 1;
        if (random() < 0.5) {
          const h2 = 15 + random() * 20;
          addBuilding(
            cx + (random() - 0.5) * 30, cz + (random() - 0.5) * 30,
            14 + random() * 8, 14 + random() * 8, h2, matIndex,
          );
          matIndex += 1;
        }
      } else if (suburb) {
        const count = 2 + Math.floor(random() * 3);
        for (let n = 0; n < count; n += 1) {
          addHouse(
            cx + (random() - 0.5) * 34, cz + (random() - 0.5) * 34,
            10 + random() * 6, 9 + random() * 6, 6 + random() * 4,
          );
        }
      } else {
        const h = 15 + random() * 25;
        addBuilding(
          cx + (random() - 0.5) * 10, cz + (random() - 0.5) * 10,
          24 + random() * 12, 24 + random() * 12, h, matIndex,
        );
        matIndex += 1;
      }
    }
  }

  // --- Street props ----------------------------------------------------------
  const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk });
  const leafMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 7, 6);
  const leafGeo = new THREE.ConeGeometry(1.6, 4.5, 4);

  function addPalm(x, z) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3.5;
    palm.add(trunk);
    for (let k = 0; k < 5; k += 1) {
      const a = (k / 5) * Math.PI * 2;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(a) * 1.1, 7.4, Math.sin(a) * 1.1);
      leaf.rotation.z = Math.cos(a) * 1.1;
      leaf.rotation.x = -Math.sin(a) * 1.1;
      leaf.scale.set(1, 1, 0.35);
      palm.add(leaf);
    }
    palm.position.set(x, 0, z);
    group.add(palm);
  }
  // A ragged line of palms along the beach, with a few more just inside
  // the western road.
  for (let z = -270; z <= 270; z += 36) {
    addPalm(-302 + (random() - 0.5) * 6, z + (random() - 0.5) * 10);
    if (random() < 0.5) addPalm(-HALF + 9, z + 18);
  }

  const treeTrunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 3, 6);
  const treeTopGeo = new THREE.SphereGeometry(2.6, 8, 6);
  const treeTopMat = new THREE.MeshLambertMaterial({ color: '#3f8a3a' });

  function addTree(x, z, s) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat);
    trunk.position.y = 1.5;
    tree.add(trunk);
    const top = new THREE.Mesh(treeTopGeo, treeTopMat);
    top.position.y = 4.2;
    top.scale.setScalar(s || 1);
    tree.add(top);
    tree.position.set(x, 0, z);
    group.add(tree);
  }
  // Most of the trees live in the park; a few are scattered across town.
  for (let i = 0; i < 26; i += 1) {
    addTree(150 + random() * 130, -282 + random() * 130, 0.8 + random() * 0.7);
  }
  for (let i = 0; i < 8; i += 1) {
    addTree(-HALF + 20 + random() * 500, -HALF + 20 + random() * 500, 0.7 + random() * 0.5);
  }

  // Street lamps: a pole and a glowing bulb at road corners.
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: '#3a3f46' });
  const lampBulbMat = new THREE.MeshLambertMaterial({ color: '#fff2b0', emissive: '#ffdf6a' });
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 6);
  const lampBulbGeo = new THREE.SphereGeometry(0.35, 8, 6);
  for (let k = 0; k <= CITY.blocks; k += 1) {
    for (let d = -252; d <= 252; d += 144) {
      const c = roadCentre(k);
      const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
      pole.position.set(c + 7, 3, d);
      group.add(pole);
      const bulb = new THREE.Mesh(lampBulbGeo, lampBulbMat);
      bulb.position.set(c + 7, 6.2, d);
      group.add(bulb);
    }
  }

  // Benches in the park and along the beach promenade.
  const benchMat = new THREE.MeshLambertMaterial({ color: '#7a5a38' });
  const benchGeo = new THREE.BoxGeometry(2.4, 0.5, 0.9);
  function addBench(x, z, angle) {
    const bench = new THREE.Mesh(benchGeo, benchMat);
    bench.position.set(x, 0.45, z);
    bench.rotation.y = angle || 0;
    group.add(bench);
  }
  for (let i = 0; i < 6; i += 1) addBench(160 + random() * 110, -270 + random() * 110, random() * Math.PI);
  for (let i = 0; i < 4; i += 1) addBench(-306, -200 + i * 110, Math.PI / 2);

  // A row of red hydrants along the south side of the z = 144 road.
  const hydrantMat = new THREE.MeshLambertMaterial({ color: '#c0392b' });
  const hydrantGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.1, 8);
  for (let i = 0; i < 10; i += 1) {
    const hydrant = new THREE.Mesh(hydrantGeo, hydrantMat);
    hydrant.position.set(-252 + i * 54, 0.55, 139);
    group.add(hydrant);
  }

  // --- Pier: a wooden walkway west into the ocean, at z = 40 ---------------
  const pierMat = new THREE.MeshLambertMaterial({ color: PALETTE.pier });
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(150, 0.6, 9), pierMat);
  pierDeck.position.set(-HALF - 60, 0.6, 40);
  group.add(pierDeck);
  const pierEnd = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 20), pierMat);
  pierEnd.position.set(-HALF - 132, 0.6, 40);
  group.add(pierEnd);
  const postGeo = new THREE.CylinderGeometry(0.4, 0.4, 3.4, 6);
  for (let x = -HALF - 6; x >= -HALF - 140; x -= 18) {
    for (const dz of [-4, 4]) {
      const post = new THREE.Mesh(postGeo, pierMat);
      post.position.set(x, -0.8, 40 + dz);
      group.add(post);
    }
  }

  // A small beacon tower on the pier-end platform: a landmark the mission
  // marker can sit beside, visible from the beach and the city.
  const beaconMat = new THREE.MeshLambertMaterial({ color: '#e8e4d8' });
  const beaconLightMat = new THREE.MeshBasicMaterial({ color: 0xffd94d });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 9, 8), beaconMat);
  beacon.position.set(-HALF - 128, 5.1, 48);
  group.add(beacon);
  const beaconLight = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), beaconLightMat);
  beaconLight.position.set(-HALF - 128, 10.2, 48);
  group.add(beaconLight);

  // --- Marina: docks and moored boats along the south edge ------------------
  const dockMat = new THREE.MeshLambertMaterial({ color: '#9a7b4f' });
  const hullMat = new THREE.MeshLambertMaterial({ color: '#f2f2f2' });
  const hullMat2 = new THREE.MeshLambertMaterial({ color: '#3f7fb8' });
  const cabinMat = new THREE.MeshLambertMaterial({ color: '#dfe8ee' });
  for (let d = 0; d < 3; d += 1) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(120, 0.5, 4), dockMat);
    dock.position.set(-60 + d * 60, 0.4, 306 + d * 18);
    group.add(dock);
  }
  const boats = [];
  for (let i = 0; i < 6; i += 1) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 3.4), i % 2 ? hullMat : hullMat2);
    hull.position.y = 0.8;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 2.4), cabinMat);
    cabin.position.set(-0.5, 2.2, 0);
    boat.add(cabin);
    boat.position.set(-120 + i * 48, 0, 318 + (i % 3) * 16);
    boat.rotation.y = (random() - 0.5) * 0.3;
    group.add(boat);
    boats.push(boat);
  }

  // --- Named places ----------------------------------------------------------
  // The first eight match the original build exactly. The rest are the
  // named points the world and missions look up: comet and van sit on the
  // road spots world.js already derives with nearestRoadPoint, and the
  // others sit on road lines or inside their district.
  const spawns = {
    playerSpawn: { x: 6, z: 102 },
    starterCar: { x: 0, z: 72 },
    hotel: { x: 42, z: -30 },
    garage: { x: -30, z: 186 },
    pier: { x: -HALF - 128, z: 40 },
    marina: { x: 0, z: 312 },
    hideout: { x: 216, z: 108 },
    suburbs: { x: 216, z: 216 },
    park: { x: 216, z: -216 },
    bank: { x: -42, z: -42 },
    beach: { x: -324, z: 0 },
    client: { x: 72, z: -108 },
    comet: { x: 60, z: 72 },
    van: { x: -60, z: -144 },
    maras: { x: -180, z: 180 },
    hospital: { x: -102, z: -102 },
    policeStation: { x: 42, z: 150 },
  };

  // --- Queries ----------------------------------------------------------------
  function isRoad(x, z) {
    if (x < -HALF - ROAD_HALF || x > HALF + ROAD_HALF
      || z < -HALF - ROAD_HALF || z > HALF + ROAD_HALF) return false;
    return roadDistance(x) <= ROAD_HALF || roadDistance(z) <= ROAD_HALF;
  }

  function clampToCity(x, z) {
    const minX = -HALF - CITY.beachWidth - CITY.oceanWidth + 20;
    const maxX = HALF + 4;
    const minZ = -HALF - 4;
    const maxZ = HALF + CITY.beachWidth + 40;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      z: Math.max(minZ, Math.min(maxZ, z)),
    };
  }

  /** Push a circle out of every building AABB; returns the corrected spot. */
  function collideCircle(x, z, r) {
    let px = x;
    let pz = z;
    // Two passes: shoving out of one building can push into the next.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < colliders.length; i += 1) {
        const c = colliders[i];
        const dx = px - c.x;
        const dz = pz - c.z;
        const ox = c.hx + r - Math.abs(dx);
        if (ox <= 0) continue;
        const oz = c.hz + r - Math.abs(dz);
        if (oz <= 0) continue;
        // Resolve along the smaller overlap so the push is the short way out.
        if (ox < oz) px = c.x + (dx >= 0 ? c.hx + r : -c.hx - r);
        else pz = c.z + (dz >= 0 ? c.hz + r : -c.hz - r);
      }
    }
    return { x: px, z: pz };
  }

  function nearestRoadPoint(x, z) {
    const kx = Math.round((x + HALF) / PITCH);
    const kz = Math.round((z + HALF) / PITCH);
    const cx = roadCentre(Math.max(0, Math.min(CITY.blocks, kx)));
    const cz = roadCentre(Math.max(0, Math.min(CITY.blocks, kz)));
    const clampX = Math.max(-HALF, Math.min(HALF, x));
    const clampZ = Math.max(-HALF, Math.min(HALF, z));
    // Snap onto whichever road line is closer: the vertical one or the
    // horizontal one.
    if (Math.abs(x - cx) <= Math.abs(z - cz)) return { x: cx, z: clampZ };
    return { x: clampX, z: cz };
  }

  function randomRoadPoint(rnd) {
    const r = rnd || random;
    const along = (r() * 2 - 1) * HALF;
    const line = roadCentre(Math.floor(r() * (CITY.blocks + 1)));
    if (r() < 0.5) return { x: line, z: along };
    return { x: along, z: line };
  }

  function randomSidewalkPoint(rnd) {
    const r = rnd || random;
    const cx = blockCentre(Math.floor(r() * CITY.blocks));
    const cz = blockCentre(Math.floor(r() * CITY.blocks));
    const side = Math.floor(r() * 4);
    const off = CITY.block / 2 - 2;
    if (side === 0) return { x: cx + off, z: cz + (r() * 2 - 1) * off };
    if (side === 1) return { x: cx - off, z: cz + (r() * 2 - 1) * off };
    if (side === 2) return { x: cx + (r() * 2 - 1) * off, z: cz + off };
    return { x: cx + (r() * 2 - 1) * off, z: cz - off };
  }

  return {
    group, colliders, buildings, boats, spawns,
    size: CITY.size,
    half: HALF,
    block: CITY.block,
    road: CITY.road,
    pitch: PITCH,
    isRoad, clampToCity, collideCircle, nearestRoadPoint, randomRoadPoint, randomSidewalkPoint,
  };
}
