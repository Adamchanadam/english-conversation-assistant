# Speech Segmentation Research Report

## Executive Summary

本報告研究人類說話習慣與智能分段策略，目標是解決 ECA 系統中「翻譯延遲」的核心問題。現有系統等待用戶完全停止說話（>1-2秒）才觸發翻譯，導致用戶無法即時理解對話內容。

**核心發現**：透過混合分段策略（時間閾值 + 語法線索 + 語義完整性），可將分段延遲從 1-2 秒降至 600-800ms，同時保持翻譯品質。

---

## 1. 英語說話習慣研究

### 1.1 語速（Words Per Minute, WPM）

| 情境 | WPM 範圍 | 說明 |
|------|----------|------|
| 學術演講、培訓 | 120-140 | 需要聽眾理解複雜概念 |
| 公開演講（標準） | ~150 | 最佳理解速度 |
| 有聲書 | 150-160 | 優化聽眾理解 |
| Podcast/廣播 | 150-170 | 較快但仍清晰 |
| 日常對話 | 160-180+ | 朋友間閒聊 |
| 電話客服 | 140-160 | 專業但友善 |

**來源**：[VirtualSpeech](https://virtualspeech.com/blog/average-speaking-rate-words-per-minute), [The Speaker Lab](https://thespeakerlab.com/blog/average-words-per-minute-speaking/)

**關鍵發現**：
- 最佳理解語速為 150-160 WPM
- 超過 200 WPM 時理解度下降 17-25%（密蘇里大學研究）
- 140 WPM 的說話者被認為更可信、更專業

### 1.2 停頓時長研究

#### 句內停頓（逗號位置）

| 研究來源 | 平均時長 | 標準差 |
|----------|----------|--------|
| 英語演講（大學畢業典禮） | 490ms | ±260ms |
| 德語講道 | 470ms | ±220ms |
| 公開演講平均 | 380-670ms | - |

#### 句間停頓（句號位置）

| 研究來源 | 平均時長 | 標準差 |
|----------|----------|--------|
| 英語演講（大學畢業典禮） | 1,010ms | ±400ms |
| 德語講道 | 980ms | ±340ms |
| 公開演講平均 | 810-1,240ms | - |

**關鍵發現**：
- 句內停頓與句間停頓的比例約為 **1:2**
- 0.6 秒的停頓被認為最自然
- 半秒停頓顯著提升句子理解度

**來源**：[BYU Scholars Archive](https://scholarsarchive.byu.edu/cgi/viewcontent.cgi?article=11044&context=etd), [MDPI Languages](https://www.mdpi.com/2226-471X/8/1/23), [Frontiers in Psychology](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.778018/full)

### 1.3 電話客服對話特點

1. **語速特點**：
   - 專業客服語速約 140-160 WPM
   - 重要資訊（日期、數字）會刻意放慢並加停頓
   - 語調穩定、音量適中

2. **停頓模式**：
   - 關鍵資訊前後會有較長停頓
   - 等待客戶回應時的「長靜默」可能表示困惑
   - 被打斷是常見情況

3. **語言特徵**：
   - 使用標準化短語（formulaic sequences）
   - 重複確認關鍵資訊
   - 同理心表達（"I understand", "I can see why"）

**來源**：[Call Centre Helper](https://www.callcentrehelper.com/professional-language-for-customer-service-182261.htm), [Springer](https://link.springer.com/article/10.1007/s10044-023-01182-8)

---

## 2. 現有技術分析

### 2.1 Web Speech API 限制

| 特性 | 說明 |
|------|------|
| 分段機制 | 無自動句子分段 |
| 標點符號 | 不提供標點（需後處理） |
| Interim Results | 提供中間結果但不穩定 |
| 長句處理 | 長段落識別不穩定 |

**問題**：Web Speech API 的 `onspeechend` 事件只在用戶完全停止說話時觸發，無法用於句子級分段。

**來源**：[MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)

### 2.2 VAD（Voice Activity Detection）技術

#### 閾值參數

| 參數 | 典型值 | 說明 |
|------|--------|------|
| activation_threshold | 0.5 | 開始偵測語音的閾值 |
| deactivation_threshold | 0.25 | 結束語音偵測的閾值 |
| end_silence_timeout | 700ms | 判斷說話結束的靜默時長 |
| no_input_timeout | 5000ms | 無輸入超時 |
| IPU segmentation | 200ms | Inter-Pausal Unit 分段 |

**OpenAI Realtime API VAD 設定**：
- `threshold`: 0-1（激活閾值）
- `prefix_padding_ms`: 語音前緩衝
- `silence_duration_ms`: 靜默判定時長

**來源**：[SpeechBrain](https://speechbrain.readthedocs.io/en/latest/tutorials/tasks/voice-activity-detection.html), [OpenAI VAD Guide](https://platform.openai.com/docs/guides/realtime-vad), [Skit Tech](https://tech.skit.ai/end-of-utterance-detection/)

### 2.3 同步口譯的 Chunking 策略

專業口譯員使用「分塊」（Chunking）策略來處理實時翻譯：

1. **核心原則**：不等待完整句子，而是在語義單元完整時即開始翻譯
2. **分塊依據**：
   - 語法結構（名詞短語、動詞短語、子句）
   - 語義完整性（一個完整的想法）
   - 停頓位置
3. **認知負載管理**：使用 formulaic sequences 減輕認知負擔

**來源**：[Frontiers in Psychology - Chunking in SI](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1252238/full)

---

## 3. 推薦分段策略

### 3.1 混合分段策略（Hybrid Segmentation）

```
┌─────────────────────────────────────────────────────────┐
│                    輸入：連續語音文字流                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 1: 時間閾值檢測                                   │
│  - 停頓 > 600ms → 可能是句子邊界                         │
│  - 停頓 > 300ms → 可能是子句邊界                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 2: 語法線索檢測                                   │
│  - 句末詞彙：right?, okay, thanks, please, so, well     │
│  - 問句結構：do you, can you, would you, is it, are you │
│  - 連接詞前：and, but, or, because, however             │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Stage 3: 長度保護                                       │
│  - 超過 15 字且有子句邊界 → 強制分段                      │
│  - 超過 25 字 → 無論如何強制分段                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    輸出：分段後的文字                     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 分段規則詳細定義

#### Rule 1: 停頓時間觸發

```javascript
const PAUSE_THRESHOLDS = {
  sentence_boundary: 600,    // ms - 可能是句子結束
  clause_boundary: 300,      // ms - 可能是子句結束
  word_gap_normal: 150,      // ms - 正常詞間停頓（不觸發）
};
```

#### Rule 2: 語法線索觸發

```javascript
const GRAMMAR_TRIGGERS = {
  // 句末標記詞（觸發分段）
  sentence_enders: [
    'right', 'okay', 'ok', 'thanks', 'thank you',
    'please', 'bye', 'goodbye', 'hello'
  ],

  // 問句開頭詞（前一段分段）
  question_starters: [
    'do you', 'can you', 'would you', 'could you',
    'is it', 'is there', 'are you', 'are there',
    'what', 'where', 'when', 'why', 'how', 'who'
  ],

  // 連接詞（可作為分段點）
  conjunctions: [
    'and', 'but', 'or', 'so', 'because',
    'however', 'therefore', 'although'
  ]
};
```

#### Rule 3: 長度保護

```javascript
const LENGTH_LIMITS = {
  soft_limit: 15,   // 超過此字數且有語法線索 → 分段
  hard_limit: 25,   // 超過此字數 → 強制分段
};
```

### 3.3 演算法實現

```javascript
class SmartSegmenter {
  constructor(options = {}) {
    this.pauseThreshold = options.pauseThreshold || 600;
    this.softLimit = options.softLimit || 15;
    this.hardLimit = options.hardLimit || 25;

    this.buffer = '';
    this.lastUpdateTime = Date.now();
    this.wordCount = 0;
  }

  /**
   * 處理新的轉錄文字
   * @param {string} transcript - 當前完整轉錄
   * @param {boolean} isFinal - 是否為最終結果
   * @returns {Object} { shouldSegment, segment, reason }
   */
  process(transcript, isFinal) {
    const now = Date.now();
    const pauseDuration = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    // 更新 buffer
    const newText = transcript.slice(this.buffer.length);
    this.buffer = transcript;
    this.wordCount = this.buffer.split(/\s+/).filter(w => w).length;

    // 檢查分段條件
    const result = this.checkSegmentation(pauseDuration, isFinal);

    if (result.shouldSegment) {
      const segment = this.buffer;
      this.reset();
      return { ...result, segment };
    }

    return result;
  }

  checkSegmentation(pauseDuration, isFinal) {
    // Rule 0: Final result 總是分段
    if (isFinal && this.buffer.trim()) {
      return { shouldSegment: true, reason: 'final_result' };
    }

    // Rule 1: 長停頓
    if (pauseDuration >= this.pauseThreshold && this.wordCount >= 3) {
      return { shouldSegment: true, reason: 'pause_detected' };
    }

    // Rule 2: 硬性長度限制
    if (this.wordCount >= this.hardLimit) {
      return { shouldSegment: true, reason: 'hard_limit' };
    }

    // Rule 3: 軟性長度 + 語法線索
    if (this.wordCount >= this.softLimit) {
      const hasGrammarCue = this.detectGrammarCue();
      if (hasGrammarCue) {
        return { shouldSegment: true, reason: 'soft_limit_with_grammar' };
      }
    }

    // Rule 4: 短文字 + 強語法線索
    if (this.wordCount >= 5) {
      const hasStrongCue = this.detectStrongGrammarCue();
      if (hasStrongCue) {
        return { shouldSegment: true, reason: 'strong_grammar_cue' };
      }
    }

    return { shouldSegment: false, reason: null };
  }

  detectGrammarCue() {
    const lower = this.buffer.toLowerCase();

    // 句末標記詞
    const enders = ['right', 'okay', 'ok', 'thanks', 'please'];
    for (const ender of enders) {
      if (lower.endsWith(ender) || lower.endsWith(ender + ' ')) {
        return true;
      }
    }

    // 連接詞
    const conjunctions = [' and ', ' but ', ' so ', ' because '];
    for (const conj of conjunctions) {
      if (lower.includes(conj) && this.wordCount > 8) {
        return true;
      }
    }

    return false;
  }

  detectStrongGrammarCue() {
    const lower = this.buffer.toLowerCase();

    // 問句結構（通常表示句子完整）
    const questionPatterns = [
      /\?$/,
      /right$/,
      /okay$/,
      /correct$/
    ];

    return questionPatterns.some(p => p.test(lower.trim()));
  }

  reset() {
    this.buffer = '';
    this.wordCount = 0;
  }
}
```

---

## 4. 參數建議

### 4.1 基礎參數

| 參數 | 建議值 | 範圍 | 說明 |
|------|--------|------|------|
| `pauseThreshold` | 600ms | 500-800ms | 主要分段觸發閾值 |
| `softLimit` | 15 words | 12-18 words | 軟性字數限制 |
| `hardLimit` | 25 words | 20-30 words | 硬性字數限制 |
| `minSegmentWords` | 3 words | 2-5 words | 最小分段字數 |

### 4.2 根據語速調整

| 語速估計 | pauseThreshold | softLimit | hardLimit |
|----------|----------------|-----------|-----------|
| 慢速 (<120 WPM) | 800ms | 12 words | 20 words |
| 正常 (120-160 WPM) | 600ms | 15 words | 25 words |
| 快速 (>160 WPM) | 500ms | 18 words | 30 words |

### 4.3 動態調整策略

```javascript
class AdaptiveSegmenter extends SmartSegmenter {
  constructor(options) {
    super(options);
    this.recentSegments = [];
    this.estimatedWPM = 150;
  }

  updateWPMEstimate(segment, durationMs) {
    const wordCount = segment.split(/\s+/).length;
    const wpm = (wordCount / durationMs) * 60000;

    // 指數移動平均
    this.estimatedWPM = this.estimatedWPM * 0.7 + wpm * 0.3;

    // 調整參數
    if (this.estimatedWPM < 120) {
      this.pauseThreshold = 800;
      this.softLimit = 12;
    } else if (this.estimatedWPM > 160) {
      this.pauseThreshold = 500;
      this.softLimit = 18;
    } else {
      this.pauseThreshold = 600;
      this.softLimit = 15;
    }
  }
}
```

---

## 5. 邊界情況處理

### 5.1 快速語速（>180 WPM）

**問題**：詞間停頓極短，難以偵測自然斷點

**解決方案**：
1. 降低停頓閾值至 400-500ms
2. 更依賴語法線索而非時間
3. 提高 softLimit 至 18-20 字
4. 使用連接詞作為主要分段點

### 5.2 慢速語速（<100 WPM）

**問題**：詞間停頓長，可能誤判為句子結束

**解決方案**：
1. 提高停頓閾值至 800-1000ms
2. 降低 minSegmentWords 至 2
3. 增加語法線索的權重
4. 考慮「思考性停頓」（um, uh, hmm）

### 5.3 連續說話無明顯停頓

**問題**：用戶一口氣說很長的句子

**解決方案**：
1. 硬性字數限制（25-30 字強制分段）
2. 在連接詞處尋找自然斷點
3. 使用語法結構分析（主句/從句邊界）

### 5.4 頻繁打斷與重新開始

**問題**：電話對話中常見的打斷情況

**解決方案**：
1. 偵測到新說話者時重置 buffer
2. 保留部分翻譯的上下文
3. 標記「被打斷」的片段

### 5.5 Filled Pauses（嗯、啊、um、uh）

**問題**：filled pauses 可能誤導分段

**解決方案**：
```javascript
const FILLED_PAUSES = ['um', 'uh', 'hmm', 'ah', 'er', 'like', 'you know'];

function filterFilledPauses(transcript) {
  return transcript.split(' ')
    .filter(word => !FILLED_PAUSES.includes(word.toLowerCase()))
    .join(' ');
}
```

---

## 6. 實施建議

### 6.1 MVP 階段

1. **實現基礎分段器**
   - 使用固定參數（pauseThreshold: 600ms, softLimit: 15, hardLimit: 25）
   - 實現基本語法線索偵測

2. **整合至 Web Speech API 流程**
   - 在 `onresult` handler 中調用分段器
   - 分段完成時觸發翻譯

3. **UI 反饋**
   - 顯示「正在聆聽...」狀態
   - 分段完成時顯示翻譯結果
   - 考慮顯示進度指示器

### 6.2 後續優化

1. **語速自適應**
   - 實現動態參數調整
   - 根據最近 5-10 個分段估計語速

2. **語法分析強化**
   - 使用簡單的 NLP 庫分析句子結構
   - 辨識問句 vs 陳述句

3. **用戶個人化**
   - 記錄用戶習慣語速
   - 允許手動調整敏感度

---

## 7. 測試計劃

### 7.1 測試場景

| 場景 | 預期行為 | 驗證方法 |
|------|----------|----------|
| 正常語速短句 | 句末分段 | 手動測試 |
| 正常語速長句 | 25 字內分段 | 自動化測試 |
| 快速連續說話 | 連接詞處分段 | 手動測試 |
| 有思考停頓 | 不在 um/uh 處分段 | 手動測試 |
| 問答對話 | 問句結束時分段 | 模擬對話測試 |

### 7.2 效能指標

| 指標 | 目標 | 量測方法 |
|------|------|----------|
| 分段延遲 | <800ms | 從停止說話到分段完成 |
| 翻譯延遲 | <1.5s | 從停止說話到顯示翻譯 |
| 分段品質 | >85% 語義完整 | 人工評估 |
| 誤分段率 | <10% | 人工評估 |

---

## 8. 參考資料

### 學術研究
- [Quantifying Speech Pause Durations - BYU Scholars Archive](https://scholarsarchive.byu.edu/cgi/viewcontent.cgi?article=11044&context=etd)
- [Occurrence and Duration of Pauses in Relation to Speech Tempo - MDPI](https://www.mdpi.com/2226-471X/8/1/23)
- [Chunking in simultaneous interpreting - Frontiers in Psychology](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1252238/full)
- [How Pause Duration Influences Impressions of English Speech - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8874014/)

### 技術文檔
- [Web Speech API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)
- [Voice Activity Detection - OpenAI](https://platform.openai.com/docs/guides/realtime-vad)
- [Voice Activity Detection - SpeechBrain](https://speechbrain.readthedocs.io/en/latest/tutorials/tasks/voice-activity-detection.html)
- [End of Utterance Detection - Skit Tech](https://tech.skit.ai/end-of-utterance-detection/)

### 產業最佳實踐
- [Configure Endpointing and Interim Results - Deepgram](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- [Average Speaking Rate and Words per Minute - VirtualSpeech](https://virtualspeech.com/blog/average-speaking-rate-words-per-minute)
