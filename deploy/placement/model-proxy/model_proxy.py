"""Loopback model proxy for evolution companions.

Placement-owned sidecar. It shares a sealed companion's network namespace,
holds the upstream gateway credential the companion must never see, and
forwards only allowlisted, non-streaming chat-completion calls. The companion
authenticates with a scoped token; the upstream key never appears in an
optimization request or a candidate. The upstream is an OpenAI-compatible
gateway (LiteLLM) that owns provider credentials and pricing.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_COMPLETION_TOKENS = 32_768
UPSTREAM_TIMEOUT_SECONDS = 600.0


def _require(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        raise SystemExit(f"{name} is required")
    return value


TOKEN = _require("ELLIOTT_PROXY_TOKEN")
UPSTREAM = _require("ELLIOTT_PROXY_UPSTREAM").rstrip("/")
UPSTREAM_KEY = _require("ELLIOTT_PROXY_UPSTREAM_KEY")
ALLOWED_MODELS = frozenset(
    item.strip()
    for item in _require("ELLIOTT_PROXY_ALLOWED_MODELS").split(",")
    if item.strip()
)
PORT = int(os.getenv("ELLIOTT_PROXY_PORT", "9090"))


def _authorized(header: str | None) -> bool:
    if header is None or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):], TOKEN)


class Handler(BaseHTTPRequestHandler):
    server_version = "elliott-model-proxy"

    def log_message(self, format: str, *args: object) -> None:
        print(format % args, file=sys.stderr)

    def _send(self, status: HTTPStatus | int, value: dict[str, object]) -> None:
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
        if self.path != "/v1/chat/completions":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not _authorized(self.headers.get("authorization")):
            self._send(HTTPStatus.UNAUTHORIZED, {"error": "invalid proxy token"})
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._send(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "request body size is out of bounds"},
            )
            return
        try:
            request = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
            return
        if not isinstance(request, dict):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "request must be an object"})
            return
        if request.get("model") not in ALLOWED_MODELS:
            self._send(
                HTTPStatus.FORBIDDEN,
                {"error": "model route is not allowlisted for this companion"},
            )
            return
        if request.get("stream"):
            self._send(
                HTTPStatus.BAD_REQUEST,
                {"error": "streaming is not supported through the proxy"},
            )
            return
        maximum_tokens = request.get("max_tokens")
        if isinstance(maximum_tokens, int):
            request["max_tokens"] = min(maximum_tokens, MAX_COMPLETION_TOKENS)
        else:
            request["max_tokens"] = MAX_COMPLETION_TOKENS
        status, body = self._forward(request)
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self._log_usage(request, status, body)

    def _forward(self, request: dict[str, object]) -> tuple[int, bytes]:
        outbound = urllib.request.Request(
            UPSTREAM + "/v1/chat/completions",
            data=json.dumps(request).encode("utf-8"),
            method="POST",
            headers={
                "authorization": f"Bearer {UPSTREAM_KEY}",
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(
                outbound,
                timeout=UPSTREAM_TIMEOUT_SECONDS,
            ) as response:
                return response.status, response.read(MAX_RESPONSE_BYTES)
        except urllib.error.HTTPError as error:
            return error.code, error.read(MAX_RESPONSE_BYTES)
        except urllib.error.URLError as error:
            return (
                int(HTTPStatus.BAD_GATEWAY),
                json.dumps({"error": f"upstream unreachable: {error.reason}"}).encode(
                    "utf-8",
                ),
            )

    def _log_usage(
        self,
        request: dict[str, object],
        status: int,
        body: bytes,
    ) -> None:
        usage: dict[str, object] = {}
        try:
            decoded = json.loads(body)
            if isinstance(decoded, dict) and isinstance(decoded.get("usage"), dict):
                usage = decoded["usage"]
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        print(
            json.dumps(
                {
                    "model": request.get("model"),
                    "status": status,
                    "promptTokens": usage.get("prompt_tokens"),
                    "completionTokens": usage.get("completion_tokens"),
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(
        f"model proxy listening on 127.0.0.1:{PORT} "
        f"for models {sorted(ALLOWED_MODELS)}",
        file=sys.stderr,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
