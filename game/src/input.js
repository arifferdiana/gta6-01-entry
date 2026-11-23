// Keyboard and mouse input. Held keys give a movement intent every frame; one-shot
// presses (enter a car, interact, pause, ...) are queued as bit flags and taken once by
// the loop, so a press between two frames is never lost and never counted twice.
// Mouse drag orbits the camera; holding the left button shoots (or punches on foot).
//
// Movement intent is camera-relative: move() returns { forward, strafe } where forward
// is +1 for W / Up and strafe is +1 for D / Right. direction() is the same intent in
// fixed world axes (W is north, -z) for scenes that have no camera angle.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_CAR = 4;
export const ACTION_INTERACT = 8;
export const ACTION_PUNCH = 16;
export const ACTION_RELOAD = 32;
export const ACTION_HORN = 64;
export const ACTION_CAMERA = 128;
export const ACTION_MUTE = 256;
export const ACTION_JUMP = 512;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Enter', 'NumpadEnter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER_CAR = new Set(['KeyF']);
const INTERACT = new Set(['KeyE']);
const RELOAD = new Set(['KeyR']);
const HORN = new Set(['KeyH']);
const CAMERA = new Set(['KeyC']);
const MUTE = new Set(['KeyM']);
const JUMP = new Set(['Space']);

const GAME_KEYS = new Set([
  ...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...RUN, ...CONFIRM, ...PAUSE,
  ...ENTER_CAR, ...INTERACT, ...RELOAD, ...HORN, ...CAMERA, ...MUTE, ...JUMP,
]);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let shootHeld = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lookX = 0;
  let lookY = 0;

  function press(code) {
    if (CONFIRM.has(code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(code)) actions |= ACTION_PAUSE;
    else if (ENTER_CAR.has(code)) actions |= ACTION_ENTER_CAR;
    else if (INTERACT.has(code)) actions |= ACTION_INTERACT;
    else if (RELOAD.has(code)) actions |= ACTION_RELOAD;
    else if (HORN.has(code)) actions |= ACTION_HORN;
    else if (CAMERA.has(code)) actions |= ACTION_CAMERA;
    else if (MUTE.has(code)) actions |= ACTION_MUTE;
    else if (JUMP.has(code)) actions |= ACTION_JUMP;
  }

  window.addEventListener('keydown', (event) => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    held.add(event.code);
    press(event.code);
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    shootHeld = false;
    dragging = false;
  });

  function hasAny(codes) {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  canvas.addEventListener('pointerdown', (event) => {
    // A click also confirms on menus; in play it is the shoot / punch button.
    actions |= ACTION_CONFIRM | ACTION_PUNCH;
    if (event.button === 0) {
      shootHeld = true;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    lookX += event.clientX - lastX;
    lookY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) {
      shootHeld = false;
      dragging = false;
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Camera-relative intent: forward +1 is W / Up, strafe +1 is D / Right. */
    move() {
      const forward = (hasAny(FORWARD) ? 1 : 0) - (hasAny(BACK) ? 1 : 0);
      const strafe = (hasAny(RIGHT) ? 1 : 0) - (hasAny(LEFT) ? 1 : 0);
      return { forward, strafe };
    },
    /** Same intent in fixed world axes (W is north, -z; D is east, +x). */
    direction() {
      const z = (hasAny(BACK) ? 1 : 0) - (hasAny(FORWARD) ? 1 : 0);
      const x = (hasAny(RIGHT) ? 1 : 0) - (hasAny(LEFT) ? 1 : 0);
      return { x, z };
    },
    /** { x: strafe, y: forward } — the move() intent as a 2D axis pair. */
    axis() {
      const m = this.move();
      return { x: m.strafe, y: m.forward };
    },
    /** Mouse-drag look since the last call, in pixels; reading it clears it. */
    lookDelta() {
      const delta = { dx: lookX, dy: lookY };
      lookX = 0;
      lookY = 0;
      return delta;
    },
    /** True while the left mouse button is held (shoot on foot with a gun, punch bare-handed). */
    shooting() {
      return shootHeld;
    },
    /** True while either Shift key is held (run on foot). */
    running() {
      return hasAny(RUN);
    },
    /** Drop every held key and queued action: call when pausing or changing scenes. */
    clear() {
      held.clear();
      actions = 0;
      shootHeld = false;
      dragging = false;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
