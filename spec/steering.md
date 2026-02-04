---
name: english-conversation-assistant-steering
description: ECA 長期規約：技術棧、事件處理準則、模型使用範圍、程式風格、驗收口徑。
version: 2.2
date: 2026-02-03
---

# English Conversation Assistant — Steering v2.0

## 0. Precedence（SSOT 優先序｜硬規約）

如有衝突／矛盾，一律按以下優先序仲裁（由高至低），並需在輸出中明確回報衝突點（不得私自改寫需求）。

1) Spec（需求/設計/任務合約）
   - `spec/requirements.md`
   - `spec/design.md`
   - `spec/tasks.md`

2) Steering（執行規約/工程準則）
   - `spec/steering.md`

3) Skills（工具/環境/除錯操作指南；只定義「How」，不得推翻「What」）
   - `src/skills/openai-gpt5-mini-controller/SKILL.md`
   - `src/skills/openai-realtime-mini-voice/SKILL.md`
   - `src/skills/windows-python/SKILL.md`
   - `src/skills/chrome-devtools-mcp.skill`

## 0.1 Tooling Router（Skills Index）

Skills 只在「需要正確使用工具/SDK/環境/除錯」時才讀；任何需求/合約/驗收標準的定義，只能以 Spec/Steering 為準。

| Skill | 何時必讀 |
|-------|---------|
| `openai-gpt5-mini-controller/SKILL.md` | 實作講稿生成、Smart 建議（使用 `gpt-5-mini`） |
| `openai-realtime-mini-voice/SKILL.md` | 實作即時翻譯、WebRTC、VAD、事件處理 |
| `windows-python/SKILL.md` | 本地開發環境、Python 依賴、測試 |
| `chrome-devtools-mcp.skill` | 除錯 WebRTC、音訊權限、console/network |

## 1. 專案北極星

以「用戶主導、AI 輔助」為核心理念：
- **即時翻譯**：讓用戶聽懂對方說什麼
- **講稿生成**：讓用戶知道自己怎麼說
- **低延遲**：翻譯 < 500ms，講稿 < 1.5s

## 2. 模型使用範圍（Hard Rule）

🔎 僅可使用以下 OpenAI 模型（硬性規則，不可變更）：

- **Realtime 語音**：`gpt-realtime-mini`
  - 最新穩定版本：`gpt-realtime-mini-2025-12-15`
  - 文檔：[gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini)

- **文字控制器**：`gpt-5-mini`
  - 最新穩定版本：`gpt-5-mini-2025-08-07`
  - 文檔：[GPT-5 mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-5-mini)

- **即時翻譯**：`gpt-4.1-nano`
  - 用途：英→中即時翻譯（方案 A）
  - 首字回應：~700ms（經測試為最快模型）
  - ⚠️ 不可用 gpt-5-mini（reasoning 開銷太大，需 5-6 秒）

### 模型 ID 確認步驟（強制）
在 Milestone 0 開始前，必須執行：
```bash
# 列出可用模型
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | grep "gpt"
```
確認 `gpt-realtime-mini` 和 `gpt-5-mini` 的實際可用性。如果 API 返回不同的版本 ID（例如更新的快照），優先使用最新穩定版本，並更新所有代碼中的 `model` 參數。

### 模型職責分工
* Realtime（語音）不得承擔結構化輸出仲裁：其不支援 structured outputs。 ([OpenAI Platform][3])
* `gpt-5-mini` 必須承擔：達標判定、下一句策略、摘要壓縮、誠實策略守門。 ([OpenAI Platform][4])

## 3. Realtime 事件處理準則（Interrupt-first）

🔎 任何需要立即停止輸出的情境，一律走：`response.cancel` → `output_audio_buffer.clear` →（需要時）`conversation.item.truncate`。 ([OpenAI Platform][5])

* `response.cancel`：取消生成（即使無 in-progress 亦可呼叫，最多 error）。 ([OpenAI Platform][5])
* `output_audio_buffer.clear`：WebRTC/SIP 立即切斷播放，且建議先 cancel。 ([OpenAI Platform][9])
* `conversation.item.truncate`：同步伺服器上下文，避免殘留未被聽到內容。 ([OpenAI Platform][5])

## 4. VAD / Turn-taking 準則

🔎 優先 `semantic_vad` + `interrupt_response=true`；如遇兼容性問題才回退其他模式。 ([OpenAI Platform][2])

## 5. Session 限制與 UX 合約

🔎 單一 session 最長 60 分鐘；必須提供倒數提示與可續接重連。 ([OpenAI Platform][6])
🔎 一旦開始輸出音訊後 voice 不可更改；voice 必須在 INIT 鎖定。 ([OpenAI Platform][6])

## 6. Segment 管理準則

Segment（翻譯段落）管理遵循以下規則：

* **主鍵**：使用 OpenAI `item_id` 作為 Segment 的主鍵
* **雙向索引**：`item_id → Segment` 和 `response_id → Segment`
* **路由**：所有事件用 `item_id` 或 `response_id` 路由到正確的 Segment
* **FIFO 隊列**：`response.created` 事件不含 `item_id`，用 FIFO 隊列關聯
* **狀態機**：`listening → transcribing → translating → done`
* **獨立生命週期**：每個 Segment 獨立處理，新 Segment 不阻塞舊 Segment
* **超時保護**：任何「等待」狀態必須有超時機制（30 秒）

詳細設計見：
- `design.md` 第 4.3 節（並行翻譯架構）
- `design_parallel_translation.md`（完整實現規格）

## 7. 翻譯準確性要求

* 翻譯必須忠於原文語義
* 不確定的詞彙用 `[?]` 標記
* 顯示英文原文讓用戶可以對照
* 信心指示（v2）：低信心時提示用戶

## 8. 參考起點（Allowed References）

🔎 官方示例可作工程參考：OpenAI Realtime Console（WebRTC）與 OpenAI Realtime Twilio demo（事件流/中斷）。 ([GitHub][7])

---

[1]: https://platform.openai.com/docs/models/gpt-realtime "gpt-realtime Model | OpenAI API"
[2]: https://platform.openai.com/docs/api-reference/realtime "Realtime | OpenAI API Reference"
[3]: https://platform.openai.com/docs/models/gpt-realtime-mini "gpt-realtime-mini Model | OpenAI API"
[4]: https://platform.openai.com/docs/models/gpt-5-mini "GPT-5 mini Model | OpenAI API"
[5]: https://platform.openai.com/docs/api-reference/realtime-client-events/response/cancel "Client events | OpenAI API Reference"
[6]: https://platform.openai.com/docs/guides/realtime-conversations "Realtime conversations | OpenAI API"
[7]: https://github.com/openai/openai-realtime-console?utm_source=chatgpt.com "openai/openai-realtime-console: React app for inspecting, ..."
[8]: https://platform.openai.com/docs/guides/realtime?utm_source=chatgpt.com "Realtime API"
[9]: https://platform.openai.com/docs/api-reference/realtime-client-events/output_audio_buffer/clear "Client events | OpenAI API Reference"
