"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  WEBRTC_CONFIG,
  getSignals,
  parseSignal,
  postSignal,
  tuneVideoSender,
  wait,
} from "@/lib/webrtc";

type ConnectionStatus =
  | "camera"
  | "waiting"
  | "negotiating"
  | "connected"
  | "failed"
  | "closed";

interface StreamStats {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  rttMs: number;
}

const STATUS_LABELS: Record<ConnectionStatus, { label: string; icon: string; classes: string }> = {
  camera: { label: "開啟鏡頭", icon: "📷", classes: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10" },
  waiting: { label: "等待主系統", icon: "⏳", classes: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10" },
  negotiating: { label: "建立低延遲連線", icon: "🔗", classes: "text-blue-300 border-blue-500/30 bg-blue-500/10" },
  connected: { label: "即時傳輸中", icon: "✅", classes: "text-green-300 border-green-500/30 bg-green-500/10" },
  failed: { label: "連線失敗", icon: "❌", classes: "text-red-300 border-red-500/30 bg-red-500/10" },
  closed: { label: "已斷線", icon: "⏸️", classes: "text-gray-300 border-gray-500/30 bg-gray-500/10" },
};

export default function RemoteCameraPage() {
  const params = useParams();
  const roomId = String(params.roomId || "").trim().toUpperCase();

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const lastSignalIdRef = useRef(0);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const senderIdRef = useRef(`camera-${Math.random().toString(36).slice(2, 9)}`);
  const reconnectKeyRef = useRef(0);
  const previousBytesRef = useRef({ bytes: 0, timestamp: 0 });

  const [status, setStatus] = useState<ConnectionStatus>("camera");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [errorMessage, setErrorMessage] = useState("");
  const [stats, setStats] = useState<StreamStats>({ width: 0, height: 0, fps: 0, bitrateKbps: 0, rttMs: 0 });

  const stopPeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidatesRef.current = [];
  }, []);

  const openCamera = useCallback(async (cameraFacing: "user" | "environment") => {
    setStatus("camera");
    setErrorMessage("");

    const target = resolution === "1080p"
      ? { width: 1920, height: 1080 }
      : { width: 1280, height: 720 };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: target.width },
          height: { ideal: target.height },
          frameRate: { ideal: 30, min: 24 },
        },
        audio: false,
      });

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.contentHint = "motion";
        const settings = track.getSettings();
        setStats((current) => ({
          ...current,
          width: settings.width || target.width,
          height: settings.height || target.height,
          fps: settings.frameRate || 0,
        }));

        // Supported Android devices use continuous autofocus where available.
        try {
          await track.applyConstraints({
            advanced: ([{ focusMode: "continuous" }] as unknown) as MediaTrackConstraintSet[],
          });
        } catch {
          // iOS and some browsers do not expose focus controls.
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return stream;
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法開啟手機鏡頭";
      setErrorMessage(message.includes("Permission") ? "請允許瀏覽器使用攝影機" : message);
      setStatus("failed");
      return null;
    }
  }, [resolution]);

  const createAndSendOffer = useCallback(async (pc: RTCPeerConnection) => {
    if (pc.signalingState === "closed") return;
    const offer = await pc.createOffer({ iceRestart: pc.iceConnectionState === "failed" });
    await pc.setLocalDescription(offer);
    await postSignal(roomId, senderIdRef.current, "offer", {
      type: offer.type,
      sdp: offer.sdp,
    });
    setStatus("waiting");
  }, [roomId]);

  const startConnection = useCallback(async () => {
    stoppedRef.current = false;
    stopPeer();
    lastSignalIdRef.current = 0;

    const stream = streamRef.current || await openCamera(facing);
    if (!stream) return;

    const pc = new RTCPeerConnection(WEBRTC_CONFIG);
    pcRef.current = pc;

    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind === "video") void tuneVideoSender(sender);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void postSignal(roomId, senderIdRef.current, "candidate", event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("connected");
        setErrorMessage("");
      } else if (pc.connectionState === "connecting") {
        setStatus("negotiating");
      } else if (pc.connectionState === "failed") {
        setStatus("failed");
        setErrorMessage("P2P 連線失敗，正在嘗試重新連線");
        window.setTimeout(() => {
          if (!stoppedRef.current && pcRef.current === pc) {
            pc.restartIce();
            void createAndSendOffer(pc);
          }
        }, 1200);
      } else if (pc.connectionState === "closed") {
        setStatus("closed");
      }
    };

    await postSignal(roomId, senderIdRef.current, "ready", { at: Date.now() });
    await createAndSendOffer(pc);

    // Sequential polling prevents overlapping requests on slower mobile networks.
    while (!stoppedRef.current && pcRef.current === pc) {
      const messages = await getSignals(roomId, senderIdRef.current, lastSignalIdRef.current);

      for (const message of messages) {
        lastSignalIdRef.current = Math.max(lastSignalIdRef.current, message.id);

        if (message.msgType === "answer") {
          const answer = parseSignal<RTCSessionDescriptionInit>(message);
          if (answer && pc.signalingState === "have-local-offer") {
            setStatus("negotiating");
            await pc.setRemoteDescription(answer);
            const queued = pendingCandidatesRef.current.splice(0);
            for (const candidate of queued) {
              try { await pc.addIceCandidate(candidate); } catch { /* ignore stale candidate */ }
            }
            pc.getSenders().forEach((sender) => void tuneVideoSender(sender));
          }
        } else if (message.msgType === "candidate") {
          const candidate = parseSignal<RTCIceCandidateInit>(message);
          if (!candidate) continue;
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(candidate); } catch { /* ignore stale candidate */ }
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        } else if (message.msgType === "restart") {
          pc.restartIce();
          await createAndSendOffer(pc);
        } else if (message.msgType === "bye") {
          setStatus("closed");
        }
      }

      await wait(pc.connectionState === "connected" ? 1000 : 300);
    }
  }, [createAndSendOffer, facing, openCamera, roomId, stopPeer]);

  useEffect(() => {
    const senderId = senderIdRef.current;
    void startConnection();
    return () => {
      stoppedRef.current = true;
      stopPeer();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      // The phone never deletes the whole room; doing so used to erase the host answer.
      void postSignal(roomId, senderId, "bye", { at: Date.now() });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read actual outbound WebRTC statistics instead of displaying a polling counter.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState !== "connected") return;
      const reports = await pc.getStats();
      let nextFps = 0;
      let nextRtt = 0;
      let nextBitrate = 0;

      reports.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video") {
          nextFps = Number(report.framesPerSecond || 0);
          const bytes = Number(report.bytesSent || 0);
          const now = Number(report.timestamp || performance.now());
          if (previousBytesRef.current.timestamp > 0 && now > previousBytesRef.current.timestamp) {
            nextBitrate = Math.round(
              ((bytes - previousBytesRef.current.bytes) * 8) /
              (now - previousBytesRef.current.timestamp)
            );
          }
          previousBytesRef.current = { bytes, timestamp: now };
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          nextRtt = Math.round(Number(report.currentRoundTripTime || 0) * 1000);
        }
      });

      setStats((current) => ({
        ...current,
        fps: nextFps || current.fps,
        bitrateKbps: nextBitrate,
        rttMs: nextRtt,
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const switchCamera = useCallback(async () => {
    const nextFacing = facing === "user" ? "environment" : "user";
    setFacing(nextFacing);
    const newStream = await openCamera(nextFacing);
    const newTrack = newStream?.getVideoTracks()[0];
    const sender = pcRef.current?.getSenders().find((item) => item.track?.kind === "video");
    if (newTrack && sender) {
      await sender.replaceTrack(newTrack);
      await tuneVideoSender(sender);
    }
  }, [facing, openCamera]);

  const changeResolution = useCallback(async (value: "720p" | "1080p") => {
    setResolution(value);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const size = value === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    try {
      await track.applyConstraints({
        width: { ideal: size.width },
        height: { ideal: size.height },
        frameRate: { ideal: 30, min: 24 },
      });
      const settings = track.getSettings();
      setStats((current) => ({ ...current, width: settings.width || size.width, height: settings.height || size.height }));
    } catch {
      setErrorMessage("此手機不支援所選解析度，已保留目前畫質");
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectKeyRef.current += 1;
    stoppedRef.current = true;
    stopPeer();
    window.setTimeout(() => {
      stoppedRef.current = false;
      void startConnection();
    }, 250);
  }, [startConnection, stopPeer]);

  const cfg = STATUS_LABELS[status];

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white camera-stage">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain bg-black"
        playsInline
        muted
        autoPlay
      />

      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/90 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/camera" className="rounded-lg bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">←</Link>
          <div className="min-w-0">
            <h1 className="truncate text-xs font-bold sm:text-sm">📹 AI 遠端攝影機</h1>
            <p className="text-[10px] text-gray-300">房間 {roomId}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium sm:text-xs ${cfg.classes}`}>
          {cfg.icon} {cfg.label}
        </span>
      </header>

      <section className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-14 sm:px-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] text-gray-300 sm:text-xs">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${status === "connected" ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {stats.width || "—"}×{stats.height || "—"} · {Math.round(stats.fps) || "—"} FPS
            {status === "connected" && <> · {stats.rttMs || "—"} ms · {stats.bitrateKbps || "—"} kbps</>}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={resolution}
              onChange={(event) => void changeResolution(event.target.value as "720p" | "1080p")}
              className="rounded-lg border border-white/15 bg-black/55 px-2 py-2 text-xs"
              aria-label="影像解析度"
            >
              <option value="720p">720p 低延遲</option>
              <option value="1080p">1080p 高畫質</option>
            </select>
            <button onClick={() => void switchCamera()} className="rounded-lg bg-white/15 px-3 py-2 text-xs hover:bg-white/25 active:scale-95">🔄 切換</button>
            {(status === "failed" || status === "closed") && (
              <button onClick={reconnect} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold hover:bg-cyan-700">重新連線</button>
            )}
          </div>
        </div>
        {errorMessage && <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-yellow-300 sm:text-xs">{errorMessage}</p>}
      </section>

      {status !== "connected" && status !== "failed" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/25">
          <div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center backdrop-blur-md">
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-3 border-cyan-400 border-t-transparent" />
            <p className="text-sm font-bold">{cfg.label}</p>
            <p className="mt-1 text-[10px] text-gray-300">主系統產生代碼後會自動等待，不需再按按鈕</p>
          </div>
        </div>
      )}

      {status === "failed" && !streamRef.current && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-5">
          <div className="max-w-sm text-center">
            <div className="mb-3 text-5xl">📷</div>
            <h2 className="text-lg font-bold text-red-300">無法開啟鏡頭</h2>
            <p className="mt-2 text-sm text-gray-300">{errorMessage}</p>
            <button onClick={reconnect} className="mt-4 rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-bold">重新嘗試</button>
          </div>
        </div>
      )}
    </main>
  );
}
