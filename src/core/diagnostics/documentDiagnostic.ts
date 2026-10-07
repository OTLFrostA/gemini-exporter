/** Side-channel problem record shared by parsing, preparation and rendering. Never an AST node. */
export interface DocumentDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    path?: string;
}
