# MOOCs Ultimate

![MOOCs Ultimate icon](src/assets/icons/icon128.png)

INIAD MOOCsを個人用に使いやすくする、Chromium向けManifest V3ブラウザ拡張機能です。

> [!WARNING]
> 現在は招待した利用者向けの **Private α版（0.1.0-alpha.1）** です。東洋大学、INIAD、INIAD MOOCs、ToyoNet-ACEの公式ツールではありません。

## αテスターの方へ

課題の提出状態、提出期限、未公開判定は学習を補助するための表示です。**提出の成否と締切は必ずMOOCs本体でも確認してください。** MOOCs Ultimateが課題を代理提出することはありません。

テストを始める前に、GitHubのPrivateリポジトリへ招待されていることを確認してください。

### 必要なもの

- Google ChromeまたはChromium系ブラウザ
- `Tqko-iniad/moocs-ultimate`へのアクセス権

### インストール

通常のαテストでは、Node.jsやpnpmは必要ありません。

1. [Releases](https://github.com/Tqko-iniad/moocs-ultimate/releases) を開く
2. 最新のα版から `moocs-ultimate-*-chromium.zip` をダウンロードする
3. ZIPを展開する
4. Chromeで `chrome://extensions` を開く
5. 右上の `デベロッパーモード` をONにする
6. `パッケージ化されていない拡張機能を読み込む` を押す
7. 展開した `chromium/` フォルダを選ぶ
8. ChromeツールバーにMOOCs Ultimateのアイコンが出ることを確認する
9. すでにMOOCsを開いている場合は、そのタブを再読み込みする

ソースからビルドしてテストする場合だけ、GitとNode.js 22を用意して次を実行します。

```bash
git clone https://github.com/Tqko-iniad/moocs-ultimate.git
cd moocs-ultimate
npx pnpm@10.30.2 install --frozen-lockfile
npx pnpm@10.30.2 run release:check
```

ビルド後は、このリポジトリの `dist/chromium/` をChromeへ読み込みます。

### 更新

更新前に、必要に応じて設定ページの `バックアップ` からメモや課題状態を書き出してください。通常は最新ReleaseのZIPを展開し、Chromeで読み込んでいるフォルダを新しい `chromium/` に置き換えます。

ソースからビルドしている場合は次を実行します。

```bash
git pull
npx pnpm@10.30.2 install --frozen-lockfile
npx pnpm@10.30.2 run release:check
```

その後、`chrome://extensions` のMOOCs Ultimateカードで再読み込みボタンを押し、開いているMOOCsタブも再読み込みしてください。

### 最初の設定

1. ChromeツールバーのMOOCs Ultimateアイコンを押す
2. `設定を開く` を押す
3. 使いたい機能だけをONにする
4. `保存` を押す
5. MOOCsを再読み込みする

すべての主要機能は個別にON/OFFできます。`ダークグラスUI`をOFFにすると、MOOCs本来の明るい外観へ戻ります。

AI要約は任意機能です。利用する場合だけ、自分のINIAD AI MOP APIキーを設定してください。APIキーはリポジトリ、Issue、診断JSON、スクリーンショットへ貼らないでください。設定JSONを書き出す際はAPIキーが自動的に除外されます。

## 主に確認してほしいこと

- MOOCsトップ、科目、講義、課題ページがクラッシュしない
- 背景・グラスUIのON/OFFが即時反映される
- textarea文字数、自動リサイズ、ページ色分けが正しく動く
- 講義ツールが現在の講義回に対応した情報だけを表示する
- 課題と出席確認を取り違えない
- 提出完了後に提出状態が保存され、再読み込み後も維持される
- 未公開課題と公開中課題を取り違えない
- 手動で設定した提出期限と期限候補が保存される
- Google SlidesをPDFとして保存できる
- スライド本文抽出とAI要約が動く
- 設定をすべてOFFにすると、追加UIがほぼ消える
- 壊れた設定JSONを読み込んでもクラッシュしない

詳しいテスト上の注意は [Alpha Testing](docs/ALPHA_TESTING.md) を参照してください。

## 不具合報告

[GitHub Issues](https://github.com/Tqko-iniad/moocs-ultimate/issues) に次の情報を記載してください。

- 再現手順
- 期待した動作
- 実際の動作
- ChromeとMOOCs Ultimateのバージョン
- 対象ページの種類（トップ、講義、課題、ACE、Slidesなど）

スクリーンショットには、APIキー、氏名、学籍番号、回答内容、提出ファイル名を含めないでください。診断JSONも送信前に内容を確認してください。

## 機能

- **見た目**: 背景画像、背景色、ダークグラスUI、追従ヘッダー・サイドバー
- **入力支援**: 文字数カウンター、textarea自動リサイズ、提出後リロード
- **ページ操作**: ページ番号色分け、前後移動ショートカット、スクリーンショット
- **資料保存**: ページ・講義回・科目単位の収集、直接保存、Google Slides PDF/PNG、本文抽出
- **課題**: 課題検出、提出状態記録、手動補正、講義回別一覧、期限候補・期限通知
- **メモ**: ページごとの複数メモ、検索、TXT/JSON入出力
- **コース**: 並び替え、お気に入り、非表示
- **INIAD Plus**: ACE時間割保存、外部リンク、Driveボタン、スライド表示調整
- **AI要約**: INIAD AI MOPによるスライド・ページ本文の復習ノート化
- **開発支援**: デベロッパーモード、診断JSON、内部ステータス

## 使い方

### 資料保存

講義ツールの `資料保存` から、ページ・講義回・科目単位で資料を収集できます。Google Slides保存中に一時タブを操作すると、安全のため処理を中断する場合があります。

### 課題状態と期限

MOOCsの表示と提出完了アラートを根拠に状態を記録します。自動判定が不確かな場合は `要対応` と表示されるため、MOOCs本体を確認してから手動補正してください。期限候補は自動確定されず、利用者が適用した場合だけ保存されます。

### AI要約

講義ツールの `AI要約` で `抽出して要約` を押すと、今回使用する推定token数を確認してから送信できます。現在は画像を送らず、抽出したテキストだけを送信します。本文だけを確認・保存する場合は、資料保存画面の `スライド本文抽出` を使用してください。

## データとプライバシー

設定、メモ、課題状態、期限、ACE時間割、要約キャッシュは `chrome.storage.local` に保存されます。拡張機能を削除するとローカルデータが失われる場合があります。

AI要約を実行した場合だけ、確認した抽出テキストをINIAD AI MOPへ送信します。詳細は [Privacy](docs/PRIVACY.md) を参照してください。

講義資料やスライドは、著作権法、授業ルール、大学の規程に従い、私的利用の範囲で扱ってください。再配布や公開は行わないでください。

## 権限

- `storage`: 設定とローカルデータの保存
- `downloads`: 資料、メモ、Slides出力の保存
- `tabs`: Slides保存用タブの開閉
- `activeTab`: スクリーンショット対象タブの取得
- `clipboardWrite`: スクリーンショットと抽出テキストのコピー
- `scripting`: 拡張機能更新後のcontent script再適用
- `moocs.iniad.org`: MOOCsへの機能追加
- `www.ace.toyo.ac.jp`: ACE時間割機能
- `docs.google.com`: Google Slides処理
- `api.openai.iniad.org`: AI要約を実行した場合のAPI通信

`debugger`と`<all_urls>`は使用していません。

## 開発者向け

```bash
npx pnpm@10.30.2 install --frozen-lockfile
npx pnpm@10.30.2 run lint
npx pnpm@10.30.2 run build:chromium
npx pnpm@10.30.2 run release:check
```

`release:check`は秘密情報・個人パス・デフォルトAPIキーを検査し、静的チェックとChromiumビルドを実行します。`dist/`、`node_modules/`、`.env*`、秘密鍵ファイルはGit管理対象外です。

トラブルへの対処は [Troubleshooting](docs/TROUBLESHOOTING.md)、設計と機能状況は [Architecture Plan](docs/ARCHITECTURE_PLAN.md) と [Feature Matrix](docs/FEATURE_MATRIX.md) を参照してください。

## Credits

機能と設計の検討では、以下の公開リポジトリを参考にしました。コードをそのまま統合せず、MOOCs Ultimate向けに機能単位で再設計しています。

- [GlassMOOCs](https://github.com/kuraryu405/glassmoocs)
- [iniad_plus](https://github.com/Kensuke-sam/iniad_plus)
- [INIAD++](https://github.com/akahoshi1421/INIAD-)
- [moocs-collect](https://github.com/yu7400ki/moocs-collect)

## License

招待したαテスターには、個人評価目的の利用のみを許可しています。第三者への公開・再配布は禁止です。詳細は [LICENSE.md](LICENSE.md) を参照してください。
