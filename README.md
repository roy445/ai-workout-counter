# AI Workout Counter

以 Next.js、MediaPipe Pose、WebRTC、PostgreSQL 與 Drizzle ORM 建立的 AI 運動教練平台。

## 功能

- 即時人體骨架辨識與關節追蹤
- 深蹲、伏地挺身、開合跳、跳躍、高抬腿、平板支撐、抬腿、仰臥起坐、波比跳
- 自動報數、運動計時與動作品質評分
- 中文語音報數、目前狀態及姿勢修正提醒
- 本機與手機遠端攝影機連線
- 多人偵測、主要人物鎖定與離開畫面自動暫停
- 運動紀錄、每日統計、挑戰、成就與排行榜
- 手機、平板與桌面裝置響應式介面

## 技術

- Next.js App Router
- TypeScript / React / Tailwind CSS
- MediaPipe Tasks Vision
- WebRTC
- PostgreSQL / Drizzle ORM

## 本機開發

1. 安裝 Node.js 22 與 PostgreSQL。
2. 複製 `.env.example` 為 `.env`，填入 PostgreSQL 的 `DATABASE_URL`。
3. 安裝依賴並建立資料表。
4. 啟動開發伺服器。

## Render 部署

專案包含 `render.yaml` Blueprint。從 Render Dashboard 選擇 **New > Blueprint**，連接這個 GitHub repository，Render 會自動建立：

- `ai-workout-counter` Node.js Web Service
- `ai-workout-counter-db` PostgreSQL Database
- `DATABASE_URL` 連線環境變數
- Drizzle 資料表
- `/api/health` 健康檢查

攝影機需要安全來源；Render 提供的 `onrender.com` 網址包含 HTTPS。

## 資料庫用途

資料庫不會儲存攝影機影片，只保存運動紀錄、統計、排行榜，以及遠端手機鏡頭建立 WebRTC 連線時所需的短期信令資料。

## 隱私

AI 姿勢分析主要在瀏覽器端執行。請勿將 `.env` 或任何包含資料庫密碼的檔案推送到 GitHub。
