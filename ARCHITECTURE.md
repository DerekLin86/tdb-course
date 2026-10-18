# Architecture Guide: Triple Dream Ballet (TDB)

本文件定義 `triple-d-ballet-class` 專案之架構原則、目錄模組劃分、邊界規則、核心業務邏輯與驗證閘門。
任何後續開發代理人（Agent）執行任務前，均須優先以此文件為單一架構依據。

---

## 1. System Overview

- **專案定位**：Triple Dream Ballet (TDB) 熟齡成人芭蕾課堂管理系統。核心提供教室現場 iPad 數位手寫簽名簽到台（模式 A）、老師端課程管理與場租防虧損開班門檻監控、以及學生名冊與票卡效期歷程管理。
- **架構模式**：Nx Monorepo (`apps/` 應用外殼與 `libs/` 模組化領域庫)。
- **技術棧 (Tech Stack)**：
  - **Monorepo 工具**：Nx 20.4+
  - **前端框架**：Angular 20+ (Standalone Components, Angular Signals)
  - **後端框架**：Python FastAPI (RESTful API, Pydantic v2, SQLite WAL 持久化，Dev/Prod 資料庫隔離與生產環境重置防護)
  - **語言**：TypeScript 5.6+ / Python 3.13+
  - **樣式**：SCSS（全域變數與 Design Tokens）
  - **繪圖**：HTML5 Canvas 原生手寫貝茲平滑畫布 (Signature Pad)
  - **測試**：Jasmine + Karma + ChromeHeadless (前端) / Pytest (後端)
- **視覺規範 (Visual Aesthetics)**：
  - **風格定位**：TDB 簡約高級感（Quiet Luxury / Modern Elegance）。
  - **背景**：靈動冰霧藍灰環境漸層 `radial-gradient(circle at 50% 18%, #f0f4f9 0%, #e3eaf2 55%, #d8e2ed 100%)`。
  - **主色調 (Primary)**：煙燻乾燥玫瑰色（Dusty Mauve `--primary: #8e5b69`，Hover `--primary-hover: #784855`）。
  - **文字色**：深冷石墨藍 `--text-title: #263342`、沉穩霧灰 `--text-body: #546474`。
  - **核心卡片**：大圓角白色純淨懸浮卡片 (`border-radius: 28px~32px`, 柔和無邊界擴散陰影)。
  - **規範禁止**：嚴格禁止隨意插入刺眼表情符號 (Emoji)、亮粉紅色虛線邊框或高飽和度警示色。

---

## 2. Directory Layout & Module Map

```
triple-d-ballet-class/
├── apps/
│   ├── api/                         # 後端應用 (Python FastAPI + SQLite)
│   │   ├── main.py                  # FastAPI 主程式、CORS、Routers 掛載
│   │   ├── database.py              # Dev/Prod WAL 資料庫連線、環境解析與生產防護 (seed/reset guardrails)
│   │   ├── models/                  # SQLAlchemy / SQLite 資料模型
│   │   ├── schemas/                 # Pydantic v2 CamelCase 序列化合約
│   │   ├── routers/                 # RESTful 端點 (students, sessions, attendance, system)
│   │   ├── services/                # 業務邏輯 (24h 請假、堂數扣抵、場租損益、簽名存根)
│   │   ├── tests/                   # Pytest 自動化整合與對抗性測試
│   │   └── project.json             # Nx 專案目標 (api:test)
│   └── triple-d-ballet-class/       # 前端應用外殼 (Shell Application)
│       ├── src/
│       │   ├── app/
│       │   │   ├── app.component.ts/.html/.scss
│       │   │   ├── app.routes.ts    # 路由定義 (Lazy load @libs/ballet/feature)
│       │   │   └── app.config.ts    # provideHttpClient(withFetch())
│       │   ├── styles.scss          # 全域 Design Tokens 與主題變數
│       │   └── main.ts
│       └── project.json
├── libs/
│   ├── ballet/
│   │   ├── data-access/             # [type:data-access, scope:ballet]
│   │   │   ├── src/
│   │   │   │   ├── lib/
│   │   │   │   │   ├── types/       # 全域資料合約 (Student, Attendance, Signature, Api)
│   │   │   │   │   └── services/    # BalletStateService, BalletApiService
│   │   │   │   └── index.ts         # 唯一對外導出進入點 (@libs/ballet/data-access)
│   │   │   └── project.json
│   │   └── feature/                 # [type:feature, scope:ballet]
│   │       ├── src/
│   │       │   ├── lib/
│   │       │   │   ├── kiosk/       # iPad 簽到台元件 (模式 A 手寫簽名)
│   │       │   │   └── admin/       # 老師端管理元件
│   │       │   │       ├── session-management/  # 課程管理與場租損益監控
│   │       │   │       └── student-management/  # 學生名冊與票卡效期歷程
│   │       │   └── index.ts         # 唯一對外導出進入點 (@libs/ballet/feature)
│   │       └── project.json
│   └── shared/
│       └── ui/                      # [type:ui, scope:shared]
│           ├── src/
│           │   ├── lib/
│           │   │   └── components/
│           │   │       ├── navbar/          # TDB 極簡導覽列與即時時鐘
│           │   │       └── signature-pad/   # 貝茲曲線高平滑手寫簽名板
│           │   └── index.ts         # 唯一對外導出進入點 (@libs/shared/ui)
│           └── project.json
├── nx.json                          # Nx 設定 (defaultBase: main, useDaemonProcess: false)
├── tsconfig.base.json               # Nx 路徑別名映射 (@libs/...)
├── ARCHITECTURE.md                  # 專案架構索引地圖 (本文件)
├── AGENTS.md                        # 本地 Agent 行為規範與 Brain 串接指南
└── package.json
```

---

## 3. Boundary & Coding Rules

1. **Nx Monorepo 依賴邊界規範**：
   - 所有跨模組參照一律使用 `tsconfig.base.json` 的路徑別名：
     - `@libs/ballet/data-access`
     - `@libs/shared/ui`
     - `@libs/ballet/feature`
   - 嚴禁越界使用相對路徑跨庫參照（例如 `../../libs/shared/ui`）。
   - 庫標籤 (Tags) 約束：
     - `ballet-data-access`: `type:data-access`, `scope:ballet`
     - `shared-ui`: `type:ui`, `scope:shared`（可被所有 scope 庫或應用參照）
     - `ballet-feature`: `type:feature`, `scope:ballet`（只供 ballet 應用與路由載入）
2. **Angular Signals 架構**：
   - 狀態管理全面使用 `signal` 與 `computed`。
   - 元件 Inputs/Outputs 一律使用 Signal APIs：`input()`, `input.required()`, `output()`。
3. **範本與樣式獨立原則**：
   - 每個元件必須將 HTML 統整至獨立 `.html` 檔案，嚴禁在 `.ts` 內使用 inline template。
   - 每個元件樣式一律使用獨立 `.scss` 檔案。
4. **資料型別集中管理**：
   - 資料模型一律集中於 `libs/ballet/data-access/src/types/` 定義介面，禁止於元件內宣告臨時 any 或重複型別。
5. **防虧損核心業務規則**：
   - **24 小時截止線**：距開課時間 $\ge 24$ 小時請假，出勤狀態為 `leave_advance`，扣抵堂數為 0；不足 24 小時請假，狀態為 `leave_late`，強制扣抵 1 堂以攤提固定場租。
   - **損益平衡門檻**：每堂課固定場租為 \$2,000，每人每堂收費折合 \$500，最低開班人數門檻為 4 人。當實到人數 $< 4$ 時，系統自動觸發虧損警報，支援老師一鍵順延停課並退還扣堂。
   - **手寫簽名存根**：學員於 iPad 簽到時必須手繪簽名，生成 Base64 PNG 永久綁定該課堂出勤紀錄，供老師後台調閱防範堂數爭議。

### 資料庫環境分流與產品化防護機制 (Database Environment & Safety Guardrails)

- **環境切分 (Environment Isolation)**：
  - `ENVIRONMENT=development`：預設資料庫為 `data/triple_d_ballet.dev.db`，資料庫為空時自動注入 10 筆示範學員，允許呼叫 `/system/reset` 進行重置測試。
  - `ENVIRONMENT=production`：預設資料庫為 `data/triple_d_ballet.prod.db`，僅執行 `Base.metadata.create_all()` 建立資料表結構，嚴格禁止自動注入 Mock 資料。
- **生產安全防護 (Production Guardrails)**：
  - `init_db()`：生產模式下跳過 `seed_mock_data()`。
  - `reset_db()`：生產模式下直接拋出 `RuntimeError`。
  - `POST /api/v1/system/reset`：生產模式下回傳 `HTTP 403 Forbidden`，防止誤刪正式資料。

---

## 4. Verification & Quality Gates

所有程式碼變更在提交或合併前，均須通過以下本地驗證指令：

```bash
npm run validate:pr
```

- **驗證項目**：
  1. `npm run build` (`nx build triple-d-ballet-class`)：全域生產模式打包，維持 **0 Errors, 0 Warnings**。
  2. `npm run test:ci` (`nx run-many -t test --watch=false --browsers=ChromeHeadless`)：全專案自動化單元測試全數通過 (**100% SUCCESS**)。

---

## 5. Code Index

| 功能 / 概念 | 對應檔案路徑 |
| :--- | :--- |
| **全域 Design Tokens & 樣式** | [`apps/triple-d-ballet-class/src/styles.scss`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/triple-d-ballet-class/src/styles.scss) |
| **路由設定** | [`apps/triple-d-ballet-class/src/app/app.routes.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/triple-d-ballet-class/src/app/app.routes.ts) |
| **學員與票卡型別** | [`libs/ballet/data-access/src/lib/types/student.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/types/student.type.ts) |
| **出勤、課堂與損益型別** | [`libs/ballet/data-access/src/lib/types/attendance.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/types/attendance.type.ts) |
| **手寫簽名板設定型別** | [`libs/ballet/data-access/src/lib/types/signature-pad.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/types/signature-pad.type.ts) |
| **API 介面資料型別合約** | [`libs/ballet/data-access/src/lib/types/api.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/types/api.type.ts) |
| **狀態流與業務核心服務** | [`libs/ballet/data-access/src/lib/services/ballet-state.service.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/services/ballet-state.service.ts) |
| **前端 HTTP API Client** | [`libs/ballet/data-access/src/lib/services/ballet-api.service.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/services/ballet-api.service.ts) |
| **資料存取層狀態單元測試** | [`libs/ballet/data-access/src/lib/services/ballet-state.service.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/services/ballet-state.service.spec.ts) |
| **資料存取層 API 單元測試** | [`libs/ballet/data-access/src/lib/services/ballet-api.service.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/lib/services/ballet-api.service.spec.ts) |
| **手寫簽名板 UI 元件** | [`libs/shared/ui/src/lib/components/signature-pad/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/lib/components/signature-pad/) |
| **簽名板元件單元測試** | [`libs/shared/ui/src/lib/components/signature-pad/signature-pad.component.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/lib/components/signature-pad/signature-pad.component.spec.ts) |
| **TDB 極簡導覽列 UI** | [`libs/shared/ui/src/lib/components/navbar/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/lib/components/navbar/) |
| **教室門口 iPad 簽到台** | [`libs/ballet/feature/src/lib/kiosk/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/lib/kiosk/) |
| **老師端課程管理** | [`libs/ballet/feature/src/lib/admin/session-management/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/lib/admin/session-management/) |
| **老師端學生管理** | [`libs/ballet/feature/src/lib/admin/student-management/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/lib/admin/student-management/) |
| **後端 FastAPI 主程式** | [`apps/api/main.py`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/main.py) |
| **後端 SQLite 資料庫連線與環境防護** | [`apps/api/database.py`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/database.py) |
| **期班學員註冊關聯模型** | [`apps/api/models/course_enrollment.py`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/models/course_enrollment.py) |
| **期班學員註冊 Pydantic Schema** | [`apps/api/schemas/course_enrollment.py`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/schemas/course_enrollment.py) |
| **後端 RESTful 路由群組** | [`apps/api/routers/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/routers/) |
| **後端業務邏輯服務** | [`apps/api/services/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/services/) |
| **後端 Pytest 整合測試** | [`apps/api/tests/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/tests/) |

---

## 6. Responsive Breakpoint System

Triple Dream Ballet 專案針對教室 iPad 現場與學員/老師手機端實施 3 層響應式版面規範：

| 裝置視區 (Viewport) | 媒體查詢範圍 (Media Query) | 版面模式與設計準則 |
| :--- | :--- | :--- |
| **Mobile (手機端)** | `max-width: 767px` | 單欄堆疊流、底部固定 Tab 導覽列 (`--bottom-tabbar-height: 60px`)、避開安全區域 (Safe Area) |
| **Tablet (平板端 / iPad)** | `min-width: 768px` and `max-width: 1024px` | iPad 教室簽到台模式、雙欄並排網格、頂部精簡導覽列 |
| **Desktop (桌面端)** | `min-width: 1025px` | 完整老師管理後台、多欄儀表板、完整頂部導覽列 |

### Safe Area 與動態視窗高度規範
1. **Dynamic Viewport Height**: 手機全螢幕頁面一律使用 `min-height: 100vh; min-height: 100dvh;` 避免行動瀏覽器網址列伸縮裁切。
2. **Safe Area Insets**: 使用環境變數 Token (`--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right`)。
3. **懸浮與覆蓋元件安全定位**: 手機端懸浮提示（如 `.toast-card`）或固定操作列，底部距離必須計入底部導覽列與 Home Bar 安全區：
   ```scss
   bottom: calc(var(--safe-bottom, 0px) + var(--bottom-tabbar-height, 60px) + 1rem);
   ```

---

## 7. Database Auto-Migration & Schema Evolution Guide for Agents

本系統採用輕量零相依（Zero-Dependency）的資料庫自動遷移機制，確保開發與生產環境在持續迭代時皆能實現平滑無痛演進（Zero Downtime & Zero Data Loss）。所有維護或擴充資料模型的 Agent 須嚴格遵守以下準則：

### 7.1 Auto-Migration Mechanism (自動遷移機制)

- **啟動自動檢查**：在 [`apps/api/database.py`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/apps/api/database.py) 中，`Metadata.create_all(bind=engine)` 於每次應用程式啟動 (`init_db()`) 時自動執行。
- **欄位差異探測**：針對已存在的資料表，系統透過 `PRAGMA table_info({tablename})` 動態查詢 SQLite 底層現有欄位清單。
- **自動補齊缺漏欄位**：若 Python ORM 類別（`_columns`）宣告的欄位不存在於現有 SQLite 資料表中，系統自動發出：
  ```sql
  ALTER TABLE {tablename} ADD COLUMN {col_name} {sqlite_type};
  ```
- **資料完整性保證**：既有資料表中的所有資料行（Rows）100% 完整保留，不需中斷服務，亦不破壞現有業務資料。

### 7.2 Agent SOP: Adding a New Column to an Existing Model (擴充既有資料表欄位 SOP)

當業務需求需要為既有實體新增屬性時，Agent 須遵循以下三步驟：

1. **Step 1: 更新 ORM Model**
   在 `apps/api/models/<model_name>.py` 中加入新屬性：
   ```python
   new_field = Column(String(), nullable=True, default=None)
   # 或數值型別：
   # count_field = Column(Integer(), nullable=True, default=0)
   ```
   > [!IMPORTANT]
   > **SQLite 限制約束規則**：SQLite 的 `ALTER TABLE ADD COLUMN` 語法要求新增欄位**必須為 `nullable=True` 或具備常數預設值 (`default=...`)**，絕對不可設定為「沒有預設值的 `NOT NULL`」。Agent 在擴充欄位時必須嚴格遵守此規則。

2. **Step 2: 更新 Pydantic Schemas**
   在 `apps/api/schemas/<model_name>.py` 中的 Request / Response Schema 加入新欄位定義，維持 camelCase 序列化合約（使用 `Field(default=..., alias="camelCaseName")` 或專案約定命名規則）。

3. **Step 3: 完成並重啟**
   修改完成！後端應用重啟（無論在本地 Dev 還是生產環境 Docker 容器）時，`init_db()` 會執行 `Metadata.create_all()`，自動探測到新欄位並下達 `ALTER TABLE`。**Agent 無須手寫任何 SQL 遷移腳本，嚴格禁止刪除或重建資料表！**

### 7.3 Agent SOP: Adding a New Table (新增資料表 SOP)

當業務需求需要建立全新資料表時：

1. 定義繼承自 `Base` 的新模型類別，並明確宣告 `__tablename__ = "table_name"`。
2. 確保該模型類別在 `apps/api/database.py` 的 `init_db()` 或 `apps/api/models/__init__.py` 中被引入（Import），以觸發 `Metadata.register()`。
3. 下次系統啟動時，`Metadata.create_all()` 透過 `CREATE TABLE IF NOT EXISTS` 自動建立全新實體資料表。

### 7.4 Production Data Protection Rule for Agents (生產資料防護規則)

- **嚴禁破壞性操作**：在生產環境（`ENVIRONMENT=production`）下，Agent **絕不可**呼叫 `reset_db()` 或執行任何 `DROP TABLE` 破壞性操作。
- **重置端點防護**：`POST /api/v1/system/reset` 於生產環境已內建攔截並一律回傳 `403 Forbidden`，防止任何自動化任務或外部請求誤刪正式營運數據。

### 7.5 Agent SOP: Safe Relational Migration (期班名冊關聯平滑回填 SOP)

當系統架構從「學員與單堂課綁定」演進升級為「學員與期班課程綁定 (`CourseEnrollment`)」時：

1. **冪等回填保證 (`backfill_course_enrollments`)**：
   - 於 `apps/api/database.py` 中實現自動回填函式，系統啟動時由 `init_db()` 自動執行。
   - 透過 `INSERT INTO course_enrollments ... SELECT ... FROM attendance_records a JOIN class_sessions s ... WHERE NOT EXISTS (...)` 語法，將既有出勤紀錄之學員自動補齊為期班註冊。
2. **生產環境零停機、零資料遺失**：
   - 不修改亦不刪除任何既有 `attendance_records` 資料行。
   - 所有歷史手寫簽名 Base64 圖檔、請假申請理由、扣堂紀錄與時間戳記 100% 完整保留。
   - 若學員自期班移出名冊，僅清理尚未履約之 `registered`（待簽到）課堂，已簽名出席或請假之歷史紀錄永不遺失。

