"""
Controller logic for gpt-5-mini text control plane.

Reference:
- design.md § 1.1 (Control Plane API 端點)
- design.md § 5 (Button-to-Policy)
- src/skills/openai-gpt5-mini-controller/SKILL.md

Model: gpt-5-mini-2025-08-07 (Responses API)
"""

import json
import logging
import os
import re
from typing import Optional, Tuple

import httpx

# Handle both module and direct execution imports
try:
    from .models import (
        ControllerOutput,
        ControllerRequest,
        ControllerResponse,
        SummarizeSsotRequest,
        SummarizeSsotResponse,
    )
    from .prompt_templates import (
        CONTROLLER_INSTRUCTION,
        SSOT_SUMMARIZE_INSTRUCTION,
        build_controller_prompt,
        build_ssot_summarize_prompt,
    )
except ImportError:
    from models import (
        ControllerOutput,
        ControllerRequest,
        ControllerResponse,
        SummarizeSsotRequest,
        SummarizeSsotResponse,
    )
    from prompt_templates import (
        CONTROLLER_INSTRUCTION,
        SSOT_SUMMARIZE_INSTRUCTION,
        build_controller_prompt,
        build_ssot_summarize_prompt,
    )

# Configure logging
logger = logging.getLogger(__name__)

# =============================================================================
# Constants
# =============================================================================

# Model configuration (HARD CONSTRAINT from CLAUDE.md)
CONTROLLER_MODEL = "gpt-5-mini-2025-08-07"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

# API configuration
MAX_OUTPUT_TOKENS = 1000  # Per SKILL.md recommendation
REQUEST_TIMEOUT = 30.0  # Per design.md § 9.3


# =============================================================================
# Token Estimation (simple formula for v1)
# =============================================================================

def estimate_tokens(text: str) -> int:
    """
    Estimate token count using simple formula (v1).

    Reference: design.md § 7 (T2.1 defines the formula)

    Formula:
    - Chinese characters: ~2 tokens each
    - English words: ~1.3 tokens each
    - Punctuation: ignored

    Args:
        text: Input text to estimate

    Returns:
        Estimated token count
    """
    if not text:
        return 0

    # Count Chinese characters (CJK Unified Ideographs range)
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))

    # Remove Chinese characters and count English words
    text_without_chinese = re.sub(r'[\u4e00-\u9fff]', '', text)
    english_words = len(text_without_chinese.split())

    # Apply formula
    estimated = int(chinese_chars * 2 + english_words * 1.3)

    return max(estimated, 1)  # At least 1 token for non-empty text


# =============================================================================
# Honesty Detection (T1.5)
# =============================================================================

# Phrases that indicate uncertainty or "I don't know" responses
HONESTY_INDICATORS = [
    "i don't know",
    "i do not know",
    "i'm not sure",
    "i am not sure",
    "let me check",
    "let me find out",
    "i'll need to verify",
    "i will need to verify",
    "i can't confirm",
    "i cannot confirm",
    "i'm uncertain",
    "i am uncertain",
    "i need to look into",
    "i'll get back to you",
    "i will get back to you",
    "that's outside my knowledge",
    "i don't have that information",
]


def detect_honesty_response(utterance: str) -> Optional[str]:
    """
    Detect if the utterance contains honesty indicators (T1.5).

    Reference: steering.md § 7 (不虛構合約)

    When the agent admits uncertainty or lack of knowledge,
    we should note this for the user interface.

    Args:
        utterance: The English utterance from the controller

    Returns:
        Chinese note for user if honesty indicator detected, None otherwise
    """
    if not utterance:
        return None

    lower_utterance = utterance.lower()

    for indicator in HONESTY_INDICATORS:
        if indicator in lower_utterance:
            logger.info(f"Honesty indicator detected: '{indicator}'")
            return "提示：AI 表示不確定此資訊，請人工確認或提供更多資料"

    return None


# =============================================================================
# Fail-soft JSON Parsing
# =============================================================================

def parse_controller_output(response_text: str) -> ControllerOutput:
    """
    Parse controller output with fail-soft strategy.

    Reference: design.md § 1.1, SKILL.md § fail-soft

    Strategy:
    1. Try direct JSON parse
    2. Try extracting JSON block with regex
    3. Fall back to best-effort field extraction

    Args:
        response_text: Raw response text from gpt-5-mini

    Returns:
        ControllerOutput with parsed or default values
    """
    # Default output
    output = ControllerOutput()

    if not response_text:
        logger.warning("Empty response from controller model")
        output.next_english_utterance = "I need a moment to process that."
        output.notes_for_user = "警告：控制器返回空響應"
        return output

    # Strategy 1: Direct JSON parse
    try:
        data = json.loads(response_text)
        return _extract_from_dict(data)
    except json.JSONDecodeError:
        logger.debug("Direct JSON parse failed, trying regex extraction")

    # Strategy 2: Extract JSON block with regex
    json_match = re.search(r'\{[\s\S]*?\}', response_text)
    if json_match:
        try:
            data = json.loads(json_match.group())
            return _extract_from_dict(data)
        except json.JSONDecodeError:
            logger.debug("Regex JSON extraction failed, trying best-effort")

    # Strategy 3: Best-effort field extraction
    logger.warning("Falling back to best-effort field extraction")
    return _best_effort_extract(response_text)


def _extract_from_dict(data: dict) -> ControllerOutput:
    """Extract ControllerOutput from a dictionary."""
    return ControllerOutput(
        decision=data.get("decision", "continue"),
        next_english_utterance=data.get("next_english_utterance", ""),
        memory_update=data.get("memory_update", ""),
        notes_for_user=data.get("notes_for_user")
    )


def _best_effort_extract(text: str) -> ControllerOutput:
    """
    Best-effort extraction of controller fields from text.

    Attempts to find key fields using regex patterns.
    """
    output = ControllerOutput()

    # Try to extract decision
    decision_match = re.search(
        r'"?decision"?\s*[:\=]\s*"?(continue|request_clarification|stop)"?',
        text,
        re.IGNORECASE
    )
    if decision_match:
        output.decision = decision_match.group(1).lower()

    # Try to extract utterance
    utterance_match = re.search(
        r'"?next_english_utterance"?\s*[:\=]\s*"([^"]+)"',
        text
    )
    if utterance_match:
        output.next_english_utterance = utterance_match.group(1)
    else:
        # If no structured utterance, use first sentence as fallback
        first_sentence = re.match(r'^[^.!?]+[.!?]', text.strip())
        if first_sentence:
            output.next_english_utterance = first_sentence.group().strip()
        else:
            output.next_english_utterance = "Let me think about that for a moment."

    # Try to extract memory update
    memory_match = re.search(
        r'"?memory_update"?\s*[:\=]\s*"([^"]+)"',
        text
    )
    if memory_match:
        output.memory_update = memory_match.group(1)

    # Try to extract notes
    notes_match = re.search(
        r'"?notes_for_user"?\s*[:\=]\s*"([^"]+)"',
        text
    )
    if notes_match:
        output.notes_for_user = notes_match.group(1)

    output.notes_for_user = (output.notes_for_user or "") + " [警告：JSON 解析失敗，使用最佳猜測]"

    return output


# =============================================================================
# OpenAI Responses API Caller
# =============================================================================

async def call_responses_api(
    instruction: str,
    prompt: str,
    previous_response_id: Optional[str] = None,
    max_tokens: int = MAX_OUTPUT_TOKENS,
    api_key: Optional[str] = None
) -> Tuple[str, str]:
    """
    Call OpenAI Responses API with gpt-5-mini.

    Reference: src/skills/openai-gpt5-mini-controller/SKILL.md

    Args:
        instruction: System instruction for the model
        prompt: User input prompt
        previous_response_id: Optional ID for stateful continuation
        max_tokens: Maximum output tokens
        api_key: OpenAI API key (required, passed from endpoint)

    Returns:
        Tuple of (response_text, response_id)

    Raises:
        httpx.HTTPStatusError: On API errors
        httpx.TimeoutException: On timeout
    """
    if not api_key:
        raise ValueError("API Key required. Please set your OpenAI API Key in Settings.")

    # Build request body
    request_body = {
        "model": CONTROLLER_MODEL,
        "instructions": instruction,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt}
                ]
            }
        ],
        "max_output_tokens": max_tokens
    }

    # Add previous_response_id if provided (for stateful continuation)
    if previous_response_id:
        request_body["previous_response_id"] = previous_response_id

    logger.debug(f"Calling Responses API with model={CONTROLLER_MODEL}")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json=request_body,
            timeout=REQUEST_TIMEOUT
        )

        response.raise_for_status()
        data = response.json()

        # Extract response text and ID
        # Responses API returns: { "id": "resp_...", "output": [...], ... }
        response_id = data.get("id", "")
        output_text = ""

        # Extract text from output array
        output_items = data.get("output", [])
        for item in output_items:
            if item.get("type") == "message":
                content = item.get("content", [])
                for content_item in content:
                    if content_item.get("type") == "output_text":
                        output_text += content_item.get("text", "")

        return output_text, response_id


# =============================================================================
# Controller Service Functions
# =============================================================================

async def generate_controller_response(
    request: ControllerRequest,
    api_key: Optional[str] = None
) -> ControllerResponse:
    """
    Generate controller response based on user directive and context.

    Reference: design.md § 1.1, § 5

    Args:
        request: ControllerRequest with directive, context, memory, turns
        api_key: OpenAI API key (required, passed from endpoint)

    Returns:
        ControllerResponse with decision, utterance, memory update, notes
    """
    # Build prompt
    prompt = build_controller_prompt(
        directive=request.directive,
        pinned_context=request.pinned_context,
        memory=request.memory,
        latest_turns=request.latest_turns
    )

    try:
        # Call Responses API
        response_text, response_id = await call_responses_api(
            instruction=CONTROLLER_INSTRUCTION,
            prompt=prompt,
            previous_response_id=request.previous_response_id,
            api_key=api_key
        )

        # Parse output with fail-soft strategy
        parsed = parse_controller_output(response_text)

        # T1.5: Detect honesty indicators in the utterance
        utterance = parsed.next_english_utterance or "Let me consider that."
        honesty_note = detect_honesty_response(utterance)

        # Combine notes: existing notes + honesty note
        final_notes = parsed.notes_for_user
        if honesty_note:
            if final_notes:
                final_notes = f"{final_notes}\n{honesty_note}"
            else:
                final_notes = honesty_note

        return ControllerResponse(
            decision=parsed.decision if parsed.decision in ("continue", "request_clarification", "stop") else "continue",
            next_english_utterance=utterance,
            memory_update=parsed.memory_update,
            notes_for_user=final_notes,
            response_id=response_id
        )

    except httpx.TimeoutException:
        logger.error("Controller API timeout")
        return ControllerResponse(
            decision="continue",
            next_english_utterance="I need a moment to think about that.",
            memory_update=request.memory,  # Preserve existing memory
            notes_for_user="警告：API 超時，使用預設回應",
            response_id=""
        )

    except httpx.HTTPStatusError as e:
        logger.error(f"Controller API error: {e.response.status_code}")
        return ControllerResponse(
            decision="continue",
            next_english_utterance="Let me get back to you on that.",
            memory_update=request.memory,
            notes_for_user=f"警告：API 錯誤 ({e.response.status_code})",
            response_id=""
        )

    except Exception as e:
        logger.error(f"Unexpected error in controller: {e}")
        return ControllerResponse(
            decision="continue",
            next_english_utterance="I appreciate your patience.",
            memory_update=request.memory,
            notes_for_user=f"警告：未預期錯誤 - {str(e)}",
            response_id=""
        )


async def summarize_ssot(request: SummarizeSsotRequest, api_key: Optional[str] = None) -> SummarizeSsotResponse:
    """
    Summarize SSOT content using gpt-5-mini.

    Reference: design.md § 4.2

    Args:
        request: SummarizeSsotRequest with ssot_text

    Returns:
        SummarizeSsotResponse with summary and token counts
    """
    # Estimate original tokens
    original_tokens = estimate_tokens(request.ssot_text)

    # If already under limit, return as-is
    if original_tokens <= 1500:
        return SummarizeSsotResponse(
            summary=request.ssot_text,
            original_tokens=original_tokens,
            summary_tokens=original_tokens
        )

    # Build summarization prompt
    prompt = build_ssot_summarize_prompt(request.ssot_text)

    try:
        # Call Responses API for summarization
        summary_text, _ = await call_responses_api(
            instruction=SSOT_SUMMARIZE_INSTRUCTION,
            prompt=prompt,
            max_tokens=2000,  # Allow more tokens for summary
            api_key=api_key
        )

        summary_tokens = estimate_tokens(summary_text)

        return SummarizeSsotResponse(
            summary=summary_text,
            original_tokens=original_tokens,
            summary_tokens=summary_tokens
        )

    except Exception as e:
        logger.error(f"SSOT summarization error: {e}")
        # Fall back to truncation
        truncated = request.ssot_text[:3000]  # Rough truncation
        return SummarizeSsotResponse(
            summary=truncated + "\n\n[注意：摘要失敗，已截斷原文]",
            original_tokens=original_tokens,
            summary_tokens=estimate_tokens(truncated)
        )
