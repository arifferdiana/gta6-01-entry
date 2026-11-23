// SOLMARINA — deterministic random numbers.
// The city is built from a fixed seed so every player gets the same
// Solmarina, while traffic and pedestrians use a live random stream.

/** mulberry32: a small, fast seeded PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source with the helpers the game uses everywhere. */
export class RNG {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  /** A float in [0, 1). */
  float() {
    return this.next();
  }

  /** A float in [a, b). */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** An integer in [a, b]. */
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }

  /** One element of an array, picked uniformly. */
  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  /** True with probability p (0..1). */
  chance(p) {
    return this.next() < p;
  }

  /** A shuffled copy of an array (Fisher-Yates). */
  shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

/** The city's build seed: the same Solmarina for every player. */
export const CITY_SEED = 20261123;

/** A live, unseeded random source for gameplay (traffic, pedestrians). */
export const liveRng = new RNG((Math.random() * 0xffffffff) >>> 0);
