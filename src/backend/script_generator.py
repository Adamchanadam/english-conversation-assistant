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

# Default prompts for each scenario (used when user input is empty)
# Each scenario has multiple common use cases
DEFAULT_PROMPTS = {
    "bank": {
        "primary": "我想查詢帳戶餘額和最近的交易記錄",
        "options": [
            {"label": "查詢餘額", "prompt": "我想查詢帳戶餘額和最近的交易記錄"},
            {"label": "不明收費", "prompt": "我想詢問帳戶上一筆不明的收費是什麼"},
            {"label": "更新資料", "prompt": "我想更新我的地址和電話號碼"},
            {"label": "開戶咨詢", "prompt": "我想了解開立新帳戶需要什麼文件"},
            {"label": "轉帳問題", "prompt": "我想查詢一筆轉帳為什麼還沒到帳"}
        ]
    },
    "nhs": {
        "primary": "我想預約看 GP 的時間",
        "options": [
            {"label": "預約 GP", "prompt": "我想預約看 GP 的時間"},
            {"label": "領處方簽", "prompt": "我想詢問我的處方簽是否可以領取"},
            {"label": "轉診進度", "prompt": "我想查詢專科轉診的進度"},
            {"label": "檢驗結果", "prompt": "我想詢問上次檢驗的結果出來了嗎"},
            {"label": "取消預約", "prompt": "我想取消或更改我的預約時間"}
        ]
    },
    "utilities": {
        "primary": "我想查詢最新的帳單金額",
        "options": [
            {"label": "查帳單", "prompt": "我想查詢最新的帳單金額"},
            {"label": "更新付款", "prompt": "我想更新 Direct Debit 的銀行資料"},
            {"label": "報讀數", "prompt": "我想報告電錶/瓦斯表的讀數"},
            {"label": "換方案", "prompt": "我想了解有沒有更優惠的方案"},
            {"label": "搬家通知", "prompt": "我下個月要搬家，想通知更新地址"}
        ]
    },
    "insurance": {
        "primary": "我想了解我的保單涵蓋範圍",
        "options": [
            {"label": "保障範圍", "prompt": "我想了解我的保單涵蓋範圍"},
            {"label": "提出理賠", "prompt": "我想提出一個理賠申請"},
            {"label": "續約保費", "prompt": "我想詢問保費續約的金額"},
            {"label": "更改資料", "prompt": "我想更改保單上的個人資料"},
            {"label": "取消保單", "prompt": "我想了解取消保單的流程"}
        ]
    },
    "general": {
        "primary": "您好，我想詢問一些事情",
        "options": [
            {"label": "一般詢問", "prompt": "您好，我想詢問一些事情"},
            {"label": "確認狀態", "prompt": "我想確認我的預約/訂單狀態"},
            {"label": "客服轉接", "prompt": "請問可以幫我轉接客服部門嗎"},
            {"label": "投訴反映", "prompt": "我想反映一個問題"},
            {"label": "感謝結束", "prompt": "好的，謝謝你的幫忙，再見"}
        ]
    }
}


def get_default_prompt(scenario: str) -> str:
    """Get the primary default prompt for a scenario."""
    return DEFAULT_PROMPTS.get(scenario, DEFAULT_PROMPTS["general"])["primary"]


def get_scenario_options(scenario: str) -> list:
    """Get all default prompt options for a scenario."""
    return DEFAULT_PROMPTS.get(scenario, DEFAULT_PROMPTS["general"])["options"]

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
        chinese_input: What the user wants to say in Chinese (if empty, uses scenario default)
        scenario: Optional scenario type
        conversation_history: Optional conversation context
        tone: Desired tone

    Yields:
        SSE-formatted strings
    """
    client = OpenAI()

    # Use default prompt if input is empty
    actual_input = chinese_input.strip() if chinese_input else ""
    if not actual_input:
        actual_input = get_default_prompt(scenario or "general")
        # Notify frontend that we're using a default prompt
        yield f"data: {json.dumps({'type': 'using_default', 'prompt': actual_input})}\n\n"

    prompt = build_script_prompt(
        chinese_input=actual_input,
        scenario=scenario,
        conversation_history=conversation_history,
        tone=tone
    )

    try:
        # First, generate the main script with streaming
        # Note: gpt-5-mini is a reasoning model, max_completion_tokens includes
        # both reasoning tokens + output tokens, so we need a higher budget
        stream = client.chat.completions.create(
            model=SCRIPT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Generate a natural English script for the user to say in a phone call. Just output the English script directly, no JSON, no explanations."
                },
                {
                    "role": "user",
                    "content": f"Convert this to natural spoken English ({tone} tone):\n\n{actual_input}"
                }
            ],
            max_completion_tokens=1000,
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
        # Note: gpt-5-mini reasoning model needs higher token budget
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
            max_completion_tokens=500,
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
