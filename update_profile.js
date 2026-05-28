const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.NAUKRI_EMAIL;
const PASSWORD = process.env.NAUKRI_PASSWORD;

async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const locator of locators) {
        try {
            if (await locator.isVisible({ timeout: 3000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 3000 });
                } else if (actionType === 'fill') {
                    await locator.click({ timeout: 1500 }).catch(() => {});
                    await locator.focus({ timeout: 1500 }).catch(() => {});
                    await locator.fill('', { timeout: 1500 }).catch(() => {});
                    await locator.fill(value, { timeout: 3000 });
                }
                return true;
            }
        } catch (e) {}
    }
    console.log(`[Self-Healing Warning] Could not perform action: ${actionName}`);
    return false;
}

async function runProfileUpdater() {
    if (!EMAIL || !PASSWORD) {
        throw new Error("Missing NAUKRI_EMAIL or NAUKRI_PASSWORD environment variables.");
    }

    console.log("🚀 Starting Profile Updater...");

    const isHeadless = process.env.GITHUB_ACTIONS === 'true';
    const browser = await chromium.launch({ headless: isHeadless, slowMo: 1000 });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log("➡️  Navigating to Naukri login...");
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    try {
        await page.waitForSelector('#usernameField', { state: 'visible', timeout: 20000 });
    } catch (e) {
        console.log("⚠️ Input fields took too long to become visible. Retrying anyway...");
    }

    console.log("✍️ Filling email field...");
    const emailFilled = await resilientAction(page, 'Fill Email', [
        page.locator('#usernameField'),
        page.locator('input[placeholder*="Email" i]'),
        page.locator('input[placeholder*="Username" i]'),
        page.locator('input[name*="email" i]'),
        page.locator('input[name*="username" i]'),
        page.getByPlaceholder('Enter your active Email ID / Username')
    ], 'fill', EMAIL);
    console.log(emailFilled ? "✅ Email filled." : "❌ Failed to fill email.");

    console.log("✍️ Filling password field...");
    const passwordFilled = await resilientAction(page, 'Fill Password', [
        page.locator('#passwordField'),
        page.locator('input[placeholder*="Password" i]'),
        page.locator('input[name*="password" i]'),
        page.locator('input[type="password"]').first(),
        page.getByPlaceholder('Enter your password')
    ], 'fill', PASSWORD);
    console.log(passwordFilled ? "✅ Password filled." : "❌ Failed to fill password.");

    if (emailFilled && passwordFilled) {
        console.log("Pressing Enter to submit login...");
        await page.keyboard.press('Enter');
        try { await page.locator('button[type="submit"]').click({ timeout: 1000 }); } catch (e) { }
    }

    console.log("⏳ Waiting for login to complete... (Please solve CAPTCHA manually if prompted)");
    try {
        await page.waitForURL(/.*naukri.com\/(mnjuser\/homepage|jobs|mnjuser\/profile).*/, { timeout: 120000 });
        console.log("✅ Logged in successfully.");
    } catch (error) {
        console.log("⚠️  Could not automatically confirm login dashboard. Proceeding anyway...");
    }

    console.log("➡️  Navigating to Profile Page...");
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000); // let the profile data load

    console.log("🔍 Looking for Resume Headline...");
    const clickedEdit = await resilientAction(page, 'Edit Resume Headline', [
        page.locator('span:text-is("Resume headline")').locator('..').locator('.edit'),
        page.locator('.resumeHeadline .edit'),
        page.locator('div.widgetHead:has(span:has-text("Resume headline")) .edit'),
        page.locator('span:has-text("Resume headline")').locator('xpath=ancestor::div[1]//span[contains(@class, "edit")]')
    ]);

    if (!clickedEdit) {
        await browser.close();
        throw new Error("Could not open the Resume Headline edit modal.");
    }

    console.log("✅ Clicked Edit Resume Headline.");
    await page.waitForTimeout(2000); // Wait for modal to open
    
    const textArea = page.locator('textarea#resumeHeadlineTxt, textarea[placeholder*="Resume Headline"], form textarea').first();
    if (!(await textArea.isVisible({ timeout: 5000 }))) {
        await browser.close();
        throw new Error("Could not find the Resume Headline text area.");
    }

    let currentText = await textArea.inputValue();
    console.log(`📝 Current Headline: "${currentText}"`);
    
    if (!currentText) {
        await browser.close();
        throw new Error("Resume Headline is currently empty. Please add one manually first.");
    }

    currentText = currentText.trim();
    let newText = "";
    if (currentText.endsWith('.')) {
        newText = currentText.slice(0, -1); // Remove the dot
        console.log("🔄 Dot found at the end. Removing it to bump profile...");
    } else {
        newText = currentText + "."; // Add the dot
        console.log("🔄 No dot at the end. Adding one to bump profile...");
    }
    
    await textArea.fill(newText);
    await page.waitForTimeout(1000);
    
    // Click Save
    console.log("🔍 Looking for Save or Update button...");
    const clickedSave = await resilientAction(page, 'Save Headline', [
        page.locator('button:has-text("Save")'),
        page.locator('button:has-text("Save ")'),
        page.locator('button:has-text("SAVE")'),
        page.locator('button:has-text("Update")'),
        page.locator('button:has-text("UPDATE")'),
        page.locator('text="Save"').locator('visible=true').last(),
        page.locator('form button').first()
    ]);

    if (!clickedSave) {
        await browser.close();
        throw new Error("Could not find or click the Save button.");
    }

    await page.waitForTimeout(2000); // User requested 2 second wait
    console.log("🎉 Successfully updated Resume Headline! Your profile is now bumped to active.");

    console.log("Closing browser...");
    await page.waitForTimeout(1000);
    await browser.close();
}

const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function startLoop() {
    const isCI = process.env.GITHUB_ACTIONS === 'true';
    const isOnce = process.argv.includes('--once');
    
    if (isOnce || isCI) {
        try {
            await runProfileUpdater();
            console.log("Exiting with status 0.");
            process.exit(0);
        } catch (err) {
            console.error("❌ Error in runProfileUpdater:", err.message);
            process.exit(1);
        }
    }
    while (true) {
        try {
            await runProfileUpdater();
        } catch (err) {
            console.error("❌ Error in runProfileUpdater loop iteration:", err.message);
        }
        console.log(`🕒 Profile Updater loop active. Updating again in 2 hours...`);
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }
}

startLoop().catch(console.error);
