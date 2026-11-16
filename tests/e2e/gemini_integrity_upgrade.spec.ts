import { test, expect } from './l2Fixtures';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type {} from '../helpers/nativeGeminiUpgrade';

let bundle: string;
test.beforeAll(async () => {
    const output = await build({ stdin: { resolveDir: resolve(__dirname, '../..'), loader: 'ts', contents: `
        import { runNativeUpgrade } from './tests/helpers/nativeGeminiUpgrade.ts';
        globalThis.geminiUpgradeProbe = { run: runNativeUpgrade };
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    bundle = output.outputFiles[0].text;
});

for (const mode of ['large', 'abort'] as const) {
    test(`native Chromium Gemini v1 upgrade: ${mode === 'large' ? '6,144 full histories without bulk reads' : 'mid-upgrade rollback and pooled-open recovery'}`, async ({ context, extensionId }, testInfo) => {
        test.setTimeout(120_000);
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/src/ui/options/options.html`);
        await page.evaluate(bundle);
        const result = await page.evaluate(mode => globalThis.geminiUpgradeProbe.run(mode), mode);
        const measurements = testInfo.outputPath('native-upgrade-measurements.json');
        await writeFile(measurements, JSON.stringify(result, null, 2));
        await testInfo.attach('native-upgrade-measurements', { path: measurements, contentType: 'application/json' });
        expect(result.verified).toBe(result.conversations);
        if (mode === 'large') {
            expect(result.bodyBytes).toBeGreaterThan(190_000_000);
            expect(result.updates).toBeGreaterThan(0);
        } else {
            expect(result.failedOpen).toBe('AbortError');
            expect(result.rollbackVerified).toBe(result.conversations);
        }
    });
}
