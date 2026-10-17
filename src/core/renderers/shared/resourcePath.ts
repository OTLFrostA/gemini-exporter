/** Packaging supplies relative file paths. Reject unsafe bindings rather than fetching them. */
export function isResourcePath(path: string | undefined): path is string {
    return Boolean(path && !/(^\s|^\/|\\|^[a-z][a-z\d+.-]*:|(^|\/)\.\.(\/|$)|[\u0000-\u001f])/i.test(path));
}
