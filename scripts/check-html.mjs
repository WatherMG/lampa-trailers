// Parse the actual JavaScript executed by static HTML pages (node --check HTML is insufficient).
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

for (const path of ['youtube-bridge.html', 'diagnostics.html']) {
  const html = readFileSync(path, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  if (!scripts.length) throw new Error(path + ': no inline JavaScript found');
  for (const [index, match] of scripts.entries()) {
    new Script(match[2], { filename: path + ':inline-' + (index + 1) + '.js' });
  }
  console.log(path + ': ' + scripts.length + ' inline script(s) parsed');
}
