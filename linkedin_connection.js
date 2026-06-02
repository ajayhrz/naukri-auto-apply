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

    const isHeadless = process.env.PLAYWRIGHT_HEADLESS === 'true';
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
        console.log("➡️ Checking session state on LinkedIn homepage...");
        await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        let currentUrl = page.url();
        let isLoggedIn = /.*linkedin.com\/(feed|jobs|in|messaging|search).*/.test(currentUrl);

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

        // Wait 5 seconds to throttle requests
        await page.waitForTimeout(5000);

        // Search for software testing hiring managers/recruiters (People filter) with JNV school context
        const keyword = `"software testing" hiring ("jnv" OR "Navodaya" OR "Jawahar Navodaya")`;
        console.log(`🔍 Searching LinkedIn for people matching: "${keyword}"...`);
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(6000);

        const processedNames = new Set();
        let searchPageCount = 1;
        while (connectedCount < targetCount) {
            console.log(`\n📄 --- Processing Search Result Page ${searchPageCount} ---`);
            
            // Loop through Connect buttons dynamically on the current search page
            let pageHasButtons = true;
            let pageConnectCount = 0;

            while (pageHasButtons && connectedCount < targetCount) {
                // Find all potential Connect buttons fresh on each loop to avoid detachment errors
                const connectButtons = await page.locator('[aria-label^="Invite "][aria-label$="to connect"], [aria-label^="Connect with "]').all();
                
                let activeBtn = null;
                let cleanName = "Recruiter";
                
                // Scan primary buttons to find the first unprocessed one
                for (const btn of connectButtons) {
                    const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
                    let name = "Recruiter";
                    if (ariaLabel) {
                        const match = ariaLabel.match(/Invite (.*) to connect/i) || ariaLabel.match(/Connect with (.*)/i);
                        if (match) name = match[1].trim();
                    }
                    if (name === "Recruiter") {
                        name = await btn.evaluate(b => {
                            const card = b.closest('[role="listitem"], li, div[class*="result"], div[class*="card"]');
                            if (card) {
                                const titleLink = card.querySelector('a[href*="/in/"]');
                                if (titleLink) return titleLink.innerText.split('\n')[0].split('•')[0].trim();
                            }
                            return "Recruiter";
                        }).catch(() => "Recruiter");
                    }
                    
                    if (!processedNames.has(name)) {
                        activeBtn = btn;
                        cleanName = name;
                        break;
                    }
                }
                
                // Fallback to broader listitem buttons if no primary unprocessed buttons are found
                if (!activeBtn) {
                    const fallbackButtons = await page.locator('div[role="listitem"] button:has-text("Connect"), div[role="listitem"] a:has-text("Connect"), div[role="listitem"] [role="button"]:has-text("Connect")').all();
                    for (const btn of fallbackButtons) {
                        let name = await btn.evaluate(b => {
                            const card = b.closest('[role="listitem"], li, div[class*="result"], div[class*="card"]');
                            if (card) {
                                const titleLink = card.querySelector('a[href*="/in/"]');
                                if (titleLink) return titleLink.innerText.split('\n')[0].split('•')[0].trim();
                            }
                            return "Recruiter";
                        }).catch(() => "Recruiter");
                        
                        if (!processedNames.has(name)) {
                            activeBtn = btn;
                            cleanName = name;
                            break;
                        }
                    }
                }

                if (!activeBtn) {
                    if (pageConnectCount === 0) {
                        console.log("ℹ️ No Connect buttons found on this page.");
                    } else {
                        console.log("ℹ️ No more unprocessed Connect buttons found on this page.");
                    }
                    pageHasButtons = false;
                    break;
                }

                // Mark this profile as processed
                processedNames.add(cleanName);
                pageConnectCount++;

                try {
                    // Scroll the button into view
                    await activeBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
                    await page.waitForTimeout(1000);

                    // Check visibility again after scrolling
                    if (!(await activeBtn.isVisible())) {
                        continue;
                    }

                    console.log(`👉 Sending connection request to: ${cleanName}`);
                    
                    // Check if the button is already pending, sent or disabled
                    const buttonInfo = await activeBtn.evaluate(el => {
                        const text = (el.innerText || '').toLowerCase();
                        const label = (el.getAttribute('aria-label') || '').toLowerCase();
                        const isDisabled = el.hasAttribute('disabled') || el.classList.contains('disabled');
                        return { text, label, isDisabled };
                    }).catch(() => ({ text: '', label: '', isDisabled: false }));
                    
                    if (buttonInfo.isDisabled || 
                        buttonInfo.text.includes('pending') || 
                        buttonInfo.text.includes('withdraw') || 
                        buttonInfo.label.includes('pending') || 
                        buttonInfo.label.includes('withdraw')) {
                        console.log(`ℹ️ Connection request is already pending/sent or button is disabled for ${cleanName}. Skipping.`);
                        continue;
                    }

                    await activeBtn.click();
                    
                    // Wait for the modal buttons to be visible
                    const sendWithoutNoteBtn = page.locator('button:has-text("Send without a note"), button[aria-label="Send without a note"]').first();
                    const sendConfirmBtn = page.locator('button:has-text("Send"), button[aria-label="Send"]').first();
                    
                    let modalOpened = false;
                    for (let attempt = 0; attempt < 8; attempt++) {
                        if (await sendWithoutNoteBtn.isVisible() || await sendConfirmBtn.isVisible()) {
                            modalOpened = true;
                            break;
                        }
                        await page.waitForTimeout(500);
                    }

                    if (modalOpened) {
                        if (await sendWithoutNoteBtn.isVisible()) {
                            await sendWithoutNoteBtn.click();
                            console.log(`✅ Clicked "Send without a note" for ${cleanName}`);
                            connectedCount++;
                        } else if (await sendConfirmBtn.isVisible()) {
                            await sendConfirmBtn.click();
                            console.log(`✅ Clicked "Send" confirmation button for ${cleanName}`);
                            connectedCount++;
                        }
                    } else {
                        // Check if the button itself text changed to Pending or if it disappeared,
                        // meaning the invite was sent directly without a modal.
                        await page.waitForTimeout(1000);
                        const btnText = (await activeBtn.innerText().catch(() => '')) || '';
                        const btnLabel = (await activeBtn.getAttribute('aria-label').catch(() => '')) || '';
                        if (btnText.toLowerCase().includes('pending') || btnLabel.toLowerCase().includes('pending') || !(await activeBtn.isVisible())) {
                            console.log(`✅ Connection request sent directly (no modal) for ${cleanName}`);
                            connectedCount++;
                        } else {
                            console.log(`⚠️ Invitation modal not detected or resolved differently. Skipping.`);
                            // Hit escape to close any lingering modal safely
                            await page.keyboard.press('Escape').catch(() => {});
                        }
                    }

                    // Check for weekly invitation limit modal
                    const limitDialog = page.locator('div[role="dialog"], [class*="modal"], [class*="dialog"]');
                    const dialogTexts = await limitDialog.allInnerTexts().catch(() => []);
                    const limitReached = dialogTexts.some(text => 
                        text.toLowerCase().includes('limit') && 
                        (text.toLowerCase().includes('reached') || text.toLowerCase().includes('weekly') || text.toLowerCase().includes('out of connection'))
                    );
                    if (limitReached) {
                        console.log("🛑 LinkedIn Weekly Connection Limit reached! Stopping execution.");
                        await page.keyboard.press('Escape').catch(() => {});
                        break;
                    }

                    // Human-like delay between requests to remain safe (3 to 7 seconds)
                    const randomDelay = Math.floor(Math.random() * 4000) + 3000;
                    console.log(`⏳ Throttling: Waiting for ${randomDelay / 1000} seconds...`);
                    await page.waitForTimeout(randomDelay);
                } catch (cardError) {
                    console.log(`❌ Error processing Connect button: ${cardError.message}`);
                }
            }

            // Check if we hit the limit during card iteration or after
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
                // Scroll down to load the pagination bar
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(3000);

                // Locate the next pagination button
                const nextButton = page.locator('button[aria-label="Next"]').first();
                if (await nextButton.isVisible({ timeout: 4000 })) {
                    console.log("➡️ Navigating to the next search page...");
                    await nextButton.click();
                    searchPageCount++;
                    await page.waitForTimeout(6000); // Allow next page list to load fully
                } else {
                    console.log("ℹ️ Pagination next button is not visible or has reached the end of search results. Stopping.");
                    break;
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
            await page.waitForTimeout(waitTime).catch(() => {});
            await context.close().catch(() => {});
        } catch (e) {}
        console.log("Browser closed. Run completed.");
    }
}

run().catch(err => {
    console.error("❌ Uncaught exception:", err);
    process.exit(1);
});
