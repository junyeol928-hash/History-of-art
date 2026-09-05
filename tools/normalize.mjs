/* 章の体裁を揃える。新しい章が増えるたびに走らせる。
   - skins.css の読み込みを足す
   - 章扉が旧式（header.opener）なら門（header.portal）へ変換する */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

let css = 0, portal = 0;
for (const f of readdirSync('chapters').filter((x) => x.endsWith('.html'))) {
  const path = `chapters/${f}`;
  let s = readFileSync(path, 'utf8');
  const before = s;

  if (!s.includes('skins.css')) {
    const link = '<link rel="stylesheet" href="../assets/css/site.css">';
    if (s.includes(link)) { s = s.replace(link, link + '\n<link rel="stylesheet" href="../assets/css/skins.css">'); css++; }
  }

  if (!s.includes('class="portal"')) {
    const m = s.match(/<header class="opener[^"]*"[^>]*>([\s\S]*?)<\/header>/);
    const eraM = s.match(/class="era-([a-z0-9]+)"/);
    if (m && eraM) {
      const svgFile = `assets/svg/portal-${eraM[1]}.svg`;
      if (existsSync(svgFile)) {
        let inner = m[1];
        const art = readFileSync(svgFile, 'utf8')
          .replace('<svg xmlns=', '<svg class="portal-art" aria-hidden="true" xmlns=');
        let big = '';
        const bm = inner.match(/<div class="bignum"[^>]*>[\s\S]*?<\/div>/);
        if (bm) { big = bm[0]; inner = inner.replace(big, ''); }
        s = s.slice(0, m.index) +
            `<header class="portal">\n${art}\n${big ? big + '\n' : ''}  <div class="inner">\n${inner.trim()}\n  </div>\n</header>` +
            s.slice(m.index + m[0].length);
        portal++;
      }
    }
  }
  if (s !== before) writeFileSync(path, s);
}
console.log(`skins.css を追加: ${css}章 / 章扉を門へ変換: ${portal}章`);
