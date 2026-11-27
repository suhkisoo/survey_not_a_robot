// 〈로봇이 아닙니다*〉 관람 설문 — 응답 저장용 Apps Script 웹 앱
// 설정 방법은 저장소의 README.md 참고. 코드를 고치면 "배포 관리 → 새 버전"으로 다시 배포해야 반영된다.

const SHEET_ID = 'PUT_SPREADSHEET_ID_HERE';
const RESP_SHEET = 'responses';
const CONTACT_SHEET = 'contacts';
const RESP_COLS = [
  'response_id', 'submitted_at', 'form_version', 'duration_sec',
  'b_exp', 'b_human', 'b_feel', 'b_think', 'b_what', 'b_changed', 'b_first',
  'c_exp', 'c_human', 'c_feel', 'c_think', 'c_what', 'c_changed', 'c_first',
  'a_exp', 'a_did', 'a_human', 'a_feel', 'a_think', 'a_what', 'a_changed', 'a_first',
  'a_reluct', 'a_quoted', 'a_person', 'a_other',
  'most_human', 'most_reason', 'most_reason_other',
  'unsure_why', 'changed_moment', 'why_human',
  'age', 'ai_use',
  'gender'          // web-v4에서 추가. 기존 행과 열이 어긋나지 않도록 맨 뒤에 둔다
];
const CONTACT_COLS = ['date', 'contact', 'raffle', 'interview'];

// 브라우저에서 /exec 주소를 열어 배포가 살아 있는지 확인하는 용도.
function doGet() {
  return out({ ok: true, service: 'survey' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > 20000) return out({ ok: false, error: 'bad_request' });
    const data = JSON.parse(raw);
    if (data.hp) return out({ ok: true });
    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    if (data.kind === 'response') return out(saveResponse(ss, data));
    if (data.kind === 'contact') return out(saveContact(ss, data));
    return out({ ok: false, error: 'unknown_kind' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function saveResponse(ss, data) {
  const sh = ss.getSheetByName(RESP_SHEET) || ss.insertSheet(RESP_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(RESP_COLS);
  const id = String(data.response_id || '');
  if (!id) return { ok: false, error: 'no_id' };
  const last = sh.getLastRow();
  if (last > 1) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return r[0]; });
    if (ids.indexOf(id) !== -1) return { ok: true, duplicate: true };
  }
  const a = data.answers || {};
  const row = RESP_COLS.map(function (c) {
    if (c === 'response_id') return id;
    if (c === 'submitted_at') return new Date();
    if (c === 'form_version') return safe(data.form_version);
    return safe(a[c]);
  });
  sh.appendRow(row);
  return { ok: true };
}

function saveContact(ss, data) {
  const sh = ss.getSheetByName(CONTACT_SHEET) || ss.insertSheet(CONTACT_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(CONTACT_COLS);
  const contact = safe(data.contact);
  if (!contact) return { ok: false, error: 'no_contact' };
  const last = sh.getLastRow();
  const pos = 2 + Math.floor(Math.random() * last);
  if (pos <= last) sh.insertRowBefore(pos);
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  sh.getRange(pos, 1, 1, CONTACT_COLS.length)
    .setValues([[date, contact, data.raffle ? 'Y' : '', data.interview ? 'Y' : '']]);
  return { ok: true };
}

// =, +, -, @ 로 시작하는 입력이 시트에서 수식으로 실행되지 않게 막는다.
function safe(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join('; ');
  if (typeof v === 'number') return v;
  const s = String(v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
