"""Gemini-specific additional check, downstream of the physical ZIP export."""
from pathlib import Path
from scripts.framework.cases.base import FeatureTestCase
from scripts.framework.features import FeatureDomain
from scripts.framework.gemini_dual_parse import run_check


class GeminiDualParseCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id='feat_gemini_dual_parse', domain=FeatureDomain.EXPORT_DISK,
            name='Gemini structured 与 Markdown 双路对比',
            description='同一份原生 RPC 分别走两条解析路径，保留逐轮差异与来源证据',
            prerequisites=['feat_zip_export_download'])

    def execute(self, ctx):
        capture = ctx.shared_data.get('gemini_dual_capture')
        if not capture or not capture.get('expected') or capture.get('missingNative'):
            return False, '缺少实际导出目标的原生 RPC 证据', capture
        root = Path(ctx.output_dir) / 'gemini_dual_parse'
        passed, summary = run_check(ctx.worktree_root, root / 'native', root / 'report')
        captured_ids = [result.get('conversationId', '').removeprefix('c_') for result in summary['results']]
        coverage_matches = sorted(captured_ids) == sorted(capture['expected'])
        if not coverage_matches:
            summary['targetCoverageMismatch'] = {'expected': capture['expected'], 'captured': captured_ids}
        passed = passed and coverage_matches
        counts = summary['counts']
        message = (f"{counts['assistant']} 条回复：{counts['match']} 一致，"
                   f"{counts['different']} 差异，{counts['structuredUnavailable']} structured 不可用；"
                   f"报告：{root / 'report/REPORT.md'}")
        return passed, message, summary
