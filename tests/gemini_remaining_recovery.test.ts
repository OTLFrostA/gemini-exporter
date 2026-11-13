import test from 'node:test';
import { remainingRecoveryExpectations, assertRemainingRecovery } from './helpers/geminiRemainingRecovery.js';

// Native recovery is a required default CI gate, with independent expectations.
for (const expected of remainingRecoveryExpectations) {
    test(`${expected.key}: recover native visible content through RPC, Domain and Markdown`, () => {
        assertRemainingRecovery(expected);
    });
}
