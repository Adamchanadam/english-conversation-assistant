# 即時指令按鈕系統設計

## 核心設計原則

> **Prompt 是方向性指引，不是照讀的台詞**
>
> - 所有 prompt/instruction 只提供「意圖方向」，不是逐字稿
> - AI 必須根據**當前話題、上下文、對話氛圍**動態生成回應
> - 每次回應都應有變化，生動、人性化、有彈性
> - 絕不能像機器人一樣照稿讀出固定句子

---

## 1. 當前按鈕執行邏輯分析

### 1.1 執行類型分類（簡化為 3 種）

| 按鈕 | 中文標籤 | 執行類型 | 是否調用 Controller | 結束對話 |
|------|---------|---------|-------------------|---------|
| AGREE | 同意 | `continue` | ✅ | ❌ |
| DISAGREE | 不同意 | `continue` | ✅ | ❌ |
| NEED_TIME | 我需要時間考慮 | `continue` | ✅ | ❌ |
| REPEAT | 請重複一次 | `continue` | ✅ | ❌ |
| PROPOSE_ALTERNATIVE | 提出替代方案 | `continue` | ✅ | ❌ |
| ASK_BOTTOM_LINE | 詢問對方底線 | `continue` | ✅ | ❌ |
| SAY_GOODBYE | 是時候說再見 | `natural_end` | ✅ | ✅ (自然過渡) |
| GOAL_MET | 達標 | `natural_end` | ✅ | ✅ (自然過渡，正面語氣) |
| EMERGENCY_STOP | 立即停止 | `emergency` | ❌ | ✅ (強制) |

### 1.2 各執行類型詳細流程

#### `standard` 類型（6 個按鈕）
```
用戶按按鈕 → 捕捉上下文 → 呼叫 Controller API
                              ↓
                    Controller 返回 utterance
                              ↓
         _injectUtterance() 注入 [Guidance: ...] 到 Realtime
                              ↓
                    AI 自然回應（不結束對話）
```

**當前問題**：所有 standard 按鈕共用同一套 prompt 模板，差異只在 directive 名稱。

#### `natural_end` 類型（SAY_GOODBYE）
```
用戶按按鈕 → 捕捉上下文 → 呼叫 Controller API
                              ↓
                    Controller 返回 utterance
                              ↓
    handleGoodbyeTransition() 注入自然告別 guidance
                              ↓
           AI 先回應對方 → 過渡 → 說再見
                              ↓
                         等待說完 → 斷線
```

**特點**：不會立即中斷 AI，讓 AI 自然結束對話。

#### `immediate_end` 類型（GOAL_MET）
```
用戶按按鈕 → 呼叫 Controller API
                    ↓
          handleSoftStop() 立即執行：
          - response.cancel
          - output_audio_buffer.clear
          - 注入簡短 goodbye
                    ↓
              等待說完 → 斷線
```

**特點**：可以立即中斷當前 AI 回應（因為已達標，快速結束合理）。

#### `emergency` 類型（EMERGENCY_STOP）
```
用戶按按鈕 → handleHardStop() 立即執行：
             - response.cancel
             - output_audio_buffer.clear
             - 300ms 後斷線（無 goodbye）
```

**特點**：最高優先級，無任何 API 呼叫，立即切斷一切。

### 1.3 當前 Prompt 模板（後端）

```
## Directive Meanings:
- AGREE: Express agreement with the counterpart's proposal
- DISAGREE: Express disagreement politely but firmly
- NEED_TIME: Request time to consider or consult
- REPEAT: Ask the counterpart to repeat or clarify
- PROPOSE_ALTERNATIVE: Suggest a different option
- ASK_BOTTOM_LINE: Probe for the counterpart's minimum acceptable terms
- SAY_GOODBYE: Initiate polite conversation ending
- GOAL_MET: Goal achieved, wrap up positively
- CONTINUE: Normal conversation flow, respond naturally
```

**問題**：這些是 AI 對 directive 的「理解說明」，不是用戶可控的「具體 prompt」。

---

## 2. 可配置按鈕系統設計

### 2.1 設計目標

1. **每個按鈕獨立配置**：prompt、執行類型、顯示文字
2. **簡單易用的 UI**：下拉選單選執行類型，文字框填 prompt
3. **預設模板**：提供合理預設值，用戶可覆蓋
4. **向後相容**：不改變現有 API 結構

### 2.2 按鈕配置資料結構

```typescript
interface ButtonConfig {
  // 基本資訊
  id: string;                    // 唯一識別碼（如 "btn_agree"）
  label: string;                 // 顯示文字（繁中）
  icon?: string;                 // 可選圖標

  // 執行邏輯
  executionType: ExecutionType;  // 執行類型（見下方）

  // Prompt 配置
  promptTemplate: string;        // 發送給 Controller 的指令模板
  guidanceTemplate?: string;     // 注入 Realtime 的 guidance 模板（可選覆蓋）

  // 樣式
  buttonClass: string;           // CSS class（如 "btn-secondary", "btn-danger"）

  // 進階選項
  requireConfirmation?: boolean; // 是否需要確認（用於危險操作）
  cooldownMs?: number;           // 冷卻時間（防止連續點擊）
}

type ExecutionType =
  | "standard"       // 正常對話繼續
  | "natural_end"    // 自然結束（先過渡再告別）
  | "immediate_end"  // 立即結束（可中斷，快速告別）
  | "emergency"      // 緊急停止（無告別，強制斷線）
  | "inject_only";   // 僅注入（不呼叫 Controller，直接注入 prompt）
```

### 2.3 Prompt 模板變數

在 `promptTemplate` 和 `guidanceTemplate` 中可使用的變數：

| 變數 | 說明 | 範例值 |
|------|------|--------|
| `{{goal}}` | 用戶的任務目標 | "協商降價 10%" |
| `{{lastCounterpart}}` | 對方最後說的話 | "我們最多只能給 5% 折扣" |
| `{{lastAI}}` | AI 最後說的話 | "我理解您的立場..." |
| `{{agentName}}` | 用戶名字 | "Adam Chan" |
| `{{counterpartType}}` | 對方身份 | "customer service" |
| `{{customInput}}` | 用戶自定義輸入 | （彈窗輸入的內容） |

### 2.4 預設按鈕配置

> **重要**：所有 `guidanceTemplate` 都是**方向性指引**，AI 必須根據當前上下文自由發揮，
> 生成生動、人性化、有變化的回應。絕不是照讀的台詞。

```javascript
const DEFAULT_BUTTONS = [
  // Row 1: 立場表達
  {
    id: "btn_agree",
    label: "同意",
    executionType: "continue",
    promptTemplate: "Express agreement with the counterpart's point.",
    guidanceTemplate: `[Direction: Your principal wants you to EXPRESS AGREEMENT with what they just said.
- React naturally to their specific point
- Show genuine understanding of WHY you agree
- Be warm and positive, but don't overdo it
- Keep it conversational - vary your phrasing each time]`,
    buttonClass: "btn-secondary"
  },
  {
    id: "btn_disagree",
    label: "不同意",
    executionType: "continue",
    promptTemplate: "Express disagreement politely but firmly.",
    guidanceTemplate: `[Direction: Your principal wants you to DISAGREE with this.
- First show you understand their position (don't dismiss)
- Then express your disagreement with reasoning
- Be firm but respectful - this is a negotiation, not a fight
- Find your own words based on the context]`,
    buttonClass: "btn-secondary"
  },
  {
    id: "btn_need_time",
    label: "我需要時間考慮",
    executionType: "continue",
    promptTemplate: "Request time to think before committing.",
    guidanceTemplate: `[Direction: Your principal needs TIME before deciding.
- Don't reject or accept - just defer
- Give a natural reason (need to review, consult, think it over)
- Keep the door open for future discussion
- Sound thoughtful, not evasive]`,
    buttonClass: "btn-secondary"
  },

  // Row 2: 資訊收集
  {
    id: "btn_repeat",
    label: "請重複一次",
    executionType: "continue",
    promptTemplate: "Ask them to repeat or clarify.",
    guidanceTemplate: `[Direction: Your principal needs them to REPEAT or CLARIFY.
- Ask naturally - maybe you missed something, or want more detail
- Be specific if possible about what part needs clarification
- Stay engaged and interested]`,
    buttonClass: "btn-secondary"
  },
  {
    id: "btn_propose",
    label: "提出替代方案",
    executionType: "continue",
    promptTemplate: "Suggest an alternative approach.",
    guidanceTemplate: `[Direction: Your principal wants to PROPOSE SOMETHING DIFFERENT.
- Acknowledge their offer first
- Then pivot to your alternative idea
- Frame it as a win-win if possible
- Be creative but realistic based on the goal]`,
    buttonClass: "btn-secondary"
  },
  {
    id: "btn_ask_bottom",
    label: "詢問對方底線",
    executionType: "continue",
    promptTemplate: "Probe for their minimum acceptable terms.",
    guidanceTemplate: `[Direction: Your principal wants to know their BOTTOM LINE.
- Ask tactfully - don't demand
- Frame it as wanting to understand what's possible
- You might ask about flexibility, limits, must-haves
- Read the room and phrase it appropriately]`,
    buttonClass: "btn-secondary"
  },

  // Row 3: 結束控制
  {
    id: "btn_goodbye",
    label: "是時候說再見",
    executionType: "natural_end",
    promptTemplate: "End the conversation gracefully.",
    guidanceTemplate: `[Direction: Your principal wants to END this conversation now.
- Wrap up naturally - don't just suddenly say goodbye
- Respond briefly to whatever they just said
- Signal you need to go (in your own words)
- Thank them warmly and say goodbye
- Make it feel like a natural ending, not an abrupt cutoff]`,
    buttonClass: "btn-warning"
  },
  {
    id: "btn_goal_met",
    label: "達標",
    executionType: "natural_end",
    promptTemplate: "Goal achieved! Wrap up positively.",
    guidanceTemplate: `[Direction: SUCCESS! The goal has been achieved. End on a HIGH NOTE.
- Express genuine satisfaction/gratitude
- Acknowledge what was accomplished
- Wrap up warmly and positively
- Say goodbye with enthusiasm
- This is a celebration - sound happy!]`,
    buttonClass: "btn-goal-met"
  },
  {
    id: "btn_emergency",
    label: "立即停止",
    executionType: "emergency",
    promptTemplate: null, // Not used - immediate disconnect
    guidanceTemplate: null,
    buttonClass: "btn-emergency"
  }
];
```

### 2.5 設定頁 UI 設計

#### 簡單模式（預設）
```
┌─────────────────────────────────────────────────────────┐
│  即時指令按鈕設定                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ☑ 使用預設按鈕配置 (建議新手使用)                         │
│                                                         │
│  預覽：                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────────────┐           │
│  │  同意   │ │ 不同意  │ │ 我需要時間考慮  │           │
│  └─────────┘ └─────────┘ └─────────────────┘           │
│  ...                                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 進階模式（展開後）
```
┌─────────────────────────────────────────────────────────┐
│  即時指令按鈕設定（進階）                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  按鈕 1: [同意________]                                  │
│  ├─ 執行類型: [standard ▼]                              │
│  │    ○ standard (繼續對話)                             │
│  │    ○ natural_end (自然結束)                          │
│  │    ○ immediate_end (立即結束)                        │
│  │    ○ emergency (緊急停止)                            │
│  │    ○ inject_only (僅注入指令)                        │
│  │                                                      │
│  ├─ Prompt 模板:                                        │
│  │  ┌───────────────────────────────────────────────┐  │
│  │  │ Express agreement with the counterpart's      │  │
│  │  │ proposal. Be genuine and positive.            │  │
│  │  └───────────────────────────────────────────────┘  │
│  │  可用變數: {{goal}} {{lastCounterpart}} {{lastAI}}    │
│  │                                                      │
│  └─ 樣式: [btn-secondary ▼]                            │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  按鈕 2: [不同意______]                                  │
│  ...                                                    │
│                                                         │
│  [+ 新增按鈕]  [重置為預設]                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.6 執行類型選項說明

| 執行類型 | UI 顯示名稱 | 說明 | 適用場景 |
|---------|------------|------|---------|
| `standard` | 繼續對話 | 呼叫 Controller → 注入指令 → 對話繼續 | 大部分對話指令 |
| `natural_end` | 自然結束 | 呼叫 Controller → 自然過渡 → 說再見 → 斷線 | 禮貌結束對話 |
| `immediate_end` | 立即結束 | 呼叫 Controller → 打斷當前 → 快速再見 → 斷線 | 達標後快速結束 |
| `emergency` | 緊急停止 | 無 API 呼叫 → 立即斷線 | 緊急情況 |
| `inject_only` | 僅注入指令 | 不呼叫 Controller → 直接注入 prompt | 簡單指令、測試 |

---

## 3. 實作計劃

### 3.1 Phase 1: 資料結構與存儲

**檔案變更**：
- `src/frontend/setup_page.html` - 新增按鈕配置 UI
- `src/frontend/app.js` - 支援動態按鈕配置
- `src/backend/models.py` - 新增 ButtonConfig model

**存儲位置**：`sessionStorage['vpn_button_config']`

### 3.2 Phase 2: 前端執行引擎重構

**變更 `handleDirective()`**：
```javascript
handleDirective(buttonId) {
    const btnConfig = this.buttonConfig[buttonId];

    switch (btnConfig.executionType) {
        case 'standard':
            this._executeStandard(btnConfig);
            break;
        case 'natural_end':
            this._executeNaturalEnd(btnConfig);
            break;
        case 'immediate_end':
            this._executeImmediateEnd(btnConfig);
            break;
        case 'emergency':
            this._executeEmergency(btnConfig);
            break;
        case 'inject_only':
            this._executeInjectOnly(btnConfig);
            break;
    }
}
```

### 3.3 Phase 3: 後端支援

**變更 Controller API**：
- 接受自定義 prompt template（可選）
- 若提供自定義 template，優先使用；否則使用預設

---

## 4. 向後相容性

- 若 `sessionStorage['vpn_button_config']` 不存在，使用 `DEFAULT_BUTTONS`
- 現有 API 不變，僅新增可選參數
- 現有按鈕 ID 保持不變（AGREE, DISAGREE 等）

---

## 5. 驗收標準

1. ✅ 設定頁可切換「簡單/進階」模式
2. ✅ 進階模式可獨立配置每個按鈕的 prompt 和執行類型
3. ✅ 對話頁正確讀取並執行自定義配置
4. ✅ 執行類型選項 UI 友好（下拉選單 + 說明文字）
5. ✅ 預設配置可一鍵重置
