import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOwnedDocument, createDriveDocumentClient, DriveHttpError } from '../src/runtime/capabilities/driveDocumentClient.js';
import { readDriveExportConnection } from '../src/shared/types/driveExport.js';

const json = (value: object, status = 200) => new Response(JSON.stringify(value), { status });
const sourceAccountId = '01234567-89ab-4def-8123-456789abcdef';

test('Drive export binding requires explicit source and destination identity', () => {
    const binding = { sourceAccountId, destinationPermissionId: 'permission-1', destinationEmail: 'test@example.com', folderId: 'folder_1' };
    assert.deepEqual(readDriveExportConnection(binding), binding);
    assert.equal(readDriveExportConnection({ ...binding, sourceAccountId: 'default' }), null);
    assert.equal(readDriveExportConnection({ ...binding, folderId: '../root' }), null);
    assert.equal(readDriveExportConnection(null), null);
});

test('Drive client validates account identity and fixes API origin', async () => {
    const client = createDriveDocumentClient('synthetic-token', async (url, init) => {
        assert.equal(new URL(url).origin, 'https://www.googleapis.com');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-token');
        assert.equal(init.redirect, 'error');
        return json({ user: { permissionId: 'permission-1', emailAddress: 'test@example.com' } });
    });
    assert.deepEqual(await client.about(), { permissionId: 'permission-1', email: 'test@example.com' });
    await assert.rejects(createDriveDocumentClient('test', async () => json({ user: {} })).about(), TypeError);
});

test('Drive multipart upload uses preallocated identity; updates preserve file ID', async () => {
    let calls = 0;
    const client = createDriveDocumentClient('test', async (url, init) => {
        calls++;
        assert.ok(init.body instanceof Blob);
        const body = await init.body.text();
        assert.match(body, /"geExportKey":"key"/);
        assert.match(body, /"geDigest":"digest"/);
        assert.match(body, /Hello world/);
        if (calls === 1) {
            assert.equal(init.method, 'POST');
            assert.match(body, /"id":"allocated"/);
            assert.match(body, /"parents":\["folder"\]/);
        } else {
            assert.equal(init.method, 'PATCH');
            assert.match(url, /\/files\/allocated\?/);
            assert.doesNotMatch(body, /"parents"/);
        }
        return json({ id: 'allocated' });
    });
    const input = { id: 'allocated', folderId: 'folder', exportKey: 'key', digest: 'digest',
        document: { name: 'test.md', markdown: '# Hello world' } };
    await client.writeDocument({ ...input, create: true });
    await client.writeDocument({ ...input, create: false });
    assert.equal(calls, 2);
});

test('Drive metadata guards refuse moved, trashed, or foreign documents', async () => {
    const client = createDriveDocumentClient('test', async () => json({
        id: 'allocated', parents: ['folder'], trashed: false, mimeType: 'text/markdown',
        appProperties: { geExportKey: 'key', geDigest: 'digest' },
    }));
    const file = await client.getDocument('allocated');
    assert.ok(file);
    assertOwnedDocument(file, 'allocated', 'folder', 'key');
    assert.throws(() => assertOwnedDocument({ ...file, trashed: true }, 'allocated', 'folder', 'key'));
    assert.throws(() => assertOwnedDocument(file, 'allocated', 'other', 'key'));
    assert.throws(() => assertOwnedDocument(file, 'allocated', 'folder', 'other'));
    assert.equal(await createDriveDocumentClient('test', async () => json({}, 404)).getDocument('allocated'), null);
});

test('Drive failures do not leak response body or accept unexpected identities', async () => {
    const denied = createDriveDocumentClient('test', async () => json({ error: 'private-body' }, 403));
    await assert.rejects(denied.about(), (error: unknown) =>
        error instanceof DriveHttpError && error.status === 403 && !error.message.includes('private-body'));
    const bad = createDriveDocumentClient('test', async () => json({ id: 'wrong' }));
    await assert.rejects(bad.writeDocument({ id: 'expected', folderId: 'folder', exportKey: 'key',
        digest: 'digest', document: { name: 'test.md', markdown: 'text' }, create: true }));
});
