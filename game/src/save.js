// SOLMARINA — saving to localStorage.
// The save holds the player's money, mission progress and position, so a
// session survives a closed tab. Nothing else is stored.

const SAVE_KEY = 'solmarina-save-v1';

/** The save shape a fresh game starts from. */
export function freshSave() {
  return {
    money: 500,
    missionIndex: 0,
    missionsDone: [],
    player: { x: 0, z: -8, heading: 0 },
    muted: false,
  };
}

/** Load the save, or a fresh one when there is none or it is corrupt. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return freshSave();
    const data = JSON.parse(raw);
    const fresh = freshSave();
    if (typeof data !== 'object' || data === null) return fresh;
    return {
      money: typeof data.money === 'number' ? data.money : fresh.money,
      missionIndex: typeof data.missionIndex === 'number' ? data.missionIndex : fresh.missionIndex,
      missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone : fresh.missionsDone,
      player:
        data.player && typeof data.player.x === 'number' && typeof data.player.z === 'number'
          ? { x: data.player.x, z: data.player.z, heading: data.player.heading || 0 }
          : fresh.player,
      muted: data.muted === true,
    };
  } catch (err) {
    return freshSave();
  }
}

/** Write the current progress. Called on mission completion and on exit. */
export function writeSave(state) {
  try {
    const data = {
      money: Math.round(state.money),
      missionIndex: state.missionIndex,
      missionsDone: state.missionsDone,
      player: { x: state.player.x, z: state.player.z, heading: state.player.heading },
      muted: !!state.muted,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    // Storage can be full or blocked; the game plays on without a save.
  }
}

/** Wipe the save (used by the "New game" choice on the start screen). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    // Nothing to do when storage is unavailable.
  }
}
