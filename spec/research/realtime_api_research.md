---

name: realtime-api-research
description: OpenAI gpt-realtime-mini API 能力研究報告，供產品設計與技術決策參考。
date: 2026-01-29
sources:
  - https://cookbook.openai.com/examples/realtime_prompting_guide
  - https://developers.openai.com/blog/realtime-api
  - https://platform.openai.com/docs/models/gpt-realtime-mini
  - https://community.openai.com/t/how-to-ensure-that-the-ai-maintains-a-consistent-conversation-flow-even-if-the-user-attempts-to-disrupt-it/1065273
  - https://dev.to/faraz_farhan_83ed23a154a2/conversation-flow-control-when-users-dont-follow-your-script-1d07
-----------------------------------------------------------------

# OpenAI Realtime API 能力與限制研究報告

## 1. API 實際能力

### 1.1 指令遵循能力（量化數據）

| 指標 | 舊模型 (2024-12) | 新模型 gpt-realtime | 改進 |
|------|-----------------|-------------------|------|
| MultiChallenge 基準測試 | 20.6% | 30.5% | +48% |

**關鍵洞察**：
> 「具體指示現在威力更強。例如『始終在Y時說X』的提示，舊模型視為模糊指導，新模型可能在意外情況下嚴格遵循。」

### 1.2 模型擅長的事

| 能力 | 可靠性 | 說明 |
|------|-------|------|
| 角色扮演 | ✅ 高 | 可靠地採用特定口音或角色（如遊戲節目主持人）|
| 情感表達 | ✅ 高 | 能在單個回應中轉換多種情感 |
| 語速控制 | ✅ 高 | 理解「快速講話但不倉促」等微妙差別 |
| 語言約束 | ✅ 高 | 保持單一語言或實施代碼轉換規則 |
| 示例短語追蹤 | ✅ 高 | 密切遵循提供的示例以保持一致的語調 |
| 短句對話 | ✅ 高 | 5-20 字/句的自然對話 |

### 1.3 模型的限制

| 限制 | 說明 |
|------|------|
| **指令不保證被遵循** | 官方文件明確指出：「指令提供指導，但不保證被遵循」|
| **指令衝突會降級性能** | 「如果指令衝突、模糊或不清楚，模型性能會下降」|
| **無法強制線性流程** | 社區反饋：用戶偏離腳本時，模型難以維持嚴格流程 |
| **30.5% 指令遵循率** | 雖然改進 48%，但仍有 ~70% 情況可能偏離 |
| **溫度不可調** | GA 版本移除溫度參數，固定為 0.8 |

### 1.4 技術參數

| 參數 | 數值 |
|------|------|
| Context Window | 32,768 tokens |
| Max Output | 4,096 tokens |
| Max Input | 28,672 tokens |
| Session Instructions + Tools | 最大 16,384 tokens |
| Session Duration | 最長 60 分鐘 |
| Token TTL | 10 分鐘（需續期）|

---

## 2. 社區反饋的真實問題

### 2.1 開發者遇到的挑戰

| 問題 | 描述 |
|------|------|
| **流程偏離** | 用戶非常規措辭時，機器人跳過步驟 |
| **無法維持嚴格流程** | 機器人需要按步驟對話，但難以實現 |
| **不傾聽用戶** | 12% 完成率，用戶投訴「機器人不傾聽」 |
| **提示詞繞過** | 用戶透過改述繞過限制 |
| **中斷問題** | 無法有效中斷 AI，AI 會一直說到句子結束 |

### 2.2 社區的結論

> 「截至 2025 年 2 月，開發者詢問是否找到可靠解決方案，但**頁面未顯示官方或社區的具體技術方案**。」

**結論**：純靠 prompt 工程無法完全解決對話流程控制問題。

---

## 3. 成功案例的啟示

### 3.1 自適應對話流程案例

| 指標 | 傳統線性流程 | 自適應流程 |
|------|------------|-----------|
| 對話完成率 | 12% | 78% |
| 招生轉換率 | - | 71% |
| 用戶反饋 | 「機器人不傾聽」| 正面 |

### 3.2 成功的關鍵

> 「成功不在於寫更好的腳本，而在於構建能夠**適應人類真實溝通方式**的系統。」

### 3.3 五種常見用戶行為

1. **信息傾瀉**：一次性提供多個信息
2. **話題跳躍**：突然問不相關的問題
3. **提前提問**：還沒到那步就問結果
4. **模糊輸入**：不給具體答案
5. **多意圖消息**：一條訊息多個目的

### 3.4 自適應流程管理三層架構

1. **信息萃取層**：從任意消息中提取所有相關信息
2. **動態優先路由**：即時回答直接問題，然後溫和回到主流程
3. **情境感知回應**：記憶歷史對話，避免重複提問

---

## 4. OpenAI 官方最佳實踐

### 4.1 推薦的 Prompt 結構

```
1. Role & Objective — 身份和成功指標
2. Personality & Tone — 語氣風格
3. Context — 上下文資訊
4. Reference Pronunciations — 發音指南
5. Tools — 工具使用規則
6. Instructions/Rules — 操作規則
7. Conversation Flow — 狀態、目標、轉換
8. Safety & Escalation — 升級和回退邏輯
```

### 4.2 Conversation Flow 設計建議

```
Greeting → Discovery → Verification → Diagnosis → Resolution → Confirm/Close
```

> 「每個階段應定義明確的退出條件以推動轉換。」

### 4.3 關鍵技巧

| 技巧 | 說明 |
|------|------|
| **短句優先** | 「Realtime 模型遵循短 bullet points 比長段落更好」|
| **5-20 字/句** | 「每句應該只有幾個字（5-20 字左右）」|
| **標籤化區段** | 使用清晰標籤讓模型找到並遵循指令 |
| **小措辭大影響** | 用「unintelligible」替代「inaudible」改善了噪音處理 |
| **工具前言** | 工具呼叫前添加短句掩蓋延遲 |

### 4.4 處理複雜情況

| 問題 | 解決方案 |
|------|---------|
| 響應重複或機械 | 添加「Variety」規則鼓勵同義詞變化 |
| 發音不正確 | 提供音標參考 |
| 背景噪音 | 明確指導處理不清楚的音訊 |
| 工具呼叫失敗 | 指定序列規則和失敗處理 |
| 不必要的確認 | 使用「Do not ask for confirmation」指令 |

---

## 5. 對產品設計的啟示

### 5.1 不應該做的事

- ❌ 期望 prompt 能 100% 控制對話流程
- ❌ 寫過長、過複雜的指令
- ❌ 強制線性腳本（用戶不會遵循）
- ❌ 依賴模型處理複雜的多步驟協商邏輯

### 5.2 應該做的事

- ✅ 接受模型有 ~70% 機率偏離指令
- ✅ 設計「自適應」而非「強制」的流程
- ✅ 使用短句 bullet points
- ✅ 為常見情況提供明確處理方式
- ✅ 利用模型擅長的能力（角色扮演、語氣、情感）

### 5.3 Realtime API 最適合的場景

基於研究，API 最適合：

| 場景類型 | 適合度 | 原因 |
|---------|-------|------|
| **開放式對話** | ⭐⭐⭐⭐⭐ | 不需嚴格流程控制 |
| **客服問答** | ⭐⭐⭐⭐ | 可自適應用戶問題 |
| **角色扮演/陪伴** | ⭐⭐⭐⭐⭐ | 模型擅長 |
| **語言學習** | ⭐⭐⭐⭐ | 自然對話、糾正發音 |
| **信息收集** | ⭐⭐⭐ | 需要自適應設計 |
| **嚴格流程協商** | ⭐⭐ | 模型難以維持嚴格流程 |
| **代客談判** | ⭐⭐ | 需要精確控制，風險較高 |

---

## 6. 預期改進幅度

| 改進方案 | 預期改進 | 依據 |
|---------|---------|------|
| 優化 Prompt（通用） | +10-15% | 指令遵循率提升 48%，但基數低 |
| Role Templates（情景專屬）| +15-20% | 自適應流程案例數據 |
| 架構層改進（App 控制）| +20-30% | 社區反饋 |
| **合計最大改進** | **+40-50%** | 從 ~30% → ~75% |

---

## 7. 結論

### 7.1 API 的本質

gpt-realtime-mini 是一個**低延遲語音對話模型**，擅長自然、流暢、有情感的對話，但**不是一個精確執行指令的代理**。

### 7.2 設計建議

1. **降低精確控制期望**：接受 ~30% 的指令遵循率
2. **利用模型優勢**：角色扮演、情感、語氣、自然對話
3. **自適應而非強制**：允許靈活回應，而非嚴格腳本
4. **用戶即時介入**：保留按鈕讓用戶在關鍵時刻引導

### 7.3 產品定位建議

基於 API 能力，產品可能需要重新定位：
- 從「代客精確協商」→「語音助手輔助對話」
- 從「完全自動」→「人機協作」
- 從「嚴格流程」→「自適應引導」

---

## 參考資料

1. [Realtime Prompting Guide | OpenAI Cookbook](https://cookbook.openai.com/examples/realtime_prompting_guide)
2. [Developer notes on the Realtime API](https://developers.openai.com/blog/realtime-api)
3. [gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini)
4. [OpenAI Developer Community - Conversation Flow](https://community.openai.com/t/how-to-ensure-that-the-ai-maintains-a-consistent-conversation-flow-even-if-the-user-attempts-to-disrupt-it/1065273)
5. [DEV Community - Conversation Flow Control](https://dev.to/faraz_farhan_83ed23a154a2/conversation-flow-control-when-users-dont-follow-your-script-1d07)
