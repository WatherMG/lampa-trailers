import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../night-controls.js', import.meta.url), 'utf8');

function harness(overrides = {}) {
  const data = { ...overrides };
  const styles = {};
  const callbacks = {};
  const params = [];
  let webosCalls = 0;
  const adaptive = { state: { profile: 'sdr', kind: 'sdr' }, _test: { applyWebos() { webosCalls++; } } };
  const document = {
    getElementById(id) { return styles[id] || null; },
    createElement(tag) { return { tagName: tag, id: '', textContent: '' }; },
    head: { appendChild(node) { styles[node.id] = node; } }
  };
  const Lampa = {
    Storage: { get(key, fallback) { return key in data ? data[key] : fallback; } },
    SettingsApi: { addParam(p) { params.push(p); } },
    Listener: { follow() {} }
  };
  const listeners = {};
  const window = {
    appready: true, Lampa, AdaptiveSubs: adaptive,
    webOS: { service: {} },
    addEventListener(name, cb) { listeners[name] = cb; }
  };
  vm.runInNewContext(source, { window, document, Lampa, console });
  return { data, params, styles, window, adaptive, listeners, get webosCalls() { return webosCalls; } };
}

test('single Night menu with UI and subtitle settings', () => {
  const h = harness();
  assert.ok(h.params.length >= 9);
  assert.ok(h.params.every(p => p.component === 'lampa_night'));
  assert.ok(h.params.some(p => p.param.name === 'night_sdr_native'));
  assert.ok(h.params.some(p => p.param.name === 'night_hdr_panel'));
  assert.ok(h.params.some(p => p.param.name === 'night_sdr_subs'));
  assert.equal(h.window.LampaNight.version, '1.1.0');
});

test('SDR / Filmmaker dims just controls and HTML subtitles', () => {
  const h = harness();
  const css = h.window.LampaNight.css();
  assert.match(css, /\.player \.player-panel\{filter:brightness\(0\.6\)/);
  assert.match(css, /\.player \.player-panel \.button\.focus\{background:/);
  assert.match(css, /\.player \.player-video__subtitles-text,/);
  assert.match(css, /brightness\(0\.65\)/);
  assert.doesNotMatch(css, /\.player\s*\{\s*filter/);
  assert.doesNotMatch(css, /video\s*\{\s*filter/);
  assert.equal(h.styles['lampa-night-controls'].textContent, css);
});

test('HDR palette follows native AdaptiveSubs HDR status', () => {
  const h = harness({ night_palette: 'blue', night_hdr_panel: '35' });
  h.adaptive.state.profile = 'hdr';
  h.listeners['adaptive_subs:profile']();
  const css = h.window.LampaNight.css();
  assert.match(css, /brightness\(0\.35\)/);
  assert.match(css, /#394c67/);
  assert.doesNotMatch(css, /player-video__subtitles-text/);
});

test('turning off UI clears Night CSS immediately', () => {
  const h = harness();
  h.data.night_enabled = false;
  h.window.LampaNight.apply();
  assert.equal(h.styles['lampa-night-controls'].textContent, '');
});

test('settings onChange apply immediately and delegate native subtitles', () => {
  const h = harness();
  const panel = h.params.find(p => p.param.name === 'night_hdr_panel');
  const native = h.params.find(p => p.param.name === 'night_sdr_native');
  h.adaptive.state.profile = 'hdr';
  h.data.night_hdr_panel = '25';
  panel.onChange();
  assert.match(h.styles['lampa-night-controls'].textContent, /brightness\(0\.25\)/);
  native.onChange();
  assert.equal(h.webosCalls, 1);
});

test('unsupported user input never enters generated CSS', () => {
  const h = harness({ night_palette: '};color:red', night_subs_position: '0;filter:invert(1)', night_subs_weight: '100;opacity:0' });
  const css = h.window.LampaNight.css();
  assert.doesNotMatch(css, /invert\(1\)/);
  assert.doesNotMatch(css, /opacity:0/);
  assert.match(css, /#594d43/);
});


test('all player chrome and player-scoped popup menus share Night palette', () => {
  const h = harness({night_palette:'graphite',night_sdr_panel:'35'});
  const css = h.window.LampaNight.css();
  assert.match(css, /\.player \.player-info,\.player \.player-footer\{filter:brightness\(0\.35\)/);
  assert.match(css, /\.player \.player-info__time/);
  assert.match(css, /\.player \.player-info__values/);
  assert.match(css, /body\.player--viewing \.selectbox__content/);
  assert.match(css, /body\.player--viewing \.selectbox-item\.focus/);
  assert.match(css, /\.player \.player-panel/);
  assert.doesNotMatch(css, /body \.selectbox__content/);
});

test('subtitle tint supports warm colors without styling video frame', () => {
  const h = harness({night_subs_tint:'amber'});
  const css = h.window.LampaNight.css();
  assert.match(css,/\.player \.player-video__subtitles-text,\.player \.player-video__subtitles-text \*\{color:#c1a87f/);
  assert.match(css,/\.player video::cue\{color:#c1a87f/);
  assert.doesNotMatch(css, /\.player-video__video\{filter/);
});
