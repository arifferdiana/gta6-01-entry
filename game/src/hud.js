// SOLMARINA — HUD (heads-up display).
//
// createHud(document) builds every DOM element the player sees on top of
// the 3D canvas: wanted stars, cash, clock, minimap, health bar, speed,
// ammo, objective text, message toasts, and the title / pause / how-to /
// game-over screens. main.js calls createHud(document) once, then
// hud.update(state) every frame with the world state:
//
//   state.player  { x, z, angle, health, onFoot, car, speed, ammo }
//   state.cars[]  { x, z }  traffic
//   state.cops[]  { x, z }  police
//   state.gang[]  { x, z }  Reef Kings
//   state.markers[] { x, z, kind, label }
//   state.wanted (0-5), state.cash, state.time (hours 0-24),
//   state.message, state.missionId
//
// The minimap covers the whole city. City bounds are fixed here so the
// HUD and the city module agree: the ground plane runs x and z from -360
// to 360 (road grid -288..288, sand beach on the west (-x) edge, marina
// water along the south (+z) edge). North is -z (up on the minimap).
const CITY_MIN = -360;
const CITY_MAX = 360;
const CITY_SIZE = CITY_MAX - CITY_MIN;

const MARKER_COLORS = {
  objective: '#ffd23f',
  pickup: '#3fd2ff',
  dropoff: '#3fff7a',
  target: '#ff4d4d',
  combat: '#ff4d4d',
  safehouse: '#3fff7a',
  package: '#c77dff',
};

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function formatCash(cash) {
  const n = Math.floor(cash || 0);
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatClock(time) {
  const t = ((time || 0) % 24 + 24) % 24;
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatSpeed(speed) {
  // World speed is metres per second; show km/h.
  const kmh = Math.round(Math.abs(speed || 0) * 3.6);
  return `${kmh} km/h`;
}

export function createHud(document) {
  const root = el(document, 'div', 'sm-hud');
  document.body.appendChild(root);

  // --- Top-left: wanted stars + cash -------------------------------------
  const topLeft = el(document, 'div', 'sm-topleft');
  const stars = el(document, 'div', 'sm-stars');
  const cash = el(document, 'div', 'sm-cash', '$0');
  topLeft.appendChild(stars);
  topLeft.appendChild(cash);
  root.appendChild(topLeft);

  // --- Top-right: clock ----------------------------------------------------
  const clock = el(document, 'div', 'sm-clock', '12:00');
  root.appendChild(clock);

  // --- Centre-top: message toasts ------------------------------------------
  const toasts = el(document, 'div', 'sm-toasts');
  root.appendChild(toasts);

  // --- Centre: objective ----------------------------------------------------
  const objective = el(document, 'div', 'sm-objective');
  const objectiveText = el(document, 'span', 'sm-objective-text');
  const objectiveDist = el(document, 'span', 'sm-objective-dist');
  objective.appendChild(objectiveText);
  objective.appendChild(objectiveDist);
  root.appendChild(objective);

  // --- Bottom-left: health bar + minimap ------------------------------------
  const bottomLeft = el(document, 'div', 'sm-bottomleft');
  const healthWrap = el(document, 'div', 'sm-health-wrap');
  const healthLabel = el(document, 'span', 'sm-health-label', 'HEALTH');
  const healthBar = el(document, 'div', 'sm-health-bar');
  const healthFill = el(document, 'div', 'sm-health-fill');
  healthBar.appendChild(healthFill);
  healthWrap.appendChild(healthLabel);
  healthWrap.appendChild(healthBar);
  const mapCanvas = el(document, 'canvas', 'sm-minimap');
  mapCanvas.width = 220;
  mapCanvas.height = 220;
  bottomLeft.appendChild(healthWrap);
  bottomLeft.appendChild(mapCanvas);
  root.appendChild(bottomLeft);
  const mapCtx = mapCanvas.getContext('2d');

  // --- Bottom-right: speed + ammo -------------------------------------------
  const bottomRight = el(document, 'div', 'sm-bottomright');
  const speed = el(document, 'div', 'sm-speed', '0 km/h');
  const ammo = el(document, 'div', 'sm-ammo', '');
  bottomRight.appendChild(speed);
  bottomRight.appendChild(ammo);
  root.appendChild(bottomRight);

  // --- Screens ---------------------------------------------------------------
  function makeScreen(name) {
    const screen = el(document, 'div', `sm-screen sm-screen-${name}`);
    screen.style.display = 'none';
    root.appendChild(screen);
    return screen;
  }

  function dispatch(action) {
    document.dispatchEvent(new document.defaultView.CustomEvent('solmarina', { detail: { action } }));
  }

  // Title screen.
  const titleScreen = makeScreen('title');
  titleScreen.appendChild(el(document, 'h1', 'sm-title', 'SOLMARINA'));
  titleScreen.appendChild(el(document, 'p', 'sm-tagline', 'Sun. Salt. Speed. One debt to clear.'));
  const btnNew = el(document, 'button', 'sm-btn', 'New Game');
  const btnContinue = el(document, 'button', 'sm-btn', 'Continue');
  const btnHow = el(document, 'button', 'sm-btn', 'How to play');
  btnNew.addEventListener('click', () => dispatch('new-game'));
  btnContinue.addEventListener('click', () => dispatch('continue'));
  btnHow.addEventListener('click', () => setScreen('howto'));
  titleScreen.appendChild(btnNew);
  titleScreen.appendChild(btnContinue);
  titleScreen.appendChild(btnHow);
  titleScreen.appendChild(el(document, 'p', 'sm-footnote', 'An original open-world crime game. Drive, earn, survive.'));

  // How to play (shown over the title screen).
  const howScreen = makeScreen('howto');
  howScreen.appendChild(el(document, 'h2', 'sm-heading', 'How to play'));
  const howList = el(document, 'ul', 'sm-howlist');
  [
    'WASD / arrows — drive or walk. Mouse — look around.',
    'F — enter / exit a car. E — interact. Space — jump / handbrake.',
    'Left click — punch or shoot. R — reload. Shift — run.',
    'Follow the yellow marker. Mara Voss pays per job.',
    'Stars mean the Solmarina PD is hunting you. Lose them or hide.',
    'Find all 10 hidden packages for $100 each.',
    'P — pause. Your progress saves automatically.',
  ].forEach((line) => howList.appendChild(el(document, 'li', null, line)));
  howScreen.appendChild(howList);
  const btnHowBack = el(document, 'button', 'sm-btn', 'Back');
  btnHowBack.addEventListener('click', () => setScreen('title'));
  howScreen.appendChild(btnHowBack);

  // Pause menu.
  const pauseScreen = makeScreen('pause');
  pauseScreen.appendChild(el(document, 'h2', 'sm-heading', 'Paused'));
  const btnResume = el(document, 'button', 'sm-btn', 'Resume');
  const btnQuitTitle = el(document, 'button', 'sm-btn', 'Save & title screen');
  btnResume.addEventListener('click', () => dispatch('resume'));
  btnQuitTitle.addEventListener('click', () => dispatch('to-title'));
  pauseScreen.appendChild(btnResume);
  pauseScreen.appendChild(btnQuitTitle);

  // Game-over screen.
  const overScreen = makeScreen('gameover');
  overScreen.appendChild(el(document, 'h2', 'sm-heading', 'BUSTED / WASTED'));
  overScreen.appendChild(el(document, 'p', 'sm-gameover-text', 'Jax is down. The debt is still waiting.'));
  const btnRetry = el(document, 'button', 'sm-btn', 'Retry');
  const btnOverTitle = el(document, 'button', 'sm-btn', 'Title screen');
  btnRetry.addEventListener('click', () => dispatch('retry'));
  btnOverTitle.addEventListener('click', () => dispatch('to-title'));
  overScreen.appendChild(btnRetry);
  overScreen.appendChild(btnOverTitle);

  const screens = { title: titleScreen, howto: howScreen, pause: pauseScreen, gameover: overScreen };
  let currentScreen = 'title';
  let lastObjective = '';
  let toastTimer = 0;

  function setScreen(name) {
    // name: 'title' | 'howto' | 'pause' | 'gameover' | 'game'
    Object.values(screens).forEach((s) => { s.style.display = 'none'; });
    if (name === 'game') {
      currentScreen = 'game';
      root.classList.remove('sm-in-menu');
      return;
    }
    const screen = screens[name];
    if (!screen) return;
    currentScreen = name;
    root.classList.add('sm-in-menu');
    screen.style.display = 'flex';
  }

  function showMessage(text) {
    if (!text) return;
    const toast = el(document, 'div', 'sm-toast', text);
    toasts.appendChild(toast);
    while (toasts.childNodes.length > 3) toasts.removeChild(toasts.firstChild);
    // Fade out and remove after 4 seconds.
    setTimeout(() => {
      toast.classList.add('sm-toast-fade');
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 600);
    }, 4000);
  }

  function showObjective(text, dist) {
    if (text) {
      objectiveText.textContent = text;
      objective.style.display = 'flex';
    } else {
      objective.style.display = 'none';
    }
    objectiveDist.textContent = (dist === undefined || dist === null) ? '' : `${Math.round(dist)}m`;
  }

  // --- Minimap ---------------------------------------------------------------
  function toMap(x, z) {
    const mx = ((x - CITY_MIN) / CITY_SIZE) * mapCanvas.width;
    const my = ((z - CITY_MIN) / CITY_SIZE) * mapCanvas.height;
    return [mx, my];
  }

  function drawMinimap(state) {
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const ctx = mapCtx;
    ctx.clearRect(0, 0, w, h);

    // Land: green city, sand beach on the west edge, ocean beyond it.
    ctx.fillStyle = '#3f7a3a';
    ctx.fillRect(0, 0, w, h);
    const [beachX] = toMap(-288, 0);
    ctx.fillStyle = '#e8d28a';
    ctx.fillRect(0, 0, beachX, h);
    // Ocean beyond the beach (far west).
    ctx.fillStyle = '#2f7fc2';
    ctx.fillRect(0, 0, 10, h);
    // Marina water along the south edge.
    const [, marinaY] = toMap(0, 288);
    ctx.fillStyle = '#2f7fc2';
    ctx.fillRect(0, marinaY, w, h - marinaY);

    // Roads: the real street grid (centres at -288..288, pitch 72).
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 3;
    const roads = [-288, -216, -144, -72, 0, 72, 144, 216, 288];
    roads.forEach((c) => {
      const [mx] = toMap(c, 0);
      const [, my] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(w, my); ctx.stroke();
    });

    // Mission markers.
    (state.markers || []).forEach((m) => {
      const [mx, my] = toMap(m.x, m.z);
      ctx.fillStyle = MARKER_COLORS[m.kind] || MARKER_COLORS.objective;
      ctx.beginPath();
      ctx.moveTo(mx, my - 7); ctx.lineTo(mx + 6, my); ctx.lineTo(mx, my + 7); ctx.lineTo(mx - 6, my);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Traffic dots (white), gang (purple), police (flashing blue/red).
    (state.cars || []).forEach((c) => {
      const [mx, my] = toMap(c.x, c.z);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    });
    (state.gang || []).forEach((g) => {
      const [mx, my] = toMap(g.x, g.z);
      ctx.fillStyle = '#c77dff';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
    });
    const flash = Math.floor(Date.now() / 400) % 2 === 0;
    (state.cops || []).forEach((c) => {
      const [mx, my] = toMap(c.x, c.z);
      ctx.fillStyle = flash ? '#3f8cff' : '#ff3f3f';
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2); ctx.fill();
    });

    // Player arrow, rotated by heading. The world's angle is measured
    // from +z (south): on the map, south is down, so the up-pointing
    // arrow turns by (PI - angle).
    const p = state.player;
    if (p) {
      const [mx, my] = toMap(p.x, p.z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI - (p.angle || 0));
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // North indicator.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('N', 6, 14);
    ctx.beginPath();
    ctx.moveTo(10, 18); ctx.lineTo(10, 26);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // --- Per-frame update -------------------------------------------------------
  function update(state) {
    if (!state) return;
    const player = state.player || {};

    // Wanted stars (0-5).
    const wanted = Math.max(0, Math.min(5, state.wanted || 0));
    let starText = '';
    for (let i = 0; i < 5; i += 1) starText += i < wanted ? '★' : '☆';
    stars.textContent = starText;
    stars.classList.toggle('sm-wanted', wanted > 0);

    cash.textContent = formatCash(state.cash);
    clock.textContent = formatClock(state.time);

    // Health bar.
    const health = Math.max(0, Math.min(100, player.health === undefined ? 100 : player.health));
    healthFill.style.width = `${health}%`;
    healthFill.classList.toggle('sm-health-low', health <= 25);
    healthWrap.style.display = currentScreen === 'game' ? 'flex' : 'none';

    // Speed + ammo (bottom-right). Speed only matters while driving;
    // ammo only shows when the player has a weapon.
    if (!player.onFoot) {
      speed.textContent = formatSpeed(player.speed);
      speed.style.display = 'block';
    } else {
      speed.style.display = 'none';
    }
    if (player.ammo !== undefined && player.ammo !== null) {
      ammo.textContent = `AMMO ${player.ammo}`;
      ammo.style.display = 'block';
    } else {
      ammo.style.display = 'none';
    }

    // Objective: state.message is the mission layer's objective line.
    // Distance is measured to the first marker.
    if (state.message && state.message !== lastObjective) {
      lastObjective = state.message;
    }
    if (state.message) {
      let dist = null;
      if (state.markers && state.markers.length > 0) {
        const m = state.markers[0];
        const dx = player.x - m.x;
        const dz = player.z - m.z;
        dist = Math.sqrt(dx * dx + dz * dz);
      }
      showObjective(state.message, dist);
    } else if (!state.missionId) {
      showObjective('', null);
    }

    drawMinimap(state);

    // Toast housekeeping: toasts remove themselves on timers.
    toastTimer += 1;
    void toastTimer;
  }

  // Start on the title screen.
  setScreen('title');

  return {
    update,
    showMessage,
    showObjective,
    setScreen,
    get screen() { return currentScreen; },
    root,
  };
}
