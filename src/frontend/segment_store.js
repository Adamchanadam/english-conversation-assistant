/**
 * Segment Store - 並行翻譯段落管理
 *
 * Reference:
 * - spec/design_parallel_translation.md
 * - spec/design.md § 4.3
 * - spec/lessons_learned.md § 1.3 (Entry ID 與 Response ID 混淆)
 *
 * 設計原則：
 * 1. 雙向索引：item_id ↔ Segment, response_id → Segment
 * 2. 不可變更原則：一旦關聯建立，不可覆蓋
 * 3. 超時保護：任何「等待」狀態必須有超時機制（30 秒）
 * 4. 狀態機驗證：只允許合法的狀態轉換
 */

// =============================================================================
// Segment Status（狀態機）
// =============================================================================

const SegmentStatus = {
    LISTENING: 'listening',         // 正在接收語音
    TRANSCRIBING: 'transcribing',   // 等待轉錄結果
    TRANSLATING: 'translating',     // 正在翻譯
    DONE: 'done',                   // 完成
    ERROR: 'error'                  // 錯誤
};

// 合法的狀態轉換路徑（lessons_learned.md § 3.2）
const VALID_TRANSITIONS = {
    [SegmentStatus.LISTENING]: [SegmentStatus.TRANSCRIBING, SegmentStatus.ERROR],
    [SegmentStatus.TRANSCRIBING]: [SegmentStatus.TRANSLATING, SegmentStatus.ERROR],
    [SegmentStatus.TRANSLATING]: [SegmentStatus.DONE, SegmentStatus.ERROR],
    [SegmentStatus.DONE]: [],      // 終態
    [SegmentStatus.ERROR]: []      // 終態
};

// 狀態超時時間（毫秒）
// 減少 LISTENING 超時，因為正常語音應該很快有 transcription
const STATUS_TIMEOUTS = {
    [SegmentStatus.LISTENING]: 15000,     // 15 秒（減少，快速檢測卡住的 segment）
    [SegmentStatus.TRANSCRIBING]: 15000,  // 15 秒
    [SegmentStatus.TRANSLATING]: 30000    // 30 秒
};

// =============================================================================
// Segment 類
// =============================================================================

/**
 * Segment 代表一個獨立的翻譯單元
 * 每個段落有自己的生命週期，與其他段落完全隔離
 */
class Segment {
    constructor(itemId) {
        this.id = null;                      // UI 顯示用 ID（由 Store 設定）
        this.itemId = itemId;                // OpenAI item_id（主鍵）
        this.englishText = '';               // 英文原文
        this.chineseTranslation = '';        // 中文翻譯
        this.status = SegmentStatus.LISTENING;
        this.responseId = null;              // 關聯的 response_id
        this.createdAt = Date.now();         // 創建時間戳（不修改 - lessons_learned.md § 4.1）
        this.completedAt = null;             // 完成時間戳
        this.error = null;                   // 錯誤信息
        this.timeoutId = null;               // 超時計時器 ID

        // 開始超時監控
        this._startTimeout();
    }

    /**
     * 設置狀態（帶驗證）
     * @param {string} newStatus - 新狀態
     * @param {string} errorMsg - 錯誤信息（僅用於 ERROR 狀態）
     * @returns {boolean} - 是否成功
     */
    setStatus(newStatus, errorMsg = null) {
        // 驗證狀態轉換（lessons_learned.md § 3.2）
        const validNext = VALID_TRANSITIONS[this.status];
        if (!validNext || !validNext.includes(newStatus)) {
            console.warn(`[Segment ${this.id}] Invalid transition: ${this.status} → ${newStatus}`);
            return false;
        }

        // 清除舊的超時
        this._clearTimeout();

        // 更新狀態
        const oldStatus = this.status;
        this.status = newStatus;

        // 處理錯誤狀態
        if (newStatus === SegmentStatus.ERROR && errorMsg) {
            this.error = errorMsg;
            // 降級處理：顯示原文
            if (!this.chineseTranslation && this.englishText) {
                this.chineseTranslation = `[翻譯失敗] ${this.englishText}`;
            }
        }

        // 處理完成狀態
        if (newStatus === SegmentStatus.DONE) {
            this.completedAt = Date.now();
        }

        // 為非終態設置新的超時
        if (newStatus !== SegmentStatus.DONE && newStatus !== SegmentStatus.ERROR) {
            this._startTimeout();
        }

        console.log(`[Segment ${this.id}] Status: ${oldStatus} → ${newStatus}`);
        return true;
    }

    /**
     * 開始超時監控（lessons_learned.md § 3.1）
     */
    _startTimeout() {
        const timeoutMs = STATUS_TIMEOUTS[this.status];
        if (!timeoutMs) return;

        this.timeoutId = setTimeout(() => {
            if (this.status !== SegmentStatus.DONE && this.status !== SegmentStatus.ERROR) {
                console.warn(`[Segment ${this.id}] Timeout in status: ${this.status}`);
                this.setStatus(SegmentStatus.ERROR, `超時（${this.status}）`);
            }
        }, timeoutMs);
    }

    /**
     * 清除超時計時器
     */
    _clearTimeout() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    /**
     * 檢查是否為終態
     */
    isTerminal() {
        return this.status === SegmentStatus.DONE || this.status === SegmentStatus.ERROR;
    }

    /**
     * 清理（釋放資源）
     */
    cleanup() {
        this._clearTimeout();
    }
}

// =============================================================================
// SegmentStore 類（基礎版）
// =============================================================================

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
        this.onSegmentUpdate = null;         // UI 更新回調
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

        console.log(`[Store] Created segment ${segment.id} for item ${itemId}`);
        this._notifyUpdate(segment);

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
     * 關鍵：一旦建立不可覆蓋（lessons_learned.md § 1.3）
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
     * 獲取所有 Segment（按創建時間排序）
     */
    getAll() {
        return Array.from(this.segments.values())
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * 獲取所有活躍的 Segment（未完成）
     */
    getActiveSegments() {
        return Array.from(this.segments.values())
            .filter(s => !s.isTerminal());
    }

    /**
     * 通知 UI 更新
     */
    _notifyUpdate(segment) {
        if (this.onSegmentUpdate) {
            this.onSegmentUpdate(segment);
        }
    }

    /**
     * 更新 Segment 並通知 UI
     */
    updateAndNotify(segment) {
        this._notifyUpdate(segment);
    }

    /**
     * 清理完成的關聯（可選，減少內存）
     */
    cleanupCompleted() {
        for (const [responseId, segment] of this.responseToSegment) {
            if (segment.isTerminal()) {
                this.responseToSegment.delete(responseId);
            }
        }
    }

    /**
     * 完全清理（重置）
     */
    reset() {
        // 清理所有 Segment 的超時
        for (const segment of this.segments.values()) {
            segment.cleanup();
        }

        this.segments.clear();
        this.responseToSegment.clear();
        this.counter = 0;

        console.log('[Store] Reset complete');
    }
}

// =============================================================================
// EnhancedSegmentStore 類（帶 FIFO 隊列）
// =============================================================================

/**
 * EnhancedSegmentStore - 改進的 response 關聯邏輯 (v3)
 *
 * 問題修復（2026-02-02 第二次）：
 * 1. OpenAI 可能跳過某些 item 的 transcription（只發 speech_started）
 * 2. FIFO 隊列導致 response 錯配到沒有英文的 segment
 * 3. 解決方案：只在收到 transcription 時才創建 segment，不在 speech_started
 *
 * Reference: design_parallel_translation.md § 4.2
 */
class EnhancedSegmentStore extends SegmentStore {
    constructor() {
        super();
        this.pendingForResponse = [];  // 等待 response 的 item_id 隊列（FIFO）
        this.pendingResponses = [];    // v4: 等待 segment 的 response_id 隊列
        this.pendingTranslations = new Map();  // v5: response_id → 緩存的翻譯內容
        this.completedResponses = new Set();   // v6: 已完成但 segment 還沒創建的 response_id
        this.speechStartedItems = new Set();  // 追蹤已 speech_started 但還沒 transcription 的 items
    }

    /**
     * v5: 緩存翻譯內容（當 segment 還不存在時）
     */
    bufferTranslation(responseId, delta) {
        if (!this.pendingTranslations.has(responseId)) {
            this.pendingTranslations.set(responseId, '');
        }
        this.pendingTranslations.set(responseId, this.pendingTranslations.get(responseId) + delta);
        console.log(`[Store] Buffered translation for ${responseId}: +${delta.length} chars`);
    }

    /**
     * v5: 獲取緩存的翻譯內容
     */
    getBufferedTranslation(responseId) {
        const buffered = this.pendingTranslations.get(responseId) || '';
        this.pendingTranslations.delete(responseId);
        return buffered;
    }

    /**
     * v6: 標記 response 已完成（當 segment 還不存在時緩存）
     */
    markResponseDone(responseId) {
        this.completedResponses.add(responseId);
        console.log(`[Store] Marked response ${responseId} as done (waiting for segment)`);
    }

    /**
     * v6: 檢查並消費 response 完成狀態
     */
    consumeResponseDone(responseId) {
        if (this.completedResponses.has(responseId)) {
            this.completedResponses.delete(responseId);
            return true;
        }
        return false;
    }

    /**
     * 標記 speech_started（但不創建 segment）
     * 只是記錄這個 item 開始了語音輸入
     */
    markSpeechStarted(itemId) {
        this.speechStartedItems.add(itemId);
        console.log(`[Store] Speech started for item ${itemId}, waiting for transcription`);
    }

    /**
     * 當收到 transcription（delta 或 completed）時創建 segment
     * v6: 檢查 response 是否已完成，直接設為 DONE
     */
    getOrCreateForTranscription(itemId) {
        if (this.segments.has(itemId)) {
            return this.segments.get(itemId);
        }

        const segment = new Segment(itemId);
        segment.id = `seg-${++this.counter}`;
        this.segments.set(itemId, segment);

        // 從 speechStartedItems 移除
        this.speechStartedItems.delete(itemId);

        // v4+v5+v6: 檢查是否有等待的 response
        if (this.pendingResponses.length > 0) {
            const responseId = this.pendingResponses.shift();
            this.linkResponse(responseId, segment);

            // v5: 應用緩存的翻譯內容
            const bufferedTranslation = this.getBufferedTranslation(responseId);
            if (bufferedTranslation) {
                segment.chineseTranslation = bufferedTranslation;
                console.log(`[Store] Applied buffered translation: ${bufferedTranslation.length} chars`);
            }

            // v6: 檢查 response 是否已完成
            if (this.consumeResponseDone(responseId)) {
                // Response 已完成，直接設為 DONE
                segment.status = SegmentStatus.DONE;
                segment._clearTimeout();
                segment.completedAt = Date.now();
                console.log(`[Store] Created segment ${segment.id} and marked DONE (response already completed)`);
            } else {
                // 還在翻譯中
                segment.status = SegmentStatus.TRANSLATING;
                segment._clearTimeout();
                segment._startTimeout();
                console.log(`[Store] Created segment ${segment.id} and linked to response ${responseId}`);
            }
        } else {
            // 正常情況：加入等待 response 的隊列
            this.pendingForResponse.push(itemId);
            console.log(`[Store] Created segment ${segment.id} for transcription item ${itemId}, queue: ${this.pendingForResponse.length}`);
        }

        this._notifyUpdate(segment);
        return segment;
    }

    /**
     * 覆寫 getOrCreate - 向後兼容，但建議使用 getOrCreateForTranscription
     */
    getOrCreate(itemId) {
        return this.getOrCreateForTranscription(itemId);
    }

    /**
     * 當 transcription.completed 時調用
     * 更新狀態
     */
    markTranscriptionCompleted(itemId) {
        const segment = this.getByItemId(itemId);
        if (!segment) {
            console.warn(`[Store] markTranscriptionCompleted: segment not found for ${itemId}`);
            return null;
        }

        // 如果還沒有被 response 認領，更新狀態為 TRANSCRIBING
        if (segment.status === SegmentStatus.LISTENING) {
            segment.setStatus(SegmentStatus.TRANSCRIBING);
            this._notifyUpdate(segment);
        }

        console.log(`[Store] Transcription completed for ${segment.id}, status: ${segment.status}`);
        return segment;
    }

    /**
     * 當 response.created 時調用
     * v4: 如果沒有等待的 segment，將 response 加入 pendingResponses 隊列
     */
    claimResponseSlot(responseId) {
        if (this.pendingForResponse.length === 0) {
            // v4: 沒有等待的 segment，將 response 加入等待隊列
            this.pendingResponses.push(responseId);
            console.log(`[Store] No pending segment for response ${responseId}, added to pendingResponses queue (size: ${this.pendingResponses.length})`);
            return null;
        }

        // FIFO：取最早等待的 segment
        const itemId = this.pendingForResponse.shift();
        const segment = this.getByItemId(itemId);

        if (segment) {
            this.linkResponse(responseId, segment);
            // 直接進入 TRANSLATING 狀態
            if (segment.status !== SegmentStatus.DONE && segment.status !== SegmentStatus.ERROR) {
                segment.status = SegmentStatus.TRANSLATING;
                segment._clearTimeout();
                segment._startTimeout();
            }
            this._notifyUpdate(segment);

            console.log(`[Store] Response ${responseId} claimed by segment ${segment.id} (en: "${segment.englishText.substring(0, 30)}...")`);
            return segment;
        }

        return null;
    }

    /**
     * 清理無效的 speechStartedItems（超時或已處理）
     */
    cleanupSpeechStarted() {
        // speechStartedItems 中超過 10 秒沒有轉成 segment 的就移除
        // 這裡簡單實現：在 reset 時清理
    }

    /**
     * 重置（包括隊列）
     */
    reset() {
        super.reset();
        this.pendingForResponse = [];
        this.pendingResponses = [];  // v4
        this.pendingTranslations.clear();  // v5
        this.completedResponses.clear();   // v6
        this.speechStartedItems.clear();
    }
}

// =============================================================================
// Exports
// =============================================================================

// For browser
if (typeof window !== 'undefined') {
    window.SegmentStatus = SegmentStatus;
    window.Segment = Segment;
    window.SegmentStore = SegmentStore;
    window.EnhancedSegmentStore = EnhancedSegmentStore;
}

// For Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SegmentStatus,
        Segment,
        SegmentStore,
        EnhancedSegmentStore,
        VALID_TRANSITIONS,
        STATUS_TIMEOUTS
    };
}
