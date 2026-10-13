import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/framework/driver/authored_response.js', 'utf8');

test('live evidence preserves source math and final code while excluding collapsed execution and UI', async ({ page }) => {
    await page.setContent(`<model-response id="answer"><h5>Gemini said</h5><model-response-content><div class="markdown-main-panel">
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
        </div><div class="markdown-main-panel"><p>Keep the entire final recommendation.</p>
        <span class="cdk-visually-hidden">Gemini said</span><button>Share</button>
        <button class="image-button"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></button>
    </div></model-response-content><footer>Outside feedback</footer></model-response>`);
    const before = await page.locator('#answer').innerHTML();
    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);
    expect(evidence.text).toContain('v = \\frac{c}{\\sqrt{\\varepsilon_r}}');
    expect(evidence.text).toContain("print('final code')");
    expect(evidence.text).toContain("value = '<br>'");
    expect(evidence.text).toContain('Keep the entire final recommendation.');
    expect(evidence.text).not.toContain('Outside feedback');
    expect(evidence.text).not.toMatch(/reasoning|intermediate execution|Copy code|Python|Gemini said|Share|Suggested follow-up|Was this visual helpful/);
    expect(evidence.hasImages).toBe(true);
    expect(evidence.codeBlocks).toEqual(["print('final code')\nvalue = '<br>'"]);
    expect(evidence.executionBlocks).toEqual([{code: "print('executed')\n    value = 1", stdout: 'executed\n'}]);
    expect(await page.locator('#answer').innerHTML()).toBe(before);
});

test('live evidence captures silent execution source separately without leaking hidden thinking', async ({ page }) => {
    await page.setContent(`<model-response id="answer"><model-response-content>
        <code-block><div class="code-block" style="display:none"><pre><code class="code-container"># silent execution</code></pre></div></code-block>
        <thought-container style="display:none"><code-block><div class="code-block" style="display:none"><pre><code class="code-container"># hidden thought</code></pre></div></code-block></thought-container>
        <code-block><div class="code-block"><pre><code class="code-container">print('visible program')</code></pre></div></code-block>
        <p>Complete final answer.</p>
    </model-response-content></model-response>`);
    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);
    expect(evidence.executionBlocks).toEqual([{code: '# silent execution', stdout: ''}]);
    expect(evidence.codeBlocks).toEqual(["print('visible program')"]);
    expect(evidence.text).toContain('Complete final answer.');
    expect(evidence.text).not.toContain('# silent execution');
    expect(evidence.text).not.toContain('# hidden thought');
});

test('live evidence excludes hidden and collapsed thinking content from authored text', async ({ page }) => {
    await page.setContent(`<model-response id="answer"><model-response-content><div class="markdown-main-panel">
        <thought-container style="display:none">
            <p>Evaluating internal reasoning path A vs path B.</p>
            <pre><code>scratchpad = {'step': 1}</code></pre>
        </thought-container>
        <div class="thought-wrapper" hidden>
            <span>Candidate thought: this should be omitted from final answer.</span>
        </div>
        <div class="model-thought" style="visibility:hidden">
            <span>Hidden internal thought chain.</span>
        </div>
        <p>This is the authored answer paragraph.</p>
        <code-block><pre><code>result = compute_final_output()</code></pre></code-block>
    </div></model-response-content></model-response>`);

    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);

    expect(evidence.text).toContain('This is the authored answer paragraph.');
    expect(evidence.text).toContain('result = compute_final_output()');
    expect(evidence.text).not.toMatch(/reasoning path|scratchpad|Candidate thought|thought chain|omitted/);
    expect(evidence.codeBlocks).toEqual(['result = compute_final_output()']);
});

test('live evidence preserves inline and block LaTeX formulas', async ({ page }) => {
    await page.setContent(`<model-response id="answer"><model-response-content><div class="markdown-main-panel">
        <p>质能方程：<span data-math="E = mc^2"><span aria-hidden="true">Emc2</span></span>，微积分基本定理：</p>
        <div data-math="\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)"><span aria-hidden="true">rendered integral</span></div>
        <p>结论成立。</p>
    </div></model-response-content></model-response>`);

    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);

    expect(evidence.text).toContain('E = mc^2');
    expect(evidence.text).toContain('\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)');
    expect(evidence.text).not.toContain('Emc2');
    expect(evidence.text).not.toContain('rendered integral');
});

test('live evidence preserves exact code block indentation and internal line breaks', async ({ page }) => {
    const authoredCode = 'def process(data):\n    if not data:\n        return None\n\n    # Preserve empty line above\n    return [x * 2 for x in data]';
    await page.setContent(`<model-response id="answer"><model-response-content><div class="markdown-main-panel">
        <p>下面是实现函数：</p>
        <code-block><div class="code-block-decoration">Python<button>Copy</button></div><pre><code>${authoredCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></code-block>
    </div></model-response-content></model-response>`);

    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string; hasImages: boolean; codeBlocks: string[]; executionBlocks: {code: string; stdout: string}[] };
    }, source);

    expect(evidence.codeBlocks).toEqual([authoredCode]);
    expect(evidence.text).toContain('下面是实现函数：');
    expect(evidence.text).not.toContain('Copy');
});


test('real norm alias evidence keeps double bars distinct from absolute value and literal prose', async ({ page }) => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/provider/math/gemini_norm_alias.json', 'utf8')) as { domSource: string; rpcSource: string };
    const literal = String.raw`Literal prose \Vert{} and code \Vert{} must stay exact.`;
    await page.setContent('<model-response id="answer"><model-response-content><div class="markdown-main-panel"><span id="norm" data-math=""></span><p id="literal"></p><span id="absolute" data-math=""></span></div></model-response-content></model-response>');
    await page.evaluate(({ fixture, literal }) => {
        document.querySelector('#norm')!.setAttribute('data-math', fixture.domSource);
        document.querySelector('#literal')!.textContent = literal;
        document.querySelector('#absolute')!.setAttribute('data-math', String.raw`\vert{}x\vert{} + \Vert{x}`);
    }, { fixture, literal });
    const evidence = await page.evaluate(source => {
        const extract = new Function('return (\n' + source + '\n)')();
        return extract(document.querySelector('#answer')) as { text: string };
    }, source);
    expect(evidence.text).toBe(fixture.rpcSource + literal + String.raw`|x| + \Vert{x}`);
    expect(evidence.text).toContain(String.raw`\|\vec{ab}\|`);
    expect(evidence.text).not.toContain(String.raw`|\vec{ab}|`);
});


test('PDF source segments cover every authored character in prose, table cells, math and code', async ({ page }) => {
    await page.setContent(`<model-response id="answer"><model-response-content><p>First <strong>sentence.</strong></p>
        <table><tr><td>Cell A <span data-math="x/y">rendered</span> tail.</td><td>Cell B.</td></tr></table>
        <pre><code>if x &lt; 3:\n    print("中文")</code></pre><p>Last sentence.</p>
    </model-response-content></model-response>`);
    const evidence = await page.evaluate(source => {
        const read = new Function('return (\n' + source + '\n)')();
        return read(document.querySelector('#answer')) as {text: string; pdfSegments: {kind: string; text: string}[]};
    }, source);
    expect(evidence.pdfSegments.map(segment => segment.text).join('').replace(/\s/g, '')).toBe(evidence.text.replace(/\s/g, ''));
    expect(evidence.pdfSegments.filter(segment => segment.kind === 'math')).toEqual([{kind: 'math', text: 'x/y'}]);
    expect(evidence.pdfSegments.filter(segment => segment.kind === 'code')).toEqual([{kind: 'code', text: 'if x < 3:\n    print("中文")'}]);
    expect(evidence.pdfSegments.filter(segment => segment.kind === 'text').map(segment => segment.text)).toEqual(['First sentence.', 'Cell A ', ' tail.', 'Cell B.', 'Last sentence.']);
});
