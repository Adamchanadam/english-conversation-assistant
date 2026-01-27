---
name: openai-gpt5-mini-controller
description: Use when you need a fast, cost-efficient text controller/judge using model gpt-5-mini via the Responses API. Maintains task goal, compresses conversation memory, evaluates stop conditions, and proposes the next English utterance for the realtime voice channel.
---

# GPT-5 mini Controller / Judge (Responses API)

## Model Version (2025-01)
- **Model ID**: `gpt-5-mini-2025-08-07` (stable snapshot)
- **API**: Responses API (`/v1/responses`)
- **Context**: 400k tokens, 128k max output
- **Official Docs**: [GPT-5 mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-5-mini)
- **API Reference**: [Responses | OpenAI API Reference](https://platform.openai.com/docs/api-reference/responses)

## Scope
This Skill defines how to use **gpt-5-mini** (text) as the app-layer "controller" for a realtime voice agent:
- Keep the pinned task goal always present (instruction + memory)
- Summarize/compact conversation state to fit context limits
- Evaluate stop conditions and user button intents
- Produce the next suggested English utterance (short, natural, turn-by-turn)

## Why gpt-5-mini here
- gpt-5-mini supports large context (400k) and Structured Outputs (optional).
- Use it for deterministic-ish control decisions and memory compaction.
- The realtime voice channel remains free-form and low-latency.

## Responses API Key Features (2025)
- **Reasoning State Preservation**: Maintains step-by-step reasoning across turns (better than Chat Completions)
- **Hosted Tools**: Server-side execution of web search, image generation, MCP tools (reduces latency)
- **Direct File Input**: Supports PDF and other file formats (useful for v2 SSOT RAG)
- **Migration Note**: Replaces `/v1/chat/completions` for reasoning models
- **Reference**: [Why we built the Responses API](https://developers.openai.com/blog/responses-api/)

## Inputs to this controller (recommended)
Provide a single controller prompt package containing:
1) Pinned task goal (must remain stable)
2) Stop conditions (including UI STOP button semantics)
3) Safety: “do not fabricate”; prefer “I don’t know” + note for later
4) Current conversation memory (compacted summary)
5) Latest transcript turn(s) from the human
6) Latest UI button intent(s) (AGREE/DISAGREE/CONSIDER/GOODBYE/STOP/ETC)

## Outputs (recommended)
Return:
- decision: continue | request_clarification | stop
- next_english_utterance: short, natural, 1–2 sentences
- memory_update: compacted memory (replace previous memory)
- notes_for_user: optional Chinese hints for the UI (not spoken)

Structured JSON is recommended, but the app must fail-soft:
- If JSON parse fails, fall back to best-effort extraction.

## Responses API call (core syntax)
HTTP:
- POST https://api.openai.com/v1/responses
Headers:
- Authorization: Bearer <API_KEY>
- Content-Type: application/json

### Minimal request body (text-only)
```json
{
  "model": "gpt-5-mini-2025-08-07",
  "instructions": "You are a controller for a realtime English voice agent. Follow the schema and never fabricate facts.",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "PINNED_GOAL: ...\nSTOP_CONDITIONS: ...\nMEMORY: ...\nLATEST_HUMAN_TURN: ...\nUI_INTENT: ..." }
      ]
    }
  ],
  "max_output_tokens": 1000
}
```

**Note**: Increased `max_output_tokens` to 1000 (from 500) to accommodate JSON output containing:
- `next_english_utterance` (1-2 sentences)
- `memory_update` (compacted summary, may be lengthy)
- `notes_for_user` (optional Chinese hints)

## Optional: Stateful conversation (two options)

Pick ONE:
A) Use `previous_response_id` for multi-turn continuity (stateless storage on your side).
B) Use `conversation` to attach inputs/outputs into a conversation object.

Do not use both in the same call.

## Controller prompt template (recommended)

Include in `instructions` or as the first input:

* Enforce short English outputs (voice turn-taking)
* Enforce “I don’t know” policy
* Enforce negotiation style: incremental, step-by-step, do not monologue

### Example controller instruction (concise)

* Produce one next utterance only (1–2 sentences).
* If missing info, ask one clarification question.
* If stop condition reached, produce a goodbye sentence and set decision=stop.
* Never invent facts. If asked something unknown, say so and note it.

## Suggested JSON schema (optional)

```json
{
  "decision": "continue|request_clarification|stop",
  "next_english_utterance": "string",
  "memory_update": "string",
  "notes_for_user": "string|null"
}
```

## Integration pattern with realtime voice

On each turn:

1. App receives human speech transcript (from Realtime transcription or your pipeline).
2. App calls this controller with:

   * pinned goal
   * stop conditions
   * current memory
   * latest turn
   * UI intent buttons pressed
3. App injects controller output into Realtime as:

   * A system message (steering)
   * Then triggers `response.create` (or lets VAD auto-create)

### Realtime injection (system)

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "system",
    "content": [
      { "type": "input_text", "text": "Controller says: Speak this next:\n<next_english_utterance>" }
    ]
  }
}
```

## Memory compaction rule

* Keep `PINNED_GOAL` unchanged.
* Replace `MEMORY` with `memory_update` each turn.
* Hard-cap memory length (e.g., target under a few thousand characters).
* If context pressure grows, compress more aggressively.

## Stop rule

Stop when:

* UI STOP is pressed OR
* stop condition satisfied (e.g., agreement reached)

Controller must set decision=stop and provide a short goodbye sentence.

## Checklist

* [ ] Pinned goal always included
* [ ] Memory replaced with compacted memory_update each turn
* [ ] Fail-soft JSON parsing
* [ ] Stop decision gates the realtime session closeout

---