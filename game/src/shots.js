// SOLMARINA — screenshot poses.
// The game reads ?shot=N from the URL and sets up a deterministic scene
// for that screenshot, so each of the four shots shows the game at its
// best: the title over the dusk city, a drive, a police chase, and the
// pier firefight. The poses use only the game's own systems.

import { CONFIG } from './config.js';

/** Set up screenshot pose n (1-4) on the live game object. */
export function applyShot(n, game, systems) {
  const player = game.player;
  const car = systems.car;
  if (n === 1) {
    // Title: on foot on the pier at dusk, the beacon behind, the city
    // across the water. The start screen stays up over the scene. The
    // camera sits behind the player so the figure and the beacon share
    // the frame.
    player.mode = 'foot';
    player.x = CONFIG.pier.x0 + 26;
    player.z = CONFIG.pier.z + 2;
    player.heading = Math.PI / 2;
    player.yaw = Math.PI / 2;
    game.state = 'title';
    game.shotCamera = { x: player.x - 24, y: 10, z: player.z - 14, lookX: player.x + 30, lookY: 6, lookZ: player.z };
    systems.police.clear();
    return;
  }
  if (n === 2) {
    // Drive: the player in a red sports car on the coastal avenue (the
    // street centreline at z = 70) heading east toward the beach.
    player.mode = 'car';
    car.place(-200, 70, Math.PI / 2);
    car.speed = 30;
    player.x = car.x;
    player.z = car.z;
    player.heading = car.heading;
    game.state = 'playing';
    game.shotCamera = null;
    game.shotCamFollow = 'chase';
    systems.missions.start(0);
    systems.police.clear();
    return;
  }
  if (n === 3) {
    // Chase: three stars, two cruisers alongside the player's car on a
    // downtown avenue (the street centreline at z = -86), speed high.
    // The camera rides ahead of the car and looks back, so the pursuing
    // cruisers show in the frame behind it.
    player.mode = 'car';
    car.place(0, -86, Math.PI);
    car.speed = 38;
    player.x = car.x;
    player.z = car.z;
    player.heading = car.heading;
    game.state = 'playing';
    game.shotCamera = null;
    game.shotCamFollow = 'rear';
    systems.police.setHeat(3 * CONFIG.wanted.heatPerStar);
    systems.police.update(0.1, { x: car.x, z: car.z, heading: car.heading });
    systems.missions.start(1);
    return;
  }
  if (n === 4) {
    // Mission: the pier firefight. On foot on the pier itself, a short
    // way from the Reef Kings under the beacon, so the player, the gang
    // and the tower share one frame from a raised three-quarter view.
    player.mode = 'foot';
    player.x = CONFIG.pier.x0 + 42;
    player.z = CONFIG.pier.z;
    player.heading = Math.PI / 2;
    player.yaw = Math.PI / 2;
    game.state = 'playing';
    game.shotCamera = { x: player.x - 20, y: 12, z: player.z - 18, lookX: CONFIG.beacon.x - 10, lookY: 8, lookZ: CONFIG.beacon.z };
    game.shotCamFollow = null;
    game.ammo = 24;
    systems.police.clear();
    systems.missions.start(3);
    return;
  }
}

/** The four shots, in order, as shots.json lists them. */
export const SHOT_LIST = [
  { file: '1-title.jpg', shot: 1, title: 'Title screen over Solmarina at dusk' },
  { file: '2-drive.jpg', shot: 2, title: 'Driving the getaway through downtown' },
  { file: '3-chase.jpg', shot: 3, title: 'A three-star pursuit on the avenue' },
  { file: '4-mission.jpg', shot: 4, title: 'The pier firefight under the beacon' },
];
