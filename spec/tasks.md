---

name: voice-proxy-negotiator-tasks
description: 端到端落地任務清單（milestones、實作步驟、測試與驗收、量化評分方法），供 Kiro 逐項完成。
-----------------------------------------------------------------

# Voice Proxy Negotiator — Tasks

## Milestone 0 — Spike（可行性最小驗證）

🔎 先驗證「可打斷 + 可續接 + 低延遲」三件事，通過後才進入完整產品化。

### 前置任務（Pre-tasks）
**T0.0** 模型 ID 確認與環境設定
- 執行 `curl https://api.openai.com/v1/models` 確認可用模型 ID
- 驗證 `gpt-realtime-mini` 和 `gpt-5-mini` 的可用性
- 創建 `.env.example` 並配置 `OPENAI_API_KEY`
- 創建目錄結構（按 `design.md` § 1.1）
- **驗收**：
  - 已確認並記錄實際 Realtime 模型 ID（`gpt-realtime-mini`）
  - 已確認並記錄文字控制器模型 ID（`gpt-5-mini`）
  - `.env.example` 已創建

**T0.1** 建立最小 WebRTC Realtime 連線並可收/播音訊
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

**T0.2** 實作 interruptions：`response.cancel` + `output_audio_buffer.clear` ([OpenAI Platform][5])
- 在 `realtime_test.html` 中實作打斷邏輯
- 觀察對方打斷行為（手動測試）
- **驗收**：
  - 對方開口時代理能停止輸出

**T0.3** 加入 `conversation.item.truncate`，確保上下文不殘留「未被聽到」的 assistant 內容 ([OpenAI Platform][5])
- 追蹤客戶端播放進度（`audio_end_ms`）
- 實作 truncate 邏輯
- **驗收**：
  - 打斷後上下文正確同步

**T0.4** 設定 `semantic_vad` + `interrupt_response`，測試 10 次打斷成功率 ([OpenAI Platform][2])
- 在 `session.update` 中配置 VAD 參數
- 手動測試 10 次打斷場景
- **驗收**：
  - 打斷成功率 ≥ 8/10（主觀可接受）
  - 打斷後可自然續接（不重複長段落、不尷尬停滯）

## Milestone 1 — v1 核心流程（設定 → 對話 → 達標/停止）

🔎 交付可用 mock-up：設定頁、對話頁、按鈕指令、停止條件、最小記憶治理。

**T1.1** 設定頁表單
- 實作 `src/frontend/setup_page.html`（Goal、Rules、SSOT、Stop conditions、Magic word、按鈕配置）
- 實作 SSOT 長度驗證（最多 5,000 字元，顯示字符計數）（參考 `requirements.md` § 5.1）
- 實作 SSOT token 估算與自動摘要（參考 `design.md` § 4.2）：
  - 使用 `token_estimator.js` 估算 SSOT tokens
  - 如 > 1,500 tokens，自動調用 `/api/summarize_ssot` 壓縮
  - 顯示原始 tokens / 摘要後 tokens
- 實作按鈕映射表配置（繁中顯示文字 ↔ 英文 Directive ID）（參考 `requirements.md` § 5.2）
  - v1 使用默認映射（9 個按鈕）
  - 存儲到 sessionStorage（參考 `design.md` § 5）
- 實作 voice 選擇下拉框（選項：marin, cedar；鎖定在 INIT）
- 實作 Magic Word 輸入框（支援多個，逗號分隔）（參考 `design.md` § 6）
- **驗收**：
  - 瀏覽器打開 `setup_page.html`，填寫表單，檢查驗證規則
  - 貼入 > 5,000 字元的 SSOT，驗證提示錯誤
  - 貼入 > 1,500 tokens 的 SSOT，驗證自動摘要

**T1.2** 對話頁
- 實作 `src/frontend/conversation_page.html`（Push-to-start、狀態顯示、按鈕列、緊急停止）
- 實作 `src/frontend/styles.css`（繁體中文字體：Noto Sans TC / Microsoft JhengHei）
- 實作按鈕列（9 個按鈕，繁中文字）
- **驗收**：
  - 瀏覽器打開 `conversation_page.html`，檢查 UI 布局與按鈕點擊響應

**T1.3** App 狀態機骨架
- 實作 `src/frontend/state_machine.js`（INIT/LISTENING/THINKING/SPEAKING/CHECKPOINT/STOPPING/STOPPED）
- 實作狀態轉換邏輯與驗證
- 創建單元測試：`src/tests/test_state_machine.js`
- **驗收**：
  - 執行測試：`node src/tests/test_state_machine.js`（或瀏覽器端測試）
  - 驗證非法狀態轉換會被阻止

**T1.4** 文字控制器（gpt-5-mini）
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
  - 執行測試：`C:\Users\adam\anaconda3\envs\adamlab4_env\python.exe src/tests/test_controller.py`
  - 驗證 JSON 解析失敗時不崩潰
  - 驗證 `previous_response_id` 正確傳遞

**T1.5** 誠實策略守門
- 修改 `src/backend/prompt_templates.py`：加入「不虛構」規則
- 修改 `src/backend/controller.py`：檢測「I don't know」類回應，記錄到 `notes_for_user`
- **驗收**：
  - 人工測試：對方問 SSOT 中沒有的問題，驗證代理是否誠實回應

**T1.6** 停止條件處理
- 實作 `src/frontend/app.js` 中的停止邏輯：
  - `handleHardStop()`：立即 cancel + clear（參考 `design.md` § 6）
  - `handleSoftStop()`：注入 goodbye 指令，播放後結束
- 實作 Magic Word 檢測（參考 `design.md` § 6）：
  - 監聽 Realtime 的 `conversation.item.created`（role=user）事件
  - 對 transcript 進行不區分大小寫的子字串匹配
  - 支援多個 Magic Word（逗號分隔），任一匹配即觸發 Soft stop
  - 範例：Magic Word="red alert"，用戶說"Red Alert"→匹配成功
- 實作衝突解決邏輯（參考 `design.md` § 6）：
  - 用戶按「達標」但 Controller 判定「未達標」：以用戶為準，顯示警告
  - Controller 判定「達標」但用戶未按按鈕：彈出提示，需用戶確認
- **驗收**：
  - 手動測試：按「立即停止」，驗證立即切斷
  - 手動測試：按「是時候說再見」，驗證播放 goodbye 後結束
  - 手動測試：說出 Magic Word，驗證觸發 Soft stop
  - 手動測試：衝突場景，驗證提示正確顯示

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

### 量化指標（v1 建議）

* M1 打斷成功率：`#success_interrupt / #attempts`
* M2 打斷反應時間（主觀等級）：1–5
* M3 達標率（在固定腳本下）：`#goal_met / #runs`
* M4 用戶可控性：按鈕介入後「策略方向符合」比例
* M5 誠實率：未知問題場景中無捏造（人工抽檢）

### 測試方法

* 腳本式對話（由測試人員扮演對方）
* 每個腳本包含：至少 2 次打斷、1 次條件改動、1 次未知問題
* 每次 run 輸出：事件時間線、摘要、達標判定、停止原因

**驗收**：

* 指標達到 Milestone 0/1/2 的門檻
* 生成一份「是否值得做 v2」結論（以指標為依據）

---