/* 検証用フォントキャッシュ
   Google Fonts の CSS と woff2 を丸ごと取ってきて、URL→ファイルの対応表と一緒に保存する。
   検証スクリプトはこれを使って fonts.googleapis.com / fonts.gstatic.com への
   要求を横取りし、ローカルから返す。
   こうしないと Chromium が代替フォントに落ち、日本語の縦組みが字送りごと壊れて
   見た目の検証が当てにならなくなる。 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = process.argv[2] || '.fontcache';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
mkdirSync(`${DIR}/css`, { recursive: true });
mkdirSync(`${DIR}/font`, { recursive: true });

const key = (u) => createHash('md5').update(u).digest('hex').slice(0, 20);

/* サイトと試作が読んでいる CSS の URL をすべて集める */
const files = process.argv.slice(3);
const cssUrls = new Set();
for (const f of files) {
  if (!existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s)]+/g)) {
    cssUrls.add(m[0].replace(/&amp;/g, '&'));
  }
}
console.log(`CSS の URL: ${cssUrls.size} 件`);

const index = {};
let fonts = 0, failed = 0;
for (const cu of cssUrls) {
  let css;
  try {
    const r = await fetch(cu, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    css = await r.text();
  } catch (e) { console.log(`  ✗ CSS ${e.message}  ${cu.slice(0, 80)}`); failed++; continue; }

  for (const m of css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g)) {
    const fu = m[0];
    const fp = `${DIR}/font/${key(fu)}.woff2`;
    if (!existsSync(fp)) {
      try {
        const r = await fetch(fu, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        writeFileSync(fp, Buffer.from(await r.arrayBuffer()));
        fonts++;
      } catch (e) { failed++; continue; }
    }
    index[fu] = fp;
  }
  const cp = `${DIR}/css/${key(cu)}.css`;
  writeFileSync(cp, css);
  index[cu] = cp;
}
writeFileSync(`${DIR}/index.json`, JSON.stringify(index, null, 1));
console.log(`フォント本体: ${fonts} 件を新規取得 / 対応表 ${Object.keys(index).length} 件 / 失敗 ${failed}`);
