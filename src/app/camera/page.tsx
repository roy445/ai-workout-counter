"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CameraJoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const join = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (normalized.length < 4 || normalized.length > 12) {
      setError("請輸入主系統顯示的房間代碼");
      return;
    }
    router.push(`/camera/${normalized}`);
  };

  return (
    <main className="min-h-[100dvh] bg-gradient-to-br from-gray-950 via-gray-900 to-black px-4 py-[max(24px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] max-w-md flex-col justify-center">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 self-start text-sm text-gray-400 hover:text-white">
          ← 返回 AI 運動教練
        </Link>

        <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-cyan-500/10 backdrop-blur-xl sm:p-7">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/15 text-3xl">📱</div>
            <h1 className="text-2xl font-black">連接 AI 主系統</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">
              在主系統的「多機」頁籤產生連線代碼，再於此手機輸入代碼。
            </p>
          </div>

          <form onSubmit={join} className="space-y-3">
            <label htmlFor="room-code" className="block text-xs font-semibold text-gray-300">房間代碼</label>
            <input
              id="room-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12));
                setError("");
              }}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="例如 ABC123"
              className="w-full rounded-2xl border border-white/15 bg-black/35 px-4 py-4 text-center text-2xl font-black uppercase tracking-[0.28em] text-cyan-300 outline-none transition placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
              autoFocus
            />
            {error && <p className="text-center text-xs text-red-300">{error}</p>}
            <button
              type="submit"
              disabled={code.length < 4}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3.5 text-sm font-bold shadow-lg shadow-cyan-500/20 transition hover:from-cyan-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              開啟手機鏡頭並連線
            </button>
          </form>

          <div className="mt-5 space-y-2 border-t border-white/10 pt-5 text-xs text-gray-400">
            <p>① 主系統按「產生連線代碼」後已自動等待。</p>
            <p>② 手機輸入代碼並允許攝影機權限。</p>
            <p>③ 成功後影像使用 WebRTC 點對點傳輸，不會上傳保存。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
