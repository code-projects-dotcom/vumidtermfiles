# VU Facts – Midterm Resource Portal

Static site (HTML/CSS/vanilla JS + Bootstrap 5) + Google Apps Script backend + Google Drive. No paid services.

```
index.html · css/style.css · js/{config,drive-api,search,app}.js · assets/{logo,favicon}.png · backend/Code.gs
```

## 1. Deploy the backend (Google Apps Script) – ~5 minutes
1. Go to https://script.google.com → **New project** (sign in with the Google account that owns/has access to the Drive folder).
2. Delete the default code, paste all of `backend/Code.gs`. `ROOT_FOLDER_ID` is already set to your folder.
3. In the editor choose function **`setup`** → **Run**. Approve the permission prompt (Advanced → Go to project (unsafe) → Allow). The log must say *Root folder OK … subjects: N* and *Setup complete*. This also installs the hourly ZIP-cleanup trigger.
4. **Deploy → New deployment → Web app**: *Execute as:* **Me** · *Who has access:* **Anyone** → Deploy. Copy the **Web app URL** (ends in `/exec`).
5. Test it in a browser: `YOUR_URL?action=subjects` should print JSON with your real subject folders.
6. Whenever you change `Code.gs`: **Deploy → Manage deployments → Edit → New version → Deploy** (URL stays the same).

## 2. Connect the frontend
Open `js/config.js`, paste the URL into `API_URL`. Nothing else to edit. (No secrets live in the frontend; the folder ID exists only in `Code.gs`.)

## 3. Publish on GitHub Pages
1. Create a GitHub repo, upload the contents of the `vu-facts` folder (so `index.html` is at the repo root).
2. **Settings → Pages → Deploy from a branch → main / (root)** → Save. Your site appears at `https://USERNAME.github.io/REPO/`.

## How it works / limits (honest notes)
- **CORS:** Apps Script cannot set CORS headers, so the site uses **JSONP** (validated callback names) for subjects, files and ZIP requests.
- **Security:** the browser only sends a folder id; the backend accepts it only if it is a direct child of the configured root. Nothing else in your Drive is reachable.
- **Caching:** subjects/files cached 10 min (server + browser). New files appear within ~10 minutes.
- **ZIP:** built server-side with `Utilities.zip`, stored in a temp Drive folder (`_VUF_ZIP_TEMP`), shared by link, deleted after 60 min (cleanup on each ZIP request + hourly trigger; items go to Drive Trash, which auto-empties). Limits: **max 60 files and ~40 MB** per subject; above that, or if any file is unreadable, **no ZIP is created** (never a partial one) and a message points to individual downloads. Apps Script runs max ~6 min per request and daily quotas apply. Google may show a "can't scan for viruses" page for large files.
- Nested folders (3 levels) are included; the ZIP is flat and duplicate names become `name (2).pdf`. Google Docs/Slides become PDF, Sheets become XLSX.
- Individual download uses Drive's `uc?export=download` URL; browsers/Drive permissions can still block it, so every row also has **Open**.
- Drive folder and files must stay **"Anyone with the link – Viewer"**.

## Testing status
| Tested here | Result |
|---|---|
| Syntax check of all JS and `Code.gs` (node) | Pass |
| Search matching on sample names (CS101, "cs101 midterm files", "cs 101", partial, name search, unknown → none, keyword-only → prompt) | Pass |
| **Not testable in my environment (no Google network, no browser):** live Drive data, Apps Script deploy, file open/download, ZIP creation, nested/empty folders on real data, visual/mobile widths, console errors | **Untested – use checklist** |

## Checklist for you (after deploy)
- [ ] `?action=subjects` shows real subjects · [ ] Page loads, logo ok, no console errors (F12)
- [ ] Header icons open correct WhatsApp/Group/Channel/TikTok/YouTube links; no phone number visible
- [ ] Search `CS101`, `cs101 midterm files`, `cs 101`, a course name, a partial code; unknown code → **Coming Soon**
- [ ] File opens in Drive; individual download works; list scrolls on desktop, page scrolls on mobile
- [ ] Download All → `CS101_Midterm_Files.zip` valid, right files, nested files included; empty subject → message; button disabled while working
- [ ] Check widths 320/375/390/430/768/1024/1440 (browser dev tools) – no sideways scroll
