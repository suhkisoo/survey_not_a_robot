// handout.html → qr/handout-a4.pdf (A4, 앞면·뒷면 두 쪽).   node qr/make_handout.js [미리보기 PNG를 둘 폴더]
// 글꼴이 다 실렸는지, 내용이 쪽을 넘치지 않는지 확인한 뒤에만 PDF를 만든다.
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 3 });
  await page.goto('file://' + path.join(root, 'handout.html'));
  await page.evaluate(() => document.fonts.ready);

  const report = await page.evaluate(() => {
    const need = ['400 10px Pretendard', '500 10px Pretendard', '600 10px Pretendard', '800 10px Pretendard', '900 10px Pretendard',
      '400 10px MaruBuri', '600 10px MaruBuri', '700 10px MaruBuri'];
    const missing = need.filter(f => !document.fonts.check(f, '가A'));
    const pages = Array.from(document.querySelectorAll('.page')).map(p => {
      const box = p.getBoundingClientRect();
      // 쪽 안쪽 여백(padding)까지 넘어간 요소가 있는지 본다
      const pad = parseFloat(getComputedStyle(p).paddingBottom);
      let worst = 0;
      p.querySelectorAll('*').forEach(el => {
        if (el.closest('[aria-hidden="true"]')) return;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) worst = Math.max(worst, r.bottom - (box.bottom - pad), r.right - (box.right - pad));
      });
      return Math.round(worst * 10) / 10;
    });
    return { missing, pages };
  });
  if (report.missing.length) { console.error('글꼴이 실리지 않았습니다:', report.missing.join(', ')); process.exit(1); }
  const over = report.pages.map((v, i) => [i + 1, v]).filter(x => x[1] > 0.5);
  if (over.length) { console.error('내용이 여백을 넘칩니다(쪽, px):', JSON.stringify(over)); if (!process.env.FORCE) process.exit(1); }

  await page.pdf({ path: path.join(root, 'qr/handout-a4.pdf'), preferCSSPageSize: true, printBackground: true });
  const dir = process.argv[2];
  if (dir) {
    const sheets = page.locator('.page');
    for (let i = 0; i < await sheets.count(); i++) await sheets.nth(i).screenshot({ path: path.join(dir, `handout-${i + 1}.png`) });
  }
  await browser.close();
  console.log('qr/handout-a4.pdf 만들었습니다 (' + report.pages.length + '쪽)');
})();
