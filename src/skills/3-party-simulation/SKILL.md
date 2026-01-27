---
name: 3-party-simulation
description: 三方互動測試框架，透過 LLM 模擬用戶、AI Proxy、對方三方對話，量化 AI Proxy 的任務成功率。
---

# 3-Party Simulation Test Framework

## 概覽

自動化測試 AI Proxy Agent 的任務成功率，無需手動語音測試。透過 LLM 模擬三方互動：

```
┌─────────────┐    設定任務/按按鈕    ┌─────────────────┐
│   User      │ ──────────────────▶ │  AI Proxy Agent │
│ (腳本驅動)   │                     │ (gpt-5-mini)    │
└─────────────┘                     └────────┬────────┘
                                             │
                                    語音對話  │ (文字模擬)
                                             ▼
                                    ┌─────────────────┐
                                    │  Counterpart    │
                                    │ (gpt-5-mini)    │
                                    └─────────────────┘
```

## 使用方式

### 命令行

```bash
# 執行所有場景（離線模式，使用 mock）
node src/tests/simulation/run_simulation.js --offline

# 執行所有場景（線上模式，需後端運行）
node src/tests/simulation/run_simulation.js

# 執行特定場景
node src/tests/simulation/run_simulation.js --scenario "煤氣味報告"

# 詳細輸出
node src/tests/simulation/run_simulation.js --verbose

# 輸出 JSON 報告
node src/tests/simulation/run_simulation.js --output reports/simulation_report.json
```

### 線上模式要求

1. 啟動後端服務：
   ```bash
   C:\Users\adam\anaconda3\envs\adamlab4_env\python.exe src/backend/main.py
   ```

2. 執行測試：
   ```bash
   node src/tests/simulation/run_simulation.js
   ```

## 場景配置

場景存放於 `src/tests/simulation/scenarios/` 目錄，JSON 格式：

```json
{
  "name": "場景名稱",
  "description": "場景描述",
  "config": {
    "agentName": "AI 代表的身份",
    "counterpartType": "對方身份",
    "goal": "任務目標",
    "taskLanguage": "zh-TW",
    "rules": "約束規則",
    "ssot": "參考資料"
  },
  "counterpartPersona": "對方的 persona 描述",
  "userActions": [
    { "turn": 3, "action": "AGREE" }
  ],
  "successCriteria": {
    "mustMention": ["必須提及的關鍵詞"],
    "mustNotSay": ["不應該說的話"],
    "maxTurns": 6,
    "goalKeywords": ["目標相關關鍵詞"]
  },
  "maxTurns": 5
}
```

### 可用按鈕動作

| Action | 說明 |
|--------|------|
| `AGREE` | 同意 |
| `DISAGREE` | 不同意 |
| `NEED_TIME` | 需要時間考慮 |
| `REPEAT` | 請重複 |
| `PROPOSE_ALTERNATIVE` | 提出替代方案 |
| `ASK_BOTTOM_LINE` | 詢問底線 |
| `SAY_GOODBYE` | 說再見 |
| `GOAL_MET` | 達標 |

## 評估指標

| 指標 | 計算方式 | 閾值 |
|------|----------|------|
| **身份正確率** | AI 每輪是否保持 I 角色 | ≥ 95% |
| **目標推進率** | 對話中提及 Goal 相關關鍵詞 | ≥ 80% |
| **按鈕響應率** | 按按鈕後策略是否改變 | ≥ 90% |
| **任務完成率** | 是否達成 successCriteria | - |

## 輸出報告

### 控制台輸出

```
════════════════════════════════════════════════════════════
場景：煤氣味報告
════════════════════════════════════════════════════════════
配置：AI=陳大文, 對方=煤氣公司, 語言=zh-TW

對話記錄：
──────────────────────────────────────────────────────────────
[Turn 1] 煤氣公司: 你好，這裡是煤氣公司
[Turn 1] 陳大文: 你好，我是陳大文，我想報告煤氣味
         ✓ 身份正確 | ✓ 目標推進
──────────────────────────────────────────────────────────────

評估結果：
  身份正確率: 100%
  目標推進率: 100%
  按鈕響應率: 100%
  任務完成: ✓

總評：PASS
════════════════════════════════════════════════════════════
```

### JSON 報告

```json
{
  "timestamp": "2026-01-27T...",
  "totalScenarios": 6,
  "passed": 5,
  "failed": 1,
  "scenarios": [
    {
      "name": "煤氣味報告",
      "result": "PASS",
      "metrics": {
        "identityAccuracy": 1,
        "goalProgressRate": 1,
        "buttonResponseRate": 1,
        "taskCompleted": true
      }
    }
  ],
  "aggregateMetrics": {
    "avgIdentityAccuracy": 0.98,
    "avgGoalProgressRate": 0.85,
    "avgButtonResponseRate": 0.95,
    "overallPassRate": 0.83
  }
}
```

## 後端 API

### `POST /api/simulate/llm`

三方模擬專用的 LLM 調用端點。

**請求**：
```json
{
  "instructions": "系統指令",
  "messages": [
    { "role": "user", "content": "對話內容" }
  ]
}
```

**響應**：
```json
{
  "response": "LLM 回應文字",
  "error": null
}
```

## 檔案結構

```
src/tests/simulation/
├── run_simulation.js    # 測試執行器
├── simulator.js         # 三方互動模擬器
├── evaluator.js         # 評估器
└── scenarios/           # 場景配置
    ├── gas_report.json
    ├── discount_negotiation.json
    ├── complaint.json
    ├── interview.json
    ├── service_provider.json
    └── unknown_info.json
```

## 新增場景

1. 在 `scenarios/` 目錄新增 JSON 檔案
2. 遵循場景配置格式
3. 執行測試驗證：
   ```bash
   node src/tests/simulation/run_simulation.js --scenario "新場景名稱"
   ```

## 離線 vs 線上模式

| 模式 | 用途 | LLM 來源 |
|------|------|----------|
| **離線** (`--offline`) | 快速驗證框架 | Mock 回應（固定腳本）|
| **線上** (預設) | 真實測試 AI Proxy | 後端 gpt-5-mini |

離線模式的目標推進率偏低是預期的，因為 mock 回應是固定的，不會動態匹配所有關鍵詞。
