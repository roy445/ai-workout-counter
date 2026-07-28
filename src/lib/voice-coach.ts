/**
 * Voice Coach – Web Speech API TTS wrapper for real-time workout announcements.
 * Speaks rep counts, form corrections, status changes and challenge milestones.
 */

let enabled = true;
let lastSpokenText = "";
let lastSpokenTime = 0;
const MIN_INTERVAL = 1200; // minimum ms between speeches

export function setVoiceEnabled(on: boolean) {
  enabled = on;
  if (!on) {
    window.speechSynthesis?.cancel();
  }
}

export function isVoiceEnabled() {
  return enabled;
}

function getVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  // Prefer zh-TW, then zh-CN, then any Chinese, then default
  return (
    voices.find((v) => v.lang === "zh-TW") ||
    voices.find((v) => v.lang === "zh-CN") ||
    voices.find((v) => v.lang.startsWith("zh")) ||
    null
  );
}

export function speak(text: string, priority: "high" | "normal" = "normal") {
  if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;

  const now = Date.now();
  // Debounce identical messages
  if (text === lastSpokenText && now - lastSpokenTime < 3000) return;
  // Minimum interval between any speech
  if (priority === "normal" && now - lastSpokenTime < MIN_INTERVAL) return;

  lastSpokenText = text;
  lastSpokenTime = now;

  // Cancel queued low-priority speech for high-priority
  if (priority === "high") {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 1.15;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voice = getVoice();
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

// ---- Convenience helpers ----

export function announceRep(count: number) {
  speak(`${count}`, "high");
}

export function announceExerciseStart(nameZh: string) {
  speak(`開始${nameZh}`, "high");
}

export function announceExerciseStop() {
  speak("已停止追蹤", "normal");
}

export function announceFormCorrection(msg: string) {
  // Strip emoji for cleaner TTS
  const clean = msg.replace(/[^\u4e00-\u9fff\u3000-\u303f\w\s，。！？、]/g, "").trim();
  if (clean.length > 2) {
    speak(clean, "normal");
  }
}

export function announceChallenge(target: number, nameZh: string) {
  speak(`恭喜！完成${target}次${nameZh}挑戰！`, "high");
}

export function announcePersonLost() {
  speak("未偵測到人物，請回到鏡頭範圍", "normal");
}

export function announceMultiplePeople() {
  speak("偵測到多人，請確保只有一人在畫面中", "normal");
}

export function announceStatus(phase: string) {
  const phaseMap: Record<string, string> = {
    standing: "站立準備",
    going_down: "往下",
    at_bottom: "到底",
    coming_up: "起身",
    up: "上方",
    holding: "保持住",
    open: "張開",
    closed: "合攏",
    airborne: "跳起",
    grounded: "落地",
  };
  const label = phaseMap[phase];
  if (label) speak(label, "normal");
}
