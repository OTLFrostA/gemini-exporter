import { PLATFORM_HOSTS, platformOrigins, type SourcePlatform } from '../src/shared/platformHosts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('physical release ZIP contains every source script and retains all optional platform groups', () => {
    const root = path.resolve(__dirname, '..');
    const source = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { version: string };
    const archive = `gemini-exporter-v${source.version}.zip`;
    execFileSync(process.execPath, ['build.js', '--pack'], { cwd: root, stdio: 'pipe' });
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'],
        { cwd: root, encoding: 'utf8' })) as { host_permissions: string[]; optional_host_permissions: string[] };
    for (const host of (Object.keys(PLATFORM_HOSTS) as SourcePlatform[]).flatMap(platformOrigins)) {
        assert.ok(manifest.optional_host_permissions.includes(host));
        assert.ok(!manifest.host_permissions.includes(host));
    }
    for (const file of ['dist/content/hook.js', 'dist/content/content.js', 'dist/content/chatgpt-hook.js', 'dist/content/chatgpt-content.js', 'dist/content/grok-hook.js', 'dist/content/grok-content.js', 'dist/content/claude-hook.js', 'dist/content/claude-content.js']) {
        const bytes = execFileSync('unzip', ['-p', archive, file], { cwd: root });
        assert.ok(bytes.length > 0, file);
    }
    const notices = execFileSync('unzip', ['-p', archive, 'THIRD_PARTY_NOTICES.md'], { cwd: root, encoding: 'utf8' });
    assert.ok(notices.includes('Copyright (c) 2025 Yalums'));
    assert.ok(notices.includes('5ae077b5bc010d80289a851621514397cf95422b'));
    const entries = execFileSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
    assert.ok(!entries.split('\n').some(name => name.startsWith('temp/')));
});
