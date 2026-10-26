/* Optional GA4 for the personal website only; no network request before consent. */
(() => {
  "use strict";

  const measurementId = "G-JNJBLJPDGQ";
  const consentKey = "otlfrosta.website.analytics-consent";
  const banner = document.getElementById("analytics-consent");
  let started = false;

  function savedChoice() {
    try {
      return window.localStorage.getItem(consentKey);
    } catch {
      return null;
    }
  }

  function saveChoice(value) {
    try {
      window.localStorage.setItem(consentKey, value);
    } catch {
      // Browsers with disabled storage still allow a session-only choice.
    }
  }

  function startAnalytics() {
    if (started) return;
    started = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    const tag = document.createElement("script");
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    document.head.appendChild(tag);
  }

  function eraseAnalyticsCookies() {
    const domain = location.hostname === "otlfrosta.com" ||
      location.hostname.endsWith(".otlfrosta.com") ? "otlfrosta.com" : null;

    for (const item of document.cookie.split(";")) {
      const name = item.split("=")[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax";
      if (domain) {
        document.cookie = name + "=; Max-Age=0; Path=/; Domain=" + domain + "; SameSite=Lax";
      }
    }
  }

  function setConsent(value) {
    saveChoice(value);
    if (banner) banner.hidden = true;
    if (value === "granted") {
      startAnalytics();
    } else {
      eraseAnalyticsCookies();
      if (started) location.reload(); // Unload Google code after consent is revoked.
    }
  }

  const choice = savedChoice();
  if (choice === "granted") {
    startAnalytics();
  } else if (choice !== "denied" && banner) {
    banner.hidden = false;
  }

  document.getElementById("analytics-allow")?.addEventListener("click", () => setConsent("granted"));
  document.getElementById("analytics-decline")?.addEventListener("click", () => setConsent("denied"));
  document.getElementById("analytics-settings")?.addEventListener("click", () => {
    if (banner) banner.hidden = false;
  });

  for (const link of document.querySelectorAll("a[data-store-cta]")) {
    link.addEventListener("click", () => {
      if (!started) return;
      window.gtag("event", "store_cta_click", {
        cta_location: link.dataset.storeCta,
        link_url: link.href
      });
    });
  }
})();
