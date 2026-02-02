/**
 * Realtime Event Handler - OpenAI Realtime API 事件處理器
 *
 * Reference:
 * - spec/design_parallel_translation.md § 6
 * - spec/lessons_learned.md § 1.1 (事件名稱錯誤), § 1.5 (雙軌策略)
 * - src/skills/openai-realtime-mini-voice/SKILL.md
 *
 * ⚠️ 重要架構說明（2026-02-02）：
 * - 即時英文預覽由 WebSpeechRealtime 負責（見 webspeech_realtime.js）
 * - 本處理器只處理 OpenAI 事件，用於最終記錄和翻譯
 * - OpenAI 的 transcription 事件只在 speech_stopped 後觸發，無法做即時預覽
 *
 * 事件名稱使用 GA 版本（2025）：
 * - response.output_text.delta（不是 response.text.delta）
 * - response.output_text.done（不是 response.text.done）
 * - conversation.item.input_audio_transcription.completed
 */

// 假設 segment_store.js 已經載入
// const { SegmentStatus, EnhancedSegmentStore } = require('./segment_store.js');

// =============================================================================
// RealtimeEventHandler 類
// =============================================================================

/**
 * RealtimeEventHandler - 處理 OpenAI Realtime API 事件
 *
 * 基於 EnhancedSegmentStore 的並行處理
 * 每個 Segment 獨立處理，互不阻塞
 */
class RealtimeEventHandler {
    constructor(store = null) {
        this.store = store || new EnhancedSegmentStore();
        this.onSegmentUpdate = null;  // UI 更新回調
        this.onError = null;          // 錯誤回調
        this.onLog = null;            // 日誌回調

        // 連接 store 的更新回調
        this.store.onSegmentUpdate = (segment) => {
            if (this.onSegmentUpdate) {
                this.onSegmentUpdate(segment);
            }
        };
    }

    /**
     * 處理事件（主入口）
     */
    handle(event) {
        const type = event.type;

        switch (type) {
            // === 語音輸入事件 ===
            case 'input_audio_buffer.speech_started':
                this._handleSpeechStarted(event);
                break;

            case 'input_audio_buffer.speech_stopped':
                this._handleSpeechStopped(event);
                break;

            // === 轉錄事件 ===
            case 'conversation.item.input_audio_transcription.delta':
                this._handleTranscriptionDelta(event);
                break;

            case 'conversation.item.input_audio_transcription.completed':
                this._handleTranscriptionCompleted(event);
                break;

            // === Response 事件 ===
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

            // === 錯誤處理 ===
            case 'error':
                this._handleError(event);
                break;

            // === 其他事件（靜默處理或日誌） ===
            default:
                // 不處理的事件類型
                if (this.onLog && !type.includes('delta')) {
                    this.onLog(`[Handler] Unhandled event: ${type}`, 'debug');
                }
        }
    }

    // =========================================================================
    // 語音輸入事件處理
    // =========================================================================

    /**
     * 處理 speech_started 事件
     * v3 修改：不再創建 Segment，只標記。等 transcription 事件才創建。
     * 原因：OpenAI 可能跳過某些 item 的 transcription
     */
    _handleSpeechStarted(event) {
        const itemId = event.item_id;
        if (!itemId) {
            this._log('speech_started missing item_id', 'warn');
            return;
        }

        // 只標記，不創建 segment
        this.store.markSpeechStarted(itemId);
        this._log(`Speech started (item: ${itemId}) - waiting for transcription`, 'event');
    }

    /**
     * 處理 speech_stopped 事件
     * 標記語音輸入結束
     */
    _handleSpeechStopped(event) {
        const itemId = event.item_id;
        if (!itemId) return;

        const segment = this.store.getByItemId(itemId);
        if (segment) {
            this._log(`Speech stopped: ${segment.id}`, 'event');
        } else {
            this._log(`Speech stopped (item: ${itemId}) - no segment yet`, 'debug');
        }
    }

    // =========================================================================
    // 轉錄事件處理
    // =========================================================================

    /**
     * 處理 transcription delta（最終記錄用）
     *
     * ⚠️ 注意：這不是「即時」預覽！
     * - OpenAI 的 transcription 事件只在 speech_stopped 後才觸發
     * - 真正的即時英文預覽由 WebSpeechRealtime 處理
     * - 這裡的 delta 用於最終英文記錄（比 Web Speech 更準確）
     */
    _handleTranscriptionDelta(event) {
        const itemId = event.item_id;
        if (!itemId) return;

        // 獲取或創建 Segment（如果 delta 先於 speech_started 到達）
        let segment = this.store.getByItemId(itemId);
        if (!segment) {
            segment = this.store.getOrCreate(itemId);
        }

        // 增量更新英文文本
        if (event.delta) {
            segment.englishText += event.delta;
            this.store.updateAndNotify(segment);

            // 只記錄首次和每 50 字元一次，避免日誌太多
            if (segment.englishText.length <= event.delta.length || segment.englishText.length % 50 < event.delta.length) {
                this._log(`Transcription delta: ${segment.id} += "${event.delta}"`, 'debug');
            }
        }
    }

    /**
     * 處理 transcription completed（最終結果）
     */
    _handleTranscriptionCompleted(event) {
        const itemId = event.item_id;
        if (!itemId) return;

        let segment = this.store.getByItemId(itemId);
        if (!segment) {
            // 如果還沒有 Segment（異常情況），創建一個
            segment = this.store.getOrCreate(itemId);
            this._log(`Transcription completed created new segment: ${itemId}`, 'warn');
        }

        // 最終轉錄結果
        if (event.transcript) {
            segment.englishText = event.transcript;
        }

        // 更新狀態（但不再負責加入隊列，隊列在 getOrCreate 時已加入）
        this.store.markTranscriptionCompleted(itemId);

        this._log(`Transcription completed: ${segment.id} = "${segment.englishText.substring(0, 50)}..."`, 'event');
    }

    // =========================================================================
    // Response 事件處理
    // =========================================================================

    /**
     * 處理 response.created
     * v4: 如果沒有等待的 segment，response 會被加入 pendingResponses 隊列
     */
    _handleResponseCreated(event) {
        const responseId = event.response?.id;
        if (!responseId) return;

        // 從 FIFO 隊列關聯，或加入 pendingResponses 等待
        const segment = this.store.claimResponseSlot(responseId);
        if (segment) {
            this._log(`Response ${responseId} claimed by ${segment.id}`, 'event');
        } else {
            // v4: 這是正常情況，response 已被加入 pendingResponses 隊列
            this._log(`Response ${responseId} queued, waiting for transcription`, 'event');
        }
    }

    /**
     * 處理 response.output_text.delta（翻譯串流）
     * v5: 如果 segment 還不存在，緩存翻譯內容
     */
    _handleTranslationDelta(event) {
        const responseId = event.response_id;
        if (!responseId || !event.delta) return;

        const segment = this.store.getByResponseId(responseId);
        if (!segment) {
            // v5: 緩存翻譯內容，等 segment 創建後再應用
            this.store.bufferTranslation(responseId, event.delta);
            return;
        }

        // 增量更新翻譯
        segment.chineseTranslation += event.delta;

        // 確保狀態正確
        if (segment.status !== SegmentStatus.TRANSLATING &&
            segment.status !== SegmentStatus.DONE) {
            segment.setStatus(SegmentStatus.TRANSLATING);
        }

        this.store.updateAndNotify(segment);
    }

    /**
     * 處理 response.output_text.done（翻譯完成）
     */
    _handleTranslationDone(event) {
        const responseId = event.response_id;
        if (!responseId) return;

        const segment = this.store.getByResponseId(responseId);
        if (!segment) return;

        // 最終翻譯結果
        if (event.text) {
            segment.chineseTranslation = event.text;
        }

        this.store.updateAndNotify(segment);
    }

    /**
     * 處理 response.done（Response 完成）
     * v6: 如果 segment 還不存在，緩存完成狀態
     */
    _handleResponseDone(event) {
        const responseId = event.response?.id;
        if (!responseId) return;

        const segment = this.store.getByResponseId(responseId);
        if (!segment) {
            // v6: segment 還沒創建，緩存完成狀態
            this.store.markResponseDone(responseId);
            this._log(`Response ${responseId} done, buffered (waiting for segment)`, 'event');
            return;
        }

        // 標記完成
        segment.setStatus(SegmentStatus.DONE);
        this.store.updateAndNotify(segment);

        this._log(`Segment completed: ${segment.id}`, 'success');
    }

    // =========================================================================
    // 錯誤處理
    // =========================================================================

    /**
     * 處理 error 事件
     */
    _handleError(event) {
        const errorCode = event.error?.code || '';
        const errorMsg = event.error?.message || 'Unknown error';
        const errorType = event.error?.type || '';

        this._log(`API Error: ${errorCode} - ${errorMsg}`, 'error');

        // 通知錯誤回調
        if (this.onError) {
            this.onError(event.error);
        }

        // 根據錯誤類型決定影響範圍
        // 某些錯誤只影響單個 segment，某些是全局的
        const globalErrors = ['rate_limit_exceeded', 'server_error'];

        if (globalErrors.includes(errorCode)) {
            // 全局錯誤：標記所有活躍 segment 為錯誤
            const activeSegments = this.store.getActiveSegments();
            for (const segment of activeSegments) {
                segment.setStatus(SegmentStatus.ERROR, errorMsg);
                this.store.updateAndNotify(segment);
            }
        }
        // 其他錯誤由具體事件處理器處理
    }

    // =========================================================================
    // 工具方法
    // =========================================================================

    /**
     * 日誌輸出
     */
    _log(msg, level = 'info') {
        const prefix = '[Handler]';
        const fullMsg = `${prefix} ${msg}`;

        if (level === 'error') {
            console.error(fullMsg);
        } else if (level === 'warn') {
            console.warn(fullMsg);
        } else {
            console.log(fullMsg);
        }

        if (this.onLog) {
            this.onLog(fullMsg, level);
        }
    }

    /**
     * 獲取 Store
     */
    getStore() {
        return this.store;
    }

    /**
     * 重置
     */
    reset() {
        this.store.reset();
        this._log('Handler reset', 'info');
    }
}

// =============================================================================
// Exports
// =============================================================================

// For browser
if (typeof window !== 'undefined') {
    window.RealtimeEventHandler = RealtimeEventHandler;
}

// For Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RealtimeEventHandler
    };
}
