"""
Glossary Module - 領域詞庫模組

Reference:
- spec/research/glossary_integration_design.md
- spec/research/uk_domain_glossaries.json

Provides domain-specific terminology hints for translation API.
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Load glossaries at module import
_GLOSSARIES: dict = {}
_GLOSSARY_LOADED = False


def _load_glossaries():
    """Load domain glossaries from JSON file."""
    global _GLOSSARIES, _GLOSSARY_LOADED

    if _GLOSSARY_LOADED:
        return

    # Find glossary file (relative to this module)
    glossary_path = Path(__file__).parent / "domain_glossaries.json"

    if not glossary_path.exists():
        logger.warning(f"Glossary file not found: {glossary_path}")
        _GLOSSARY_LOADED = True
        return

    try:
        with open(glossary_path, "r", encoding="utf-8") as f:
            _GLOSSARIES = json.load(f)
        logger.info(f"Loaded glossaries: {list(_GLOSSARIES.keys())}")
        _GLOSSARY_LOADED = True
    except Exception as e:
        logger.error(f"Failed to load glossaries: {e}")
        _GLOSSARY_LOADED = True


def get_glossary_hint(text: str, scenario: Optional[str] = None, max_hints: int = 5) -> str:
    """
    Find matching glossary terms in source text and return hints.

    Args:
        text: English source text to analyze
        scenario: Domain scenario (bank, nhs, utilities, insurance)
        max_hints: Maximum number of hints to return

    Returns:
        Formatted hint string for translation prompt, or empty string
    """
    _load_glossaries()

    if not scenario or scenario not in _GLOSSARIES:
        return ""

    scenario_data = _GLOSSARIES.get(scenario, {})
    terms = scenario_data.get("terms", {})

    if not terms:
        return ""

    text_lower = text.lower()
    matches = []

    # Find matching terms (longer terms first to avoid partial matches)
    sorted_terms = sorted(terms.keys(), key=len, reverse=True)
    matched_positions = set()  # Track matched positions to avoid overlaps

    for term in sorted_terms:
        term_lower = term.lower()
        pos = text_lower.find(term_lower)

        if pos != -1:
            # Check if this position overlaps with already matched terms
            term_range = set(range(pos, pos + len(term)))
            if not term_range & matched_positions:
                info = terms[term]
                zh = info.get("zh", "")
                if zh:
                    matches.append(f'"{term}" = "{zh}"')
                    matched_positions.update(term_range)

                    if len(matches) >= max_hints:
                        break

    if not matches:
        return ""

    return "Key terms: " + ", ".join(matches)


def get_scenario_context(scenario: Optional[str] = None) -> str:
    """
    Get scenario context description for translation prompt.

    Args:
        scenario: Domain scenario

    Returns:
        Context description string
    """
    _load_glossaries()

    if not scenario or scenario not in _GLOSSARIES:
        return ""

    description = _GLOSSARIES.get(scenario, {}).get("description", "")
    return f"Context: {description}" if description else ""


def post_process_translation(text: str, scenario: Optional[str] = None) -> str:
    """
    Apply scenario-specific post-processing corrections.

    Critical term replacements that must be correct regardless of context.

    Args:
        text: Translated Chinese text
        scenario: Domain scenario

    Returns:
        Corrected translation
    """
    import re

    # NHS-specific: "surgery" means clinic, not operation
    if scenario == "nhs":
        # If translation contains 手術 but context suggests it means clinic
        # This is tricky - we can't blindly replace. Leave as-is for now.
        pass

    # Future: Add more scenario-specific corrections

    return text


# Pre-load glossaries on import
_load_glossaries()
