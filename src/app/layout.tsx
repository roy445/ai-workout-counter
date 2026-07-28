import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 運動教練 | AI Fitness Coach",
  description:
    "使用 AI 人體姿勢辨識技術，即時分析運動動作，智慧計數與品質評分。支援深蹲、伏地挺身、開合跳等多種運動。",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏋️</text></svg>",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
