// SOLMARINA — keyboard and mouse input.
// The game uses pointer lock for looking around on foot; in a car the
// mouse steers the camera. Every key the game reads is tracked here.

import { CONFIG } from './config.js';

/** Build the input state for a canvas element. */
export function createInput(canvas) {
  const keys = new Set();
  let lookDX = 0;
  let lookDY = 0;
  let locked = false;
  let interactQueued = false;

  function keyName(e) {
    return e.code;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) {
      keys.add(keyName(e));
      if (CONFIG.keys.interact.includes(e.code)) interactQueued = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(keyName(e));
  });
  window.addEventListener('blur', () => {
    keys.clear();
  });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookDX += e.movementX || 0;
    lookDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  canvas.addEventListener('click', () => {
    if (!locked) {
      try {
        canvas.requestPointerLock();
      } catch (err) {
        // Pointer lock can be refused (for example in a headless shot);
        // the game still plays with the keys alone.
      }
    }
  });

  function anyDown(codes) {
    for (const c of codes) if (keys.has(c)) return true;
    return false;
  }

  return {
    /** True while the named action's keys are held. */
    get forward() {
      return anyDown(CONFIG.keys.forward);
    },
    get back() {
      return anyDown(CONFIG.keys.back);
    },
    get left() {
      return anyDown(CONFIG.keys.left);
    },
    get right() {
      return anyDown(CONFIG.keys.right);
    },
    get run() {
      return anyDown(CONFIG.keys.run);
    },
    get brake() {
      return anyDown(CONFIG.keys.brake);
    },
    get reload() {
      return keys.has('KeyR');
    },
    get mute() {
      return keys.has('KeyM');
    },

    /** True once per press of the interact key (E). */
    consumeInteract() {
      const v = interactQueued;
      interactQueued = false;
      return v;
    },

    /** Mouse movement since the last read, in pixels. */
    consumeLook() {
      const out = { dx: lookDX, dy: lookDY };
      lookDX = 0;
      lookDY = 0;
      return out;
    },

    get pointerLocked() {
      return locked;
    },

    /** Ask the browser for pointer lock (called from the start button). */
    requestLock() {
      try {
        canvas.requestPointerLock();
      } catch (err) {
        // Playing without pointer lock is fine.
      }
    },
  };
}
