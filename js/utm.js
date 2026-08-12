/**
 * Captura UTMs / click IDs da URL no 1º acesso e guarda em localStorage.
 * Sempre envie esses dados no campo "utm" da BravoPay (UTMify).
 */
(function () {
  const KEY = "cnc_utm";
  const FIELDS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "ttclid",
    "gclid",
  ];

  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function captureFromUrl() {
    const params = new URLSearchParams(location.search);
    const current = readStored();
    let changed = false;

    for (const field of FIELDS) {
      const value = params.get(field);
      if (value) {
        // BravoPay usa source/medium/... sem o prefixo utm_
        const key = field.startsWith("utm_") ? field.replace(/^utm_/, "") : field;
        current[key] = value;
        changed = true;
      }
    }

    if (changed) {
      current.captured_at = new Date().toISOString();
      current.landing_page = location.href;
      localStorage.setItem(KEY, JSON.stringify(current));
    }
  }

  function getUtm() {
    const data = readStored();
    // Remove metadados internos
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (["captured_at", "landing_page"].includes(k)) continue;
      if (v) out[k] = v;
    }
    return out;
  }

  captureFromUrl();
  window.UTM = { getUtm, captureFromUrl };
})();
