import { deriveVaultKeyring, formatRecoveryKey, generateMasterKeyBytes, parseRecoveryKey } from '../../shared/crypto/index.js';
import { activateDefaultVaultKeyring } from './cloudSyncEngine.js';

export async function prepareOneTimeVaultKey(): Promise<string> {
    const bytes = generateMasterKeyBytes();
    try {
        return await formatRecoveryKey(bytes);
    } finally {
        bytes.fill(0);
    }
}

export function createVaultKeySetup(activate = activateDefaultVaultKeyring) {
    return async (value: string, origin: 'generated' | 'imported', expectedFingerprint: string | null) => {
        const parsing = parseRecoveryKey(value);
        value = '';
        const bytes = await parsing;
        const keyring = await deriveVaultKeyring(bytes).finally(() => bytes.fill(0));
        return activate(keyring, origin, expectedFingerprint);
    };
}

export const commitOneTimeVaultKey = createVaultKeySetup();
