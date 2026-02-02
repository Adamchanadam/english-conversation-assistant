# Web Speech API 能力研究報告

## 概述

本報告深入分析 Web Speech API (SpeechRecognition) 的能力和限制，特別聚焦於分段相關功能，以及與 OpenAI Realtime API 的配合方案。

---

## 1. Web Speech API 事件詳細分析

### 1.1 `onresult` 事件

**觸發時機**：
- 每當語音識別服務產生新的識別結果時觸發
- 在 `continuous: true` 模式下，會多次觸發
- 在 `continuous: false` 模式下，只在識別完成時觸發一次

**事件結構**：
```javascript
recognition.onresult = function(event) {
    // event.resultIndex: 本次事件中最低變更的結果索引
    // event.results: SpeechRecognitionResultList
    // event.results[i].isFinal: boolean
    // event.results[i][0].transcript: string
    // event.results[i][0].confidence: number (0-1)
};
```

### 1.2 `isFinal` 標記

**何時為 true**：
- 當語音識別服務認為用戶已完成一段話時
- 通常基於用戶說話後的**停頓檢測**（pause detection）
- 停頓長度由瀏覽器/服務決定，**無法配置**

**行為特點**：
- `isFinal: false` = interim result（臨時結果，可能變更）
- `isFinal: true` = final result（最終結果，不會再變）
- 一旦設為 `true`，該 index 的結果不會再更新

**限制**：
- 停頓時長**不可控**（Chrome 約 1-2 秒）
- 無法區分「思考停頓」和「句子結束」
- 快速連續說話時可能產生很長的單一結果

### 1.3 `resultIndex` 的含義

```
resultIndex = 本次事件中變更的最低索引

例如：
- results[0-2] 是之前的 final results
- results[3] 是新的 final result
- results[4] 是當前的 interim result
→ resultIndex = 3
```

**用途**：
- 優化處理：只需處理從 `resultIndex` 開始的結果
- final 結果不會改變，可累積保存
- interim 結果需要每次完全重建

### 1.4 累積文字 vs 增量文字

**官方模式是累積式**：
```javascript
// 正確模式
let finalTranscript = '';  // 全域累積
let interimTranscript = ''; // 每次重建

recognition.onresult = (event) => {
    interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }
};
```

**問題**：
- 沒有原生的「增量」模式
- 需要自行計算 delta（當前 - 上次）
- Chrome 和 iOS 行為不同（Chrome: 結果列表增長；iOS: 單一結果增長）

---

## 2. 分段信號功能分析

### 2.1 句子邊界信號

**結論：Web Speech API 不提供句子邊界信號**

- 沒有 `onsentenceend` 事件
- 沒有標點符號事件
- `isFinal` 基於停頓，不是基於語義

### 2.2 標點符號識別能力

**Chrome Web Speech API 的標點能力非常有限**：

| 功能 | 支援狀態 |
|------|---------|
| 自動標點 | ❌ 不支援 |
| 說「句號」插入 "。" | ⚠️ 部分語言支援 |
| 說「逗號」插入 "，" | ⚠️ 部分語言支援 |
| 句子邊界檢測 | ❌ 不支援 |

**歷史問題**：
- Chrome 曾經支援某些語言的自動標點，後來移除
- 第三方擴充功能需要自行實現標點插入

### 2.3 `continuous` 模式行為

```javascript
recognition.continuous = true;  // 持續識別模式
```

**行為**：
- 用戶停頓後不會自動停止識別
- 會持續產生多個 final results
- 60 秒超時限制（Chrome）
- 7 秒靜音超時（Chrome 可能自動結束）

**與分段的關係**：
- `continuous: true` 下，`isFinal` 會在每個「語音片段」結束後觸發
- 但這個「片段」是基於停頓，不是句子
- 快速說話 → 可能整段話變成一個結果
- 慢速說話 → 可能一句話變成多個結果

---

## 3. 相關事件時序

### 3.1 事件順序

```
audiostart → soundstart → speechstart → [識別進行] → speechend → soundend → audioend
```

### 3.2 各事件觸發時機

| 事件 | 觸發時機 | 用途 |
|------|---------|------|
| `audiostart` | 音訊輸入開始 | UI 提示開始錄音 |
| `soundstart` | 檢測到任何聲音 | 音量指示器 |
| `speechstart` | 檢測到語音 | 開始顯示識別結果 |
| `speechend` | 語音停止 | 用戶可能說完了 |
| `soundend` | 所有聲音停止 | 背景噪音也停了 |
| `audioend` | 音訊輸入結束 | 麥克風關閉 |

### 3.3 `speechend` 的時機

- `speechend` 會在用戶**停止說話幾秒後**觸發
- 這個延遲**無法配置**
- 在 `continuous: true` 下，`speechend` 後識別仍可繼續

---

## 4. 瀏覽器兼容性

### 4.1 支援狀態 (2025年1月)

| 瀏覽器 | SpeechRecognition 支援 |
|--------|----------------------|
| Chrome | ✅ 完整支援 (需網路) |
| Edge | ✅ 完整支援 (Chromium 核心) |
| Safari | ⚠️ 部分支援 (v14.1+) |
| Firefox | ❌ 不支援 |
| iOS Safari | ⚠️ 部分支援 |
| Android Chrome | ✅ 支援 |

**瀏覽器兼容性分數：50/100**

### 4.2 主要限制

1. **需要網路連線**：語音識別在雲端進行
2. **Chrome 專屬**：實質上只有 Chrome 家族完整支援
3. **需使用 prefix**：`webkitSpeechRecognition`（Chrome/Safari）
4. **HTTPS 必須**：安全性要求

### 4.3 Firefox 狀態

- 仍在實驗階段
- 需手動啟用 feature flag
- 不建議依賴

---

## 5. 與 OpenAI Realtime API 的配合

### 5.1 OpenAI semantic_vad 的觸發時機

根據 [OpenAI VAD 文檔](https://platform.openai.com/docs/guides/realtime-vad)：

**semantic_vad 特點**：
- 使用語義分類器判斷用戶是否說完
- 基於用戶說的**詞彙內容**評分
- 高確信度 → 立即結束
- 低確信度 → 等待更長超時

**優勢**：
- 比 Web Speech 更智能（考慮語義）
- 減少中途打斷
- 適合對話場景

### 5.2 `speech_started` / `speech_stopped` 事件

```javascript
// OpenAI Realtime 事件
{
    type: 'input_audio_buffer.speech_started',
    item_id: 'item_xxx'
}
{
    type: 'input_audio_buffer.speech_stopped',
    item_id: 'item_xxx'
}
```

**用途**：
- 打斷檢測
- UI 反饋（對方正在說話）
- 上下文管理

**已知問題 (2025年報告)**：
- `speech_stopped` 有時不可靠觸發
- 可能收到多個連續的 `speech_started`
- 建議增加 fallback 邏輯

### 5.3 OpenAI 事件作為分段信號的可行性

| 事件 | 作為分段信號 | 評估 |
|------|-------------|------|
| `speech_started` | ❌ 不適合 | 只標記開始 |
| `speech_stopped` | ⚠️ 可考慮 | 表示語音結束，但可能不可靠 |
| `response.done` | ✅ 可用 | AI 回應完成，代表一輪結束 |
| `conversation.item.created` | ✅ 可用 | 新對話項目創建 |

**推薦**：
- **用 `response.done`** 作為「AI 說完」的信號
- **用 transcript 事件** 作為「對方說完」的信號
- **不要完全依賴 `speech_stopped`**

---

## 6. 快速語速與連續說話的挑戰

### 6.1 Web Speech API 的問題

| 場景 | 問題 |
|------|------|
| 快速語速 | `isFinal` 延遲觸發，可能整段話成一個結果 |
| 連續說話 | 結果累積，無法分辨句子邊界 |
| 有停頓 | 可能在非句尾處觸發 `isFinal` |

### 6.2 累積問題

```
用戶說：「我想預約下週三的位置，大概是晚上七點，兩個人。」

可能的結果：
- 情況A (一次 final): 整句話
- 情況B (多次 final):
  - "我想預約下週三的位置"
  - "大概是晚上七點"
  - "兩個人"

無法預測哪種情況會發生，取決於說話節奏。
```

### 6.3 解決策略

1. **使用 OpenAI 的 transcription 代替 Web Speech**
   - OpenAI Realtime 內建 Whisper 轉錄
   - 可配置 `gpt-4o-mini-transcribe`（真正的串流）
   - 不依賴瀏覽器實現

2. **雙軌策略**
   - Web Speech 用於快速預覽（即使不完美）
   - OpenAI transcription 用於最終記錄

---

## 7. 技術方案推薦

### 方案 A：純 OpenAI Realtime（推薦）

```javascript
// 使用 OpenAI 內建轉錄，不依賴 Web Speech
const sessionConfig = {
    audio: {
        input: {
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: { type: 'semantic_vad' }
        }
    }
};

// 分段信號來源
// 1. conversation.item.input_audio_transcription.completed → 對方說完
// 2. response.done → AI 說完
```

**優點**：
- 跨瀏覽器一致
- 語義分段（semantic_vad）
- 統一的轉錄格式

**缺點**：
- 必須連接 OpenAI
- 成本考量

### 方案 B：Web Speech + OpenAI 混合

```javascript
// Web Speech 用於即時預覽
// OpenAI transcription 用於正式記錄

// 即時預覽（給用戶看）
recognition.onresult = (e) => showPreview(e.results);

// 正式記錄（用於分析）
case 'conversation.item.input_audio_transcription.completed':
    addToTranscript(event.transcript);
```

**優點**：
- 即時反饋
- 最終結果準確

**缺點**：
- 複雜度高
- 兩套文字可能不一致

### 方案 C：純 Web Speech（不推薦用於 ECA）

**理由**：
- 分段不可控
- 瀏覽器兼容性差
- 無法與 OpenAI 語義 VAD 協調

---

## 8. 結論與建議

### 8.1 關鍵發現

1. **Web Speech API 不提供可靠的句子分段信號**
   - `isFinal` 基於停頓，不是語義
   - 無標點符號識別
   - 無句子邊界事件

2. **OpenAI semantic_vad 是更好的分段方案**
   - 基於語義理解
   - 與 Realtime API 原生整合
   - 雖有 bug 報告，仍比 Web Speech 可靠

3. **瀏覽器兼容性是硬傷**
   - Web Speech 基本只能用於 Chrome
   - 對 Firefox/Safari 用戶不友好

### 8.2 ECA 專案建議（2026-02-02 更新）

> ⚠️ **重要更新**：經實測確認，OpenAI Realtime API 的轉錄事件只在 `speech_stopped` 後才觸發，
> **無法實現「邊說邊顯示」的即時英文字幕**。必須使用 Web Speech API 作為即時預覽的主要來源。

1. **即時英文預覽必須使用 Web Speech API**
   - 本地處理，延遲 ~100ms
   - 設置 `interimResults: true` 獲取逐字更新
   - 這是實現「邊說邊顯示」的唯一方案

2. **OpenAI Realtime API 用於正式記錄和翻譯**
   - `transcription.completed` → 最終英文轉錄（更準確）
   - `response.output_text.delta` → 中文翻譯串流
   - 配置 `semantic_vad` 進行語義分段

3. **雙軌策略是標準做法**
   ```
   Web Speech API ────→ 即時英文預覽（用戶即時看到）
   OpenAI Realtime ───→ 正式記錄 + 中文翻譯（延遲但準確）
   ```

4. **以 `response.done` 作為翻譯完成信號**
   - AI 翻譯完成 = segment 狀態更新為 DONE
   - 此時更新 UI 的對話記錄

5. **不要依賴 OpenAI 做即時英文顯示**
   - OpenAI 的 `transcription.delta` 也是在語音結束後才觸發
   - 如果需要「邊說邊顯示」，只能用 Web Speech API

---

## 參考資料

- [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Web Speech API Specification](https://webaudio.github.io/web-speech-api/)
- [Chrome Web Speech API Blog](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api)
- [OpenAI Realtime VAD Guide](https://platform.openai.com/docs/guides/realtime-vad)
- [OpenAI Realtime API Reference](https://platform.openai.com/docs/api-reference/realtime)
- [Can I Use - Speech Recognition](https://caniuse.com/speech-recognition)
