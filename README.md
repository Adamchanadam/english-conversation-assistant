# Voice Proxy Negotiator

即時語音翻譯工具 — 將英文語音即時轉譯為中文字幕。

## 功能特色

### 🎤 即時英文字幕
- 使用 Web Speech API 實現「邊說邊顯示」英文字幕
- 延遲約 100ms，提供即時視覺回饋

### 🌐 智能中文翻譯
- 使用 OpenAI Realtime API (`gpt-realtime-mini`) 進行翻譯
- 語音結束後自動翻譯成中文

### ✂️ 智能分段 (SmartSegmenter)
- 600ms 停頓自動偵測句子邊界
- 語法線索輔助分段（如 "right", "okay", "thanks"）
- 長度保護：15 字軟性限制、25 字硬性限制
- 過濾填充詞（um, uh, hmm）

### 📊 雙軌架構
```
麥克風音訊
    │
    ├──→ Web Speech API ──→ 即時英文預覽（邊說邊顯示）
    │
    └──→ OpenAI Realtime ──→ 正式轉錄 + 中文翻譯
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
http://localhost:8000/eca_parallel_test.html
```

### 5. 允許麥克風權限並開始說話

## 技術架構

| 組件 | 技術 | 用途 |
|------|------|------|
| 即時英文預覽 | Web Speech API | 邊說邊顯示（~100ms 延遲） |
| 語音翻譯 | OpenAI Realtime API | 英文→中文翻譯 |
| 智能分段 | SmartSegmenter | 600ms 停頓偵測 + 語法線索 |
| 後端 | Python FastAPI | 提供 ephemeral key |
| 前端 | Vanilla JS | WebRTC 連接 |

## 專案結構

```
├── src/
│   ├── backend/
│   │   └── main.py              # FastAPI 後端
│   └── frontend/
│       ├── eca_parallel_test.html  # 主測試頁面
│       ├── smart_segmenter.js      # 智能分段器
│       └── webspeech_realtime.js   # Web Speech 封裝
├── spec/
│   ├── requirements.md          # 需求規格
│   ├── design.md                # 設計文檔
│   └── lessons_learned.md       # 經驗教訓記錄
└── CLAUDE.md                    # AI 開發規則
```

## 授權

MIT License
