"""
Pydantic models for Voice Proxy Negotiator Backend API.

Reference:
- design.md § 1.1 (Controller API 規格)
- design.md § 4.2 (SSOT 摘要 API 規格)
- src/skills/openai-gpt5-mini-controller/SKILL.md
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


# =============================================================================
# Token API Models (from spike)
# =============================================================================

class TokenRequest(BaseModel):
    """Request model for ephemeral token generation."""
    voice: str = Field(default="marin", description="Voice selection (marin or cedar)")


class TokenResponse(BaseModel):
    """Response model for ephemeral token."""
    client_secret: str = Field(..., description="Ephemeral client secret (ek_...)")
    expires_at: int = Field(..., description="Unix timestamp when token expires")
    model: str = Field(..., description="Realtime model ID")


# =============================================================================
# Controller API Models
# =============================================================================

class ControllerRequest(BaseModel):
    """
    Request model for Controller API.

    Reference: design.md § 1.1

    Attributes:
        directive: User button intent (e.g., AGREE, DISAGREE, NEED_TIME)
        pinned_context: Goal + Rules + SSOT summary (stable)
        memory: Rolling summary of conversation state
        latest_turns: Recent conversation turns (max 3 for natural tone)
        previous_response_id: Optional ID for stateful continuation
    """
    directive: Literal[
        "AGREE",
        "DISAGREE",
        "NEED_TIME",
        "REPEAT",
        "PROPOSE_ALTERNATIVE",
        "ASK_BOTTOM_LINE",
        "SAY_GOODBYE",
        "GOAL_MET",
        "CONTINUE"  # Default when no button pressed
    ] = Field(..., description="User button directive")

    pinned_context: str = Field(
        ...,
        description="Goal, Rules, SSOT summary - kept stable throughout session"
    )

    memory: str = Field(
        default="",
        description="Rolling summary of conversation state"
    )

    latest_turns: List[str] = Field(
        default_factory=list,
        description="Recent conversation turns (recommended: max 3)",
        max_length=10  # Hard limit for safety
    )

    previous_response_id: Optional[str] = Field(
        default=None,
        description="Previous response ID for stateful continuation (Responses API)"
    )


class ControllerResponse(BaseModel):
    """
    Response model for Controller API.

    Reference: design.md § 1.1, src/skills/openai-gpt5-mini-controller/SKILL.md

    Attributes:
        decision: continue / request_clarification / stop
        next_english_utterance: Short phrase for Realtime to speak (1-2 sentences)
        memory_update: Updated rolling summary (replaces previous memory)
        notes_for_user: Optional Chinese hints for UI (not spoken)
        response_id: Response ID for stateful continuation
    """
    decision: Literal["continue", "request_clarification", "stop"] = Field(
        ...,
        description="Controller decision for next action"
    )

    next_english_utterance: str = Field(
        ...,
        description="Short English phrase for Realtime to speak (1-2 sentences)"
    )

    memory_update: str = Field(
        default="",
        description="Updated rolling summary (replaces previous memory)"
    )

    notes_for_user: Optional[str] = Field(
        default=None,
        description="Optional Chinese hints for UI (not spoken)"
    )

    response_id: str = Field(
        ...,
        description="Response ID for stateful continuation"
    )


# =============================================================================
# SSOT Summarize API Models
# =============================================================================

class SummarizeSsotRequest(BaseModel):
    """
    Request model for SSOT summarization.

    Reference: design.md § 4.2
    """
    ssot_text: str = Field(
        ...,
        description="Original SSOT content to summarize",
        max_length=10000  # Safety limit (> 5000 char limit in requirements)
    )


class SummarizeSsotResponse(BaseModel):
    """
    Response model for SSOT summarization.

    Reference: design.md § 4.2
    """
    summary: str = Field(
        ...,
        description="Summarized SSOT content"
    )

    original_tokens: int = Field(
        ...,
        description="Estimated token count of original SSOT"
    )

    summary_tokens: int = Field(
        ...,
        description="Estimated token count of summary"
    )


# =============================================================================
# Internal Models (for Controller logic)
# =============================================================================

class ControllerOutput(BaseModel):
    """
    Internal model for parsed Controller output from gpt-5-mini.
    Used for fail-soft JSON parsing.
    """
    decision: str = "continue"
    next_english_utterance: str = ""
    memory_update: str = ""
    notes_for_user: Optional[str] = None


# =============================================================================
# Health Check Models
# =============================================================================

class HealthResponse(BaseModel):
    """Response model for health check endpoint."""
    status: str = Field(default="ok")
    model_controller: str = Field(..., description="Controller model ID")
    model_realtime: str = Field(..., description="Realtime model ID")
    api_key_configured: bool = Field(..., description="Whether API key is configured")


# =============================================================================
# 3-Party Simulation Models (design.md § 9)
# =============================================================================

class SimulateLLMMessage(BaseModel):
    """Single message for LLM simulation."""
    role: Literal["user", "assistant", "system"] = Field(..., description="Message role")
    content: str = Field(..., description="Message content")


class SimulateLLMRequest(BaseModel):
    """
    Request model for LLM simulation endpoint.

    Reference: design.md § 9 (3-Party Simulation)
    """
    instructions: str = Field(
        ...,
        description="System instructions for the LLM"
    )
    messages: List[SimulateLLMMessage] = Field(
        default_factory=list,
        description="Conversation history"
    )


class SimulateLLMResponse(BaseModel):
    """Response model for LLM simulation endpoint."""
    response: str = Field(..., description="LLM response text")
    error: Optional[str] = Field(default=None, description="Error message if failed")
