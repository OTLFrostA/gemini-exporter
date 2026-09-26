/**
 * Ambient declarations for Typst template text imports.
 * build.js bundles .typ/.tmTheme files with the esbuild 'text' loader;
 * tsc only needs to know they resolve to strings.
 */
declare module '*.typ' {
    const text: string;
    export default text;
}

declare module '*.tmTheme' {
    const text: string;
    export default text;
}
