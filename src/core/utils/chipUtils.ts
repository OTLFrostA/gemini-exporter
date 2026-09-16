// src/core/utils/chipUtils.ts - Canonical predicates and cleaning utilities for Google internal chip links

export const INTERNAL_CHIP_TOKEN_PATTERN =
    '(?:immersive_entry_chip|deep_research(?:_confirmation_content)?|map_(?:content|location(?:_reference)?)|grounding_content|web_search(?:_content)?|youtube_content|flights_content|hotels_content|workspace_content|image_?generation_?content|generated_image)';

export const INTERNAL_CHIP_URL_RE = new RegExp(
    `https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}`,
    'i'
);

export function isInternalChipUrl(u?: string | null): boolean {
    if (!u) return false;
    return INTERNAL_CHIP_URL_RE.test(u);
}

export function stripInternalChipMarkdown(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';

    const standaloneRe = new RegExp(
        `(?:^|\\n)\\s*(?:\\[)?https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}(?:\\/[^\\s\\n\\]]*)?(?:\\])?\\s*(?=\\n|$)`,
        'gi'
    );
    const linkWithTitleRe = new RegExp(
        `\\[([^\\]]+)\\]\\(https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}[^\\)]*\\)`,
        'gi'
    );
    const rawUrlRe = new RegExp(
        `https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}(?:\\/[^\\s\\n\\)]*)?`,
        'gi'
    );

    let cleaned = text.replace(standaloneRe, '\n');
    cleaned = cleaned.replace(linkWithTitleRe, '$1');
    cleaned = cleaned.replace(rawUrlRe, '');
    return cleaned;
}

const ChipUtils = {
    INTERNAL_CHIP_TOKEN_PATTERN,
    INTERNAL_CHIP_URL_RE,
    isInternalChipUrl,
    stripInternalChipMarkdown
};

if (typeof module === 'object' && module.exports) {
    module.exports = ChipUtils;
}

export default ChipUtils;

