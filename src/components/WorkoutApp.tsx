"use client";

import { useRef, useEffect, useState, useCallback } from "react";
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
  announcePersonLost,
  announceMultiplePeople,
  setVoiceEnabled,
  isVoiceEnabled,
} from "@/lib/voice-coach";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PoseLandmarkerResult {
  landmarks: Point3D[][];
  worldLandmarks: Point3D[][];
}
type MpPoseLandmarker = {
  detectForVideo(v: HTMLVideoElement, ts: number): PoseLandmarkerResult;
};

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

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */
export default function WorkoutApp() {
  /* refs */
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<MpPoseLandmarker | null>(null);
  const animRef = useRef(0);
  const lastTimeRef = useRef(-1);

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

  // Camera management
  const [cameras, setCameras] = useState<CameraSource[]>([]);
  const [activeCameraId, setActiveCameraId] = useState("local-default");
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [showRemoteSetup, setShowRemoteSetup] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const remotePcRef = useRef<RTCPeerConnection | null>(null);
  const remotePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteLastIdRef = useRef(0);
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

  /* ---- voice announcements triggered by state changes ---- */
  useEffect(() => {
    if (!voiceOn) return;
    if (exerciseState.reps > prevReps.current && exerciseState.reps > 0) {
      announceRep(exerciseState.reps);
    }
    prevReps.current = exerciseState.reps;
  }, [exerciseState.reps, voiceOn]);

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

  /* ---- init camera with HD resolution ---- */
  const initCamera = useCallback(async (facingMode: "user" | "environment" = "user") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameras((prev) => {
        const without = prev.filter((c) => c.id !== "local-default");
        return [
          ...without,
          { id: "local-default", label: "本機鏡頭", type: "local", status: "active", stream, personCount: 0 },
        ];
      });
    } catch {
      setStatus("error");
    }
  }, []);

  /* ---- init pose detector (with multi-pose support) ---- */
  const initPose = useCallback(async () => {
    setStatus("loading");
    try {
      const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fs = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
      let lm: unknown;
      try {
        lm = await PoseLandmarker.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 3,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        lm = await PoseLandmarker.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          },
          runningMode: "VIDEO",
          numPoses: 3,
        });
      }
      landmarkerRef.current = lm as unknown as MpPoseLandmarker;
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  /* ---- detection loop ---- */
  const loop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!video || !canvas || !lm || video.readyState < 2) { animRef.current = requestAnimationFrame(loop); return; }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) { animRef.current = requestAnimationFrame(loop); return; }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (video.currentTime !== lastTimeRef.current) {
      lastTimeRef.current = video.currentTime;
      try {
        const res = lm.detectForVideo(video, performance.now());

        // Draw video (mirrored for local)
        const isLocal = cameras.find((c) => c.id === activeCameraId)?.type !== "remote";
        ctx.save();
        if (isLocal) { ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); }
        else { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
        ctx.restore();

        const poseCount = res.landmarks?.length || 0;

        // Multi-person detection
        if (poseCount > 1) {
          setMultiPerson(true);
          if (!multiPersonTimer.current) {
            multiPersonTimer.current = setTimeout(() => {
              if (voiceOn) announceMultiplePeople();
              multiPersonTimer.current = null;
            }, 3000);
          }
        } else {
          setMultiPerson(false);
          if (multiPersonTimer.current) { clearTimeout(multiPersonTimer.current); multiPersonTimer.current = null; }
        }

        if (poseCount > 0) {
          setPersonDetected(true);
          if (personLostTimer.current) { clearTimeout(personLostTimer.current); personLostTimer.current = null; }

          // Always use first (largest / most confident) person
          const raw = res.landmarks[0] as Point3D[];
          const mirrored = isLocal ? raw.map((p) => ({ ...p, x: 1 - p.x })) : raw;

          if (status !== "detecting" && trackRef.current) setStatus("detecting");

          drawSkeleton(ctx, mirrored, canvas.width, canvas.height, stateRef.current.quality);

          if (trackRef.current) {
            const ns = detectExercise(exRef.current, raw, { ...stateRef.current });
            setExerciseState(ns);
          }

          // HUD: phase + person count
          if (trackRef.current) {
            const hudH = 40;
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(0, 0, 300, hudH);
            ctx.font = `bold ${Math.max(14, Math.round(canvas.width / 55))}px system-ui, sans-serif`;
            ctx.fillStyle = "#00ff88";
            ctx.fillText(`動作: ${stateRef.current.phase}`, 10, hudH * 0.65);

            if (poseCount > 1) {
              ctx.fillStyle = "rgba(255,60,60,0.7)";
              ctx.fillRect(canvas.width - 200, 0, 200, hudH);
              ctx.fillStyle = "#fff";
              ctx.fillText(`⚠ 偵測到 ${poseCount} 人`, canvas.width - 190, hudH * 0.65);
            }
          }

          // Draw multi-person skeletons (dimmed)
          if (poseCount > 1) {
            for (let pi = 1; pi < poseCount; pi++) {
              const otherRaw = res.landmarks[pi] as Point3D[];
              const otherMirrored = isLocal ? otherRaw.map((p) => ({ ...p, x: 1 - p.x })) : otherRaw;
              ctx.globalAlpha = 0.3;
              drawSkeleton(ctx, otherMirrored, canvas.width, canvas.height, 30);
              ctx.globalAlpha = 1;
            }
          }
        } else {
          setPersonDetected(false);
          if (trackRef.current) {
            setStatus("paused");
            if (!personLostTimer.current) {
              personLostTimer.current = setTimeout(() => {
                if (voiceOn) announcePersonLost();
                personLostTimer.current = null;
              }, 2000);
            }
          }
        }
      } catch {
        const isLocal = cameras.find((c) => c.id === activeCameraId)?.type !== "remote";
        ctx.save();
        if (isLocal) { ctx.scale(-1, 1); ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); }
        else { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
        ctx.restore();
      }
    }
    animRef.current = requestAnimationFrame(loop);
  }, [status, cameras, activeCameraId, voiceOn]);

  /* ---- lifecycle ---- */
  useEffect(() => {
    initCamera().then(() => initPose());
    return () => {
      cancelAnimationFrame(animRef.current);
      if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
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
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    const cur = cameras.find((c) => c.id === "local-default");
    const newFacing = cur ? "environment" : "user";
    await initCamera(newFacing as "user" | "environment");
  }, [cameras, initCamera]);

  /* ---- Remote camera WebRTC ---- */
  const generateRoom = useCallback(() => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
    setShowRemoteSetup(true);
    // Clean old signals
    fetch(`/api/signal?roomId=${code}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const connectRemoteCamera = useCallback(() => {
    if (!roomCode) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    });
    remotePcRef.current = pc;

    pc.ontrack = (ev) => {
      if (ev.streams[0]) {
        // Create hidden video for remote stream
        let rv = remoteVideoRef.current;
        if (!rv) {
          rv = document.createElement("video");
          rv.playsInline = true;
          rv.muted = true;
          rv.autoplay = true;
          rv.style.display = "none";
          document.body.appendChild(rv);
          remoteVideoRef.current = rv;
        }
        rv.srcObject = ev.streams[0];
        rv.play().catch(() => {});

        setRemoteConnected(true);
        setCameras((prev) => {
          const without = prev.filter((c) => c.id !== `remote-${roomCode}`);
          return [...without, { id: `remote-${roomCode}`, label: `遠端 ${roomCode}`, type: "remote", status: "active", stream: ev.streams[0], personCount: 0 }];
        });
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: roomCode, sender: "host", msgType: "candidate", data: JSON.stringify(ev.candidate.toJSON()) }),
        }).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setRemoteConnected(true);
        if (voiceOn) speak("遠端攝影機已連線");
      }
    };

    // Poll for offer from camera
    remoteLastIdRef.current = 0;
    remotePollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/signal?roomId=${roomCode}&notFrom=host&afterId=${remoteLastIdRef.current}`);
        const data = await r.json();
        if (!data.messages) return;

        for (const msg of [...data.messages].reverse()) {
          if (msg.id > remoteLastIdRef.current) remoteLastIdRef.current = msg.id;
          const payload = JSON.parse(msg.data);

          if (msg.msgType === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await fetch("/api/signal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomId: roomCode, sender: "host", msgType: "answer", data: JSON.stringify({ sdp: answer.sdp, type: answer.type }) }),
            });
          } else if (msg.msgType === "candidate" && pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(payload)); } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }, 800);
  }, [roomCode, voiceOn]);

  const switchToCamera = useCallback((camId: string) => {
    setActiveCameraId(camId);
    lastTimeRef.current = -1;

    if (camId === "local-default") {
      const local = cameras.find((c) => c.id === "local-default");
      if (local?.stream && videoRef.current) {
        videoRef.current.srcObject = local.stream;
        videoRef.current.play().catch(() => {});
      }
    } else {
      // Switch to remote camera video
      const rv = remoteVideoRef.current;
      if (rv && videoRef.current) {
        videoRef.current.srcObject = rv.srcObject;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [cameras]);

  /* ---- exercise handlers ---- */
  const selectExercise = useCallback((type: ExerciseType) => {
    if (exerciseState.reps > 0) {
      setSessionExercises((p) => [...p, { type: exerciseState.type, reps: exerciseState.reps, duration: exerciseState.duration, quality: exerciseState.quality }]);
      setTotalSessionReps((p) => p + exerciseState.reps);
    }
    resetDetectorState();
    setSelectedExercise(type);
    setExerciseState(createExerciseState(type));
    setShowMenu(false);
    setChallengeCompleted(false);
    prevReps.current = 0;
    prevFeedbackLen.current = 0;
  }, [exerciseState]);

  const toggleTrack = useCallback(() => {
    if (isTracking) {
      setIsTracking(false);
      setStatus("ready");
      if (voiceOn) announceExerciseStop();
    } else {
      resetDetectorState();
      setExerciseState(createExerciseState(selectedExercise));
      setIsTracking(true);
      setStatus("detecting");
      setChallengeCompleted(false);
      prevReps.current = 0;
      prevFeedbackLen.current = 0;
      const info = EXERCISES.find((e) => e.id === selectedExercise);
      if (voiceOn && info) announceExerciseStart(info.nameZh);
    }
  }, [isTracking, selectedExercise, voiceOn]);

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
    if (next) speak("語音播報已開啟");
  }, [voiceOn]);

  /* cleanup remote on unmount */
  useEffect(() => {
    return () => {
      if (remotePollRef.current) clearInterval(remotePollRef.current);
      remotePcRef.current?.close();
      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject) (remoteVideoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        remoteVideoRef.current.remove();
      }
    };
  }, []);

  const info = EXERCISES.find((e) => e.id === selectedExercise)!;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col">
      {/* ---- HEADER ---- */}
      <header className="bg-black/50 backdrop-blur-md border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3 flex-shrink-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <a href="/" className="flex items-center gap-1.5 hover:opacity-80 transition flex-shrink-0">
            <span className="text-xl sm:text-2xl">🏋️‍♂️</span>
            <span className="text-sm sm:text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent hidden xs:inline">AI 運動教練</span>
          </a>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <StatusBadge status={status} />
            <button onClick={toggleVoice} className={`p-1.5 sm:p-2 rounded-lg transition text-xs sm:text-sm ${voiceOn ? "bg-cyan-500/20 text-cyan-300" : "bg-white/10 text-gray-400"}`} title="語音播報">
              {voiceOn ? "🔊" : "🔇"}
            </button>
            <button onClick={() => { setShowCameraPanel(!showCameraPanel); setMobileTab("cameras"); }} className="p-1.5 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm" title="鏡頭管理">
              📹 <span className="hidden sm:inline text-[10px] text-gray-400">{cameras.length}</span>
            </button>
            <button onClick={switchLocalCamera} className="p-1.5 sm:p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm" title="切換鏡頭">📷</button>
            <a href="/history" className="px-2 py-1.5 sm:px-3 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm">📊<span className="hidden sm:inline ml-1">紀錄</span></a>
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
            <div className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-black shadow-2xl shadow-cyan-500/10 border border-white/10">
              <video ref={videoRef} className="hidden" playsInline muted />
              <canvas ref={canvasRef} className="w-full aspect-video bg-gray-900" />

              {/* person-lost overlay */}
              {!personDetected && isTracking && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                  <div className="text-center p-4">
                    <span className="text-4xl sm:text-5xl mb-3 block">👤</span>
                    <p className="text-base sm:text-lg font-semibold text-yellow-400">未偵測到人物</p>
                    <p className="text-xs sm:text-sm text-gray-300 mt-1">請確保全身在鏡頭範圍內</p>
                  </div>
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
              <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 bg-black/50 backdrop-blur rounded-lg px-2 py-1 text-[10px] sm:text-xs text-gray-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {cameras.find((c) => c.id === activeCameraId)?.label || "本機鏡頭"}
                {cameras.length > 1 && <span className="text-gray-500">({cameras.length}台)</span>}
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
              <button onClick={() => { resetDetectorState(); setExerciseState(createExerciseState(selectedExercise)); setChallengeCompleted(false); prevReps.current = 0; prevFeedbackLen.current = 0; }}
                className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition text-xs sm:text-sm">🔄</button>
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
                  <button onClick={generateRoom} className="w-full py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition font-medium text-xs">
                    📱 產生連線代碼
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-black/40 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-gray-400 mb-1">房間代碼</p>
                      <p className="text-2xl sm:text-3xl font-black text-cyan-400 tracking-widest">{roomCode}</p>
                    </div>
                    <div className="bg-black/40 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-gray-400 mb-1">或在手機瀏覽器開啟：</p>
                      <p className="text-[10px] sm:text-xs text-cyan-300 break-all select-all">{baseUrl}/camera/{roomCode}</p>
                    </div>
                    {!remoteConnected ? (
                      <button onClick={connectRemoteCamera} className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 transition font-medium text-xs">
                        🔗 開始等待連線
                      </button>
                    ) : (
                      <div className="text-center py-1">
                        <span className="text-xs text-green-400 font-bold">✅ 遠端攝影機已連線！</span>
                      </div>
                    )}
                    <button onClick={() => { setShowRemoteSetup(false); setRoomCode(""); }} className="w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition text-xs text-gray-400">
                      取消
                    </button>
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
