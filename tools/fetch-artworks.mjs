/* =========================================================================
   作品画像を Wikimedia から取得して assets/artworks/ に焼き込む。
   このコンテナからは外部ネットワークに出られないので、GitHub Actions で走らせる。

     node tools/fetch-artworks.mjs                 … 未取得のものだけ
     node tools/fetch-artworks.mjs --force         … 全部取り直す
     node tools/fetch-artworks.mjs --only=a,b,c    … このIDだけ取り直す
     node tools/fetch-artworks.mjs --audit         … 取得はせず、現状の点検だけ

   取得の記録は data/artworks-provenance.json に残す。
   どの経路で・Commons のどのファイルから来た一枚なのかが、あとから分かるように。

   ── 2026-09 の作り直しについて ──────────────────────────────
   以前の版は、名指しの Commons ファイル名が実在しないとき、
   作品名で全文検索して「いちばん大きい画像」を採っていた。これが壊れていた。

   ・Commons の検索は "Lamassu" を "Lama" に語幹展開する。
     人頭有翼牡牛像を頼んで、ダライ・ラマの写真が返ってきていた。
   ・`Object.values(pages)` は pageid 順なので、検索順位が消える。
     そのうえ選択基準が画素幅だけで、iiurlwidth の上限で軒並み同点になるから、
     実質くじ引きだった。
   ・記事名が作者名のとき（《青い馬 I》の wikiEn が "Franz Marc" など）、
     残る経路が検索だけになり、作者の顔写真が作品として配られていた。
   ・一度書き込むと以後スキップされ、報告も「その回に取ったぶん」しか
     数えないので、誤りが恒久的に見えなくなっていた。

   なので、この版では次を守る。
   ・検索の結果は、作品を指す語が題に入っていなければ採らない（照合の関門）。
   ・作者名しか手がかりがない場合は、検索そのものを使わない。
   ・経路には優先順位があり、上が通ればそこで確定する。大きさでは選ばない。
   ・同じ Commons ファイルを二つの作品に配らない。
   ・報告は毎回すべてのIDについて出す。
   ========================================================================= */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';

const UA = 'ArtHistoryStaticSite/1.0 (https://github.com/junyeol928-hash/History-of-art; educational)';
const OUT = 'assets/artworks';
const PROV = 'data/artworks-provenance.json';
const WIDTH = 1800;            // 拡大して筆跡を見るのに耐える幅
const SMALL = 1300;            // それでも重すぎる場合に落とす幅
const MAX_BYTES = 1500 * 1024; // 1枚の上限
const MIN_KEEP = 300;          // これを下回る写真は、額に入れるより自作の図のほうがましだ

const FORCE = process.argv.includes('--force');
const AUDIT = process.argv.includes('--audit');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '')
  .replace('--only=', '').split(',').map((s) => s.trim()).filter(Boolean);

/* ── 照合の関門 ──────────────────────────────────────────────
   検索が返した一枚が、頼んだ作品を指しているかを、題名の語で確かめる。
   通らなければ採らない。間違った写真は、写真がないことより悪い。 */

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'de', 'la', 'le', 'les', 'du', 'des',
  'van', 'von', 'der', 'die', 'das', 'el', 'il', 'un', 'una', 'jpg', 'jpeg', 'png', 'tif',
  'tiff', 'webp', 'svg', 'file', 'google', 'project', 'wikipedia', 'commons',
  'full', 'original', 'edit', 'crop', 'cropped', 'retouched', 'restored',
]);

/** 題名を、照合に使える語の集合にする（4文字以上、ありふれた語は除く） */
function tokens(s) {
  return new Set(
    String(s || '')
      .replace(/\.(jpg|jpeg|png|webp|svg|tif|tiff)$/i, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t))
  );
}

/** その作品を名指す語。作者の名前は手がかりに数えない。
    《ジスモンダ》を頼んで「ミュシャの肖像写真」が返ってきていたのは、
    合っているのが作者名だけだったからだ。 */
function keyTokens(m) {
  const fromFile = tokens(m.commons);
  const fromArticle = tokens(m.wikiEn);
  const artistish = m.artistPage ? fromArticle : new Set();
  const strong = new Set([...fromFile].filter((t) => !artistish.has(t)));
  if (strong.size) return strong;
  // ファイル名が無い、または作者名しか入っていないときは記事名に頼る
  return m.artistPage ? new Set() : fromArticle;
}

/** 一語だけの一致では通さない。
    《虎卣》の手がかりが {tiger, hakuko} のとき、"Bengal tiger ..." は
    tiger ひとつで通ってしまい、青銅器のかわりに本物のトラが来る。
    手がかりが二語以上あるなら、二語以上そろうことを求める。 */
function relevant(candidateTitle, keys) {
  if (!keys.size) return false;          // 手がかりが無いなら、採らない
  const ct = tokens(candidateTitle);
  let hit = 0;
  for (const k of keys) if (ct.has(k)) hit += 1;
  return hit >= Math.min(2, keys.size);
}

/** JPEG/PNG のヘッダから画素幅を読む（外部ライブラリなしで済ませる） */
function widthOf(buf) {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {              // JPEG
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // 0xff が続くのは詰め物。読み飛ばさないと、次の2バイトを
        // セグメント長と読み違えて、あらぬところへ跳ぶ
        if (marker === 0xff) { i += 1; continue; }
        // 長さを持たないマーカー（SOI/EOI/RSTn/TEM）
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return buf.readUInt16BE(i + 7);
        }
        const len = buf.readUInt16BE(i + 2);
        if (len < 2) return 0;             // 壊れている
        i += 2 + len;
      }
    } else if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {  // PNG
      return buf.readUInt32BE(16);
    }
  } catch { /* 読めなければ 0 扱い */ }
  return 0;
}

mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync('data/artworks.json', 'utf8'));
const ids = Object.keys(manifest).sort();
const prov = existsSync(PROV) ? JSON.parse(readFileSync(PROV, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Commons のファイル名から、指定幅のサムネイル URL を得る */
async function viaCommons(file) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=' + WIDTH
    + '&titles=' + encodeURIComponent('File:' + file);
  const d = await getJSON(api);
  const pages = d?.query?.pages ?? {};
  for (const k of Object.keys(pages)) {
    if (k === '-1') continue;
    const pg = pages[k];
    if ('missing' in pg) continue;
    const ii = pg.imageinfo?.[0];
    if (!ii) continue;
    if (!ii.thumburl && ii.size && ii.size > 4 * 1024 * 1024) {
      throw new Error('サムネイルが得られず、原寸が大きすぎます');
    }
    return { url: ii.thumburl || ii.url, mime: ii.mime, file: pg.title };
  }
  throw new Error('Commons にそのファイル名が見つかりません');
}

/** Commons を検索する。返すのは検索順位の順。順位は pg.index に入っている。
    以前の版は Object.values() でこの順位を捨て、画素幅だけで選んでいた。 */
async function searchCommons(query, limit = 12) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&generator=search&gsrnamespace=6&gsrlimit=' + limit
    + '&gsrsearch=' + encodeURIComponent(query)
    + '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=' + WIDTH;
  const d = await getJSON(api);
  const pages = Object.values(d?.query?.pages ?? {});
  pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  const out = [];
  for (const pg of pages) {
    const ii = pg.imageinfo?.[0];
    if (!ii) continue;
    if (ii.mime && !/^image\/(jpeg|png|webp)$/.test(ii.mime)) continue;
    if (/\b(map|logo|coat of arms|diagram|icon|flag)\b/i.test(pg.title)) continue;
    out.push({ url: ii.thumburl || ii.url, mime: ii.mime, file: pg.title });
  }
  return out;
}

/** 照合の関門を通った、いちばん順位の高い一枚を返す */
async function viaVettedSearch(query, keys) {
  const cands = await searchCommons(query, 12);
  if (!cands.length) throw new Error('Commons 検索で画像が見つかりません');
  const hit = cands.find((c) => relevant(c.file, keys));
  if (!hit) {
    throw new Error(`候補${cands.length}件はどれも作品名と合いません`
      + `（先頭は「${cands[0].file.replace(/^File:/, '')}」）`);
  }
  return hit;
}

/** Wikipedia の記事名から、その記事の代表画像を得る。

    URL の幅は書き換えない。Wikimedia のサムネイルは決まった幅
    （1920, 3840 など）でしか出てこなくなっていて、`/1800px-` のような
    半端な幅を頼むと 400 が返る。以前の版はここで幅を 1800 に書き換えていたので、
    Wikipedia 経路がまるごと失敗し、そのぶんが全部 Commons の全文検索に
    落ちていた。取り違えが増えた直接の原因のひとつがこれだった。 */
async function viaWikipedia(lang, title) {
  const api = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`
    + encodeURIComponent(String(title).replace(/ /g, '_'));
  const d = await getJSON(api);
  const u = d?.thumbnail?.source || d?.originalimage?.source;
  if (!u) throw new Error(`${lang}.wikipedia に画像がありません`);
  return {
    url: await widestWorking(u),
    mime: null,
    file: decodeURIComponent(String(u).split('/').pop().replace(/^\d+px-/, '').split('?')[0]),
  };
}

/** 記事の代表画像は 330px ほどの小さなサムネイルで返ってくる。
    決まった段の中から、実際に取れるいちばん大きいものに上げる。 */
async function widestWorking(url) {
  const cur = Number((url.match(/\/(\d+)px-/) || [])[1] || 0);
  if (!cur) return url;                  // 原寸URLならそのまま
  for (const w of BUCKETS) {
    if (w <= cur) break;
    const bigger = url.replace(/\/\d+px-/, `/${w}px-`);
    try {
      const r = await fetch(bigger, { method: 'HEAD', headers: { 'User-Agent': UA } });
      if (r.ok) return bigger;
    } catch { /* この段が無ければ次の段へ */ }
  }
  return url;
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

/** 重すぎたら、より小さい幅で取り直す（Wikimedia 側でリサイズしてもらう）。

    幅は勝手な数字にできない。決まった段（BUCKETS）のどれかにする。
    段から外れた幅を頼むと 400 が返ってきて、その一枚がまるごと落ちる。 */
const BUCKETS = [2560, 1920, 1280, 1024, 800];

async function downloadSized(url) {
  const buf = await download(url);
  if (buf.length <= MAX_BYTES) return { buf, url };
  const cur = Number((url.match(/\/(\d+)px-/) || [])[1] || 0);
  for (const w of BUCKETS) {
    if (!cur || w >= cur) continue;
    const smaller = url.replace(/\/\d+px-/, `/${w}px-`);
    try {
      const b2 = await download(smaller);
      if (b2.length < buf.length) return { buf: b2, url: smaller };
    } catch { /* この段が無ければ次の段へ */ }
  }
  return { buf, url };
}

function haveExt(id) {
  for (const e of ['jpg', 'png', 'webp', 'svg']) {
    const p = `${OUT}/${id}.${e}`;
    if (existsSync(p) && statSync(p).size > 3000) return e;
  }
  return null;
}

console.log(`マニフェスト ${ids.length} 件\n`);

const ok = [];
const failed = [];
const small = [];
const clash = [];

/* 同じ Commons ファイルを二つの作品に配らないための台帳。
   以前は sha1 で弾いていたが、解像度が1段違うだけで別物になるので
   素通りしていた。等伯の《楓図》と《松林図》、パカル王の《翡翠の仮面》と
   《石棺蓋》が同じ写真になっていたのはこれだ。出所の名前で照合する。 */
const usedFile = new Map();
for (const id of ids) {
  const f = prov[id]?.file;
  if (f && !usedFile.has(f)) usedFile.set(f, id);
}

const targets = ONLY.length ? ids.filter((i) => ONLY.includes(i)) : ids;

for (const id of targets) {
  const m = manifest[id];

  /* 記事名が作者の名前そのものなら、その記事の代表画像は
     この作品ではなく「その作家のいちばん有名な絵」か、作家本人の顔写真だ。 */
  m.artistPage = !!(m.wiki && m.artist && m.wiki === m.artist);
  const keys = keyTokens(m);

  if (AUDIT) {
    const have = haveExt(id);
    const p = prov[id];
    if (!have) console.log(`✗ ${id}  画像なし`);
    else if (!p) console.log(`? ${id}  .${have} はあるが取得の記録がない（出所不明）`);
    else console.log(`= ${id}  .${have}  ${p.via}  ${p.file}`);
    continue;
  }

  if (!FORCE && !ONLY.length) {
    const have = haveExt(id);
    if (have) { ok.push(id); console.log(`= ${id}  （取得済み .${have}）`); continue; }
  }

  /* 経路には順位がある。上が通ればそこで確定する。大きさでは選ばない。
     大きさで選ぶと、名指しより「その作家の代表作」のほうが大きくて勝ってしまう。 */
  const attempts = [];
  if (m.commons) {
    attempts.push(['Commons(名指し)', () => viaCommons(m.commons)]);
  }
  if (m.wikiEn && !m.artistPage) {
    attempts.push(['en.wikipedia(作品の記事)', () => viaWikipedia('en', m.wikiEn)]);
  }
  if (m.wiki && !m.artistPage) {
    attempts.push([`${m.wikiLang || 'ja'}.wikipedia(作品の記事)`,
      () => viaWikipedia(m.wikiLang || 'ja', m.wiki)]);
  }
  if (m.commons && keys.size) {
    const q = String(m.commons).replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ').trim();
    attempts.push(['Commons(検索・照合あり)', () => viaVettedSearch(q, keys)]);
  }
  if (m.wikiEn && !m.artistPage && keys.size) {
    attempts.push(['Commons(記事名で検索・照合あり)', () => viaVettedSearch(m.wikiEn, keys)]);
  }

  const errors = [];
  let got = null;
  for (const [via, fn] of attempts) {
    try {
      const cand = await fn();
      const sized = await downloadSized(cand.url);
      const w = widthOf(sized.buf);
      if (w && w < MIN_KEEP) {
        errors.push(`${via}: ${w}px しかなく小さすぎます`);
        small.push({ id, w, artist: m.artist, title: m.title, dropped: true });
        continue;
      }
      got = { ...sized, mime: cand.mime, file: String(cand.file).replace(/^File:/, ''), w, via };
      break;
    } catch (e) {
      errors.push(`${via}: ${e.message}`);
    }
    await sleep(150);
  }

  if (got) {
    const owner = usedFile.get(got.file);
    if (owner && owner !== id) {
      console.log(`✗ ${id}  ${owner} と同じファイル（${got.file}）が返った`);
      clash.push({ id, owner, file: got.file, artist: m.artist, title: m.title });
      got = null;
    }
  }

  if (got) {
    const ext = extFor(got.url, got.mime);
    writeFileSync(`${OUT}/${id}.${ext}`, got.buf);
    // このIDが前に使っていたファイルの登録を外す。外さないと、
    // Aを直したあとも A の旧ファイルが台帳に残り、
    // そのファイルを正しく使うはずの B が「重複」として拒まれる
    const before = prov[id]?.file;
    if (before && before !== got.file && usedFile.get(before) === id) usedFile.delete(before);
    usedFile.set(got.file, id);
    prov[id] = { via: got.via, file: got.file, width: got.w, at: new Date().toISOString().slice(0, 10) };
    const warn = got.w && got.w < 1200 ? '  ← 小さい' : '';
    console.log(`✓ ${id}  ${got.via}  ${got.w}px  ${(got.buf.length / 1024).toFixed(0)}KB  ${got.file}${warn}`);
    ok.push(id);
    if (got.w && got.w < 1200) small.push({ id, w: got.w, artist: m.artist, title: m.title });
  } else {
    console.log(`✗ ${id}  ${m.artist ?? ''}《${m.title ?? ''}》`);
    errors.forEach((e) => console.log(`    ${e}`));
    failed.push({ id, artist: m.artist, title: m.title, errors });
  }
  await sleep(150);
}

if (AUDIT) process.exit(0);

writeFileSync('data/artworks-baked.json',
  JSON.stringify(ids.filter((i) => haveExt(i)).sort(), null, 1));
writeFileSync(PROV, JSON.stringify(
  Object.fromEntries(Object.keys(prov).sort().map((k) => [k, prov[k]])), null, 1));

/* 報告は毎回、全IDについて出す。
   以前の版は「その回に新しく取ったぶん」しか数えていなかったので、
   一度まちがえて焼き込まれた画像は、以後どの回の報告にも現れなかった。 */
const have = ids.filter((i) => haveExt(i));
const noProv = have.filter((i) => !prov[i]);
const risky = have.filter((i) => prov[i] && prov[i].via !== 'Commons(名指し)');

console.log(`\n──────────────────────────────`);
console.log(`画像がある: ${have.length} / ${ids.length}`);
console.log(`画像がない: ${ids.length - have.length}`);
console.log(`名指し以外の経路で取れた（要目視）: ${risky.length}`);
console.log(`出所の記録がない（要目視）: ${noProv.length}`);
console.log(`幅1200px未満: ${small.length}`);
console.log(`他と同じファイルが返った: ${clash.length}`);

if (clash.length) {
  console.log(`\n別作品と同じ Commons ファイルが返ったもの:`);
  clash.forEach((d) => console.log(`  ${d.id}  ← ${d.owner} と同一（${d.file}）`));
}
if (noProv.length) {
  console.log(`\n出所の記録がない画像（いつ・どこから来たのか分かりません）:`);
  noProv.forEach((i) => console.log(`  ${i}`));
}
if (failed.length) {
  console.log(`\nマニフェストの commons / wiki / wikiEn を直してください:`);
  failed.forEach((f) => console.log(`  ${f.id}  ${f.artist ?? ''}《${f.title ?? ''}》`));
}

/* GitHub Actions のサマリー欄にも出す */
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `## 作品画像の取得結果`, ``,
    `- 画像がある: **${have.length} / ${ids.length}**`,
    `- 画像がない: **${ids.length - have.length}**`,
    `- 名指し以外の経路（要目視）: **${risky.length}**`,
    `- 出所の記録がない（要目視）: **${noProv.length}**`,
    `- 幅1200px未満: **${small.length}**`,
    `- 他と同じファイルが返った: **${clash.length}**`, ``,
  ];
  if (clash.length) {
    lines.push(`### 別作品と同じファイルが返ったもの`, ``, `| ID | 同じだった相手 | ファイル |`, `|---|---|---|`);
    clash.forEach((d) => lines.push(`| \`${d.id}\` | \`${d.owner}\` | ${d.file} |`));
    lines.push(``);
  }
  if (risky.length) {
    lines.push(`### 名指し以外の経路で取れたもの`, ``, `| ID | 経路 | 使ったファイル |`, `|---|---|---|`);
    risky.forEach((i) => lines.push(`| \`${i}\` | ${prov[i].via} | ${prov[i].file} |`));
    lines.push(``);
  }
  if (small.length) {
    lines.push(`### 解像度が足りないもの`, ``, `| 幅 | ID | 作品 |`, `|---|---|---|`);
    small.sort((a, b) => a.w - b.w).forEach((s) =>
      lines.push(`| ${s.w}px | \`${s.id}\` | ${s.artist ?? ''}《${s.title ?? ''}》 |`));
    lines.push(``);
  }
  if (failed.length) {
    lines.push(`### 取得できなかったもの`, ``, `| ID | 作品 | 試したこと |`, `|---|---|---|`);
    failed.forEach((f) => lines.push(
      `| \`${f.id}\` | ${f.artist ?? ''}《${f.title ?? ''}》 | ${f.errors.join('<br>')} |`));
  }
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), { flag: 'a' });
}
