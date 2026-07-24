from __future__ import annotations

import os
import unittest
from pathlib import Path

from elliott_companion.server import JobController


class JobServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_pythonpath = os.environ.get("PYTHONPATH")
        repository = Path(__file__).resolve().parents[2]
        os.environ["PYTHONPATH"] = os.pathsep.join(
            [
                str(repository / "companions" / "common"),
                str(repository / "companions" / "tests"),
            ]
        )

    def tearDown(self) -> None:
        if self.previous_pythonpath is None:
            os.environ.pop("PYTHONPATH", None)
        else:
            os.environ["PYTHONPATH"] = self.previous_pythonpath

    def test_process_is_really_paused_and_resumed(self) -> None:
        controller = JobController("slow_worker:optimize", 0.03, 1)
        result = controller.start(
            {
                "run": {"id": "evr_12345678"},
                "maximumDurationMilliseconds": 5_000,
            }
        )
        self.assertTrue(result["paused"])
        token = result["resumeToken"]
        for _ in range(20):
            result = controller.resume(token)
            if result["paused"] is False:
                break
        self.assertFalse(result["paused"])
        self.assertEqual(result["runId"], "evr_12345678")

    def test_cancel_is_idempotent(self) -> None:
        controller = JobController("slow_worker:optimize", 0.03, 1)
        result = controller.start(
            {
                "run": {"id": "evr_87654321"},
                "maximumDurationMilliseconds": 5_000,
            }
        )
        self.assertTrue(result["paused"])
        controller.cancel("evr_87654321")
        controller.cancel("evr_87654321")


if __name__ == "__main__":
    unittest.main()
