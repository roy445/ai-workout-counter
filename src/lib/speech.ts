// 語音播報系統（Web Speech API）
// 支援：報數、狀態播報、動作提示。以中文語音為主，並做佇列與節流。

type SpeakOpts = {
  priority?: boolean; // true 時會中斷目前語音立即播報
  rate?: number;
  pitch?: number;
};

class SpeechManager {
  private enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private supported = false;
  private lastText = "";
  private lastTime = 0;

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this.supported = true;
      this.pickVoice();
      window.speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  private pickVoice() {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices();
    // 優先挑選繁中 / 中文語音
    this.voice =
      voices.find((v) => /zh-TW|zh-HK/i.test(v.lang)) ??
      voices.find((v) => /zh/i.test(v.lang)) ??
      voices.find((v) => /^zh/i.test(v.lang)) ??
      voices[0] ??
      null;
  }

  isSupported() {
    return this.supported;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v && this.supported) window.speechSynthesis.cancel();
  }

  getEnabled() {
    return this.enabled;
  }

  // 由使用者手勢觸發一次，解鎖行動裝置的語音權限
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  speak(text: string, opts: SpeakOpts = {}) {
    if (!this.enabled || !this.supported || !text) return;
    const now = performance.now();
    // 避免極短時間重複同一句
    if (text === this.lastText && now - this.lastTime < 400) return;
    this.lastText = text;
    this.lastTime = now;

    if (opts.priority) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "zh-TW";
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1.0;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }

  // 報數：直接唸數字，快速節奏
  count(n: number) {
    // 報數時中斷前一個數字，維持節奏感
    this.speak(String(n), { priority: true, rate: 1.15 });
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
  }
}

let instance: SpeechManager | null = null;
export function getSpeech(): SpeechManager {
  if (!instance) instance = new SpeechManager();
  return instance;
}
