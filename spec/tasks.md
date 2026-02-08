---
name: english-conversation-assistant-tasks
description: English Conversation Assistant (ECA) 開發任務清單 — MVP 到 v2.0
version: 2.4
date: 2026-02-07
---

# English Conversation Assistant — Tasks v2.0

## 專案轉型說明

🔄 **重要**：本專案已從「代客協商」轉型為「英文對話助手」。

**原因**：OpenAI Realtime API 指令遵循率僅 30.5%，約 70% 機率偏離任務，無法可靠執行複雜協商任務。

**新方向**：用戶主導 + AI 輔助的英文對話工具
- 即時翻譯（對方英文 → 中文字幕）
- 講稿生成（用戶中文 → 英文講稿）
- Smart 建議（情境回應建議）
- Panic Button（緊急求助）

---

## 歷史 Milestones（已完成，保留參考）

### Milestone 0 — Spike（可行性驗證）✅ COMPLETED
- WebRTC 連線：1 秒內建立 ✅
- 雙向音訊：正常 ✅
- semantic_vad：正常 ✅
- 打斷功能：AI 立即停止說話 ✅

### Milestone 1 — 舊版核心流程 ✅ COMPLETED（已棄用）
- 設定頁表單 ✅
- 對話頁 UI ✅
- 狀態機骨架 ✅
- 文字控制器 ✅
- 誠實策略守門 ✅
- 停止條件處理 ✅

**注意**：M1 代碼可部分重用，但需要大幅修改以適應新設計。

---

## Milestone 2 — ECA MVP（核心功能）

🎯 **目標**：交付可用 MVP — 即時翻譯 + 通話前準備 + Quick Response Bar（Panic Button + 快捷短語）

### Phase 2.1 — 系統音訊捕獲與即時翻譯

**T2.1.0** ✅ **智能分段 + 並行翻譯系統**（COMPLETED 2026-02-02）
- ✅ 實作 `src/frontend/segment_store.js`（Segment + SegmentStore + EnhancedSegmentStore 類）
- ✅ 實作 `src/frontend/realtime_event_handler.js`（RealtimeEventHandler 類）
- ✅ 實作 `src/frontend/segment_renderer.js`（SegmentRenderer 類）
- ✅ 實作 `src/frontend/eca_parallel_test.html`（整合測試頁面）
- **並行處理**：
  - ✅ 雙向索引：item_id ↔ Segment, response_id → Segment
  - ✅ FIFO 隊列處理 response.created（因為它不包含 item_id）
  - ✅ 每個 Segment 獨立生命週期
  - ✅ 超時保護（30 秒）
  - ✅ 狀態機驗證（listening → transcribing → translating → done）
- **驗收結果**（2026-02-02 Regression Test）：
  - ✅ 3 段並行處理：新段落不阻塞舊段落翻譯
  - ✅ 翻譯結果正確對應（0% 錯配）
  - ✅ FIFO 隊列正確關聯 response_id → segment
  - ✅ UI 渲染正常（最新在上，狀態指示）
- **參考**：
  - `spec/design_parallel_translation.md`（完整實現規格）
  - `spec/design.md` 4.2-4.3 節（概念設計）
  - `spec/research/speech_segmentation.md`（人類說話習慣研究）
- **備註**：SmartSegmenter（分段邏輯）將在 T2.1.2 整合，目前使用 OpenAI semantic_vad 進行分段

**T2.1.1** ~~系統音訊捕獲 POC~~ ❌ REMOVED
- **移除原因**：主要使用場景（手機打電話 + 電腦輔助）用不到系統音訊捕獲
- **現有方案**：麥克風 + 擴音模式已足夠，且支援更廣泛（包括手機）
- **日期**：2026-02-04

**T2.1.2** ✅ **雙軌音訊架構**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`（整合頁面）
- ✅ **Web Speech API**：英文即時預覽（~100ms 延遲）
- ✅ **後端 API 翻譯**：`/api/translate/stream`（gpt-4.1-nano，~700ms 首字）
- ✅ 整合 SmartSegmenter 分段邏輯（5 種預設模式）
- ✅ 整合 SegmentStore 並行管理
- **驗收結果**（2026-02-06）：
  - ✅ 英文即時顯示（Web Speech API）
  - ✅ 翻譯正確對應每個段落
  - ✅ 方案 A 架構運作正常
- **備註**：實作於 `eca_parallel_test.html`，未遷移到 `app.js`（MVP 階段不需要）

**T2.1.3** ✅ **翻譯 UI 組件**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`（整合頁面）
- ✅ 雙欄顯示：英文原文 + 中文翻譯
- ✅ **段落狀態指示**：🎤聆聽中 → 📝轉錄中 → 🔄翻譯中 → ✅完成
- ✅ 最新段落在上（prepend）
- ✅ 自動滾動 + 歷史回看
- **驗收結果**（2026-02-06）：
  - ✅ 字幕清晰易讀（暗色主題）
  - ✅ 可回看歷史對話
  - ✅ 段落狀態正確顯示

### Phase 2.2 — 通話前準備模式（Pre-Call Preparation）

> **⚠️ 重新設計（2026-02-05）**：原 T2.2 「通話中打字輸入講稿」經分析不實用（5-10 秒沉默、無對話上下文），
> 重新定位為「通話前準備 + 通話中一鍵調用」。後端 API（`script_generator.py`、`POST /api/script/stream`）保留不變。
> 詳見 `spec/lessons_learned.md` §5.3。

**T2.2.1** ✅ 講稿生成 API（COMPLETED — 後端已完成，保留重用）
- `src/backend/script_generator.py` — 已實作
- `POST /api/script/stream` — 已實作（SSE 串流）
- 使用 `gpt-5-mini`（reasoning_effort="low"）
- **無需改動**

**T2.2.2** ✅ **通話前準備畫面**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`
- ✅ **場景選擇**：Bank / NHS / Utilities / Insurance / General 五個場景卡片
- ✅ **詞彙預覽**：選擇場景後顯示常用詞彙（靜態數據，`SCENARIOS` 物件）
- ✅ **講稿生成**：中文輸入框 → 調用 `POST /api/script/stream` → 顯示英文講稿
- ✅ **講稿保存**：生成的講稿可保存為「快捷卡片」（localStorage）
- ✅ **進入通話**：點擊「開始聆聽」→ 帶著已準備的卡片進入通話模式
- **驗收結果**（2026-02-06 DevTools 測試）：
  - ✅ 場景選擇正常
  - ✅ 中文輸入 → 英文講稿生成（SSE 串流）
  - ✅ 講稿可保存、可刪除
  - ✅ 保存的卡片在通話中可見

**T2.2.3** ✅ **Teleprompter 統一顯示組件**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`（`teleprompterOverlay`）
- ✅ 大字體顯示、高對比背景
- ✅ **統一輸出**：已準備的講稿、快捷短語、Panic 拖延語都輸出到此組件
- ✅ 點擊卡片/按鈕 → Teleprompter Overlay 大字顯示
- ✅ 點擊關閉按鈕或 ESC 鍵關閉
- **驗收結果**（2026-02-06 DevTools 測試）：
  - ✅ 通話中只需看一個地方
  - ✅ 英文 + 中文對照顯示
  - ✅ 字體清晰、易讀

### Phase 2.3 — Panic Button（整合到 Quick Response Bar）

> **⚠️ 重新設計（2026-02-05）**：Panic Button 不再是獨立浮動按鈕，
> 而是整合到 Quick Response Bar 的右下角。無 API 調用，純本地 < 300ms。

**T2.3.1** ✅ **Panic Button 整合**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`
- ✅ 紅色 🆘「求助」按鈕，位於 Quick Response Bar 右下角
- ✅ 點擊 → 立即在 Teleprompter 顯示一句拖延語（從 8 句中隨機選）
- ✅ **拖延語庫**（靜態數據，`STALLING_PHRASES` 陣列）：
  ```
  "Let me think about that for a moment..."
  "That's a good question. Give me a second..."
  "Could you hold on for just a second?"
  "I want to make sure I understand correctly..."
  "Let me just check something quickly..."
  "Hmm, let me consider that..."
  "I need a moment to think about this..."
  "That's interesting. Let me think..."
  ```
- ✅ 同時顯示用戶已準備的講稿供選擇
- **驗收結果**（2026-02-06 DevTools 測試）：
  - ✅ 點擊 → Teleprompter 顯示拖延語（< 300ms）
  - ✅ 無 API 調用、無網路依賴
  - ✅ 視覺顯眼（紅色）、位置易觸及
  - ✅ 同時顯示已準備的講稿卡片

**T2.3.2** ~~TTS 播放模組~~ → 移至 Phase 3（v1.5）
- **移後原因**：MVP 階段優先文字顯示，TTS 為增強功能
- TTS 播放（Web Speech Synthesis）將在 Smart 建議階段（Phase 3）一併實作

### Phase 2.4 — 快捷短語（整合到 Quick Response Bar）

> **⚠️ 重新設計（2026-02-05）**：快捷短語不再是獨立組件，
> 而是整合到 Quick Response Bar 中，與已準備的講稿和 Panic Button 並列。

**T2.4.1** ✅ **Quick Response Bar**（COMPLETED 2026-02-06）
- ✅ 實作於 `src/frontend/eca_parallel_test.html`（`quickResponseBar`）
- ✅ **取代通話中的 textarea**，改為一排可點擊的按鈕
- ✅ **上排**：用戶通話前準備的講稿卡片（來自 localStorage）
- ✅ **下排**：4 個預設快捷短語（`QUICK_PHRASES` 陣列）：
  | 中文 | 英文 |
  |------|------|
  | 請再說一次 | Could you repeat that, please? |
  | 請慢點說 | Could you speak more slowly? |
  | 我確認一下 | Let me confirm that... |
  | 謝謝再見 | Thank you. Goodbye. |
- ✅ **右下角**：🆘 Panic Button（見 T2.3.1）
- ✅ 點擊任意按鈕 → 在 Teleprompter 大字顯示
- **驗收結果**（2026-02-06 DevTools 測試）：
  - ✅ 通話中底部欄取代 textarea
  - ✅ 已準備的講稿正確顯示
  - ✅ 快捷短語一鍵即用（< 300ms）
  - ✅ 所有按鈕輸出到 Teleprompter

### Phase 2.5 — MVP 整合與測試

**T2.5.1** ✅ **主介面整合**（COMPLETED 2026-02-06）
- ✅ 所有組件已整合到 `src/frontend/eca_parallel_test.html`
- ✅ 響應式設計（桌面版）
- ✅ 暗色主題
- **驗收結果**（2026-02-06 DevTools 測試）：
  - ✅ 所有功能正常運作（場景選擇、講稿生成、通話模式、Quick Response Bar、Panic Button）
  - ⏳ 手機版待測試
- **備註**：MVP 使用 `eca_parallel_test.html` 作為主入口，後端路由 `/` 和 `/eca` 已指向此頁面

**T2.5.2** 🔄 端到端測試（IN PROGRESS）
- 2026-02-06 已用 Chrome DevTools MCP 完成基本功能測試
- 待完成：真實語音翻譯測試（需要麥克風輸入）
- 測試場景：
  - ✅ 講稿生成（API 測試通過）
  - ✅ Panic Button（本地功能測試通過）
  - ✅ 快捷短語（本地功能測試通過）
  - ⏳ 即時翻譯（需要真實語音測試）

**T2.5.3** 性能優化
- 待測量各功能延遲
- **預估性能**（基於開發測試）：
  - 翻譯首字回應：~700ms（gpt-4.1-nano）
  - 講稿生成首字回應：~1-2s（gpt-5-mini）
  - Panic Button 響應：< 100ms（本地）

### Phase 2.6 — 翻譯品質改良

> **新增（2026-02-07）**：基於 Swarm Mode 研究成果，實施翻譯品質改良。
> 參考：`spec/research/translation_quality_roadmap.md`

**T2.6.1** ✅ **場景詞庫整合**（COMPLETED 2026-02-07）
- ✅ 實作 `src/backend/glossary.py`（詞庫加載和查詢模組）
- ✅ 使用 `src/backend/domain_glossaries.json`（4 場景詞庫）
- ✅ 修改 `/api/translate/stream` 整合詞庫提示
- ✅ 前端傳遞 `scenario` 參數到翻譯 API
- **驗收結果**（2026-02-07）：
  - ✅ Bank 場景：direct debit → 直接付款授權
  - ✅ NHS 場景：surgery → 診所（非手術）
  - ✅ 詞庫提示自動注入翻譯 prompt

**T2.6.2** ✅ **翻譯驗證系統**（COMPLETED 2026-02-07）
- ✅ 實作 `src/frontend/translation_validator.js`
  - ✅ `NumberExtractor`：提取英文/中文數字
  - ✅ `ConfidenceScorer`：啟發式信心評分
  - ✅ `TranslationValidator`：綜合驗證
- ✅ 整合到 `eca_parallel_test.html`
- ✅ 翻譯完成後自動驗證
- ✅ 警告 UI 顯示（黃色邊框 + 警告文字）
- **驗收結果**（2026-02-07）：
  - ✅ 數字錯誤（£500→£50）正確檢測
  - ✅ 正確翻譯不觸發警告
  - ✅ 警告訊息清晰（「請對照英文原文」）

**T2.6.3** ✅ **數字保持規則**（COMPLETED 2026-02-07）
- ✅ 更新翻譯 prompt：所有數字保持阿拉伯數字
- ✅ 金額：£500 → £500（非五百英鎊）
- ✅ 日期：15th March → 3月15日（非三月十五日）
- ✅ 時間：2:30pm → 下午2:30
- ✅ 百分比、電話、參考編號保持原樣
- **驗收結果**（2026-02-07）：
  - ✅ 翻譯結果數字易於核對
  - ✅ 驗證器能準確比對

**T2.6.4** ✅ **UI/UX 改良**（COMPLETED 2026-02-07）
- ✅ 暫停/繼續/返回首頁按鈕（取代單一「結束通話」）
- ✅ 計時器暫停/繼續功能
- ✅ 實時英文預覽 Karaoke 效果（發光文字）
- ✅ 實時預覽單行顯示（展開可查看全部）
- ✅ 自動滾動至最新內容
- ✅ 狀態正確更新（已暫停、翻譯中、已停止）
- ✅ 第二次開始時清理舊數據

**T2.6.5** ✅ **場景預設講稿**（COMPLETED 2026-02-07）
- ✅ 後端 `script_generator.py` 新增 `DEFAULT_PROMPTS` 字典
  - 每個場景 5 個常用目的（查詢餘額、預約 GP、查帳單等）
- ✅ 新增 API `GET /api/script/scenarios` 和 `GET /api/script/scenarios/{scenario}`
- ✅ 前端「快速選擇常用目的」按鈕區
  - 選擇場景後自動顯示該場景的預設選項
  - 點擊按鈕 → 填入輸入框並自動生成講稿
- ✅ 空輸入時直接點「生成講稿」→ 使用場景預設
- ✅ Placeholder 根據場景動態更新
- **驗收結果**（2026-02-07）：
  - ✅ 5 個場景各有 5 個預設選項
  - ✅ 一鍵生成講稿（無需輸入）
  - ✅ 用戶可快速上手

### MVP 總體驗收

| 指標 | 目標 | 驗收方式 |
|------|------|---------|
| **智能分段延遲** | <800ms | 從停止說話到分段觸發 |
| **英文即時顯示** | <100ms | Web Speech API 本地處理 |
| **翻譯端到端延遲** | <1.5s | 從句子結束到翻譯顯示 |
| **並行翻譯正確率** | 100% | 翻譯結果正確對應段落 |
| 翻譯準確度 | >85% 用戶滿意 | 人工測試 10 句 |
| 講稿生成延遲 | <1.5s | 計時測量 |
| Panic Button 響應 | <300ms | 計時測量 |
| 手機版可用性 | 核心功能正常 | 手動測試 |

---

## Milestone 3 — ECA v1.5（增強功能）

🎯 **目標**：Smart 建議 + 場景預設 + 對話記錄

### Phase 3.1 — Smart 建議

**T3.1.1** 建議生成 API
- 實作 `src/backend/suggestion_generator.py`
- 實作 `POST /api/suggest` 端點
- Smart 觸發邏輯（問句、沉默等）
- **驗收**：
  - 情境相關的建議
  - 最多 3 個選項

**T3.1.2** 建議卡片 UI
- 實作 `src/frontend/components/SuggestionCards.js`
- 雙語顯示（英+中）
- 5 秒自動隱藏
- 點擊「用這個」→ 複製到 Teleprompter
- **驗收**：
  - 非侵入式顯示
  - 響應迅速

**T3.1.3** Smart 觸發整合
- 整合觸發邏輯到主應用
- 監聽轉錄內容，判斷是否顯示建議
- **驗收**：
  - 問句時自動顯示建議
  - 沉默 3 秒後顯示建議

### Phase 3.2 — 場景預設

**T3.2.1** 場景模板數據
- 實作 `src/frontend/scenario_presets.js`
- 4 個核心場景：bank、nhs、utilities、insurance
- 包含：常用詞彙、建議短語、語氣設定
- **驗收**：
  - 模板數據完整
  - 符合英國實際場景

**T3.2.2** 場景選擇 UI
- 實作 `src/frontend/components/ScenarioSelector.js`
- 卡片式選擇
- 預覽場景內容
- **驗收**：
  - 選擇後影響建議生成
  - 顯示場景專屬詞彙

### Phase 3.3 — 對話記錄

**T3.3.1** 記錄存儲
- 實作 `src/frontend/conversation_history.js`
- localStorage 存儲（MVP）
- 記錄：時間戳、原文、翻譯、講稿
- **驗收**：
  - 對話自動保存
  - 可查看歷史

**T3.3.2** 記錄瀏覽 UI
- 實作 `src/frontend/components/HistoryPanel.js`
- 時間線顯示
- 搜尋功能
- 匯出 JSON/Markdown
- **驗收**：
  - 可回顧過去對話
  - 匯出格式正確

---

## Milestone 4 — ECA v2.0（進階功能）

🎯 **目標**：桌面應用 + 信心指示 + 學習功能

### Phase 4.1 — 桌面應用 (Tauri)

**T4.1.1** Tauri 專案設置
- 初始化 Tauri v2 專案
- 整合現有前端代碼
- 系統音訊捕獲優化（桌面 API）
- **驗收**：
  - 桌面應用可運行
  - 系統音訊捕獲穩定

**T4.1.2** 桌面特有功能
- 全域快捷鍵（Panic Button）
- 系統托盤
- 開機啟動選項
- **驗收**：
  - 快捷鍵在任何應用中可用
  - 托盤常駐

### Phase 4.2 — 信心指示

**T4.2.1** 信心計算
- 修改翻譯 API，返回信心分數
- 基於：語音清晰度、詞彙識別率、語法完整度
- **驗收**：
  - 信心分數合理
  - 低信心時正確標記

**T4.2.2** 信心 UI
- 🟢 高信心（>0.8）
- 🟡 中信心（0.5-0.8）
- 🔴 低信心（<0.5）
- 低信心時顯示原文
- **驗收**：
  - 指示清晰易懂
  - 幫助用戶判斷可信度

### Phase 4.3 — 學習功能

**T4.3.1** 詞彙高亮
- 識別對話中的新詞彙
- 高亮顯示 + 解釋
- **驗收**：
  - 新詞彙被正確識別
  - 解釋有幫助

**T4.3.2** Flashcard 匯出
- 將新詞彙匯出為 Anki 格式
- 包含：詞彙、例句、翻譯
- **驗收**：
  - Anki 可成功匯入
  - 卡片格式正確

---

## 技術債務與優化

### 待清理項目

| 項目 | 位置 | 優先級 | 說明 |
|------|------|--------|------|
| 舊版 Controller | `src/backend/controller.py` | 中 | 重構為 script/suggest API |
| 舊版狀態機 | `src/frontend/state_machine.js` | 低 | 簡化為翻譯模式 |
| 舊版測試 | `src/tests/` | 中 | 更新為新功能測試 |
| 過時文件 | `spec/role_templates_v2.md` | 低 | 已標記 DEPRECATED |

### 性能優化目標

| 指標 | 當前 | 目標 | 方案 |
|------|------|------|------|
| 首次載入 | ~3s | <2s | 懶載入 |
| **分段延遲** | >1.5s | <800ms | SmartSegmenter 混合策略 |
| **英文即時顯示** | N/A | <100ms | Web Speech API |
| **翻譯端到端** | TBD | <1.5s | 並行處理 + 串流 |
| 講稿生成 | TBD | <1.5s | 快取常用 |
| 記憶體使用 | TBD | <200MB | 定期清理 |

---

## 量化指標

### MVP 指標

| 指標 | 目標 |
|------|------|
| 翻譯準確度 | >85% 用戶滿意 |
| 翻譯延遲 | <500ms |
| 講稿生成延遲 | <1.5s |
| Panic Button 響應 | <300ms |

### v1.0 指標

| 指標 | 目標 |
|------|------|
| 翻譯準確度 | >90% 用戶滿意 |
| 講稿採用率 | >60% |
| NPS | >50 |

### 商業指標（12 個月）

| 指標 | 目標 |
|------|------|
| 註冊用戶 | 20,000 |
| 付費轉換率 | 10% |
| 月活躍用戶 | 10,000 |
| MRR | £25,000 |

---

## 開發順序與進度

```
Phase 2.1 (即時翻譯) ─────────────────── ✅ COMPLETED (2026-02-06)
        ↓
Phase 2.2 (通話前準備模式) ──────────── ✅ COMPLETED (2026-02-06)
        ↓
Phase 2.3 + 2.4 (Quick Response Bar) ── ✅ COMPLETED (2026-02-06)
        ↓
Phase 2.5 (整合測試) ────────────────── 🔄 IN PROGRESS（真實語音測試待完成）
        ↓
Phase 2.6 (翻譯品質改良) ────────────── ✅ COMPLETED (2026-02-07)
        ↓
Phase 3.x (Smart 建議 + 場景 + TTS) ── 待開發（v1.5 增強）
        ↓
Phase 4.x (桌面應用 + 學習) ─────────── 待開發（v2.0 進階）
```

**MVP 完成度**: ~98%（剩餘：真實語音翻譯測試、手機版測試）

---

*最後更新：2026-02-07*
*版本：2.5*

### 更新日誌

| 版本 | 日期 | 變更 |
|------|------|------|
| 2.5 | 2026-02-07 | **翻譯品質改良**：新增 Phase 2.6（詞庫整合、翻譯驗證、數字規則、UI/UX 改良）；Swarm Mode 研究完成 |
| 2.4 | 2026-02-06 | **MVP 功能完成**：標記 T2.1.2, T2.1.3, T2.2.2, T2.2.3, T2.3.1, T2.4.1, T2.5.1 為已完成；DevTools 驗收測試通過 |
| 2.3 | 2026-02-05 | **T2.2 重新設計**：改為「通話前準備模式」；T2.3 Panic Button 整合到 Quick Response Bar；T2.4 快捷短語整合到 Quick Response Bar；TTS 移至 Phase 3 |
| 2.2 | 2026-02-03 | 完成 Test 21 修復：gpt-4.1-nano 翻譯、SmartSegmenter 5 預設模式、動態穩定性檢測 |
| 2.1 | 2026-02-01 | 新增 T2.1.0（智能分段 + 並行翻譯系統），更新 T2.1.2（雙軌音訊架構），更新驗收標準 |
| 2.0 | 2026-01-29 | 初始 ECA 任務清單 |
