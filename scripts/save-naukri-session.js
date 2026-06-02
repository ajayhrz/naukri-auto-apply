#!/usr/bin/env node
/**
 * Log in once in a visible browser and save cookies for automated runs.
 * Usage: node scripts/save-naukri-session.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
    launchNaukriBrowser,
    createNaukriContext,
    loginWithCredentials,
    saveStorageState,
    getStorageStatePath,
} = require('../lib/naukri_auth');

async function main() {
    const email = process.env.NAUKRI_EMAIL;
    const password = process.env.NAUKRI_PASSWORD;
    if (!email || !password) {
        console.error('Set NAUKRI_EMAIL and NAUKRI_PASSWORD in .env first.');
        process.exit(1);
    }

    process.env.PLAYWRIGHT_HEADLESS = 'false';
    const browser = await launchNaukriBrowser();
    const context = await createNaukriContext(browser);
    const page = await context.newPage();

    try {
        await loginWithCredentials(page, email, password);
        await saveStorageState(context);
        console.log(`\n✅ Session saved to ${getStorageStatePath()}`);
        console.log('Optional: upload this file to Jenkins as secret file NAUKRI_STORAGE_STATE');
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
