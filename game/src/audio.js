// SOLMARINA — all sound is synthesised with WebAudio.
// No audio files: every effect is an oscillator or a noise burst, so the
// game stays a set of static files with no network request.

/** Build the sound system. Nothing plays until resume() runs on a user gesture. */
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenOn = false;
  let sirenTimer = 0;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Engine hum: a low sawtooth through a low-pass filter.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // Police siren: a sine that swings between two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      return true;
    } catch (err) {
      return false;
    }
  }

  /** A short burst of white noise, shaped by a gain envelope. */
  function noiseBurst(duration, volume, filterFreq) {
    if (!ctx || muted) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  /** A single tone with an attack and a decay. */
  function tone(freq, duration, volume, type) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  return {
    /** Create the context (call from a click or key press). */
    resume() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },

    /** Engine hum follows speed: 0 is silent, 1 is full throttle. */
    engine(speed01) {
      if (!ctx || muted) return;
      const v = Math.max(0, Math.min(1, speed01));
      engineGain.gain.setTargetAtTime(v * 0.12, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(55 + v * 110, ctx.currentTime, 0.08);
      engineFilter.frequency.setTargetAtTime(320 + v * 900, ctx.currentTime, 0.08);
    },

    /** A gunshot: a sharp noise crack plus a low thump. */
    shot() {
      noiseBurst(0.12, 0.5, 1800);
      tone(90, 0.12, 0.35, 'triangle');
    },

    /** An enemy shot, quieter and duller than the player's. */
    distantShot() {
      noiseBurst(0.1, 0.16, 900);
    },

    /** A two-tone police siren; call every frame with whether any cruiser is near. */
    siren(on, dt) {
      if (!ctx || muted) {
        sirenOn = false;
        return;
      }
      sirenOn = on;
      if (!on) {
        sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        return;
      }
      sirenTimer += dt;
      const hi = Math.floor(sirenTimer * 2.2) % 2 === 0;
      sirenOsc.frequency.setTargetAtTime(hi ? 920 : 640, ctx.currentTime, 0.05);
      sirenGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.1);
    },

    /** A pickup chime. */
    beep() {
      tone(880, 0.12, 0.25, 'sine');
      setTimeout(() => tone(1318, 0.18, 0.25, 'sine'), 90);
    },

    /** A short mission-complete sting. */
    sting() {
      tone(523, 0.16, 0.3, 'triangle');
      setTimeout(() => tone(659, 0.16, 0.3, 'triangle'), 140);
      setTimeout(() => tone(784, 0.3, 0.3, 'triangle'), 280);
    },

    /** A dull thud for a crash. */
    thud() {
      noiseBurst(0.18, 0.4, 300);
      tone(70, 0.2, 0.4, 'sine');
    },

    /** A UI click. */
    click() {
      tone(1200, 0.05, 0.2, 'square');
    },

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },

    get isMuted() {
      return muted;
    },
  };
}
