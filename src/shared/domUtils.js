import { isExtensionContextInvalidated } from './browserApi.js';

export function showToast(message) {
  const oldToast = document.querySelector('.um-toast');
  oldToast?.remove();

  const toast = document.createElement('div');
  toast.className = 'um-toast';
  toast.dataset.umModule = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => {
    toast.classList.add('um-toast-hide');
    window.setTimeout(() => toast.remove(), 220);
  }, 1800);
}

export function reportContentError(scope, error) {
  if (isExtensionContextInvalidated(error)) return;
  console.warn(scope, error);
}

export function createButton(label, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

export function downloadTextFileFromPage(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
