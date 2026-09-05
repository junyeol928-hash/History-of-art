# 時代スキンの試作 ─ 共通ブリーフ

## 何を試すのか

美術史サイトの章が、**その時代の美意識をまとって現れる**ようにしたい。
ただし全面的に着替えさせると、38章ぶんバラバラになり、主役である作品画像と喧嘩する。

そこで **「壁は変えない。額と照明だけを変える」** という方針を採る。
あなたはその方針が成立するかを、極端な時代のひとつで実証する。

---

## 変えてよいもの（＝スキン）

1. **見出し・章タイトルの書体**（本文書体は変えない）
2. **罫線と区切り飾りの形**（直線／二重線／唐草／幾何学／截金風 など）
3. **章扉の地の処理**（金地、砂子、方眼、余白のとり方、特大年号の扱い）
4. **時代色**（すでに定義済み。下記の値を使うこと）
5. **図版の額（マット）の質感**（枠線の太さ・二重罫・角の処理）
6. ごく控えめな地紋・テクスチャ（本文の可読性を落とさない範囲で）

## 絶対に変えてはいけないもの（＝壁）

- **本文の組み**：字送り・行間・段落の間隔・本文の色。どの章でも同じ静けさを保つ
- **本文の書体**（明朝系）と**本文のサイズ（17px以上）**
- **図版の置き方**：作品画像がいちばん大きく、いちばん強いこと
- **美術館の壁のようなキャプションの構造**：作者／作品名＋制作年／技法・寸法・所蔵／「ここを見る」
- 地の明度（昼は生成りの白、夜は墨色）。時代の色で地を塗りつぶさない
- **作品画像の上に装飾を重ねない**

装飾は**余白・章扉・見出し・罫線**に置く。本文と図版には触らない。これが守れているかが評価点です。

---

## 作るもの

担当する章の**実物のHTML**を読み、その**章扉から本文2節ぶん＋図版1点＋年表ストリップ**までを、
その時代のスキンをまとった姿として1枚のアートボードに組む。

- 出力先とファイル名は個別指示のとおり
- 幅 **1000px 固定**、高さは内容なり（1600〜2200px目安）
- 本文・キャプションの文章は**実物の章から一字も変えずに引く**（勝手に書かない）
- 図版は外部から読み込めないので、**構図と色調を抽象化した自作SVG**で描く。グレーの箱は禁止

## 形式（Design Component `.dc.html`）

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap">
  <style> body { margin: 0; } a { color: #...; } a:hover { color: #...; } </style>
</helmet>
<div style="width: 1000px; background: #...; ..."> … </div>
</x-dc>
</body>
</html>
```
- `<script src="./support.js"></script>` の行は**一字一句そのまま**
- `<script data-dc-script>` は**書かない**（静的なので不要。空だとエラーになる）
- スタイルは**インライン `style="..."`** を基本にする（Webフォントと `a` の色だけ helmet に）
- 並ぶ要素は `display:flex` / `grid` ＋ `gap` で組む。空白文字やマージンで並べない
- アイコンはインラインSVG。**絵文字は禁止**
- `{{ }}` は使わない

## フォント

Google Fonts のみ。日本語で使えるもの：
Shippori Mincho / Shippori Mincho B1 / Zen Old Mincho / Zen Kaku Gothic New / Zen Antique /
Klee One / Kaisei Decol / Yuji Syuku / Noto Serif JP / Noto Sans JP / M PLUS 1
欧文：Cormorant Garamond / EB Garamond / Playfair Display / Bodoni Moda / Spectral /
Libre Baskerville / Instrument Serif / DM Serif Display / Archivo / Syne / Space Grotesk / Jost /
Cinzel / UnifrakturMaguntia / Italiana / Marcellus
- **Inter・Roboto・Arial・Fraunces は禁止。** 必ず fallback スタック付き
- 本文は明朝系で固定。スキンで変えるのは**見出しと数字**だけ

## 時代色（サイトで実装済みの値。これを使う）

| クラス | 顔料 | accent | accent-ink | accent-soft | accent-line |
|---|---|---|---|---|---|
| era-medieval | ラピスラズリ | #2f4a9b | #273e82 | #e2e5f2 | #a3aed5 |
| era-rococo | ローズマダー | #b8567f | #9b4869 | #f6e5ec | #dfa8c0 |
| era-modern | カドミウムレッド | #c8352a | #a72c23 | #f7e2e0 | #e0a29c |
| era-japan | 弁柄 | #8c2f39 | #74262f | #f2e2e4 | #cc9ba1 |

昼の地：`--bg:#f4f1e8`（生成り）／`--bg-raise:#faf8f2`／`--ink:#23201b`／`--ink-2:#56504a`／
`--ink-3:#8b8378`／`--rule:#cfc7b6`／`--rule-soft:#e0dacb`／額縁 `--frame:#c9c0ad`／マット `--mat:#ffffff`

**昼のスキンだけ作ればよい。** 夜（墨色）は私が別途あてます。

## 最後に

報告は3〜4文で。**「変えたもの」と「変えなかったもの」を明示**してください。
あなたの案の中で、38章ぶん展開したときに破綻しそうな箇所があれば、それも正直に書いてください。
