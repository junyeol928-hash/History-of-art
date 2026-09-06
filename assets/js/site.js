/* =========================================================================
   共通の仕掛け ─ 配色切り替え・進捗・章送り・用語ツールチップ・続きから
   ========================================================================= */
(function () {
  'use strict';

  var ROOT = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/assets\/js\/site\.js.*$/, '');
    return './';
  })();

  /* ---------- 配色 ---------- */
  var THEME_KEY = 'arthistory.theme';
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}

  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  }

  /* ---------- ヘッダーを組み立てる ---------- */
  var SUN = '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/></svg>';
  var MOON = '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z"/></svg>';

  function buildTopbar() {
    var bar = document.querySelector('.topbar');
    if (!bar || bar.dataset.built) return;
    bar.dataset.built = '1';
    var where = bar.dataset.where || '';
    bar.innerHTML =
      '<a class="home" href="' + ROOT + 'index.html">世界美術史</a>' +
      '<button class="toc-btn" type="button" aria-expanded="false" aria-label="目次をひらく">' + TOCI + '<span>目次</span></button>' +
      '<span class="spacer"></span>' +
      '<nav>' +
        '<a href="' + ROOT + 'gallery.html">作品</a>' +
        '<a class="opt" href="' + ROOT + 'timeline.html">年表</a>' +
        '<a class="opt" href="' + ROOT + 'map.html">地図</a>' +
        '<a class="opt" href="' + ROOT + 'museums.html">美術館</a>' +
        '<a href="' + ROOT + 'glossary.html">用語</a>' +
      '</nav>' +
      '<span class="where">' + where + '</span>' +
      '<button class="icon-btn" type="button" aria-label="配色を切り替える">' + SUN + MOON + '</button>';
    bar.querySelector('.icon-btn').addEventListener('click', toggleTheme);
    bar.querySelector('.toc-btn').addEventListener('click', openToc);
  }

  /* =========================================================================
     目次 ─ どのページからでも、章へ直接飛べるようにする。
     トップページまで戻ってスクロールして探す、をなくすためのもの。
     ========================================================================= */
  var TOCI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">'
    + '<path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/></svg>';
  var toc = null, tocLoaded = false;

  function ensureToc() {
    if (toc) return toc;
    toc = document.createElement('div');
    toc.className = 'tocpanel';
    toc.hidden = true;
    toc.innerHTML =
      '<div class="tocsheet" role="dialog" aria-modal="true" aria-label="目次">' +
        '<div class="tochead">' +
          '<b>目次</b>' +
          '<button class="tocclose" type="button" aria-label="閉じる">閉じる</button>' +
        '</div>' +
        '<div class="tocbody"><p class="tocwait">読み込んでいます…</p></div>' +
      '</div>';
    document.body.appendChild(toc);
    toc.addEventListener('click', function (e) {
      if (e.target === toc || e.target.closest('.tocclose')) closeToc();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toc && !toc.hidden) closeToc();
    });
    return toc;
  }

  function fillToc() {
    if (tocLoaded) return;
    tocLoaded = true;
    var here = document.body.dataset.chapter || '';
    fetch(ROOT + 'data/chapters.json').then(function (r) { return r.json(); }).then(function (d) {
      var chs = d.chapters || [];
      /* part は "west" のような識別子なので、parts の表示名に引き当てる */
      var label = {};
      (d.parts || []).forEach(function (p) { label[p.id] = p.name; });
      var parts = [], byPart = {};
      chs.forEach(function (c) {
        if (!byPart[c.part]) { byPart[c.part] = []; parts.push(c.part); }
        byPart[c.part].push(c);
      });
      var html = '';
      parts.forEach(function (id) {
        html += '<p class="tocpart">' + escapeHTML(label[id] || id) + '</p><ul class="toclist">';
        byPart[id].forEach(function (c) {
          var on = c.slug === here;
          /* 時代の色は点だけに出す。文字まで時代の色を継ぐと、目次の中で読みにくくなる */
          html += '<li><a' + (on ? ' class="-here" aria-current="page"' : '') +
            ' href="' + ROOT + 'chapters/' + escapeHTML(c.slug) + '.html">' +
            '<i class="era-' + escapeHTML(c.era) + '"></i>' +
            '<b>' + c.n + '</b><span>' + escapeHTML(c.title) + '</span></a></li>';
        });
        html += '</ul>';
      });
      html += '<p class="tocpart">読むほかに</p><ul class="toclist -tools">' +
        [['gallery.html','作品'],['timeline.html','年表'],['map.html','地図'],
         ['museums.html','美術館'],['glossary.html','用語']]
        .map(function (x) { return '<li><a href="' + ROOT + x[0] + '"><span>' + x[1] + '</span></a></li>'; }).join('') +
        '</ul>';
      toc.querySelector('.tocbody').innerHTML = html;
      var cur = toc.querySelector('.-here');
      if (cur) cur.scrollIntoView({ block: 'center' });
    }).catch(function () {
      toc.querySelector('.tocbody').innerHTML =
        '<p class="tocwait">目次を読み込めませんでした。<a href="' + ROOT + 'index.html">トップページ</a>からどうぞ。</p>';
    });
  }

  function openToc() {
    ensureToc();
    fillToc();
    toc.hidden = false;
    document.body.style.overflow = 'hidden';
    var b = document.querySelector('.toc-btn');
    if (b) b.setAttribute('aria-expanded', 'true');
    var c = toc.querySelector('.tocclose');
    if (c) c.focus();
  }
  function closeToc() {
    if (!toc) return;
    toc.hidden = true;
    document.body.style.overflow = '';
    var b = document.querySelector('.toc-btn');
    if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
  }

  /* ---------- 読書進捗 ---------- */
  function progress() {
    var el = document.getElementById('progress');
    if (!el) return;
    var tick = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
      el.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
    };
    document.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    tick();
  }

  /* ---------- 用語ツールチップ ---------- */
  var glossary = null;
  var tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'gloss';
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  var tipOwner = null;      // いまツールチップを出している語
  function showTip(el, term, def) {
    var t = ensureTip();
    t.innerHTML = '<b>' + escapeHTML(term) + '</b>' + escapeHTML(def);
    t.hidden = false;
    tipOwner = el;
    el.setAttribute('aria-expanded', 'true');
    var r = el.getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    t.style.left = (left + window.scrollX) + 'px';
    t.style.top = (top + window.scrollY) + 'px';
  }
  function hideTip() {
    if (tip) tip.hidden = true;
    if (tipOwner) tipOwner.setAttribute('aria-expanded', 'false');
    tipOwner = null;
  }

  function wireGlossary() {
    var terms = document.querySelectorAll('.term[data-term]');
    if (!terms.length) return;
    fetch(ROOT + 'data/glossary.json', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (g) {
        glossary = g || {};
        var here = document.body.dataset.chapter || '';
        terms.forEach(function (el) {
          var key = el.dataset.term;
          var entry = glossary[key];
          /* 同じ語を複数の章が書き分けていることがある。
             いま読んでいる章の版があれば、そちらを出す。
             用語辞典（glossary.html）の見出しは初出の章の版のまま。 */
          if (entry && entry.byChapter && entry.byChapter[here]) {
            entry = entry.byChapter[here];
          }
          var def = entry ? (entry.short || entry.def || '') : (el.dataset.def || '');
          if (!def) return;
          var show = function () { showTip(el, key, def); };

          /* 指で触ると mouseenter や focus が click より先に来る。
             以前はそこで出したものを、直後の click が「出ているから」という
             理由だけで引っ込めていた。最初のタップでは何も読めない。
             だから、ホバーで出すのはマウスのときだけにして、
             タップとキー操作は「この語のものが出ていたら閉じる」で切り替える。 */
          if (window.PointerEvent) {
            el.addEventListener('pointerenter', function (e) {
              if (e.pointerType === 'mouse') show();
            });
            el.addEventListener('pointerleave', function (e) {
              if (e.pointerType === 'mouse' && tipOwner === el) hideTip();
            });
          } else {
            el.addEventListener('mouseenter', show);
            el.addEventListener('mouseleave', function () { if (tipOwner === el) hideTip(); });
          }
          el.addEventListener('blur', function () { if (tipOwner === el) hideTip(); });
          el.addEventListener('click', function (e) {
            e.preventDefault();
            if (tipOwner === el) hideTip(); else show();
          });
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tipOwner === el) hideTip(); else show(); }
            if (e.key === 'Escape' && tipOwner === el) hideTip();
          });
          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-expanded', 'false');
        });
        document.addEventListener('scroll', hideTip, { passive: true });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
      });
  }

  /* ---------- 章送り ---------- */
  function chapterNav() {
    var host = document.querySelector('[data-chapter-nav]');
    var page = document.body.dataset.chapter;
    if (!host || !page) return;
    fetch(ROOT + 'data/chapters.json', { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = d.chapters, i = -1;
        for (var k = 0; k < list.length; k++) if (list[k].slug === page) { i = k; break; }
        if (i < 0) return;
        var nx = list[i + 1];
        var bar = document.querySelector('.topbar');
        if (bar) {
          var w = bar.querySelector('.where');
          if (w && !w.textContent) w.textContent = '第' + list[i].n + '章　' + list[i].title;
        }
        if (!nx) {
          host.innerHTML = '<p>ここまでが本編です。年表と地図で、通しの流れをもう一度たどれます。</p>' +
            '<a class="to" href="' + ROOT + 'timeline.html"><span class="n">APPENDIX</span>' +
            '<span class="t">大年表 ─ 世界を横に並べて見る</span></a>';
          return;
        }
        var teaser = host.dataset.teaser || '';
        host.innerHTML =
          (teaser ? '<p>' + teaser + '</p>' : '') +
          '<a class="to" href="' + ROOT + 'chapters/' + nx.slug + '.html">' +
          '<span class="n">NEXT ─ 第' + nx.n + '章</span>' +
          '<span class="t">' + escapeHTML(nx.title) + '</span></a>';
      }).catch(function () {});
  }

  /* ---------- 続きから ---------- */
  var POS_KEY = 'arthistory.pos';
  function rememberPosition() {
    var page = document.body.dataset.chapter;
    if (!page) return;
    var save = function () {
      try {
        var all = JSON.parse(localStorage.getItem(POS_KEY) || '{}');
        all[page] = Math.round(window.scrollY);
        all._last = page;
        localStorage.setItem(POS_KEY, JSON.stringify(all));
      } catch (e) {}
    };
    var t = null;
    document.addEventListener('scroll', function () {
      clearTimeout(t); t = setTimeout(save, 400);
    }, { passive: true });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* 章の書き出しが年号で始まると、飾り文字が数字を割ってしまう。
     「1874年」が「1」と「874年」に見える。
     数字の頭には飾り文字を置かない。 */
  function dropCap() {
    var p = document.querySelector('.prose p.lead');
    if (!p) return;
    var t = (p.textContent || '').replace(/^[\s「『（(]+/, '');
    if (/^[0-9０-９]/.test(t)) p.classList.add('nocap');
  }

  /* 節の番号を、その時代の数え方で書く。
     ギリシア・ローマとルネサンスはローマ数字、日本と中国は漢数字、
     イスラームは東アラビア数字、20世紀以降は飾りのない算用数字。
     内容は変わらない。数字の姿だけが、時代のものになる。 */
  var ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV'];
  var KANJI = ['','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五'];
  var ARABIC = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  var NUMSET = {
    classical: 'roman', renaissance: 'roman', rococo: 'roman',
    japan: 'kanji', china: 'kanji',
    islam: 'arabic',
    modern: 'plain', contemp: 'plain'
  };
  function sectionNumbers() {
    var era = (document.body.className.match(/era-([a-z0-9]+)/) || [])[1];
    var kind = NUMSET[era];
    if (!kind) return;
    document.querySelectorAll('.prose h2 .n').forEach(function (el) {
      var n = parseInt(el.textContent, 10);
      if (!n || n > 15) return;
      if (kind === 'roman')  el.textContent = ROMAN[n];
      else if (kind === 'kanji') el.textContent = KANJI[n];
      else if (kind === 'plain') el.textContent = String(n);
      else if (kind === 'arabic') el.textContent = String(n).split('').map(function (d) { return ARABIC[+d]; }).join('');
    });
  }

  function boot() {
    buildTopbar();
    dropCap();
    sectionNumbers();
    progress();
    wireGlossary();
    chapterNav();
    rememberPosition();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
