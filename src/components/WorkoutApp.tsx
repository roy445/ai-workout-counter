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
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Point3D[],
  w: number,
  h: number,
  quality: number
) {
  const hue = quality > 75 ? 145 : quality > 50 ? 45 : 0;
  const jointColor = `hsl(${hue}, 90%, 55%)`;
  const lineColor = `hsla(${hue}, 80%, 60%, 0.8)`;
  const glowColor = `hsla(${hue}, 100%, 60%, 0.35)`;

  ctx.lineWidth = Math.max(2, Math.round(w / 250));
  ctx.strokeStyle = lineColor;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;

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

  ctx.shadowBlur = 14;
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if ((lm.visibility ?? 0) < 0.35) continue;
    const r = keyJoints.has(i) ? Math.max(5, Math.round(w / 160)) : Math.max(2.5, Math.round(w / 300));
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, r, 0, 2 * Math.PI);
    ctx.fillStyle = jointColor;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
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
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const [sessionStartTime] = useState(Date.now());
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
  const remotePcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStoppedRef = useRef(false);
  const remoteLastIdRef = useRef(0);
  const remotePendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  /* mutable refs for closures */
  const stateRef = useRef(exerciseState);
  stateRef.current = exerciseState;
  const exRef = useRef(selectedExercise);
  exRef.current = selectedExercise;
  const trackRef = useRef(isTracking);
  trackRef.current = isTracking;
  const prevReps = useRef(0);
  const prevFeedbackLen = useRef(0);
  const personLostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multiPersonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;
  const activeCameraRef = useRef(activeCameraId);
  activeCameraRef.current = activeCameraId;
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const cameraQualityRef = useRef<CameraQuality>(cameraQuality);
  cameraQualityRef.current = cameraQuality;
  const statusRef = useRef(status);
  statusRef.current = status;

  /* ---- voice announcements triggered by state changes ---- */
  useEffect(() => {
    if (!voiceOn) return;
    if (exerciseState.reps > prevReps.current && exerciseState.reps > 0) {
      const shouldSpeak = selectedExercise !== "plank" || exerciseState.reps % 5 === 0;
      if (shouldSpeak) announceRep(exerciseState.reps, exerciseState.quality);
      if (challengeMode) announceChallengeProgress(exerciseState.reps, challengeTarget);
    }
    prevReps.current = exerciseState.reps;
  }, [exerciseState.reps, exerciseState.quality, voiceOn, selectedExercise, challengeMode, challengeTarget]);

  useEffect(() => {
    if (!voiceOn) return;
    if (exerciseState.feedback.length > prevFeedbackLen.current) {
      const latest = exerciseState.feedback[exerciseState.feedback.length - 1];
      if (latest && latest.type === "warning") {
        announceFormCorrection(latest.message);
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
        }
      }
      setLocalFacing(facingMode);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
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

  /* ---- display at source quality; infer at ~20 FPS on max 640px ---- */
  const loop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      animRef.current = requestAnimationFrame(loop);
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      animRef.current = requestAnimationFrame(loop);
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
      const isLocal = camerasRef.current.find((camera) => camera.id === activeCameraRef.current)?.type !== "remote";

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.save();
      if (isLocal) {
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();

      const now = performance.now();
      if (now - lastInferenceAtRef.current >= 50) {
        lastInferenceAtRef.current = now;
        const analysis = analysisCanvasRef.current || document.createElement("canvas");
        analysisCanvasRef.current = analysis;
        const aspect = sourceWidth / sourceHeight;
        analysis.width = aspect >= 1 ? 640 : Math.max(320, Math.round(640 * aspect));
        analysis.height = aspect >= 1 ? Math.max(320, Math.round(640 / aspect)) : 640;
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

    animRef.current = requestAnimationFrame(loop);
  }, []);

  /* ---- lifecycle ---- */
  useEffect(() => {
    void initCamera().then(() => initPose());
    return () => {
      cancelAnimationFrame(animRef.current);
      camerasRef.current.forEach((camera) => camera.stream?.getTracks().forEach((track) => track.stop()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "ready" || status === "detecting" || status === "paused") {
      animRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [status, loop]);

  /* ---- switch local camera ---- */
  const switchLocalCamera = useCallback(async () => {
    const currentLocal = camerasRef.current.find((camera) => camera.id === "local-default");
    currentLocal?.stream?.getTracks().forEach((track) => track.stop());
    const nextFacing = localFacing === "user" ? "environment" : "user";
    const stream = await initCamera(nextFacing);
    if (stream) {
      setActiveCameraId("local-default");
      lastTimeRef.current = -1;
    }
  }, [initCamera, localFacing]);

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

      let remoteVideo = remoteVideoRef.current;
      if (!remoteVideo) {
        remoteVideo = document.createElement("video");
        remoteVideo.playsInline = true;
        remoteVideo.muted = true;
        remoteVideo.autoplay = true;
        remoteVideo.style.display = "none";
        document.body.appendChild(remoteVideo);
        remoteVideoRef.current = remoteVideo;
      }
      remoteVideo.srcObject = stream;
      void remoteVideo.play();

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
                try {
                  await pc.addIceCandidate(candidate);
                } catch {
                  // Ignore candidates from an older negotiation.
                }
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
  }, []);

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

  const switchToCamera = useCallback((cameraId: string) => {
    const camera = camerasRef.current.find((item) => item.id === cameraId);
    if (!camera?.stream || !videoRef.current) return;

    setActiveCameraId(cameraId);
    activeCameraRef.current = cameraId;
    videoRef.current.srcObject = camera.stream;
    void videoRef.current.play();
    lastTimeRef.current = -1;
    lastInferenceAtRef.current = 0;
    lastResultRef.current = null;
    lastDimensionsRef.current = { width: 0, height: 0 };
    primaryCenterRef.current = null;
    setPersonDetected(false);
  }, []);

  /* ---- exercise handlers ---- */
  const selectExercise = useCallback((type: ExerciseType) => {
    if (exerciseState.reps > 0) {
      setSessionExercises((p) => [...p, { type: exerciseState.type, reps: exerciseState.reps, duration: exerciseState.duration, quality: exerciseState.quality }]);
      setTotalSessionReps((p) => p + exerciseState.reps);
    }
    resetDetectorState();
    const freshState = createExerciseState(type);
    stateRef.current = freshState;
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
    stateRef.current = freshState;
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
      stateRef.current = freshState;
      setExerciseState(freshState);
      setIsTracking(true);
      setStatus(personDetected && poseCoverage >= 50 ? "detecting" : "paused");
      setChallengeCompleted(false);
      prevReps.current = 0;
      prevFeedbackLen.current = 0;
      const exercise = EXERCISES.find((item) => item.id === selectedExercise);
      if (voiceOn && exercise) {
        window.setTimeout(() => announceExerciseStart(exercise.nameZh), 250);
      }
    }
  }, [isTracking, selectedExercise, voiceOn, exerciseState.reps, personDetected, poseCoverage]);

  useEffect(() => {
    if (challengeMode && !challengeCompleted && exerciseState.reps >= challengeTarget) {
      setChallengeCompleted(true);
      setShowCompletion(true);
      const info = EXERCISES.find((e) => e.id === selectedExercise);
      if (voiceOn && info) announceChallenge(challengeTarget, info.nameZh);
    }
  }, [exerciseState.reps, challengeMode, challengeTarget, challengeCompleted, voiceOn, selectedExercise]);

  const saveSession = useCallback(async () => {
    const all = [...sessionExercises];
    if (exerciseState.reps > 0) all.push({ type: exerciseState.type, reps: exerciseState.reps, duration: exerciseState.duration, quality: exerciseState.quality });
    if (!all.length) return;
    const tr = all.reduce((s, e) => s + e.reps, 0);
    const td = Math.round((Date.now() - sessionStartTime) / 1000);
    const aq = all.reduce((s, e) => s + e.quality, 0) / all.length;
    try {
      await fetch("/api/workouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ totalDuration: td, totalReps: tr, avgQuality: Math.round(aq), exercises: all }) });
      if (voiceOn) speak("運動紀錄已儲存");
    } catch { /* skip */ }
  }, [sessionExercises, exerciseState, sessionStartTime, voiceOn]);

  const toggleVoice = useCallback(() => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    if (next) unlockVoice();
  }, [voiceOn]);

  /* cleanup remote on unmount */
  useEffect(() => {
    return () => {
      remoteStoppedRef.current = true;
      remotePcRef.current?.close();
      if (remoteVideoRef.current) {
        remoteVideoRef.current.remove();
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
                ref={videoRef}
                style={{
                  position: "absolute",
                  opacity: 0,
                  width: "4px",
                  height: "4px",
                  pointerEvents: "none",
                }}
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-gray-900" />

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
                <div className="bg-white/5 rounded-lg p-2"><div className="text-lg sm:text-xl font-bold text-purple-400">{fmt(Math.round((Date.now() - sessionStartTime) / 1000))}</div><div className="text-[10px] text-gray-400">總時長</div></div>
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
