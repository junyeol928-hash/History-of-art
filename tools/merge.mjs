/* data/art/*.json と data/terms/*.json を、サイトが読む1枚に束ねる */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

function merge(dir, out, label) {
  if (!existsSync(dir)) { console.log(`(${dir} なし)`); return; }
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const all = {};
  const dupes = [];
  for (const f of files) {
    let o;
    try { o = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); }
    catch (e) { console.error(`  ✗ ${f} は JSON として壊れています: ${e.message}`); continue; }
    for (const [k, v] of Object.entries(o)) {
      // 同じ用語が複数の章で導入されていたら、初出の章の定義を残す
      if (k in all) { dupes.push(`${k}（${f} は初出ではないので採らない）`); continue; }
      all[k] = v;
    }
  }
  writeFileSync(out, JSON.stringify(all, null, 1));
  console.log(`${label}: ${files.length}ファイル → ${Object.keys(all).length}件  ${out}`);
  if (dupes.length) console.log(`  重複キー: ${dupes.join(', ')}`);
}

merge('data/art', 'data/artworks.json', '作品');
merge('data/terms', 'data/glossary.json', '用語');
