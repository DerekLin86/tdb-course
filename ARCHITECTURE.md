# Architecture Guide: Triple Dream Ballet (TDB)

本文件定義 `triple-d-ballet-class` 專案之架構原則、目錄模組劃分、邊界規則、核心業務邏輯與驗證閘門。
任何後續開發代理人（Agent）執行任務前，均須優先以此文件為單一架構依據。

---

## 1. System Overview

- **專案定位**：Triple Dream Ballet (TDB) 熟齡成人芭蕾課堂管理系統。核心提供教室現場 iPad 數位手寫簽名簽到台（模式 A）、學員手機端極簡 24 小時請假與票卡查詢、以及老師端場租防虧損開班門檻監控後台。
- **架構模式**：Nx Monorepo (`apps/` 應用外殼與 `libs/` 模組化領域庫)。
- **技術棧 (Tech Stack)**：
  - **Monorepo 工具**：Nx 20.4+
  - **框架**：Angular 20+ (Standalone Components, Angular Signals)
  - **語言**：TypeScript 5.6+
  - **樣式**：SCSS（全域變數與 Design Tokens）
  - **繪圖**：HTML5 Canvas 原生手寫貝茲平滑畫布 (Signature Pad)
  - **測試**：Jasmine + Karma + ChromeHeadless
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
│   └── triple-d-ballet-class/       # 應用程式外殼 (Shell Application)
│       ├── src/
│       │   ├── app/
│       │   │   ├── app.component.ts/.html/.scss
│       │   │   ├── app.routes.ts    # 路由定義 (Lazy load @libs/ballet/feature)
│       │   │   └── app.config.ts
│       │   ├── styles.scss          # 全域 Design Tokens 與主題變數
│       │   └── main.ts
│       └── project.json
├── libs/
│   ├── ballet/
│   │   ├── data-access/             # [type:data-access, scope:ballet]
│   │   │   ├── src/
│   │   │   │   ├── types/           # 全域資料合約 (Student, Attendance, Signature)
│   │   │   │   ├── services/        # BalletStateService (Signals + LocalStorage)
│   │   │   │   └── index.ts         # 唯一對外導出進入點 (@libs/ballet/data-access)
│   │   │   └── project.json
│   │   └── feature/                 # [type:feature, scope:ballet]
│   │       ├── src/
│   │       │   ├── kiosk/           # iPad 簽到台元件 (模式 A 手寫簽名)
│   │       │   ├── student/         # 學員手機端請假查堂元件
│   │       │   ├── admin/           # 老師管理後台元件 (門檻警報與簽名存根)
│   │       │   └── index.ts         # 唯一對外導出進入點 (@libs/ballet/feature)
│   │       └── project.json
│   └── shared/
│       └── ui/                      # [type:ui, scope:shared]
│           ├── src/
│           │   ├── navbar/          # TDB 極簡導覽列與即時時鐘
│           │   ├── signature-pad/   # 貝茲曲線高平滑手寫簽名板
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
| **學員與票卡型別** | [`libs/ballet/data-access/src/types/student.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/types/student.type.ts) |
| **出勤、課堂與損益型別** | [`libs/ballet/data-access/src/types/attendance.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/types/attendance.type.ts) |
| **手寫簽名板設定型別** | [`libs/ballet/data-access/src/types/signature-pad.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/types/signature-pad.type.ts) |
| **狀態流與業務核心服務** | [`libs/ballet/data-access/src/services/ballet-state.service.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/services/ballet-state.service.ts) |
| **手寫簽名板 UI 元件** | [`libs/shared/ui/src/signature-pad/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/signature-pad/) |
| **TDB 極簡導覽列 UI** | [`libs/shared/ui/src/navbar/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/navbar/) |
| **教室門口 iPad 簽到台** | [`libs/ballet/feature/src/kiosk/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/kiosk/) |
| **學員手機請假端** | [`libs/ballet/feature/src/student/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/student/) |
| **老師管理與損益後台** | [`libs/ballet/feature/src/admin/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/feature/src/admin/) |
| **資料存取層單元測試** | [`libs/ballet/data-access/src/services/ballet-state.service.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/ballet/data-access/src/services/ballet-state.service.spec.ts) |
| **簽名板元件單元測試** | [`libs/shared/ui/src/signature-pad/signature-pad.component.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/libs/shared/ui/src/signature-pad/signature-pad.component.spec.ts) |
