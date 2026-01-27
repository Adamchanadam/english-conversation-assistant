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
from fastapi.responses import FileResponse
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
    title="Voice Proxy Negotiator",
    description="Backend API for English voice negotiation agent",
    version="1.0.0"
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
# 3-Party Simulation Endpoint (design.md § 9)
# =============================================================================

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


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
    """Serve the setup page (development)."""
    setup_page = os.path.join(FRONTEND_DIR, "setup_page.html")
    if os.path.exists(setup_page):
        return FileResponse(setup_page)
    return {"message": "Voice Proxy Negotiator API", "docs": "/docs"}


@app.get("/conversation")
async def serve_conversation():
    """Serve the conversation page (development)."""
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

    print(f"Starting Voice Proxy Negotiator backend on http://{host}:{port}")
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
