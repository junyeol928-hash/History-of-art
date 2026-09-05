#!/usr/bin/env bash
# 検証用にサイトが使うWebフォントの実体を取ってきて、この環境に入れる。
# これをやらないと Chromium が代替フォントに落ち、とくに日本語の縦組みが
# 字送りごと壊れて、見た目の検証が当てにならなくなる。
set -u
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
DEST="${1:-$HOME/.fonts}"
mkdir -p "$DEST"

FAMILIES=(
  "Shippori+Mincho:wght@400;500;600;700;800"
  "Shippori+Mincho+B1:wght@400;500;600;700"
  "Zen+Old+Mincho:wght@400;500;700;900"
  "Zen+Kaku+Gothic+New:wght@300;400;500;700;900"
  "Zen+Antique"
  "Klee+One:wght@400;600"
  "Kaisei+Decol:wght@400;700"
  "Yuji+Syuku"
  "Noto+Serif+JP:wght@400;500;700"
  "Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400"
  "EB+Garamond:wght@400;500;600"
  "Cinzel:wght@400;600;700"
  "UnifrakturMaguntia"
  "Italiana" "Marcellus"
  "Playfair+Display:wght@400;500;700"
  "Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400"
  "Archivo:wght@100..900"
  "Syne:wght@400;700;800"
  "Space+Grotesk:wght@300;400;500;700"
  "Jost:wght@300;400;500;700"
)

n=0
for fam in "${FAMILIES[@]}"; do
  css=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=${fam}&display=swap" 2>/dev/null) || continue
  urls=$(printf '%s' "$css" | grep -oE 'https://fonts\.gstatic\.com/[^)]+\.woff2' | sort -u)
  for u in $urls; do
    out="$DEST/$(printf '%s' "$u" | md5sum | cut -c1-16).woff2"
    [ -s "$out" ] && continue
    if curl -sS -A "$UA" -o "$out" "$u" 2>/dev/null && [ -s "$out" ]; then n=$((n+1)); else rm -f "$out"; fi
  done
  printf '.'
done
echo
echo "取得したフォントファイル: ${n} 件（合計 $(du -sh "$DEST" 2>/dev/null | cut -f1)）"
command -v fc-cache >/dev/null && fc-cache -f "$DEST" >/dev/null 2>&1 && echo "フォントキャッシュを更新しました"
