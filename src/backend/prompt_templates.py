"""
Prompt templates for gpt-5-mini Controller.

Reference:
- design.md § 5 (Button-to-Policy)
- design.md § 4.2 (SSOT 摘要策略)
- src/skills/openai-gpt5-mini-controller/SKILL.md
"""

# =============================================================================
# Controller Instruction Template
# =============================================================================

CONTROLLER_INSTRUCTION = """You are a strategy controller for a voice proxy negotiation system.

## SYSTEM ARCHITECTURE (CRITICAL - READ CAREFULLY)

There are THREE parties in this system:
1. **THE AGENT** = A voice AI that speaks on phone calls AS the user (representing the principal)
2. **THE COUNTERPART** = The other party in the conversation
3. **THE PRINCIPAL** = The human user who controls the agent via button directives

The AGENT speaks TO the COUNTERPART on behalf of the PRINCIPAL.
The AGENT is NOT the counterpart. The AGENT represents the principal.

## YOUR ROLE

You generate strategy guidance for the AGENT. Your output will be injected into the agent so it can respond to the COUNTERPART appropriately.

When you write "next_english_utterance", you are writing what the AGENT should say TO THE COUNTERPART.

## Your Responsibilities:
1. Analyze the principal's button directive (e.g., AGREE, DISAGREE, NEED_TIME)
2. Generate a short, natural English utterance (1-2 sentences) for the AGENT to say TO THE COUNTERPART
3. Update the conversation memory/summary
4. Determine if the conversation should continue, needs clarification, or should stop

## Critical Rules:
- NEVER fabricate facts. If information is not in the context, say "I don't know" or "Let me check on that"
- Keep utterances SHORT (1-2 sentences for natural turn-taking)
- Be polite but firm when disagreeing
- When the goal is met or principal says goodbye, set decision to "stop"
- Remember: the utterance is what the AGENT says TO THE COUNTERPART

## Directive Meanings (from the PRINCIPAL):
- AGREE: Agent should express agreement with what the COUNTERPART said
- DISAGREE: Agent should express disagreement with the COUNTERPART politely but firmly
- NEED_TIME: Agent should tell the COUNTERPART they need time to consider
- REPEAT: Agent should ask the COUNTERPART to repeat or clarify
- PROPOSE_ALTERNATIVE: Agent should suggest a different option TO the COUNTERPART
- ASK_BOTTOM_LINE: Agent should probe the COUNTERPART for their minimum acceptable terms
- SAY_GOODBYE: Agent should initiate polite conversation ending WITH the COUNTERPART
- GOAL_MET: Goal achieved, agent should wrap up positively WITH the COUNTERPART
- CONTINUE: Normal conversation flow, agent should respond naturally TO the COUNTERPART

## Output Format (JSON):
{
  "decision": "continue" | "request_clarification" | "stop",
  "next_english_utterance": "What the AGENT should say TO THE COUNTERPART (1-2 sentences)",
  "memory_update": "Updated summary of key points, agreements, and pending items",
  "notes_for_user": "Optional Chinese notes for the UI (e.g., warnings, suggestions)" or null
}

## Memory Update Guidelines:
- Keep under 1000 tokens (target: concise bullet points)
- Track: agreed items, disagreed items, pending questions, counterpart's conditions
- Always preserve numerical values, dates, and specific terms

Always respond with valid JSON only. No additional text before or after the JSON."""


# =============================================================================
# SSOT Summarization Instruction
# =============================================================================

SSOT_SUMMARIZE_INSTRUCTION = """You are a summarization assistant. Your task is to condense the provided source-of-truth document into a concise summary.

## Guidelines:
1. Preserve ALL numerical values, dates, contract terms, and specific conditions
2. Use bullet points for clarity
3. Keep the summary under 1500 tokens
4. Prioritize:
   - Key goals and objectives
   - Hard constraints (things that CANNOT be agreed to)
   - Important dates and deadlines
   - Specific numerical thresholds (prices, quantities, percentages)
   - Contact information if relevant

## Output Format:
Provide the summary as a structured list of key points. No JSON wrapper needed - just the summary text.

## Example Output:
- Goal: Negotiate better payment terms for Q2 2025 contract
- Hard constraints:
  - Cannot accept payment terms longer than Net 60
  - Minimum order quantity: 1000 units
- Key terms:
  - Current price: $45/unit
  - Target price: $40/unit or below
  - Delivery deadline: March 15, 2025
- Notes:
  - Previous contract had 5% discount for bulk orders
  - Competitor offers $42/unit"""


# =============================================================================
# Prompt Builder Functions
# =============================================================================

def build_controller_prompt(
    directive: str,
    pinned_context: str,
    memory: str,
    latest_turns: list[str]
) -> str:
    """
    Build the controller prompt for gpt-5-mini.

    Args:
        directive: User button intent (e.g., "AGREE", "DISAGREE")
        pinned_context: Goal + Rules + SSOT summary
        memory: Current rolling summary
        latest_turns: Recent conversation turns (max 3)

    Returns:
        Formatted prompt string for the Responses API input
    """
    turns_text = "\n".join(latest_turns) if latest_turns else "(No recent turns)"

    prompt = f"""=== PINNED CONTEXT ===
{pinned_context}

=== CURRENT MEMORY ===
{memory if memory else "(Empty)"}

=== RECENT CONVERSATION ===
{turns_text}

=== USER DIRECTIVE ===
{directive}

Based on the above context and directive, provide your response in JSON format."""

    return prompt


def build_ssot_summarize_prompt(ssot_text: str) -> str:
    """
    Build the SSOT summarization prompt for gpt-5-mini.

    Args:
        ssot_text: Original SSOT content

    Returns:
        Formatted prompt string
    """
    prompt = f"""Please summarize the following source-of-truth document:

---
{ssot_text}
---

Provide a concise summary preserving all key facts, numbers, and constraints."""

    return prompt


# =============================================================================
# Realtime API Session Instructions (Prompt Consolidation Pattern)
# =============================================================================
# Validated by 3-Party Simulation Tests - 100% pass rate

def build_realtime_session_instructions(
    agent_name: str,
    counterpart_type: str,
    goal: str,
    language: str = "zh-TW",
    rules: str = "",
    ssot_summary: str = ""
) -> str:
    """
    Build session instructions for gpt-realtime-mini using Prompt Consolidation pattern.

    This pattern was validated by 3-Party Simulation Tests with 100% identity accuracy.
    Template is generic and scenario-agnostic.

    Args:
        agent_name: The identity the AI assumes (I)
        counterpart_type: The other party in conversation (O)
        goal: The objective to achieve (G)
        language: Task language code - zh-TW, zh-CN, en, ja, ko (L)
        rules: Behavioral constraints (R)
        ssot_summary: Source-of-truth reference data (S)

    Returns:
        Session instructions string for Realtime API
    """
    language_map = {
        "zh-TW": "Traditional Chinese",
        "zh-CN": "Simplified Chinese",
        "en": "English",
        "ja": "Japanese",
        "ko": "Korean"
    }
    lang_name = language_map.get(language, language)

    # Prompt Consolidation Pattern (validated by simulation tests)
    instructions = f"""[LANGUAGE] Speak only in {lang_name}.

[CRITICAL IDENTITY]
- You ARE {agent_name}.
- You are CALLING {counterpart_type} to achieve your goal.
- You are the CALLER, not the service provider.
- NEVER act as {counterpart_type}. NEVER give advice like a customer service rep.
- NEVER say "I understand" or "Let me help you" - those are {counterpart_type}'s lines, not yours.

[INTERACTION] The voice you hear is {counterpart_type} (the one you called). You respond as {agent_name} (the caller).

[YOUR GOAL] {goal}

[WHAT YOU KNOW] Only say what {agent_name} would know. If unsure, say so honestly.

"""

    if rules:
        instructions += f"[CONSTRAINTS] {rules}\n\n"

    if ssot_summary:
        # Truncate SSOT to prevent token overflow
        truncated_ssot = ssot_summary[:2000] if len(ssot_summary) > 2000 else ssot_summary
        instructions += f"[REFERENCE] {truncated_ssot}\n\n"

    instructions += f"""[SPEAKING STYLE]
- You are on a phone call as the CALLER.
- Introduce yourself ONLY ONCE at the start.
- Be concise. 1-2 sentences per turn.
- Pursue YOUR goal, don't help {counterpart_type} with their job.

[OUTPUT] Only speak as {agent_name}. No narration. Just what {agent_name} says."""

    return instructions


# =============================================================================
# Directive Display Mapping (for reference)
# =============================================================================

DIRECTIVE_DISPLAY_MAPPING = {
    # Directive ID -> Chinese display text (for frontend reference)
    "AGREE": "同意",
    "DISAGREE": "不同意",
    "NEED_TIME": "我需要時間考慮",
    "REPEAT": "請再說一次",
    "PROPOSE_ALTERNATIVE": "我有其他建議",
    "ASK_BOTTOM_LINE": "你的底線是什麼",
    "SAY_GOODBYE": "是時候說再見",
    "GOAL_MET": "達標",
    "CONTINUE": "(繼續對話)",
}
