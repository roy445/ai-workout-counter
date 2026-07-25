# 🏃 AI 運動計數網站

使用電腦或手機鏡頭，透過 **MediaPipe Pose** 即時辨識人體骨架，自動偵測並計算多種運動
（深蹲、伏地挺身、仰臥起坐、開合跳、跳躍、平板支撐、原地踏步、超慢跑），
含語音報數、組數/目標、組間休息、AI 自動判斷動作、每日與歷史紀錄、圖表與成就系統。

技術：**Next.js (App Router) + TypeScript + Tailwind CSS + Drizzle ORM + PostgreSQL**

---

## 環境需求

- **Node.js 20 或以上**（建議 LTS）→ <https://nodejs.org>
- **PostgreSQL 14 或以上** → <https://www.postgresql.org/download/>
- 一個瀏覽器（Chrome / Edge / Safari 皆可）+ 可用的鏡頭

---

## 在 VSCode 初始化與啟動（一步一步）

### 1. 用 VSCode 開啟專案
`檔案 → 開啟資料夾`，選這個專案資料夾。

### 2. 開啟終端機
選單 `終端機 → 新增終端機`（或按 `` Ctrl + ` ``）。

### 3. 安裝套件
```bash
npm install
```

### 4. 設定環境變數
複製範例檔並依需要修改連線字串：
```bash
cp .env.example .env
```
`.env` 內的 `DATABASE_URL` 預設為：
```
postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

### 5. 建立資料庫
確認 PostgreSQL 已啟動，然後建立名為 `app_db` 的資料庫：
```bash
# 方法一：用 createdb
createdb app_db

# 方法二：用 psql
psql -U postgres -c "CREATE DATABASE app_db;"
```

### 6. 建立資料表（套用 schema）
```bash
npx drizzle-kit push
```

### 7. 啟動開發伺服器
```bash
npm run dev
```
瀏覽器開啟 <http://localhost:3000> 即可使用。

> 📷 首次使用會請求鏡頭權限，請按「允許」。鏡頭功能在 `localhost` 或 HTTPS 下才可運作。

---

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動開發伺服器（熱更新） |
| `npm run build` | 建置正式版 |
| `npm run start` | 執行正式版（需先 build） |
| `npm run lint` | 程式碼檢查 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npx drizzle-kit push` | 將 schema 套用到資料庫 |

---

## 專案結構

```
src/
├─ app/
│  ├─ page.tsx            # 首頁（運動計數）
│  ├─ history/page.tsx    # 歷史紀錄 / 數據頁
│  ├─ layout.tsx          # 全域版型
│  ├─ globals.css         # 全域樣式 / 主題
│  └─ api/
│     ├─ health/route.ts       # 健康檢查
│     └─ sessions/route.ts     # 運動紀錄 CRUD
├─ components/            # 前端元件（鏡頭、圖表、熱力圖…）
├─ lib/                   # 運動偵測模型、語音、音效、成就
└─ db/
   ├─ index.ts            # Drizzle 連線
   └─ schema.ts           # 資料表定義
```

---

## 🚀 部署到 GitHub + Render

### A. 先推上 GitHub

在 VSCode 終端機（專案根目錄）依序執行：

```bash
git init
git add .
git commit -m "初次提交：AI 運動計數網站"
```

到 GitHub 建立一個新的 repository（例如 `ai-workout-counter`，**不要**勾選自動建立 README），
然後把本地專案連上去並推送（把網址換成你的）：

```bash
git branch -M main
git remote add origin https://github.com/你的帳號/ai-workout-counter.git
git push -u origin main
```

> ✅ `.env` 已被 `.gitignore` 排除，密碼不會外流。

### B. 在 Render 部署（用 Blueprint 一鍵建立）

本專案已內建 `render.yaml`，會自動幫你建立「Web 服務 + PostgreSQL 資料庫」。

1. 到 <https://render.com> 註冊 / 登入，並授權連結你的 GitHub。
2. 點 **New → Blueprint**。
3. 選擇你剛剛推上去的 repo。
4. Render 會讀取 `render.yaml`，顯示將建立：
   - 一個 PostgreSQL 資料庫 `workout-db`
   - 一個 Web 服務 `ai-workout-counter`
5. 按 **Apply** 開始部署。

Render 會自動：
- 執行 `npm install && npm run build`
- 啟動前先 `drizzle-kit push` 建立資料表
- 用 `/api/health` 做健康檢查
- 把資料庫連線字串（`DATABASE_URL`）自動注入 Web 服務

部署完成後，點 Web 服務的網址即可使用 🎉
（首次進入會請求鏡頭權限，Render 是 HTTPS，鏡頭可正常運作。）

### C. 之後要更新網站

只要把改動推上 GitHub，Render 會自動重新部署：

```bash
git add .
git commit -m "更新功能"
git push
```

### 手動部署（不使用 Blueprint 的替代方式）

若你想自己手動設定，而不用 `render.yaml`：

1. 先在 Render 建立一個 **PostgreSQL** 資料庫，複製它的 **Internal Database URL**。
2. 建立一個 **Web Service**，連到你的 repo，設定：
   - **Build Command**：`npm install && npm run build`
   - **Start Command**：`npx drizzle-kit push --force && npx next start -p $PORT`
   - **Health Check Path**：`/api/health`
   - **環境變數**：新增 `DATABASE_URL`＝剛剛複製的資料庫網址
     （若使用 External URL，另外加 `DATABASE_SSL=true`）

---

## 常見問題

**Q：`npx drizzle-kit push` 失敗 / 連不到資料庫？**
確認 PostgreSQL 正在執行、`app_db` 已建立，且 `.env` 的帳號密碼、埠號正確。

**Q：鏡頭打不開？**
確認網址是 `http://localhost:3000`（不要用區網 IP），並在瀏覽器允許鏡頭權限。

**Q：想改資料庫連線？**
同時修改 `.env` 的 `DATABASE_URL` 與 `drizzle.config.json` 內的 `url`。
