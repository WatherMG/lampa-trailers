// Builds a single JS plugin from the audited MIT Adaptive Subtitles v1.0.0
// and the Night UI extension. Fail fast on incompatible upstream changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let code = readFileSync(join(root, 'vendor/adaptive_subs-1.0.0.js'), 'utf8');
function replaceOnce(from, to) {
  const p = code.indexOf(from);
  if (p < 0 || code.indexOf(from, p + from.length) !== -1) {
    throw new Error('Unsupported Adaptive Subtitles source: ' + from.slice(0, 90));
  }
  code = code.slice(0, p) + to + code.slice(p + from.length);
}
replaceOnce("var C = 'adaptive_subs';", "var C = 'lampa_night';");
replaceOnce("name: 'Адаптивные субтитры',", "name: 'Night — плеер и субтитры',");
replaceOnce("if (current.profile !== 'hdr') return lampaOpacity;",
  "if (current.profile !== 'hdr') return Math.round(lampaOpacity * nightNativeSdr() / 100);");
replaceOnce("if (current.profile === 'hdr') {\n            webosCall('setSubtitleCharacterOpacity', { charOpacity: webosOpacity() }, id);",
  "if (current.profile === 'hdr' || nightNativeSdr() < 100) {\n            webosCall('setSubtitleCharacterOpacity', { charOpacity: webosOpacity() }, id);");
replaceOnce("    function webosOpacity() {",
  "    function nightNativeSdr() { var n = parseInt(Lampa.Storage.get('night_sdr_native', '60'), 10); return isNaN(n) ? 60 : Math.max(0, Math.min(100, n)); }\n    function webosOpacity() {");
replaceOnce("'#555555': 'Очень тёмные — 33%'",
  "'#555555': 'Очень тёмные — 33%', '#404040': 'Минимальные — 25%'");
replaceOnce(
  "var TONES = { '#9a9a9a': 0.60, '#8a8a8a': 0.54, '#7a7a7a': 0.48, '#666666': 0.40, '#555555': 0.33 };",
  "var TONES = { '#9a9a9a': 0.60, '#8a8a8a': 0.54, '#7a7a7a': 0.48, '#666666': 0.40, '#555555': 0.33, '#404040': 0.25 };"
);
replaceOnce(
  "values: { 'default': 'Не менять (как в Lampa)', '3.2vh': 'Очень маленький', '3.8vh': 'Маленький', '4.4vh': 'Средний', '5vh': 'Крупный', '5.8vh': 'Очень крупный' }",
  "values: { 'default': 'Не менять (как в Lampa)', '0.5vh': 'Микро 0.5vh', '0.7vh': '0.7vh', '0.9vh': '0.9vh', '1vh': '1.0vh', '1.2vh': '1.2vh', '1.4vh': 'Минимальный', '1.8vh': 'Очень мелкий', '2.2vh': 'Мелкий', '2.6vh': 'Компактный', '3vh': 'Маленький', '3.2vh': 'Очень маленький (оригинал)', '3.8vh': 'Маленький (оригинал)', '4.4vh': 'Средний', '5vh': 'Крупный', '5.8vh': 'Очень крупный' }"
);
// Exports and HDR detection stay identical to upstream to preserve manual
// remote toggle, per-title overrides, TorrServer /ffp and webOS controls.
const intro = [
  '/*!',
  ' * Lampa Night v1.2.0: one-file HDR subtitle + low-glare player plugin.',
  ' * Adaptive Subtitles © 2026 emoorpheus, MIT.',
  ' * Night UI © 2026 WatherMG, contributors, MIT.',
  ' * Upstream license: https://github.com/emoorpheus/lampa-adaptive-subtitles/blob/main/LICENSE',
  ' * See vendor/LICENSE.adaptive-subtitles for complete upstream license.',
  ' */',
  ''
].join('\n');
const ui = readFileSync(join(root, 'night-controls.js'), 'utf8');
const menu = readFileSync(join(root, 'night-menu.js'), 'utf8');
const result = intro + code + '\n' + ui + '\n' + menu;
writeFileSync(join(root, 'night.js'), result);
console.log('Created night.js:', result.length, 'bytes');
