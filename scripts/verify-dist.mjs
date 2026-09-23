// Verify the exact files and the YouTube bridge contract before deployment.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
for (const name of ['index.html', '.nojekyll', 'trailer-fix.js', 'youtube-bridge.html', 'diagnostics.html']) {
  assert.ok(statSync(join('dist', name)).isFile(), 'Missing site file: ' + name);
}
const plugin = readFileSync('dist/trailer-fix.js', 'utf8');
const bridge = readFileSync('dist/youtube-bridge.html', 'utf8');
assert.match(plugin, /youtube-bridge\.html/);
assert.match(bridge, /strict-origin-when-cross-origin/);
assert.match(bridge, /www\.youtube\.com\/iframe_api/);
console.log('Pages artifact contract verified.');
