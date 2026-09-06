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
      const obj = (v && typeof v === 'object' && !Array.isArray(v));
      if (k in all) {
        /* 同じ語を複数の章が定義している。用語辞典の見出しは初出の章のものを
           使うが、後の章の書き分けを捨てない。フレスコは第11章で
           「湿気に弱く、ヴェネツィアでは保たなかった」と書かれ、補色は
           第18章で「ゴッホが手紙で繰り返し論じている」と書かれている。
           以前はこれを黙って捨てていたので、その章を読んでいても
           別の章の説明が出ていた。章ごとの版として持たせ、
           本文のツールチップはその章の版を先に使う。 */
        if (obj && all[k] && typeof all[k] === 'object') {
          (all[k].byChapter ||= {})[from] = { ...v, chapter: from };
          dupes.push(`${k}（${from} の版も残した）`);
        } else {
          dupes.push(`${k}（${f} は初出ではないので採らない）`);
        }
        continue;
      }
      // どの章のものかを記録しておく（名作ギャラリーが時代で絞り込むのに使う）
      // v 側に chapter が書かれていても、置かれているファイルの章を正とする
      all[k] = obj ? { ...v, chapter: from } : v;
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

/* ファイルから直に開いても読めるように、同じ中身を JavaScript にも書き出す。
   ここで一緒に作らないと、データだけ新しくて同梱が古い状態が生まれる。 */
await import('node:child_process').then(({ execFileSync }) => {
  execFileSync(process.execPath, ['tools/bundle.mjs'], { stdio: 'inherit' });
});
