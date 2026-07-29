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

const STATUS_LABELS: Record<
  ConnectionStatus,
  { label: string; icon: string; classes: string }
> = {
  camera: {
    label: "開啟鏡頭",
    icon: "📷",
    classes: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  },
  waiting: {
    label: "尋找主系統",
    icon: "⏳",
    classes: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10",
  },
  negotiating: {
    label: "建立低延遲連線",
    icon: "🔗",
    classes: "text-blue-300 border-blue-500/30 bg-blue-500/10",
  },
  connected: {
    label: "即時傳輸中",
    icon: "✅",
    classes: "text-green-300 border-green-500/30 bg-green-500/10",
  },
  failed: {
    label: "連線失敗",
    icon: "❌",
    classes: "text-red-300 border-red-500/30 bg-red-500/10",
  },
  closed: {
    label: "已斷線",
    icon: "⏸️",
    classes: "text-gray-300 border-gray-500/30 bg-gray-500/10",
  },
};

export default function RemoteCameraPage() {
  const params = useParams();
  const roomId = String(params.roomId || "").trim().toUpperCase();

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runIdRef = useRef(0);
  const lastSignalIdRef = useRef(0);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const senderIdRef = useRef(
    `camera-${Math.random().toString(36).slice(2, 9)}`,
  );
  const previousBytesRef = useRef({ bytes: 0, timestamp: 0 });

  const [status, setStatus] = useState<ConnectionStatus>("camera");
  const [facing, setFacing] =
    useState<"user" | "environment">("environment");
  const [resolution, setResolution] = useState<"720p" | "1080p">(
    "720p",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [stats, setStats] = useState<StreamStats>({
    width: 0,
    height: 0,
    fps: 0,
    bitrateKbps: 0,
    rttMs: 0,
  });

  const stopPeer = useCallback(() => {
    runIdRef.current += 1;
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidatesRef.current = [];
  }, []);

  const openCamera = useCallback(
    async (cameraFacing: "user" | "environment") => {
      setStatus("camera");
      setErrorMessage("");

      const target =
        resolution === "1080p"
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

          try {
            await track.applyConstraints({
              advanced: ([{ focusMode: "continuous" }] as unknown) as MediaTrackConstraintSet[],
            });
          } catch {
            // Continuous focus is optional and is not exposed by iOS Safari.
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        return stream;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "無法開啟手機鏡頭";
        setErrorMessage(
          message.toLowerCase().includes("permission") ||
            message.toLowerCase().includes("denied")
            ? "請到瀏覽器網站設定允許使用攝影機"
            : message,
        );
        setStatus("failed");
        return null;
      }
    },
    [resolution],
  );

  const startConnection = useCallback(
    async (resetCursor = false) => {
      stopPeer();
      const runId = runIdRef.current;
      if (resetCursor) lastSignalIdRef.current = 0;
      setWaitSeconds(0);
      setErrorMessage("");

      if (!/^[A-Z0-9]{4,12}$/.test(roomId)) {
        setStatus("failed");
        setErrorMessage("房間代碼格式錯誤，請返回重新輸入");
        return;
      }

      const stream = streamRef.current || (await openCamera(facing));
      if (!stream || runIdRef.current !== runId) return;

      const pc = new RTCPeerConnection(WEBRTC_CONFIG);
      pcRef.current = pc;

      for (const track of stream.getTracks()) {
        const transceiver = pc.addTransceiver(track, {
          direction: "sendonly",
          streams: [stream],
        });
        if (track.kind === "video") {
          void tuneVideoSender(transceiver.sender);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void postSignal(
            roomId,
            senderIdRef.current,
            "candidate",
            event.candidate.toJSON(),
          );
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
          setErrorMessage(
            "裝置已交換連線資訊，但目前網路阻擋 P2P。請讓兩台裝置改用同一個 Wi-Fi，或設定 TURN。",
          );
        } else if (pc.connectionState === "disconnected") {
          setStatus("negotiating");
          setErrorMessage("影像暫時中斷，正在恢復連線");
        } else if (pc.connectionState === "closed") {
          setStatus("closed");
        }
      };

      setStatus("waiting");
      const readySent = await postSignal(
        roomId,
        senderIdRef.current,
        "ready",
        { at: Date.now() },
      );

      if (!readySent) {
        setStatus("failed");
        setErrorMessage(
          "無法連接信令伺服器。請確認 Vercel 已設定 DATABASE_URL，並且 signaling 資料表已建立。",
        );
        return;
      }

      const startedAt = Date.now();
      let offerReceived = false;

      while (runIdRef.current === runId && pcRef.current === pc) {
        const messages = await getSignals(
          roomId,
          senderIdRef.current,
          lastSignalIdRef.current,
        );

        for (const message of messages) {
          lastSignalIdRef.current = Math.max(
            lastSignalIdRef.current,
            message.id,
          );

          if (message.msgType === "offer") {
            const offer = parseSignal<RTCSessionDescriptionInit>(message);
            if (!offer || offer.type !== "offer") continue;

            try {
              offerReceived = true;
              setStatus("negotiating");
              setErrorMessage("");
              await pc.setRemoteDescription(offer);

              const queued = pendingCandidatesRef.current.splice(0);
              for (const candidate of queued) {
                try {
                  await pc.addIceCandidate(candidate);
                } catch {
                  // Ignore candidates belonging to an older negotiation.
                }
              }

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              const answerSent = await postSignal(
                roomId,
                senderIdRef.current,
                "answer",
                { type: answer.type, sdp: answer.sdp },
              );

              if (!answerSent) {
                setStatus("failed");
                setErrorMessage("已找到主系統，但無法送出連線回覆");
              }

              pc.getSenders().forEach((sender) =>
                void tuneVideoSender(sender),
              );
            } catch {
              setStatus("failed");
              setErrorMessage("收到房間資訊，但建立 WebRTC 連線失敗");
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
              pendingCandidatesRef.current.push(candidate);
            }
          } else if (message.msgType === "restart") {
            setStatus("waiting");
            setErrorMessage("主系統正在重新建立房間，請稍候");
          } else if (message.msgType === "bye") {
            setStatus("closed");
            setErrorMessage("主系統已關閉這個房間");
          }
        }

        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setWaitSeconds(elapsed);

        if (!offerReceived && elapsed >= 15) {
          setStatus("failed");
          setErrorMessage(
            "找不到主系統。請確認主系統仍停在「已自動等待手機連線」，且房間代碼完全相同。",
          );
        }

        await wait(pc.connectionState === "connected" ? 1000 : 350);
      }
    },
    [facing, openCamera, roomId, stopPeer],
  );

  useEffect(() => {
    const senderId = senderIdRef.current;
    void startConnection(true);
    return () => {
      stopPeer();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void postSignal(roomId, senderId, "bye", { at: Date.now() });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          if (
            previousBytesRef.current.timestamp > 0 &&
            now > previousBytesRef.current.timestamp
          ) {
            nextBitrate = Math.round(
              ((bytes - previousBytesRef.current.bytes) * 8) /
                (now - previousBytesRef.current.timestamp),
            );
          }
          previousBytesRef.current = { bytes, timestamp: now };
        }
        if (
          report.type === "candidate-pair" &&
          report.state === "succeeded"
        ) {
          nextRtt = Math.round(
            Number(report.currentRoundTripTime || 0) * 1000,
          );
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
    const sender = pcRef.current
      ?.getSenders()
      .find((item) => item.track?.kind === "video");
    if (newTrack && sender) {
      await sender.replaceTrack(newTrack);
      await tuneVideoSender(sender);
    }
  }, [facing, openCamera]);

  const changeResolution = useCallback(
    async (value: "720p" | "1080p") => {
      setResolution(value);
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      const size =
        value === "1080p"
          ? { width: 1920, height: 1080 }
          : { width: 1280, height: 720 };
      try {
        await track.applyConstraints({
          width: { ideal: size.width },
          height: { ideal: size.height },
          frameRate: { ideal: 30, min: 24 },
        });
        const settings = track.getSettings();
        setStats((current) => ({
          ...current,
          width: settings.width || size.width,
          height: settings.height || size.height,
        }));
      } catch {
        setErrorMessage("此手機不支援所選解析度，已保留目前畫質");
      }
    },
    [],
  );

  const reconnect = useCallback(() => {
    void startConnection(true);
  }, [startConnection]);

  const cfg = STATUS_LABELS[status];

  return (
    <main className="camera-stage fixed inset-0 overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        playsInline
        muted
        autoPlay
      />

      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/90 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/camera"
            className="rounded-lg bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20"
          >
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xs font-bold sm:text-sm">
              📹 AI 遠端攝影機
            </h1>
            <p className="text-[10px] text-gray-300">房間 {roomId}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium sm:text-xs ${cfg.classes}`}
        >
          {cfg.icon} {cfg.label}
        </span>
      </header>

      <section className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-14 sm:px-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] text-gray-300 sm:text-xs">
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${status === "connected" ? "animate-pulse bg-green-400" : "bg-yellow-400"}`}
            />
            {stats.width || "—"}×{stats.height || "—"} ·{" "}
            {Math.round(stats.fps) || "—"} FPS
            {status === "connected" && (
              <>
                {" "}
                · {stats.rttMs || "—"} ms · {stats.bitrateKbps || "—"} kbps
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={resolution}
              onChange={(event) =>
                void changeResolution(
                  event.target.value as "720p" | "1080p",
                )
              }
              className="rounded-lg border border-white/15 bg-black/55 px-2 py-2 text-xs"
              aria-label="影像解析度"
            >
              <option value="720p">720p 低延遲</option>
              <option value="1080p">1080p 高畫質</option>
            </select>
            <button
              onClick={() => void switchCamera()}
              className="rounded-lg bg-white/15 px-3 py-2 text-xs hover:bg-white/25 active:scale-95"
            >
              🔄 切換
            </button>
            {(status === "failed" || status === "closed") && (
              <button
                onClick={reconnect}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold hover:bg-cyan-700"
              >
                重新連線
              </button>
            )}
          </div>
        </div>
        {errorMessage && (
          <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-yellow-300 sm:text-xs">
            {errorMessage}
          </p>
        )}
      </section>

      {(status === "camera" ||
        status === "waiting" ||
        status === "negotiating") && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/25">
          <div className="rounded-2xl border border-white/10 bg-black/65 px-5 py-4 text-center backdrop-blur-md">
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-3 border-cyan-400 border-t-transparent" />
            <p className="text-sm font-bold">{cfg.label}</p>
            <p className="mt-1 text-[10px] text-gray-300">
              已等待 {waitSeconds} 秒
            </p>
            <p className="mt-1 text-[10px] text-gray-400">
              主系統產生代碼後會自動等待，不需再按按鈕
            </p>
          </div>
        </div>
      )}

      {status === "failed" && !streamRef.current && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-5">
          <div className="max-w-sm text-center">
            <div className="mb-3 text-5xl">📷</div>
            <h2 className="text-lg font-bold text-red-300">無法開啟鏡頭</h2>
            <p className="mt-2 text-sm text-gray-300">{errorMessage}</p>
            <button
              onClick={reconnect}
              className="mt-4 rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-bold"
            >
              重新嘗試
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
