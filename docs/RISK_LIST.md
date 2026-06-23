# MOOCs Ultimate Risk List

この文書は、`MOOCs Ultimate` の統合・再設計時に注意するリスク一覧です。

## 技術リスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| R-001 | background service workerが複数由来の処理で肥大化する | MV3の停止/再起動時に状態が壊れる | router、handler、queue stateを分け、永続状態はstorageへ保存する |
| R-002 | Google Slides viewerのDOM変更でSVG取得が壊れる | PDF/PNG保存が失敗する | Slides helperを小さく保ち、失敗理由をdownload panelに出す |
| R-003 | downloads処理をcontent scriptから直接呼ぶ | 権限と失敗処理が散らばる | downloads APIはbackgroundに集約する |
| R-004 | DOM構造変更でボタン挿入や抽出が壊れる | MOOCs更新時に主要機能が動かない | セレクタを `dom/moocs-selectors.ts` に集約し、ページ種別検出をテストする |
| R-005 | jQuery UI依存をそのまま持ち込む | bundle肥大化、CSS衝突、Firefox差分 | drag/resize/sortableは小さく再実装するかadapter化する |
| R-006 | content moduleの二重起動 | ボタンやメモ窓が重複する | module idごとに `data-um-mounted` を管理する |
| R-007 | MutationObserverが多すぎる | ページ表示が重くなる | runtimeでobserverを共有し、モジュールへイベント配信する |
| R-008 | PDF/PNG保存中にタブが閉じられる | キューが詰まる、進捗状態が残る | キャンセル・timeout・tab close handlingをbackgroundに置く |
| R-009 | `chrome.storage` 容量超過 | メモやdebug logが保存できない | メモ本文、debug logに上限と古いデータ削除を設ける |
| R-010 | Firefox MV3の差分 | Chromiumで動くAPIがFirefoxで失敗する | browser adapterでサポート判定し、未対応機能をUIで無効にする |

## 統合衝突リスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| C-001 | CSS class / id の衝突 | MOOCs本体や他機能の見た目が崩れる | 新規UIは `um-` classのみ使う |
| C-002 | storage keyの衝突 | 旧拡張や別機能の設定を上書きする | `ultimateMoocs:` prefixとschema versionを必須にする |
| C-003 | message typeの衝突 | 別handlerが誤反応する | `ultimateMoocs:<domain>.<action>` に統一する |
| C-004 | Google Slides保存方式の衝突 | 2つの保存処理が同じタブを操作する | background queueで同時実行数を制御する |
| C-005 | 見た目カスタム同士の衝突 | 背景画像、背景色、テーマCSSが上書きし合う | appearance設定で優先順位を決め、CSS variablesへ集約する |
| C-006 | メモとスライド操作のfloating UI衝突 | 画面上で重なる、クリックしづらい | z-index scaleと配置ルールを定義する |
| C-007 | コース並び替えとMOOCs本体更新の衝突 | コース一覧が欠落する | HTML保存ではなくID/URL順序保存にする |

## 権限・セキュリティリスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| S-001 | Google Slides helperがログイン済みページを読む | 意図しないページに見える | host permissionを`docs.google.com/presentation/*`に限定し、保存用タブは処理後閉じる |
| S-002 | `optional_host_permissions` が広すぎる | 不要なサイトへのアクセス権に見える | 初期はMOOCs/ACE/Google Slidesに限定する |
| S-003 | 外部リンクやDrive検索URL生成で不正な文字列を扱う | 意図しないURLを開く | URLSearchParamsで生成し、innerHTMLを避ける |
| S-004 | メモ本文をHTMLとして挿入する | XSS風の自己注入が起きる | textContent/valueのみ使う |
| S-005 | debug logに個人情報や講義URLが残る | ローカルでも扱いに困る | debug logは初期off、上限、削除ボタンを用意する |
| S-006 | 資料保存の利用範囲誤解 | 著作権・授業ルール違反につながる | READMEと保存UIに個人利用・私的利用範囲の注意を書く |

## UXリスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| U-001 | 機能が多すぎて設定が分かりにくい | 個人利用でも管理しづらい | 設定ページをカテゴリ別に分け、初期値は控えめにする |
| U-002 | 保存処理の待ち時間が長い | 操作ミスや中断が増える | 進捗、現在処理中の資料名、キャンセルを表示する |
| U-003 | floating UIが学習画面の邪魔になる | MOOCsの操作性が落ちる | 折りたたみ、位置保存、機能別on/offを用意する |
| U-004 | ショートカットが入力欄と衝突する | 課題入力中にページ移動する | textarea/input/contenteditableではショートカットを無効化する |
| U-005 | Firefoxで一部機能が使えない理由が分からない | 不具合に見える | 設定ページと保存パネルに対応状況を表示する |

## ライセンス・クレジットリスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| L-001 | 参考元のクレジット不足 | 礼儀・ライセンス上の問題になる | READMEにGlassMOOCs、iniad_plus、INIAD++を明記する |
| L-002 | ライブラリ由来コードの扱い漏れ | MIT等の表記漏れが起きる | 外部ライブラリを導入する場合は `NOTICE` または README に追記する |
| L-003 | 既存コードをそのままコピーして境界が曖昧になる | 保守性とライセンス確認が難しくなる | 参考実装として読み、機能仕様から新規実装する |
| L-004 | 公式ツールと誤認される | 利用者や第三者に誤解を与える | READMEに非公式・個人利用であることを明記する |

## 受け入れ基準

- `um-` / `ultimateMoocs:` 以外の新規名前空間を使っていない。
- background service workerが1つだけである。
- content scriptが機能別に分割され、mountの重複防止がある。
- Chromium専用APIはadapterに閉じ込められている。
- 資料保存は進捗、失敗、キャンセル、権限不足の表示を持つ。
- READMEに参考元クレジット、非公式注意、個人利用方針がある。
