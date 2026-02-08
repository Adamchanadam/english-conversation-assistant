# English Conversation Assistant (ECA)

即時英文對話助手 — 讓英文電話不再焦慮的即時輔助工具。

## 功能特色

### 🎤 即時英文字幕（Karaoke 效果）
- 使用 Web Speech API 實現「邊說邊顯示」英文字幕
- 延遲約 100ms，提供即時視覺回饋
- Karaoke 式發光效果，清晰顯示正在說的內容

### 🌐 智能中文翻譯
- 使用 `gpt-4.1-nano` 進行即時串流翻譯（~700ms 首字回應）
- 數字、金額、日期保持阿拉伯數字格式，易於核對

### 📚 場景詞庫（UK 專用）
- 4 個場景：銀行、NHS 醫療、水電、保險
- 領域術語自動提示翻譯（如 direct debit → 直接付款授權）
- 避免常見誤譯（如 NHS surgery → 診所，非手術）

### ✅ 翻譯品質驗證
- 自動檢測數字/金額錯誤
- 低信心翻譯警告提示
- 顯示「請對照英文原文」警告

### ✂️ 智能分段 (SmartSegmenter)
- 600ms 停頓自動偵測句子邊界
- 語法線索輔助分段（如 "right", "okay", "thanks"）
- 長度保護：15 字軟性限制、25 字硬性限制
- 過濾填充詞（um, uh, hmm）

### 🎯 通話輔助功能
- **通話前準備**：選擇場景、生成講稿
- **場景預設講稿**：每個場景有 5 個常用目的，一鍵生成講稿
- **Quick Response Bar**：快捷短語一鍵調用
- **Panic Button**：緊急時顯示拖延語
- **暫停/繼續**：隨時暫停收音，不離開通話

### ⚡ 場景預設講稿
| 場景 | 常用目的 |
|------|----------|
| 銀行 | 查詢餘額、不明收費、更新資料、開戶咨詢、轉帳問題 |
| 醫療 | 預約 GP、領處方簽、轉診進度、檢驗結果、取消預約 |
| 水電 | 查帳單、更新付款、報讀數、換方案、搬家通知 |
| 保險 | 保障範圍、提出理賠、續約保費、更改資料、取消保單 |
| 一般 | 一般詢問、確認狀態、客服轉接、投訴反映、感謝結束 |

### 📊 雙軌架構
```
麥克風音訊
    │
    ├──→ Web Speech API ──→ 即時英文預覽（Karaoke 效果，~100ms）
    │
    └──→ SmartSegmenter ──→ /api/translate/stream ──→ 中文翻譯
                                    │
                                    └── + 場景詞庫提示
                                    └── + 翻譯驗證
```

## 快速開始

### 1. 安裝依賴
```bash
pip install -r requirements.txt
```

### 2. 設定環境變數
```bash
# Windows
set OPENAI_API_KEY=your-api-key

# Mac/Linux
export OPENAI_API_KEY=your-api-key
```

### 3. 啟動後端
```bash
cd src/backend
python main.py
```

### 4. 開啟瀏覽器
```
http://localhost:8000
```

### 5. 選擇場景 → 開始聆聽 → 允許麥克風權限

## 技術架構

| 組件 | 技術 | 用途 |
|------|------|------|
| 即時英文預覽 | Web Speech API | 邊說邊顯示（~100ms 延遲） |
| 智能分段 | SmartSegmenter | 600ms 停頓偵測 + 語法線索 |
| 串流翻譯 | gpt-4.1-nano | 英文→繁體中文（~700ms 首字）|
| 場景詞庫 | domain_glossaries.json | UK 專用術語提示 |
| 翻譯驗證 | TranslationValidator | 數字/信心檢測 |
| 講稿生成 | gpt-5-mini | 中文→英文講稿 |
| 後端 | Python FastAPI | API 服務 |
| 前端 | Vanilla JS | 單頁應用 |

## 專案結構

```
├── src/
│   ├── backend/
│   │   ├── main.py                 # FastAPI 後端
│   │   ├── glossary.py             # 場景詞庫模組
│   │   ├── domain_glossaries.json  # UK 領域詞庫
│   │   └── script_generator.py     # 講稿生成
│   └── frontend/
│       ├── eca_parallel_test.html  # 主頁面
│       ├── smart_segmenter.js      # 智能分段器
│       ├── webspeech_realtime.js   # Web Speech 封裝
│       └── translation_validator.js # 翻譯驗證器
├── spec/
│   ├── requirements.md             # 需求規格
│   ├── design.md                   # 設計文檔
│   ├── tasks.md                    # 任務清單
│   └── lessons_learned.md          # 經驗教訓記錄
└── CLAUDE.md                       # AI 開發規則
```

## 授權

MIT License
