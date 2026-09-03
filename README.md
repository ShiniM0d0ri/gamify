<div align="center">

  <h1 align="center">Gamify</h1>

  <p align="center">
    <strong>Gamify is a Steam-like launcher for Windows — forked from <a href="https://github.com/hydralauncher/hydra">Hydra 4.1.1</a> (Electron, React, TypeScript, Python/libtorrent, Rust). The fork keeps Hydra's library/cloud-save/achievement stack but replaces single-stream downloads with multi-source accelerated downloads.</strong>
  </p>

  <p align="center">
    Authentic sources are curated from <code>cs.rin.ru f=10 t=95461</code> Recommended sites (verified 2026-09-03 via authenticated fetch). Primary repacks: <code>FitGirl (fitgirl-repacks.site)</code>, <code>SteamRIP</code>, <code>KaOsKrew</code>, <code>AnkerGames</code>, <code>GameBounty</code>, <code>GOG-Games</code> — with <code>dodi-repacks.site</code> gated behind warning per current RIN untrusted list.
  </p>

</div>

## Why fork Hydra

Hydra is the most mature open-source game launcher (16k★, Electron 40 + libtorrent Python RPC + Rust native, 40+ community `sources` JSON). Existing alternatives (Sail-Launcher, Arachnel, FitLauncher, FitFast) are FitGirl-only or Linux-only. Gamify keeps Hydra's catalog/library/seeding stack and surgically upgrades the download path to be fastest on Windows.

## Gamify changes vs upstream

- **Multi-source fastest downloads** — `src/main/services/download/parallel-http-downloader.ts` (16× `Range: bytes=s-e` parallel, 2 MiB chunk floor, per-chunk stall 30s + 10 retries, aggregated speed/throttle, `.tmp-gamify-*` resume, merge). Doc: `docs/GAMIFY_PLAN.md` §4.1 Tier A. Tiers B–D (batch concurrency, mirror racing, Metalink) are next milestones.
- **Verified sources** — RIN whitelist/blacklist imported; `dodi-repacks` & `gamedrive` behind toggle; external `games.json` not bundled (DMCA-safe linking).
- **Online-Fix** — prefers open `ReFix` (MIT, Spacewar 480) over closed `OnlineFix64.dll`.
- **Windows-first** — `appId gg.gamify.launcher`, product `Gamify`, `electron-builder --win` NSIS/portable, NTFS long paths, Defender/Firewall prompts.

## Features (inherited from Hydra)

- Add games you own to your library, profiles, cloud saves (Hydra Cloud), achievements, powerful suggestion catalogue.

## Build from source

Same as Hydra — see `docs/GAMIFY_PLAN.md` §5 + https://docs.hydralauncher.gg/getting-started

### Requirements

- Node.js 22 + Yarn 1.22.22 (`npm i -g yarn`)
- Python 3.9+ `pip install -r requirements.txt`
- Rust toolchain (`hydra-native`)

```powershell
yarn --frozen-lockfile
yarn build:win      # NSIS + portable (runs build:native + build:python-rpc + electron-vite build)
yarn dev            # electron-vite dev
```

Packaging scripts `build:win/mac/linux/unpack` now correctly handle `ParallelHttpDownloader`.

## Fork maintenance

- `upstream` remote = `hydralauncher/hydra` — sync via `git fetch upstream && git merge upstream/main`.
- Source allow-list lives outside repo (Hydra-compatible JSON) so domains can rotate without code push.
- See `docs/GAMIFY_PLAN.md` for roadmap and `src/main/services/download/download-manager.ts` for integration points.

## License

MIT — same as Hydra (`LICENSE`). Gamify is a fork, not affiliated with Hydra. Hydra © Los Broxas.

## Disclaimer

Gamify ships no game files, no repack archives, and no hard-coded `fuckingfast.co/dl` links. Users add community source URLs themselves. Use only for games you own / where you have rights. See RIN `Minimum requirements` and `How to stay safe` in `docs/GAMIFY_PLAN.md`.
