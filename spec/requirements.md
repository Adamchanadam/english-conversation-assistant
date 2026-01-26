---
name: voice-proxy-negotiator-requirements
description: 英語語音「代客協商」Web App 之需求規格（Realtime 語音 + App 狀態機 + gpt-5-mini 裁判），供 Kiro 落地開發與驗收。
-------------------------------------------------------------------------------------------

# Voice Proxy Negotiator — Requirements

## 1. 產品背景與定位

🔎 本產品為「英語世界代客協商」語音代理：以低延遲英語語音與對方人類對話，協助繁體中文（廣東話/普通話）用戶達成預設協商目標。
系統在對外（對方人類）端以英語語音溝通；在對內（用戶）端提供繁體中文介面作設定、引導與即時介入。

## 2. 核心目標（Product Goal）

🔎 在自然來回對話節奏下，逐步推進至「任務達標」或「用戶即時停止」為止，並在未知處保持誠實不虛構。

## 3. 模型與工具限制（Hard Constraints）

🔎 僅允許使用兩個 OpenAI 模型：`gpt-realtime-mini`（Realtime 語音對話）與 `gpt-5-mini`（文字狀態機/裁判/記憶壓縮）。 ([OpenAI Platform][3])

* `gpt-realtime-mini`：32k context、4,096 max output，且不支援 Structured outputs。 ([OpenAI Platform][3])
* `gpt-5-mini`：400k context、128k max output；適合承擔長期記憶與複雜規則治理。 ([OpenAI Platform][4])

## 4. 主要使用情境（Primary Use Cases）

🔎 以「短句、輪流、可被打斷」的口語協商節奏運作，並允許用戶透過 UI 即時引導代理立場與下一句話。

* UC-01：用戶在設定頁輸入任務目標/原則/SSOT，開始語音協商。
* UC-02：對方提出新要求/條件；系統分析與目標差距，提出下一步短句回應。
* UC-03：對方打斷代理；系統能停止輸出並在對方說完後自然續接。 ([OpenAI Platform][5])
* UC-04：用戶按「同意/不同意/我要考慮/是時候說再見/達標/停止」等按鈕即時改變策略。
* UC-05：遇到不確定資訊，系統以誠實策略回應（例如：承認未知、先記錄、稍後跟進），不捏造。

## 5. 功能需求（Functional Requirements）

### 5.1 設定頁（Session Setup）

🔎 用戶可定義本次協商的「任務目標、硬約束、口吻策略、停止條件、Magic Word、SSOT 參考資料」。
必填欄位：

* 任務目標（Goal Statement）
* 停止條件（Stop Conditions：達標規則 + Magic Word/Stop Button）
* SSOT（可貼文字；v1 先做純文字，不做檔案 RAG）
  - **長度限制（v1）**：最多 5,000 字元（約 1,500 tokens）
  - **超長處理**：前端提示用戶精簡；或由 `gpt-5-mini` 摘要後作為 Pinned Context
  - **v2 規劃**：支援檔案上傳 + RAG 檢索

選填欄位：
* 角色/語氣（例如：禮貌但堅定、先確認再提案）
* 禁區（不可承諾事項、不可透露資料）
* 期望談判策略（例如：先問對方底線、再提出折衷）

### 5.2 對話頁（Live Negotiation）

🔎 提供「一鍵式即時語義指令」按鈕組，且不破壞語音 UX（不中斷對話流程、無需長篇輸入）。

#### 按鈕文字（v1 規範）
- **顯示語言**：繁體中文（符合對內介面定位）
- **內部 directive ID**：英文大寫（例如 `AGREE_SOFTLY`、`NEED_TIME`）
- **映射表**（可在設定頁配置）：

| 按鈕文字（繁中） | Directive ID | Controller 生成策略示例 |
|-----------------|--------------|-------------------------|
| 同意 | `AGREE` | "Politely agree and confirm next steps." |
| 不同意 | `DISAGREE` | "Decline politely and explain reason." |
| 我需要時間考慮 | `NEED_TIME` | "Ask for time to consider and set follow-up." |
| 請重複一次 | `REPEAT` | "Ask the other party to repeat or clarify." |
| 提出替代方案 | `PROPOSE_ALTERNATIVE` | "Suggest a different option." |
| 詢問對方底線 | `ASK_BOTTOM_LINE` | "Inquire about their constraints or limits." |
| 是時候說再見 | `SAY_GOODBYE` | "Initiate polite wrap-up and goodbye." |
| 達標 | `GOAL_MET` | "Confirm goal achieved and close session." |
| 立即停止 | `EMERGENCY_STOP` | (Hard stop, no Controller call) |

最低限度按鈕（v1 必須實作）：
* 同意 / 不同意 / 我需要時間考慮 / 請重複一次
* 提出替代方案 / 詢問對方底線
* 是時候說再見
* 達標
* 立即停止

### 5.3 中斷與續接（Interruptions / Barge-in）

🔎 必須支援「對方人類打斷代理」時，代理能停止輸出並在對方講完後自然回應。

* 事件要求：取消正在生成的回應（`response.cancel`），並於 WebRTC/SIP 立即切斷播放（`output_audio_buffer.clear`）。 ([OpenAI Platform][5])
* 如需要同步「已播放音訊」與「伺服器上下文」，使用 `conversation.item.truncate`。 ([OpenAI Platform][5])
* Turn taking：優先採用 `semantic_vad` + `interrupt_response` 以提升可打斷性與自然停頓。 ([OpenAI Platform][2])

### 5.4 目標貫通與記憶（Goal Persistence / Memory）

🔎 任務目標必須在整段對話中持續保留，避免 context window 壓力導致失焦。

* 將「目標/規則」固定為高優先級的「Pinned Context」
* 將「對話歷史」做滾動摘要/要點化（由 `gpt-5-mini` 產生），再回灌至 Realtime 或用於下一步生成

### 5.5 Context Window 視覺化（Progress Bar）

🔎 介面需顯示「當前上下文容量壓力」以提示用戶如何引導，並即時更新。
要求：

* 顯示：Pinned Context、Rolling Summary、Recent Turns 估算 token 佔用
* 顯示：距離「建議壓縮門檻」的剩餘比例（例如 70% 警戒線）
  說明：
* Realtime token 與 audio token 口徑複雜，v1 允許以文字 transcript/估算 token 為主，並標示「估算值」。

### 5.6 誠實策略（Anti-Hallucination Behavior）

🔎 在未知/不確定時必須顯式承認並採取替代策略，不得捏造事實或承諾。
最低策略集合：

* 承認未知 + 記錄待辦（Follow-up List）
* 反問澄清（Clarify）
* 將問題轉為可操作下一步（例如：要求對方提供文件/條款）

## 6. 非功能需求（NFR）

🔎 系統核心指標為「低延遲、可打斷、可控、可驗收」。

* Latency：語音回應需「主觀上接近即時」；以 Realtime + WebRTC 為優先路徑（低延遲設計目的）。 ([OpenAI Platform][8])
* Reliability：中斷事件不應導致 session 壞死；可安全重試 cancel（即使沒有 in-progress response 亦可呼叫，最多回 error 但 session 不受影響）。 ([OpenAI Platform][5])
* Session duration：單一 Realtime session 最長 60 分鐘；需設計自動重連與上下文續接。 ([OpenAI Platform][6])
* Voice immutability：一旦開始輸出音訊後，voice 不可更改；需在 session 啟動前確定 voice。 ([OpenAI Platform][6])

## 7. 成功準則（Success Criteria）

🔎 成功以「達標率 + 可打斷性 + 用戶可控性 + 不虛構」綜合判定。
v1 最低驗收（Pass/Fail）：

1. 可完成至少 3 段「對方→代理→對方→代理」的自然往返
2. 對方打斷時，代理能在可接受時間內停止輸出並續接
3. 用戶按鈕介入能改變下一句回應方向
4. 遇到未知問題時，代理不捏造，會採用誠實策略
5. 達標/停止可確實結束（包含緊急停機）

## 8. 風險與限制（Risks）

🔎 Realtime 不支援 Structured outputs，故「任務達標才停」與「不虛構」必須落在 App 狀態機與 `gpt-5-mini` 裁判。 ([OpenAI Platform][3])
其他關鍵風險：

* Barge-in 在不同裝置/瀏覽器音訊路徑上有差異，需做實測與回退策略（cancel + clear + truncate 組合）。 ([OpenAI Platform][5])
* 成本不確定性：音訊 token 計價與用量依實際互動而波動；需在 v1 加入用量記錄與預算警戒線。 ([OpenAI Platform][1])

---