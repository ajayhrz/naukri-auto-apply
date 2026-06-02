const {
    launchNaukriBrowser,
    createNaukriContext,
    ensureNaukriLogin,
    saveStorageState,
} = require('./lib/naukri_auth');
require('dotenv').config();

const EMAIL = process.env.NAUKRI_EMAIL;
const PASSWORD = process.env.NAUKRI_PASSWORD;

async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const locator of locators) {
        try {
            if (await locator.isVisible({ timeout: 5000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 5000 });
                } else if (actionType === 'fill') {
                    await locator.click({ timeout: 2000 }).catch(() => {});
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

async function runProfileUpdater() {
    console.log('🚀 Starting Profile Updater...');

    const browser = await launchNaukriBrowser();
    const context = await createNaukriContext(browser);
    const page = await context.newPage();

    try {
        await ensureNaukriLogin(page, context, { email: EMAIL, password: PASSWORD });

        console.log('➡️  Navigating to Profile Page...');
        await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        console.log('🔍 Looking for Resume Headline...');
        const clickedEdit = await resilientAction(page, 'Edit Resume Headline', [
            page.locator('span:text-is("Resume headline")').locator('..').locator('.edit'),
            page.locator('.resumeHeadline .edit'),
            page.locator('div.widgetHead:has(span:has-text("Resume headline")) .edit'),
            page.locator('span:has-text("Resume headline")').locator('xpath=ancestor::div[1]//span[contains(@class, "edit")]'),
        ]);

        if (!clickedEdit) {
            throw new Error('Could not open the Resume Headline edit modal.');
        }

        console.log('✅ Clicked Edit Resume Headline.');
        await page.waitForTimeout(2000);

        const textArea = page
            .locator('textarea#resumeHeadlineTxt, textarea[placeholder*="Resume Headline"], form textarea')
            .first();
        if (!(await textArea.isVisible({ timeout: 5000 }))) {
            throw new Error('Could not find the Resume Headline text area.');
        }

        let currentText = await textArea.inputValue();
        console.log(`📝 Current Headline: "${currentText}"`);

        if (!currentText) {
            throw new Error('Resume Headline is currently empty. Please add one manually first.');
        }

        currentText = currentText.trim();
        let newText = '';
        if (currentText.endsWith('.')) {
            newText = currentText.slice(0, -1);
            console.log('🔄 Dot found at the end. Removing it to bump profile...');
        } else {
            newText = currentText + '.';
            console.log('🔄 No dot at the end. Adding one to bump profile...');
        }

        await textArea.fill(newText);
        await page.waitForTimeout(1000);

        console.log('🔍 Looking for Save or Update button...');
        const clickedSave = await resilientAction(page, 'Save Headline', [
            page.locator('button:has-text("Save")'),
            page.locator('button:has-text("Save ")'),
            page.locator('button:has-text("SAVE")'),
            page.locator('button:has-text("Update")'),
            page.locator('button:has-text("UPDATE")'),
            page.locator('text="Save"').locator('visible=true').last(),
            page.locator('form button').first(),
        ]);

        if (!clickedSave) {
            throw new Error('Could not find or click the Save button.');
        }

        await page.waitForTimeout(2000);
        console.log('🎉 Successfully updated Resume Headline! Your profile is now bumped to active.');

        await saveStorageState(context);
    } finally {
        await page.waitForTimeout(1000).catch(() => {});
        await browser.close();
    }
}

const INTERVAL_MS = 1 * 60 * 60 * 1000;

async function startLoop() {
    if (process.argv.includes('--once')) {
        try {
            await runProfileUpdater();
            console.log('Exiting with status 0.');
            process.exit(0);
        } catch (err) {
            console.error('❌ Error in runProfileUpdater:', err.message);
            process.exit(1);
        }
    }

    while (true) {
        try {
            await runProfileUpdater();
        } catch (err) {
            console.error('❌ Error in runProfileUpdater loop iteration:', err.message);
        }
        console.log('🕒 Profile Updater loop active. Updating again in 1 hour...');
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
}

startLoop().catch(console.error);
