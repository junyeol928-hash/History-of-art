/* =========================================================================
   作品画像を Wikimedia から取得して assets/artworks/ に焼き込む。
   このコンテナからは外部ネットワークに出られないので、GitHub Actions で走らせる。
   取得できたIDは data/artworks-baked.json に、失敗は標準出力とサマリーに出す。
     node tools/fetch-artworks.mjs           … 未取得のものだけ
     node tools/fetch-artworks.mjs --force   … 全部取り直す
   ========================================================================= */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = 'ArtHistoryStaticSite/1.0 (https://github.com/junyeol928-hash/History-of-art; educational)';
const OUT = 'assets/artworks';
const WIDTH = 1800;           // 拡大して筆跡を見るのに耐える幅
const SMALL = 1300;           // それでも重すぎる場合に落とす幅
const MAX_BYTES = 1500 * 1024; // 1枚の上限
const FORCE = process.argv.includes('--force');
const GOOD_ENOUGH = 1500;     // これだけ幅があれば、それ以上の経路は探さない

/** JPEG/PNG のヘッダから画素幅を読む（外部ライブラリなしで済ませる） */
async function widthOf(buf) {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {              // JPEG
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return buf.readUInt16BE(i + 7);
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {  // PNG
      return buf.readUInt32BE(16);
    }
  } catch (e) { /* 読めなければ 0 扱い */ }
  return 0;
}

mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync('data/artworks.json', 'utf8'));
const ids = Object.keys(manifest).sort();

const ok = [];
const failed = [];
const small = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Commons のファイル名から、指定幅のサムネイル URL を得る */
async function viaCommons(file) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=' + WIDTH
    + '&titles=' + encodeURIComponent('File:' + file);
  const d = await getJSON(api);
  const pages = d?.query?.pages ?? {};
  for (const k of Object.keys(pages)) {
    if (k === '-1') continue;
    const ii = pages[k].imageinfo?.[0];
    if (ii) {
      // thumburl が無いのは SVG など。その場合だけ原寸を使う
      if (!ii.thumburl && ii.size && ii.size > 4 * 1024 * 1024) {
        throw new Error('サムネイルが得られず、原寸が大きすぎます');
      }
      return { url: ii.thumburl || ii.url, mime: ii.mime };
    }
  }
  throw new Error('Commons にそのファイル名が見つかりません');
}

/** Commons を作品名で検索して、いちばん大きい画像を拾う。
    マニフェストのファイル名が外れていても、これで救えることが多い */
async function viaCommonsSearch(query, limit = 8) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&generator=search&gsrnamespace=6&gsrlimit=' + limit
    + '&gsrsearch=' + encodeURIComponent(query)
    + '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=' + WIDTH;
  const d = await getJSON(api);
  const pages = Object.values(d?.query?.pages ?? {});
  const cands = [];
  for (const pg of pages) {
    const ii = pg.imageinfo?.[0];
    if (!ii) continue;
    if (ii.mime && !/^image\/(jpeg|png|webp)$/.test(ii.mime)) continue;
    // 図表・地図・紋章などを避ける
    if (/\b(map|logo|coat of arms|diagram|icon|flag)\b/i.test(pg.title)) continue;
    cands.push({ url: ii.thumburl || ii.url, mime: ii.mime, w: ii.thumbwidth || ii.width || 0 });
  }
  if (!cands.length) throw new Error('Commons 検索で画像が見つかりません');
  cands.sort((a, b) => b.w - a.w);
  return cands[0];
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

/** 重すぎたら、より小さい幅で取り直す（Wikimedia 側でリサイズしてもらう） */
async function downloadSized(url, mime) {
  let buf = await download(url);
  if (buf.length > MAX_BYTES) {
    const smaller = url.replace(new RegExp(`/${WIDTH}px-`), `/${SMALL}px-`);
    if (smaller !== url) {
      try {
        const b2 = await download(smaller);
        if (b2.length < buf.length) return { buf: b2, url: smaller };
      } catch (e) { /* 取り直せなければ元のまま */ }
    }
  }
  return { buf, url };
}

function alreadyHave(id) {
  for (const e of ['jpg', 'png', 'webp', 'svg']) {
    const p = `${OUT}/${id}.${e}`;
    if (existsSync(p) && statSync(p).size > 3000) return e;
  }
  return null;
}

/* 別々の作品なのに同じ写真が返ってくることがある。
   ファイル名が違っていて、記事の代表画像に落ちたときだ。
   縄文の土偶5点が全部おなじ遮光器土偶になっていた。
   間違った写真は、写真がないことより悪い。だから中身のハッシュで弾く。 */
const seen = new Map();   // sha1 → 先に取れたID
const dup = [];
const miss = [];   // commons を名指ししたのに、その名前では取れなかったもの
const sha = (b) => createHash('sha1').update(b).digest('hex');
for (const e of ['jpg', 'png', 'webp', 'svg']) {
  for (const id of ids) {
    const p = `${OUT}/${id}.${e}`;
    if (existsSync(p) && statSync(p).size > 3000) {
      const h = sha(readFileSync(p));
      if (!seen.has(h)) seen.set(h, id);
    }
  }
}

console.log(`マニフェスト ${ids.length} 件\n`);

for (const id of ids) {
  const m = manifest[id];
  if (!FORCE) {
    const have = alreadyHave(id);
    if (have) { ok.push(id); console.log(`= ${id}  （取得済み .${have}）`); continue; }
  }

  const attempts = [];
  if (m.commons) attempts.push(['Commons(名指し)', () => viaCommons(m.commons)]);
  const q = [m.titleEn, m.wikiEn, m.artistEn].filter(Boolean).join(' ');
  if (q) attempts.push(['Commons(検索)', () => viaCommonsSearch(q)]);
  if (m.wikiEn)  attempts.push(['en.wikipedia', () => viaWikipedia('en', m.wikiEn)]);
  if (m.wiki)    attempts.push([`${m.wikiLang || 'ja'}.wikipedia`, () => viaWikipedia(m.wikiLang || 'ja', m.wiki)]);

  // 経路ごとに候補を集め、いちばん大きい画像を採用する。
  // 小さなサムネイルを先に掴んで満足してしまうのを防ぐため。
  const errors = [];
  let best = null;   // {buf, url, mime, w, label}
  for (const [label, fn] of attempts) {
    try {
      const got = await fn();
      const sized = await downloadSized(got.url, got.mime);
      const w = await widthOf(sized.buf);
      if (!best || w > best.w) best = { ...sized, mime: got.mime, w, label };
      /* 名指しのファイルが十分な大きさで取れたら、そこで打ち切る。
         検索は「その作家の代表作」を返してくるので、名指しより大きいことがある。
         大きさで選ぶと、別の作品にすり替わる。名指しのほうが常に正しい。 */
      if (label === 'Commons(名指し)' && w >= 1200) break;
      // 十分な大きさが取れたら、それ以上は探さない
      if (w >= GOOD_ENOUGH) break;
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
    await sleep(150);
  }

  if (best) {
    const h = sha(best.buf);
    const owner = seen.get(h);
    if (owner && owner !== id) {
      console.log(`✗ ${id}  ${owner} と同じ写真が返った（取り違え）`);
      dup.push({ id, owner, artist: m.artist, title: m.title });
      best = null;
    } else {
      seen.set(h, id);
    }
  }

  const done = !!best;
  if (best) {
    const ext = extFor(best.url, best.mime);
    writeFileSync(`${OUT}/${id}.${ext}`, best.buf);
    const warn = best.w && best.w < 1200 ? '  ← 小さい' : '';
    console.log(`✓ ${id}  ${best.label}  ${best.w}px  ${(best.buf.length / 1024).toFixed(0)}KB${warn}`);
    ok.push(id);
    if (best.w && best.w < 1200) small.push({ id, w: best.w, artist: m.artist, title: m.title });
    /* 名指しのファイル名が効かなかったものは、別の作品が来ている恐れがある。
       名前を直すべき候補として控えておく。 */
    if (m.commons && best.label !== 'Commons(名指し)') {
      miss.push({ id, label: best.label, commons: m.commons, artist: m.artist, title: m.title });
    }
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
console.log(`取れたが幅1200px未満: ${small.length}`);
console.log(`取り違え（他と同じ写真）: ${dup.length}`);
console.log(`名指しのファイル名が効かなかった: ${miss.length}`);
if (miss.length) {
  console.log(`\n別の作品が来ている恐れがあります（commons 名を直してください）:`);
  miss.forEach((d) => console.log(`  ${d.id}  ${d.label} で代用  指定は「${d.commons}」  ${d.artist ?? ''}《${d.title ?? ''}》`));
}
if (dup.length) {
  console.log(`\n別作品と同じ写真が返ったもの（commons 名を名指しで直してください）:`);
  dup.forEach((d) => console.log(`  ${d.id}  ← ${d.owner} と同一  ${d.artist ?? ''}《${d.title ?? ''}》`));
}
if (small.length) {
  console.log(`\n解像度が足りない作品（マニフェストの commons 名を直すと改善します）:`);
  small.sort((a, b) => a.w - b.w).forEach((s2) =>
    console.log(`  ${String(s2.w).padStart(4)}px  ${s2.id}  ${s2.artist ?? ''}《${s2.title ?? ''}》`));
}
if (failed.length) {
  console.log(`\nマニフェストの commons / wiki / wikiEn を直してください:`);
  failed.forEach((f) => console.log(`  ${f.id}  ${f.artist ?? ''}《${f.title ?? ''}》`));
}

/* GitHub Actions のサマリー欄にも出す */
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `## 作品画像の取得結果`, ``,
    `- 取得できた: **${ok.length} / ${ids.length}**`,
    `- 取得できなかった: **${failed.length}**`,
    `- 取れたが幅1200px未満: **${small.length}**`, ``,
    `- 取り違え（他と同じ写真）: **${dup.length}**`, ``,
    `- 名指しのファイル名が効かなかった: **${miss.length}**`, ``,
  ];
  if (small.length) {
    lines.push(`### 解像度が足りないもの`, ``, `| 幅 | ID | 作品 |`, `|---|---|---|`);
    small.sort((a, b) => a.w - b.w).forEach((s2) =>
      lines.push(`| ${s2.w}px | \`${s2.id}\` | ${s2.artist ?? ''}《${s2.title ?? ''}》 |`));
    lines.push(``);
  }
  if (dup.length) {
    lines.push(`### 別作品と同じ写真が返ったもの`, ``, `| ID | 同じだった相手 | 作品 |`, `|---|---|---|`);
    dup.forEach((d) => lines.push(`| \`${d.id}\` | \`${d.owner}\` | ${d.artist ?? ''}《${d.title ?? ''}》 |`));
    lines.push(``);
  }
  if (miss.length) {
    lines.push(`### 名指しが効かず別経路で取れたもの`, ``, `| ID | 代わりに使った経路 | 指定していた名前 | 作品 |`, `|---|---|---|---|`);
    miss.forEach((d) => lines.push(`| \`${d.id}\` | ${d.label} | \`${d.commons}\` | ${d.artist ?? ''}《${d.title ?? ''}》 |`));
    lines.push(``);
  }
  if (failed.length) {
    lines.push(`### 直すべきマニフェスト`, ``, `| ID | 作品 | 試したこと |`, `|---|---|---|`);
    failed.forEach((f) => lines.push(
      `| \`${f.id}\` | ${f.artist ?? ''}《${f.title ?? ''}》 | ${f.errors.join('<br>')} |`));
  }
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), { flag: 'a' });
}
