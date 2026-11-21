# tests/test_serial_pipeline.py
"""
Unit tests for the Serial Action Pipeline & Single-Flight Executor.
Validates state machine invariants, concurrency violation prevention,
process mutual exclusion, and fail-fast circuit breaking.
"""

import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.framework.pipeline import (
    PipelineStage,
    PipelineConcurrencyViolationError,
    ProcessLock,
    ProcessLockError,
    AtomicAction,
    ActionResult,
    SerialActionExecutor
)


class MockAction(AtomicAction):
    def __init__(self, name, allowed_stages, next_stage, success=True, error_msg="fail"):
        self._name = name
        self._allowed_stages = allowed_stages
        self._next_stage = next_stage
        self._success = success
        self._error_msg = error_msg
        self.executed = False

    @property
    def name(self) -> str:
        return self._name

    @property
    def allowed_stages(self):
        return self._allowed_stages

    @property
    def next_stage(self):
        return self._next_stage

    def execute(self, ctx, cdp) -> ActionResult:
        self.executed = True
        if self._success:
            return ActionResult(True, f"{self._name} succeeded")
        return ActionResult(False, self._error_msg)


class TestSerialPipeline(unittest.TestCase):

    @unittest.skipIf(os.name == "nt", "Requires POSIX flock")
    def test_process_lock_release_preserves_successor_exclusivity(self):
        import fcntl
        import select

        with tempfile.TemporaryDirectory() as directory:
            lock_path = os.path.join(directory, "runner.lock")
            lock1, lock3 = ProcessLock(lock_path), ProcessLock(lock_path)
            successor = None
            successor_ready = False
            real_flock = fcntl.flock

            def unlock_and_acquire_successor(fd, operation):
                nonlocal successor, successor_ready
                real_flock(fd, operation)
                if operation == fcntl.LOCK_UN:
                    successor = subprocess.Popen(
                        [sys.executable, "-c", (
                            "import sys\n"
                            "from scripts.framework.pipeline import ProcessLock\n"
                            "with ProcessLock(sys.argv[1]):\n"
                            "    print('acquired', flush=True)\n"
                            "    sys.stdin.read()\n"
                        ), lock_path],
                        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                    )
                    readable, _, _ = select.select([successor.stdout], [], [], 10)
                    successor_ready = bool(readable) and successor.stdout.readline().strip() == "acquired"

            try:
                lock1.acquire()
                with patch("fcntl.flock", side_effect=unlock_and_acquire_successor):
                    lock1.release()
                self.assertTrue(successor_ready, "Successor must acquire during release")
                with self.assertRaises(ProcessLockError):
                    lock3.acquire()
            finally:
                lock3.release()
                lock1.release()
                if successor is not None:
                    try:
                        successor.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        successor.kill()
                        successor.communicate()

    @unittest.skipIf(os.name == "nt" or getattr(os, "geteuid", lambda: 0)() == 0,
                     "Requires POSIX permissions and a non-root user")
    def test_process_lock_read_only_file_acquisition_and_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = os.path.join(directory, "runner.lock")
            with ProcessLock(lock_path):
                pass
            os.chmod(lock_path, 0o444)
            lock1, lock2 = ProcessLock(lock_path), ProcessLock(lock_path)
            try:
                lock1.acquire()
                self.assertTrue(lock1._acquired)
                with self.assertRaises(ProcessLockError) as conflict:
                    lock2.acquire()
                self.assertIn("冲突进程信息", str(conflict.exception))
                self.assertIsNone(lock2.fd)
                lock1.release()
                self.assertIsNone(lock1.fd)
                lock2.acquire()
                self.assertTrue(lock2._acquired)
            finally:
                lock2.release()
                lock1.release()

    def test_process_lock_acquisition_and_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = os.path.join(directory, "runner.lock")
            lock1, lock2 = ProcessLock(lock_path), ProcessLock(lock_path)
            try:
                lock1.acquire()
                self.assertTrue(lock1._acquired)
                self.assertTrue(os.path.exists(lock_path))

                with self.assertRaises(ProcessLockError):
                    lock2.acquire()

                lock1.release()
                self.assertFalse(lock1._acquired)
                self.assertTrue(os.path.exists(lock_path))
                with open(lock_path, encoding="utf-8") as lock_file:
                    self.assertEqual(lock_file.read(), "")

                lock2.acquire()
                self.assertTrue(lock2._acquired)
            finally:
                lock2.release()
                lock1.release()
            self.assertTrue(os.path.exists(lock_path))
            with open(lock_path, encoding="utf-8") as lock_file:
                self.assertEqual(lock_file.read(), "")

    def test_executor_state_machine_transition_success(self):
        executor = SerialActionExecutor()
        self.assertEqual(executor.current_stage, PipelineStage.IDLE)

        a1 = MockAction("StageInput", {PipelineStage.IDLE}, PipelineStage.STAGED)
        a2 = MockAction("Dispatch", {PipelineStage.STAGED}, PipelineStage.DISPATCHED)
        a3 = MockAction("Settle", {PipelineStage.DISPATCHED}, PipelineStage.SETTLED)
        a4 = MockAction("Cooldown", {PipelineStage.SETTLED}, PipelineStage.IDLE)

        res = executor.run_pipeline(None, None, [a1, a2, a3, a4])
        self.assertTrue(res.success)
        self.assertEqual(res.executed_actions, 4)
        self.assertEqual(executor.current_stage, PipelineStage.IDLE)

    def test_executor_concurrency_violation_halts(self):
        executor = SerialActionExecutor()
        # a2 expects STAGED, but current is IDLE
        a1 = MockAction("InvalidDirectDispatch", {PipelineStage.STAGED}, PipelineStage.DISPATCHED)

        with self.assertRaises(PipelineConcurrencyViolationError):
            executor.run_pipeline(None, None, [a1])

    def test_nested_execution_is_rejected_while_outer_action_is_running(self):
        executor = SerialActionExecutor()
        case = self
        nested = MockAction("Nested", {PipelineStage.IDLE}, PipelineStage.STAGED)

        class ReenterAction(MockAction):
            def execute(self, ctx, cdp):
                case.assertTrue(executor.is_in_flight)
                with case.assertRaises(PipelineConcurrencyViolationError):
                    executor.run_pipeline(ctx, cdp, [nested])
                self.executed = True
                return ActionResult(True, "nested call rejected")

        outer = ReenterAction("Outer", {PipelineStage.IDLE}, PipelineStage.IDLE)
        result = executor.run_pipeline(None, None, [outer])
        self.assertTrue(result.success)
        self.assertEqual(result.executed_actions, 1)
        self.assertTrue(outer.executed)
        self.assertFalse(nested.executed)
        self.assertFalse(executor.is_in_flight)
        self.assertEqual(executor.current_stage, PipelineStage.IDLE)

    def test_circuit_breaker_halts_on_action_failure(self):
        executor = SerialActionExecutor()
        a1 = MockAction("Step1", {PipelineStage.IDLE}, PipelineStage.STAGED, success=True)
        a2 = MockAction("Step2Fail", {PipelineStage.STAGED}, PipelineStage.DISPATCHED, success=False, error_msg="Network drop")
        a3 = MockAction("Step3ShouldNotRun", {PipelineStage.DISPATCHED}, PipelineStage.SETTLED, success=True)

        res = executor.run_pipeline(None, None, [a1, a2, a3])
        self.assertFalse(res.success)
        self.assertIn("Network drop", str(res.error))
        self.assertTrue(a1.executed)
        self.assertTrue(a2.executed)
        self.assertFalse(a3.executed, "Action after circuit breaker trip must not execute!")
        self.assertEqual(executor.current_stage, PipelineStage.IDLE, "Stage must reset to IDLE safely on failure")


if __name__ == "__main__":
    unittest.main()
