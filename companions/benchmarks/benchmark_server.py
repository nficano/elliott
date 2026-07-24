from __future__ import annotations

import argparse
import json
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from benchmark_worker import run_benchmark
from code_check_worker import check_candidate
from evaluation_worker import baseline, compare
from elliott_companion.wire import MAX_REQUEST_BYTES, WireError, canonical_json


class BenchmarkServer(ThreadingHTTPServer):
    semaphore: threading.BoundedSemaphore


class Handler(BaseHTTPRequestHandler):
    server: BenchmarkServer

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write(
            canonical_json(
                {
                    "event": "benchmark.http",
                    "client": self.client_address[0],
                    "message": format % args,
                }
            )
            + "\n"
        )

    def _send(self, status: HTTPStatus, value: Any) -> None:
        encoded = canonical_json(value).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        self._send(
            HTTPStatus.OK if self.path == "/healthz" else HTTPStatus.NOT_FOUND,
            {"status": "ok"} if self.path == "/healthz" else {"error": "not found"},
        )

    def do_POST(self) -> None:
        handlers = {
            "/v1/run": run_benchmark,
            "/v1/baseline": baseline,
            "/v1/compare": compare,
            "/v1/candidate/check": check_candidate,
        }
        handler = handlers.get(self.path)
        if handler is None:
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "-1"))
            if length < 0 or length > MAX_REQUEST_BYTES:
                raise WireError("request exceeds the size limit")
            operation = json.loads(self.rfile.read(length))
            if not self.server.semaphore.acquire(blocking=False):
                self._send(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"error": "benchmark concurrency limit reached"},
                )
                return
            try:
                result = handler(operation)
            finally:
                self.server.semaphore.release()
            self._send(HTTPStatus.OK, result)
        except (WireError, ValueError, json.JSONDecodeError) as error:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - HTTP boundary must fail closed.
            self._send(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"{type(error).__name__}: {str(error)[:4096]}"},
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9073)
    parser.add_argument("--maximum-jobs", type=int, default=1)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1"}:
        raise SystemExit("benchmark server must bind to loopback")
    if args.maximum_jobs <= 0:
        raise SystemExit("maximum-jobs must be positive")
    server = BenchmarkServer((args.host, args.port), Handler)
    server.semaphore = threading.BoundedSemaphore(args.maximum_jobs)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
