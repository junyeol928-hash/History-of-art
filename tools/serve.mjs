/* 手元で読むためのサーバー。
   このサイトは目次も年表も辞典もデータを fetch で読むので、
   index.html をダブルクリックするとブラウザに止められて真っ白になる。
   ビルドは要らないが、サーバーは要る。それだけのためのファイル。
     node tools/serve.mjs         … http://localhost:8080
     node tools/serve.mjs 3000    … 番号を変える
     node tools/serve.mjs --lan   … 同じ WiFi のスマホからも見る */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const LAN = args.includes('--lan');
const PORT = Number(args.find((a) => /^\d+$/.test(a))) || 8080;
const ROOT = process.cwd();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    // 上の階層へ抜けさせない
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(302, { Location: p + '/' }).end(); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
       .end('<p style="font-family:sans-serif;padding:2rem">そのページはありません。<a href="/">目次へ</a></p>');
  }
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`\n  世界美術史\n\n  → http://localhost:${PORT}/`);
  if (LAN) {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  → http://${n.address}:${PORT}/   （同じ WiFi のスマホから）`);
      }
    }
  }
  console.log(`\n  止めるときは Ctrl+C\n`);
});
