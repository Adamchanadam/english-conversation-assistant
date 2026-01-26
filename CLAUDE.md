# Project Rules (Spec-Driven)

## Language
  - 繁體中文為主，英文為副

## 模型硬性規則（Hard Model Constraint）
  - **Realtime 語音**：必須使用 `gpt-realtime-mini`
  - **文字控制器**：必須使用 `gpt-5-mini`（不得使用 gpt-4o-mini 或其他模型）
  - 此規則優先級最高，不可變更

## Source of Truth
- The only source of truth for this project is:
  - requirements.md
  - design.md
  - tasks.md
  - steering.md
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
  1) Explain approach with traceability to requirements/design
  2) Make code changes
  3) Add/modify tests
  4) Provide verification commands
  5) Mark completed tasks as done in tasks.md
  6) Suggest commit message(s) referencing the tasks

## Safety / Truthfulness
- If uncertain, say so and propose safe alternatives (clarify / record follow-up).
- Never fabricate facts, APIs, or behaviors.

## Coding Standards
- Prefer small diffs, clear naming, and deterministic logs for replayable tests.
