// Save / load through localStorage. The snapshot shape is the contract the world
// and the save UI share: { cash, missionsDone: [ids], x, z, time, health }.
// Every access is guarded: storage can be off (private windows) and a corrupt or
// foreign save must never break boot.

import { SAVE_KEY } from './config.js';

function readRaw() {
  try {
    return window.localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function saveGame(snapshot) {
  try {
    const clean = {
      cash: Math.floor(snapshot.cash || 0),
      missionsDone: Array.isArray(snapshot.missionsDone) ? snapshot.missionsDone.slice() : [],
      x: Number(snapshot.x) || 0,
      z: Number(snapshot.z) || 0,
      time: Number(snapshot.time) || 0,
      health: Math.max(0, Math.min(100, Number(snapshot.health) || 100)),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  const raw = readRaw();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      cash: Number(data.cash) || 0,
      missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone.filter((id) => typeof id === 'string') : [],
      x: Number(data.x) || 0,
      z: Number(data.z) || 0,
      time: Number(data.time) || 0,
      health: Math.max(0, Math.min(100, Number(data.health) || 100)),
    };
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasSave() {
  return loadGame() !== null;
}
