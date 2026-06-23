# MOOCs Ultimate Architecture Plan

`MOOCs Ultimate` は Manifest V3 の個人利用向け拡張機能として設計する。Chromium対応を先に安定させ、Firefox対応は同じ機能境界を保ったままadapterを差し替えられる構造にする。

## 設計原則

- background service worker は1つだけにする。
- content script は機能別モジュールに分割する。
- CSS、storage、message、DOM data属性はすべて名前空間化する。
- 既存コードのファイル単位移植ではなく、機能単位で再設計する。
- DOM依存はページ種別ごとのadapterに閉じ込める。
- Google Slides保存やdownloadsなど権限が強い処理はbackground側へ集約する。
- 個人利用前提だが、参考元クレジットと非公式ツールであることをREADMEに書く。

## 想定ディレクトリ構成

```text
src/
  manifest/
    manifest.base.json
    manifest.chromium.json
    manifest.firefox.json
  background/
    service-worker.ts
    router.ts
    handlers/
      downloads.ts
      slides-export.ts
      storage.ts
      debug-log.ts
    adapters/
      browser-api.ts
      downloads-api.ts
      tabs-api.ts
  content/
    runtime.ts
    modules/
      appearance.ts
      input-assist.ts
      navigation.ts
      downloads-panel.ts
      notes.ts
      course-sort.ts
      ace-timetable.ts
      external-links.ts
      drive-button.ts
      slide-adjust.ts
    pages/
      moocs.ts
      ace.ts
      google-slides.ts
    dom/
      moocs-selectors.ts
      ace-selectors.ts
  options/
    App.tsx
    settings-schema.ts
  shared/
    constants.ts
    messages.ts
    storage-keys.ts
    logger.ts
    permissions.ts
    types.ts
styles/
  content.css
  options.css
```

## Manifest V3方針

```json
{
  "manifest_version": 3,
  "name": "MOOCs Ultimate",
  "permissions": ["storage", "downloads", "tabs", "activeTab", "clipboardWrite", "scripting"],
  "host_permissions": [
    "https://moocs.iniad.org/*",
    "https://www.ace.toyo.ac.jp/ct/home*",
    "https://docs.google.com/presentation/*",
    "https://api.openai.iniad.org/*"
  ],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "options_page": "options/index.html"
}
```

Google SlidesのPDF/PNG保存は、保存用タブ上のSlides helperがSVGを画像化し、backgroundがdownloads APIへ渡す。強い `debugger` 権限は使わない。

Firefox対応では、content script注入やdownloads APIの差分をbrowser adapterで吸収する。Slides保存はSVGベース処理を維持する。

## Background service worker

`background/service-worker.ts` は唯一のbackground入口にする。ここでは直接ビジネスロジックを書かず、message typeごとにhandlerへ委譲する。

主な責務:

- `chrome.runtime.onMessage` の単一router。
- ダウンロードキューの管理。
- Google Slides保存用タブの作成、再利用、クローズ。
- `chrome.downloads` 呼び出しの集約。
- debug logの保存と出力。
- storage migrationの実行。

message type例:

| Message type | 方向 | 用途 |
| --- | --- | --- |
| `ultimateMoocs:settings.get` | content/options -> background | 設定取得 |
| `ultimateMoocs:settings.set` | options -> background | 設定保存 |
| `ultimateMoocs:download.enqueue` | content -> background | 資料保存キュー登録 |
| `ultimateMoocs:download.progress` | background -> content | 進捗通知 |
| `ultimateMoocs:slides.exportPdf` | background内部 | Google Slides PDF出力 |
| `ultimateMoocs:slides.exportPng` | background内部 | Google Slides PNG出力 |
| `ultimateMoocs:notes.export` | content -> background | メモtxt保存 |
| `ultimateMoocs:debug.log` | any -> background | デバッグログ集約 |

## Content script runtime

content scriptはページごとに入口を分けるが、各入口は `content/runtime.ts` を通して起動する。

```text
MOOCs page
  runtime -> page detector -> appearance
                            -> input-assist
                            -> navigation
                            -> downloads-panel
                            -> notes
                            -> course-sort
                            -> external-links
                            -> drive-button
                            -> slide-adjust

ACE page
  runtime -> ace-timetable

Google Slides page
  runtime -> google-slides capture helper
```

各モジュールは次の形に揃える。

```ts
export interface ContentModule {
  id: string;
  matches(context: PageContext): boolean;
  mount(context: PageContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
}
```

この形にすることで、同じページに複数機能を入れてもmount順序、重複起動、リロード後復旧を管理しやすくする。

## 名前空間

| 種類 | 形式 | 例 |
| --- | --- | --- |
| CSS class | `um-*` | `um-download-panel`, `um-note-window` |
| data属性 | `data-um-*` | `data-um-module="notes"` |
| storage key | `ultimateMoocs.*` | `ultimateMoocs.settings`, `ultimateMoocs.memos` |
| message type | `ultimateMoocs:*` | `ultimateMoocs:download.enqueue` |
| CustomEvent | `ultimateMoocs:*` | `ultimateMoocs:page.updated` |
| logger scope | `ultimateMoocs:*` | `ultimateMoocs:slides` |

既存参考元の `glassmoocs-*`、`iniadpp-*`、`mymemo-*`、`#slide_download` などは新規コードに持ち込まない。

## Storage schema

```ts
type UltimateMoocsSettings = {
  version: 1;
  appearance: {
    enabled: boolean;
    backgroundMode: "none" | "color" | "image";
    backgroundColor: string;
    backgroundImageUrl: string;
    stickyHeader: boolean;
    stickySidebar: boolean;
    tabColoring: boolean;
  };
  inputAssist: {
    textareaCounter: boolean;
    autoResize: boolean;
  };
  navigation: {
    shortcutsEnabled: boolean;
    previousTabShortcut: string;
    nextTabShortcut: string;
    scrollTopButton: boolean;
  };
  downloads: {
    defaultFormat: "pdf" | "png";
    slidesExporter: "svg-rasterize" | "manual";
  };
  debug: {
    enabled: boolean;
    level: "error" | "warn" | "info" | "debug";
  };
};
```

主要key:

- `ultimateMoocs.settings`
- `ultimateMoocs.memos`
- `ultimateMoocs.courseOrder`
- `ultimateMoocs.coursePrefs`
- `ultimateMoocs.downloadState`
- `ultimateMoocs.aceTimetable`
- `ultimateMoocs:migrations`
- `ultimateMoocs:debug.logs`

## Google Slides PDF/PNG保存

Chromium優先の主経路:

1. MOOCsページの `downloads-panel` がGoogle Slides URLを抽出する。
2. `ultimateMoocs:download.enqueue` をbackgroundへ送る。
3. backgroundがキューを作り、Google Slidesタブを順番に開く。
4. Google Slides content helperがページ数、タイトル、描画完了状態を返す。
5. Google Slides content helperが表示中スライドSVGを画像化する。
6. PDFはbackgroundのPDF builderで1ファイルにまとめ、PNGは連番ファイルとして `chrome.downloads.download` へ渡す。
7. 進捗を `ultimateMoocs.downloadState` に保存し、MOOCsページのpanelが表示する。

Firefoxや自動保存不可のfallback:

- 自動保存不能な場合は手動保存用タブを開く。
- 機能としては同じ `slides-export` adapterに隠蔽し、UI側には `unsupported` / `manualRequired` として返す。

## Options page

設定ページはGlassMOOCsの方針を引き継ぎ、拡張機能のoptions pageとして作る。INIAD++のようにMOOCs内に設定フォームを差し込む方式は、DOM変更リスクが高いため補助に留める。

設定ページに置く項目:

- 見た目カスタム
- 入力支援
- ページナビゲーション
- 資料保存とGoogle Slides保存形式
- メモ
- コース並び替え
- ACE時間割
- 外部リンク
- Driveボタン
- スライド表示調整
- デバッグログ
- 参考元クレジット

## Browser adapter

`shared/browser-api.ts` または `background/adapters/browser-api.ts` で `chrome` / `browser` の差を吸収する。

- Chromium: callback API と一部Promise APIをラップする。
- Firefox: `browser.*` Promise APIを優先する。
- 差分が大きい機能はadapterの戻り値で `supported: false` を返す。

## Build方針

- ビルドツールはViteを候補にする。
- `manifest.base.json` から `dist/chromium/manifest.json` と `dist/firefox/manifest.json` を生成する。
- Chromiumを先にCI対象にする。
- Firefoxはmanifest生成とlintから始め、Google Slides保存の互換性を後続で詰める。
