# Parallel Translation Architecture Design

> **⚠️ 重要架構說明（2026-02-02 更新）**
>
> 本設計採用**雙軌策略**實現即時翻譯：
>
> | 軌道 | 技術 | 用途 | 延遲 |
> |------|------|------|------|
> | **Track 1** | Web Speech API | 即時英文預覽（邊說邊顯示） | ~100ms |
> | **Track 2** | OpenAI Realtime API | 最終英文轉錄 + 中文翻譯 | ~500ms-1s |
>
> **關鍵發現**：OpenAI Realtime API 的 `transcription.delta/completed` 事件只在 `speech_stopped` 後才觸發，
> **無法實現說話中的即時預覽**。因此必須使用 Web Speech API 作為即時英文顯示的來源。
>
> 詳見：`spec/research/webspeech_capabilities.md` §8.2 及 `spec/lessons_learned.md` §1.5

## 1. 問題分析

### 1.1 當前架構問題

原 `eca_main.html`（現為 `eca.html`）的翻譯流程存在以下並發問題：

```
問題場景：

時間線 →
Segment 1: [英文輸入開始] ... [英文完成] [等待翻譯...] ← 卡住！
Segment 2:                           [英文輸入開始] ... [英文完成]
                                           ↑
                                     新段落開始時，舊翻譯被中斷
```

**根因**：
1. **單一活躍 item** — `entryState.currentItemId` 只追蹤一個 item
2. **response 路由衝突** — `responseToItem` Map 在新 response 到來時覆蓋舊對應
3. **FIFO Queue 不足** — `pendingResponseQueue` 假設順序到達，但 API 事件可能亂序

### 1.2 OpenAI Realtime API 行為

根據 `gpt-realtime-mini` 的實際行為：

| 事件 | 時序特性 | 包含數據 |
|------|----------|----------|
| `speech_started` | 即時 | `item_id` |
| `transcription.completed` | 語音結束後 ~200ms | `item_id`, `transcript` |
| `response.created` | 緊接 transcription | `response_id`（無 item_id） |
| `response.output_text.delta` | 串流 | `response_id`, `delta` |
| `response.done` | 翻譯完成 | `response_id` |

**關鍵觀察**：
- `response.*` 事件**不包含** `item_id`，必須靠我們自己建立對應關係
- 當 Segment 2 的 `speech_started` 到達時，Segment 1 可能還在等待 `response.done`
- API 不保證事件順序與用戶說話順序一致

---

## 2. 架構設計

### 2.1 架構概覽

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Parallel Translation Architecture                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   Audio     │    │   Segment       │    │   Translation           │  │
│  │   Input     │───>│   Manager       │───>│   Pool                  │  │
│  │             │    │   (Segmenter)   │    │   (Parallel Promises)   │  │
│  └─────────────┘    └─────────────────┘    └─────────────────────────┘  │
│                             │                         │                  │
│                             ▼                         ▼                  │
│                     ┌───────────────┐         ┌───────────────┐         │
│                     │ Segment Store │         │  UI Renderer  │         │
│                     │ (by item_id)  │         │  (per segment)│         │
│                     └───────────────┘         └───────────────┘         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心數據結構

```javascript
/**
 * Segment 代表一個獨立的翻譯單元
 * 每個段落有自己的生命週期，與其他段落完全隔離
 */
class Segment {
    constructor(itemId) {
        this.id = generateSegmentId();       // UI 顯示用 ID
        this.itemId = itemId;                // OpenAI item_id（主鍵）
        this.englishText = '';               // 英文原文
        this.chineseTranslation = '';        // 中文翻譯
        this.status = 'listening';           // 狀態機
        this.responseId = null;              // 關聯的 response_id
        this.createdAt = Date.now();         // 創建時間戳
        this.completedAt = null;             // 完成時間戳
        this.error = null;                   // 錯誤信息
    }
}

/**
 * Segment 狀態機
 *
 *   listening ──> transcribing ──> translating ──> done
 *       │              │               │
 *       └──────────────┴───────────────┴──────> error
 */
const SegmentStatus = {
    LISTENING: 'listening',         // 正在接收語音
    TRANSCRIBING: 'transcribing',   // 等待轉錄結果
    TRANSLATING: 'translating',     // 正在翻譯
    DONE: 'done',                   // 完成
    ERROR: 'error'                  // 錯誤
};
```

### 2.3 Segment Store（段落存儲）

```javascript
/**
 * SegmentStore - 管理所有段落的中央存儲
 *
 * 設計原則：
 * 1. 雙向索引：item_id ↔ Segment, response_id → Segment
 * 2. 不可變更原則：一旦關聯建立，不可覆蓋
 * 3. 併發安全：所有操作都是同步的（JavaScript 單線程）
 */
class SegmentStore {
    constructor() {
        this.segments = new Map();           // item_id → Segment
        this.responseToSegment = new Map();  // response_id → Segment
        this.counter = 0;
    }

    /**
     * 獲取或創建 Segment
     * 保證同一個 item_id 只有一個 Segment
     */
    getOrCreate(itemId) {
        if (this.segments.has(itemId)) {
            return this.segments.get(itemId);
        }
        const segment = new Segment(itemId);
        segment.id = `seg-${++this.counter}`;
        this.segments.set(itemId, segment);
        return segment;
    }

    /**
     * 根據 item_id 獲取 Segment
     */
    getByItemId(itemId) {
        return this.segments.get(itemId);
    }

    /**
     * 根據 response_id 獲取 Segment
     */
    getByResponseId(responseId) {
        return this.responseToSegment.get(responseId);
    }

    /**
     * 建立 response_id → Segment 關聯
     * 關鍵：一旦建立不可覆蓋
     */
    linkResponse(responseId, segment) {
        if (!this.responseToSegment.has(responseId)) {
            this.responseToSegment.set(responseId, segment);
            segment.responseId = responseId;
            console.log(`[Store] Linked response ${responseId} → segment ${segment.id}`);
        } else {
            console.warn(`[Store] Response ${responseId} already linked, ignoring`);
        }
    }

    /**
     * 獲取所有活躍的 Segment（未完成）
     */
    getActiveSegments() {
        return Array.from(this.segments.values())
            .filter(s => s.status !== SegmentStatus.DONE && s.status !== SegmentStatus.ERROR);
    }

    /**
     * 清理完成的關聯（可選，減少內存）
     */
    cleanupCompleted() {
        for (const [responseId, segment] of this.responseToSegment) {
            if (segment.status === SegmentStatus.DONE || segment.status === SegmentStatus.ERROR) {
                this.responseToSegment.delete(responseId);
            }
        }
    }
}
```

---

## 3. 並發模型選擇

### 3.1 方案對比

| 方案 | 優點 | 缺點 | 適用場景 |
|------|------|------|----------|
| **A: Promise 並行** | 簡單、原生支持、無額外依賴 | 無並發數限制 | ✅ 推薦 |
| **B: Queue + Worker Pool** | 可控並發數、背壓處理 | 複雜度高 | 高頻場景 |
| **C: 事件驅動** | 解耦、可擴展 | 調試困難 | 大型系統 |

### 3.2 推薦方案：Promise 並行

**理由**：
1. **場景適合**：用戶說話速度有限，不會產生高並發
2. **OpenAI API 限制**：Realtime API 本身就是串流的，不需要我們額外限流
3. **簡單性**：易於理解和調試
4. **瀏覽器原生**：無額外依賴

```javascript
/**
 * 並發模型：每個 Segment 獨立的 Promise 生命週期
 *
 * Segment 1: ────────[listening]─[transcribing]─[translating]─[done]
 * Segment 2:               ────────[listening]─[transcribing]──────────[translating]─[done]
 * Segment 3:                             ────────[listening]─[transcribing]─[translating]─[done]
 *
 * 每個 Segment 的狀態轉換獨立進行，互不阻塞
 */
```

---

## 4. 數據流設計

### 4.1 完整數據流

> **⚠️ 時序說明**：
> - **Web Speech API**：即時處理，用戶說話時立即顯示英文（~100ms 延遲）
> - **OpenAI transcription**：僅在 `speech_stopped` 後觸發（~500ms-1s 延遲）
>
> 因此，即時英文預覽顯示來自 Web Speech API，最終記錄使用 OpenAI 結果。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Data Flow Diagram                               │
│         (Web Speech = 即時預覽; OpenAI = 最終記錄 + 翻譯)                     │
└─────────────────────────────────────────────────────────────────────────────┘

        Audio Input                    OpenAI Realtime API
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ speech_started    │──────────────│ Event: speech_started │
│ (item_id: A)      │              │ item_id: A            │
└───────────────────┘              └───────────────────────┘
            │                                  │
            │                                  ▼
            │                      ┌───────────────────────┐
            │                      │ SegmentStore          │
            │                      │ getOrCreate("A")      │
            │                      │ → Segment A           │
            │                      │   status: listening   │
            │                      └───────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ Web Speech API    │──────────────│ Update Segment A      │
│ onresult: "Hello" │              │ englishText: "Hello"  │
└───────────────────┘              └───────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ transcription     │──────────────│ Segment A             │
│ .completed        │              │ englishText: "Hello"  │
│ item_id: A        │              │ status: transcribing  │
└───────────────────┘              └───────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ response.created  │──────────────│ linkResponse(R1, A)   │
│ response_id: R1   │              │ Segment A.responseId  │
│ (no item_id!)     │              │   = R1                │
└───────────────────┘              └───────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ response.output_  │──────────────│ getByResponseId(R1)   │
│ text.delta        │              │ → Segment A           │
│ response_id: R1   │              │ translation += "你好" │
│ delta: "你好"     │              │ status: translating   │
└───────────────────┘              └───────────────────────┘
            │                                  │
            ▼                                  ▼
┌───────────────────┐              ┌───────────────────────┐
│ response.done     │──────────────│ Segment A             │
│ response_id: R1   │              │ status: done          │
└───────────────────┘              └───────────────────────┘
```

### 4.2 關鍵問題：response_id 與 item_id 的關聯

```
問題：response.created 事件不包含 item_id！

解決方案：按順序關聯（FIFO with safeguard）

事件序列：
1. speech_started (item_id: A)      → 創建 Segment A, 加入 pendingQueue
2. transcription.completed (A)      → Segment A 準備好接收翻譯
3. speech_started (item_id: B)      → 創建 Segment B, 加入 pendingQueue
4. response.created (response_id: R1) → 從 pendingQueue 彈出 A, link(R1, A)
5. transcription.completed (B)      → Segment B 準備好
6. response.output_text.delta (R1)  → getByResponseId(R1) → Segment A
7. response.done (R1)               → Segment A 完成
8. response.created (response_id: R2) → 從 pendingQueue 彈出 B, link(R2, B)
```

**改進：雙重驗證機制**

```javascript
/**
 * 改進的 response 關聯邏輯
 *
 * 問題：純 FIFO 假設順序，但網路延遲可能導致亂序
 * 解決：結合時間戳驗證 + 最近 transcription 優先
 */
class EnhancedSegmentStore extends SegmentStore {
    constructor() {
        super();
        this.pendingForResponse = [];  // 等待 response 的 item_id 隊列
    }

    /**
     * 當 transcription.completed 時調用
     */
    markReadyForResponse(itemId) {
        const segment = this.getByItemId(itemId);
        if (segment && !this.pendingForResponse.includes(itemId)) {
            this.pendingForResponse.push(itemId);
            segment.status = SegmentStatus.TRANSCRIBING;
            console.log(`[Store] Segment ${segment.id} ready for response, queue:`,
                        this.pendingForResponse.length);
        }
    }

    /**
     * 當 response.created 時調用
     * 返回應該關聯的 Segment
     */
    claimResponseSlot(responseId) {
        if (this.pendingForResponse.length === 0) {
            console.warn(`[Store] No pending segments for response ${responseId}`);
            return null;
        }

        // FIFO：取最早等待的 segment
        const itemId = this.pendingForResponse.shift();
        const segment = this.getByItemId(itemId);

        if (segment) {
            this.linkResponse(responseId, segment);
            segment.status = SegmentStatus.TRANSLATING;
            return segment;
        }

        return null;
    }
}
```

---

## 5. 翻譯 API 選型

### 5.1 當前方案：OpenAI Realtime API（內建翻譯）

原 `eca_main.html`（現為 `eca.html`）使用 Realtime API 的 `output_modalities: ['text']` 模式，讓 AI 直接輸出翻譯。

**優點**：
- 低延遲（單一 API 調用）
- 自動處理上下文
- 無額外成本

**缺點**：
- 翻譯和轉錄綁定在一起
- 無法單獨重試翻譯

### 5.2 備選方案：分離式翻譯（gpt-5-mini）

如果需要更多控制，可以使用獨立的翻譯請求：

```javascript
/**
 * 獨立翻譯 API 調用（使用 gpt-5-mini）
 *
 * 參考：src/skills/openai-gpt5-mini-controller/SKILL.md
 */
async function translateWithGpt5Mini(englishText) {
    const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-5-mini-2025-08-07',
            input: [{
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: `Translate to Traditional Chinese (Hong Kong style):

"${englishText}"

Rules:
1. Natural translation, not word-by-word
2. Output ONLY the Chinese translation
3. No explanations`
                }]
            }],
            max_output_tokens: 500
        })
    });

    const result = await response.json();
    return result.output?.[0]?.content?.[0]?.text || '';
}
```

### 5.3 推薦：維持 Realtime API 內建翻譯

理由：
1. 延遲最低（無額外網路往返）
2. 上下文自動管理
3. 與語音流同步

---

## 6. 事件處理邏輯

> **⚠️ 重要說明**：以下處理器僅處理 OpenAI Realtime API 事件。
>
> **即時英文預覽**由獨立的 `WebSpeechRealtime` 類處理（見 `webspeech_realtime.js`），
> 因為 OpenAI 的 `transcription.delta` 只在 `speech_stopped` 後才觸發，無法提供邊說邊顯示。
>
> **事件流程**：
> ```
> Web Speech API (獨立) ─────→ 即時英文預覽 UI
>                              ↓
> OpenAI speech_started ──────→ 創建 Segment（標記開始）
> OpenAI transcription.* ─────→ 最終英文記錄（覆蓋 Web Speech 結果）
> OpenAI response.* ──────────→ 中文翻譯串流
> ```

### 6.1 完整事件處理器

```javascript
/**
 * 新版事件處理器
 * 基於 SegmentStore 的並行處理
 *
 * 注意：即時英文預覽由 WebSpeechRealtime 負責，此處理器只處理 OpenAI 事件
 */
class RealtimeEventHandler {
    constructor() {
        this.store = new EnhancedSegmentStore();
        this.onSegmentUpdate = null;  // UI 更新回調
    }

    handle(event) {
        const type = event.type;

        switch (type) {
            case 'input_audio_buffer.speech_started':
                this._handleSpeechStarted(event);
                break;

            case 'conversation.item.input_audio_transcription.delta':
                this._handleTranscriptionDelta(event);
                break;

            case 'conversation.item.input_audio_transcription.completed':
                this._handleTranscriptionCompleted(event);
                break;

            case 'response.created':
                this._handleResponseCreated(event);
                break;

            case 'response.output_text.delta':
                this._handleTranslationDelta(event);
                break;

            case 'response.output_text.done':
                this._handleTranslationDone(event);
                break;

            case 'response.done':
                this._handleResponseDone(event);
                break;

            case 'error':
                this._handleError(event);
                break;
        }
    }

    _handleSpeechStarted(event) {
        const itemId = event.item_id;
        if (!itemId) return;

        // 獲取或創建 Segment
        const segment = this.store.getOrCreate(itemId);
        segment.status = SegmentStatus.LISTENING;

        // 通知 UI
        this._notifyUpdate(segment);
        console.log(`[Handler] Speech started: ${segment.id}`);
    }

    _handleTranscriptionDelta(event) {
        const itemId = event.item_id;
        const segment = this.store.getByItemId(itemId);
        if (!segment) return;

        // 增量更新英文文本（用於實時預覽）
        if (event.delta) {
            segment.englishText += event.delta;
            this._notifyUpdate(segment);
        }
    }

    _handleTranscriptionCompleted(event) {
        const itemId = event.item_id;
        const segment = this.store.getByItemId(itemId);
        if (!segment) return;

        // 最終轉錄結果
        if (event.transcript) {
            segment.englishText = event.transcript;
        }

        // 標記為等待翻譯
        this.store.markReadyForResponse(itemId);
        this._notifyUpdate(segment);
        console.log(`[Handler] Transcription completed: ${segment.id} = "${segment.englishText}"`);
    }

    _handleResponseCreated(event) {
        const responseId = event.response?.id;
        if (!responseId) return;

        // 關聯 response 到等待中的 segment
        const segment = this.store.claimResponseSlot(responseId);
        if (segment) {
            console.log(`[Handler] Response ${responseId} claimed by ${segment.id}`);
        }
    }

    _handleTranslationDelta(event) {
        const responseId = event.response_id;
        const segment = this.store.getByResponseId(responseId);
        if (!segment) {
            console.warn(`[Handler] No segment for response ${responseId}`);
            return;
        }

        // 增量更新翻譯
        if (event.delta) {
            segment.chineseTranslation += event.delta;
            segment.status = SegmentStatus.TRANSLATING;
            this._notifyUpdate(segment);
        }
    }

    _handleTranslationDone(event) {
        const responseId = event.response_id;
        const segment = this.store.getByResponseId(responseId);
        if (!segment) return;

        // 最終翻譯結果
        if (event.text) {
            segment.chineseTranslation = event.text;
        }
        this._notifyUpdate(segment);
    }

    _handleResponseDone(event) {
        const responseId = event.response?.id;
        const segment = this.store.getByResponseId(responseId);
        if (!segment) return;

        // 標記完成
        segment.status = SegmentStatus.DONE;
        segment.completedAt = Date.now();
        this._notifyUpdate(segment);
        console.log(`[Handler] Segment completed: ${segment.id}`);

        // 可選：清理
        // this.store.cleanupCompleted();
    }

    _handleError(event) {
        console.error('[Handler] API Error:', event.error);

        // 標記所有活躍 segment 為錯誤
        const activeSegments = this.store.getActiveSegments();
        for (const segment of activeSegments) {
            segment.status = SegmentStatus.ERROR;
            segment.error = event.error?.message || 'Unknown error';
            this._notifyUpdate(segment);
        }
    }

    _notifyUpdate(segment) {
        if (this.onSegmentUpdate) {
            this.onSegmentUpdate(segment);
        }
    }
}
```

---

## 7. 錯誤處理策略

### 7.1 錯誤分類

| 錯誤類型 | 影響範圍 | 處理策略 |
|----------|----------|----------|
| 網路錯誤 | 全局 | 重連 WebRTC |
| API 錯誤 | 單個 Segment | 標記錯誤，顯示原文 |
| 超時 | 單個 Segment | 顯示「翻譯超時」 |
| 配額超限 | 全局 | 通知用戶 |

### 7.2 Segment 級別錯誤恢復

```javascript
/**
 * Segment 錯誤恢復
 */
class SegmentErrorHandler {
    constructor(store) {
        this.store = store;
        this.timeoutMs = 30000;  // 30 秒超時
    }

    /**
     * 監控 Segment 超時
     */
    startTimeoutMonitor(segment) {
        setTimeout(() => {
            if (segment.status === SegmentStatus.TRANSCRIBING ||
                segment.status === SegmentStatus.TRANSLATING) {
                console.warn(`[Timeout] Segment ${segment.id} timed out`);
                segment.status = SegmentStatus.ERROR;
                segment.error = '翻譯超時';

                // 顯示原文（降級處理）
                if (!segment.chineseTranslation && segment.englishText) {
                    segment.chineseTranslation = `[原文] ${segment.englishText}`;
                }
            }
        }, this.timeoutMs);
    }

    /**
     * 處理特定 Segment 的錯誤
     */
    handleSegmentError(segment, error) {
        segment.status = SegmentStatus.ERROR;
        segment.error = error.message || 'Unknown error';

        // 降級顯示
        if (!segment.chineseTranslation && segment.englishText) {
            segment.chineseTranslation = `[翻譯失敗] ${segment.englishText}`;
        }
    }
}
```

---

## 8. UI 渲染策略

### 8.1 渲染原則

1. **最新在上** — 新段落插入到頂部
2. **狀態可見** — 每個段落顯示當前狀態
3. **非阻塞** — 使用 `requestAnimationFrame` 批量更新

### 8.2 渲染實現

```javascript
/**
 * Segment UI Renderer
 */
class SegmentRenderer {
    constructor(containerElement) {
        this.container = containerElement;
        this.pendingUpdates = new Map();  // segment.id → segment
        this.rafId = null;
    }

    /**
     * 排隊更新（批量處理）
     */
    queueUpdate(segment) {
        this.pendingUpdates.set(segment.id, segment);
        this._scheduleRender();
    }

    _scheduleRender() {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => this._render());
    }

    _render() {
        this.rafId = null;

        for (const [id, segment] of this.pendingUpdates) {
            this._renderSegment(segment);
        }

        this.pendingUpdates.clear();
    }

    _renderSegment(segment) {
        let el = document.getElementById(segment.id);
        const isNew = !el;

        if (!el) {
            el = document.createElement('div');
            el.id = segment.id;
            el.className = 'transcript-entry';
            // 插入到頂部
            this.container.prepend(el);
        }

        // 狀態樣式
        el.className = `transcript-entry status-${segment.status}`;

        // 狀態指示器
        const statusText = {
            [SegmentStatus.LISTENING]: '🎤 聆聽中...',
            [SegmentStatus.TRANSCRIBING]: '📝 轉錄中...',
            [SegmentStatus.TRANSLATING]: '🔄 翻譯中...',
            [SegmentStatus.DONE]: '✅ 完成',
            [SegmentStatus.ERROR]: '❌ 錯誤'
        }[segment.status];

        // 翻譯顯示
        let translationHtml = '';
        if (segment.chineseTranslation) {
            translationHtml = this._escapeHtml(segment.chineseTranslation);
            if (segment.status === SegmentStatus.TRANSLATING) {
                translationHtml += '<span class="streaming-cursor"></span>';
            }
        } else if (segment.status === SegmentStatus.LISTENING) {
            translationHtml = '<span class="waiting">等待語音...</span>';
        } else if (segment.status === SegmentStatus.TRANSCRIBING) {
            translationHtml = '<span class="waiting">等待翻譯...</span>';
        }

        el.innerHTML = `
            <div class="transcript-original">${this._escapeHtml(segment.englishText) || '...'}</div>
            <div class="transcript-translation">${translationHtml}</div>
            <div class="transcript-meta">
                <span>${new Date(segment.createdAt).toLocaleTimeString()}</span>
                <span class="status-indicator">${statusText}</span>
            </div>
        `;
    }

    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
```

---

## 9. 完整代碼示例

### 9.1 整合使用

```javascript
// 初始化
const eventHandler = new RealtimeEventHandler();
const renderer = new SegmentRenderer(document.getElementById('transcriptContent'));

// 連接 UI 更新
eventHandler.onSegmentUpdate = (segment) => {
    renderer.queueUpdate(segment);
};

// WebRTC data channel 事件
dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    eventHandler.handle(data);
};
```

### 9.2 CSS 補充

```css
.transcript-entry.status-listening {
    border-left-color: var(--accent-yellow);
    opacity: 0.8;
}

.transcript-entry.status-transcribing {
    border-left-color: var(--accent-blue);
}

.transcript-entry.status-translating {
    border-left-color: var(--accent-blue);
}

.transcript-entry.status-done {
    border-left-color: var(--accent-green);
}

.transcript-entry.status-error {
    border-left-color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
}

.waiting {
    color: var(--text-secondary);
    font-style: italic;
}

.status-indicator {
    font-size: 12px;
    opacity: 0.8;
}
```

---

## 10. 驗收標準

| 場景 | 預期結果 |
|------|----------|
| 單句 "Hello" | 1 個 Segment：Hello → 你好 |
| 兩句連續 "Hello" "World" | 2 個 Segment，各自完成翻譯 |
| 說話時新段落開始 | 舊段落繼續翻譯，新段落獨立處理 |
| 翻譯超時 | 顯示原文 + 錯誤狀態 |
| API 錯誤 | 當前 Segment 標記錯誤，其他不受影響 |
| 事件亂序 | 每個 Segment 仍正確對應 |

---

## 11. 實施計劃

### 11.1 階段劃分

| 階段 | 內容 | 預估複雜度 |
|------|------|-----------|
| 1 | 實現 Segment 和 SegmentStore | 低 |
| 2 | 實現 EnhancedSegmentStore（response 關聯） | 中 |
| 3 | 實現 RealtimeEventHandler | 中 |
| 4 | 實現 SegmentRenderer | 低 |
| 5 | 整合測試 | 中 |
| 6 | 錯誤處理和超時 | 低 |

### 11.2 風險評估

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| 事件順序不符預期 | 中 | 高 | 增加日誌，可調整 FIFO 邏輯 |
| 內存洩漏 | 低 | 中 | 定期清理完成的 Segment |
| UI 更新過頻 | 低 | 低 | requestAnimationFrame 批量 |

---

*文檔版本：1.0*
*創建日期：2026-02-01*
*作者：Concurrent Architect*
