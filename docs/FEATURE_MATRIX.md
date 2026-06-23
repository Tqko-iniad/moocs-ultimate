# MOOCs Ultimate Feature Matrix

MOOCs Ultimateは、GlassMOOCs、iniad_plus、INIAD++系の機能を参考に、Manifest V3向けに再設計した個人利用用拡張機能です。

## Current Scope

| Category | Status | Settings |
| --- | --- | --- |
| Appearance | Implemented | `appearance.*` |
| Input Helper | Implemented | `inputHelper.*` |
| Navigation | Implemented | `navigation.*` |
| Downloads | Implemented | `downloads.*` |
| Google Slides PDF/PNG | Implemented for Chromium | `downloads.enableGoogleSlidesPdf`, `downloads.enableGoogleSlidesPng` |
| Memo | Implemented | `memo.*` |
| Course tools | Implemented | `course.*` |
| INIAD Plus tools | Implemented | `iniadPlus.*` |
| AI Summary foundation | Partially implemented | `ai.*` |
| Developer diagnostics | Implemented | `debug.enableDebugLog` |
| Firefox build | Not implemented | Future browser adapter work |

## Feature Comparison

| Feature | GlassMOOCs | iniad_plus / INIAD++ | MOOCs Ultimate |
| --- | --- | --- | --- |
| Glassmorphism | Yes | No | Yes, `um-` CSS |
| Background image URL | Yes | No | Yes |
| Background color | Limited | Yes | Yes |
| Content opacity | Yes | No | Yes |
| Sticky header/sidebar | No | Yes | Yes |
| Scroll top button | No | Yes | Yes |
| textarea counter | Yes | Yes | Yes, grapheme-aware when possible |
| textarea auto resize | Yes | No | Yes |
| Reload after submit | Yes-style behavior | No | Yes |
| Number tab coloring | Yes | No | Yes |
| Previous/next shortcut | Yes | No | Yes, `Mod+ArrowLeft/Right` default |
| Download panel | Yes | Partial | Yes |
| Page material download | Yes | Yes | Yes |
| Lecture material collection | Yes | Yes | Yes |
| Course material collection | Yes | No/partial | Yes |
| Direct file download | Yes | Yes | Yes |
| Google Slides PDF | Yes/alternate approach | Yes | Yes, Slides SVG rasterize + PDF builder |
| Google Slides PNG | No/partial | Yes | Yes, Slides SVG rasterize |
| Page memo | No | Yes | Yes |
| Multiple memos | No | Yes | Yes |
| Memo list/search | No | Yes | Yes, options page |
| Memo JSON import/export | No | Partial | Yes |
| Course sort | No | Yes | Yes |
| Course favorite/hide | No | No/adjacent | Yes |
| ACE timetable download | No | Yes | Yes, ACE content script |
| Upcoming lecture panel | No | Yes | Yes, local data/page data only |
| External links panel | No | Yes | Yes |
| Drive button | No | Yes | Yes |
| Slide resize tools | No | Yes | Yes |
| AI slide summary | No | No | Yes: text extraction, confirmation, summary, cache |
| Options page | Yes | Limited | Yes |
| Developer diagnostics | Yes | Console logs | Yes, developer-mode-only tab and sanitized JSON export |

## Storage Keys

| Key | Purpose |
| --- | --- |
| `ultimateMoocs.settings` | All feature settings |
| `ultimateMoocs.memos` | URL-based memo records |
| `ultimateMoocs.courseOrder` | Course order |
| `ultimateMoocs.coursePrefs` | Course favorite/hide flags |
| `ultimateMoocs.assignmentStatus` | Assignment state and deadline records |
| `ultimateMoocs.downloadState` | Download queue progress |
| `ultimateMoocs.aceTimetable` | ACE timetable data |
| `ultimateMoocs.aiUsage` | Estimated daily AI token usage |
| `ultimateMoocs.aiQuota` | Manually entered AI quota information |
| `ultimateMoocs.aiSummaries` | Cached AI summaries |

## Message Namespaces

Runtime messages use `ultimateMoocs:*`, for example:

- `ultimateMoocs:settings.get`
- `ultimateMoocs:settings.set`
- `ultimateMoocs:download.enqueue`
- `ultimateMoocs:download.cancel`
- `ultimateMoocs:download.state.get`
- `ultimateMoocs:ai.summarize`
- `ultimateMoocs:ai.usage.get`
- `ultimateMoocs:slides.session`

## Permissions

| Permission | Reason |
| --- | --- |
| `storage` | Local settings and user data |
| `downloads` | Direct files, memo exports, Slides outputs |
| `tabs` | Open/close Slides export tabs |
| `activeTab` | Capture the active MOOCs tab from the screenshot shortcut |
| `clipboardWrite` | Copy screenshots and extracted text |
| `scripting` | Reinject the content script after an extension reload |
| `moocs.iniad.org` | MOOCs content UI |
| `www.ace.toyo.ac.jp/ct/home*` | ACE timetable UI |
| `docs.google.com/presentation/*` | Slides helper |
| `api.openai.iniad.org` | INIAD AI MOP requests when AI summary is enabled |

Broad permissions such as `<all_urls>` and `debugger` are intentionally omitted.

## Remaining Risks

- Google Slides DOM and viewer behavior can change.
- Firefox support needs packaging/API compatibility work, but Slides export no longer depends on Chromium debugger.
- Course list selectors depend on MOOCs page structure.
- ACE timetable parsing is best-effort because ACE markup may vary.
- AI output quality depends on the extracted Slides text and the configured model.
