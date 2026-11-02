/*!
 * Adaptive Subtitles for Lampa v1.0.0 (MIT License)
 * HDR / Dolby Vision / HLG video -> subtitles are dimmed (no glare on OLED screens); SDR -> as in Lampa.
 * Dimming uses brightness, so colours and styling are kept (external subtitles, ASS: Lampa's simple renderer and JASSUB).
 * HDR detection: file name, TorrServer torrent title, ffprobe data (from the torrent parser or TorrServer /ffp,
 * shared with other plugins through window.__lampa_ffp__), HLS VIDEO-RANGE. Manual HDR/SDR key in the player
 * (remembered per torrent or per show). Other plugins can listen to the "adaptive_subs" event.
 *
 * On LG webOS, embedded (MKV) subtitles are drawn by the system player, not by HTML, so CSS does not affect them.
 * For those the plugin changes character opacity via luna://com.webos.media (setSubtitleCharacterOpacity), the same
 * method Lampa itself uses (src/interaction/player/video/webos/subtitles.js). The opacity chosen in Lampa is kept:
 * passed as is in SDR and dimmed proportionally in HDR.
 * The user interface is in Russian. ES5 + Promise, no dependencies.
 */
(function () {
    'use strict';

    if (window.adaptive_subs_plugin) return;
    window.adaptive_subs_plugin = true;

    var VERSION = "1.0.0";
    var STYLE_ID = 'adaptive-subs-style';
    var QUICK_WAIT = 1500;          // мс: ждём быстрые источники (название раздачи, HLS) до первого уведомления
    var NET_TIMEOUT = 4000;
    var FFP_TIMEOUT = 3e4;          // TorrServer запускает ffprobe по торренту: бывает долго
    var OVERRIDE_LIMIT = 300;
    var current = { profile: 'sdr', kind: 'sdr', brightness: 1, source: '', key: '', detected: 'sdr' };
    var lookupToken = 0;
    var session = 0;
    var torrCache = {};
    var hlsCache = {};

    // ---------- Настройки ----------
    var DEFAULTS = {
        adaptive_subs_mode: 'auto',
        adaptive_subs_hdr_style: 'dim',
        adaptive_subs_hdr_tone: '#7a7a7a',
        adaptive_subs_level_hdr10: 'same',
        adaptive_subs_level_dv: 'same',
        adaptive_subs_level_hlg: 'same',
        adaptive_subs_ass: 'true',
        adaptive_subs_webos_opacity: '128',
        adaptive_subs_webos_size: 'default',
        adaptive_subs_sdr_color: 'lampa',
        adaptive_subs_size: 'default',
        adaptive_subs_ffp: 'true',
        adaptive_subs_hls: 'true',
        adaptive_subs_display: 'false',
        adaptive_subs_webos_probe: 'false',
        adaptive_subs_key: 'none',
        adaptive_subs_notify: 'true'
    };

    function opt(name) {
        var v;
        try { v = Lampa.Storage.get(name, DEFAULTS[name]); } catch (e) { v = DEFAULTS[name]; }
        return (v === undefined || v === null || v === '') ? DEFAULTS[name] : v;
    }

    function flag(name) {
        var v = opt(name);
        return v === true || v === 'true';
    }

    function copy(obj) {
        var out = {};
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
        return out;
    }

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('AdaptiveSubs');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function isHdrKind(kind) {
        return kind === 'hdr' || kind === 'hdr10' || kind === 'dv' || kind === 'hlg';
    }


    // ---------- Признаки HDR в тексте (название, адрес, качество, раздача) ----------
    var SEP = '(?:^|[\\s._\\-\\[\\]\\(\\)/,+|])';
    var END = '(?=$|[\\s._\\-\\[\\]\\(\\)/,+|])';
    var DV_RE = new RegExp(SEP + '(?:dolby[\\s._\\-]?vision|dovi|dv)' + END, 'i');
    var HLG_RE = new RegExp(SEP + 'hlg' + END, 'i');
    var HDR10_RE = new RegExp(SEP + '(?:hdr10\\+?|hdr10plus|smpte[\\s._\\-]?2084)' + END, 'i');
    var HDR_RE = new RegExp(SEP + '(?:hdr|uhd[\\s._\\-]?hdr)' + END, 'i');
    var SDR_RE = new RegExp(SEP + 'sdr' + END, 'i');

    function safeDecode(s) {
        s = String(s || '');
        for (var i = 0; i < 2; i++) {
            try { var d = decodeURIComponent(s.replace(/\+/g, ' ')); if (d === s) break; s = d; } catch (e) { break; }
        }
        return s;
    }

    // -> 'dv' | 'hlg' | 'hdr10' | 'hdr' | 'sdr' | null
    function kindFromText(text) {
        text = safeDecode(text);
        if (!text) return null;
        if (DV_RE.test(text)) return 'dv';
        if (HLG_RE.test(text)) return 'hlg';
        if (HDR10_RE.test(text)) return 'hdr10';
        if (HDR_RE.test(text)) return 'hdr';
        if (SDR_RE.test(text)) return 'sdr';
        return null;
    }

    // Совместимость с v3: 'hdr' | 'sdr' | null
    function detectFromText(text) {
        var k = kindFromText(text);
        return k ? (isHdrKind(k) ? 'hdr' : 'sdr') : null;
    }

    function collectStrings(data) {
        var out = [];
        if (!data || typeof data !== 'object') return out;
        var keys = ['title', 'url', 'path', 'quality', 'name', 'file', 'translate', 'voice_name', 'release', 'info'];
        for (var i = 0; i < keys.length; i++) {
            var v = data[keys[i]];
            if (typeof v === 'string') out.push(v);
            else if (v && typeof v === 'object' && !(v instanceof Array)) {
                // quality: { "2160p HDR": url, ... }
                for (var k in v) if (v.hasOwnProperty(k)) out.push(k);
            }
        }
        return out;
    }

    // Первая строка с признаком решает (как в v3)
    function kindFromData(data) {
        var strings = collectStrings(data);
        for (var i = 0; i < strings.length; i++) {
            var found = kindFromText(strings[i]);
            if (found) return found;
        }
        return null;
    }

    // ---------- Признаки HDR в ffprobe (данные раздачи или TorrServer /ffp) ----------
    // color_transfer: smpte2084 = PQ (HDR10/HDR10+), arib-std-b67 = HLG;
    // Dolby Vision: side_data «DOVI configuration record» или codec_tag dvh1/dvhe/dva1/dvav
    function kindFromStreams(list) {
        if (list && !Array.isArray(list) && Array.isArray(list.streams)) list = list.streams;
        if (!Array.isArray(list)) return null;
        var video = null, i;
        for (i = 0; i < list.length; i++) {
            var s = list[i];
            if (s && s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)) { video = s; break; }
        }
        if (!video) return null;
        var dv = /^(?:dvh1|dvhe|dva1|dvav)$/i.test(String(video.codec_tag_string || ''));
        var side = video.side_data_list;
        if (Array.isArray(side)) {
            for (i = 0; i < side.length; i++) {
                if (/dovi|dolby\s*vision/i.test(String(side[i] && side[i].side_data_type || ''))) dv = true;
            }
        }
        if (dv) return 'dv';
        var trc = String(video.color_transfer || '').toLowerCase();
        if (trc === 'smpte2084') return 'hdr10';
        if (trc === 'arib-std-b67') return 'hlg';
        if (trc && trc !== 'unknown' && trc !== 'unspecified' && trc !== 'reserved') return 'sdr';
        // 8 бит без сведений о передаточной функции — SDR (HDR10/HLG/DV требуют 10 бит)
        if (/^(?:yuv420p|yuvj420p|nv12|yuv422p|yuv444p)$/i.test(String(video.pix_fmt || ''))) return 'sdr';
        return null;
    }

    // ---------- HLS: VIDEO-RANGE (SDR | HLG | PQ) и CODECS в мастер-плейлисте ----------
    function kindFromHls(text) {
        if (typeof text !== 'string' || text.indexOf('#EXTM3U') === -1) return null;
        var lines = text.split(/\r?\n/), kinds = {}, n = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
            n++;
            var attrs = line.slice(18);
            var range = /(?:^|,)VIDEO-RANGE=([A-Za-z]+)/.exec(attrs);
            var codecs = /(?:^|,)CODECS="([^"]*)"/.exec(attrs);
            var k = '?';
            if (codecs && /(?:^|,)\s*(?:dvh1|dvhe|dva1|dvav)\./i.test(codecs[1])) k = 'dv';
            else if (range) {
                var r = range[1].toUpperCase();
                k = r === 'PQ' ? 'hdr10' : (r === 'HLG' ? 'hlg' : (r === 'SDR' ? 'sdr' : '?'));
            }
            kinds[k] = true;
        }
        if (!n || kinds['?']) return null;
        var list = Object.keys(kinds);
        if (list.length === 1) return list[0];
        if (kinds.sdr) return null;          // есть и SDR, и HDR — что выберет плеер, неизвестно
        return 'hdr';
    }


    // ---------- TorrServer ----------
    // Общий кэш ffprobe для autoskip и adaptive_subs: один запуск ffprobe на файл (та же реализация, что в autoskip)
    function sharedFfp() {
        if (!window.__lampa_ffp__ || typeof window.__lampa_ffp__.get !== 'function') {
            window.__lampa_ffp__ = {
                v: 1,
                _p: {},
                get: function (base, hash, index, auth, timeout) {
                    var key = (base + '|' + hash + '|' + index).toLowerCase(), cache = this._p;
                    if (cache[key]) return cache[key];
                    var p = new Promise(function (resolve) {
                        var xhr, done = false, timer;
                        function finish(r) {
                            if (done) return;
                            done = true;
                            clearTimeout(timer);
                            if (!r || r.status !== 200) setTimeout(function () { if (cache[key] === p) delete cache[key]; }, 6e4);
                            resolve(r);
                        }
                        try {
                            xhr = new XMLHttpRequest();
                            xhr.open('GET', base + '/ffp/' + hash + '/' + index, true);
                            if (auth) xhr.setRequestHeader('Authorization', auth);
                            xhr.onreadystatechange = function () {
                                if (xhr.readyState !== 4) return;
                                var json = null;
                                try { json = JSON.parse(xhr.responseText); } catch (e) {}
                                finish({ status: xhr.status, json: json });
                            };
                            xhr.onerror = function () { finish({ status: 0, json: null }); };
                            timer = setTimeout(function () {
                                try { xhr.abort(); } catch (e) {}
                                finish({ status: 0, json: null, timeout: true });
                            }, timeout || 3e4);
                            xhr.send(null);
                        } catch (e) { finish({ status: 0, json: null }); }
                    });
                    cache[key] = p;
                    return p;
                }
            };
        }
        return window.__lampa_ffp__;
    }

    // { base, hash, index|null } из адреса потока TorrServer: /stream, /play и GStreamer /gst
    function torrTarget(data) {
        var url = data && typeof data.url === 'string' ? data.url : '';
        var base = url.match(/^(https?:\/\/[^\/?#]+(?:\/[^?#]*?)?)\/(?:stream|play|gst)(?:\/|\?|$)/);
        if (!base) return null;
        var hash = null, index = null, m;
        if (data && typeof data.torrent_hash === 'string' && /^[a-fA-F0-9]{40}$/.test(data.torrent_hash)) hash = data.torrent_hash;
        if (!hash) {
            m = url.match(/[?&]link=([a-fA-F0-9]{40})(?![a-fA-F0-9])/) || url.match(/\/(?:play|gst)\/([a-fA-F0-9]{40})(?![a-fA-F0-9])/);
            if (m) hash = m[1];
        }
        m = url.match(/[?&]index=(\d+)/) || url.match(/\/play\/[a-fA-F0-9]{40}\/(\d+)/);
        if (m) index = parseInt(m[1], 10);
        if (!hash) return null;
        return { base: base[1], hash: hash.toLowerCase(), index: index, key: hash.toLowerCase() };
    }

    // Как Lampa (utils/reguest.js): Basic-авторизация, если включена и запрос идёт на адрес TorrServer
    function torrAuth(base) {
        try {
            var on = Lampa.Storage.field ? Lampa.Storage.field('torrserver_auth') : Lampa.Storage.get('torrserver_auth', false);
            if (!(on === true || on === 'true')) return null;
            var urls = [Lampa.Storage.get('torrserver_url', ''), Lampa.Storage.get('torrserver_url_two', '')], hit = false;
            for (var i = 0; i < urls.length; i++) {
                var u = String(urls[i] || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                if (u && base.indexOf(u) !== -1) hit = true;
            }
            if (!hit) return null;
            var pair = Lampa.Storage.get('torrserver_login', '') + ':' + (Lampa.Storage.value ? Lampa.Storage.value('torrserver_password', '') : Lampa.Storage.get('torrserver_password', ''));
            return 'Basic ' + (Lampa.Base64 && Lampa.Base64.encode ? Lampa.Base64.encode(pair) : btoa(pair));
        } catch (e) { return null; }
    }

    // Точный тип по файлу: ffprobe TorrServer (GET /ffp/:hash/:id)
    function ffpKind(t) {
        if (!t || t.index === null || t.index === undefined) return Promise.resolve(null);
        return sharedFfp().get(t.base, t.hash, t.index, torrAuth(t.base), FFP_TIMEOUT).then(function (r) {
            if (!r || r.status !== 200 || !r.json) {
                log('ffprobe from TorrServer unavailable', r ? r.status : '');
                return null;
            }
            return kindFromStreams(r.json.streams || r.json);
        }, function () { return null; });
    }

    // Название раздачи из TorrServer (в имени файла HDR/DV часто нет)
    function torrTitle(t) {
        return new Promise(function (resolve) {
            if (!t) return resolve(null);
            if (torrCache.hasOwnProperty(t.key)) return resolve(torrCache[t.key]);
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', t.base + '/torrents', true);
                xhr.timeout = NET_TIMEOUT;
                xhr.setRequestHeader('Content-Type', 'application/json');
                var auth = torrAuth(t.base);
                if (auth) xhr.setRequestHeader('Authorization', auth);
                xhr.onload = function () {
                    var text = null;
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var j = JSON.parse(xhr.responseText);
                            text = [j.title, j.name].join(' ');
                            torrCache[t.key] = text;
                        } catch (e) {}
                    }
                    resolve(text);
                };
                xhr.onerror = xhr.ontimeout = function () { resolve(null); };
                xhr.send(JSON.stringify({ action: 'get', hash: t.hash }));
            } catch (e) { resolve(null); }
        });
    }

    // ---------- HLS: мастер-плейлист онлайн-потока ----------
    function hlsKind(url) {
        if (hlsCache.hasOwnProperty(url)) return Promise.resolve(hlsCache[url]);
        return new Promise(function (resolve) {
            var done = false, timer;
            function finish(k) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(k);
            }
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    var k = xhr.status >= 200 && xhr.status < 300 ? kindFromHls(xhr.responseText) : null;
                    if (xhr.status >= 200 && xhr.status < 300) hlsCache[url] = k;
                    finish(k);
                };
                xhr.onerror = function () { finish(null); };
                timer = setTimeout(function () {
                    try { xhr.abort(); } catch (e) {}
                    finish(null);
                }, NET_TIMEOUT);
                xhr.send(null);
            } catch (e) { finish(null); }
        });
    }


    // ---------- LG webOS: встроенные субтитры ----------
    var webosOrigRequest = null;
    var lampaOpacity = 255;      // прозрачность символов, выбранная в Lampa (кнопка 9)
    var dimmedMediaId = null;    // mediaId, для которого выставлено затемнение
    var probeLogged = {};        // mediaId -> true: сведения webOS о видео уже записаны в журнал

    // Веб-версия Lampa подключает webOSTV.js всегда (index.html), поэтому window.webOS есть и в обычном
    // браузере. Телевизор определяем, как сама Lampa (core/platform.js): webOS.platform.tv === true
    function isWebos() {
        var w = window.webOS, tv = false;
        if (!w || !w.service || typeof w.service.request !== 'function') return false;
        try { tv = !!(Lampa.Platform && typeof Lampa.Platform.is === 'function' && Lampa.Platform.is('webos')); } catch (e) {}
        return tv || !!(w.platform && w.platform.tv === true);
    }

    function readLampaOpacity() {
        try {
            var p = Lampa.Storage.get('webos_subs_params', '{}');
            if (typeof p === 'string') p = JSON.parse(p);
            var v = p ? parseInt(p.char_opacity, 10) : NaN;
            if (!isNaN(v) && v >= 0 && v <= 255) return v;
        } catch (e) {}
        return 255;
    }

    // В HDR: доля от значения Lampa; уровень HDR10/DV/HLG меняет её пропорционально основному уровню
    function webosOpacity() {
        if (current.profile !== 'hdr') return lampaOpacity;
        var k = parseInt(opt('adaptive_subs_webos_opacity'), 10);
        if (isNaN(k) || k < 0 || k > 255) k = 255;
        var ratio = current.brightness > 0 ? current.brightness / mainLevel() : 1;
        var v = Math.round(lampaOpacity * k / 255 * ratio);
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    function webosFontSize() {
        var v = opt('adaptive_subs_webos_size');
        if (v === 'default') return null;
        v = parseInt(v, 10);
        return (isNaN(v) || v < 0 || v > 4) ? null : v;
    }

    function currentMediaId() {
        var video = document.querySelector('video');
        return video && video.mediaId ? video.mediaId : null;
    }

    // Эксперимент (по умолчанию выключен): что webOS сообщает о видео в sourceInfo.
    // Какие поля там бывают, не проверено на телевизоре: в журнал пишется всё, а для решения
    // берутся только явные известные значения (HDR10, HDR10+, HLG, Dolby Vision, SDR).
    var WEBOS_KNOWN = { hdr10: 'hdr10', 'hdr10+': 'hdr10', hdr10plus: 'hdr10', hlg: 'hlg', dolbyvision: 'dv', 'dolby vision': 'dv', dovi: 'dv', sdr: 'sdr' };

    function inspectWebos(result) {
        var info = result && result.sourceInfo && result.sourceInfo.programInfo && result.sourceInfo.programInfo[0];
        if (!info) return null;
        var tracks = info.videoTrackInfo || info.videoInfo || [];
        if (!Array.isArray(tracks)) tracks = [tracks];
        var found = null;
        for (var i = 0; i < tracks.length && !found; i++) {
            var t = tracks[i];
            if (!t || typeof t !== 'object') continue;
            for (var k in t) {
                if (!t.hasOwnProperty(k) || typeof t[k] !== 'string' || !/hdr|range|transfer|dolby/i.test(k)) continue;
                var v = t[k].trim().toLowerCase();
                if (WEBOS_KNOWN.hasOwnProperty(v)) { found = WEBOS_KNOWN[v]; break; }
            }
        }
        return { kind: found, video: tracks };
    }

    // Перехват вызовов Lampa в com.webos.media: значение Lampa запоминаем и
    // передаём дальше (в HDR — затемнённым). Объект Lampa не меняем — работаем с копией.
    function hookWebos() {
        if (!isWebos() || webosOrigRequest) return;
        lampaOpacity = readLampaOpacity();
        webosOrigRequest = window.webOS.service.request;
        window.webOS.service.request = function (uri, params) {
            var args = arguments;
            try {
                if (String(uri).indexOf('com.webos.media') !== -1 && params && params.parameters) {
                    var p = null, np = null;
                    if (params.method === 'setSubtitleCharacterOpacity') {
                        var v = parseInt(params.parameters.charOpacity, 10);
                        if (!isNaN(v) && v >= 0 && v <= 255) lampaOpacity = v;
                        p = copy(params.parameters);
                        p.charOpacity = webosOpacity();
                        if (current.profile === 'hdr') dimmedMediaId = p.mediaId || null;
                        else if (dimmedMediaId === p.mediaId) dimmedMediaId = null;
                    } else if (params.method === 'setSubtitleFontSize') {
                        var fs = webosFontSize();
                        if (fs !== null) {
                            p = copy(params.parameters);
                            p.fontSize = fs;
                        }
                    } else if (params.method === 'subscribe' && typeof params.onSuccess === 'function' && flag('adaptive_subs_webos_probe')) {
                        var orig = params.onSuccess, media = params.parameters.mediaId, sess = session;
                        np = copy(params);
                        np.onSuccess = function (result) {
                            try {
                                var r = result && result.sourceInfo ? inspectWebos(result) : null;
                                if (r && !probeLogged[media]) {
                                    probeLogged[media] = true;
                                    log('webOS sourceInfo video:', JSON.stringify(r.video), '->', r.kind || 'нет известного признака');
                                    if (r.kind && sess === session && Resolver.active) Resolver.active.offer(r.kind, 'webos');
                                }
                            } catch (e) {}
                            return orig.apply(this, arguments);
                        };
                    }
                    if (p) {
                        np = copy(params);
                        np.parameters = p;
                    }
                    if (np) args = [uri, np];
                }
            } catch (e) {}
            return webosOrigRequest.apply(this, args);
        };
    }

    function webosCall(method, parameters, mediaId) {
        if (!webosOrigRequest || !mediaId) return;
        parameters.mediaId = mediaId;
        webosOrigRequest.call(window.webOS.service, 'luna://com.webos.media', {
            method: method,
            parameters: parameters,
            onSuccess: function () {},
            onFailure: function (r) { log(method, 'fail', r && r.errorText); }
        });
    }

    // HDR — затемнить; SDR — только вернуть значение Lampa, если мы затемняли это же видео
    function applyWebos() {
        if (!webosOrigRequest) return;
        var id = currentMediaId();
        if (!id) return;
        if (current.profile === 'hdr') {
            webosCall('setSubtitleCharacterOpacity', { charOpacity: webosOpacity() }, id);
            dimmedMediaId = id;
        } else if (dimmedMediaId === id) {
            webosCall('setSubtitleCharacterOpacity', { charOpacity: lampaOpacity }, id);
            dimmedMediaId = null;
        }
        var fs = webosFontSize();
        if (fs !== null) webosCall('setSubtitleFontSize', { fontSize: fs }, id);
    }

    // На start видео ещё не создано: ждём mediaId (до ~20 с) и применяем к каждому новому
    function watchMedia(sess) {
        if (!webosOrigRequest) return;
        var tries = 0, applied = null;
        (function tick() {
            if (sess !== session) return;
            var id = currentMediaId();
            if (id && id !== applied) {
                applied = id;
                applyWebos();
            }
            if (++tries < 40) setTimeout(tick, 500);
        })();
    }


    // ---------- Уровни яркости ----------
    // Значения соответствуют прежним серым цветам v3: #9a -> 0.60, #8a -> 0.54, #7a -> 0.48, #66 -> 0.40, #55 -> 0.33
    var TONES = { '#9a9a9a': 0.60, '#8a8a8a': 0.54, '#7a7a7a': 0.48, '#666666': 0.40, '#555555': 0.33 };
    var TONE_NAMES = {
        '#9a9a9a': 'Светлее — 60%',
        '#8a8a8a': 'Умеренно — 54%',
        '#7a7a7a': 'Темнее — 48%',
        '#666666': 'Тёмные — 40%',
        '#555555': 'Очень тёмные — 33%'
    };
    var KIND_NAMES = { dv: 'Dolby Vision', hdr10: 'HDR10', hlg: 'HLG', hdr: 'HDR', sdr: 'SDR' };

    function mainLevel() {
        return TONES[opt('adaptive_subs_hdr_tone')] || TONES[DEFAULTS.adaptive_subs_hdr_tone];
    }

    function levelFor(kind) {
        var v = kind === 'hdr10' || kind === 'dv' || kind === 'hlg' ? opt('adaptive_subs_level_' + kind) : 'same';
        return v && v !== 'same' && TONES[v] ? TONES[v] : mainLevel();
    }

    // Серый того же уровня — для режима «перекрашивать» и для video::cue
    function toneFor(b) {
        var n = Math.max(0, Math.min(255, Math.round(b * 255))), h = n.toString(16);
        if (h.length < 2) h = '0' + h;
        return '#' + h + h + h;
    }

    // ---------- Стили ----------
    var HDR_SHADOW = '0 0 3px rgba(0,0,0,.9), 0 0 6px rgba(0,0,0,.7), 1px 1px 2px #000';
    var SDR_SHADOW = '0 0 2px #000, 0 0 4px #000, 1px 1px 2px #000, -1px -1px 2px #000';

    function buildCss(st) {
        st = st || current;
        var css = '';
        if (st.profile === 'hdr') {
            var b = st.brightness > 0 && st.brightness <= 1 ? st.brightness : mainLevel(), tone = toneFor(b);
            var f = 'brightness(' + b + ')';
            if (opt('adaptive_subs_hdr_style') === 'color') {
                css += '.player-video__subtitles-text, .player-video__subtitles-text *{color:' + tone + ' !important;' +
                       'text-shadow:' + HDR_SHADOW + ' !important;}';
            } else {
                // яркостью: цветные надписи и оформление остаются, просто темнее
                css += '.player-video__subtitles-text{filter:' + f + ' !important;-webkit-filter:' + f + ' !important;}';
            }
            // WebVTT, который рисует сам браузер: фильтры к ::cue не применяются — только цвет (как в v3)
            css += 'video::cue{color:' + tone + ' !important;text-shadow:' + HDR_SHADOW + ' !important;}';
            // ASS: простой рендер Lampa (.player-video__ass) и JASSUB (холст в .JASSUB)
            if (flag('adaptive_subs_ass')) {
                css += '.player-video__ass, .JASSUB{filter:' + f + ' !important;-webkit-filter:' + f + ' !important;}';
            }
        } else {
            var color = opt('adaptive_subs_sdr_color');
            if (color && color !== 'lampa') {
                css += '.player-video__subtitles-text, .player-video__subtitles-text *{color:' + color + ' !important;' +
                       'text-shadow:' + SDR_SHADOW + ' !important;}' +
                       'video::cue{color:' + color + ' !important;text-shadow:' + SDR_SHADOW + ' !important;}';
            }
        }
        var size = opt('adaptive_subs_size');
        if (size && size !== 'default') {
            css += '.player-video__subtitles-text{font-size:' + size + ' !important;line-height:1.25 !important;}' +
                   'video::cue{font-size:' + size + ' !important;}';
        }
        return css;
    }

    function applyStyle() {
        var el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            document.head.appendChild(el);
        }
        var css = buildCss(current);
        if (el.textContent !== css) el.textContent = css;
    }


    // ---------- Профиль: применение, уведомление, событие для других плагинов ----------
    var SOURCE_NAMES = {
        name: 'по названию', torrserver: 'по раздаче TorrServer', parser: 'по данным раздачи', ffprobe: 'по файлу',
        hls: 'по потоку HLS', webos: 'по данным webOS', manual: 'вручную', override: 'ваш выбор',
        display: 'экран без HDR', 'default': 'признаков HDR нет'
    };
    // Чем выше, тем надёжнее; более слабый источник не перебивает уже найденное
    var PRIO = { 'default': 0, name: 1, torrserver: 2, webos: 3, hls: 4, parser: 5, ffprobe: 6, override: 8, manual: 9 };

    // Экран сам не показывает HDR (эксперимент): только если браузер знает признак dynamic-range
    function displaySdr() {
        try {
            if (!window.matchMedia) return false;
            return !window.matchMedia('(dynamic-range: high)').matches && window.matchMedia('(dynamic-range: standard)').matches;
        } catch (e) { return false; }
    }

    function emit() {
        var detail = { type: 'profile', profile: current.profile, kind: current.kind, brightness: current.brightness, source: current.source };
        try { if (Lampa.Listener && typeof Lampa.Listener.send === 'function') Lampa.Listener.send('adaptive_subs', detail); } catch (e) {}
        try {
            var ev;
            if (typeof CustomEvent === 'function') ev = new CustomEvent('adaptive_subs:profile', { detail: detail });
            else {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent('adaptive_subs:profile', false, false, detail);
            }
            window.dispatchEvent(ev);
        } catch (e) {}
    }

    function applyKind(kind, source) {
        var before = current.profile + '|' + current.kind + '|' + current.brightness;
        var hdr = isHdrKind(kind);
        current.kind = kind || 'sdr';
        current.source = source || '';
        current.profile = hdr ? 'hdr' : 'sdr';
        if (source !== 'manual' && source !== 'override') current.detected = current.kind;
        if (hdr && source !== 'manual' && source !== 'override' && flag('adaptive_subs_display') && displaySdr()) {
            current.profile = 'sdr';
            current.source = 'display';
        }
        current.brightness = current.profile === 'hdr' ? levelFor(current.kind) : 1;
        applyStyle();
        applyWebos();
        if (before !== current.profile + '|' + current.kind + '|' + current.brightness) emit();
    }

    function announce(refined, extra) {
        if (!flag('adaptive_subs_notify')) return;
        var hdr = current.profile === 'hdr';
        var text = (refined ? 'Субтитры уточнены: ' : 'Субтитры: ') +
            (hdr ? (KIND_NAMES[current.kind] || 'HDR') + ' — затемнённые, ' + Math.round(current.brightness * 100) + '%' : 'SDR — обычные');
        var why = extra || SOURCE_NAMES[current.source];
        if (why) text += ' (' + why + ')';
        try { Lampa.Noty.show(text); } catch (e) { log(text); }
    }

    // ---------- Ручной выбор HDR/SDR: для раздачи (по хешу) или для сериала/фильма ----------
    var OVERRIDES = 'adaptive_subs_overrides';

    function overrideKey(info) {
        if (info && info.hash) return 'h:' + info.hash;
        if (info && info.tmdb) return 't:' + info.tmdb;
        return '';
    }

    function readOverrides() {
        var v;
        try { v = Lampa.Storage.get(OVERRIDES, '{}'); if (typeof v === 'string') v = JSON.parse(v); } catch (e) { v = null; }
        return v && typeof v === 'object' && !(v instanceof Array) ? v : {};
    }

    function getOverride(key) {
        var v = key ? readOverrides()[key] : null;
        return v && (v.p === 'hdr' || v.p === 'sdr') ? v.p : null;
    }

    function setOverride(key, profile) {
        if (!key) return;
        var all = readOverrides(), list = [], k;
        if (profile) all[key] = { p: profile, t: Date.now() };
        else delete all[key];
        for (k in all) if (all.hasOwnProperty(k)) list.push({ k: k, t: all[k] && all[k].t || 0 });
        if (list.length > OVERRIDE_LIMIT) {
            list.sort(function (a, b) { return a.t - b.t; });
            for (var i = 0; i < list.length - OVERRIDE_LIMIT; i++) delete all[list[i].k];
        }
        try { Lampa.Storage.set(OVERRIDES, all); } catch (e) {}
    }

    // ---------- Определение за запуск: быстрые признаки сразу, точные — уточняют ----------
    // Уведомление одно: после быстрых источников (до QUICK_WAIT); второе — только если точный
    // источник позже сменил HDR на SDR или наоборот
    function Resolver(notify) {
        this.token = ++lookupToken;
        this.notify = notify;
        this.best = null;
        this.announced = null;
        this.refined = false;
        this.pending = 0;
        this.timer = null;
        Resolver.active = this;
    }

    Resolver.active = null;

    Resolver.prototype.alive = function () {
        return this.token === lookupToken;
    };

    Resolver.prototype.offer = function (kind, source) {
        if (!this.alive() || !kind) return false;
        var prio = PRIO[source] || 0;
        if (this.best && prio <= this.best.prio) return false;
        var was = this.announced !== null ? current.profile : null;
        this.best = { kind: kind, source: source, prio: prio };
        applyKind(kind, source);
        if (was !== null && !this.refined && current.profile !== was) {
            this.refined = true;
            if (this.notify) announce(true);
        }
        return true;
    };

    Resolver.prototype.wait = function (promise, source) {
        var self = this;
        this.pending++;
        promise.then(function (kind) { self.offer(kind, source); }, function () {}).then(function () {
            self.pending--;
            if (!self.pending) self.flush();
        });
    };

    Resolver.prototype.start = function () {
        var self = this;
        if (!this.pending) return this.flush();
        this.timer = setTimeout(function () { self.flush(); }, QUICK_WAIT);
    };

    Resolver.prototype.flush = function () {
        clearTimeout(this.timer);
        if (!this.alive() || this.announced !== null) return;
        this.announced = current.profile;
        if (this.notify) announce(false);
    };

    function activityCard() {
        try {
            var act = Lampa.Activity.active();
            return act ? act.card || act.movie || null : null;
        } catch (e) { return null; }
    }

    // Ключ сериала/фильма как в autoskip: id TMDB у карточек tmdb и cub, у других источников — «источник-id»
    function cardKey(card) {
        if (!card || card.id === undefined || card.id === null || card.id === '' || card.id === 0) return '';
        if (!card.source || card.source === 'tmdb' || card.source === 'cub') return String(card.id);
        return String(card.source).replace(/[^A-Za-z0-9]/g, '') + '-' + String(card.id).replace(/[^A-Za-z0-9]/g, '');
    }

    function describeData(data) {
        data = data || {};
        var torr = torrTarget(data), card = data.card || activityCard(), url = typeof data.url === 'string' ? data.url : '';
        return {
            torr: torr,
            hash: torr ? torr.hash : '',
            tmdb: cardKey(card),
            url: url,
            hls: !torr && /^https?:\/\/.+\.m3u8(?:$|[?#])/i.test(url)
        };
    }

    function evaluate(data, notify) {
        var r = new Resolver(notify), info = describeData(data);
        current.key = overrideKey(info);
        var mode = opt('adaptive_subs_mode');
        if (mode === 'hdr' || mode === 'sdr') {
            r.offer(mode, 'manual');
            return r.flush();
        }
        var ov = getOverride(current.key);
        if (ov) {
            r.offer(ov === 'hdr' ? 'hdr' : 'sdr', 'override');
            return r.flush();
        }
        var byName = kindFromData(data);
        r.offer(byName || 'sdr', byName ? 'name' : 'default');
        var byParser = kindFromStreams(data && data.ffprobe);
        if (byParser) r.offer(byParser, 'parser');
        if (info.torr) {
            if (!byParser && flag('adaptive_subs_ffp')) r.wait(ffpKind(info.torr), 'ffprobe');
            if (!byName && !byParser) r.wait(torrTitle(info.torr).then(kindFromText), 'torrserver');
        } else if (info.hls && !byParser && flag('adaptive_subs_hls')) {
            r.wait(hlsKind(info.url), 'hls');
        }
        r.start();
        return r;
    }

    // Клавиша в плеере: HDR <-> SDR, выбор запоминается
    function toggleProfile() {
        var next = current.profile === 'hdr' ? 'sdr' : 'hdr', key = current.key;
        lookupToken++;                          // поздние уточнения не перебьют выбор пользователя
        Resolver.active = null;
        if (key) setOverride(key, next);
        applyKind(next === 'hdr' ? (isHdrKind(current.detected) ? current.detected : 'hdr') : 'sdr', 'override');
        announce(false, key ? 'запомнено для ' + (key.charAt(0) === 'h' ? 'раздачи' : 'сериала или фильма') : 'вручную');
        return next;
    }

    var KEY_CODES = { red: [403], green: [404], yellow: [405], blue: [406] };

    function playerActive() {
        try {
            if (!(Lampa.Player.opened && Lampa.Player.opened())) return false;
            var en = Lampa.Controller && Lampa.Controller.enabled ? Lampa.Controller.enabled() : null;
            return !en || typeof en.name !== 'string' || en.name === 'player';
        } catch (e) { return false; }
    }

    function bindKey() {
        var kp = Lampa.Keypad && Lampa.Keypad.listener;
        if (!kp || typeof kp.follow !== 'function') return;
        kp.follow('keydown', function (e) {
            var codes = KEY_CODES[opt('adaptive_subs_key')];
            if (!codes || !e || codes.indexOf(parseInt(e.code, 10)) === -1 || !playerActive()) return;
            toggleProfile();
            if (e.event && typeof e.event.preventDefault === 'function') e.event.preventDefault();
        });
    }

    function playdata() {
        try { return Lampa.Player.playdata ? Lampa.Player.playdata() : null; } catch (e) { return null; }
    }

    function playerOpened() {
        try { return !!(Lampa.Player.opened && Lampa.Player.opened()); } catch (e) { return false; }
    }

    // start приходит и при первом запуске, и при выборе серии в плейлисте
    function onStart(data) {
        var sess = ++session;
        try { evaluate(data || playdata(), true); } catch (e) { log(e && e.message); }
        watchMedia(sess);
    }

    function onDestroy() {
        lookupToken++;
        session++;
        Resolver.active = null;
    }


    // ---------- Меню настроек ----------
    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var webos = isWebos();
        var C = 'adaptive_subs';

        Lampa.SettingsApi.addComponent({
            component: C,
            name: 'Адаптивные субтитры',
            icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M6 13h5M13 13h5M6 16h8M16 16h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        });

        function add(param, field, extra) {
            var o = { component: C, param: param, field: field };
            if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
            try { Lampa.SettingsApi.addParam(o); } catch (e) {}
        }
        function title(name, text) { add({ name: name, type: 'title' }, { name: text }); }
        function refresh() { applyKind(current.kind, current.source); }
        function reevaluate() { if (playerOpened()) evaluate(playdata(), true); else refresh(); }
        var levels = { same: 'Как основной уровень' };
        for (var t in TONE_NAMES) if (TONE_NAMES.hasOwnProperty(t)) levels[t] = TONE_NAMES[t];

        title('adaptive_subs_t_detect', 'Определение HDR');
        add({ name: 'adaptive_subs_mode', type: 'select', default: DEFAULTS.adaptive_subs_mode,
            values: { auto: 'Авто (по файлу и релизу)', hdr: 'Всегда HDR (приглушённые)', sdr: 'Всегда SDR (обычные)' } },
            { name: 'Режим', description: 'Авто: технические данные файла (ffprobe), поток HLS, затем слова HDR / DV / Dolby Vision / HDR10 / HLG в названии файла и раздачи' },
            { onChange: reevaluate });
        add({ name: 'adaptive_subs_ffp', type: 'trigger', default: true },
            { name: 'Точно по файлу через TorrServer', description: 'ffprobe на TorrServer (/ffp): различает HDR10, Dolby Vision и HLG. Нужен TorrServer с ffprobe' });
        add({ name: 'adaptive_subs_hls', type: 'trigger', default: true },
            { name: 'По потоку HLS (онлайн)', description: 'Признак VIDEO-RANGE (SDR / HLG / PQ) в плейлисте m3u8, если источник его указывает' });
        add({ name: 'adaptive_subs_display', type: 'trigger', default: false },
            { name: 'Учитывать HDR экрана (эксперимент)', description: 'Если браузер сообщает, что экран сейчас без HDR (dynamic-range), не затемнять. На ТВ не проверено' });
        if (webos) {
            add({ name: 'adaptive_subs_webos_probe', type: 'trigger', default: false },
                { name: 'Сведения webOS о видео (эксперимент)', description: 'Записывать в журнал, что телевизор сообщает о видео, и использовать явный признак HDR, если он есть. Не проверено' });
        }

        title('adaptive_subs_t_look', 'Вид в HDR');
        add({ name: 'adaptive_subs_hdr_style', type: 'select', default: DEFAULTS.adaptive_subs_hdr_style,
            values: { dim: 'Затемнять (цвета сохраняются)', color: 'Перекрашивать в серый' } },
            { name: 'HDR: способ', description: 'Затемнение яркостью оставляет цветные надписи цветными. Субтитры WebVTT, которые рисует сам браузер, всегда перекрашиваются' },
            { onChange: refresh });
        add({ name: 'adaptive_subs_hdr_tone', type: 'select', default: DEFAULTS.adaptive_subs_hdr_tone, values: TONE_NAMES },
            { name: 'HDR: яркость субтитров', description: 'Основной уровень. В режиме «перекрашивать» — серый той же яркости' },
            { onChange: refresh });
        add({ name: 'adaptive_subs_level_hdr10', type: 'select', default: 'same', values: levels },
            { name: 'HDR10: яркость', description: 'Если тип HDR известен' }, { onChange: refresh });
        add({ name: 'adaptive_subs_level_dv', type: 'select', default: 'same', values: levels },
            { name: 'Dolby Vision: яркость' }, { onChange: refresh });
        add({ name: 'adaptive_subs_level_hlg', type: 'select', default: 'same', values: levels },
            { name: 'HLG: яркость' }, { onChange: refresh });
        add({ name: 'adaptive_subs_ass', type: 'trigger', default: true },
            { name: 'Затемнять субтитры ASS', description: 'Оформление ASS (цвета, караоке) сохраняется. Нагрузка на слабые ТВ не проверялась' },
            { onChange: refresh });
        if (webos) {
            add({ name: 'adaptive_subs_webos_opacity', type: 'select', default: DEFAULTS.adaptive_subs_webos_opacity,
                values: { '191': '75% — чуть темнее', '153': '60% — серые', '128': '50% — тёмно-серые', '102': '40% — тёмные', '77': '30% — очень тёмные' } },
                { name: 'HDR: яркость встроенных субтитров (LG webOS)', description: 'Для субтитров внутри MKV, которые рисует сам телевизор. Доля от яркости, выбранной в Lampa (кнопка 9). В SDR — как в Lampa' },
                { onChange: function () { applyWebos(); } });
        }

        title('adaptive_subs_t_sdr', 'SDR и размер');
        add({ name: 'adaptive_subs_sdr_color', type: 'select', default: DEFAULTS.adaptive_subs_sdr_color,
            values: { lampa: 'Не менять (как в Lampa)', '#ffffff': 'Белый', '#f0f0f0': 'Мягкий белый', '#fff4c2': 'Тёплый жёлтый' } },
            { name: 'SDR: цвет внешних субтитров', description: 'По умолчанию стиль Lampa не меняется' },
            { onChange: refresh });
        add({ name: 'adaptive_subs_size', type: 'select', default: DEFAULTS.adaptive_subs_size,
            values: { 'default': 'Не менять (как в Lampa)', '3.2vh': 'Очень маленький', '3.8vh': 'Маленький', '4.4vh': 'Средний', '5vh': 'Крупный', '5.8vh': 'Очень крупный' } },
            { name: 'Размер внешних субтитров', description: 'Одинаковый для SDR и HDR' },
            { onChange: refresh });
        if (webos) {
            add({ name: 'adaptive_subs_webos_size', type: 'select', default: DEFAULTS.adaptive_subs_webos_size,
                values: { 'default': 'Не менять (красная кнопка пульта)', '0': '0 — самый маленький', '1': '1', '2': '2', '3': '3', '4': '4 — самый большой' } },
                { name: 'Размер встроенных субтитров (LG webOS)' },
                { onChange: function () { applyWebos(); } });
        }

        title('adaptive_subs_t_ctrl', 'Управление');
        add({ name: 'adaptive_subs_key', type: 'select', default: DEFAULTS.adaptive_subs_key,
            values: { none: 'Нет', red: 'Красная (403)', green: 'Зелёная (404)', yellow: 'Жёлтая (405)', blue: 'Синяя (406)' } },
            { name: 'Клавиша HDR/SDR в плеере', description: 'Переключает профиль, если плагин ошибся, и запоминает выбор для раздачи (или сериала). ' +
                'На LG webOS цветные кнопки также управляют встроенными субтитрами Lampa; не назначайте ту же клавишу, что в плагине «Пропуск заставок»' });
        add({ name: 'adaptive_subs_forget', type: 'button' },
            { name: 'Забыть ручные выборы HDR/SDR', description: 'Снова определять автоматически' },
            { onChange: function () {
                try { Lampa.Storage.set(OVERRIDES, {}); } catch (e) {}
                try { Lampa.Noty.show('Ручные выборы HDR/SDR забыты'); } catch (e) {}
            } });
        add({ name: 'adaptive_subs_notify', type: 'trigger', default: true },
            { name: 'Уведомление при старте', description: 'Какой профиль включился и почему; второе — только если точная проверка его сменила' });
    }


    // ---------- Инициализация ----------
    var inited = false;

    function init() {
        if (inited) return;
        inited = true;
        addSettings();
        hookWebos();
        applyStyle();
        Lampa.Player.listener.follow('start', onStart);
        Lampa.Player.listener.follow('destroy', onDestroy);
        bindKey();
        log('v' + VERSION + ' initialized' + (webosOrigRequest ? ' | webOS' : ''));
    }

    // Экспорт для других плагинов, отладки и тестов
    window.AdaptiveSubs = {
        version: VERSION,
        detect: detectFromText,
        kind: kindFromText,
        state: current,
        set: function (p) {
            lookupToken++;
            applyKind(p === 'hdr' ? 'hdr' : 'sdr', 'manual');
            announce(false);
        },
        toggle: toggleProfile,
        webos: function () { return !!webosOrigRequest; },
        _test: {
            evaluate: evaluate,
            buildCss: buildCss,
            applyKind: applyKind,
            torrServerTarget: torrTarget,
            kindFromStreams: kindFromStreams,
            kindFromHls: kindFromHls,
            kindFromData: kindFromData,
            levelFor: levelFor,
            toneFor: toneFor,
            overrideKey: overrideKey,
            describeData: describeData,
            getOverride: getOverride,
            setOverride: setOverride,
            sharedFfp: sharedFfp,
            inspectWebos: inspectWebos,
            webosOpacity: webosOpacity,
            applyWebos: applyWebos,
            lampaOpacity: function () { return lampaOpacity; },
            onStart: onStart,
            onDestroy: onDestroy,
            init: init
        }
    };

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e && e.type === 'ready') init(); });
})();
