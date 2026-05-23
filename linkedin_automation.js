const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;

async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const locator of locators) {
        try {
            if (await locator.isVisible({ timeout: 5000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 5000 });
                } else if (actionType === 'fill') {
                    await locator.click({ timeout: 2000 }).catch(() => {});
                    await locator.focus({ timeout: 2000 }).catch(() => {});
                    await locator.fill('', { timeout: 2000 }).catch(() => {});
                    await locator.fill(value, { timeout: 5000 });
                }
                return true;
            }
        } catch (e) {}
    }
    console.log(`[Self-Healing Warning] Could not perform action: ${actionName}`);
    return false;
}

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
        await page.waitForTimeout(4000);

        // Fill credentials using self-healing actions
        console.log("✍️ Entering email...");
        const emailFilled = await resilientAction(page, 'Fill Email', [
            page.locator('#username'),
            page.locator('#session_key'),
            page.locator('input[name="session_key"]'),
            page.locator('input[type="email"]'),
            page.locator('input[placeholder*="Email" i]')
        ], 'fill', EMAIL);

        console.log("✍️ Entering password...");
        const passwordFilled = await resilientAction(page, 'Fill Password', [
            page.locator('#password'),
            page.locator('#session_password'),
            page.locator('input[name="session_password"]'),
            page.locator('input[type="password"]')
        ], 'fill', PASSWORD);

        if (emailFilled && passwordFilled) {
            console.log("Pressing Sign In...");
            const clickedSignIn = await resilientAction(page, 'Click Sign In', [
                page.locator('button[type="submit"]'),
                page.locator('.btn__primary--large'),
                page.locator('button:has-text("Sign in")'),
                page.locator('button:has-text("Sign In")')
            ], 'click');
        } else {
            console.log("❌ Email or Password field was not successfully filled.");
        }

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
