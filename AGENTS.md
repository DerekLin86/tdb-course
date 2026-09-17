# Agent Rulebook: Triple Dream Ballet (TDB)

本文件定義針對 `triple-d-ballet-class` 專案之 Agent 行為規範與 Brain 治理整合指南。

---

## 1. Central Brain Integration (@brain)

本專案全面受控於 Central Brain 單一真實數據源 (Single Source of Truth, SSOT)：
- **中央大腦根目錄**: `/Users/derek.lin/GIT_POOL/brain`
- **全域規則與生命週期**: [`/Users/derek.lin/GIT_POOL/brain/AGENTS.md`](file:///Users/derek.lin/GIT_POOL/brain/AGENTS.md)
- **技能與代理人索引**: [`/Users/derek.lin/GIT_POOL/brain/skills-index.md`](file:///Users/derek.lin/GIT_POOL/brain/skills-index.md)
- **專案檔案描述 (Profile)**: [`/Users/derek.lin/GIT_POOL/brain/projects/triple-d-ballet-class/profile.md`](file:///Users/derek.lin/GIT_POOL/brain/projects/triple-d-ballet-class/profile.md)
- **代理人交接協議**: [`/Users/derek.lin/GIT_POOL/brain/agents/AGENT_HANDOFF_PROTOCOL.md`](file:///Users/derek.lin/GIT_POOL/brain/agents/AGENT_HANDOFF_PROTOCOL.md)

### 架構導向查閱協議 (Architecture-First Lookup Protocol)
1. 任何後續 Agent 在進行功能擴充、修復或諮詢前，**必須優先讀取本專案之 [`ARCHITECTURE.md`](./ARCHITECTURE.md)** 作為架構地圖。
2. 透過 Module Map 與 Code Index 直接定位關鍵檔案，禁止無目的之全域盲目搜尋。
3. 嚴格遵守工作區隔離原則（嚴禁在下游專案任務期間擅自修改 `brain` 核心庫檔案）。

---

## 2. 專案開發與代碼規範 (Local Repository Rules)

### Frontend & Angular 規範
1. **元件範本分離**：每個元件一律將範本程式碼分離至獨立 `.html` 檔案，嚴禁於 `.ts` 內使用 inline template。
2. **Angular Signal 架構**：元件狀態流與屬性傳遞全面採用 Signal (`signal`, `computed`, `effect`, `input`, `output`)。
3. **型別抽離**：所有 Props 與業務介面統一定義於 `src/app/types/` 目錄。
4. **共用優先原則**：若有重複程式碼，優先使用 `src/app/components/` 之共用元件（如 `signature-pad`、`navbar`）。
5. **視覺風格一致性**：嚴格遵循 TDB 簡約高級感規範（安靜奢華 Quiet Luxury、煙燻玫瑰色 `#8e5b69`、冰霧藍灰環境漸層、大圓角懸浮白卡片），嚴禁使用花俏 Emoji 或高飽和度警示色。

---

## 3. 品質驗證閘門 (Validation Gate)

任何代碼變更在交付前，必須執行 PR 驗證指令並確保 100% 通過：

```bash
npm run validate:pr
```

- 包含：`ng build`（0 警告、0 錯誤）與 `ng test:ci`（單元測試全數 PASS）。

---

## 4. 推薦指派之專業子代理人 (Subagent Delegation)

- **前端代碼監督員**: `frontend-code-supervisor`（監督 Angular Signals、.html 分離與 SCSS 規範）。
- **品質驗證專案員**: `qa-validator`（執行 Karma 單元測試與 PR 品質驗證）。
- **架構分析員**: `software-analyst`（評估複雜新業務需求與資料合約擴充）。
