import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/framework/driver/authored_response.js', 'utf8');

test('live evidence preserves source math and final code while excluding collapsed execution and UI', async ({ page }) => {
    await page.setContent(`<div id="answer">
        <div class="code-block-decoration">Python<button>Copy code</button></div>
        <div style="display: none">Hidden reasoning
            <pre>print('intermediate execution')</pre>
        </div>
        <p>波速<span data-math="v = \\frac{c}{\\sqrt{\\varepsilon_r}}"><span aria-hidden="true">vc√εr</span></span>。</p>
        <code-block><div class="code-block-decoration">Python</div><pre><code>print('final code')
value = '&lt;br&gt;'</code></pre></code-block>
        <p>Keep the entire final recommendation.</p>
        <span class="cdk-visually-hidden">Gemini said</span><button>Share</button>
        <button class="image-button"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></button>
    </div>`);
    const before = await page.locator('#answer').innerHTML();
    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[] };
    }, source);
    expect(evidence.text).toContain('v = \\frac{c}{\\sqrt{\\varepsilon_r}}');
    expect(evidence.text).toContain("print('final code')");
    expect(evidence.text).toContain("value = '<br>'");
    expect(evidence.text).toContain('Keep the entire final recommendation.');
    expect(evidence.text).not.toMatch(/reasoning|intermediate execution|Copy code|Python|Gemini said|Share/);
    expect(evidence.hasImages).toBe(true);
    expect(evidence.codeBlocks).toEqual(["print('final code')\nvalue = '<br>'"]);
    expect(await page.locator('#answer').innerHTML()).toBe(before);
});
