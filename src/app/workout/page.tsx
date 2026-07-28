"use client";

import dynamic from "next/dynamic";

const WorkoutApp = dynamic(() => import("@/components/WorkoutApp"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-white text-lg font-medium">正在載入 AI 運動教練...</p>
        <p className="text-gray-400 text-sm mt-2">
          首次載入需要下載 AI 模型，請稍候
        </p>
      </div>
    </div>
  ),
});

export default function WorkoutPage() {
  return <WorkoutApp />;
}
