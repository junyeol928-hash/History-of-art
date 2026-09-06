/* =========================================================================
   作品画像の解決 ─ 三段構え
     1. assets/artworks/<id>.jpg      … GitHub Actions が焼き込んだもの（最速・確実）
     2. Wikimedia / Wikipedia の API  … 閲覧者のブラウザが実行時に取得
     3. 章に書かれた <svg class="fallback"> … 構図を抽象化した自作図
   どの段でも失敗したら、次へ静かに落ちる。壊れた画像アイコンは出さない。
   ========================================================================= */
(function () {
  'use strict';

  /* v1 のキャッシュには、取り違えた画像のURLが入っている恐れがある。
     鍵を変えて、前に配ってしまったURLを一度すべて捨てる。 */
  var CACHE_KEY = 'artcache.v2';
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

  /* ---------- 1点ぶんの解決 ----------
     small を立てると、まず縮小版を取りに行く。
     顔カードもギャラリーの札も、画面上では350px幅ほどしかない。
     そこへ1800px・1.5MBの原寸を10枚並べると、下のほうが延々と出てこない。 */
  /* キャッシュは「外から取ってきたURL」を覚えておくためのもので、
     焼き込み画像より先に立たせてはいけない。先に立たせると、
     こちらが焼き込みを差し替えても、前に見た人の手元では
     古いURLが30日ぶん生き残ってしまう。焼き込みは常に最初に試す。 */
  function resolve(id, small) {
    return resolveFresh(id, small);
  }

  /* 記事名が作者の名前そのものなら、その記事の代表画像は
     この作品ではなく、その作家の代表作か本人の顔写真だ。
     取得スクリプト（tools/fetch-artworks.mjs）と同じ規則をここでも守る。
     取得時だけ塞いで実行時に開いていると、焼き込みが無い作品で
     ブラウザが作者の顔写真を額に入れてしまう。 */
  function isArtistPage(m) {
    return !!(m.wiki && m.artist && m.wiki === m.artist);
  }

  function resolveFresh(id, small) {
    var m = (manifest && manifest[id]) || {};
    var chain = Promise.reject();
    var key = id + (small ? '@s' : '');

    // 段1: 焼き込み済み
    if (!baked || baked.indexOf(id) !== -1 || baked.length === 0) {
      var ext = m.ext || 'jpg';
      if (small) {
        chain = chain.catch(function () { return tryImage(ROOT + 'assets/artworks/thumb/' + id + '.jpg'); });
      }
      chain = chain.catch(function () { return tryImage(ROOT + 'assets/artworks/' + id + '.' + ext); });
    }
    // 段2: 前に外から取れたURLを覚えていれば、それを先に試す
    var cached = cacheGet(key);
    if (cached) {
      chain = chain.catch(function () { return tryImage(cached); });
    }
    // 段3: Commons のファイル名
    if (m.commons) {
      chain = chain.catch(function () {
        return fromCommons(m.commons, m.width || 1600).then(tryImage);
      });
    }
    // 段3の予備: Wikipedia の「作品の」記事
    if (m.wiki && !isArtistPage(m)) {
      var lang = m.wikiLang || 'ja';
      chain = chain.catch(function () { return fromWikipedia(lang, m.wiki).then(tryImage); });
      if (lang !== 'en' && m.wikiEn) {
        chain = chain.catch(function () { return fromWikipedia('en', m.wikiEn).then(tryImage); });
      }
    }
    return chain.then(function (url) { cacheSet(key, url); return url; });
  }

  /* ---------- 図版1つを仕上げる ---------- */
  function mountPlate(fig) {
    var id = fig.dataset.art;
    if (!id) return;
    var mount = fig.querySelector('.mount');
    if (!mount) return;
    mount.classList.add('-loading');
    // 小さく出す札は、小さい画像で足りる
    var small = fig.classList.contains('face') || fig.classList.contains('card');

    resolve(id, small).then(function (url) {
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
  var viewerTicket = 0;
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
    viewerTicket += 1;   // 取得中の拡大画像を無効にする
    if (viewer) { viewer.classList.remove('-on'); document.body.style.overflow = ''; }
  }
  /* 拡大時は、焼き込み済みより大きい画像を取りに行く。
     筆跡やひび割れを見るための一手間。失敗したら表示中の画像のまま */
  function bigger(m, fallback, id) {
    /* 表示に使ったのが縮小版なら、まず焼き込み済みの原寸に戻す。
       そのうえで、あればもっと大きいものを Commons から取る */
    var base = id
      ? tryImage(ROOT + 'assets/artworks/' + id + '.' + ((m && m.ext) || 'jpg')).catch(function () { return fallback; })
      : Promise.resolve(fallback);
    return base.then(function (b) {
      if (!m || !m.commons) return b;
      return fromCommons(m.commons, 3000).then(tryImage).catch(function () { return b; });
    });
  }

  /* 拡大画像の取得は非同期なので、Aを閉じてBを開いたあとにAのぶんが
     返ってくることがある。「開いているか」だけを見ていると、
     そのときBの額にAの絵が入り、説明文だけBのまま残る。
     開くたびに番号を振って、いま開いているものの結果だけを容れる。 */


  function openViewer(fig, url, m) {
    var v = ensureViewer();
    var img = v.querySelector('img');
    var mine = ++viewerTicket;
    img.src = url;
    v.classList.add('-loading');
    bigger(m, url, fig.dataset.art).then(function (big) {
      if (mine !== viewerTicket || !v.classList.contains('-on')) return;
      img.src = big;
      v.classList.remove('-loading');
    });
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
  /* 図版は数が多い。ギャラリーでは400点を超える。
     いちどに全部取りに行くと回線が詰まり、どれも出てこない。
     だから画面に近づいたものから順に解決する。 */
  var ready = null;
  function load() {
    if (ready) return ready;
    ready = Promise.all([
      getJSON(ROOT + 'data/artworks.json').catch(function () { return {}; }),
      getJSON(ROOT + 'data/artworks-baked.json').catch(function () { return []; })
    ]).then(function (r) {
      manifest = r[0] || {};
      baked = Array.isArray(r[1]) ? r[1] : [];
    });
    return ready;
  }

  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          mountSpots(en.target);
          mountPlate(en.target);
        });
      }, { rootMargin: '900px 0px' })
    : null;

  /* あとから差し込まれた図版も拾う。
     ギャラリーは JSON を読んでから中身を作るので、
     最初の走査では一枚も見つからない。 */
  function scan() {
    var plates = Array.prototype.slice.call(
      /* 図版だけでなく「この時代の顔」も写真を出す。
         face を数えていなかったせいで、374枚が全部フォールバックの図のままだった */
      document.querySelectorAll('figure.plate[data-art]:not([data-mounted]), figure.face[data-art]:not([data-mounted])')
    );
    if (!plates.length) return;
    load().then(function () {
      plates.forEach(function (fig) {
        fig.dataset.mounted = '1';
        // 注釈の番号だけが先に浮かんでいると、何の上の番号か分からない。
        // 写真と同時に出す
        if (io) io.observe(fig); else { mountSpots(fig); mountPlate(fig); }
      });
    });
  }

  window.ArtworkPlates = { rescan: scan };
  document.addEventListener('artwork:rescan', scan);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
