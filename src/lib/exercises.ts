// 運動定義 + 姿勢分析 + 自動計數狀態機（專業版）
// 所有偵測邏輯皆以 MediaPipe Pose 的 33 個 landmark（正規化 0~1）為基礎。

export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

// MediaPipe Pose landmark 索引
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export type ExerciseKey =
  | "squat"
  | "pushup"
  | "situp"
  | "jumpingjack"
  | "jump"
  | "plank"
  | "march"
  | "slowjog"
  | "crotchclap";

export type ExerciseDef = {
  key: ExerciseKey;
  name: string; // 中文名稱
  emoji: string;
  met: number; // 代謝當量，用於熱量估算
  timeBased: boolean; // true 表示以時間為主（如平板支撐）
  hint: string; // 操作提示
  cue: string; // 語音開始提示
  unit?: string; // 計數單位（次 / 步）
  targetCadence?: number; // 建議步頻（步/分），用於超慢跑節奏提示
};

export const EXERCISES: Record<ExerciseKey, ExerciseDef> = {
  squat: {
    key: "squat",
    name: "深蹲",
    emoji: "🏋️",
    met: 5.0,
    timeBased: false,
    hint: "面向鏡頭站立，下蹲到大腿接近水平再站直即計一次。",
    cue: "深蹲開始，請站到鏡頭前",
  },
  pushup: {
    key: "pushup",
    name: "伏地挺身",
    emoji: "💪",
    met: 8.0,
    timeBased: false,
    hint: "側身面向鏡頭，手肘彎曲下壓再撐直即計一次。",
    cue: "伏地挺身開始，請側身面對鏡頭",
  },
  situp: {
    key: "situp",
    name: "仰臥起坐",
    emoji: "🧘",
    met: 8.0,
    timeBased: false,
    hint: "側躺面向鏡頭，上身抬起再躺下即計一次。",
    cue: "仰臥起坐開始，請側躺面對鏡頭",
  },
  jumpingjack: {
    key: "jumpingjack",
    name: "開合跳",
    emoji: "🤸",
    met: 8.0,
    timeBased: false,
    hint: "雙手雙腳張開再合起算一次，全身需入鏡。",
    cue: "開合跳開始，請讓全身入鏡",
  },
  jump: {
    key: "jump",
    name: "跳躍",
    emoji: "⬆️",
    met: 8.0,
    timeBased: false,
    hint: "原地向上跳起再落地算一次。",
    cue: "跳躍開始",
  },
  plank: {
    key: "plank",
    name: "平板支撐",
    emoji: "🧎",
    met: 3.8,
    timeBased: true,
    hint: "側身保持身體成一直線，系統累計正確支撐時間。",
    cue: "平板支撐開始，保持身體成一直線",
  },
  march: {
    key: "march",
    name: "原地踏步",
    emoji: "🚶",
    met: 4.0,
    timeBased: false,
    hint: "面向鏡頭，交替抬起膝蓋，每抬一次算一步。",
    cue: "原地踏步開始",
    unit: "步",
  },
  slowjog: {
    key: "slowjog",
    name: "超慢跑",
    emoji: "🏃‍♂️",
    met: 6.0,
    timeBased: false,
    hint: "面向鏡頭原地小步輕跑，前腳掌著地、保持穩定步頻約 180。",
    cue: "超慢跑開始，放鬆小步、保持節奏",
    unit: "步",
    targetCadence: 180,
  },
  crotchclap: {
    key: "crotchclap",
    name: "胯下擊掌",
    emoji: "👏",
    met: 7.0,
    timeBased: false,
    hint: "面向鏡頭，抬起單腳並在大腿下方雙手擊掌，左右輪流，每擊掌一次算一下。",
    cue: "胯下擊掌開始，抬腳在胯下拍手",
    unit: "下",
  },
};

export const EXERCISE_LIST = Object.values(EXERCISES);

// ---------- 幾何工具 ----------

// 計算 B 點的夾角（A-B-C），回傳角度（度）
export function angle(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return 180;
  let cos = dot / (magAb * magCb);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function avg(a: number, b: number) {
  return (a + b) / 2;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

// 判斷關鍵點是否可見（用於判斷人物是否在鏡頭中）
export function isPersonPresent(lms: Landmark[] | null): boolean {
  if (!lms || lms.length < 33) return false;
  const keys = [
    LM.LEFT_SHOULDER,
    LM.RIGHT_SHOULDER,
    LM.LEFT_HIP,
    LM.RIGHT_HIP,
  ];
  let visible = 0;
  for (const k of keys) {
    const v = lms[k]?.visibility ?? 0;
    if (v > 0.5) visible++;
  }
  return visible >= 3;
}

// ---------- Landmark 平滑濾波（EMA）----------
// 降低抖動，讓角度與計數更穩定，提升專業準確度。
export class LandmarkSmoother {
  private prev: Landmark[] | null = null;
  private alpha: number;
  constructor(alpha = 0.5) {
    this.alpha = alpha;
  }
  reset() {
    this.prev = null;
  }
  apply(lms: Landmark[]): Landmark[] {
    if (!this.prev) {
      this.prev = lms.map((p) => ({ ...p }));
      return this.prev;
    }
    const a = this.alpha;
    const out = lms.map((p, i) => {
      const q = this.prev![i] ?? p;
      return {
        x: q.x + a * (p.x - q.x),
        y: q.y + a * (p.y - q.y),
        z: q.z + a * (p.z - q.z),
        visibility: p.visibility,
      };
    });
    this.prev = out;
    return out;
  }
}

// ---------- 計數狀態機 ----------

export type UpdateResult = {
  repInc: number; // 本幀新增次數
  phase: string; // 當前動作階段（中文）
  metric?: number; // 主要量測值（角度或位置），供顯示
  progress?: number; // 0~1，本次動作完成進度（供進度環）
  holding?: boolean; // 時間型運動：是否正在有效支撐
  feedback?: string; // 動作品質提示（例如「蹲深一點」）
  cadence?: number; // 即時步頻（步/分），供超慢跑等使用
};

export interface RepCounter {
  reset(): void;
  update(lms: Landmark[]): UpdateResult;
}

// 深蹲：以膝蓋角度判斷 下蹲(<95) -> 站直(>165)，並檢查蹲的深度
class SquatCounter implements RepCounter {
  private down = false;
  private reachedDepth = false;
  reset() {
    this.down = false;
    this.reachedDepth = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const left = angle(lms[LM.LEFT_HIP], lms[LM.LEFT_KNEE], lms[LM.LEFT_ANKLE]);
    const right = angle(
      lms[LM.RIGHT_HIP],
      lms[LM.RIGHT_KNEE],
      lms[LM.RIGHT_ANKLE],
    );
    const kneeAngle = avg(left, right);
    let repInc = 0;
    let feedback = "";
    if (kneeAngle < 95) {
      this.down = true;
      this.reachedDepth = true;
    } else if (kneeAngle < 120) {
      this.down = true;
    } else if (kneeAngle > 165 && this.down) {
      this.down = false;
      if (this.reachedDepth) {
        repInc = 1;
      } else {
        feedback = "蹲低一點";
      }
      this.reachedDepth = false;
    }
    // 進度：從站立(170) 到 深蹲(90)
    const progress = clamp01((170 - kneeAngle) / (170 - 90));
    return {
      repInc,
      phase: this.down ? "下蹲中" : "站立",
      metric: Math.round(kneeAngle),
      progress,
      feedback,
    };
  }
}

// 伏地挺身：以手肘角度判斷 下壓(<90) -> 撐直(>160)
class PushupCounter implements RepCounter {
  private down = false;
  private reachedDepth = false;
  reset() {
    this.down = false;
    this.reachedDepth = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const left = angle(
      lms[LM.LEFT_SHOULDER],
      lms[LM.LEFT_ELBOW],
      lms[LM.LEFT_WRIST],
    );
    const right = angle(
      lms[LM.RIGHT_SHOULDER],
      lms[LM.RIGHT_ELBOW],
      lms[LM.RIGHT_WRIST],
    );
    const elbow = avg(left, right);
    let repInc = 0;
    let feedback = "";
    if (elbow < 90) {
      this.down = true;
      this.reachedDepth = true;
    } else if (elbow < 120) {
      this.down = true;
    } else if (elbow > 160 && this.down) {
      this.down = false;
      if (this.reachedDepth) repInc = 1;
      else feedback = "下壓深一點";
      this.reachedDepth = false;
    }
    const progress = clamp01((170 - elbow) / (170 - 85));
    return {
      repInc,
      phase: this.down ? "下壓中" : "撐起",
      metric: Math.round(elbow),
      progress,
      feedback,
    };
  }
}

// 仰臥起坐：以髖部角度(肩-髖-膝)判斷 躺下(>120) -> 起身(<65)
class SitupCounter implements RepCounter {
  private up = false;
  private reachedTop = false;
  reset() {
    this.up = false;
    this.reachedTop = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const left = angle(
      lms[LM.LEFT_SHOULDER],
      lms[LM.LEFT_HIP],
      lms[LM.LEFT_KNEE],
    );
    const right = angle(
      lms[LM.RIGHT_SHOULDER],
      lms[LM.RIGHT_HIP],
      lms[LM.RIGHT_KNEE],
    );
    const hip = avg(left, right);
    let repInc = 0;
    if (hip < 65) {
      this.up = true;
      this.reachedTop = true;
    } else if (hip < 90) {
      this.up = true;
    } else if (hip > 120 && this.up) {
      this.up = false;
      if (this.reachedTop) repInc = 1;
      this.reachedTop = false;
    }
    const progress = clamp01((130 - hip) / (130 - 60));
    return {
      repInc,
      phase: this.up ? "起身" : "躺下",
      metric: Math.round(hip),
      progress,
    };
  }
}

// 開合跳：手腕高於肩 + 腳踝距離變大 => 張開；反之合起。一開一合算一次。
class JumpingJackCounter implements RepCounter {
  private open = false;
  reset() {
    this.open = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const shoulderY = avg(lms[LM.LEFT_SHOULDER].y, lms[LM.RIGHT_SHOULDER].y);
    const wristsUp =
      lms[LM.LEFT_WRIST].y < shoulderY && lms[LM.RIGHT_WRIST].y < shoulderY;
    const shoulderW = Math.abs(
      lms[LM.LEFT_SHOULDER].x - lms[LM.RIGHT_SHOULDER].x,
    );
    const ankleW = Math.abs(lms[LM.LEFT_ANKLE].x - lms[LM.RIGHT_ANKLE].x);
    const legsApart = ankleW > shoulderW * 1.3;
    let repInc = 0;
    if (wristsUp && legsApart) {
      this.open = true;
    } else if (!wristsUp && !legsApart && this.open) {
      this.open = false;
      repInc = 1;
    }
    const progress = this.open ? 1 : 0;
    return { repInc, phase: this.open ? "張開" : "合起", progress };
  }
}

// 跳躍：追蹤髖部 y 的基準線，明顯上升(離地)再回落算一次
class JumpCounter implements RepCounter {
  private baseline: number | null = null;
  private inAir = false;
  reset() {
    this.baseline = null;
    this.inAir = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const hipY = avg(lms[LM.LEFT_HIP].y, lms[LM.RIGHT_HIP].y);
    if (this.baseline === null) this.baseline = hipY;
    if (!this.inAir) this.baseline = this.baseline * 0.9 + hipY * 0.1;
    let repInc = 0;
    const threshold = this.baseline - 0.06;
    if (hipY < threshold) {
      this.inAir = true;
    } else if (hipY > this.baseline - 0.02 && this.inAir) {
      this.inAir = false;
      repInc = 1;
    }
    const progress = clamp01((this.baseline - hipY) / 0.08);
    return { repInc, phase: this.inAir ? "騰空" : "著地", progress };
  }
}

// 平板支撐：時間為主，判斷身體大致成一直線即視為「支撐中」
class PlankCounter implements RepCounter {
  reset() {}
  update(lms: Landmark[]): UpdateResult {
    const bodyLine =
      (angle(lms[LM.LEFT_SHOULDER], lms[LM.LEFT_HIP], lms[LM.LEFT_KNEE]) +
        angle(lms[LM.RIGHT_SHOULDER], lms[LM.RIGHT_HIP], lms[LM.RIGHT_KNEE])) /
      2;
    const holding = bodyLine > 150;
    return {
      repInc: 0,
      phase: holding ? "支撐中" : "調整姿勢",
      metric: Math.round(bodyLine),
      holding,
      feedback: holding ? "" : "打直身體",
    };
  }
}

// 原地踏步：交替抬膝，每抬起一膝算一步
class MarchCounter implements RepCounter {
  private leftUp = false;
  private rightUp = false;
  reset() {
    this.leftUp = false;
    this.rightUp = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const hipY = avg(lms[LM.LEFT_HIP].y, lms[LM.RIGHT_HIP].y);
    const kneeToHip = 0.12;
    let repInc = 0;
    const leftKneeUp = lms[LM.LEFT_KNEE].y < hipY + kneeToHip;
    const rightKneeUp = lms[LM.RIGHT_KNEE].y < hipY + kneeToHip;
    if (leftKneeUp && !this.leftUp) {
      this.leftUp = true;
      repInc += 1;
    } else if (!leftKneeUp) {
      this.leftUp = false;
    }
    if (rightKneeUp && !this.rightUp) {
      this.rightUp = true;
      repInc += 1;
    } else if (!rightKneeUp) {
      this.rightUp = false;
    }
    return {
      repInc,
      phase: leftKneeUp || rightKneeUp ? "抬膝" : "放下",
      progress: leftKneeUp || rightKneeUp ? 1 : 0,
    };
  }
}

// 超慢跑：專業步頻模型。
// 逐腳追蹤腳踝相對「自適應基準線」的抬起，用遲滯(hysteresis)避免抖動誤判，
// 並以最近數步的時間間隔換算即時步頻(步/分)，同時檢查步幅是否過大。
class SlowJogCounter implements RepCounter {
  private baseL: number | null = null;
  private baseR: number | null = null;
  private upL = false;
  private upR = false;
  private stepTimes: number[] = [];
  private lastAmp = 0;

  reset() {
    this.baseL = null;
    this.baseR = null;
    this.upL = false;
    this.upR = false;
    this.stepTimes = [];
    this.lastAmp = 0;
  }

  private track(
    ankleY: number,
    base: number | null,
    up: boolean,
    rise: number,
    now: number,
  ): { base: number; up: boolean; step: boolean } {
    // 自適應基準線：腳在地面(未抬起)時緩慢更新
    let b = base ?? ankleY;
    if (!up) b = b * 0.92 + ankleY * 0.08;
    // y 越小越高：抬起門檻與放下門檻（遲滯）
    const upThresh = b - rise; // 抬到超過 rise 視為離地
    const downThresh = b - rise * 0.4; // 回落至此視為著地
    let step = false;
    let u = up;
    if (!up && ankleY < upThresh) {
      u = true;
    } else if (up && ankleY > downThresh) {
      u = false;
      step = true; // 一次完整「抬起→著地」= 一步
    }
    return { base: b, up: u, step };
  }

  update(lms: Landmark[]): UpdateResult {
    const now = performance.now();
    // 以肩髖距離估算身高比例，讓門檻隨遠近自適應
    const scale =
      Math.abs(
        avg(lms[LM.LEFT_SHOULDER].y, lms[LM.RIGHT_SHOULDER].y) -
          avg(lms[LM.LEFT_HIP].y, lms[LM.RIGHT_HIP].y),
      ) || 0.15;
    const rise = Math.max(0.012, scale * 0.18); // 超慢跑步幅小

    const lAnkle = lms[LM.LEFT_ANKLE].y;
    const rAnkle = lms[LM.RIGHT_ANKLE].y;

    const L = this.track(lAnkle, this.baseL, this.upL, rise, now);
    this.baseL = L.base;
    this.upL = L.up;
    const R = this.track(rAnkle, this.baseR, this.upR, rise, now);
    this.baseR = R.base;
    this.upR = R.up;

    let repInc = 0;
    if (L.step) {
      repInc += 1;
      this.stepTimes.push(now);
    }
    if (R.step) {
      repInc += 1;
      this.stepTimes.push(now);
    }
    while (this.stepTimes.length > 8) this.stepTimes.shift();

    // 即時步頻（步/分）
    let cadence = 0;
    if (this.stepTimes.length >= 3) {
      const span =
        (this.stepTimes[this.stepTimes.length - 1] - this.stepTimes[0]) / 1000;
      const cnt = this.stepTimes.length - 1;
      if (span > 0) cadence = Math.round((cnt / span) * 60);
    }
    // 步頻太久沒更新則歸零
    if (
      this.stepTimes.length > 0 &&
      now - this.stepTimes[this.stepTimes.length - 1] > 2000
    ) {
      cadence = 0;
    }

    // 步幅回饋：抬得過高代表不是超慢跑
    const amp = Math.max(
      (this.baseL ?? lAnkle) - lAnkle,
      (this.baseR ?? rAnkle) - rAnkle,
    );
    this.lastAmp = this.lastAmp * 0.8 + amp * 0.2;
    let feedback = "";
    if (cadence > 0 && cadence < 140) feedback = "步頻再快一點";
    else if (this.lastAmp > rise * 2.2) feedback = "步幅放小、輕輕跑";

    return {
      repInc,
      phase: this.upL || this.upR ? "騰步" : "著地",
      cadence,
      feedback,
      progress: Math.min(1, this.lastAmp / (rise * 1.5)),
    };
  }
}
// 胯下擊掌：抬起單腳，於大腿下方雙手靠攏擊掌算一次。
// 判定條件：有一腳膝蓋明顯抬起(高於髖) + 雙手腕距離很近(擊掌) + 手腕位置偏低(在胯下附近)。
// 用「擊掌合起→分開」的循環避免同一次重複計數。
class CrotchClapCounter implements RepCounter {
  private clapped = false;
  reset() {
    this.clapped = false;
  }
  update(lms: Landmark[]): UpdateResult {
    const hipY = avg(lms[LM.LEFT_HIP].y, lms[LM.RIGHT_HIP].y);
    // 身高比例尺（肩到髖），讓門檻隨遠近自適應
    const scale =
      Math.abs(avg(lms[LM.LEFT_SHOULDER].y, lms[LM.RIGHT_SHOULDER].y) - hipY) ||
      0.15;
    const shoulderW =
      Math.abs(lms[LM.LEFT_SHOULDER].x - lms[LM.RIGHT_SHOULDER].x) || 0.15;

    // 是否有一腳抬起（膝蓋高於髖部一定幅度）
    const kneeUp =
      lms[LM.LEFT_KNEE].y < hipY - scale * 0.15 ||
      lms[LM.RIGHT_KNEE].y < hipY - scale * 0.15;

    // 雙手腕距離（擊掌時很近）
    const wristDist = Math.hypot(
      lms[LM.LEFT_WRIST].x - lms[LM.RIGHT_WRIST].x,
      lms[LM.LEFT_WRIST].y - lms[LM.RIGHT_WRIST].y,
    );
    const handsTogether = wristDist < shoulderW * 0.5;

    // 手腕偏低（在胯下附近，低於髖部）
    const wristY = avg(lms[LM.LEFT_WRIST].y, lms[LM.RIGHT_WRIST].y);
    const handsLow = wristY > hipY - scale * 0.2;

    let repInc = 0;
    let feedback = "";
    if (kneeUp && handsTogether && handsLow) {
      if (!this.clapped) {
        this.clapped = true;
        repInc = 1;
      }
    } else if (wristDist > shoulderW * 0.9) {
      // 雙手明顯分開後，才允許下一次計數
      this.clapped = false;
    }

    if (kneeUp && !handsLow) feedback = "手往胯下拍";
    else if (kneeUp && !handsTogether && !this.clapped) feedback = "雙手靠攏擊掌";

    return {
      repInc,
      phase: this.clapped ? "擊掌" : kneeUp ? "抬腳" : "準備",
      progress: this.clapped ? 1 : kneeUp ? 0.5 : 0,
      feedback,
    };
  }
}

export function createCounter(key: ExerciseKey): RepCounter {
  switch (key) {
    case "squat":
      return new SquatCounter();
    case "pushup":
      return new PushupCounter();
    case "situp":
      return new SitupCounter();
    case "jumpingjack":
      return new JumpingJackCounter();
    case "jump":
      return new JumpCounter();
    case "plank":
      return new PlankCounter();
    case "march":
      return new MarchCounter();
    case "slowjog":
      return new SlowJogCounter();
    case "crotchclap":
      return new CrotchClapCounter();
  }
}

// ---------- AI 自動動作分類器 ----------
// 觀察最近數十幀的姿態與動態特徵，自動判斷使用者正在做哪種運動。

type Feat = {
  torso: number; // 軀幹與垂直線夾角（0=直立, 90=水平）
  knee: number; // 膝角
  elbow: number; // 肘角
  hipAngle: number; // 肩-髖-膝角
  hipY: number;
  noseY: number;
  wristMinY: number; // 最高的手腕 y
  lKneeY: number;
  rKneeY: number;
  lAnkleY: number;
  rAnkleY: number;
  ankleSpread: number;
  shoulderW: number;
  torsoLen: number; // 肩到髖距離，作為身高比例尺
  wristDist: number; // 雙手腕距離（擊掌時會變很近）
};

function range(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.max(...arr) - Math.min(...arr);
}
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export class AutoClassifier {
  private buf: Feat[] = [];
  private cap = 55; // 約 1.8 秒

  reset() {
    this.buf = [];
  }

  push(lms: Landmark[]) {
    const sx = avg(lms[LM.LEFT_SHOULDER].x, lms[LM.RIGHT_SHOULDER].x);
    const sy = avg(lms[LM.LEFT_SHOULDER].y, lms[LM.RIGHT_SHOULDER].y);
    const hx = avg(lms[LM.LEFT_HIP].x, lms[LM.RIGHT_HIP].x);
    const hy = avg(lms[LM.LEFT_HIP].y, lms[LM.RIGHT_HIP].y);
    const dx = hx - sx;
    const dy = hy - sy;
    const torso = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;

    const knee = avg(
      angle(lms[LM.LEFT_HIP], lms[LM.LEFT_KNEE], lms[LM.LEFT_ANKLE]),
      angle(lms[LM.RIGHT_HIP], lms[LM.RIGHT_KNEE], lms[LM.RIGHT_ANKLE]),
    );
    const elbow = avg(
      angle(lms[LM.LEFT_SHOULDER], lms[LM.LEFT_ELBOW], lms[LM.LEFT_WRIST]),
      angle(lms[LM.RIGHT_SHOULDER], lms[LM.RIGHT_ELBOW], lms[LM.RIGHT_WRIST]),
    );
    const hipAngle = avg(
      angle(lms[LM.LEFT_SHOULDER], lms[LM.LEFT_HIP], lms[LM.LEFT_KNEE]),
      angle(lms[LM.RIGHT_SHOULDER], lms[LM.RIGHT_HIP], lms[LM.RIGHT_KNEE]),
    );

    this.buf.push({
      torso,
      knee,
      elbow,
      hipAngle,
      hipY: hy,
      noseY: lms[LM.NOSE].y,
      wristMinY: Math.min(lms[LM.LEFT_WRIST].y, lms[LM.RIGHT_WRIST].y),
      lKneeY: lms[LM.LEFT_KNEE].y,
      rKneeY: lms[LM.RIGHT_KNEE].y,
      lAnkleY: lms[LM.LEFT_ANKLE].y,
      rAnkleY: lms[LM.RIGHT_ANKLE].y,
      ankleSpread: Math.abs(lms[LM.LEFT_ANKLE].x - lms[LM.RIGHT_ANKLE].x),
      shoulderW: Math.abs(lms[LM.LEFT_SHOULDER].x - lms[LM.RIGHT_SHOULDER].x),
      torsoLen: Math.abs(sy - hy) || 0.15,
      wristDist: Math.hypot(
        lms[LM.LEFT_WRIST].x - lms[LM.RIGHT_WRIST].x,
        lms[LM.LEFT_WRIST].y - lms[LM.RIGHT_WRIST].y,
      ),
    });
    if (this.buf.length > this.cap) this.buf.shift();
  }

  // 回傳判定結果，若尚無把握回傳 null（代表繼續觀察）
  classify(): ExerciseKey | null {
    const b = this.buf;
    if (b.length < 25) return null;

    const avgTorso = mean(b.map((f) => f.torso));
    const shoulderW = Math.max(0.05, mean(b.map((f) => f.shoulderW)));

    // ---- 身體呈水平：伏地挺身 / 仰臥起坐 / 平板 ----
    if (avgTorso > 45) {
      const elbowR = range(b.map((f) => f.elbow));
      const hipAngleR = range(b.map((f) => f.hipAngle));
      const avgKnee = mean(b.map((f) => f.knee));
      const hipYR = range(b.map((f) => f.hipY));

      if (elbowR > 25) return "pushup";
      if (avgKnee < 120 && hipAngleR > 18) return "situp";
      // 幾乎不動 -> 平板支撐
      if (elbowR < 14 && hipYR < 0.025 && hipAngleR < 14) return "plank";
      return null;
    }

    // ---- 直立：開合跳 / 原地踏步 / 超慢跑 / 跳躍 / 深蹲 ----
    const wristAboveFrac =
      b.filter((f) => f.wristMinY < f.noseY).length / b.length;
    const ankleRnorm = range(b.map((f) => f.ankleSpread)) / shoulderW;
    const hipYR = range(b.map((f) => f.hipY));
    const kneeR = range(b.map((f) => f.knee));
    const kneeDiffR = range(b.map((f) => f.lKneeY - f.rKneeY));
    const scale = Math.max(0.05, mean(b.map((f) => f.torsoLen)));
    // 腳踝上下擺動幅度（相對身高比例）
    const lAnkleR = range(b.map((f) => f.lAnkleY)) / scale;
    const rAnkleR = range(b.map((f) => f.rAnkleY)) / scale;
    const ankleVert = Math.max(lAnkleR, rAnkleR);
    // 雙腳交替（相位相反）：左右腳踝差的擺動幅度
    const ankleAltR = range(b.map((f) => f.lAnkleY - f.rAnkleY)) / scale;
    const kneeDiffNorm = kneeDiffR / scale;

    // 雙手腕距離的變化幅度（擊掌會忽近忽遠）
    const wristDistR = range(b.map((f) => f.wristDist)) / shoulderW;

    if (wristAboveFrac > 0.25 && ankleRnorm > 0.4) return "jumpingjack";
    // 胯下擊掌：有抬膝 + 雙手距離大幅開合（擊掌）
    if (kneeDiffNorm > 0.4 && wristDistR > 0.6) return "crotchclap";
    // 原地踏步：抬膝明顯（膝蓋高低差大）、手沒有明顯開合
    if (kneeDiffNorm > 0.5 && hipYR < 0.05) return "march";
    // 超慢跑：腳踝小幅交替上下、抬膝不明顯、身體不太起伏
    if (
      ankleAltR > 0.12 &&
      ankleVert > 0.08 &&
      kneeDiffNorm < 0.5 &&
      hipYR < 0.045
    )
      return "slowjog";
    if (hipYR > 0.05 && kneeR < 25) return "jump";
    if (kneeR > 25) return "squat";
    return null;
  }

  // 觀察太久仍無結果時的保底判斷（依姿勢方向）
  fallback(): ExerciseKey {
    const avgTorso = mean(this.buf.map((f) => f.torso));
    return avgTorso > 45 ? "plank" : "squat";
  }
}

// 熱量估算：kcal = MET * 體重(kg) * 時間(小時)
export function estimateCalories(
  met: number,
  weightKg: number,
  durationSeconds: number,
): number {
  return met * weightKg * (durationSeconds / 3600);
}

// 骨架連線（用於畫圖）
export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [28, 30],
  [27, 31],
  [28, 32],
];
