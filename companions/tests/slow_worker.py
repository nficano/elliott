from __future__ import annotations

import time
from typing import Any


def optimize(request: dict[str, Any]) -> dict[str, Any]:
    time.sleep(0.2)
    return {
        "runId": request["run"]["id"],
        "candidates": [],
        "paused": False,
    }
