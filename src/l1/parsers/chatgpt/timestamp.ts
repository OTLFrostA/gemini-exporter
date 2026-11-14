import { parseEpochOrIsoTimestamp } from '../shared/time.js';

/** ChatGPT numeric source dates use seconds (or already-millisecond values); strings use ISO dates. */
export function chatGPTTimestamp(value: unknown): number | undefined {
    return parseEpochOrIsoTimestamp(value);
}
