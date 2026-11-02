// Verify the exact files and the YouTube bridge contract before deployment.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
for (const name of ['index.html', '.nojekyll', 'trailers.js', 'night.js', 'LICENSE.adaptive-subtitles', 'youtube-bridge.html', 'diagnostics.html']) {
  assert.ok(statSync(join('dist', name)).isFile(), 'Missing site file: ' + name);
}
assert.ok(!existsSync(join('dist', 'trailer-fix.js')), 'Legacy filename must not be published');
const plugin = readFileSync('dist/trailers.js', 'utf8');
const bridge = readFileSync('dist/youtube-bridge.html', 'utf8');
assert.match(plugin, /youtube-bridge\.html/);
assert.match(bridge, /strict-origin-when-cross-origin/);
assert.match(bridge, /www\.youtube\.com\/iframe_api/);
const night = readFileSync('dist/night.js', 'utf8');
assert.match(night, /Night — плеер и субтитры/);
assert.match(night, /setSubtitleCharacterOpacity/);
assert.match(night, /setSubtitleFontSize/);
assert.match(night, /night_hdr_panel/);
assert.match(night, /night_sdr_native/);
assert.match(night, /adaptive_subs:profile/);
console.log('Pages artifact contract verified.');
