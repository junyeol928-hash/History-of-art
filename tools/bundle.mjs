/* data/*.json を、そのまま読み込める JavaScript として同梱する。
     node tools/bundle.mjs   →  data/bundle.js

   なぜ要るか。
   このサイトは目次も年表も辞典も、データを fetch で読んでいる。
   サーバー越しなら問題ないが、index.html をダブルクリックして
   file:// で開くと、ブラウザが同じ場所のファイルへの fetch を止める。
   真っ白なページが出る。

   そこで同じ中身を <script> で読める形にしておき、
   file:// で開かれたときだけ fetch の代わりにこちらを返す。
   http:// で開いているあいだは、この仕掛けは一切働かない。
   サーバーを立てて読むときの動きは、前と1バイトも変わらない。 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const FILES = [
  'data/chapters.json',
  'data/artworks.json',
  'data/artworks-baked.json',
  'data/glossary.json',
  'data/timeline.json',
  'data/museums.json',
  'data/capitals.json',
];

const data = {};
for (const f of FILES) data[f] = JSON.parse(readFileSync(f, 'utf8'));

/* index.html は「章のHTMLが実在するか」を HEAD で確かめて、
   目次のリンクにするか「準備中」にするかを決めている。
   file:// では HEAD も通らないので、実在する章の一覧も一緒に持たせる。 */
const chapterFiles = readdirSync('chapters')
  .filter((f) => f.endsWith('.html'))
  .map((f) => 'chapters/' + f)
  .sort();

const js = `/* 自動生成 — 直接編集しないでください。tools/bundle.mjs が作ります。
   ${new Date().toISOString().slice(0, 10)} 時点の data/*.json を同梱しています。
   data/ を書き換えたら node tools/bundle.mjs を走らせ直してください。 */
(function () {
  'use strict';

  var DATA = ${JSON.stringify(data)};
  var PAGES = ${JSON.stringify(chapterFiles)};

  window.__ARTDATA = DATA;

  /* サーバー越しに読んでいるときは何もしない。
     ここで手を入れるのは、ファイルから直に開かれたときだけ。 */
  if (location.protocol !== 'file:') return;

  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  function reply(body, status) {
    var init = { status: status || 200, headers: { 'Content-Type': 'application/json' } };
    if (typeof Response === 'function') return Promise.resolve(new Response(body, init));
    // Response が無い古い環境向けの、最低限の代用
    return Promise.resolve({
      ok: init.status < 400, status: init.status,
      json: function () { return Promise.resolve(JSON.parse(body)); },
      text: function () { return Promise.resolve(body); },
    });
  }

  window.fetch = function (input, init) {
    var url = String((input && input.url) || input || '');

    // 外の世界（Wikimedia など）への要求はそのまま通す
    if (/^https?:/i.test(url)) {
      return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch できません'));
    }

    // 同梱したデータで答えられるもの
    for (var key in DATA) {
      if (Object.prototype.hasOwnProperty.call(DATA, key) && url.indexOf(key) !== -1) {
        return reply(JSON.stringify(DATA[key]));
      }
    }

    /* 目次が章の実在を確かめにくる HEAD 要求。
       一覧に載っていれば 200、なければ 404 を返す。 */
    if (/\\.html($|[?#])/i.test(url)) {
      var hit = PAGES.some(function (p) {
        return url.indexOf(p) !== -1 || url.indexOf(p.replace('chapters/', '')) !== -1;
      });
      return reply('', hit ? 200 : 404);
    }

    return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch できません'));
  };
})();
`;

writeFileSync('data/bundle.js', js);
console.log(`data/bundle.js を書きました（${FILES.length}ファイル・章${chapterFiles.length}本・${(js.length / 1024).toFixed(0)}KB）`);
