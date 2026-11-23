import corpus from '../captured/table_content_recovery.json';
import { describeFixtures, derived } from '../../provenance.js';
import { rpc, domainTurn } from './protocol.js';

function wire(markdown: string, ...tables: unknown[]): string {
    const candidate = ['rc_table', [[markdown]]];
    const turn = domainTurn('Table recovery', 1700000000, [candidate]);
    const model: unknown[] = [[candidate]];
    model[12] = [[tables]];
    turn[3] = model;
    return rpc([[turn]]);
}

// Selected table nodes and rows from a714229ffb19b514 replies 20, 23 and 46.
// The capture was cropped to the affected tables and the turn envelope is synthetic.
const first = corpus.G_TABLE_RESTORE_LL1_20;
const second = corpus.G_TABLE_RESTORE_LL1_23;
const superscript = corpus.G_TABLE_RESTORE_SUPERSCRIPT_46;
export const tableRecoveryCases = {
    'G_TABLE_RESTORE_LL1_20': () => wire(first.markdown, first.table),
    'G_TABLE_RESTORE_LL1_23': () => wire(second.markdown, second.table),
    'G_TABLE_RESTORE_SUPERSCRIPT_46': () => wire(superscript.markdown, superscript.table),
    'G_TABLE_RESTORE_CONFLICT': () => wire(first.markdown.replace('Nonterminal', 'Unrelated heading'), first.table),
    'G_TABLE_RESTORE_AMBIGUOUS': () => wire(first.markdown + '\n\n' + first.markdown, first.table),
};

export const fixtureOrigins = describeFixtures(tableRecoveryCases, derived(
    ['tests/fixtures/providers/gemini/captured/table_content_recovery.json'],
    'Native table nodes and selected Markdown rows cropped from an audited Gemini history. Uses a synthetic turn envelope and explicit conflict and duplicate variants.',
));
