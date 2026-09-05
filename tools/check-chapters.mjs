/* 章の点検。決まりごとを守れているかを機械的に確かめる。
   使い方: node tools/check-chapters.mjs [章のslug...]  （省略すると全章） */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const chapters = JSON.parse(readFileSync('data/chapters.json', 'utf8')).chapters;
const art = existsSync('data/artworks.json') ? JSON.parse(readFileSync('data/artworks.json', 'utf8')) : {};
const gloss = existsSync('data/glossary.json') ? JSON.parse(readFileSync('data/glossary.json', 'utf8')) : {};
const only = process.argv.slice(2);

const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '')
                      .replace(/<[^>]+>/g, '').replace(/\s+/g, '');
let bad = 0, ok = 0;

for (const c of chapters) {
  const f = `chapters/${c.slug}.html`;
  if (!existsSync(f)) continue;
  if (only.length && !only.includes(c.slug)) continue;
  const s = readFileSync(f, 'utf8');
  const p = [];

  // 骨格
  if (!/<header class="portal"/.test(s)) p.push('章扉（門）がない');
  if (!/class="portal-art"/.test(s)) p.push('門の地がない');
  if (!/<div class="inner">/.test(s)) p.push('門の銘板（.inner）がない');
  const spots = (s.match(/class="spot-card"/g) || []).length;
  if (spots < 3) p.push(`この時代の見分け方が${spots}枚（3枚必要）`);
  const faces = (s.match(/class="face"/g) || []).length;
  if (faces < 6) p.push(`この時代の顔が${faces}点（6点以上必要）`);
  const hooks = (s.match(/class="hook"/g) || []).length;
  if (faces && hooks < faces) p.push(`「一行の引っかかり」が${hooks}/${faces}点`);
  if (!/class="[^"]*seeit/.test(s)) p.push('「見に行く」がない');
  if (!/data-chapter="([^"]+)"/.test(s) || RegExp.$1 !== c.slug) p.push('data-chapter が不一致');
  if (!new RegExp(`class="era-${c.era}"`).test(s)) p.push(`時代クラス era-${c.era} がない`);
  if (!/skins\.css/.test(s)) p.push('skins.css を読んでいない');

  // 図版
  const plates = (s.match(/<figure class="plate/g) || []).length;
  const looks = (s.match(/class="look"/g) || []).length;
  if (plates < 5) p.push(`図版が${plates}点（5点以上）`);
  if (plates && looks < plates - 1) p.push(`「ここを見る」が${looks}/${plates}点`);

  // データの整合
  for (const id of new Set([...s.matchAll(/data-art="([^"]+)"/g)].map((m) => m[1])))
    if (!art[id]) p.push(`作品データ欠落: ${id}`);
  for (const t of new Set([...s.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1])))
    if (!gloss[t]) p.push(`用語欠落: ${t}`);
  for (const m of s.matchAll(/data-spots='([^']+)'/g)) {
    try { JSON.parse(m[1]); } catch (e) { p.push('data-spots が壊れている'); }
  }

  // 禁じ手
  const bodyOnly = s.split('</head>')[1] || '';
  if (/<style[\s>]/.test(bodyOnly)) p.push('本文に <style> がある');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(s)) p.push('絵文字がある');
  if (/(Inter|Roboto|Fraunces)[+:'"]/.test(s)) p.push('禁止書体を使っている');

  const chars = strip(s).length;
  if (chars < 3500) p.push(`本文が短い（約${chars}字）`);

  if (p.length) {
    bad++;
    console.log(`✗ 第${String(c.n).padStart(2)}章 ${c.slug}  (${chars}字)`);
    p.forEach((x) => console.log(`     ${x}`));
  } else {
    ok++;
    console.log(`✓ 第${String(c.n).padStart(2)}章 ${c.slug}  ${chars}字 図版${plates} 見分け方${spots} 顔${faces}`);
  }
}
console.log(`\n合格 ${ok} / 要修正 ${bad}`);
