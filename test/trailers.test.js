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
    launches, notices, settings, components, timers, commands,
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
  assert.equal(h.api.bridgeUrl, 'https://example.github.io/lampa-trailers/youtube-bridge.html');
  assert.equal(h.components[0].component, 'ltf_settings');
  assert.strictEqual(h.alias, h.api);
  assert.equal(h.settings.length, 5);
});

test('cached inline script obtains original URL from the plugin list', () => {
  const h = harness({ inline: true, installed: [{ url: PLUGIN_URL, status: 1 }] });
  assert.equal(h.api.bridgeUrl, 'https://example.github.io/lampa-trailers/youtube-bridge.html');
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
