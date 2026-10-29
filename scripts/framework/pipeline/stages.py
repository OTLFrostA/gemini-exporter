"""
Pipeline Stage Definitions and Invariant State Machine for Gemini Actions.
Enforces strictly one direction of state transitions:
IDLE -> STAGED -> DISPATCHED -> STREAMING -> SETTLED -> COOLDOWN -> IDLE
"""

from enum import Enum, auto
from typing import Set


class PipelineStage(Enum):
    IDLE = auto()
    STAGED = auto()
    DISPATCHED = auto()
    STREAMING = auto()
    SETTLED = auto()
    COOLDOWN = auto()


class PipelineConcurrencyViolationError(RuntimeError):
    """Raised when an action violates state machine invariants (e.g. attempting to stage prompt while streaming)."""
    pass


class CircuitBreakerError(RuntimeError):
    """Raised when the fail-fast circuit breaker halts the pipeline on unrecoverable errors."""
    pass
