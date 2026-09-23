// Verify the exact files and the YouTube bridge contract before deployment.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
for (const name of ['index.html', '.nojekyll', 'trailers.js', 'youtube-bridge.html', 'diagnostics.html']) {
  assert.ok(statSync(join('dist', name)).isFile(), 'Missing site file: ' + name);
}
assert.ok(!existsSync(join('dist', 'trailer-fix.js')), 'Legacy filename must not be published');
const plugin = readFileSync('dist/trailers.js', 'utf8');
const bridge = readFileSync('dist/youtube-bridge.html', 'utf8');
assert.match(plugin, /youtube-bridge\.html/);
assert.match(bridge, /strict-origin-when-cross-origin/);
assert.match(bridge, /www\.youtube\.com\/iframe_api/);
console.log('Pages artifact contract verified.');
