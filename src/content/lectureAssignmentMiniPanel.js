import {
  compareAssignmentDeadlineUrgency,
  getAssignmentDeadlineState,
} from '../shared/assignmentDeadline.js';
import {
  getAssignmentEvidenceSourceLabel,
  getAssignmentRecordTitleForDisplay,
  getAssignmentStatusDisplayLabel,
} from '../shared/assignmentStatus.js';
import { sortCollectedAssignmentRecords } from '../shared/assignmentDetection.js';

export function updateLectureAssignmentCheckStatus(panel, text, state = 'idle') {
  if (!panel) return;
  const status = panel.querySelector('.um-lecture-assignment-status');
  const button = panel.querySelector('[data-um-assignment-check]');
  if (status) {
    status.textContent = text;
    status.dataset.state = state;
  }
  if (button) {
    button.disabled = state === 'checking';
  }
}

export function renderLectureAssignmentMiniList(document, panel, records) {
  if (!panel) return;
  const list = panel.querySelector('[data-um-assignment-list]');
  if (!list) return;
  list.replaceChildren();
  const visibleRecords = records.filter((record) => record?.status).sort((a, b) => {
    const deadlineOrder = compareAssignmentDeadlineUrgency(a, b);
    if (deadlineOrder) return deadlineOrder;
    const pageOrder = sortCollectedAssignmentRecords([a, b]);
    if (pageOrder[0]?.url === pageOrder[1]?.url) return 0;
    return pageOrder[0] === a ? -1 : 1;
  });
  list.hidden = visibleRecords.length === 0;
  if (!visibleRecords.length) return;
  const heading = document.createElement('div');
  heading.className = 'um-lecture-assignment-list-heading';
  heading.textContent = 'この回の課題';
  list.append(heading);
  for (const record of visibleRecords) {
    const deadline = getAssignmentDeadlineState(record);
    const link = document.createElement('a');
    link.className = 'um-lecture-assignment-item';
    link.dataset.status = record.status || 'unknown';
    link.dataset.deadlineTone = deadline.tone;
    link.href = record.url || record.pageKey || '#';
    link.title = [deadline.label, record.evidence, '期限は課題ページで編集できます。'].filter(Boolean).join('\n');
    const title = document.createElement('span');
    title.className = 'um-lecture-assignment-title';
    title.textContent = getAssignmentRecordTitleForDisplay(record);
    const meta = document.createElement('span');
    meta.className = 'um-lecture-assignment-meta';
    meta.textContent = getAssignmentEvidenceSourceLabel(record);
    const status = document.createElement('span');
    status.className = 'um-lecture-assignment-chip';
    status.textContent = getAssignmentStatusDisplayLabel(record.status);
    const deadlineText = document.createElement('span');
    deadlineText.className = 'um-lecture-assignment-deadline';
    deadlineText.dataset.tone = deadline.tone;
    deadlineText.textContent = deadline.label;
    link.append(title, meta, status, deadlineText);
    list.append(link);
  }
}
