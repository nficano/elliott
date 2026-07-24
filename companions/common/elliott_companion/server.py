from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .wire import (
    MAX_REQUEST_BYTES,
    RUN_ID,
    WireError,
    canonical_json,
    require_mapping,
    require_string,
)

PASSTHROUGH_ENVIRONMENT = frozenset(
    {
        "ELLIOTT_COMPANION_FIXTURE",
        "ELLIOTT_DSPY_MODEL",
        "ELLIOTT_DARWINIAN_MODEL",
        "ELLIOTT_MODEL_PROXY_ENDPOINT",
        "ELLIOTT_MODEL_PROXY_INPUT_USD_PER_MILLION",
        "ELLIOTT_MODEL_PROXY_OUTPUT_USD_PER_MILLION",
        "ELLIOTT_MODEL_PROXY_TOKEN",
        "ELLIOTT_BENCHMARK_DRIVER_CONFIG",
        "ELLIOTT_BENCHMARK_WORK_ROOT",
        "LANG",
        "LC_ALL",
        "PATH",
        "PYTHONPATH",
        "PYTHONUNBUFFERED",
    }
)


@dataclass
class Job:
    run_id: str
    token: str
    process: subprocess.Popen[bytes]
    root: Path
    result_path: Path
    started_at: float
    deadline: float
    paused: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


class JobController:
    def __init__(self, worker: str, slice_seconds: float, maximum_jobs: int) -> None:
        self.worker = worker
        self.slice_seconds = slice_seconds
        self.maximum_jobs = maximum_jobs
        self.by_run_id: dict[str, Job] = {}
        self.by_token: dict[str, Job] = {}
        self.lock = threading.Lock()

    @staticmethod
    def _environment() -> dict[str, str]:
        environment = {
            key: value
            for key, value in os.environ.items()
            if key in PASSTHROUGH_ENVIRONMENT
        }
        environment.setdefault("PYTHONUNBUFFERED", "1")
        return environment

    def start(self, request: dict[str, Any]) -> dict[str, Any]:
        run = require_mapping(request.get("run"), "run")
        run_id = require_string(run.get("id"), "run.id")
        if RUN_ID.fullmatch(run_id) is None:
            raise WireError("run.id is invalid")
        duration_ms = request.get("maximumDurationMilliseconds")
        if (
            isinstance(duration_ms, bool)
            or not isinstance(duration_ms, int)
            or duration_ms <= 0
        ):
            raise WireError("maximumDurationMilliseconds must be positive")
        with self.lock:
            existing = self.by_run_id.get(run_id)
            if existing is not None and existing.process.poll() is None:
                raise WireError("run already has an active worker")
            active = sum(job.process.poll() is None for job in self.by_run_id.values())
            if active >= self.maximum_jobs:
                raise WireError("companion concurrency limit reached")
            root = Path(tempfile.mkdtemp(prefix="elliott-job-", dir="/tmp"))
            os.chmod(root, 0o700)
            request_path = root / "request.json"
            result_path = root / "result.json"
            request_path.write_text(canonical_json(request), encoding="utf-8")
            os.chmod(request_path, 0o600)
            token = secrets.token_urlsafe(32)
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "elliott_companion.worker_process",
                    self.worker,
                    str(request_path),
                    str(result_path),
                ],
                cwd=root,
                env=self._environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            now = time.monotonic()
            job = Job(
                run_id=run_id,
                token=token,
                process=process,
                root=root,
                result_path=result_path,
                started_at=now,
                deadline=now + duration_ms / 1000,
            )
            self.by_run_id[run_id] = job
            self.by_token[token] = job
        return self._await_or_pause(job)

    def _signal_group(self, job: Job, sig: signal.Signals) -> None:
        if job.process.poll() is None:
            os.killpg(job.process.pid, sig)

    def _await_or_pause(self, job: Job) -> dict[str, Any]:
        with job.lock:
            remaining = job.deadline - time.monotonic()
            if remaining <= 0:
                self._signal_group(job, signal.SIGKILL)
                raise WireError("optimization duration budget exhausted")
            try:
                job.process.wait(timeout=min(self.slice_seconds, remaining))
            except subprocess.TimeoutExpired:
                self._signal_group(job, signal.SIGSTOP)
                job.paused = True
                return {
                    "runId": job.run_id,
                    "candidates": [],
                    "paused": True,
                    "resumeToken": job.token,
                }
            return self._read_result(job)

    def _read_result(self, job: Job) -> dict[str, Any]:
        if not job.result_path.is_file():
            raise RuntimeError("worker exited without a result")
        result = json.loads(job.result_path.read_text(encoding="utf-8"))
        if not isinstance(result, dict):
            raise TypeError("worker result is not an object")
        error = result.get("error")
        if isinstance(error, dict):
            raise RuntimeError(  # noqa: TRY004 - this reports a remote worker failure.
                f"worker {error.get('type', 'Error')}: {error.get('message', 'unknown failure')}"
            )
        if result.get("runId") != job.run_id:
            raise RuntimeError("worker result runId mismatch")
        return result

    def pause(self, run_id: str) -> str:
        with self.lock:
            job = self.by_run_id.get(run_id)
        if job is None:
            raise WireError("run was not found")
        with job.lock:
            if job.process.poll() is None and not job.paused:
                self._signal_group(job, signal.SIGSTOP)
                job.paused = True
            return job.token

    def resume(self, token: str) -> dict[str, Any]:
        with self.lock:
            job = self.by_token.get(token)
        if job is None:
            raise WireError("resume token was not found")
        with job.lock:
            if job.process.poll() is None and job.paused:
                self._signal_group(job, signal.SIGCONT)
                job.paused = False
        return self._await_or_pause(job)

    def cancel(self, run_id: str) -> None:
        with self.lock:
            job = self.by_run_id.get(run_id)
        if job is None:
            return
        with job.lock:
            self._signal_group(job, signal.SIGKILL)
            try:
                job.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            shutil.rmtree(job.root, ignore_errors=True)
        with self.lock:
            self.by_run_id.pop(job.run_id, None)
            self.by_token.pop(job.token, None)


class CompanionServer(ThreadingHTTPServer):
    controller: JobController


class Handler(BaseHTTPRequestHandler):
    server: CompanionServer

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write(
            canonical_json(
                {
                    "event": "companion.http",
                    "client": self.client_address[0],
                    "message": format % args,
                }
            )
            + "\n"
        )

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("content-length")
        if raw_length is None:
            raise WireError("content-length is required")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise WireError("content-length is invalid") from error
        if length < 0 or length > MAX_REQUEST_BYTES:
            raise WireError("request exceeds the size limit")
        try:
            return require_mapping(json.loads(self.rfile.read(length)), "request")
        except json.JSONDecodeError as error:
            raise WireError("request is not valid JSON") from error

    def _send(self, status: HTTPStatus, value: Any) -> None:
        encoded = canonical_json(value).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send(HTTPStatus.OK, {"status": "ok"})
        else:
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            request = self._read_json()
            if self.path == "/v1/optimize":
                result = self.server.controller.start(request)
            elif self.path == "/v1/pause":
                result = self.server.controller.pause(
                    require_string(request.get("runId"), "runId")
                )
            elif self.path == "/v1/resume":
                result = self.server.controller.resume(
                    require_string(request.get("resumeToken"), "resumeToken")
                )
            elif self.path == "/v1/cancel":
                self.server.controller.cancel(
                    require_string(request.get("runId"), "runId")
                )
                result = {}
            else:
                self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._send(HTTPStatus.OK, result)
        except WireError as error:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - HTTP boundary must fail closed.
            self._send(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"{type(error).__name__}: {str(error)[:4096]}"},
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--slice-seconds",
        type=float,
        default=float(os.getenv("ELLIOTT_JOB_SLICE_SECONDS", "30")),
    )
    parser.add_argument(
        "--maximum-jobs",
        type=int,
        default=int(os.getenv("ELLIOTT_MAXIMUM_JOBS", "1")),
    )
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1"}:
        raise SystemExit("companion server must bind to loopback")
    if args.slice_seconds <= 0 or args.maximum_jobs <= 0:
        raise SystemExit("job limits must be positive")
    server = CompanionServer((args.host, args.port), Handler)
    server.controller = JobController(
        args.worker, args.slice_seconds, args.maximum_jobs
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
