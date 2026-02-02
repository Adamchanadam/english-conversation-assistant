# Technical Research Report: Real-Time Voice Translation System

> **研究日期**: 2025-01-29
> **研究範圍**: 即時翻譯技術、低延遲架構、跨平台方案、音訊處理、創新技術

---

## 1. 即時翻譯技術現狀

### 1.1 Speech-to-Text (STT) API 比較

| 提供商 | 延遲 | 準確率 (WER) | 價格 | 語言支援 | 即時串流 |
|--------|------|-------------|------|----------|---------|
| **OpenAI Whisper API** | ~500ms | 9.2% | $0.006/min | 58 語言 | ❌ 需自行實作 |
| **OpenAI Realtime API** | <100ms | 同 GPT-4o | $0.06/min(輸入) $0.24/min(輸出) | 多語言 | ✅ 原生支援 |
| **Deepgram Nova-3** | <200ms | 8.6% | $0.0043/min | 36 語言 | ✅ 優秀 |
| **AssemblyAI Universal-2** | ~300ms | 8.4% (最佳) | $0.0025/min | ~20 語言 | ✅ 良好 |
| **Google Chirp 2** | ~300ms | 次佳 | $0.016/min | 100+ 語言 | ✅ 良好 |
| **Azure Speech** | ~250ms | 中等 | $0.001-0.002/min | 110+ 語言 | ✅ 良好 |

#### 關鍵發現

1. **最高準確率**: AssemblyAI Universal-2 (8.4% WER)，比 Whisper 減少 30% 幻覺率
2. **最低延遲**: Deepgram Nova-3 (<200ms)，OpenAI Realtime API (<100ms)
3. **最佳性價比**: AssemblyAI ($0.0025/min) 或 Deepgram ($0.0043/min)
4. **最多語言**: Google (100+) 或 Azure (110+)

### 1.2 OpenAI Realtime API vs Whisper

| 特性 | Realtime API (gpt-realtime-mini) | Whisper + 自行串流 |
|------|------------------------------|-------------------|
| 延遲 | <100ms（近乎即時） | 380-520ms（需工程優化） |
| 架構 | 原生 speech-to-speech | 需串接 STT → LLM → TTS |
| 中斷處理 | ✅ 內建 VAD | ❌ 需自行實作 |
| 成本 | 較高（音訊計費） | 較低（可自建） |
| 適用場景 | 對話式 AI、語音助理 | 批次轉錄、離線處理 |

#### gpt-realtime-mini 特點（ECA 指定模型）
- 專為低延遲設計，Genspark 測試顯示「近乎即時」
- 雙語翻譯與意圖識別表現優秀
- 最新穩定版本：`gpt-realtime-mini-2025-12-15`

### 1.3 新興技術：SimulStreaming

WhisperStreaming 正被 SimulStreaming 取代（同一作者）：
- 速度更快、品質更高
- 新增 LLM 翻譯模型串接
- 適合即時翻譯場景

---

## 2. 低延遲架構

### 2.1 WebRTC 優化

#### 基礎效能
- 典型延遲：<500ms，優化後可達 ~250ms
- 使用 UDP + RTP，比 HLS/DASH 更快
- 推送式傳輸，無需等待請求

#### 延遲來源與優化

| 延遲來源 | 問題 | 解決方案 |
|---------|------|---------|
| 網路 | 封包遺失、抖動 | 前向糾錯、抖動緩衝 |
| 裝置 | 編碼/解碼延遲 | 硬體加速、低功耗編碼器 |
| 伺服器 | RTT 過高 | 邊緣運算、CDN |
| 緩衝 | 緩衝過大 | 動態調整緩衝大小 |

#### 2025 新技術趨勢

1. **Media over QUIC (MOQ)**: nanocosmos 已整合，更低延遲
2. **AV1 編碼器**: 更好的壓縮比
3. **AI 優化**: 即時網路狀況分析，主動調整位元率
4. **邊緣運算**: 處理更接近用戶

### 2.2 語音 AI 延遲優化策略

根據 WebRTC.ventures 研究：
- 結合快速轉錄 + WebRTC 串流 + LiveKit
- 平行執行小型與大型語言模型
- 可大幅提升響應速度而不犧牲品質

### 2.3 本地模型 vs 雲端模型

| 面向 | 本地模型 | 雲端模型 |
|------|---------|---------|
| 延遲 | 更低（無網路延遲） | 依賴網路品質 |
| 準確率 | 中等（受限於模型大小） | 更高（大型模型） |
| 隱私 | 完全本地處理 | 資料需上傳 |
| 成本 | 一次性（設備） | 持續性（API） |
| 離線 | ✅ 支援 | ❌ 不支援 |

---

## 3. 跨平台方案

### 3.1 桌面應用框架

| 框架 | 包大小 | 記憶體 | 啟動時間 | 系統音訊捕獲 | 行動支援 |
|------|--------|--------|----------|-------------|---------|
| **Electron** | >100MB | 數百 MB | 1-2 秒 | ✅ 需 native addon | ❌ |
| **Tauri** | <10MB | 30-40MB | <0.5 秒 | ⚠️ 需 Rust 橋接 | ✅ iOS/Android |

#### Electron 優勢
- 成熟生態系統（Slack、VS Code）
- 完整 Node.js 整合
- 大量現成外掛（音訊、視訊）
- ASIO 專業音訊支援

#### Tauri 優勢
- 輕量快速
- 安全優先設計
- Rust 後端（高效能）
- 單一代碼庫支援桌面與行動

### 3.2 系統音訊捕獲

#### macOS

| 方案 | 權限需求 | 優點 | 缺點 |
|------|---------|------|------|
| **AudioTee.js** | System Audio Only | 不需重啟、Node.js EventEmitter | 需要 Swift binary |
| **Chromium 內建** | Screen & System Audio | 無外部依賴 | 需重啟、權限範圍大 |
| **Core Audio Taps** (macOS 14.2+) | 系統層級 | 低延遲直接存取 | 需 Swift/ObjC |
| **BlackHole** | 無 | 開源免費 | 需用戶設定虛擬裝置 |
| **Audio Hijack** | 標準 | 功能完整 | 付費軟體 |

#### Windows
- **WASAPI**: 原生支援，簡單高品質
- **Audacity**: 開源免費，跨平台
- **ASIO**: 專業低延遲（Electron 支援）

### 3.3 行動應用框架

| 框架 | GitHub Stars | 音訊處理 | 即時串流 | 優勢 |
|------|-------------|----------|---------|------|
| **Flutter** | 170k | flutter_sound, just_audio | 良好 | 單一代碼庫、UI 一致性 |
| **React Native** | 121k | react-native-live-audio-stream | 良好 | JS 生態系、熱重載 |

#### Flutter 音訊限制
- iOS 音訊捕獲需 native 橋接
- 進階濾波需 FFI
- 即時延遲可能較高

#### React Native 音訊限制
- JS 橋接可能造成延遲
- 背景處理需 native 服務設定
- 麥克風權限跨平台差異

### 3.4 LockedIn AI 參考架構

LockedIn AI 的 overlay 技術：
- **True Stealth Mode**: 面試/會議時隱形覆蓋層
- **透明度滑桿**: 即時調整可見度
- **116ms 響應時間**: 42 種語言支援
- **螢幕分享隱藏**: 對他人不可見
- **多模型架構**: DeepSeek + Azure OpenAI + Gemini + Claude + Grok

---

## 4. 音訊處理技術

### 4.1 回音消除 (AEC)

WebRTC 內建三大模組：
1. **延遲對齊估算**: 計算回音延遲
2. **自適應濾波器**: 估算並移除回音
3. **非線性處理 (NLP)**: 移除殘餘回音

#### 實作考量
- AEC 是最複雜的模組
- 使用傅立葉轉換、VAD、MDF 自適應濾波

### 4.2 噪音抑制

#### 傳統方法
```javascript
// WebRTC getUserMedia 約束
{ noiseSuppression: true }
```

#### AI 驅動方法 (2025)
- **RNNoise**: C 語言實作，可編譯為 WebAssembly
- **深度學習**: CNN、RNN 架構
- 可適應新噪音環境（非監督式學習）

### 4.3 自動增益控制 (AGC)

- 自動調整音量
- 注意：靜默時可能放大背景噪音

### 4.4 多音源分離

目前挑戰：
- 說話者識別需額外 API
- Whisper 不支援說話者分離
- AssemblyAI、Deepgram 有內建功能（額外收費）

---

## 5. 創新技術機會

### 5.1 On-Device AI（本地端 AI）

#### Apple MLX 框架
- 專為 Apple Silicon 設計
- 統一記憶體架構，CPU/GPU 共享
- 支援 Python、Swift、C++、C
- **MLX-Audio**: 本地端 TTS/STT/STS

#### ONNX Runtime
- 跨平台一致性
- 支援量化與優化推論
- iOS、Android、嵌入式 Linux

#### 離線翻譯可行性
- Gemma 3n 等模型支援即時翻譯
- 無雲端依賴
- 需權衡模型大小與準確度

### 5.2 語音克隆/TTS

#### ElevenLabs（領先方案）
| 模型 | 延遲 | 用途 |
|------|------|------|
| Flash v2.5 | ~75ms | 即時應用（語音代理） |
| Turbo v2.5 | ~250-300ms | 互動場景 |
| Multilingual v2 | 較高 | 長篇內容 |
| Eleven v3 | 較高 | 最大表現力 |

- **即時克隆**: 10 秒錄音即可
- **32+ 語言**: 克隆聲音可說多種語言
- **10,000+ 預設聲音**

#### 應用場景
- 用戶聲音說英文？技術上可行
- 隱私與道德考量需注意

### 5.3 發音評估

#### Azure Speech 發音評估
- **評估維度**: 準確度、流暢度、韻律、文法、詞彙
- **場景**: 朗讀、口說、遊戲
- **限制**:
  - 完整功能僅支援 en-US
  - 韻律評估僅限 en-US
  - 最長 30 秒音訊

- **價格**: ~$1.32/小時（與 STT 相同）

### 5.4 其他創新機會

1. **即時字幕 + 翻譯覆蓋層**: 類似 LockedIn AI
2. **情緒分析**: 對話中偵測情緒變化
3. **自動摘要**: 通話後生成摘要
4. **多方通話翻譯**: 支援多人多語言

---

## 6. 成本估算

### 6.1 API 成本比較

#### STT (Speech-to-Text)

| 服務 | 價格 | 10 分鐘成本 | 月用量 1000 小時 |
|------|------|------------|-----------------|
| AssemblyAI | $0.0025/min | $0.025 | $150 |
| Deepgram | $0.0043/min | $0.043 | $258 |
| Whisper API | $0.006/min | $0.06 | $360 |
| Azure | $0.001-0.002/min | $0.01-0.02 | $60-120 |
| Google Chirp | $0.016/min | $0.16 | $960 |

#### TTS (Text-to-Speech)

| 服務 | 價格 | 說明 |
|------|------|------|
| ElevenLabs | 訂閱制 | 依字元數計費 |
| Azure TTS | ~$0.016/1000字元 | |
| Google TTS | ~$0.016/1000字元 | |

#### OpenAI Realtime API

| 計費項目 | 價格 |
|---------|------|
| 音訊輸入 | $0.06/min |
| 音訊輸出 | $0.24/min |
| 文字輸入 | $4.00/1M tokens |
| 文字輸出 | $16.00/1M tokens |

**gpt-4o-mini-realtime (較便宜)**:
- 音訊輸入: $10.00/1M tokens
- 音訊輸出: $20.00/1M tokens

### 6.2 單次通話成本估算

**假設**: 10 分鐘通話，用戶說 4 分鐘，AI 說 2 分鐘

| 架構 | 估算成本 |
|------|---------|
| **OpenAI Realtime** | $0.24 + $0.48 = ~$0.72 |
| **STT + LLM + TTS** | $0.04 + $0.05 + $0.10 = ~$0.19 |
| **本地端模型** | 接近 $0 (僅設備成本) |

### 6.3 月度成本模擬

| 使用量 | OpenAI Realtime | 傳統架構 | 混合架構 |
|--------|----------------|---------|---------|
| 100 通話/月 | ~$72 | ~$19 | ~$40 |
| 1000 通話/月 | ~$720 | ~$190 | ~$400 |
| 10000 通話/月 | ~$7,200 | ~$1,900 | ~$4,000 |

### 6.4 定價模式建議

1. **Freemium**: 每月 X 分鐘免費，超過收費
2. **訂閱制**: $9.99/月（基本）、$19.99/月（專業）
3. **按量計費**: $0.05-0.10/分鐘
4. **企業方案**: 年約、量大優惠

---

## 7. 技術風險與緩解

### 7.1 風險矩陣

| 風險 | 影響 | 機率 | 緩解措施 |
|------|------|------|---------|
| API 延遲不穩定 | 高 | 中 | 多供應商備援、本地快取 |
| 成本超支 | 高 | 中 | 使用量監控、成本上限、混合架構 |
| 翻譯品質不一致 | 中 | 高 | 專業術語字典、用戶回饋機制 |
| 系統音訊捕獲複雜 | 中 | 高 | 跨平台抽象層、漸進式支援 |
| 隱私合規 | 高 | 中 | 本地處理選項、加密、GDPR/HIPAA |
| 多說話者混淆 | 中 | 中 | 說話者分離 API、VAD 優化 |

### 7.2 技術債務風險

- **依賴特定供應商**: 建議抽象層設計
- **API 版本更新**: 保持版本固定與測試
- **瀏覽器相容性**: WebRTC 標準持續演進

---

## 8. 推薦技術棧

### 8.1 MVP 推薦（快速驗證）— ECA 指定架構

```
前端: Web (React) + WebRTC
後端: FastAPI (Python)
STT/翻譯: OpenAI Realtime API (gpt-realtime-mini)
LLM: gpt-5-mini（講稿生成 + Smart 建議）
TTS: OpenAI Realtime API (內建)
```

**優點**: 最快上線、與 ECA 需求完全對齊
**缺點**: 較高 API 成本

### 8.2 成本優化架構（備選方案）

```
前端: Web + WebRTC
STT:  Deepgram Nova-3 或 AssemblyAI
LLM:  gpt-5-mini（維持 ECA 指定）
TTS:  ElevenLabs Flash v2.5
```

**優點**: 成本降低 50-70%
**缺點**: 串接複雜度增加，需驗證延遲是否達標

### 8.3 進階桌面應用

```
框架: Tauri (跨平台 + 行動)
音訊: AudioTee (macOS) / WASAPI (Windows)
STT:  Deepgram Streaming
LLM:  OpenAI + 本地 Llama 備援
TTS:  ElevenLabs
覆蓋: 系統級 overlay (類似 LockedIn)
```

### 8.4 隱私優先架構

```
STT:  本地 Whisper (MLX/ONNX)
LLM:  本地 Llama 3.2 / Gemma 3n
TTS:  MLX-Audio
翻譯: 本地 NLLB 或 MarianMT
```

**優點**: 完全離線、隱私保護
**缺點**: 需要強力設備、準確度較低

---

## 9. 架構設計建議

### 9.1 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Web App   │  │ Desktop App │  │     Mobile App      │  │
│  │  (React)    │  │  (Tauri)    │  │  (Flutter/RN)       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │                │                   │
          └────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   WebRTC    │
                    │   Gateway   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐   ┌──────▼──────┐  ┌─────▼─────┐
    │    STT    │   │     LLM     │  │    TTS    │
    │ (Deepgram)│   │  (GPT-4o)   │  │(ElevenLabs│
    └─────┬─────┘   └──────┬──────┘  └─────┬─────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Translation │
                    │    Engine    │
                    └─────────────┘
```

### 9.2 音訊處理流程

```
麥克風輸入 → VAD → 噪音抑制 → STT → 翻譯 → LLM → TTS → 輸出
     ↑                                              │
     └──────────── 回音消除 ◄──────────────────────┘
```

### 9.3 關鍵設計原則

1. **抽象層設計**: 可更換 STT/TTS/LLM 供應商
2. **串流優先**: 減少感知延遲
3. **優雅降級**: 網路不穩時有備案
4. **成本控制**: 使用量監控與限制

---

## 10. 總結與下一步

### 10.1 技術可行性結論

| 功能 | 可行性 | 建議優先級 |
|------|--------|-----------|
| 即時語音翻譯 | ✅ 高 | P0 |
| 低延遲對話 | ✅ 高 | P0 |
| 桌面系統音訊捕獲 | ⚠️ 中（平台差異） | P1 |
| 行動應用 | ✅ 高 | P2 |
| 離線翻譯 | ⚠️ 中（準確度權衡） | P3 |
| 語音克隆 | ✅ 高（ElevenLabs） | P3 |
| 發音評估 | ⚠️ 中（語言限制） | P3 |

### 10.2 建議開發路線

**Phase 1 - MVP (2-4 週)**
- Web 應用 + OpenAI Realtime API
- 基本翻譯功能驗證

**Phase 2 - 優化 (4-6 週)**
- 成本優化架構（替換為 Deepgram/AssemblyAI）
- 桌面應用（Tauri）

**Phase 3 - 進階 (6-8 週)**
- 系統音訊捕獲
- 行動應用支援
- 進階功能（語音克隆、發音評估）

---

## 參考資料

### STT/TTS 比較
- [Best Speech to Text Models 2025](https://nextlevel.ai/best-speech-to-text-models/)
- [Deepgram vs OpenAI vs Google STT](https://deepgram.com/learn/deepgram-vs-openai-vs-google-stt-accuracy-latency-price-compared)
- [Top APIs for Real-time Speech Recognition 2026](https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription)

### OpenAI Realtime
- [OpenAI Realtime API Pricing](https://skywork.ai/blog/agent/openai-realtime-api-pricing-2025-cost-calculator/)
- [GPT Realtime Mini Pricing](https://www.eesel.ai/blog/gpt-realtime-mini-pricing)
- [Realtime API vs Whisper vs TTS API](https://www.eesel.ai/blog/realtime-api-vs-whisper-vs-tts-api)

### WebRTC
- [WebRTC Low Latency Guide 2025](https://www.videosdk.live/developer-hub/webrtc/webrtc-low-latency)
- [Reducing Voice Agent Latency](https://webrtc.ventures/2025/06/reducing-voice-agent-latency-with-parallel-slms-and-llms/)

### 跨平台開發
- [Tauri vs Electron 2025](https://www.raftlabs.com/blog/tauri-vs-electron-pros-cons/)
- [Recording System Audio in Electron macOS](https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches)

### 本地端 AI
- [MLX Framework](https://mlx-framework.org/)
- [MLX-Audio GitHub](https://github.com/Blaizzy/mlx-audio)
- [Open-Source Translation Models](https://picovoice.ai/blog/open-source-translation/)

### 語音克隆
- [ElevenLabs API Guide 2025](https://www.webfuse.com/blog/elevenlabs-api-in-2025-the-ultimate-guide-for-developers)

### 發音評估
- [Azure Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
