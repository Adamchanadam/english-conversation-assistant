# Changelog

## [v2.2] - 2026-02-17

### 翻譯品質提升

- **書面語風格**：翻譯 prompt 加入書面語（書面語）指示，明確禁止口語化表達（「呢個係」「搞掂咗」），要求使用「這是」「已經」「需要」等正式用語
- **上下文連貫翻譯**：新增 `previous_context` 欄位，每段翻譯時自動帶入上一段英文作為語境參考，模型只翻譯新段落但可根據前文產生更連貫的翻譯
- **更自然的斷句**：SmartSegmenter 預設從 `fast`（500ms/14字）改為 `stable`（750ms/18字），暫停閾值和字數限制提高，減少句子中間被截斷

### Technical Changes

- `TranslateRequest` model 新增 `previous_context: Optional[str]` 欄位
- `/api/translate/stream` 端點支援帶上下文的 user message 格式
- `/api/translate` 端點同步加入書面語指示
- 前端 `translateViaBackend()` 追蹤 `previousSegmentEnglish` 並傳入請求

---

## [v2.1] - 2026-02-17

### i18n 全面修復

- **完整多語言支援**：所有用戶可見的 UI 文字（按鈕、狀態訊息、提示、錯誤訊息）現在完整支援繁體中文 / 簡體中文 / English 切換
- **場景快捷按鈕 i18n**：5 場景 × 7 個常用目的（共 35 個按鈕）+ 5 個場景 placeholder 全部支援三語切換
- **動態文字 i18n**：講稿生成狀態（生成中/生成失敗）、複製回饋、說話者標籤、PWA 提示等所有 JS 動態生成的文字皆已國際化
- **語言切換即時生效**：切換語言後自動重新渲染場景選擇器、快捷按鈕、placeholder

### UI/UX

- 新增手機版 UI 截圖至 README
- README 新增 v2.1 更新摘要（Marketing/UX 角度）

---

## [v2.0] - 2026-02-16

### New Features

- **Smart Suggestions (Feature A)**：通話中按「幫我回應」按鈕，AI 自動根據最近對話生成 2-3 個回應建議（英+中），使用 `gpt-4.1-mini` SSE 串流，首個建議約 1 秒出現
- **Key Info Extraction (Feature C)**：自動偵測並標亮對話中的重要資訊 — 電話號碼、日期、金額、參考編號、郵遞區號、時間，點擊一鍵複製
- **Mobile Progressive Disclosure UI**：手機版通話介面全面改版，採用三層漸進式顯示設計：
  - Layer 1：固定底部 3 按鈕（PTT、暫停/繼續、幫我回應）
  - Layer 2：Peek Bar + Bottom Sheet（快捷短語、已儲存講稿、Panic Button）
  - Layer 3：⋮ Overflow Menu（返回首頁、匯出記錄）

### Security

- **API Key 強制用戶輸入**：移除所有後端 `.env` `OPENAI_API_KEY` fallback，所有 API 端點強制要求前端透過 `X-API-Key` header 提供 API Key，未設定時返回 401 錯誤

### Bug Fixes

- **Spacebar 滾動修復**：通話模式下 Spacebar 不再觸發頁面滾動（`e.preventDefault()` 移至 `isPaused` 判斷之前）
- **Mobile 滾動修復**：修復手機版無法滾動到頁底的問題（CSS `height` 改為 `100dvh`，加上 `-webkit-overflow-scrolling: touch`）

### Backend Changes

- 新增 `/api/suggest/stream` SSE 端點（sync httpx 串流，避免 Windows async 開銷）
- 新增 `SuggestRequest` Pydantic model
- `controller.py` `call_responses_api()` 改為接受 `api_key` 參數
- 所有 9 個 API 端點統一使用 `_require_api_key()` helper

### Models

| 功能 | 模型 | 延遲 |
|------|------|------|
| 即時翻譯 | `gpt-4.1-nano` | ~700ms |
| Smart Suggestions | `gpt-4.1-mini` | ~1s 首建議 |
| 講稿生成 | `gpt-5-mini` | ~1.5s |

---

## [v1.0] - 2026-02-08

### Initial Release

- 即時英文字幕（Web Speech API Karaoke 效果）
- 智能中文翻譯（gpt-4.1-nano 串流）
- SmartSegmenter 智能分段
- 場景詞庫（6 領域 281 條 UK 術語）
- 翻譯品質驗證
- 講稿生成（gpt-5-mini）
- Quick Phrases（4 句快捷短語）
- Panic Button（8 句拖延語）
- Speaker Attribution（Spacebar HOLD 角色標記）
- 多語言介面（繁中/簡中/English）
- 匯出對話記錄（Markdown）
- Cloud Run 部署支援
- iOS PWA standalone 模式偵測
