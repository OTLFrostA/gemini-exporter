// Read the authored answer independently of the extension's parser/exporter.
// This function is embedded in the live CDP driver and exercised in a browser.
(root) => {
    if (!root) return { text: '', hasImages: false, codeBlocks: [] };
    const clone = root.cloneNode(true);
    const originals = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((element, index) => {
        const style = getComputedStyle(element);
        // Collapsed tool execution blocks are not part of the final answer.
        if (style.display === 'none' || style.visibility === 'hidden' || element.hidden) {
            copies[index].remove();
        }
    });
    // Gemini keeps the original LaTeX here; rendered glyph order is lossy.
    clone.querySelectorAll('[data-math]').forEach(element => {
        const source = element.getAttribute('data-math') || '';
        // Gemini drops optional row spacing from its displayed TeX source.
        element.replaceWith(document.createTextNode(source.replace(/\\\\\s*\[[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:ex|em|pt|pc|px|cm|mm|in)\]/g, '\\\\').replace(/\\vert\{\}/g, '|')));
    });
    // Gemini wraps generated images in a clickable button. Read image evidence
    // before removing control text; disk assertions still require real assets.
    const hasImages = clone.querySelectorAll('img, [data-image-id]').length > 0;
    clone.querySelectorAll('button, .code-block-decoration, .cdk-visually-hidden, [aria-hidden="true"]').forEach(element => element.remove());
    return {
        text: (clone.textContent || '').trim(),
        hasImages,
        codeBlocks: [...clone.querySelectorAll('pre')].map(pre => (pre.querySelector('code') || pre).textContent || ''),
    };
}
