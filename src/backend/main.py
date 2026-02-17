"""
FastAPI main entry point for Voice Proxy Negotiator Backend.

Integrates:
- /api/token (from spike - ephemeral token generation)
- /api/controller (gpt-5-mini controller)
- /api/summarize_ssot (SSOT summarization)

Reference:
- design.md § 1.1 (Tech Stack, API 規格)
- design.md § 9 (Ephemeral Token)
- src/spike/backend_token.py (token endpoint reference)
"""

import os
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
import httpx

# Handle both module and direct execution imports
try:
    from .models import (
        TokenRequest,
        TokenResponse,
        ControllerRequest,
        ControllerResponse,
        SummarizeSsotRequest,
        SummarizeSsotResponse,
        HealthResponse,
        SimulateLLMRequest,
        SimulateLLMResponse,
        TranslateRequest,
        TranslateResponse,
        ScriptRequest,
        ScriptResponse,
        SuggestRequest,
    )
    from .controller import (
        generate_controller_response,
        summarize_ssot,
        CONTROLLER_MODEL,
    )
    from .script_generator import (
        generate_script,
        generate_script_stream,
        get_scenario_options,
        DEFAULT_PROMPTS,
    )
    from .glossary import (
        get_glossary_hint,
        get_scenario_context,
    )
except ImportError:
    from models import (
        TokenRequest,
        TokenResponse,
        ControllerRequest,
        ControllerResponse,
        SummarizeSsotRequest,
        SummarizeSsotResponse,
        HealthResponse,
        SimulateLLMRequest,
        SimulateLLMResponse,
        TranslateRequest,
        TranslateResponse,
        ScriptRequest,
        ScriptResponse,
        SuggestRequest,
    )
    from controller import (
        generate_controller_response,
        summarize_ssot,
        CONTROLLER_MODEL,
    )
    from script_generator import (
        generate_script,
        generate_script_stream,
        get_scenario_options,
        DEFAULT_PROMPTS,
    )
    from glossary import (
        get_glossary_hint,
        get_scenario_context,
    )

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# =============================================================================
# FastAPI App Setup
# =============================================================================

app = FastAPI(
    title="English Conversation Assistant",
    description="Backend API for real-time English translation and script generation",
    version="2.0.0"
)

# CORS configuration (design.md § 1.1)
# Note: Using specific origins since wildcards require allow_credentials=False
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,  # v1 不使用 cookies
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],  # X-API-Key for user-provided OpenAI key
    expose_headers=["Content-Length"],
    max_age=86400,  # 24 小時預檢緩存
)

# =============================================================================
# Constants
# =============================================================================

REALTIME_MODEL = "gpt-realtime-mini-2025-12-15"
OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


def _require_api_key(req: Request) -> str:
    """Extract API key from X-API-Key header. Raise 401 if not provided.

    All endpoints require the user to provide their own OpenAI API Key
    via the frontend settings page (stored in localStorage, sent as header).
    """
    api_key = req.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="API Key required. Please set your OpenAI API Key in Settings (首頁設定)."
        )
    return api_key


# =============================================================================
# Token Endpoint (integrated from spike)
# =============================================================================

@app.post("/api/token", response_model=TokenResponse)
async def get_ephemeral_token(request: TokenRequest, req: Request):
    """
    Generate ephemeral token for WebRTC Realtime session.

    CRITICAL: Token TTL is 10 minutes (not 60 minutes).
    Reference: design.md § 9, SKILL openai-realtime-mini-voice

    用戶必須透過 X-API-Key header 提供自己的 API Key。
    """
    api_key = _require_api_key(req)

    # Validate voice selection
    valid_voices = ["marin", "cedar"]
    if request.voice not in valid_voices:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid voice. Must be one of: {valid_voices}"
        )

    # Call OpenAI client_secrets endpoint
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                OPENAI_CLIENT_SECRETS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "expires_after": {
                        "anchor": "created_at",
                        "seconds": 600,  # 10 minutes TTL
                    },
                    "session": {
                        "type": "realtime",
                        "model": REALTIME_MODEL,
                        "audio": {
                            "output": {
                                "voice": request.voice,
                            },
                        },
                    },
                },
                timeout=10.0,
            )

            if response.status_code == 401:
                raise HTTPException(
                    status_code=500,
                    detail="Invalid OpenAI API key"
                )
            elif response.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="Rate limited by OpenAI. Please retry later."
                )
            elif response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"OpenAI API error: {response.text}"
                )

            data = response.json()

            return TokenResponse(
                client_secret=data["value"],
                expires_at=data["expires_at"],
                model=REALTIME_MODEL,
            )

        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="OpenAI API timeout"
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to connect to OpenAI: {str(e)}"
            )


# =============================================================================
# Controller Endpoint
# =============================================================================

@app.post("/api/controller", response_model=ControllerResponse)
async def controller_endpoint(request: ControllerRequest, req: Request):
    """
    Generate next utterance strategy based on user directive.

    Reference: design.md § 1.1, § 5 (Button-to-Policy)

    This endpoint:
    1. Takes user button directive + conversation context
    2. Calls gpt-5-mini via Responses API
    3. Returns decision, next utterance, memory update, notes
    """
    api_key = _require_api_key(req)

    logger.info(f"Controller request: directive={request.directive}")

    try:
        response = await generate_controller_response(request, api_key=api_key)
        logger.info(f"Controller response: decision={response.decision}")
        return response

    except ValueError as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Controller endpoint error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Controller error: {str(e)}"
        )


# =============================================================================
# SSOT Summarization Endpoint
# =============================================================================

@app.post("/api/summarize_ssot", response_model=SummarizeSsotResponse)
async def summarize_ssot_endpoint(request: SummarizeSsotRequest, req: Request):
    """
    Summarize SSOT content if it exceeds token limit.

    Reference: design.md § 4.2

    This endpoint:
    1. Estimates token count of SSOT
    2. If > 1500 tokens, summarizes using gpt-5-mini
    3. Returns summary with token counts
    """
    api_key = _require_api_key(req)

    logger.info(f"SSOT summarize request: {len(request.ssot_text)} characters")

    try:
        response = await summarize_ssot(request, api_key=api_key)
        logger.info(
            f"SSOT summarize response: {response.original_tokens} -> {response.summary_tokens} tokens"
        )
        return response

    except Exception as e:
        logger.error(f"SSOT summarize endpoint error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Summarization error: {str(e)}"
        )


# =============================================================================
# Health Check Endpoint
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        model_controller=CONTROLLER_MODEL,
        model_realtime=REALTIME_MODEL,
        api_key_configured=True,  # API key now required per-request via X-API-Key header
    )


# =============================================================================
# Translation Endpoint (方案 A: 兩階段架構)
# Reference: spec/lessons_learned.md (Test 21)
# =============================================================================

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

# 翻譯模型：使用 gpt-4.1-nano（最快，首字回應約 700ms）
# 測試結果：gpt-4.1-nano 703ms < gpt-3.5-turbo 1235ms < gpt-4o-mini 1377ms
# 注意：這不是「文字控制器」，不受 CLAUDE.md gpt-5-mini 限制
# Controller API 仍使用 gpt-5-mini
TRANSLATION_MODEL = "gpt-4.1-nano"


@app.post("/api/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest, req: Request):
    """
    Translate English text to Traditional Chinese using gpt-4.1-nano.

    方案 A: 兩階段架構
    - Web Speech API 負責 STT（語音轉文字）
    - gpt-4.1-nano 負責翻譯（文字轉文字）- 快速，約 0.3-0.8 秒

    注意：翻譯不是「文字控制器」功能，使用 gpt-4.1-nano 以獲得更快回應。
    Controller API (/api/controller) 仍使用 gpt-5-mini。

    Reference:
    - spec/lessons_learned.md (Test 21 - 方案 A)
    """
    api_key = _require_api_key(req)

    logger.info(f"Translate request: {len(request.text)} chars")

    try:
        # Twilio-style translation prompt (proven effective)
        system_prompt = """You are a translation machine. Translate English to Traditional Chinese (Hong Kong style, 繁體中文).

RULES:
- Output ONLY the Chinese translation, nothing else.
- No greetings, no explanations, no "好的", no "我明白".
- Use Traditional Chinese (說話 not 说话).
- Proper nouns: 中文 (English), e.g., "愛潑斯坦 (Epstein)"

CRITICAL - Keep ALL numbers in Arabic numerals:
- Currency: £500, $1,000 → keep as-is
- Dates: 15th March → 3月15日 (NOT 三月十五日)
- Times: 2:30pm → 下午2:30
- Percentages, phone numbers, reference numbers → keep as-is"""

        async with httpx.AsyncClient() as client:
            # 使用 Chat Completions API（更快，無 reasoning 開銷）
            response = await client.post(
                OPENAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": TRANSLATION_MODEL,  # gpt-4.1-nano
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": request.text}
                    ],
                    "max_tokens": 500,
                    "temperature": 0.3,  # 低溫度 = 更一致的翻譯
                },
                timeout=10.0,  # 10 秒足夠
            )

            if response.status_code != 200:
                error_msg = f"OpenAI API error: {response.status_code} - {response.text}"
                logger.error(error_msg)
                return TranslateResponse(
                    translation="",
                    source_text=request.text,
                    error=error_msg
                )

            data = response.json()

            # Chat Completions API 格式
            translation_text = ""
            if "choices" in data and len(data["choices"]) > 0:
                translation_text = data["choices"][0]["message"].get("content", "")

            logger.info(f"Translation ({TRANSLATION_MODEL}): {len(translation_text)} chars")
            return TranslateResponse(
                translation=translation_text.strip(),
                source_text=request.text
            )

    except httpx.TimeoutException:
        return TranslateResponse(
            translation="",
            source_text=request.text,
            error="Translation API timeout"
        )
    except Exception as e:
        logger.error(f"Translation error: {e}")
        return TranslateResponse(
            translation="",
            source_text=request.text,
            error=str(e)
        )


# =============================================================================
# Streaming Translation Endpoint (快速回應，~0.3s 首字)
# =============================================================================

@app.post("/api/translate/stream")
async def translate_text_stream(request: TranslateRequest, req: Request):
    """
    Streaming translation using SSE (Server-Sent Events).

    優點：
    - 首字回應時間約 0.3 秒
    - 用戶可以邊看邊讀，感覺更快
    - 支援場景詞庫提升翻譯品質

    使用方式：
    前端用 EventSource 或 fetch + ReadableStream 接收

    Reference: spec/research/glossary_integration_design.md
    """
    api_key = _require_api_key(req)

    # Build system prompt with optional glossary hints
    base_prompt = """You are a translation machine. Translate English to Traditional Chinese (Hong Kong style, 繁體中文).
Output ONLY the Chinese translation. No greetings, no explanations. Use Traditional Chinese (說話 not 说话).

PROPER NOUNS - Keep these UNTRANSLATED:
- Brand names: Google, Microsoft, Apple, OpenAI, ChatGPT, Claude, etc.
- Product/App names: Keep CamelCase words as-is (e.g., "YouTube", "WhatsApp", "TikTok")
- Company names: Keep as-is, do NOT translate meaning
- Technical terms that are commonly used in English: API, LLM, AI, SDK, etc.
- If unsure whether something is a proper noun, keep it in English

NUMBERS - Keep ALL in Arabic numerals, NEVER convert to Chinese:
- Currency: £500, $1,000, 50p → keep as-is
- Dates: 15th March → 3月15日 (NOT 三月十五日)
- Times: 2:30pm → 下午2:30 (NOT 下午兩點半)
- Percentages: 5% → 5% (NOT 百分之五)
- Phone numbers: 020 7123 4567 → keep as-is
- Reference numbers: ABC123 → keep as-is
- Ordinals: 1st, 2nd, 3rd → 第1, 第2, 第3 (NOT 第一, 第二)"""

    # Add glossary hints if scenario provided
    glossary_hint = get_glossary_hint(request.text, request.scenario) if request.scenario else ""
    scenario_context = get_scenario_context(request.scenario) if request.scenario else ""

    if glossary_hint or scenario_context:
        system_prompt = f"{base_prompt}\n\n{scenario_context}\n{glossary_hint}".strip()
        logger.info(f"Translation with glossary: scenario={request.scenario}, hints={glossary_hint[:50]}...")
    else:
        system_prompt = base_prompt

    async def generate():
        import json as json_module
        logger.info(f"[Translate] Starting stream translation for: {request.text[:50]}...")
        logger.info(f"[Translate] Using API key: {api_key[:15]}...")

        try:
            async with httpx.AsyncClient() as client:
                logger.info(f"[Translate] Calling OpenAI API with model: {TRANSLATION_MODEL}")
                async with client.stream(
                    "POST",
                    OPENAI_CHAT_URL,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": TRANSLATION_MODEL,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": request.text}
                        ],
                        "max_tokens": 500,
                        "temperature": 0.3,
                        "stream": True,
                    },
                    timeout=15.0,
                ) as response:
                    logger.info(f"[Translate] OpenAI response status: {response.status_code}")

                    # 檢查 OpenAI API 回應狀態
                    if response.status_code != 200:
                        error_body = await response.aread()
                        error_msg = error_body.decode('utf-8')
                        logger.error(f"[Translate] OpenAI API error {response.status_code}: {error_msg}")
                        yield f"data: {{\"error\": \"OpenAI API error {response.status_code}: {error_msg[:100]}\"}}\n\n"
                        return

                    chunk_count = 0
                    async for line in response.aiter_lines():
                        logger.debug(f"[Translate] Raw line: {line[:100] if line else '(empty)'}")
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                logger.info(f"[Translate] Stream done after {chunk_count} chunks")
                                yield f"data: {{\"done\": true}}\n\n"
                                break
                            try:
                                chunk = json_module.loads(data)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    chunk_count += 1
                                    logger.debug(f"[Translate] Chunk {chunk_count}: {content}")
                                    yield f"data: {{\"text\": {json_module.dumps(content)}}}\n\n"
                            except Exception as parse_err:
                                logger.warning(f"[Translate] JSON parse error: {parse_err}, data: {data[:50]}")
        except Exception as e:
            logger.error(f"[Translate] Streaming error: {e}")
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# =============================================================================
# Script Generation Endpoint (design.md § 5)
# =============================================================================


@app.post("/api/script", response_model=ScriptResponse)
async def generate_script_endpoint(request: ScriptRequest, req: Request):
    """
    Generate English script from Chinese input.

    Reference: design.md § 5.2

    This endpoint uses gpt-5-mini to convert Chinese text into
    natural English scripts that users can read aloud during phone calls.

    Returns:
        - english_script: Main script to read
        - alternatives: 2 alternative phrasings
        - pronunciation_tips: IPA for difficult words
    """
    api_key = _require_api_key(req)

    logger.info(f"Script generation request: {request.chinese_input[:50]}...")

    # Extract context
    context = request.context
    scenario = context.scenario if context else None
    conversation_history = [
        {"role": turn.role, "text": turn.text}
        for turn in (context.conversation_history if context else [])
    ]
    tone = context.tone if context else "polite"

    result = generate_script(
        chinese_input=request.chinese_input,
        scenario=scenario,
        conversation_history=conversation_history,
        tone=tone,
        api_key=api_key
    )

    return ScriptResponse(
        english_script=result.get("english_script", ""),
        alternatives=result.get("alternatives", []),
        pronunciation_tips=[],  # Simplified for now
        error=result.get("error")
    )


@app.post("/api/script/stream")
async def generate_script_stream_endpoint(request: ScriptRequest, req: Request):
    """
    Streaming script generation using SSE.

    Reference: design.md § 5.2

    Streams the English script in real-time for faster perceived response.

    """
    api_key = _require_api_key(req)

    # Extract context
    context = request.context
    scenario = context.scenario if context else None
    conversation_history = [
        {"role": turn.role, "text": turn.text}
        for turn in (context.conversation_history if context else [])
    ]
    tone = context.tone if context else "polite"

    def generate():
        for chunk in generate_script_stream(
            chinese_input=request.chinese_input,
            scenario=scenario,
            conversation_history=conversation_history,
            tone=tone,
            api_key=api_key
        ):
            yield chunk

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.get("/api/script/scenarios")
async def get_script_scenarios():
    """
    Get default prompt options for all scenarios.

    Returns scenario-specific default prompts that users can quickly select
    instead of typing their own input.
    """
    return {
        "scenarios": {
            key: {
                "primary": data["primary"],
                "options": data["options"]
            }
            for key, data in DEFAULT_PROMPTS.items()
        }
    }


@app.get("/api/script/scenarios/{scenario}")
async def get_scenario_prompts(scenario: str):
    """
    Get default prompt options for a specific scenario.

    Args:
        scenario: Scenario key (bank, nhs, utilities, insurance, general)

    Returns default prompts that users can quickly select.
    """
    if scenario not in DEFAULT_PROMPTS:
        return {"error": f"Unknown scenario: {scenario}", "options": []}

    data = DEFAULT_PROMPTS[scenario]
    return {
        "scenario": scenario,
        "primary": data["primary"],
        "options": data["options"]
    }


# =============================================================================
# Smart Suggestions Endpoint (Feature A)
# Uses gpt-4.1-mini: 1st suggestion ~1s, total ~1.6s (fastest + best quality)
# Tested: gpt-4.1-mini 1.08s > gpt-4.1-nano 1.89s > gpt-4o-mini 2.31s
# =============================================================================

SUGGEST_MODEL = "gpt-4.1-mini"


def _parse_suggestion_block(block: str) -> dict | None:
    """Parse a suggestion block in EN:/ZH: format."""
    english = ""
    chinese = ""
    for line in block.split("\n"):
        line = line.strip()
        if line.upper().startswith("EN:"):
            english = line[3:].strip()
        elif line.upper().startswith("ZH:"):
            chinese = line[3:].strip()
    if english and chinese:
        return {"english": english, "chinese": chinese}
    return None


SUGGEST_SYSTEM_PROMPT = """You help a non-native English speaker respond in a phone call.
Suggest 2-3 natural responses the user could say next.

FORMAT (strict, one per block):
EN: [English response, 1-2 sentences, British spelling]
ZH: [Traditional Chinese translation, Hong Kong style, 繁體中文]
---
EN: [next suggestion]
ZH: [translation]
---

Output ONLY in this format. No numbering, no extra text.
Use Traditional Chinese characters (說話 not 说话, 電話 not 电话)."""


def _suggest_stream_sync(api_key: str, conversation_text: str, num_turns: int):
    """Sync SSE generator — uses sync httpx streaming to avoid Windows async overhead.

    Yields SSE events as each suggestion is parsed from the --- delimiter stream.
    First suggestion typically arrives in ~1s.
    """
    import json as _json

    user_message = f"Recent conversation:\n{conversation_text}\n\nSuggest 2-3 responses for the Caller:"

    logger.info(f"[Suggest] Streaming for {num_turns} turns (sync)")
    try:
        with httpx.Client() as client:
            with client.stream(
                "POST",
                OPENAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": SUGGEST_MODEL,
                    "messages": [
                        {"role": "system", "content": SUGGEST_SYSTEM_PROMPT},
                        {"role": "user", "content": user_message}
                    ],
                    "max_tokens": 500,
                    "temperature": 0.7,
                    "stream": True,
                },
                timeout=15.0,
            ) as response:
                if response.status_code != 200:
                    yield f"data: {_json.dumps({'type': 'error', 'error': f'API {response.status_code}'})}\n\n"
                    return

                accumulated = ""
                suggestion_index = 0

                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    d = line[6:]
                    if d == "[DONE]":
                        break
                    try:
                        chunk = _json.loads(d)
                        content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if content:
                            accumulated += content
                            # Check for complete suggestion blocks
                            while "---" in accumulated and suggestion_index < 3:
                                parts = accumulated.split("---", 1)
                                block = parts[0].strip()
                                accumulated = parts[1] if len(parts) > 1 else ""
                                if block:
                                    s = _parse_suggestion_block(block)
                                    if s:
                                        yield f"data: {_json.dumps({'type': 'suggestion', 'index': suggestion_index, 'english': s['english'], 'chinese': s['chinese']})}\n\n"
                                        suggestion_index += 1
                    except (_json.JSONDecodeError, IndexError, KeyError):
                        pass

                # Handle last block (no trailing ---)
                if accumulated.strip() and suggestion_index < 3:
                    s = _parse_suggestion_block(accumulated.strip())
                    if s:
                        yield f"data: {_json.dumps({'type': 'suggestion', 'index': suggestion_index, 'english': s['english'], 'chinese': s['chinese']})}\n\n"
                        suggestion_index += 1

                logger.info(f"[Suggest] Streamed {suggestion_index} suggestions")
                yield f"data: {_json.dumps({'type': 'done'})}\n\n"

    except httpx.TimeoutException:
        yield f"data: {_json.dumps({'type': 'error', 'error': 'API timeout'})}\n\n"
    except Exception as e:
        logger.error(f"[Suggest] Error: {e}")
        yield f"data: {_json.dumps({'type': 'error', 'error': str(e)[:100]})}\n\n"


@app.post("/api/suggest/stream")
async def suggest_stream(request: SuggestRequest, req: Request):
    """
    SSE streaming endpoint for smart suggestions.

    Uses sync httpx streaming in thread pool (avoids Windows async overhead).
    Each suggestion is emitted as soon as it's parsed from the stream.
    """
    api_key = _require_api_key(req)

    conv_lines = []
    for turn in request.conversation_turns:
        label = "Caller" if turn.role == "me" else "Other party"
        conv_lines.append(f"{label}: {turn.text}")
    conversation_text = "\n".join(conv_lines)

    return StreamingResponse(
        _suggest_stream_sync(api_key, conversation_text, len(request.conversation_turns)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# =============================================================================
# 3-Party Simulation Endpoint (design.md § 9)
# =============================================================================


@app.post("/api/simulate/llm", response_model=SimulateLLMResponse)
async def simulate_llm_endpoint(request: SimulateLLMRequest, req: Request):
    """
    LLM endpoint for 3-party simulation testing.

    Reference: design.md § 9 (3-Party Simulation Test)

    This endpoint:
    1. Takes system instructions and conversation messages
    2. Calls gpt-5-mini via Responses API
    3. Returns the LLM response text

    Used by: src/tests/simulation/simulator.js
    """
    api_key = _require_api_key(req)

    logger.info(f"Simulate LLM request: {len(request.messages)} messages")

    try:
        # Build input messages for Responses API
        # Note: content should be a simple string, not an array with type
        input_messages = []
        for msg in request.messages:
            input_messages.append({
                "role": msg.role,
                "content": msg.content
            })

        async with httpx.AsyncClient() as client:
            response = await client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": CONTROLLER_MODEL,
                    "instructions": request.instructions,
                    "input": input_messages,
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                error_msg = f"OpenAI API error: {response.status_code} - {response.text}"
                logger.error(error_msg)
                return SimulateLLMResponse(response="", error=error_msg)

            data = response.json()

            # Extract response text
            output_text = ""
            if "output" in data and len(data["output"]) > 0:
                for item in data["output"]:
                    if item.get("type") == "message" and "content" in item:
                        for content_item in item["content"]:
                            if content_item.get("type") == "output_text":
                                output_text += content_item.get("text", "")

            logger.info(f"Simulate LLM response: {len(output_text)} chars")
            return SimulateLLMResponse(response=output_text.strip())

    except httpx.TimeoutException:
        return SimulateLLMResponse(response="", error="OpenAI API timeout")
    except Exception as e:
        logger.error(f"Simulate LLM error: {e}")
        return SimulateLLMResponse(response="", error=str(e))


# =============================================================================
# Static File Serving (for development)
# =============================================================================

# Get the project root directory (two levels up from this file)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "src", "frontend")


@app.get("/")
async def serve_index():
    """Serve the ECA main page."""
    eca_page = os.path.join(FRONTEND_DIR, "eca.html")
    if os.path.exists(eca_page):
        return FileResponse(eca_page)
    return {"message": "English Conversation Assistant API", "docs": "/docs"}


@app.get("/eca")
async def serve_eca():
    """Serve the ECA main page."""
    eca_page = os.path.join(FRONTEND_DIR, "eca.html")
    if os.path.exists(eca_page):
        return FileResponse(eca_page)
    raise HTTPException(status_code=404, detail="ECA page not found")


@app.get("/static/{filename:path}")
async def serve_static(filename: str):
    """Serve static files (JS, CSS)."""
    file_path = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    debug = os.getenv("DEBUG", "false").lower() == "true"

    print(f"Starting English Conversation Assistant backend on http://{host}:{port}")
    print(f"Controller Model: {CONTROLLER_MODEL}")
    print(f"Realtime Model: {REALTIME_MODEL}")
    print("API Key: required via X-API-Key header (no .env fallback)")
    print(f"API docs: http://{host}:{port}/docs")
    print(f"Frontend dir: {FRONTEND_DIR}")

    # 直接傳入 app 物件，避免模組路徑問題
    uvicorn.run(
        app,
        host=host,
        port=port,
    )
