// 音效系統（Web Audio API，程式合成，不需音檔）
// 提供：計數嗶聲、達標勝利音、倒數 tick、破紀錄提示音。

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    return this.ctx;
  }

  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }
  getEnabled() {
    return this.enabled;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = "sine",
    gain = 0.15,
    delay = 0,
  ) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // 每下計數：清脆短嗶
  rep() {
    this.tone(880, 0.09, "triangle", 0.12);
  }

  // 倒數 tick
  tick() {
    this.tone(660, 0.08, "square", 0.08);
  }

  // 倒數最後的 go
  go() {
    this.tone(1046, 0.25, "sawtooth", 0.13);
  }

  // 一組完成：上升三音
  setDone() {
    this.tone(660, 0.12, "sine", 0.14, 0);
    this.tone(880, 0.12, "sine", 0.14, 0.12);
    this.tone(1174, 0.22, "sine", 0.15, 0.24);
  }

  // 全部完成：勝利號角
  victory() {
    this.tone(784, 0.14, "sine", 0.15, 0);
    this.tone(988, 0.14, "sine", 0.15, 0.14);
    this.tone(1318, 0.3, "sine", 0.16, 0.28);
  }

  // 破個人紀錄：閃亮兩音
  record() {
    this.tone(1318, 0.12, "triangle", 0.15, 0);
    this.tone(1760, 0.25, "triangle", 0.15, 0.12);
  }
}

let instance: SoundManager | null = null;
export function getSound(): SoundManager {
  if (!instance) instance = new SoundManager();
  return instance;
}
