# Gamify — Hydra Fork Plan

**Base:** `hydralauncher/hydra 4.1.1` (Electron 40, React 18, Python 3.9 `python_rpc` libtorrent, Rust `hydra-native`) forked to `/home/darkflamemaster/projects/gamify` as `gamify 0.1.0` (`package.json:2`).
**Goal:** Steam-like Windows launcher (Win10/11) with fastest downloads by combining multiple sources/hosts, verified via `cs.rin.ru f=10 t=95461` (Recommended sites) authenticated fetch 2026-09-03.

## 1. Why fork Hydra vs others

| Candidate | Verdict | Reason |
|---|---|---|
| **Hydra** | **FORK** 16.6k★, MIT, active CI `windows-2022+ubuntu` | 40+ `sources` JSON, dual-path `JsHttpDownloader` (HTTP/Debrid) + `PythonRPC/libtorrent` (torrent), handles `FuckingFast`/`Datanodes`/`Gofile`/`PixelDrain` etc., library sync, achievements, cloud saves. Single-stream bottleneck is fixable. |
| Sail-Launcher | Good Win aria2+Debrid, but C# solo, smaller community | Use as reference for PixelDrain worker + TorBox impl |
| Arachnel | Qt light, plugin per source, but Online-Fix not ready | Reference plugin model |
| FitLauncher/FitFast/ffastloader | Single-purpose FitGirl `fuckingfast.co` 16x Camoufox | Reuse CF bypass logic |

Hydra already claims `add games you own` — DMCA-safe linking, not hosting — same survival pattern needed for Gamify.

## 2. Verified source allow-list (RIN t=95461 OP)

**Direct / specialized (allow anonymous, uBlock ok, HTTPS, 6mo+):** `Appnetica`, `GLOAD.to`, `Gog-Games.to`, `My Abandonware`, `Old-Games.RU`, `ReleaseBB`, `scene.cat`, `Scnlog.me`, `Collection Chamber`, `Torrminatorr`, `Wendy's Forum`  
**Torrents:** `Rutracker`, `Rustorka`, `Rutor` (via `qBittorrent/Deluge` style, `libtorrent`)  
**Crack/Fix:** `Online-Fix.me` (closed, flag), `Fearless Revolution`, `FLiNG`, `GameCopyWorld`, `Megagames` → prefer open `ReFix` (`Coronitaa/ReFix` MIT, Spacewar 480, Goldberg alt)  
**Repacks/Preinstalled:** `FitGirl (THE repacker)`, `AnkerGames`, `GameBounty` (via `GameBounty.world`), `KaOsKrew`, `Kapital Sin`, `SteamRIP`  
**Filehosts (good):** `1Fichier`, `Catbox`, `Clicknupload`, `DailyUploads`, `FileDitch`, `FileQ`, `GoFile`, `Google Drive`, `HexUpload`, `Krakenfiles`, `Mail.ru Cloud`, `MediaFire`, `MEGA`, `Mixdrop`, `Pixeldrain`, `Sendcm`, `SendSpace`, `Yandex.Disk`  
**Untrusted (block by default, show warning):** `dodi-repacks.site / game-repack.site`, `gamedrive.org`, `steam-repacks.net`, `repack-games.com`, `oceanofgames`, `steamunlocked`, `igg-games` + 30 more, plus any `CODEX/CPY` scene-name fake. All require user confirmation toggle in Settings.

Source JSON lives outside repo (`hydra.wiki/sources` style) so domains can rotate without code push. Gamify adds `reputation` field (`trusted` / `warning` / `blocked`) derived from RIN list.

Passwords: `cs.rin.ru` / `csrin.org` (RIN convention for protected archives).

## 3. Current Hydra bottleneck (audit `src/main/services/download/`)

- `JsHttpDownloader` (`src/main/services/download/js-http-downloader.ts:109`): single `fetch(url, Range: bytes=start-)`, single `pipeline(reader → fs.WriteStream)`, stall check `30s`, retry `10` exp backoff. No `Range` multi-connection, no concurrent files. `DownloadManager.downloadingGameId` singleton → queue `pausedOrder` only one active at a time (`download-orchestrator.ts:processNextQueuedDownload`).
- `FuckingFastApi` (`src/main/services/hosters/fuckingfast.ts:45`): naive `axios.get` + regex `window.open("https://fuckingfast.co/dl/...")`, misses CF `503` + `rate limit` + new `securitytoken` challenge (seen on `cs.rin.ru`); upstream `FitFast` uses Camoufox stealth instead.
- No Metalink, no parallel chunk merge, no speed-based mirror racing. `MultiSource` idea in spec not present.

## 4. Fastest download design — combine parts from multiple sources

### 4.1 Tier A: Per-file 16x parallel Range (aria2-like, Win-optimized)

New `ParallelHttpDownloader` (`src/main/services/download/parallel-http-downloader.ts`) — drop-in for `JsHttpDownloader` when `HEAD` reports `Accept-Ranges: bytes` and `Content-Length` known:

- `HEAD` probe: `Content-Length`, `Accept-Ranges`, `ETag`. If missing → fallback to old single-stream.
- Split: `connections = min(16, ceil(fileSize / 2MiB))` (fitgirl parts often 500MiB–2GiB). `chunk = fileSize / connections`.
- Spawn N `fetch` with `Range: bytes=s-e` via `AbortController` pool, stream to temp `file.part00..15` in `savePath/.tmp-<folderName>/`. Throttle applies per-chunk aggregated.
- Merge: `fs.createWriteStream` concat or `fs.promises` append in order, verify `bytesDownloaded === fileSize`. Resume: keep `.tmp` index, `HEAD` again, skip completed chunks (size check).
- Stall/retry per chunk (reuse `stallDetected` 30s, retry 10), but overall retry resets if any chunk makes progress (`shouldResetRetryBudget`).
- Metrics: report aggregated `downloadSpeed` same as `JsHttpDownloaderStatus` so UI unchanged.

Windows notes: use `fs` with `FILE_FLAG_SEQUENTIAL_SCAN` hint via `node:fs` `open` flags, NTFS `sparse` not needed, long path `\\?\` via `path.win32`. Defender: no AV exclude needed per chunk, only final.

### 4.2 Tier B: Batch multi-file concurrency (repack parts)

FitGirl repacks ship `setup.exe` + `data01.bin`…`data15.bin` + `update.rar` parts on 2–4 hosts (e.g., `fuckingfast.co` + `datanodes.to` + `pixeldrain`). Hydra queues them sequentially.

Gamify change:

- `DownloadManager` allow `concurrency: 3` (default, user setting `Settings → Downloads → Max concurrent files` 1–8) using `p-queue` or manual `Promise.allSettled` over `downloadsSublevel` batch with same `objectId` prefix.
- UI: `Downloads` page groups parts under one game card, progress = `sum(bytesDownloaded)/sum(fileSize)` weighted, reusing `allDebridBatch` pattern but generic.
- Integration: `startGameDownload` now accepts `uri: string[]` (multi-mirror) → spawn parallel.

### 4.3 Tier C: Mirror racing + auto re-resolve (FitFast/MirrorGrab)

- Before `HEAD`, fire parallel `GET` resolver for same logical file on all hosts (`fuckingfast`, `datanodes`, `pixeldrain`, `1fichier`). Probe `first 1MiB Range` speed 2s, keep fastest `directUrl`.
- During download, monitor per-chunk `downloadSpeed`; if `< 50KB/s` for `15s` → abort that chunk, re-resolve `FuckingFastApi.getDirectLink` (Fresh signed URL, CF fresh) like `FitFast` auto re-resolve, resume that chunk.

### 4.4 Tier D: True Metalink multi-host per-chunk (combined parts)

When same hash on 2 hosts (e.g., `fitgirl 7z` mirrored), generate ephemeral `.metalink` XML with `<resources><url>...</url></resources>` and feed to custom Metalink handler OR manual: assign chunks round-robin to hosts (chunk 0→host A, chunk1→host B, ...) if `Content-Length` + `ETag` identical, else fallback to Tier B. This is true combining parts from multiple sources per single file à la `aria2 --metalink`.

### 4.5 Fallback: libtorrent swarm

Keep `PythonRPC` path for `Downloader.Torrent`. Extend to hybrid: if HTTP stall > `60s` and torrent magnet available, auto spawn torrent as fallback (user opt-in). Use `bt-tracker` `customTrackers` already in `startGameDownload`.

## 5. Windows support checklist

- Build: `yarn --frozen-lockfile` + `pip -r requirements.txt` + `Rust stable` + `yarn build:win` (`electron-builder --win` NSIS, `build/unpack`). Test on `windows-2022` CI already green.
- Long paths: `app.setPath`, `path.win32`, manifest `longPathAware`.
- Firewall: `ReFix` needs inbound allow for LAN 480 → prompt `netsh advfirewall` (reuse Hydra `windows-game-capture`).
- Extraction: `node-7z` + `7zip-bin` handles `.7z/.rar` parts; auto-run `setup.exe /SILENT` via `sudo-prompt` elevation; cleanup `.tmp`.
- Integration: Start Menu shortcut, tray, single-instance lock already in Hydra.

## 6. Implementation phases

**Phase 0 — Foundation (1w) [DONE]:** Fork Hydra `4.1.1` → `gamify 0.1.0`, `upstream` remote, wipe creds (`shred`), `docs/GAMIFY_PLAN.md` (this file).

**Phase 1 — Scaffolding (1–2w):**
- Rebrand `README.md`, `electron-builder.yml` `appId: gg.gamify.launcher`, `icon.png`.
- Add `src/main/services/download/parallel-http-downloader.ts` (interface compatible, unit test `parallel-http-downloader.test.ts`).
- Refactor `DownloadManager.getJsDownloadOptions` to return `useParallel: boolean`.

**Phase 2 — Speed core (2–3w):**
- Implement Tier A (16x Range) + Tier B (batch concurrency 3). Benchmark on `pixeldrain` 1GiB vs vanilla (expect 3–8x on 100Mbps).
- Patch `FuckingFastApi` with `axios-cookiejar` + retry + `x-ratelimit` handling; add optional Camoufox fallback (`python_rpc` `playwright`) behind flag.
- Add Settings UI `maxConnections (4–16)` + `maxConcurrentFiles (1–8)` + `autoReResolve` toggle.

**Phase 3 — Multi-source (2w):**
- Tier C racing + Tier D Metalink handler. Persist `hash` in `Download` level entry for dedup.
- Extend `DownloadSource` JSON schema: `mirrors: [{url, hoster}]`, `hash: sha1`.

**Phase 4 — Hardening (1w):**
- RIN blocklist filter, `ReFix` DLL preference, `VirusTotal` scan hook (`file-type` → hash → VT API optional).
- Windows E2E tests (`vitest` + `electron` `spectron` + manual Win VM), performance report.

## 7. DMCA safety (why not taken down)

Same as Hydra: repo contains only generic manager + source fetcher, no game bytes, no hard-coded `fuckingfast.co/dl/` links, sources external JSON, MIT + `DISCLAIMER: add games you own`. GitHub 512 safe harbor — takedown only on specific infringing file notice. `gamify` never commits `OnlineFix64.dll` or `setup.exe`.

## 8. Verification

- Build: `yarn typecheck && yarn build:win` on `windows-2022` (or `yarn build:unpack` on Linux for smoke).
- Tests: `yarn test src/main/services/download/*` (existing + new parallel tests).
- Manual: download FitGirl 500MiB test from `pixeldrain` vs `datanodes` parallel, measure `time` + `downloadSpeed` in Downloads UI; confirm resume after kill.

---
*Next: implement `parallel-http-downloader.ts` stub and wire to `DownloadManager`.*

# Fix: set correct API vars and clear invalid downloadSources for catalog
