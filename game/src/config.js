// SOLMARINA — shared tuning and world constants.
// Every number that more than one system needs lives here, so the city,
// the cars, the police and the missions all agree on the same Solmarina.

export const CONFIG = {
  // The city is a square street grid centred on the origin.
  worldSize: 640,
  halfWorld: 320,
  block: 64, // one city block, edge to edge
  roadWidth: 14, // street width between blocks
  sidewalk: 5, // pavement strip along each street

  // The east edge of the map is the coast: sand, then open water.
  beachX: 296, // where the sand starts
  waterX: 330, // where the water starts
  // The pier runs out over the water at z = 0.
  pier: { x0: 296, x1: 402, z: 0, width: 18 },
  // The beacon tower stands at the end of the pier.
  beacon: { x: 394, z: 0 },
  // Landmark addresses the missions use (all on street centrelines).
  hospital: { x: -242, z: -164 },
  safehouse: { x: -164, z: 226 },
  warehouse: { x: 226, z: -164 },
  marina: { x: 224, z: 224 },
  docks: { x: 256, z: 256 },

  // Dusk palette: a low orange sun over a purple-blue city.
  colors: {
    skyTop: 0x232f57,
    skyMid: 0x6b4368,
    horizon: 0xff9a5c,
    sun: 0xffb347,
    fog: 0x4a3a5e,
    road: 0x2b2b33,
    roadLine: 0xd8d8c8,
    sidewalk: 0x4d4d58,
    sand: 0xd9b380,
    water: 0x1d4e6b,
    grass: 0x2c4a28,
    buildingRoof: 0x3a3a44,
  },

  // On-foot player.
  player: {
    walkSpeed: 6,
    runSpeed: 11,
    radius: 0.7,
    health: 100,
    eyeHeight: 1.7,
  },

  // Cars: arcade handling, forgiving on purpose.
  car: {
    accel: 17,
    brake: 36,
    maxSpeed: 46, // about 165 km/h
    maxReverse: 15,
    steer: 2.1, // radians per second at full lock, scaled by speed
    radius: 2.1,
    trafficSpeed: 9,
    trafficCount: 14,
  },

  // Pedestrians.
  people: {
    count: 12,
    walkSpeed: 1.6,
    fleeSpeed: 4.5,
  },

  // Wanted level: heat points fill the meter; stars are heat / 20.
  wanted: {
    maxStars: 5,
    heatPerStar: 20,
    decayPerSec: 5, // heat lost while no police can see the player
    stealHeat: 25,
    shootHeat: 14,
    speedHeat: 5,
    killHeat: 30,
    cruiserPerStar: 1, // cruisers on the street per star, capped below
    maxCruisers: 5,
    roadblockAtStars: 3,
  },

  // Combat.
  combat: {
    magSize: 24,
    reserveAmmo: 120,
    reloadSeconds: 1.4,
    damage: 34,
    enemyHealth: 70,
    enemyDamage: 8,
    enemyRange: 55,
    enemyFireDelay: 1.1,
  },

  money: { start: 500, deathLoss: 0.1 },

  // How far the camera sits behind the player.
  camera: { footDistance: 8.5, footHeight: 4.0, carDistance: 13, carHeight: 5.8 },

  keys: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'],
    interact: ['KeyE'],
    brake: ['Space'],
    reload: ['KeyR'],
    mute: ['KeyM'],
  },
};

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Distance between two points on the ground plane. */
export function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
