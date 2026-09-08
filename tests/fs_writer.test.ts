import test from 'node:test';
import assert from 'node:assert';

import { FsWriter, ensureSubDir, sanitizeFileName } from '../src/core/engine/writers/fsWriter.js';

test('fsWriter - exports and helpers', () => {
    assert.ok(FsWriter);
    assert.strictEqual(typeof ensureSubDir, 'function');
    assert.strictEqual(typeof sanitizeFileName, 'function');
});

test('fsWriter - sanitizeFileName', () => {
    assert.strictEqual(sanitizeFileName('valid_name.md'), 'valid_name.md');
    assert.strictEqual(sanitizeFileName(''), 'untitled');
});

