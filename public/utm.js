/* First-party UTM pass-through only. No telemetry, cookies, storage, or network calls. */
(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign"];
  const incoming = new Map();

  for (const key of utmKeys) {
    const value = params.get(key);
    // Restrict to short campaign labels so arbitrary URL inputs are not forwarded.
    if (value && value.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value)) {
      incoming.set(key, value);
    }
  }

  if (incoming.size === 0) return;

  const storeHost = "chromewebstore.google.com";
  const storePath = "/detail/ldpbiafkgjlaooeplkiooljccpalpkgf";

  for (const anchor of document.querySelectorAll("a[data-store-cta]")) {
    const target = new URL(anchor.href);
    if (target.protocol !== "https:" || target.hostname !== storeHost || target.pathname !== storePath) continue;

    for (const [key, value] of incoming) {
      target.searchParams.set(key, value);
    }
    anchor.href = target.toString();
  }
})();
