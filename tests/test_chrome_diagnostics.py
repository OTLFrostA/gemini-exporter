"""Regression checks for browser identity loss, reporting and launch isolation."""
import json
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from scripts.chrome_diagnostics import BrowserDiagnostics
from scripts.launch_test_chrome import ensure_port_free, main, verify_process, ensure_profile_free
from scripts.framework.platforms.core import PlatformSession, run_session
from scripts.framework.features import FeatureRegistry


class TestChromeDiagnostics(unittest.TestCase):
    def test_occupied_port_is_rejected_without_launch(self):
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            with self.assertRaisesRegex(RuntimeError, 'already occupied'):
                ensure_port_free(server.getsockname()[1])

    def test_replacement_stays_failed_after_original_endpoint_returns(self):
        with tempfile.TemporaryDirectory() as directory:
            diag = BrowserDiagnostics(9222, directory)
            diag.version = {'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://original'}
            diag.stage = 'export'
            with patch('scripts.chrome_diagnostics.browser_version', return_value={
                    'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://replacement'}):
                with self.assertRaisesRegex(RuntimeError, 'export'):
                    diag.check()
            with patch('scripts.chrome_diagnostics.browser_version') as probe:
                with self.assertRaises(RuntimeError):
                    diag.check()
                probe.assert_not_called()
            events = (diag.output / 'events.jsonl').read_text()
            self.assertIn('browser_failure', events)

    def test_disconnect_latched_even_if_case_reports_success(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = SimpleNamespace(port=9222, output_dir=directory, registry=FeatureRegistry(standard=False))
            dag = SimpleNamespace(cases={})
            def execute(context, target_ids=None):
                with patch('scripts.chrome_diagnostics.browser_version', side_effect=OSError('disconnected')):
                    try:
                        context.browser_checkpoint('export')
                    except RuntimeError:
                        pass  # A case accidentally swallowing its transport error must not pass the run.
                return True
            dag.run = execute
            closed = []
            session = PlatformSession(dag, ctx, lambda: True, lambda: closed.append(True))
            version = {'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://original'}
            with patch('scripts.chrome_diagnostics.browser_version', return_value=version):
                report = {}
                self.assertFalse(run_session(session, report))
            self.assertEqual(closed, [True])
            self.assertIn('export', report['chrome_diagnostics']['failure'])

    def test_finish_does_not_copy_another_browser_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / 'profile'
            profile.mkdir()
            (profile / 'chrome-launch.json').write_text(json.dumps({
                'browser': {'webSocketDebuggerUrl': 'ws://other'}, 'log_dir': directory}))
            diag = BrowserDiagnostics(9222, directory)
            with patch.dict('os.environ', {'GEMINI_EXPORTER_TEST_PROFILE': str(profile)}), \
                    patch('scripts.chrome_diagnostics.browser_version', return_value={
                        'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://original'}):
                diag.start()
                diag.finish()
            self.assertFalse((diag.output / 'launch.json').exists())

    def test_original_launch_evidence_survives_replacement_of_profile_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / 'profile'
            profile.mkdir()
            launch = profile / 'original-launch'
            launch.mkdir()
            (launch / 'stderr.log').write_text('original browser error')
            pointer = profile / 'chrome-launch.json'
            pointer.write_text(json.dumps({'log_dir': str(launch),
                'browser': {'webSocketDebuggerUrl': 'ws://original'}}))
            diag = BrowserDiagnostics(9222, directory)
            with patch.dict('os.environ', {'GEMINI_EXPORTER_TEST_PROFILE': str(profile)}), \
                    patch('scripts.chrome_diagnostics.browser_version', return_value={
                        'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://original'}):
                diag.start()
                pointer.write_text(json.dumps({'browser': {'webSocketDebuggerUrl': 'ws://replacement'}}))
                diag.finish()
            self.assertEqual((diag.output / 'stderr.log').read_text(), 'original browser error')

    def test_stale_profile_singleton_can_recover_without_deleting_files(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)
            singleton = profile / 'SingletonLock'
            singleton.symlink_to(socket.gethostname() + '-123')
            with patch('scripts.launch_test_chrome.os.kill', side_effect=ProcessLookupError):
                ensure_profile_free(profile)
            self.assertTrue(singleton.is_symlink())
            with patch('scripts.launch_test_chrome.os.kill') as probe:
                with self.assertRaisesRegex(RuntimeError, 'already in use'):
                    ensure_profile_free(profile)
                probe.assert_called_once_with(123, 0)

    def test_launcher_verifies_endpoint_pid_and_disconnects_without_closing_chrome(self):
        connection = Mock()
        version = {'webSocketDebuggerUrl': 'ws://browser'}
        with patch('scripts.launch_test_chrome.CDPConnection', return_value=connection):
            connection.call.return_value = {'result': {'processInfo': [{'type': 'browser', 'id': 42}]}}
            verify_process(version, 42)
            with self.assertRaisesRegex(RuntimeError, 'another process'):
                verify_process(version, 43)
        self.assertEqual(connection.close.call_count, 2)
        self.assertTrue(all(call.args[0] == 'SystemInfo.getProcessInfo'
                            for call in connection.call.call_args_list))

    def test_launcher_records_identity_and_logs_without_waiting_for_browser_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            version = {'Browser': 'Chrome/test', 'webSocketDebuggerUrl': 'ws://original'}
            process = SimpleNamespace(pid=123, poll=lambda: None)
            with patch('scripts.launch_test_chrome.ensure_port_free'), \
                    patch('scripts.launch_test_chrome.browser_version', return_value=version), \
                    patch('scripts.launch_test_chrome.verify_process'), \
                    patch('scripts.launch_test_chrome.subprocess.Popen', return_value=process) as spawn:
                self.assertEqual(main(['--chrome', 'chrome', '--profile', directory,
                                       '--repo', directory, '--', 'about:blank']), 0)
            metadata = json.loads((Path(directory) / 'chrome-launch.json').read_text())
            self.assertEqual(metadata['pid'], 123)
            self.assertEqual(metadata['browser'], version)
            self.assertTrue((Path(metadata['log_dir']) / 'stderr.log').exists())
            self.assertTrue(spawn.call_args.kwargs['start_new_session'])
            self.assertIn('--enable-logging', metadata['command'])

    def test_startup_exit_preserves_exit_code_and_stderr_path(self):
        with tempfile.TemporaryDirectory() as directory:
            process = SimpleNamespace(pid=123, poll=lambda: 5, returncode=5)
            with patch('scripts.launch_test_chrome.ensure_port_free'), \
                    patch('scripts.launch_test_chrome.subprocess.Popen', return_value=process):
                with self.assertRaisesRegex(RuntimeError, 'exited during startup'):
                    main(['--chrome', 'chrome', '--profile', directory, '--repo', directory])
            metadata = json.loads((Path(directory) / 'chrome-launch.json').read_text())
            self.assertEqual(metadata['exit_code'], 5)
            self.assertTrue((Path(metadata['log_dir']) / 'stderr.log').exists())
            self.assertFalse((Path(directory) / '.chrome-launch.lock').exists())

    def test_launcher_releases_lock_and_never_spawns_on_occupied_port(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('scripts.launch_test_chrome.ensure_port_free', side_effect=RuntimeError('occupied')), \
                    patch('scripts.launch_test_chrome.subprocess.Popen') as spawn:
                with self.assertRaisesRegex(RuntimeError, 'occupied'):
                    main(['--chrome', 'chrome', '--profile', directory, '--repo', directory])
                spawn.assert_not_called()
            self.assertFalse((Path(directory) / '.chrome-launch.lock').exists())


if __name__ == '__main__':
    unittest.main()
