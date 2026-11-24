(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safe = (u) => (/^https:\/\//.test(u) ? u : "#");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = window.VUF_CONFIG, S = window.VUF_Search, API = window.VUF_API;
  const input = $("#q"), clearBtn = $("#clear"), form = $("#searchForm"), sug = $("#sug"), panel = $("#results"), body = $("#resultsBody");
  let subjects = null, pending = null, items = [], active = -1, timer;

  const state = (icon, title, msg, extra) => `<div class="state"><span class="state-ico"><i class="bi ${icon}"></i></span><h3>${title}</h3><p>${msg}</p>${extra || ""}</div>`;
  const skeleton = () => `<div class="skel" aria-busy="true" aria-label="Loading"><i></i><i></i><i></i><i></i></div>`;
  function show(html, scroll) {
    body.innerHTML = html; panel.hidden = false;
    body.classList.remove("enter"); void body.offsetWidth; body.classList.add("enter");
    if (scroll) panel.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
  function showError(e, retry) {
    show(state("bi-wifi-off", "Couldn't load resources", esc(e.message || "Something went wrong."), '<button class="btn-main" id="retry"><i class="bi bi-arrow-clockwise"></i>Try again</button>'), true);
    $("#retry").onclick = retry;
  }
  function loadSubjects() {
    if (!pending) pending = API.subjects().then((s) => (subjects = s)).finally(() => (pending = null));
    return pending;
  }

  async function search(q) {
    q = q.trim(); hideSug(); if (!q) return;
    if (!subjects) { show(skeleton(), true); try { await loadSubjects(); } catch (e) { return showError(e, () => search(q)); } }
    const r = S.rank(subjects, q);
    if (!r.hasTokens) return show(state("bi-search", "What are you looking for?", "Type a subject code like CS101 or a course name."), true);
    if (!r.list.length) return show(state("bi-hourglass-split", "Coming Soon", "We're working on adding resources for this subject. Please check back soon!"), true);
    const l = r.list;
    if (l.length === 1 || (l[0].score >= 100 && (l[1] ? l[1].score : 0) < 100)) return openSubject(l[0].subject);
    show(`<div class="head"><div><h2 class="h-title">${l.length} subjects found</h2><p class="h-sub">Choose one to see its files</p></div></div><ul class="choices">` +
      l.slice(0, 30).map((x, i) => { const p = S.parse(x.subject.name); return `<li><button data-i="${i}"><b>${esc(p.code || x.subject.name)}</b><span>${esc(p.title && p.code ? p.title : "")}</span><i class="bi bi-chevron-right"></i></button></li>`; }).join("") + "</ul>", true);
    body.querySelectorAll(".choices button").forEach((b) => (b.onclick = () => openSubject(l[+b.dataset.i].subject)));
  }

  const KINDS = [[(m, n) => m === "application/pdf", "PDF", "bi-file-earmark-pdf", "k-pdf"], [(m, n) => /word|msword|document$/.test(m) || /\.docx?$/.test(n), "DOC", "bi-file-earmark-word", "k-doc"],
    [(m, n) => /sheet|excel/.test(m) || /\.(xlsx?|csv)$/.test(n), "XLS", "bi-file-earmark-excel", "k-xls"], [(m, n) => /presentation|powerpoint/.test(m) || /\.pptx?$/.test(n), "PPT", "bi-file-earmark-ppt", "k-ppt"],
    [(m) => m.startsWith("image/"), "IMG", "bi-file-earmark-image", "k-img"], [(m) => /zip|rar|7z/.test(m), "ZIP", "bi-file-earmark-zip", "k-zip"],
    [(m) => m.startsWith("video/"), "VIDEO", "bi-file-earmark-play", "k-vid"], [(m) => m.startsWith("text/"), "TXT", "bi-file-earmark-text", "k-def"]];
  function kind(f) { const n = f.name.toLowerCase(); for (const k of KINDS) if (k[0](f.mime, n)) return k.slice(1); return [(n.split(".").pop() || "FILE").slice(0, 4).toUpperCase(), "bi-file-earmark", "k-def"]; }
  function size(b) { if (!b) return ""; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + " " + u[i]; }

  async function openSubject(s) {
    hideSug(); show(skeleton(), true);
    let d; try { d = await API.files(s.id); } catch (e) { return showError(e, () => openSubject(s)); }
    const p = S.parse(s.name), title = p.code ? `${esc(p.code)}${p.title ? " – " + esc(p.title) : ""}` : esc(s.name);
    if (!d.files.length) return show(state("bi-hourglass-split", "Coming Soon", `${title}: files are being added. Please check back soon!`));
    const rows = d.files.map((f) => { const k = kind(f), meta = [k[0], size(f.size), f.path].filter(Boolean).map(esc).join(" · ");
      return `<li class="frow"><a class="fmain" href="${esc(safe(f.view))}" target="_blank" rel="noopener noreferrer"><span class="ficon ${k[2]}"><i class="bi ${k[1]}"></i></span><span class="finfo"><span class="fname">${esc(f.name)}</span><span class="fmeta">${meta}</span></span><i class="bi bi-box-arrow-up-right fopen" title="Open"></i></a><a class="fbtn" href="${esc(safe(f.download))}" rel="noopener noreferrer" aria-label="Download ${esc(f.name)}" title="Download"><i class="bi bi-download"></i></a></li>`; }).join("");
    show(`<div class="head"><div><h2 class="h-title">${title}</h2><p class="h-sub">Midterm Preparation Resources</p><span class="count"><i class="bi bi-files"></i>${d.files.length} File${d.files.length > 1 ? "s" : ""} Available</span></div>
      <button class="btn-main" id="zipBtn"><i class="bi bi-file-earmark-zip"></i><span>Download All Files</span></button></div><div id="zipMsg" role="status" aria-live="polite"></div>
      ${d.skipped ? `<p class="note">${d.skipped} file(s) could not be read and are not listed.</p>` : ""}<ul class="files">${rows}</ul>`);
    $("#zipBtn").onclick = () => zip(s);
  }

  async function zip(s) {
    const btn = $("#zipBtn"), msg = $("#zipMsg"); if (btn.disabled) return;
    btn.disabled = true; btn.classList.add("busy"); btn.querySelector("span").textContent = "Preparing ZIP…"; msg.innerHTML = '<p class="note">Building your ZIP. This can take up to a minute for big subjects…</p>';
    try {
      const r = await API.zip(s.id), a = document.createElement("a"); a.href = safe(r.url); a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click(); a.remove();
      msg.innerHTML = `<p class="note ok"><i class="bi bi-check-circle-fill"></i> ${esc(r.name)} · ${r.count} files · ${size(r.bytes)}. Download started. <a href="${esc(safe(r.url))}" rel="noopener noreferrer">Tap here if it didn't.</a></p>`;
    } catch (e) { msg.innerHTML = `<p class="note err"><i class="bi bi-exclamation-triangle-fill"></i> ${esc(e.message || "ZIP could not be created.")} You can still download files one by one below.</p>`; }
    btn.disabled = false; btn.classList.remove("busy"); btn.querySelector("span").textContent = "Download All Files";
  }

  /* Suggestions */
  function hideSug() { sug.hidden = true; sug.innerHTML = ""; active = -1; items = []; input.setAttribute("aria-expanded", "false"); }
  function suggest() {
    const q = input.value.trim(); if (!q || !subjects) return hideSug();
    const r = S.rank(subjects, q); items = r.list.slice(0, 6).map((x) => x.subject);
    if (!items.length) return hideSug();
    sug.innerHTML = items.map((s, i) => { const p = S.parse(s.name); return `<li role="option" data-i="${i}"><b>${esc(p.code || s.name)}</b> <span>${esc(p.code ? p.title : "")}</span></li>`; }).join("");
    sug.hidden = false; active = -1; input.setAttribute("aria-expanded", "true");
  }
  const mark = () => sug.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", i === active));
  input.addEventListener("input", () => { clearBtn.hidden = !input.value; clearTimeout(timer); timer = setTimeout(suggest, C.DEBOUNCE_MS); });
  input.addEventListener("keydown", (e) => {
    if (sug.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
    else if (e.key === "Escape") hideSug();
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); const s = items[active]; input.value = s.name; openSubject(s); }
  });
  sug.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (!li) return; e.preventDefault(); const s = items[+li.dataset.i]; input.value = s.name; clearBtn.hidden = false; openSubject(s); });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) hideSug(); });
  clearBtn.onclick = () => { input.value = ""; clearBtn.hidden = true; hideSug(); input.focus(); };
  form.addEventListener("submit", (e) => { e.preventDefault(); search(input.value); });

  /* Scroll reveal */
  const els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduced) { const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { threshold: 0.12 }); els.forEach((el) => io.observe(el)); }
  else els.forEach((el) => el.classList.add("in"));

  loadSubjects().catch(() => {}); // prefetch; errors are shown (with retry) when the student searches
})();
