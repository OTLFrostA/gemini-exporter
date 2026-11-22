export interface IndexIngestResult {
    added: number;
    updated: number;
}

export interface IndexAdmissionResult extends IndexIngestResult {
    accepted: number;
    rejected: number;
}

/** Committed admission result; temporary resource ownership is decided by accepted. */
export interface DetailIngestResult {
    accepted: boolean;
    changed: boolean;
    /** Present only when this committed transaction created the conversation's Index. */
    indexAdded?: true;
}
