/** Persisted semantic quality. Parser evidence belongs beside the Domain snapshot. */
export type SourceTurnStatus = 'finished' | 'unfinished' | 'interrupted' | 'handoff' | 'awaiting_reply' | 'tool_pending' | 'unknown';
/** A fully acquired snapshot has a deterministic parser gap. Its quality stays
 * partial; fetching identical input only helps after the source or parser changes. */
export interface ContentRepairPolicy {
    reason: 'source_annotations_unrepresented';
    retry: 'source_or_parser_change';
    parserRevision: string;
}
/** Coverage, failure reason and retry policy are independent facts. A repair
 * policy only describes known partial snapshots, never unknown/complete ones. */
export type ContentQuality = {
    sourceTurn?: SourceTurnStatus;
} & ({ status: 'complete' | 'unknown'; repair?: never }
    | { status: 'partial'; repair?: ContentRepairPolicy });
