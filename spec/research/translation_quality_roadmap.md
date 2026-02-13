# Translation Quality Improvement Roadmap

## Executive Summary

基於 Swarm Mode 研究成果，本文件整合三個改良方向的設計方案，提供實施路線圖。

### 研究成果總覽

| 研究項目 | 研究員 | 狀態 | 輸出文件 |
|---------|--------|------|---------|
| UK 領域詞庫 | team-lead | ✅ 完成 | `uk_domain_glossaries.json` |
| 數字/日期驗證 | validation-researcher | ✅ 完成 | `translation_validation_design.md` |
| 低信心檢測 | confidence-researcher | ✅ 完成 | `translation_validation_design.md` |
| 詞庫整合設計 | team-lead | ✅ 完成 | `glossary_integration_design.md` |
| 驗證系統設計 | team-lead | ✅ 完成 | `translation_validation_design.md` |

---

## Implementation Phases

### Phase 1: Glossary Integration (P0 - Critical)

**目標**：讓場景選擇實際影響翻譯品質

**範圍**：
- 在翻譯 API 加入 glossary hint
- 前端傳遞 scenario 參數
- 關鍵術語後處理

**文件**：
- 創建 `src/backend/glossary.py` - 詞庫加載和查詢
- 修改 `src/backend/main.py` - 整合詞庫到翻譯流程
- 修改 `src/frontend/eca.html` - 傳遞 scenario

**工作量估計**：1 Workstream

**驗證**：
- 銀行場景翻譯「direct debit」為「自動轉賬」
- NHS 場景翻譯「surgery」為「診所」而非「手術」

---

### Phase 2: Number Validation (P0 - Critical)

**目標**：檢測數字/金額翻譯錯誤，顯示警告

**範圍**：
- 創建前端 TranslationValidator 類
- 數字提取（英文和中文）
- 比對驗證邏輯
- UI 警告顯示

**文件**：
- 創建 `src/frontend/translation_validator.js` - 驗證邏輯
- 修改 `src/frontend/eca.html` - UI 整合

**工作量估計**：1 Workstream

**驗證**：
- 輸入「£500」翻譯為「£50」時顯示警告
- 正常翻譯不顯示警告

---

### Phase 3: Confidence Scoring (P1 - Important)

**目標**：檢測低品質翻譯，提示用戶核對原文

**範圍**：
- 啟發式信心評分（長度比例、未翻譯檢測、AI 失敗語句）
- 整合到 TranslationValidator
- 信心等級 UI 顯示

**文件**：
- 更新 `src/frontend/translation_validator.js` - 添加 ConfidenceScorer
- 更新 `src/frontend/eca.html` - 信心 UI

**工作量估計**：0.5 Workstream

**驗證**：
- 翻譯失敗時顯示「請對照英文原文」
- 正常翻譯顯示高信心

---

### Phase 4: Logprobs Integration (P2 - Nice to Have)

**目標**：使用模型置信度提高準確性

**範圍**：
- 後端啟用 logprobs
- 前端解析 token 置信度
- 整合到信心評分

**文件**：
- 修改 `src/backend/main.py` - 啟用 logprobs
- 更新 `src/frontend/translation_validator.js` - 處理 logprobs

**工作量估計**：0.5 Workstream

**前置條件**：Phase 3 完成

---

## Implementation Order

```
Week 1: Phase 1 (Glossary) + Phase 2 (Validation) 並行
        ├── Glossary: backend + frontend
        └── Validation: frontend only

Week 2: Phase 3 (Confidence) + Testing
        ├── Confidence scoring
        └── End-to-end testing

Future: Phase 4 (Logprobs) 視需求
```

---

## New Files to Create

| 文件 | 用途 | Phase |
|------|------|-------|
| `src/backend/glossary.py` | 詞庫加載和查詢 | 1 |
| `src/frontend/translation_validator.js` | 驗證和信心評分 | 2, 3 |
| `spec/research/uk_domain_glossaries.json` | 詞庫數據 | 1 (已創建) |

---

## Files to Modify

| 文件 | 修改內容 | Phase |
|------|---------|-------|
| `src/backend/main.py` | 整合詞庫，可選 logprobs | 1, 4 |
| `src/frontend/eca.html` | 傳遞 scenario，顯示警告 UI | 1, 2, 3 |

---

## API Changes

### `/api/translate/stream` 參數更新

| 參數 | 類型 | 必填 | 說明 | Phase |
|------|------|------|------|-------|
| text | string | ✅ | 要翻譯的英文 | 現有 |
| scenario | string | ❌ | 場景（bank, nhs, utilities, insurance, general） | 1 |

### 響應格式更新（streaming）

```javascript
// 現有格式
{"text": "翻譯文字", "done": false}
{"text": "", "done": true}

// Phase 4 新增（可選）
{"text": "翻譯文字", "done": false, "logprob": -0.5}
```

---

## UI Changes Summary

### Translation Entry Component

```html
<!-- Before -->
<div class="translation-entry">
  <div class="entry-english">The balance is £500</div>
  <div class="entry-chinese">餘額是 £50</div>
</div>

<!-- After (with validation) -->
<div class="translation-entry" data-confidence="low">
  <div class="entry-english">The balance is £500</div>
  <div class="entry-chinese">餘額是 £50</div>
  <div class="validation-warning">
    ⚠️ 數字可能有誤，請對照英文原文
  </div>
</div>
```

### CSS Classes to Add

```css
.translation-entry[data-confidence="low"] { border-left: 3px solid orange; }
.translation-entry[data-confidence="medium"] { border-left: 3px solid yellow; }
.validation-warning { background: rgba(255, 170, 0, 0.1); }
```

---

## Success Metrics

| 指標 | 目標 | 測量方式 |
|------|------|---------|
| 術語翻譯準確率 | >95% | 測試用例通過率 |
| 數字驗證召回率 | >90% | 人工標註測試集 |
| 誤報率 | <10% | 正常翻譯誤報次數 |
| 延遲增加 | <100ms | 端到端延遲測量 |

---

## Risks and Mitigations

| 風險 | 影響 | 緩解措施 |
|------|------|---------|
| 詞庫過大增加延遲 | Medium | 只載入當前場景詞庫 |
| 驗證誤報干擾用戶 | High | 設置高閾值，只警告高信心問題 |
| 中文數字解析錯誤 | Medium | 完善正則，添加測試用例 |

---

## Tasks for Implementation

### Workstream A: Glossary Integration

- [ ] A.1: 創建 `glossary.py` 模組
- [ ] A.2: 修改 `main.py` 整合詞庫
- [ ] A.3: 前端傳遞 scenario 參數
- [ ] A.4: 添加測試用例

### Workstream B: Validation System

- [ ] B.1: 創建 `translation_validator.js`
- [ ] B.2: 實現數字提取（英文）
- [ ] B.3: 實現數字提取（中文，含中文數字）
- [ ] B.4: 實現比對邏輯
- [ ] B.5: 實現信心評分
- [ ] B.6: UI 警告顯示
- [ ] B.7: 添加測試用例

---

## Appendix: Research Documents

1. `spec/research/uk_domain_glossaries.json` - 領域詞庫數據
2. `spec/research/glossary_integration_design.md` - 詞庫整合設計
3. `spec/research/translation_validation_design.md` - 驗證系統設計

---

*Roadmap 完成日期：2026-02-06*
*研究團隊：team-lead, glossary-researcher, validation-researcher, confidence-researcher*
