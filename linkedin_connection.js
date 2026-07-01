const { chromium } = require('playwright');
require('dotenv').config();

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;

async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const rawLocator of locators) {
        try {
            const locator = rawLocator.first();
            if (await locator.isVisible({ timeout: 5000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 5000 });
                } else if (actionType === 'fill') {
                    await locator.click({ timeout: 2000 }).catch(() => { });
                    await locator.focus({ timeout: 2000 }).catch(() => { });
                    await locator.fill('', { timeout: 2000 }).catch(() => { });
                    await locator.fill(value, { timeout: 5000 });
                }
                return true;
            }
        } catch (e) {
            console.log(`[Self-Healing Debug] Locator error for ${actionName}: ${e.message}`);
        }
    }
    console.log(`[Self-Healing Warning] Could not perform action: ${actionName}`);
    return false;
}

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide LINKEDIN_EMAIL and LINKEDIN_PASSWORD in the .env file.");
        process.exit(1);
    }

    console.log("🚀 Starting Playwright LinkedIn Connection Assistant...");

    const isHeadless = true; // process.env.PLAYWRIGHT_HEADLESS === 'true';
    const userDataDir = process.env.LINKEDIN_USER_DATA_DIR || './linkedin-user-data';
    console.log(`Launching browser: headless=${isHeadless}, userDataDir=${userDataDir}`);

    const launchOptions = {
        headless: isHeadless,
        viewport: isHeadless ? { width: 1280, height: 720 } : null,
        args: [
            '--disable-blink-features=AutomationControlled'
        ]
    };

    if (!isHeadless) {
        launchOptions.channel = 'chrome';
        launchOptions.args.push('--start-maximized');
    }

    // Launch persistent Chrome context to keep cookies/session state
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = context.pages()[0] || await context.newPage();

    let connectedCount = 0;
    const targetCount = 100;

    try {
        // Step 1: Check session state
        console.log("➡️ Checking session state...");
        await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        let currentUrl = page.url();
        let isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/signup') && !currentUrl.includes('/checkpoint');

        if (isLoggedIn) {
            console.log("🎉 Session verified! Already logged into LinkedIn.");
        } else {
            console.log("ℹ️ No active session found. Initiating secure login flow...");
            await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(4000);

            // Wait for the login form to load
            console.log("⏳ Waiting for login page form fields to be visible...");
            await page.waitForSelector('#username, #session_key, input[name="session_key"], input[type="email"]', { state: 'visible', timeout: 15000 }).catch(() => null);

            // Fill credentials using self-healing actions
            console.log("✍️ Entering email...");
            const emailFilled = await resilientAction(page, 'Fill Email', [
                page.locator('#username'),
                page.locator('#session_key'),
                page.locator('input[name="session_key"]'),
                page.locator('input[type="email"]')
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
                await resilientAction(page, 'Click Sign In', [
                    page.locator('button[type="submit"]'),
                    page.locator('.btn__primary--large'),
                    page.locator('button:has-text("Sign in")'),
                    page.locator('button:has-text("Sign In")')
                ], 'click');
            } else {
                console.log("❌ Email or Password field was not successfully filled.");
            }

            // Allow time for manual multi-factor authentication or captcha verification if requested
            console.log("⏳ Waiting for login confirmation (please log in or solve any challenges manually in the browser window)...");
            try {
                const startTime = Date.now();
                const maxWaitTime = 300000; // 5 minutes
                let loggedIn = false;
                let lastAlertTime = 0;

                while (Date.now() - startTime < maxWaitTime) {
                    const checkUrl = page.url();
                    if (/.*linkedin.com\/(feed|jobs|in|messaging|search).*/.test(checkUrl)) {
                        loggedIn = true;
                        break;
                    }
                    if (checkUrl.includes('/checkpoint/') && (Date.now() - lastAlertTime > 15000)) {
                        console.log("⚠️ LinkedIn Security Challenge detected! Please check your LinkedIn app and tap YES (or solve the challenge manually)...");
                        lastAlertTime = Date.now();
                    }
                    await page.waitForTimeout(2000);
                }

                if (loggedIn) {
                    console.log("✅ Successfully logged in and verified.");
                } else {
                    console.log("⚠️ Did not confirm login automatically within 5 minutes. Proceeding anyway...");
                }
            } catch (e) {
                console.log("⚠️ Error checking login status: " + e.message);
            }
        }

        // Wait 5 seconds to throttle request
        await page.waitForTimeout(5000);

        console.log("➡️ Navigating to My Network...");
        // Click over the my networks button
        const myNetworkClicked = await resilientAction(page, 'Click My Network', [
            page.locator('a[href*="/mynetwork/"]'),
            page.locator('span[title="My Network"]'),
            page.locator('a:has-text("My Network")')
        ], 'click');
        
        if (!myNetworkClicked) {
             console.log("⚠️ Could not click My Network button, falling back to direct navigation...");
             await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        }
        
        await page.waitForTimeout(5000);

        console.log("🔍 Scanning network suggestions dynamically...");
        
        let noNewButtonsCount = 0;
        
        while (connectedCount < targetCount && noNewButtonsCount < 10) {
            const connectButtons = await page.locator('button').all();
            let newValidButtonsFound = false;
            
            for (let i = 0; i < connectButtons.length; i++) {
                if (connectedCount >= targetCount) break;

                try {
                    const btn = connectButtons[i];
                    if (!(await btn.isVisible().catch(() => false))) continue;

                    // Skip if we already processed this button
                    const isProcessed = await btn.evaluate(el => el.getAttribute('data-processed')).catch(() => null);
                    if (isProcessed === "true") continue;
                    
                    // Mark as processed
                    await btn.evaluate(el => el.setAttribute('data-processed', 'true')).catch(() => {});

                    const btnText = await btn.innerText().catch(() => '');
                    if (!btnText.toLowerCase().includes('connect')) continue;

                    const cardText = await btn.evaluate(el => {
                        const card = el.closest('li') || el.closest('.discover-entity-type-card') || el.closest('.artdeco-card') || el.parentElement.parentElement.parentElement;
                        return card ? card.innerText : '';
                    }).catch(() => '');

                    const textLower = cardText.toLowerCase();
                    const hasBackground = textLower.includes('qa') || textLower.includes('software testing') || textLower.includes('quality assurance') || textLower.includes('tester');
                    const isFromIndia = textLower.includes('india');

                    if (hasBackground && !isFromIndia) {
                        newValidButtonsFound = true;
                        console.log(`\n👉 Found matching profile:\n${cardText.split('\\n')[0]} - ${cardText.split('\\n')[1] || ''}`);
                        
                        await btn.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
                        await page.waitForTimeout(1000);
                        
                        await btn.click();
                        console.log(`✅ Sent connection request.`);
                        connectedCount++;

                        const sendWithoutNoteBtn = page.locator('button:has-text("Send without a note"), button[aria-label="Send without a note"]').first();
                        const sendConfirmBtn = page.locator('button:has-text("Send"), button[aria-label="Send"]').first();

                        let modalOpened = false;
                        for (let attempt = 0; attempt < 5; attempt++) {
                            if (await sendWithoutNoteBtn.isVisible().catch(() => false) || await sendConfirmBtn.isVisible().catch(() => false)) {
                                modalOpened = true;
                                break;
                            }
                            await page.waitForTimeout(500);
                        }

                        if (modalOpened) {
                            if (await sendWithoutNoteBtn.isVisible().catch(() => false)) {
                                await sendWithoutNoteBtn.click();
                            } else if (await sendConfirmBtn.isVisible().catch(() => false)) {
                                await sendConfirmBtn.click();
                            }
                        }

                        const limitDialog = page.locator('div[role="dialog"], [class*="modal"], [class*="dialog"]');
                        const dialogTexts = await limitDialog.allInnerTexts().catch(() => []);
                        const limitReached = dialogTexts.some(text =>
                            text.toLowerCase().includes('limit') &&
                            (text.toLowerCase().includes('reached') || text.toLowerCase().includes('weekly') || text.toLowerCase().includes('out of connection'))
                        );
                        if (limitReached) {
                            console.log("🛑 LinkedIn Weekly Connection Limit reached! Stopping execution.");
                            break;
                        }

                        const randomDelay = Math.floor(Math.random() * 3000) + 2000;
                        console.log(`⏳ Waiting for ${randomDelay / 1000} seconds...`);
                        await page.waitForTimeout(randomDelay);
                    }
                } catch (err) {
                    console.log(`❌ Error evaluating button: ${err.message}`);
                }
            }

            const limitDialog = page.locator('div[role="dialog"], [class*="modal"], [class*="dialog"]');
            const dialogTexts = await limitDialog.allInnerTexts().catch(() => []);
            const limitReached = dialogTexts.some(text =>
                text.toLowerCase().includes('limit') &&
                (text.toLowerCase().includes('reached') || text.toLowerCase().includes('weekly') || text.toLowerCase().includes('out of connection'))
            );
            if (limitReached) {
                break;
            }

            if (connectedCount < targetCount) {
                console.log("⬇️ Scrolling to load more suggestions...");
                for (let s = 0; s < 5; s++) {
                    await page.evaluate(() => window.scrollBy(0, 1500));
                    await page.waitForTimeout(1500);
                }
                
                if (!newValidButtonsFound) {
                    noNewButtonsCount++;
                } else {
                    noNewButtonsCount = 0;
                }
            }
        }

        console.log(`\n🎉 Connection Run Finished. Sent connection invitations to ${connectedCount} people.`);
    } catch (error) {
        console.error("❌ Error during LinkedIn connection automation run:", error.message);
    } finally {
        const waitTime = isHeadless ? 1000 : 15000;
        console.log(`⏳ Keeping browser open for ${waitTime / 1000} seconds...`);
        try {
            await page.waitForTimeout(waitTime).catch(() => { });
            await context.close().catch(() => { });
        } catch (e) { }
        console.log("Browser closed. Run completed.");
    }
}

run().catch(err => {
    console.error("❌ Uncaught exception:", err);
    process.exit(1);
});
