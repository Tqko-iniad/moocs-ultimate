import { runtimeSendMessage } from '../shared/browserApi.js';
import { createMessage, MESSAGE_TYPES } from '../shared/messages.js';

function getSlideIframeElements(doc) {
  return [...doc.querySelectorAll('iframe[src]')].filter((frame) =>
    /docs\.google\.com\/presentation/i.test(frame.src),
  );
}

function getEmbedKey(src) {
  try {
    const url = new URL(src);
    return url.origin + url.pathname;
  } catch {
    return '';
  }
}

export function createSlidePositionRestoreController({ document: documentRef }) {
  let applied = false;

  async function ensureMounted() {
    if (applied) return;
    const frames = getSlideIframeElements(documentRef);
    if (!frames.length) return;

    applied = true;
    for (const frame of frames) {
      const key = getEmbedKey(frame.src);
      if (!key) continue;

      let saved;
      try {
        const response = await runtimeSendMessage(
          createMessage(MESSAGE_TYPES.slidePositionGet, { key }),
        );
        saved = response?.payload?.position;
      } catch {
        continue;
      }
      if (!saved || typeof saved.page !== 'number' || saved.page < 2) continue;

      try {
        const url = new URL(frame.src);
        const slideValue = saved.slideParam || `id.p${saved.page - 1}`;
        url.searchParams.set('slide', slideValue);
        frame.src = url.toString();
      } catch {
        // skip malformed src
      }
    }
  }

  return { ensureMounted };
}
