// Drawing only: the three.js scene, the third-person camera rig and the
// per-frame painting of the live state. No rules live here — the world hands
// over positions and this module turns them into figures, cars, a beacon
// and flashes. Everything is built once and reused; draw() only moves,
// shows and hides things, so a frame costs no allocation.

import * as THREE from 'three';
import { PALETTE } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

export const CAMERA_FOLLOW = 'follow';
export const CAMERA_DRIVE = 'drive';
export const CAMERA_TOP = 'top';
export const CAMERA_CINEMATIC = 'cinematic';

const PED_SHIRTS = [0x4a90d9, 0x7bc47f, 0xe8b13d, 0xd97b9c, 0x8a6fc0, 0x5bc0be, 0xe07a3f, 0x9db38a];
const PED_PANTS = [0x2b3a55, 0x3d3d3d, 0x5a4a3a, 0x37474f];

/** A blocky walking figure: shirt body, head, hair, legs and arms. */
function makePerson(shirtColor, pantsColor) {
  const figure = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a077 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), shirt);
  body.position.y = 1.15;
  figure.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
  head.position.y = 1.85;
  figure.add(head);
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.16, 0.44),
    new THREE.MeshLambertMaterial({ color: 0x2b2118 }),
  );
  hair.position.y = 2.1;
  figure.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, 0.3), pants);
  legL.position.set(-0.18, 0.38, 0);
  figure.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, 0.3), pants);
  legR.position.set(0.18, 0.38, 0);
  figure.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), shirt);
  armL.position.set(-0.48, 1.15, 0);
  figure.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), shirt);
  armR.position.set(0.48, 1.15, 0);
  figure.add(armR);
  figure.userData = { legL, legR, armL, armR };
  return figure;
}

/** A low-poly car. Sport models are longer; taxis get a roof sign and
 *  police cars get a light bar that blinks while they drive. */
function makeCar(color, model) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1c2b36 });
  const sport = model === 'sport';
  const taxi = model === 'taxi';
  const bodyLen = sport ? 4.6 : 4.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.75, bodyLen), paint);
  body.position.y = 0.55;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, sport ? 2 : 2.2), glass);
  cabin.position.set(0, 1.2, sport ? -0.2 : 0.1);
  car.add(cabin);
  if (taxi) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x8a7320 }),
    );
    sign.position.set(0, 1.65, 0.1);
    car.add(sign);
  }
  if (model === 'police') {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2244aa, emissive: 0x2244aa }),
    );
    bar.position.set(0, 1.6, 0.1);
    car.add(bar);
    car.userData.lightBar = bar;
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x16181c });
  for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    car.add(wheel);
  }
  return car;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf7c98a, 180, 780);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1c4, 1.6);
  sun.position.set(180, 260, 90);
  scene.add(sun);

  // Gradient sky dome with a flat sun disc hanging in it.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      },
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos; void main() { float h = clamp(vPos.y / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    }),
  );
  scene.add(sky);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(34, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sunDisc.position.set(420, 480, 210);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);

  if (city && city.group) scene.add(city.group);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  camera.position.set(0, 40, 80);

  // --- Pooled figures, cars and effects (created once, reused) -------------
  const playerFigure = makePerson(PALETTE.player, PALETTE.playerPants);
  scene.add(playerFigure);
  const pedPool = [];
  const copPool = [];
  const gangPool = [];
  // Cars are keyed by the car object itself, not by list index: the state
  // list is rebuilt every frame (parked + traffic + police), and its order
  // can shift. An index-keyed pool would hand a parked mission car the
  // mesh of a traffic car that moved — or hide it entirely — whenever the
  // list reorders. Keying on identity keeps every staged car visible.
  const carMeshes = new Map();
  const pedColors = new Map();

  // Health/ammo pickups: small floating crates, pooled and reused.
  const pickupPool = [];
  const pickupGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const pickupHealthMat = new THREE.MeshLambertMaterial({ color: 0x2ecc71, emissive: 0x1a7a44 });
  const pickupAmmoMat = new THREE.MeshLambertMaterial({ color: 0xf2c94c, emissive: 0x8a7320 });

  function figureFor(pool, index, shirtColor, pantsColor) {
    let figure = pool[index];
    if (!figure) {
      figure = makePerson(shirtColor, pantsColor);
      pool[index] = figure;
      scene.add(figure);
    }
    return figure;
  }

  // Mission beacon: a tall translucent pillar with a spinning marker.
  const beacon = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.4, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: PALETTE.beacon, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }),
  );
  pillar.position.y = 30;
  beacon.add(pillar);
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4),
    new THREE.MeshBasicMaterial({ color: PALETTE.beacon, fog: false }),
  );
  marker.position.y = 9;
  beacon.add(marker);
  beacon.visible = false;
  scene.add(beacon);

  // Muzzle flashes and explosions: small pooled sprites.
  const flashPool = [];
  const flashGeo = new THREE.PlaneGeometry(1.6, 1.6);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe066, transparent: true, opacity: 0.95, depthWrite: false, fog: false,
  });
  for (let i = 0; i < 8; i += 1) {
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.visible = false;
    scene.add(flash);
    flashPool.push(flash);
  }
  const explosionPool = [];
  const explosionGeo = new THREE.SphereGeometry(1, 12, 10);
  for (let i = 0; i < 6; i += 1) {
    const boom = new THREE.Mesh(
      explosionGeo,
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, fog: false }),
    );
    boom.visible = false;
    scene.add(boom);
    explosionPool.push(boom);
  }

  // --- Camera rig ------------------------------------------------------------
  let cameraMode = CAMERA_FOLLOW;
  let camYaw = Math.PI;
  let camPitch = 0.32;
  let camDistance = 13;
  let orbitAngle = 0;
  let clock = 0;

  // --- Adaptive quality ------------------------------------------------------
  // Under SwiftShader (software rendering) the frame cost is dominated by
  // fill rate, so the drawing buffer is the lever that actually helps.
  // Measure real frame times once the shaders have compiled: if the machine
  // is slow, first cap the pixel ratio at 1, then (if still slow) halve it.
  // Each step is taken once and stays. Staged screenshots paint only a
  // couple of frames, so they always keep full quality.
  let lastFrameAt = 0;
  let qualityPhase = 0; // 0 warmup, 1 measure tier 1, 2 settle, 3 measure tier 2, 4 done
  let qualityFrames = 0;
  let qualityTime = 0;

  function adaptiveQuality(frameMs) {
    if (qualityPhase === 4) return;
    if (qualityPhase === 0) {
      qualityFrames += 1;
      if (qualityFrames >= 3) { qualityPhase = 1; qualityFrames = 0; qualityTime = 0; }
      return;
    }
    if (qualityPhase === 1) {
      qualityFrames += 1;
      qualityTime += frameMs;
      if (qualityFrames >= 10) {
        if (qualityTime / 10 > 45) {
          renderer.setPixelRatio(1);
          resize();
          qualityPhase = 2;
        } else {
          qualityPhase = 4;
        }
        qualityFrames = 0;
        qualityTime = 0;
      }
      return;
    }
    if (qualityPhase === 2) {
      // Let the lower-resolution shaders settle before measuring again.
      qualityFrames += 1;
      if (qualityFrames >= 3) { qualityPhase = 3; qualityFrames = 0; qualityTime = 0; }
      return;
    }
    qualityFrames += 1;
    qualityTime += frameMs;
    if (qualityFrames >= 10) {
      if (qualityTime / 10 > 45) {
        renderer.setPixelRatio(0.5);
        resize();
      }
      qualityPhase = 4;
    }
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function animateFigure(figure, speed, time, phase) {
    const swing = Math.min(1, Math.abs(speed) / 6) * 0.7;
    const t = time * 9 + phase;
    figure.userData.legL.rotation.x = Math.sin(t) * swing;
    figure.userData.legR.rotation.x = -Math.sin(t) * swing;
    figure.userData.armL.rotation.x = -Math.sin(t) * swing * 0.8;
    figure.userData.armR.rotation.x = Math.sin(t) * swing * 0.8;
  }

  function placeFigure(figure, entity, time, phase) {
    figure.visible = true;
    figure.position.set(entity.x || 0, entity.y || 0, entity.z || 0);
    figure.rotation.y = entity.angle || 0;
    animateFigure(figure, entity.speed || 0, time, phase);
  }

  function placeCar(car, data, time) {
    car.visible = true;
    car.position.set(data.x || 0, 0, data.z || 0);
    car.rotation.y = data.angle || 0;
    if (car.userData.lightBar) {
      const on = Math.floor(time * 4) % 2 === 0;
      car.userData.lightBar.material.emissive.setHex(on ? 0xcc2222 : 0x2244cc);
    }
  }

  /** Paint one frame of the live state under the current screen. */
  function draw(state, screen) {
    const now = performance.now();
    // Advance the animation clock by real elapsed time (capped), so walk
    // cycles, the beacon spin and the police flash run at the same speed
    // on a 30 fps machine as on a 60 fps one.
    if (lastFrameAt > 0) {
      clock += Math.min(0.1, (now - lastFrameAt) / 1000);
      adaptiveQuality(now - lastFrameAt);
    } else {
      clock += 1 / 60;
    }
    lastFrameAt = now;

    const s = state || {};
    const player = s.player || { x: 0, z: 0, angle: 0, health: 100, onFoot: true, speed: 0 };
    const cars = s.cars || [];
    const peds = s.peds || [];
    const cops = s.cops || [];

    // The player figure (hidden while driving — the car carries them).
    // A dead player lies flat on their back.
    if (player.onFoot === false && player.car) {
      playerFigure.visible = false;
    } else {
      placeFigure(playerFigure, player, clock, 0);
      playerFigure.rotation.x = player.health <= 0 ? Math.PI / 2 : 0;
    }

    // Pedestrians. Each ped keeps its shirt/pants for life, keyed by object.
    for (let i = 0; i < peds.length; i += 1) {
      const ped = peds[i];
      let color = pedColors.get(ped);
      if (!color) {
        color = {
          shirt: PED_SHIRTS[i % PED_SHIRTS.length],
          pants: PED_PANTS[i % PED_PANTS.length],
        };
        pedColors.set(ped, color);
      }
      placeFigure(figureFor(pedPool, i, color.shirt, color.pants), ped, clock, i * 1.7);
    }
    for (let i = peds.length; i < pedPool.length; i += 1) pedPool[i].visible = false;

    // Cops on foot (driving cops are painted with the cars below).
    let copFigureIndex = 0;
    for (let i = 0; i < cops.length; i += 1) {
      const cop = cops[i];
      if (cop.onFoot === false && cop.car) continue;
      placeFigure(figureFor(copPool, copFigureIndex, PALETTE.cop, 0x1a2436), cop, clock, i * 2.3);
      copFigureIndex += 1;
    }
    for (let i = copFigureIndex; i < copPool.length; i += 1) copPool[i].visible = false;

    // Reef Kings gang members (purple shirts), same figures as peds.
    const gang = s.gang || [];
    for (let i = 0; i < gang.length; i += 1) {
      if (gang[i].dead) continue;
      placeFigure(figureFor(gangPool, i, PALETTE.gang, 0x2b2b2b), gang[i], clock, i * 2.9);
    }
    for (let i = gang.length; i < gangPool.length; i += 1) gangPool[i].visible = false;

    // Health / ammo pickups: bobbing crates, green for health, amber for ammo.
    const pickups = s.pickups || [];
    let pickupIndex = 0;
    for (let i = 0; i < pickups.length; i += 1) {
      const pk = pickups[i];
      if (!pk || pk.active === false) continue;
      let box = pickupPool[pickupIndex];
      if (!box) {
        box = new THREE.Mesh(pickupGeo, pickupHealthMat);
        pickupPool[pickupIndex] = box;
        scene.add(box);
      }
      box.material = pk.kind === 'ammo' ? pickupAmmoMat : pickupHealthMat;
      box.visible = true;
      box.position.set(pk.x || 0, 1.1 + Math.sin(clock * 3 + i) * 0.25, pk.z || 0);
      box.rotation.y = clock * 1.2 + i;
      pickupIndex += 1;
    }
    for (let i = pickupIndex; i < pickupPool.length; i += 1) pickupPool[i].visible = false;

    // Cars (traffic, the player's car and police cars share the pool).
    // Meshes are matched to car objects by identity, so a car keeps its
    // mesh even when the list reorders; a mesh is rebuilt only when the
    // car's colour or model actually changes.
    const seenCars = new Set();
    for (let i = 0; i < cars.length; i += 1) {
      const data = cars[i];
      seenCars.add(data);
      const color = typeof data.color === 'number' ? data.color : 0xb03a3a;
      const model = data.model || 'sedan';
      let car = carMeshes.get(data);
      if (!car || car.userData.color !== color || car.userData.model !== model) {
        if (car) scene.remove(car);
        car = makeCar(color, model);
        car.userData.color = color;
        car.userData.model = model;
        carMeshes.set(data, car);
        scene.add(car);
      }
      placeCar(car, data, clock);
    }
    for (const [data, car] of carMeshes) {
      if (!seenCars.has(data)) car.visible = false;
    }

    // Mission beacon: the mission layer's target, or the first map marker.
    const target = s.missionTarget || s.beacon
      || (Array.isArray(s.markers) && s.markers.length > 0 ? s.markers[0] : null);
    if (target && typeof target.x === 'number' && typeof target.z === 'number') {
      beacon.visible = true;
      beacon.position.set(target.x, 0, target.z);
      marker.position.y = 9 + Math.sin(clock * 2.5) * 1.2;
      marker.rotation.y = clock * 1.5;
    } else {
      beacon.visible = false;
    }

    // Muzzle flashes (camera-facing quads) and explosions (growing spheres).
    const flashes = s.flashes || [];
    for (let i = 0; i < flashPool.length; i += 1) {
      const flash = flashPool[i];
      const data = flashes[i];
      if (!data) {
        flash.visible = false;
        continue;
      }
      flash.visible = true;
      flash.position.set(data.x || 0, data.y || 1.4, data.z || 0);
      flash.lookAt(camera.position);
    }
    const effects = s.effects || [];
    for (let i = 0; i < explosionPool.length; i += 1) {
      const boom = explosionPool[i];
      const data = effects[i];
      if (!data || data.kind !== 'explosion') {
        boom.visible = false;
        continue;
      }
      boom.visible = true;
      const life = Math.max(0, Math.min(1, (data.ttl || 0) / (data.max || 0.6)));
      const size = 1 + (1 - life) * 7;
      boom.scale.setScalar(size);
      boom.position.set(data.x || 0, 1.5, data.z || 0);
      boom.material.opacity = 0.25 + life * 0.65;
    }

    // --- Camera --------------------------------------------------------------
    // The chase camera always frames the player: it sits behind the orbit
    // yaw (snapped behind the heading on entering a car or starting play)
    // and looks a few units ahead of the player along their facing, so the
    // action stays in frame instead of drifting to a fixed north view.
    const px = player.x || 0;
    const pz = player.z || 0;
    if (screen === SCREEN_TITLE || cameraMode === CAMERA_CINEMATIC) {
      orbitAngle += 0.0016;
      const r = 230;
      camera.position.set(Math.cos(orbitAngle) * r, 130, Math.sin(orbitAngle) * r);
      camera.lookAt(0, 10, 0);
    } else if (cameraMode === CAMERA_TOP) {
      camera.position.set(px, 190, pz + 1);
      camera.lookAt(px, 0, pz);
    } else {
      const driving = player.onFoot === false;
      const dist = driving ? 17 : 12;
      const height = driving ? 6.5 : 5;
      camDistance += (dist - camDistance) * 0.12;
      const ahead = driving ? 4 : 2;
      const tx = px + Math.sin(player.angle || 0) * ahead;
      const tz = pz + Math.cos(player.angle || 0) * ahead;
      const cx = tx - Math.sin(camYaw) * camDistance * Math.cos(camPitch);
      const cz = tz - Math.cos(camYaw) * camDistance * Math.cos(camPitch);
      camera.position.set(cx, height + Math.sin(camPitch) * camDistance, cz);
      camera.lookAt(tx, 2, tz);
    }

    renderer.render(scene, camera);
  }

  function setCameraMode(mode) {
    if (mode === CAMERA_FOLLOW || mode === CAMERA_DRIVE
      || mode === CAMERA_TOP || mode === CAMERA_CINEMATIC) {
      cameraMode = mode;
    }
  }

  /** Mouse-drag orbit: dx turns the camera, dy tilts it. */
  function addLook(dx, dy) {
    camYaw -= dx * 0.005;
    camPitch = Math.max(0.05, Math.min(1.1, camPitch + dy * 0.003));
  }

  /** Snap the orbit behind the player's current facing (used when entering
   *  a car and when play starts, so the chase view opens on the action). */
  function snapBehind(angle) {
    camYaw = angle || 0;
  }

  return { draw, setCameraMode, addLook, snapBehind };
}
