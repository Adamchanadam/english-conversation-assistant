"""
Script Generator Module - 講稿生成模組

Reference:
- design.md § 5 (講稿生成模組)
- CLAUDE.md § 模型硬性規則 (gpt-5-mini for text controller)

Uses gpt-5-mini to generate English scripts from Chinese input.
"""

import os
import json
import logging
from typing import Generator, Optional

from openai import OpenAI

# Configure logging
logger = logging.getLogger(__name__)

# Model configuration (CLAUDE.md § 模型硬性規則)
SCRIPT_MODEL = "gpt-5-mini"

# Scenario-specific guidance
SCENARIO_GUIDANCE = {
    "bank": {
        "context": "Banking/financial services call",
        "common_terms": ["account", "balance", "transaction", "statement", "charge", "fee", "transfer"],
        "tone_hint": "Professional and clear"
    },
    "nhs": {
        "context": "NHS/GP medical appointment",
        "common_terms": ["appointment", "prescription", "symptoms", "referral", "doctor", "surgery"],
        "tone_hint": "Polite and patient"
    },
    "utilities": {
        "context": "Utility company (gas, electric, water) customer service",
        "common_terms": ["bill", "meter reading", "tariff", "direct debit", "account number"],
        "tone_hint": "Clear and straightforward"
    },
    "insurance": {
        "context": "Insurance claim or inquiry",
        "common_terms": ["policy", "claim", "excess", "cover", "premium", "renewal"],
        "tone_hint": "Detailed and precise"
    },
    "general": {
        "context": "General phone conversation",
        "common_terms": [],
        "tone_hint": "Natural and conversational"
    }
}

TONE_INSTRUCTIONS = {
    "polite": "Use polite expressions like 'Could you please...', 'I'd like to...', 'Would it be possible...'",
    "formal": "Use formal language suitable for official communications",
    "casual": "Use natural, conversational English",
    "assertive": "Be direct and clear while remaining respectful"
}


def build_script_prompt(
    chinese_input: str,
    scenario: Optional[str] = None,
    conversation_history: list = None,
    tone: str = "polite"
) -> str:
    """
    Build the prompt for script generation.

    Args:
        chinese_input: What the user wants to say in Chinese
        scenario: Optional scenario type (bank, nhs, utilities, insurance, general)
        conversation_history: Optional list of recent conversation turns
        tone: Desired tone (polite, formal, casual, assertive)

    Returns:
        Formatted prompt string
    """
    # Get scenario guidance
    scenario_info = SCENARIO_GUIDANCE.get(scenario or "general", SCENARIO_GUIDANCE["general"])
    tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["polite"])

    # Build conversation context
    context_str = ""
    if conversation_history:
        context_str = "\n\nRecent conversation:\n"
        for turn in conversation_history[-5:]:  # Max 5 turns
            role = "Them" if turn.get("role") == "them" else "Me"
            context_str += f"- {role}: {turn.get('text', '')}\n"

    prompt = f"""You are helping a non-native English speaker prepare what to say in a phone call.

TASK: Convert the user's Chinese input into natural, speakable English.

CONTEXT:
- Scenario: {scenario_info['context']}
- Tone: {tone_instruction}
{context_str}

USER WANTS TO SAY (in Chinese):
{chinese_input}

RULES:
1. Generate natural, conversational English that sounds good when spoken aloud
2. Keep it concise (1-3 sentences for the main script)
3. Provide 2 alternative phrasings
4. If there are difficult words, provide pronunciation tips in IPA
5. Use British English spelling (colour, centre, etc.)

OUTPUT FORMAT (JSON):
{{
  "english_script": "Main script the user should say",
  "alternatives": ["Alternative 1", "Alternative 2"],
  "pronunciation_tips": [
    {{"word": "example", "ipa": "/ɪɡˈzɑːmpl/"}}
  ]
}}

Generate the JSON response:"""

    return prompt


def generate_script(
    chinese_input: str,
    scenario: Optional[str] = None,
    conversation_history: list = None,
    tone: str = "polite"
) -> dict:
    """
    Generate English script from Chinese input.

    Args:
        chinese_input: What the user wants to say in Chinese
        scenario: Optional scenario type
        conversation_history: Optional conversation context
        tone: Desired tone

    Returns:
        Dict with english_script, alternatives, pronunciation_tips
    """
    client = OpenAI()

    prompt = build_script_prompt(
        chinese_input=chinese_input,
        scenario=scenario,
        conversation_history=conversation_history,
        tone=tone
    )

    try:
        response = client.chat.completions.create(
            model=SCRIPT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that generates natural English scripts for phone conversations. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_completion_tokens=500,
            reasoning_effort="low",
            response_format={"type": "json_object"}
        )

        result_text = response.choices[0].message.content
        result = json.loads(result_text)

        # Validate and sanitize response
        return {
            "english_script": result.get("english_script", ""),
            "alternatives": result.get("alternatives", [])[:2],  # Max 2 alternatives
            "pronunciation_tips": result.get("pronunciation_tips", [])[:5]  # Max 5 tips
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse script response: {e}")
        return {
            "english_script": "",
            "alternatives": [],
            "pronunciation_tips": [],
            "error": "Failed to generate script"
        }
    except Exception as e:
        logger.error(f"Script generation error: {e}")
        return {
            "english_script": "",
            "alternatives": [],
            "pronunciation_tips": [],
            "error": str(e)
        }


def generate_script_stream(
    chinese_input: str,
    scenario: Optional[str] = None,
    conversation_history: list = None,
    tone: str = "polite"
) -> Generator[str, None, None]:
    """
    Generate English script with streaming output.

    Yields SSE-formatted events for real-time display.

    Args:
        chinese_input: What the user wants to say in Chinese
        scenario: Optional scenario type
        conversation_history: Optional conversation context
        tone: Desired tone

    Yields:
        SSE-formatted strings
    """
    client = OpenAI()

    prompt = build_script_prompt(
        chinese_input=chinese_input,
        scenario=scenario,
        conversation_history=conversation_history,
        tone=tone
    )

    try:
        # First, generate the main script with streaming
        stream = client.chat.completions.create(
            model=SCRIPT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Generate a natural English script for the user to say in a phone call. Just output the English script directly, no JSON, no explanations."
                },
                {
                    "role": "user",
                    "content": f"Convert this to natural spoken English ({tone} tone):\n\n{chinese_input}"
                }
            ],
            max_completion_tokens=200,
            reasoning_effort="low",
            stream=True
        )

        full_script = ""
        for chunk in stream:
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                full_script += text
                yield f"data: {json.dumps({'type': 'script_delta', 'text': text})}\n\n"

        # Signal main script complete
        yield f"data: {json.dumps({'type': 'script_done', 'text': full_script})}\n\n"

        # Now generate alternatives (non-streaming for simplicity)
        alt_response = client.chat.completions.create(
            model=SCRIPT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Generate 2 alternative ways to say the same thing. Output as JSON array: [\"alt1\", \"alt2\"]"
                },
                {
                    "role": "user",
                    "content": f"Original: {full_script}\n\nGenerate 2 alternatives:"
                }
            ],
            max_completion_tokens=200,
            reasoning_effort="low",
            response_format={"type": "json_object"}
        )

        try:
            alt_text = alt_response.choices[0].message.content
            # Handle both array and object formats
            alt_data = json.loads(alt_text)
            if isinstance(alt_data, list):
                alternatives = alt_data[:2]
            elif isinstance(alt_data, dict):
                alternatives = alt_data.get("alternatives", [])[:2]
            else:
                alternatives = []
        except:
            alternatives = []

        yield f"data: {json.dumps({'type': 'alternatives', 'alternatives': alternatives})}\n\n"

        # Final done event
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        logger.error(f"Script stream error: {e}")
        yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
