"""
Test script for /api/translate endpoint.

Verifies:
1. API response structure from OpenAI Responses API
2. Correct parsing of translation text
3. Backend endpoint integration
"""

import asyncio
import json
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import httpx
from dotenv import load_dotenv

load_dotenv()

CONTROLLER_MODEL = "gpt-5-mini-2025-08-07"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


async def test_openai_responses_api():
    """Test OpenAI Responses API directly to verify response format."""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not configured")
        return False

    translation_instructions = """You are a translation machine. Your sole function is to translate English text to Traditional Chinese (Hong Kong style, 繁體中文).

CRITICAL RULES:
- Output ONLY the Chinese translation, nothing else.
- Do NOT add greetings, explanations, or commentary.
- Use Traditional Chinese characters (繁體字), NOT Simplified Chinese (简体字)."""

    test_text = "Hello, how are you today?"

    print(f"\n=== Test 1: OpenAI Responses API Direct Call ===")
    print(f"Model: {CONTROLLER_MODEL}")
    print(f"Input: {test_text}")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": CONTROLLER_MODEL,
                    "instructions": translation_instructions,
                    "input": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "input_text", "text": test_text}
                            ]
                        }
                    ],
                    "max_output_tokens": 500,
                },
                timeout=30.0,
            )

            print(f"\nHTTP Status: {response.status_code}")

            if response.status_code != 200:
                print(f"ERROR: {response.text}")
                return False

            data = response.json()

            # Log response keys
            print(f"\n--- Response Structure ---")
            print(f"Top-level keys: {list(data.keys())}")

            if "output" in data:
                print(f"Output count: {len(data['output'])}")
                for i, item in enumerate(data["output"]):
                    print(f"\nOutput[{i}]:")
                    print(f"  type: {item.get('type')}")

                    if "content" in item:
                        print(f"  content count: {len(item['content'])}")
                        for j, content_item in enumerate(item["content"]):
                            print(f"    Content[{j}]:")
                            print(f"      type: {content_item.get('type')}")
                            if "text" in content_item:
                                print(f"      text: {content_item['text']}")

            # Extract translation using backend logic
            translation_text = ""
            if "output" in data and len(data["output"]) > 0:
                for item in data["output"]:
                    if item.get("type") == "message" and "content" in item:
                        for content_item in item["content"]:
                            if content_item.get("type") == "output_text":
                                translation_text += content_item.get("text", "")
                            elif content_item.get("type") == "text":
                                translation_text += content_item.get("text", "")

            print(f"\n--- Result ---")
            print(f"Extracted translation: {translation_text}")

            if translation_text:
                print("\n✅ TEST PASSED: Translation extracted successfully")
                return True
            else:
                print("\n❌ TEST FAILED: No translation extracted")
                return False

        except Exception as e:
            print(f"\nERROR: {e}")
            import traceback
            traceback.print_exc()
            return False


async def test_backend_translate_endpoint():
    """Test the /api/translate endpoint (requires server running)."""

    print(f"\n=== Test 2: Backend /api/translate Endpoint ===")

    test_cases = [
        "Hello, how are you today?",
        "The meeting is scheduled for next Monday at 3 PM.",
        "Jeffrey Epstein was a convicted American sex offender.",
    ]

    all_passed = True

    async with httpx.AsyncClient() as client:
        for test_text in test_cases:
            print(f"\nInput: {test_text}")
            try:
                response = await client.post(
                    "http://127.0.0.1:8000/api/translate",
                    json={"text": test_text},
                    timeout=30.0,
                )

                print(f"HTTP Status: {response.status_code}")

                data = response.json()
                print(f"Translation: {data.get('translation', 'N/A')}")
                print(f"Error: {data.get('error', 'None')}")

                if data.get("translation") and len(data["translation"]) > 0:
                    print("✅ PASS")
                else:
                    print(f"❌ FAIL: No translation returned")
                    all_passed = False

            except Exception as e:
                print(f"❌ FAIL: {e}")
                all_passed = False

    return all_passed


async def main():
    print("=" * 60)
    print("Translation API Regression Test")
    print("=" * 60)

    # Test 1: Direct OpenAI API call
    result1 = await test_openai_responses_api()

    # Test 2: Backend endpoint (requires server running)
    print("\n" + "=" * 60)
    print("Testing backend endpoint (server must be running)...")
    result2 = await test_backend_translate_endpoint()

    print("\n" + "=" * 60)
    print("REGRESSION TEST RESULTS:")
    print(f"  Test 1 (OpenAI Responses API): {'✅ PASS' if result1 else '❌ FAIL'}")
    print(f"  Test 2 (Backend Endpoint):     {'✅ PASS' if result2 else '❌ FAIL'}")
    print("=" * 60)

    return result1 and result2


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
