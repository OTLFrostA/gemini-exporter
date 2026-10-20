/** Prepare a full-resolution acquisition URL while preserving authentication queries. */
export function highResVariant(url?: string | null): string {
    if (!url || typeof url !== "string") return url || "";
    if (url.includes("googleusercontent.com/p/") || url.includes("/places/v1/media")) {
        return url;
    }
    const qIdx = url.indexOf("?");
    const base = qIdx === -1 ? url : url.slice(0, qIdx);
    const query = qIdx === -1 ? "" : url.slice(qIdx);
    let resized = base.replace(/=[sw]\d+(?:-[a-z0-9]+)*$/i, "=s0");
    if ((base.includes("/gg/") || base.includes("/rd-gg/")) && !/=[sw]\d+/i.test(base) && !base.endsWith("=s0")) {
        resized = base + "=s0";
    }
    return resized + query;
}
