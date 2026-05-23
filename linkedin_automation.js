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
                    await locator.click({ timeout: 2000 }).catch(() => {});
                    await locator.focus({ timeout: 2000 }).catch(() => {});
                    await locator.fill('', { timeout: 2000 }).catch(() => {});
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

async function commentOnRelevantPosts(page) {
    console.log("🔍 Scanning search result posts for software testing openings...");
    
    // Find all post containers on LinkedIn search results page
    const posts = await page.locator('.reusable-search__result-container, [data-urn], article, .search-results-container li').all();
    console.log(`📊 Found ${posts.length} potential post cards on page.`);

    let commentedCount = 0;

    for (let i = 0; i < posts.length; i++) {
        try {
            const post = posts[i];
            if (!(await post.isVisible())) continue;

            // Extract post text content to inspect
            const postText = await post.innerText().catch(() => '');
            const textLower = postText.toLowerCase();

            // Check if it matches Software Testing and is an opening/hiring post
            const isTestingRelated = textLower.includes('testing') || textLower.includes('qa ') || textLower.includes('sdet') || textLower.includes('quality assurance');
            const isHiringRelated = textLower.includes('hiring') || textLower.includes('opening') || textLower.includes('vacancy') || textLower.includes('looking for') || textLower.includes('recruiting') || textLower.includes('job');

            if (isTestingRelated && isHiringRelated) {
                console.log(`\n📌 Found Matching Post (${i+1}): "${postText.substring(0, 120).replace(/\n/g, ' ')}..."`);

                // Find the Comment button within this post card
                const commentBtn = post.locator('button:has-text("Comment"), button[aria-label*="Comment"], button.comment-button, button.artdeco-button:has-text("Comment")').first();
                
                if (await commentBtn.isVisible({ timeout: 3000 })) {
                    console.log("💬 Clicking Comment button...");
                    await commentBtn.click({ force: true });
                    await page.waitForTimeout(2000);

                    // Find comment text area editor (LinkedIn uses Quill ql-editor or div[role="textbox"])
                    const commentInput = post.locator('div.ql-editor, div[role="textbox"], textarea, [aria-placeholder*="comment"]').first();
                    
                    if (await commentInput.isVisible({ timeout: 4000 })) {
                        console.log("✍️ Typing comment: \"Interested\"...");
                        await commentInput.focus();
                        await commentInput.fill("Interested");
                        await page.waitForTimeout(1500);

                        // Find the Post/Submit button
                        const postSubmitBtn = post.locator('button:has-text("Post"), button.comments-comment-box__submit-button, button[type="submit"]').first();
                        if (await postSubmitBtn.isVisible({ timeout: 3000 })) {
                            console.log("🚀 Clicking Post button...");
                            await postSubmitBtn.click();
                            commentedCount++;
                            console.log("✅ Comment posted successfully!");
                            
                            // Delay to act like a human and avoid anti-bot block
                            const delay = Math.floor(Math.random() * 5000) + 5000; // 5-10 seconds pause
                            console.log(`⏳ Pausing for ${delay/1000} seconds to prevent bot flagging...`);
                            await page.waitForTimeout(delay);
                        } else {
                            console.log("⚠️ Could not locate Post button.");
                        }
                    } else {
                        console.log("⚠️ Could not locate Comment input field.");
                    }
                } else {
                    console.log("ℹ️ Comment button is not visible or comments are disabled for this post.");
                }
            }
        } catch (err) {
            console.log(`⚠️ Error processing post ${i+1}:`, err.message);
        }
    }
    console.log(`\n🎉 Content scan complete. Commented on ${commentedCount} matching posts.`);
}

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide LINKEDIN_EMAIL and LINKEDIN_PASSWORD in your .env file.");
        return;
    }

    console.log("🚀 Starting Playwright LinkedIn Automation with Persistent Context...");

    // Launch persistent Chrome context to keep cookies/session state
    const context = await chromium.launchPersistentContext('./linkedin-user-data', {
        headless: false,
        channel: 'chrome', // Use real Google Chrome to avoid playwright-specific fingerprinting
        viewport: null, // Let it use native viewport
        args: [
            '--disable-blink-features=AutomationControlled', // Disable navigator.webdriver flag
            '--start-maximized'
        ]
    });

    const page = context.pages()[0] || await context.newPage();

    try {
        // Step 1: Check if already logged in from a previous session
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
            const loginFormLoaded = await page.waitForSelector('#username, #session_key, input[name="session_key"], input[type="email"]', { state: 'visible', timeout: 15000 }).catch(() => null);
            if (!loginFormLoaded) {
                console.log("⚠️ Login form took too long to load. Saving screenshot to debug...");
                await page.screenshot({ path: 'linkedin_login_error.png' }).catch(() => {});
                console.log("📸 Screenshot saved to 'linkedin_login_error.png'. Proceeding with fallback detection...");
            }

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
                    const currentUrl = page.url();
                    
                    // If we reached feed or jobs, we are logged in!
                    if (/.*linkedin.com\/(feed|jobs).*/.test(currentUrl)) {
                        loggedIn = true;
                        break;
                    }

                    // If checkpoint is detected, print helpful warning every 15 seconds
                    if (currentUrl.includes('/checkpoint/') && (Date.now() - lastAlertTime > 15000)) {
                        console.log("⚠️ LinkedIn Security Challenge detected! Please check your LinkedIn app and tap YES (or solve the challenge manually)...");
                        lastAlertTime = Date.now();
                    }

                    await page.waitForTimeout(2000); // Check every 2 seconds
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

        // Wait 5 seconds as requested
        console.log("⏳ Waiting for 5 seconds...");
        await page.waitForTimeout(5000);

        // Navigate to Jobs portal
        console.log("➡️ Navigating to LinkedIn Jobs...");
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        // Search for recent posts based on JOB_KEYWORD
        const keyword = process.env.JOB_KEYWORD || "Software Testing";
        console.log(`🔍 Searching LinkedIn for recent posts on: "${keyword}"...`);
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=FACETED_SEARCH&sortBy=%22date_posted%22`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(6000);

        // Run the commenting automation
        await commentOnRelevantPosts(page);

        console.log("🎯 Automation template initialized. You can now use the active session page to scan and apply for jobs.");
    } catch (error) {
        console.error("❌ Error during LinkedIn automation run:", error.message);
    } finally {
        // Keep the browser open for 15 seconds so you can see the active page before closing
        console.log("⏳ Keeping browser open for 15 seconds...");
        await page.waitForTimeout(15000);
        await context.close();
        console.log("Browser closed. Run completed.");
    }
}

run().catch(console.error);
