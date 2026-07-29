/** Browser-side Traditional Chinese voice coach with a small priority queue. */

type VoicePriority = "high" | "normal";
interface VoiceItem { text: string; priority: VoicePriority; key: string; }

let enabled = true;
let speaking = false;
let currentPriority: VoicePriority | null = null;
let generation = 0;
const queue: VoiceItem[] = [];
const lastSpokenByKey = new Map<string, number>();
let lastNormalTime = 0;
let cachedVoice: SpeechSynthesisVoice | null = null;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function chooseVoice(): SpeechSynthesisVoice | null {
  const api = synth();
  if (!api) return null;
  const voices = api.getVoices();
  cachedVoice =
    voices.find((voice) => voice.lang.toLowerCase() === "zh-tw") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("zh-hant")) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ||
    cachedVoice;
  return cachedVoice;
}

function cleanText(text: string): string {
  return text
    .replace(/[✅⚠️❌⏱️🔥🎯🏆💪]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pump(): void {
  const api = synth();
  if (!enabled || !api || speaking || queue.length === 0) return;

  const item = queue.shift();
  if (!item) return;

  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = "zh-TW";
  utterance.rate = item.priority === "high" ? 1.18 : 1.08;
  utterance.pitch = 1;
  utterance.volume = 1;
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;

  speaking = true;
  currentPriority = item.priority;
  const token = generation;

  const done = () => {
    if (token !== generation) return;
    speaking = false;
    currentPriority = null;
    window.setTimeout(pump, 80);
  };
  utterance.onend = done;
  utterance.onerror = done;
  api.speak(utterance);
}

export function setVoiceEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    generation += 1;
    queue.length = 0;
    speaking = false;
    currentPriority = null;
    synth()?.cancel();
  }
}

export function isVoiceEnabled(): boolean {
  return enabled;
}

/** Must be called from a user click on iOS/Safari to unlock speech audio. */
export function unlockVoice(): void {
  const api = synth();
  if (!api || !enabled) return;
  chooseVoice();
  const utterance = new SpeechSynthesisUtterance("語音教練已準備");
  utterance.lang = "zh-TW";
  utterance.volume = 0.85;
  utterance.rate = 1.1;
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;
  api.cancel();
  generation += 1;
  speaking = false;
  currentPriority = null;
  queue.length = 0;
  api.speak(utterance);
}

export function speak(
  rawText: string,
  priority: VoicePriority = "normal",
  key = rawText,
  cooldownMs = priority === "high" ? 250 : 2500
): void {
  if (!enabled) return;
  const text = cleanText(rawText);
  if (!text) return;

  const now = Date.now();
  const last = lastSpokenByKey.get(key) || 0;
  if (now - last < cooldownMs) return;
  if (priority === "normal" && now - lastNormalTime < 850) return;

  lastSpokenByKey.set(key, now);
  if (priority === "normal") lastNormalTime = now;

  const item: VoiceItem = { text, priority, key };
  if (priority === "high") {
    // Counts and start/stop prompts jump ahead of old coaching messages.
    const duplicateIndex = queue.findIndex((queued) => queued.key === key);
    if (duplicateIndex >= 0) queue.splice(duplicateIndex, 1);
    queue.unshift(item);

    // Interrupt only a long normal message, never another rep count.
    if (speaking && currentPriority === "normal") {
      generation += 1;
      synth()?.cancel();
      speaking = false;
      currentPriority = null;
    }
  } else {
    if (!queue.some((queued) => queued.key === key)) queue.push(item);
  }

  // Keep stale coaching advice from accumulating during fast exercise.
  if (queue.length > 5) queue.splice(5);
  pump();
}

export function announceRep(count: number, quality = 100): void {
  if (count > 0 && count % 10 === 0) {
    speak(`${count}次，太棒了，繼續保持`, "high", `rep-${count}`, 0);
  } else if (count > 0 && count % 5 === 0) {
    speak(`${count}次，很好`, "high", `rep-${count}`, 0);
  } else {
    speak(String(count), "high", `rep-${count}`, 0);
  }

  if (quality < 65) {
    speak("放慢速度，先確保姿勢正確", "normal", "low-quality", 6000);
  }
}

export function announceCountdown(nameZh: string): void {
  speak(`準備開始${nameZh}。三、二、一，開始`, "high", `start-${nameZh}`, 0);
}

export function announceExerciseStart(nameZh: string): void {
  announceCountdown(nameZh);
}

export function announceExerciseStop(reps?: number): void {
  const summary = typeof reps === "number" && reps > 0 ? `已停止追蹤，本次完成${reps}次` : "已停止追蹤";
  speak(summary, "high", "stop", 0);
}

export function announceFormCorrection(message: string): void {
  const text = cleanText(message)
    .replace(/^完成第.*$/, "")
    .replace("再蹲低一些，膝蓋角度不足", "再蹲低一些，讓膝蓋穩定對準腳尖")
    .replace("保持背部挺直", "收緊核心，保持背部挺直")
    .replace("動作幅度不夠", "動作幅度再完整一些");
  if (text.length > 2) speak(text, "normal", `form-${text}`, 4500);
}

export function announceChallenge(target: number, nameZh: string): void {
  speak(`恭喜，完成${target}次${nameZh}挑戰`, "high", "challenge-complete", 0);
}

export function announceChallengeProgress(current: number, target: number): void {
  if (current === Math.ceil(target / 2)) {
    speak("已經完成一半，繼續保持", "normal", `half-${target}`, 0);
  } else if (target - current === 3) {
    speak("最後三次，加油", "normal", `last-three-${target}`, 0);
  }
}

export function announcePersonLost(): void {
  speak("暫停分析。未偵測到人物，請回到鏡頭範圍", "high", "person-lost", 7000);
}

export function announcePersonFound(): void {
  speak("已重新鎖定，繼續運動", "normal", "person-found", 5000);
}

export function announceMultiplePeople(): void {
  speak("偵測到多人，目前只鎖定主要使用者", "normal", "multiple-people", 8000);
}

export function announceCameraBlurred(): void {
  speak("畫面較模糊，請擦拭鏡頭並增加光線", "normal", "camera-blurred", 12000);
}

export function announceStatus(phase: string): void {
  const phaseMap: Record<string, string> = {
    calibrating: "正在校準站立位置",
    at_bottom: "深度到位，準備起身",
    holding: "姿勢正確，保持核心穩定",
    in_plank: "進入平板位置",
    plank_position: "保持身體一直線",
    sitting: "起身到位",
    at_top: "抬腿到位",
  };
  const label = phaseMap[phase];
  if (label) speak(label, "normal", `phase-${phase}`, 5500);
}
