// SOLMARINA — the sky, the sea, the pier and the beacon tower.
// The world module owns the renderer, the lights and everything that is
// not a building, a car or a person: dusk sky, water, sand, the pier
// reaching out over the sea, the marina, and the beacon that gives the
// city its landmark.

import * as THREE from 'three';
import { CONFIG } from './config.js';

/** Build the world: scene, camera, renderer, lights, sea and landmarks. */
export function createWorld() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.colors.fog, 180, 900);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 40, 90);

  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  // --- Sky: a big dome shaded from deep blue at the top to orange at the horizon.
  const skyGeo = new THREE.SphereGeometry(1200, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(CONFIG.colors.skyTop) },
      mid: { value: new THREE.Color(CONFIG.colors.skyMid) },
      low: { value: new THREE.Color(CONFIG.colors.horizon) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 low;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.9, h))
                          : mix(low, mid, smoothstep(-0.05, 0.25, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // --- Lights: a low orange sun and a soft purple fill from the sky.
  const sun = new THREE.DirectionalLight(CONFIG.colors.sun, 2.7);
  sun.position.set(-220, 90, -160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0x8a6bb8, 0x2e2a33, 1.3);
  scene.add(hemi);

  // --- Ground: one big slab; the city, beach and water sit on top of it.
  const groundMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.grass, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(60, -0.1, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // City asphalt: the whole street grid sits on one dark slab.
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.worldSize + 40, CONFIG.worldSize + 40),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.road, roughness: 0.95 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(0, 0, 0);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  // --- Beach and sea on the east edge.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(70, CONFIG.worldSize + 120),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.sand, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(CONFIG.beachX + 18, 0.05, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  const waterMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.water,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.88,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(420, 1100), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CONFIG.waterX + 210, 0.1, 0);
  scene.add(water);

  // --- The pier: wooden planks on posts, running out over the water.
  const pierGroup = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5d4630, roughness: 1 });
  const pier = CONFIG.pier;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(pier.x1 - pier.x0, 0.6, pier.width), plankMat);
  deck.position.set((pier.x0 + pier.x1) / 2, 1.2, pier.z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  pierGroup.add(deck);
  for (let x = pier.x0 + 8; x < pier.x1; x += 14) {
    for (const dz of [-pier.width / 2 + 1, pier.width / 2 - 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.4, 8), postMat);
      post.position.set(x, -0.2, pier.z + dz);
      pierGroup.add(post);
    }
  }
  // Rails along both sides of the pier.
  for (const dz of [-pier.width / 2 + 0.4, pier.width / 2 - 0.4]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(pier.x1 - pier.x0, 0.18, 0.18), postMat);
    rail.position.set((pier.x0 + pier.x1) / 2, 2.6, pier.z + dz);
    pierGroup.add(rail);
    for (let x = pier.x0 + 4; x < pier.x1; x += 12) {
      const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), postMat);
      baluster.position.set(x, 1.9, pier.z + dz);
      pierGroup.add(baluster);
    }
  }
  scene.add(pierGroup);

  // --- The marina: docks and moored boats in the south-east corner.
  const marinaGroup = new THREE.Group();
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x6b543a, roughness: 0.9 });
  const hullColors = [0xd8d8d8, 0x3a6ea5, 0xc25b4e, 0x4e8a6b];
  for (let i = 0; i < 3; i++) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 60), dockMat);
    dock.position.set(300 + i * 18, 1.0, 250);
    dock.castShadow = true;
    marinaGroup.add(dock);
  }
  for (let i = 0; i < 5; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.6, 14),
      new THREE.MeshStandardMaterial({ color: hullColors[i % hullColors.length], roughness: 0.5 }),
    );
    hull.position.y = 0.6;
    hull.castShadow = true;
    boat.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.6, 5),
      new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.6 }),
    );
    cabin.position.set(0, 2.1, -1);
    boat.add(cabin);
    boat.position.set(292 + i * 16, 0.4, 236 + (i % 2) * 26);
    boat.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.12;
    marinaGroup.add(boat);
  }
  scene.add(marinaGroup);

  // --- The beacon tower at the end of the pier: the city's landmark.
  const beaconGroup = new THREE.Group();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc25b4e, roughness: 0.7 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.6, 34, 12), towerMat);
  tower.position.y = 17;
  tower.castShadow = true;
  beaconGroup.add(tower);
  for (const y of [10, 20, 30]) {
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.75, 2.2, 12), stripeMat);
    stripe.position.y = y;
    beaconGroup.add(stripe);
  }
  const lampRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 3.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.4 }),
  );
  lampRoom.position.y = 35.5;
  beaconGroup.add(lampRoom);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc94d, emissiveIntensity: 2.4 }),
  );
  lamp.position.y = 35.5;
  beaconGroup.add(lamp);
  // A rotating beam: a long translucent cone.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 12, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(60, 35.5, 0);
  const beamPivot = new THREE.Group();
  beamPivot.add(beam);
  beamPivot.position.y = 0;
  beaconGroup.add(beamPivot);
  beaconGroup.position.set(CONFIG.beacon.x, 1.5, CONFIG.beacon.z);
  scene.add(beaconGroup);

  // A warm lamp low over the pier, so the firefight under the beacon
  // reads at dusk instead of sinking into shadow.
  const pierLight = new THREE.PointLight(0xffc27a, 1.4, 130, 1.6);
  pierLight.position.set(CONFIG.pier.x0 + 64, 10, 0);
  scene.add(pierLight);

  // A few clouds: flat, slow-drifting puffs high above the city.
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xd9a0a8, roughness: 1, transparent: true, opacity: 0.55 });
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(14 + j * 5, 10, 8), cloudMat);
      puff.position.set(j * 16 - puffs * 7, j % 2 === 0 ? 0 : 4, (j % 3) * 8 - 8);
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set(-320 + i * 110, 150 + (i % 3) * 22, -260 + (i * 67) % 520);
    scene.add(cloud);
    clouds.push(cloud);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    renderer,
    sun,
    water,
    beaconGroup,
    beamPivot,
    lamp,
    clouds,

    /** Animate the sea, the beacon beam and the clouds. */
    update(dt, t) {
      water.position.y = 0.1 + Math.sin(t * 0.5) * 0.15;
      beamPivot.rotation.y = t * 0.45;
      lamp.material.emissiveIntensity = 2.0 + Math.sin(t * 3.0) * 0.7;
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.position.x += dt * (1.5 + i * 0.2);
        if (c.position.x > 420) c.position.x = -420;
      }
    },
  };
}
