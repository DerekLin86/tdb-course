# Architecture Guide: Triple Dream Ballet (TDB)

本文件定義 `triple-d-ballet-class` 專案之架構原則、目錄模組劃分、邊界規則、核心業務邏輯與驗證閘門。
任何後續開發代理人（Agent）執行任務前，均須優先以此文件為單一架構依據。

---

## 1. System Overview

- **專案定位**：Triple Dream Ballet (TDB) 熟齡成人芭蕾課堂管理系統。核心提供教室現場 iPad 數位手寫簽名簽到台（模式 A）、學員手機端極簡 24 小時請假與票卡查詢、以及老師端場租防虧損開班門檻監控後台。
- **技術棧 (Tech Stack)**：
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
├── src/
│   ├── app/
│   │   ├── types/                  # 全域資料合約與型別定義 (SSOT)
│   │   │   ├── student.type.ts     # 學員與 5/10 堂票卡資料結構
│   │   │   ├── attendance.type.ts  # 課堂、出勤紀錄、財務損益指標型別
│   │   │   └── signature-pad.type.ts # 手寫簽名板配置介面
│   │   ├── services/               # 核心業務邏輯與狀態流
│   │   │   └── ballet-state.service.ts # 基於 Signal 的狀態管理器，整合 LocalStorage
│   │   ├── components/             # 可重用 UI 元件
│   │   │   ├── navbar/             # TDB 極簡頂部導覽與時鐘控制器
│   │   │   └── signature-pad/      # 具備高 DPI、防手勢誤觸之平滑手寫畫布
│   │   ├── pages/                  # 三大核心業務路由
│   │   │   ├── kiosk/              # 教室門口 iPad 手寫簽名簽到台 (模式 A)
│   │   │   ├── student/            # 學員手機端 (LINE 友善免密碼請假與查堂)
│   │   │   └── admin/              # 老師管理後台 (場租防虧門檻、簽名存根、儲值)
│   │   ├── app.component.ts/.html/.scss
│   │   ├── app.routes.ts
│   │   └── app.config.ts
│   ├── styles.scss                 # 全域 Design Tokens 與基底重置樣式
│   └── main.ts
├── ARCHITECTURE.md                 # 專案架構索引地圖 (本文件)
├── AGENTS.md                       # 本地 Agent 行為規範與 Brain 串接指南
└── package.json
```

---

## 3. Boundary & Coding Rules

1. **Angular Signals 架構**：
   - 狀態管理全面使用 `signal` 與 `computed`。
   - 元件 Inputs/Outputs 一律使用 Signal APIs：`input()`, `input.required()`, `output()`。
2. **範本與樣式獨立原則**：
   - 每個元件必須將 HTML 統整至獨立 `.html` 檔案，嚴禁在 `.ts` 內使用 inline template。
   - 每個元件樣式一律使用獨立 `.scss` 檔案。
3. **資料型別集中管理**：
   - 元件間傳遞之 Props 與物件模型，一律於 `src/app/types/` 定義介面，禁止於元件內宣告臨時 any 或重複型別。
4. **防虧損核心業務規則**：
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
  1. `npm run build`：全域 Angular 生產模式打包，必須維持 **0 Errors, 0 Warnings**。
  2. `npm run test:ci`：Karma + ChromeHeadless 自動化單元測試，全數案例通過 (**100% SUCCESS**)。

---

## 5. Code Index

| 功能 / 概念 | 對應檔案路徑 |
| :--- | :--- |
| **全域 Design Tokens & 樣式** | [`src/styles.scss`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/styles.scss) |
| **路由設定** | [`src/app/app.routes.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/app.routes.ts) |
| **學員與票卡型別** | [`src/app/types/student.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/types/student.type.ts) |
| **出勤、課堂與損益型別** | [`src/app/types/attendance.type.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/types/attendance.type.ts) |
| **狀態流與業務核心服務** | [`src/app/services/ballet-state.service.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/services/ballet-state.service.ts) |
| **手寫簽名板元件** | [`src/app/components/signature-pad/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/components/signature-pad/) |
| **TDB 極簡導覽列** | [`src/app/components/navbar/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/components/navbar/) |
| **教室門口 iPad 簽到台** | [`src/app/pages/kiosk/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/pages/kiosk/) |
| **學員手機請假端** | [`src/app/pages/student/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/pages/student/) |
| **老師管理與損益後台** | [`src/app/pages/admin/`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/pages/admin/) |
| **單元測試套件** | [`src/app/services/ballet-state.service.spec.ts`](file:///Users/derek.lin/GIT_POOL/triple-d-ballet-class/src/app/services/ballet-state.service.spec.ts) |
