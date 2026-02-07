/**
 * Translation Validator - 翻譯驗證模組
 *
 * Reference:
 * - spec/research/translation_validation_design.md
 * - spec/research/translation_quality_roadmap.md
 *
 * Validates translation quality and detects potential errors:
 * - Number/amount mismatches
 * - Low confidence translations
 * - Untranslated content
 */

class TranslationValidator {
    constructor() {
        this.numberExtractor = new NumberExtractor();
        this.confidenceScorer = new ConfidenceScorer();
    }

    /**
     * Validate a translation
     * @param {string} sourceText - English source text
     * @param {string} translatedText - Chinese translation
     * @param {string} scenario - Optional scenario (bank, nhs, utilities, insurance)
     * @returns {ValidationResult}
     */
    validate(sourceText, translatedText, scenario = null) {
        const numberResult = this.validateNumbers(sourceText, translatedText);
        const confidenceResult = this.confidenceScorer.score(sourceText, translatedText);

        // Combine all warnings
        const allWarnings = [
            ...numberResult.warnings,
            ...confidenceResult.signals.map(s => ({
                type: s.signal,
                severity: s.penalty > 0.3 ? 'high' : 'medium',
                message: this.getSignalMessage(s.signal)
            }))
        ];

        const hasHighSeverity = allWarnings.some(w => w.severity === 'high');
        const isLowConfidence = confidenceResult.level === 'low';

        return {
            isValid: !hasHighSeverity && !isLowConfidence,
            confidence: confidenceResult.level,
            confidenceScore: confidenceResult.confidence,
            warnings: allWarnings,
            showWarning: isLowConfidence || hasHighSeverity,
            numbers: {
                source: numberResult.sourceNumbers,
                target: numberResult.targetNumbers
            }
        };
    }

    /**
     * Validate numbers between source and translation
     */
    validateNumbers(sourceText, translatedText) {
        const sourceNumbers = this.numberExtractor.extract(sourceText, 'en');
        const targetNumbers = this.numberExtractor.extract(translatedText, 'zh');

        const warnings = [];

        // Check for missing numbers
        for (const num of sourceNumbers) {
            if (!this.findNumberMatch(num, targetNumbers)) {
                warnings.push({
                    type: 'missing_number',
                    severity: 'high',
                    source: num,
                    message: `數字 ${num.display} 可能缺失或錯誤`
                });
            }
        }

        // Check for number count mismatch (informational)
        if (sourceNumbers.length > 0 && sourceNumbers.length !== targetNumbers.length) {
            // Only warn if significant difference
            if (Math.abs(sourceNumbers.length - targetNumbers.length) > 1) {
                warnings.push({
                    type: 'count_mismatch',
                    severity: 'medium',
                    message: `原文有 ${sourceNumbers.length} 個數字，譯文有 ${targetNumbers.length} 個`
                });
            }
        }

        return {
            isValid: warnings.filter(w => w.severity === 'high').length === 0,
            warnings,
            sourceNumbers,
            targetNumbers
        };
    }

    /**
     * Find matching number in target list
     */
    findNumberMatch(sourceNum, targetNumbers, tolerance = 0.01) {
        return targetNumbers.some(t => {
            // Exact match
            if (t.value === sourceNum.value) return true;
            // Tolerance for floating point
            if (Math.abs(t.value - sourceNum.value) <= tolerance) return true;
            // Percentage tolerance (for large numbers)
            if (sourceNum.value > 100 && Math.abs(t.value - sourceNum.value) / sourceNum.value <= 0.01) return true;
            return false;
        });
    }

    /**
     * Get human-readable message for signal type
     */
    getSignalMessage(signal) {
        const messages = {
            'length_ratio': '翻譯長度異常',
            'untranslated_english': '部分內容未翻譯',
            'ai_failure': '翻譯可能失敗',
            'no_translation': '未進行翻譯',
            'repetitive': '翻譯內容重複'
        };
        return messages[signal] || signal;
    }
}


/**
 * Number Extractor - 數字提取器
 */
class NumberExtractor {
    constructor() {
        // English patterns
        this.enPatterns = {
            // Currency: £100, £1,000.50, 100 pounds, fifty p
            currency: /£\s*([\d,]+(?:\.\d{2})?)|(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:pounds?|pence|p\b)/gi,

            // Percentages: 5%, 5.5%, five percent
            percentage: /(\d+(?:\.\d+)?)\s*%/g,

            // Cardinal numbers: 100, 1,000, 1000.50
            cardinal: /\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/g,

            // Ordinal: 1st, 2nd, 15th
            ordinal: /\b(\d+)(?:st|nd|rd|th)\b/gi,

            // Phone UK: 020 7123 4567, 07700 900123
            phone: /\b(?:0\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})\b/g,

            // Time: 2pm, 14:00, 2:30pm
            time: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi
        };

        // Chinese patterns
        this.zhPatterns = {
            // Arabic numbers in Chinese
            arabic: /(\d+(?:,\d{3})*(?:\.\d+)?)/g,

            // Currency symbols
            currency: /[£￡]\s*([\d,]+(?:\.\d{2})?)/g,

            // Chinese numerals
            chineseNum: /([零一二三四五六七八九十百千萬億兩]+)/g
        };

        // Chinese numeral map
        this.chineseNumMap = {
            '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
            '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
            '十': 10, '百': 100, '千': 1000, '萬': 10000, '億': 100000000
        };
    }

    /**
     * Extract numbers from text
     * @param {string} text - Input text
     * @param {string} lang - Language ('en' or 'zh')
     * @returns {Array<{value: number, display: string, type: string}>}
     */
    extract(text, lang = 'en') {
        const numbers = [];
        const seenValues = new Set();

        if (lang === 'en') {
            // Extract currency first (higher priority)
            let match;
            const currencyRegex = /£\s*([\d,]+(?:\.\d{2})?)/g;
            while ((match = currencyRegex.exec(text)) !== null) {
                const value = this.parseNumber(match[1]);
                if (!seenValues.has(value)) {
                    numbers.push({ value, display: match[0], type: 'currency' });
                    seenValues.add(value);
                }
            }

            // Extract percentages
            const percentRegex = /(\d+(?:\.\d+)?)\s*%/g;
            while ((match = percentRegex.exec(text)) !== null) {
                const value = parseFloat(match[1]);
                if (!seenValues.has(value)) {
                    numbers.push({ value, display: match[0], type: 'percentage' });
                    seenValues.add(value);
                }
            }

            // Extract general numbers (excluding already matched)
            const numRegex = /\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/g;
            while ((match = numRegex.exec(text)) !== null) {
                const value = this.parseNumber(match[1]);
                if (!seenValues.has(value) && value > 0) {
                    numbers.push({ value, display: match[1], type: 'number' });
                    seenValues.add(value);
                }
            }

        } else if (lang === 'zh') {
            let match;

            // Extract currency with symbols
            const currencyRegex = /[£￡]\s*([\d,]+(?:\.\d{2})?)/g;
            while ((match = currencyRegex.exec(text)) !== null) {
                const value = this.parseNumber(match[1]);
                if (!seenValues.has(value)) {
                    numbers.push({ value, display: match[0], type: 'currency' });
                    seenValues.add(value);
                }
            }

            // Extract Arabic numbers
            const arabicRegex = /(\d+(?:,\d{3})*(?:\.\d+)?)/g;
            while ((match = arabicRegex.exec(text)) !== null) {
                const value = this.parseNumber(match[1]);
                if (!seenValues.has(value) && value > 0) {
                    numbers.push({ value, display: match[1], type: 'number' });
                    seenValues.add(value);
                }
            }

            // Extract Chinese numerals
            const chineseRegex = /([零一二三四五六七八九十百千萬億兩]+)/g;
            while ((match = chineseRegex.exec(text)) !== null) {
                const value = this.parseChineseNumber(match[1]);
                if (value > 0 && !seenValues.has(value)) {
                    numbers.push({ value, display: match[1], type: 'chinese' });
                    seenValues.add(value);
                }
            }
        }

        return numbers;
    }

    /**
     * Parse number string to float
     */
    parseNumber(str) {
        return parseFloat(str.replace(/,/g, ''));
    }

    /**
     * Parse Chinese numeral to number
     * Handles: 一百二十三 → 123, 五千 → 5000, 兩萬 → 20000
     */
    parseChineseNumber(str) {
        if (!str || str.length === 0) return 0;

        let result = 0;
        let temp = 0;
        let billion = 0;
        let tenThousand = 0;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const num = this.chineseNumMap[char];

            if (num === undefined) continue;

            if (num === 100000000) { // 億
                if (temp === 0) temp = 1;
                billion = (result + temp) * num;
                result = 0;
                temp = 0;
            } else if (num === 10000) { // 萬
                if (temp === 0) temp = 1;
                tenThousand = (result + temp) * num;
                result = 0;
                temp = 0;
            } else if (num === 1000) { // 千
                if (temp === 0) temp = 1;
                result += temp * num;
                temp = 0;
            } else if (num === 100) { // 百
                if (temp === 0) temp = 1;
                result += temp * num;
                temp = 0;
            } else if (num === 10) { // 十
                if (temp === 0) temp = 1;
                result += temp * num;
                temp = 0;
            } else {
                temp = num;
            }
        }

        return billion + tenThousand + result + temp;
    }
}


/**
 * Confidence Scorer - 信心評分器
 */
class ConfidenceScorer {
    constructor() {
        // AI failure phrases (indicates translation didn't work)
        this.failurePhrases = [
            '我無法', '抱歉', '作為AI', '作為一個', '我是一個',
            '我不能', '很抱歉', '對不起', '無法翻譯',
            'I cannot', 'I am unable', 'As an AI'
        ];

        // Placeholder patterns
        this.placeholderPatterns = [
            /\[翻譯\]/g,
            /\[.*?\]/g,
            /\.{4,}/g,  // More than 3 dots
            /（翻譯中）/g
        ];
    }

    /**
     * Score translation confidence
     * @param {string} sourceText - English source
     * @param {string} translatedText - Chinese translation
     * @returns {{confidence: number, level: string, signals: Array}}
     */
    score(sourceText, translatedText) {
        const signals = [];
        let totalPenalty = 0;

        // Skip if either text is empty
        if (!sourceText || !translatedText) {
            return {
                confidence: 0,
                level: 'low',
                signals: [{ signal: 'empty_text', penalty: 1.0 }]
            };
        }

        // 1. Length ratio check
        const ratio = translatedText.length / sourceText.length;
        if (ratio < 0.2 || ratio > 4.0) {
            signals.push({ signal: 'length_ratio', penalty: 0.3 });
            totalPenalty += 0.3;
        }

        // 2. Untranslated English detection
        // Look for English words (4+ letters) in Chinese output
        const englishWords = translatedText.match(/[a-zA-Z]{4,}/g) || [];
        // Exclude common OK words (proper nouns with Chinese annotation)
        const significantEnglish = englishWords.filter(w =>
            !['http', 'https', 'www', 'com', 'org'].includes(w.toLowerCase())
        );
        if (significantEnglish.length > 3) {
            signals.push({ signal: 'untranslated_english', penalty: 0.4 });
            totalPenalty += 0.4;
        }

        // 3. AI failure phrase detection
        const hasFailurePhrase = this.failurePhrases.some(phrase =>
            translatedText.includes(phrase)
        );
        if (hasFailurePhrase) {
            signals.push({ signal: 'ai_failure', penalty: 0.5 });
            totalPenalty += 0.5;
        }

        // 4. Identical text (no translation)
        if (sourceText.trim() === translatedText.trim()) {
            signals.push({ signal: 'no_translation', penalty: 1.0 });
            totalPenalty += 1.0;
        }

        // 5. Repetitive content detection
        // Check if same phrase repeated multiple times
        const words = translatedText.split('');
        if (words.length > 10) {
            const chunks = [];
            for (let i = 0; i < translatedText.length - 5; i += 5) {
                chunks.push(translatedText.substring(i, i + 5));
            }
            const uniqueChunks = new Set(chunks);
            if (uniqueChunks.size < chunks.length * 0.3) {
                signals.push({ signal: 'repetitive', penalty: 0.4 });
                totalPenalty += 0.4;
            }
        }

        // Calculate confidence
        const confidence = Math.max(0, Math.min(1, 1 - totalPenalty));

        // Determine level
        let level;
        if (confidence > 0.7) {
            level = 'high';
        } else if (confidence > 0.4) {
            level = 'medium';
        } else {
            level = 'low';
        }

        return { confidence, level, signals };
    }
}


// Export for browser
if (typeof window !== 'undefined') {
    window.TranslationValidator = TranslationValidator;
    window.NumberExtractor = NumberExtractor;
    window.ConfidenceScorer = ConfidenceScorer;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TranslationValidator, NumberExtractor, ConfidenceScorer };
}
