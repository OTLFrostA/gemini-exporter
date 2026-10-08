import type { ResourceBindings } from '../../document/ast/ast.js';
import type { ResourceDelivery, ResourceResult } from '../../resources/resourceResult.js';
import { normalizeArchivePath } from './archivePath.js';

/** Only successful delivery receipts may become local renderer bindings. */
export function prepareDomainResources(results: readonly ResourceResult<ResourceDelivery>[] = []): ResourceBindings {
    return Object.fromEntries(results.flatMap(result => result.ok
        ? [[result.resourceId, normalizeArchivePath(result.value.path)]] : []));
}
