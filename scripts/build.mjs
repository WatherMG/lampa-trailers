// Produces an allowlisted, reproducible static Pages artifact.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const name of ['trailer-fix.js', 'youtube-bridge.html', 'diagnostics.html']) {
  cpSync(join(root, name), join(dist, name));
}
writeFileSync(join(dist, '.nojekyll'), '');
const page = [
  '<!doctype html>',
  '<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Lampa Trailers</title>',
  '<style>body{max-width:46rem;margin:2rem auto;padding:0 1rem;background:#16191c;color:#fafafa;font:1.15rem/1.6 system-ui}a{color:#9ad0ff}code{overflow-wrap:anywhere}</style>',
  '</head><body><h1>Lampa Trailers (beta)</h1>',
  '<p>Экспериментальное расширение YouTube и RuTube для Lampa/webOS. Воспроизведение на вашем ТВ требует проверки.</p>',
  '<p>JS-плагин: <a href="trailer-fix.js"><code>trailer-fix.js</code></a></p>',
  '<p><a href="diagnostics.html">YouTube IFrame diagnostics</a></p>',
  '<p><a href="youtube-bridge.html">YouTube Bridge</a> — техническая страница.</p>',
  '</body></html>'
];
writeFileSync(join(dist, 'index.html'), page.join('\n') + '\n');
console.log('Pages artifact assembled:', dist);
