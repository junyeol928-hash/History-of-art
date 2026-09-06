/* 実フォントで描いて確かめる。
   使い方: node tools/verify.mjs <出力先> <URLパス...>
   fonts.googleapis.com / fonts.gstatic.com への要求はローカルのキャッシュから返す。

   スクリーンショットが撮れたことを合格の代わりにしない。
   以前は例外も横のはみ出しも数えるだけで、必ず成功終了していた。
   いまは次のどれかがあれば非ゼロで終わる。
     ・ページ内の例外
     ・読み込みの失敗
     ・横スクロールが出るほどのはみ出し
     ・焼き込み済みのはずの図版が自作図に落ちている（＝写真が出ていない）

   Playwright の場所は PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM で差し替えられる。
   前の版はコンテナ内の絶対パスを直に書いていたので、よそでは起動すらしなかった。 */
import { readFileSync, existsSync } from 'node:fs';

const PW = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(PW).catch((e) => {
  console.error(`Playwright を読み込めません（${PW}）: ${e.message}`);
  console.error('PLAYWRIGHT_MODULE で場所を指定するか、npm i -D playwright してください。');
  process.exit(2);
});

const OUT = process.argv[2];
const paths = process.argv.slice(3);
const idx = existsSync('.fontcache/index.json')
  ? JSON.parse(readFileSync('.fontcache/index.json', 'utf8')) : {};
console.log(`フォントキャッシュ: ${Object.keys(idx).length} 件`);

const problems = [];
const launchOpts = {};
if (process.env.PLAYWRIGHT_CHROMIUM) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
const b = await chromium.launch(launchOpts);
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
      /* 図版が写真で出たか、自作図に落ちたかを数える。
         スクリーンショットが撮れても、額の中が全部フォールバックの図なら
         それは通っていない。 */
      const plates = [...document.querySelectorAll('figure.plate[data-art], figure.face[data-art]')];
      return {
        h: root ? Math.ceil(root.getBoundingClientRect().height) : 0,
        sw: document.documentElement.scrollWidth,
        fonts: [...used].slice(0, 6),
        loaded: document.fonts ? document.fonts.size : -1,
        plates: plates.length,
        real: plates.filter((f) => f.classList.contains('-real')).length,
        drawn: plates.filter((f) => f.classList.contains('-drawn')).map((f) => f.dataset.art),
      };
    });

    /* 焼き込み済みのIDが自作図に落ちていたら、写真が出ていないということ */
    const baked = new Set(JSON.parse(readFileSync('data/artworks-baked.json', 'utf8')));
    const shouldHaveShown = r.drawn.filter((id) => baked.has(id));
    if (shouldHaveShown.length) {
      problems.push(`${p}: 写真が出ていない ${shouldHaveShown.join(', ')}`);
    }
    if (errs.length) problems.push(`${p}: ${errs.join(' / ')}`);
    if (r.sw > w) problems.push(`${p}: 横に${r.sw - w}pxはみ出している（${tag}/${scheme}）`);
    const name = tag + '-' + scheme + p.replace(/[/.]/g, '_');
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const over = r.sw > w ? `  ← 横にはみ出している（${r.sw}px）` : '';
    console.log(`${(tag + '/' + scheme).padEnd(9)}${p.padEnd(32)} 幅${String(r.sw).padStart(5)}`
      + ` 書体${String(r.loaded).padStart(4)}種 図版${r.real}/${r.plates}`
      + ` ${r.fonts.slice(0, 2).join(' / ')}${over} ${errs.join('|')}`);
    await page.close();
  }
  await ctx.close();
}
await b.close();

if (problems.length) {
  console.error(`\n──────────────────────────────\n${problems.length}件の問題:`);
  problems.forEach((x) => console.error(`  ${x}`));
  process.exit(1);
}
console.log('\n問題なし');
