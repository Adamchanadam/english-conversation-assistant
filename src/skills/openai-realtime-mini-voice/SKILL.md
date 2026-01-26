---
name: openai-realtime-mini-voice
description: Use when building low-latency speech-to-speech or speech-to-text interactive sessions with OpenAI Realtime API using model gpt-realtime-mini. Covers session.update, VAD, interruption handling, and the core Realtime client event syntax.
---

# OpenAI Realtime Voice Session (gpt-realtime-mini)

## Model Version (2025-01)
- **Model ID**: `gpt-realtime-mini-2025-12-15` (stable snapshot)
- **Context**: 32k tokens, 4,096 max output
- **Available Voices**: `marin`, `cedar` (Realtime-exclusive voices)
- **Official Docs**: [gpt-realtime-mini Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime-mini)
- **API Guide**: [Realtime API | OpenAI API](https://platform.openai.com/docs/guides/realtime)
- **WebRTC Guide**: [Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc)

## Ephemeral Token (Client Secret) Generation

**CRITICAL**: Token TTL is **10 minutes** (not 60 minutes). Must implement auto-renewal.

### Backend generates token
```http
POST https://api.openai.com/v1/realtime/client_secrets
Authorization: Bearer {OPENAI_API_KEY}
Content-Type: application/json

{
  "model": "gpt-realtime-mini-2025-12-15",
  "voice": "marin"
}
```

**Response**:
```json
{
  "client_secret": "ek_1234...",
  "expires_at": 1234567890
}
```

- **Token Format**: Starts with `ek_`
- **Default TTL**: 10 minutes (600 seconds)
- **Renewal Strategy**: Request new token at ~8 minutes to avoid session interruption
- **Official Docs**: [Client secrets | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions)

## Scope
This Skill defines how to run a browser-based realtime voice agent with **gpt-realtime-mini** using the OpenAI Realtime API.
It focuses on:
- Session configuration (`session.update`)
- Audio input buffering & turn detection (VAD)
- Creating responses (`response.create`) vs auto responses
- Handling interruptions (cancel/clear/truncate)
- Practical guardrails for "do not fabricate" in live voice UX

## Non-goals
- This Skill does not define business-specific negotiation tactics.
- This Skill does not implement app-level state machines; it provides the API primitives and recommended patterns.

## Hard constraints (model / protocol)
- gpt-realtime-mini does **NOT** support Structured Outputs; do not rely on strict JSON from the realtime channel.
- Context window is limited (32k tokens; design for summarization / compaction in the app layer).
- Some events are transport-specific (e.g., `output_audio_buffer.clear` is WebRTC/SIP only).
- **Session duration limit**: 60 minutes maximum (must implement reconnection logic)

## Security prerequisites
1) Never expose a long-lived API key in the browser.
2) Use a backend to mint short-lived client credentials (ephemeral / client secret) for the Realtime session.
3) Implement auto-renewal for 10-minute token TTL.

## Transport options

### Recommended: WebRTC (browser)
- Best for low-latency audio in/out.
- Use a data channel for JSON Realtime events and audio tracks for microphone + assistant audio.

#### WebRTC Configuration (ICE servers)

**STUN Server** (required for NAT traversal):
```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },  // Google public STUN
    { urls: 'stun:stun1.l.google.com:19302' }  // Backup
  ]
};
```

**TURN Server** (optional for v1):
- v1 (local development): Not required (same network, no firewall)
- v2 (production): Required for users behind restrictive NAT/firewall
- Options:
  - Self-hosted: coturn, eturnal
  - Third-party: Twilio TURN, Metered TURN (paid services)

**Connection Flow**:
1. Browser requests ICE candidates using STUN
2. WebRTC establishes peer connection with OpenAI Realtime server
3. If direct connection fails, fallback to TURN relay (v2)

**Error Handling**:
- `ICE connection failed`: Retry 3 times with 2-second intervals
- If all retries fail: Display "Network connection issue, check firewall settings"
- Provide fallback: Download conversation log and end session gracefully

### Alternative: WebSocket
- Simpler to prototype, but you must manage audio chunking & playback yourself.
- No STUN/TURN required (TCP-based)

## Session configuration (must-do)
Send `session.update` early (immediately after connection) to lock:
- Instructions (English speaking persona + “do not fabricate” rule)
- `turn_detection` (VAD mode + interruption behavior)
- Audio formats and voice
- Whether server auto-creates responses on speech stop (`create_response`)

### Example: session.update (conversation mode with interruptions)
```json
{
  "type": "session.update",
  "session": {
    "instructions": [
      "You are an English voice agent. Speak in short, natural sentences.",
      "Never invent facts. If you do not know, say you do not know and offer to note it for later.",
      "Keep responses concise unless explicitly asked for detail.",
      "Stay aligned with the pinned task goal and current negotiation context provided by the app."
    ].join("\n"),
    "output_modalities": ["audio", "text"],
    "input_audio_format": "audio/pcm",
    "output_audio_format": "audio/pcm",
    "voice": "marin",
    "turn_detection": {
      "type": "semantic_vad",
      "eagerness": "auto",
      "create_response": true,
      "interrupt_response": true
    }
  }
}
```

**Audio Format Details**:
- `audio/pcm`: 16-bit PCM, 24kHz sample rate (default for WebRTC)
- Alternative: `audio/g711_ulaw`, `audio/g711_alaw` (for SIP/telephony)

**Voice Options** (2025-01):
- `marin`: Default, natural female voice
- `cedar`: Alternative voice (Realtime-exclusive)
- Note: Once audio output starts, voice cannot be changed mid-session

## Feeding user audio (WebSocket & some WebRTC flows)

### Append audio chunks

```json
{ "type": "input_audio_buffer.append", "audio": "<base64_audio_bytes>" }
```

### Commit audio (only when server VAD is disabled)

```json
{ "type": "input_audio_buffer.commit" }
```

### Clear buffer (optional)

```json
{ "type": "input_audio_buffer.clear" }
```

## Adding app-provided context mid-call (recommended)

Use `conversation.item.create` with `role: system` for small steering updates, e.g.:

* “User clicked: AGREE”
* “Pinned task goal: …”
* “Stop condition reached: …”

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "system",
    "content": [{ "type": "input_text", "text": "User clicked: AGREE. Keep tone polite and confirm next steps." }]
  }
}
```

## Creating a response (manual mode)

If `turn_detection.create_response` is false, trigger inference explicitly:

```json
{ "type": "response.create", "response": { "conversation": "auto" } }
```

## Interruption handling (critical for natural voice UX)

When the human starts speaking while the assistant is still talking, do ALL of:

1. Cancel the in-progress response generation
2. Cut off any queued audio playback (WebRTC/SIP)
3. Truncate server-side assistant audio transcript to match what the user actually heard

### Recommended event sequence

#### (A) Cancel generation

```json
{ "type": "response.cancel" }
```

#### (B) Stop audio output immediately (WebRTC/SIP only)

```json
{ "type": "output_audio_buffer.clear" }
```

#### (C) Truncate the assistant message item (sync server context with played audio)

You need:

* `item_id` = the active assistant message item id
* `audio_end_ms` = how many ms were already played on the client

```json
{
  "type": "conversation.item.truncate",
  "item_id": "<assistant_item_id>",
  "content_index": 0,
  "audio_end_ms": 1500
}
```

## VAD tuning guidance

* Use `semantic_vad` to reduce premature cutoffs in natural conversation.
* Use `server_vad` for noisy environments or when semantics are unreliable.
* Keep `interrupt_response: true` for the “user can cut in” UX.

## Observability: server events you should handle

Your app should listen for (names vary by transport, but conceptually):

* Session lifecycle: created/updated
* Turn boundaries: `input_audio_buffer.speech_started`, `input_audio_buffer.speech_stopped`
* Response lifecycle: created / done
* Conversation items: created / truncated / deleted
* Errors: error events (log + display non-disruptively)

## Practical guardrails for “do not fabricate”

Because realtime output is not reliably machine-parseable:

* Put “never invent facts” into `instructions`.
* Enforce app-layer policy:

  * If the agent claims a specific fact, require the app to confirm it exists in the pinned SSOT or transcript.
  * If not confirmable, inject a corrective system message and request a clarification.

## Minimal "stop now" pattern

When user presses STOP or says the magic stop word:

1. Inject system message: "Stop now. Say goodbye in one short sentence."
2. Cancel any ongoing response + clear audio buffer
3. Close the session cleanly after goodbye finishes (or timeout)

## Session Management Best Practices

### Token Renewal (10-minute TTL)
- **8 minutes**: Request new token from backend (2-minute buffer)
- **Update session**: Reconnect WebRTC with new client secret (seamless to user)
- **No interruption**: Keep conversation context across token renewal

### Session Reconnection (60-minute limit)
- **55 minutes**: Warn user "Session will reconnect in 5 minutes"
- **58 minutes**: Inject system message to wrap up current topic
- **60 minutes**: Save context (Pinned + Rolling + Recent 3 turns), close session, create new session with saved context
- **Fallback**: If reconnection fails (3 retries), download conversation log (JSON/Markdown)

## Recent Updates (2025-01)

- **Improved instruction-following**: +18.6% accuracy vs previous snapshot
- **Better tool-calling**: +12.9% accuracy
- **More natural voice**: Especially with Custom Voices
- **WebRTC support**: Generally available (GA)
- **SIP support**: Phone calling integration available
- **MCP servers**: Remote Model Context Protocol server support

## Checklist

* [ ] session.update sent immediately with correct model ID (`gpt-realtime-mini-2025-12-15`)
* [ ] semantic_vad enabled with interruption
* [ ] response.cancel + output_audio_buffer.clear + item.truncate implemented
* [ ] system injections for UI buttons (AGREE / DISAGREE / STOP)
* [ ] app-layer stop condition enforcement
* [ ] Token auto-renewal at 8 minutes (10-minute TTL)
* [ ] Session reconnection at 60 minutes with context preservation

---
