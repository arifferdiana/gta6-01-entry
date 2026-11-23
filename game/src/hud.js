// SOLMARINA — the HUD: money, health, wanted stars, objective, speed,
// ammo, toasts, the minimap, and the start and death screens.
// Layout follows the readability rule: every element is anchored to a
// screen edge on a dark translucent chip, so it reads over dusk light.

import { CONFIG, clamp } from './config.js';

/** Build the HUD. The DOM skeleton lives in index.html; this wires it. */
export function createHud() {
  const el = (id) => document.getElementById(id);
  const moneyEl = el('money');
  const healthFill = el('health-fill');
  const healthText = el('health-text');
  const starsEl = el('stars');
  const objectiveEl = el('objective');
  const speedEl = el('speed');
  const ammoEl = el('ammo');
  const toastEl = el('toast');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');
  const startScreen = el('start-screen');
  const deathScreen = el('death-screen');
  const startBtn = el('start-btn');
  const newGameBtn = el('new-game-btn');
  const respawnBtn = el('respawn-btn');
  let toastTimer = null;

  /** A star row: filled gold stars for the wanted level, dim for the rest. */
  function starRow(n) {
    let out = '';
    for (let i = 0; i < CONFIG.wanted.maxStars; i++) {
      out += `<span class="${i < n ? 'star on' : 'star'}">★</span>`;
    }
    return out;
  }

  return {
    setMoney(v) {
      moneyEl.textContent = `$${Math.floor(v).toLocaleString('en-US')}`;
    },

    setHealth(v) {
      const pct = clamp(v, 0, 100);
      healthFill.style.width = `${pct}%`;
      healthFill.style.background = pct > 50 ? '#4caf50' : pct > 25 ? '#ff9800' : '#f44336';
      healthText.textContent = `${Math.ceil(v)} HP`;
    },

    setWanted(n) {
      starsEl.innerHTML = starRow(n);
      starsEl.classList.toggle('hot', n >= 3);
    },

    setObjective(text) {
      if (objectiveEl.textContent !== text) objectiveEl.textContent = text;
    },

    /** Speed shows only while driving; ammo only on foot. */
    setSpeed(kmh, driving) {
      speedEl.style.display = driving ? 'block' : 'none';
      if (driving) speedEl.textContent = `${Math.round(kmh)} km/h`;
    },

    setAmmo(mag, reserve) {
      ammoEl.style.display = mag === null ? 'none' : 'block';
      if (mag !== null) ammoEl.textContent = `AMMO ${mag} / ${reserve}`;
    },

    /** A centre toast that fades after a few seconds. */
    toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
    },

    showStart(hasSave, onStart, onNewGame) {
      startScreen.style.display = 'flex';
      objectiveEl.style.display = 'none';
      newGameBtn.style.display = hasSave ? 'inline-block' : 'none';
      startBtn.onclick = () => onStart(false);
      newGameBtn.onclick = () => onNewGame();
    },

    hideStart() {
      startScreen.style.display = 'none';
      objectiveEl.style.display = 'block';
    },

    showDeath(onRespawn) {
      deathScreen.style.display = 'flex';
      respawnBtn.onclick = () => {
        deathScreen.style.display = 'none';
        onRespawn();
      };
    },

    /** Draw the minimap: streets, beach, player, cars, police, objective. */
    drawMinimap(state) {
      const size = minimap.width;
      const half = size / 2;
      const scale = size / (CONFIG.worldSize + 60);
      const toMap = (x, z) => [half + x * scale, half + z * scale];
      mapCtx.clearRect(0, 0, size, size);
      // Round clip so the map reads as a dial.
      mapCtx.save();
      mapCtx.beginPath();
      mapCtx.arc(half, half, half - 2, 0, Math.PI * 2);
      mapCtx.clip();
      // Background: dark city, sand strip, water.
      mapCtx.fillStyle = '#1d1d26';
      mapCtx.fillRect(0, 0, size, size);
      mapCtx.fillStyle = '#8a6a44';
      const [bx] = toMap(CONFIG.beachX, 0);
      mapCtx.fillRect(bx, 0, size - bx, size);
      mapCtx.fillStyle = '#1d4e6b';
      const [wx] = toMap(CONFIG.waterX, 0);
      mapCtx.fillRect(wx, 0, size - wx, size);
      // Streets.
      mapCtx.strokeStyle = '#3f3f4d';
      mapCtx.lineWidth = 2;
      const step = CONFIG.block + CONFIG.roadWidth;
      for (let v = -CONFIG.halfWorld; v <= CONFIG.halfWorld + 1; v += step) {
        const [ax, ay] = toMap(v + CONFIG.roadWidth / 2, -CONFIG.halfWorld);
        const [bx2, by2] = toMap(v + CONFIG.roadWidth / 2, CONFIG.halfWorld);
        mapCtx.beginPath();
        mapCtx.moveTo(ax, ay);
        mapCtx.lineTo(bx2, by2);
        mapCtx.stroke();
        const [cx, cy] = toMap(-CONFIG.halfWorld, v + CONFIG.roadWidth / 2);
        const [dx, dy] = toMap(CONFIG.halfWorld, v + CONFIG.roadWidth / 2);
        mapCtx.beginPath();
        mapCtx.moveTo(cx, cy);
        mapCtx.lineTo(dx, dy);
        mapCtx.stroke();
      }
      // The pier and the beacon.
      mapCtx.strokeStyle = '#c9a86a';
      mapCtx.lineWidth = 3;
      const [px0, py0] = toMap(CONFIG.pier.x0, CONFIG.pier.z);
      const [px1, py1] = toMap(CONFIG.pier.x1, CONFIG.pier.z);
      mapCtx.beginPath();
      mapCtx.moveTo(px0, py0);
      mapCtx.lineTo(px1, py1);
      mapCtx.stroke();
      const [bx3, by3] = toMap(CONFIG.beacon.x, CONFIG.beacon.z);
      mapCtx.fillStyle = '#ffd24d';
      mapCtx.beginPath();
      mapCtx.arc(bx3, by3, 3, 0, Math.PI * 2);
      mapCtx.fill();
      // Objective marker.
      if (state.objective) {
        const [ox, oy] = toMap(state.objective.x, state.objective.z);
        mapCtx.fillStyle = '#ffd24d';
        mapCtx.beginPath();
        mapCtx.arc(ox, oy, 4, 0, Math.PI * 2);
        mapCtx.fill();
        mapCtx.strokeStyle = '#ffd24d';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.arc(ox, oy, 7 + Math.sin(performance.now() * 0.005) * 2, 0, Math.PI * 2);
        mapCtx.stroke();
      }
      // Traffic as pale dots, police as red dots, enemies as orange dots.
      const dot = (x, z, color, r) => {
        const [mx, my] = toMap(x, z);
        mapCtx.fillStyle = color;
        mapCtx.beginPath();
        mapCtx.arc(mx, my, r, 0, Math.PI * 2);
        mapCtx.fill();
      };
      for (const c of state.cars || []) dot(c.x, c.z, '#b8b8c8', 2);
      for (const p of state.police || []) dot(p.x, p.z, '#ff4444', 2.5);
      for (const e of state.enemies || []) dot(e.x, e.z, '#ff8800', 2.5);
      // The player: a white arrow pointing where they face.
      const [ux, uy] = toMap(state.playerX, state.playerZ);
      mapCtx.save();
      mapCtx.translate(ux, uy);
      mapCtx.rotate(Math.atan2(Math.sin(state.heading), Math.cos(state.heading)) * -1 + Math.PI);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4, 5);
      mapCtx.lineTo(-4, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
      mapCtx.restore();
      // Ring around the dial.
      mapCtx.strokeStyle = 'rgba(255,255,255,0.7)';
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.arc(half, half, half - 2, 0, Math.PI * 2);
      mapCtx.stroke();
    },
  };
}
