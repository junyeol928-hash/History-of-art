/* =========================================================================
   作品画像を Wikimedia から取得して assets/artworks/ に焼き込む。
   このコンテナからは外部ネットワークに出られないので、GitHub Actions で走らせる。
   取得できたIDは data/artworks-baked.json に、失敗は標準出力とサマリーに出す。
     node tools/fetch-artworks.mjs           … 未取得のものだけ
     node tools/fetch-artworks.mjs --force   … 全部取り直す
   ========================================================================= */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const UA = 'ArtHistoryStaticSite/1.0 (https://github.com/junyeol928-hash/History-of-art; educational)';
const OUT = 'assets/artworks';
const WIDTH = 1600;
const FORCE = process.argv.includes('--force');

mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync('data/artworks.json', 'utf8'));
const ids = Object.keys(manifest).sort();

const ok = [];
const failed = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Commons のファイル名から、指定幅のサムネイル URL を得る */
async function viaCommons(file) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=' + WIDTH
    + '&titles=' + encodeURIComponent('File:' + file);
  const d = await getJSON(api);
  const pages = d?.query?.pages ?? {};
  for (const k of Object.keys(pages)) {
    if (k === '-1') continue;
    const ii = pages[k].imageinfo?.[0];
    if (ii) return { url: ii.thumburl || ii.url, mime: ii.mime };
  }
  throw new Error('Commons にそのファイル名が見つかりません');
}

/** Wikipedia の記事名から、その記事の代表画像を得る */
async function viaWikipedia(lang, title) {
  const api = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`
    + encodeURIComponent(String(title).replace(/ /g, '_'));
  const d = await getJSON(api);
  const u = d?.originalimage?.source || d?.thumbnail?.source;
  if (!u) throw new Error(`${lang}.wikipedia に画像がありません`);
  return { url: u.replace(/\/(\d+)px-/, `/${WIDTH}px-`), mime: null };
}

function extFor(url, mime) {
  if (mime === 'image/png' || /\.png($|\?)/i.test(url)) return 'png';
  if (mime === 'image/svg+xml' || /\.svg($|\?)/i.test(url)) return 'svg';
  if (/\.webp($|\?)/i.test(url)) return 'webp';
  return 'jpg';
}

async function download(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`ダウンロード失敗 HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 3000) throw new Error(`小さすぎます（${buf.length} バイト）`);
  return buf;
}

function alreadyHave(id) {
  for (const e of ['jpg', 'png', 'webp', 'svg']) {
    const p = `${OUT}/${id}.${e}`;
    if (existsSync(p) && statSync(p).size > 3000) return e;
  }
  return null;
}

console.log(`マニフェスト ${ids.length} 件\n`);

for (const id of ids) {
  const m = manifest[id];
  if (!FORCE) {
    const have = alreadyHave(id);
    if (have) { ok.push(id); console.log(`= ${id}  （取得済み .${have}）`); continue; }
  }

  const attempts = [];
  if (m.commons) attempts.push(['Commons', () => viaCommons(m.commons)]);
  if (m.wiki)    attempts.push([`${m.wikiLang || 'ja'}.wikipedia`, () => viaWikipedia(m.wikiLang || 'ja', m.wiki)]);
  if (m.wikiEn)  attempts.push(['en.wikipedia', () => viaWikipedia('en', m.wikiEn)]);

  let done = false;
  const errors = [];
  for (const [label, fn] of attempts) {
    try {
      const { url, mime } = await fn();
      const buf = await download(url);
      const ext = extFor(url, mime);
      writeFileSync(`${OUT}/${id}.${ext}`, buf);
      console.log(`✓ ${id}  ${label}  ${(buf.length / 1024).toFixed(0)}KB`);
      ok.push(id);
      done = true;
      break;
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
    await sleep(150);
  }
  if (!done) {
    console.log(`✗ ${id}  ${m.artist ?? ''}《${m.title ?? ''}》`);
    errors.forEach((e) => console.log(`    ${e}`));
    failed.push({ id, artist: m.artist, title: m.title, errors });
  }
  await sleep(150);
}

writeFileSync('data/artworks-baked.json', JSON.stringify(ok.sort(), null, 1));

console.log(`\n──────────────────────────────`);
console.log(`取得できた: ${ok.length} / ${ids.length}`);
console.log(`取得できなかった: ${failed.length}`);
if (failed.length) {
  console.log(`\nマニフェストの commons / wiki / wikiEn を直してください:`);
  failed.forEach((f) => console.log(`  ${f.id}  ${f.artist ?? ''}《${f.title ?? ''}》`));
}

/* GitHub Actions のサマリー欄にも出す */
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `## 作品画像の取得結果`, ``,
    `- 取得できた: **${ok.length} / ${ids.length}**`,
    `- 取得できなかった: **${failed.length}**`, ``,
  ];
  if (failed.length) {
    lines.push(`### 直すべきマニフェスト`, ``, `| ID | 作品 | 試したこと |`, `|---|---|---|`);
    failed.forEach((f) => lines.push(
      `| \`${f.id}\` | ${f.artist ?? ''}《${f.title ?? ''}》 | ${f.errors.join('<br>')} |`));
  }
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), { flag: 'a' });
}
