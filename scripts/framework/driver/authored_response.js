// Read the authored answer independently of the extension's parser/exporter.
// This function is embedded in the live CDP driver and exercised in a browser.
(root) => {
    if (!root) return { text: '', hasImages: false, codeBlocks: [], executionBlocks: [] };
    // A streamed answer may have multiple Markdown panels. Read the complete
    // response body, excluding model-level headers and feedback outside it.
    root = root.querySelector('model-response-content') || root;
    // Execution disclosures are accessible source evidence, even when collapsed.
    // Verify exported protocol-tagged execution blocks separately from prose.
    const executions = [...root.querySelectorAll('code-block')].filter(block => block.querySelector('.code-result-container'));
    const executionBlocks = executions.map(block => ({
        code: block.querySelector('.code-container')?.textContent || '',
        stdout: block.querySelector('.code-result-container')?.textContent || '',
    }));
    const clone = root.cloneNode(true);
    const clonedExecutions = [...clone.querySelectorAll('code-block')].filter(block => block.querySelector('.code-result-container'));
    const originals = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((element, index) => {
        const style = getComputedStyle(element);
        // Collapsed tool execution blocks are not part of the final answer.
        if (style.display === 'none' || style.visibility === 'hidden' || element.hidden) {
            copies[index].remove();
        }
    });
    clonedExecutions.forEach(block => block.remove());
    clone.querySelectorAll('follow-up, elicitations-group, mini-app, thought-container, thought-box, .thought-container, .thought-wrapper, .model-thought, [data-thought]').forEach(element => element.remove());
    // Gemini keeps the original LaTeX here; rendered glyph order is lossy.
    clone.querySelectorAll('[data-math]').forEach(element => {
        const source = element.getAttribute('data-math') || '';
        // Gemini expands norm aliases and drops optional row spacing in displayed TeX.
        // Keep double norm bars distinct from single absolute-value bars.
        element.replaceWith(document.createTextNode(source.replace(/\\\\\s*\[[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:ex|em|pt|pc|px|cm|mm|in)\]/g, '\\\\').replace(/\\Vert\{\}/g, '\\|').replace(/\\vert\{\}/g, '|')));
    });
    // Gemini wraps generated images in a clickable button. Read image evidence
    // before removing control text; disk assertions still require real assets.
    const hasImages = clone.querySelectorAll('img, [data-image-id]').length > 0;
    clone.querySelectorAll('button, .code-block-decoration, .cdk-visually-hidden, [aria-hidden="true"]').forEach(element => element.remove());
    return {
        text: (clone.textContent || '').trim(),
        hasImages,
        codeBlocks: [...clone.querySelectorAll('pre')].map(pre => (pre.querySelector('code') || pre).textContent || ''),
        executionBlocks,
    };
}
