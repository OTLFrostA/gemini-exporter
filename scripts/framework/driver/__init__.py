# scripts/framework/driver/__init__.py
"""
High-Level Gemini Automation Driver and Chat Session Abstractions.
Encapsulates all low-level CDP interactions, DOM selectors, atomic pipelines,
session lifecycle transitions, and turn evaluations into clean, declarative APIs.
"""

from .gemini_driver import GeminiDriver, GeminiChatSession, TurnResult

__all__ = [
    "GeminiDriver",
    "GeminiChatSession",
    "TurnResult"
]
