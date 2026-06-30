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

async function scrollAndClick(page, locator) {
    try {
        if (await locator.isVisible({ timeout: 5000 })) {
            await locator.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await page.waitForTimeout(500);
            await locator.click({ timeout: 5000 });
            return true;
        }
    } catch (e) {
        console.log(`[ScrollAndClick Error] ${e.message}`);
    }
    return false;
}

async function commentOnRelevantPosts(page, currentCommentedCount = 0, targetComments = 100) {
    console.log("🔍 Scanning search result posts for software testing openings...");

    const userName = "Ajay Mishra";
    let commentedCount = currentCommentedCount;
    let noNewPostsCount = 0;
    let refreshCount = 0;
    const maxNoNewPostsScrolls = 5; // Reduced from 15 to 5 so it switches countries much faster when feed is dry

    // We keep looping until we hit targetComments (no maximum scroll limit, we just refresh)
    while (commentedCount < targetComments) {
        // Wait for post elements or comment buttons to load
        await page.waitForSelector('button', { timeout: 8000 }).catch(() => null);

        // Find all comment buttons that are NOT marked processed yet
        const commentActionResults = await page.evaluate(() => {
            const results = [];

            // Find all buttons on the page
            const allBtns = Array.from(document.querySelectorAll('button'));
            const commentBtns = allBtns.filter(el => {
                const txt = el.innerText ? el.innerText.trim().toLowerCase() : '';
                const isComment = txt.includes('comment') || el.getAttribute('aria-label')?.toLowerCase().includes('comment');
                // Exclude submit buttons (which are inside the comment box editor or form)
                const isInsideEditor = el.closest('form, div.comments-comment-box, [data-test-comment-box], div.comments-comment-texteditor');

                // Exclude disabled buttons
                const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');

                return isComment && !isInsideEditor && !isDisabled && !el.getAttribute('data-processed');
            });

            const hiringKeywords = [
                'hiring', "we're hiring", 'looking for', 'opening', 'vacancy', 
                'job opening', 'requirement', 'recruit', 'open position', 
                'apply now', 'urgent requirement', 'immediate joiner'
            ];

            const qaKeywords = [
                'qa', 'q.a', 'quality assurance', 'software testing', 'software tester',
                'test engineer', 'test automation', 'automation testing', 'manual testing',
                'sdet', 'qa engineer', 'qa analyst', 'qa automation', 'selenium', 'playwright',
                'cypress', 'api testing', 'performance testing'
            ];

            // Things that indicate it's a DEV role post, not QA — even if "QA" is mentioned in passing
            const excludeKeywords = [
                'software engineer', 'software engineering', 'developer', 'frontend', 
                'backend', 'full stack', 'fullstack', 'open to work', 'devops engineer',
                'data engineer', 'product manager', 'ui/ux designer'
            ];

            function requiresMoreThan3Years(text) {
                const textLower = text.toLowerCase();
                const expRegex = /(\d+)\s*(?:\+|-|\s*to\s*\d+)?\s*(?:year|yr|exp)/gi;
                let match;
                let found = false;
                while ((match = expRegex.exec(textLower)) !== null) {
                    const years = parseInt(match[1], 10);
                    if (!isNaN(years) && years >= 3) {
                        found = true;
                    }
                }
                return found;
            }

            function isOwnPost(text) {
                if (text.includes('• You') || text.includes('•\nYou') || text.includes('\n• You')) {
                    return true;
                }
                if (/ajay\s+mishra[\s\S]{0,100}\b(you)\b/i.test(text)) {
                    return true;
                }
                return false;
            }

            for (let i = 0; i < commentBtns.length; i++) {
                const btn = commentBtns[i];
                // Mark this button as processed so we don't evaluate it again
                btn.setAttribute('data-processed', 'true');

                // Traverse up to find the post card container (which is a listitem or article or LI)
                let card = btn.parentElement;
                let postCard = null;
                let depth = 0;

                while (card && depth < 15) {
                    const role = card.getAttribute('role');
                    const tagName = card.tagName.toUpperCase();
                    const className = card.className || '';
                    if (role === 'listitem' ||
                        role === 'article' ||
                        tagName === 'LI' ||
                        tagName === 'ARTICLE' ||
                        className.includes('reusable-search__result-container') ||
                        className.includes('feed-shared-update-v2')) {
                        postCard = card;
                        break;
                    }
                    card = card.parentElement;
                    depth++;
                }

                // Fallback if no specific listitem is found
                if (!postCard) {
                    postCard = btn.parentElement?.parentElement?.parentElement?.parentElement || btn.parentElement;
                }

                const postText = postCard ? (postCard.innerText || '') : '';

                // Filter out own posts
                if (isOwnPost(postText)) {
                    continue;
                }

                const postTextLower = postText.toLowerCase();
                const isHiringPost = hiringKeywords.some(k => postTextLower.includes(k));
                const isQaPost = qaKeywords.some(k => postTextLower.includes(k));
                const isExcluded = excludeKeywords.some(k => postTextLower.includes(k));
                const hasExpRequirement = requiresMoreThan3Years(postText);

                if (isHiringPost && isQaPost && hasExpRequirement && !isExcluded) {
                    // Generate a unique dynamic ID for this specific run cycle
                    const uniqueId = `btn-${Date.now()}-${i}`;
                    btn.setAttribute('data-target-comment', uniqueId);
                    postCard.setAttribute('data-target-card', `card-${uniqueId}`);

                    results.push({
                        uniqueId: uniqueId,
                        matchedText: postText.substring(0, 120),
                        actionable: true
                    });
                }
            }
            return results;
        });

        let successfullyCommentedThisScan = false;

        if (commentActionResults.length > 0) {
            console.log(`📌 Found ${commentActionResults.length} matching posts in this scan (evaluating...).`);

            for (const action of commentActionResults) {
                if (commentedCount >= targetComments) break;

                try {
                    console.log(`\n📌 Commenting on dynamic post card: "${action.matchedText.replace(/\n/g, ' ')}..."`);

                    const cardContainer = page.locator(`[data-target-card="card-${action.uniqueId}"]`);
                    const commentBtn = cardContainer.locator(`[data-target-comment="${action.uniqueId}"]`);

                    if (await commentBtn.isVisible({ timeout: 5000 })) {
                        console.log("💬 Clicking Comment button...");
                        const commentBtnClicked = await scrollAndClick(page, commentBtn);

                        if (commentBtnClicked) {
                            await page.waitForTimeout(3000); // Allow comments section to load

                            // Check if already commented by the user
                            const alreadyCommented = await cardContainer.evaluate((card, user) => {
                                const activeInputContainer = card.querySelector('div.ql-editor, div[role="textbox"], textarea')?.closest('form, div.comments-comment-box, [data-test-comment-box]');

                                const authorElements = Array.from(card.querySelectorAll('a, span, p')).filter(el => {
                                    const text = el.innerText || '';
                                    return text.trim() === user || text.trim().toLowerCase().includes(user.toLowerCase());
                                });

                                const existingComments = authorElements.filter(el => {
                                    if (activeInputContainer && activeInputContainer.contains(el)) {
                                        return false;
                                    }
                                    let parent = el.parentElement;
                                    let inCommentSection = false;
                                    while (parent) {
                                        if (parent.tagName === 'FORM' || parent.getAttribute('contenteditable') === 'true' || parent.innerText.toLowerCase().includes('commenting as')) {
                                            return false;
                                        }
                                        if (parent.className.includes('comment') || parent.className.includes('reply') || parent.tagName === 'LI' || parent.getAttribute('role') === 'listitem') {
                                            inCommentSection = true;
                                        }
                                        parent = parent.parentElement;
                                    }
                                    return inCommentSection;
                                });
                                return existingComments.length > 0;
                            }, userName);

                            if (alreadyCommented) {
                                console.log("ℹ️ Already commented on this post. Skipping...");
                                // Close the comment box so it doesn't clutter the screen
                                await commentBtn.click({ timeout: 1000 }).catch(() => { });
                                await page.waitForTimeout(200);
                                continue;
                            }

                            const commentInput = cardContainer.locator('div.ql-editor, div[role="textbox"], textarea, [contenteditable="true"], [aria-placeholder*="comment"]').first();

                            if (await commentInput.isVisible({ timeout: 2000 })) {
                                console.log("✍️ Typing comment: \"Interested\"...");
                                await commentInput.evaluate(el => el.scrollIntoView({ block: 'center' }));
                                await page.waitForTimeout(100);
                                await commentInput.focus();
                                await commentInput.fill("Interested");
                                await page.waitForTimeout(300);

                                // Tag the submit button inside the active comment box
                                const submitBtnTagged = await cardContainer.evaluate((card) => {
                                    const input = card.querySelector('div.ql-editor, div[role="textbox"], textarea, [contenteditable="true"]');
                                    if (!input) return false;
                                    // Exclude comments-comment-texteditor as it is too narrow and doesn't contain the submit button
                                    const container = input.closest('form, div.comments-comment-box, [data-test-comment-box]') || card;
                                    const buttons = Array.from(container.querySelectorAll('button'));
                                    const submitBtn = buttons.find(btn => {
                                        // Exclude the comment toggle button which we tagged previously
                                        if (btn.getAttribute('data-target-comment')) {
                                            return false;
                                        }
                                        const txt = btn.innerText ? btn.innerText.trim().toLowerCase() : '';
                                        const aria = btn.getAttribute('aria-label') ? btn.getAttribute('aria-label').trim().toLowerCase() : '';
                                        return txt === 'comment' || txt === 'post' || txt === 'reply' ||
                                            aria === 'comment' || aria === 'post' || aria === 'reply';
                                    });
                                    if (submitBtn) {
                                        submitBtn.setAttribute('data-submit-btn', 'true');
                                        return true;
                                    }
                                    return false;
                                });

                                if (submitBtnTagged) {
                                    const postSubmitBtn = cardContainer.locator('[data-submit-btn="true"]');
                                    console.log("🚀 Clicking Post button...");
                                    const postBtnClicked = await scrollAndClick(page, postSubmitBtn);

                                    if (postBtnClicked) {
                                        // Verification step
                                        await page.waitForTimeout(1500);
                                        const verificationResult = await cardContainer.evaluate((card, user) => {
                                            // First check: has the input box been cleared?
                                            const activeInputBox = card.querySelector('div.ql-editor, div[role="textbox"], textarea, [contenteditable="true"]');
                                            if (activeInputBox) {
                                                const inputText = activeInputBox.innerText || '';
                                                if (inputText.includes('Interested')) {
                                                    return "FAILED_INPUT_NOT_CLEARED";
                                                }
                                            }

                                            // Second check: is there a comment element outside the editor containing 'Interested'?
                                            const elements = Array.from(card.querySelectorAll('p, span, div, li'));
                                            const foundInterested = elements.some(el => {
                                                if (activeInputBox && activeInputBox.contains(el)) {
                                                    return false;
                                                }
                                                const activeInputContainer = activeInputBox ? activeInputBox.closest('form, div.comments-comment-box, [data-test-comment-box]') : null;
                                                if (activeInputContainer && activeInputContainer.contains(el)) {
                                                    return false;
                                                }
                                                const text = el.innerText || '';
                                                return text.includes('Interested');
                                            });

                                            return foundInterested ? "SUCCESS" : "FAILED_NOT_FOUND_IN_DOM";
                                        }, userName);

                                        if (verificationResult === "SUCCESS") {
                                            commentedCount++;
                                            successfullyCommentedThisScan = true;
                                            noNewPostsCount = 0; // Reset scroll counter since we successfully commented!
                                            refreshCount = 0; // Reset refresh counter as well
                                            console.log(`✅ Comment posted and verified successfully! (Total: ${commentedCount}/${targetComments})`);
                                        } else {
                                            console.log(`⚠️ Comment verification failed: ${verificationResult}`);
                                        }

                                        // Human-like delay
                                        await page.waitForTimeout(500);
                                    } else {
                                        console.log("⚠️ Could not click Post button.");
                                    }
                                } else {
                                    console.log("⚠️ Could not locate Post button.");
                                }
                            } else {
                                console.log("⚠️ Could not locate Comment input field.");
                            }
                        } else {
                            console.log("⚠️ Comment button click action failed.");
                        }
                    } else {
                        console.log("⚠️ Comment button is not visible on page.");
                    }
                } catch (err) {
                    console.log(`⚠️ Error executing dynamic comment action:`, err.message);
                }
            }
        }
        
        if (!successfullyCommentedThisScan) {
            noNewPostsCount++;
            console.log(`⏳ No actionable posts found in this scan. Scrolling to load more... (Attempts: ${noNewPostsCount}/${maxNoNewPostsScrolls})`);
        }

        // Scroll down to the bottom
        console.log("⏬ Scrolling page down...");
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(2000);

        // LinkedIn Search Results are paginated. We need to click 'Next' to get more posts!
        const nextButton = page.locator('button[aria-label="Next"], button.artdeco-pagination__button--next').first();
        if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            const isDisabled = await nextButton.evaluate(btn => btn.disabled || btn.getAttribute('aria-disabled') === 'true');
            if (!isDisabled) {
                console.log("⏭️ Clicking 'Next' page button...");
                await nextButton.click();
                await page.waitForTimeout(5000); // Wait for next page to load
                noNewPostsCount = 0; // Reset since we are on a new page!
                continue; // Skip the infinite scroll logic below and evaluate the new page
            }
        }

        // Alternative scroll target for infinite scroll feeds
        await page.locator('button').last().scrollIntoViewIfNeeded().catch(() => { });

        // Wait for 4 seconds for new content to render/load
        console.log("⏳ Waiting 4 seconds for new posts to load into the feed...");
        await page.waitForTimeout(4000);

        // If we've scrolled too many times without finding new posts, the feed is likely exhausted.
        // We will reload the page to get a fresh feed instead of quitting!
        if (noNewPostsCount >= maxNoNewPostsScrolls) {
            refreshCount++;
            if (refreshCount > 1) { // Exactly 1 refresh allowed before changing country
                console.log(`🔄 Feed exhausted after 1 refresh. Moving to next country...`);
                return commentedCount;
            }
            console.log(`🔄 Reached max scrolls without new posts. Refreshing page to load fresh content...`);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            noNewPostsCount = 0; // Reset scroll counter after refreshing
        }
    }
    console.log(`\n🎉 Content scan complete. Commented on ${commentedCount} matching posts.`);
    return commentedCount;
}

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide LINKEDIN_EMAIL and LINKEDIN_PASSWORD in your .env file.");
        return;
    }

    console.log("🚀 Starting Playwright LinkedIn Automation with Persistent Context...");

    const isHeadless = false; // Turned off as requested to show browser
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

    // Listen to network requests to capture the comment posting API and payload
    page.on('request', request => {
        try {
            const url = request.url();
            if (request.method() === 'POST' && url.includes('/voyager/api/')) {
                const postData = request.postData();
                if (postData && postData.includes('Interested')) {
                    console.log(`\n======================================================`);
                    console.log(`🌐 [API CAPTURE] LinkedIn Comment API Hit!`);
                    console.log(`➡️ Endpoint URL: ${url}`);
                    console.log(`➡️ Payload: ${postData.substring(0, 600)}...`); // Logging first 600 chars of the payload
                    console.log(`======================================================\n`);
                }
            }
        } catch (e) { }
    });

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
                await page.screenshot({ path: 'linkedin_login_error.png' }).catch(() => { });
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

        const countries = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'Netherlands', 'Ireland', 'Singapore', 'UAE', 'India'];
        const dateFilters = ["past-week", "past-24h"];
        const baseKeyword = "software testing hiring";
        let totalCommented = 0;
        const targetComments = 100;

        for (const country of countries) {
            if (totalCommented >= targetComments) break;

            for (const dateFilter of dateFilters) {
                if (totalCommented >= targetComments) break;

                const keyword = `${baseKeyword} ${country}`;
                console.log(`\n======================================================`);
                console.log(`🔍 Searching LinkedIn for posts on: "${keyword}" (Date: ${dateFilter}, Sorted by: Top Match)...`);
                const searchUrl = `https://www.linkedin.com/search/results/content/?datePosted=%22${dateFilter}%22&keywords=${encodeURIComponent(keyword)}&origin=FACETED_SEARCH&sortBy=%22relevance%22`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(6000);

                // Run the commenting automation for this country and date filter
                totalCommented = await commentOnRelevantPosts(page, totalCommented, targetComments);
            }
        }

        console.log("🎯 Automation template initialized. You can now use the active session page to scan and apply for jobs.");
    } catch (error) {
        console.error("❌ Error during LinkedIn automation run:", error.message);
        process.exit(1);
    } finally {
        const waitTime = isHeadless ? 1000 : 15000;
        console.log(`⏳ Keeping browser open for ${waitTime / 1000} seconds...`);
        try {
            await page.waitForTimeout(waitTime).catch(() => { });
        } catch (e) { }
        try {
            await context.close().catch(() => { });
        } catch (e) { }
        console.log("Browser closed. Run completed.");
    }
    process.exit(0);
}

run().catch(err => {
    console.error("❌ Uncaught exception:", err);
    process.exit(1);
});
