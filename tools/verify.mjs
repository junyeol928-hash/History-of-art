/* 実フォントで描いて確かめる。
   使い方: node tools/verify.mjs <出力先> <URLパス...>
   fonts.googleapis.com / fonts.gstatic.com への要求はローカルのキャッシュから返す。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, existsSync } from 'node:fs';

const OUT = process.argv[2];
const paths = process.argv.slice(3);
const idx = existsSync('.fontcache/index.json')
  ? JSON.parse(readFileSync('.fontcache/index.json', 'utf8')) : {};
console.log(`フォントキャッシュ: ${Object.keys(idx).length} 件`);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const COMBOS = (process.env.COMBOS || 'pc-light')
  .split(',')
  .map((t) => ({
    'pc-light':  [1000, 900, 'pc',  'light'],
    'pc-dark':   [1000, 900, 'pc',  'dark'],
    'sp-light':  [ 390, 844, 'sp',  'light'],
    'sp-dark':   [ 390, 844, 'sp',  'dark'],
  }[t.trim()]))
  .filter(Boolean);
for (const [w, h, tag, scheme] of COMBOS) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', colorScheme: scheme });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:8899')) return route.continue();
    const hit = idx[u] || idx[u.replace(/&amp;/g, '&')];
    if (hit && existsSync(hit)) {
      return route.fulfill({
        status: 200,
        contentType: u.endsWith('.woff2') ? 'font/woff2' : 'text/css',
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(hit),
      });
    }
    return route.abort();
  });
  for (const p of paths) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://127.0.0.1:8899' + p, { waitUntil: 'load', timeout: 20000 }).catch(() => errs.push('読み込み失敗'));
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const used = new Set();
      document.querySelectorAll('h1,h2,p,span,div').forEach((e) => {
        if (e.textContent && e.textContent.trim().length > 4) {
          used.add(getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, ''));
        }
      });
      const root = document.body.firstElementChild;
      return {
        h: root ? Math.ceil(root.getBoundingClientRect().height) : 0,
        sw: document.documentElement.scrollWidth,
        fonts: [...used].slice(0, 6),
        loaded: document.fonts ? document.fonts.size : -1,
      };
    });
    const name = tag + '-' + scheme + p.replace(/[/.]/g, '_');
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const over = r.sw > w ? `  ← 横にはみ出している（${r.sw}px）` : '';
    console.log(`${(tag + '/' + scheme).padEnd(9)}${p.padEnd(32)} 幅${String(r.sw).padStart(5)} 書体${String(r.loaded).padStart(4)}種 ${r.fonts.slice(0,2).join(' / ')}${over} ${errs.join('|')}`);
    await page.close();
  }
  await ctx.close();
}
await b.close();
