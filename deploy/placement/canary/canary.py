"""Snapshot-bound canary for evolution release promotion.

Called by the Elliott runtime at POST /v1/canary with the pending
EvolutionRelease. Verifies the live runtime is ready and can still complete a
real agent turn, then echoes the release's snapshotId with a pass verdict.

Limits, stated plainly: this canaries the RUNNING runtime at promotion time —
it does not stage the candidate release in an isolated runtime first. It
catches a runtime broken by earlier promotions or infrastructure drift, not a
defect introduced by the candidate itself; the evaluation report and human
proposal approval remain the gates for candidate quality.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RUNTIME = os.getenv("ELLIOTT_RUNTIME_URL", "http://elliott:8080").rstrip("/")
PORT = int(os.getenv("ELLIOTT_CANARY_PORT", "9080"))
MAX_REQUEST_BYTES = 1024 * 1024
HEALTH_TIMEOUT_SECONDS = 10.0
TURN_TIMEOUT_SECONDS = 150.0
SMOKE_PROMPT = "Deployment canary: reply with the single word OK."


def _runtime_ready() -> bool:
    try:
        with urllib.request.urlopen(
            RUNTIME + "/healthz",
            timeout=HEALTH_TIMEOUT_SECONDS,
        ) as response:
            health = json.loads(response.read())
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return False
    return isinstance(health, dict) and health.get("ready") is True


def _turn_completes() -> bool:
    request = urllib.request.Request(
        RUNTIME + "/v1/observability/map/send",
        data=json.dumps(
            {"text": SMOKE_PROMPT, "sender": "evolution-canary"},
        ).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=TURN_TIMEOUT_SECONDS,
        ) as response:
            value = json.loads(response.read())
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return False
    answer = value.get("answer") if isinstance(value, dict) else None
    return isinstance(answer, str) and bool(answer.strip()) and "timed out" not in answer


class Handler(BaseHTTPRequestHandler):
    server_version = "elliott-evolution-canary"

    def log_message(self, format: str, *args: object) -> None:
        print(format % args, file=sys.stderr)

    def _send(self, status: HTTPStatus, value: dict[str, object]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send(HTTPStatus.OK, {"status": "ok"})
        else:
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/canary":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._send(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "request body size is out of bounds"},
            )
            return
        try:
            release = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
            return
        snapshot_id = (
            release.get("snapshotId") if isinstance(release, dict) else None
        )
        if not isinstance(snapshot_id, str) or not snapshot_id:
            self._send(
                HTTPStatus.BAD_REQUEST,
                {"error": "release must carry a snapshotId"},
            )
            return
        passed = _runtime_ready() and _turn_completes()
        print(
            json.dumps(
                {"snapshotId": snapshot_id, "passed": passed},
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        self._send(HTTPStatus.OK, {"passed": passed, "snapshotId": snapshot_id})


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"evolution canary listening on :{PORT} for {RUNTIME}", file=sys.stderr)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
