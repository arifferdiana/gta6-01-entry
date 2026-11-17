// SOLMARINA — story missions and side jobs.
//
// createMissions(world) drives the mission layer. The world owns the
// simulation (player, cars, peds, cops, gang, wanted level); this module
// owns the story: which mission is active, what the current objective is,
// where the map markers point, and what the player earns.
//
// Contract with the world:
//   world.state.player  { x, z, angle, health, onFoot, car, speed }
//   world.state.cash, world.state.wanted, world.state.time
//   world.state.missionId, world.state.message, world.state.markers
//   world.state.missionsDone (array, created here if missing)
// The HUD reads world.state.missionId / .message / .markers every frame.
// The world calls missions.onEvent(name, data) for gameplay events:
//   'arrive'  { x, z }            player reached a marker
//   'steal'   { kind }            player stole a target vehicle
//   'kill'    { kind }            player eliminated a gang member / cop
//   'escape'  {}                  wanted level dropped to zero
//   'deliver' { kind }            player delivered a package / vehicle
// update(dt) is called every frame and also polls marker proximity, so a
// mission still advances even if the world never fires 'arrive'.
//
// Everything here is deterministic: taxi fares and package spots come from
// fixed tables and a tiny seeded counter, never from Math.random().

// Mission locations, all on roads or open ground in the real city grid
// (roads at -288, -216, -144, -72, 0, 72, 144, 216, 288; beach west,
// marina south). Markers must be reachable on foot, so none sits inside
// a building: every spot is on a road centre line, a plaza, the beach,
// the pier or a dock.
const LOCATIONS = {
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

// Ten hidden packages, one per landmark, spread across the five districts.
const HIDDEN_PACKAGES = [
  { x: -410, z: 40, label: 'Package 1 — Pier end' },
  { x: -330, z: 80, label: 'Package 2 — Beach lifeguard hut' },
  { x: -60, z: 318, label: 'Package 3 — Marina fuel dock' },
  { x: -36, z: 216, label: "Package 4 — Garage corner" },
  { x: 66, z: -6, label: 'Package 5 — Hotel pool' },
  { x: 216, z: -216, label: 'Package 6 — Park fountain' },
  { x: 216, z: 216, label: 'Package 7 — Suburbs cul-de-sac' },
  { x: -60, z: -144, label: 'Package 8 — Bank alley' },
  { x: 216, z: 120, label: 'Package 9 — Hideout shed' },
  { x: 0, z: 0, label: 'Package 10 — Downtown plaza' },
];

// Taxi drop-off points. Fares are picked in fixed rotation order so a
// session is reproducible; the payout cycles $20, $35, $50, $60.
const TAXI_STOPS = [
  { x: 72, z: -30, label: 'Palms Hotel' },
  { x: -300, z: 40, label: 'Solmarina Pier' },
  { x: 0, z: 312, label: 'Marina' },
  { x: 216, z: -216, label: 'Palm Park' },
  { x: 216, z: 216, label: 'Suburbs' },
  { x: 0, z: 0, label: 'Downtown plaza' },
];
const TAXI_FARES = [20, 35, 50, 60];

const ARRIVE_RADIUS = 14;

function dist(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function cloneMarker(loc, kind) {
  return { x: loc.x, z: loc.z, kind: kind || 'objective', label: loc.label };
}

// ---------------------------------------------------------------------------
// Mission definitions. Each mission is a small state machine: an ordered
// list of steps. A step has:
//   text    — the objective line shown in the HUD
//   marker  — { x, z, kind, label } or null (no marker for timed steps)
//   onEvent — (event, data, ctx) => true when this step is complete
//   onEnter — (ctx) => void, runs once when the step becomes current
//   update  — (dt, ctx) => true when this step is complete (timed steps)
// ctx gives the step access to the world and to mission helpers.
// ---------------------------------------------------------------------------

const MISSION_DEFS = [
  {
    id: 'first-fare',
    title: 'First Fare',
    reward: 300,
    brief: [
      'Mara: Rook. You owe me fifty grand.',
      'Mara: Drive. I will count the fares.',
      'Mara: Pick up the client. Hotel. No detours.',
    ],
    steps: [
      {
        text: 'Get in a car',
        marker: cloneMarker(LOCATIONS.starterCar, 'pickup'),
        onEvent(event, _data, ctx) {
          return event === 'enter-car';
        },
        update(_dt, ctx) {
          return !ctx.world.state.player.onFoot;
        },
      },
      {
        text: 'Pick up the client',
        marker: cloneMarker(LOCATIONS.client, 'pickup'),
        onEvent(event, _data, _ctx) {
          return event === 'arrive';
        },
      },
      {
        text: 'Drive the client to the Palms Hotel',
        marker: cloneMarker(LOCATIONS.hotel, 'dropoff'),
        onEvent(event, _data, _ctx) {
          return event === 'arrive';
        },
      },
    ],
    completeText: 'Fare complete. Mara is... almost impressed.',
  },
  {
    id: 'hot-wheels',
    title: 'Hot Wheels',
    reward: 800,
    brief: [
      'Mara: A Comet GT is parked downtown. Unlocked. Careless.',
      'Mara: Bring it to the garage. Do not scratch it.',
      'Mara: Scratch it and the scratch comes out of your cut.',
    ],
    steps: [
      {
        text: 'Steal the Comet GT downtown',
        marker: cloneMarker(LOCATIONS.comet, 'target'),
        onEvent(event, data, _ctx) {
          return event === 'steal' && (!data || data.kind === 'comet' || data.kind === 'car');
        },
      },
      {
        text: "Deliver the Comet GT to Rook's Garage",
        marker: cloneMarker(LOCATIONS.garage, 'dropoff'),
        onEvent(event, _data, _ctx) {
          return event === 'deliver' || event === 'arrive';
        },
      },
    ],
    completeText: 'Comet GT delivered. Clean. Mara pays up.',
  },
  {
    id: 'the-drop',
    title: 'The Drop',
    reward: 1200,
    brief: [
      'Mara: Package on the pier. On foot. Cars draw eyes.',
      'Mara: Walk it to the marina. Slow is smooth.',
      'Mara: The cops are bored tonight. Keep them that way.',
    ],
    steps: [
      {
        text: 'Collect the package at the pier (on foot)',
        marker: cloneMarker(LOCATIONS.packagePier, 'pickup'),
        onEvent(event, _data, ctx) {
          return event === 'arrive' && ctx.world.state.player.onFoot;
        },
        update(_dt, ctx) {
          const p = ctx.world.state.player;
          return p.onFoot && dist(p.x, p.z, LOCATIONS.packagePier.x, LOCATIONS.packagePier.z) < ARRIVE_RADIUS;
        },
      },
      {
        text: 'Deliver the package to the marina',
        marker: cloneMarker(LOCATIONS.marina, 'dropoff'),
        onEvent(event, _data, ctx) {
          return event === 'arrive' && ctx.world.state.player.onFoot;
        },
        update(_dt, ctx) {
          const p = ctx.world.state.player;
          return p.onFoot && dist(p.x, p.z, LOCATIONS.marina.x, LOCATIONS.marina.z) < ARRIVE_RADIUS;
        },
      },
    ],
    completeText: 'Package delivered. Nobody saw a thing.',
  },
  {
    id: 'heat-wave',
    title: 'Heat Wave',
    reward: 1500,
    brief: [
      'Mara: The Reef Kings set you up. PD is on you. Two stars.',
      'Mara: Sixty seconds. Lose them or reach the hideout.',
      'Mara: Do not get caught, Rook. I do not pay bail.',
    ],
    steps: [
      {
        text: 'Survive 60 seconds or reach the hideout',
        marker: cloneMarker(LOCATIONS.hideout, 'safehouse'),
        onEnter(ctx) {
          ctx.world.state.wanted = 2;
          ctx.mission.timer = 60;
          ctx.mission.elapsed = 0;
        },
        onEvent(event, _data, ctx) {
          if (event === 'escape') return true;
          if (event === 'arrive') return true;
          return false;
        },
        update(dt, ctx) {
          ctx.mission.elapsed += dt;
          const left = Math.max(0, Math.ceil(60 - ctx.mission.elapsed));
          ctx.mission.stepText = `Lose the cops — ${left}s left (or reach the hideout)`;
          if (ctx.world.state.wanted === 0) return true;
          if (ctx.mission.elapsed >= 60) return true;
          const p = ctx.world.state.player;
          return dist(p.x, p.z, LOCATIONS.hideout.x, LOCATIONS.hideout.z) < ARRIVE_RADIUS;
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
    reward: 2500,
    brief: [
      'Mara: The Reef Kings own the pier tonight. Five of them.',
      'Mara: Take it back. Loud is fine this time.',
      'Mara: Come home in one piece, Rook.',
    ],
    steps: [
      {
        text: 'Clear the Reef Kings at the pier (0/5)',
        marker: cloneMarker(LOCATIONS.pier, 'combat'),
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
    reward: 5000,
    brief: [
      'Mara: Meridian Bank. Armored van. Three stars waiting.',
      'Mara: Take the van. Lose the PD. Bring it to me.',
      'Mara: This one clears your debt, Rook. All of it.',
    ],
    steps: [
      {
        text: 'Steal the armored van at Meridian Bank',
        marker: cloneMarker(LOCATIONS.van, 'target'),
        onEvent(event, data, _ctx) {
          return event === 'steal' && (!data || data.kind === 'van' || data.kind === 'armored');
        },
      },
      {
        text: 'Escape the 3-star wanted level',
        marker: cloneMarker(LOCATIONS.hideout, 'safehouse'),
        onEnter(ctx) {
          ctx.world.state.wanted = 3;
          ctx.mission.escaped = false;
        },
        onEvent(event, _data, ctx) {
          if (event === 'escape') {
            ctx.mission.escaped = true;
            return true;
          }
          return false;
        },
        update(_dt, ctx) {
          if (ctx.world.state.wanted === 0) return true;
          const p = ctx.world.state.player;
          return dist(p.x, p.z, LOCATIONS.hideout.x, LOCATIONS.hideout.z) < ARRIVE_RADIUS;
        },
      },
      {
        text: "Deliver the van to Mara's office",
        marker: cloneMarker(LOCATIONS.maras, 'dropoff'),
        onEvent(event, _data, _ctx) {
          return event === 'deliver' || event === 'arrive';
        },
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

  let active = null; // { def, stepIndex, stepText, timer, elapsed, kills, escaped }
  let taxi = null; // { stage: 'pickup'|'dropoff', stop, fare, ped }
  let taxiCount = 0;
  const packagesFound = new Set();
  let briefLine = 0;
  let briefTimer = 0;

  function setObjective(text) {
    state.message = text;
  }

  function setMarkers(list) {
    state.markers = list;
  }

  function currentStep() {
    if (!active) return null;
    return active.def.steps[active.stepIndex] || null;
  }

  function enterStep() {
    const step = currentStep();
    if (!step) return;
    active.stepText = step.text;
    if (step.onEnter) step.onEnter({ world, mission: active });
    setMarkers(step.marker ? [step.marker] : []);
    setObjective(step.text);
  }

  function finishMission() {
    const def = active.def;
    state.cash += def.reward;
    state.missionsDone.push(def.id);
    if (def.onComplete) def.onComplete({ world, mission: active });
    setMarkers([]);
    setObjective('');
    state.missionId = null;
    state.message = def.completeText + `  +$${def.reward}`;
    active = null;
    briefLine = 0;
  }

  function advanceStep() {
    active.stepIndex += 1;
    if (active.stepIndex >= active.def.steps.length) {
      finishMission();
    } else {
      enterStep();
    }
  }

  function startBrief(def) {
    // Mara's briefing lines roll out one at a time through showMessage;
    // the first line goes out immediately, the rest in update().
    briefLine = 0;
    briefTimer = 0;
    if (def.brief.length > 0) {
      state.message = def.brief[0];
      briefLine = 1;
    }
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

    start(id) {
      const def = MISSION_DEFS.find((d) => d.id === id);
      if (!def) return false;
      if (state.missionsDone.includes(id)) return false;
      if (active) return false;
      if (id !== 'first-fare' && !state.missionsDone.includes('first-fare')) return false;
      active = { def, stepIndex: 0, stepText: def.steps[0].text, timer: 0, elapsed: 0, kills: 0, escaped: false };
      state.missionId = id;
      taxi = null;
      startBrief(def);
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
    // Taxi fare: repeatable after mission 1. Call when the player is
    // driving; a ped is "picked up" by reaching the pickup marker, then
    // the fare is paid on reaching the drop-off marker.
    startTaxi() {
      if (active || taxi) return false;
      if (!state.missionsDone.includes('first-fare')) return false;
      const stop = TAXI_STOPS[taxiCount % TAXI_STOPS.length];
      const fare = TAXI_FARES[taxiCount % TAXI_FARES.length];
      taxiCount += 1;
      // Pick-up point: a fixed kerb spot near the player's current area,
      // chosen from the stop list so it is always reachable.
      const pickup = TAXI_STOPS[(taxiCount + 2) % TAXI_STOPS.length];
      taxi = { stage: 'pickup', pickup, stop, fare };
      state.missionId = 'taxi';
      setMarkers([cloneMarker(pickup, 'pickup')]);
      setObjective(`Taxi: pick up the fare at ${pickup.label}`);
      state.message = `Taxi job — pick up at ${pickup.label} ($${fare} fare)`;
      return true;
    },

    // Hidden packages: 10 fixed spots. Call with the player's position
    // (or rely on update()'s proximity poll) to collect one.
    collectPackageAt(x, z) {
      for (let i = 0; i < HIDDEN_PACKAGES.length; i += 1) {
        if (packagesFound.has(i)) continue;
        const p = HIDDEN_PACKAGES[i];
        if (dist(x, z, p.x, p.z) < ARRIVE_RADIUS) {
          packagesFound.add(i);
          state.cash += 100;
          state.message = `Hidden package found! (${packagesFound.size}/10)  +$100`;
          return true;
        }
      }
      return false;
    },

    get hiddenPackageMarkers() {
      return HIDDEN_PACKAGES.filter((_, i) => !packagesFound.has(i)).map((p) => ({
        x: p.x, z: p.z, kind: 'package', label: p.label,
      }));
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
      if (state.player) {
        api.collectPackageAt(state.player.x, state.player.z);
      }

      // Taxi job proximity polling.
      if (taxi && state.player) {
        const target = taxi.stage === 'pickup' ? taxi.pickup : taxi.stop;
        if (dist(state.player.x, state.player.z, target.x, target.z) < ARRIVE_RADIUS) {
          if (taxi.stage === 'pickup') {
            taxi.stage = 'dropoff';
            setMarkers([cloneMarker(taxi.stop, 'dropoff')]);
            setObjective(`Taxi: drop the fare at ${taxi.stop.label}`);
            state.message = `Fare aboard — take them to ${taxi.stop.label}`;
          } else {
            state.cash += taxi.fare;
            state.message = `Fare complete!  +$${taxi.fare}`;
            taxi = null;
            state.missionId = active ? active.def.id : null;
            setMarkers([]);
            setObjective('');
          }
        }
      }

      // Active mission step polling (timers, proximity, on-foot checks).
      if (!active) return;
      const step = currentStep();
      if (!step) return;
      const ctx = { world, mission: active };
      if (step.update && step.update(dt, ctx)) {
        advanceStep();
        return;
      }
      // Proximity fallback for marker steps: arriving counts even if the
      // world never fired 'arrive'. Steps with a custom onEvent that
      // needs more than arrival (steal / kill / on-foot) still rely on
      // their own update() for the on-foot case; plain arrival steps
      // advance here.
      if (step.marker && !step.update) {
        const p = state.player;
        if (p && dist(p.x, p.z, step.marker.x, step.marker.z) < ARRIVE_RADIUS) {
          if (step.onEvent && step.onEvent('arrive', { x: p.x, z: p.z }, ctx)) {
            advanceStep();
          }
        }
      }
      // Keep the HUD objective line fresh (timers rewrite stepText).
      if (active) setObjective(active.stepText || step.text);
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
      if (step.onEvent(name, data || {}, ctx)) {
        advanceStep();
      }
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

export { LOCATIONS, HIDDEN_PACKAGES, TAXI_STOPS };
