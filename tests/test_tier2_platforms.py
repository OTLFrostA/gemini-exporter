"""Contract tests for plugin orchestration; no browser, network or scenario consumption."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.framework.platforms import load_plugins
from scripts.framework.platforms.core import (
    PlatformPlugins, PlatformSession, RunConfig, Tier2Runner, feature_spec, resolve_plan,
)
from scripts.framework.cases.base import DAGRunner, FeatureTestCase
from scripts.framework.features import FeatureDomain, FeatureRegistry


class Case(FeatureTestCase):
    def __init__(self, key, action, prerequisites=()):
        super().__init__(key, FeatureDomain.PAGE_CHAT, key, key, prerequisites=list(prerequisites))
        self.action = action

    def execute(self, ctx):
        return self.action(), 'test evidence', None


class Plugin:
    capabilities = ('chat',)
    accepted_options = ()

    def __init__(self, key, fail=False, prepare_fail=False, cleanup_fail=False):
        self.id, self.events = key, []
        self.fail, self.prepare_fail, self.cleanup_fail = fail, prepare_fail, cleanup_fail

    def dag(self):
        dag = DAGRunner()
        def first():
            self.events.append('first')
            return not self.fail
        def second():
            self.events.append('second')
            return True
        dag.register(Case('first', first))
        dag.register(Case('second', second, ('first',)))
        return dag

    def features(self):
        return [feature_spec(c) for c in self.dag().get_execution_order()]

    def open(self, config):
        self.config = config
        Path(config.output_dir).mkdir(parents=True, exist_ok=True)
        def prepare():
            self.events.append('prepare')
            if self.prepare_fail:
                raise RuntimeError('prepare failed')
        def close():
            self.events.append('close')
            if self.cleanup_fail:
                raise RuntimeError('cleanup failed')
        return PlatformSession(self.dag(), SimpleNamespace(registry=FeatureRegistry(standard=False)),
                               prepare, close, target_ids=['second'] if config.target_features else None)


class PlatformsTest(unittest.TestCase):
    def run_matrix(self, plugins, **kwargs):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            runner = Tier2Runner(plugins, RunConfig(output_dir=folder, **kwargs))
            passed = runner.run()
            report = json.loads((Path(folder)/'tier2-report.json').read_text())
        return passed, report

    def test_registration_selection_and_third_party(self):
        registry = load_plugins()
        external = Plugin('third_party')
        registry.register(external)
        self.assertEqual([p.id for p in registry.select(['chatgpt,gemini', 'chatgpt'])], ['chatgpt', 'gemini'])
        self.assertEqual(registry.select(['all'])[-1], external)
        for names in (['unknown'], ['all,chatgpt'], [''], []):
            with self.assertRaises(ValueError):
                registry.select(names)
        with self.assertRaises(ValueError):
            registry.register(external)

    def test_external_module_registration(self):
        external = Plugin('third_party')
        module = SimpleNamespace(register=lambda registry: registry.register(external))
        with patch('scripts.framework.platforms.import_module', return_value=module) as imported:
            registry = load_plugins(['custom.tier2'])
        imported.assert_called_once_with('custom.tier2')
        self.assertEqual(registry.select(['third_party']), [external])

    def test_failure_blocks_dependents_but_other_platform_runs_and_artifacts_isolate(self):
        first, second = Plugin('first', fail=True), Plugin('second')
        passed, report = self.run_matrix([first, second])
        self.assertFalse(passed)
        self.assertEqual(first.events, ['prepare', 'first', 'close'])
        self.assertEqual(second.events, ['prepare', 'first', 'second', 'close'])
        self.assertEqual([f['status'] for f in report['platforms']['first']['features']], ['FAIL', 'SKIP'])
        self.assertTrue(report['platforms']['second']['passed'])
        self.assertNotEqual(first.config.output_dir, second.config.output_dir)

    def test_prepare_and_cleanup_failures_cannot_pass(self):
        for kwargs in ({'prepare_fail': True}, {'cleanup_fail': True}):
            plugin = Plugin('third', **kwargs)
            passed, report = self.run_matrix([plugin])
            self.assertFalse(passed)
            self.assertEqual(plugin.events[-1], 'close')
            self.assertFalse(report['platforms']['third']['passed'])

    def test_options_are_scoped_to_plugin(self):
        first, second = Plugin('one'), Plugin('two')
        first.accepted_options = ('archive',)
        passed, _ = self.run_matrix([first, second], options={'one': {'archive': 'input.zip'}})
        self.assertTrue(passed)
        self.assertEqual(first.config.options, {'archive': 'input.zip'})
        self.assertEqual(second.config.options, {})

    def test_preflight_rejects_all_bad_plans_before_any_open(self):
        good, bad = Plugin('good'), Plugin('bad')
        for kwargs in ({'target_features': 'missing'}, {'domain': 'missing'},
                       {'options': {'bad': {'unknown': 1}}}, {'options': {'absent': {}}}):
            with self.assertRaises(ValueError):
                Tier2Runner([good, bad], RunConfig(**kwargs))
            self.assertEqual(good.events, [])
            self.assertEqual(bad.events, [])

    def test_invalid_dependencies_and_cycle_rejected(self):
        for specs in ([{'id': 'a', 'prerequisites': ['missing']}],
                      [{'id': 'a', 'prerequisites': ['b']}, {'id': 'b', 'prerequisites': ['a']}], []):
            with self.assertRaises(ValueError):
                resolve_plan(specs)

    def test_real_plugins_and_dependency_plans_do_not_consume_pool(self):
        with patch('scripts.framework.scenario_provider.OnlineScenarioProvider.pop_scenario',
                   side_effect=AssertionError('Offline plan must not consume scenarios')):
            plugins = load_plugins().select(['all'])
            runner = Tier2Runner(plugins, RunConfig())
            self.assertEqual(len(runner.plan()['gemini']['features']), 25)
            self.assertEqual(len(runner.plan()['chatgpt']['features']), 9)
            targeted = Tier2Runner([plugins[1]], RunConfig(target_features='full_reply_fidelity'))
            active = {f['id'] for f in targeted.plan()['chatgpt']['features'] if f['scheduled']}
            self.assertIn('complex_multiturn', active)
            self.assertIn('physical_four_format_export', active)
            self.assertNotIn('popup_export', active)

    def test_cli_aliases_and_platform_specific_listing(self):
        root = Path(__file__).resolve().parents[1]
        for args in (['--platforms', 'gemini', 'chatgpt', '--plan'],
                     ['--provider', 'chatgpt', '--list-features'],
                     ['--platform', 'gemini,chatgpt', '--list-features']):
            result = subprocess.run([sys.executable, 'scripts/test_live_chat_and_export.py', *args],
                                    cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            if args[1] == 'chatgpt':
                self.assertEqual(set(plan), {'chatgpt'})
                self.assertFalse(any(f['id'].startswith('feat_takeout') for f in plan['chatgpt']['features']))

    def test_preparation_false_and_finalization_failure_block_success(self):
        for hook in ('prepare', 'finalize'):
            plugin = Plugin('third')
            original = plugin.open
            def open_session(config):
                session = original(config)
                if hook == 'prepare':
                    session.prepare = lambda: False
                else:
                    session.finalize = Mock(side_effect=RuntimeError('finalization failed'))
                return session
            plugin.open = open_session
            passed, report = self.run_matrix([plugin])
            self.assertFalse(passed)
            self.assertIn('close', plugin.events)

    def test_runtime_must_match_declared_dependencies_before_browser_preparation(self):
        plugin = Plugin('third')
        original = plugin.open
        def open_session(config):
            session = original(config)
            session.dag.cases['second'].prerequisites = []
            return session
        plugin.open = open_session
        passed, report = self.run_matrix([plugin])
        self.assertFalse(passed)
        self.assertEqual(plugin.events, ['close'])
        self.assertIn('declared plan', report['platforms']['third']['error'])

    def test_target_selection_is_owned_by_framework(self):
        plugin = Plugin('third')
        passed, report = self.run_matrix([plugin], target_features='first')
        self.assertTrue(passed)
        self.assertEqual(plugin.events, ['prepare', 'first', 'close'])
        self.assertEqual(report['scope'], 'targeted')
        statuses = {f['id']: f['status'] for f in report['platforms']['third']['features']}
        self.assertEqual(statuses, {'first': 'PASS', 'second': 'SKIP'})

    def test_failed_open_does_not_stop_other_platform(self):
        first, second = Plugin('one'), Plugin('two')
        first.open = Mock(side_effect=RuntimeError('open failed'))
        passed, report = self.run_matrix([first, second])
        self.assertFalse(passed)
        self.assertEqual(report['platforms']['one']['status'], 'failed')
        self.assertTrue(report['platforms']['two']['passed'])

    def test_chatgpt_adapter_uses_common_dag_and_preserves_failure_evidence(self):
        from scripts.framework.platforms.chatgpt import ChatGPTPlugin
        runtime = SimpleNamespace(report={'gates': {}}, options=Mock(), chat=Mock(), browser=Mock(),
                                  save_report=Mock(), root=Path('/unused'), output=Path('/unused'), chat_ids=['id'])
        def gate(name, operation):
            result = operation()
            runtime.report['gates'][name] = {'status': 'passed', 'detail': result}
            return result
        runtime.gate = gate
        for name in ('prepare', 'generate', 'capture_golden', 'sync', 'confirmed_deletion',
                     'exports', 'popup_export'):
            setattr(runtime, name, Mock(return_value={}))
        def lifecycle():
            for key in ('live_disk_save', 'passive_promotion'):
                runtime.report['gates'][key] = {'status': 'passed'}
        runtime.lifecycle = lifecycle
        # Golden export's mandatory evidence is deliberately absent.
        runtime.golden_exports = Mock(return_value={})
        plugin = ChatGPTPlugin()
        plugin.open = lambda config: ChatGPTPlugin.session(runtime)
        with patch('scripts.framework.chatgpt_evidence.assert_full_exports', return_value={}):
            passed, report = self.run_matrix([plugin])
        self.assertFalse(passed)
        statuses = {f['id']: f['status'] for f in report['platforms']['chatgpt']['features']}
        self.assertEqual(statuses['full_reply_fidelity'], 'PASS')
        self.assertEqual(statuses['golden_physical_exports'], 'FAIL')
        self.assertEqual(statuses['popup_export'], 'SKIP')
        self.assertFalse(runtime.report['passed'])
        self.assertEqual(runtime.report['gates']['golden_physical_exports']['status'], 'fail')
        for connection in (runtime.options, runtime.chat, runtime.browser):
            connection.close.assert_called_once()

    def test_gemini_adapter_releases_environment_even_if_tracker_fails(self):
        from scripts.framework.platforms.gemini import GeminiPlugin
        runtime = SimpleNamespace(dag=DAGRunner(), ctx=SimpleNamespace(env=Mock()),
            prepare=Mock(), tracker=Mock(), target_ids=None,
            environment_context=SimpleNamespace(active_cdp=object()))
        runtime.tracker.teardown.side_effect = RuntimeError('tracker failed')
        with self.assertRaisesRegex(RuntimeError, 'tracker failed'):
            GeminiPlugin.session(runtime).close()
        runtime.ctx.env.teardown.assert_called_once_with(runtime.environment_context.active_cdp)

    def test_chatgpt_mandatory_subgate_still_blocks_success(self):
        from scripts.framework.platforms.chatgpt import ChatGPTCase
        runtime = SimpleNamespace(report={'gates': {}}, lifecycle=Mock(return_value={}), save_report=Mock(),
                                  gate=lambda name, operation: operation())
        case = ChatGPTCase('lifecycle', 'lifecycle', FeatureDomain.LIFECYCLE,
                           evidence=('live_disk_save', 'passive_promotion'))
        with self.assertRaisesRegex(ValueError, 'Missing mandatory evidence'):
            case.execute(SimpleNamespace(runtime=runtime))


if __name__ == '__main__':
    unittest.main()
