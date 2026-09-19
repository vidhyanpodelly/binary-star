const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:8080/hidden-in-starlight/', { waitUntil: 'networkidle0' });
  await page.click('[data-panel="blackhole"]');
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'bh_new_screenshot.png' });
  await browser.close();
})();
