const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide LINKEDIN_EMAIL and LINKEDIN_PASSWORD in your .env file.");
        return;
    }

    console.log("🚀 Starting Playwright LinkedIn Automation...");

    const browser = await chromium.launch({ headless: false, slowMo: 150 });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log("➡️ Navigating to LinkedIn login page...");
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Fill credentials
        console.log("✍️ Entering email...");
        await page.fill('#username', EMAIL);
        
        console.log("✍️ Entering password...");
        await page.fill('#password', PASSWORD);

        console.log("Pressing Sign In...");
        await page.click('button[type="submit"]');

        // Allow time for manual multi-factor authentication or captcha verification if requested
        console.log("⏳ Waiting for login confirmation (Please solve MFA/CAPTCHA manually if it appears)...");
        await page.waitForURL(/.*linkedin.com\/(feed|checkpoint).*/, { timeout: 60000 });

        console.log("✅ Successfully logged into LinkedIn feed.");

        // Navigate to Jobs portal
        console.log("➡️ Navigating to LinkedIn Jobs...");
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        console.log("🎯 Automation template initialized. You can now use the active session page to scan and apply for jobs.");
    } catch (error) {
        console.error("❌ Error during LinkedIn automation run:", error.message);
    } finally {
        // Keep the browser open for 15 seconds so you can see the active page before closing
        await page.waitForTimeout(15000);
        await browser.close();
        console.log("Browser closed. Run completed.");
    }
}

run().catch(console.error);
