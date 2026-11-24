/**
 * VU FACTS – Google Apps Script backend
 * Deploy as Web app: Execute as "Me", Who has access "Anyone".
 * Actions (GET):  ?action=subjects | files&id=FOLDER | zip&id=FOLDER   (+ &callback=fn for JSONP)
 * Security: the browser never chooses arbitrary folders. Every id is checked
 * against the real child folders of ROOT_FOLDER_ID before anything is read.
 */
const ROOT_FOLDER_ID = '1n_1rtyxxERfknSUIXMD5hr41h0uSPWL9';
const CFG = {
  CACHE_SECONDS: 600,          // subjects/files cache
  MAX_DEPTH: 3,                // nested folder levels scanned inside a subject
  MAX_ZIP_FILES: 60,           // above this: no ZIP, individual downloads only
  MAX_ZIP_BYTES: 40 * 1024 * 1024, // total source size limit for a reliable ZIP
  ZIP_KEEP_MINUTES: 60,        // temp ZIPs older than this are deleted
  ZIP_REUSE_SECONDS: 1800,     // reuse a fresh ZIP for the same subject
  TMP_FOLDER: '_VUF_ZIP_TEMP'
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    if (p.action === 'subjects') out = { ok: true, data: { subjects: getSubjects_(false) } };
    else if (p.action === 'files') out = { ok: true, data: getFiles_(p.id) };
    else if (p.action === 'zip') out = { ok: true, data: createZip_(p.id) };
    else throw fail_('BAD_ACTION', 'Unknown request.');
  } catch (ex) {
    console.error(ex && ex.stack || ex);
    out = { ok: false, error: { code: ex.code || 'SERVER_ERROR',
      message: ex.code ? ex.message : 'Google Drive is temporarily unavailable. Please try again.' } };
  }
  const json = JSON.stringify(out), cb = p.callback;
  if (cb && /^[A-Za-z_$][\w$]{0,60}$/.test(cb))
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, msg) { const e = new Error(msg); e.code = code; return e; }

function cacheGet_(k) { try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function cachePut_(k, v, s) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), s || CFG.CACHE_SECONDS); } catch (_) {} }

function getSubjects_(force) {
  if (!force) { const c = cacheGet_('subjects'); if (c) return c; }
  const list = [], it = DriveApp.getFolderById(ROOT_FOLDER_ID).getFolders();
  while (it.hasNext()) { const f = it.next(); list.push({ id: f.getId(), name: f.getName() }); }
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  cachePut_('subjects', list);
  return list;
}

// Only immediate children of the configured root are accepted.
function assertSubject_(id) {
  if (!id || !/^[\w-]{10,80}$/.test(id)) throw fail_('INVALID_FOLDER', 'Invalid subject.');
  let s = getSubjects_(false).filter(x => x.id === id)[0];
  if (!s) s = getSubjects_(true).filter(x => x.id === id)[0]; // new subject added recently
  if (!s) throw fail_('INVALID_FOLDER', 'This subject was not found.');
  return s;
}

function walk_(folder, path, depth, acc) {
  const fi = folder.getFiles();
  while (fi.hasNext()) {
    try {
      const f = fi.next(), m = f.getMimeType();
      if (m === 'application/vnd.google-apps.shortcut') continue;
      acc.files.push({ id: f.getId(), name: f.getName(), mime: m, size: f.getSize(), path: path });
    } catch (_) { acc.skipped++; }           // inaccessible or deleted file
  }
  if (depth < CFG.MAX_DEPTH) {
    const di = folder.getFolders();
    while (di.hasNext()) { try { const d = di.next(); walk_(d, path ? path + '/' + d.getName() : d.getName(), depth + 1, acc); } catch (_) { acc.skipped++; } }
  }
}

function urls_(f) {
  const nat = f.mime.indexOf('application/vnd.google-apps.') === 0, id = f.id;
  f.view = 'https://drive.google.com/file/d/' + id + '/view';
  if (!nat) f.download = 'https://drive.google.com/uc?export=download&id=' + id;
  else if (/document$/.test(f.mime)) f.download = 'https://docs.google.com/document/d/' + id + '/export?format=pdf';
  else if (/spreadsheet$/.test(f.mime)) f.download = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
  else if (/presentation$/.test(f.mime)) f.download = 'https://docs.google.com/presentation/d/' + id + '/export/pdf';
  else f.download = f.view;
  return f;
}

function scan_(id) {
  const acc = { files: [], skipped: 0 };
  walk_(DriveApp.getFolderById(id), '', 0, acc);
  acc.files.sort((a, b) => (a.path + '/' + a.name).localeCompare(b.path + '/' + b.name, undefined, { numeric: true }));
  return acc;
}

function getFiles_(id) {
  const s = assertSubject_(id), key = 'files:' + id, c = cacheGet_(key);
  if (c) return c;
  const acc = scan_(id);
  const out = { subject: s, files: acc.files.map(urls_), skipped: acc.skipped, generatedAt: Date.now() };
  cachePut_(key, out);
  return out;
}

function createZip_(id) {
  const s = assertSubject_(id);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw fail_('BUSY', 'The server is busy. Please try again in a moment.');
  try {
    cleanupZips();
    const reuse = cacheGet_('zip:' + id);
    if (reuse) { try { const f = DriveApp.getFileById(reuse.fileId); if (!f.isTrashed()) return reuse.result; } catch (_) {} }

    const acc = scan_(id);
    if (!acc.files.length) throw fail_('EMPTY', 'This subject has no files yet.');
    if (acc.files.length > CFG.MAX_ZIP_FILES) throw fail_('TOO_LARGE', 'This subject has too many files for one ZIP (' + acc.files.length + '). Please use the individual download buttons.');
    const total = acc.files.reduce((n, f) => n + (f.size || 0), 0);
    if (total > CFG.MAX_ZIP_BYTES) throw fail_('TOO_LARGE', 'These files are too large for a reliable ZIP (' + Math.round(total / 1048576) + ' MB). Please use the individual download buttons.');

    const used = {}, blobs = [];
    acc.files.forEach(f => {
      let blob;
      try {
        const file = DriveApp.getFileById(f.id);
        blob = f.mime.indexOf('application/vnd.google-apps.') === 0 ? file.getAs('application/pdf') : file.getBlob();
      } catch (_) { throw fail_('FILE_UNREADABLE', 'A file could not be read, so no ZIP was created (no incomplete ZIPs are served). Please use the individual downloads.'); }
      let name = f.mime.indexOf('application/vnd.google-apps.') === 0 && !/\.pdf$/i.test(f.name) ? f.name + '.pdf' : f.name;
      name = name.replace(/[\\\/:*?"<>|]/g, '_');
      const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      let n = name, i = 1;
      while (used[n.toLowerCase()]) n = base + ' (' + (++i) + ')' + ext;   // avoid collisions from nested folders
      used[n.toLowerCase()] = 1;
      blobs.push(blob.setName(n));
    });

    const m = s.name.match(/^[A-Za-z]{2,5}\s*-?\s*\d{2,4}[A-Za-z]?/);
    const zipName = (m ? m[0] : s.name).replace(/[^A-Za-z0-9]+/g, '') + '_Midterm_Files.zip';
    const file = tmpFolder_().createFile(Utilities.zip(blobs, zipName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const result = { url: 'https://drive.google.com/uc?export=download&id=' + file.getId(), name: zipName, count: blobs.length, bytes: file.getSize(), keepMinutes: CFG.ZIP_KEEP_MINUTES };
    cachePut_('zip:' + id, { fileId: file.getId(), result: result }, CFG.ZIP_REUSE_SECONDS);
    return result;
  } finally { lock.releaseLock(); }
}

function tmpFolder_() {
  const root = DriveApp.getRootFolder(), it = root.getFoldersByName(CFG.TMP_FOLDER);
  return it.hasNext() ? it.next() : root.createFolder(CFG.TMP_FOLDER);
}

/** Deletes temp ZIPs older than ZIP_KEEP_MINUTES (runs on every ZIP request + hourly trigger). */
function cleanupZips() {
  const it = tmpFolder_().getFiles(), limit = Date.now() - CFG.ZIP_KEEP_MINUTES * 60000;
  while (it.hasNext()) { const f = it.next(); if (f.getDateCreated().getTime() < limit) f.setTrashed(true); }
}

/** RUN ONCE from the editor: grants permissions, checks the root folder, installs hourly cleanup. */
function setup() {
  Logger.log('Root folder OK: ' + DriveApp.getFolderById(ROOT_FOLDER_ID).getName() + ' | subjects: ' + getSubjects_(true).length);
  tmpFolder_();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'cleanupZips'))
    ScriptApp.newTrigger('cleanupZips').timeBased().everyHours(1).create();
  Logger.log('Setup complete.');
}
