export type SignalType = "ready" | "offer" | "answer" | "candidate" | "restart" | "bye";

export interface SignalMessage {
  id: number;
  roomId: string;
  sender: string;
  msgType: SignalType;
  data: string;
  createdAt: string;
}

const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// TURN is optional but required on some carrier-grade or corporate NAT networks.
// WebRTC clients must receive these credentials, so use short-lived TURN credentials in production.
const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
if (turnUrl && turnUsername && turnCredential) {
  iceServers.push({
    urls: turnUrl.split(",").map((url) => url.trim()),
    username: turnUsername,
    credential: turnCredential,
  });
}

export const WEBRTC_CONFIG: RTCConfiguration = {
  iceServers,
  iceCandidatePoolSize: 6,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

export async function postSignal(
  roomId: string,
  sender: string,
  msgType: SignalType,
  payload: unknown
): Promise<boolean> {
  try {
    const response = await fetch("/api/signal", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: roomId.toUpperCase(),
        sender,
        msgType,
        data: JSON.stringify(payload),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getSignals(
  roomId: string,
  notFrom: string,
  afterId: number
): Promise<SignalMessage[]> {
  try {
    const query = new URLSearchParams({
      roomId: roomId.toUpperCase(),
      notFrom,
      afterId: String(afterId),
      t: String(Date.now()),
    });
    const response = await fetch(`/api/signal?${query}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { messages?: SignalMessage[] };
    return data.messages || [];
  } catch {
    return [];
  }
}

export function parseSignal<T>(message: SignalMessage): T | null {
  try {
    return JSON.parse(message.data) as T;
  } catch {
    return null;
  }
}

export async function clearSignalRoom(roomId: string): Promise<void> {
  try {
    await fetch(`/api/signal?roomId=${encodeURIComponent(roomId.toUpperCase())}`, {
      method: "DELETE",
      cache: "no-store",
    });
  } catch {
    // A stale room is harmless because every generated code is unique.
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Tune the outgoing video for live movement analysis rather than visual detail.
 * WebRTC video remains peer-to-peer after signaling completes.
 */
export async function tuneVideoSender(sender: RTCRtpSender): Promise<void> {
  const track = sender.track;
  if (!track || track.kind !== "video") return;

  track.contentHint = "motion";

  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = 2_200_000;
    params.encodings[0].maxFramerate = 30;
    params.encodings[0].scaleResolutionDownBy = 1;
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "maintain-framerate";
    await sender.setParameters(params);
  } catch {
    // Safari may reject parameters before negotiation; default WebRTC settings still work.
  }
}
