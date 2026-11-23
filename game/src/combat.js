// SOLMARINA — combat: fists and pistol, enemy return fire, pickups.
// Original code for this game. No Rockstar / GTA names, art or assets.
//
// The pistol is a hitscan raycast toward the crosshair (the camera's aim
// direction) against people and cars in range; punching is a short arc in
// front of the player. Gang members and (at 2+ stars) foot cops shoot back
// with distance-based inaccuracy. Health and ammo pickups sit at fixed
// spots and respawn after a minute.
//
// NOTE ON RENDERING: render.js draws muzzle flashes from state.flashes
// (the world copies combat's flash there) and owns every other mesh. The
// pickup meshes built here live in pickupGroup, exposed for main.js to add
// to the scene; the simulation itself is the plain pickup objects.

import * as THREE from 'three';
import { COMBAT, PLAYER } from './config.js';
import { createRandom } from './random.js';

export const WEAPONS = {
  fists: {
    name: 'Fists', damage: PLAYER.punchDamage, range: PLAYER.punchRange,
    arc: 1.05, rate: PLAYER.punchCooldown, magSize: Infinity, reloadTime: 0,
  },
  pistol: {
    name: 'Pistol', damage: COMBAT.pistolDamage, range: COMBAT.pistolRange,
    arc: 0, rate: COMBAT.pistolCooldown, magSize: COMBAT.pistolMagazine,
    reloadTime: COMBAT.pistolReload,
  },
};

const PICKUP_RESPAWN = 60;

/** Tiny seeded RNG (mulberry32) from the shared random module, used only when no random() is passed in. */
const fallbackRandom = createRandom;

function call(audio, name, ...args) {
  if (audio && typeof audio[name] === 'function') audio[name](...args);
}

/** Distance along a 2D ray to a circle, or null when the ray misses. */
function rayHit2D(ox, oz, dx, dz, tx, tz, radius, range) {
  const rx = tx - ox;
  const rz = tz - oz;
  const t = rx * dx + rz * dz;
  if (t < 0 || t > range) return null;
  const cx = ox + dx * t;
  const cz = oz + dz * t;
  if (Math.hypot(tx - cx, tz - cz) > radius) return null;
  return t;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function buildPickupMesh(kind) {
  const group = new THREE.Group();
  if (kind === 'health') {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f6 });
    const red = new THREE.MeshLambertMaterial({ color: 0xd43d2a });
    const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), white);
    boxMesh.position.y = 0.55;
    group.add(boxMesh);
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), red);
    crossA.position.set(0, 0.55, 0.29);
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.06), red);
    crossB.position.set(0, 0.55, 0.29);
    group.add(crossB);
  } else {
    const olive = new THREE.MeshLambertMaterial({ color: 0x5a6b2f });
    const brass = new THREE.MeshLambertMaterial({ color: 0xf2c94c });
    const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), olive);
    boxMesh.position.y = 0.45;
    group.add(boxMesh);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.54), brass);
    top.position.y = 0.64;
    group.add(top);
  }
  return group;
}

/**
 * createCombat(audio, random?)
 *
 * state: { weapon:'fists'|'pistol', ammo, reserve, reloading, reloadTimer,
 *   shootTimer, punchTimer, flashTimer, flash:{x,y,z}, kills }.
 * pickups: [{ kind:'health'|'ammo', x, z, mesh, active, respawnTimer }].
 *
 * The ctx passed to shoot/punch/update is:
 *   { origin:{x,y,z}, angle, player:{x,z,onFoot},
 *     peds, cops, gang, cars, wanted,
 *     onKill(target), onHit(target), onShoot(origin),
 *     onEnemyShoot(origin), onPlayerDamage(amount, from),
 *     onPickup(kind, pickup) }
 */
export function createCombat(audio, random) {
  const rng = typeof random === 'function' ? random : fallbackRandom(0x5eed);
  const state = {
    weapon: 'pistol', ammo: COMBAT.pistolMagazine, reserve: 48,
    reloading: false, reloadTimer: 0,
    shootTimer: 0, punchTimer: 0,
    flashTimer: 0, flash: { x: 0, y: 1.5, z: 0 },
    kills: 0,
  };
  const pickups = [];
  const pickupGroup = new THREE.Group();
  let pickupSpin = 0;

  function damagePerson(target, amount, ctx) {
    target.health -= amount;
    if (target.health <= 0 && !target.dead) {
      target.dead = true;
      state.kills += 1;
      if (ctx && typeof ctx.onKill === 'function') ctx.onKill(target);
      return true;
    }
    return false;
  }

  function damageCar(target, amount, ctx) {
    target.health -= amount;
    if (target.health <= 0 && !target.disabled) {
      target.disabled = true;
      target.speed = 0;
      if (ctx && typeof ctx.onCarDisabled === 'function') ctx.onCarDisabled(target);
      return true;
    }
    return false;
  }

  function nearestTarget(origin, angle, ctx) {
    const spread = (rng() * 2 - 1) * (COMBAT.spread || 0.03);
    const a = angle + spread;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const range = WEAPONS.pistol.range;
    let best = null;
    let bestT = Infinity;
    const people = []
      .concat(ctx.peds || [], ctx.cops || [], ctx.gang || []);
    for (const target of people) {
      if (!target || target.dead) continue;
      const t = rayHit2D(origin.x, origin.z, dx, dz, target.x, target.z, 0.75, range);
      if (t !== null && t < bestT) {
        bestT = t;
        best = target;
      }
    }
    for (const target of ctx.cars || []) {
      if (!target || target.disabled) continue;
      const t = rayHit2D(origin.x, origin.z, dx, dz, target.x, target.z, 2.1, range);
      if (t !== null && t < bestT) {
        bestT = t;
        best = target;
      }
    }
    return best;
  }

  function shoot(ctx) {
    if (state.weapon !== 'pistol') return punch(ctx);
    if (state.reloading || state.shootTimer > 0) return null;
    if (state.ammo <= 0) {
      reload();
      return { empty: true };
    }
    state.ammo -= 1;
    state.shootTimer = WEAPONS.pistol.rate;
    state.flashTimer = 0.07;
    state.flash.x = ctx.origin.x + Math.sin(ctx.angle) * 1.2;
    state.flash.y = ctx.origin.y;
    state.flash.z = ctx.origin.z + Math.cos(ctx.angle) * 1.2;
    call(audio, 'gunshot');
    if (ctx && typeof ctx.onShoot === 'function') ctx.onShoot(ctx.origin);
    const target = nearestTarget(ctx.origin, ctx.angle, ctx);
    if (!target) return { hit: false };
    if (target.kind === 'ped' || target.kind === 'cop' || target.kind === 'gang') {
      damagePerson(target, WEAPONS.pistol.damage, ctx);
    } else {
      damageCar(target, WEAPONS.pistol.damage, ctx);
    }
    if (ctx && typeof ctx.onHit === 'function') ctx.onHit(target);
    return { hit: true, target };
  }

  function punch(ctx) {
    if (state.punchTimer > 0) return null;
    state.punchTimer = WEAPONS.fists.rate;
    call(audio, 'punch');
    if (ctx && typeof ctx.onShoot === 'function') ctx.onShoot(ctx.origin);
    const hits = [];
    const people = [].concat(ctx.peds || [], ctx.cops || [], ctx.gang || []);
    for (const target of people) {
      if (!target || target.dead) continue;
      const dx = target.x - ctx.origin.x;
      const dz = target.z - ctx.origin.z;
      const d = Math.hypot(dx, dz);
      if (d > WEAPONS.fists.range) continue;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), ctx.angle)) > WEAPONS.fists.arc) continue;
      // Knockback: shove the target away from the player.
      const push = 1.4;
      target.x += (dx / (d || 1)) * push;
      target.z += (dz / (d || 1)) * push;
      damagePerson(target, WEAPONS.fists.damage, ctx);
      hits.push(target);
    }
    return { hit: hits.length > 0, targets: hits };
  }

  function reload() {
    if (state.weapon !== 'pistol' || state.reloading) return false;
    if (state.ammo >= WEAPONS.pistol.magSize || state.reserve <= 0) return false;
    state.reloading = true;
    state.reloadTimer = WEAPONS.pistol.reloadTime;
    call(audio, 'click');
    return true;
  }

  function switchWeapon(name) {
    if (!WEAPONS[name]) return false;
    if (state.weapon === name) return true;
    state.weapon = name;
    state.reloading = false;
    state.reloadTimer = 0;
    call(audio, 'click');
    return true;
  }

  function giveAmmo(n) {
    state.reserve += n;
  }

  function spawnPickups(spots) {
    for (const p of pickups) pickupGroup.remove(p.mesh);
    pickups.length = 0;
    const list = Array.isArray(spots) && spots.length > 0 ? spots : [
      { x: 0, z: 0, kind: 'health' },
      { x: 20, z: 20, kind: 'ammo' },
    ];
    for (const spot of list) {
      const mesh = buildPickupMesh(spot.kind);
      mesh.position.set(spot.x, 0, spot.z);
      pickupGroup.add(mesh);
      pickups.push({
        kind: spot.kind, x: spot.x, z: spot.z,
        mesh, active: true, respawnTimer: 0,
      });
    }
  }

  /**
   * Enemy return fire, reloads, muzzle-flash decay and pickup collection.
   * ctx is the same shape as shoot()'s, plus onEnemyShoot(origin).
   */
  function update(dt, ctx) {
    if (state.shootTimer > 0) state.shootTimer -= dt;
    if (state.punchTimer > 0) state.punchTimer -= dt;
    if (state.flashTimer > 0) state.flashTimer -= dt;
    if (state.reloading) {
      state.reloadTimer -= dt;
      if (state.reloadTimer <= 0) {
        state.reloading = false;
        const take = Math.min(WEAPONS.pistol.magSize - state.ammo, state.reserve);
        state.ammo += take;
        state.reserve -= take;
        call(audio, 'click');
      }
    }

    // Enemy fire: gang members always shoot; foot cops shoot at 2+ stars.
    if (ctx && ctx.player && ctx.player.onFoot) {
      const shooters = [];
      for (const g of ctx.gang || []) {
        if (!g.dead) shooters.push({ who: g, damage: COMBAT.gangDamage, range: COMBAT.gangRange, cooldown: COMBAT.gangCooldown });
      }
      if ((ctx.wanted || 0) >= 2) {
        for (const c of ctx.cops || []) {
          if (!c.dead) shooters.push({ who: c, damage: COMBAT.copDamage, range: COMBAT.copRange, cooldown: COMBAT.copCooldown });
        }
      }
      for (const s of shooters) {
        const who = s.who;
        const d = Math.hypot(who.x - ctx.player.x, who.z - ctx.player.z);
        if (d > s.range) continue;
        who.shootTimer = (who.shootTimer || 0) - dt;
        if (who.shootTimer > 0) continue;
        who.shootTimer = s.cooldown * (0.8 + rng() * 0.5);
        call(audio, 'gunshot');
        if (ctx && typeof ctx.onEnemyShoot === 'function') {
          ctx.onEnemyShoot({ x: who.x, y: 1.5, z: who.z });
        }
        const hitChance = Math.max(0.07, Math.min(0.3, 0.3 - d * 0.007));
        if (rng() < hitChance && typeof ctx.onPlayerDamage === 'function') {
          ctx.onPlayerDamage(s.damage * (0.8 + rng() * 0.4), who);
        }
      }
    }

    // Pickups: collect on touch, respawn after a minute.
    pickupSpin += dt;
    for (const p of pickups) {
      if (p.mesh) p.mesh.rotation.y = pickupSpin;
      if (!p.active) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.active = true;
          if (p.mesh) p.mesh.visible = true;
        }
        continue;
      }
      if (ctx && ctx.player
        && Math.hypot(p.x - ctx.player.x, p.z - ctx.player.z) < 2.2) {
        p.active = false;
        p.respawnTimer = PICKUP_RESPAWN;
        if (p.mesh) p.mesh.visible = false;
        call(audio, 'pickup');
        if (typeof ctx.onPickup === 'function') ctx.onPickup(p.kind, p);
      }
    }
  }

  function reset() {
    state.weapon = 'pistol';
    state.ammo = COMBAT.pistolMagazine;
    state.reserve = 48;
    state.reloading = false;
    state.reloadTimer = 0;
    state.shootTimer = 0;
    state.punchTimer = 0;
    state.flashTimer = 0;
    state.kills = 0;
    for (const p of pickups) {
      p.active = true;
      p.respawnTimer = 0;
      if (p.mesh) p.mesh.visible = true;
    }
  }

  return {
    state, pickups, pickupGroup,
    shoot, punch, reload, switchWeapon, giveAmmo, spawnPickups, update, reset,
  };
}
