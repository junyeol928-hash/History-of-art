## 検証
- 章の結合と検査: `node tools/merge.mjs` → `node tools/check-chapters.mjs`(CI と同じ)
  - merge は `data/bundle.js` などを書き換える。確認だけで流したときは、その差分を戻す
- 表示の確認: `node tools/serve.mjs` で開き、変更したページをスマホ幅(375px)とデスクトップ幅でスクショして崩れがないか見る
- 終了前に上を実行し、失敗していたら直してから報告する
