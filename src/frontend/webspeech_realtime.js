/**
 * Web Speech API 實時英文字幕
 *
 * Reference:
 * - spec/design.md § 4.1 雙軌音訊架構
 * - spec/design_parallel_translation.md § 4.1, § 6
 * - spec/research/webspeech_capabilities.md § 8.2
 * - spec/lessons_learned.md § 1.5 (OpenAI 不能做即時預覽)
 *
 * ⚠️ 架構關鍵（2026-02-02 確認）：
 * - 這是實現「邊說邊顯示英文字幕」的唯一方案
 * - OpenAI Realtime API 的 transcription 只在 speech_stopped 後觸發
 * - 雙軌策略：Web Speech（即時預覽）+ OpenAI（正式記錄+翻譯）
 *
 * 用途：邊說邊顯示英文字幕（real-time word-by-word, ~100ms 延遲）
 */

class WebSpeechRealtime {
    constructor() {
        this.recognition = null;
        this.isRunning = false;
        this.onInterimResult = null;  // 即時結果回調（邊說邊顯示）
        this.onFinalResult = null;    // 最終結果回調
        this.onError = null;
        this.onStateChange = null;
        this.onAudioStart = null;     // 音訊開始收錄回調（可以開始說話了）

        // 內部狀態
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.isMuted = false;  // PTT 靜音模式

        // 🔧 語言切換狀態機（修復快速連續切換問題）
        this._pendingLanguage = null;  // 待切換的目標語言
        this._isRestarting = false;    // 是否正在重啟中

        this._init();
    }

    /**
     * 初始化 Web Speech API
     */
    _init() {
        // 檢查瀏覽器支援
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('[WebSpeech] Not supported in this browser');
            return;
        }

        this.recognition = new SpeechRecognition();

        // 配置
        this.recognition.continuous = true;      // 持續識別
        this.recognition.interimResults = true;  // 啟用即時結果
        this.recognition.lang = 'en-US';         // 英文識別（預設，可動態切換）
        this.recognition.maxAlternatives = 1;
        this.currentLang = 'en-US';              // 追蹤當前語言

        // 事件處理
        this.recognition.onresult = (event) => this._handleResult(event);
        this.recognition.onerror = (event) => this._handleError(event);
        this.recognition.onend = () => this._handleEnd();
        this.recognition.onstart = () => this._handleStart();
        this.recognition.onaudiostart = () => this._handleAudioStart();
        this.recognition.onspeechstart = () => console.log('[WebSpeech] Speech started');
        this.recognition.onspeechend = () => console.log('[WebSpeech] Speech ended');

        console.log('[WebSpeech] Initialized');
    }

    /**
     * 動態切換識別語言
     * 🔧 修復版：處理快速連續切換（如 Spacebar 快速按放）
     *
     * @param {string} lang - BCP 47 語言代碼（如 'en-US', 'en-GB', 'en-IN'）
     * @param {boolean} restart - 是否重啟識別（切換語言需要重啟）
     */
    setLanguage(lang, restart = true) {
        if (!this.recognition) {
            console.warn('[WebSpeech] Not initialized');
            return false;
        }

        // 🔧 關鍵：如果已經在重啟中，只更新目標語言，不重複 stop()
        if (this._isRestarting) {
            console.log(`[WebSpeech] Already restarting, queuing language: ${lang}`);
            this._pendingLanguage = lang;
            this.recognition.lang = lang;
            this.currentLang = lang;
            return true;
        }

        if (this.currentLang === lang) {
            console.log(`[WebSpeech] Already using ${lang}`);
            return true;
        }

        const wasRunning = this.isRunning;
        console.log(`[WebSpeech] Switching language: ${this.currentLang} → ${lang}`);

        // 更新語言設定
        this.recognition.lang = lang;
        this.currentLang = lang;

        // 如果正在運行，需要停止後重啟
        if (wasRunning && restart) {
            this._isRestarting = true;  // 進入重啟狀態
            this._pendingLanguage = lang;
            try {
                this.recognition.stop();
                console.log(`[WebSpeech] Stopping for language change to ${lang}`);
            } catch (e) {
                // stop 失敗，清除重啟狀態
                console.warn('[WebSpeech] Stop failed during language change:', e.message);
                this._isRestarting = false;
                this._pendingLanguage = null;
            }
        }

        return true;
    }

    /**
     * 獲取當前語言設定
     */
    getLanguage() {
        return this.currentLang;
    }

    /**
     * 檢查是否支援
     */
    isSupported() {
        return this.recognition !== null;
    }

    /**
     * 開始識別
     */
    start() {
        if (!this.recognition) {
            console.error('[WebSpeech] Not supported');
            return false;
        }

        if (this.isRunning) {
            console.warn('[WebSpeech] Already running');
            return true;
        }

        try {
            this.finalTranscript = '';
            this.interimTranscript = '';
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('[WebSpeech] Start error:', error);
            return false;
        }
    }

    /**
     * 停止識別（完全停止，非語言切換）
     */
    stop() {
        if (!this.recognition) {
            return;
        }

        // 🔧 完全停止：清除所有狀態
        this.isRunning = false;
        this._isRestarting = false;
        this._pendingLanguage = null;

        try {
            this.recognition.stop();
            console.log('[WebSpeech] Stop called - full stop');
        } catch (error) {
            console.error('[WebSpeech] Stop error:', error.message);
        }
    }

    /**
     * 重置（清除累積的文字）
     */
    reset() {
        this.finalTranscript = '';
        this.interimTranscript = '';
    }

    /**
     * 處理識別結果
     * 🔧 PTT 靜音模式：isMuted = true 時完全跳過處理，不累積文字
     */
    _handleResult(event) {
        // PTT 靜音模式：完全跳過處理，不累積任何文字
        if (this.isMuted) {
            return;
        }

        let interim = '';
        let finalAdded = '';

        // 處理所有結果
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;

            if (result.isFinal) {
                // 最終結果：累積
                this.finalTranscript += transcript + ' ';
                finalAdded += transcript + ' ';
            } else {
                // 即時結果：重建
                interim += transcript;
            }
        }

        this.interimTranscript = interim;

        // 回調：即時結果（邊說邊顯示）
        if (this.onInterimResult) {
            // 返回完整的顯示文字 = 已確認 + 正在說
            const fullText = (this.finalTranscript + this.interimTranscript).trim();
            this.onInterimResult(fullText, this.interimTranscript);
        }

        // 回調：最終結果
        if (finalAdded && this.onFinalResult) {
            this.onFinalResult(finalAdded.trim());
        }
    }

    /**
     * 開啟靜音模式（PTT 用）
     * 靜音期間不累積任何語音識別結果
     */
    mute() {
        this.isMuted = true;
        console.log('[WebSpeech] Muted - ignoring all results');
    }

    /**
     * 關閉靜音模式（PTT 結束用）
     * 🔧 不清空已收錄的文字，讓背景翻譯繼續處理
     * 返回當前 fullText 長度，供調用者設置 processedLength 跳過 PTT 期間的內容
     */
    unmute() {
        this.isMuted = false;
        const currentLength = (this.finalTranscript + this.interimTranscript).trim().length;
        console.log(`[WebSpeech] Unmuted - keeping existing transcripts, length: ${currentLength}`);
        return currentLength;
    }

    /**
     * 處理錯誤
     * 🔧 修復：不在這裡重啟，讓 _handleEnd 統一處理
     * 因為 Web Speech API 會在錯誤後自動觸發 onend
     */
    _handleError(event) {
        console.error('[WebSpeech] Error:', event.error, event.message);

        // 錯誤時清除重啟狀態
        if (this._isRestarting) {
            console.log('[WebSpeech] Error during restart, clearing restart state');
            this._isRestarting = false;
            this._pendingLanguage = null;
        }

        // 🔧 不在這裡重啟！Web Speech API 錯誤後會自動觸發 onend
        // _handleEnd 會處理 continuous 模式的自動重啟
        // 這避免了與 _handleEnd 的競態條件

        if (this.onError) {
            this.onError(event.error, event.message);
        }
    }

    /**
     * 處理開始
     * 🔧 清除重啟狀態，確保狀態機正確
     */
    _handleStart() {
        this.isRunning = true;
        this._isRestarting = false;  // 重啟完成，清除標誌
        console.log('[WebSpeech] Recognition started, language:', this.currentLang);
        if (this.onStateChange) {
            this.onStateChange('running');
        }
    }

    /**
     * 處理音訊開始（麥克風真正開始收音）
     * 這是用戶可以開始說話的時刻
     */
    _handleAudioStart() {
        console.log('[WebSpeech] Audio capture started - ready to speak!');
        if (this.onAudioStart) {
            this.onAudioStart();
        }
    }

    /**
     * 處理結束
     * 🔧 修復版：統一處理語言切換和常規自動重啟，帶重試機制
     */
    _handleEnd() {
        console.log('[WebSpeech] Recognition ended, isRestarting:', this._isRestarting, 'isRunning:', this.isRunning);

        // 情況 1：語言切換重啟
        if (this._isRestarting) {
            const targetLang = this._pendingLanguage || this.currentLang;
            console.log(`[WebSpeech] Restarting with language: ${targetLang}`);

            // 確保使用最新的語言設定
            this.recognition.lang = targetLang;
            this.currentLang = targetLang;

            // 清除待定語言（但保持 _isRestarting 直到成功）
            this._pendingLanguage = null;

            // 帶重試的重啟
            this._restartWithRetry(targetLang, 3);  // 最多重試 3 次
            return;
        }

        // 情況 2：continuous 模式下自動重啟（非語言切換）
        if (this.isRunning) {
            console.log('[WebSpeech] Auto-restarting (continuous mode)...');
            setTimeout(() => {
                if (this.isRunning && !this._isRestarting) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.error('[WebSpeech] Auto-restart failed:', e.message);
                        // 🔧 不要設置 isRunning = false，嘗試再次重啟
                        this._scheduleRetry();
                    }
                }
            }, 100);
        } else {
            // 情況 3：正常停止
            if (this.onStateChange) {
                this.onStateChange('stopped');
            }
        }
    }

    /**
     * 帶重試的重啟機制
     * 🔧 修復：每次重試時檢查 _pendingLanguage，使用最新的目標語言
     * @param {string} targetLang - 目標語言（可能被 _pendingLanguage 覆蓋）
     * @param {number} retriesLeft - 剩餘重試次數
     */
    _restartWithRetry(targetLang, retriesLeft) {
        const delay = retriesLeft === 3 ? 100 : 200;  // 第一次 100ms，之後 200ms

        setTimeout(() => {
            // 🔧 關鍵修復：檢查是否有更新的目標語言
            const actualLang = this._pendingLanguage || targetLang;
            if (this._pendingLanguage) {
                console.log(`[WebSpeech] Using queued language: ${this._pendingLanguage} (was: ${targetLang})`);
                this.recognition.lang = actualLang;
                this.currentLang = actualLang;
                this._pendingLanguage = null;
            }

            try {
                this.recognition.start();
                console.log(`[WebSpeech] Restart succeeded (language: ${actualLang})`);
                // _isRestarting 會在 _handleStart 中清除
            } catch (e) {
                console.error(`[WebSpeech] Restart failed (${retriesLeft} retries left):`, e.message);

                if (retriesLeft > 0) {
                    // 重試
                    console.log('[WebSpeech] Retrying restart...');
                    this._restartWithRetry(actualLang, retriesLeft - 1);
                } else {
                    // 重試耗盡，清除狀態但保持 isRunning = true 以便自動恢復
                    console.error('[WebSpeech] All retries exhausted, will try again on next onend');
                    this._isRestarting = false;
                    // 🔧 關鍵：不設置 isRunning = false，讓 continuous 模式的自動重啟有機會恢復
                }
            }
        }, delay);
    }

    /**
     * 安排重試（用於自動重啟失敗時）
     * @param {number} attempt - 當前嘗試次數（防止無限循環）
     */
    _scheduleRetry(attempt = 0) {
        if (attempt >= 5) {
            console.error('[WebSpeech] Max retry attempts reached, giving up');
            this.isRunning = false;
            if (this.onStateChange) {
                this.onStateChange('stopped');
            }
            return;
        }

        const delay = Math.min(500 * Math.pow(1.5, attempt), 3000);  // 指數退避，最多 3 秒

        setTimeout(() => {
            if (this.isRunning && !this._isRestarting) {
                console.log(`[WebSpeech] Scheduled retry (attempt ${attempt + 1})...`);
                try {
                    this.recognition.start();
                } catch (e) {
                    console.error('[WebSpeech] Scheduled retry failed:', e.message);
                    this._scheduleRetry(attempt + 1);
                }
            }
        }, delay);
    }

    /**
     * 獲取當前狀態
     */
    getState() {
        return {
            isRunning: this.isRunning,
            finalTranscript: this.finalTranscript,
            interimTranscript: this.interimTranscript,
            fullText: (this.finalTranscript + this.interimTranscript).trim()
        };
    }
}

// Export
if (typeof window !== 'undefined') {
    window.WebSpeechRealtime = WebSpeechRealtime;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebSpeechRealtime };
}
