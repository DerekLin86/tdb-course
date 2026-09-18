# Original User Request

## 2026-09-18T04:06:16Z

為 `triple-d-ballet-class` 芭蕾課堂管理系統建置生產級 Python FastAPI 後端服務（位於 `apps/api`）與 SQLite 持久化資料庫，並將現有 Angular 前端狀態服務無縫串接至後端 API，實現出缺勤、手寫簽名存根保存、24 小時請假防虧損規則與票卡堂數管理。

Working directory: /Users/derek.lin/GIT_POOL/triple-d-ballet-class
Integrity mode: demo

## Requirements

### R1. 後端持久化 API 服務 (apps/api)
- 在 `apps/api` 建立 Python FastAPI 應用程式，使用 SQLite 作為持久化資料庫。
- 實作完整 RESTful API 端點，支援：
  - 學員資料與購票票卡管理（購票 5 堂 / 10 堂、效期檢查、剩餘堂數扣抵與充值）。
  - 課堂出缺勤管理與模式 A 數位簽到（儲存並調閱高畫質手寫簽名 Base64 存根）。
  - 24 小時防虧損請假計算邏輯（開課 24 小時前請假不扣堂，不足 24 小時請假扣抵 1 堂）。
  - 課堂損益平衡指標統計（固定場租 $2,000，每人每堂 $500，4 人開班門檻警報）。
- 具備跨來源資源共用 (CORS) 支援（允許前端 `http://localhost:4200` 存取），並提供自動化 API 文件（Swagger / OpenAPI）。

### R2. 前端 Angular 資料存取整合
- 擴充 `@libs/ballet/data-access` 的資料存取層，提供 HTTP 客戶端服務與後端 API 對接，支援即時狀態更新與遠端持久化。
- 確保現有 iPad 簽到台 (`/kiosk`)、學員手機端 (`/student`) 與老師管理後台 (`/admin`) 元件流暢運作，無破壞性變更。

### R3. 自動化測試與品質驗證
- 為後端建置完整的自動化測試套件（如 pytest），涵蓋所有 API 端點、業務邊界條件（24h 截止時間判定、堂數扣抵與退款、4 人損益門檻）與異常處理。
- 前端維持現有單元測試與建置閘門 100% 通過（`npm run validate:pr`）。

## Acceptance Criteria

### API 功能與業務邏輯驗證
- [ ] FastAPI 服務可於本地正確啟動，OpenAPI (`/docs`) 正常載入且無 schema 錯誤
- [ ] 學員 24 小時前請假與不足 24 小時請假之扣堂邏輯經自動化測試驗證正確無誤
- [ ] 模式 A iPad 手寫簽名 Base64 資料能完整持久化儲存並於管理後台正確調閱
- [ ] 課堂損益計算與 4 人門檻警報資料計算符合業務合約

### 前端整合與品質驗證
- [ ] 前端應用程式可透過 API 正常讀取與更新學員、票卡、出勤與簽名資料
- [ ] 執行 `npm run validate:pr` 通過（`nx build triple-d-ballet-class` 0 警告 0 錯誤，且全數單元測試 100% 通過）
- [ ] 後端自動化測試套件執行全數 PASS，無遺漏之核心端點測試
