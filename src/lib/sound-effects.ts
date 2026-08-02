/**
 * Web Audio API Gym Synthesizer - Synthesizes high-quality sound effects in-browser
 * with zero file downloads or latency issues.
 */

let audioCtx: AudioContext | null = null;
let enabled = true;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window || "webkitAudioContext" in window)) {
    return null;
  }
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

export function isSoundEnabled() {
  return enabled;
}

/** Synthesize a standard rep chime. Higher quality = higher pitches. */
export function playRepSound(quality = 100) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  
  if (quality >= 85) {
    // S-Class Premium Double Chime (Gold Coin feel)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now); // A5
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.1); // E6

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1046.5, now + 0.06); // C6
    osc2.frequency.exponentialRampToValueAtTime(1568, now + 0.16); // G6

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.06);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  } else {
    // Standard clean rep beep
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.05); // A5

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }
}

/** Synthesize standard caution/warning beep */
export function playWarningSound() {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(220, now); // Low pitch warning
  osc.frequency.linearRampToValueAtTime(180, now + 0.15);

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.18, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.22);
}

/** Synthesize short countdown tick */
export function playCountdownTick() {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1000, now);

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.08, now + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.06);
}

/** Synthesize triumphant melody on challenge completion */
export function playChallengeSuccessSound() {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + idx * 0.1);

    gainNode.gain.setValueAtTime(0, now + idx * 0.1);
    gainNode.gain.linearRampToValueAtTime(0.12, now + idx * 0.1 + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now + idx * 0.1);
    osc.stop(now + idx * 0.1 + 0.4);
  });
}
