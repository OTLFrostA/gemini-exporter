/** Temporary bytes and signed download credentials are execution hints, not durable locators. */
export function isDurableSourceUri(value: unknown): value is string {
    if (typeof value !== 'string' || /^(?:data|blob):/i.test(value)) return false;
    try {
        const url = new URL(value);
        // Preserve source queries intact; signed URLs cannot be made durable by stripping parameters.
        return ![...url.searchParams.keys()].some(key => /^(?:x-goog-signature|x-amz-signature)$/i.test(key));
    } catch { return true; } // Relative archive references are durable source facts.
}
