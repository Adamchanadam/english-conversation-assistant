# 經驗教訓記錄 (Lessons Learned)

> 目的：系統性記錄開發過程中遇到的問題、根因分析、解決方案，避免重複犯錯，持續改進。
>
> 更新原則：每次遇到重大問題或解決後，立即記錄。

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

## 2. 前端架構相關

### 2.1 單文件過大難以維護

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

## 更新日誌

| 日期 | 更新內容 |
|------|---------|
| 2026-02-02 | 新增 §1.3 Response 事件時序假設錯誤、§1.4 沒有處理 transcription.delta、§3.2 OpenAI 可能跳過 Segment |
| 2026-02-01 | 初版建立，記錄 M1→M2 轉型期間的問題 |

---

*本文檔是活文檔，持續更新。*
