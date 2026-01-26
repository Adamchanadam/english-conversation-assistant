---

name: voice-proxy-negotiator-steering
description: Kiro 長期規約：此專案的技術棧、事件處理準則、模型使用範圍、程式風格、驗收口徑（避免每次對話重覆說明）。
-------------------------------------------------------------------

# Voice Proxy Negotiator — Steering

## 0. Precedence（SSOT 優先序｜硬規約）

🔎 如有衝突／矛盾，一律按以下優先序仲裁（由高至低），並需在輸出中明確回報衝突點（不得私自改寫需求）。

1) Spec（需求/設計/任務合約）
   - `spec/requirements.md`
   - `spec/design.md`
   - `spec/tasks.md`

2) Steering（執行規約/工程準則）
   - `spec/steering.md`
   - `.kiro/steering/**`（如存在）

3) Skills（工具/環境/除錯操作指南；只定義「How」，不得推翻「What」）
   - `src/skills/openai-gpt5-mini-controller/SKILL.md`
   - `src/skills/openai-realtime-mini-voice/SKILL.md`
   - `src/skills/windows-python/SKILL.md`
   - `src/skills/chrome-devtools-mcp.skill`

## 0.1 Tooling Router（Skills Index｜Router-only）

🔎 Skills 只在「需要正確使用工具/SDK/環境/除錯」時才讀；任何需求/合約/驗收標準的定義，只能以 Spec/Steering 為準。

- `src/skills/openai-gpt5-mini-controller/SKILL.md`
  - 何時必讀：實作/調整 `gpt-5-mini` Control Plane（狀態機、達標判定、摘要壓縮、誠實守門、文本計劃生成）
- `src/skills/openai-realtime-mini-voice/SKILL.md`
  - 何時必讀：實作/調整 `gpt-realtime-mini` Realtime Voice（WebRTC 管線、VAD、interruptions、cancel/clear/truncate、語音 UX）
- `src/skills/windows-python/SKILL.md`
  - 何時必讀：本地 Windows 開發環境、Python 依賴、測試與腳本執行、CI/命令一致性
- `src/skills/chrome-devtools-mcp.skill`
  - 何時必讀：用 Chrome DevTools/MCP 除錯 WebRTC、音訊權限、裝置選擇、console/network 記錄與重現問題

## 1. 專案北極星


🔎 以「低延遲語音協商」為首要體驗；一切治理（達標/不虛構/記憶）放在 App/Control 平面，避免拖慢語音回合。

## 2. 模型使用範圍（Hard Rule）

🔎 僅可使用以下 OpenAI 模型（硬性規則，不可變更）：

- **Realtime 語音**：`gpt-realtime-mini`
  - 最新穩定版本：`gpt-realtime-mini-2025-12-15`
  - 文檔：[gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini)

- **文字控制器**：`gpt-5-mini`
  - 最新穩定版本：`gpt-5-mini-2025-08-07`
  - 文檔：[GPT-5 mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-5-mini)

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

## 6. 記憶治理（One-rule-one-place）

🔎 任務目標/硬約束永遠以 Pinned Context 單點保存；對話歷史只以 Rolling Summary + 最近 N turns 保存。
要求：

* 任何壓縮只可由 `gpt-5-mini` 產生
* 壓縮後必須保留：已承諾/未承諾、對方條件、未解問題、下一步策略

## 7. 「不虛構」合約（Mandatory）

🔎 遇到未知或缺資訊，必須採用「承認未知 + 澄清/記錄待辦」策略，不得編造。
最低回應模板（英語語音亦須遵守語義）：

* “I’m not sure about that. Let me note it down and get back to you.”
* “Could you clarify X so I can respond accurately?”

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
