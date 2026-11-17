// SOLMARINA — sound, all synthesized with WebAudio.
//
// No audio files, no network. The AudioContext is created only on the
// first user gesture (init), and every method is a safe no-op until then,
// so the world can call audio freely from boot. Music is a light looping
// chord pad, the engine is a speed-following oscillator pair, and the
// siren is a two-tone loop while the player is wanted.

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = null;
  let sirenHigh = false;
  let musicTimer = null;
  let musicOn = false;
  let musicStep = 0;
  let muted = false;
  let noiseBuffer = null;

  function ensureNoise() {
    if (noiseBuffer) return noiseBuffer;
    const length = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

    // Engine hum: two detuned saws through a lowpass; setEngine() bends
    // the pitch and the filter with speed.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 55 * 1.01;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();

    // Two-tone siren, flipped between 700 and 950 Hz by a timer.
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 700;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.14;
    musicBus.connect(master);
  }

  function setMuted(m) {
    muted = !!m;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
  }

  function isMuted() {
    return muted;
  }

  /** Engine pitch and loudness follow the car's speed (0 when parked / on foot). */
  function setEngine(speed, maxSpeed) {
    if (!ctx || !engineOsc) return;
    const ratio = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed || 40)));
    const now = ctx.currentTime;
    const freq = 48 + ratio * 150;
    engineOsc.frequency.setTargetAtTime(freq, now, 0.08);
    engineOsc2.frequency.setTargetAtTime(freq * 1.01, now, 0.08);
    engineGain.gain.setTargetAtTime(speed > 0.5 ? 0.05 + ratio * 0.05 : 0, now, 0.1);
    engineFilter.frequency.setTargetAtTime(350 + ratio * 900, now, 0.1);
  }

  function setSiren(on) {
    if (!ctx || !sirenOsc) return;
    if (on && !sirenTimer) {
      sirenGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.05);
      sirenTimer = window.setInterval(() => {
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 700, ctx.currentTime, 0.02);
      }, 380);
    } else if (!on && sirenTimer) {
      window.clearInterval(sirenTimer);
      sirenTimer = null;
      sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }
  }

  // One short oscillator note with an exponential decay.
  function blip(frequency, duration, type, volume, slideTo) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume || 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // A burst of filtered noise (gunshots, punches).
  function noiseBurst(duration, volume, filterFreq) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = ensureNoise();
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume || 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function gunshot() {
    noiseBurst(0.14, 0.5, 2600);
    blip(160, 0.08, 'square', 0.18, 55);
  }

  function punch() {
    noiseBurst(0.09, 0.3, 500);
    blip(110, 0.12, 'sine', 0.3, 45);
  }

  function pickup() {
    blip(660, 0.09, 'sine', 0.2);
    window.setTimeout(() => blip(990, 0.14, 'sine', 0.2), 80);
  }

  function click() {
    blip(880, 0.05, 'square', 0.08);
  }

  function horn() {
    if (!ctx) return;
    blip(370, 0.28, 'sawtooth', 0.12);
    blip(466, 0.28, 'sawtooth', 0.1);
  }

  function missionComplete() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((note, i) => {
      window.setTimeout(() => blip(note, 0.22, 'triangle', 0.22), i * 110);
    });
  }

  function stinger(notes, type) {
    notes.forEach((note, i) => {
      window.setTimeout(() => blip(note, 0.4, type || 'sawtooth', 0.18), i * 180);
    });
  }

  function busted() {
    stinger([392, 311, 233], 'sawtooth');
  }

  function wasted() {
    stinger([330, 262, 196, 131], 'sawtooth');
  }

  // Ambient music: a slow chord pad (Am – F – C – G) with a soft bass
  // pulse. Chords are [root, third, fifth, octave] in Hz; each step holds
  // one chord for a bar.
  const CHORDS = [
    [110.0, 220.0, 261.6, 329.6],
    [87.3, 174.6, 220.0, 261.6],
    [130.8, 196.0, 261.6, 329.6],
    [98.0, 196.0, 246.9, 293.7],
  ];
  const BAR_MS = 2400;

  function playChord(notes) {
    if (!ctx || !musicBus) return;
    const now = ctx.currentTime;
    const barSeconds = BAR_MS / 1000;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.16, now + 0.5);
      gain.gain.setValueAtTime(0.16, now + barSeconds - 0.6);
      gain.gain.linearRampToValueAtTime(0, now + barSeconds);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start(now);
      osc.stop(now + barSeconds + 0.05);
    }
    // Soft bass pulse on the root, twice a bar.
    for (let beat = 0; beat < 2; beat += 1) {
      const start = now + (beat * BAR_MS) / 2000;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[0] / 2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start(start);
      osc.stop(start + 0.55);
    }
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    const tick = () => {
      if (!musicOn) return;
      playChord(CHORDS[musicStep % CHORDS.length]);
      musicStep += 1;
    };
    tick();
    musicTimer = window.setInterval(tick, BAR_MS);
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function toggleMusic() {
    if (musicOn) stopMusic();
    else startMusic();
    return musicOn;
  }

  return {
    init, setMuted, isMuted, setEngine, setSiren,
    gunshot, punch, pickup, click, horn,
    missionComplete, busted, wasted,
    startMusic, stopMusic, toggleMusic,
  };
}
