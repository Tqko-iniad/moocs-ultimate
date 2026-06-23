# Privacy

MOOCs Ultimate is designed for personal local use.

## Data Stored Locally

The extension stores the following data in `chrome.storage.local`:

- `ultimateMoocs.settings`: feature settings
- `ultimateMoocs.memos`: page memos
- `ultimateMoocs.courseOrder`: course order
- `ultimateMoocs.coursePrefs`: favorite and hidden course flags
- `ultimateMoocs.assignmentStatus`: detected and manually corrected assignment states and deadlines
- `ultimateMoocs.downloadState`: download progress state
- `ultimateMoocs.aceTimetable`: timetable data exported from ACE
- `ultimateMoocs.aiUsage`: estimated daily AI token usage
- `ultimateMoocs.aiQuota`: manually entered AI quota information
- `ultimateMoocs.aiSummaries`: cached AI summaries

## Network Behavior

The extension runs on:

- `https://moocs.iniad.org/*`
- `https://www.ace.toyo.ac.jp/ct/home*`
- `https://docs.google.com/presentation/*`

It does not send your settings, memos, timetable, or debug data to a custom external server. Downloads are requested from the original material URLs you choose to save.

If AI summary is enabled, extracted text selected for summarization is sent from the background service worker to the configured INIAD AI MOP OpenAI-compatible endpoint. The default endpoint is `https://api.openai.iniad.org/api/v1`. The API key is stored in extension-local storage, is used only by extension code for API requests, is not inserted into the MOOCs page DOM, and is removed from exported settings JSON.

## Google Slides Export

Chromium Slides export opens a temporary Slides viewer tab and uses the Slides content script to rasterize slide SVG content into PDF or PNG files. The temporary tab is closed after processing. Export may fail if the page is not logged in, the Slides viewer cannot render, or the user operates the temporary tab during export.

## User Responsibility

Downloaded course materials and slides should be handled within private-use, course-rule, and copyright-law limits. Do not redistribute downloaded materials.
