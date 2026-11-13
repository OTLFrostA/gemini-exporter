import test from 'node:test';
import { remainingRecoveryExpectations, assertRemainingRecovery } from '../helpers/geminiRemainingRecovery.js';

// Intentionally red until native recovery is implemented. No skips, TODO flags,
// parser mocks or generated goldens. Run: npm run test:gemini-remaining
for (const expected of remainingRecoveryExpectations) {
    test(`${expected.key}: recover native visible content through RPC, Domain and Markdown`, () => {
        assertRemainingRecovery(expected);
    });
}
