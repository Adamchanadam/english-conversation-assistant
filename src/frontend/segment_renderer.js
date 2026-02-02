/**
 * Segment Renderer - 翻譯段落 UI 渲染器
 *
 * Reference:
 * - spec/design_parallel_translation.md § 8
 * - spec/lessons_learned.md § 4.2 (串流顯示閃爍)
 * - spec/design.md § 4.3
 *
 * 渲染原則：
 * 1. 最新在上 — 新段落插入到頂部
 * 2. 狀態可見 — 每個段落顯示當前狀態
 * 3. 非阻塞 — 使用 requestAnimationFrame 批量更新
 * 4. 差異更新 — 只更新變化的部分，避免閃爍
 */

// 假設 segment_store.js 已經載入
// const { SegmentStatus } = require('./segment_store.js');

// =============================================================================
// 狀態顯示文字
// =============================================================================

const STATUS_DISPLAY = {
    listening: { text: '🎤 聆聽中...', class: 'status-listening' },
    transcribing: { text: '📝 轉錄中...', class: 'status-transcribing' },
    translating: { text: '🔄 翻譯中...', class: 'status-translating' },
    done: { text: '✅ 完成', class: 'status-done' },
    error: { text: '❌ 錯誤', class: 'status-error' }
};

// =============================================================================
// SegmentRenderer 類
// =============================================================================

/**
 * SegmentRenderer - 渲染翻譯段落到 DOM
 *
 * 使用 requestAnimationFrame 批量更新，避免頻繁重繪
 */
class SegmentRenderer {
    constructor(containerElement) {
        this.container = containerElement;
        this.pendingUpdates = new Map();  // segment.id → segment
        this.rafId = null;
        this.segmentElements = new Map(); // segment.id → DOM element
    }

    /**
     * 排隊更新（批量處理）
     * @param {Segment} segment - 要更新的段落
     */
    queueUpdate(segment) {
        this.pendingUpdates.set(segment.id, segment);
        this._scheduleRender();
    }

    /**
     * 安排渲染
     */
    _scheduleRender() {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => this._render());
    }

    /**
     * 執行批量渲染
     */
    _render() {
        this.rafId = null;

        for (const [id, segment] of this.pendingUpdates) {
            this._renderSegment(segment);
        }

        this.pendingUpdates.clear();
    }

    /**
     * 渲染單個 Segment
     * @param {Segment} segment - 段落
     */
    _renderSegment(segment) {
        let el = this.segmentElements.get(segment.id);
        const isNew = !el;

        if (!el) {
            // 創建新元素
            el = this._createSegmentElement(segment);
            this.segmentElements.set(segment.id, el);

            // 插入到頂部（最新在上）
            if (this.container.firstChild) {
                this.container.insertBefore(el, this.container.firstChild);
            } else {
                this.container.appendChild(el);
            }
        }

        // 更新內容（差異更新）
        this._updateSegmentElement(el, segment);
    }

    /**
     * 創建 Segment DOM 元素
     */
    _createSegmentElement(segment) {
        const el = document.createElement('div');
        el.id = segment.id;
        el.className = 'transcript-entry';
        el.setAttribute('data-item-id', segment.itemId);

        el.innerHTML = `
            <div class="transcript-original"></div>
            <div class="transcript-translation"></div>
            <div class="transcript-meta">
                <span class="transcript-time"></span>
                <span class="status-indicator"></span>
            </div>
        `;

        return el;
    }

    /**
     * 更新 Segment DOM 元素（差異更新 - 避免閃爍）
     */
    _updateSegmentElement(el, segment) {
        // 更新狀態樣式
        const statusInfo = STATUS_DISPLAY[segment.status] || STATUS_DISPLAY.listening;
        el.className = `transcript-entry ${statusInfo.class}`;

        // 更新英文原文
        const originalEl = el.querySelector('.transcript-original');
        const originalText = segment.englishText || '...';
        if (originalEl.textContent !== originalText) {
            originalEl.textContent = originalText;
        }

        // 更新翻譯（帶串流游標）
        const translationEl = el.querySelector('.transcript-translation');
        this._updateTranslation(translationEl, segment);

        // 更新時間
        const timeEl = el.querySelector('.transcript-time');
        const timeStr = new Date(segment.createdAt).toLocaleTimeString('zh-TW');
        if (timeEl.textContent !== timeStr) {
            timeEl.textContent = timeStr;
        }

        // 更新狀態指示
        const statusEl = el.querySelector('.status-indicator');
        if (statusEl.textContent !== statusInfo.text) {
            statusEl.textContent = statusInfo.text;
        }
    }

    /**
     * 更新翻譯內容（帶串流效果）
     */
    _updateTranslation(el, segment) {
        let html = '';

        if (segment.chineseTranslation) {
            // 有翻譯內容
            html = this._escapeHtml(segment.chineseTranslation);

            // 串流中顯示游標
            if (segment.status === 'translating') {
                html += '<span class="streaming-cursor"></span>';
            }
        } else if (segment.error) {
            // 錯誤狀態
            html = `<span class="error-text">${this._escapeHtml(segment.error)}</span>`;
        } else if (segment.status === 'listening') {
            // 正在聆聽（有英文即時預覽）
            if (segment.englishText && segment.englishText !== '...') {
                html = '<span class="waiting">🎤 聆聽中...</span>';
            } else {
                html = '<span class="waiting">🎤 等待語音...</span>';
            }
        } else if (segment.status === 'transcribing') {
            // 等待轉錄結果
            html = '<span class="waiting">📝 識別中...</span>';
        } else if (segment.status === 'translating') {
            // 等待翻譯開始
            html = '<span class="waiting">🔄 翻譯中...</span>';
        }

        // 只在內容變化時更新（避免閃爍）
        if (el.innerHTML !== html) {
            el.innerHTML = html;
        }
    }

    /**
     * HTML 轉義（防止 XSS）
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 清空容器
     */
    clear() {
        this.container.innerHTML = '';
        this.segmentElements.clear();
        this.pendingUpdates.clear();

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /**
     * 獲取所有段落數量
     */
    getCount() {
        return this.segmentElements.size;
    }
}

// =============================================================================
// CSS 樣式（可注入到頁面）
// =============================================================================

const SEGMENT_RENDERER_STYLES = `
/* 段落基本樣式 */
.transcript-entry {
    padding: 12px 16px;
    border-left: 3px solid var(--accent-blue, #3498db);
    margin-bottom: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 0 8px 8px 0;
    transition: border-color 0.3s, opacity 0.3s;
}

/* 狀態樣式 */
.transcript-entry.status-listening {
    border-left-color: var(--accent-yellow, #f1c40f);
    opacity: 0.8;
}

.transcript-entry.status-transcribing {
    border-left-color: var(--accent-blue, #3498db);
}

.transcript-entry.status-translating {
    border-left-color: var(--accent-blue, #3498db);
}

.transcript-entry.status-done {
    border-left-color: var(--accent-green, #2ecc71);
}

.transcript-entry.status-error {
    border-left-color: var(--accent-red, #e74c3c);
    background: rgba(231, 76, 60, 0.1);
}

/* 原文樣式 */
.transcript-original {
    color: var(--text-secondary, #b0b0b0);
    font-size: 14px;
    margin-bottom: 6px;
}

/* 翻譯樣式 */
.transcript-translation {
    color: var(--text-primary, #ffffff);
    font-size: 18px;
    font-weight: 500;
    line-height: 1.5;
}

/* 等待文字 */
.transcript-translation .waiting {
    color: var(--text-secondary, #b0b0b0);
    font-style: italic;
    font-weight: normal;
}

/* 錯誤文字 */
.transcript-translation .error-text {
    color: var(--accent-red, #e74c3c);
}

/* 串流游標 */
.streaming-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--accent-blue, #3498db);
    margin-left: 2px;
    animation: blink 0.8s infinite;
}

@keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
}

/* 元數據 */
.transcript-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-secondary, #b0b0b0);
}

.status-indicator {
    opacity: 0.8;
}
`;

/**
 * 注入樣式到頁面
 */
function injectSegmentRendererStyles() {
    if (document.getElementById('segment-renderer-styles')) {
        return; // 已經注入
    }

    const styleEl = document.createElement('style');
    styleEl.id = 'segment-renderer-styles';
    styleEl.textContent = SEGMENT_RENDERER_STYLES;
    document.head.appendChild(styleEl);
}

// =============================================================================
// Exports
// =============================================================================

// For browser
if (typeof window !== 'undefined') {
    window.SegmentRenderer = SegmentRenderer;
    window.injectSegmentRendererStyles = injectSegmentRendererStyles;
    window.SEGMENT_RENDERER_STYLES = SEGMENT_RENDERER_STYLES;
}

// For Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SegmentRenderer,
        injectSegmentRendererStyles,
        SEGMENT_RENDERER_STYLES,
        STATUS_DISPLAY
    };
}
