# Synology NAS 方案 A 高效自動化部署操作指南

本手冊指導如何透過 **GitHub Actions 自動建置** 與 **Synology DSM Container Manager (Docker)** 高效運行 `triple-d-ballet-class`，徹底避免在 NAS 上編譯消耗運算資源與記憶體。

---

## 流程總覽架構

```mermaid
flowchart LR
    Dev[本機開發開發提交] -->|git push main| GHA[GitHub Actions Runner]
    subgraph GitHub 雲端環境 (免費 runner)
      GHA -->|編譯 Angular & FastAPI| Build[Docker Buildx linux/amd64]
      Build -->|發布 Image| GHCR[(GitHub Container Registry)]
    end
    subgraph Synology NAS 環境 (純拉取運行)
      GHCR -->|docker compose pull| CM[Container Manager]
      CM --> Backend[tdb-backend :8000]
      CM --> Frontend[tdb-frontend :8080]
      Backend <--> Data[(NAS 實體硬碟 /volume1/docker/triple-d-ballet/data)]
    end
    Client[用戶端 (iPad / 手機 / 瀏覽器)] -->|http://NAS_IP:8080| Frontend
```

---

## 第一步：GitHub 儲存庫與 Package 權限設定

1. **推送代碼至 GitHub**：
   ```bash
   git add .github/workflows/deploy.yml docker-compose.yml .env.example
   git commit -m "feat(ci): add GHCR build workflow and NAS compose setup"
   git push origin main
   ```
2. **確認 GitHub Actions 建置完成**：
   - 前往 GitHub 儲存庫的 **Actions** 分頁，確認 `Build and Push Docker Images to GHCR` 執行完畢（綠色勾勾）。
3. **設定 Package 公開權限（最簡化 NAS 拉取）**：
   - 進入 GitHub 個人首頁 -> **Packages** -> 找到 `tdb-frontend` 與 `tdb-backend`。
   - 點選進入 **Package settings** -> 最下方 **Danger Zone** -> **Change package visibility** -> 選擇 **Public**。
   - *(若保持 Private，需在 NAS 端執行 `docker login ghcr.io`，輸入 GitHub 帳號與具備 `read:packages` 權限的 Personal Access Token)*。

---

## 第二步：Synology NAS 目錄與資料夾準備

1. 開啟 Synology DSM **File Station**。
2. 進入 `docker` 共享資料夾（若無則手動建立），建立專案結構：
   ```
   /docker/
   └── triple-d-ballet/
       ├── docker-compose.yml
       ├── .env
       └── data/              <-- 用於存放 SQLite 資料庫
   ```
3. **設定資料夾權限（關鍵）**：
   - 右鍵點擊 `data` 資料夾 -> **內容** -> **權限**。
   - 新增 `Everyone` 或 `docker` 群組具備 **讀取與寫入** 權限，避免 SQLite 容器寫入時產生 `attempt to write a readonly database` 錯誤。

---

## 第三步：部署至 Synology Container Manager

### 方式 1：DSM 圖形介面操作（Container Manager，DSM 7.2+ 推薦）

1. 開啟 DSM 中的 **Container Manager** 套件。
2. 點選左側 **專案 (Project)** -> 點選 **新增 (Create)**。
3. 設定專案內容：
   - **專案名稱**：`triple-d-ballet`
   - **路徑**：選擇 `/docker/triple-d-ballet`
   - **來源**：選擇 **建立 docker-compose.yml**。
4. 將專案中的 [`docker-compose.yml`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/docker-compose.yml) 內容貼入文字編輯區。
5. 在同一畫面勾選「啟用環境變數檔」，並填入或建立 `.env`：
   ```bash
   IMAGE_REPO=<你的GitHub帳號或組織名>/triple-d-ballet-class
   IMAGE_TAG=latest
   FRONTEND_PORT=8080
   DATA_VOLUME_PATH=/volume1/docker/triple-d-ballet/data
   ```
6. 點選下一步，勾選「在專案建立完成後建置專案」，點擊完成。
7. Container Manager 將在數十秒內直接自 GHCR 下載最新映像檔並啟動所有容器！訪問網址即為 `http://<NAS_IP>:8080`。

---

### 方式 2：SSH 終端機指令（進階用戶）

透過 SSH 連線進入 Synology NAS：
```bash
cd /volume1/docker/triple-d-ballet

# 1. 建立 .env 檔案並設定好變數
cp .env.example .env
nano .env

# 2. 一鍵拉取最新映像檔並在背景啟動
docker compose pull
docker compose up -d
```

---

## 第四步：日常版本更新（兩種模式）

### 模式 A：手動一鍵更新
每當你在本地推新版本至 GitHub `main`，GitHub Actions 完成建置後，你只需在 NAS 執行：
- **Container Manager GUI**：至「專案」-> 對 `triple-d-ballet` 點右鍵 -> 點擊 **重組 (Build / Pull)**。
- **SSH 指令**：
  ```bash
  cd /volume1/docker/triple-d-ballet && docker compose pull && docker compose up -d
  ```

### 模式 B：完全自動化熱更新（Watchtower）
若希望連點擊都不用，啟動時開啟 watchtower profile：
```bash
docker compose --profile auto-update up -d
```
Watchtower 將在背景每 5 分鐘自動檢查 GHCR 是否有新版 image，若發現更新則自動平滑重啟前端與後端容器，實現無人值守自動部署！
