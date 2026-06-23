const PREVIOUS_ATTENDANCE_TITLE_PATTERN = /前回の確認/i;
const ATTENDANCE_FIELD_PATTERN = /教室(?:名|番号)?|座席(?:位置|番号)?|テーブル番号/i;

export function isPreviousAttendanceTitle(text) {
  return PREVIOUS_ATTENDANCE_TITLE_PATTERN.test(String(text || ''));
}

export function isAttendanceFieldInstruction(text) {
  return ATTENDANCE_FIELD_PATTERN.test(String(text || ''));
}
