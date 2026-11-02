const captured = require('../gemini_process_session.json');
type ProcessSessionKey = 'partial' | 'answered' | 'truncated' | 'malformed' | 'oversized'
    | 'missing-final' | 'missing-answered' | 'missing-identity';
/** Sanitized native processSession transport samples, one immutable key per variant. */
export function processSessionGen(key: ProcessSessionKey): string {
    if (key === 'partial' || key === 'answered') return captured[key];
    if (key === 'truncated') return captured.answered.slice(0, -1);
    if (key === 'malformed') return '3\n???';
    if (key === 'oversized') return '99999999999\n';
    const row = JSON.parse(captured.answered.split('\n')[1]);
    const bytes = Buffer.from(row[0][1][0], 'base64');
    if (key === 'missing-final') bytes[7] = 0;
    if (key === 'missing-answered') bytes[bytes.length - 1] = 1;
    if (key === 'missing-identity') bytes[bytes.indexOf('r_11111111')] = 'x'.charCodeAt(0);
    row[0][1][0] = bytes.toString('base64');
    const frame = JSON.stringify(row);
    return frame.length + '\n' + frame;
}
