import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { validateParserDomain, restoreDomainSnapshot, type TrustedDomain } from '../src/core/domain/runtimeValidation.js';
function typeContract(domain: DomainConversationDetail, raw: unknown): void {
    // @ts-expect-error An ordinary builder cannot manufacture trust.
    const forged: TrustedDomain = domain;
    // @ts-expect-error Raw data must pass recovery, not the typed parser boundary.
    validateParserDomain(raw);
    const parsed: TrustedDomain = validateParserDomain(domain);
    const restored: TrustedDomain = restoreDomainSnapshot(raw);
    const compatible: DomainConversationDetail = parsed;
    void [forged, restored, compatible];
}
void typeContract;
