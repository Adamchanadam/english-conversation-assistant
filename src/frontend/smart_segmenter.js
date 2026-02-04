/**
 * Smart Segmenter - 智能語音分段器
 *
 * Reference:
 * - spec/research/speech_segmentation.md §3 混合分段策略
 * - spec/design.md §4.2 SmartSegmenter 設計
 *
 * 核心功能：
 * - 基於停頓時間（600ms）偵測句子邊界
 * - 使用語法線索（right, okay, thanks 等）輔助分段
 * - 長度保護（15 字軟性、25 字硬性限制）
 * - 過濾 filled pauses（um, uh, hmm）
 *
 * 設計目標：
 * - 將分段延遲從 2-3 秒降至 ~600ms
 * - 保持語義完整性
 */

class SmartSegmenter {
    constructor(options = {}) {
        // 分段閾值（ms）
        this.pauseThreshold = options.pauseThreshold || 600;
        this.minPauseForSegment = options.minPauseForSegment || 300;  // 最小停頓

        // 字數限制
        this.softLimit = options.softLimit || 15;
        this.hardLimit = options.hardLimit || 25;
        this.minSegmentWords = options.minSegmentWords || 3;

        // 狀態
        this.buffer = '';
        this.lastUpdateTime = Date.now();
        this.wordCount = 0;
        this.segmentStartTime = Date.now();

        // 🐛 Bug fix: 追蹤已處理的文字位置
        // Web Speech 的 fullText 是從 session 開始累積的，
        // 我們需要記住上次分段結束的位置
        this.processedLength = 0;

        // 🔧 動態穩定性檢測（取代 hardcode 單詞列表）
        // 當偵測到暫停時，等待 stabilityDelay 確認文字已穩定
        this.stabilityDelay = options.stabilityDelay || 150;  // ms
        this.pendingEmit = null;  // 待發出的 segment
        this.lastBufferSnapshot = '';  // 用於檢測文字變化

        // 回調
        this.onSegment = null;  // (segment, reason) => void

        // 定時器（用於偵測長停頓）
        this.pauseCheckTimer = null;
        this.pauseCheckInterval = 100;  // 每 100ms 檢查一次

        // 統計
        this.segmentCount = 0;
        this.totalWords = 0;
    }

    /**
     * 語法觸發詞
     */
    static GRAMMAR_TRIGGERS = {
        // 句末標記詞（強觸發）
        sentenceEnders: [
            'right', 'okay', 'ok', 'thanks', 'thank you',
            'please', 'bye', 'goodbye', 'hello', 'yes', 'no',
            'correct', 'exactly', 'absolutely', 'definitely'
        ],

        // 問句開頭詞（用於偵測問句結束）
        questionStarters: [
            'do you', 'can you', 'would you', 'could you',
            'is it', 'is there', 'are you', 'are there',
            'what', 'where', 'when', 'why', 'how', 'who'
        ],

        // 連接詞（可作為分段點）
        conjunctions: [
            'and', 'but', 'or', 'so', 'because',
            'however', 'therefore', 'although', 'then'
        ]
    };

    /**
     * Filled pauses（過濾詞）
     */
    static FILLED_PAUSES = ['um', 'uh', 'hmm', 'ah', 'er', 'like', 'you know'];

    /**
     * 開始監控
     */
    start() {
        this.reset();
        this._startPauseCheck();
        console.log('[SmartSegmenter] Started');
    }

    /**
     * 停止監控
     */
    stop() {
        this._stopPauseCheck();

        // 取消待發出的 segment
        if (this.pendingEmit) {
            clearTimeout(this.pendingEmit);
            this.pendingEmit = null;
        }

        // 強制輸出剩餘內容
        if (this.buffer.trim() && this.wordCount >= this.minSegmentWords) {
            this._emitSegment('stop');
        }
        console.log('[SmartSegmenter] Stopped');
    }

    /**
     * 完全重置狀態（用於開始新的 session）
     * 注意：這會重置 processedLength，適用於 Web Speech 重新開始的情況
     */
    reset() {
        // 取消待發出的 segment
        if (this.pendingEmit) {
            clearTimeout(this.pendingEmit);
            this.pendingEmit = null;
        }

        this.buffer = '';
        this.wordCount = 0;
        this.lastUpdateTime = Date.now();
        this.segmentStartTime = Date.now();
        this.processedLength = 0;
        this.lastBufferSnapshot = '';
        this._currentTranscriptLength = undefined;
    }

    /**
     * 處理 Web Speech 的輸出
     *
     * @param {string} transcript - 當前完整轉錄文字（Web Speech 從 session 開始累積）
     * @param {boolean} isFinal - 是否為 Web Speech 的最終結果
     */
    process(transcript, isFinal = false) {
        const now = Date.now();
        const pauseDuration = now - this.lastUpdateTime;

        // 過濾 filled pauses
        const filteredTranscript = this._filterFilledPauses(transcript);

        // 🐛 關鍵修復：只處理新增的文字（從上次分段結束位置開始）
        // Web Speech 的 fullText 是從 session 開始累積的，
        // 所以我們需要從 processedLength 位置開始截取當前分段
        const currentSegmentText = filteredTranscript.slice(this.processedLength);

        // 如果沒有新文字，只更新時間戳
        if (currentSegmentText.trim().length === 0) {
            this.lastUpdateTime = now;
            return { shouldSegment: false, reason: null };
        }

        // 🔧 動態穩定性檢測：如果文字有變化，取消待發出的 segment
        // 這避免了在單詞中間切割（如 "g" → "gpt4"）
        if (currentSegmentText !== this.lastBufferSnapshot) {
            if (this.pendingEmit) {
                clearTimeout(this.pendingEmit);
                this.pendingEmit = null;
                console.log(`[SmartSegmenter] Text changed, cancelled pending emit`);
            }
            this.lastBufferSnapshot = currentSegmentText;
        }

        // 🐛 修復：buffer 只存儲當前分段的文字，不是整個累積文字
        this.buffer = currentSegmentText;
        this.wordCount = this._countWords(this.buffer);
        this.lastUpdateTime = now;

        // 記錄當前 filteredTranscript 長度，用於分段時更新 processedLength
        this._currentTranscriptLength = filteredTranscript.length;

        // 檢查分段條件
        const result = this._checkSegmentation(pauseDuration, isFinal);

        if (result.shouldSegment) {
            // 對於非即時觸發的情況，使用延遲發出以確保穩定性
            if (result.reason === 'pause_detected' || result.reason === 'soft_limit_with_conjunction') {
                this._scheduleEmit(result.reason);
            } else {
                // 硬性限制或 final 結果，立即發出
                this._emitSegment(result.reason);
            }
        }

        return result;
    }

    /**
     * 延遲發出 segment（穩定性檢測）
     * 等待 stabilityDelay 毫秒，如果期間有新文字進來則取消
     */
    _scheduleEmit(reason) {
        if (this.pendingEmit) {
            clearTimeout(this.pendingEmit);
        }

        this.pendingEmit = setTimeout(() => {
            this.pendingEmit = null;
            // 再次檢查是否仍然應該發出
            if (this.buffer.trim() && this.wordCount >= this.minSegmentWords) {
                console.log(`[SmartSegmenter] Stability confirmed, emitting (waited ${this.stabilityDelay}ms)`);
                this._emitSegment(reason);
            }
        }, this.stabilityDelay);
    }

    /**
     * 檢查分段條件
     */
    _checkSegmentation(pauseDuration, isFinal) {
        // Rule 0: Web Speech final result 總是分段
        if (isFinal && this.buffer.trim()) {
            return { shouldSegment: true, reason: 'webspeech_final' };
        }

        // Rule 1: 硬性長度限制（無條件）
        if (this.wordCount >= this.hardLimit) {
            return { shouldSegment: true, reason: 'hard_limit' };
        }

        // Rule 2: 長停頓 + 足夠字數
        // 注意：這主要由 _checkPause() 定時器處理，這裡作為備份
        if (pauseDuration >= this.pauseThreshold && this.wordCount >= this.minSegmentWords) {
            return { shouldSegment: true, reason: 'pause_detected' };
        }

        // Rule 3: 軟性長度 + 語法線索
        if (this.wordCount >= this.softLimit) {
            const grammarCue = this._detectGrammarCue();
            if (grammarCue) {
                return { shouldSegment: true, reason: `soft_limit_with_${grammarCue}` };
            }
        }

        // Rule 4: 短文字 + 強語法線索（句末詞）
        if (this.wordCount >= this.minSegmentWords) {
            const strongCue = this._detectStrongGrammarCue();
            if (strongCue) {
                return { shouldSegment: true, reason: `strong_cue_${strongCue}` };
            }
        }

        return { shouldSegment: false, reason: null };
    }

    /**
     * 偵測語法線索
     */
    _detectGrammarCue() {
        const lower = this.buffer.toLowerCase().trim();

        // 句末標記詞
        for (const ender of SmartSegmenter.GRAMMAR_TRIGGERS.sentenceEnders) {
            if (lower.endsWith(ender)) {
                return `ender_${ender}`;
            }
        }

        // 連接詞（只在超過 8 字時才觸發）
        if (this.wordCount > 8) {
            for (const conj of SmartSegmenter.GRAMMAR_TRIGGERS.conjunctions) {
                // 檢查是否以連接詞開頭一個新子句
                const pattern = new RegExp(` ${conj} [a-z]`, 'i');
                if (pattern.test(lower)) {
                    return `conjunction_${conj}`;
                }
            }
        }

        return null;
    }

    /**
     * 偵測強語法線索
     */
    _detectStrongGrammarCue() {
        const lower = this.buffer.toLowerCase().trim();

        // 問句結構（問號或問句結尾）
        if (lower.endsWith('?')) {
            return 'question_mark';
        }

        // 強句末詞（在任何長度都觸發）
        const strongEnders = ['right', 'okay', 'correct', 'thanks', 'please'];
        for (const ender of strongEnders) {
            if (lower.endsWith(ender)) {
                return ender;
            }
        }

        return null;
    }

    /**
     * 輸出分段
     *
     * 🔧 動態穩定性檢測：
     * 這個方法只有在文字已經穩定（150ms 內沒有變化）後才會被調用
     * 因此不需要額外的單詞邊界檢測
     */
    _emitSegment(reason) {
        const segment = this.buffer.trim();
        if (!segment) return;

        if (this._countWords(segment) < this.minSegmentWords) {
            console.log(`[SmartSegmenter] Skipped (too short: ${this._countWords(segment)} words)`);
            return;
        }

        const duration = Date.now() - this.segmentStartTime;

        // 統計
        this.segmentCount++;
        this.totalWords += this._countWords(segment);

        console.log(`[SmartSegmenter] Segment #${this.segmentCount}: "${segment.substring(0, 50)}${segment.length > 50 ? '...' : ''}" (${this._countWords(segment)} words, reason: ${reason})`);

        // 回調
        if (this.onSegment) {
            this.onSegment(segment, {
                reason,
                wordCount: this._countWords(segment),
                duration,
                segmentIndex: this.segmentCount
            });
        }

        // 更新 processedLength 到當前位置
        if (this._currentTranscriptLength !== undefined) {
            this.processedLength = this._currentTranscriptLength;
        }

        // 重置 buffer 和快照
        this._resetBuffer();
        this.lastBufferSnapshot = '';
    }


    /**
     * 內部方法：只重置 buffer 相關狀態
     */
    _resetBuffer() {
        this.buffer = '';
        this.wordCount = 0;
        this.segmentStartTime = Date.now();
    }

    /**
     * 過濾 filled pauses
     */
    _filterFilledPauses(transcript) {
        const words = transcript.split(/\s+/);
        const filtered = words.filter(word => {
            const lower = word.toLowerCase().replace(/[.,!?]/g, '');
            return !SmartSegmenter.FILLED_PAUSES.includes(lower);
        });
        return filtered.join(' ');
    }

    /**
     * 計算字數
     */
    _countWords(text) {
        return text.split(/\s+/).filter(w => w.trim()).length;
    }

    /**
     * 開始停頓檢查定時器
     */
    _startPauseCheck() {
        this._stopPauseCheck();
        this.pauseCheckTimer = setInterval(() => this._checkPause(), this.pauseCheckInterval);
    }

    /**
     * 停止停頓檢查定時器
     */
    _stopPauseCheck() {
        if (this.pauseCheckTimer) {
            clearInterval(this.pauseCheckTimer);
            this.pauseCheckTimer = null;
        }
    }

    /**
     * 定期檢查停頓
     * 這是偵測「用戶停止說話」的關鍵機制
     *
     * 🔧 使用 _scheduleEmit 而非直接 _emitSegment
     * 確保在發出前文字已穩定（動態穩定性檢測）
     */
    _checkPause() {
        if (!this.buffer.trim() || this.wordCount < this.minSegmentWords) {
            return;
        }

        // 如果已有待發出的 segment，不重複排程
        if (this.pendingEmit) {
            return;
        }

        const pauseDuration = Date.now() - this.lastUpdateTime;

        if (pauseDuration >= this.pauseThreshold) {
            console.log(`[SmartSegmenter] Pause detected: ${pauseDuration}ms, scheduling emit...`);
            this._scheduleEmit('pause_timeout');
        }
    }

    /**
     * 獲取當前狀態
     */
    getState() {
        return {
            buffer: this.buffer,
            wordCount: this.wordCount,
            segmentCount: this.segmentCount,
            totalWords: this.totalWords,
            timeSinceLastUpdate: Date.now() - this.lastUpdateTime
        };
    }

    /**
     * 獲取統計
     */
    getStats() {
        return {
            segmentCount: this.segmentCount,
            totalWords: this.totalWords,
            avgWordsPerSegment: this.segmentCount > 0 ? (this.totalWords / this.segmentCount).toFixed(1) : 0
        };
    }
}

/**
 * AdaptiveSegmenter - 自適應分段器
 * 根據語速動態調整參數
 */
class AdaptiveSegmenter extends SmartSegmenter {
    constructor(options = {}) {
        super(options);

        // 語速估計
        this.estimatedWPM = 150;
        this.recentSegments = [];  // 最近的分段記錄
        this.maxRecentSegments = 5;
    }

    /**
     * 覆寫 _emitSegment 以更新語速估計
     */
    _emitSegment(reason) {
        const duration = Date.now() - this.segmentStartTime;
        const wordCount = this.wordCount;

        // 調用父類方法
        super._emitSegment(reason);

        // 更新語速估計
        this._updateWPMEstimate(wordCount, duration);
    }

    /**
     * 更新語速估計並調整參數
     */
    _updateWPMEstimate(wordCount, durationMs) {
        if (durationMs < 500 || wordCount < 2) return;  // 忽略太短的分段

        const wpm = (wordCount / durationMs) * 60000;

        // 記錄
        this.recentSegments.push({ wpm, wordCount, duration: durationMs });
        if (this.recentSegments.length > this.maxRecentSegments) {
            this.recentSegments.shift();
        }

        // 指數移動平均
        this.estimatedWPM = this.estimatedWPM * 0.7 + wpm * 0.3;

        // 根據語速調整參數
        this._adjustParameters();

        console.log(`[AdaptiveSegmenter] WPM estimate: ${this.estimatedWPM.toFixed(0)}, pause threshold: ${this.pauseThreshold}ms`);
    }

    /**
     * 根據語速調整分段參數
     */
    _adjustParameters() {
        if (this.estimatedWPM < 120) {
            // 慢速說話
            this.pauseThreshold = 800;
            this.softLimit = 12;
            this.hardLimit = 20;
        } else if (this.estimatedWPM > 160) {
            // 快速說話
            this.pauseThreshold = 500;
            this.softLimit = 18;
            this.hardLimit = 30;
        } else {
            // 正常語速
            this.pauseThreshold = 600;
            this.softLimit = 15;
            this.hardLimit = 25;
        }
    }

    /**
     * 獲取語速統計
     */
    getWPMStats() {
        return {
            estimatedWPM: this.estimatedWPM.toFixed(0),
            recentSegments: this.recentSegments.length,
            currentThreshold: this.pauseThreshold
        };
    }
}

// =============================================================================
// Exports
// =============================================================================

// For browser
if (typeof window !== 'undefined') {
    window.SmartSegmenter = SmartSegmenter;
    window.AdaptiveSegmenter = AdaptiveSegmenter;
}

// For Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SmartSegmenter,
        AdaptiveSegmenter
    };
}
