# 測試指南（M2 Translation Mode）

請把 tasks.md 內的測試/驗收全部落成可重播。

## 測試環境

- **測試頁面**：`src/frontend/eca_parallel_test.html`
- **後端**：`python src/backend/main.py`（提供 ephemeral key）
- **瀏覽器**：Chrome（需要麥克風權限）

## 核心測試場景

### 1. 基本翻譯流程（必測）
- 說一段 10-20 字的英文句子
- 驗證：
  - [ ] Web Speech 即時顯示英文（邊說邊顯示）
  - [ ] SmartSegmenter 在 600ms 停頓後觸發分段
  - [ ] OpenAI 返回中文翻譯
  - [ ] 段落狀態從 listening → transcribing → translating → done

### 2. 長句分段測試
- 說一段超過 25 字的英文（不停頓）
- 驗證：
  - [ ] SmartSegmenter hardLimit (25w) 觸發自動分段
  - [ ] 翻譯結果語義完整

### 3. 連續多段測試
- 連續說 5 段以上的英文
- 驗證：
  - [ ] 段落計數正確遞增
  - [ ] 沒有段落遺失或重複
  - [ ] 翻譯順序正確（FIFO）

### 4. 錯誤恢復測試
- 模擬網路斷線/重連
- 驗證：
  - [ ] 連線狀態正確顯示
  - [ ] 重連後可繼續使用

## 驗收命令

```bash
# 1. 啟動後端
cd src/backend && python main.py

# 2. 開啟瀏覽器測試頁面
# http://localhost:8000/eca_parallel_test.html

# 3. 開啟 DevTools Console 監控事件
# F12 → Console → Filter: [SmartSegmenter] [OpenAI]
```

## 測試日誌檢查點

測試通過時，Console 應顯示：
```
[SmartSegmenter] Started
[SmartSegmenter] Segment #1: "..." (Xw, reason)
[OpenAI] response.output_text.delta
[OpenAI] response.output_text.done
```

測試失敗跡象：
- `Unknown parameter` — API 格式錯誤（見 lessons_learned.md §1.9）
- `SmartSegmenter` 字數持續增長（>25w）— buffer 累積問題（見 §2.1）
- `input_audio_buffer_commit_empty` — 觸發太頻繁（見 §2.2）

## KPI 指標

| 指標 | 目標 |
|------|------|
| 分段延遲 | ≤ 600ms（從停頓到觸發） |
| 翻譯延遲 | ≤ 3s（從分段到顯示翻譯） |
| 完成率 | 100%（所有段落都有翻譯） |
| 系統錯誤 | 0 |

## 測試後更新

如發現新問題：
1. 先修復並驗證
2. 更新 `spec/lessons_learned.md` 記錄經驗
3. 更新相關測試場景
