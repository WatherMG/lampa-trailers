'use strict';
// Node.js tests use simulated Lampa, webOS and network APIs; no TV is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const plugin = fs.readFileSync(path.join(__dirname, '..', 'trailers.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'youtube-bridge.html'), 'utf8');
const PLUGIN_URL = 'https://example.github.io/lampa-trailers/trailers.js';

function harness(options = {}) {
  const events = {};
  const played = [];
  const tubes = [];
  const notices = [];
  const requests = [];
  const xhrs = [];
  const launches = [];
  const settings = [];
  const components = [];
  const unifiedButtons = [];
  const selectedMenus = [];
  const timers = new Map();
  const commands = [];
  let nextTimer = 0;
  let closeCount = 0;
  let root;
  const fakeWindow = {
    console: { log() {}, warn() {}, info() {}, error() {} },
    addEventListener(name, fn) { (events[name] ||= []).push(fn); },
    removeEventListener(name, fn) { events[name] = (events[name] || []).filter(f => f !== fn); }
  };
  if (options.webOS !== false) {
    fakeWindow.webOS = { service: { request(url, args) {
      launches.push({ url, args });
      if (options.failAppLaunch) args.onFailure({ errorCode: 100, errorText: 'Not installed' });
      else args.onSuccess({ returnValue: true });
    } } };
  }
  const Lampa = {
    Player: {
      listener: { follow(name, fn) { (events['player:' + name] ||= []).push(fn); } },
      play(data) {
        const event = { data, aborted: false, abort() { this.aborted = true; } };
        for (const listener of events['player:create'] || []) listener(event);
        if (!event.aborted) played.push(data);
        return !event.aborted;
      },
      opened() { return true; },
      close() { closeCount++; }
    },
    PlayerVideo: { registerTube(handler) { tubes.push(handler); } },
    Listener: { follow(name, fn) { (events['lampa:' + name] ||= []).push(fn); } },
    Select: { show(menu) { selectedMenus.push(menu); } },
    SettingsApi: {
      addParam(param) { settings.push(param); },
      addComponent(component) { components.push(component); }
    },
    Subscribe() { return { follow() {}, send() {}, destroy() {} }; },
    Noty: { show(message) { notices.push(message); } },
    Storage: { get(key, fallback) {
      if (key === 'plugins') return options.installed || [];
      return options.storage && Object.hasOwn(options.storage, key) ? options.storage[key] : fallback;
    } },
    Reguest: class {
      timeout() {}
      native(url, success, failure) { requests.push({ url, success, failure }); }
      clear() { this.cleared = true; }
    }
  };
  fakeWindow.Lampa = Lampa;
  class XHR {
    constructor() { xhrs.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    send() { this.sent = true; }
    abort() { this.aborted = true; }
  }
  const document = {
    currentScript: options.inline ? { src: '' } : { src: PLUGIN_URL },
    createElement(tag) {
      assert.equal(tag, 'iframe');
      return {
        style: {},
        setAttribute() {},
        contentWindow: { postMessage(data, origin) { commands.push({ data, origin }); } },
        parentNode: { removeChild() {} }
      };
    }
  };
  function $(html) {
    if (typeof html === 'string' && html.includes('view--ltf-unified')) {
      return { length: 1, handlers: {}, on(name, fn) { this.handlers[name] = fn; return this; } };
    }
    assert.match(html, /player-video__youtube/);
    root = { appendChild(frame) { this.frame = frame; } };
    return { 0: root, remove() {} };
  }
  const sandbox = {
    window: fakeWindow, Lampa, webOS: fakeWindow.webOS,
    document, console: fakeWindow.console, $, URL, XMLHttpRequest: XHR,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date, Math, Object, Array, String, Number, JSON, Error
  };
  vm.runInNewContext(plugin, sandbox, { filename: 'trailers.js' });
  return {
    api: fakeWindow.LampaTrailerFix, alias: fakeWindow.LampaTrailers, Lampa, tubes, played, requests, xhrs,
    launches, notices, settings, components, timers, commands, unifiedButtons, selectedMenus,
    fireFull(data) {
      const original = { length: 1, addClass() { this.hidden = true; return this; }, before(btn) { unifiedButtons.push(btn); } };
      const rutube = { length: 0, addClass() { return this; } };
      const render = { find(selector) {
        if (selector === '.view--ltf-unified') return { length: unifiedButtons.length };
        if (selector === '.view--trailer') return original;
        if (selector === '.view--rutube_trailer') return rutube;
        if (selector === '.full-start__button') return { length: 1 };
        return { length: 0 };
      } };
      const e = { type: 'complite', object: { method: 'movie', activity: { render() { return render; } } }, data };
      for (const listener of events['lampa:full'] || []) listener(e);
      return { original, e };
    },
    get root() { return root; },
    get closeCount() { return closeCount; },
    message(msg) { for (const listener of events.message || []) listener(msg); },
    fireTimer(delay) {
      const pair = [...timers.entries()].find(([, value]) => value.delay === delay);
      assert.ok(pair, 'timer exists: ' + delay);
      timers.delete(pair[0]);
      pair[1].fn();
    }
  };
}

function sampleManifest() {
  return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720\n720/index.m3u8';
}

test('bridge URL resolves to the installed plugin origin', () => {
  const h = harness();
  assert.equal(h.api.bridgeUrl, 'https://example.github.io/lampa-trailers/youtube-bridge.html?v=0.4.1-beta');
  assert.equal(h.components[0].component, 'ltf_settings');
  assert.strictEqual(h.alias, h.api);
  assert.equal(h.settings.length, 8);
});

test('cached inline script obtains original URL from the plugin list', () => {
  const h = harness({ inline: true, installed: [{ url: PLUGIN_URL, status: 1 }] });
  assert.equal(h.api.bridgeUrl, 'https://example.github.io/lampa-trailers/youtube-bridge.html?v=0.4.1-beta');
});

test('HLS parser resolves variants, selects bitrate, and does not duplicate labels', () => {
  const h = harness();
  const result = h.api.parseHlsMaster(sampleManifest(), 'https://cdn.example/master.m3u8');
  assert.equal(result.length, 2);
  assert.equal(result[0].url, 'https://cdn.example/1080/index.m3u8');
  assert.equal(result[1].name, '720p');
  assert.equal(new Set(result.map(item => item.name)).size, 2);
});

test('HLS with external audio cannot be flattened into silent video variants', () => {
  const h = harness();
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="a"\nvideo.m3u8';
  assert.equal(h.api.parseHlsMaster(master, 'https://cdn.example/master.m3u8').length, 0);
});

test('RuTube card supplies real quality options to the Lampa player', () => {
  const h = harness();
  const id = 'a'.repeat(32);
  h.Lampa.Player.play({ url: 'https://rutube.ru/video/' + id, iptv: true });
  assert.equal(h.played.length, 0);
  h.requests[0].success({ video_balancer: { m3u8: 'https://cdn.example/master.m3u8' } });
  h.xhrs[0].status = 200;
  h.xhrs[0].responseText = sampleManifest();
  h.xhrs[0].onload();
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].url, 'https://cdn.example/1080/index.m3u8');
  assert.equal(h.played[0].quality['720p'], 'https://cdn.example/720/index.m3u8');
  assert.equal(h.played[0].quality.Auto, 'https://cdn.example/master.m3u8');
});

test('manual quality can start at 720p when selected', () => {
  const h = harness();
  h.api.config.rutubePreferred = '720';
  h.Lampa.Player.play({ url: 'https://rutube.ru/video/' + 'b'.repeat(32) });
  h.requests[0].success({ video_balancer: { m3u8: 'https://cdn.example/master.m3u8' } });
  h.xhrs[0].status = 200;
  h.xhrs[0].responseText = sampleManifest();
  h.xhrs[0].onload();
  assert.equal(h.played[0].url, 'https://cdn.example/720/index.m3u8');
});

test('RuTube error falls back to TVIGL without recursion', () => {
  const h = harness();
  const url = 'https://rutube.ru/video/' + 'c'.repeat(32);
  h.Lampa.Player.play({ url, iptv: true });
  h.requests[0].failure();
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].url, url);
  assert.equal(h.played[0].iptv, true);
  assert.equal(h.api.stats.rutubeFallback, 1);
});

test('stale RuTube requests cannot start playback after another item', () => {
  const h = harness();
  h.Lampa.Player.play({ url: 'https://rutube.ru/video/' + 'd'.repeat(32) });
  h.Lampa.Player.play({ url: 'https://example.com/video.mp4' });
  h.requests[0].success({ video_balancer: { m3u8: 'https://cdn.example/master.m3u8' } });
  assert.equal(h.xhrs.length, 0);
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].url, 'https://example.com/video.mp4');
});

test('YouTube native mode supports configurable official or AdFree app IDs', () => {
  const h = harness();
  h.settings.find(item => item.param.name === 'ltf_youtube_mode').onChange('native');
  h.settings.find(item => item.param.name === 'ltf_youtube_app_id').onChange('youtube.leanback.v4');
  h.Lampa.Player.play({ url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].args.parameters.id, 'youtube.leanback.v4');
  assert.equal(h.launches[0].args.parameters.params.contentTarget, 'v=dQw4w9WgXcQ');
});

test('absent YouTube app falls back to the embedded player', () => {
  const h = harness({ failAppLaunch: true });
  h.api.config.youtubeMode = 'native';
  h.Lampa.Player.play({ url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(h.played.length, 1);
  assert.match(h.played[0].url, /lampa-trailer-fix\.invalid\/youtube\/dQw4w9WgXcQ/);
});

test('YouTube iframe error 153 falls back to the installed app', () => {
  const h = harness();
  h.Lampa.Player.play({ url: 'https://youtu.be/dQw4w9WgXcQ' });
  let video;
  h.tubes[0].create(obj => { video = obj; });
  video.src = h.played[0].url;
  video.load();
  video.play();
  const frame = h.root.frame;
  const bridgeId = new URL(frame.src).searchParams.get('bridgeId');
  h.message({ source: frame.contentWindow, origin: 'https://example.github.io', data: { bridgeId, type: 'ready' } });
  h.message({ source: frame.contentWindow, origin: 'https://example.github.io', data: { bridgeId, type: 'error', data: { code: 153 } } });
  assert.equal(h.launches.length, 1);
  assert.equal(h.closeCount, 1);
  assert.equal(h.api.stats.youtubeErrors.at(-1).code, '153');
});

test('YouTube iframe startup watchdog handles a frozen video', () => {
  const h = harness();
  h.Lampa.Player.play({ url: 'https://youtu.be/dQw4w9WgXcQ' });
  let video;
  h.tubes[0].create(obj => { video = obj; });
  video.src = h.played[0].url;
  video.load();
  video.play();
  const frame = h.root.frame;
  h.message({ source: frame.contentWindow, origin: 'https://example.github.io', data: { bridgeId: new URL(frame.src).searchParams.get('bridgeId'), type: 'ready' } });
  h.fireTimer(18000);
  assert.equal(h.launches.length, 1);
  assert.equal(h.api.stats.youtubeErrors.at(-1).code, 'play-timeout');
});

test('YouTube bridge uses official API and origin/referrer policy', () => {
  assert.match(bridge, /strict-origin-when-cross-origin/);
  assert.match(bridge, /https:\/\/www\.youtube\.com\/iframe_api/);
  assert.match(bridge, /origin:\s*location\.origin/);
  assert.match(bridge, /parent\.postMessage/);
});

// Regression: Lampa Params.update indexes values[name][key] for every input.
test('text input advertises string values so Lampa settings never crash', () => {
  const h = harness();
  const input = h.settings.find(item => item.param.name === 'ltf_youtube_app_id');
  assert.equal(input.param.type, 'input');
  assert.equal(input.param.values, 'string');
  const storedValue = 'youtube.leanback.v4';
  const displayed = typeof input.param.values === 'string' ? storedValue : input.param.values[storedValue];
  assert.equal(displayed, storedValue);
});
test('YouTube bridge exposes native controls and playback speed', () => {
  assert.match(bridge, /controls:\s*1/);
  assert.match(bridge, /setPlaybackRate/);
});


test('unified YouTube list preserves its source label and correct video URLs', () => {
  const h = harness();
  const items = h.api.youtubeCardItems({ results: [
    { name: 'Official trailer', key: 'dQw4w9WgXcQ', iso_639_1: 'en', official: true },
    { name: 'Invalid entry', key: 'invalid' }
  ] });
  assert.equal(items.length, 1);
  assert.match(items[0].subtitle, /^\[YouTube\] EN/);
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('unified RuTube search discards unavailable and non-RuTube videos', () => {
  const h = harness();
  const id = 'b'.repeat(32);
  const rows = h.api.validRutubeTrailers({ results: [
    { title: 'Фильм трейлер', video_url: 'https://rutube.ru/video/' + id, duration: 120 },
    { title: 'Paid', embed_url: 'https://rutube.ru/video/' + id, is_paid: true },
    { title: 'Wrong host', url: 'https://example.org/video/' + id }
  ] });
  assert.equal(rows.length, 1);
  const items = h.api.rutubeCardItems(rows);
  assert.equal(items[0].url, 'https://rutube.ru/video/' + id);
  assert.match(items[0].subtitle, /^\[RuTube\]/);
});

test('YouTube bridge accepts playback speed commands', () => {
  assert.match(bridge, /command === 'setPlaybackRate'/);
  assert.match(bridge, /controls:\s*1/);
});


test('combined card button shows YouTube and RuTube as separate selectable sections', () => {
  const h = harness();
  const rutubeId = 'a'.repeat(32);
  const card = h.fireFull({
    movie: { id: 278, title: 'Побег из Шоушенка', release_date: '1994-09-23' },
    videos: { results: [{ name: 'Official Trailer', key: 'dQw4w9WgXcQ', iso_639_1: 'en' }] }
  });
  assert.equal(card.original.hidden, true);
  assert.equal(h.unifiedButtons.length, 1);
  h.unifiedButtons[0].handlers['hover:enter']();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /trailer\.rootu\.top\/search\/movie\/0000278\.json/);
  h.requests[0].success([{
    title: 'Побег из Шоушенка трейлер', video_url: 'https://rutube.ru/video/' + rutubeId,
    duration: 120
  }]);
  assert.equal(h.selectedMenus.length, 1);
  const items = h.selectedMenus[0].items;
  assert.equal(items[0].title, 'YouTube');
  assert.match(items[1].subtitle, /^\[YouTube\]/);
  assert.equal(items[2].title, 'RuTube');
  assert.match(items[3].subtitle, /^\[RuTube\]/);
});

test('embedded YouTube script parses and handles real bridge commands', () => {
  const match = bridge.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
  assert.ok(match, 'bridge inline JavaScript exists');
  const script = new vm.Script(match[1], { filename: 'youtube-bridge.html' });
  const calls = [];
  const outgoing = [];
  const handlers = {};
  let youtubePlayer;
  const parent = { postMessage(message) { outgoing.push(message); } };
  const frameWindow = {
    parent,
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  class Player {
    constructor(element, options) {
      assert.equal(element, 'yt');
      youtubePlayer = this;
      this.options = options;
    }
    getCurrentTime() { return 1; }
    getDuration() { return 90; }
    getPlaybackQuality() { return 'hd720'; }
    playVideo() { calls.push('play'); }
    pauseVideo() { calls.push('pause'); }
    setPlaybackRate(rate) { calls.push(['rate', rate]); }
  }
  script.runInNewContext({
    window: frameWindow,
    location: {
      href: 'https://example.github.io/lampa-trailers/youtube-bridge.html?videoId=M7lc1UVf-VE&bridgeId=ltf_test',
      origin: 'https://example.github.io'
    },
    URL,
    YT: { Player },
    setInterval() { return 1; },
    clearInterval() {}
  });
  frameWindow.onYouTubeIframeAPIReady();
  youtubePlayer.options.events.onReady();
  assert.equal(outgoing[0].type, 'ready');
  function command(type, data = {}) {
    handlers.message({ source: parent, data: { bridgeId: 'ltf_test', type, data } });
  }
  command('play');
  command('setPlaybackRate', { rate: 1.5 });
  command('pause');
  assert.deepEqual(calls, ['play', ['rate', 1.5], 'pause']);
});

test('text setting survives the same values lookup used by Lampa Params.update', () => {
  function paramsUpdate(param, selected) {
    const values = { [param.name]: param.values };
    return typeof values[param.name] === 'string'
      ? selected
      : values[param.name][selected];
  }
  const h = harness();
  const input = h.settings.find(item => item.param.name === 'ltf_youtube_app_id').param;
  assert.throws(() => paramsUpdate({ name: input.name, type: 'input' }, 'youtube.leanback.v4'),
    /undefined/);
  assert.equal(paramsUpdate(input, 'youtube.leanback.v4'), 'youtube.leanback.v4');
});

test('disabled RuTube avoids all network requests and opens YouTube immediately', () => {
  const h = harness();
  h.settings.find(s => s.param.name === 'ltf_rutube_enabled').onChange(false);
  h.fireFull({
    movie: { id: 278, title: 'Movie' },
    videos: { results: [{ name: 'Trailer', key: 'dQw4w9WgXcQ' }] }
  });
  h.unifiedButtons[0].handlers['hover:enter']();
  assert.equal(h.requests.length, 0);
  assert.equal(h.selectedMenus.length, 1);
  assert.deepEqual(Array.from(h.selectedMenus[0].items, item => item.title),
    ['YouTube', 'Trailer']);
});

test('stored source preferences disable YouTube and can display RuTube first', () => {
  const h = harness({ storage: {
    ltf_youtube_enabled: 'false',
    ltf_rutube_enabled: true,
    ltf_source_order: 'rutube_first'
  } });
  assert.equal(h.api.config.youtubeEnabled, false);
  assert.equal(h.api.config.sourceOrder, 'rutube_first');
  h.fireFull({
    movie: { id: 278, title: 'Movie' },
    videos: { results: [{ name: 'YT', key: 'dQw4w9WgXcQ' }] }
  });
  h.unifiedButtons[0].handlers['hover:enter']();
  const id = 'e'.repeat(32);
  h.requests[0].success([{ title: 'RT', video_url: 'https://rutube.ru/video/' + id }]);
  assert.deepEqual(Array.from(h.selectedMenus[0].items, item => item.title), ['RuTube', 'RT']);
});

test('source order can be changed while keeping both providers enabled', () => {
  const h = harness();
  h.settings.find(s => s.param.name === 'ltf_source_order').onChange('rutube_first');
  h.fireFull({
    movie: { id: 278, title: 'Movie' },
    videos: { results: [{ name: 'YT', key: 'dQw4w9WgXcQ' }] }
  });
  h.unifiedButtons[0].handlers['hover:enter']();
  h.requests[0].success([{ title: 'RT', video_url: 'https://rutube.ru/video/' + 'f'.repeat(32) }]);
  assert.deepEqual(Array.from(h.selectedMenus[0].items, item => item.title), ['RuTube', 'RT', 'YouTube', 'YT']);
});

test('disabled sources do not intercept playback from another plugin', () => {
  const h = harness({ storage: { ltf_youtube_enabled: false, ltf_rutube_enabled: false } });
  const yt = 'https://youtu.be/dQw4w9WgXcQ';
  const rt = 'https://rutube.ru/video/' + 'f'.repeat(32);
  h.Lampa.Player.play({ url: yt });
  h.Lampa.Player.play({ url: rt });
  assert.deepEqual(h.played.map(item => item.url), [yt, rt]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.launches.length, 0);
  h.fireFull({ movie: { id: 278, title: 'Movie' }, videos: { results: [] } });
  h.unifiedButtons[0].handlers['hover:enter']();
  assert.equal(h.requests.length, 0);
  assert.equal(h.selectedMenus.length, 0);
  assert.match(h.notices.at(-1), /Включите YouTube или RuTube/);
});
