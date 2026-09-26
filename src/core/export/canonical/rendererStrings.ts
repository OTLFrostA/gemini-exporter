export interface RendererStrings {
    thinkingSummary: string;
    thinkingProgress: string;
    thinkingProcess: string;
    toolCall: string;
    toolResult: string;
    sources: string;
    sizeUnknown: string;
    dateUnknown: string;
    unsupportedContent: string;
    mathFallback: string;
}

const EN: RendererStrings = {
    thinkingSummary: 'Thinking Summary',
    thinkingProgress: 'Thinking Progress',
    thinkingProcess: 'Thinking Process',
    toolCall: 'Tool call',
    toolResult: 'Tool result',
    sources: 'Sources',
    sizeUnknown: 'size unknown',
    dateUnknown: 'date unknown',
    unsupportedContent: 'Unsupported content',
    mathFallback: 'Could not typeset this formula; original LaTeX preserved:',
};

const ZH: RendererStrings = {
    thinkingSummary: '思考摘要',
    thinkingProgress: '思考过程',
    thinkingProcess: '思考过程',
    toolCall: '工具调用',
    toolResult: '工具结果',
    sources: '来源',
    sizeUnknown: '大小未知',
    dateUnknown: '日期未知',
    unsupportedContent: '不支持的内容',
    mathFallback: '无法排版该公式；保留原始 LaTeX：',
};

export function getRendererStrings(locale: 'zh' | 'en'): RendererStrings {
    return locale === 'en' ? EN : ZH;
}
