import type { ExportResult } from '../../application/export/types.js';

export interface ContentBadgePort {
    ensureBadge(): void;
    refreshAccount(): Promise<unknown>;
    showLiveSaveResult?: (result: ExportResult | null, accountId: string) => void;
    showLiveSaveError?: (accountId: string) => void;
}

let badge: ContentBadgePort | undefined;

export function provideContentBadge(value: ContentBadgePort): void {
    badge = value;
}

export function contentBadge(): ContentBadgePort | undefined {
    return badge;
}
