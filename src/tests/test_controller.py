"""
Unit tests for Controller module.

Reference:
- tasks.md T1.4 驗收標準
- design.md § 1.1 (Controller API 規格)

Run with:
    python -m pytest src/tests/test_controller.py -v
"""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# Import modules under test
import sys
import os

# Ensure src is in path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.backend.controller import (
    estimate_tokens,
    parse_controller_output,
    CONTROLLER_MODEL,
)
from src.backend.models import (
    ControllerRequest,
    ControllerResponse,
    ControllerOutput,
    SummarizeSsotRequest,
)
from src.backend.prompt_templates import (
    build_controller_prompt,
    build_ssot_summarize_prompt,
    CONTROLLER_INSTRUCTION,
    DIRECTIVE_DISPLAY_MAPPING,
)


# =============================================================================
# Test: Token Estimation
# =============================================================================

class TestEstimateTokens:
    """Tests for token estimation function."""

    def test_empty_string(self):
        """Empty string should return 0 tokens."""
        assert estimate_tokens("") == 0

    def test_english_words(self):
        """English words should be ~1.3 tokens each."""
        text = "hello world"  # 2 words
        tokens = estimate_tokens(text)
        assert tokens >= 2  # At least 2 tokens
        assert tokens <= 4  # At most 4 tokens (2 * 1.3 rounded)

    def test_chinese_characters(self):
        """Chinese characters should be ~2 tokens each."""
        text = "你好世界"  # 4 characters
        tokens = estimate_tokens(text)
        assert tokens >= 6  # At least 6 tokens (4 * 2 - some margin)
        assert tokens <= 10  # At most 10 tokens

    def test_mixed_content(self):
        """Mixed Chinese and English content."""
        text = "Hello 世界"  # 1 English word + 2 Chinese chars
        tokens = estimate_tokens(text)
        assert tokens >= 4  # 1*1.3 + 2*2 = 5.3
        assert tokens <= 8

    def test_long_text(self):
        """Longer text should scale proportionally."""
        short_text = "hello"
        long_text = "hello " * 100
        short_tokens = estimate_tokens(short_text)
        long_tokens = estimate_tokens(long_text)
        assert long_tokens > short_tokens * 50  # Should scale reasonably


# =============================================================================
# Test: Fail-soft JSON Parsing
# =============================================================================

class TestParseControllerOutput:
    """Tests for fail-soft JSON parsing."""

    def test_valid_json(self):
        """Valid JSON should parse correctly."""
        valid_json = json.dumps({
            "decision": "continue",
            "next_english_utterance": "I agree with that.",
            "memory_update": "Updated memory",
            "notes_for_user": "測試備註"
        })
        result = parse_controller_output(valid_json)
        assert result.decision == "continue"
        assert result.next_english_utterance == "I agree with that."
        assert result.memory_update == "Updated memory"
        assert result.notes_for_user == "測試備註"

    def test_json_with_extra_text(self):
        """JSON embedded in extra text should be extracted."""
        text_with_json = """
        Here is my response:
        {"decision": "stop", "next_english_utterance": "Goodbye!", "memory_update": "", "notes_for_user": null}
        End of response.
        """
        result = parse_controller_output(text_with_json)
        assert result.decision == "stop"
        assert result.next_english_utterance == "Goodbye!"

    def test_invalid_json_best_effort(self):
        """Invalid JSON should trigger best-effort extraction."""
        malformed = """
        decision: continue
        next_english_utterance: "Let me think about that."
        memory_update: "Some memory"
        """
        result = parse_controller_output(malformed)
        # Should still extract something
        assert result is not None
        assert isinstance(result.decision, str)
        # Should have warning note
        assert result.notes_for_user is not None
        assert "警告" in result.notes_for_user or "JSON" in result.notes_for_user

    def test_empty_response(self):
        """Empty response should return defaults with warning."""
        result = parse_controller_output("")
        assert result.decision == "continue"
        assert result.next_english_utterance != ""  # Should have fallback
        assert result.notes_for_user is not None
        assert "警告" in result.notes_for_user

    def test_partial_json(self):
        """Partial JSON should still extract available fields."""
        partial = '{"decision": "request_clarification", "next_english_utterance": "Could you clarify?"'
        result = parse_controller_output(partial)
        # Should attempt extraction but may fail - verify no crash
        assert result is not None

    def test_all_decision_types(self):
        """All valid decision types should be accepted."""
        for decision in ["continue", "request_clarification", "stop"]:
            valid_json = json.dumps({
                "decision": decision,
                "next_english_utterance": "Test",
                "memory_update": "",
                "notes_for_user": None
            })
            result = parse_controller_output(valid_json)
            assert result.decision == decision


# =============================================================================
# Test: Prompt Building
# =============================================================================

class TestPromptBuilding:
    """Tests for prompt template building."""

    def test_build_controller_prompt_basic(self):
        """Basic controller prompt should include all sections."""
        prompt = build_controller_prompt(
            directive="AGREE",
            pinned_context="Goal: Get 10% discount",
            memory="We discussed pricing",
            latest_turns=["Human: How about $90?", "Assistant: Let me check."]
        )

        assert "PINNED CONTEXT" in prompt
        assert "Goal: Get 10% discount" in prompt
        assert "CURRENT MEMORY" in prompt
        assert "We discussed pricing" in prompt
        assert "RECENT CONVERSATION" in prompt
        assert "Human: How about $90?" in prompt
        assert "USER DIRECTIVE" in prompt
        assert "AGREE" in prompt

    def test_build_controller_prompt_empty_memory(self):
        """Empty memory should show (Empty) placeholder."""
        prompt = build_controller_prompt(
            directive="CONTINUE",
            pinned_context="Some context",
            memory="",
            latest_turns=[]
        )

        assert "(Empty)" in prompt
        assert "(No recent turns)" in prompt

    def test_build_ssot_summarize_prompt(self):
        """SSOT summarize prompt should include the text."""
        ssot = "This is my contract. Price: $100. Deadline: March 1."
        prompt = build_ssot_summarize_prompt(ssot)

        assert "This is my contract" in prompt
        assert "$100" in prompt
        assert "March 1" in prompt

    def test_controller_instruction_content(self):
        """Controller instruction should include key rules."""
        assert "NEVER fabricate" in CONTROLLER_INSTRUCTION
        assert "1-2 sentences" in CONTROLLER_INSTRUCTION
        assert "decision" in CONTROLLER_INSTRUCTION
        assert "JSON" in CONTROLLER_INSTRUCTION

    def test_all_directives_in_mapping(self):
        """All expected directives should be in the mapping."""
        expected_directives = [
            "AGREE", "DISAGREE", "NEED_TIME", "REPEAT",
            "PROPOSE_ALTERNATIVE", "ASK_BOTTOM_LINE",
            "SAY_GOODBYE", "GOAL_MET", "CONTINUE"
        ]
        for directive in expected_directives:
            assert directive in DIRECTIVE_DISPLAY_MAPPING


# =============================================================================
# Test: Model Validation
# =============================================================================

class TestModelValidation:
    """Tests for Pydantic model validation."""

    def test_controller_request_valid(self):
        """Valid ControllerRequest should pass validation."""
        request = ControllerRequest(
            directive="AGREE",
            pinned_context="Goal: negotiate",
            memory="Current state",
            latest_turns=["Turn 1", "Turn 2"],
            previous_response_id="resp_123"
        )
        assert request.directive == "AGREE"
        assert request.previous_response_id == "resp_123"

    def test_controller_request_defaults(self):
        """ControllerRequest should have sensible defaults."""
        request = ControllerRequest(
            directive="CONTINUE",
            pinned_context="Goal"
        )
        assert request.memory == ""
        assert request.latest_turns == []
        assert request.previous_response_id is None

    def test_controller_request_invalid_directive(self):
        """Invalid directive should raise validation error."""
        with pytest.raises(Exception):  # Pydantic ValidationError
            ControllerRequest(
                directive="INVALID_DIRECTIVE",
                pinned_context="Goal"
            )

    def test_controller_response_valid(self):
        """Valid ControllerResponse should pass validation."""
        response = ControllerResponse(
            decision="continue",
            next_english_utterance="I agree.",
            memory_update="Updated",
            notes_for_user=None,
            response_id="resp_456"
        )
        assert response.decision == "continue"
        assert response.response_id == "resp_456"

    def test_summarize_request_valid(self):
        """Valid SummarizeSsotRequest should pass validation."""
        request = SummarizeSsotRequest(ssot_text="My SSOT content")
        assert request.ssot_text == "My SSOT content"


# =============================================================================
# Test: Controller Model Constant
# =============================================================================

class TestModelConstants:
    """Tests for model constants."""

    def test_controller_model_is_gpt5_mini(self):
        """Controller model must be gpt-5-mini (HARD CONSTRAINT)."""
        assert "gpt-5-mini" in CONTROLLER_MODEL
        assert "2025" in CONTROLLER_MODEL  # Should have version suffix


# =============================================================================
# Test: Controller Service (with mocking)
# =============================================================================

class TestControllerService:
    """Tests for controller service functions with mocked API."""

    @pytest.mark.asyncio
    async def test_generate_controller_response_success(self):
        """Controller should return valid response on success."""
        from src.backend.controller import generate_controller_response

        mock_response = {
            "id": "resp_test_123",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps({
                                "decision": "continue",
                                "next_english_utterance": "I understand your point.",
                                "memory_update": "Discussed pricing",
                                "notes_for_user": None
                            })
                        }
                    ]
                }
            ]
        }

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
            with patch("src.backend.controller.httpx.AsyncClient") as mock_client:
                mock_response_obj = MagicMock()
                mock_response_obj.status_code = 200
                mock_response_obj.json.return_value = mock_response
                mock_response_obj.raise_for_status = MagicMock()

                mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                    return_value=mock_response_obj
                )

                request = ControllerRequest(
                    directive="AGREE",
                    pinned_context="Goal: negotiate",
                    memory="",
                    latest_turns=[]
                )

                response = await generate_controller_response(request)

                assert response.decision == "continue"
                assert response.next_english_utterance == "I understand your point."
                assert response.response_id == "resp_test_123"

    @pytest.mark.asyncio
    async def test_generate_controller_response_timeout(self):
        """Controller should handle timeout gracefully."""
        from src.backend.controller import generate_controller_response
        import httpx

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
            with patch("src.backend.controller.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                    side_effect=httpx.TimeoutException("Timeout")
                )

                request = ControllerRequest(
                    directive="AGREE",
                    pinned_context="Goal",
                    memory="existing memory",
                    latest_turns=[]
                )

                response = await generate_controller_response(request)

                # Should return fallback response, not crash
                assert response.decision == "continue"
                assert response.notes_for_user is not None
                assert "超時" in response.notes_for_user
                assert response.memory_update == "existing memory"  # Preserved

    @pytest.mark.asyncio
    async def test_summarize_ssot_under_limit(self):
        """SSOT under token limit should not be summarized."""
        from src.backend.controller import summarize_ssot

        request = SummarizeSsotRequest(ssot_text="Short text")
        response = await summarize_ssot(request)

        # Should return original text unchanged
        assert response.summary == "Short text"
        assert response.original_tokens == response.summary_tokens


# =============================================================================
# Test: previous_response_id Handling
# =============================================================================

class TestPreviousResponseId:
    """Tests for previous_response_id stateful continuation."""

    @pytest.mark.asyncio
    async def test_previous_response_id_included_in_request(self):
        """previous_response_id should be included in API request."""
        from src.backend.controller import call_responses_api

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
            with patch("src.backend.controller.httpx.AsyncClient") as mock_client:
                mock_response_obj = MagicMock()
                mock_response_obj.status_code = 200
                mock_response_obj.json.return_value = {
                    "id": "resp_new",
                    "output": []
                }
                mock_response_obj.raise_for_status = MagicMock()

                mock_post = AsyncMock(return_value=mock_response_obj)
                mock_client.return_value.__aenter__.return_value.post = mock_post

                await call_responses_api(
                    instruction="Test instruction",
                    prompt="Test prompt",
                    previous_response_id="resp_previous_123"
                )

                # Verify previous_response_id was included
                call_args = mock_post.call_args
                request_body = call_args[1]["json"]
                assert request_body["previous_response_id"] == "resp_previous_123"

    @pytest.mark.asyncio
    async def test_previous_response_id_omitted_when_none(self):
        """previous_response_id should be omitted when None."""
        from src.backend.controller import call_responses_api

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
            with patch("src.backend.controller.httpx.AsyncClient") as mock_client:
                mock_response_obj = MagicMock()
                mock_response_obj.status_code = 200
                mock_response_obj.json.return_value = {
                    "id": "resp_new",
                    "output": []
                }
                mock_response_obj.raise_for_status = MagicMock()

                mock_post = AsyncMock(return_value=mock_response_obj)
                mock_client.return_value.__aenter__.return_value.post = mock_post

                await call_responses_api(
                    instruction="Test instruction",
                    prompt="Test prompt",
                    previous_response_id=None
                )

                # Verify previous_response_id was NOT included
                call_args = mock_post.call_args
                request_body = call_args[1]["json"]
                assert "previous_response_id" not in request_body


# =============================================================================
# Test: Honesty Detection (T1.5)
# =============================================================================

class TestHonestyDetection:
    """Tests for honesty indicator detection (T1.5)."""

    def test_detect_i_dont_know(self):
        """Should detect 'I don't know' phrases."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("I don't know the exact price.")
        assert result is not None
        assert "不確定" in result

    def test_detect_not_sure(self):
        """Should detect 'I'm not sure' phrases."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("I'm not sure about the delivery date.")
        assert result is not None
        assert "不確定" in result

    def test_detect_let_me_check(self):
        """Should detect 'let me check' phrases."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("Let me check on that for you.")
        assert result is not None
        assert "確認" in result or "不確定" in result

    def test_detect_will_get_back(self):
        """Should detect 'I'll get back to you' phrases."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("I'll get back to you with the details.")
        assert result is not None

    def test_no_detection_for_normal_response(self):
        """Should not detect honesty indicators in normal responses."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("I agree with your proposal.")
        assert result is None

        result = detect_honesty_response("The price is $45 per unit.")
        assert result is None

    def test_case_insensitive_detection(self):
        """Detection should be case insensitive."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("I DON'T KNOW about that.")
        assert result is not None

    def test_empty_utterance(self):
        """Empty utterance should return None."""
        from src.backend.controller import detect_honesty_response

        result = detect_honesty_response("")
        assert result is None

        result = detect_honesty_response(None)
        assert result is None

    @pytest.mark.asyncio
    async def test_honesty_note_added_to_response(self):
        """Honesty note should be added to controller response."""
        from src.backend.controller import generate_controller_response

        mock_response = {
            "id": "resp_test",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps({
                                "decision": "continue",
                                "next_english_utterance": "I don't know the specific terms.",
                                "memory_update": "User asked about terms",
                                "notes_for_user": None
                            })
                        }
                    ]
                }
            ]
        }

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test_key"}):
            with patch("src.backend.controller.httpx.AsyncClient") as mock_client:
                mock_response_obj = MagicMock()
                mock_response_obj.status_code = 200
                mock_response_obj.json.return_value = mock_response
                mock_response_obj.raise_for_status = MagicMock()

                mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                    return_value=mock_response_obj
                )

                request = ControllerRequest(
                    directive="CONTINUE",
                    pinned_context="Goal",
                    memory="",
                    latest_turns=[]
                )

                response = await generate_controller_response(request)

                # Should have honesty note added
                assert response.notes_for_user is not None
                assert "不確定" in response.notes_for_user


# =============================================================================
# Run tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
