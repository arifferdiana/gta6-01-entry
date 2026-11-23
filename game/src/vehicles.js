// SOLMARINA — cars: the player's arcade handling and the city's traffic.
// Cars are built from boxes and cylinders with headlights and taillights;
// traffic follows the street grid and stops for the car ahead of it.

import * as THREE from 'three';
import { CONFIG, clamp, wrapAngle, dist2d } from './config.js';
import { streetLines } from './city.js';

const CAR_COLORS = [0xc23b3b, 0x3b6ec2, 0xd8d8d8, 0x2e2e34, 0xd8a83b, 0x3b8a5a, 0x8a3bc2, 0xc26a2e];

/** Build a car's mesh. Styles: sport, sedan, taxi, truck, police. */
export function makeCarMesh(style, color) {
  const group = new THREE.Group();
  // A faint emissive in the body colour keeps the car readable at dusk.
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55, emissive: color, emissiveIntensity: 0.16 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });

  const long = style === 'truck' ? 5.6 : style === 'sport' ? 4.6 : 4.4;
  const wide = 2.0;
  const bodyH = style === 'truck' ? 1.5 : 0.75;

  const body = new THREE.Mesh(new THREE.BoxGeometry(wide, bodyH, long), bodyMat);
  body.position.y = 0.65;
  body.castShadow = true;
  group.add(body);

  if (style !== 'truck') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.82, 0.62, long * 0.48), glassMat);
    cabin.position.set(0, bodyH + 0.55, -long * 0.06);
    cabin.castShadow = true;
    group.add(cabin);
  } else {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.9, 1.1, 1.4), glassMat);
    cab.position.set(0, 1.7, long * 0.28);
    cab.castShadow = true;
    group.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.94, 0.5, long * 0.5), darkMat);
    bed.position.set(0, 1.55, -long * 0.22);
    group.add(bed);
  }

  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95 });
  const wheels = [];
  for (const [wx, wz] of [
    [-wide / 2, long * 0.32],
    [wide / 2, long * 0.32],
    [-wide / 2, -long * 0.32],
    [wide / 2, -long * 0.32],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  // Headlights: two bright lenses plus a faint beam cone.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffedb0, emissiveIntensity: 1.4 });
  for (const wx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.1), headMat);
    lamp.position.set(wx, 0.72, long / 2 + 0.02);
    group.add(lamp);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xcc0000, emissiveIntensity: 1.2 });
  for (const wx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.1), tailMat);
    lamp.position.set(wx, 0.72, -long / 2 - 0.02);
    group.add(lamp);
  }

  if (style === 'police') {
    // A black-and-white cruiser with a flashing light bar.
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.3), darkMat);
    barBase.position.set(0, bodyH + 0.95, -long * 0.06);
    group.add(barBase);
    const redLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 }),
    );
    redLens.position.set(-0.28, bodyH + 0.98, -long * 0.06);
    group.add(redLens);
    const blueLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 2 }),
    );
    blueLens.position.set(0.28, bodyH + 0.98, -long * 0.06);
    group.add(blueLens);
    group.userData.lightBar = { red: redLens, blue: blueLens };
  }

  if (style === 'taxi') {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.22, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xcc9900, emissiveIntensity: 0.7 }),
    );
    sign.position.set(0, bodyH + 0.95, -long * 0.06);
    group.add(sign);
  }

  group.userData.wheels = wheels;
  group.userData.length = long;
  return group;
}

/** Pick a random point on the street grid (a street centreline). */
function randomStreetPoint(rng) {
  const lines = streetLines();
  const horizontal = rng.chance(0.5);
  const line = rng.pick(lines);
  const along = rng.range(-CONFIG.halfWorld + 20, CONFIG.halfWorld - 20);
  return horizontal ? { x: along, z: line } : { x: line, z: along };
}

/** The player's car: arcade physics with collision against buildings. */
export class PlayerCar {
  constructor(scene, colliders, color) {
    this.mesh = makeCarMesh('sport', color);
    // Headlights: one spotlight that throws a pool of light on the road ahead.
    this.headlight = new THREE.SpotLight(0xffe9a8, 220, 70, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, 1.1, 2.2);
    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.position.set(0, 0, 30);
    this.mesh.add(this.headlight);
    this.mesh.add(this.headlightTarget);
    this.headlight.target = this.headlightTarget;
    scene.add(this.mesh);
    this.colliders = colliders;
    this.x = 0;
    this.z = 40;
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.driven = false;
  }

  place(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const spin = this.speed * 0.06;
    for (const w of this.mesh.userData.wheels) w.rotation.x += spin;
    this.mesh.rotation.z = -this.steer * 0.06;
  }

  update(dt, input) {
    const cfg = CONFIG.car;
    const throttle = input.forward ? 1 : input.back ? -0.6 : 0;
    if (throttle > 0) this.speed += cfg.accel * dt;
    else if (throttle < 0) this.speed -= cfg.accel * 0.6 * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
    if (input.brake) {
      const before = this.speed;
      this.speed -= Math.sign(this.speed) * cfg.brake * dt;
      if (Math.sign(before) !== Math.sign(this.speed)) this.speed = 0;
    }
    this.speed = clamp(this.speed, -cfg.maxReverse, cfg.maxSpeed);
    const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const steerSpeed = cfg.steer * clamp(Math.abs(this.speed) / 12, 0.25, 1);
    this.steer += (steerTarget * (this.speed >= 0 ? 1 : -1) - this.steer) * Math.min(1, dt * 8);
    this.heading += this.steer * steerSpeed * dt * Math.sign(this.speed || 1) * (this.speed >= 0 ? 1 : -1);
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const pos = { x: nx, z: nz };
    this.colliders.resolveCircle(pos, cfg.radius);
    // The coast stops cars: no driving into the sea.
    pos.x = Math.min(pos.x, CONFIG.beachX + 6);
    pos.x = Math.max(pos.x, -CONFIG.halfWorld);
    pos.z = clamp(pos.z, -CONFIG.halfWorld, CONFIG.halfWorld);
    const hitWall = Math.abs(pos.x - nx) > 0.01 || Math.abs(pos.z - nz) > 0.01;
    if (hitWall) this.speed *= 0.55;
    this.x = pos.x;
    this.z = pos.z;
    this.syncMesh();
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }
}

/** A traffic car: drives a route along the streets and stops for cars ahead. */
class TrafficCar {
  constructor(scene, rng, colliders, color) {
    this.mesh = makeCarMesh(rng.pick(['sedan', 'sedan', 'taxi', 'truck']), color);
    scene.add(this.mesh);
    this.colliders = colliders;
    this.rng = rng;
    const start = randomStreetPoint(rng);
    this.x = start.x;
    this.z = start.z;
    this.heading = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    this.speed = 0;
    this.targetSpeed = rng.range(7, CONFIG.car.trafficSpeed + 2);
    this.route = [];
    this.routeIndex = 0;
    this.makeRoute();
    this.syncMesh();
  }

  makeRoute() {
    const lines = streetLines();
    this.route = [];
    let x = this.x;
    let z = this.z;
    for (let i = 0; i < 6; i++) {
      const horizontal = this.rng.chance(0.5);
      const line = this.rng.pick(lines);
      if (horizontal) this.route.push({ x: this.rng.range(-300, 300), z: line });
      else this.route.push({ x: line, z: this.rng.range(-300, 300) });
      void x;
      void z;
    }
    this.routeIndex = 0;
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  update(dt, others) {
    const target = this.route[this.routeIndex];
    if (!target) return;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 6) {
      this.routeIndex++;
      if (this.routeIndex >= this.route.length) this.makeRoute();
      return;
    }
    const wantHeading = Math.atan2(dx, dz);
    const diff = wrapAngle(wantHeading - this.heading);
    this.heading += clamp(diff, -1.4 * dt, 1.4 * dt);
    // Stop for a car ahead.
    let blocked = false;
    for (const o of others) {
      if (o === this) continue;
      const ahead = (o.x - this.x) * Math.sin(this.heading) + (o.z - this.z) * Math.cos(this.heading);
      const side = Math.abs((o.x - this.x) * Math.cos(this.heading) - (o.z - this.z) * Math.sin(this.heading));
      if (ahead > 0 && ahead < 9 && side < 2.4) {
        blocked = true;
        break;
      }
    }
    this.speed += ((blocked ? 0 : this.targetSpeed) - this.speed) * Math.min(1, dt * 1.5);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    const pos = { x: this.x, z: this.z };
    this.colliders.resolveCircle(pos, 2.1);
    this.x = pos.x;
    this.z = pos.z;
    this.syncMesh();
  }
}

/** The traffic system: a set of cars circulating on the street grid. */
export function createTraffic(scene, rng, colliders) {
  const cars = [];
  for (let i = 0; i < CONFIG.car.trafficCount; i++) {
    cars.push(new TrafficCar(scene, rng, colliders, CAR_COLORS[i % CAR_COLORS.length]));
  }
  return {
    cars,

    /** A parked car near a point, for the player to steal. */
    parkedNear(x, z) {
      let best = null;
      let bestD = Infinity;
      for (const c of cars) {
        const d = dist2d(c.x, c.z, x, z);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return bestD < 40 ? best : null;
    },

    update(dt) {
      for (const c of cars) c.update(dt, cars);
    },
  };
}
