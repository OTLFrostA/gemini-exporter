/** Resource acquisition output. Bytes and acquisition failures travel beside the document tree. */
export interface PreparedResource {
    bytes?: Uint8Array;
    mediaType?: string;
    name?: string;
    failureReason?: string;
}
export type PreparedResources = ReadonlyMap<string, PreparedResource>;
