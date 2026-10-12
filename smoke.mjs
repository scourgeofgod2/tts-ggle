import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (err) => console.error('PAGEERROR', err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE', msg.text())
})
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
const body = await page.locator('body').innerText()
console.log('--- BODY ---')
console.log(body.slice(0, 2000))
await page.screenshot({ path: 'ui-smoke.png', fullPage: true })
console.log('--- SCREENSHOT SAVED ---')
await browser.close()
