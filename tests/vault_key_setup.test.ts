import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultKeySetup, prepareOneTimeVaultKey } from '../src/application/vault/vaultKeySetup.js';
import { MASTER_KEY_BYTES, formatRecoveryKey } from '../src/shared/crypto/index.js';

test('Vault key setup clears owned recovery buffers on success and failure', async t => {
    const valid = await formatRecoveryKey(new Uint8Array(MASTER_KEY_BYTES).fill(42));
    const incorrectChecksum = 'GEK1-B' + valid.slice(6);
    const invalidAlphabet = valid.slice(0, -1) + 'U';
    const invalidPadding = valid.slice(0, -1) + '1';
    const activate = t.mock.fn(async () => ({ keyFingerprint: '', resolution: 'initialized' as const }));
    const setup = createVaultKeySetup(activate);
    const simulatedFailure = new Error('digest unavailable');
    const generate = () => prepareOneTimeVaultKey();
    const importValid = () => setup(valid, 'imported', null);
    const rejectInvalid = (value: string) => assert.rejects(setup(value, 'imported', null), { code: 'CLOUD_KEY_INVALID' });

    for (const [label, action, digestFails, expectedDigests] of [
        ['generate', generate, false, 1],
        ['import', importValid, false, 1],
        ['bad checksum', () => rejectInvalid(incorrectChecksum), false, 1],
        ['invalid alphabet', () => rejectInvalid(invalidAlphabet), false, 0],
        ['invalid padding', () => rejectInvalid(invalidPadding), false, 0],
        ['generate with failed digest', () => assert.rejects(generate(), simulatedFailure), true, 1],
        ['import with failed digest', () => assert.rejects(importValid(), simulatedFailure), true, 1],
    ] as const) {
        await t.test(label, async subtest => {
            const ownedBuffers: Uint8Array[] = [];
            const digestInputs: ArrayBufferView[] = [];
            const digest = crypto.subtle.digest.bind(crypto.subtle);
            subtest.mock.method(crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
                if (ArrayBuffer.isView(data)) digestInputs.push(data);
                if (digestFails) throw simulatedFailure;
                return digest(algorithm, data);
            });
            const Bytes = Uint8Array;
            globalThis.Uint8Array = new Proxy(Bytes, {
                construct(target, args, newTarget) {
                    const buffer = Reflect.construct(target, args, newTarget) as Uint8Array;
                    if (args[0] === MASTER_KEY_BYTES + 2) ownedBuffers.push(buffer);
                    return buffer;
                },
            });
            try {
                await action();
            } finally {
                globalThis.Uint8Array = Bytes;
            }
            assert.equal(digestInputs.length, expectedDigests);
            assert.equal(
                digestInputs.every(view => new Bytes(view.buffer, view.byteOffset, view.byteLength).every(byte => byte === 0)),
                true,
                'checksum input is cleared',
            );
            assert.equal(ownedBuffers.every(buffer => buffer.every(byte => byte === 0)), true, 'recovery buffer is cleared');
        });
    }
    assert.equal(activate.mock.callCount(), 1, 'only the valid import reaches activation');
});
