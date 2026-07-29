import Link from "next/link";
import { EXERCISES } from "@/lib/exercise-detector";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-blue-600/5 to-transparent pointer-events-none" />
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <header className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-2xl sm:text-3xl">🏋️‍♂️</span>
            <span className="text-lg sm:text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">AI Fitness Coach</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <Link href="/camera" className="rounded-xl px-2 py-2 text-xs text-gray-300 transition hover:bg-white/10 hover:text-white sm:px-3 sm:text-sm">📱 <span className="hidden sm:inline">手機鏡頭</span></Link>
            <Link href="/history" className="hidden rounded-xl px-3 py-2 text-xs text-gray-300 transition hover:bg-white/10 hover:text-white sm:inline-block sm:text-sm">📊 紀錄</Link>
            <Link href="/workout" className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-2 text-xs font-bold shadow-lg shadow-cyan-500/20 transition hover:from-cyan-600 hover:to-blue-700 sm:px-5 sm:py-2.5 sm:text-sm">開始運動 →</Link>
          </div>
        </header>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16 sm:pb-24 text-center">
          <div className="inline-block px-3 py-1 sm:px-4 sm:py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs sm:text-sm font-medium mb-4 sm:mb-6">
            🤖 AI 驅動 · 🔊 語音播報 · 📹 多鏡頭支援 · 📱 手機友善
          </div>
          <h1 className="text-3xl sm:text-5xl md:text-7xl font-black mb-4 sm:mb-6 leading-tight">
            你的<span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent"> AI 私人教練</span>
          </h1>
          <p className="text-sm sm:text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-6 sm:mb-10 leading-relaxed px-2">
            只需一個普通鏡頭，AI 即時辨識人體姿勢，智慧計數與品質評分。支援語音報數、姿勢糾正播報，還能連接手機作為多角度攝影機。
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/workout" className="group w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-base sm:text-lg hover:from-cyan-600 hover:to-blue-700 transition shadow-2xl shadow-cyan-500/30 flex items-center justify-center gap-2">
              <span>立即開始運動</span><span className="group-hover:translate-x-1 transition-transform">→</span>
            </Link>
            <Link href="/history" className="w-full sm:w-auto px-6 py-3 sm:px-8 sm:py-4 rounded-2xl bg-white/5 border border-white/10 font-medium text-base sm:text-lg hover:bg-white/10 transition text-center">
              查看紀錄 📊
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2 sm:mb-3">核心功能</h2>
          <p className="text-sm sm:text-base text-gray-400">專業級 AI 運動追蹤系統</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[
            { icon: "🦴", title: "即時骨架追蹤", desc: "MediaPipe AI 即時偵測 33 個人體關節，HD 高清畫質精準追蹤動作，畫面中即時顯示骨架連線。" },
            { icon: "🔊", title: "語音報數與糾正", desc: "AI 教練即時語音播報完成次數，動作品質不佳時語音提醒糾正姿勢，就像真人教練在旁指導。" },
            { icon: "📹", title: "多鏡頭支援", desc: "支援連接外部手機作為遠端攝影機，從正面、側面多角度捕捉動作，大幅提高判斷準確度。" },
            { icon: "🧠", title: "智慧動作辨識", desc: "透過關節角度計算與狀態機分析，精準辨識深蹲、伏地挺身、開合跳等 9 種運動，避免誤判。" },
            { icon: "👥", title: "智慧人物管理", desc: "自動鎖定主要使用者，偵測多人時發出警告，人物離開鏡頭自動暫停分析並語音提示。" },
            { icon: "🏆", title: "成就與挑戰", desc: "挑戰模式設定目標次數，成就系統解鎖徽章，排行榜激勵持續運動，紀錄每日數據。" },
          ].map((f, i) => (
            <div key={i} className="bg-white/5 backdrop-blur rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/10 hover:border-cyan-500/30 transition group">
              <div className="text-3xl sm:text-4xl mb-3 group-hover:scale-110 transition-transform">{f.icon}</div>
              <h3 className="text-base sm:text-lg font-bold mb-1 sm:mb-2">{f.title}</h3>
              <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Exercises */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">支援運動項目</h2>
          <p className="text-sm text-gray-400">AI 能辨識多種常見運動動作</p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-4">
          {EXERCISES.map((ex) => (
            <div key={ex.id} className="bg-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-white/10 text-center hover:border-cyan-500/30 transition">
              <div className="text-2xl sm:text-3xl mb-1 sm:mb-2">{ex.icon}</div>
              <div className="font-medium text-xs sm:text-sm">{ex.nameZh}</div>
              <div className="text-[10px] sm:text-xs text-gray-500">{ex.name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Multi-camera section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">📱 多裝置連線</h2>
          <p className="text-sm text-gray-400">將手機變成 AI 攝影機，多角度捕捉動作</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {[
            { step: "01", icon: "🔗", title: "產生連線碼", desc: "在主系統的鏡頭管理面板中產生一組房間代碼" },
            { step: "02", icon: "📱", title: "手機開啟", desc: "用手機瀏覽器掃描或輸入連結，開啟遠端攝影機" },
            { step: "03", icon: "🎯", title: "多角度分析", desc: "AI 綜合多鏡頭影像，從不同角度精準分析動作" },
          ].map((s, i) => (
            <div key={i} className="text-center p-4 sm:p-6">
              <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-500/20 mb-3 sm:mb-4">
                <span className="text-3xl sm:text-4xl">{s.icon}</span>
              </div>
              <div className="text-purple-400 text-xs font-bold mb-1">步驟 {s.step}</div>
              <h3 className="text-base sm:text-lg font-bold mb-1 sm:mb-2">{s.title}</h3>
              <p className="text-xs sm:text-sm text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="bg-gradient-to-r from-cyan-500/10 via-blue-600/10 to-purple-500/10 rounded-2xl sm:rounded-3xl p-8 sm:p-12 border border-white/10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 sm:mb-4">準備好成為更好的自己了嗎？</h2>
          <p className="text-sm sm:text-base text-gray-400 mb-6 sm:mb-8 max-w-lg mx-auto">不需要穿戴設備，不需要健身房，只需要鏡頭和你的決心。</p>
          <Link href="/workout" className="inline-block px-8 py-3 sm:px-10 sm:py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-base sm:text-lg hover:from-cyan-600 hover:to-blue-700 transition shadow-2xl shadow-cyan-500/30">🚀 立即開始訓練</Link>
        </div>
      </section>

      <footer className="border-t border-white/10 py-6 sm:py-8 text-center text-xs sm:text-sm text-gray-500">
        <p>🏋️‍♂️ AI Fitness Coach · MediaPipe AI · 免費開源 · 手機 / 電腦適用</p>
      </footer>
    </div>
  );
}
