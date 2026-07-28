"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type ConnectionStatus = "connecting" | "connected" | "failed" | "closed";

export default function RemoteCameraPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastIdRef = useRef(0);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("environment");
  const [resolution, setResolution] = useState("720p");
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);

  // FPS counter
  useEffect(() => {
    const iv = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const sendSignal = useCallback(
    async (msgType: string, data: unknown) => {
      try {
        await fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            sender: "camera",
            msgType,
            data: JSON.stringify(data),
          }),
        });
      } catch {
        /* ignore */
      }
    },
    [roomId]
  );

  const startCamera = useCallback(
    async (facing: "user" | "environment") => {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facing,
          width: { ideal: resolution === "1080p" ? 1920 : 1280 },
          height: { ideal: resolution === "1080p" ? 1080 : 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      // Stop existing tracks
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        return stream;
      } catch {
        return null;
      }
    },
    [resolution]
  );

  const setupWebRTC = useCallback(async () => {
    const stream = await startCamera(cameraFacing);
    if (!stream) {
      setStatus("failed");
      return;
    }

    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    pcRef.current = pc;

    // Add tracks to peer connection
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal("candidate", event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("connected");
      } else if (pc.connectionState === "failed") {
        setStatus("failed");
      } else if (pc.connectionState === "closed") {
        setStatus("closed");
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal("offer", { sdp: offer.sdp, type: offer.type });

    // Poll for answer and ICE candidates from host
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/signal?roomId=${roomId}&notFrom=camera&afterId=${lastIdRef.current}`
        );
        const data = await res.json();
        if (!data.messages) return;

        for (const msg of data.messages.reverse()) {
          if (msg.id > lastIdRef.current) lastIdRef.current = msg.id;

          const payload = JSON.parse(msg.data);

          if (msg.msgType === "answer" && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(
              new RTCSessionDescription(payload)
            );
          } else if (msg.msgType === "candidate" && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(payload));
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      }

      frameCountRef.current++;
    }, 500);
  }, [cameraFacing, roomId, sendSignal, startCamera]);

  useEffect(() => {
    setupWebRTC();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pcRef.current?.close();
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      }
      // Clean up signals
      fetch(`/api/signal?roomId=${roomId}`, { method: "DELETE" }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchCamera = async () => {
    const newFacing = cameraFacing === "user" ? "environment" : "user";
    setCameraFacing(newFacing);

    // Get new stream
    const newStream = await startCamera(newFacing);
    if (!newStream || !pcRef.current) return;

    // Replace tracks in peer connection
    const senders = pcRef.current.getSenders();
    for (const sender of senders) {
      if (sender.track?.kind === "video") {
        const newTrack = newStream.getVideoTracks()[0];
        if (newTrack) await sender.replaceTrack(newTrack);
      }
    }
  };

  const statusConfig: Record<ConnectionStatus, { color: string; label: string; icon: string }> = {
    connecting: { color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10", label: "連線中...", icon: "⏳" },
    connected: { color: "text-green-400 border-green-500/30 bg-green-500/10", label: "已連線", icon: "✅" },
    failed: { color: "text-red-400 border-red-500/30 bg-red-500/10", label: "連線失敗", icon: "❌" },
    closed: { color: "text-gray-400 border-gray-500/30 bg-gray-500/10", label: "已斷線", icon: "⏸️" },
  };

  const cfg = statusConfig[status];

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="bg-black/60 backdrop-blur-md border-b border-white/10 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📹</span>
            <div>
              <h1 className="text-sm font-bold">AI 遠端攝影機</h1>
              <p className="text-[10px] text-gray-400">房間: {roomId}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
            {cfg.icon} {cfg.label}
          </span>
        </div>
      </header>

      {/* Camera view */}
      <div className="flex-1 relative bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {/* Overlay info */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-300">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1.5 animate-pulse" />
              {resolution} · {fps > 0 ? `${fps} poll/s` : "---"}
            </div>
            <div className="flex gap-2">
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="bg-white/10 rounded-lg px-2 py-1.5 text-xs border border-white/10"
              >
                <option value="720p" className="bg-gray-900">720p HD</option>
                <option value="1080p" className="bg-gray-900">1080p FHD</option>
              </select>
              <button
                onClick={handleSwitchCamera}
                className="p-2 rounded-lg bg-white/15 hover:bg-white/25 transition active:scale-95"
              >
                🔄
              </button>
            </div>
          </div>
        </div>

        {/* Connection status overlay */}
        {status === "connecting" && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center p-6">
              <div className="inline-block w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-lg font-bold">正在連線到主系統...</p>
              <p className="text-sm text-gray-400 mt-2">房間代碼: {roomId}</p>
              <p className="text-xs text-gray-500 mt-1">請確保主系統已開啟</p>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center p-6">
              <div className="text-5xl mb-4">❌</div>
              <p className="text-lg font-bold text-red-400">連線失敗</p>
              <p className="text-sm text-gray-400 mt-2">
                請確認房間代碼正確，並重新整理頁面
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-700 rounded-xl font-bold transition"
              >
                重新連線
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="bg-black/60 backdrop-blur-md border-t border-white/10 px-4 py-3 flex-shrink-0 text-center">
        <p className="text-xs text-gray-400">
          此裝置作為遠端攝影機，影像將傳送至主系統進行 AI 分析
        </p>
      </div>
    </div>
  );
}
