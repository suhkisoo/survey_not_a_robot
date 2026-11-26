// 명세 9장 테스트(1~11)를 로컬에서 돌린다: node test/run.js
// 실제 apps-script/Code.gs를 가짜 스프레드시트 위에서 실행하는 모의 서버 + Playwright(모바일 360px).
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

/* ---- 가짜 Apps Script 환경 ---- */
class Sheet {
  constructor() { this.rows = []; }
  getLastRow() { return this.rows.length; }
  appendRow(r) { this.rows.push(r.slice()); }
  insertRowBefore(p) { this.rows.splice(p - 1, 0, []); }
  getRange(r, c, nr, nc) {
    const s = this;
    return {
      getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (s.rows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
      setValues(v) { for (let i = 0; i < nr; i++) { const row = s.rows[r - 1 + i] || (s.rows[r - 1 + i] = []); for (let j = 0; j < nc; j++) row[c - 1 + j] = v[i][j]; } }
    };
  }
}
const sheets = { responses: new Sheet(), contacts: new Sheet() };
const ctx = vm.createContext({
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet()) }) },
  Utilities: { formatDate: d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d) },
  ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx);
let posts = [];

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/exec') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      posts.push({ type: req.headers['content-type'], body });
      const r = ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(r.text);
    });
    return;
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace("ENDPOINT: ''", "ENDPOINT: '/exec'");
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});

/* ---- 테스트 도구 ---- */
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
const respRows = () => sheets.responses.rows.slice(1);
const col = (row, name) => row[ctx.RESP_COLS ? 0 : 0, COLS.indexOf(name)];
const COLS = vm.runInContext('RESP_COLS', ctx);
function resetSheets() { sheets.responses = new Sheet(); sheets.contacts = new Sheet(); posts = []; }

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const SHOTS = process.env.SHOTS;

  async function open() {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.on('dialog', d => { fail++; console.log('  ✗ alert/confirm이 떴음: ' + d.message()); d.dismiss(); });
    page.on('pageerror', e => { fail++; console.log('  ✗ 페이지 오류: ' + e.message); });
    await page.goto(url);
    return { context, page };
  }
  const pick = (page, name, v) => page.check(`input[name="${name}"][value="${v}"]`);
  const next = page => page.click('#next');
  const title = page => page.textContent('h1,h2');
  const vis = (page, q) => page.isVisible(`[data-q="${q}"]`);
  async function start(page) { await pick(page, 'consent', 'yes'); await next(page); }
  async function nextTwice(page) { // 선택 문항이 비어 있으면 안내 후 한 번 더
    const before = await title(page);
    await next(page);
    if (await title(page) === before && await page.isVisible('#msg.warn')) await next(page);
  }
  async function allNoneToInfo(page) {
    await start(page);
    for (const p of ['b', 'c', 'a']) { await pick(page, p + '_exp', 'none'); await next(page); }
  }
  async function submitInfo(page) { await next(page); if (await page.isVisible('#msg.warn')) await next(page); }

  // 1
  console.log('1. 동의 "아니오"');
  { const { context, page } = await open();
    await next(page); ok(await page.isVisible('#msg.err'), '동의 미선택 시 진행 안 됨');
    await pick(page, 'consent', 'no'); await next(page);
    ok((await title(page)).includes('감사합니다'), '감사 인사 표시');
    ok(posts.length === 0 && respRows().length === 0, '아무것도 전송·저장 안 됨');
    ok(await page.evaluate(() => localStorage.length) === 0, '임시 저장도 남지 않음');
    await context.close(); }

  // 2
  console.log('2. 세 존재 모두 "안 봄"');
  { resetSheets(); const { context, page } = await open();
    await start(page);
    await next(page); ok(await page.isVisible('#msg.err') && (await title(page)).startsWith('B'), '경험 여부는 필수');
    ok(!(await vis(page, 'b_human')), '경험 답 전에는 B 문항 숨김');
    for (const p of ['b', 'c', 'a']) { await pick(page, p + '_exp', 'none'); await next(page); }
    ok(await title(page) === '기본 정보', '4.5를 건너뛰고 기본 정보로');
    await pick(page, 'age', '20s'); await pick(page, 'ai_use', 'daily'); await next(page);
    await page.waitForSelector('#contactForm');
    const r = respRows();
    ok(r.length === 1 && r[0][COLS.indexOf('b_exp')] === 'none' && r[0][COLS.indexOf('age')] === '20s', '전송 정상 (1행)');
    ok(r[0][COLS.indexOf('form_version')] === 'web-v1' && typeof r[0][COLS.indexOf('duration_sec')] === 'number', 'form_version, duration_sec 기록');
    ok(posts[0].type.startsWith('text/plain'), 'Content-Type text/plain');
    ok(await page.evaluate(() => localStorage.length) === 0, '전송 성공 후 임시 저장 삭제');
    await context.close(); }

  // 3, 6
  console.log('3·6. tried → none으로 변경 / most_human 선택지');
  { resetSheets(); const { context, page } = await open();
    await start(page);
    await pick(page, 'b_exp', 'tried');
    await pick(page, 'b_human', '5'); await pick(page, 'b_what', 'unsure'); await pick(page, 'b_changed', 'yes'); await pick(page, 'b_first', 'human');
    await nextTwice(page);
    ok((await title(page)).includes('5층 화면 속 존재들'), '군중 섹션으로 이동');
    await page.click('#prev');
    ok(await page.isChecked('input[name="b_human"][value="5"]'), '이전으로 돌아가도 답 유지');
    await pick(page, 'b_exp', 'none');
    ok(!(await vis(page, 'b_human')) && !(await vis(page, 'b_first')), 'none으로 바꾸면 B 문항 숨김');
    await next(page);
    await pick(page, 'c_exp', 'seen'); await pick(page, 'c_human', '2'); await nextTwice(page);
    await pick(page, 'a_exp', 'none'); await next(page);
    ok(await title(page) === '세 존재를 돌아보며', '돌아보며 섹션 표시');
    const opts = await page.$$eval('input[name="most_human"]', els => els.map(e => e.value));
    ok(opts.join() === 'c,none', '"안 봄" 존재는 선택지에 없음 (' + opts.join() + ')');
    ok(!(await vis(page, 'unsure_why')) && !(await vis(page, 'changed_moment')), '숨겨진 B 답(unsure/yes)은 뒤 조건에 영향 없음');
    ok(!(await vis(page, 'most_reason')), '선택 전 이유 문항 숨김');
    await pick(page, 'most_human', 'c');
    ok(await vis(page, 'most_reason'), 'most_human=c → 이유 문항 표시');
    await pick(page, 'most_reason', 'words'); await pick(page, 'most_reason', 'other');
    ok(await vis(page, 'most_reason_other'), '기타 선택 시 직접 입력 표시');
    await page.fill('[name="most_reason_other"]', '=기타 이유');
    await pick(page, 'most_human', 'none');
    ok(!(await vis(page, 'most_reason')) && !(await vis(page, 'most_reason_other')), 'most_human=none → 이유 문항 숨김');
    await pick(page, 'most_human', 'c');
    await page.fill('[name="why_human"]', '움직임이 자연스러워서');
    await next(page);
    await submitInfo(page);
    await page.waitForSelector('#contactForm');
    const r = respRows()[0]; const g = n => r[COLS.indexOf(n)];
    ok(g('b_exp') === 'none' && ['b_human', 'b_what', 'b_changed', 'b_first'].every(n => g(n) === ''), 'B 문항 값이 전송에서 빠짐');
    ok(g('c_human') === 2 && g('most_human') === 'c' && g('most_reason') === 'words; other', '복수 선택은 "; "로 이어짐');
    ok(g('most_reason_other') === "'=기타 이유", '= 로 시작하는 주관식은 수식 방지 처리');
    ok(g('why_human') === '움직임이 자연스러워서' && g('age') === '', '주관식 저장, 건너뛴 문항은 빈칸');
    await context.close(); }

  // 4, 5, 7
  console.log('4·5·7. A 조건 문항 / 해당 없음 / 미응답 안내');
  { resetSheets(); const { context, page } = await open();
    await start(page);
    await pick(page, 'b_exp', 'seen');
    await next(page);
    ok(await page.isVisible('#msg.warn') && (await title(page)).startsWith('B'), '척도를 비우고 다음 → 안내 한 번');
    ok((await page.textContent('#msg')).includes('답하지 않은 문항이 있어요. 그대로 넘어갈까요?'), '안내 문구');
    await next(page);
    ok((await title(page)).includes('5층 화면 속 존재들'), '다시 누르면 통과');
    await pick(page, 'c_exp', 'none'); await next(page);
    await pick(page, 'a_exp', 'tried');
    ok(await vis(page, 'a_did') && await vis(page, 'a_reluct') && await vis(page, 'a_quoted'), 'A 문항 표시');
    ok(!(await vis(page, 'a_first')), 'a_changed 답 전 a_first 숨김');
    await pick(page, 'a_changed', 'no'); ok(!(await vis(page, 'a_first')), 'a_changed=no → a_first 숨김');
    await pick(page, 'a_changed', 'yes'); ok(await vis(page, 'a_first'), 'a_changed=yes → a_first 표시');
    ok(!(await vis(page, 'a_person')) && !(await vis(page, 'a_other')), 'a_quoted 답 전 숨김');
    await pick(page, 'a_quoted', 'unsure'); ok(!(await vis(page, 'a_person')), 'a_quoted=unsure → 숨김');
    await pick(page, 'a_quoted', 'yes'); ok(await vis(page, 'a_person') && await vis(page, 'a_other'), 'a_quoted=yes → a_person, a_other 표시');
    await pick(page, 'a_did', 'talk'); await pick(page, 'a_did', 'knock'); await pick(page, 'a_did', 'na');
    const checked = () => page.$$eval('input[name="a_did"]:checked', els => els.map(e => e.value).join());
    ok(await checked() === 'na', '"해당 없음" 선택 시 다른 항목 해제');
    await pick(page, 'a_did', 'hand');
    ok(await checked() === 'hand', '다른 항목 선택 시 "해당 없음" 해제');
    // 360px 레이아웃
    const box = await page.$$eval('[data-q="a_human"] .scale label', els => els.map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height, r.top]; }));
    ok(box.length === 7 && box.every(b => b[0] >= 40 && b[1] >= 40) && new Set(box.map(b => b[2])).size === 1, '7점 척도: 한 줄, 터치 영역 40px 이상 (' + Math.round(box[0][0]) + '×' + Math.round(box[0][1]) + ')');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), '가로 스크롤 없음');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'a.png'), fullPage: true });
    await context.close(); }

  // 8
  console.log('8. 제출 연타 / 새로고침 후 재전송');
  { resetSheets(); const { context, page } = await open();
    await allNoneToInfo(page);
    await pick(page, 'age', '30s'); await pick(page, 'ai_use', 'weekly');
    await page.evaluate(() => { const b = document.getElementById('next'); b.click(); b.click(); b.click(); });
    await page.waitForSelector('#contactForm');
    ok(respRows().length === 1 && posts.length === 1, '연타해도 한 번만 전송, 1행');
    await context.close();

    resetSheets(); const o = await open(); const p2 = o.page;
    await allNoneToInfo(p2);
    await pick(p2, 'age', '40s'); await pick(p2, 'ai_use', 'never');
    // 서버에는 저장됐지만 응답이 끊긴 상황
    await p2.route('**/exec', async route => { await route.fetch(); await route.abort(); });
    await next(p2);
    await p2.waitForSelector('#msg.warn:has-text("다시 보내는 중")');
    ok(respRows().length === 1, '서버에는 저장됨');
    await p2.unroute('**/exec');
    await p2.reload();
    ok(await title(p2) === '기본 정보' && await p2.isChecked('input[name="age"][value="40s"]'), '새로고침 후 답안 복원');
    await next(p2);
    await p2.waitForSelector('#contactForm');
    ok(respRows().length === 1 && posts.length >= 2, '재전송해도 시트에 한 행만 (전송 ' + posts.length + '회)');
    await o.context.close(); }

  // 9
  console.log('9. 네트워크 끊고 제출');
  { resetSheets(); const { context, page } = await open();
    await allNoneToInfo(page);
    await pick(page, 'age', '10s'); await pick(page, 'ai_use', 'rarely');
    await context.setOffline(true);
    const t0 = Date.now();
    await next(page);
    await page.waitForSelector('#next:has-text("다시 보내기")', { timeout: 40000 });
    const el = (Date.now() - t0) / 1000;
    ok(el >= 16.5 && el < 25, '2·5·10초 재시도 후 "다시 보내기" 표시 (' + el.toFixed(1) + '초)');
    ok(await page.isChecked('input[name="age"][value="10s"]') && respRows().length === 0, '답안 유지, 저장 없음');
    await context.setOffline(false);
    await next(page);
    await page.waitForSelector('#contactForm');
    ok(respRows().length === 1 && respRows()[0][COLS.indexOf('age')] === '10s', '연결 후 전송 성공');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'done.png'), fullPage: true });

    // 10, 11
    console.log('10·11. 연락처');
    const dis = () => page.isDisabled('#sendContact');
    ok(await dis(), '처음엔 전송 버튼 꺼짐');
    await page.fill('#contact', '=1+1'); await page.check('#agree');
    ok(await dis(), '추첨/인터뷰 미선택 → 꺼짐');
    await page.check('#raffle'); ok(!(await dis()), '조건 충족 → 켜짐');
    await page.uncheck('#agree'); ok(await dis(), '동의 해제 → 꺼짐');
    await page.check('#agree');
    await page.click('#sendContact');
    await page.waitForSelector('#contactDone');
    const c = sheets.contacts.rows;
    ok(respRows().length === 1 && c.length === 2, 'contacts에만 쌓임');
    ok(c[1][1] === "'=1+1", '=1+1 은 글자로 저장 (앞에 \' 붙음)');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(c[1][0]) && c[1][2] === 'Y' && c[1][3] === '' && c[1].length === 4, '날짜만 기록, raffle=Y');
    const sent = JSON.parse(posts[posts.length - 1].body);
    ok(!('response_id' in sent) && !posts[posts.length - 1].body.includes(respRows()[0][0]), '연락처 전송에 response_id 없음');
    await page.click('#restart');
    ok((await title(page)).includes('관람 설문') && !(await page.isChecked('input[name="consent"][value="yes"]')), '"새 응답 시작" → 초기화');
    await context.close();
    for (let i = 0; i < 8; i++) ctx.doPost({ postData: { contents: JSON.stringify({ kind: 'contact', contact: 'p' + i, interview: true }) } });
    const order = sheets.contacts.rows.slice(1).map(r => r[1]).filter(x => /^p\d$/.test(x)).join('');
    ok(sheets.contacts.rows.length === 10 && order !== 'p0p1p2p3p4p5p6p7', '행 위치 무작위 (' + order + ')');
    ok(sheets.contacts.rows[0].join() === 'date,contact,raffle,interview', '머리글 행 유지'); }

  // honeypot
  console.log('+ honeypot');
  { resetSheets();
    const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ kind: 'response', response_id: 'x', hp: 'bot', answers: {} }) } }).text);
    ok(r.ok === true && sheets.responses.rows.length === 0, 'hp가 채워진 요청은 저장 안 함'); }

  if (SHOTS) {
    const { context, page } = await open();
    await page.screenshot({ path: path.join(SHOTS, 'intro.png'), fullPage: true });
    await context.close();
  }
  await browser.close(); server.close();
  console.log(`\n통과 ${pass}, 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
