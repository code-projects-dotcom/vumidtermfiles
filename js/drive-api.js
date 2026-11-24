/* Apps Script client. JSONP is used because ContentService cannot set CORS headers. */
(function () {
  "use strict";
  const C = window.VUF_CONFIG; let n = 0; const mem = new Map();

  function jsonp(params, timeout) {
    return new Promise((resolve, reject) => {
      if (!C.API_URL) return reject({ code: "NO_API", message: "The resource server is not connected yet." });
      const cb = "__vuf" + (++n) + "_" + Date.now(), s = document.createElement("script");
      const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
      const t = setTimeout(() => { done(); reject({ code: "TIMEOUT", message: "Google Drive is taking too long to respond." }); }, timeout || 25000);
      window[cb] = (d) => { done(); d && d.ok ? resolve(d.data) : reject((d && d.error) || { code: "BAD", message: "Unexpected response." }); };
      s.onerror = () => { done(); reject({ code: "NETWORK", message: "Could not reach Google Drive. Check your connection." }); };
      s.src = C.API_URL + (C.API_URL.includes("?") ? "&" : "?") + new URLSearchParams(Object.assign({}, params, { callback: cb }));
      document.head.appendChild(s);
    });
  }
  const ttl = () => C.CACHE_MINUTES * 60000;
  function cached(key, loader) {
    const h = mem.get(key); if (h && Date.now() - h.t < ttl()) return Promise.resolve(h.d);
    return loader().then((d) => { mem.set(key, { t: Date.now(), d }); return d; });
  }
  window.VUF_API = {
    subjects() {
      try { const r = JSON.parse(sessionStorage.getItem("vuf_subjects") || "null"); if (r && Date.now() - r.t < ttl()) return Promise.resolve(r.d); } catch (_) {}
      return jsonp({ action: "subjects" }).then((d) => {
        try { sessionStorage.setItem("vuf_subjects", JSON.stringify({ t: Date.now(), d: d.subjects })); } catch (_) {}
        return d.subjects;
      });
    },
    files: (id) => cached("f:" + id, () => jsonp({ action: "files", id })),
    zip: (id) => jsonp({ action: "zip", id }, C.ZIP_TIMEOUT_MS)
  };
})();
