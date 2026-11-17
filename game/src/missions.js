// SOLMARINA — story missions, taxi fares and hidden packages.
//
// createMissions(world) is the story layer. The world owns the
// simulation (player, cars, peds, cops, gang, wanted level); this module
// owns the narrative: which mission is active, what the current objective
// is, where the markers point, and what the player earns.
//
// Story: Jax "Rook" Marlowe, a getaway driver, owes $50,000 to the fixer
// Mara Voss. The Reef Kings gang and the Solmarina PD stand in his way.
// Six story missions pay out $500, $2,000, $5,000, $9,000, $12,000 and
// $21,500 — $50,000 in total, enough to clear the debt. Taxi fares and
// the ten hidden packages ($100 each) are side income on top.
//
// Contract with the world (see world.js):
//   world.state.player  { x, z, angle, health, onFoot, car, speed }
//   world.state.cash, world.state.wanted, world.state.time
//   world.state.missionId, world.state.message, world.state.markers
//   world.state.missionsDone (array, created here if missing)
// The world calls missions.onEvent(name, data) for gameplay events:
//   'enter-car', 'steal', 'arrive', 'deliver', 'interact', 'kill',
//   'escape', 'wasted', 'busted'.
// update(dt) runs every frame and also polls marker proximity, so a
// mission still advances even if the world never fires 'arrive'.
//
// Everything here is deterministic: taxi fares and package spots come
// from fixed tables and a rotating counter, never from Math.random().

// All mission spots sit on road centre lines, plazas, the beach, the pier
// or a dock — never inside a building — so every marker is reachable on
// foot. Roads run at -288, -216, -144, -72, 0, 72, 144, 216, 288.
export const LOCATIONS = {
  downtown: { x: 0, z: 0, label: 'Downtown' },
  starterCar: { x: 7.6, z: 112, label: 'Your first car' },
  hotel: { x: 72, z: -30, label: 'Palms Hotel' },
  garage: { x: -72, z: 216, label: "Rook's Garage" },
  pier: { x: -300, z: 40, label: 'Solmarina Pier' },
  marina: { x: 0, z: 312, label: 'Marina' },
  hideout: { x: 216, z: 144, label: 'Hideout' },
  suburbs: { x: 216, z: 216, label: 'Suburbs' },
  park: { x: 216, z: -216, label: 'Palm Park' },
  bank: { x: -60, z: -144, label: 'Meridian Bank' },
  beach: { x: -330, z: 80, label: 'Beach' },
  client: { x: -36, z: 72, label: 'Client' },
  comet: { x: 60, z: 72, label: 'Comet GT' },
  packagePier: { x: -300, z: 40, label: 'Package' },
  van: { x: -60, z: -144, label: 'Armored Van' },
  maras: { x: -144, z: -144, label: "Mara's Office" },
};

// Ten hidden packages, one per landmark, spread across the districts.
export const HIDDEN_PACKAGES = [
  { x: -410, z: 40, label: 'Package 1 — Pier end' },
  { x: -330, z: 80, label: 'Package 2 — Beach lifeguard hut' },
  { x: -60, z: 318, label: 'Package 3 — Marina fuel dock' },
  { x: -36, z: 216, label: 'Package 4 — Garage corner' },
  { x: 66, z: -6, label: 'Package 5 — Hotel pool' },
  { x: 216, z: -216, label: 'Package 6 — Park fountain' },
  { x: 216, z: 216, label: 'Package 7 — Suburbs cul-de-sac' },
  { x: -60, z: -144, label: 'Package 8 — Bank alley' },
  { x: 216, z: 120, label: 'Package 9 — Hideout shed' },
  { x: 0, z: 0, label: 'Package 10 — Downtown plaza' },
];

// Taxi drop-off points. Fares are picked in fixed rotation so a session
// is reproducible; the payout cycles $20, $35, $50, $60.
export const TAXI_STOPS = [
  { x: 72, z: -30, label: 'Palms Hotel' },
  { x: -300, z: 40, label: 'Solmarina Pier' },
  { x: 0, z: 312, label: 'Marina' },
  { x: 216, z: -216, label: 'Palm Park' },
  { x: 216, z: 216, label: 'Suburbs' },
  { x: 0, z: 0, label: 'Downtown plaza' },
];

const TAXI_FARES = [20, 35, 50, 60];
const ARRIVE_RADIUS = 14;
const PACKAGE_REWARD = 100;
const DEBT_GOAL = 50000;

function dist(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function nearPlayer(world, x, z) {
  const p = world.state.player;
  return !!p && dist(p.x, p.z, x, z) < ARRIVE_RADIUS;
}

function markerFor(loc, kind) {
  return { x: loc.x, z: loc.z, kind: kind || 'objective', label: loc.label };
}

// ---------------------------------------------------------------------------
// Mission definitions. A mission is an ordered list of steps. A step has:
//   text    — the objective line shown in the HUD
//   marker  — { x, z, kind, label } or null (no marker for timed steps)
//   onEnter — (ctx) => void, runs once when the step becomes current
//   onEvent — (event, data, ctx) => true when this step is complete
//   tick    — (dt, ctx) => true when this step is complete (timed / polled)
// ctx gives a step access to the world and to the mission's scratch state.
// ---------------------------------------------------------------------------

const MISSION_DEFS = [
  {
    id: 'first-fare',
    title: 'First Fare',
    reward: 500,
    brief: [
      'Mara: Rook. You owe me fifty grand.',
      'Mara: Drive. I will count the fares.',
      'Mara: Pick up the client. Hotel. No detours.',
    ],
    steps: [
      {
        text: 'Get in a car',
        marker: markerFor(LOCATIONS.starterCar, 'pickup'),
        onEvent(event) { return event === 'enter-car'; },
        tick(_dt, ctx) { return !ctx.world.state.player.onFoot; },
      },
      {
        text: 'Pick up the client',
        marker: markerFor(LOCATIONS.client, 'pickup'),
        onEvent(event) { return event === 'arrive'; },
      },
      {
        text: 'Drive the client to the Palms Hotel',
        marker: markerFor(LOCATIONS.hotel, 'dropoff'),
        onEvent(event) { return event === 'arrive'; },
      },
    ],
    completeText: 'Fare complete. Mara is... almost impressed.',
  },
  {
    id: 'hot-wheels',
    title: 'Hot Wheels',
    reward: 2000,
    brief: [
      'Mara: A Comet GT is parked downtown. Unlocked. Careless.',
      'Mara: Bring it to the garage. Do not scratch it.',
      'Mara: Scratch it and the scratch comes out of your cut.',
    ],
    steps: [
      {
        text: 'Steal the Comet GT downtown',
        marker: markerFor(LOCATIONS.comet, 'target'),
        onEvent(event, data) {
          return event === 'steal'
            && (!data || data.kind === 'comet' || data.kind === 'car');
        },
      },
      {
        text: "Deliver the Comet GT to Rook's Garage",
        marker: markerFor(LOCATIONS.garage, 'dropoff'),
        onEvent(event) { return event === 'deliver' || event === 'arrive'; },
      },
    ],
    completeText: 'Comet GT delivered. Clean. Mara pays up.',
  },
  {
    id: 'the-drop',
    title: 'The Drop',
    reward: 5000,
    brief: [
      'Mara: Package on the pier. On foot. Cars draw eyes.',
      'Mara: Walk it to the marina. Slow is smooth.',
      'Mara: The cops are bored tonight. Keep them that way.',
    ],
    steps: [
      {
        text: 'Collect the package at the pier (on foot)',
        marker: markerFor(LOCATIONS.packagePier, 'pickup'),
        onEvent(event, _data, ctx) {
          return event === 'arrive' && ctx.world.state.player.onFoot;
        },
        tick(_dt, ctx) {
          const p = ctx.world.state.player;
          return p.onFoot
            && dist(p.x, p.z, LOCATIONS.packagePier.x, LOCATIONS.packagePier.z) < ARRIVE_RADIUS;
        },
      },
      {
        text: 'Deliver the package to the marina',
        marker: markerFor(LOCATIONS.marina, 'dropoff'),
        onEvent(event, _data, ctx) {
          return event === 'arrive' && ctx.world.state.player.onFoot;
        },
        tick(_dt, ctx) {
          const p = ctx.world.state.player;
          return p.onFoot
            && dist(p.x, p.z, LOCATIONS.marina.x, LOCATIONS.marina.z) < ARRIVE_RADIUS;
        },
      },
    ],
    completeText: 'Package delivered. Nobody saw a thing.',
  },
  {
    id: 'heat-wave',
    title: 'Heat Wave',
    reward: 9000,
    brief: [
      'Mara: The Reef Kings set you up. PD is on you. Two stars.',
      'Mara: Sixty seconds. Lose them or reach the hideout.',
      'Mara: Do not get caught, Rook. I do not pay bail.',
    ],
    steps: [
      {
        text: 'Survive 60 seconds or reach the hideout',
        marker: markerFor(LOCATIONS.hideout, 'safehouse'),
        onEnter(ctx) {
          // Forcing state.wanted is the one write the world expects from
          // missions: the police adopt a changed state.wanted each step.
          ctx.world.state.wanted = 2;
          ctx.mission.elapsed = 0;
        },
        onEvent(event) {
          return event === 'escape' || event === 'arrive';
        },
        tick(dt, ctx) {
          ctx.mission.elapsed += dt;
          const left = Math.max(0, Math.ceil(60 - ctx.mission.elapsed));
          ctx.mission.stepText = `Lose the cops — ${left}s left (or reach the hideout)`;
          if (ctx.world.state.wanted === 0) return true;
          if (ctx.mission.elapsed >= 60) return true;
          return nearPlayer(ctx.world, LOCATIONS.hideout.x, LOCATIONS.hideout.z);
        },
      },
    ],
    completeText: 'Heat gone. Mara wires the money.',
    onComplete(ctx) {
      ctx.world.state.wanted = 0;
    },
  },
  {
    id: 'pier-pressure',
    title: 'Pier Pressure',
    reward: 12000,
    brief: [
      'Mara: The Reef Kings own the pier tonight. Five of them.',
      'Mara: Take it back. Loud is fine this time.',
      'Mara: Come home in one piece, Rook.',
    ],
    steps: [
      {
        text: 'Clear the Reef Kings at the pier (0/5)',
        marker: markerFor(LOCATIONS.pier, 'combat'),
        onEnter(ctx) {
          ctx.mission.kills = 0;
        },
        onEvent(event, data, ctx) {
          if (event !== 'kill') return false;
          if (data && data.kind && data.kind !== 'gang') return false;
          ctx.mission.kills += 1;
          ctx.mission.stepText = `Clear the Reef Kings at the pier (${ctx.mission.kills}/5)`;
          return ctx.mission.kills >= 5;
        },
      },
    ],
    completeText: 'The pier is yours again. The Kings will remember.',
  },
  {
    id: 'big-score',
    title: 'The Big Score',
    reward: 21500,
    brief: [
      'Mara: Meridian Bank. Armored van. Three stars waiting.',
      'Mara: Take the van. Lose the PD. Bring it to me.',
      'Mara: This one clears your debt, Rook. All of it.',
    ],
    steps: [
      {
        text: 'Steal the armored van at Meridian Bank',
        marker: markerFor(LOCATIONS.van, 'target'),
        onEvent(event, data) {
          return event === 'steal'
            && (!data || data.kind === 'van' || data.kind === 'armored');
        },
      },
      {
        text: 'Escape the 3-star wanted level',
        marker: markerFor(LOCATIONS.hideout, 'safehouse'),
        onEnter(ctx) {
          ctx.world.state.wanted = 3;
        },
        onEvent(event) {
          return event === 'escape';
        },
        tick(_dt, ctx) {
          if (ctx.world.state.wanted === 0) return true;
          return nearPlayer(ctx.world, LOCATIONS.hideout.x, LOCATIONS.hideout.z);
        },
      },
      {
        text: "Deliver the van to Mara's office",
        marker: markerFor(LOCATIONS.maras, 'dropoff'),
        onEvent(event) { return event === 'deliver' || event === 'arrive'; },
      },
    ],
    completeText: 'Debt cleared. Solmarina is yours now, Rook.',
    onComplete(ctx) {
      ctx.world.state.wanted = 0;
      ctx.world.state.storyComplete = true;
    },
  },
];

// ---------------------------------------------------------------------------
// createMissions
// ---------------------------------------------------------------------------

export function createMissions(world) {
  const state = world.state;
  if (!Array.isArray(state.missionsDone)) state.missionsDone = [];
  if (!Array.isArray(state.markers)) state.markers = [];
  if (typeof state.cash !== 'number') state.cash = 0;

  // Active mission scratch state. stepText is the live objective line;
  // timed steps rewrite it every frame (the heat-wave countdown).
  let active = null;
  let taxi = null; // { stage: 'pickup' | 'dropoff', pickup, stop, fare }
  let taxiCount = 0;
  const packagesFound = new Set();
  let briefLine = 0;
  let briefTimer = 0;

  function currentStep() {
    if (!active) return null;
    return active.def.steps[active.stepIndex] || null;
  }

  function enterStep() {
    const step = currentStep();
    if (!step) return;
    active.stepText = step.text;
    if (step.onEnter) step.onEnter({ world, mission: active });
    state.markers = step.marker ? [step.marker] : [];
    state.message = step.text;
  }

  function finishMission() {
    const def = active.def;
    state.cash += def.reward;
    state.missionsDone.push(def.id);
    if (def.onComplete) def.onComplete({ world, mission: active });
    state.markers = [];
    state.missionId = null;
    state.message = `${def.completeText}  +$${def.reward}`;
    active = null;
    briefLine = 0;
  }

  function advanceStep() {
    active.stepIndex += 1;
    if (active.stepIndex >= active.def.steps.length) finishMission();
    else enterStep();
  }

  const api = {
    list: MISSION_DEFS.map((d) => ({
      id: d.id,
      title: d.title,
      reward: d.reward,
      done: state.missionsDone.includes(d.id),
    })),

    get active() {
      return active ? active.def.id : null;
    },

    // Read-only views for the HUD / save system.
    get activeMission() {
      return active;
    },
    get missionsDone() {
      return state.missionsDone.slice();
    },
    get packagesFound() {
      return Array.from(packagesFound);
    },
    get taxiActive() {
      return taxi !== null;
    },
    get debtGoal() {
      return DEBT_GOAL;
    },

    start(id) {
      const def = MISSION_DEFS.find((d) => d.id === id);
      if (!def) return false;
      if (state.missionsDone.includes(id)) return false;
      if (active) return false;
      // The story is linear: mission 1 must be done before the rest.
      if (id !== 'first-fare' && !state.missionsDone.includes('first-fare')) return false;
      active = {
        def, stepIndex: 0, stepText: def.steps[0].text,
        elapsed: 0, kills: 0,
      };
      state.missionId = id;
      taxi = null;
      // Mara's briefing rolls out one line at a time in update().
      briefLine = def.brief.length > 0 ? 1 : 0;
      briefTimer = 0;
      if (def.brief.length > 0) state.message = def.brief[0];
      enterStep();
      return true;
    },

    // Start the next unplayed story mission, in order.
    startNext() {
      const next = MISSION_DEFS.find((d) => !state.missionsDone.includes(d.id));
      if (!next) return false;
      return api.start(next.id);
    },

    // --- Side jobs -------------------------------------------------------
    // Taxi fare: repeatable after mission 1. The player picks up a fare
    // at the pickup marker (while driving), then earns the fare on
    // reaching the drop-off marker. Proximity is polled in update().
    startTaxi() {
      if (active || taxi) return false;
      if (!state.missionsDone.includes('first-fare')) return false;
      const stop = TAXI_STOPS[taxiCount % TAXI_STOPS.length];
      const fare = TAXI_FARES[taxiCount % TAXI_FARES.length];
      taxiCount += 1;
      // Pick-up point: a fixed kerb spot from the stop list, always
      // reachable, offset from the drop-off so the fare is a real drive.
      const pickup = TAXI_STOPS[(taxiCount + 2) % TAXI_STOPS.length];
      taxi = { stage: 'pickup', pickup, stop, fare };
      state.missionId = 'taxi';
      state.markers = [markerFor(pickup, 'pickup')];
      state.message = `Taxi job — pick up at ${pickup.label} ($${fare} fare)`;
      return true;
    },

    // Hidden packages: 10 fixed spots, $100 each. Call with the player's
    // position (update() polls this every frame, mission or not).
    collectPackageAt(x, z) {
      for (let i = 0; i < HIDDEN_PACKAGES.length; i += 1) {
        if (packagesFound.has(i)) continue;
        const p = HIDDEN_PACKAGES[i];
        if (dist(x, z, p.x, p.z) < ARRIVE_RADIUS) {
          packagesFound.add(i);
          state.cash += PACKAGE_REWARD;
          state.message = `Hidden package found! (${packagesFound.size}/10)  +$${PACKAGE_REWARD}`;
          return true;
        }
      }
      return false;
    },

    get hiddenPackageMarkers() {
      return HIDDEN_PACKAGES
        .filter((_, i) => !packagesFound.has(i))
        .map((p) => ({ x: p.x, z: p.z, kind: 'package', label: p.label }));
    },

    update(dt) {
      // Roll out Mara's briefing lines, one every 3 seconds.
      if (active && briefLine > 0 && briefLine < active.def.brief.length) {
        briefTimer += dt;
        if (briefTimer >= 3) {
          briefTimer = 0;
          state.message = active.def.brief[briefLine];
          briefLine += 1;
        }
      }

      // Hidden packages are always collectable, mission or not.
      if (state.player) api.collectPackageAt(state.player.x, state.player.z);

      // Taxi job proximity polling.
      if (taxi && state.player) {
        const target = taxi.stage === 'pickup' ? taxi.pickup : taxi.stop;
        if (dist(state.player.x, state.player.z, target.x, target.z) < ARRIVE_RADIUS) {
          if (taxi.stage === 'pickup') {
            taxi.stage = 'dropoff';
            state.markers = [markerFor(taxi.stop, 'dropoff')];
            state.message = `Fare aboard — take them to ${taxi.stop.label}`;
          } else {
            state.cash += taxi.fare;
            state.message = `Fare complete!  +$${taxi.fare}`;
            taxi = null;
            state.missionId = active ? active.def.id : null;
            state.markers = [];
            state.message = '';
          }
        }
      }

      // Active mission step polling (timers, proximity, on-foot checks).
      if (!active) return;
      const step = currentStep();
      if (!step) return;
      const ctx = { world, mission: active };
      if (step.tick && step.tick(dt, ctx)) {
        advanceStep();
        return;
      }
      // Proximity fallback for plain marker steps: arriving counts even
      // if the world never fired 'arrive'. Steps with a tick of their own
      // (timed / on-foot steps) already handled arrival above.
      if (step.marker && !step.tick && state.player) {
        if (dist(state.player.x, state.player.z, step.marker.x, step.marker.z) < ARRIVE_RADIUS) {
          if (step.onEvent && step.onEvent('arrive', { x: state.player.x, z: state.player.z }, ctx)) {
            advanceStep();
            return;
          }
        }
      }
      // Keep the HUD objective line fresh (timed steps rewrite stepText).
      if (active) state.message = active.stepText || step.text;
    },

    onEvent(name, data) {
      // Taxi jobs only care about arrival, handled in update().
      if (!active) return;
      const step = currentStep();
      if (!step || !step.onEvent) return;
      const ctx = { world, mission: active };
      if (name === 'arrive' && step.marker && state.player) {
        // Only count arrivals at the current marker, not anywhere.
        if (dist(state.player.x, state.player.z, step.marker.x, step.marker.z) >= ARRIVE_RADIUS) return;
      }
      if (step.onEvent(name, data || {}, ctx)) advanceStep();
    },

    // Restore save data (snapshot.missionsDone, snapshot.packagesFound).
    restore(saved) {
      if (!saved) return;
      if (Array.isArray(saved.missionsDone)) {
        state.missionsDone = saved.missionsDone.slice();
      }
      if (Array.isArray(saved.packagesFound)) {
        saved.packagesFound.forEach((i) => packagesFound.add(i));
      }
      if (typeof saved.taxiCount === 'number') taxiCount = saved.taxiCount;
    },

    // Snapshot fragment for saveGame().
    snapshot() {
      return {
        missionsDone: state.missionsDone.slice(),
        packagesFound: Array.from(packagesFound),
        taxiCount,
      };
    },
  };

  return api;
}
