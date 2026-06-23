# MOOCs Ultimate

MOOCs Ultimateは、INIAD MOOCsを自分用に使いやすくするManifest V3ブラウザ拡張機能です。Chromium系ブラウザを優先して実装しています。

この拡張機能は個人利用向けの非公式ツールです。東洋大学、INIAD、INIAD MOOCs、ToyoNet-ACEが公認、公開、配布しているものではありません。

現在は招待した利用者向けのαテスト段階です。課題の提出状態や期限表示は補助情報であり、最終確認は必ずMOOCs本体で行ってください。テスト時の注意は [docs/ALPHA_TESTING.md](docs/ALPHA_TESTING.md) を参照してください。

## Features

- Appearance: グラスモーフィズム、背景画像URL、背景色、透明度、ヘッダー/サイドバー追従、上へ戻るボタン
- Input Helper: textarea文字数カウンター、自動リサイズ、提出後リロード
- Navigation: 上部番号タブ色分け、前後移動ショートカット
- Downloads: ページ/講義回/科目単位の資料候補収集、直接ファイル保存、Google Slides PDF/PNG保存
- Assignments: 課題検出、提出状態記録、講義回別一覧、手動補正、期限候補と期限通知
- Memo: ページごとの複数メモ、メモ検索、TXT/JSONエクスポート/インポート
- Course: コース並び替え、お気に入り、非表示
- INIAD Plus: ACE時間割JSON/CSV保存、直近講義パネル、外部リンク一覧、Driveボタン、スライド表示調整
- AI Summary: INIAD AI MOP向けのAPI設定、推定token上限、要約キャッシュの土台
- Debug: デベロッパーモード、内部ステータス表示、デバッグログ、セルフ診断

すべての主要機能は設定ページからON/OFFできます。設定をすべてOFFにすると、MOOCs側の追加UIはほぼ消える設計です。

## Install

```bash
pnpm install --frozen-lockfile
pnpm run release:check
```

`pnpm`をグローバルに導入していない環境では、`npx pnpm@10.30.2`へ読み替えられます。

Chrome / Chromiumで読み込む手順:

1. `pnpm run build:chromium` を実行する
2. Chromeで `chrome://extensions` を開く
3. `デベロッパーモード` をONにする
4. `パッケージ化されていない拡張機能を読み込む` を押す
5. `dist/chromium/` を選ぶ

## Update

```bash
git pull
pnpm install
pnpm run build:chromium
```

その後、`chrome://extensions` のMOOCs Ultimateカードで再読み込みボタンを押してください。

## Usage

設定ページは拡張機能詳細の `拡張機能のオプション` から開けます。

- `保存`: `ultimateMoocs.settings` に設定を保存
- `初期化`: 設定をデフォルトへ戻す
- `設定をエクスポート`: 設定JSONを書き出す
- `設定をインポート`: 設定JSONを読み込む。壊れたJSONや型違いは保存せずエラー表示します

`上級・デバッグ` でデベロッパーモードをONにして保存すると、上部に `診断` タブが表示されます。background、storage、downloads、tabs、content script、ダウンロードキューの状態を確認できます。診断JSONにはAPIキー、閲覧URL、課題本文、ファイル名を含めません。デベロッパーモードがOFFの場合、診断タブは非表示になり、background側も診断要求を拒否します。

資料保存パネルはMOOCsページ上部に表示されます。Google Slides保存は保存用タブを開き、Slides helperで各スライドをSVGから画像化してPDFまたはPNG連番として保存します。保存中にSlidesタブを前面化した場合は、ユーザー操作を邪魔しないため中断します。

ACE時間割機能は `INIAD Plus > ACE timetable download` がONのときだけACEページに表示されます。時間割データは `ultimateMoocs.aceTimetable` に保存され、JSON/CSVで書き出せます。

AI要約は `AI要約` カテゴリで有効にし、INIAD AI MOPのAPIキーを保存して使います。講義ツールの `AI要約` から `抽出して要約` を押すと、今回使用する推定token数を確認してから送信できます。スライド本文だけを確認・保存したい場合は、資料保存画面の `スライド本文抽出` を使用します。現在は画像をAPIへ送信せず、抽出したテキストだけを送ります。要約結果は復習ノート形式で表示され、コピー、TXT保存、ページメモへの追加ができます。

APIキーの初期値は空です。各利用者が自分の設定ページで入力してください。設定JSONの書き出し時にはAPIキーが自動的に除外されます。APIキーをソースコード、Issue、診断JSON、スクリーンショットへ含めないでください。

## Permissions

- `storage`: 設定、メモ、コース順、ACE時間割、ダウンロード状態をローカル保存するため
- `downloads`: 直接資料、メモ、Slides PDF/PNGを保存するため
- `tabs`: Google Slides保存用タブを開閉し、進捗処理するため
- `activeTab`: ショートカット実行時に現在のMOOCsタブを取得するため
- `clipboardWrite`: スクリーンショットや抽出テキストをクリップボードへコピーするため
- `scripting`: 拡張機能更新後に開いたままのMOOCsタブへcontent scriptとCSSを再適用するため
- `https://api.openai.iniad.org/*`: AI要約ON時にINIAD AI MOP OpenAI互換APIへ要約リクエストを送るため
- `https://moocs.iniad.org/*`: MOOCsページでUIを表示するため
- `https://www.ace.toyo.ac.jp/ct/home*`: ACE時間割保存UIを表示するため
- `https://docs.google.com/presentation/*`: Slides helperを動かすため

`debugger` と `<all_urls>` は使用していません。

## Before Push

GitHubへpushする前に次を実行してください。

```bash
pnpm run release:check
git status --short
```

`release:check`は、APIキーや秘密鍵らしき値、個人環境の絶対パス、空でないデフォルトAPIキーを検査した後、静的チェックとChromiumビルドを実行します。`dist/`、`node_modules/`、`.env*`、秘密鍵ファイルはGit管理対象外です。

## Manual Test

1. Chromeで `dist/chromium/` を読み込める
2. MOOCsトップページを開いてコンソールエラーでクラッシュしない
3. 講義ページで `MOOCs Ultimate Downloads` パネルが出る
4. textareaに文字数が出て入力に追従する
5. 上部番号タブの色分けが動く
6. メモを追加、編集、削除、再読み込み後に復元できる
7. OptionsのMemo Listで検索し、該当ページを開ける
8. コース並び替え、 favorite、hide が保存される
9. 直接ファイル保存が `moocs-ultimate/...` 配下に保存される
10. Google Slides PDF保存が1ファイルで保存される
11. Google Slides PNG保存が `_p001.png` 形式の連番で保存される
12. ACEページで時間割JSON/CSV保存ボタンが出る
13. 設定をすべてOFFにするとMOOCs表示がほぼ元に戻る
14. 設定を初期化しても壊れない
15. 壊れた設定JSONをインポートしてもクラッシュしない
16. AI要約をONにすると講義ページに `スライド要約` パネルが表示される
17. APIキー未設定時に要約すると、パネル内に設定案内エラーが出る

## Troubleshooting

詳しくは [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) を参照してください。

## Privacy

詳しくは [docs/PRIVACY.md](docs/PRIVACY.md) を参照してください。設定やメモ、ACE時間割はローカルの `chrome.storage.local` に保存します。外部サーバーへの独自送信は行いません。

## Copyright Notice

講義資料やスライドは、著作権法、授業ルール、大学の規程に従い、私的利用の範囲で扱ってください。ダウンロードした資料の再配布や公開は行わないでください。

## Credits

設計と機能検討では以下の公開リポジトリを参考にしました。コードを丸ごと貼り合わせるのではなく、MOOCs Ultimate向けに機能単位で再設計しています。

- GlassMOOCs: https://github.com/kuraryu405/glassmoocs
- iniad_plus: https://github.com/Kensuke-sam/iniad_plus
- INIAD++: https://github.com/akahoshi1421/INIAD-
- moocs-collect: https://github.com/yu7400ki/moocs-collect

## License

招待したαテスターには個人評価目的の利用のみを許可しています。第三者へ公開・再配布する場合は、[LICENSE.md](LICENSE.md)と参考元リポジトリ、利用ライブラリのライセンスを再確認してください。
