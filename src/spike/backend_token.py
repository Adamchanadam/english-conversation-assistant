"""
Spike: Minimal FastAPI backend for ephemeral token generation.
Task: T0.1 - WebRTC Realtime connection test

Reference:
- design.md § 9 (Ephemeral Token)
- SKILL: openai-realtime-mini-voice (Token generation)
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

# Load environment variables
load_dotenv()

app = FastAPI(title="Voice Proxy Negotiator - Spike")

# CORS configuration (design.md § 1.1)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Length"],
    max_age=86400,
)

# Constants
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
REALTIME_MODEL = "gpt-realtime-mini-2025-12-15"
OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


class TokenRequest(BaseModel):
    voice: str = "marin"


class TokenResponse(BaseModel):
    client_secret: str
    expires_at: int
    model: str


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
    # Reference: https://platform.openai.com/docs/api-reference/realtime-sessions
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

            # Response format: { "value": "ek_...", "expires_at": ..., "session": {...} }
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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "model": REALTIME_MODEL,
        "api_key_configured": bool(OPENAI_API_KEY),
    }


# Serve static files (HTML test page)
@app.get("/")
async def serve_test_page():
    """Serve the WebRTC test page."""
    return FileResponse("src/spike/realtime_test.html")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    debug = os.getenv("DEBUG", "false").lower() == "true"

    print(f"Starting spike server on http://{host}:{port}")
    print(f"Model: {REALTIME_MODEL}")
    print(f"API Key configured: {bool(OPENAI_API_KEY)}")

    uvicorn.run(
        "backend_token:app",
        host=host,
        port=port,
        reload=debug,
    )
