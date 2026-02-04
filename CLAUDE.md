# Project Rules (Spec-Driven)

## Language
  - 繁體中文為主，英文為副

## 模型硬性規則（Hard Model Constraint）
  - **Realtime 語音**：必須使用 `gpt-realtime-mini`
  - **文字控制器**：必須使用 `gpt-5-mini`（講稿生成、Smart 建議）
  - **即時翻譯**：必須使用 `gpt-4.1-nano`（經測試最快，703ms 首字回應）
    - ⚠️ 不可用 gpt-5-mini（reasoning 開銷，需 5-6 秒）
  - 此規則優先級最高，不可變更

## Source of Truth
- The only source of truth for this project is:
  - requirements.md
  - design.md
  - tasks.md
  - steering.md
  - **lessons_learned.md** — 經驗教訓記錄（必讀）
- Do not invent requirements. If something is missing, ask the minimum questions.

## Precedence
- Precedence order (highest → lowest):
  1) Spec (requirements/design/tasks): `spec/requirements.md`, `spec/design.md`, `spec/tasks.md`
  2) Execution rules: `spec/steering.md`
  3) Tooling skills (how-to only): `src/skills/**`
- If any Skill conflicts with Spec/Steering, Spec/Steering wins. Report the conflict explicitly and continue with the higher-precedence rule.

## Tooling Router (Skills Index)
- Skills are non-authoritative references for tooling only. They MUST NOT introduce or override requirements.
- Use these skills when implementing or debugging:
  - `src/skills/openai-gpt5-mini-controller/SKILL.md` — Use when implementing the Control Plane (state/judge/summary) with `gpt-5-mini`.
  - `src/skills/openai-realtime-mini-voice/SKILL.md` — Use when implementing Realtime voice UX (`gpt-realtime-mini`), WebRTC, VAD/interruptions, cancel/clear/truncate handling.
  - `src/skills/windows-python/SKILL.md` — Use when setting up local dev, scripts, tests, and Windows-specific Python tooling.
  - `src/skills/chrome-devtools-mcp.skill` — Use when debugging WebRTC/audio/permissions/console via Chrome DevTools MCP.

## Workflow
- Plan first (read-only). Then implement tasks via **Workstream/Batch** approach (supports parallel execution).
- **Implementation Model**: See `prompt_2_implement.md` for authoritative Workstream/Batch rules (parallel execution, file ownership, verification).
- For each Workstream/Batch:
  0) **必讀 `spec/lessons_learned.md`**（避免重複犯錯）
  1) Explain approach with traceability to requirements/design
  2) Make code changes
  3) Add/modify tests
  4) Provide verification commands
  5) Mark completed tasks as done in tasks.md
  6) Suggest commit message(s) referencing the tasks
  7) **遇到重大問題解決後，更新 lessons_learned.md**

## Safety / Truthfulness
- If uncertain, say so and propose safe alternatives (clarify / record follow-up).
- Never fabricate facts, APIs, or behaviors.

## API/SDK 開發規則（MANDATORY）

**CRITICAL**: 使用任何 API/SDK 前，必須先確認正確語法。不可憑記憶或猜測。

### 開發流程（按順序執行）

1. **先讀 Skill**
   - 檢查 `src/skills/` 是否有相關 SKILL.md
   - Skill 包含已驗證的 API 語法、事件名稱、最佳實踐
   - 例：OpenAI Realtime API → 讀 `src/skills/openai-realtime-mini-voice/SKILL.md`

2. **Skill 不存在或不完整 → 搜索最新文檔**
   - 使用 WebSearch 搜索官方文檔
   - 確認 API 版本（Beta vs GA 語法可能不同）
   - 記錄搜索結果到 Skill 供日後使用

3. **測試驗證**
   - 使用 Chrome DevTools MCP 實測 API 行為
   - 檢查 console log 確認事件名稱正確
   - 不要讓用戶做第一個測試者

### 常見錯誤模式（避免）

| ❌ 錯誤做法 | ✅ 正確做法 |
|------------|------------|
| 憑記憶寫 API 調用 | 先讀 Skill 或官方文檔 |
| 假設事件名稱 | 查證確切事件名稱（如 `response.output_text.delta` 不是 `response.text.delta`） |
| 讓用戶測試未驗證代碼 | 先用 DevTools 自行驗證 |
| 遇錯才查文檔 | 開發前就查文檔 |

### 教訓記錄

> **完整記錄見 `spec/lessons_learned.md`**（持續更新）

快速索引：
- **OpenAI Realtime GA API (2025)**：事件名稱與 Beta 不同
  - Text output: `response.output_text.delta/done`（不是 `response.text.delta/done`）
  - Session config: `audio.input.transcription`（不是 `input_audio_transcription`）
  - response.create 格式：`{ conversation: 'auto' }`（不是 `{ modalities: ['text'] }`）
  - 詳見 `src/skills/openai-realtime-mini-voice/SKILL.md`
- **方案 A 兩階段架構**（詳見 lessons_learned.md §方案 A）：
  - Web Speech API → SmartSegmenter → `/api/translate/stream`（gpt-4.1-nano）
  - 不用 OpenAI Realtime 翻譯（會進入 Q&A 對話模式）
- **SmartSegmenter**（詳見 lessons_learned.md §2.1, §2.2）：
  - Web Speech fullText 是累積的，需用 `processedLength` 追蹤
  - 動態穩定性檢測：暫停後等 100ms，有新文字就取消重等
  - 5 種預設模式，預設為「快速」（500ms/100ms）
- **Entry ID 綁定**：必須建立 `response.id → entry_id` 映射（詳見 lessons_learned.md §1.3）
- **狀態超時保護**：任何「等待」狀態必須有超時機制（詳見 lessons_learned.md §3.1）
- **條目排序**：新條目只能 push 到末尾，不可中間插入（詳見 lessons_learned.md §4.1）

## Coding Standards
- Prefer small diffs, clear naming, and deterministic logs for replayable tests.

## Prompt Engineering Rules (for AI Realtime Voice)

**IMPORTANT**: These rules apply when writing/modifying prompts for `gpt-realtime-mini` in `app.js`.

### 1. Language Consistency
- **ALL prompts must be in English** (instructions, rules, examples)
- Output language is controlled by `[LANGUAGE] Speak only in ${langName}`
- The AI model will automatically adapt English examples to the target language
- **NEVER mix Chinese examples in English prompts** — this causes confusion when user selects non-Chinese language

### 2. No Hardcoding / No Scenario-Specific Examples
- This is a **generic tool** for any user-defined scenario
- **NEVER** include scenario-specific examples (e.g., "gas leak", "address", "appointment")
- Use **generic placeholders**: `${I}` (caller identity), `${O}` (other party), `${G}` (goal)
- Examples should be **behavioral patterns**, not specific content

### 3. Prompt Structure
- Use **English section headers**: `[RESPONSE RULES]`, `[COMMON SITUATIONS]`, etc.
- Use **numbered/bulleted lists** for clarity
- Keep instructions **concise** — long prompts reduce effectiveness

### 4. "Don't Know" Handling
- Provide **multiple natural response options** (not just one phrase)
- Responses should be **human-like**: "I'll need to check on that", "I don't have that info right now"
- **NEVER make up information** — this is a hard rule

### 5. Testing Considerations
- Prompts must work for **any language** setting
- Prompts must work for **any scenario** (not just the test scenario)
- After modifying prompts, run regression tests
