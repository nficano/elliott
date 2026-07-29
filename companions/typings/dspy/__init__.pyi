# Minimal stubs for the DSPy 3.2.1 surface used by the Elliott companion.
# Real DSPy installs from companions/dspy/pyproject.toml (image + local uv sync);
# these stubs keep basedpyright useful when that venv is not the active interpreter.
from collections.abc import Callable
from typing import Any

Example: Any
LM: Any
Signature: Any
InputField: Callable[..., Any]
OutputField: Callable[..., Any]
Predict: Any
context: Callable[..., Any]
GEPA: Any
MIPROv2: Any
