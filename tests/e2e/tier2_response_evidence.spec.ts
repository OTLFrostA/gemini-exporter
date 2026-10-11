import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/framework/driver/authored_response.js', 'utf8');

test('live evidence preserves source math and final code while excluding collapsed execution and UI', async ({ page }) => {
    await page.setContent(`<div id="answer">
        <div class="code-block-decoration">Python<button>Copy code</button></div>
        <div style="display: none">Hidden reasoning
            <pre>print('intermediate execution')</pre>
        </div>
        <div style="display:none"><code-block><pre><code class="code-container">print('executed')
    value = 1</code></pre><pre><code class="code-result-container">executed
</code></pre></code-block></div>
        <follow-up><div>Suggested follow-up</div></follow-up>
        <mini-app><div>Was this visual helpful?</div></mini-app>
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
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);
    expect(evidence.text).toContain('v = \\frac{c}{\\sqrt{\\varepsilon_r}}');
    expect(evidence.text).toContain("print('final code')");
    expect(evidence.text).toContain("value = '<br>'");
    expect(evidence.text).toContain('Keep the entire final recommendation.');
    expect(evidence.text).not.toMatch(/reasoning|intermediate execution|Copy code|Python|Gemini said|Share|Suggested follow-up|Was this visual helpful/);
    expect(evidence.hasImages).toBe(true);
    expect(evidence.codeBlocks).toEqual(["print('final code')\nvalue = '<br>'"]);
    expect(evidence.executionBlocks).toEqual([{code: "print('executed')\n    value = 1", stdout: 'executed\n'}]);
    expect(await page.locator('#answer').innerHTML()).toBe(before);
});
