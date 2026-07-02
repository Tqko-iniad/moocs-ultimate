import {
  formatAssignmentDeadlineForDisplay,
  getAssignmentEvidenceDescription,
  getAssignmentStatusDescriptionText,
  getAssignmentStatusDisplayLabel,
} from '../shared/assignmentStatus.js';

function createAssignmentDeadlineCandidateListElement(documentRef, record, candidates, actions) {
  const section = documentRef.createElement('div');
  section.className = 'um-assignment-deadline-candidates';
  const heading = documentRef.createElement('strong');
  heading.textContent = 'ページ内の期限候補';
  section.append(heading);
  for (const candidate of candidates) {
    const item = documentRef.createElement('div');
    item.className = 'um-assignment-deadline-candidate';
    const content = documentRef.createElement('div');
    const date = documentRef.createElement('strong');
    date.textContent = formatAssignmentDeadlineForDisplay({ deadlineDate: candidate.date, deadlineTime: candidate.time });
    const source = documentRef.createElement('small');
    source.textContent = candidate.sourceText;
    const assumptions = [];
    if (!candidate.contextMatched) assumptions.push('期限語がないため日付候補として表示');
    if (candidate.inferredYear) assumptions.push('年は講義年度から補完');
    if (candidate.inferredTime) assumptions.push('時刻は23:59を提案');
    content.append(date, source);
    if (assumptions.length) {
      const note = documentRef.createElement('small');
      note.className = 'um-assignment-deadline-assumption';
      note.textContent = assumptions.join(' / ');
      content.append(note);
    }
    const buttonGroup = documentRef.createElement('div');
    const applyButton = actions.createButton('適用');
    applyButton.addEventListener('click', () => actions.onApplyCandidate(record, candidate));
    const ignoreButton = actions.createButton('無視');
    ignoreButton.addEventListener('click', () => actions.onIgnoreCandidate(record, candidate.id));
    buttonGroup.append(applyButton, ignoreButton);
    item.append(content, buttonGroup);
    section.append(item);
  }
  return section;
}

function createAssignmentDeadlineEditorControl(documentRef, record, candidates, actions) {
  const details = documentRef.createElement('details');
  details.className = 'um-assignment-deadline-control';
  details.dataset.hasCandidates = candidates.length ? 'true' : 'false';

  const summary = documentRef.createElement('summary');
  const label = documentRef.createElement('span');
  label.textContent = '提出期限';
  const value = documentRef.createElement('strong');
  value.textContent = record?.deadlineDate
    ? formatAssignmentDeadlineForDisplay(record)
    : candidates.length
      ? `候補あり（${candidates.length}件）`
      : '未設定';
  summary.append(label, value);
  details.append(summary);

  const fields = documentRef.createElement('div');
  fields.className = 'um-assignment-deadline-fields';
  const dateLabel = documentRef.createElement('label');
  dateLabel.textContent = '日付';
  const dateInput = documentRef.createElement('input');
  dateInput.type = 'date';
  dateInput.min = '2000-01-01';
  dateInput.max = '2099-12-31';
  dateInput.value = record?.deadlineDate || '';
  dateInput.setAttribute('aria-label', '提出期限の日付');
  const datePickerRow = documentRef.createElement('span');
  datePickerRow.className = 'um-assignment-date-picker-row';
  const calendarTrigger = documentRef.createElement('span');
  calendarTrigger.className = 'um-assignment-calendar-trigger';
  calendarTrigger.textContent = 'カレンダー';
  const pickerInput = documentRef.createElement('input');
  pickerInput.type = 'date';
  pickerInput.min = '2000-01-01';
  pickerInput.max = '2099-12-31';
  pickerInput.value = dateInput.value;
  pickerInput.setAttribute('aria-label', 'カレンダーから提出期限を選択');
  pickerInput.addEventListener('change', () => {
    dateInput.value = pickerInput.value;
  });
  dateInput.addEventListener('change', () => {
    pickerInput.value = dateInput.value;
  });
  calendarTrigger.append(pickerInput);
  datePickerRow.append(dateInput, calendarTrigger);
  dateLabel.append(datePickerRow);
  const timeLabel = documentRef.createElement('label');
  timeLabel.textContent = '時刻（任意）';
  const timeInput = documentRef.createElement('input');
  timeInput.type = 'time';
  timeInput.value = record?.deadlineTime || '23:59';
  timeInput.setAttribute('aria-label', '提出期限の時刻');
  timeLabel.append(timeInput);

  const buttons = documentRef.createElement('div');
  buttons.className = 'um-assignment-deadline-actions';
  const saveButton = actions.createButton('保存');
  saveButton.addEventListener('click', () => actions.onSaveDeadline(record, dateInput.value, timeInput.value));
  const clearButton = actions.createButton('期限を削除');
  clearButton.disabled = !record?.deadlineDate;
  clearButton.addEventListener('click', () => actions.onClearDeadline(record));
  buttons.append(saveButton, clearButton);
  fields.append(dateLabel, timeLabel, buttons);
  if (candidates.length) details.append(createAssignmentDeadlineCandidateListElement(documentRef, record, candidates, actions));
  details.append(fields);
  return details;
}

export function renderAssignmentStatusPanelContent(panel, result, record, options = {}) {
  if (!panel) return;
  const { document: documentRef = document, createButton, candidates = [], debugEnabled = false } = options;
  panel.dataset.status = result.status;
  panel.replaceChildren();

  const header = documentRef.createElement('div');
  header.className = 'um-assignment-status-header';

  const main = documentRef.createElement('div');
  main.className = 'um-assignment-status-main';
  const badge = documentRef.createElement('span');
  badge.className = 'um-assignment-status-badge';
  badge.textContent = getAssignmentStatusDisplayLabel(result.status);
  const title = documentRef.createElement('strong');
  title.textContent = getAssignmentStatusDescriptionText(result);
  main.append(badge, title);
  header.append(main);

  const detail = documentRef.createElement('p');
  detail.className = 'um-assignment-status-evidence';
  detail.textContent = getAssignmentEvidenceDescription(result, record);

  const meta = documentRef.createElement('small');
  meta.className = 'um-assignment-status-meta';
  const checkedAt = record?.checkedAt ? new Date(record.checkedAt).toLocaleString() : new Date().toLocaleString();
  meta.textContent = `確認: ${checkedAt} / 判定信頼度: ${result.confidence}`;

  const body = documentRef.createElement('div');
  body.className = 'um-assignment-status-body';
  if (debugEnabled) body.append(detail, meta);
  body.append(createAssignmentDeadlineEditorControl(documentRef, record, candidates, options));

  const actions = documentRef.createElement('div');
  actions.className = 'um-assignment-status-actions';
  const refreshButton = createButton('再確認');
  refreshButton.classList.add('um-assignment-action-primary');
  refreshButton.addEventListener('click', () => options.onRefresh());
  actions.append(refreshButton);

  const collectButton = createButton('この回の課題を確認');
  collectButton.addEventListener('click', () => options.onCollectLectureAssignments());
  actions.append(collectButton);

  const manualDetails = documentRef.createElement('details');
  manualDetails.className = 'um-assignment-manual-details';
  const manualSummary = documentRef.createElement('summary');
  manualSummary.textContent = '手動補正';
  manualDetails.append(manualSummary);

  const manualActions = documentRef.createElement('div');
  manualActions.className = 'um-assignment-manual-actions';
  for (const [status, label] of [
    ['submitted', '提出済みにする'],
    ['not_submitted', '未提出にする'],
    ['unpublished', '課題未公開にする'],
    ['unknown', '確認不能にする'],
  ]) {
    const button = createButton(label);
    button.dataset.status = status;
    button.disabled = result.status === status && result.source === 'manual';
    button.addEventListener('click', () => options.onSetManualStatus(status));
    manualActions.append(button);
  }
  manualDetails.append(manualActions);
  actions.append(manualDetails);

  if (debugEnabled) {
    const devButton = createButton('開発用: 提出完了アラート');
    devButton.classList.add('um-assignment-dev-button');
    devButton.title = '一時テスト用です。実際のMOOCs提出や直接更新は行わず、alert検出経路だけを確認します。';
    devButton.addEventListener('click', () => options.onTriggerDevAlert());
    actions.append(devButton);
  }

  panel.append(header, body, actions);
}
