// SOLMARINA — the mission campaign.
// Five missions tell the story of a newcomer rising in Solmarina against
// the Reef Kings, ending at the beacon tower. Each mission is a small
// state machine: a target, a check that runs every frame, and a reward.

import * as THREE from 'three';
import { CONFIG, dist2d } from './config.js';

/** The campaign, in order. Types: drive, escape, collect, shootout, finale. */
export const MISSIONS = [
  {
    id: 'neon-tide',
    title: 'Neon Tide',
    brief: 'Steal a car and drive the getaway to the warehouse.',
    type: 'drive',
    target: { x: CONFIG.warehouse.x, z: CONFIG.warehouse.z },
    targetName: 'the warehouse',
    reward: 400,
  },
  {
    id: 'pier-pressure',
    title: 'Pier Pressure',
    brief: 'The informant is in the car. Lose the heat, then reach the safe house.',
    type: 'escape',
    target: { x: CONFIG.safehouse.x, z: CONFIG.safehouse.z },
    targetName: 'the safe house',
    reward: 700,
  },
  {
    id: 'blackwater-deal',
    title: 'Blackwater Deal',
    brief: 'The Reef Kings hid five packages around the city. Collect them all.',
    type: 'collect',
    target: { x: 0, z: 0 },
    targetName: 'the packages',
    reward: 900,
  },
  {
    id: 'signal-fire',
    title: 'Signal Fire',
    brief: 'Five Reef Kings hold the pier under the beacon. Clear them out.',
    type: 'shootout',
    target: { x: CONFIG.beacon.x - 30, z: CONFIG.beacon.z },
    targetName: 'the pier',
    reward: 1200,
  },
  {
    id: 'final-tide',
    title: 'Final Tide',
    brief: 'Broadcast the evidence from the marina. Reach the docks and hold on.',
    type: 'finale',
    target: { x: CONFIG.docks.x, z: CONFIG.docks.z },
    targetName: 'the docks',
    reward: 2000,
  },
];

/** Package spots for the collect mission: five street intersections. */
const PACKAGE_SPOTS = [
  { x: -242, z: -8 },
  { x: 226, z: -164 },
  { x: -164, z: 226 },
  { x: 148, z: 148 },
  { x: 70, z: -242 },
];

/** Build the mission system. `systems` gives it the police and combat hooks. */
export function createMissions(scene, game, systems) {
  let index = game.missionIndex || 0;
  if (index >= MISSIONS.length) index = MISSIONS.length - 1;
  let active = false;
  let holdTimer = 0;
  let collected = 0;
  let packageMeshes = [];
  let gangSpawned = false;

  // The objective marker: a glowing pillar the player can see across the city.
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xffd24d,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 12, 1, true), markerMat);
  marker.visible = false;
  scene.add(marker);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.4, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.visible = false;
  scene.add(markerRing);

  function packageMesh(x, z) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.8, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0xaa7700, emissiveIntensity: 0.8, roughness: 0.4 }),
    );
    m.position.set(x, 0.9, z);
    m.castShadow = true;
    scene.add(m);
    return m;
  }

  function clearPackages() {
    for (const m of packageMeshes) scene.remove(m);
    packageMeshes = [];
  }

  function current() {
    return MISSIONS[index];
  }

  function objectiveText() {
    const m = current();
    if (!m) return 'Solmarina is yours. Free roam.';
    if (m.type === 'collect') return `${m.title}: collect the packages (${collected}/5) — ${m.brief}`;
    if (m.type === 'shootout') return `${m.title}: Reef Kings left: ${systems.combat.aliveCount()} — ${m.brief}`;
    if (m.type === 'finale') return `${m.title}: hold at the docks (${Math.ceil(holdTimer)}s) — ${m.brief}`;
    return `${m.title}: reach ${m.targetName} — ${m.brief}`;
  }

  function start(i) {
    index = i;
    game.missionIndex = i;
    active = true;
    holdTimer = 0;
    collected = 0;
    gangSpawned = false;
    clearPackages();
    systems.combat.clearGang();
    const m = current();
    if (!m) return;
    marker.position.set(m.target.x, 30, m.target.z);
    marker.visible = true;
    markerRing.position.set(m.target.x, 0.15, m.target.z);
    markerRing.visible = true;
    if (m.type === 'collect') {
      for (const s of PACKAGE_SPOTS) packageMeshes.push(packageMesh(s.x, s.z));
    }
    if (m.type === 'shootout') {
      systems.combat.spawnGang(5, m.target.x, m.target.z);
      gangSpawned = true;
    }
    if (m.type === 'escape') {
      systems.police.addHeat(2 * CONFIG.wanted.heatPerStar);
    }
    game.objective = objectiveText();
  }

  function complete() {
    const m = current();
    if (m) {
      game.money += m.reward;
      game.missionsDone.push(m.id);
      systems.audio.sting();
      systems.hud.toast(`${m.title} complete — $${m.reward}`);
    }
    active = false;
    marker.visible = false;
    markerRing.visible = false;
    clearPackages();
    index++;
    game.missionIndex = index;
    if (index < MISSIONS.length) {
      start(index);
    } else {
      game.objective = 'Campaign complete — Solmarina is yours. Free roam.';
    }
  }

  return {
    get index() {
      return index;
    },
    get current() {
      return current();
    },
    get active() {
      return active;
    },

    /** The objective marker's ground position, for the minimap. */
    get target() {
      const m = current();
      if (!m) return null;
      if (m.type === 'collect' && packageMeshes.length > 0) {
        let best = packageMeshes[0];
        let bestD = Infinity;
        for (const p of packageMeshes) {
          const d = dist2d(p.position.x, p.position.z, game.player.x, game.player.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return { x: best.position.x, z: best.position.z };
      }
      return { x: m.target.x, z: m.target.z };
    },

    start,
    objectiveText,

    update(dt) {
      if (!active) return;
      const m = current();
      if (!m) return;
      const px = game.player.x;
      const pz = game.player.z;
      // The marker pulses so it is easy to spot from far away.
      markerMat.opacity = 0.28 + Math.sin(performance.now() * 0.004) * 0.12;
      markerRing.rotation.z += dt * 0.8;
      if (m.type === 'drive' || m.type === 'escape') {
        const d = dist2d(px, pz, m.target.x, m.target.z);
        if (d < 9) {
          if (m.type === 'escape' && game.wanted > 0) {
            game.objective = `${m.title}: lose the heat first — ${m.brief}`;
            return;
          }
          complete();
        }
      } else if (m.type === 'collect') {
        for (let i = packageMeshes.length - 1; i >= 0; i--) {
          const p = packageMeshes[i];
          if (dist2d(px, pz, p.position.x, p.position.z) < 3) {
            scene.remove(p);
            packageMeshes.splice(i, 1);
            collected++;
            game.money += 100;
            systems.audio.beep();
          }
        }
        if (packageMeshes.length === 0 && collected >= 5) complete();
      } else if (m.type === 'shootout') {
        if (gangSpawned && systems.combat.aliveCount() === 0) complete();
      } else if (m.type === 'finale') {
        const d = dist2d(px, pz, m.target.x, m.target.z);
        if (d < 10) {
          holdTimer += dt;
          if (holdTimer >= 6) complete();
        } else {
          holdTimer = Math.max(0, holdTimer - dt * 2);
        }
      }
      game.objective = objectiveText();
    },
  };
}
