---

name: voice-proxy-negotiator-tasks
description: 端到端落地任務清單（milestones、實作步驟、測試與驗收、量化評分方法），供 Kiro 逐項完成。
-----------------------------------------------------------------

# Voice Proxy Negotiator — Tasks

## Milestone 0 — Spike（可行性最小驗證） ✅ COMPLETED

🔎 先驗證「可打斷 + 可續接 + 低延遲」三件事，通過後才進入完整產品化。

**完成日期**：2026-01-26
**驗收結果**：
- WebRTC 連線：1 秒內建立 ✅
- 雙向音訊：正常 ✅
- semantic_vad：speech_started/stopped 正常 ✅
- 打斷功能：AI 立即停止說話 ✅

### 前置任務（Pre-tasks）
**T0.0** ✅ 模型 ID 確認與環境設定
- 執行 `curl https://api.openai.com/v1/models` 確認可用模型 ID
- 驗證 `gpt-realtime-mini` 和 `gpt-5-mini` 的可用性
- 創建 `.env.example` 並配置 `OPENAI_API_KEY`
- 創建目錄結構（按 `design.md` § 1.1）
- **驗收**：
  - 已確認並記錄實際 Realtime 模型 ID（`gpt-realtime-mini`）
  - 已確認並記錄文字控制器模型 ID（`gpt-5-mini`）
  - `.env.example` 已創建

**T0.1** ✅ 建立最小 WebRTC Realtime 連線並可收/播音訊
- 實作 `src/spike/backend_token.py`（FastAPI，生成 ephemeral token）
  - 調用 `POST https://api.openai.com/v1/realtime/client_secrets`
  - 使用模型：`gpt-realtime-mini-2025-12-15`
  - 參考：[Client secrets | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions)
- 實作 `src/spike/realtime_test.html`（WebRTC 初始化、音訊輸入/輸出）
- 實作 `/api/token` 端點（參考 `design.md` § 9）
  - 返回 `client_secret`（格式：`ek_1234...`）
  - TTL：10 分鐘（OpenAI 默認值）
- **驗收**：
  - 啟動後端：`C:\Users\adam\anaconda3\envs\adamlab4_env\python.exe src/spike/backend_token.py`
  - 瀏覽器打開 `realtime_test.html`，可聽到 Realtime 回應
  - 驗證 token 在 10 分鐘後過期

**T0.2** ✅ 實作 interruptions：`response.cancel` + `output_audio_buffer.clear` ([OpenAI Platform][5])
- 在 `realtime_test.html` 中實作打斷邏輯
- 觀察對方打斷行為（手動測試）
- **驗收**：
  - 對方開口時代理能停止輸出

**T0.3** ✅ 加入 `conversation.item.truncate`，確保上下文不殘留「未被聽到」的 assistant 內容 ([OpenAI Platform][5])
- 追蹤客戶端播放進度（`audio_end_ms`）
- 實作 truncate 邏輯
- **驗收**：
  - 打斷後上下文正確同步

**T0.4** ✅ 設定 `semantic_vad` + `interrupt_response`，測試 10 次打斷成功率 ([OpenAI Platform][2])
- 在 `session.update` 中配置 VAD 參數
- 手動測試 10 次打斷場景
- **驗收**：
  - 打斷成功率 ≥ 8/10（主觀可接受）
  - 打斷後可自然續接（不重複長段落、不尷尬停滯）

## Milestone 1 — v1 核心流程（設定 → 對話 → 達標/停止）

🔎 交付可用 mock-up：設定頁、對話頁、按鈕指令、停止條件、最小記憶治理。

**T1.1** 設定頁表單 ✅ COMPLETED (UI 部分)
- 實作 `src/frontend/setup_page.html`（Goal、Rules、SSOT、Stop conditions、按鈕配置）
- 實作 SSOT 長度驗證（最多 5,000 字元，顯示字符計數）（參考 `requirements.md` § 5.1）
- 實作 SSOT token 估算與自動摘要（參考 `design.md` § 4.2）：
  - 使用 `token_estimator.js` 估算 SSOT tokens
  - 如 > 1,500 tokens，自動調用 `/api/summarize_ssot` 壓縮
  - 顯示原始 tokens / 摘要後 tokens
- 實作按鈕映射表配置（繁中顯示文字 ↔ 英文 Directive ID）（參考 `requirements.md` § 5.2）
  - v1 使用默認映射（9 個按鈕）
  - 存儲到 sessionStorage（參考 `design.md` § 5）
- 實作 voice 選擇下拉框（選項：marin, cedar；鎖定在 INIT）
- **驗收**：
  - 瀏覽器打開 `setup_page.html`，填寫表單，檢查驗證規則
  - 貼入 > 5,000 字元的 SSOT，驗證提示錯誤
  - 貼入 > 1,500 tokens 的 SSOT，驗證自動摘要
- **完成日期**：2026-01-26
- **完成內容**：
  - 表單所有欄位（Goal、Rules、SSOT、Stop Conditions、Voice）
  - 字符計數即時更新
  - Token 估算（簡化公式：中文字 x2 + 英文詞 x1.3）
  - SSOT > 5000 字元錯誤顯示
  - sessionStorage 存儲 vpn_config
  - 頁面跳轉到 conversation_page.html
- **待後續 Batch 完成**：SSOT 自動摘要需後端 `/api/summarize_ssot` API

**T1.2** 對話頁 ✅ COMPLETED
- 實作 `src/frontend/conversation_page.html`（Push-to-start、狀態顯示、按鈕列、緊急停止）
- 實作 `src/frontend/styles.css`（繁體中文字體：Noto Sans TC / Microsoft JhengHei）
- 實作按鈕列（9 個按鈕，繁中文字）
- **驗收**：
  - 瀏覽器打開 `conversation_page.html`，檢查 UI 布局與按鈕點擊響應
- **完成日期**：2026-01-26
- **完成內容**：
  - 連線狀態顯示（connected/disconnected/connecting）
  - 當前狀態顯示（INIT/LISTENING/THINKING/SPEAKING/CHECKPOINT/STOPPING/STOPPED）
  - 麥克風/播放狀態指示器（帶動畫）
  - 任務目標顯示區
  - 3x3 按鈕列（同意/不同意/我需要時間考慮/請重複一次/提出替代方案/詢問對方底線/是時候說再見/達標/立即停止）
  - 「立即停止」按鈕紅色警示樣式
  - 「達標」按鈕綠色樣式
  - 事件日誌區域（支援 info/success/error/warn/event 顏色）
  - 按鈕點擊 console.log 響應
  - 載入 sessionStorage 設定並顯示
  - 暗色主題樣式（與 spike/realtime_test.html 一致）

**T1.3** App 狀態機骨架 ✅ COMPLETED
- 實作 `src/frontend/state_machine.js`（INIT/LISTENING/THINKING/SPEAKING/CHECKPOINT/STOPPING/STOPPED）
- 實作狀態轉換邏輯與驗證
- 創建單元測試：`src/tests/test_state_machine.js`
- **驗收**：
  - 執行測試：`node src/tests/test_state_machine.js`
  - 驗證非法狀態轉換會被阻止
- **完成日期**：2026-01-26
- **完成內容**：
  - `src/frontend/state_machine.js` - StateMachine 類別
    - VALID_TRANSITIONS 定義所有合法狀態轉換
    - `canTransition()`: 檢查轉換是否有效
    - `transition()`: 執行狀態轉換並通知監聽器
    - `onTransition()`: 註冊狀態變化回調
    - `reset()`: 重置為 INIT 狀態
  - `src/tests/test_state_machine.js` - 48 個測試
    - 有效轉換序列測試
    - 無效轉換拒絕測試
    - 監聽器回調測試
    - 錯誤處理測試
    - Reset 功能測試
  - 測試結果：48 passed

**T1.4** 文字控制器（gpt-5-mini） ✅ COMPLETED
- 實作 `src/backend/controller.py`（調用 Responses API）
  - 使用模型：`gpt-5-mini-2025-08-07`
  - API 端點：`POST https://api.openai.com/v1/responses`
  - 參考：[Responses | OpenAI API Reference](https://platform.openai.com/docs/api-reference/responses)
  - 使用 `previous_response_id` 模式（無狀態）（參考 `design.md` § 5）
- 實作 `src/backend/prompt_templates.py`（Controller instruction 模板）
- 實作功能：
  - `generate_next_utterance()`：生成下一句短句 plan（1–2 句）
  - `update_memory()`：更新 Rolling Summary（目標長度 ≤ 1,000 tokens）
  - `judge_goal_met()`：判定達標與否
- 實作 fail-soft JSON 解析（解析失敗時 best-effort 提取）
- 實作調用時機邏輯（參考 `design.md` § 5）：
  - 觸發時機 A：用戶按按鈕
  - 觸發時機 B：每 5 輪或 token 達 70%
  - 不觸發：正常對話流（Realtime 自主回應）
- 實作後端 API 端點：`POST /api/controller`（參考 `design.md` § 1.1）
  - 請求包含：directive, pinned_context, memory, latest_turns（最近 3 輪）
  - 響應包含：decision, next_english_utterance, memory_update, notes_for_user
- 實作後端 API 端點：`POST /api/summarize_ssot`（參考 `design.md` § 4.2）
- 創建單元測試：`src/tests/test_controller.py`（Mock OpenAI Responses API）
- **驗收**：
  - 執行測試：`python -m pytest src/tests/test_controller.py -v`
  - 驗證 JSON 解析失敗時不崩潰
  - 驗證 `previous_response_id` 正確傳遞
- **完成日期**：2026-01-26
- **完成內容**：
  - `src/backend/controller.py` - 完整 Controller 邏輯
  - `src/backend/prompt_templates.py` - CONTROLLER_INSTRUCTION, SSOT_SUMMARIZE_INSTRUCTION 模板
  - `src/backend/models.py` - Pydantic 資料模型（ControllerRequest/Response, SummarizeSsotRequest/Response）
  - `src/backend/main.py` - FastAPI 應用（/api/token, /api/controller, /api/summarize_ssot）
  - `src/tests/test_controller.py` - 27 個測試（Mock API, fail-soft parsing, token estimation）
  - fail-soft JSON 解析：3 層策略（直接解析 → regex 提取 → best-effort）
  - `previous_response_id` 正確傳遞
  - 測試結果：27 passed

**T1.5** 誠實策略守門 ✅ COMPLETED
- 修改 `src/backend/prompt_templates.py`：加入「不虛構」規則
- 修改 `src/backend/controller.py`：檢測「I don't know」類回應，記錄到 `notes_for_user`
- **驗收**：
  - 人工測試：對方問 SSOT 中沒有的問題，驗證代理是否誠實回應
- **完成日期**：2026-01-26
- **完成內容**：
  - CONTROLLER_INSTRUCTION 已包含「NEVER fabricate facts」規則
  - `detect_honesty_response()` 函數：檢測 17 種誠實表達短語
  - 短語清單：i don't know, i'm not sure, let me check, let me find out, i'll need to verify, i can't confirm, i'm uncertain, i need to look into, i'll get back to you, that's outside my knowledge, i don't have that information 等
  - 檢測後添加繁中提示到 notes_for_user：「提示：AI 表示不確定此資訊，請人工確認或提供更多資料」
  - 8 個測試案例全部通過
  - 測試結果：35 passed（含原有 27 + 新增 8）

**T1.6** 停止條件處理 ✅ COMPLETED
- 實作 `src/frontend/app.js` 中的停止邏輯：
  - `handleHardStop()`：立即 cancel + clear（參考 `design.md` § 6）
  - `handleSoftStop()`：注入 goodbye 指令，播放後結束
- 實作衝突解決邏輯（參考 `design.md` § 6）：
  - 用戶按「達標」但 Controller 判定「未達標」：以用戶為準，顯示警告
  - Controller 判定「達標」但用戶未按按鈕：彈出提示，需用戶確認
- **驗收**：
  - 手動測試：按「立即停止」，驗證立即切斷
  - 手動測試：按「是時候說再見」，驗證播放 goodbye 後結束
  - 手動測試：衝突場景，驗證提示正確顯示
- **完成日期**：2026-01-26
- **完成內容**：
  - `src/frontend/app.js` - VoiceProxyApp 類別（完整應用邏輯）
    - WebRTC 連線整合（基於 spike）
    - StateMachine 整合
    - `handleHardStop()`: response.cancel + output_audio_buffer.clear + truncate
    - `handleSoftStop()`: 注入 goodbye 後等待播放完成再斷線
    - `_handleControllerDecision()`: 衝突解決邏輯
    - `_checkControllerTrigger()`: 5 輪/70% token 觸發 Controller
    - `_injectUtterance()`: 注入 Controller 建議的英文回應
  - `src/tests/test_app.js` - 測試（初始化, 設定載入, 狀態機整合, Token 估算, Controller 觸發, 指令處理, Reset）
  - 更新 `conversation_page.html` 整合 app.js
  - 測試結果：55 passed

**總體驗收（Milestone 1）**：
* 連續完成 3 組「對方↔代理」往返（不少於 6 turns）
* 用戶按按鈕能改變下一句策略方向
* 達標/停止能可靠結束
* 無按鈕時延遲 < 1s，按按鈕後延遲可接受 2–3s

## Milestone 2 — Context Window 壓力與 UX

🔎 交付 progress bar（估算 token 壓力）、摘要壓縮策略、session 60 分鐘限制提示與重連策略。

**T2.1** Token 估算 + Progress Bar UI
- 實作 `src/frontend/token_estimator.js`
  - **v1 策略**：使用簡化估算公式（快速實作）
    - 中文字：每個字 ≈ 2 tokens
    - 英文詞：每個詞 ≈ 1.3 tokens（split by space）
    - 標點符號：忽略
  - **v2 升級**：使用 `tiktoken` WASM（精準但需額外依賴）
    - CDN：`https://cdn.jsdelivr.net/npm/tiktoken`
    - 或 npm：`npm install tiktoken`
- 實作 `src/frontend/progress_bar.js`（可視化組件）
- 修改 `src/frontend/conversation_page.html`：加入 progress bar UI
- 顯示內容：
  - Pinned Context tokens（固定）
  - Rolling Summary tokens（會變）
  - Recent turns tokens（滑動窗，最近 3 輪）
  - 預留回應 buffer（10–20%）
- 顯示警戒線（70%）與顏色變化：
  - 綠色（< 50%）
  - 黃色（50-70%）
  - 紅色（> 70%）
- 標示「估算值」（音訊 token 未精準計算，簡化公式有誤差）
- **驗收**：
  - 對話過程中 progress bar 即時更新
  - 超過 70% 時顏色變為紅色
  - 估算誤差在 ±20% 以內（手動抽檢 5 段對話）

**T2.2** Rolling Summary 壓縮節奏
- 修改 `src/backend/controller.py`：在 `update_memory()` 中檢查 token 超過 70% 時觸發壓縮
- 實作壓縮策略：保留已承諾/未承諾、對方條件、未解問題、下一步策略
- 創建集成測試：`src/tests/test_compression.py`（模擬 20 輪對話）
- **驗收**：
  - 執行測試：`python src/tests/test_compression.py`
  - 驗證摘要壓縮後不失焦（核心目標仍保留）

**T2.3** Session 60 分鐘限制與 Token 續期
- 實作 `src/frontend/session_manager.js`（參考 `design.md` § 8、§ 9）
- 實作雙層計時器：
  - **Token 續期**（10 分鐘 TTL）：
    - 8 分鐘時：背景請求新 token（預留 2 分鐘緩衝）
    - 更新 WebRTC session（無縫續接，用戶無感知）
  - **Session 重連**（60 分鐘上限）：
    - 55 分鐘時：UI 提示「對話即將超時，系統將在 5 分鐘後自動重連」
    - 58 分鐘時：注入 system message「Please wrap up current topic in 1-2 sentences.」
- 實作重連流程：
  1. 保存上下文（Pinned + Rolling + 最近 3 輪）
  2. 關閉舊 session（注入提示、cancel + close WebRTC）
  3. 建立新 session（請求新 token、注入上下文）
  4. 用戶通知（「✅ 重連成功，對話繼續」）
- 實作失敗回退（3 次重試後下載對話記錄 JSON/Markdown）
- **驗收**：
  - 手動測試：修改計時器為 30 秒（token）/ 2 分鐘（session）加速測試
  - 驗證 8 分鐘時自動續期 token，對話不中斷
  - 驗證 55/58 分鐘時提示顯示
  - 驗證 60 分鐘時重連成功
  - 驗證重連失敗時下載對話記錄

**T2.4** Voice 鎖定檢查
- 修改 `src/frontend/setup_page.html`：voice 選擇在表單階段
- 修改 `src/frontend/app.js`：在 INIT 階段鎖定 voice，之後不可更改
- 實作檢查：如果嘗試在輸出後改 voice，顯示錯誤
- **驗收**：
  - 手動測試：對話開始後嘗試改 voice，驗證錯誤提示

**總體驗收（Milestone 2）**：
* 超過警戒線會觸發壓縮，且不失焦
* 接近 60 分鐘時能提示並可續接（至少完成一次重連演練）
* Progress bar 顯示準確且即時更新

## Milestone 3 — 測試、量化評分與可交付驗收包

🔎 以「可重播測試腳本 + 指標表」量化成功率，支援是否進一步投入開發的決策。

### T3.1 三方互動測試框架（3-Party Simulation Test）
- 實作 `src/tests/simulation/run_simulation.js`（測試執行器）
- 實作 `src/tests/simulation/simulator.js`（三方互動模擬器）
- 實作 `src/tests/simulation/evaluator.js`（評估器）
- 創建場景庫 `src/tests/simulation/scenarios/`：
  - `gas_report.json` - 煤氣味報告（zh-TW）
  - `discount_negotiation.json` - 折扣談判（en）
  - `complaint.json` - 投訴（zh-CN）
  - `interview.json` - 面試（ja）
  - `service_provider.json` - 角色反轉（en）
  - `unknown_info.json` - 誠實策略測試（zh-TW）
- 實作後端 API：`POST /api/simulate`（參考 `design.md` § 9.6）
- 實作命令行介面（參考 `design.md` § 9.7）
- **驗收**：
  - 執行測試：`node src/tests/simulation/run_simulation.js`
  - 所有預設場景通過
  - 輸出人類可讀報告
  - 輸出 JSON 格式報告（可供後續分析）

### T3.2 量化指標儀表板
- 實作 `src/tests/simulation/metrics.js`（指標計算）
- 計算指標：
  - 身份正確率（Identity Accuracy）：≥ 95%
  - 目標推進率（Goal Progress Rate）：≥ 80%
  - 按鈕響應率（Button Responsiveness）：≥ 90%
  - 任務完成率（Task Completion Rate）：≥ 70%
  - 誠實率（Honesty Rate）：100%
- 實作報告生成：`reports/simulation_report.json`、`reports/simulation_report.md`
- **驗收**：
  - 執行測試後生成指標報告
  - 指標達標判定正確

### 量化指標（v1 建議）

* M1 打斷成功率：`#success_interrupt / #attempts`
* M2 打斷反應時間（主觀等級）：1–5
* M3 達標率（在固定腳本下）：`#goal_met / #runs`
* M4 用戶可控性：按鈕介入後「策略方向符合」比例
* M5 誠實率：未知問題場景中無捏造（人工抽檢）
* **M6 身份正確率**：AI 保持 I 角色不混淆
* **M7 目標推進率**：對話推進至 Goal 關鍵詞

### 測試方法

* ~~腳本式對話（由測試人員扮演對方）~~ **改為自動化三方 LLM 互動測試**
* 每個場景包含：預設對話流程、用戶按鈕介入點、成功判定條件
* 每次 run 輸出：對話記錄、每輪評估、指標統計、總評

**驗收**：

* 指標達到 Milestone 0/1/2 的門檻
* 生成一份「是否值得做 v2」結論（以指標為依據）
* **三方互動測試全場景通過**

---