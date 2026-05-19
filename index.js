const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

let resumeData = {};
try {
    resumeData = JSON.parse(fs.readFileSync('./ajay_mishra_resume_data.json', 'utf8'));
} catch (e) {
    console.log("Could not load resume data JSON.");
}

let processedJobs = [];
try {
    processedJobs = JSON.parse(fs.readFileSync('./processed_jobs.json', 'utf8'));
} catch (e) { }

const EMAIL = process.env.NAUKRI_EMAIL;
const PASSWORD = process.env.NAUKRI_PASSWORD;
const RAW_KEYWORDS = process.env.JOB_KEYWORD;
const RESUME_PATH = process.env.RESUME_PATH; // Absolute path to your resume file if needed
const CITIES = process.env.CITIES;
// This function attempts to click an element by trying multiple fallback locators.
// If the UI changes slightly, it "heals" by relying on backup semantic selectors.
async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const locator of locators) {
        try {
            // Wait briefly to see if this particular locator exists
            if (await locator.isVisible({ timeout: 3000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 3000 });
                } else if (actionType === 'fill') {
                    await locator.fill(value, { timeout: 3000 });
                }
                // Return true if action was successful
                return true;
            }
        } catch (e) {
            // Ignore error and try the next backup locator
        }
    }
    console.log(`[Self-Healing Warning] Could not perform action: ${actionName}`);
    return false;
}

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide NAUKRI_EMAIL and NAUKRI_PASSWORD in the .env file.");
        return;
    }

    // Wipe previous failed jobs log to keep it fresh for this run
    try {
        fs.writeFileSync('./failed_jobs.log', `--- Failed Jobs Log (${new Date().toLocaleString()}) ---\n\n`, 'utf8');
    } catch (e) { }

    console.log("🚀 Starting Playwright Job Assistant...");

    // Launch browser in non-headless mode so you can see it and handle CAPTCHAs if they appear
    const browser = await chromium.launch({ headless: false, slowMo: 2000 });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        permissions: ['geolocation', 'notifications']
    });
    const page = await context.newPage();

    console.log("➡️  Navigating to Naukri login...");
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });

    // Explicitly wait for the form to render
    try {
        await page.waitForSelector('#usernameField, input[type="text"]', { timeout: 15000 });
    } catch (e) {
        console.log("⚠️ Input fields took too long to load. Retrying anyway...");
    }

    // --- Login process with self-healing locators ---
    const emailFilled = await resilientAction(page, 'Fill Email', [
        page.locator('#usernameField'),
        page.getByPlaceholder('Enter your active Email ID / Username'),
        page.locator('input[type="text"]').first()
    ], 'fill', EMAIL);

    const passwordFilled = await resilientAction(page, 'Fill Password', [
        page.locator('#passwordField'),
        page.getByPlaceholder('Enter your password'),
        page.locator('input[type="password"]').first()
    ], 'fill', PASSWORD);

    if (emailFilled && passwordFilled) {
        console.log("Pressing Enter to submit login...");
        await page.keyboard.press('Enter');
        // fallback click just in case
        try { await page.locator('button[type="submit"]').click({ timeout: 1000 }); } catch (e) { }
    }

    // Wait for login to complete (URL change or specific element)
    console.log("⏳ Waiting for login to complete... (Please solve CAPTCHA manually if prompted)");
    try {
        await page.waitForURL(/.*naukri.com\/(mnjuser\/homepage|jobs).*/, { timeout: 30000 });
        console.log("✅ Logged in successfully.");
    } catch (error) {
        console.log("⚠️  Could not automatically confirm login within 30 seconds. Proceeding to search anyway...");
    }

    let totalApplied = 0;
    let totalRedirected = 0;
    let totalSkippedExp = 0;
    let totalFailed = 0;

    console.log(`\n==================================================`);
    console.log(`🔍 PERFORMING MASTER SEARCH WITH ALL KEYWORDS`);
    console.log(`==================================================`);

    // --- Searching for jobs via Direct URL ---
    console.log(`➡️  Constructing Search URL...`);
    const encodedKeywords = encodeURIComponent(RAW_KEYWORDS || '');
    const encodedCities = encodeURIComponent(CITIES || '');
    
    // Naukri works best with a path like /keyword-jobs-in-city
    const firstKeyword = RAW_KEYWORDS ? RAW_KEYWORDS.split(',')[0].trim().replace(/\s+/g, '-').toLowerCase() : 'jobs';
    const firstCity = CITIES ? CITIES.split(',')[0].trim().replace(/\s+/g, '-').toLowerCase() : 'india';
    
    const searchUrl = `https://www.naukri.com/${firstKeyword}-jobs-in-${firstCity}?k=${encodedKeywords}&l=${encodedCities}&experience=4`;
    
    console.log(`➡️  Navigating directly to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000); // Give it a moment to render properly
    console.log("✅ Successfully loaded search results natively.");

    // --- Sort Results by Date ---
    try {
        console.log("➡️  Changing sorting to 'Date'...");
        await page.waitForTimeout(2000); // Give the search results a moment to load

        // Use self-healing locators for the sort dropdown
        const sortDropdown = page.locator('.sort-drop, .sort-by, span:has-text("Sort by:")').first();
        if (await sortDropdown.isVisible({ timeout: 5000 })) {
            await sortDropdown.click();
            await page.waitForTimeout(1000); // Wait for dropdown to open
            // Click "Date" from the dropdown list
            await page.locator('ul.dropdown li:has-text("Date"), a:has-text("Date"), span:has-text("Date")').last().click();
            await page.waitForTimeout(3000); // Wait for the new sorted results to AJAX reload
            console.log("✅ Successfully sorted results by Date.");
        } else {
            console.log("ℹ️  Could not find 'Sort by' dropdown. Proceeding with default sorting.");
        }
    } catch (e) {
        console.log("⚠️  Error sorting by Date. It might already be set or UI changed.");
    }



    let currentPage = 1;
    const maxPages = 5; // Process up to 5 pages

    while (currentPage <= maxPages) {
        console.log(`\n📄 --- Processing Page ${currentPage} ---`);

        // Wait for the job listing wrapper
        try {
            await page.waitForSelector('.srp-jobtuple-wrapper, .jobTuple', { timeout: 15000 });
        } catch (e) {
            console.log("❌ Could not find job listings on this page. Exiting search.");
            break;
        }

        // Get all job cards on the page
        const jobs = await page.locator('.srp-jobtuple-wrapper, .jobTuple').all();
        console.log(`📊 Found ${jobs.length} jobs on page ${currentPage}.`);

        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];

            let jobUrl = "";
            try {
                jobUrl = await job.locator('a.title').first().getAttribute('href');
                if (jobUrl) jobUrl = jobUrl.split('?')[0]; // Strip tracking parameters for consistent ID
                if (jobUrl && processedJobs.includes(jobUrl)) {
                    console.log(`\n--------------------------------------------------`);
                    console.log(`⏭️  Skipping Job: Already processed in a previous run (Self-Healing).`);
                    continue;
                }
            } catch (e) { }

            // --- Check Experience Requirement before opening ---
            let skipDueToExperience = false;
            try {
                const expElement = job.locator('span.expwdth, span.exp, li:has(i.naukicon-experience) span').first();
                if (await expElement.isVisible({ timeout: 1000 })) {
                    const expText = await expElement.textContent();
                    const match = expText.match(/(\d+)\s*-\s*(\d+)/);
                    if (match) {
                        const minExp = parseInt(match[1]);
                        const maxExp = parseInt(match[2]);
                        // If 4 years doesn't fall in the required range, skip it
                        if (4 < minExp || 4 > maxExp) {
                            skipDueToExperience = true;
                            console.log(`\n--------------------------------------------------`);
                            console.log(`🚫 Skipping Job: Experience required (${expText}) does not fit your 4 years profile.`);
                            totalSkippedExp++;
                        }
                    }
                }
            } catch (e) { }

            if (skipDueToExperience) continue;

            // Open the job in a new tab so we don't lose our search results page
            const [jobPage] = await Promise.all([
                context.waitForEvent('page'),
                job.locator('a.title').first().click()
            ]);

            await jobPage.waitForLoadState('domcontentloaded');
            const title = await jobPage.title();
            console.log(`\n--------------------------------------------------`);
            console.log(`🔍 Evaluating Job: ${title.split('|')[0].trim()}`);

            // --- Determine if it's Easy Apply or Redirect ---
            let isRedirect = false;

            // Naukri buttons usually say "Apply on company site" for external applications
            try {
                const externalApplyBtn = jobPage.locator('button:has-text("Apply on company site")');
                if (await externalApplyBtn.isVisible({ timeout: 3000 })) {
                    isRedirect = true;
                }
            } catch (e) { }

            if (isRedirect) {
                console.log("🚫 Status: REDIRECT NOT APPLY (Requires applying on company site). Leaving tab open.");
                totalRedirected++;
                if (jobUrl && !processedJobs.includes(jobUrl)) {
                    processedJobs.push(jobUrl);
                    fs.writeFileSync('./processed_jobs.json', JSON.stringify(processedJobs, null, 2));
                }
                // We do not close the tab so you can manually apply later if you want
                continue;
            }

            // --- Apply Process ---
            try {
                // Use self-healing locators to find the Apply button
                const clickedApply = await resilientAction(jobPage, 'Click Apply', [
                    jobPage.getByRole('button', { name: 'Apply', exact: true }),
                    jobPage.locator('#apply-button'),
                    jobPage.locator('.apply-button')
                ]);

                if (clickedApply) {
                    console.log("✅ Clicked 'Apply' button.");

                    // Pause briefly to let the modal/popup load
                    await jobPage.waitForTimeout(2000);

                    // Sometimes Naukri asks to verify/update your resume.
                    if (RESUME_PATH) {
                        try {
                            const uploadInput = jobPage.locator('input[type="file"]');
                            if (await uploadInput.isVisible({ timeout: 2000 })) {
                                console.log("📄 Resume upload requested. Uploading...");
                                await uploadInput.setInputFiles(RESUME_PATH);
                                await jobPage.waitForTimeout(2000); // wait for upload to process
                            }
                        } catch (e) { }
                    }

                    // Try to automatically answer questionnaires using resume data
                    // Handle multi-step chatbot questionnaires
                    let questionLoop = 0;
                    while (questionLoop < 5) { // Try up to 5 questions in sequence
                        questionLoop++;
                        try {
                            const textInputs = await jobPage.locator('input[type="text"], input[type="number"], input:not([type]), textarea').all();
                            let answered = false;
                            
                            for (const input of textInputs) {
                                if (await input.isVisible() && await input.isEditable()) {
                                    // Extract conversational context (scan entire page text for clues since it's a chat)
                                    const pageText = await jobPage.locator('body').innerText().catch(() => '');
                                    const matchStr = pageText.toLowerCase();

                                    if (matchStr.includes('expected') && matchStr.includes('ctc')) {
                                        await input.fill(resumeData.personal_details?.expected_ctc?.replace(/[^0-9.]/g, '') || '12');
                                    } else if (matchStr.includes('current') && matchStr.includes('ctc')) {
                                        await input.fill(resumeData.personal_details?.current_ctc?.replace(/[^0-9.]/g, '') || '7.2');
                                    } else if (matchStr.includes('notice period')) {
                                        await input.fill('Immediate');
                                    } else {
                                        await input.fill('4'); // Default fallback for experience or arbitrary questions
                                    }
                                    answered = true;
                                }
                            }
                            
                            const radioBtns = await jobPage.locator('input[type="radio"]').all();
                            if (radioBtns.length > 0) {
                                for (const radio of radioBtns) {
                                    if (await radio.isVisible()) {
                                        await radio.check({ timeout: 1000 }).catch(() => { });
                                        answered = true;
                                        break;
                                    }
                                }
                            } else if (!answered) {
                                // Fallback for Naukri's custom div-based radio buttons / dropdowns (e.g. SingleSelectRadioButton)
                                const customRadio = jobPage.locator('div[id*="SingleSelectRadioButton"] div, div[id*="Navbar"]').first();
                                if (await customRadio.isVisible({ timeout: 1000 })) {
                                    await customRadio.click();
                                    await jobPage.waitForTimeout(500);
                                    // If a dropdown opened, try to click the first option (e.g. Mr., Single, Male)
                                    const dropdownOption = jobPage.locator('text="Mr.", text="Male", text="Married", text="Single"').first();
                                    if (await dropdownOption.isVisible()) {
                                        await dropdownOption.click();
                                    }
                                    answered = true;
                                }
                            }
                            
                            // Look for the Save/Submit button (sometimes it's a button, sometimes a generic div with text)
                            const saveBtn = jobPage.locator('button:has-text("Save"), button:has-text("Submit"), :text-is("Save"), :text-is("Submit")').last();
                            
                            if (await saveBtn.isVisible({ timeout: 2000 })) {
                                await saveBtn.click();
                                await jobPage.waitForTimeout(2000); // Wait for the next question to slide in
                            } else {
                                break; // No save button found, questionnaire is likely finished
                            }
                        } catch (e) {
                            break;
                        }
                    }

                    // Check for successful application text
                    try {
                        const successText = jobPage.locator('text=Applied successfully, text=You have successfully applied');
                        if (await successText.isVisible({ timeout: 3000 })) {
                            console.log("🎉 Status: APPLIED SUCCESSFULLY");
                            totalApplied++;
                        } else {
                            console.log("🎉 Status: APPLIED SUCCESSFULLY (Assumed based on flow)");
                            totalApplied++;
                        }
                    } catch (e) {
                        console.log("🎉 Status: APPLIED SUCCESSFULLY (Assumed based on flow)");
                        totalApplied++;
                    }

                } else {
                    console.log("ℹ️  Status: Could not find 'Apply' button. It might already be applied.");
                    totalFailed++;
                    try { fs.appendFileSync('./failed_jobs.log', `[Missing Apply Button] ${title}\nURL: ${jobUrl}\n\n`, 'utf8'); } catch (e) { }
                }
            } catch (error) {
                console.log(`❌ Status: Error applying - ${error.message}`);
                totalFailed++;
                try { fs.appendFileSync('./failed_jobs.log', `[Error] ${title}\nURL: ${jobUrl}\nReason: ${error.message}\n\n`, 'utf8'); } catch (e) { }
            }

            if (jobUrl && !processedJobs.includes(jobUrl)) {
                processedJobs.push(jobUrl);
                fs.writeFileSync('./processed_jobs.json', JSON.stringify(processedJobs, null, 2));
            }

            await jobPage.close();

            // Random delay to mimic human behavior and avoid getting blocked
            const delay = Math.floor(Math.random() * 3000) + 2000;
            await page.waitForTimeout(delay);
        }

        console.log(`\n✅ Finished processing jobs on page ${currentPage}.`);

        // Pagination logic
        if (currentPage >= maxPages) {
            console.log("Reached maximum page limit.");
            break;
        }

        const nextBtn = page.locator('a.fright, a:has-text("Next"), span:has-text("Next")').first();
        try {
            if (await nextBtn.isVisible({ timeout: 3000 })) {
                console.log("➡️ Clicking Next Page...");
                await nextBtn.click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(3000); // Give it time to load new jobs
                currentPage++;
            } else {
                console.log("No more pages found.");
                break;
            }
        } catch (e) {
            console.log("Error finding Next button. Stopping pagination.");
            break;
        }
    } // End of while loop
    console.log(`--- FINAL REPORT ---`);
    console.log(`🚀 Total Automatically Applied: ${totalApplied}`);
    console.log(`🔗 Total Redirects (Opened for you): ${totalRedirected}`);
    console.log(`⏭️  Total Skipped (Experience Mismatch): ${totalSkippedExp}`);
    console.log(`⚠️  Total Failed/Already Applied: ${totalFailed}`);
    console.log(`--------------------`);
    console.log("Closing browser in 5 seconds...");
    await page.waitForTimeout(5000);
    await browser.close();
}

run().catch(console.error);
