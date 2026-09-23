/*
 * Lampa Trailers — experimental, self-hosted extension.
 * 1) Uses existing CUB/TMDB and TVIGL card buttons; no duplicate search plugin.
 * 2) Sends YouTube playback through a same-host HTTPS IFrame bridge.
 * 3) Expands RuTube HLS master playlists into real Lampa quality URLs.
 * License: MIT. See README.md. No third-party source code copied.
 */
(function () {
  'use strict';

  if (window.LampaTrailerFix && window.LampaTrailerFix.version) return;
  if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener || !Lampa.PlayerVideo) {
    console.error('[TrailerFix] Lampa Player/PlayerVideo APIs are unavailable');
    return;
  }

  var VERSION = '0.3.0-beta';
  var INTERNAL_HOST = 'lampa-trailer-fix.invalid';
  var YT_PATH = '/youtube/';
  var tag = document.currentScript;
  var pluginUrl = tag && tag.src ? tag.src : '';
  // Lampa can execute a cached plugin as an inline <script>, with no currentScript.src.
  // Recover its original URL from the installed plugin list in that case.
  if (!pluginUrl && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
    try {
      var installed = Lampa.Storage.get('plugins', []);
      if (typeof installed === 'string') installed = JSON.parse(installed);
      if (Array.isArray(installed)) {
        installed.some(function (entry) {
          var url = typeof entry === 'string' ? entry : entry && entry.url;
          if (typeof url === 'string' && /(?:^|\/)trailer-fix\.js(?:[?#]|$)/.test(url)) {
            pluginUrl = url;
            return true;
          }
          return false;
        });
      }
    } catch (e) { /* diagnostic URL remains empty */ }
  }
  var bridgeUrl = window.LAMPA_TRAILER_BRIDGE_URL ||
    (pluginUrl ? new URL('youtube-bridge.html', pluginUrl).href : '');
  var savedMode = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('ltf_youtube_mode', 'auto') : 'auto';
  var savedQuality = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('ltf_rutube_quality', true) : true;
  var savedAppId = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('ltf_youtube_app_id', 'youtube.leanback.v4') : 'youtube.leanback.v4';
  var savedPreferred = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('ltf_rutube_preferred', 'max') : 'max';
  var savedDebug = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('ltf_debug', false) : false;
  var config = {
    // auto: try embedded player, fall back to YouTube app on iframe error.
    // native: always launch YouTube app; bridge: never leave Lampa automatically.
    youtubeMode: /^(auto|native|bridge)$/.test(savedMode) ? savedMode : 'auto',
    rutubeQuality: savedQuality !== false && savedQuality !== 'false',
    rutubePreferred: /^(auto|max|1080|720)$/.test(savedPreferred) ? savedPreferred : 'max',
    youtubeAppId: /^[a-zA-Z0-9_.-]{4,120}$/.test(savedAppId) ? savedAppId : 'youtube.leanback.v4',
    debug: savedDebug === true || savedDebug === 'true'
  };
  var counters = { youtube: 0, rutube: 0, rutubeFallback: 0, youtubeErrors: [] };
  // A second trailer selection must invalidate requests started for the first one.
  var selection = 0;
  var pending = [];

  function cancelPending() {
    while (pending.length) {
      try { pending.pop()(); } catch (e) { log('cancel failed', e); }
    }
  }

  function log() {
    if (config.debug && window.console) console.log.apply(console, ['[TrailerFix]'].concat([].slice.call(arguments)));
  }

  function notify(message) {
    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
    if (window.console) console.warn('[TrailerFix]', message);
  }

  if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
    var settingSection = 'ltf_settings';
    // An independent menu appears in Settings, rather than adding several unrelated
    // items under "More". The Lampa SDK creates its parameter template itself.
    if (typeof Lampa.SettingsApi.addComponent === 'function') {
      Lampa.SettingsApi.addComponent({
        component: settingSection,
        name: 'Трейлеры: YouTube и RuTube',
        after: 'player',
        icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M10 8L16 12L10 16V8Z" fill="currentColor"/></svg>'
      });
    } else settingSection = 'more';

    function param(name, type, value, values, label, description, onChange) {
      var p = { name: name, type: type, default: value };
      if (values) p.values = values;
      Lampa.SettingsApi.addParam({
        component: settingSection, param: p,
        field: { name: label, description: description || '' }, onChange: onChange
      });
    }
    param('ltf_youtube_mode', 'select', 'auto', {
      auto: 'Внутри Lampa, затем приложение YouTube',
      native: 'Сразу приложение YouTube',
      bridge: 'Только внутри Lampa'
    }, 'YouTube: способ просмотра', 'Приложение YouTube может быть официальным или AdFree.',
    function (value) { if (/^(auto|native|bridge)$/.test(value)) config.youtubeMode = value; });
    param('ltf_youtube_app_id', 'input', 'youtube.leanback.v4', null,
      'YouTube: ID приложения на webOS', 'Обычно youtube.leanback.v4 у официального YouTube и AdFree. Проверьте через ares-install --list.',
      function (value) {
        if (/^[a-zA-Z0-9_.-]{4,120}$/.test(value)) config.youtubeAppId = value;
        else notify('Некорректный ID приложения YouTube; использую прежний.');
      });
    param('ltf_rutube_quality', 'trigger', true, null,
      'RuTube: ручной выбор качества', 'Передавать варианты HLS в стандартное меню качества Lampa.',
      function (value) { config.rutubeQuality = value === true || value === 'true'; });
    param('ltf_rutube_preferred', 'select', 'max', {
      max: 'Максимальное доступное',
      auto: 'Автоматически (HLS master)',
      '1080': 'До 1080p',
      '720': 'До 720p'
    }, 'RuTube: качество при запуске', 'Ручной выбор остается доступен в меню плеера.',
    function (value) { if (/^(auto|max|1080|720)$/.test(value)) config.rutubePreferred = value; });
    param('ltf_debug', 'trigger', false, null,
      'Диагностические сообщения', 'Выводить события расширения в консоль webOS DevTools.',
    function (value) { config.debug = value === true || value === 'true'; });
  }

  function youtubeId(url) {
    var m;
    if (typeof url !== 'string') return '';
    m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*?\bv=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&#?/]|$)/i);
    return m ? m[1] : '';
  }

  function rutubeId(url) {
    var m;
    if (typeof url !== 'string') return '';
    m = url.match(/^https?:\/\/(?:www\.)?rutube\.ru\/(?:play\/embed|video\/private|video|shorts)\/([a-f0-9]{32})(?:[/?#]|$)/i);
    return m ? m[1] : '';
  }

  // Deliberately independent of TVIGL's private search implementation.
  // Selection/search stay in your existing card plugins.
  function parseHlsMaster(text, baseUrl) {
    if (typeof text !== 'string' || !/^\s*#EXTM3U\b/.test(text)) return [];
    var lines = text.replace(/\r/g, '').split('\n');
    // Variant-only URLs cannot reliably carry an external AUDIO rendition.
    // In this case leave the original master playlist to the native player.
    if (lines.some(function (line) { return /^#EXT-X-MEDIA:\s*TYPE=AUDIO\b/i.test(line.trim()); })) return [];
    var result = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var height = /\bRESOLUTION\s*=\s*\d+x(\d+)/i.exec(line);
      var bandwidth = /\bBANDWIDTH\s*=\s*(\d+)/i.exec(line);
      var name = height ? height[1] + 'p' : (bandwidth ? Math.round(Number(bandwidth[1]) / 1000) + ' kbps' : 'Variant');
      var next = '';
      for (var j = i + 1; j < lines.length; j++) {
        next = lines[j].trim();
        if (next && next[0] !== '#') break;
        next = '';
      }
      if (!next) continue;
      var resolved;
      try { resolved = new URL(next, baseUrl).href; } catch (e) { continue; }
      if (!/^https?:\/\//i.test(resolved)) continue;
      var unique = name;
      if (seen[unique]) unique += ' (' + Math.round(Number(bandwidth && bandwidth[1] || 0) / 1000) + 'k)';
      if (seen[unique]) unique += ' #' + (result.length + 1);
      seen[unique] = true;
      result.push({ name: unique, url: resolved, height: height ? Number(height[1]) : 0,
        bandwidth: bandwidth ? Number(bandwidth[1]) : 0 });
    }
    result.sort(function (a, b) { return b.height - a.height || b.bandwidth - a.bandwidth; });
    return result;
  }

  function requestRutubeOptions(id, done) {
    var net = new Lampa.Reguest();
    net.timeout(12000);
    var used = false;
    function finish(err, body) {
      if (used) return;
      used = true;
      try { net.clear(); } catch (e) {}
      done(err, body);
    }
    try {
      net.native('https://rutube.ru/api/play/options/' + id + '/?format=json&no_404=true', function (data) {
        try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { return finish(e); }
        var master = data && data.video_balancer && data.video_balancer.m3u8;
        if (!master || !/^https?:\/\//i.test(master)) return finish(new Error('No HLS URL in RuTube options'));
        finish(null, master);
      }, function () { finish(new Error('RuTube API request failed')); });
    } catch (e) { finish(e); }
    return function () { used = true; try { net.clear(); } catch (e) {} };
  }

  function requestMaster(master, done) {
    var xhr = new XMLHttpRequest();
    var used = false;
    function finish(err, text) {
      if (used) return;
      used = true;
      done(err, text);
    }
    try {
      xhr.open('GET', master, true);
      xhr.timeout = 12000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) finish(null, xhr.responseText);
        else finish(new Error('HLS HTTP ' + xhr.status));
      };
      xhr.onerror = function () { finish(new Error('HLS CORS/network error')); };
      xhr.ontimeout = function () { finish(new Error('HLS request timeout')); };
      xhr.send();
    } catch (e) { finish(e); }
    return function () { used = true; try { xhr.abort(); } catch (e) {} };
  }

  function nativeYoutube(id, onSuccess, onFailure) {
    if (!window.webOS || !webOS.service || !webOS.service.request) {
      if (onFailure) onFailure('webOS Application Manager недоступен');
      return false;
    }
    try {
      webOS.service.request('luna://com.webos.applicationManager', {
        method: 'launch',
        parameters: {
          id: config.youtubeAppId,
          params: { contentTarget: 'v=' + id }
        },
        onSuccess: function (response) {
          if (response && response.returnValue === false) {
            if (onFailure) onFailure('Приложение YouTube отклонило запуск');
            return;
          }
          // The app manager confirms launch, not that this YouTube build accepted
          // contentTarget or that playback has actually started.
          log('webOS YouTube app launch confirmed', config.youtubeAppId, response);
          if (onSuccess) onSuccess(response);
        },
        onFailure: function (error) {
          if (onFailure) onFailure('Не удалось запустить ' + config.youtubeAppId + ': ' +
            ((error && (error.errorText || error.errorCode)) || 'unknown'));
        }
      });
      return true;
    } catch (e) {
      if (onFailure) onFailure(String(e));
      return false;
    }
  }

  function fallbackNative(id, reason, onFailure) {
    log('YouTube embed fallback', id, reason);
    return nativeYoutube(id, function () {
      try { if (Lampa.Player.opened && Lampa.Player.opened()) Lampa.Player.close(); }
      catch (e) { log('could not close Lampa player', e); }
      notify('YouTube: встроенный плеер недоступен; запущено приложение YouTube.');
    }, function (problem) {
      notify('YouTube: ' + problem);
      if (onFailure) onFailure(problem);
    });
  }

  function createYoutubeVideo(callVideo) {
    var $box = $('<div class="player-video__youtube" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden"></div>');
    var root = $box[0];
    var listener = Lampa.Subscribe();
    var src = '';
    var frame = null;
    var ready = false;
    var wantedPlay = false;
    var closed = false;
    var startTimer = null;
    var playTimer = null;
    var state = -1;
    var current = 0;
    var duration = 0;
    var muted = false;
    var volume = 100;
    var quality = '';
    var bridgeId = 'ltf_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    var videoId = '';
    var bridgeOrigin = '';

    function post(type, data) {
      if (!frame || !frame.contentWindow) return;
      try { frame.contentWindow.postMessage({ bridgeId: bridgeId, type: type, data: data || {} }, bridgeOrigin); }
      catch (e) { log('bridge post failed', e); }
    }

    function signalError(reason, code) {
      if (closed) return;
      clearTimeout(startTimer);
      clearTimeout(playTimer);
      counters.youtubeErrors.push({ video: videoId, code: code, reason: reason });
      if (counters.youtubeErrors.length > 10) counters.youtubeErrors.shift();
      log('YouTube error', code, reason);
      if (config.youtubeMode === 'auto' && videoId && window.webOS && webOS.service) {
        closed = true;
        fallbackNative(videoId, reason, function () {
          listener.send('error', { error: 'YouTube: ' + reason, fatal: true });
        });
      } else {
        notify('YouTube: ' + reason + (code ? ' (' + code + ')' : ''));
        listener.send('error', { error: 'YouTube: ' + reason, fatal: true });
      }
    }

    function onMessage(event) {
      if (!frame || event.source !== frame.contentWindow || event.origin !== bridgeOrigin) return;
      var msg = event.data;
      if (!msg || msg.bridgeId !== bridgeId || !msg.type) return;
      var d = msg.data || {};
      if (msg.type === 'ready') {
        ready = true;
        clearTimeout(startTimer);
        listener.send('loadeddata');
        listener.send('canplay');
        post('setVolume', { volume: volume });
        if (wantedPlay) startPlayback();
      } else if (msg.type === 'time') {
        current = Number(d.currentTime) || 0;
        duration = Number(d.duration) || 0;
        if (d.quality) quality = d.quality;
        listener.send('timeupdate');
      } else if (msg.type === 'state') {
        state = d.state;
        if (state === 1) {
          clearTimeout(playTimer);
          listener.send('playing');
        }
        else if (state === 2) listener.send('pause');
        else if (state === 3) listener.send('waiting');
        else if (state === 0) listener.send('ended');
      } else if (msg.type === 'error') {
        var code = String(d.code || 'unknown');
        var explain = code === '153' ? 'ошибка 153: YouTube не принял идентификацию iframe' :
          code === '101' || code === '150' ? 'автор запретил встраивание' :
          code === 'autoplay' ? 'webOS заблокировал автозапуск iframe' :
          'iframe не смог воспроизвести ролик';
        signalError(explain, code);
      }
    }

    // Some webOS WebViews return iframe "ready" but silently ignore playVideo().
    // Fall back to the installed YouTube application instead of leaving a frozen poster.
    function startPlayback() {
      if (!ready || closed) return;
      post('play');
      clearTimeout(playTimer);
      playTimer = setTimeout(function () {
        if (state !== 1 && !closed) signalError('встроенный YouTube не начал воспроизведение', 'play-timeout');
      }, 18000);
    }

    Object.defineProperty(root, 'src', { set: function (url) { src = url || ''; }, get: function () { return src; } });
    Object.defineProperty(root, 'paused', { get: function () { return state !== 1; } });
    Object.defineProperty(root, 'currentTime', { get: function () { return current; }, set: function (x) { current = Number(x) || 0; post('seekTo', { time: current }); } });
    Object.defineProperty(root, 'duration', { get: function () { return duration; } });
    Object.defineProperty(root, 'volume', { get: function () { return volume / 100; }, set: function (n) { volume = Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 100); post('setVolume', { volume: volume }); } });
    Object.defineProperty(root, 'muted', { get: function () { return muted; }, set: function (v) { muted = !!v; post(muted ? 'mute' : 'unMute'); } });
    Object.defineProperty(root, 'videoWidth', { get: function () { return quality === 'hd2160' ? 3840 : quality === 'hd1440' ? 2560 : quality === 'hd1080' ? 1920 : quality === 'hd720' ? 1280 : 0; } });
    Object.defineProperty(root, 'videoHeight', { get: function () { return quality === 'hd2160' ? 2160 : quality === 'hd1440' ? 1440 : quality === 'hd1080' ? 1080 : quality === 'hd720' ? 720 : 0; } });
    Object.defineProperty(root, 'audioTracks', { get: function () { return []; } });
    Object.defineProperty(root, 'textTracks', { get: function () { return []; } });

    root.addEventListener = listener.follow.bind(listener);
    root.canPlayType = function () { return 'maybe'; };
    root.resize = function () {};
    root.load = function () {
      if (frame || !bridgeUrl) {
        if (!bridgeUrl) signalError('bridge не настроен: опубликуй оба файла на HTTPS');
        return;
      }
      videoId = src.match(/\/youtube\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/i);
      videoId = videoId && videoId[1];
      if (!videoId) return signalError('invalid YouTube video ID');
      var url = new URL(bridgeUrl);
      if (url.protocol !== 'https:') return signalError('bridge должен работать по HTTPS');
      bridgeOrigin = url.origin;
      url.searchParams.set('videoId', videoId);
      url.searchParams.set('bridgeId', bridgeId);
      frame = document.createElement('iframe');
      frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      frame.setAttribute('allowfullscreen', 'true');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000';
      frame.src = url.href;
      window.addEventListener('message', onMessage);
      root.appendChild(frame);
      startTimer = setTimeout(function () { if (!ready) signalError('нет ответа от YouTube bridge за 25 секунд'); }, 25000);
    };
    root.play = function () { wantedPlay = true; if (ready) startPlayback(); };
    root.pause = function () { wantedPlay = false; clearTimeout(playTimer); if (ready) post('pause'); };
    root.destroy = function () {
      closed = true;
      clearTimeout(startTimer);
      clearTimeout(playTimer);
      try { post('destroy'); } catch (e) {}
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
      window.removeEventListener('message', onMessage);
      listener.destroy();
      $box.remove();
    };
    callVideo(root);
    return $box;
  }

  Lampa.PlayerVideo.registerTube({
    name: 'TrailerFixYouTubeBridge',
    verify: function (url) {
      return typeof url === 'string' && url.indexOf('https://' + INTERNAL_HOST + YT_PATH) === 0;
    },
    create: createYoutubeVideo
  });

  Lampa.Player.listener.follow('create', function (event) {
    var data = event && event.data;
    if (!data || typeof data.url !== 'string' || data.__trailerFixBypass) return;

    selection++;
    cancelPending();
    var requested = selection;

    var id = youtubeId(data.url);
    if (id) {
      event.abort();
      counters.youtube++;
      if (config.youtubeMode === 'native' && window.webOS && webOS.service) {
        nativeYoutube(id, function () { log('YouTube app started'); }, function (reason) {
          notify(reason);
          // Do not discard the selected trailer when the installed app cannot open.
          Lampa.Player.play(Object.assign({}, data, {
            url: 'https://' + INTERNAL_HOST + YT_PATH + id,
            youtube: false, __trailerFixBypass: true
          }));
        });
        return;
      }
      var playData = Object.assign({}, data, {
        url: 'https://' + INTERNAL_HOST + YT_PATH + id,
        youtube: false,
        __trailerFixBypass: true
      });
      Lampa.Player.play(playData);
      return;
    }

    id = rutubeId(data.url);
    if (!id || !config.rutubeQuality || typeof Lampa.Reguest !== 'function') return;
    event.abort();
    counters.rutube++;
    var originalData = Object.assign({}, data, { __trailerFixBypass: true });
    function fallback(reason) {
      counters.rutubeFallback++;
      log('RuTube: original TVIGL player fallback', reason);
      Lampa.Player.play(originalData);
    }
    var cancelOptions = requestRutubeOptions(id, function (err, master) {
      if (requested !== selection) return;
      if (err) return fallback(err.message);
      var cancelManifest = requestMaster(master, function (err2, manifest) {
        if (requested !== selection) return;
        if (err2) return fallback(err2.message);
        // An audio rendition group means variant-only URLs can be silent.
        // Pass the intact master playlist to Lampa's HLS handler instead.
        if (/^#EXT-X-MEDIA:\s*TYPE=AUDIO\b/im.test(manifest)) {
          Lampa.Player.play(Object.assign({}, originalData, {
            url: master, iptv: false, iptv_player: false
          }));
          return;
        }
        var variants = parseHlsMaster(manifest, master);
        if (!variants.length) return fallback('No variants in master');
        var qualityMap = { Auto: master };
        variants.forEach(function (v) { qualityMap[v.name] = v.url; });
        var first = variants[0];
        if (config.rutubePreferred === 'auto') first = { url: master };
        else if (config.rutubePreferred === '1080' || config.rutubePreferred === '720') {
          var ceiling = Number(config.rutubePreferred);
          first = variants.filter(function (v) { return v.height > 0 && v.height <= ceiling; })[0] || variants[variants.length - 1];
        }
        var current = Object.assign({}, originalData, {
          url: first.url,
          __ltfQualityMap: qualityMap,
          iptv: false,
          iptv_player: false
        });
        log('RuTube variants', qualityMap);
        // The stock Player.play() overrides data.url with Lampa's global
        // video_quality_default when data.quality is supplied. Defer setting
        // the UI quality map until Player's ready event to preserve our start
        // quality while retaining manual selection.
        if (!Lampa.PlayerPanel || typeof Lampa.PlayerPanel.quality !== 'function') {
          current.quality = qualityMap; // older Lampa fallback: global default wins
        }
        Lampa.Player.play(current);
      });
      pending.push(cancelManifest);
    });
    pending.push(cancelOptions);
  });

  Lampa.Player.listener.follow('ready', function (data) {
    if (!data || !data.__ltfQualityMap) return;
    if (Lampa.PlayerPanel && typeof Lampa.PlayerPanel.quality === 'function') {
      Lampa.PlayerPanel.quality(data.__ltfQualityMap, data.url);
      log('RuTube quality menu attached', data.url);
    }
  });

  window.LampaTrailerFix = {
    version: VERSION,
    config: config,
    stats: counters,
    bridgeUrl: bridgeUrl,
    parseHlsMaster: parseHlsMaster, // diagnostic and test only
    youtubeId: youtubeId,
    rutubeId: rutubeId
  };
  console.info('[TrailerFix] v' + VERSION + ', bridge=' + bridgeUrl + ', install order: TVIGL/CUB then TrailerFix');
})();