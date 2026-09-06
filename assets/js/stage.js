/* =========================================================================
   時代スキンの舞台づくり

   本文の段落を、連なりごとに <div class="run"> でくくる。
   それだけ。組み方を変えるのは CSS の仕事で、ここはその足場を作るだけ。

   なぜ要るか。
   縦組みにするにも、二段に割るにも、紙片として散らすにも、
   「ここからここまでが一続きの文章」という単位が要る。
   .prose の直下は p と figure と h2 と band が交互に並んでいるだけなので、
   CSS からは段落の連なりを掴めない。だからここで印をつける。

   守ること。
   ・**これが動かなくても本文は読める。** くくらなければ、ただの段落のままになる。
   ・文章の順番も中身も変えない。要素を移動も複製もしない。
   ・図版・囲み・見出しには触らない。
   ========================================================================= */
(function () {
  'use strict';

  var prose = document.querySelector('.prose');
  if (!prose) return;

  /* 段落の連なりだけをくくる。
     間に図版や見出しや囲みが入ったら、そこで一区切りとする。 */
  var run = null;
  var index = 0;
  var kids = Array.prototype.slice.call(prose.children);

  kids.forEach(function (el) {
    var isText = el.tagName === 'P' || el.tagName === 'BLOCKQUOTE';
    if (!isText) { run = null; return; }

    if (!run) {
      run = document.createElement('div');
      run.className = 'run';
      run.dataset.run = String(index++);
      prose.insertBefore(run, el);
    }
    run.appendChild(el);
  });

  prose.dataset.runs = String(index);

  /* 章の中で「意味が変わるところ」に印をつける。
     h2 の直後の連なりが、その節の書き出しにあたる。
     時代ごとの CSS が、ここを山場として扱えるようにしておく。 */
  Array.prototype.forEach.call(prose.querySelectorAll('h2'), function (h) {
    var n = h.nextElementSibling;
    if (n && n.classList.contains('run')) n.classList.add('-opens');
  });

  var runs = prose.querySelectorAll('.run');
  if (runs.length) {
    runs[0].classList.add('-first');
    runs[runs.length - 1].classList.add('-last');
  }

  /* 縦組みの塊は、右端＝文章の書き出しから読みはじめる。

     vertical-rl では scrollLeft は 0 が右端で、左へ行くほど負になる。
     つまり初期値 0 がすでに読み始めであり、ふつうは何もしなくてよい。
     ただしそう振る舞わないブラウザがあったときのために、
     いちど右端へ寄せておく（正しく動いている環境では何も起きない）。 */
  function anchorStart() {
    Array.prototype.forEach.call(runs, function (run) {
      if ((getComputedStyle(run).writingMode || '').indexOf('vertical') !== 0) return;
      if (run.scrollWidth <= run.clientWidth) return;
      run.scrollLeft = run.scrollWidth;   // 右端へ寄る（0 に丸められる）
    });
  }

  anchorStart();
  // 書体が届くと字送りが変わり、幅も変わる
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(anchorStart);
})();
