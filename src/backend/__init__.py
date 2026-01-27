"""
Voice Proxy Negotiator Backend Package.

Modules:
- main: FastAPI application entry point
- controller: gpt-5-mini controller logic
- models: Pydantic data models
- prompt_templates: Instruction templates for gpt-5-mini
"""

from .models import (
    TokenRequest,
    TokenResponse,
    ControllerRequest,
    ControllerResponse,
    SummarizeSsotRequest,
    SummarizeSsotResponse,
    HealthResponse,
)

from .controller import (
    generate_controller_response,
    summarize_ssot,
    estimate_tokens,
    parse_controller_output,
    CONTROLLER_MODEL,
)

__all__ = [
    # Models
    "TokenRequest",
    "TokenResponse",
    "ControllerRequest",
    "ControllerResponse",
    "SummarizeSsotRequest",
    "SummarizeSsotResponse",
    "HealthResponse",
    # Controller functions
    "generate_controller_response",
    "summarize_ssot",
    "estimate_tokens",
    "parse_controller_output",
    "CONTROLLER_MODEL",
]
