# Lampa Trailers — webOS (beta)

[![CI and Pages](https://github.com/WatherMG/lampa-trailers/actions/workflows/ci-pages.yml/badge.svg)](https://github.com/WatherMG/lampa-trailers/actions/workflows/ci-pages.yml)

An independent, experimental helper extension for **Lampa**. It adds **one combined Trailers button** to film/series cards. YouTube discovery uses the metadata already loaded by Lampa/CUB; RuTube discovery uses a third-party trailer cache with RuTube's search endpoint as a fallback. Playback is integrated into Lampa where supported. The plugin runs in Lampa's WebView; its static YouTube bridge is hosted on the same HTTPS GitHub Pages site.

**Status: beta.** Automated tests run with simulated Lampa, webOS, YouTube bridge, and RuTube network responses. Neither this code nor GitHub Actions can guarantee successful media playback on a physical LG G6. The user's Lampa/webOS version, network, RuTube CDN and YouTube embed restrictions must be tested on the TV. An error 153 observed in a third-party report does not prove the user's TV has exactly that error.

## Installation

This repo is configured to publish a static site from GitHub Actions. Once **Settings → Pages → Build and deployment → Source → GitHub Actions** is enabled and the deployment succeeds, the intended URLs are:

- Plugin: `https://wathermg.github.io/lampa-trailers/trailers.js`
- Diagnostics: `https://wathermg.github.io/lampa-trailers/diagnostics.html`
- Bridge: `https://wathermg.github.io/lampa-trailers/youtube-bridge.html`

After the Pages deployment succeeds, open the diagnostics page on the TV and test the YouTube IFrame bridge. A successful CI run does not prove successful playback on a physical webOS device.

Install `trailers.js` as a normal Lampa JS extension and restart the app. The extension adds one **Трейлеры** button; its list separates **YouTube** and **RuTube** with headings and per-item source labels. The original YouTube button is hidden while our combined button is active. Disable older overlapping RuTube trailer plugins (TVIGL/RootU) for a clean one-button interface: the combined button performs its own RuTube discovery. You can keep TVIGL enabled as an emergency playback fallback, but its card button is hidden when our combined button is present. If RuTube's cache/search fails on the TV, YouTube trailers still appear when Lampa supplies TMDB video metadata.

**Migration from `trailer-fix.js`:** remove the old extension URL from Lampa, install `trailers.js` and restart the app. The old filename will not be published. The legacy JavaScript API `LampaTrailerFix` remains available as an alias of `LampaTrailers`.

Settings appear in **Lampa → Settings → Трейлеры: YouTube и RuTube**, provided `SettingsApi.addComponent` is supported. On older Lampa builds the settings fall back to `Дополнительно`. Select `YouTube: способ просмотра` and `RuTube: качество при запуске` as needed. The plugin is also testable from DevTools via `LampaTrailers`. In version 0.4.1-beta the settings `youtube.leanback.v4` input is registered as a literal string in the Lampa Settings API; this fixes the previous undefined-value crash.

## 0.4.1-beta fixes

- Fixed a JavaScript syntax error in `youtube-bridge.html`: literal `\\n` sequences after an inline comment and in the message handler prevented the IFrame bridge from initializing. CI now parses the real inline HTML scripts and exercises the YouTube command handler.
- Added independent **YouTube** and **RuTube** switches and a **Порядок источников** selector. RuTube off means no RuTube search request; YouTube off removes YouTube from the combined list.
- Both sources enabled preserves the existing combined button, YouTube-first order, RuTube quality behavior and configurable YouTube application ID. A change to source controls applies the next time the combined list is opened.
- Tests check both source orders, disabled searches/interception and the parameter lookup used by Lampa settings. Physical-TV playback still requires acceptance testing.

## Playback architecture and sources

### Practical controls on LG webOS

The YouTube bridge forwards play/pause, volume, seek and playback-rate commands to the official IFrame API. This command path is covered by simulated tests, not yet confirmed on LG webOS. The official IFrame API does **not** expose supported commands for fixed video quality or arbitrary caption-track selection. For those functions use YouTube's own visible player controls if accessible with LG Magic Remote, or switch to the installed YouTube app. On RuTube, the ordinary Lampa HLS quality selector can show the variants; external audio rendition playlists are preserved rather than flattened.


### YouTube

- Discovery: Lampa's existing TMDB/CUB video metadata, reused in the combined button. This helper does **not** scrape YouTube search, use `youtube-dl`/`yt-dlp`, use unofficial InnerTube endpoints, extract signed URLs, or proxy YouTube media through the VPS.
- Playback: Google's official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) on a real HTTPS GitHub Pages document. The bridge sets `strict-origin-when-cross-origin` and identifies itself with the official `origin` player parameter. This addresses a *possible* embed-error-153 cause; the hosting WebView and YouTube may still reject it.
- Recovery: an iframe error or startup timeout in Auto mode requests a webOS Application Manager launch for the selected video. Both the official LG YouTube app and common AdFree replacements typically occupy app ID `youtube.leanback.v4`; a custom ID can be configured. If launch fails, the plugin reports it rather than silently closing Lampa. **Successful application launch is not proof that the app supports deep linking or successfully played the video.**
- The app fallback leaves Lampa. The embedded bridge enables YouTube's own on-screen controls (`controls=1`) and passes Lampa's play/pause/seek/volume/speed commands. **YouTube quality cannot be selected through the IFrame API** because the older quality-setting methods no longer work. The YouTube iframe's own quality/subtitle menus may require a pointer or remote focus, and Lampa's overlay can cover them on webOS. For reliable native YouTube CC and quality controls choose **Settings → Trailers → YouTube playback → Installed YouTube app**; a regular YouTube app or an AdFree replacement can use the configured app ID. The bridge cannot guarantee subtitles will be disabled by default because `cc_load_policy=0` does not override a user's YouTube caption preference. The source video may forbid embedding (`101`/`150`) or be unavailable (`100`).

### RuTube

- Discovery: the combined button first queries `trailer.rootu.top/search/<movie|tv>/<TMDB id>.json`; if no results are returned it tries RuTube's video search endpoint. These service interfaces are not guaranteed to remain available and may reject webOS cross-origin requests. For playback, the plugin consumes RuTube's `api/play/options/<video-id>/` response, following the field `video_balancer.m3u8` used by TVIGL; **this is a service-specific interface, not a stable public contract**. It may break or be geo-limited.
- HLS: the helper retrieves the master playlist using XHR and parses `#EXT-X-STREAM-INF` variants, resolving relative paths. URLs are passed through the **stock Lampa quality menu**. `Auto` points at the unmodified master playlist, so playback quality adaptation remains possible on compatible players.
- Safety: master playlists with separate `#EXT-X-MEDIA:TYPE=AUDIO` rendition groups are not flattened into video-only variants; the plugin sends the intact HLS master to Lampa instead of a video-only variant. This preserves the audio references, but native webOS/Hls.js support still requires TV testing. Authentication, expiring URLs, CORS and codec support remain under RuTube and webOS control.
- The default quality preference sets the initial variant where the installed Lampa build provides `PlayerPanel.quality`. On older builds that lack this API, the native Lampa global default quality may override the initial choice, but manual switching remains possible.

## Settings (separate section)

| Option | Default | Meaning |
|---|---|---|
| YouTube: показывать трейлеры | On | Hide YouTube trailers from the combined list and bypass YouTube playback interception when off. |
| RuTube: показывать трейлеры | On | Hide RuTube trailers, skip RuTube search requests, and bypass playback interception when off. |
| Порядок источников | YouTube → RuTube | Put YouTube or RuTube first without changing their individual enable switches. |
| YouTube: способ просмотра | Inside Lampa → installed YouTube app on failure | `auto`, `native`, `bridge`. `native` only applies on webOS and falls back to bridge if launching the app fails. |
| YouTube: ID приложения на webOS | `youtube.leanback.v4` | Same ID is commonly used by the official app and AdFree replacement. Find the actual installed ID with `ares-install --list --device <NAME>` or webOS CLI. |
| RuTube: ручной выбор качества | On | Populate Lampa's quality selector with actual HLS variant URLs. |
| RuTube: качество при запуске | Maximum | `max`, adaptive `auto`, up to `1080p`, up to `720p` (available variants only). |
| Диагностические сообщения | Off | Enables plugin console messages; available counters are exposed through `LampaTrailers.stats`. |

**Do not enable overlapping trailer plugins unless diagnosing a fallback.** This extension provides the combined card button and RuTube search. It does not modify the bundled Lampa files.

## Local verification and CI

Requires Node.js 22+ for the test runner (the published plugin itself is plain browser JavaScript, with no Node runtime dependency).

```sh
npm run check
npm test
npm run build
```

The Pages workflow runs syntax checks, integration tests and static artifact verification on pull requests and pushes to `main`. It deploys allowlisted HTML/JS files on `main` after tests succeed. It does not run privileged network proxy services and stores no API tokens or credentials.

Pages must use **Settings → Pages → Build and deployment → Source → GitHub Actions**. Verify the first deployment in the workflow logs and visit the Pages URL before installing the plugin.

### Physical-TV acceptance checklist

1. `diagnostics.html` in the LG browser displays `ready` and then `state: 1` after Play (or logs the actual YouTube error code).
2. The same YouTube trailer opens via a Lampa card on native webOS; test both `auto` and `bridge` modes, including return from the official YouTube app (or AdFree, if installed).
3. RuTube card trailer plays with audio; the quality panel shows **only** resolutions offered by that exact playlist, switching preserves playback/seek, and Auto works.
4. When the TV is offline, RuTube API fails, or the installed YouTube app is absent, Lampa remains recoverable; after leaving the player, ordinary torrent/film playback still works.
5. In the combined card button verify both headings, choose YouTube and RuTube, and check that the selected source plays.
6. Switch off RuTube and reopen the combined button: YouTube must appear immediately, with no RuTube network requests. Switch off YouTube and confirm only RuTube remains. Turn both back on, reverse source order, and check headings and actual playback. Where RuTube search is blocked, collect its error without disabling YouTube.
7. Collect the console log with `LampaTrailers.config.debug = true` and `LampaTrailers.stats` if any case fails. Don't publish signed CDN URLs or account information in a public issue.

## Development priorities

1. Test on actual LG/webOS versions and collect error codes before changing playback algorithms. If iframe error `153` persists, confirm the actual network `Referer`, navigation policy, and webOS `file://` sandbox instead of claiming a successful workaround.
2. Add a user-selectable *manual* fallback (keep Lampa open) and/or a supported way to open the official YouTube app without assuming which implementation is installed.
3. Refresh expiring RuTube HLS quality URLs upon quality changes and implement explicit fallback when a CDN returns 403/404. Keep external audio rendition groups intact.
4. Optionally support official TMDB metadata as an alternative discovery source, without depending on a third-party search proxy. Do not store third-party API keys in public JS.
5. Add hardware integration tests via webOS CLI/DevTools before calling a release production-ready.

## Source code and license

- [Lampa application and player APIs](https://github.com/yumata/lampa-source)
- [TVIGL RuTube plugin](https://github.com/tvigl/plugins/blob/main/rutube.js)
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube embedded player minimum requirements](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [GitHub Pages custom Actions workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

MIT for original files in this repository. See [SECURITY.md](SECURITY.md) before sharing logs. No third-party Lampa/TVIGL source is copied.