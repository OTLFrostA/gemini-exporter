/** Renderers receive only planned relative archive paths, never resource bytes or output directories. */
export type ResourceBindings = Readonly<Record<string, string>>;
