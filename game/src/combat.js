// SOLMARINA — combat.
// Hitscan shooting with tracers and muzzle flashes, gang members who
// shoot back, and a death that drops the player at the hospital minus a
// cut of their money.

import * as THREE from 'three';
import { CONFIG, clamp, dist2d } from './config.js';

const ENEMY_COLORS = [0xc23b3b, 0x3b5fd9, 0x5a5a5a];

/** One Reef Kings gang member. */
class Enemy {
  constructor(scene, x, z, rng) {
    this.group = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: rng.pick(ENEMY_COLORS), roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.9, 8), shirt);
    body.position.y = 1.05;
    body.castShadow = true;
    this.group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    this.group.add(head);
    // A red bandana marks the gang.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.8 }),
    );
    band.position.y = 1.82;
    this.group.add(band);
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.6 }),
    );
    gun.position.set(0.3, 1.25, 0.4);
    this.group.add(gun);
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.x = x;
    this.z = z;
    this.health = CONFIG.combat.enemyHealth;
    this.fireTimer = rng.range(0.4, 1.4);
    this.dead = false;
    this.deathTimer = 0;
  }

  /** Fall over and sink slightly when killed. */
  die() {
    this.dead = true;
    this.deathTimer = 0;
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.y = 0.3;
  }

  update(dt, playerPos, shootAt) {
    if (this.dead) {
      this.deathTimer += dt;
      return;
    }
    const dx = playerPos.x - this.x;
    const dz = playerPos.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.group.rotation.y = Math.atan2(dx, dz);
    this.fireTimer -= dt;
    if (d < CONFIG.combat.enemyRange && this.fireTimer <= 0) {
      this.fireTimer = CONFIG.combat.enemyFireDelay * (0.8 + Math.random() * 0.5);
      shootAt(this);
    }
  }

  remove(scene) {
    scene.remove(this.group);
  }
}

/** The combat system: the player's gun, the gang, and player health. */
export function createCombat(scene, rng, colliders, audio, game) {
  const enemies = [];
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  const flash = new THREE.PointLight(0xffe9a8, 0, 30, 1.5);
  scene.add(flash);

  /** A tracer line from the muzzle to the hit point, fading in 80 ms. */
  function addTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, tracerMat.clone());
    scene.add(line);
    tracers.push({ line, life: 0.08 });
  }

  function updateTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        tracers.splice(i, 1);
      } else {
        t.line.material.opacity = t.life / 0.08;
      }
    }
    flash.intensity = Math.max(0, flash.intensity - dt * 300);
  }

  /** The player fires a hitscan shot from the camera toward the crosshair. */
  function playerShoot(origin, direction) {
    if (game.ammo <= 0) {
      audio.click();
      return { hit: false };
    }
    game.ammo--;
    audio.shot();
    game.lastGunshot = { x: origin.x, z: origin.z };
    flash.position.copy(origin);
    flash.intensity = 60;
    // Find the nearest enemy the ray passes close to.
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const ex = e.x - origin.x;
      const ez = e.z - origin.z;
      const along = ex * direction.x + ez * direction.z;
      if (along < 0 || along > 90) continue;
      const perp = Math.abs(ex * direction.z - ez * direction.x);
      if (perp < 1.1 && along < bestD) {
        bestD = along;
        best = e;
      }
    }
    const end = best
      ? new THREE.Vector3(best.x, 1.3, best.z)
      : new THREE.Vector3(origin.x + direction.x * 90, 1.3, origin.z + direction.z * 90);
    addTracer(new THREE.Vector3(origin.x, origin.y, origin.z), end);
    if (best) {
      best.health -= CONFIG.combat.damage;
      if (best.health <= 0 && !best.dead) {
        best.die();
        game.money += 150;
        audio.beep();
      }
      return { hit: true, killed: best.dead };
    }
    return { hit: false };
  }

  return {
    enemies,
    get ammo() {
      return game.ammo;
    },

    /** Spawn n gang members around a point. */
    spawnGang(n, cx, cz) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const r = rng.range(8, 18);
        enemies.push(new Enemy(scene, cx + Math.sin(a) * r, cz + Math.cos(a) * r, rng));
      }
    },

    /** How many gang members are still standing. */
    aliveCount() {
      return enemies.filter((e) => !e.dead).length;
    },

    clearGang() {
      for (const e of enemies) e.remove(scene);
      enemies.length = 0;
    },

    shoot(origin, direction) {
      return playerShoot(origin, direction);
    },

    /** Damage the player; returns true when the player dies. */
    damagePlayer(n) {
      game.health = clamp(game.health - n, 0, CONFIG.player.health);
      if (game.health <= 0) {
        const lost = Math.floor(game.money * CONFIG.money.deathLoss);
        game.money -= lost;
        game.health = CONFIG.player.health;
        game.deaths = (game.deaths || 0) + 1;
        if (typeof game.onDeath === 'function') game.onDeath();
        return true;
      }
      return false;
    },

    /** Positions for the minimap. */
    positions() {
      return enemies.filter((e) => !e.dead).map((e) => ({ x: e.x, z: e.z }));
    },

    update(dt, playerPos) {
      updateTracers(dt);
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.update(dt, playerPos, (enemy) => {
          // An enemy shot: a tracer from the enemy to the player, with a
          // hit chance that falls off with distance.
          const from = new THREE.Vector3(enemy.x, 1.3, enemy.z);
          const to = new THREE.Vector3(playerPos.x, 1.3, playerPos.z);
          addTracer(from, to);
          audio.distantShot();
          const d = dist2d(enemy.x, enemy.z, playerPos.x, playerPos.z);
          const hitChance = clamp(0.55 - d / 140, 0.12, 0.55);
          if (Math.random() < hitChance) this.damagePlayer(CONFIG.combat.enemyDamage);
        });
        if (e.dead && e.deathTimer > 6) {
          e.remove(scene);
          enemies.splice(i, 1);
        }
      }
    },
  };
}
