// handout.html → qr/handout-a4.pdf (A4 한 장).  node qr/make_handout.js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(root, 'handout.html'));
  const fits = await page.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollHeight <= s.clientHeight + 1 && s.scrollWidth <= s.clientWidth + 1; });
  if (!fits) { console.error('내용이 A4 한 장을 넘칩니다. 문구를 줄여 주세요.'); process.exit(1); }
  await page.pdf({ path: path.join(root, 'qr/handout-a4.pdf'), format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  if (process.argv[2]) await page.locator('.sheet').screenshot({ path: process.argv[2] });
  await browser.close();
  console.log('qr/handout-a4.pdf 만들었습니다');
})();
