// SOLMARINA — the render loop and the camera.
// One loop drives every system in the same order each frame, then moves
// the third-person camera: behind the player on foot, further back and
// higher in a car, or fixed for a title screenshot.

import * as THREE from 'three';
import { CONFIG, clamp, lerp, wrapAngle } from './config.js';

/** Build the loop. `systems` holds every updateable part of the game. */
export function createLoop(game, systems) {
  const { world, city, traffic, crowd, police, combat, missions, hud, audio, input, car } = systems;
  const clock = new THREE.Clock();
  let running = false;
  let raf = 0;
  const camPos = new THREE.Vector3(0, 40, 90);
  const camLook = new THREE.Vector3(0, 0, 0);
  const tmpLook = new THREE.Vector3();

  function step() {
    if (!running) return;
    raf = requestAnimationFrame(step);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const player = game.player;

    // --- Input: looking around turns the player on foot.
    const look = input.consumeLook();
    if (game.state === 'playing') {
      if (player.mode === 'foot') {
        player.yaw -= look.dx * 0.0032;
        player.pitch = clamp(player.pitch - look.dy * 0.0032, -1.1, 0.9);
        player.heading = player.yaw;
      }
      // E enters or exits the nearest car.
      if (input.consumeInteract()) {
        if (player.mode === 'foot') {
          if (car.driven && dist2d(player.x, player.z, car.x, car.z) < 5) {
            // Back into the car the player already owns.
            player.mode = 'car';
          } else {
            const near = traffic.parkedNear(player.x, player.z);
            if (near) {
              player.mode = 'car';
              car.place(near.x, near.z, near.heading);
              car.driven = true;
              police.addHeat(CONFIG.wanted.stealHeat);
              audio.thud();
              hud.toast('Car stolen — the police noticed');
            }
          }
        } else {
          player.mode = 'foot';
          player.x = car.x - Math.sin(car.heading) * 3;
          player.z = car.z - Math.cos(car.heading) * 3;
          player.heading = car.heading;
          player.yaw = car.heading;
          car.speed = 0;
        }
      }
      // Mouse click shoots on foot.
      if (player.mode === 'foot' && input.pointerLocked) {
        // Shooting is wired through the canvas mousedown in main.js.
      }
    }

    // --- The player on foot: WASD moves, Shift runs, buildings block.
    if (game.state === 'playing' && player.mode === 'foot') {
      const speed = input.run ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed;
      let mx = 0;
      let mz = 0;
      if (input.forward) mz += 1;
      if (input.back) mz -= 1;
      if (input.left) mx -= 1;
      if (input.right) mx += 1;
      if (mx !== 0 || mz !== 0) {
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
        const sin = Math.sin(player.heading);
        const cos = Math.cos(player.heading);
        const nx = player.x + (sin * mz + cos * mx) * speed * dt;
        const nz = player.z + (cos * mz - sin * mx) * speed * dt;
        const pos = { x: nx, z: nz };
        city.resolveCircle(pos, CONFIG.player.radius);
        pos.x = Math.min(pos.x, CONFIG.beachX + 10);
        pos.x = Math.max(pos.x, -CONFIG.halfWorld);
        pos.z = clamp(pos.z, -CONFIG.halfWorld, CONFIG.halfWorld);
        player.x = pos.x;
        player.z = pos.z;
        player.moving = true;
      } else {
        player.moving = false;
      }
      // Reload with R.
      if (input.reload && game.ammo < CONFIG.combat.magSize && !game.reloading) {
        game.reloading = true;
        game.reloadTimer = CONFIG.combat.reloadSeconds;
      }
    }

    // --- Reload timer.
    if (game.reloading) {
      game.reloadTimer -= dt;
      if (game.reloadTimer <= 0) {
        const need = CONFIG.combat.magSize - game.ammo;
        const take = Math.min(need, game.reserveAmmo);
        game.ammo += take;
        game.reserveAmmo -= take;
        game.reloading = false;
      }
    }

    // --- The player's car.
    if (game.state === 'playing' && player.mode === 'car') {
      car.update(dt, input);
      player.x = car.x;
      player.z = car.z;
      player.heading = car.heading;
      audio.engine(Math.abs(car.speed) / CONFIG.car.maxSpeed);
      // Speeding past a cruiser adds heat.
      if (Math.abs(car.speed) > 30) {
        for (const c of police.cruisers) {
          if (dist2d(c.x, c.z, car.x, car.z) < 25) {
            police.addHeat(CONFIG.wanted.speedHeat * dt);
            break;
          }
        }
      }
    } else {
      audio.engine(0);
    }

    // --- The player's figure follows the player state.
    if (systems.playerMesh) {
      systems.playerMesh.position.set(player.x, player.moving ? Math.abs(Math.sin(t * 11)) * 0.07 : 0, player.z);
      systems.playerMesh.rotation.y = player.heading;
      systems.playerMesh.visible = player.mode === 'foot' && game.state !== 'dead';
    }

    // --- The world systems, in the same order every frame.
    traffic.update(dt);
    crowd.update(dt, player, game.lastGunshot);
    game.lastGunshot = null;
    police.update(dt, player);
    combat.update(dt, player);
    missions.update(dt);
    world.update(dt, t);
    city.update(dt, t);

    // --- The HUD.
    hud.setMoney(game.money);
    hud.setHealth(game.health);
    hud.setWanted(game.wanted);
    hud.setObjective(game.objective);
    hud.setSpeed(car.speedKmh, player.mode === 'car');
    hud.setAmmo(player.mode === 'foot' ? game.ammo : null, game.reserveAmmo);
    hud.drawMinimap({
      playerX: player.x,
      playerZ: player.z,
      heading: player.heading,
      cars: traffic.cars.map((c) => ({ x: c.x, z: c.z })),
      police: police.positions(),
      enemies: combat.positions(),
      objective: missions.target,
    });

    // --- The camera.
    const cam = world.camera;
    if (game.shotCamFollow === 'rear' && player.mode === 'car') {
      // A chase shot: the camera sits ahead of the car and looks back at
      // it, so the pursuing cruisers show in the frame behind the car.
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      camPos.set(player.x + fx * 14, 4.5, player.z + fz * 14);
      camLook.set(player.x, 2, player.z);
      cam.position.copy(camPos);
      cam.lookAt(camLook);
    } else if (game.shotCamFollow === 'chase' && player.mode === 'car') {
      // A drive shot: the camera sits directly behind the car (no lerp),
      // so the car is in the frame from the very first rendered frame —
      // a lerped chase camera has not converged yet when a screenshot
      // fires a fraction of a second into the game.
      const bx = Math.sin(player.heading);
      const bz = Math.cos(player.heading);
      camPos.set(
        player.x - bx * CONFIG.camera.carDistance,
        CONFIG.camera.carHeight,
        player.z - bz * CONFIG.camera.carDistance,
      );
      camLook.set(player.x + bx * 12, 1.6, player.z + bz * 12);
      cam.position.copy(camPos);
      cam.lookAt(camLook);
    } else if (game.shotCamera) {
      camPos.set(game.shotCamera.x, game.shotCamera.y, game.shotCamera.z);
      camLook.set(game.shotCamera.lookX, game.shotCamera.lookY, game.shotCamera.lookZ);
      cam.position.copy(camPos);
      cam.lookAt(camLook);
    } else if (player.mode === 'car') {
      const back = CONFIG.camera.carDistance;
      const height = CONFIG.camera.carHeight;
      tmpLook.set(
        player.x - Math.sin(player.heading) * back,
        height,
        player.z - Math.cos(player.heading) * back,
      );
      camPos.lerp(tmpLook, 1 - Math.pow(0.0001, dt));
      cam.position.copy(camPos);
      camLook.lerp(new THREE.Vector3(player.x + Math.sin(player.heading) * 12, 1.6, player.z + Math.cos(player.heading) * 12), 1 - Math.pow(0.001, dt));
      cam.lookAt(camLook);
    } else {
      const back = CONFIG.camera.footDistance;
      const height = CONFIG.camera.footHeight + Math.sin(player.pitch || 0) * 2;
      tmpLook.set(
        player.x - Math.sin(player.heading) * back,
        height,
        player.z - Math.cos(player.heading) * back,
      );
      camPos.lerp(tmpLook, 1 - Math.pow(0.0001, dt));
      cam.position.copy(camPos);
      camLook.lerp(
        new THREE.Vector3(
          player.x + Math.sin(player.heading) * 10,
          1.6 + (player.pitch || 0) * 4,
          player.z + Math.cos(player.heading) * 10,
        ),
        1 - Math.pow(0.001, dt),
      );
      cam.lookAt(camLook);
    }

    world.renderer.render(world.scene, cam);
  }

  function dist2d(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  return {
    start() {
      if (running) return;
      running = true;
      clock.start();
      raf = requestAnimationFrame(step);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
