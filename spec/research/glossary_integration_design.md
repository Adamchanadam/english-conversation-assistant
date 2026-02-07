# Glossary Integration Design

## Overview

Integrate domain-specific glossaries into the real-time translation pipeline to improve translation quality for UK-specific terms.

## Current Architecture

```
English Audio → Web Speech → SmartSegmenter → /api/translate/stream → Chinese Translation
                                                      ↓
                                              gpt-4.1-nano
                                              (no context)
```

## Proposed Architecture

```
English Audio → Web Speech → SmartSegmenter → /api/translate/stream → Chinese Translation
                                                      ↓
                                              gpt-4.1-nano
                                              + Glossary Context
                                              + Scenario Hint
```

## Design Options

### Option A: Prompt Injection (Recommended)

Inject relevant glossary terms into the translation prompt based on detected keywords.

**Pros:**
- No additional API calls
- Low latency impact
- Flexible and adaptive

**Cons:**
- Slightly longer prompts
- May not catch all terms

**Implementation:**

```python
# In main.py

def build_translation_prompt(text: str, scenario: str = None, glossary: dict = None):
    """Build translation prompt with optional glossary context."""

    base_prompt = "Translate the following English to Traditional Chinese (Hong Kong style)."

    # Add glossary hint if scenario provided
    glossary_hint = ""
    if scenario and glossary:
        scenario_glossary = glossary.get(scenario, {}).get("terms", {})
        # Find matching terms in source text
        matching_terms = []
        text_lower = text.lower()
        for term, translation in scenario_glossary.items():
            if term.lower() in text_lower:
                matching_terms.append(f'"{term}" → "{translation["zh"]}"')

        if matching_terms:
            glossary_hint = f"\n\nTerminology hints:\n" + "\n".join(matching_terms[:5])

    return f"{base_prompt}{glossary_hint}\n\nEnglish: {text}\nChinese:"
```

### Option B: Two-Pass Translation

First pass identifies key terms, second pass translates with context.

**Pros:**
- More accurate term detection
- Can validate translations

**Cons:**
- 2x latency (unacceptable for real-time)
- Higher API cost

**Decision: Rejected for real-time use case**

### Option C: Post-Processing Replacement

Translate first, then replace terms from glossary.

**Pros:**
- Simple implementation
- Guaranteed correct terms

**Cons:**
- May break sentence flow
- Context-insensitive replacements

**Decision: Can be used as fallback for high-priority terms**

## Recommended Implementation (Option A + C Hybrid)

### Backend Changes (`main.py`)

```python
import json
from pathlib import Path

# Load glossaries at startup
GLOSSARY_PATH = Path(__file__).parent.parent.parent / "spec/research/uk_domain_glossaries.json"
with open(GLOSSARY_PATH, "r", encoding="utf-8") as f:
    DOMAIN_GLOSSARIES = json.load(f)

def find_glossary_hints(text: str, scenario: str) -> str:
    """Find matching glossary terms in source text."""
    if not scenario or scenario not in DOMAIN_GLOSSARIES:
        return ""

    terms = DOMAIN_GLOSSARIES[scenario].get("terms", {})
    text_lower = text.lower()

    matches = []
    for term, info in terms.items():
        if term.lower() in text_lower:
            matches.append(f'"{term}" = "{info["zh"]}"')

    if not matches:
        return ""

    return "Key terms: " + ", ".join(matches[:5])


@app.get("/api/translate/stream")
async def translate_stream(text: str, scenario: str = None):
    """Stream translation with glossary support."""

    glossary_hint = find_glossary_hints(text, scenario)

    system_prompt = """You are a real-time translator. Translate English to Traditional Chinese (Hong Kong style).
Rules:
- Keep it natural and conversational
- Preserve numbers, dates, and amounts exactly
- Use 賬戶 not 账户, 餘額 not 余额"""

    if glossary_hint:
        system_prompt += f"\n\n{glossary_hint}"

    # ... rest of streaming logic
```

### Frontend Changes (`eca_parallel_test.html`)

```javascript
// Pass scenario to translation API
async function sendToTranslate(segment) {
    const scenario = document.getElementById('scenarioSelect')?.value || 'general';

    const url = `/api/translate/stream?text=${encodeURIComponent(segment.text)}&scenario=${encodeURIComponent(scenario)}`;

    const response = await fetch(url);
    // ... handle streaming response
}
```

### API Changes

Update `/api/translate/stream` to accept `scenario` parameter:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Yes | English text to translate |
| scenario | string | No | Domain scenario (bank, nhs, utilities, insurance, general) |

## High-Priority Term Post-Processing

For critical terms that must be translated correctly, add post-processing:

```python
# Critical term replacements (always apply)
CRITICAL_REPLACEMENTS = {
    "excess": "墊底費",  # Never translate as "超額"
    "no-claims bonus": "無索償折扣",  # Never translate as "無理賠獎金"
    "direct debit": "自動轉賬",  # Never translate as "直接借記"
    "surgery": "診所",  # In NHS context, never translate as "手術"
}

def post_process_translation(text: str, scenario: str) -> str:
    """Apply critical term corrections."""
    if scenario == "nhs":
        # In NHS context, "surgery" means clinic
        text = re.sub(r'手術(?!室)', '診所', text)

    # Add more scenario-specific corrections...
    return text
```

## Testing Plan

### Test Cases

1. **Banking scenario**
   - Input: "I need to check my direct debit for the standing order"
   - Expected: Contains "自動轉賬" and "定期轉賬"

2. **NHS scenario**
   - Input: "I'd like to book an appointment at the surgery"
   - Expected: "診所" not "手術"

3. **Insurance scenario**
   - Input: "What's my excess and will this affect my no-claims?"
   - Expected: Contains "墊底費" and "無索償折扣"

4. **No scenario (general)**
   - Input: Same as above
   - Expected: Still reasonable translation, may not use exact terms

### A/B Testing

Compare translation quality with and without glossary:

```python
# Log for analysis
logger.info(f"Translation | scenario={scenario} | glossary_used={bool(glossary_hint)} | source={text[:50]}... | result={translation[:50]}...")
```

## Performance Considerations

| Metric | Without Glossary | With Glossary |
|--------|-----------------|---------------|
| Prompt tokens | ~50 | ~80 (+30 for hints) |
| First token latency | 703ms | ~750ms (est.) |
| Cost per 1K translations | $X | ~$X × 1.1 |

The additional latency (~50ms) and cost (~10%) are acceptable for improved accuracy.

## Rollout Plan

1. **Phase 1**: Add glossary lookup to backend (no-op if no scenario)
2. **Phase 2**: Update frontend to pass scenario parameter
3. **Phase 3**: Add critical term post-processing
4. **Phase 4**: Monitor and tune glossary terms based on user feedback

## File Changes Summary

| File | Changes |
|------|---------|
| `src/backend/main.py` | Add glossary loading, prompt building, post-processing |
| `src/frontend/eca_parallel_test.html` | Pass scenario to API |
| `spec/research/uk_domain_glossaries.json` | Glossary data (created) |

---

*Design completed: 2026-02-06*
