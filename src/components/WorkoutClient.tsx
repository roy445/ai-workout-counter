"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EXERCISE_LIST,
  EXERCISES,
  type ExerciseKey,
  createCounter,
  estimateCalories,
  isPersonPresent,
  LandmarkSmoother,
  AutoClassifier,
  POSE_CONNECTIONS,
  type Landmark,
  type RepCounter,
} from "@/lib/exercises";
import { getSpeech } from "@/lib/speech";
import { getSound } from "@/lib/sound";
import ProgressRing from "@/components/ProgressRing";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";

type Status = "idle" | "loading" | "ready" | "running" | "error";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export default function WorkoutClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 迴圈與偵測 ref
  const landmarkerRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const smootherRef = useRef<LandmarkSmoother>(new LandmarkSmoother(0.45));
  const classifierRef = useRef<AutoClassifier>(new AutoClassifier());
  const autoRef = useRef<boolean>(false);
  const modeRef = useRef<"target" | "free">("target");
  const activeKeyRef = useRef<ExerciseKey>("squat");
  const detectingRef = useRef<boolean>(false);
  const detectStartRef = useRef<number>(0);
  const portraitRef = useRef<boolean>(true);
  const facingRef = useRef<"user" | "environment">("user");
  const lastVideoTimeRef = useRef<number>(-1);
  const lastFrameTsRef = useRef<number>(0);
  const activeMsRef = useRef<number>(0);
  const repsRef = useRef<number>(0);
  const runningRef = useRef<boolean>(false);
  const presentRef = useRef<boolean>(false);
  const repTimesRef = useRef<number[]>([]);
  const lastFeedbackSpokenRef = useRef<string>("");
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setNumberRef = useRef<number>(1);
  const targetRepsRef = useRef<number>(0);
  const targetSetsRef = useRef<number>(0);

  const [selected, setSelected] = useState<ExerciseKey>("squat");
  const [autoDetect, setAutoDetect] = useState(false);
  const [mode, setMode] = useState<"target" | "free">("target");
  const [activeKey, setActiveKey] = useState<ExerciseKey>("squat");
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [reps, setReps] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [calories, setCalories] = useState(0);
  const [phase, setPhase] = useState("準備中");
  const [progress, setProgress] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [rpm, setRpm] = useState(0);
  const [cadence, setCadence] = useState(0);
  const [present, setPresent] = useState(false);
  const [weight, setWeight] = useState(65);
  const [voiceOn, setVoiceOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(40);
  const [portrait, setPortrait] = useState(true); // true=直式(全身)，false=橫式
  const [facing, setFacing] = useState<"user" | "environment">("user"); // 前/後鏡頭
  const [saveMsg, setSaveMsg] = useState("");
  const [popKey, setPopKey] = useState(0);
  const [personalBest, setPersonalBest] = useState(0);
  const halfwaySpokenRef = useRef(false);
  const finalSpokenRef = useRef(false);
  const metronomeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const personalBestRef = useRef(0);
  const pbMapRef = useRef<Record<string, number>>({});

  // 訓練設定
  const [targetReps, setTargetReps] = useState(15);
  const [targetSets, setTargetSets] = useState(3);
  const [restSec, setRestSec] = useState(30);
  const [setNumber, setSetNumber] = useState(1);
  const [resting, setResting] = useState(false);
  const [restLeft, setRestLeft] = useState(0);

  const selectedRef = useRef(selected);
  const weightRef = useRef(weight);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    autoRef.current = autoDetect;
  }, [autoDetect]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  // 手動模式時，作用中的運動＝所選運動
  useEffect(() => {
    if (!autoDetect) setActiveKey(selected);
  }, [autoDetect, selected]);
  useEffect(() => {
    weightRef.current = weight;
  }, [weight]);
  useEffect(() => {
    targetRepsRef.current = targetReps;
  }, [targetReps]);
  useEffect(() => {
    targetSetsRef.current = targetSets;
  }, [targetSets]);

  useEffect(() => {
    getSpeech().setEnabled(voiceOn);
  }, [voiceOn]);
  useEffect(() => {
    getSound().setEnabled(soundOn);
  }, [soundOn]);

  useEffect(() => {
    const w = Number(localStorage.getItem("workout_weight"));
    if (w && w > 0) setWeight(w);
    const v = localStorage.getItem("workout_voice");
    if (v !== null) setVoiceOn(v === "1");
    const sd = localStorage.getItem("workout_sound");
    if (sd !== null) setSoundOn(sd === "1");
    const mo = localStorage.getItem("workout_metronome");
    if (mo !== null) setMetronomeOn(mo === "1");
    const bpm = Number(localStorage.getItem("workout_bpm"));
    if (bpm > 0) setMetronomeBpm(bpm);
    const tr = Number(localStorage.getItem("workout_target_reps"));
    if (tr > 0) setTargetReps(tr);
    const ts = Number(localStorage.getItem("workout_target_sets"));
    if (ts > 0) setTargetSets(ts);
    const rs = Number(localStorage.getItem("workout_rest"));
    if (rs > 0) setRestSec(rs);
    const ad = localStorage.getItem("workout_auto");
    if (ad !== null) setAutoDetect(ad === "1");
    const md = localStorage.getItem("workout_mode");
    if (md === "free" || md === "target") setMode(md);
    const po = localStorage.getItem("workout_portrait");
    if (po !== null) setPortrait(po === "1");
  }, []);
  useEffect(() => {
    portraitRef.current = portrait;
    localStorage.setItem("workout_portrait", portrait ? "1" : "0");
  }, [portrait]);
  useEffect(() => {
    facingRef.current = facing;
  }, [facing]);
  useEffect(() => {
    localStorage.setItem("workout_auto", autoDetect ? "1" : "0");
  }, [autoDetect]);
  useEffect(() => {
    localStorage.setItem("workout_mode", mode);
  }, [mode]);
  useEffect(() => {
    localStorage.setItem("workout_weight", String(weight));
  }, [weight]);
  useEffect(() => {
    localStorage.setItem("workout_voice", voiceOn ? "1" : "0");
  }, [voiceOn]);
  useEffect(() => {
    localStorage.setItem("workout_sound", soundOn ? "1" : "0");
  }, [soundOn]);
  useEffect(() => {
    localStorage.setItem("workout_metronome", metronomeOn ? "1" : "0");
  }, [metronomeOn]);
  useEffect(() => {
    localStorage.setItem("workout_bpm", String(metronomeBpm));
  }, [metronomeBpm]);

  // 抓取此運動的個人最佳紀錄（用於破紀錄提示）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.ok) return;
        // 建立各運動的個人最佳表
        const map: Record<string, number> = {};
        for (const s of data.sessions as {
          exercise: string;
          reps: number;
          durationSeconds: number;
        }[]) {
          const dd = EXERCISES[s.exercise as ExerciseKey];
          if (!dd) continue;
          const m = dd.timeBased ? s.durationSeconds : s.reps;
          map[s.exercise] = Math.max(map[s.exercise] ?? 0, m);
        }
        pbMapRef.current = map;
        const key = autoRef.current ? activeKeyRef.current : selectedRef.current;
        personalBestRef.current = map[key] ?? 0;
        setPersonalBest(personalBestRef.current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, activeKey]);
  useEffect(() => {
    localStorage.setItem("workout_target_reps", String(targetReps));
  }, [targetReps]);
  useEffect(() => {
    localStorage.setItem("workout_target_sets", String(targetSets));
  }, [targetSets]);
  useEffect(() => {
    localStorage.setItem("workout_rest", String(restSec));
  }, [restSec]);

  // 顯示用：自動偵測模式顯示目前判定的運動，否則顯示所選運動
  const def = EXERCISES[autoDetect ? activeKey : selected];

  // ---------- 繪製骨架 ----------
  const drawSkeleton = useCallback((lms: Landmark[] | null, ok: boolean) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!lms) return;

    // 前鏡頭畫面左右鏡像，骨架也要跟著鏡像；後鏡頭則維持原方向
    const mirror = facingRef.current === "user";
    const px = (x: number) => (mirror ? 1 - x : x) * w;
    const py = (y: number) => y * h;
    const lineColor = ok ? "#22d3ee" : "#f59e0b";

    ctx.save();
    ctx.shadowColor = ok ? "rgba(34,211,238,0.7)" : "rgba(245,158,11,0.5)";
    ctx.shadowBlur = Math.max(8, w / 110);
    ctx.lineWidth = Math.max(3, w / 200);
    ctx.strokeStyle = lineColor;
    ctx.lineCap = "round";
    for (const [a, b] of POSE_CONNECTIONS) {
      const p1 = lms[a];
      const p2 = lms[b];
      if (!p1 || !p2) continue;
      if ((p1.visibility ?? 1) < 0.3 || (p2.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(px(p1.x), py(p1.y));
      ctx.lineTo(px(p2.x), py(p2.y));
      ctx.stroke();
    }
    ctx.restore();

    const r = Math.max(4, w / 160);
    for (const p of lms) {
      if ((p.visibility ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = ok ? "#0891b2" : "#d97706";
      ctx.fill();
    }
  }, []);

  // ---------- 組間休息 ----------
  const startRest = useCallback(() => {
    const rest = restSec;
    if (rest <= 0) {
      // 無休息，直接下一組
      beginNextSet();
      return;
    }
    setResting(true);
    setRestLeft(rest);
    getSpeech().speak(`第 ${setNumberRef.current} 組完成，休息 ${rest} 秒`, {
      priority: true,
    });
    let left = rest;
    restTimerRef.current = setInterval(() => {
      left -= 1;
      setRestLeft(left);
      if (left === 3 || left === 2 || left === 1) {
        getSpeech().speak(String(left));
        getSound().tick();
      }
      if (left <= 0) {
        if (restTimerRef.current) clearInterval(restTimerRef.current);
        setResting(false);
        beginNextSet();
      }
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restSec]);

  const beginNextSet = useCallback(() => {
    setNumberRef.current += 1;
    setSetNumber(setNumberRef.current);
    counterRef.current = createCounter(activeKeyRef.current);
    counterRef.current.reset();
    repsRef.current = 0;
    setReps(0);
    setProgress(0);
    halfwaySpokenRef.current = false;
    finalSpokenRef.current = false;
    getSound().go();
    getSpeech().speak(`第 ${setNumberRef.current} 組開始`, { priority: true });
    lastFrameTsRef.current = performance.now();
    runningRef.current = true;
  }, []);

  // 完成整個訓練並儲存
  const finishWorkout = useCallback(async (autoDone: boolean) => {
    runningRef.current = false;
    detectingRef.current = false;
    setDetecting(false);
    if (restTimerRef.current) clearInterval(restTimerRef.current);
    setResting(false);
    setStatus("ready");
    setProgress(0);
    const secs = Math.floor(activeMsRef.current / 1000);
    // 總次數 = 已完成組數 * 目標 + 當前組次數（近似）；改為累計實際
    const r = totalRepsRef.current + repsRef.current;
    const key = activeKeyRef.current;
    const d = EXERCISES[key];
    const cals = estimateCalories(d.met, weightRef.current, secs);

    if (r === 0 && secs < 3) {
      setSaveMsg("這次運動資料太少，未儲存。");
      getSpeech().speak("資料太少，未儲存", { priority: true });
      return;
    }

    getSound().victory();
    const summary = d.timeBased
      ? `訓練完成，${d.name}支撐 ${secs} 秒，消耗 ${cals.toFixed(0)} 大卡`
      : `訓練完成！總共 ${r} 下，消耗 ${cals.toFixed(0)} 大卡，太棒了`;
    getSpeech().speak(autoDone ? `全部完成！${summary}` : summary, {
      priority: true,
    });

    try {
      const resp = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise: key,
          reps: r,
          durationSeconds: secs,
          calories: cals,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        setSaveMsg(
          `已儲存 ✅ ${d.name} ${r} 次 / ${secs} 秒 / ${cals.toFixed(1)} kcal`,
        );
      } else {
        setSaveMsg(data.error || "儲存失敗");
      }
    } catch {
      setSaveMsg("儲存失敗，請稍後再試。");
    }
    totalRepsRef.current = 0;
  }, []);

  const totalRepsRef = useRef(0);

  // 當一組達標
  const onSetComplete = useCallback(() => {
    runningRef.current = false;
    totalRepsRef.current += repsRef.current;
    setPopKey((k) => k + 1);
    getSound().setDone();
    if (setNumberRef.current >= targetSetsRef.current) {
      finishWorkout(true);
    } else {
      startRest();
    }
  }, [finishWorkout, startRest]);

  // ---------- 主迴圈 ----------
  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current as {
      detectForVideo: (
        v: HTMLVideoElement,
        ts: number,
      ) => { landmarks?: Landmark[][] };
    } | null;
    if (!video || !landmarker) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    const now = performance.now();
    if (video.currentTime !== lastVideoTimeRef.current && video.videoWidth > 0) {
      lastVideoTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      let lms =
        result.landmarks && result.landmarks.length > 0
          ? result.landmarks[0]
          : null;

      const wasPresent = isPersonPresent(lms);
      if (wasPresent && lms) {
        lms = smootherRef.current.apply(lms);
      } else {
        smootherRef.current.reset();
      }
      drawSkeleton(lms, wasPresent);

      if (wasPresent && lms) {
        if (!presentRef.current && runningRef.current) {
          getSpeech().speak("繼續", { priority: true });
        }
        presentRef.current = true;

        // 自動偵測階段：判斷正在做哪種運動並鎖定
        if (detectingRef.current) {
          classifierRef.current.push(lms);
          const guess = classifierRef.current.classify();
          const elapsed = now - detectStartRef.current;
          const chosen = guess ?? (elapsed > 7000 ? classifierRef.current.fallback() : null);
          if (chosen) {
            detectingRef.current = false;
            setDetecting(false);
            activeKeyRef.current = chosen;
            setActiveKey(chosen);
            counterRef.current = createCounter(chosen);
            counterRef.current.reset();
            repsRef.current = 0;
            setReps(0);
            halfwaySpokenRef.current = false;
            finalSpokenRef.current = false;
            personalBestRef.current = pbMapRef.current[chosen] ?? 0;
            setPersonalBest(personalBestRef.current);
            lastFrameTsRef.current = now;
            getSound().go();
            getSpeech().speak(`偵測到${EXERCISES[chosen].name}，開始計數`, {
              priority: true,
            });
          }
        }

        if (runningRef.current && !detectingRef.current) {
          const dt = lastFrameTsRef.current ? now - lastFrameTsRef.current : 0;
          if (dt > 0 && dt < 500) activeMsRef.current += dt;

          const res = counterRef.current?.update(lms);
          if (res) {
            if (res.repInc > 0) {
              repsRef.current += res.repInc;
              setPopKey((k) => k + 1);
              getSound().rep();
              const actDef = EXERCISES[activeKeyRef.current];
              const timeBased = actDef.timeBased;
              // 步頻型（超慢跑/踏步）步速快，改為每 10 步報一次；其餘逐次報數
              if (!timeBased) {
                if (actDef.unit === "步") {
                  if (repsRef.current % 10 === 0) getSpeech().count(repsRef.current);
                } else {
                  getSpeech().count(repsRef.current);
                }
              }
              const t = repTimesRef.current;
              t.push(now);
              while (t.length > 6) t.shift();

              const tr = modeRef.current === "target" ? targetRepsRef.current : 0;
              // 破個人紀錄提示
              if (
                !timeBased &&
                personalBestRef.current > 0 &&
                repsRef.current === personalBestRef.current + 1
              ) {
                getSound().record();
                getSpeech().speak("破紀錄了！", { priority: true });
              }
              if (!timeBased && tr > 0) {
                // 過半鼓勵
                if (
                  !halfwaySpokenRef.current &&
                  repsRef.current >= Math.ceil(tr / 2) &&
                  repsRef.current < tr
                ) {
                  halfwaySpokenRef.current = true;
                  getSpeech().speak("加油，已經過半");
                }
                // 最後衝刺
                if (
                  !finalSpokenRef.current &&
                  tr - repsRef.current === 3 &&
                  tr > 5
                ) {
                  finalSpokenRef.current = true;
                  getSpeech().speak("最後三下，衝刺");
                }
              }
              // 達到目標次數 -> 完成一組
              if (!timeBased && tr > 0 && repsRef.current >= tr) {
                onSetComplete();
              }
            }
            setPhase(res.phase);
            setProgress(res.progress ?? 0);
            setFeedback(res.feedback ?? "");
            if (res.cadence !== undefined) setCadence(res.cadence);
            if (res.feedback && res.feedback !== lastFeedbackSpokenRef.current) {
              lastFeedbackSpokenRef.current = res.feedback;
              getSpeech().speak(res.feedback);
            } else if (!res.feedback) {
              lastFeedbackSpokenRef.current = "";
            }
          }
        }
      } else {
        if (presentRef.current && runningRef.current) {
          getSpeech().speak("偵測不到你，已暫停", { priority: true });
        }
        presentRef.current = false;
        setProgress(0);
      }
      setPresent(presentRef.current);
      lastFrameTsRef.current = now;
    }

    const secs = Math.floor(activeMsRef.current / 1000);
    setSeconds(secs);
    setReps(repsRef.current);
    setCalories(
      estimateCalories(
        EXERCISES[activeKeyRef.current].met,
        weightRef.current,
        secs,
      ),
    );
    const times = repTimesRef.current;
    if (times.length >= 2) {
      const span = (times[times.length - 1] - times[0]) / 1000;
      const cnt = times.length - 1;
      setRpm(span > 0 ? Math.round((cnt / span) * 60) : 0);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [drawSkeleton, onSetComplete]);

  // ---------- 初始化 ----------
  const init = useCallback(async () => {
    try {
      setStatus("loading");
      setErrorMsg("");
      getSpeech().unlock();
      getSound().unlock();
      getSpeech().speak("正在啟動鏡頭與 AI 模型");

      // 先關掉舊的串流（切換鏡頭時）
      const oldVideo = videoRef.current;
      if (oldVideo && oldVideo.srcObject) {
        (oldVideo.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
      // 直式時要求較高的畫面（手機可拍到全身），橫式則用一般 16:9
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingRef.current },
          width: { ideal: portraitRef.current ? 720 : 1280 },
          height: { ideal: portraitRef.current ? 1280 : 720 },
        },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      landmarkerRef.current = landmarker;

      setStatus("ready");
      getSpeech().speak("準備完成，請站到鏡頭前");
      lastFrameTsRef.current = 0;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      setStatus("error");
      setErrorMsg(
        "無法啟動鏡頭或載入模型，請確認已允許鏡頭權限並保持網路連線。",
      );
    }
  }, [loop]);

  // 切換前/後鏡頭（只換攝影機串流，不重載模型）
  const swapCamera = useCallback(async () => {
    const next = facingRef.current === "user" ? "environment" : "user";
    facingRef.current = next;
    setFacing(next);
    // 若鏡頭尚未開啟，只更新設定即可
    const video = videoRef.current;
    if (!video || !video.srcObject) return;
    try {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: next },
          width: { ideal: portraitRef.current ? 720 : 1280 },
          height: { ideal: portraitRef.current ? 1280 : 720 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      smootherRef.current.reset();
      getSpeech().speak(next === "user" ? "已切換前鏡頭" : "已切換後鏡頭");
    } catch (e) {
      console.error(e);
      setErrorMsg("切換鏡頭失敗，此裝置可能沒有另一顆鏡頭。");
    }
  }, []);

  // 開始運動（3 秒語音倒數）
  const start = useCallback(() => {
    const auto = autoRef.current;
    smootherRef.current.reset();
    classifierRef.current.reset();
    repsRef.current = 0;
    totalRepsRef.current = 0;
    activeMsRef.current = 0;
    repTimesRef.current = [];
    setNumberRef.current = 1;
    lastFrameTsRef.current = performance.now();
    halfwaySpokenRef.current = false;
    finalSpokenRef.current = false;
    setReps(0);
    setSeconds(0);
    setCalories(0);
    setRpm(0);
    setCadence(0);
    setSetNumber(1);
    setSaveMsg("");
    setStatus("running");

    if (auto) {
      // 自動偵測：先不建立計數器，等辨識鎖定動作
      counterRef.current = null;
      detectingRef.current = false; // 倒數結束才開始偵測
      setDetecting(false);
    } else {
      activeKeyRef.current = selectedRef.current;
      setActiveKey(selectedRef.current);
      counterRef.current = createCounter(selectedRef.current);
      counterRef.current.reset();
      personalBestRef.current = pbMapRef.current[selectedRef.current] ?? 0;
      setPersonalBest(personalBestRef.current);
    }

    getSpeech().speak(
      auto ? "自動偵測模式，請開始做動作" : EXERCISES[selectedRef.current].cue,
      { priority: true },
    );
    let n = 3;
    getSpeech().speak(`預備，${n}`);
    const timer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        getSpeech().speak(String(n));
      } else {
        clearInterval(timer);
        lastFrameTsRef.current = performance.now();
        runningRef.current = true;
        if (auto) {
          detectingRef.current = true;
          detectStartRef.current = performance.now();
          classifierRef.current.reset();
          setDetecting(true);
          getSpeech().speak("開始偵測，請持續動作", { priority: true });
        } else {
          getSpeech().speak("開始！", { priority: true });
        }
      }
    }, 900);
  }, []);

  const stop = useCallback(() => {
    finishWorkout(false);
  }, [finishWorkout]);

  // 節拍器：運動中依 BPM 播放 tick 帶節奏
  useEffect(() => {
    if (metronomeRef.current) {
      clearInterval(metronomeRef.current);
      metronomeRef.current = null;
    }
    if (metronomeOn && status === "running" && !resting) {
      const interval = Math.max(400, 60000 / metronomeBpm);
      metronomeRef.current = setInterval(() => {
        if (runningRef.current && presentRef.current) getSound().tick();
      }, interval);
    }
    return () => {
      if (metronomeRef.current) clearInterval(metronomeRef.current);
    };
  }, [metronomeOn, metronomeBpm, status, resting]);

  const changeExercise = useCallback((key: ExerciseKey) => {
    setSelected(key);
    if (!runningRef.current) {
      repsRef.current = 0;
      activeMsRef.current = 0;
      repTimesRef.current = [];
      setReps(0);
      setSeconds(0);
      setCalories(0);
      setRpm(0);
      setProgress(0);
      setPhase("準備中");
      getSpeech().speak(`已選擇 ${EXERCISES[key].name}`);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (restTimerRef.current) clearInterval(restTimerRef.current);
      getSpeech().cancel();
      const v = videoRef.current;
      if (v && v.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const running = status === "running";
  const counting = running && runningRef.current;
  const paused = counting && !present;
  const ringFraction =
    mode === "target" && !def.timeBased && targetReps > 0
      ? reps / targetReps
      : undefined;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* 頂部 */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-xl shadow-lg shadow-cyan-500/20">
            🏃
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              AI 運動計數
            </h1>
            <p className="text-xs text-slate-400">
              MediaPipe Pose · 自動計數 · 語音教練
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setVoiceOn((v) => !v)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              voiceOn
                ? "bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/20"
                : "glass text-slate-300"
            }`}
            title="語音教練開關"
          >
            {voiceOn ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => setSoundOn((v) => !v)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              soundOn
                ? "bg-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/20"
                : "glass text-slate-300"
            }`}
            title="音效開關"
          >
            {soundOn ? "🎵" : "🔕"}
          </button>
          <button
            onClick={() => setPortrait((v) => !v)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              portrait
                ? "bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/20"
                : "glass text-slate-300"
            }`}
            title={portrait ? "直式（照全身）" : "橫式"}
          >
            {portrait ? "📱 直式" : "🖥️ 橫式"}
          </button>
          <button
            onClick={swapCamera}
            className="rounded-xl glass px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            title="切換前 / 後鏡頭（後鏡頭視野較廣）"
          >
            🔄 {facing === "user" ? "前鏡頭" : "後鏡頭"}
          </button>
          <ThemeToggle />
          <Link
            href="/history"
            className="rounded-xl glass px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            📊 數據
          </Link>
        </div>
      </header>

      {/* 模式列：自動偵測 + 訓練模式 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAutoDetect((v) => !v)}
          disabled={running}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
            autoDetect
              ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25"
              : "glass text-slate-300 hover:bg-white/10"
          } ${running ? "cursor-not-allowed opacity-50" : ""}`}
          title="讓 AI 自動判斷你正在做哪種運動"
        >
          🤖 自動偵測 {autoDetect ? "開" : "關"}
        </button>

        <div className="flex overflow-hidden rounded-xl glass p-1">
          <button
            onClick={() => setMode("target")}
            disabled={running}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              mode === "target"
                ? "bg-cyan-500 text-slate-900"
                : "text-slate-300"
            } ${running ? "cursor-not-allowed opacity-50" : ""}`}
          >
            🎯 目標次數
          </button>
          <button
            onClick={() => setMode("free")}
            disabled={running}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              mode === "free" ? "bg-cyan-500 text-slate-900" : "text-slate-300"
            } ${running ? "cursor-not-allowed opacity-50" : ""}`}
          >
            ♾️ 自由模式
          </button>
        </div>
      </div>

      {/* 運動選擇（自動偵測時停用） */}
      <div
        className={`no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1 transition ${
          autoDetect ? "pointer-events-none opacity-40" : ""
        }`}
      >
        {EXERCISE_LIST.map((ex) => (
          <button
            key={ex.key}
            onClick={() => changeExercise(ex.key)}
            disabled={running || autoDetect}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              selected === ex.key && !autoDetect
                ? "bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/20"
                : "glass text-slate-300 hover:bg-white/10"
            } ${running || autoDetect ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {ex.emoji} {ex.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* 影像區 */}
        <div
          className={`relative mx-auto w-full overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10 ${
            portrait ? "max-w-[460px]" : ""
          }`}
        >
          <div
            className={`relative w-full ${
              portrait ? "aspect-[9/16]" : "aspect-video"
            }`}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-contain ${
                facing === "user" ? "-scale-x-100" : ""
              }`}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full object-contain"
            />

            {/* 狀態標籤 */}
            {status !== "idle" && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    paused
                      ? "bg-amber-400"
                      : counting
                        ? "animate-pulse bg-emerald-400"
                        : present
                          ? "bg-cyan-400"
                          : "bg-slate-400"
                  }`}
                />
                {status === "loading"
                  ? "模型載入中…"
                  : detecting
                    ? "🤖 AI 偵測動作中…"
                    : resting
                      ? "組間休息中"
                      : paused
                        ? "已暫停：請回到鏡頭前"
                        : counting
                          ? `辨識中 · ${phase}`
                          : running
                            ? "預備倒數中…"
                            : present
                              ? "已就緒，可開始"
                              : "請站到鏡頭前"}
              </div>
            )}

            {/* 組數 / 模式徽章 */}
            {running && (
              <div className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-cyan-300 backdrop-blur">
                {mode === "target"
                  ? `第 ${setNumber} / ${targetSets} 組`
                  : "♾️ 自由模式"}
              </div>
            )}

            {/* 自動偵測中覆蓋 */}
            {detecting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-sm">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-violet-400 border-t-transparent" />
                <div className="text-lg font-bold text-white">
                  🤖 AI 正在判斷你的動作
                </div>
                <div className="text-sm text-slate-300">請持續做動作…</div>
              </div>
            )}

            {/* 進度條 + 提示 */}
            {counting && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
                {feedback && (
                  <div className="mx-auto mb-2 w-fit animate-rise rounded-full bg-amber-500/90 px-4 py-1 text-sm font-semibold text-white">
                    ⚠ {feedback}
                  </div>
                )}
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-100"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* 休息倒數覆蓋 */}
            {resting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                <div className="text-sm font-semibold uppercase tracking-widest text-cyan-300">
                  休息
                </div>
                <div className="text-7xl font-black tabular text-white">
                  {restLeft}
                </div>
                <div className="text-sm text-slate-300">
                  下一組：第 {setNumber + 1} / {targetSets} 組
                </div>
                <button
                  onClick={() => {
                    if (restTimerRef.current)
                      clearInterval(restTimerRef.current);
                    setResting(false);
                    beginNextSet();
                  }}
                  className="pointer-events-auto mt-3 rounded-full bg-cyan-500 px-5 py-2 text-sm font-bold text-slate-900"
                >
                  跳過休息
                </button>
              </div>
            )}

            {/* 待啟動 */}
            {status === "idle" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-900 to-black text-center text-white">
                <div className="text-5xl">📷</div>
                <p className="max-w-sm px-6 text-slate-300">
                  開啟鏡頭，AI 教練會即時辨識骨架、自動計數並用語音陪你訓練。
                </p>
                <button
                  onClick={init}
                  className="rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-8 py-3 text-base font-bold text-slate-900 shadow-lg shadow-cyan-500/30 transition hover:scale-105"
                >
                  開啟鏡頭開始
                </button>
              </div>
            )}

            {status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/75 text-white">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-400 border-t-transparent" />
                  <p>正在載入 AI 模型…</p>
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black p-6 text-center text-white">
                <p className="text-red-300">{errorMsg}</p>
                <button
                  onClick={init}
                  className="rounded-full bg-cyan-500 px-6 py-2 font-semibold text-slate-900"
                >
                  重新嘗試
                </button>
              </div>
            )}

            {/* 暫停 */}
            {paused && !resting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="animate-rise rounded-2xl bg-amber-500/90 px-6 py-4 text-center font-bold text-white">
                  ⏸ 已自動暫停
                  <div className="text-sm font-normal">
                    回到鏡頭前即自動繼續
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右側面板 */}
        <div className="flex flex-col gap-4">
          {/* 進度環主卡 */}
          <div className="glass flex flex-col items-center rounded-3xl p-6">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-400">
              {autoDetect && (
                <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-bold text-violet-300">
                  🤖 {detecting ? "偵測中" : "自動"}
                </span>
              )}
              <span>
                {def.emoji} {def.name}
                {running && mode === "target" ? ` · 第 ${setNumber} 組` : ""}
              </span>
            </div>
            <ProgressRing
              size={210}
              stroke={14}
              progress={progress}
              fraction={ringFraction}
              color={paused ? "#f59e0b" : "#22d3ee"}
            >
              {def.timeBased ? (
                <>
                  <div
                    key={popKey}
                    className="animate-pop text-5xl font-black tabular text-white"
                  >
                    {mmss(seconds)}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-emerald-300">
                    支撐時間
                  </div>
                </>
              ) : (
                <>
                  <div
                    key={popKey}
                    className="animate-pop text-7xl font-black tabular text-white"
                  >
                    {reps}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-cyan-300">
                    {mode === "target" ? `目標 ${targetReps}` : "自由計數"}
                  </div>
                </>
              )}
            </ProgressRing>
            {personalBest > 0 && (
              <div className="mt-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
                🏆 個人紀錄：
                {def.timeBased ? mmss(personalBest) : `${personalBest} 次`}
              </div>
            )}
            <div className="mt-2 text-center text-xs text-slate-400">
              {def.hint}
            </div>
          </div>

          {/* 即時數據 */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="時間" value={mmss(seconds)} accent="text-emerald-400" />
            <Stat
              label="熱量"
              value={calories.toFixed(1)}
              unit="kcal"
              accent="text-orange-400"
            />
            {def.key === "slowjog" ? (
              <Stat
                label="步頻"
                value={String(cadence)}
                unit={`步/分 · 目標${def.targetCadence ?? 180}`}
                accent={
                  cadence >= (def.targetCadence ?? 180) - 20
                    ? "text-emerald-400"
                    : "text-violet-400"
                }
              />
            ) : (
              <Stat
                label="節奏"
                value={def.timeBased ? "—" : String(rpm)}
                unit="次/分"
                accent="text-violet-400"
              />
            )}
          </div>

          {/* 控制 */}
          <div className="glass rounded-3xl p-5">
            {status === "idle" || status === "loading" || status === "error" ? (
              <p className="text-center text-sm text-slate-400">請先開啟鏡頭</p>
            ) : running ? (
              <button
                onClick={stop}
                className="w-full rounded-2xl bg-red-500 py-3 text-base font-bold text-white transition hover:bg-red-400"
              >
                ⏹ 結束並儲存
              </button>
            ) : (
              <button
                onClick={start}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3 text-base font-bold text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:scale-[1.02]"
              >
                ▶ 開始訓練
              </button>
            )}
            {saveMsg && (
              <p className="mt-3 text-center text-sm text-slate-300">{saveMsg}</p>
            )}
          </div>

          {/* 訓練設定 */}
          <div className="glass rounded-3xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">訓練設定</span>
              <span className="text-xs text-slate-400">
                {mode === "target" ? "🎯 目標次數模式" : "♾️ 自由模式"}
              </span>
            </div>
            {mode === "target" ? (
              <div className="grid grid-cols-3 gap-3">
                <NumInput
                  label="每組次數"
                  value={targetReps}
                  setValue={setTargetReps}
                  min={1}
                  max={100}
                  disabled={running}
                />
                <NumInput
                  label="組數"
                  value={targetSets}
                  setValue={setTargetSets}
                  min={1}
                  max={20}
                  disabled={running}
                />
                <NumInput
                  label="休息(秒)"
                  value={restSec}
                  setValue={setRestSec}
                  min={0}
                  max={300}
                  step={5}
                  disabled={running}
                />
              </div>
            ) : (
              <p className="rounded-xl bg-black/30 px-4 py-3 text-xs text-slate-400">
                ♾️ 自由模式：不限次數與時間，持續計數直到你按「結束並儲存」。
                {def.timeBased
                  ? "（平板支撐會持續累計支撐時間）"
                  : "（想做幾下就做幾下）"}
              </p>
            )}
            <label className="mt-4 mb-1 block text-xs font-medium text-slate-400">
              體重（熱量估算）：{weight} kg
            </label>
            <input
              type="range"
              min={30}
              max={150}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-full"
            />

            {/* 節拍器 */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setMetronomeOn((v) => !v)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  metronomeOn
                    ? "bg-violet-500 text-white"
                    : "glass text-slate-300"
                }`}
              >
                🥁 節拍器 {metronomeOn ? "開" : "關"}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{metronomeBpm} BPM</span>
                <input
                  type="range"
                  min={20}
                  max={120}
                  step={5}
                  value={metronomeBpm}
                  onChange={(e) => setMetronomeBpm(Number(e.target.value))}
                  className="w-24"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent: string;
}) {
  return (
    <div className="glass rounded-2xl p-3 text-center">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular ${accent}`}>{value}</div>
      {unit && <div className="text-[9px] text-slate-500">{unit}</div>}
    </div>
  );
}

function NumInput({
  label,
  value,
  setValue,
  min,
  max,
  step = 1,
  disabled,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="text-center">
      <div className="mb-1 text-[11px] font-medium text-slate-400">{label}</div>
      <div className="flex items-center justify-between gap-1 rounded-xl bg-black/30 p-1">
        <button
          onClick={() => setValue(clamp(value - step))}
          disabled={disabled}
          className="h-7 w-7 rounded-lg bg-white/10 text-white disabled:opacity-40"
        >
          −
        </button>
        <span className="tabular text-base font-bold text-white">{value}</span>
        <button
          onClick={() => setValue(clamp(value + step))}
          disabled={disabled}
          className="h-7 w-7 rounded-lg bg-white/10 text-white disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
