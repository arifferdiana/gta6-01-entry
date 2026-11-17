// SOLMARINA — every tuning number and colour in one place.
// The city is a fixed-size grid world; nothing below depends on the screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** City layout: 8x8 blocks, each 60 units, separated by 12-unit roads. */
export const CITY = {
  blocks: 8,
  block: 60,
  road: 12,
  pitch: 72,
  /** Full width of the road grid, edge road centre to edge road centre. */
  size: 576,
  /** Half of size: the road grid spans [-288, 288] on both axes. */
  half: 288,
  /** Beach strip west of the grid, then open ocean. */
  beachWidth: 72,
  oceanWidth: 420,
};

/** Districts, as rectangles in world units (x east, z south; origin is the city centre). */
export const DISTRICTS = {
  downtown: { x0: -144, z0: -144, x1: 144, z1: 144 },
  beach: { x0: -360, z0: -288, x1: -288, z1: 288 },
  marina: { x0: -180, z0: 288, x1: 180, z1: 372 },
  suburbs: { x0: 144, z0: -288, x1: 288, z1: 288 },
  park: { x0: 144, z0: -288, x1: 288, z1: -144 },
};

export const PLAYER = {
  walkSpeed: 7,
  runSpeed: 11,
  radius: 0.7,
  health: 100,
  jumpSpeed: 8,
  gravity: 24,
  punchDamage: 12,
  punchRange: 2.2,
  punchCooldown: 0.45,
};

export const CAR = {
  accel: 22,
  brake: 34,
  reverseAccel: 12,
  maxSpeed: 42,
  sportMaxSpeed: 55,
  maxReverse: 12,
  turnRate: 1.9,
  grip: 6,
  radius: 1.6,
  /** Handbrake (Space while driving) multiplies lateral grip down and boosts turn. */
  handbrakeTurn: 2.6,
  /** Seconds a car keeps rolling after the driver leaves it. */
  coastTime: 1.2,
};

/** Traffic and pedestrians. */
export const TRAFFIC = {
  cars: 14,
  peds: 26,
  cruiseSpeed: 9,
  pedSpeed: 1.6,
  spawnRadius: 220,
  despawnRadius: 260,
};

export const POLICE = {
  cars: 4,
  cruiseSpeed: 13,
  chaseSpeed: 30,
  ramDamage: 8,
  /** Wanted stars decay one level per this many seconds of staying out of sight. */
  decaySeconds: 25,
  /** A cop that cannot reach the player for this long gives up the chase. */
  giveUpSeconds: 20,
};

export const COMBAT = {
  pistolDamage: 25,
  pistolRange: 55,
  pistolMagazine: 12,
  pistolReload: 1.1,
  pistolCooldown: 0.22,
  spread: 0.03,
  copDamage: 9,
  copRange: 38,
  copCooldown: 0.9,
  gangDamage: 11,
  gangRange: 34,
  gangCooldown: 1.1,
};

export const WANTED_MAX = 5;
/** Wanted stars earned by each crime. */
export const HEAT = {
  punchPed: 1,
  shoot: 1,
  killPed: 2,
  killCop: 2,
  stealCar: 1,
};

export const MISSIONS = {
  /** Cash paid for the first story mission; later missions scale from here. */
  basePayout: 500,
  payoutStep: 250,
};

/** Prices at the hospital / garage / gun shop, in cash. */
export const PRICES = {
  heal: 150,
  repair: 200,
  pistolAmmo: 80,
  armour: 300,
};

export const PALETTE = {
  skyTop: '#2f7fc9',
  skyHorizon: '#ffd9a0',
  sun: '#fff3c4',
  fog: '#f7c98a',
  ground: '#3a3f46',
  road: '#33373d',
  roadLine: '#e8d27a',
  sidewalk: '#b9ac93',
  sand: '#ecd3a0',
  ocean: '#1e9db4',
  oceanDeep: '#0f6f8f',
  grass: '#5da24a',
  building: ['#e8b48a', '#d99a6c', '#f0cfa8', '#c98d7a', '#e6d3b3', '#b7c4c9'],
  glass: '#7fb8d8',
  palmTrunk: '#8a6b4a',
  palmLeaf: '#3f9e4d',
  player: '#e84c3d',
  playerPants: '#2b3a55',
  cop: '#24407a',
  gang: '#7a2e8f',
  beacon: '#ffd94d',
  pier: '#8a6b4a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the save lives between visits (this browser only). */
export const SAVE_KEY = 'solmarina.save.v1';
