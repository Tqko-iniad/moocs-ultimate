# Troubleshooting

## Extension Does Not Load

- Run `pnpm run build:chromium`.
- Load `dist/chromium/`, not `src/`.
- Check `chrome://extensions` for manifest errors.

## UI Does Not Appear On MOOCs

- Confirm the current URL starts with `https://moocs.iniad.org/`.
- Open the options page and check that the relevant feature is ON.
- Reload the MOOCs tab after rebuilding or reloading the extension.
- If all settings are OFF, most UI is intentionally hidden.

## Download Panel Does Not Save Files

- Confirm Chrome has not blocked downloads.
- Check the failure list in `MOOCs Ultimate Downloads`.
- Direct file download requires the candidate URL to be a downloadable file or convertible Google Drive file URL.
- Streaming links such as `m3u8` may be detected but are disabled by default.

## Google Slides PDF/PNG Fails

- Do not activate or operate the temporary Slides tab while exporting.
- If the Slides page requires login or access approval, open it manually first.
- If the failure says the Slides helper is unavailable, reload the extension and try again.

## Memo Or Course Data Disappears

- Data is stored in `chrome.storage.local`.
- Removing the extension can remove local extension data.
- Export important memos from the options page before resetting storage.

## Broken Settings JSON

The settings importer validates type and allowed values. Invalid JSON is not saved and should not crash the extension. Use `初期化` on the options page to restore defaults.

## ACE Timetable Button Does Not Appear

- Confirm the current URL is `https://www.ace.toyo.ac.jp/ct/home...`.
- Turn ON `INIAD Plus > ACE timetable download`.
- Reload the ACE tab.
- ACE parsing is best-effort; if no timetable rows are found, JSON/CSV may contain zero items.

## `pnpm` Is Not Installed

Install pnpm, or run the pinned version without a global installation:

```bash
npx pnpm@10.30.2 install --frozen-lockfile
npx pnpm@10.30.2 run release:check
```
