import {
  Point3D,
  LANDMARK,
  calculateAngle,
  midpoint,
  distance2D,
  isVisible,
  isStanding,
  smoothValue,
} from "./pose-utils";

export type ExerciseType =
  | "squat"
  | "pushup"
  | "jumping_jack"
  | "jump"
  | "situp"
  | "leg_raise"
  | "burpee"
  | "plank"
  | "high_knees";

export interface ExerciseInfo {
  id: ExerciseType;
  name: string;
  nameZh: string;
  icon: string;
  description: string;
}

export const EXERCISES: ExerciseInfo[] = [
  { id: "squat", name: "Squat", nameZh: "深蹲", icon: "🏋️", description: "膝蓋彎曲至90度以下，保持背部挺直" },
  { id: "pushup", name: "Push-up", nameZh: "伏地挺身", icon: "💪", description: "手肘彎曲至90度以下，身體保持一直線" },
  { id: "jumping_jack", name: "Jumping Jack", nameZh: "開合跳", icon: "⭐", description: "雙手舉過頭頂，雙腳打開再合攏" },
  { id: "jump", name: "Jump", nameZh: "跳躍", icon: "🦘", description: "雙腳離地跳起，確保明顯騰空" },
  { id: "high_knees", name: "High Knees", nameZh: "高抬腿", icon: "🏃", description: "交替抬膝至腰部高度" },
  { id: "plank", name: "Plank", nameZh: "平板支撐", icon: "🧘", description: "身體保持水平，核心收緊" },
  { id: "leg_raise", name: "Leg Raise", nameZh: "抬腿", icon: "🦵", description: "躺平後雙腿抬起至90度" },
  { id: "situp", name: "Sit-up", nameZh: "仰臥起坐", icon: "🤸", description: "從平躺起身至坐姿" },
  { id: "burpee", name: "Burpee", nameZh: "波比跳", icon: "🔥", description: "站立-蹲下-伏地挺身-跳起" },
];

export interface Feedback {
  message: string;
  type: "info" | "warning" | "success" | "error";
  timestamp: number;
}

export interface ExerciseState {
  type: ExerciseType;
  phase: string;
  reps: number;
  quality: number;
  qualityHistory: number[];
  feedback: Feedback[];
  isActive: boolean;
  startTime: number;
  duration: number;
  holdTime: number; // for plank
  lastRepTime: number;
}

// Minimum time between reps to avoid double counting (ms)
const MIN_REP_INTERVAL = 400;

export function createExerciseState(type: ExerciseType): ExerciseState {
  return {
    type,
    phase: "idle",
    reps: 0,
    quality: 100,
    qualityHistory: [],
    feedback: [],
    isActive: false,
    startTime: 0,
    duration: 0,
    holdTime: 0,
    lastRepTime: 0,
  };
}

function addFeedback(
  state: ExerciseState,
  message: string,
  type: Feedback["type"] = "info"
): void {
  const now = Date.now();
  // Don't add duplicate messages within 3 seconds
  if (
    state.feedback.length > 0 &&
    state.feedback[state.feedback.length - 1].message === message &&
    now - state.feedback[state.feedback.length - 1].timestamp < 3000
  ) {
    return;
  }
  state.feedback.push({ message, type, timestamp: now });
  // Keep only last 5 messages
  if (state.feedback.length > 5) {
    state.feedback = state.feedback.slice(-5);
  }
}

function countRep(state: ExerciseState, quality: number): void {
  const now = Date.now();
  if (now - state.lastRepTime < MIN_REP_INTERVAL) return;

  state.reps++;
  state.lastRepTime = now;
  state.qualityHistory.push(quality);
  state.quality = Math.round(
    state.qualityHistory.reduce((a, b) => a + b, 0) /
      state.qualityHistory.length
  );
  addFeedback(state, `✅ 完成第 ${state.reps} 次！品質: ${quality}%`, "success");
}

// ===== SQUAT DETECTOR =====
let sqPrevKneeAngle = 180;
export function detectSquat(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];

  if (!isVisible(lKnee) || !isVisible(rKnee)) return state;

  const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);
  const kneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
  const smoothedAngle = smoothValue(kneeAngle, sqPrevKneeAngle, 0.4);
  sqPrevKneeAngle = smoothedAngle;

  // Check back alignment
  const shoulder = midpoint(lShoulder, rShoulder);
  const hip = midpoint(lHip, rHip);
  const backAngle = Math.abs(
    Math.atan2(shoulder.y - hip.y, shoulder.x - hip.x) * (180 / Math.PI) + 90
  );

  let quality = 100;

  if (state.phase === "idle" || state.phase === "standing") {
    if (smoothedAngle > 155) {
      state.phase = "standing";
    }
    if (smoothedAngle < 140) {
      state.phase = "going_down";
    }
  } else if (state.phase === "going_down") {
    if (smoothedAngle < 100) {
      state.phase = "at_bottom";
      // Check quality
      if (smoothedAngle > 90) {
        quality -= 15;
        addFeedback(state, "⚠️ 再蹲低一些，膝蓋角度不足", "warning");
      }
      if (backAngle > 30) {
        quality -= 20;
        addFeedback(state, "⚠️ 保持背部挺直", "warning");
      }
    }
    if (smoothedAngle > 160) {
      // Went back up without reaching bottom
      state.phase = "standing";
      addFeedback(state, "⚠️ 深蹲幅度不夠，請蹲更低", "warning");
    }
  } else if (state.phase === "at_bottom") {
    if (smoothedAngle > 140) {
      state.phase = "coming_up";
    }
  } else if (state.phase === "coming_up") {
    if (smoothedAngle > 155) {
      state.phase = "standing";
      quality = Math.max(quality, 60);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== PUSH-UP DETECTOR =====
let puPrevElbowAngle = 180;
export function detectPushup(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lElbow = landmarks[LANDMARK.LEFT_ELBOW];
  const rElbow = landmarks[LANDMARK.RIGHT_ELBOW];
  const lWrist = landmarks[LANDMARK.LEFT_WRIST];
  const rWrist = landmarks[LANDMARK.RIGHT_WRIST];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];

  if (!isVisible(lElbow) || !isVisible(rElbow)) return state;

  const leftElbowAngle = calculateAngle(lShoulder, lElbow, lWrist);
  const rightElbowAngle = calculateAngle(rShoulder, rElbow, rWrist);
  const elbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
  const smoothedAngle = smoothValue(elbowAngle, puPrevElbowAngle, 0.4);
  puPrevElbowAngle = smoothedAngle;

  // Check body alignment
  const shoulder = midpoint(lShoulder, rShoulder);
  const hip = midpoint(lHip, rHip);
  const bodyDrop = Math.abs(hip.y - shoulder.y);

  let quality = 100;

  if (state.phase === "idle" || state.phase === "up") {
    if (smoothedAngle > 150) {
      state.phase = "up";
    }
    if (smoothedAngle < 130) {
      state.phase = "going_down";
    }
  } else if (state.phase === "going_down") {
    if (smoothedAngle < 100) {
      state.phase = "at_bottom";
      if (smoothedAngle > 90) {
        quality -= 15;
        addFeedback(state, "⚠️ 手肘彎曲角度不足，再低一些", "warning");
      }
      if (bodyDrop > 0.1) {
        quality -= 15;
        addFeedback(state, "⚠️ 臀部太高或太低，保持身體水平", "warning");
      }
    }
    if (smoothedAngle > 155) {
      state.phase = "up";
    }
  } else if (state.phase === "at_bottom") {
    if (smoothedAngle > 130) {
      state.phase = "coming_up";
    }
  } else if (state.phase === "coming_up") {
    if (smoothedAngle > 150) {
      state.phase = "up";
      quality = Math.max(quality, 60);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== JUMPING JACK DETECTOR =====
export function detectJumpingJack(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lWrist = landmarks[LANDMARK.LEFT_WRIST];
  const rWrist = landmarks[LANDMARK.RIGHT_WRIST];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lElbow = landmarks[LANDMARK.LEFT_ELBOW];
  const rElbow = landmarks[LANDMARK.RIGHT_ELBOW];

  if (!isVisible(lWrist) || !isVisible(rWrist)) return state;

  // Check arm position - arms should be above shoulders when open
  const armsUp = lWrist.y < lShoulder.y && rWrist.y < rShoulder.y;

  // Check leg spread
  const hipWidth = distance2D(lHip, rHip);
  const ankleWidth = distance2D(lAnkle, rAnkle);
  const legsApart = ankleWidth > hipWidth * 1.5;

  // Arm angle check
  const lArmAngle = calculateAngle(lElbow, lShoulder, lHip);
  const rArmAngle = calculateAngle(rElbow, rShoulder, rHip);
  const armsWide = lArmAngle > 100 && rArmAngle > 100;

  const isOpen = armsUp && (legsApart || armsWide);
  const isClosed = !armsUp && !legsApart;

  let quality = 100;

  if (state.phase === "idle" || state.phase === "closed") {
    if (isClosed) {
      state.phase = "closed";
    }
    if (isOpen) {
      state.phase = "open";
      if (!armsUp) {
        quality -= 20;
        addFeedback(state, "⚠️ 手臂舉得更高", "warning");
      }
      if (!legsApart) {
        quality -= 15;
        addFeedback(state, "⚠️ 雙腳打開幅度不夠", "warning");
      }
    }
  } else if (state.phase === "open") {
    if (isClosed) {
      state.phase = "closed";
      quality = Math.max(quality, 65);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== JUMP DETECTOR =====
let jumpBaseline = 0;
let jumpFrameCount = 0;
export function detectJump(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];

  if (!isVisible(lAnkle) || !isVisible(rAnkle)) return state;

  const ankleY = (lAnkle.y + rAnkle.y) / 2;

  // Establish baseline (average ankle position when standing)
  if (jumpFrameCount < 30) {
    jumpBaseline = jumpBaseline === 0 ? ankleY : smoothValue(ankleY, jumpBaseline, 0.1);
    jumpFrameCount++;
    state.phase = "calibrating";
    return state;
  }

  // Jump is detected when ankle position rises significantly
  const jumpThreshold = 0.04;
  const isInAir = ankleY < jumpBaseline - jumpThreshold;

  if (state.phase === "calibrating" || state.phase === "grounded") {
    if (!isInAir) {
      state.phase = "grounded";
      jumpBaseline = smoothValue(ankleY, jumpBaseline, 0.02);
    }
    if (isInAir) {
      state.phase = "airborne";
    }
  } else if (state.phase === "airborne") {
    if (!isInAir) {
      state.phase = "grounded";
      const jumpHeight = jumpBaseline - ankleY;
      let quality = Math.min(100, Math.round((jumpHeight / 0.1) * 100));
      quality = Math.max(50, quality);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== HIGH KNEES DETECTOR =====
let hkLastSide: "left" | "right" | "none" = "none";
export function detectHighKnees(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];

  if (!isVisible(lKnee) || !isVisible(rKnee)) return state;

  const hipY = (lHip.y + rHip.y) / 2;
  const kneeThreshold = hipY - 0.02;

  const leftKneeUp = lKnee.y < kneeThreshold;
  const rightKneeUp = rKnee.y < kneeThreshold;

  let quality = 100;

  if (leftKneeUp && hkLastSide !== "left") {
    if (lKnee.y > hipY - 0.05) {
      quality = 70;
      addFeedback(state, "⚠️ 左膝抬得更高", "warning");
    }
    hkLastSide = "left";
    state.phase = "left_up";
    countRep(state, quality);
  } else if (rightKneeUp && hkLastSide !== "right") {
    if (rKnee.y > hipY - 0.05) {
      quality = 70;
      addFeedback(state, "⚠️ 右膝抬得更高", "warning");
    }
    hkLastSide = "right";
    state.phase = "right_up";
    countRep(state, quality);
  } else if (!leftKneeUp && !rightKneeUp) {
    state.phase = "standing";
  }

  return state;
}

// ===== PLANK DETECTOR =====
let plankStartTime = 0;
export function detectPlank(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];

  const shoulder = midpoint(lShoulder, rShoulder);
  const hip = midpoint(lHip, rHip);
  const ankle = midpoint(lAnkle, rAnkle);

  // Check if body is roughly horizontal
  const shoulderHipDiff = Math.abs(shoulder.y - hip.y);
  const hipAnkleDiff = Math.abs(hip.y - ankle.y);
  const isHorizontal = shoulderHipDiff < 0.12 && hipAnkleDiff < 0.12;

  // Check hip sag or pike
  const hipSag = hip.y > Math.max(shoulder.y, ankle.y) + 0.05;
  const hipPike = hip.y < Math.min(shoulder.y, ankle.y) - 0.05;

  if (isHorizontal && !hipSag && !hipPike) {
    if (state.phase !== "holding") {
      state.phase = "holding";
      plankStartTime = Date.now();
      addFeedback(state, "✅ 平板支撐姿勢正確，保持住！", "success");
    }
    state.holdTime = Math.round((Date.now() - plankStartTime) / 1000);
    state.reps = state.holdTime; // Use reps to show seconds

    if (hipSag) {
      addFeedback(state, "⚠️ 臀部下沉，收緊核心", "warning");
    }

    // Update quality based on alignment
    const alignment = 100 - Math.round((shoulderHipDiff + hipAnkleDiff) * 200);
    state.quality = Math.max(50, Math.min(100, alignment));
  } else {
    if (state.phase === "holding") {
      addFeedback(
        state,
        `⏱️ 平板支撐結束，撐了 ${state.holdTime} 秒`,
        "info"
      );
    }
    state.phase = "idle";
    if (hipSag) {
      addFeedback(state, "⚠️ 臀部下沉，收緊核心肌群", "warning");
    }
    if (hipPike) {
      addFeedback(state, "⚠️ 臀部太高，身體保持一直線", "warning");
    }
  }

  return state;
}

// ===== LEG RAISE DETECTOR =====
let lrPrevLegAngle = 180;
export function detectLegRaise(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];

  const hip = midpoint(lHip, rHip);
  const knee = midpoint(lKnee, rKnee);
  const ankle = midpoint(lAnkle, rAnkle);
  const shoulder = midpoint(lShoulder, rShoulder);

  // Angle between torso and legs at the hip
  const legAngle = calculateAngle(shoulder, hip, ankle);
  const smoothedAngle = smoothValue(legAngle, lrPrevLegAngle, 0.4);
  lrPrevLegAngle = smoothedAngle;

  let quality = 100;

  // Check knee straightness
  const kneeAngle = calculateAngle(hip, knee, ankle);
  if (kneeAngle < 150) {
    quality -= 15;
  }

  if (state.phase === "idle" || state.phase === "down") {
    if (smoothedAngle > 150) {
      state.phase = "down";
    }
    if (smoothedAngle < 120) {
      state.phase = "raising";
    }
  } else if (state.phase === "raising") {
    if (smoothedAngle < 100) {
      state.phase = "at_top";
      if (smoothedAngle > 95) {
        quality -= 10;
        addFeedback(state, "⚠️ 腿再抬高一些", "warning");
      }
      if (kneeAngle < 150) {
        addFeedback(state, "⚠️ 保持雙腿伸直", "warning");
      }
    }
    if (smoothedAngle > 155) {
      state.phase = "down";
    }
  } else if (state.phase === "at_top") {
    if (smoothedAngle > 130) {
      state.phase = "lowering";
    }
  } else if (state.phase === "lowering") {
    if (smoothedAngle > 150) {
      state.phase = "down";
      quality = Math.max(quality, 60);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== SIT-UP DETECTOR =====
let suPrevAngle = 180;
export function detectSitup(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];

  const shoulder = midpoint(lShoulder, rShoulder);
  const hip = midpoint(lHip, rHip);
  const knee = midpoint(lKnee, rKnee);

  const torsoAngle = calculateAngle(shoulder, hip, knee);
  const smoothedAngle = smoothValue(torsoAngle, suPrevAngle, 0.4);
  suPrevAngle = smoothedAngle;

  let quality = 100;

  if (state.phase === "idle" || state.phase === "lying") {
    if (smoothedAngle > 140) {
      state.phase = "lying";
    }
    if (smoothedAngle < 120) {
      state.phase = "rising";
    }
  } else if (state.phase === "rising") {
    if (smoothedAngle < 80) {
      state.phase = "sitting";
      if (smoothedAngle > 70) {
        quality -= 10;
        addFeedback(state, "⚠️ 起身再高一些", "warning");
      }
    }
    if (smoothedAngle > 145) {
      state.phase = "lying";
      addFeedback(state, "⚠️ 動作幅度不夠", "warning");
    }
  } else if (state.phase === "sitting") {
    if (smoothedAngle > 110) {
      state.phase = "going_down";
    }
  } else if (state.phase === "going_down") {
    if (smoothedAngle > 140) {
      state.phase = "lying";
      quality = Math.max(quality, 60);
      countRep(state, quality);
    }
  }

  return state;
}

// ===== BURPEE DETECTOR =====
let burpeeSubPhase = 0; // 0=standing, 1=down, 2=plank, 3=up, 4=jump
export function detectBurpee(
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  const lShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const lHip = landmarks[LANDMARK.LEFT_HIP];
  const rHip = landmarks[LANDMARK.RIGHT_HIP];
  const lKnee = landmarks[LANDMARK.LEFT_KNEE];
  const rKnee = landmarks[LANDMARK.RIGHT_KNEE];
  const lAnkle = landmarks[LANDMARK.LEFT_ANKLE];
  const rAnkle = landmarks[LANDMARK.RIGHT_ANKLE];

  const shoulder = midpoint(lShoulder, rShoulder);
  const hip = midpoint(lHip, rHip);
  const ankle = midpoint(lAnkle, rAnkle);

  const standing = isStanding(landmarks);
  const kneeAngle =
    (calculateAngle(lHip, lKnee, lAnkle) +
      calculateAngle(rHip, rKnee, rAnkle)) /
    2;
  const isLow = shoulder.y > hip.y - 0.05 || kneeAngle < 100;

  const quality = 85;

  if (burpeeSubPhase === 0) {
    state.phase = "standing";
    if (isLow) {
      burpeeSubPhase = 1;
      state.phase = "squatting_down";
    }
  } else if (burpeeSubPhase === 1) {
    state.phase = "going_down";
    if (Math.abs(shoulder.y - hip.y) < 0.1 && Math.abs(hip.y - ankle.y) < 0.15) {
      burpeeSubPhase = 2;
      state.phase = "in_plank";
    }
  } else if (burpeeSubPhase === 2) {
    state.phase = "plank_position";
    if (standing || kneeAngle > 140) {
      burpeeSubPhase = 3;
      state.phase = "getting_up";
    }
  } else if (burpeeSubPhase === 3) {
    state.phase = "getting_up";
    if (standing && kneeAngle > 160) {
      burpeeSubPhase = 0;
      state.phase = "standing";
      countRep(state, quality);
    }
  }

  return state;
}

// ===== MAIN DETECTOR =====
export function detectExercise(
  type: ExerciseType,
  landmarks: Point3D[],
  state: ExerciseState
): ExerciseState {
  if (!state.isActive) {
    state.isActive = true;
    state.startTime = Date.now();
  }
  state.duration = Math.round((Date.now() - state.startTime) / 1000);

  switch (type) {
    case "squat":
      return detectSquat(landmarks, state);
    case "pushup":
      return detectPushup(landmarks, state);
    case "jumping_jack":
      return detectJumpingJack(landmarks, state);
    case "jump":
      return detectJump(landmarks, state);
    case "high_knees":
      return detectHighKnees(landmarks, state);
    case "plank":
      return detectPlank(landmarks, state);
    case "leg_raise":
      return detectLegRaise(landmarks, state);
    case "situp":
      return detectSitup(landmarks, state);
    case "burpee":
      return detectBurpee(landmarks, state);
    default:
      return state;
  }
}

// Reset detector state between exercises
export function resetDetectorState(): void {
  sqPrevKneeAngle = 180;
  puPrevElbowAngle = 180;
  jumpBaseline = 0;
  jumpFrameCount = 0;
  hkLastSide = "none";
  plankStartTime = 0;
  lrPrevLegAngle = 180;
  suPrevAngle = 180;
  burpeeSubPhase = 0;
}
