# 會議語音助手「建議回應」功能 UX 研究報告

## 研究摘要

本報告針對會議語音助手的「建議回應」功能進行全面的 UX 研究，涵蓋競品分析、認知負荷研究、以及替代方案探索。研究目標是找出最適合會議場景的 AI 建議呈現方式。

---

## 1. 競品分析

### 1.1 主要競品功能對照表

| 產品 | 即時建議回應 | 實現方式 | 目標用戶 | 成熟度 |
|------|-------------|----------|----------|--------|
| **Otter.ai Meeting Agent** | 有（2025年3月推出） | 語音激活 AI 代理人，可回答問題、安排後續行動、生成郵件草稿 | 商務會議 | 新功能，逐步推出中 |
| **Otter Sales Agent** | 有 | 銷售通話中即時指導與異議處理建議 | 銷售團隊 | 已上線 |
| **Microsoft Copilot in Teams** | 部分有 | 即時摘要、行動項目建議、遲到者追趕摘要；Facilitator 功能可追蹤會議目標 | 企業用戶 | 成熟，持續更新 |
| **Google Meet (Gemini)** | 否 | 專注於會後筆記、摘要、翻譯字幕 | 企業用戶 | 成熟 |
| **Fireflies.ai** | 有（Live Assist） | 即時建議、指導與答案；「Talk to Fireflies」整合 Perplexity 即時網路搜尋 | 多元用戶 | 進階功能 |
| **Gong** | 否（事後分析） | 通話後分析、洞察、指導機會 | 銷售團隊 | 成熟 |
| **Balto** | 有 | 即時動態提示、工作流程指引、異議處理 | 客服/銷售 | 最完整的即時體驗 |

### 1.2 關鍵發現

#### 成功案例：銷售領域的即時指導

**Balto** 和 **Otter Sales Agent** 在銷售場景中實現了即時建議功能：

> "Balto delivers real-time guidance, giving agents dynamic prompts and workflows that help them handle objections, stay on message, and improve conversion rates in the moment." - [Top 8 Gong Alternatives](https://www.balto.ai/competitors/gong-alternatives/)

成功要素：
- **明確的目標**：銷售通話有清晰的目標（成交）
- **可預測的模式**：異議處理有標準流程
- **單一對話**：通常是 1:1 對話
- **專業培訓**：用戶是受過訓練的銷售人員

#### 保守案例：通用會議助手

**Google Meet** 和 **Gong** 選擇不提供即時回應建議：

原因分析：
1. **會議類型多樣性**：無法預測用戶需要什麼樣的建議
2. **認知負荷風險**：會議中額外資訊可能造成分心
3. **準確性挑戰**：通用場景難以確保建議品質
4. **信任問題**：2024 年全球 AI 信任度從 62% 降至 54%

#### 失敗教訓

> "Too many companies are deploying AI to cut costs, not solve problems, and customers can tell the difference." - [Qualtrics Research](https://www.qualtrics.com/articles/news/ai-powered-customer-service-fails-at-four-times-the-rate-of-other-tasks/)

> "AI-powered customer service fails at four times the rate of other tasks." - Qualtrics XM Institute

常見失敗原因：
- AI 無法處理複雜或非標準情況
- 用戶被困在循環中無法解決問題
- 缺乏情感智慧和同理心
- 幻覺問題（hallucination rates 5-25%）

---

## 2. 會議 UX 研究發現

### 2.1 認知負荷研究

#### 工作記憶限制

> "Working memory is a cognitive system that temporarily holds and manipulates information... The average person can only keep 7 (plus or minus 2) items in their working memory." - [Cognitive Load Theory](https://lawsofux.com/cognitive-load/)

在會議中，用戶已經需要處理：
- 對方的發言內容
- 自己的思考和回應準備
- 情境脈絡和歷史
- 非語言訊號（表情、語氣）
- 時間壓力

**額外的 AI 建議會增加認知負荷。**

#### 中斷研究

> "Interventions at workflow boundaries achieved 52% engagement rates, while mid-task interventions were dismissed 62% of the time." - [Developer Interaction Patterns with Proactive AI](https://arxiv.org/abs/2601.10253)

**關鍵洞察**：在「任務邊界」（如發言輪替）提供建議比「任務中」更有效。

#### 時機研究

> "While timing did not significantly impact analytic performance, suggestions appearing after potential problems were preferred, enhancing trust and efficiency." - [CHI 2024 Research](https://dl.acm.org/doi/10.1145/3613904.3642168)

**心理準備度**很重要：

> "Designers must consider not only when the system is confident enough to act, but also when users are receptive to unsolicited help." - [Proactive AI Research](https://arxiv.org/html/2509.09309v1)

### 2.2 會議類型差異

| 會議類型 | 建議需求程度 | 時間壓力 | 預測性 |
|----------|-------------|----------|--------|
| **1:1 定期同步** | 低 | 低 | 高 |
| **銷售/談判** | 高 | 高 | 中 |
| **腦力激盪** | 低 | 低 | 低 |
| **決策會議** | 中 | 中 | 中 |
| **專案進度會議** | 低 | 中 | 高 |
| **客訴處理** | 高 | 高 | 中 |

> "A formal meeting has a set agenda and a strict protocol... An informal meeting may not look like a traditional meeting at all." - [Slack Blog](https://slack.com/blog/collaboration/difference-between-formal-informal-meetings)

### 2.3 用戶偏好：控制 vs 自動化

**Copilot（輔助）vs Agent（自動）模式**：

> "AI Co-Pilots are designed to keep the user in charge, with users approving actions before they are completed." - [AI Co-Pilot vs Agentic AI](https://www.rezolve.ai/blog/ai-co-pilot-vs-agentic-ai-key-differences)

> "Use an AI copilot when humans stay in the driver's seat, and deploy AI agents when autonomous execution creates outsized efficiency or speed." - [Microsoft Copilot](https://www.microsoft.com/en-us/microsoft-copilot/copilot-101/copilot-ai-agents)

**會議場景建議**：採用 Copilot 模式，讓用戶保持控制權。

---

## 3. 替代方案評估

### 3.1 方案對比表

| 方案 | 描述 | 優點 | 缺點 | 適用場景 |
|------|------|------|------|----------|
| **A. 即時自動建議** | 對方說完後自動顯示建議 | 最快的回應支援 | 認知負荷高、干擾性強、準確性風險 | 高度結構化對話（如客服腳本） |
| **B. 用戶主動請求** | 用戶按鈕/語音觸發建議 | 用戶控制、降低干擾 | 需要額外操作、可能錯過時機 | 通用會議、用戶偏好控制 |
| **C. 關鍵詞觸發** | 特定詞彙出現時才建議 | 精準、降低雜訊 | 設定複雜、可能漏掉重要情境 | 談判、術語密集對話 |
| **D. 事後回顧建議** | 會後提供改善建議 | 零干擾、深度分析 | 無即時幫助 | 培訓、自我提升 |
| **E. 靜默預備模式** | AI 準備好建議但不顯示，等用戶請求 | 低干擾、快速響應 | 用戶可能不知道建議已準備好 | 平衡即時性與控制 |
| **F. 分層漸進式** | 根據情境逐步增加建議強度 | 適應性強 | 實現複雜 | 長時間或複雜會議 |

### 3.2 創新方案探索

#### 方案 E：靜默預備模式（推薦）

**概念**：
- AI 持續分析對話，準備建議
- 建議不自動顯示
- UI 提供微妙提示（如圖示亮起）表示「建議已準備好」
- 用戶一鍵/一聲即可查看

**優勢**：
- 結合即時性（建議已準備好）和控制（用戶決定何時看）
- 降低認知負荷
- 建立用戶信任

**研究支持**：

> "Well-timed proactive suggestions required significantly less interpretation time than reactive suggestions (45.4s versus 101.4s)." - [Developer Interaction Patterns](https://arxiv.org/abs/2601.10253)

#### 方案 F：情境感知分層模式

**概念**：
根據對話情境動態調整建議強度：

| 情境 | 建議強度 | 呈現方式 |
|------|----------|----------|
| 一般對話 | 低 | 靜默預備 |
| 檢測到困難/停頓 | 中 | 微提示 |
| 檢測到關鍵時刻/壓力 | 高 | 主動建議 |
| 用戶請求 | 最高 | 完整建議面板 |

---

## 4. 具體設計建議

基於以上研究，提出以下三個可行方案：

### 方案一：「隨需助手」模式（On-Demand Assistant）

**核心設計**：
- **預設關閉**自動建議
- 提供「請求建議」快捷鍵/語音指令
- AI 持續監聽但不主動干預
- 用戶觸發後提供 2-3 個建議選項

**UI 呈現**：
```
+------------------------------------------+
|  會議進行中                    [? 請求建議] |
|  對方: "我們需要重新考慮預算..."            |
|                                          |
|  [按下快捷鍵後]                            |
|  +--------------------------------------+|
|  | AI 建議:                              ||
|  | 1. "我理解預算是重要考量，請問..."       ||
|  | 2. "我們可以討論分階段方案..."          ||
|  | 3. "需要我提供更多成本分析嗎？"         ||
|  +--------------------------------------+|
+------------------------------------------+
```

**適用情境**：通用會議、需要用戶高度控制

**實現複雜度**：低

### 方案二：「智慧提示」模式（Smart Nudge）

**核心設計**：
- AI 持續分析對話
- 建議準備好時，UI 顯示微妙提示（如圖示變亮）
- 用戶可選擇忽略或查看
- 不打斷用戶注意力

**UI 呈現**：
```
+------------------------------------------+
|  會議進行中                    [💡 建議就緒] |
|  對方: "我們需要重新考慮預算..."            |
|                                          |
|  [懸浮/點擊💡]                             |
|  +--------------------------------------+|
|  | 建議回應:                              ||
|  | "我理解您對預算的考量。我們是否可以      ||
|  |  討論分階段實施的可能性？"              ||
|  +--------------------------------------+|
+------------------------------------------+
```

**適用情境**：需要平衡即時性與控制的場景

**實現複雜度**：中

### 方案三：「場景自適應」模式（Context-Adaptive）

**核心設計**：
- 用戶預設會議類型（談判/一般/腦力激盪）
- 系統根據類型調整建議策略
- 談判模式：更主動提供建議
- 一般模式：靜默預備
- 允許會議中切換模式

**配置選項**：
```
會議助手設定
┌─────────────────────────────────────┐
│ 建議模式:                            │
│ ○ 被動模式 - 僅在請求時提供建議        │
│ ● 平衡模式 - 準備好時提示，不自動顯示   │
│ ○ 主動模式 - 關鍵時刻自動顯示建議      │
│                                     │
│ 會議類型:                            │
│ [▼ 商務談判]                         │
│                                     │
│ 觸發關鍵詞: [預算] [截止日期] [合約]   │
└─────────────────────────────────────┘
```

**適用情境**：進階用戶、特定垂直領域

**實現複雜度**：高

---

## 5. 設計原則建議

基於研究，建議遵循以下設計原則：

### 5.1 認知負荷管理

1. **最小干擾原則**：預設狀態應該是不干擾的
2. **漸進式揭露**：建議應該是可選的，而非強制的
3. **工作流程邊界**：在發言輪替時提供建議，而非說話中途

### 5.2 用戶控制

4. **用戶主權**：用戶應該能完全控制建議的開關
5. **可配置性**：允許用戶設定偏好的建議頻率和方式
6. **易於關閉**：任何建議都應該能一鍵關閉

### 5.3 信任建立

7. **透明度**：清楚說明建議來源和限制
8. **準確性優先**：寧可不建議，也不要給錯誤建議
9. **免責聲明**：建議僅供參考，用戶自行判斷

### 5.4 場景適應

10. **情境感知**：根據會議類型調整行為
11. **學習能力**：根據用戶反饋改善建議品質
12. **失敗優雅**：當 AI 無法提供有信心的建議時，明確告知

---

## 6. 建議的下一步

### 6.1 推薦採用方案

**短期（MVP）**：採用「方案一：隨需助手模式」

理由：
- 實現複雜度最低
- 風險最小（用戶完全控制）
- 可以收集用戶使用模式數據
- 為後續優化提供基礎

**中期**：進化到「方案二：智慧提示模式」

理由：
- 基於 MVP 數據優化觸發時機
- 提供更好的即時性體驗
- 保持用戶控制權

**長期**：發展「方案三：場景自適應模式」

理由：
- 針對特定垂直市場（如銷售、客服）優化
- 提供進階用戶更多配置選項

### 6.2 驗證建議

1. **用戶訪談**：與目標用戶確認建議需求和偏好
2. **原型測試**：建立低保真原型進行 A/B 測試
3. **指標定義**：定義成功指標（使用率、滿意度、任務完成率）
4. **迭代計畫**：規劃 2-3 輪迭代優化

### 6.3 技術準備

1. **延遲優化**：確保建議生成延遲 < 2 秒
2. **準確性監控**：建立建議品質評估機制
3. **用戶反饋收集**：實作建議評分機制

---

## 參考資料

### 競品與市場

- [Otter.ai Meeting Agent](https://otter.ai/blog/otter-meeting-agent-your-new-collaborative-teammate)
- [Microsoft Copilot in Teams](https://support.microsoft.com/en-us/office/use-copilot-in-microsoft-teams-meetings-0bf9dd3c-96f7-44e2-8bb8-790bedf066b1)
- [Fireflies.ai Features](https://fireflies.ai)
- [Gong Alternatives Comparison](https://www.balto.ai/competitors/gong-alternatives/)

### 學術研究

- [Developer Interaction Patterns with Proactive AI: A Five-Day Field Study](https://arxiv.org/abs/2601.10253)
- [Enhancing UX Evaluation Through Collaboration with Conversational AI Assistants (CHI 2024)](https://dl.acm.org/doi/10.1145/3613904.3642168)
- [Need Help? Designing Proactive AI Assistants for Programming (CHI 2025)](https://dl.acm.org/doi/10.1145/3706598.3714002)
- [Summaries, Highlights, and Action Items: LLM-powered Meeting Recap System](https://arxiv.org/html/2307.15793v3)
- [The Goldilocks Time Window for Proactive Interventions](https://arxiv.org/html/2504.09332)
- [Proactive AI Adoption can be Threatening: When Help Backfires](https://arxiv.org/html/2509.09309v1)

### UX 設計原則

- [Cognitive Load | Laws of UX](https://lawsofux.com/cognitive-load/)
- [Minimize Cognitive Load to Maximize Usability - Nielsen Norman Group](https://www.nngroup.com/articles/minimize-cognitive-load/)
- [Think-Time UX: Design to Support Cognitive Latency](https://www.uxtigers.com/post/think-time-ux)
- [Designing For Attention - Smashing Magazine](https://www.smashingmagazine.com/2020/09/designing-for-attention/)

### AI 輔助設計

- [AI Co-Pilot vs Agentic AI - Key Differences](https://www.rezolve.ai/blog/ai-co-pilot-vs-agentic-ai-key-differences)
- [Google Smart Reply Research](https://research.google/pubs/smart-reply-automated-response-suggestion-for-email/)
- [What AI Can't Do Well in Customer Service](https://agentiveaiq.com/blog/what-ai-cant-do-well-in-customer-service-and-what-to-do-instead)

---

*報告產出日期：2026-01-29*
*研究方法：Web 搜尋、學術文獻回顧、競品分析*
