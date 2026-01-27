"""
Pytest configuration for Voice Proxy Negotiator tests.
"""

import pytest

# Configure pytest-asyncio mode
pytest_plugins = ('pytest_asyncio',)


@pytest.fixture
def sample_pinned_context():
    """Sample pinned context for testing."""
    return """Goal: Negotiate 10% discount on bulk order
Rules:
- Cannot accept payment terms longer than Net 60
- Minimum order: 500 units
- Target delivery: March 2025

SSOT Summary:
- Current price: $45/unit
- Competitor quote: $42/unit
- Previous volume discount: 5% for 1000+ units"""


@pytest.fixture
def sample_memory():
    """Sample rolling memory for testing."""
    return """Agreed:
- Delivery date: March 15, 2025
- Payment terms: Net 45

Pending:
- Price per unit (currently discussing)
- Volume discount threshold

Counterpart conditions:
- Wants exclusive distribution rights
- Requests 2-year contract minimum"""


@pytest.fixture
def sample_latest_turns():
    """Sample latest conversation turns for testing."""
    return [
        "Human: What's the best price you can offer for 800 units?",
        "Assistant: For 800 units, we can offer $43 per unit with standard Net 45 terms.",
        "Human: That's still a bit high. Can you do $40?"
    ]
