import { englishCount, text } from '../../shared/settings.js';
import { resourceIssueKind } from '../../../shared/resources/resourceResult.js';
import type { ExportIssueGroup } from '../state/exportIssues.js';

const LABELS: ReadonlyMap<string, readonly [string, string]> = new Map([
    ['ACCOUNT_UNAVAILABLE', ['Selected account unavailable', '所选账号不可用']],
    ['ACCOUNT_CHANGED', ['Source account changed or does not match', '来源账号已变化或与所选账号不一致']],
    ['PLATFORM_PERMISSION_REQUIRED', ['Site access is not authorized', '尚未授权访问该平台']],
    ['SOURCE_PAGE_UNAVAILABLE', ['No verified source page available', '没有可用且已验证的平台页面']],
    ['SOURCE_AUTH_UNAVAILABLE', ['Platform authentication information unavailable', '无法获取平台身份验证信息']],
    ['SOURCE_RESPONSE_INVALID', ['Source data could not be parsed or verified', '无法解析或验证平台返回的数据']],
    ['SOURCE_CHANGED', ['Conversation changed during acquisition', '获取过程中会话内容发生变化']],
    ['CONVERSATION_NOT_FOUND', ['Source confirmed the conversation no longer exists', '来源已确认会话不存在']],
    ['EXPORTED_FROM_LOCAL_DELETED_AT_SOURCE', ['Deleted at source; exported from local history', '云端已删除，已使用本地历史导出']],
    ['DETAIL_UNAVAILABLE', ['No usable conversation body available', '没有可用于导出的会话正文']],
    ['DETAIL_NOT_COMPLETE', ['Conversation body is incomplete', '会话正文不完整']],
    ['DETAIL_STALE', ['Conversation timestamps differ; freshness is unconfirmed', '会话时间戳不一致，最新状态尚未确认']],
    ['RESOURCE_LOCATOR_UNAVAILABLE', ['Attachment download location unavailable', '缺少可用的附件下载地址']],
    ['RESOURCE_SIZE_LIMIT', ['Attachment exceeds the supported size limit', '附件超过支持的大小限制']],
    ['RESOURCE_SIZE_MISMATCH', ['Attachment size does not match source metadata', '附件大小与来源记录不一致']],
    ['RESOURCE_SOURCE_EXPIRED', ['Source attachment unavailable', '来源附件无法获取']],
    ['RESOURCE_ACCESS_RESTRICTED', ['Attachment access restricted', '附件访问受限']],
    ['RESOURCE_DOWNLOAD_FAILED', ['Attachment download failed', '附件下载失败']],
    ['RESOURCE_PROCESSING_FAILED', ['Attachment could not be processed', '附件无法处理']],
    ['RESOURCE_UNAVAILABLE', ['Attachment failed: Unknown error', '附件失败：未知错误']],
    ['RESOURCE_METADATA_UNAVAILABLE', ['Attachment metadata unavailable', '附件元数据缺失']],
    ['DIRECTORY_UNAVAILABLE', ['Save directory unavailable', '保存目录不可用']],
    ['DIRECTORY_PERMISSION_REQUIRED', ['Folder access is not authorized', '文件夹访问未授权']],
    ['FILE_WRITE_FAILED', ['File delivery failed', '文件交付失败']],
    ['PACKAGING_SIZE_LIMIT', ['Batch exceeds the ZIP size limit; use a local folder or fewer conversations', '批量文件超过 ZIP 大小限制，请改用文件夹或减少会话数量']],
    ['PACKAGING_UNAVAILABLE', ['ZIP packaging component unavailable', 'ZIP 打包组件不可用']],
    ['PACKAGING_FAILED', ['Export file packaging failed', '导出文件打包失败']],
    ['RECORD_WRITE_FAILED', ['Files delivered, but export history could not be saved', '文件已交付，但导出记录保存失败']],
    ['PDF_INIT_FAILED', ['PDF engine initialization failed', 'PDF 引擎启动失败']],
    ['PDF_TIMEOUT', ['PDF engine timed out', 'PDF 引擎处理超时']],
    ['PDF_COMPILE_FAILED', ['PDF compilation failed', 'PDF 编译失败']],
    ['PDF_INVALID_OUTPUT', ['PDF engine returned invalid output', 'PDF 引擎返回了无效文件']],
    ['FORMAT_CONTENT_OMITTED', ['Some content was omitted from the export', '部分内容未能导出']],
    ['TYPST_LOCAL_FONT_READ_FAILED', ['Some local fonts could not be read', '部分本地字体无法读取']],
    ['TYPST_LOCAL_FONTS_MISSING', ['Local fonts unavailable; fallback fonts used', '本地字体不可用，已使用备用字体']],
    ['TYPST_MATH_INIT_FAILED', ['Math engine unavailable; source formulas preserved', '公式引擎不可用，已保留原始公式']],
    ['MATH_FENCE_UNCLOSED', ['Source formula delimiter is unclosed; formula source preserved', '来源公式分隔符未闭合，已保留原始公式']],
    ['GEMINI_STRUCTURED_FALLBACK', ['Some source content required fallback parsing', '部分来源内容使用了备用解析']],
    ['GEMINI_SOURCE_ANNOTATION_FALLBACK', ['Body preserved; some source references could not be placed exactly', '已保留正文，部分来源引用无法精确定位']],
    ['GEMINI_DOCUMENT_BINDING_FALLBACK', ['Document body extracted via fallback (unverified binding)', '文档已通过备用方式提取（归属未验证）']],
    ['UNKNOWN_ERROR', ['Unknown error', '未知错误']],
]);

export type FailureGroupTier = 'error' | 'degraded' | 'note';

const PARSER_NOTE_CATEGORIES = new Set([
    'GEMINI_DOCUMENT_BINDING_FALLBACK',
    'GEMINI_SOURCE_ANNOTATION_FALLBACK',
    'GEMINI_STRUCTURED_FALLBACK',
    'TYPST_LOCAL_FONT_READ_FAILED',
    'TYPST_LOCAL_FONTS_MISSING',
    'TYPST_MATH_INIT_FAILED',
    'MATH_FENCE_UNCLOSED',
]);

export function failureGroupTier(group: ExportIssueGroup): FailureGroupTier {
    if (group.severity === 'error') return 'error';
    if (PARSER_NOTE_CATEGORIES.has(group.category) || group.diagnostic.stage === 'source_parse') return 'note';
    return 'degraded';
}

const TIER_RANK: Record<FailureGroupTier, number> = { error: 0, degraded: 1, note: 2 };

/** Deduplicate synthetic DETAIL_NOT_COMPLETE echoes already explained by specific groups and sort by user impact. */
export function prepareDisplayFailureGroups(groups: readonly ExportIssueGroup[]): ExportIssueGroup[] {
    const specificKeys = new Set<string>();
    for (const group of groups) {
        if (group.category === 'DETAIL_NOT_COMPLETE') continue;
        for (const { key } of group.conversations) specificKeys.add(`${key.accountId}/${key.conversationId}`);
    }
    const deduped: ExportIssueGroup[] = [];
    for (const group of groups) {
        if (group.category !== 'DETAIL_NOT_COMPLETE' || specificKeys.size === 0) {
            deduped.push(group);
            continue;
        }
        const remaining = group.conversations.filter(({ key }) => !specificKeys.has(`${key.accountId}/${key.conversationId}`));
        if (remaining.length > 0) deduped.push({ ...group, conversations: remaining, occurrences: remaining.length });
    }
    return deduped.sort((a, b) => TIER_RANK[failureGroupTier(a)] - TIER_RANK[failureGroupTier(b)]);
}
export function failureGroupLabel(group: ExportIssueGroup): string {
    let label = LABELS.get(resourceIssueKind({ code: group.category, httpStatus: group.httpStatus }) === 'expired'
        ? 'RESOURCE_SOURCE_EXPIRED' : group.category);
    if (group.category === 'SOURCE_HTTP_ERROR') {
        label = group.httpStatus === 401 ? ['Platform authentication failed', '平台身份验证失败']
            : group.httpStatus === 403 ? ['Platform access restricted', '平台访问受限']
            : group.httpStatus === 429 ? ['Platform request rate limited', '平台请求过于频繁']
            : group.httpStatus !== undefined && group.httpStatus >= 500 ? ['Platform returned a server error', '平台服务返回错误']
            : ['Platform request failed', '平台请求失败'];
    }
    const reason = label ? text(...label) : group.severity === 'warning' ? text('Export warning', '导出警告') : text('Unknown error', '未知错误');
    const count = group.conversations.length;
    return reason + (group.httpStatus !== undefined ? ` (HTTP ${group.httpStatus})` : '')
        + ' · ' + (count ? text(englishCount(count, 'conversation'), `${count} 条会话`) : text('Export task', '导出任务'))
        + ' · ' + text(englishCount(group.occurrences, 'occurrence'), `${group.occurrences} 次`);
}
export function copyExportFailures(groups: readonly ExportIssueGroup[]): string {
    return prepareDisplayFailureGroups(groups).map(group => [failureGroupLabel(group),
        `${text('Example diagnostic', '示例诊断')}: [${group.diagnostic.stage} / ${group.diagnostic.code}] ${group.diagnostic.message}`,
        ...group.conversations.map(({ key, title }) => `${key.accountId}/${key.conversationId}${title ? `: ${title}` : ''}`)
    ].join('\n')).join('\n\n');
}
