// 紹介動画の書き出し: trailer.html をコマ送りで撮影し、ffmpeg で mp4 にする
// 使い方: node render.mjs [--from 秒] [--to 秒] [--step コマ] [--no-encode]
// 環境変数: CHROME(Chromiumの実行ファイル) FFMPEG PW_CORE(playwright-coreの場所) OUT(作業フォルダ)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);
const FPS = 30, from = +arg('from', 0), to = +arg('to', 30), step = +arg('step', 1), query = arg('q', '');
const work = process.env.OUT || path.join(here, 'frames');
fs.mkdirSync(work, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); } });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = await import(pathToFileURL(process.env.PW_CORE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error' && !/vibrate|favicon/.test(m.text())) console.log('ERR', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/promo/trailer.html?${query}`);
await page.evaluate(() => window.trailer.init());
console.log('init done', await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }));

const total = Math.round(to * FPS), t0 = Date.now();
const saveFrom = Math.round(from * FPS);
for (let i = 0; i < total; i++) {
  const jpg = await page.evaluate(k => window.trailer.frame(k), i);
  if (i >= saveFrom && (i - saveFrom) % step === 0) fs.writeFileSync(path.join(work, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(jpg, 'base64'));
  if (i % 60 === 0) console.log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const log = await page.evaluate(() => window.trailer.log());
console.log('LOG', JSON.stringify(log));
fs.writeFileSync(path.join(work, 'log.json'), JSON.stringify(log, null, 1));
if (!flag('no-audio')) {
  const a = await page.evaluate(() => window.trailer.audio());
  fs.writeFileSync(path.join(work, 'audio.wav'), Buffer.from(a.wav, 'base64'));
  console.log('audio peak', a.peak);
}
await browser.close();
server.close();
if (!flag('no-encode')) {
  const output = process.env.MP4 || path.join(here, 'droplet-merge-trailer.mp4');
  const r = spawnSync(process.env.FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-pattern_type', 'sequence', '-i', path.join(work, 'f%05d.jpg'), '-i', path.join(work, 'audio.wav'), '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', output], { stdio: 'inherit' });
  console.log('encode exit', r.status, output, fs.existsSync(output) ? (fs.statSync(output).size / 1e6).toFixed(1) + ' MB' : '');
}
