"""TCP bridge into a sealed companion's loopback namespace.

Companion job servers refuse to bind anything but 127.0.0.1; the placement
layer owns the IPC route in. This sidecar shares the companion's network
namespace, listens on the container's external interface, and pipes each
connection to the loopback port. It carries no credentials and adds no
protocol behavior — the companion's own wire validation stays the boundary.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
from socketserver import BaseRequestHandler, ThreadingTCPServer

LISTEN_PORT = int(os.environ["ELLIOTT_BRIDGE_LISTEN_PORT"])
TARGET_PORT = int(os.environ["ELLIOTT_BRIDGE_TARGET_PORT"])
CONNECT_TIMEOUT_SECONDS = 10.0
CHUNK_BYTES = 65536


def _pump(source: socket.socket, destination: socket.socket) -> None:
    try:
        while True:
            data = source.recv(CHUNK_BYTES)
            if not data:
                break
            destination.sendall(data)
    except OSError:
        pass
    finally:
        try:
            destination.shutdown(socket.SHUT_WR)
        except OSError:
            pass


class Handler(BaseRequestHandler):
    def handle(self) -> None:
        try:
            upstream = socket.create_connection(
                ("127.0.0.1", TARGET_PORT),
                timeout=CONNECT_TIMEOUT_SECONDS,
            )
        except OSError:
            return
        # Optimization jobs legitimately hold connections open for a long
        # time; rely on EOF from either side rather than socket timeouts.
        upstream.settimeout(None)
        self.request.settimeout(None)
        responder = threading.Thread(
            target=_pump,
            args=(upstream, self.request),
            daemon=True,
        )
        responder.start()
        _pump(self.request, upstream)
        responder.join()
        upstream.close()


class Bridge(ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    server = Bridge(("0.0.0.0", LISTEN_PORT), Handler)
    print(
        f"loopback bridge listening on :{LISTEN_PORT} "
        f"for 127.0.0.1:{TARGET_PORT}",
        file=sys.stderr,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
