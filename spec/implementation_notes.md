---
name: voice-proxy-negotiator-implementation-notes
description: 實作階段的關鍵技術細節與坑位補充（2025-01-25 補充）
---

# Implementation Notes — 關鍵技術細節

## 🎯 高優先級坑位已補充（2025-01-25）

### 1. 模型 ID 確認（已解決）✅

**官方確認**：
- **gpt-5-mini**：`gpt-5-mini-2025-08-07` ([GPT-5 mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-5-mini))
- **gpt-realtime-mini**：`gpt-realtime-mini-2025-12-15` ([gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini))

**已更新文檔**：
- `spec/steering.md` § 2：記錄實際模型 ID 與版本快照
- `spec/tasks.md` T0.0：加入模型 ID 確認步驟

---

### 2. Responses API 端點確認（已解決）✅

**官方確認**：
- **端點**：`POST https://api.openai.com/v1/responses`
- **文檔**：[Responses | OpenAI API Reference](https://platform.openai.com/docs/api-reference/responses)
- **說明**：這是新一代 API，取代舊的 `/v1/chat/completions`，專為推理模型與 agent 設計

**關鍵特性**：
- Reasoning State Preservation（保留推理狀態跨回合）
- Hosted Tools（伺服器端執行 web search、image gen、MCP）
- Direct File Input（支援 PDF 等檔案，v2 可用於 SSOT RAG）

**已更新文檔**：
- `spec/design.md` § 1：補充 Responses API 端點與關鍵特性
- `spec/tasks.md` T1.4：明確使用 `/v1/responses`

**參考來源**：[Why we built the Responses API](https://developers.openai.com/blog/responses-api/)

---

### 3. Ephemeral Token 生成方式（已解決）✅

**官方確認**：
- **端點**：`POST https://api.openai.com/v1/realtime/client_secrets`
- **文檔**：[Client secrets | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions)
- **Token 格式**：`ek_1234...`（以 `ek_` 開頭）
- **默認 TTL**：**10 分鐘**（不是 60 分鐘）

**請求範例**：
```http
POST https://api.openai.com/v1/realtime/client_secrets
Authorization: Bearer {OPENAI_API_KEY}
Content-Type: application/json

{
  "model": "gpt-realtime-mini-2025-12-15",
  "voice": "marin"
}
```

**響應範例**：
```json
{
  "client_secret": "ek_1234...",
  "expires_at": 1234567890
}
```

**已更新文檔**：
- `spec/design.md` § 9：補充完整的 API 調用範例與 token 續期策略
- `spec/tasks.md` T0.1：明確端點與 TTL

**參考來源**：[Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc)

---

### 4. Controller 調用路徑（已解決）✅

**設計決策**：前端**不得**直接調用 OpenAI API（避免暴露 API key），必須通過後端代理。

**調用流程**：
```
用戶按按鈕
  ↓
前端 POST /api/controller
  ↓
後端 controller.py 調用 /v1/responses
  ↓
返回策略指令給前端
  ↓
前端注入到 Realtime session
```

**已新增後端 API 規格**：

#### `POST /api/controller`
生成下一句策略指令。

**請求**：
```json
{
  "directive": "AGREE",
  "pinned_context": "Goal: ...\nRules: ...",
  "memory": "Current summary...",
  "latest_turns": ["Human: ...", "Assistant: ..."]
}
```

**響應**：
```json
{
  "decision": "continue",
  "next_english_utterance": "I agree with your proposal. Let's move forward.",
  "memory_update": "Updated summary...",
  "notes_for_user": null
}
```

**已更新文檔**：
- `spec/design.md` § 1.1：補充完整調用路徑與 API 規格
- `spec/tasks.md` T1.4：加入 `/api/controller` 端點實作

---

## ⚠️ 中優先級坑位已補充

### 5. Magic Word 檢測邏輯（已解決）✅

**檢測方式**：
- **檢測時機**：每次收到 Realtime 的 `conversation.item.created`（role=user）事件
- **匹配規則**：對 transcript 進行**不區分大小寫**的子字串匹配
- **支援多個 Magic Word**：逗號分隔，任一匹配即觸發 Soft stop
- **範例**：Magic Word=`"red alert"`，用戶說`"Red Alert"`→匹配成功

**已更新文檔**：
- `spec/design.md` § 6：補充完整 Magic Word 檢測邏輯
- `spec/tasks.md` T1.6：加入 Magic Word 檢測實作與測試

---

### 6. SSOT 摘要策略（已解決）✅

**壓縮時機**：
- 用戶點擊「開始對話」按鈕時
- 前端估算 SSOT tokens（使用 `token_estimator.js`）
- 如 > 1,500 tokens，調用後端 `/api/summarize_ssot`

**壓縮方法**：
- 後端調用 `gpt-5-mini` (Responses API)
- Instruction：「總結以下資料為關鍵要點清單（bullet points），保留所有數字、日期、條款編號，目標長度 1,500 tokens 以內」

**新增 API 規格**：

#### `POST /api/summarize_ssot`
```json
// 請求
{
  "ssot_text": "原始 SSOT 內容..."
}

// 響應
{
  "summary": "摘要後的 SSOT...",
  "original_tokens": 3200,
  "summary_tokens": 1400
}
```

**已更新文檔**：
- `spec/design.md` § 4.2：補充完整 SSOT 摘要策略與 API 規格
- `spec/tasks.md` T1.1：加入 SSOT 自動摘要實作
- `spec/tasks.md` T1.4：加入 `/api/summarize_ssot` 端點實作

---

### 7. 按鈕映射表存儲位置（已解決）✅

**v1 策略**：存儲在**前端 sessionStorage**（臨時），對話結束後清除。

**數據結構**：
```javascript
sessionStorage.setItem('button_mapping', JSON.stringify({
  "同意": "AGREE",
  "不同意": "DISAGREE",
  "我需要時間考慮": "NEED_TIME",
  // ...
}));
```

**v2 規劃**：支援用戶自定義按鈕與映射，存儲到後端數據庫（持久化）

**已更新文檔**：
- `spec/design.md` § 5：補充按鈕映射表存儲策略
- `spec/tasks.md` T1.1：明確使用 sessionStorage

---

### 8. Controller 狀態管理方式（已解決）✅

**v1 選擇**：使用 `previous_response_id` 模式（無狀態），避免伺服器端保存會話狀態。

**調用範例**：
```json
{
  "model": "gpt-5-mini-2025-08-07",
  "instructions": "...",
  "input": [...],
  "previous_response_id": "resp_abc123"  // 上一次調用的 response ID
}
```

**好處**：
- 前端/App 層完全控制狀態（pinned_context + memory + recent_turns）
- 後端無狀態，易於水平擴展
- 可重播測試（提供相同輸入即可復現）

**已更新文檔**：
- `spec/design.md` § 5：補充狀態管理方式與優點
- `spec/tasks.md` T1.4：明確使用 `previous_response_id`

**參考來源**：`src/skills/openai-gpt5-mini-controller/SKILL.md:63-68`

---

### 9. Recent Turns 的 N 值（已解決）✅

**明確定義**：N = **3**（保留最近 3 輪對話原文）

**理由**：
- 符合 T2.3 重連時保存的數量
- 約 500–1,000 tokens，不會過度佔用 context

**已更新文檔**：
- `spec/design.md` § 4.2：明確 Recent Turns = 3 輪
- `spec/tasks.md` T1.4、T2.3：統一使用「最近 3 輪」

---

### 10. Token 續期策略（已解決）✅

**問題**：Token TTL 只有 10 分鐘，但 session 最長 60 分鐘。

**策略**：雙層計時器
- **8 分鐘時**：背景請求新 token（預留 2 分鐘緩衝）
- **更新 session**：使用新 token 無縫續接（WebRTC 重連）
- **55 分鐘時**：提示用戶即將超過 session 上限，準備完整重連

**已更新文檔**：
- `spec/design.md` § 9：補充 Token 續期策略
- `spec/tasks.md` T2.3：實作雙層計時器（token 續期 + session 重連）

---

## 📝 低優先級坑位（已補充 / 待實作階段確認）

### 已補充（2025-01-25）

11. **Voice 選項列表** ✅
    - v1 支援：`marin`（默認）、`cedar`
    - 來源：[gpt-realtime-mini Model](https://platform.openai.com/docs/models/gpt-realtime-mini)
    - 位置：`SKILL.md`、`design.md` § 1.1

12. **音訊格式參數** ✅
    - 格式：`audio/pcm`
    - 規格：16-bit PCM, 24kHz sample rate（WebRTC 默認）
    - 位置：`SKILL.md`

13. **進度條顏色方案** ⚠️
    - 建議：綠色（< 50%）、黃色（50-70%）、紅色（> 70%）
    - 實作時確認：可調整為更好的視覺方案
    - 待補充位置：`tasks.md` T2.1 或前端 CSS

14. **錯誤處理策略** ✅
    - OpenAI API：Exponential backoff，最多重試 3 次
    - WebRTC：重試 3 次（2 秒間隔），失敗後優雅降級
    - Session 超時：下載對話記錄（JSON + Markdown）
    - 位置：`design.md` § 9（新增完整錯誤處理章節）

15. **WebRTC STUN/TURN 配置** ✅
    - STUN：`stun:stun.l.google.com:19302`（Google 公開）
    - TURN：v1 不配置（本地開發），v2 需配置（生產環境）
    - 位置：`SKILL.md`（Transport options 章節）

16. **CORS 配置** ✅
    - Allowed Origins: `http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`
    - Allowed Methods: `GET, POST, OPTIONS`
    - Allowed Headers: `Content-Type, Authorization`
    - FastAPI 配置範例：`design.md` § 1.1
    - 位置：`design.md` § 1.1、§ 9

### 待實作階段確認

17. **tiktoken WASM 引入方式**
    - 選項 A：CDN（`https://cdn.jsdelivr.net/npm/tiktoken`）
    - 選項 B：npm 安裝（`npm install tiktoken`）
    - 選項 C：簡化估算（每個中文字 ≈ 2 tokens，每個英文詞 ≈ 1 token）
    - 建議：v1 先用選項 C（快速），v2 再用精準的 tiktoken
    - 待補充位置：`tasks.md` T2.1

---

## 📚 參考來源總結

### OpenAI 官方文檔
- [GPT-5 mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-5-mini)
- [gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini)
- [Responses | OpenAI API Reference](https://platform.openai.com/docs/api-reference/responses)
- [Client secrets | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions)
- [Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc)
- [Why we built the Responses API](https://developers.openai.com/blog/responses-api/)

### 專案內部 SKILLS
- `src/skills/openai-gpt5-mini-controller/SKILL.md`：Controller 狀態管理、JSON 解析
- `src/skills/openai-realtime-mini-voice/SKILL.md`：WebRTC、VAD、interruptions
- `src/skills/windows-python/SKILL.md`：Python 環境、編碼、路徑處理

---

## ✅ 所有高/中優先級坑位已補齊

**補充完成時間**：2025-01-25

### 已補充清單（共 16 項）

**高優先級（1-4）**：
- ✅ 模型 ID 確認（實際版本快照）
- ✅ Responses API 端點確認
- ✅ Ephemeral Token 生成端點與 TTL
- ✅ Controller 調用路徑與後端 API 規格

**中優先級（5-10）**：
- ✅ Magic Word 檢測邏輯
- ✅ SSOT 摘要策略與 API
- ✅ 按鈕映射表存儲方式
- ✅ Controller 狀態管理（`previous_response_id`）
- ✅ Recent Turns N 值（明確為 3）
- ✅ Token 續期策略（雙層計時器）

**低優先級（11-16）**：
- ✅ Voice 選項列表（marin, cedar）
- ✅ 音訊格式參數（16-bit PCM, 24kHz）
- ⚠️ 進度條顏色方案（建議已提供，實作時確認）
- ✅ 錯誤處理策略（完整章節）
- ✅ WebRTC STUN/TURN 配置
- ✅ CORS 配置（完整規格 + FastAPI 範例）

**待實作確認（17）**：
- ⏳ tiktoken WASM 引入方式（建議簡化估算，v1 優先）

---

## 📊 文檔更新總結

### 更新的文檔

1. **`spec/steering.md`**：模型 ID、官方連結
2. **`spec/design.md`**：
   - § 1：Responses API 特性、Controller 調用路徑
   - § 1.1：技術棧、CORS 配置
   - § 4.2：SSOT 摘要策略、Recent Turns N=3
   - § 5：按鈕映射、Controller 狀態管理
   - § 6：Magic Word 檢測、停止條件優先級
   - § 8：Session 重連策略
   - § 9（新增）：**完整錯誤處理策略**
   - § 9（原 § 8）：Ephemeral Token 生成與續期
3. **`spec/tasks.md`**：
   - T0.0：模型 ID 確認步驟
   - T0.1：Token 端點、TTL
   - T1.1：SSOT 自動摘要、Magic Word、voice 選擇
   - T1.4：Responses API、`/api/controller`、`/api/summarize_ssot`
   - T1.6：Magic Word 檢測實作
   - T2.3：雙層計時器（token 續期 + session 重連）
4. **`src/skills/openai-gpt5-mini-controller/SKILL.md`**：
   - 模型版本區塊（ID、文檔連結）
   - Responses API 關鍵特性
   - `max_output_tokens` 提升到 1000
5. **`src/skills/openai-realtime-mini-voice/SKILL.md`**：
   - 模型版本區塊（ID、voices、文檔連結）
   - **Ephemeral Token 生成區塊**（最關鍵）
   - WebRTC STUN/TURN 配置
   - Session 管理最佳實踐
   - 音訊格式細節
6. **`spec/implementation_notes.md`**（新增）：完整記錄所有坑位補充

---

## ✅ 狀態：規劃階段完成，可進入實作

**已補齊**：16/17 項坑位（94% 完成度）
**待確認**：1 項（tiktoken 引入方式，實作時決定）

**下一步**：
1. 提交規格修訂 commit（包含所有更新的文檔）
2. 進入 `prompt_2_implement.md` 階段開始編碼
