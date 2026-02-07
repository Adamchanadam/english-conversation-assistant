# 經驗教訓記錄 (Lessons Learned)

> 目的：系統性記錄開發過程中遇到的問題、根因分析、解決方案，避免重複犯錯，持續改進。
>
> 更新原則：每次遇到重大問題或解決後，立即記錄。

---

## 🚨 Test 21 修復記錄（2026-02-02）

### 問題結構（修復前）
```
1) Web Speech = 實時逐字英文字幕（頁頂）✅ 正常

2) 分拆段落條目 =
   2.1) 英文段落 ❌ 問題：文字不完整、過短、與 2.2 中文不對齊
   2.2) 英譯中 ❌ 問題：
        - 語言錯誤：顯示簡體中文，應為繁體中文
        - 模式錯誤：Q&A 對話模式，非純文字翻譯
```

### 修復方案
| 項目 | 問題 | 修復 | 狀態 |
|------|------|------|------|
| 2.2a | 簡體→繁體中文 | 明確指定 "Traditional Chinese (Hong Kong)" + 繁簡對比範例 | ✅ 已修復 |
| 2.2b | Q&A 模式→翻譯模式 | 採用 Twilio 風格 prompt："You are a translation machine..." | ✅ 已修復 |
| 2.1 | 英文段落不對齊 | v9: 改用 FIFO 策略（最早未使用）取代時間戳匹配 | ✅ 已修復 |

### 技術修復細節

#### 2.2 翻譯模式修復（Twilio 風格 prompt）
```javascript
// session.update instructions
instructions: `You are a translation machine. Your sole function is to translate English audio to Traditional Chinese (Hong Kong style, 繁體中文).

CRITICAL RULES:
- Do NOT respond to the audio content. Do NOT have a dialogue.
- Do NOT say "我明白", "好的", "請問", or any conversational phrases.
- Output ONLY the Chinese translation, nothing else.
- Use Traditional Chinese characters (繁體字), NOT Simplified Chinese (简体字).
  ✓ Correct: 說話、學習、電話、經濟
  ✗ Wrong: 说话、学习、电话、经济
...`

// response.create instructions（每次翻譯時強化）
instructions: 'Translate to Traditional Chinese (繁體中文). Output ONLY the translation. No dialogue...'
```

#### 2.1 英文段落對齊修復（v9 FIFO）
```javascript
// v9: 改用 FIFO 策略取代時間戳匹配
findClosestWebSpeechText() {
    // 理由：語音是順序的，第一個 transcription 應該對應第一個 Web Speech 分段
    for (const entry of this.webSpeechHistory) {
        if (entry.used) continue;
        entry.used = true;  // 找到第一個未使用的就用
        return entry.text;
    }
    return '';
}
```

### 參考資源
- [Twilio Live Translation](https://github.com/twilio-samples/live-translation-openai-realtime-api) - prompt 風格參考
- [OpenAI Cookbook - One-Way Translation](https://cookbook.openai.com/examples/voice_solutions/one_way_translation_using_realtime_api)

### 回歸測試結果（2026-02-02）

**測試腳本**: `src/tests/test_translate_api.py`

```
============================================================
REGRESSION TEST RESULTS:
  Test 1 (OpenAI Responses API): ✅ PASS
  Test 2 (Backend Endpoint):     ✅ PASS
============================================================

測試案例:
- "Hello, how are you today?" → "你好，你今天好嗎？" ✅ 繁體
- "The meeting is scheduled for next Monday at 3 PM." → "會議定於下星期一下午3時舉行。" ✅ 繁體
- "Jeffrey Epstein was a convicted American sex offender." → "傑弗里·愛潑斯坦 (Jeffrey Epstein) 曾是被定罪的美國性罪犯。" ✅ 繁體+專有名詞格式
```

**已驗證**:
- [x] 翻譯結果是繁體中文（說話、學習，非 说话、学习）
- [x] 翻譯是純翻譯（無對話回應，無 "我明白"、"好的"）
- [x] 專有名詞格式正確：中文 (English)

**待人工驗證（Test 22）**:
- [ ] 實際語音測試：Web Speech + SmartSegmenter + 後端翻譯 整合

---

## 🔧 方案 A 實現記錄（2026-02-02 Test 21 後）

### 問題根因
OpenAI Realtime API 的語音輸入模式**天生是對話模式**：
- `session.update` 的 `instructions` 被忽略或優先級低
- 語音輸入觸發「對話回應」行為，而非「翻譯」
- 無論 Twilio 風格 prompt 或 XML 格式都無法解決

### 方案 A: 兩階段架構

```
┌─────────────────────────────────────────────────────────────┐
│  麥克風音訊                                                    │
│    │                                                          │
│    └──→ Web Speech API ──→ SmartSegmenter ──→ /api/translate │
│         (瀏覽器 STT)       (600ms 分段)      (gpt-5-mini)     │
│                                                ↓              │
│                                           繁體中文翻譯         │
└─────────────────────────────────────────────────────────────┘
```

### 實現細節

**後端** (`main.py`):
```python
@app.post("/api/translate")
async def translate_text(request: TranslateRequest):
    # 使用 gpt-5-mini（符合 CLAUDE.md 模型規則）
    # Twilio 風格 prompt："You are a translation machine..."
```

**前端** (`eca_parallel_test.html`):
```javascript
smartSegmenter.onSegment = (segment) => {
    // 不再調用 forceTranslation()（OpenAI Realtime）
    // 改用後端 API
    translateViaBackend(segment);
};

async function translateViaBackend(englishText) {
    const response = await fetch('/api/translate', {
        method: 'POST',
        body: JSON.stringify({ text: englishText })
    });
    // 更新 UI...
}
```

### 優點
1. **完全控制翻譯行為**：gpt-5-mini 文字 API 不會進入對話模式
2. **符合模型規則**：CLAUDE.md 指定文字控制器使用 gpt-5-mini
3. **簡化架構**：不需要處理 OpenAI Realtime 的複雜事件時序

### 缺點
1. **額外 API 調用**：每個分段一次 HTTP 請求
2. ~~**略增延遲**：約 500-1000ms（但可接受）~~ → 已優化

### 效能優化記錄（2026-02-02）

**問題**：gpt-5-mini 翻譯需要 5-6 秒（reasoning tokens 開銷）

**根因分析**：
- gpt-5-mini 是 reasoning 模型，需要大量 reasoning tokens
- `max_output_tokens: 500` 不夠，reasoning 用完配額後沒有輸出
- 增加到 `max_output_tokens: 2000` 後能翻譯，但需要 5-6 秒

**解決方案**：
1. 改用 Chat Completions API（無 reasoning 開銷）
2. 使用串流回應（SSE）立即顯示部分結果
3. 選擇最快的模型

**模型速度測試**：
| 模型 | 首字回應 | 總時間 |
|------|---------|--------|
| gpt-4.1-nano | **703ms** | 850ms |
| gpt-3.5-turbo | 1235ms | 1358ms |
| gpt-4o-mini | 1377ms | 1506ms |
| gpt-5-mini (Responses API) | ~3000ms | 5000-6000ms |

**最終配置**：
- 模型：`gpt-4.1-nano`（**重要：不可更改，經測試為最快模型**）
- API：Chat Completions + Streaming
- 端點：`/api/translate/stream`
- 預期首字回應：~700ms

**⚠️ 模型選擇警告**：
翻譯必須使用 `gpt-4.1-nano`，原因：
1. 首字回應最快（703ms vs 1235ms+ 其他模型）
2. 翻譯品質足夠好
3. 成本最低

**不可使用的模型**：
- ❌ `gpt-5-mini` - reasoning 模型，太慢（5-6秒）
- ❌ `gpt-4o-mini` - 1377ms，比 nano 慢一倍
- ❌ `gpt-3.5-turbo` - 1235ms，已淘汰

### SmartSegmenter 動態穩定性檢測（2026-02-03）

**問題**：分段在單詞中間切割
- ❌ "gpt4" → "g" + "pt4"
- ❌ "tagline" → "tag" + "line"

**根因**：Web Speech interim results 可能在單詞中間，當 600ms 暫停觸發時切割

**錯誤方案（已棄用）**：hardcode 單詞列表
- ❌ 不可擴展，無法處理動態內容
- ❌ 需要維護大量特例

**正確方案**：動態穩定性檢測（`_scheduleEmit`）
```javascript
// 原理：當偵測到暫停時，不立即發出，而是等待 150ms
// 如果在這 150ms 內有新文字進來，取消發出並重新等待
// 這樣可以動態處理任何內容，不需要 hardcode

process(transcript) {
    // 如果文字有變化，取消待發出的 segment
    if (currentSegmentText !== this.lastBufferSnapshot) {
        if (this.pendingEmit) {
            clearTimeout(this.pendingEmit);
            this.pendingEmit = null;
        }
        this.lastBufferSnapshot = currentSegmentText;
    }
    // ...
}

_scheduleEmit(reason) {
    if (this.pendingEmit) clearTimeout(this.pendingEmit);

    this.pendingEmit = setTimeout(() => {
        this.pendingEmit = null;
        // 文字已穩定 150ms，可以安全發出
        this._emitSegment(reason);
    }, this.stabilityDelay);  // 150ms
}
```

**優點**：
- ✅ 無需 hardcode，可處理任何語言/內容
- ✅ 自動適應 Web Speech 的更新頻率
- ✅ 配置簡單（只需調整 `stabilityDelay`）

### SmartSegmenter 預設模式（2026-02-03）

**背景**：不同用戶說話速度和停頓習慣不同，固定參數無法適合所有人

**解決方案**：提供 5 種預設模式讓用戶自行選擇

| 模式 | pauseThreshold | stabilityDelay | 特點 |
|------|---------------|----------------|------|
| 🚀 極速 | 400ms | 80ms | 最快反應，可能切斷單詞 |
| ⚡ 快速 | 500ms | 100ms | **預設**，快速反應 |
| ⚖️ 平衡 | 600ms | 150ms | 平衡速度與穩定性 |
| 🛡️ 穩定 | 750ms | 200ms | 更穩定，較慢 |
| 🔒 保守 | 900ms | 250ms | 最穩定，最慢 |

**實現**：`eca_parallel_test.html` 頁頂選擇器，即時生效

---

## 目錄

1. [OpenAI Realtime API 相關](#1-openai-realtime-api-相關)
2. [前端架構相關](#2-前端架構相關)
3. [狀態管理相關](#3-狀態管理相關)
4. [UI/UX 相關](#4-uiux-相關)
5. [開發流程相關](#5-開發流程相關)

---

## 1. OpenAI Realtime API 相關

### 1.1 事件名稱錯誤（Beta vs GA）

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | 使用了 Beta 版事件名稱，導致事件監聽失敗 |
| **症狀** | 沒有收到預期的事件回調，功能無反應 |
| **根因** | OpenAI Realtime API 從 Beta 升級到 GA 時，事件名稱有變更，憑記憶寫代碼沒有查證 |
| **解決方案** | 查閱最新官方文檔，使用正確事件名稱 |
| **正確用法** | |

```javascript
// ❌ 錯誤（Beta 版）
dc.addEventListener('response.text.delta', ...)
dc.addEventListener('response.text.done', ...)

// ✅ 正確（GA 版 2025）
dc.addEventListener('response.output_text.delta', ...)
dc.addEventListener('response.output_text.done', ...)
```

| **預防措施** | 1. 開發前必讀 `src/skills/openai-realtime-mini-voice/SKILL.md` |
|           | 2. 不確定時用 WebSearch 搜索最新文檔 |
|           | 3. 用 DevTools 驗證事件名稱再寫業務邏輯 |

---

### 1.2 Session 配置語法錯誤

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | Session 配置欄位名稱錯誤，導致 STT 不工作 |
| **症狀** | 語音輸入後沒有 transcript 輸出 |
| **根因** | GA 版配置結構與 Beta 版不同 |
| **解決方案** | 使用正確的配置結構 |

```javascript
// ❌ 錯誤（Beta 版）
{
  input_audio_transcription: { enabled: true }
}

// ✅ 正確（GA 版）
{
  audio: {
    input: {
      transcription: { model: "gpt-4o-mini-transcribe" }
    }
  }
}
```

| **預防措施** | 參考 SKILL.md 中的 Session 配置範例 |

---

### 1.3 OpenAI 可能跳過某些 Item 的 Transcription

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | OpenAI VAD 發送 `speech_started` 但可能不發送對應的 `transcription` 事件 |
| **症狀** | 翻譯出現在錯誤的段落；某些段落有翻譯但沒有英文原文 |
| **根因** | OpenAI VAD 可能合併或跳過某些語音片段，導致 `speech_started` 和 `transcription` 不是 1:1 對應 |
| **錯誤修復 v1** | 在 `speech_started` 時創建 segment 並加入 FIFO 隊列 → 失敗，因為被跳過的 item 也會佔用隊列位置 |
| **正確修復 v3** | **只在收到 `transcription` 事件時才創建 segment**，`speech_started` 只做標記 |

```javascript
// ❌ 錯誤 v1：speech_started 時創建 segment
_handleSpeechStarted(event) {
  const segment = this.store.getOrCreate(event.item_id);  // 錯！被跳過的 item 也會創建
  this.pendingForResponse.push(event.item_id);  // FIFO 隊列包含沒有英文的 segment
}

// ✅ 正確 v3：speech_started 只標記，不創建
_handleSpeechStarted(event) {
  this.store.markSpeechStarted(event.item_id);  // 只標記
}

// ✅ 正確 v3：transcription 到達時才創建 segment 並加入隊列
_handleTranscriptionDelta(event) {
  const segment = this.store.getOrCreateForTranscription(event.item_id);
  // getOrCreateForTranscription 會：
  // 1. 創建新 segment
  // 2. 加入 pendingForResponse 隊列
  // 3. 確保每個進入隊列的 segment 都有英文內容
}
```

| **預防措施** | 1. **不要假設事件 1:1 對應** — VAD 可能合併/跳過 |
|           | 2. **只在「有內容」時才創建數據結構** — 避免空 segment |
|           | 3. **模擬測試要包含「跳過」場景** — 不只測試正常流程 |
|           | 4. **用實際 API 測試驗證**，模擬事件無法覆蓋所有邊界情況 |

---

### 1.4 response.created 可能先於 transcription.delta 到達

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | v3 修復後仍然出現 "Response has no pending segment" 錯誤 |
| **症狀** | 翻譯結果丟失，segment 沒有收到翻譯內容 |
| **根因** | OpenAI 發送事件順序：`speech_stopped → response.created → transcription.delta`，即 response 先於 transcription 到達 |
| **錯誤假設** | 假設 transcription 一定在 response 之前到達，所以 v3 等待 transcription 創建 segment 後才能關聯 response |
| **正確修復 v4** | **雙向隊列**：當 response 先到但沒有 segment 時，將 response 加入 `pendingResponses` 隊列，等 transcription 創建 segment 時再關聯 |

```javascript
// ✅ 正確 v4：雙向隊列處理任意事件順序
class EnhancedSegmentStore {
  constructor() {
    this.pendingForResponse = [];  // segment 等待 response
    this.pendingResponses = [];    // response 等待 segment（v4 新增）
  }

  // response.created 時：如果沒有 segment，加入 pendingResponses
  claimResponseSlot(responseId) {
    if (this.pendingForResponse.length === 0) {
      this.pendingResponses.push(responseId);  // v4: 保存等待的 response
      return null;
    }
    // 正常關聯...
  }

  // transcription 創建 segment 時：檢查是否有等待的 response
  getOrCreateForTranscription(itemId) {
    const segment = new Segment(itemId);
    if (this.pendingResponses.length > 0) {
      const responseId = this.pendingResponses.shift();
      this.linkResponse(responseId, segment);  // 立即關聯
    } else {
      this.pendingForResponse.push(itemId);  // 等待 response
    }
    return segment;
  }
}
```

| **預防措施** | 1. **不要假設任何事件順序** — API 事件可能以任意順序到達 |
|           | 2. **使用雙向隊列** — 無論誰先到都能正確關聯 |
|           | 3. **模擬測試要覆蓋兩種順序** — transcription 先到 + response 先到 |

---

### 1.5 實時英文字幕必須用 Web Speech API，不是 OpenAI Realtime API

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | OpenAI Realtime API 的 transcription 無法實現「邊說邊顯示」 |
| **症狀** | 用戶說話時沒有英文字幕，必須等語音結束才顯示 |
| **根因** | OpenAI transcription 在 `speech_stopped` 後才處理，不是實時串流 |
| **錯誤嘗試** | 嘗試用 `gpt-4o-mini-transcribe` 期望得到實時串流，但仍是語音結束後才處理 |
| **正確解決方案** | **雙軌策略**（見 spec/research/webspeech_capabilities.md §6.3） |

```
┌─────────────────────────────────────────────────────────┐
│  麥克風音訊                                               │
│    │                                                     │
│    ├──→ Web Speech API ──→ 實時英文字幕（邊說邊顯示）    │
│    │    - 瀏覽器內建，免費                              │
│    │    - onresult + interimResults = true              │
│    │                                                     │
│    └──→ OpenAI Realtime API ──→ 中文翻譯 + 正式記錄     │
│         - 語音結束後處理                                 │
│         - gpt-realtime-mini 翻譯                        │
└─────────────────────────────────────────────────────────┘
```

| **預防措施** | 1. **實時顯示需求必須用 Web Speech API** — OpenAI 無法做到 |
|           | 2. **讀研究文檔** — spec/research/webspeech_capabilities.md 早已說明 |
|           | 3. **雙軌策略是標準做法** — 實時預覽 + 正式記錄分開處理 |

---

### 1.6 translation.delta 在 segment 創建前到達會丟失

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | v4 緩存了 response_id，但 translation.delta 在 segment 創建前到達時被丟棄 |
| **症狀** | segment 有英文但沒有翻譯，或翻譯不完整 |
| **根因** | OpenAI 事件順序：`response.created → translation.delta × N → transcription.delta`，翻譯完成後轉錄才到達 |
| **正確修復 v5** | 緩存 translation delta 內容，segment 創建時應用 |

```javascript
// ✅ v5：緩存翻譯內容
bufferTranslation(responseId, delta) {
  const current = this.pendingTranslations.get(responseId) || '';
  this.pendingTranslations.set(responseId, current + delta);
}

// Handler: 緩存而非丟棄
_handleTranslationDelta(event) {
  const segment = this.store.getByResponseId(event.response_id);
  if (!segment) {
    this.store.bufferTranslation(event.response_id, event.delta);  // 緩存！
    return;
  }
  segment.chineseTranslation += event.delta;
}
```

| **預防措施** | 1. **任何「等待關聯」的數據都要緩存** — 不只是 ID，還有內容 |
|           | 2. **串流數據不可丟棄** — delta 丟失無法恢復 |

---

### 1.7 ~~沒有處理 transcription.delta 事件~~ [已被 §1.5 取代]

> ⚠️ **此節已過時**：原本以為處理 OpenAI 的 `transcription.delta` 可以實現即時英文顯示，
> 但實測發現 OpenAI 的轉錄事件只在 `speech_stopped` 之後才觸發。
>
> **正確解決方案見 §1.5**：使用 Web Speech API 實現即時英文預覽。

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **原始問題** | 英文原文沒有即時逐字顯示，整段說完才出現 |
| **錯誤分析** | 以為是沒處理 `transcription.delta`，其實 OpenAI 根本不支援說話中即時轉錄 |
| **正確根因** | OpenAI Realtime API 的轉錄只在語音結束後才處理（見 §1.5） |
| **正確解決** | 使用 Web Speech API（本地處理，~100ms 延遲）+ OpenAI 作為正式記錄 |

```javascript
// ❌ 錯誤思路：以為處理 transcription.delta 就能即時
// 實際上 OpenAI 的 delta 也是在 speech_stopped 後才觸發

// ✅ 正確做法：雙軌策略
// 1. Web Speech API → 即時英文預覽（邊說邊顯示）
// 2. OpenAI transcription → 最終記錄（更準確但有延遲）
```

| **教訓** | 不要假設 API 行為，必須實測驗證事件觸發時機 |

---

### 1.8 Entry ID 與 Response ID 混淆

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | 翻譯結果出現在錯誤的字幕條目 |
| **症狀** | 英文原文 A 的翻譯出現在條目 B |
| **根因** | Realtime API 有多層 ID：`response.id`、`item.id`、`output[].id`，沒有正確建立映射關係 |
| **解決方案** | 建立明確的 ID 映射表 + FIFO 隊列 |

```javascript
// ✅ 正確做法 v3：雙向索引 + FIFO 隊列（只在有 transcription 時才加入）
class EnhancedSegmentStore {
  constructor() {
    this.segments = new Map();           // item_id → Segment
    this.responseToSegment = new Map();  // response_id → Segment
    this.pendingForResponse = [];        // FIFO 隊列
    this.speechStartedItems = new Set(); // 追蹤已開始但還沒 transcription 的 items
  }

  // speech_started 時只標記，不創建 segment
  markSpeechStarted(itemId) {
    this.speechStartedItems.add(itemId);
  }

  // transcription 到達時才創建 segment 並加入隊列
  getOrCreateForTranscription(itemId) {
    if (this.segments.has(itemId)) return this.segments.get(itemId);
    const segment = new Segment(itemId);
    this.segments.set(itemId, segment);
    this.pendingForResponse.push(itemId);  // 關鍵：只有有英文內容的才加入
    this.speechStartedItems.delete(itemId);
    return segment;
  }

  // response.created 時從隊列取出（FIFO）
  claimResponseSlot(responseId) {
    const itemId = this.pendingForResponse.shift();  // 最早的先出
    const segment = this.segments.get(itemId);
    this.responseToSegment.set(responseId, segment);
    return segment;
  }
}
```

| **預防措施** | 1. 畫出 ID 關係圖再寫代碼 |
|           | 2. 在 console 中 log 所有 ID 確認對應關係 |
|           | 3. 使用 FIFO 隊列處理順序關聯，不依賴事件中的 ID |
|           | 4. **只有確認有內容的 segment 才加入隊列** |

---

### 1.9 response.create 格式錯誤

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | 手動觸發翻譯時收到 `Unknown parameter: 'response.modalities'` 錯誤 |
| **症狀** | `forceTranslation()` 調用後 API 報錯，翻譯不工作 |
| **根因** | 使用了過時的 Beta 版格式 `{ modalities: ['text'] }` |
| **解決方案** | 使用 GA 版格式 `{ conversation: 'auto' }` |

```javascript
// ❌ 錯誤（Beta 版）
{
  type: 'response.create',
  response: {
    modalities: ['text']  // 無效參數
  }
}

// ✅ 正確（GA 版）
{
  type: 'response.create',
  response: {
    conversation: 'auto'
  }
}
```

| **預防措施** | 1. 參考 `src/skills/openai-realtime-mini-voice/SKILL.md` |
|           | 2. API 格式變更時更新 SKILL.md |

---

### 1.10 翻譯模式需要 Few-Shot Priming（模型進入 Q&A 對話模式）

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | 翻譯輸出與英文原文完全無關，模型回應「好的，我明白了。請告訴我您想翻譯的內容...」|
| **症狀** | 第一句總是對話式回應；翻譯內容是通用句子，缺少原文的關鍵實體/數字 |
| **根因** | OpenAI Realtime API 是**對話式模型**，預設會「回應」而非「翻譯」。僅靠 system prompt 不足以引導模型 |
| **解決方案** | 使用 `conversation.item.create` 注入 **few-shot 範例**，在用戶開始說話前建立翻譯模式 |

```javascript
// ✅ 正確做法：Session 建立後注入 few-shot 範例
function injectFewShotExamples() {
    // Example 1: User (English) → Assistant (Chinese translation)
    sendEvent({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'The Prime Minister announced new policies.' }]
        }
    });
    sendEvent({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '首相 (Prime Minister) 宣布了新政策。' }]
            // ⚠️ assistant 用 'output_text'，不是 'text'
        }
    });
    // 可加入更多範例...
}

// 在 session.update 後調用
sendEvent(sessionConfig);
injectFewShotExamples();  // 🔧 關鍵！
```

| **預防措施** | 1. **翻譯場景必須使用 few-shot priming** — 單靠 instructions 不夠 |
|           | 2. 範例應包含目標格式（如專有名詞+英文對照、數字格式）|
|           | 3. 參考 OpenAI Cookbook: [One-Way Translation](https://cookbook.openai.com/examples/voice_solutions/one_way_translation_using_realtime_api) |

---

## 2. 前端架構相關

### 2.1 SmartSegmenter Buffer 累積錯誤（Web Speech 累積特性）

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | SmartSegmenter 的 buffer 字數不斷增長（9w → 100w+），導致分段失效 |
| **症狀** | 同一段話重複觸發多次分段；`input_audio_buffer_commit_empty` 錯誤 |
| **根因** | Web Speech API 的 `fullText` 是從 session 開始累積的，SmartSegmenter 錯誤地將整個累積文字存入 buffer |
| **解決方案** | 追蹤 `processedLength`，只處理新增的文字 |

```javascript
// ❌ 錯誤：buffer 存儲整個累積文字
process(transcript) {
  this.buffer = transcript;  // 第一次 "hello" = 1 word
                             // 第二次 "hello world" = 2 words
                             // ... 越來越長！
  this.wordCount = this._countWords(this.buffer);
}

// ✅ 正確：只存儲當前分段
constructor() {
  this.processedLength = 0;  // 追蹤已處理位置
}

process(transcript) {
  const currentSegment = transcript.slice(this.processedLength);
  this.buffer = currentSegment;  // 只有當前分段
  this.wordCount = this._countWords(this.buffer);
}

_emitSegment() {
  // 輸出後更新 processedLength
  this.processedLength = this._currentTranscriptLength;
  this._resetBuffer();  // 只重置 buffer，不重置 processedLength
}
```

| **預防措施** | 1. **理解 Web Speech API 特性** — fullText 是累積的，不是每次獨立的 |
|           | 2. **分段器需要追蹤「已處理位置」** — 避免重複處理 |
|           | 3. **區分「完全重置」和「分段重置」** — reset() vs _resetBuffer() |

---

### 2.2 SmartSegmenter 頻繁觸發導致 API 錯誤

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | SmartSegmenter 每秒觸發多次 `forceTranslation()`，導致 `input_audio_buffer_commit_empty` |
| **症狀** | 控制台大量 "Force translation triggered" 日誌；API 返回空 buffer 錯誤 |
| **根因** | 1. Buffer 累積錯誤導致反覆觸發 hardLimit<br>2. 沒有防抖機制，每個分段立即調用 API |
| **解決方案** | 1. 修復 buffer 累積問題（見 §2.1）<br>2. 添加防抖機制（最少 500ms 間隔） |

```javascript
// ❌ 錯誤：無限制調用
smartSegmenter.onSegment = (segment) => {
  forceTranslation();  // 可能每秒調用 10+ 次
};

// ✅ 正確：防抖機制
let lastForceTranslationTime = 0;
const MIN_TRANSLATION_INTERVAL = 500;  // 最少 500ms 間隔

function forceTranslation() {
  const now = Date.now();
  if (now - lastForceTranslationTime < MIN_TRANSLATION_INTERVAL) {
    return;  // 太頻繁，跳過
  }
  lastForceTranslationTime = now;

  // 執行 API 調用...
}
```

| **預防措施** | 1. **任何觸發 API 調用的事件都需要防抖** |
|           | 2. **OpenAI audio buffer 需要足夠音訊才能 commit** — 太快會得到空 buffer |
|           | 3. **日誌中出現重複事件時要警覺** — 可能是觸發機制有問題 |

---

### 2.3 單文件過大難以維護

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | `app.js` 膨脹到 1961 行，難以維護和調試 |
| **症狀** | 修改一處經常影響其他功能，bug 難以定位 |
| **根因** | 沒有模組化，所有邏輯堆在一個文件 |
| **解決方案** | 按職責拆分模組 |

```
// ✅ 正確做法：職責分離
app.js              → 主入口（僅協調）
realtime-client.js  → API 連接
entry-manager.js    → 數據/狀態管理
ui-renderer.js      → UI 渲染
```

| **預防措施** | 1. 單文件不超過 300 行 |
|           | 2. 開發前先定義模組邊界 |
|           | 3. 每個模組有單一職責 |

---

### 2.2 新舊代碼混雜

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | M1（協商模式）代碼和 M2（翻譯模式）代碼混在一起 |
| **症狀** | 無法確定哪些代碼還在使用，修改怕破壞功能 |
| **根因** | 轉型時沒有清理舊代碼 |
| **解決方案** | 重寫而非修補 |

| **預防措施** | 1. 架構大改時，優先考慮重寫 |
|           | 2. 舊代碼移到 `_archive/` 目錄 |
|           | 3. 不要在舊架構上疊加新邏輯 |

---

## 3. 狀態管理相關

### 3.1 狀態永久卡住

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | UI 顯示「等待語音...」永遠不結束 |
| **症狀** | 用戶以為系統當機 |
| **根因** | 狀態轉換只靠事件觸發，沒有超時保護 |
| **解決方案** | 每個狀態設置超時 |

```javascript
// ✅ 正確做法：超時保護
class Entry {
  constructor() {
    this.status = 'listening';
    this.timeoutId = setTimeout(() => {
      if (this.status === 'listening') {
        this.setStatus('error', '未檢測到語音');
      }
    }, 10000);  // 10 秒超時
  }

  setStatus(newStatus, errorMsg) {
    clearTimeout(this.timeoutId);
    this.status = newStatus;
    if (newStatus === 'transcribing') {
      this.timeoutId = setTimeout(() => {
        this.setStatus('error', '識別超時');
      }, 15000);
    }
    // ...
  }
}
```

| **預防措施** | 1. 任何「等待」狀態必須有超時 |
|           | 2. 超時後提供明確的錯誤信息 |
|           | 3. 測試時模擬超時情況 |

---

### 3.2 OpenAI 可能跳過 Segment

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-02 |
| **問題** | 某些 Segment 有 `speech_started` 但沒有 `transcription.completed` |
| **症狀** | Segment 永久卡在「🎤 聆聽中...」或「📝 轉錄中...」 |
| **根因** | OpenAI VAD 可能將多個短語音合併，或認為某段沒有有效內容而跳過 |
| **解決方案** | 1. 減少超時時間（15秒而非30秒）<br>2. 超時後自動進入錯誤狀態 |

```javascript
// ✅ 正確做法：合理的超時設置
const STATUS_TIMEOUTS = {
  'listening': 15000,     // 15 秒（快速檢測被跳過的 segment）
  'transcribing': 15000,  // 15 秒
  'translating': 30000    // 30 秒
};

class Segment {
  constructor() {
    this._startTimeout();  // 創建時就開始計時
  }

  _startTimeout() {
    const timeout = STATUS_TIMEOUTS[this.status];
    this.timeoutId = setTimeout(() => {
      this.setStatus('error', `超時（${this.status}）`);
    }, timeout);
  }
}
```

| **預防措施** | 1. **永遠不要假設事件一定會到達** |
|           | 2. 每個「等待」狀態都要有超時 |
|           | 3. 超時時間要根據實際測試調整（不要太長） |
|           | 4. 超時後提供降級處理（如顯示已有的英文原文） |

---

### 3.3 狀態轉換無驗證

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | 狀態可以從任意狀態跳到任意狀態 |
| **症狀** | 出現不合理的狀態序列，如 `done → listening` |
| **根因** | 沒有定義合法的狀態轉換路徑 |
| **解決方案** | 狀態機模式 + 轉換驗證 |

```javascript
// ✅ 正確做法：定義合法轉換
const VALID_TRANSITIONS = {
  'listening': ['transcribing', 'error'],
  'transcribing': ['translating', 'error'],
  'translating': ['done', 'error'],
  'done': [],  // 終態
  'error': []  // 終態
};

function setStatus(newStatus) {
  const validNext = VALID_TRANSITIONS[this.status];
  if (!validNext.includes(newStatus)) {
    console.error(`Invalid transition: ${this.status} → ${newStatus}`);
    return false;
  }
  this.status = newStatus;
  return true;
}
```

| **預防措施** | 1. 先畫狀態圖再寫代碼 |
|           | 2. 狀態轉換必須經過驗證函數 |
|           | 3. 非法轉換要 log 警告 |

---

## 4. UI/UX 相關

### 4.1 條目排序混亂

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | 字幕條目顯示順序不符合時間順序 |
| **症狀** | 09:39 的內容出現在 09:38 之前 |
| **根因** | 在列表中間插入新條目，或使用不一致的排序邏輯 |
| **解決方案** | 統一排序規則 |

```javascript
// ✅ 正確做法
// 1. 新條目永遠 push 到末尾
entries.push(newEntry);

// 2. 渲染時按 timestamp 排序
const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

// 3. 使用穩定的 timestamp（創建時設定，不修改）
class Entry {
  constructor() {
    this.timestamp = Date.now();  // 只設一次
  }
}
```

| **預防措施** | 1. 不要在數組中間 insert |
|           | 2. timestamp 創建後不修改 |
|           | 3. 排序邏輯集中在一處 |

---

### 4.2 串流顯示閃爍

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | 串流文字輸出時 UI 閃爍 |
| **症狀** | 每個 delta 都觸發整個列表重繪 |
| **根因** | 沒有差異更新，每次都替換整個 DOM |
| **解決方案** | 只更新變化的部分 |

```javascript
// ❌ 錯誤：整個列表重繪
function render() {
  container.innerHTML = entries.map(e => `<div>...</div>`).join('');
}

// ✅ 正確：只更新變化的文字節點
function updateEntryText(entryId, field, text) {
  const el = document.querySelector(`[data-entry-id="${entryId}"] .${field}`);
  if (el) el.textContent = text;
}
```

| **預防措施** | 1. 串流場景使用 textContent 更新 |
|           | 2. 避免頻繁操作 innerHTML |
|           | 3. 考慮使用 Virtual DOM 或 React |

---

## 5. 開發流程相關

### 5.1 憑記憶寫 API 調用

| 項目 | 內容 |
|------|------|
| **日期** | 2026-01 |
| **問題** | 直接憑記憶寫 API 代碼，導致語法錯誤 |
| **症狀** | 代碼運行時報錯或無反應 |
| **根因** | 沒有查閱文檔就開始寫代碼 |
| **解決方案** | 強制執行「先查後寫」流程 |

| **預防措施** | 見 CLAUDE.md「API/SDK 開發規則」 |

```
開發流程：
1. 先讀 src/skills/ 下的 SKILL.md
2. Skill 不完整 → WebSearch 搜索官方文檔
3. 用 DevTools 實測驗證
4. 確認後才寫業務代碼
```

---

### 5.2 修補式開發導致技術債

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | 多次修補同一問題，每次修補引入新 bug |
| **症狀** | 代碼越改越亂，最終無法維護 |
| **根因** | 沒有理解根因就開始修復，治標不治本 |
| **解決方案** | 根因分析 → 設計 → 實現 |

| **預防措施** | 1. 修復前先做根因分析 |
|           | 2. 同一問題修復超過 2 次，考慮重寫 |
|           | 3. 重大修改前先寫設計文檔 |

---

### 5.3 沒有記錄經驗教訓

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-01 |
| **問題** | 遇到的問題沒有記錄，導致重複犯錯 |
| **症狀** | 同樣的問題反覆出現 |
| **根因** | 解決問題後急於繼續開發，沒有停下來記錄 |
| **解決方案** | 建立本文檔，強制記錄 |

| **預防措施** | 1. 解決重大問題後，立即更新本文檔 |
|           | 2. 開發前先閱讀本文檔 |
|           | 3. Code Review 時檢查是否有已知問題 |

---

## §5. 方案 A 架構問題

### 5.1 孤兒 Segment 問題（2026-02-04）

**問題描述**：
測試時出現只有英文、沒有翻譯的「孤兒 segment」，顯示狀態停留在「📝 識別中...」或「📝 轉錄中...」。

**根因**：
在「方案 A」架構中，有**兩個獨立的來源**在創建 UI segments：

| 來源 | 觸發時機 | 創建 Segment | 觸發翻譯 |
|------|---------|-------------|---------|
| **SmartSegmenter** | 停頓偵測 (500-900ms) | ✅ | ✅ `translateViaBackend()` |
| **RealtimeEventHandler** | OpenAI `transcription.completed` | ✅ | ❌ 無 |

當 OpenAI 轉錄事件在 SmartSegmenter 停頓偵測之前觸發時，`RealtimeEventHandler` 會創建一個 segment，但這個 segment 沒有觸發翻譯 API，導致孤兒 segment。

**解決方案**：
```javascript
// ⚠️ 方案 A 架構：UI 渲染由 SmartSegmenter 的 translateViaBackend() 控制
// RealtimeEventHandler 只記錄日誌，不渲染 UI segments
eventHandler.onSegmentUpdate = (segment) => {
    // 不渲染 OpenAI 的 segments
    // renderer.queueUpdate(segment);
    // updateStats();
};
```

**關鍵教訓**：
- 在方案 A 中，**SmartSegmenter 是唯一的 segment 創建者**
- `RealtimeEventHandler` 只用於日誌和後備，不應渲染 UI
- 避免多個來源創建相同的 UI 元素

### 5.2 gpt-5-mini 是 Reasoning 模型，參數限制不同（2026-02-04）

**問題描述**：
講稿生成 API 調用 `gpt-5-mini` 時返回 400 錯誤：
```
Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.
```

**根因**：
`gpt-5-mini` 是 reasoning 模型（類似 o3-mini、o4-mini），與一般 chat 模型（gpt-4o、gpt-4.1-nano）的 API 參數不同。

**不支援的參數**：
| ❌ 不支援 | ✅ 替代方案 |
|-----------|------------|
| `temperature` | 無（reasoning 模型不支援溫度控制）|
| `top_p` | 無 |
| `max_tokens` | `max_completion_tokens`（Chat Completions API）|
| `presence_penalty` | 無 |
| `frequency_penalty` | 無 |

**支援的特殊參數**：
- `reasoning_effort`: `"none"` / `"minimal"` / `"low"` / `"medium"` / `"high"`
  - 控制 reasoning tokens 數量，影響速度和品質
  - 講稿生成建議用 `"low"`（速度優先）
- `response_format`: `{"type": "json_object"}` 或 `{"type": "json_schema", ...}` — 支援
- `max_completion_tokens`: 上限 4096（包含 reasoning tokens + output tokens）

**正確用法**：
```python
# ✅ gpt-5-mini 正確調用
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[...],
    max_completion_tokens=500,
    reasoning_effort="low",
    response_format={"type": "json_object"}
)

# ❌ 錯誤：不支援 temperature 和 max_tokens
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[...],
    temperature=0.7,      # ❌ 不支援
    max_tokens=500,        # ❌ 用 max_completion_tokens
)
```

**影響文件**：`src/backend/script_generator.py`（3 處 API 調用已修復）

**預防措施**：
1. **Reasoning 模型與 Chat 模型參數不同** — 開發前確認模型類型
2. **查閱 SKILL.md 或官方文檔** — 不要憑記憶假設參數
3. **gpt-5-mini 用於文字生成時** — 設 `reasoning_effort="low"` 減少 reasoning 開銷

### 5.3 T2.2 講稿生成 UX 重新設計（2026-02-05）

| 項目 | 內容 |
|------|------|
| **日期** | 2026-02-05 |
| **問題** | T2.2 原設計「通話中打字輸入 → 生成講稿 → 用戶照唸」在真實使用場景下不可行 |
| **症狀** | 通話中打字需要 5-10 秒沉默，對方會以為斷線；生成的講稿缺少對話上下文，可能答非所問 |

**根因分析（2 個致命問題）**：

| 問題 | 嚴重性 | 說明 |
|------|--------|------|
| 通話中打字不實用 | 致命 | 打字需要 5-10 秒沉默，對方會問「Are you still there?」 |
| 無對話上下文 | 致命 | 用戶輸入中文時，系統不知道對方剛說了什麼，生成結果可能完全不相關 |

**後端 API 評估**：
- `script_generator.py` + `POST /api/script/stream` — 後端品質良好，支持場景/語調/歷史
- 問題完全在前端交互模型，不在後端

**解決方案**：重新定位為「通話前準備 + 通話中一鍵調用」

```
原設計（不實用）：
  通話中 → 打字輸入中文 → 等待生成 → 讀講稿
  問題：5-10秒沉默、無上下文、壓力下難以打字

新設計（實用）：
  通話前 → 從容輸入中文 → 生成講稿 → 保存為卡片
  通話中 → 一鍵點擊卡片 → Teleprompter 大字顯示
  問題全部解決：不需打字、有時間準備、零延遲調用
```

**影響範圍**：

| 組件 | 決定 | 原因 |
|------|------|------|
| `script_generator.py` | **保留不變** | 後端 API 品質良好 |
| 前端 textarea（通話中） | **移除** | 不再支持通話中打字輸入 |
| 前端新增：通話前準備畫面 | **新增** | 場景選擇 + 詞彙預覽 + 講稿生成 + 保存 |
| 前端新增：Quick Response Bar | **新增** | 取代 textarea，整合已準備講稿 + 快捷短語 + Panic Button |
| 前端新增：Teleprompter | **新增** | 統一大字顯示組件 |
| T2.3 Panic Button | **整合到 Quick Response Bar** | 不再獨立浮動，成為底部欄一部分 |
| T2.4 快捷短語 | **整合到 Quick Response Bar** | 與講稿卡片和 Panic Button 並列 |
| T2.3.2 TTS | **移至 Phase 3** | MVP 優先文字顯示 |

**關鍵教訓**：

> **在建構功能之前，必須驗證交互模型在真實使用約束下是否可行。**
> 如果用戶在高壓環境下（如通話中）需要使用某功能，
> 該功能的交互延遲必須 < 1 秒（不包含打字時間）。
> 任何需要用戶停下來思考 + 打字的交互，都應該放在低壓環境（通話前）完成。

| **預防措施** | 1. 設計前先做「壓力測試」— 模擬真實使用場景的時間壓力 |
|           | 2. 如果功能需要用戶打字，確認用戶有時間打字（通話前 vs 通話中） |
|           | 3. 通話中的操作只能是「一鍵」或「零操作」（自動觸發） |
|           | 4. 後端 API 與前端 UX 是獨立的 — 後端好不代表 UX 好 |

---

## ✅ MVP 功能驗收記錄（2026-02-06）

### 測試方法
使用 Chrome DevTools MCP 進行自動化 UI 測試，驗證所有 MVP 功能。

### 測試結果

| 功能 | 狀態 | 備註 |
|------|------|------|
| 場景選擇 | ✅ 通過 | 5 個場景卡片正常顯示 |
| 講稿生成 | ✅ 通過 | API 調用 + SSE 串流正常 |
| 講稿儲存 | ✅ 通過 | localStorage 持久化正常 |
| 模式切換 | ✅ 通過 | 準備模式 ↔ 通話模式 |
| Quick Response Bar | ✅ 通過 | 講稿卡片 + 快捷短語顯示正常 |
| Panic Button | ✅ 通過 | 拖延語顯示 + 講稿提示 |
| Teleprompter Overlay | ✅ 通過 | 大字顯示、中英對照 |
| 結束通話 | ✅ 通過 | 返回準備模式，狀態正確 |

### 待測試項目
- [ ] 真實語音翻譯（需要麥克風輸入）
- [ ] 手機版響應式 UI
- [ ] 長時間 session 穩定性

---

## 翻譯品質改良記錄（2026-02-07）

### 6.1 數字保持阿拉伯數字規則

**問題**：翻譯結果中的數字、金額、日期如果轉換成中文（如「五百英鎊」），會：
1. 難以快速核對
2. 增加驗證複雜度（需要解析中文數字）
3. 可能因轉換錯誤導致誤解

**解決方案**：在翻譯 prompt 中明確要求保持阿拉伯數字：

```python
CRITICAL - Keep ALL numbers in Arabic numerals, NEVER convert to Chinese:
- Currency: £500, $1,000, 50p → keep as-is
- Dates: 15th March → 3月15日 (NOT 三月十五日)
- Times: 2:30pm → 下午2:30 (NOT 下午兩點半)
- Percentages: 5% → 5% (NOT 百分之五)
- Phone numbers: 020 7123 4567 → keep as-is
- Reference numbers: ABC123 → keep as-is
```

**效果**：
- ✅ 用戶可快速核對數字
- ✅ 驗證器可準確比對
- ✅ 避免中文數字解析錯誤

### 6.2 場景詞庫整合策略

**問題**：翻譯 API 不知道對話場景，可能誤譯領域術語（如 NHS "surgery" 譯為「手術」而非「診所」）

**解決方案**：Prompt Injection 策略

```python
# 在翻譯 prompt 中注入詞庫提示
glossary_hint = get_glossary_hint(text, scenario)  # "direct debit" = "直接付款授權"
if glossary_hint:
    system_prompt += f"\n\nKey terms: {glossary_hint}"
```

**效果**：
- ✅ 領域術語翻譯更準確
- ✅ 延遲增加極小（~50ms）
- ✅ 不需要額外 API 調用

### 6.3 翻譯驗證啟發式方法

**問題**：翻譯可能出錯，但 gpt-4.1-nano 串流模式不提供 logprobs

**解決方案**：前端啟發式驗證

```javascript
class TranslationValidator {
    validate(sourceText, translatedText) {
        // 1. 數字比對
        const sourceNums = extractNumbers(sourceText);
        const targetNums = extractNumbers(translatedText);
        // 檢查是否有遺漏

        // 2. 信心評分
        // - 長度比例異常（<0.2 或 >4.0）
        // - 未翻譯英文（Chinese 中有 English words）
        // - AI 失敗語句（"我無法", "抱歉"）
        // - 原文 = 譯文（沒有翻譯）
    }
}
```

**效果**：
- ✅ 數字錯誤檢測率高
- ✅ 低信心翻譯有警告
- ✅ 零額外 API 成本

---

## 更新日誌

| 日期 | 更新內容 |
|------|---------|
| 2026-02-07 | 新增翻譯品質改良記錄（§6.1 數字規則、§6.2 詞庫整合、§6.3 驗證方法）|
| 2026-02-06 | 新增 MVP 功能驗收記錄（Chrome DevTools MCP 測試通過）|
| 2026-02-05 | 新增 §5.3 T2.2 講稿生成 UX 重新設計（通話前準備 + Quick Response Bar）|
| 2026-02-04 | 新增 §5.2 gpt-5-mini reasoning 模型參數限制（max_tokens → max_completion_tokens）|
| 2026-02-04 | 新增 §5.1 孤兒 Segment 問題（方案 A 雙來源衝突）|
| 2026-02-03 | 新增 SmartSegmenter 動態穩定性檢測、5 種預設模式（預設為「快速」）|
| 2026-02-02 | 新增 §1.10 翻譯模式需要 Few-Shot Priming（Q&A 對話模式問題）|
| 2026-02-02 | 新增 §1.9 response.create 格式錯誤、§2.1 SmartSegmenter Buffer 累積錯誤、§2.2 頻繁觸發 API 錯誤 |
| 2026-02-02 | 新增 §1.3 Response 事件時序假設錯誤、§1.4 沒有處理 transcription.delta、§3.2 OpenAI 可能跳過 Segment |
| 2026-02-01 | 初版建立，記錄 M1→M2 轉型期間的問題 |

---

*本文檔是活文檔，持續更新。*
