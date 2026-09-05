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
  function showTip(el, term, def) {
    var t = ensureTip();
    t.innerHTML = '<b>' + escapeHTML(term) + '</b>' + escapeHTML(def);
    t.hidden = false;
    var r = el.getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    t.style.left = (left + window.scrollX) + 'px';
    t.style.top = (top + window.scrollY) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function wireGlossary() {
    var terms = document.querySelectorAll('.term[data-term]');
    if (!terms.length) return;
    fetch(ROOT + 'data/glossary.json', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (g) {
        glossary = g || {};
        terms.forEach(function (el) {
          var key = el.dataset.term;
          var entry = glossary[key];
          var def = entry ? (entry.short || entry.def || '') : (el.dataset.def || '');
          if (!def) return;
          var show = function () { showTip(el, key, def); };
          el.addEventListener('mouseenter', show);
          el.addEventListener('focus', show);
          el.addEventListener('mouseleave', hideTip);
          el.addEventListener('blur', hideTip);
          el.addEventListener('click', function (e) {
            e.preventDefault();
            if (tip && !tip.hidden) hideTip(); else show();
          });
          el.tabIndex = 0;
        });
        document.addEventListener('scroll', hideTip, { passive: true });
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

  function boot() {
    buildTopbar();
    progress();
    wireGlossary();
    chapterNav();
    rememberPosition();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
