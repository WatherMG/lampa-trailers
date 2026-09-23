# Lampa Trailers — webOS (beta)

[![CI and Pages](https://github.com/WatherMG/lampa-trailers/actions/workflows/ci-pages.yml/badge.svg)](https://github.com/WatherMG/lampa-trailers/actions/workflows/ci-pages.yml)

An independent, experimental helper extension for **Lampa**. It works with the existing **CUB/TMDB YouTube trailer button** and **TVIGL RuTube trailer button**, rather than maintaining another trailer search engine. The plugin runs in Lampa's WebView; its static YouTube bridge is hosted on the same HTTPS GitHub Pages site.

**Status: beta.** Automated tests run with simulated Lampa, webOS, YouTube bridge, and RuTube network responses. Neither this code nor GitHub Actions can guarantee successful media playback on a physical LG G6. The user's Lampa/webOS version, network, RuTube CDN and YouTube embed restrictions must be tested on the TV. An error 153 observed in a third-party report does not prove the user's TV has exactly that error.

## Installation

This repo is configured to publish a static site from GitHub Actions. Once **Settings → Pages → Build and deployment → Source → GitHub Actions** is enabled and the deployment succeeds, the intended URLs are:

- Plugin: `https://wathermg.github.io/lampa-trailers/trailers.js`
- Diagnostics: `https://wathermg.github.io/lampa-trailers/diagnostics.html`
- Bridge: `https://wathermg.github.io/lampa-trailers/youtube-bridge.html`

After the Pages deployment succeeds, open the diagnostics page on the TV and test the YouTube IFrame bridge. A successful CI run does not prove successful playback on a physical webOS device.

In Lampa, install and enable the original CUB/TMDB trailer plugin (if your Lampa build does not provide that button already), and **TVIGL RuTube** `https://tvigl.github.io/plugins/rutube.js`. Disable the overlapping `plugin.rootu.top/rutube.js` or other RuTube playback handlers: Lampa chooses the first registered handler for a URL, and registration order is not a reliable extension mechanism. Then add this repo's `trailers.js` as a normal Lampa JS plugin, restart the app, and test the trailer buttons inside a film/series card. This extension intercepts the selected link before starting Lampa Player; it does not register an additional handler for the public RuTube URL.

**Migration from `trailer-fix.js`:** remove the old extension URL from Lampa, install `trailers.js` and restart the app. The old filename will not be published. The legacy JavaScript API `LampaTrailerFix` remains available as an alias of `LampaTrailers`.\n\nSettings appear in **Lampa → Settings → Трейлеры: YouTube и RuTube**, provided `SettingsApi.addComponent` is supported. On older Lampa builds the settings fall back to `Дополнительно`. Select `YouTube: способ просмотра` and `RuTube: качество при запуске` as needed. The plugin is also testable from the DevTools console via `LampaTrailers`.

## Playback architecture and sources

### YouTube

- Discovery: Lampa's existing CUB/TMDB list. This helper does **not** scrape YouTube search, use `youtube-dl`/`yt-dlp`, use unofficial InnerTube endpoints, extract signed URLs, or proxy YouTube media through the VPS.
- Playback: Google's official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) on a real HTTPS GitHub Pages document. The bridge sets `strict-origin-when-cross-origin` and identifies itself with the official `origin` player parameter. This addresses a *possible* embed-error-153 cause; the hosting WebView and YouTube may still reject it.
- Recovery: an iframe error or startup timeout in Auto mode requests a webOS Application Manager launch for the selected video. Both the official LG YouTube app and common AdFree replacements typically occupy app ID `youtube.leanback.v4`; a custom ID can be configured. If launch fails, the plugin reports it rather than silently closing Lampa. **Successful application launch is not proof that the app supports deep linking or successfully played the video.**
- The app fallback leaves Lampa. YouTube's IFrame API does not expose a reliably enforceable fixed video resolution; a fake quality selector is deliberately not provided. The source video may forbid embedding (`101`/`150`) or be unavailable (`100`).

### RuTube

- Discovery: TVIGL's existing film/series card button. The plugin consumes RuTube's `api/play/options/<video-id>/` response, following the field `video_balancer.m3u8` used by TVIGL; **this is a service-specific interface, not a stable public contract**. It may break or be geo-limited.
- HLS: the helper retrieves the master playlist using XHR and parses `#EXT-X-STREAM-INF` variants, resolving relative paths. URLs are passed through the **stock Lampa quality menu**. `Auto` points at the unmodified master playlist, so playback quality adaptation remains possible on compatible players.
- Safety: master playlists with separate `#EXT-X-MEDIA:TYPE=AUDIO` rendition groups are not flattened into video-only variants; the plugin sends the intact HLS master to Lampa instead of a video-only variant. This preserves the audio references, but native webOS/Hls.js support still requires TV testing. Authentication, expiring URLs, CORS and codec support remain under RuTube and webOS control.
- The default quality preference sets the initial variant where the installed Lampa build provides `PlayerPanel.quality`. On older builds that lack this API, the native Lampa global default quality may override the initial choice, but manual switching remains possible.

## Settings (separate section)

| Option | Default | Meaning |
|---|---|---|
| YouTube: способ просмотра | Inside Lampa → installed YouTube app on failure | `auto`, `native`, `bridge`. `native` only applies on webOS and falls back to bridge if launching the app fails. |
| YouTube: ID приложения на webOS | `youtube.leanback.v4` | Same ID is commonly used by the official app and AdFree replacement. Find the actual installed ID with `ares-install --list --device <NAME>` or webOS CLI. |
| RuTube: ручной выбор качества | On | Populate Lampa's quality selector with actual HLS variant URLs. |
| RuTube: качество при запуске | Maximum | `max`, adaptive `auto`, up to `1080p`, up to `720p` (available variants only). |
| Диагностические сообщения | Off | Enables plugin console messages; available counters are exposed through `LampaTrailers.stats`. |

**Do not enable every overlapping trailer plugin.** Search and playback are separate responsibilities: use CUB to find YouTube videos, TVIGL to find RuTube videos, and this extension to improve playback and present the available RuTube variants. Disabling this extension restores the original Lampa/CUB/TVIGL behaviour without modifying their files.

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
5. Collect the console log with `LampaTrailers.config.debug = true` and `LampaTrailers.stats` if any case fails. Don't publish signed CDN URLs or account information in a public issue.

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