# scripts/framework/__init__.py
"""
Gemini Exporter Feature-Driven Testing Framework.
Provides declarative feature specifications, CDP action primitives, assertions, and test runner.
"""

from .features import Feature, FeatureDomain, FeatureRegistry, TestStatus, TestResult
from .actions import CDPActions
from .assertions import CDPAssertions
from .driver import GeminiDriver, GeminiChatSession, TurnResult

__all__ = [
    "Feature",
    "FeatureDomain",
    "FeatureRegistry",
    "TestStatus",
    "TestResult",
    "CDPActions",
    "CDPAssertions",
    "GeminiDriver",
    "GeminiChatSession",
    "TurnResult",
]

