/* Subject matching over the real folder list returned by Drive. */
(function (root) {
  "use strict";
  const STOP = new Set("file files mid midterm mids paper papers past solved mcq mcqs note notes resource resources preparation prep study material materials vu of for the and subject course download all question questions".split(" "));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  function parse(name) {
    const m = name.match(/^([A-Za-z]{2,5}\s*-?\s*\d{2,4}[A-Za-z]?)\s*[-–—:_.]*\s*(.*)$/);
    return m ? { code: m[1].replace(/[\s-]+/g, "").toUpperCase(), title: m[2].trim() } : { code: "", title: name.trim() };
  }

  function rank(subjects, query) {
    const tokens = norm(query).split(" ").filter((t) => t && !STOP.has(t));
    if (!tokens.length) return { hasTokens: false, list: [] };
    const joined = tokens.join("");
    const list = [];
    subjects.forEach((s) => {
      const hay = norm(s.name), compact = hay.replace(/ /g, ""), code = parse(s.name).code.toLowerCase();
      if (!tokens.every((t) => hay.includes(t) || compact.includes(t))) return;
      let score = 1;
      if (code && joined === code) score = 100;
      else if (code && code.startsWith(joined)) score = 80;
      else if (compact.startsWith(joined)) score = 70;
      else if (compact.includes(joined)) score = 40;
      tokens.forEach((t) => { if (hay.split(" ").some((w) => w.startsWith(t))) score += 5; });
      list.push({ subject: s, score });
    });
    list.sort((a, b) => b.score - a.score || a.subject.name.localeCompare(b.subject.name, undefined, { numeric: true }));
    return { hasTokens: true, list };
  }
  const api = { rank, parse, norm };
  if (typeof module !== "undefined") module.exports = api; else root.VUF_Search = api;
})(typeof window !== "undefined" ? window : globalThis);
