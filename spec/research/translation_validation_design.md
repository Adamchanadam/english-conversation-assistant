# Translation Validation System Design

## Overview

Post-translation validation system to detect potential errors in real-time translations, focusing on number/date/amount mismatches and low-confidence translations.

## Architecture

```
English Source → Translation API → Validation Layer → UI Display
                                        ↓
                                  ValidationResult
                                  {
                                    isValid: boolean,
                                    confidence: 'high' | 'medium' | 'low',
                                    warnings: Warning[],
                                    extractedData: { source: {...}, target: {...} }
                                  }
```

## Component 1: Number/Amount Validator

### Extraction Patterns (English)

```javascript
const PATTERNS = {
  // Currency (UK focus)
  currency: /£\s*[\d,]+(?:\.\d{2})?|(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:pounds?|pence|p\b)/gi,

  // Cardinal numbers
  cardinal: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g,

  // Ordinal numbers
  ordinal: /\b(\d+)(?:st|nd|rd|th)\b/gi,

  // Percentages
  percentage: /\b\d+(?:\.\d+)?%|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*percent/gi,

  // Dates (UK format)
  dateUK: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g,
  dateText: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)/gi,

  // Time
  time: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'clock)?\b/gi,

  // Phone (UK)
  phoneUK: /\b(?:0\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}|(?:\+44|44)\s?\d{10,11})\b/g,

  // Reference numbers
  reference: /\b[A-Z]{2,4}[\-\s]?\d{4,10}\b/gi
};
```

### Extraction Patterns (Chinese)

```javascript
const ZH_PATTERNS = {
  // Currency
  currency: /[£￡]?\s*[\d,]+(?:\.\d{2})?\s*[英鎊镑]|[\d,]+(?:\.\d{2})?\s*便士/g,

  // Chinese numerals
  chineseNum: /[零一二三四五六七八九十百千萬億]+/g,

  // Arabic numbers in Chinese text
  arabicNum: /\d+(?:,\d{3})*(?:\.\d+)?/g,

  // Dates
  date: /(\d{1,2})[月\/\-](\d{1,2})[日號号]?|(\d{4})年(\d{1,2})月(\d{1,2})[日號号]?/g,

  // Time
  time: /(\d{1,2})(?:[:：](\d{2}))?\s*(?:點|点|時|时)?(?:(\d{2})\s*分)?/g,

  // Percentage
  percentage: /\d+(?:\.\d+)?%|百分之\d+/g
};

// Chinese numeral conversion
function chineseToArabic(str) {
  const map = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100, '千': 1000, '萬': 10000, '億': 100000000
  };
  // Parse algorithm handles: 一百二十三 → 123
  // Implementation in translation_validator.js
}
```

### Validation Logic

```javascript
class NumberValidator {
  validate(sourceText, translatedText) {
    const sourceNums = this.extractNumbers(sourceText, 'en');
    const targetNums = this.extractNumbers(translatedText, 'zh');

    const warnings = [];

    // Check: Numbers in source missing from target
    for (const num of sourceNums) {
      if (!this.findMatch(num, targetNums)) {
        warnings.push({
          type: 'missing_number',
          severity: 'high',
          source: num,
          message: `數字 ${num.value} 可能缺失`
        });
      }
    }

    // Check: Number count mismatch
    if (sourceNums.length !== targetNums.length) {
      warnings.push({
        type: 'count_mismatch',
        severity: 'medium',
        message: `原文有 ${sourceNums.length} 個數字，譯文有 ${targetNums.length} 個`
      });
    }

    return {
      isValid: warnings.filter(w => w.severity === 'high').length === 0,
      warnings
    };
  }

  findMatch(sourceNum, targetNums, tolerance = 0.001) {
    return targetNums.some(t =>
      Math.abs(t.value - sourceNum.value) <= tolerance
    );
  }
}
```

## Component 2: Confidence Scorer

Based on research findings, gpt-4.1-nano supports logprobs but streaming complicates their use. We'll use heuristic methods for Phase 1.

### Heuristic Signals

| Signal | Detection | Severity |
|--------|-----------|----------|
| Length ratio anomaly | `targetLen / sourceLen < 0.3 or > 3.0` | Medium |
| Untranslated English | `/[a-zA-Z]{4,}/` in Chinese output | High |
| AI failure phrases | Contains "我無法", "抱歉", "作為AI" | High |
| Identical text | source === target | High |
| Placeholder text | Contains "[翻譯]", "..." repeated | Medium |
| Question marks | Excessive "?" in output | Low |

### Implementation

```javascript
class ConfidenceScorer {
  score(sourceText, translatedText) {
    const signals = [];
    let totalPenalty = 0;

    // Length ratio check
    const ratio = translatedText.length / sourceText.length;
    if (ratio < 0.3 || ratio > 3.0) {
      signals.push({ signal: 'length_ratio', penalty: 0.3 });
      totalPenalty += 0.3;
    }

    // Untranslated English detection
    const englishWords = translatedText.match(/[a-zA-Z]{4,}/g) || [];
    const englishRatio = englishWords.length / translatedText.split(/\s+/).length;
    if (englishRatio > 0.2) {
      signals.push({ signal: 'untranslated_english', penalty: 0.4 });
      totalPenalty += 0.4;
    }

    // AI failure phrases
    const failurePhrases = ['我無法', '抱歉', '作為AI', '作為一個', '我是一個'];
    if (failurePhrases.some(p => translatedText.includes(p))) {
      signals.push({ signal: 'ai_failure', penalty: 0.5 });
      totalPenalty += 0.5;
    }

    // Identical text check
    if (sourceText.trim() === translatedText.trim()) {
      signals.push({ signal: 'no_translation', penalty: 1.0 });
      totalPenalty += 1.0;
    }

    // Calculate confidence
    const confidence = Math.max(0, 1 - totalPenalty);

    return {
      confidence,
      level: confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
      signals
    };
  }
}
```

## Component 3: Combined Validator

```javascript
class TranslationValidator {
  constructor() {
    this.numberValidator = new NumberValidator();
    this.confidenceScorer = new ConfidenceScorer();
  }

  validate(sourceText, translatedText, scenario = null) {
    const numberResult = this.numberValidator.validate(sourceText, translatedText);
    const confidenceResult = this.confidenceScorer.score(sourceText, translatedText);

    // Combine results
    const allWarnings = [
      ...numberResult.warnings,
      ...confidenceResult.signals.map(s => ({
        type: s.signal,
        severity: s.penalty > 0.3 ? 'high' : 'medium',
        message: this.getSignalMessage(s.signal)
      }))
    ];

    return {
      isValid: numberResult.isValid && confidenceResult.level !== 'low',
      confidence: confidenceResult.level,
      confidenceScore: confidenceResult.confidence,
      warnings: allWarnings,
      showWarning: confidenceResult.level === 'low' ||
                   allWarnings.some(w => w.severity === 'high')
    };
  }

  getSignalMessage(signal) {
    const messages = {
      'length_ratio': '翻譯長度異常',
      'untranslated_english': '部分內容未翻譯',
      'ai_failure': '翻譯可能失敗',
      'no_translation': '未進行翻譯'
    };
    return messages[signal] || signal;
  }
}
```

## UI Integration

### Warning Display

```html
<!-- In translation entry -->
<div class="translation-entry" data-confidence="low">
  <div class="entry-english">The balance is £1,500</div>
  <div class="entry-chinese">餘額是 £150</div>
  <div class="validation-warning">
    <span class="warning-icon">⚠️</span>
    <span class="warning-text">數字可能有誤，請對照英文原文</span>
  </div>
</div>
```

### CSS Styles

```css
.translation-entry[data-confidence="low"] {
  border-left: 3px solid var(--warning-orange);
}

.translation-entry[data-confidence="low"] .entry-chinese {
  opacity: 0.8;
}

.validation-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 170, 0, 0.1);
  border-radius: 4px;
  font-size: 12px;
  color: var(--warning-orange);
}
```

## Integration Point

Validation should happen in the frontend after receiving each translation chunk:

```javascript
// In eca.html, after receiving translation
function handleTranslationComplete(segment) {
  const validator = new TranslationValidator();
  const result = validator.validate(
    segment.english,
    segment.chinese,
    currentScenario
  );

  segment.validation = result;

  if (result.showWarning) {
    renderWarning(segment, result);
  }
}
```

## Phase 2: Logprobs Integration (Future)

When we want higher accuracy, we can enable logprobs on the translation API:

```python
# In main.py /api/translate/stream
response = client.chat.completions.create(
    model="gpt-4.1-nano",
    messages=[...],
    stream=True,
    logprobs=True,
    top_logprobs=3
)

# Extract confidence from logprobs
for chunk in response:
    if chunk.choices[0].logprobs:
        token_logprob = chunk.choices[0].logprobs.content[0].logprob
        confidence = math.exp(token_logprob)  # Convert to probability
```

This provides actual model confidence per token, enabling more precise warnings.

## Summary

| Component | Status | Priority |
|-----------|--------|----------|
| Number Validator | Design Complete | P0 - Critical for banking calls |
| Confidence Scorer | Design Complete | P1 - Improves user trust |
| UI Integration | Design Complete | P0 - Required for warnings |
| Logprobs Integration | Future Phase | P2 - Nice to have |

---

*Design completed: 2026-02-06*
*Based on research by: validation-researcher, confidence-researcher*
