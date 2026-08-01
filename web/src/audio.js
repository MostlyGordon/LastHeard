// Web Audio beep. The AudioContext is created/resumed on a user gesture
// (the alarm "arm" button) to satisfy browser autoplay policies.

let ctx = null;
let enabled = false;

export function arm() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  enabled = true;
}

export function disarm() {
  enabled = false;
}

export function isArmed() {
  return enabled;
}

export function beep(freq = 880, durationMs = 180, repeats = 3) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < repeats; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + i * (durationMs / 1000 + 0.09);
    const end = start + durationMs / 1000;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  }
}