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
        this.recognition.lang = 'en-US';         // 英文識別
        this.recognition.maxAlternatives = 1;

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
     * 停止識別
     */
    stop() {
        if (!this.recognition) {
            return;
        }

        // 🐛 Bug fix: 先設置 isRunning = false，防止 _handleEnd 中的自動重啟
        this.isRunning = false;

        try {
            this.recognition.stop();
            console.log('[WebSpeech] Stop called, isRunning set to false');
        } catch (error) {
            console.error('[WebSpeech] Stop error:', error);
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
     */
    _handleError(event) {
        console.error('[WebSpeech] Error:', event.error, event.message);

        // 某些錯誤後需要重啟
        const recoverable = ['no-speech', 'audio-capture', 'network'];
        if (recoverable.includes(event.error) && this.isRunning) {
            console.log('[WebSpeech] Attempting restart after error...');
            setTimeout(() => {
                if (this.isRunning) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.error('[WebSpeech] Restart failed:', e);
                    }
                }
            }, 1000);
        }

        if (this.onError) {
            this.onError(event.error, event.message);
        }
    }

    /**
     * 處理開始
     */
    _handleStart() {
        this.isRunning = true;
        console.log('[WebSpeech] Recognition started');
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
     */
    _handleEnd() {
        console.log('[WebSpeech] Recognition ended');

        // continuous 模式下自動重啟
        if (this.isRunning) {
            console.log('[WebSpeech] Auto-restarting...');
            setTimeout(() => {
                if (this.isRunning) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.error('[WebSpeech] Auto-restart failed:', e);
                        this.isRunning = false;
                        if (this.onStateChange) {
                            this.onStateChange('stopped');
                        }
                    }
                }
            }, 100);
        } else {
            if (this.onStateChange) {
                this.onStateChange('stopped');
            }
        }
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
