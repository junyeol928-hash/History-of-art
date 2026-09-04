/* =========================================================================
   作品画像の解決 ─ 三段構え
     1. assets/artworks/<id>.jpg      … GitHub Actions が焼き込んだもの（最速・確実）
     2. Wikimedia / Wikipedia の API  … 閲覧者のブラウザが実行時に取得
     3. 章に書かれた <svg class="fallback"> … 構図を抽象化した自作図
   どの段でも失敗したら、次へ静かに落ちる。壊れた画像アイコンは出さない。
   ========================================================================= */
(function () {
  'use strict';

  var CACHE_KEY = 'artcache.v1';
  var CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30日
  var manifest = null;
  var baked = null;

  /* ---------- localStorage キャッシュ ---------- */
  function cacheRead() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function cacheGet(id) {
    var c = cacheRead(), e = c[id];
    if (!e || !e.t || (Date.now() - e.t) > CACHE_TTL) return null;
    return e.u || null;
  }
  function cacheSet(id, url) {
    try {
      var c = cacheRead();
      c[id] = { u: url, t: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* 容量超過・プライベートモード等は黙って諦める */ }
  }

  /* ---------- サイトのルートを求める（/chapters/ の下からでも効くように） ---------- */
  var ROOT = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/assets\/js\/artwork\.js.*$/, '');
    return document.body && document.body.dataset.root ? document.body.dataset.root : './';
  })();

  function getJSON(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  /* ---------- 画像が本当に読めるか確かめてから差し込む ---------- */
  function tryImage(url) {
    return new Promise(function (resolve, reject) {
      if (!url) return reject();
      var im = new Image();
      im.decoding = 'async';
      im.referrerPolicy = 'no-referrer';
      im.onload = function () {
        // 1x1 のダミーを掴まされることがあるので弾く
        if (im.naturalWidth < 8 || im.naturalHeight < 8) reject();
        else resolve(url);
      };
      im.onerror = function () { reject(); };
      im.src = url;
    });
  }

  /* ---------- 段2: Wikimedia Commons のファイル名から解決 ---------- */
  function fromCommons(file, width) {
    var api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
            + '&prop=imageinfo&iiprop=url&iiurlwidth=' + (width || 1600)
            + '&titles=' + encodeURIComponent('File:' + file);
    return getJSON(api).then(function (d) {
      var pages = d && d.query && d.query.pages;
      for (var k in pages) {
        var ii = pages[k].imageinfo;
        if (ii && ii[0]) return ii[0].thumburl || ii[0].url;
      }
      throw new Error('no imageinfo');
    });
  }

  /* ---------- 段2の予備: Wikipedia の記事タイトルから解決 ---------- */
  function fromWikipedia(lang, title) {
    var api = 'https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/'
            + encodeURIComponent(title.replace(/ /g, '_'));
    return getJSON(api).then(function (d) {
      var u = (d.originalimage && d.originalimage.source) ||
              (d.thumbnail && d.thumbnail.source);
      if (!u) throw new Error('no image');
      // サムネイル URL の幅指定を大きくする
      return u.replace(/\/(\d+)px-/, '/1600px-');
    });
  }

  /* ---------- 1点ぶんの解決 ---------- */
  function resolve(id) {
    var cached = cacheGet(id);
    if (cached) return tryImage(cached).catch(function () { return resolveFresh(id); });
    return resolveFresh(id);
  }

  function resolveFresh(id) {
    var m = (manifest && manifest[id]) || {};
    var chain = Promise.reject();

    // 段1: 焼き込み済み
    if (!baked || baked.indexOf(id) !== -1 || baked.length === 0) {
      var ext = m.ext || 'jpg';
      chain = chain.catch(function () { return tryImage(ROOT + 'assets/artworks/' + id + '.' + ext); });
    }
    // 段2: Commons のファイル名
    if (m.commons) {
      chain = chain.catch(function () {
        return fromCommons(m.commons, m.width || 1600).then(tryImage);
      });
    }
    // 段2の予備: Wikipedia 記事
    if (m.wiki) {
      var lang = m.wikiLang || 'ja';
      chain = chain.catch(function () { return fromWikipedia(lang, m.wiki).then(tryImage); });
      if (lang !== 'en' && m.wikiEn) {
        chain = chain.catch(function () { return fromWikipedia('en', m.wikiEn).then(tryImage); });
      }
    }
    return chain.then(function (url) { cacheSet(id, url); return url; });
  }

  /* ---------- 図版1つを仕上げる ---------- */
  function mountPlate(fig) {
    var id = fig.dataset.art;
    if (!id) return;
    var mount = fig.querySelector('.mount');
    if (!mount) return;
    mount.classList.add('-loading');

    resolve(id).then(function (url) {
      var m = (manifest && manifest[id]) || {};
      var img = new Image();
      img.src = url;
      img.alt = fig.dataset.alt || (m.title || '') + (m.artist ? ' ／ ' + m.artist : '');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      var svg = mount.querySelector('svg.fallback');
      if (svg) svg.remove();
      mount.insertBefore(img, mount.firstChild);
      mount.classList.remove('-loading');
      fig.classList.add('-real');
      addCredit(fig, m, url);
      img.addEventListener('click', function () { openViewer(fig, url, m); });
    }).catch(function () {
      // 三段目：章に書かれた自作SVGをそのまま見せる
      mount.classList.remove('-loading');
      fig.classList.add('-drawn');
      var cap = fig.querySelector('figcaption');
      if (cap && !cap.querySelector('.credit')) {
        var s = document.createElement('span');
        s.className = 'credit';
        s.textContent = '※ 作品写真を取得できなかったため、構図を図にしたものを表示しています';
        cap.appendChild(s);
      }
    });
  }

  function addCredit(fig, m, url) {
    var cap = fig.querySelector('figcaption');
    if (!cap || cap.querySelector('.credit')) return;
    var s = document.createElement('span');
    s.className = 'credit';
    var src = m.source || 'Wikimedia Commons';
    var lic = m.license || 'パブリックドメイン';
    s.textContent = src + '／' + lic;
    cap.appendChild(s);
  }

  /* =========================================================================
     拡大ビューア
     ========================================================================= */
  var viewer = null;
  function ensureViewer() {
    if (viewer) return viewer;
    viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.innerHTML =
      '<button class="close" type="button" aria-label="閉じる">✕</button>' +
      '<img alt="">' +
      '<div class="vcap"></div>';
    document.body.appendChild(viewer);
    viewer.addEventListener('click', function (e) {
      if (e.target === viewer || e.target.classList.contains('close')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    return viewer;
  }
  function close() {
    if (viewer) { viewer.classList.remove('-on'); document.body.style.overflow = ''; }
  }
  function openViewer(fig, url, m) {
    var v = ensureViewer();
    v.querySelector('img').src = url;
    var t = (m.artist ? m.artist + '　' : '') + (m.title || '') + (m.year ? '　' + m.year : '');
    var c = m.collection ? '<br>' + m.collection : '';
    v.querySelector('.vcap').innerHTML = t + c;
    v.classList.add('-on');
    document.body.style.overflow = 'hidden';
  }

  /* =========================================================================
     注釈ホットスポット
     章側: <figure class="plate" data-art="…" data-spots='[{"x":32,"y":58,"t":"見出し","d":"説明"}]'>
     ========================================================================= */
  function mountSpots(fig) {
    var raw = fig.dataset.spots;
    if (!raw) return;
    var spots;
    try { spots = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(spots) || !spots.length) return;

    var mount = fig.querySelector('.mount');
    if (!mount) return;
    mount.classList.add('spotwrap');

    var notes = document.createElement('div');
    notes.className = 'hotnotes';
    fig.appendChild(notes);

    spots.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hotspot';
      b.style.left = s.x + '%';
      b.style.top = s.y + '%';
      b.textContent = String(i + 1);
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-label', s.t || ('注釈' + (i + 1)));

      var note = document.createElement('div');
      note.className = 'hotnote';
      note.hidden = true;
      note.innerHTML = '<b>' + (i + 1) + '　' + esc(s.t || '') + '</b>' + esc(s.d || '');
      notes.appendChild(note);

      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-expanded') === 'true';
        notes.querySelectorAll('.hotnote').forEach(function (n) { n.hidden = true; });
        mount.querySelectorAll('.hotspot').forEach(function (o) { o.setAttribute('aria-expanded', 'false'); });
        if (!on) { note.hidden = false; b.setAttribute('aria-expanded', 'true'); }
      });
      mount.appendChild(b);
    });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* ---------- 起動 ---------- */
  function boot() {
    var plates = Array.prototype.slice.call(document.querySelectorAll('figure.plate[data-art]'));
    if (!plates.length) return;

    Promise.all([
      getJSON(ROOT + 'data/artworks.json').catch(function () { return {}; }),
      getJSON(ROOT + 'data/artworks-baked.json').catch(function () { return []; })
    ]).then(function (r) {
      manifest = r[0] || {};
      baked = Array.isArray(r[1]) ? r[1] : [];
      plates.forEach(function (fig) { mountPlate(fig); mountSpots(fig); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
