"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Point3D, POSE_CONNECTIONS, LANDMARK } from "@/lib/pose-utils";
import {
  ExerciseType,
  ExerciseState,
  EXERCISES,
  Feedback,
  createExerciseState,
  detectExercise,
  resetDetectorState,
} from "@/lib/exercise-detector";
import {
  speak,
  announceRep,
  announceExerciseStart,
  announceExerciseStop,
  announceFormCorrection,
  announceChallenge,
  announceChallengeProgress,
  announcePersonLost,
  announcePersonFound,
  announceMultiplePeople,
  announceCameraBlurred,
  announceStatus,
  setVoiceEnabled,
  unlockVoice,
} from "@/lib/voice-coach";
import {
  WEBRTC_CONFIG,
  clearSignalRoom,
  getSignals,
  parseSignal,
  postSignal,
  tuneVideoSender,
  wait,
} from "@/lib/webrtc";
import {
  playRepSound,
  playWarningSound,
  playCountdownTick,
  playChallengeSuccessSound,
} from "@/lib/sound-effects";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PoseLandmarkerResult {
  landmarks: Point3D[][];
  worldLandmarks: Point3D[][];
}
type MpPoseLandmarker = {
  detectForVideo(source: CanvasImageSource, timestamp: number): PoseLandmarkerResult;
};

type RemoteConnectionStatus = "idle" | "preparing" | "waiting" | "negotiating" | "connected" | "failed";
type CameraQuality = "clear" | "fair" | "blurred";

interface CameraSource {
  id: string;
  label: string;
  type: "local" | "remote";
  status: "active" | "connecting" | "paused" | "error";
  stream?: MediaStream;
  videoEl?: HTMLVideoElement;
  personCount: number;
}

/* ------------------------------------------------------------------ */
/*  Drawing                                                            */
/* ------------------------------------------------------------------ */
function drawRadarCircle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  label = "等待人體進入"
) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.22;
  const time = Date.now() / 1000;

  ctx.save();
  ctx.shadowBlur = 15;
  ctx.shadowColor = "rgba(6,182,212,0.4)";

  // Outer rotating target dashed ring
  ctx.strokeStyle = "rgba(6,182,212,0.75)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.setLineDash([12, 18]);
  ctx.stroke();

  // Inner rotating ring with opposite rotation
  ctx.strokeStyle = "rgba(34,211,238,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, 2 * Math.PI);
  ctx.setLineDash([6, 12]);
  ctx.stroke();

  // Radar sweeping line
  ctx.strokeStyle = "rgba(34,211,238,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(time * 2) * r, cy + Math.sin(time * 2) * r);
  ctx.stroke();

  // Center targeting point
  ctx.fillStyle = "rgba(34,211,238,0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fill();

  // Draw circular corners
  ctx.strokeStyle = "rgba(34,211,238,0.7)";
  ctx.lineWidth = 3;
  const cornerLen = 20;
  
  // Top-Left corner
  ctx.beginPath();
  ctx.moveTo(cx - r - cornerLen, cy - r);
  ctx.lineTo(cx - r, cy - r);
  ctx.lineTo(cx - r, cy - r - cornerLen);
  ctx.stroke();

  // Top-Right corner
  ctx.beginPath();
  ctx.moveTo(cx + r + cornerLen, cy - r);
  ctx.lineTo(cx + r, cy - r);
  ctx.lineTo(cx + r, cy - r - cornerLen);
  ctx.stroke();

  // Bottom-Left corner
  ctx.beginPath();
  ctx.moveTo(cx - r - cornerLen, cy + r);
  ctx.lineTo(cx - r, cy + r);
  ctx.lineTo(cx - r, cy + r + cornerLen);
  ctx.stroke();

  // Bottom-Right corner
  ctx.beginPath();
  ctx.moveTo(cx + r + cornerLen, cy + r);
  ctx.lineTo(cx + r, cy + r);
  ctx.lineTo(cx + r, cy + r + cornerLen);
  ctx.stroke();

  // High-tech Calibration label
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(34,211,238,0.95)";
  ctx.font = `bold ${Math.max(12, Math.round(w / 60))}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(`📡 [ ${label} ]`, cx, cy + r + 32);

  ctx.restore();
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Point3D[],
  w: number,
  h: number,
  quality: number
) {
  // Cyberpunk Neon Glow Scheme
  const hue = quality > 75 ? 175 : quality > 50 ? 45 : 0; // Cyan (175) is cooler than green!
  const jointColor = `hsl(${hue}, 100%, 55%)`;
  const lineColor = `hsla(${hue}, 90%, 65%, 0.85)`;
  const glowColor = `hsla(${hue}, 100%, 60%, 0.45)`;

  ctx.lineWidth = Math.max(3, Math.round(w / 220));
  ctx.strokeStyle = lineColor;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 12;

  for (const [i, j] of POSE_CONNECTIONS) {
    const a = landmarks[i];
    const b = landmarks[j];
    if ((a.visibility ?? 0) < 0.35 || (b.visibility ?? 0) < 0.35) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  const keyJoints: Set<number> = new Set([
    LANDMARK.LEFT_SHOULDER as number, LANDMARK.RIGHT_SHOULDER as number,
    LANDMARK.LEFT_ELBOW as number, LANDMARK.RIGHT_ELBOW as number,
    LANDMARK.LEFT_WRIST as number, LANDMARK.RIGHT_WRIST as number,
    LANDMARK.LEFT_HIP as number, LANDMARK.RIGHT_HIP as number,
    LANDMARK.LEFT_KNEE as number, LANDMARK.RIGHT_KNEE as number,
    LANDMARK.LEFT_ANKLE as number, LANDMARK.RIGHT_ANKLE as number,
  ]);

  ctx.shadowBlur = 18;
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if ((lm.visibility ?? 0) < 0.35) continue;
    const r = keyJoints.has(i) ? Math.max(6, Math.round(w / 140)) : Math.max(3, Math.round(w / 260));
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, r, 0, 2 * Math.PI);
    ctx.fillStyle = jointColor;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/* ------------------------------------------------------------------ */
/*  Tiny sub-components                                                */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    loading: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    ready: "bg-green-500/20 text-green-300 border-green-500/30",
    detecting: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    error: "bg-red-500/20 text-red-300 border-red-500/30",
    paused: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };
  const lbl: Record<string, string> = {
    loading: "⏳ 載入中",
    ready: "✅ 就緒",
    detecting: "🔍 偵測中",
    error: "❌ 錯誤",
    paused: "⏸️ 暫停",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium border ${cfg[status] || cfg.loading}`}>
      {lbl[status] || status}
    </span>
  );
}

function FeedbackList({ items }: { items: Feedback[] }) {
  if (!items.length) return null;
  const c: Record<string, string> = { success: "text-green-400", warning: "text-yellow-400", error: "text-red-400", info: "text-blue-400" };
  return (
    <div className="space-y-1">
      {items.slice(-4).reverse().map((fb, i) => (
        <div key={`${fb.timestamp}-${i}`} className={`text-xs sm:text-sm ${c[fb.type]} animate-fade-in`}>{fb.message}</div>
      ))}
    </div>
  );
}

function QualityRing({ quality, size = 80 }: { quality: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ - (quality / 100) * circ;
  const col = quality > 75 ? "stroke-green-400" : quality > 50 ? "stroke-yellow-400" : "stroke-red-400";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={col} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .5s" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm sm:text-lg font-bold">{quality}%</span>
      </div>
    </div>
  );
}

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function poseCenter(pose: Point3D[]): { x: number; y: number } {
  const leftHip = pose[LANDMARK.LEFT_HIP];
  const rightHip = pose[LANDMARK.RIGHT_HIP];
  return { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
}

/** Keep tracking the same person; otherwise choose the largest, clearest body. */
function selectPrimaryPose(
  poses: Point3D[][],
  previousCenter: { x: number; y: number } | null
): Point3D[] | null {
  if (poses.length === 0) return null;
  let best: Point3D[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const pose of poses) {
    const visible = pose.filter((point) => (point.visibility ?? 0) > 0.35);
    if (visible.length < 8) continue;
    const minX = Math.min(...visible.map((point) => point.x));
    const maxX = Math.max(...visible.map((point) => point.x));
    const minY = Math.min(...visible.map((point) => point.y));
    const maxY = Math.max(...visible.map((point) => point.y));
    const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    const visibility = visible.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / visible.length;
    const center = poseCenter(pose);
    const distancePenalty = previousCenter
      ? Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y) * 0.45
      : 0;
    const score = area * 1.8 + visibility - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = pose;
    }
  }
  return best;
}

function poseCompleteness(pose: Point3D[]): number {
  const pairs: [number, number][] = [
    [LANDMARK.LEFT_SHOULDER, LANDMARK.RIGHT_SHOULDER],
    [LANDMARK.LEFT_ELBOW, LANDMARK.RIGHT_ELBOW],
    [LANDMARK.LEFT_WRIST, LANDMARK.RIGHT_WRIST],
    [LANDMARK.LEFT_HIP, LANDMARK.RIGHT_HIP],
    [LANDMARK.LEFT_KNEE, LANDMARK.RIGHT_KNEE],
    [LANDMARK.LEFT_ANKLE, LANDMARK.RIGHT_ANKLE],
  ];
  return pairs.reduce((sum, [left, right]) => {
    return sum + Math.max(pose[left]?.visibility ?? 0, pose[right]?.visibility ?? 0);
  }, 0) / pairs.length;
}

/** Fast edge score. It detects defocus; it does not alter or upload the image. */
function estimateSharpness(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  try {
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const step = 8;
    let total = 0;
    let count = 0;
    for (let y = step; y < height; y += step) {
      for (let x = step; x < width; x += step) {
        const index = (y * width + x) * 4;
        const left = (y * width + x - step) * 4;
        const up = ((y - step) * width + x) * 4;
        const lum = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
        const leftLum = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
        const upLum = pixels[up] * 0.299 + pixels[up + 1] * 0.587 + pixels[up + 2] * 0.114;
        total += Math.abs(lum - leftLum) + Math.abs(lum - upLum);
        count += 2;
      }
    }
    return count > 0 ? total / count : 0;
  } catch {
    return 20;
  }
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */
export default function WorkoutApp() {
  /* refs */
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<MpPoseLandmarker | null>(null);
  const animRef = useRef(0);
  const lastTimeRef = useRef(-1);
  const lastInferenceAtRef = useRef(0);
  const lastResultRef = useRef<PoseLandmarkerResult | null>(null);
  const lastBlurCheckRef = useRef(0);
  const primaryCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastDimensionsRef = useRef({ width: 0, height: 0 });
  const personWasDetectedRef = useRef(false);

  /* state */
  const [status, setStatus] = useState<string>("loading");
  const [selectedExercise, setSelectedExercise] = useState<ExerciseType>("squat");
  const [exerciseState, setExerciseState] = useState<ExerciseState>(createExerciseState("squat"));
  const [isTracking, setIsTracking] = useState(false);
  const [personDetected, setPersonDetected] = useState(false);
  const [multiPerson, setMultiPerson] = useState(false);
  const [showMenu, setShowMenu] = useState(true);
  const [sessionExercises, setSessionExercises] = useState<{ type: ExerciseType; reps: number; duration: number; quality: number }[]>([]);
  
  // Purity: Wrap Date.now() in lazy initializer function
  const [sessionStartTime] = useState(() => Date.now());
  
  // Purity: Time state updating every second to avoid Date.now() inside render JSX body
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [totalSessionReps, setTotalSessionReps] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [challengeMode, setChallengeMode] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState(10);
  const [challengeCompleted, setChallengeCompleted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [mobileTab, setMobileTab] = useState<"cam" | "stats" | "cameras">("cam");
  const [cameraQuality, setCameraQuality] = useState<CameraQuality>("clear");
  const [inferenceMs, setInferenceMs] = useState(0);
  const [poseCoverage, setPoseCoverage] = useState(0);
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });

  // Camera management
  const [cameras, setCameras] = useState<CameraSource[]>([]);
  const [activeCameraId, setActiveCameraId] = useState("local-default");
  const [localFacing, setLocalFacing] = useState<"user" | "environment">("user");
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [showRemoteSetup, setShowRemoteSetup] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<RemoteConnectionStatus>("idle");
  const [remoteError, setRemoteError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const remotePcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStoppedRef = useRef(false);
  const remoteLastIdRef = useRef(0);
  const remotePendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  /* mutable refs for closures */
  const stateRef = useRef(exerciseState);
  const exRef = useRef(selectedExercise);
  const trackRef = useRef(isTracking);
  const prevReps = useRef(0);
  const prevFeedbackLen = useRef(0);
  const personLostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multiPersonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camerasRef = useRef(cameras);
  const activeCameraRef = useRef(activeCameraId);
  const voiceOnRef = useRef(voiceOn);
  const cameraQualityRef = useRef<CameraQuality>(cameraQuality);
  const statusRef = useRef(status);
  const localFacingRef = useRef<"user" | "environment">(localFacing);

  // Purity: Update refs inside an effect instead of during render
  useEffect(() => {
    stateRef.current = exerciseState;
    exRef.current = selectedExercise;
    trackRef.current = isTracking;
    camerasRef.current = cameras;
    activeCameraRef.current = activeCameraId;
    voiceOnRef.current = voiceOn;
    cameraQualityRef.current = cameraQuality;
    statusRef.current = status;
    localFacingRef.current = localFacing;
  }, [exerciseState, selectedExercise, isTracking, cameras, activeCameraId, voiceOn, cameraQuality, status, localFacing]);

  /* ---- voice announcements and synthesized sound effects triggered by state changes ---- */
  useEffect(() => {
    if (exerciseState.reps > prevReps.current && exerciseState.reps > 0) {
      // Rep Sound Effect is played with dynamic pitch based on execution quality
      playRepSound(exerciseState.quality);
      
      if (voiceOn) {
        const shouldSpeak = selectedExercise !== "plank" || exerciseState.reps % 5 === 0;
        if (shouldSpeak) announceRep(exerciseState.reps, exerciseState.quality);
        if (challengeMode) announceChallengeProgress(exerciseState.reps, challengeTarget);
      }
    }
    prevReps.current = exerciseState.reps;
  }, [exerciseState.reps, exerciseState.quality, voiceOn, selectedExercise, challengeMode, challengeTarget]);

  useEffect(() => {
    if (exerciseState.feedback.length > prevFeedbackLen.current) {
      const latest = exerciseState.feedback[exerciseState.feedback.length - 1];
      if (latest && latest.type === "warning") {
        // Warning sound effect played in addition to voice prompt
        playWarningSound();
        if (voiceOn) announceFormCorrection(latest.message);
      }
    }
    prevFeedbackLen.current = exerciseState.feedback.length;
  }, [exerciseState.feedback, voiceOn]);

  useEffect(() => {
    if (voiceOn && isTracking) announceStatus(exerciseState.phase);
  }, [exerciseState.phase, isTracking, voiceOn]);

  /* ---- init camera with HD display stream ---- */
  const initCamera = useCallback(async (facingMode: "user" | "environment" = "user") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 24 },
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.contentHint = "motion";
        try {
          await track.applyConstraints({
            advanced: ([{ focusMode: "continuous" }] as unknown) as MediaTrackConstraintSet[],
          });
        } catch { /* autofocus control is optional */ }
        const settings = track.getSettings();
        if (settings.width && settings.height) {
          setVideoDimensions({ width: settings.width, height: settings.height });
          lastDimensionsRef.current = { width: settings.width, height: settings.height };
        }
      }
      setLocalFacing(facingMode);
      localFacingRef.current = facingMode;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        try {
          await localVideoRef.current.play();
        } catch (playErr) {
          console.warn("Autoplay temporarily blocked on camera start, waiting for interaction:", playErr);
          setAutoplayBlocked(true);
        }
      }
      setCameras((previous) => {
        const withoutLocal = previous.filter((camera) => camera.id !== "local-default");
        return [
          { id: "local-default", label: facingMode === "user" ? "本機前鏡頭" : "本機後鏡頭", type: "local", status: "active", stream, personCount: 0 },
          ...withoutLocal,
        ];
      });
      return stream;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  /* ---- accurate model on a smaller analysis frame ---- */
  const initPose = useCallback(async () => {
    setStatus("loading");
    try {
      const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
      const fullModel = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
      const liteModel = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
      let landmarker: unknown;
      try {
        landmarker = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: fullModel, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 2,
          minPoseDetectionConfidence: 0.58,
          minPosePresenceConfidence: 0.58,
          minTrackingConfidence: 0.58,
        });
      } catch {
        landmarker = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: liteModel },
          runningMode: "VIDEO",
          numPoses: 2,
          minPoseDetectionConfidence: 0.52,
          minPosePresenceConfidence: 0.52,
          minTrackingConfidence: 0.52,
        });
      }
      landmarkerRef.current = landmarker as MpPoseLandmarker;
      analysisCanvasRef.current = document.createElement("canvas");
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  /* Hoisting Fix: Declare switcher camera function BEFORE calling it in remote connect loop */
  const switchToCamera = useCallback((cameraId: string) => {
    const camera = camerasRef.current.find((item) => item.id === cameraId);
    const video = cameraId === "local-default" ? localVideoRef.current : remoteVideoRef.current;
    if (!camera?.stream || !video) {
      console.warn("Camera or stream not found for ID:", cameraId);
      return;
    }

    setActiveCameraId(cameraId);
    activeCameraRef.current = cameraId;
    setAutoplayBlocked(false);

    // Reset video player parameters explicitly
    video.pause();
    video.srcObject = camera.stream;
    video.muted = true;
    video.playsInline = true;

    // Force reloading of stream dimensions on metadata load
    video.onloadedmetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
        lastDimensionsRef.current = { width: video.videoWidth, height: video.videoHeight };
      }
    };

    video.play()
      .then(() => {
        lastTimeRef.current = -1;
        lastInferenceAtRef.current = 0;
        lastResultRef.current = null;
        primaryCenterRef.current = null;
        setPersonDetected(false);
        setAutoplayBlocked(false);
      })
      .catch((error: unknown) => {
        console.warn("Failed to play switched camera stream (autoplay blocked):", error);
        setAutoplayBlocked(true);
      });
  }, []);

  // Hoisting Fix: Keep recursive loop inside mutable loopRef
  const loopRef = useRef<() => void>(() => {});

  /* ---- display at source quality; infer at ~20 FPS on max 640px ---- */
  const loop = useCallback(() => {
    const isLocal = activeCameraRef.current === "local-default";
    const video = isLocal ? localVideoRef.current : remoteVideoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      animRef.current = requestAnimationFrame(() => loopRef.current());
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      animRef.current = requestAnimationFrame(() => loopRef.current());
      return;
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (lastDimensionsRef.current.width !== sourceWidth || lastDimensionsRef.current.height !== sourceHeight) {
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      lastDimensionsRef.current = { width: sourceWidth, height: sourceHeight };
      setVideoDimensions({ width: sourceWidth, height: sourceHeight });
    }

    if (video.currentTime !== lastTimeRef.current) {
      lastTimeRef.current = video.currentTime;
      const isLocal_ = camerasRef.current.find((camera) => camera.id === activeCameraRef.current)?.type !== "remote";

      // Draw video frame on canvas to 100% guarantee no black screen across any browser
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.save();
      if (isLocal_) {
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();

      const now = performance.now();
      if (now - lastInferenceAtRef.current >= 50) {
        lastInferenceAtRef.current = now;
        
        // Purity & Immutability: Use purely local document-created analysis canvas to bypass ref updates warnings
        const analysis = document.createElement("canvas");
        const aspect = sourceWidth / sourceHeight;
        
        const targetWidth = aspect >= 1 ? 640 : Math.max(320, Math.round(640 * aspect));
        const targetHeight = aspect >= 1 ? Math.max(320, Math.round(640 / aspect)) : 640;
        analysis.width = targetWidth;
        analysis.height = targetHeight;
        
        const analysisCtx = analysis.getContext("2d", { willReadFrequently: true });

        if (analysisCtx) {
          analysisCtx.drawImage(video, 0, 0, analysis.width, analysis.height);

          if (now - lastBlurCheckRef.current > 1200) {
            lastBlurCheckRef.current = now;
            const sharpness = estimateSharpness(analysisCtx, analysis.width, analysis.height);
            const quality: CameraQuality = sharpness < 6 ? "blurred" : sharpness < 11 ? "fair" : "clear";
            cameraQualityRef.current = quality;
            setCameraQuality(quality);
            if (quality === "blurred" && trackRef.current && voiceOnRef.current) announceCameraBlurred();
          }

          try {
            const inferenceStart = performance.now();
            const result = landmarker.detectForVideo(analysis, inferenceStart);
            setInferenceMs(Math.round(performance.now() - inferenceStart));
            lastResultRef.current = result;

            const poses = (result.landmarks || []) as Point3D[][];
            const poseCount = poses.length;
            const primary = selectPrimaryPose(poses, primaryCenterRef.current);
            const coverage = primary ? poseCompleteness(primary) : 0;
            setPoseCoverage(Math.round(coverage * 100));

            if (poseCount > 1) {
              setMultiPerson(true);
              if (!multiPersonTimer.current) {
                multiPersonTimer.current = setTimeout(() => {
                  if (voiceOnRef.current) announceMultiplePeople();
                  multiPersonTimer.current = null;
                }, 1800);
              }
            } else {
              setMultiPerson(false);
              if (multiPersonTimer.current) {
                clearTimeout(multiPersonTimer.current);
                multiPersonTimer.current = null;
              }
            }

            if (primary) {
              const wasMissing = !personWasDetectedRef.current;
              personWasDetectedRef.current = true;
              setPersonDetected(true);
              primaryCenterRef.current = poseCenter(primary);
              if (personLostTimer.current) {
                clearTimeout(personLostTimer.current);
                personLostTimer.current = null;
              }

              const mirrored = isLocal ? primary.map((point) => ({ ...point, x: 1 - point.x })) : primary;
              drawSkeleton(ctx, mirrored, canvas.width, canvas.height, stateRef.current.quality);

              const usable = coverage >= 0.5;
              if (trackRef.current && usable) {
                if (wasMissing && statusRef.current === "paused" && voiceOnRef.current) announcePersonFound();
                if (statusRef.current !== "detecting") setStatus("detecting");
                const current = stateRef.current;
                const next = detectExercise(exRef.current, primary, { ...current });
                const changed =
                  next.reps !== current.reps || next.phase !== current.phase ||
                  next.duration !== current.duration || next.quality !== current.quality ||
                  next.pendingRepQuality !== current.pendingRepQuality ||
                  next.feedback.length !== current.feedback.length;
                stateRef.current = next;
                if (changed) setExerciseState(next);
              } else if (trackRef.current && !usable) {
                setStatus("paused");
                drawRadarCircle(ctx, canvas.width, canvas.height, "請退後一點，讓全身入鏡");
              }

              if (trackRef.current) {
                const hudHeight = Math.max(32, Math.round(canvas.height / 14));
                ctx.fillStyle = "rgba(0,0,0,.58)";
                ctx.fillRect(0, 0, Math.min(canvas.width, 360), hudHeight);
                ctx.font = `bold ${Math.max(14, Math.round(canvas.width / 55))}px system-ui, sans-serif`;
                ctx.fillStyle = usable ? "#00ff88" : "#facc15";
                ctx.fillText(usable ? `動作：${stateRef.current.phase}` : "請讓完整身體進入畫面", 10, hudHeight * 0.68);
              }

              for (const pose of poses) {
                if (pose === primary) continue;
                const secondary = isLocal ? pose.map((point) => ({ ...point, x: 1 - point.x })) : pose;
                ctx.globalAlpha = 0.25;
                drawSkeleton(ctx, secondary, canvas.width, canvas.height, 30);
                ctx.globalAlpha = 1;
              }
            } else {
              personWasDetectedRef.current = false;
              primaryCenterRef.current = null;
              setPersonDetected(false);
              // Draw revolving radar circle in center when no person is present
              drawRadarCircle(ctx, canvas.width, canvas.height, "等待人體進入");
              
              if (trackRef.current) {
                setStatus("paused");
                if (!personLostTimer.current) {
                  personLostTimer.current = setTimeout(() => {
                    if (voiceOnRef.current) announcePersonLost();
                    personLostTimer.current = null;
                  }, 1600);
                }
              }
            }
          } catch {
            // Keep displaying the live video if one inference frame fails.
          }
        }
      } else if (lastResultRef.current?.landmarks?.length) {
        const cached = selectPrimaryPose(lastResultRef.current.landmarks as Point3D[][], primaryCenterRef.current);
        if (cached) {
          const displayPose = isLocal ? cached.map((point) => ({ ...point, x: 1 - point.x })) : cached;
          drawSkeleton(ctx, displayPose, canvas.width, canvas.height, stateRef.current.quality);
        }
      }
    }

    animRef.current = requestAnimationFrame(() => loopRef.current());
  }, []);

  // Maintain reference to loop callback safely
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  /* ---- lifecycle ---- */
  useEffect(() => {
    // Avoid synchronous state cascading during initial effect trigger
    const timer = setTimeout(() => {
      void initCamera().then(() => initPose());
    }, 50);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(animRef.current);
      camerasRef.current.forEach((camera) => camera.stream?.getTracks().forEach((track) => track.stop()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "ready" || status === "detecting" || status === "paused") {
      animRef.current = requestAnimationFrame(() => loopRef.current());
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [status]);

  /* ---- switch local camera ---- */
  const switchLocalCamera = useCallback(async () => {
    const currentLocal = camerasRef.current.find((camera) => camera.id === "local-default");
    if (currentLocal?.stream) {
      currentLocal.stream.getTracks().forEach((track) => track.stop());
    }
    const nextFacing = localFacingRef.current === "user" ? "environment" : "user";
    const stream = await initCamera(nextFacing);
    if (stream) {
      setActiveCameraId("local-default");
      lastTimeRef.current = -1;
    }
  }, [initCamera]);

  /* ---- Remote camera WebRTC ---- */
  const startRemoteHost = useCallback(async (code: string) => {
    remoteStoppedRef.current = true;
    remotePcRef.current?.close();
    remotePendingCandidatesRef.current = [];
    remoteLastIdRef.current = 0;
    remoteStoppedRef.current = false;
    setRemoteConnected(false);
    setRemoteError("");
    setRemoteStatus("preparing");

    const pc = new RTCPeerConnection(WEBRTC_CONFIG);
    remotePcRef.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });

    const sendHostOffer = async (iceRestart = false): Promise<boolean> => {
      if (pc.signalingState === "closed") return false;

      try {
        if (
          pc.signalingState === "have-local-offer" &&
          pc.localDescription
        ) {
          return await postSignal(code, "host", "offer", {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          });
        }

        if (pc.signalingState !== "stable") return false;
        const offer = await pc.createOffer({ iceRestart });
        await pc.setLocalDescription(offer);
        return await postSignal(code, "host", "offer", {
          type: offer.type,
          sdp: offer.sdp,
        });
      } catch {
        return false;
      }
    };

    pc.ontrack = (event) => {
      const stream =
        event.streams[0] || new MediaStream([event.track]);

      try {
        const receiver = event.receiver as RTCRtpReceiver & {
          playoutDelayHint?: number;
          jitterBufferTarget?: number;
        };
        receiver.playoutDelayHint = 0;
        receiver.jitterBufferTarget = 0;
      } catch {
        // Low-latency receiver hints are not supported by every browser.
      }

      if (remoteVideoRef.current) {
        const remoteVideo = remoteVideoRef.current;
        remoteVideo.pause();
        remoteVideo.srcObject = stream;
        remoteVideo.muted = true;
        remoteVideo.playsInline = true;
        remoteVideo.play()
          .catch((err) => {
            console.warn("Autoplay blocked on remote track play:", err);
            setAutoplayBlocked(true);
          });
      }

      setCameras((previous) => {
        const withoutCurrent = previous.filter(
          (camera) => camera.id !== `remote-${code}`,
        );
        return [
          ...withoutCurrent,
          {
            id: `remote-${code}`,
            label: `手機鏡頭 ${code}`,
            type: "remote",
            status: "active",
            stream,
            personCount: 0,
          },
        ];
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void postSignal(
          code,
          "host",
          "candidate",
          event.candidate.toJSON(),
        );
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setRemoteConnected(true);
        setRemoteStatus("connected");
        setRemoteError("");
        if (voiceOnRef.current) {
          speak(
            "遠端手機鏡頭已連線，系統已自動為您切換至手機畫面",
            "high",
            "remote-connected",
            0,
          );
        }
        // Automatically switch to the newly connected remote mobile camera stream
        window.setTimeout(() => {
          switchToCamera(`remote-${code}`);
        }, 1200);
      } else if (pc.connectionState === "connecting") {
        setRemoteStatus("negotiating");
      } else if (pc.connectionState === "failed") {
        setRemoteConnected(false);
        setRemoteStatus("failed");
        setRemoteError(
          "裝置已交換連線資訊，但目前網路阻擋 P2P。請改用同一個 Wi-Fi，或設定 TURN。",
        );
      } else if (pc.connectionState === "disconnected") {
        setRemoteStatus("negotiating");
        setRemoteError("手機影像暫時中斷，正在等待恢復");
      }
    };

    // The host creates the room offer before the phone opens the link.
    const offerSent = await sendHostOffer();
    if (!offerSent) {
      setRemoteStatus("failed");
      setRemoteError(
        "無法建立連線房間。請確認 Vercel 已設定 DATABASE_URL，並建立 signaling 資料表。",
      );
      return;
    }
    setRemoteStatus("waiting");

    while (!remoteStoppedRef.current && remotePcRef.current === pc) {
      const messages = await getSignals(
        code,
        "host",
        remoteLastIdRef.current,
      );

      for (const message of messages) {
        remoteLastIdRef.current = Math.max(
          remoteLastIdRef.current,
          message.id,
        );

        if (message.msgType === "ready") {
          setRemoteStatus("negotiating");
          // Repost the same offer so a newly opened phone sees it immediately.
          if (
            pc.signalingState === "have-local-offer" &&
            pc.localDescription
          ) {
            await postSignal(code, "host", "offer", {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            });
          }
        } else if (message.msgType === "answer") {
          const answer = parseSignal<RTCSessionDescriptionInit>(message);
          if (!answer || answer.type !== "answer") continue;

          try {
            if (pc.signalingState === "have-local-offer") {
              setRemoteStatus("negotiating");
              await pc.setRemoteDescription(answer);
              const queued = remotePendingCandidatesRef.current.splice(0);
              for (const candidate of queued) {
                try { await pc.addIceCandidate(candidate); } catch { /* ignore stale candidate */ }
              }
            }
          } catch {
            setRemoteStatus("failed");
            setRemoteError("收到手機回覆，但套用連線資訊失敗");
          }
        } else if (message.msgType === "candidate") {
          const candidate = parseSignal<RTCIceCandidateInit>(message);
          if (!candidate) continue;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(candidate);
            } catch {
              // Ignore stale ICE candidates.
            }
          } else {
            remotePendingCandidatesRef.current.push(candidate);
          }
        } else if (
          message.msgType === "bye" &&
          pc.connectionState !== "connected"
        ) {
          setRemoteStatus("waiting");
        }
      }

      await wait(pc.connectionState === "connected" ? 1000 : 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchToCamera]);

  const generateRoom = useCallback(async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
    setShowRemoteSetup(true);
    setRemoteStatus("preparing");
    await clearSignalRoom(code);
    // Waiting begins automatically; there is no second button to forget.
    void startRemoteHost(code);
  }, [startRemoteHost]);

  const retryRemote = useCallback(async () => {
    if (!roomCode) return;
    remoteStoppedRef.current = true;
    remotePcRef.current?.close();
    setRemoteStatus("preparing");
    setRemoteError("");
    await clearSignalRoom(roomCode);
    void startRemoteHost(roomCode);
  }, [roomCode, startRemoteHost]);

  const cancelRemoteSetup = useCallback(() => {
    remoteStoppedRef.current = true;
    remotePcRef.current?.close();
    if (roomCode) void postSignal(roomCode, "host", "bye", { at: Date.now() });
    setShowRemoteSetup(false);
    setRemoteStatus("idle");
    setRoomCode("");
  }, [roomCode]);

  const shareRemoteLink = useCallback(async () => {
    if (!roomCode) return;
    const url = `${window.location.origin}/camera/${roomCode}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "AI 遠端攝影機", text: `房間代碼：${roomCode}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 1800);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 1800);
      } catch { /* clipboard may be blocked */ }
    }
  }, [roomCode]);

  /* ---- exercise handlers ---- */
  const selectExercise = useCallback((type: ExerciseType) => {
    if (exerciseState.reps > 0) {
      setSessionExercises((p) => [...p, { type: exerciseState.type, reps: exerciseState.reps, duration: exerciseState.duration, quality: exerciseState.quality }]);
      setTotalSessionReps((p) => p + exerciseState.reps);
    }
    resetDetectorState();
    const freshState = createExerciseState(type);
    setSelectedExercise(type);
    setExerciseState(freshState);
    setShowMenu(false);
    setChallengeCompleted(false);
    prevReps.current = 0;
    prevFeedbackLen.current = 0;
  }, [exerciseState]);

  const resetCurrentExercise = useCallback(() => {
    resetDetectorState();
    const freshState = createExerciseState(selectedExercise);
    setExerciseState(freshState);
    setChallengeCompleted(false);
    prevReps.current = 0;
    prevFeedbackLen.current = 0;
  }, [selectedExercise]);

  const toggleTrack = useCallback(() => {
    if (isTracking) {
      setIsTracking(false);
      setStatus("ready");
      if (voiceOn) announceExerciseStop(exerciseState.reps);
    } else {
      if (voiceOn) unlockVoice();
      resetDetectorState();
      const freshState = createExerciseState(selectedExercise);
      setExerciseState(freshState);
      setIsTracking(true);
      setStatus(personDetected && poseCoverage >= 50 ? "detecting" : "paused");
      setChallengeCompleted(false);
      prevReps.current = 0;
      prevFeedbackLen.current = 0;
      const exercise = EXERCISES.find((item) => item.id === selectedExercise);
      // Play sweet countdown sound effects in sync!
      playCountdownTick();
      if (voiceOn && exercise) {
        window.setTimeout(() => {
          playCountdownTick();
          announceExerciseStart(exercise.nameZh);
        }, 250);
      }
    }
  }, [isTracking, selectedExercise, voiceOn, exerciseState.reps, personDetected, poseCoverage]);

  // Synchronous State cascading triggers fix
  useEffect(() => {
    if (challengeMode && !challengeCompleted && exerciseState.reps >= challengeTarget) {
      const timer = setTimeout(() => {
        setChallengeCompleted(true);
        setShowCompletion(true);
        // Play sweet triumphant sound effects!
        playChallengeSuccessSound();
        const exerciseInfo = EXERCISES.find((e) => e.id === selectedExercise);
        if (voiceOn && exerciseInfo) announceChallenge(challengeTarget, exerciseInfo.nameZh);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [exerciseState.reps, challengeMode, challengeTarget, challengeCompleted, voiceOn, selectedExercise]);

  const saveSession = useCallback(async () => {
    const all = [...sessionExercises];
    if (exerciseState.reps > 0) all.push({ type: exerciseState.type, reps: exerciseState.reps, duration: exerciseState.duration, quality: exerciseState.quality });
    if (!all.length) return;
    const tr = all.reduce((s, e) => s + e.reps, 0);
    const td = Math.round((Date.now() - sessionStartTime) / 1000);
    const aq = all.reduce((s, e) => s + e.quality, 0) / all.length;

    const payload = { totalDuration: td, totalReps: tr, avgQuality: Math.round(aq), exercises: all };

    try {
      const res = await fetch("/api/workouts", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(payload) 
      });
      if (res.ok) {
        if (voiceOn) speak("運動紀錄已儲存", "high");
        alert("✅ 運動紀錄已成功儲存至雲端！");
      } else {
        throw new Error("Server rejected request");
      }
    } catch { 
      // Safe offline recovery! Store session locally inside localStorage
      try {
        const key = "offline_workout_sessions";
        const existing = JSON.parse(localStorage.getItem(key) || "[]") as Array<typeof payload & { id: string; startedAt: string }>;
        const newSession = {
          ...payload,
          id: `offline-${Math.random().toString(36).slice(2, 9)}`,
          startedAt: new Date().toISOString(),
        };
        existing.push(newSession);
        localStorage.setItem(key, JSON.stringify(existing));
        if (voiceOn) speak("雲端連線異常，已自動備份至本機暫存", "high");
        alert("💾 雲端連線失敗，運動紀錄已為您安全備份至本機暫存！連線後將自動同步。");
      } catch {
        alert("❌ 儲存失敗，且本機儲存空間已滿，請確認網路正常。");
      }
    }
  }, [sessionExercises, exerciseState, sessionStartTime, voiceOn]);

  const toggleVoice = useCallback(() => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    if (next) unlockVoice();
  }, [voiceOn]);

  /* cleanup remote on unmount */
  useEffect(() => {
    const remoteVideo = remoteVideoRef.current;
    return () => {
      remoteStoppedRef.current = true;
      remotePcRef.current?.close();
      if (remoteVideo) {
        try { remoteVideo.pause(); remoteVideo.srcObject = null; } catch { /* ignore */ }
      }
    };
  }, []);

  const info = EXERCISES.find((e) => e.id === selectedExercise)!;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const cameraAspect = videoDimensions.width / Math.max(1, videoDimensions.height);
  const qualityLabel = cameraQuality === "clear" ? "清晰" : cameraQuality === "fair" ? "普通" : "模糊";

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col">
      {/* ---- HEADER ---- */}
      <header className="bg-black/50 backdrop-blur-md border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3 flex-shrink-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-1.5 hover:opacity-80 transition flex-shrink-0">
            <span className="text-xl sm:text-2xl">🏋️‍♂️</span>
            <span className="text-sm sm:text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent hidden xs:inline">AI 運動教練</span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <StatusBadge status={status} />
            <button onClick={toggleVoice} className={`p-1.5 sm:p-2 rounded-lg transition text-xs sm:text-sm ${voiceOn ? "bg-cyan-500/20 text-cyan-300" : "bg-white/10 text-gray-400"}`} title="語音播報">
              {voiceOn ? "🔊" : "🔇"}
            </button>
            <button onClick={() => { setShowCameraPanel(!showCameraPanel); setMobileTab("cameras"); }} className="p-1.5 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm" title="鏡頭管理">
              📹 <span className="hidden sm:inline text-[10px] text-gray-400">{cameras.length}</span>
            </button>
            <button onClick={switchLocalCamera} className="p-1.5 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm" title="切換鏡頭">📷</button>
            <Link href="/history" className="px-2 py-1.5 sm:px-3 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm">📊<span className="hidden sm:inline ml-1">紀錄</span></Link>
          </div>
        </div>
      </header>

      {/* ---- MOBILE BOTTOM NAV ---- */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/10 z-40 flex">
        {([["cam", "📷", "鏡頭"], ["stats", "📊", "數據"], ["cameras", "📹", "多機"]] as const).map(([id, icon, lbl]) => (
          <button key={id} onClick={() => setMobileTab(id)} className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] transition ${mobileTab === id ? "text-cyan-400" : "text-gray-500"}`}>
            <span className="text-lg">{icon}</span>{lbl}
          </button>
        ))}
      </nav>

      {/* ---- MAIN CONTENT ---- */}
      <div className="flex-1 max-w-7xl mx-auto w-full p-2 sm:p-4 pb-20 sm:pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">

          {/* ====== LEFT: CAMERA ====== */}
          <div className={`lg:col-span-2 ${mobileTab !== "cam" ? "hidden sm:block" : ""}`}>
            <div
              className="relative mx-auto max-h-[68dvh] overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl shadow-cyan-500/10 sm:rounded-2xl"
              style={{
                aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}`,
                width: cameraAspect < 1 ? `min(100%, ${Math.round(68 * cameraAspect)}dvh)` : "100%",
              }}
            >
              <video
                ref={localVideoRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0.01,
                  pointerEvents: "none",
                  zIndex: -1,
                }}
                playsInline
                muted
                autoPlay
              />
              <video
                ref={remoteVideoRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0.01,
                  pointerEvents: "none",
                  zIndex: -1,
                }}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-gray-900 object-contain" />

              {/* Autoplay blocked fallback overlay */}
              {autoplayBlocked && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/85 p-4 text-center">
                  <span className="mb-2 block text-5xl">▶️</span>
                  <p className="text-sm font-bold text-cyan-400 sm:text-base">手機鏡頭已連線！</p>
                  <p className="mt-1 text-xs text-gray-300">請點選下方按鈕，啟用視訊流播放與 AI 骨架偵測</p>
                  <button
                    onClick={() => {
                      const video = activeCameraRef.current === "local-default" ? localVideoRef.current : remoteVideoRef.current;
                      if (video) {
                        video.play()
                          .then(() => setAutoplayBlocked(false))
                          .catch(() => {});
                      }
                    }}
                    className="mt-4 rounded-xl bg-cyan-500 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-cyan-500/20 hover:bg-cyan-600 active:scale-95"
                  >
                    ▶️ 啟用手機畫面
                  </button>
                </div>
              )}

              {/* person-lost overlay */}
              {!personDetected && isTracking && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="p-4 text-center">
                    <span className="mb-3 block text-4xl sm:text-5xl">👤</span>
                    <p className="text-base font-semibold text-yellow-400 sm:text-lg">未偵測到人物</p>
                    <p className="mt-1 text-xs text-gray-300 sm:text-sm">請確保頭、手與腳都在鏡頭範圍內</p>
                  </div>
                </div>
              )}

              {personDetected && isTracking && poseCoverage < 50 && (
                <div className="absolute bottom-12 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-yellow-500/90 px-3 py-1.5 text-[10px] font-bold text-black sm:text-xs">
                  ⚠️ 身體只有 {poseCoverage}% 可見，請退後一點
                </div>
              )}

              {cameraQuality === "blurred" && (
                <div className="absolute left-2 top-11 z-10 rounded-lg bg-orange-600/90 px-3 py-1.5 text-[10px] font-bold sm:left-3 sm:text-xs">
                  🧽 畫面模糊：擦拭鏡頭並增加光線
                </div>
              )}

              {/* multi-person warning */}
              {multiPerson && personDetected && (
                <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-red-600/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs sm:text-sm font-bold animate-pulse">
                  ⚠️ 偵測到多人 — 僅追蹤主要使用者
                </div>
              )}

              {/* rep counter overlay */}
              {isTracking && (
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-black/60 backdrop-blur-md rounded-xl px-3 py-2 sm:px-4 sm:py-3 border border-white/10 text-center">
                  <div className="text-2xl sm:text-4xl font-black text-cyan-400">{exerciseState.reps}</div>
                  <div className="text-[10px] sm:text-xs text-gray-400">{selectedExercise === "plank" ? "秒" : "次"}</div>
                </div>
              )}

              {/* camera label */}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/65 px-2 py-1 text-[9px] text-gray-200 backdrop-blur sm:bottom-3 sm:left-3 sm:text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${cameraQuality === "blurred" ? "bg-orange-400" : "bg-green-400 animate-pulse"}`} />
                <span>{cameras.find((camera) => camera.id === activeCameraId)?.label || "本機鏡頭"}</span>
                <span className="text-gray-400">{videoDimensions.width}×{videoDimensions.height}</span>
                <span className={cameraQuality === "clear" ? "text-green-300" : cameraQuality === "fair" ? "text-yellow-300" : "text-orange-300"}>{qualityLabel}</span>
                <span className="text-cyan-300">AI {inferenceMs || "—"}ms</span>
              </div>

              {/* idle overlay */}
              {!isTracking && status !== "loading" && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <p className="text-sm sm:text-lg text-white/70 text-center px-4">選擇運動後按「開始追蹤」</p>
                </div>
              )}
            </div>

            {/* ---- Controls ---- */}
            <div className="mt-2 sm:mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => setShowMenu(!showMenu)} className="flex items-center gap-1 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition font-medium text-xs sm:text-sm">
                {info.icon} {info.nameZh} <span className="text-gray-400 text-[10px]">▼</span>
              </button>
              <button onClick={toggleTrack} className={`px-4 py-2 sm:px-6 sm:py-2.5 rounded-xl font-bold transition shadow-lg text-xs sm:text-sm ${isTracking ? "bg-red-500 hover:bg-red-600 shadow-red-500/20" : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-cyan-500/20"}`}>
                {isTracking ? "⏹ 停止" : "▶️ 開始追蹤"}
              </button>
              <button onClick={resetCurrentExercise}
                className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm" title="重置目前運動">🔄</button>
              <button onClick={saveSession} className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 transition font-medium shadow-lg shadow-emerald-500/20 text-xs sm:text-sm">💾 儲存</button>
            </div>

            {/* exercise picker */}
            {showMenu && (
              <div className="mt-2 sm:mt-3 bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-white/10">
                <h3 className="text-xs font-semibold text-gray-400 mb-2">選擇運動項目</h3>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2">
                  {EXERCISES.map((ex) => (
                    <button key={ex.id} onClick={() => selectExercise(ex.id)}
                      className={`flex flex-col items-center p-2 sm:p-3 rounded-xl transition ${selectedExercise === ex.id ? "bg-cyan-500/20 border border-cyan-500/50" : "bg-white/5 hover:bg-white/10 border border-transparent"}`}>
                      <span className="text-xl sm:text-2xl mb-0.5">{ex.icon}</span>
                      <span className="text-[10px] sm:text-xs font-medium">{ex.nameZh}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ====== RIGHT: PANELS ====== */}
          <div className={`space-y-3 sm:space-y-4 ${mobileTab === "cam" ? "hidden sm:block" : ""}`}>

            {/* ---- Current exercise stats ---- */}
            <div className={`bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10 ${mobileTab === "cameras" ? "hidden sm:block" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm sm:text-lg font-bold flex items-center gap-1.5">{info.icon} {info.nameZh}</h2>
                <span className="text-[10px] sm:text-xs text-gray-400">{info.name}</span>
              </div>
              <div className="flex items-center justify-around mb-3">
                <div className="text-center">
                  <div className="text-3xl sm:text-4xl font-black text-cyan-400">{exerciseState.reps}</div>
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{selectedExercise === "plank" ? "秒數" : "完成次數"}</div>
                </div>
                <QualityRing quality={exerciseState.quality} size={typeof window !== "undefined" && window.innerWidth < 640 ? 64 : 80} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/5 rounded-lg sm:rounded-xl p-2 text-center">
                  <div className="text-sm sm:text-lg font-bold">{fmt(exerciseState.duration)}</div>
                  <div className="text-[10px] sm:text-xs text-gray-400">時間</div>
                </div>
                <div className="bg-white/5 rounded-lg sm:rounded-xl p-2 text-center">
                  <div className="text-sm sm:text-lg font-bold capitalize">{exerciseState.phase === "idle" ? "等待中" : exerciseState.phase}</div>
                  <div className="text-[10px] sm:text-xs text-gray-400">階段</div>
                </div>
              </div>
              <div className="mt-2 p-2 bg-white/5 rounded-lg"><p className="text-[10px] sm:text-xs text-gray-400">{info.description}</p></div>
            </div>

            {/* ---- AI Feedback ---- */}
            <div className={`bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10 ${mobileTab === "cameras" ? "hidden sm:block" : ""}`}>
              <h3 className="text-xs sm:text-sm font-bold text-gray-300 mb-2 flex items-center gap-1.5">🤖 AI 教練回饋{voiceOn && <span className="text-[10px] text-cyan-400">🔊 語音播報中</span>}</h3>
              {exerciseState.feedback.length > 0 ? <FeedbackList items={exerciseState.feedback} /> : <p className="text-[10px] sm:text-xs text-gray-500">開始運動後，AI 教練會即時給予動作建議與語音播報</p>}
            </div>

            {/* ---- Challenge ---- */}
            <div className={`bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10 ${mobileTab === "cameras" ? "hidden sm:block" : ""}`}>
              <h3 className="text-xs sm:text-sm font-bold text-gray-300 mb-2">🎯 挑戰模式</h3>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setChallengeMode(!challengeMode)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${challengeMode ? "bg-orange-500/30 text-orange-300 border border-orange-500/40" : "bg-white/10 text-gray-400"}`}>
                  {challengeMode ? "🔥 已開啟" : "開啟挑戰"}
                </button>
                {challengeMode && (
                  <select value={challengeTarget} onChange={(e) => setChallengeTarget(parseInt(e.target.value))} className="bg-white/10 rounded-lg px-2 py-1 text-xs border border-white/10">
                    {[5, 10, 15, 20, 30, 50, 100].map((n) => <option key={n} value={n} className="bg-gray-900">{n} 次</option>)}
                  </select>
                )}
              </div>
              {challengeMode && (
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>{exerciseState.reps}/{challengeTarget}</span><span>{Math.min(100, Math.round((exerciseState.reps / challengeTarget) * 100))}%</span></div>
                  <div className="w-full bg-white/10 rounded-full h-2"><div className="bg-gradient-to-r from-orange-500 to-yellow-400 h-2 rounded-full transition-all" style={{ width: `${Math.min(100, (exerciseState.reps / challengeTarget) * 100)}%` }} /></div>
                </div>
              )}
            </div>

            {/* ---- Camera Manager ---- */}
            <div className={`bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10 ${mobileTab !== "cameras" ? "hidden sm:block" : ""}`}>
              <h3 className="text-xs sm:text-sm font-bold text-gray-300 mb-3 flex items-center gap-1.5">📹 鏡頭管理 <span className="text-[10px] text-gray-500">{cameras.length} 台連線</span></h3>

              {/* Camera list */}
              <div className="space-y-2 mb-3">
                {cameras.map((cam) => (
                  <div key={cam.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${activeCameraId === cam.id ? "bg-cyan-500/15 border-cyan-500/40" : "bg-white/5 border-white/5 hover:bg-white/10"}`}
                    onClick={() => switchToCamera(cam.id)}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cam.status === "active" ? "bg-green-400" : cam.status === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-red-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{cam.label}</div>
                      <div className="text-[10px] text-gray-500">{cam.type === "local" ? "本機" : "遠端"} · {cam.status === "active" ? "使用中" : cam.status}</div>
                    </div>
                    {activeCameraId === cam.id && <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0">使用中</span>}
                  </div>
                ))}
              </div>

              {/* Add remote camera */}
              <div className="border-t border-white/10 pt-3">
                <h4 className="text-[10px] sm:text-xs font-semibold text-gray-400 mb-2">➕ 新增遠端攝影機</h4>
                <p className="text-[10px] text-gray-500 mb-2">將另一台手機作為 AI 攝影機，從不同角度捕捉動作</p>

                {!showRemoteSetup ? (
                  <button onClick={() => void generateRoom()} className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 py-2 text-xs font-medium transition hover:from-purple-700 hover:to-pink-700">
                    📱 產生連線代碼並自動等待
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-black/40 p-3 text-center">
                      <p className="mb-1 text-[10px] text-gray-400">在另一台手機輸入房間代碼</p>
                      <p className="text-2xl font-black tracking-widest text-cyan-400 sm:text-3xl">{roomCode}</p>
                    </div>

                    <div className={`rounded-lg border p-2.5 text-center ${
                      remoteStatus === "connected" ? "border-green-500/30 bg-green-500/10" :
                      remoteStatus === "failed" ? "border-red-500/30 bg-red-500/10" :
                      "border-cyan-500/20 bg-cyan-500/10"
                    }`}>
                      <p className={`text-xs font-bold ${remoteStatus === "connected" ? "text-green-300" : remoteStatus === "failed" ? "text-red-300" : "text-cyan-300"}`}>
                        {remoteStatus === "preparing" && "⏳ 正在準備連線房間"}
                        {remoteStatus === "waiting" && "📡 已自動等待手機連線"}
                        {remoteStatus === "negotiating" && "🔗 找到手機，正在建立低延遲連線"}
                        {remoteStatus === "connected" && "✅ 遠端手機鏡頭已連線"}
                        {remoteStatus === "failed" && "❌ 連線失敗"}
                      </p>
                      {remoteError && <p className="mt-1 text-[10px] text-gray-300">{remoteError}</p>}
                    </div>

                    <div className="rounded-lg bg-black/40 p-2 text-center">
                      <p className="mb-1 text-[10px] text-gray-400">手機可開啟以下網址，或前往 /camera 輸入代碼</p>
                      <p className="select-all break-all text-[10px] text-cyan-300 sm:text-xs">{baseUrl}/camera/{roomCode}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => void shareRemoteLink()} className="rounded-lg bg-white/10 py-2 text-xs font-medium hover:bg-white/15">
                        {linkCopied ? "✅ 已複製" : "📤 分享 / 複製"}
                      </button>
                      {remoteConnected ? (
                        <button onClick={() => switchToCamera(`remote-${roomCode}`)} className="rounded-lg bg-green-600 py-2 text-xs font-bold hover:bg-green-700">切換到手機畫面</button>
                      ) : (
                        <button onClick={retryRemote} className="rounded-lg bg-cyan-600 py-2 text-xs font-medium hover:bg-cyan-700">🔄 重新等待</button>
                      )}
                    </div>

                    <Link href="/camera" target="_blank" rel="noreferrer" className="block rounded-lg bg-white/5 py-1.5 text-center text-[10px] text-gray-400 hover:bg-white/10 hover:text-white">
                      在此裝置預覽手機代碼輸入頁 ↗
                    </Link>
                    <button onClick={cancelRemoteSetup} className="w-full rounded-lg bg-white/5 py-1.5 text-xs text-gray-400 transition hover:bg-white/10">取消連線房間</button>
                  </div>
                )}
              </div>
            </div>

            {/* ---- Session summary ---- */}
            <div className={`bg-white/5 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-white/10 ${mobileTab === "cameras" ? "hidden sm:block" : ""}`}>
              <h3 className="text-xs sm:text-sm font-bold text-gray-300 mb-2">📊 本次訓練</h3>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-white/5 rounded-lg p-2"><div className="text-lg sm:text-xl font-bold text-cyan-400">{totalSessionReps + exerciseState.reps}</div><div className="text-[10px] text-gray-400">總次數</div></div>
                <div className="bg-white/5 rounded-lg p-2"><div className="text-lg sm:text-xl font-bold text-purple-400">{fmt(Math.round((currentTime - sessionStartTime) / 1000))}</div><div className="text-[10px] text-gray-400">總時長</div></div>
              </div>
              {sessionExercises.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sessionExercises.map((ex, i) => {
                    const ei = EXERCISES.find((e) => e.id === ex.type);
                    return <div key={i} className="flex items-center justify-between text-[10px] sm:text-xs bg-white/5 rounded-lg px-2 py-1.5"><span>{ei?.icon} {ei?.nameZh}</span><span className="text-gray-400">{ex.reps}次 · {ex.quality}%</span></div>;
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Challenge modal ---- */}
      {showCompletion && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-yellow-500/30 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl shadow-yellow-500/20">
            <div className="text-5xl sm:text-6xl mb-3">🏆</div>
            <h2 className="text-xl sm:text-2xl font-black text-yellow-400 mb-2">挑戰完成！</h2>
            <p className="text-sm text-gray-300 mb-1">完成 {challengeTarget} 次{info.nameZh}！</p>
            <p className="text-xs text-gray-400 mb-5">平均品質: {exerciseState.quality}%</p>
            <button onClick={() => setShowCompletion(false)} className="px-6 py-2.5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl font-bold hover:from-yellow-600 hover:to-orange-600 transition text-sm">太棒了！</button>
          </div>
        </div>
      )}
    </div>
  );
}
