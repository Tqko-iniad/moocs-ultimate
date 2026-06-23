# MOOCs Ultimate Migration Plan

この計画は、GlassMOOCs、iniad_plus、INIAD++の機能を `MOOCs Ultimate` として再設計しながら取り込むための段取りです。コードをそのまま貼り合わせるのではなく、機能、データ、権限、UIの境界を先に決めてから移植する。

## Phase 0: 調査とルール固定

成果物:

- `FEATURE_MATRIX.md` で機能差分を固定する。
- `ARCHITECTURE_PLAN.md` でMV3、background統合、content module分割を固定する。
- `RISK_LIST.md` で衝突リスクを管理する。

完了条件:

- 採用する機能カテゴリが明確である。
- `um-` / `ultimateMoocs:` 名前空間ルールが全機能に適用される。
- READMEに参考元クレジットを書く方針が決まっている。

## Phase 1: 拡張機能の土台

対象:

- Manifest V3 skeleton
- build script
- background service worker単一化
- message router
- browser adapter
- storage schema
- logger
- options page skeleton

移行方針:

- GlassMOOCsのVite/options/build分離の考え方を参考にする。
- iniad_plusのservice workerはPDF/PNG保存のhandler設計の参考にし、入口は `background/service-worker.ts` に統合する。
- message typeは `ultimateMoocs:*` のみ許可する。

完了条件:

- Chromiumで拡張機能が読み込める。
- options pageが開ける。
- `ultimateMoocs:settings` の読み書きができる。
- debug logをon/offできる。

## Phase 2: 低リスクcontent modules

対象:

- 見た目カスタム
- 入力支援
- ページナビゲーション
- 外部リンク一覧
- Driveボタン
- スライド表示調整

移行方針:

- GlassMOOCsの背景画像、タブ色分け、ショートカットを `appearance` と `navigation` に分解する。
- INIAD++の背景色、固定ヘッダ/サイドバー、上へ戻る、外部リンク、Drive、スライド操作を個別モジュール化する。
- jQuery UI依存のdrag/resizeは、最初は素のCSS/Pointer Eventsで再実装を検討する。

完了条件:

- 各モジュールが `mount()` で起動し、二重挿入されない。
- 追加DOMは `um-` class と `data-um-*` のみを使う。
- 設定ページで機能ごとにon/offできる。

## Phase 3: storageを使う生活支援機能

対象:

- メモ
- コース並び替え
- ACE時間割ダウンロード

移行方針:

- INIAD++のlocalStorage中心の実装を、`chrome.storage.local` 中心に移す。
- メモはURL単位の複数メモとして再設計し、index keyを持たせる。
- コース並び替えはDOM HTML丸ごと保存ではなく、コースIDまたはリンクURLの順序を保存する。
- ACE時間割はACEページ専用content scriptに分け、MOOCs側表示とはmessage/storageで接続する。

完了条件:

- メモ作成、編集、削除、txt保存、一覧表示が動く。
- コース並び替えがリロード後に復元される。
- ACE時間割データが名前空間化されたkeyに保存される。

## Phase 4: 資料保存

対象:

- MOOCsページの資料抽出
- 通常資料ダウンロード
- Google Slides PDF/PNG保存
- 進捗UI

移行方針:

- GlassMOOCsのdownload panel / queueの考え方を参考にする。
- GlassMOOCsのSlides SVG取得・画像化・PDF builderの流れを主経路として参考にする。
- content scriptはURL抽出とUIだけを担当し、保存処理はbackgroundに集約する。
- Google Slides保存は adapter で `svg-rasterize` と `manual` を切り替える。

完了条件:

- 単一資料、講義内一括、科目内収集の粒度が定義される。
- PDFは1ファイル、PNGは連番ファイルで保存できる。
- 進捗、失敗、キャンセル、権限不足がUIに表示される。
- 保存中にタブを閉じた場合の復旧/失敗処理がある。

## Phase 5: Firefox準備

対象:

- Firefox manifest生成
- `browser.*` adapter
- Google Slides保存のbrowser API差分
- SVG rasterize経路のFirefox互換性確認

移行方針:

- GlassMOOCsのFirefoxビルド分離を参考にする。
- Chromium専用機能には `supported` 判定を置き、FirefoxでUIが壊れないようにする。
- 最初のFirefox対応では、資料保存のうち通常ファイル保存と手動Slides保存を優先する。

完了条件:

- Firefox一時アドオンとして読み込める。
- 対応済み機能と未対応機能が設定ページで明確に表示される。
- Chromium専用API呼び出しで例外が出ない。

## Phase 6: ドキュメントとクレジット

対象:

- README
- 参考元クレジット
- 非公式ツール注意書き
- 個人利用向けインストール手順

方針:

- 参考元として以下を明記する。
  - GlassMOOCs: `https://github.com/kuraryu405/glassmoocs`
  - iniad_plus: `https://github.com/Kensuke-sam/iniad_plus`
  - INIAD++: `https://github.com/akahoshi1421/INIAD-`
- 「そのまま複製したものではなく、個人利用のために機能単位で再設計したもの」と書く。
- INIAD公式ではないこと、資料保存は著作権法と授業ルールの範囲内で使うことを書く。

## 移行チェックリスト

- [ ] `glassmoocs-*` classを新規コードに持ち込んでいない。
- [ ] `iniadpp-*` classを新規コードに持ち込んでいない。
- [ ] `mymemo-*` classを新規コードに持ち込んでいない。
- [ ] storage keyがすべて `ultimateMoocs:` で始まる。
- [ ] message typeがすべて `ultimateMoocs:` で始まる。
- [ ] background service workerが1つだけである。
- [ ] content scriptが機能別moduleに分割されている。
- [ ] Chromium専用処理がadapter内に閉じている。
- [ ] Firefoxで未対応の機能が明示的に無効化される。
- [ ] READMEに参考元クレジットがある。
