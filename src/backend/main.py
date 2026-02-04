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

from fastapi import FastAPI, HTTPException
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
    )
    from .controller import (
        generate_controller_response,
        summarize_ssot,
        CONTROLLER_MODEL,
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
    )
    from controller import (
        generate_controller_response,
        summarize_ssot,
        CONTROLLER_MODEL,
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
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Length"],
    max_age=86400,  # 24 小時預檢緩存
)

# =============================================================================
# Constants
# =============================================================================

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
REALTIME_MODEL = "gpt-realtime-mini-2025-12-15"
OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


# =============================================================================
# Token Endpoint (integrated from spike)
# =============================================================================

@app.post("/api/token", response_model=TokenResponse)
async def get_ephemeral_token(request: TokenRequest):
    """
    Generate ephemeral token for WebRTC Realtime session.

    CRITICAL: Token TTL is 10 minutes (not 60 minutes).
    Reference: design.md § 9, SKILL openai-realtime-mini-voice
    """
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured"
        )

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
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
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
async def controller_endpoint(request: ControllerRequest):
    """
    Generate next utterance strategy based on user directive.

    Reference: design.md § 1.1, § 5 (Button-to-Policy)

    This endpoint:
    1. Takes user button directive + conversation context
    2. Calls gpt-5-mini via Responses API
    3. Returns decision, next utterance, memory update, notes
    """
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured"
        )

    logger.info(f"Controller request: directive={request.directive}")

    try:
        response = await generate_controller_response(request)
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
async def summarize_ssot_endpoint(request: SummarizeSsotRequest):
    """
    Summarize SSOT content if it exceeds token limit.

    Reference: design.md § 4.2

    This endpoint:
    1. Estimates token count of SSOT
    2. If > 1500 tokens, summarizes using gpt-5-mini
    3. Returns summary with token counts
    """
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured"
        )

    logger.info(f"SSOT summarize request: {len(request.ssot_text)} characters")

    try:
        response = await summarize_ssot(request)
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
        api_key_configured=bool(OPENAI_API_KEY),
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
async def translate_text(request: TranslateRequest):
    """
    Translate English text to Traditional Chinese using gpt-4o-mini.

    方案 A: 兩階段架構
    - Web Speech API 負責 STT（語音轉文字）
    - gpt-4o-mini 負責翻譯（文字轉文字）- 快速，約 0.3-0.8 秒

    注意：翻譯不是「文字控制器」功能，使用 gpt-4o-mini 以獲得更快回應。
    Controller API (/api/controller) 仍使用 gpt-5-mini。

    Reference:
    - spec/lessons_learned.md (Test 21 - 方案 A)
    """
    if not OPENAI_API_KEY:
        return TranslateResponse(
            translation="",
            source_text=request.text,
            error="OPENAI_API_KEY not configured"
        )

    logger.info(f"Translate request: {len(request.text)} chars")

    try:
        # Twilio-style translation prompt (proven effective)
        system_prompt = """You are a translation machine. Translate English to Traditional Chinese (Hong Kong style, 繁體中文).

RULES:
- Output ONLY the Chinese translation, nothing else.
- No greetings, no explanations, no "好的", no "我明白".
- Use Traditional Chinese (說話 not 说话).
- Proper nouns: 中文 (English), e.g., "愛潑斯坦 (Epstein)"
- Numbers: Keep digits, e.g., "$75,000", "2019年"."""

        async with httpx.AsyncClient() as client:
            # 使用 Chat Completions API（更快，無 reasoning 開銷）
            response = await client.post(
                OPENAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": TRANSLATION_MODEL,  # gpt-4o-mini
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
async def translate_text_stream(request: TranslateRequest):
    """
    Streaming translation using SSE (Server-Sent Events).

    優點：
    - 首字回應時間約 0.3 秒
    - 用戶可以邊看邊讀，感覺更快

    使用方式：
    前端用 EventSource 或 fetch + ReadableStream 接收
    """
    if not OPENAI_API_KEY:
        async def error_gen():
            yield f"data: {{\"error\": \"OPENAI_API_KEY not configured\"}}\n\n"
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    system_prompt = """You are a translation machine. Translate English to Traditional Chinese (Hong Kong style, 繁體中文).
Output ONLY the Chinese translation. No greetings, no explanations. Use Traditional Chinese (說話 not 说话)."""

    async def generate():
        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    OPENAI_CHAT_URL,
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
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
                        "stream": True,  # 啟用串流
                    },
                    timeout=15.0,
                ) as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]  # Remove "data: " prefix
                            if data == "[DONE]":
                                yield f"data: {{\"done\": true}}\n\n"
                                break
                            try:
                                import json
                                chunk = json.loads(data)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    # 發送翻譯片段
                                    yield f"data: {{\"text\": {json.dumps(content)}}}\n\n"
                            except:
                                pass
        except Exception as e:
            logger.error(f"Streaming translation error: {e}")
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
# 3-Party Simulation Endpoint (design.md § 9)
# =============================================================================


@app.post("/api/simulate/llm", response_model=SimulateLLMResponse)
async def simulate_llm_endpoint(request: SimulateLLMRequest):
    """
    LLM endpoint for 3-party simulation testing.

    Reference: design.md § 9 (3-Party Simulation Test)

    This endpoint:
    1. Takes system instructions and conversation messages
    2. Calls gpt-5-mini via Responses API
    3. Returns the LLM response text

    Used by: src/tests/simulation/simulator.js
    """
    if not OPENAI_API_KEY:
        return SimulateLLMResponse(
            response="",
            error="OPENAI_API_KEY not configured"
        )

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
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
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
    """Serve the ECA main page (default)."""
    eca_page = os.path.join(FRONTEND_DIR, "eca_main.html")
    if os.path.exists(eca_page):
        return FileResponse(eca_page)
    return {"message": "English Conversation Assistant API", "docs": "/docs"}


@app.get("/eca")
async def serve_eca():
    """Serve the ECA main page."""
    eca_page = os.path.join(FRONTEND_DIR, "eca_main.html")
    if os.path.exists(eca_page):
        return FileResponse(eca_page)
    raise HTTPException(status_code=404, detail="ECA page not found")


@app.get("/eca-test")
async def serve_eca_test():
    """Serve the ECA parallel translation test page."""
    test_page = os.path.join(FRONTEND_DIR, "eca_parallel_test.html")
    if os.path.exists(test_page):
        return FileResponse(test_page)
    raise HTTPException(status_code=404, detail="ECA test page not found")


@app.get("/setup")
async def serve_setup():
    """Serve the legacy setup page."""
    setup_page = os.path.join(FRONTEND_DIR, "setup_page.html")
    if os.path.exists(setup_page):
        return FileResponse(setup_page)
    raise HTTPException(status_code=404, detail="Setup page not found")


@app.get("/conversation")
async def serve_conversation():
    """Serve the legacy conversation page."""
    conversation_page = os.path.join(FRONTEND_DIR, "conversation_page.html")
    if os.path.exists(conversation_page):
        return FileResponse(conversation_page)
    raise HTTPException(status_code=404, detail="Conversation page not found")


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
    print(f"API Key configured: {bool(OPENAI_API_KEY)}")
    print(f"API docs: http://{host}:{port}/docs")
    print(f"Frontend dir: {FRONTEND_DIR}")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
    )
