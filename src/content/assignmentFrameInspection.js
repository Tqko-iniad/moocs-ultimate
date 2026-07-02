import { detectAssignmentSignalInDocument } from '../shared/assignmentDetection.js';
import { getMoocsPageTitle } from '../shared/downloadCandidates.js';

export function createAssignmentFrameInspection({
  document: documentRef,
  window: windowRef,
  location: locationRef,
  getAssignmentDetectionOptions,
}) {
  function shouldInspectAssignmentCandidateInSandboxedFrame(entry) {
    if (!entry || entry.staticError) return false;
    if (entry.url?.origin !== locationRef.origin) return false;
    if (!entry.candidate?.likelyAssignment && !entry.candidate?.reasons?.includes('assignment-tab-title')) {
      return false;
    }
    return true;
  }

  async function inspectAssignmentCandidateInSandboxedFrame(entry) {
    const frame = documentRef.createElement('iframe');
    frame.dataset.umOwned = 'true';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.referrerPolicy = 'same-origin';
    frame.style.cssText =
      'position:fixed!important;left:-10000px!important;top:0!important;width:1280px!important;height:800px!important;opacity:0!important;pointer-events:none!important;border:0!important;';

    try {
      const result = await new Promise((resolve) => {
        const startedAt = Date.now();
        let settled = false;
        let intervalId = 0;
        let timeoutId = 0;

        const finish = (value) => {
          if (settled) return;
          settled = true;
          windowRef.clearInterval(intervalId);
          windowRef.clearTimeout(timeoutId);
          resolve(value);
        };
        const inspect = () => {
          try {
            const doc = frame.contentDocument;
            if (!doc?.documentElement) return;
            const signal = detectAssignmentSignalInDocument(doc, entry.url, entry.candidate, getAssignmentDetectionOptions());
            if (signal.attendancePage) {
              finish({ attendancePage: true });
              return;
            }
            if (signal.ok) {
              finish({
                signal,
                title: getMoocsPageTitle(doc, entry.url.href) || entry.linkText || '課題',
              });
              return;
            }
            if (doc.readyState === 'complete' && Date.now() - startedAt >= 1800) finish(null);
          } catch {
            // The final timeout handles redirects, sandboxed navigations, or inaccessible documents.
          }
        };

        intervalId = windowRef.setInterval(inspect, 180);
        timeoutId = windowRef.setTimeout(() => finish(null), 5000);
        frame.addEventListener('load', inspect);
        frame.src = entry.url.href;
        documentRef.body.append(frame);
        inspect();
      });
      return result;
    } finally {
      frame.remove();
    }
  }

  return {
    shouldInspectAssignmentCandidateInSandboxedFrame,
    inspectAssignmentCandidateInSandboxedFrame,
  };
}
