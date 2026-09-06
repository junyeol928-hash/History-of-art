/* data/art/*.json と data/terms/*.json を、サイトが読む1枚に束ねる */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

let broken = 0;

function merge(dir, out, label) {
  if (!existsSync(dir)) { console.log(`(${dir} なし)`); return; }
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const all = {};
  const dupes = [];
  for (const f of files) {
    let o;
    try { o = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); }
    catch (e) {
      console.error(`  ✗ ${f} は JSON として壊れています: ${e.message}`);
      broken += 1;
      continue;
    }
    const from = f.replace(/\.json$/, '');
    for (const [k, v] of Object.entries(o)) {
      // 同じ項目が複数の章にあれば、初出の章のものを残す
      if (k in all) { dupes.push(`${k}（${f} は初出ではないので採らない）`); continue; }
      // どの章のものかを記録しておく（名作ギャラリーが時代で絞り込むのに使う）
      all[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { chapter: from, ...v } : v;
    }
  }
  /* 壊れたJSONを読み飛ばしたまま書き出すと、欠けた状態で公開されてしまう。
     ひとつでも読めなければ、何も書かずに止める。 */
  if (broken) {
    console.error(`\n${broken}ファイルが読めませんでした。${out} は書き換えません。`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(all, null, 1));
  console.log(`${label}: ${files.length}ファイル → ${Object.keys(all).length}件  ${out}`);
  if (dupes.length) console.log(`  重複キー: ${dupes.join(', ')}`);
}

merge('data/art', 'data/artworks.json', '作品');
merge('data/terms', 'data/glossary.json', '用語');
