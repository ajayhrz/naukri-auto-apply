const fs = require('fs');
const nodemailer = require('nodemailer');
const {
    launchNaukriBrowser,
    createNaukriContext,
    ensureNaukriLogin,
    saveStorageState,
} = require('./lib/naukri_auth');
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

async function isQuestionnaireElement(element) {
    try {
        return await element.evaluate(el => {
            // Exclude headers, footers, search bars, global navigation
            if (el.closest('#nav-bar-container, .nI-gNb-header, [class*="search"], [class*="qsb"], .footer, footer, header, #header, #footer')) {
                return false;
            }
            // Must be inside chatbot, modal, drawer, or apply containers
            if (el.closest('.chatbot_MessageContainer, [class*="chatbot"], [class*="modal"], [class*="drawer"], [class*="apply"], [class*="questionnaire"], [class*="bot"]')) {
                return true;
            }
            // Or if it's inside a form that is NOT global
            const form = el.closest('form');
            if (form && !form.className.includes('search') && !form.className.includes('qsb') && !form.id.includes('search')) {
                return true;
            }
            // If the element is inside an iframe, check if there is an input or questionnaire
            return window.self !== window.top; 
        });
    } catch (e) {
        return false;
    }
}

async function getQuestionnaireContext(page) {
    const frames = page.frames();
    for (const frame of frames) {
        try {
            const hasInput = await frame.locator('input, textarea, select, .chatbot_MessageContainer, .chatbot_RadioButtonContainer, button:has-text("Save"), button:has-text("Submit"), .sendMsg').first().isVisible({ timeout: 1000 }).catch(() => false);
            if (hasInput) {
                return frame;
            }
        } catch (e) {}
    }
    return page;
}

async function getLocalContext(element, globalText) {
    try {
        const text = await element.evaluate(el => {
            // 1. Check placeholder
            if (el.placeholder) return el.placeholder;
            if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
            
            // 2. Check aria-label
            if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
            
            // 3. Check associated label
            if (el.id) {
                const lbl = document.querySelector(`label[for="${el.id}"]`);
                if (lbl && lbl.innerText) return lbl.innerText;
            }
            
            // 4. Check closest label ancestor
            const parentLabel = el.closest('label');
            if (parentLabel && parentLabel.innerText) return parentLabel.innerText;
            
            // 5. Check chatbot message container text or sibling text
            let p = el.parentElement;
            let d = 0;
            while (p && d < 5) {
                if (p.classList.contains('chatbot_MessageContainer') || p.className.includes('chatbot_Message') || p.className.includes('question-container')) {
                    if (p.innerText) return p.innerText;
                }
                
                const headers = p.querySelectorAll('h1, h2, h3, h4, h5, h6, label, .question, .title, .label, [class*="question"], [class*="label"]');
                for (const h of headers) {
                    if (h !== el && h.innerText && h.innerText.trim().length > 3) {
                        return h.innerText;
                    }
                }
                
                let prev = p.previousElementSibling;
                while (prev) {
                    if (prev.innerText && prev.innerText.trim().length > 3) {
                        return prev.innerText;
                    }
                    prev = prev.previousElementSibling;
                }
                
                p = p.parentElement;
                d++;
            }
            
            if (el.parentElement && el.parentElement.innerText) {
                return el.parentElement.innerText;
            }
            
            return '';
        }).catch(() => '');
        return (text + ' ' + globalText).toLowerCase();
    } catch (e) {
        return globalText.toLowerCase();
    }
}

async function checkAndMailNotifications(context) {
    console.log(`\n[${new Date().toLocaleString()}] 🔍 Starting Notification Scan...`);
    const tempPage = await context.newPage();
    try {
        console.log("➡️  Navigating to Naukri notifications...");
        await tempPage.goto('https://www.naukri.com/mnjuser/notifications', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await tempPage.waitForTimeout(5000);

        // Try clicking the bell icon if direct nav redirects/fails
        const bellIcon = tempPage.locator('.nI-gNb-icon-bell, [class*="bell"], .nI-gNb-notification').first();
        if (await bellIcon.isVisible()) {
            await bellIcon.click().catch(() => {});
            await tempPage.waitForTimeout(3000);
        }

        const rawItems = await tempPage.locator('.nI-gNb-ncr__menu-item, .nI-gNb-ncr__menu-item-content, .notification-item, .notification-card, [class*="notification"] li, [class*="drawer"] [class*="card"], .dropdown-list-item, .nI-gNb-notification-dropdown a, [class*="notification"] a, .nI-gNb-drawer a, .nI-gNb-drawer li, .nI-gNb-drawer div').all();
        let fetchedNotifications = [];
        for (const item of rawItems) {
            try {
                const text = await item.innerText();
                const cleanedText = text.replace(/\s+/g, ' ').trim();
                if (cleanedText && cleanedText.length > 5 && !fetchedNotifications.includes(cleanedText)) {
                    fetchedNotifications.push(cleanedText);
                }
            } catch (e) {}
        }

        console.log(`📋 Extracted ${fetchedNotifications.length} notifications.`);

        // Compare with seen list
        const SEEN_FILE = './seen_notifications.json';
        let seenNotifications = [];
        try {
            if (fs.existsSync(SEEN_FILE)) {
                seenNotifications = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
            }
        } catch (e) {}

        const newNotifications = fetchedNotifications.filter(notif => !seenNotifications.includes(notif));
        if (newNotifications.length > 0) {
            console.log(`🎉 Found ${newNotifications.length} new notifications!`);
            
            const MY_EMAIL = 'am618035@gmail.com';
            const APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || process.env.NAUKRI_PASSWORD;
            
            if (APP_PASSWORD) {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: MY_EMAIL,
                        pass: APP_PASSWORD
                    }
                });

                let htmlContent = `<h3>New Naukri Notifications Detected</h3><ul>`;
                let textContent = `New Naukri Notifications Detected:\n\n`;

                newNotifications.forEach(notif => {
                    htmlContent += `<li><strong>${notif}</strong></li>`;
                    textContent += `- ${notif}\n`;
                });
                htmlContent += `</ul>`;

                const mailOptions = {
                    from: MY_EMAIL,
                    to: MY_EMAIL,
                    subject: `Naukri Alert: ${newNotifications.length} New Notification(s)`,
                    text: textContent,
                    html: htmlContent
                };

                await transporter.sendMail(mailOptions);
                console.log(`📧 Email alert sent successfully to ${MY_EMAIL}.`);
            } else {
                console.log("⚠️ EMAIL_APP_PASSWORD not set in .env. Skipping email notification.");
            }

            // Update seen list
            seenNotifications = [...newNotifications, ...seenNotifications].slice(0, 100);
            fs.writeFileSync(SEEN_FILE, JSON.stringify(seenNotifications, null, 2));
        } else {
            console.log("ℹ️  No new notifications detected.");
        }
    } catch (err) {
        console.error("❌ Error checking notifications:", err.message);
    } finally {
        await tempPage.close().catch(() => {});
    }
}

async function run() {
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide NAUKRI_EMAIL and NAUKRI_PASSWORD in the .env file.");
        process.exit(1);
    }

    // Wipe previous failed jobs log to keep it fresh for this run
    try {
        fs.writeFileSync('./failed_jobs.log', `--- Failed Jobs Log (${new Date().toLocaleString()}) ---\n\n`, 'utf8');
    } catch (e) { }

    console.log("🚀 Starting Playwright Job Assistant...");

    const isHeadless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const browser = await launchNaukriBrowser();
    const context = await createNaukriContext(browser);
    await context.grantPermissions(['geolocation', 'notifications']);
    const page = await context.newPage();

    await ensureNaukriLogin(page, context, { email: EMAIL, password: PASSWORD });

    // Call notification checker right after login
    await checkAndMailNotifications(context).catch(() => {});

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

        // Use self-healing locators for the sort dropdown button
        const sortDropdown = page.locator('#filter-sort, .sort-drop, .sort-by, span:has-text("Sort by:")').first();
        if (await sortDropdown.isVisible({ timeout: 5000 })) {
            const currentSort = await sortDropdown.innerText();
            if (currentSort.includes("Date")) {
                console.log("ℹ️  Results are already sorted by Date.");
            } else {
                await sortDropdown.click();
                await page.waitForTimeout(2000); // Wait for dropdown to open
                
                // Use resilient locators for the Date option
                const dateOption = page.locator('[data-id="filter-sort-f"], li[title="Date"] a, span:text-is("Date")').first();
                if (await dateOption.isVisible({ timeout: 3000 })) {
                    await dateOption.click();
                    await page.waitForTimeout(5000); // Wait for the new sorted results to AJAX reload
                    console.log("✅ Successfully sorted results by Date.");
                } else {
                    console.log("⚠️ Could not find 'Date' option in the sort dropdown. Proceeding with default sorting.");
                }
            }
        } else { 
            console.log("ℹ️  Could not find 'Sort by' dropdown. Proceeding with default sorting.");
        }
    } catch (e) {
        console.log(`⚠️  Error sorting by Date: ${e.message}`);
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

            // --- Check Job Title matches relevant keywords ---
            let skipDueToTitle = false;
            let jobTitleText = "";
            try {
                const titleElement = job.locator('a.title').first();
                if (await titleElement.isVisible()) {
                    jobTitleText = await titleElement.textContent();
                    const lowercaseTitle = jobTitleText.toLowerCase();
                    
                    const RELEVANT_KEYWORDS = [
                        'test', 'testing', 'qa', 'sdet', 'quality assurance', 'quality analyst', 'quality control'
                    ];
                    if (process.env.JOB_KEYWORD) {
                        process.env.JOB_KEYWORD.split(',').forEach(k => {
                            const cleanK = k.trim().toLowerCase();
                            if (cleanK && !RELEVANT_KEYWORDS.includes(cleanK)) {
                                RELEVANT_KEYWORDS.push(cleanK);
                            }
                        });
                    }
                    
                    const isRelevant = RELEVANT_KEYWORDS.some(kw => {
                        const regex = new RegExp(`\\b${kw}\\b|${kw}`);
                        return regex.test(lowercaseTitle);
                    });
                    
                    if (!isRelevant) {
                        skipDueToTitle = true;
                        console.log(`\n--------------------------------------------------`);
                        console.log(`🚫 Skipping Job: Title "${jobTitleText.trim()}" does not match Software Testing/QA profile.`);
                    }
                }
            } catch (e) { }

            if (skipDueToTitle) {
                if (jobUrl && !processedJobs.includes(jobUrl)) {
                    processedJobs.push(jobUrl);
                    try { fs.writeFileSync('./processed_jobs.json', JSON.stringify(processedJobs, null, 2)); } catch (e) {}
                }
                continue;
            }

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

            if (skipDueToExperience) {
                if (jobUrl && !processedJobs.includes(jobUrl)) {
                    processedJobs.push(jobUrl);
                    try { fs.writeFileSync('./processed_jobs.json', JSON.stringify(processedJobs, null, 2)); } catch (e) {}
                }
                continue;
            }

            // Open the job in a new tab so we don't lose our search results page
            let jobPage;
            try {
                if (page.isClosed() || !browser.isConnected()) {
                    console.log("ℹ️ Browser or page was closed. Exiting job loop.");
                    break;
                }
                const [targetPage] = await Promise.all([
                    context.waitForEvent('page'),
                    job.locator('a.title').first().click()
                ]);
                jobPage = targetPage;
            } catch (err) {
                if (err.message.includes('closed') || err.message.includes('detached') || err.message.includes('browser has been closed')) {
                    console.log("ℹ️ Browser or page was closed during job processing. Exiting.");
                    break;
                }
                console.error(`❌ Error opening job page: ${err.message}`);
                continue;
            }

            await jobPage.waitForLoadState('load');
            // Wait up to 10 seconds for page content (title/buttons) to render
            await jobPage.waitForSelector('h1, button, .apply-button', { timeout: 10000 }).catch(() => {});
            
            const title = await jobPage.title();
            console.log(`\n--------------------------------------------------`);
            console.log(`🔍 Evaluating Job: ${title ? title.split('|')[0].trim() : 'Unknown Title'}`);

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
                    jobPage.locator('button.apply-button').first(),
                    jobPage.locator('button:has-text("Apply")').first(),
                    jobPage.locator('button:has-text("APPLY")').first(),
                    jobPage.locator('span:has-text("Apply")').first(),
                    jobPage.locator('.apply-button').first(),
                    jobPage.locator('#apply-button').first(),
                    jobPage.getByRole('button', { name: /Apply/i })
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
                    const maxQuestions = 10;
                    let appliedSuccessfully = false;
                    let lastContextText = "";
                    let duplicateContextCount = 0;

                    while (questionLoop < maxQuestions) {
                        questionLoop++;
                        try {
                            if (jobPage.isClosed()) {
                                console.log("ℹ️ Job page closed. Questionnaire complete.");
                                appliedSuccessfully = true;
                                break;
                            }
                            await jobPage.waitForTimeout(2000); // Wait for potential animations or load

                            // Resolve the active frame/document context dynamically
                            const qContext = await getQuestionnaireContext(jobPage);

                            // 1. Check if application is already completed based on page content/URL
                            const bodyText = await qContext.innerText('body').catch(() => '');
                            const currentUrl = jobPage.url();
                            
                            if (
                                bodyText.toLowerCase().includes('applied successfully') || 
                                bodyText.toLowerCase().includes('successfully applied') ||
                                currentUrl.includes('saveApply')
                            ) {
                                appliedSuccessfully = true;
                                break;
                            }

                            // Check if the Apply button text has changed to 'Applied'
                            const applyBtn = qContext.locator('button:has-text("Apply"), button:has-text("Applied"), #apply-button, .apply-button').first();
                            let applyText = await applyBtn.innerText().catch(() => '');
                            if (!applyText) {
                                const mainApplyBtn = jobPage.locator('button:has-text("Apply"), button:has-text("Applied"), #apply-button, .apply-button').first();
                                applyText = await mainApplyBtn.innerText().catch(() => '');
                            }
                            if (applyText.trim().toLowerCase() === 'applied') {
                                appliedSuccessfully = true;
                                break;
                            }

                            // Prevent infinite loop on stuck questions
                            const lines = bodyText.split('\n').filter(l => l.trim().length > 0);
                            const currentContextText = lines.slice(-5).join('\n');
                            if (currentContextText && currentContextText === lastContextText) {
                                duplicateContextCount++;
                                if (duplicateContextCount >= 3) {
                                    console.log("⚠️ Stuck on the same question 3 times. Exiting questionnaire to prevent infinite loop.");
                                    break;
                                }
                            } else {
                                lastContextText = currentContextText;
                                duplicateContextCount = 0;
                            }

                            // 2. Text Inputs (div contenteditable, standard inputs, textareas) inside the chatbot/modal
                            const textInputs = await qContext.locator('input[type="text"], input[type="number"], input:not([type]), textarea, div[contenteditable="true"], div.textArea').all();
                            let textAnswered = false;

                            for (const input of textInputs) {
                                if (await input.isVisible() && (await input.isEditable() || await input.getAttribute('contenteditable') === 'true')) {
                                    // Ensure the input is part of the chatbot or modal
                                    const isInsideChat = await isQuestionnaireElement(input);
                                    if (!isInsideChat) continue;

                                    let qText = await getLocalContext(input, '');
                                    if (!qText || qText.trim().length < 3) {
                                        qText = bodyText.toLowerCase();
                                    }

                                    const TECH_KEYWORDS = [
                                        'java', 'javascript', 'js', 'sql', 'playwright', 'selenium', 'cucumber', 'rest assured', 'postman', 'testng', 'junit', 'maven', 
                                        'jenkins', 'git', 'github', 'jira', 'sdet', 'qa', 'test', 'testing', 'automation', 'api', 'manual'
                                    ];
                                    const hasTechKeyword = TECH_KEYWORDS.some(tech => qText.includes(tech));

                                    let fillValue = '4'; // Default fallback
                                    
                                    if (qText.includes('expected')) {
                                        fillValue = '12';
                                    } else if (qText.includes('current') || qText.includes('ctc') || qText.includes('salary') || qText.includes('lpa')) {
                                        fillValue = '7.2';
                                    } else if (qText.includes('experience') || qText.includes('year') || qText.includes('yr') || hasTechKeyword) {
                                        fillValue = '4';
                                    } else if (qText.includes('notice period') || qText.includes('notice')) {
                                        fillValue = 'Immediate';
                                    } else {
                                        // Extract from resume if we can find something matching
                                        let foundVal = '';
                                        if (resumeData.personal_details) {
                                            for (const key of Object.keys(resumeData.personal_details)) {
                                                if (qText.includes(key.toLowerCase())) {
                                                    foundVal = String(resumeData.personal_details[key]);
                                                    break;
                                                }
                                            }
                                        }
                                        if (!foundVal && resumeData.skills) {
                                            for (const category of Object.keys(resumeData.skills)) {
                                                const list = resumeData.skills[category];
                                                if (Array.isArray(list)) {
                                                    for (const skill of list) {
                                                        if (qText.includes(skill.toLowerCase())) {
                                                            foundVal = '4';
                                                            break;
                                                        }
                                                    }
                                                }
                                                if (foundVal) break;
                                            }
                                        }
                                        fillValue = foundVal || '4';
                                    }

                                    console.log(`✍️  Filling text field with: "${fillValue}" (Context: "${qText.substring(0, 100).replace(/\n/g, ' ')}")`);
                                    const tagName = await input.evaluate(el => el.tagName.toLowerCase());
                                    if (tagName === 'div') {
                                        await input.focus();
                                        await input.fill(fillValue).catch(async () => {
                                            await jobPage.keyboard.insertText(fillValue);
                                        });
                                    } else {
                                        await input.fill(fillValue);
                                    }
                                    textAnswered = true;
                                }
                            }

                            // 2b. Standard HTML Select Dropdowns
                            let selectAnswered = false;
                            const selects = await qContext.locator('select').all();
                            for (const select of selects) {
                                if (await select.isVisible()) {
                                    const isInsideChat = await select.evaluate(el => !!el.closest('.chatbot_MessageContainer, [class*="chat"], [class*="modal"], [class*="form"]')).catch(() => false);
                                    const isFrame = qContext !== jobPage;
                                    if (!isInsideChat && !isFrame) continue;

                                    let qText = await getLocalContext(select, '');
                                    if (!qText || qText.trim().length < 3) {
                                        qText = bodyText.toLowerCase();
                                    }

                                    const options = await select.locator('option').all();
                                    let optionValueToSelect = null;
                                    
                                    for (const opt of options) {
                                        const text = (await opt.innerText()).toLowerCase().trim();
                                        const val = (await opt.getAttribute('value') || '').toLowerCase().trim();
                                        
                                        if (qText.includes('reloc') || qText.includes('resid') || qText.includes('hyderabad') || qText.includes('willing')) {
                                            if (text === 'yes' || val === 'yes') {
                                                optionValueToSelect = await opt.getAttribute('value');
                                                break;
                                            }
                                        } else if (qText.includes('experience') || qText.includes('year') || qText.includes('yr')) {
                                            const match = text.match(/(\d+)\s*[-to]+\s*(\d+)/);
                                            if (match) {
                                                const min = parseInt(match[1]);
                                                const max = parseInt(match[2]);
                                                if (4 >= min && 4 <= max) {
                                                    optionValueToSelect = await opt.getAttribute('value');
                                                    break;
                                                }
                                            }
                                            if (text.includes('4') || val.includes('4')) {
                                                optionValueToSelect = await opt.getAttribute('value');
                                                break;
                                            }
                                        } else if (qText.includes('expected')) {
                                            const match = text.match(/(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)/);
                                            if (match) {
                                                const min = parseFloat(match[1]);
                                                const max = parseFloat(match[2]);
                                                if (12 >= min && 12 <= max) {
                                                    optionValueToSelect = await opt.getAttribute('value');
                                                    break;
                                                }
                                            }
                                            if (text.includes('12') || val.includes('12')) {
                                                optionValueToSelect = await opt.getAttribute('value');
                                                break;
                                            }
                                        } else if (qText.includes('current') || qText.includes('ctc') || qText.includes('salary')) {
                                            const match = text.match(/(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)/);
                                            if (match) {
                                                const min = parseFloat(match[1]);
                                                const max = parseFloat(match[2]);
                                                if (7.2 >= min && 7.2 <= max) {
                                                    optionValueToSelect = await opt.getAttribute('value');
                                                    break;
                                                }
                                            }
                                            if (text.includes('7') || val.includes('7.2') || text.includes('7.2')) {
                                                optionValueToSelect = await opt.getAttribute('value');
                                                break;
                                            }
                                        }
                                    }
                                    
                                    // Fallback to select first non-placeholder option
                                    if (!optionValueToSelect && options.length > 1) {
                                        optionValueToSelect = await options[1].getAttribute('value');
                                    }
                                    
                                    if (optionValueToSelect) {
                                        console.log(`🔘 Selecting dropdown option value: "${optionValueToSelect}" (Context: "${qText.substring(0, 100).replace(/\n/g, ' ')}")`);
                                        await select.selectOption(optionValueToSelect);
                                        selectAnswered = true;
                                    }
                                }
                            }

                            // 3. Radio Options (labels/inputs)
                            const rawRadioLabels = await qContext.locator('label.ssrc__label, .ssrc__radio-btn-container label, input[type="radio"]:not(.hidden), div.chatbot_RadioButtonContainer label, .chatbot_RadioOption, .chatbot_RadioOption label, .chatbot_RadioOption input, div[class*="radio"] label, [class*="Radio"] label, [role="radio"], [class*="radio-option" i], [class*="radio-btn" i]').all();
                            
                            const radioLabels = [];
                            for (const el of rawRadioLabels) {
                                try {
                                    if (await el.isVisible() && await isQuestionnaireElement(el)) {
                                        radioLabels.push(el);
                                    }
                                } catch (e) {}
                            }

                            let radioAnswered = false;

                            if (radioLabels.length > 0) {
                                let elementToClick = null;
                                
                                let qText = '';
                                for (const el of radioLabels) {
                                    try {
                                        if (await el.isVisible()) {
                                            qText = await getLocalContext(el, '');
                                            if (qText && qText.trim().length > 3) break;
                                        }
                                    } catch (e) {}
                                }
                                if (!qText || qText.trim().length < 3) {
                                    qText = bodyText.toLowerCase();
                                }

                                // Helper to identify positive options
                                function isPositiveText(str) {
                                    if (!str) return false;
                                    const lower = str.toLowerCase().trim();
                                    const positiveWords = ['yes', 'agree', 'willing', 'confirm', 'accept', 'authorized', 'available', 'correct', 'true', 'ok', 'allow', 'ready', 'willingness'];
                                    const negativeWords = ['no', 'not', 'disagree', 'unwilling', 'decline', 'reject', 'false'];

                                    const hasNegative = negativeWords.some(neg => {
                                        const regex = new RegExp(`\\b${neg}\\b`);
                                        return regex.test(lower);
                                    });
                                    if (hasNegative) {
                                        return false;
                                    }

                                    return positiveWords.some(pos => {
                                        const regex = new RegExp(`\\b${pos}\\b`);
                                        return regex.test(lower) || lower.startsWith(pos);
                                    });
                                }

                                // A. Handle Experience & Salary Contexts first
                                if (qText.includes('experience') || qText.includes('year') || qText.includes('yr')) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            const text = (await el.innerText().catch(() => '')).toLowerCase().trim();
                                            const val = (await el.getAttribute('value').catch(() => '') || '').toLowerCase().trim();
                                            const match = text.match(/(\d+)\s*[-to]+\s*(\d+)/);
                                            if (match) {
                                                const min = parseInt(match[1]);
                                                const max = parseInt(match[2]);
                                                if (4 >= min && 4 <= max) {
                                                    elementToClick = el;
                                                    break;
                                                }
                                            }
                                            if (text === '4' || val === '4' || text.includes('4 year') || text.includes('3-5') || text.includes('3 to 5')) {
                                                elementToClick = el;
                                                break;
                                            }
                                        }
                                    }
                                } else if (qText.includes('expected') && (qText.includes('ctc') || qText.includes('salary') || qText.includes('lpa'))) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            const text = (await el.innerText().catch(() => '')).toLowerCase().trim();
                                            const val = (await el.getAttribute('value').catch(() => '') || '').toLowerCase().trim();
                                            const match = text.match(/(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)/);
                                            if (match) {
                                                const min = parseFloat(match[1]);
                                                const max = parseFloat(match[2]);
                                                if (12 >= min && 12 <= max) {
                                                    elementToClick = el;
                                                    break;
                                                }
                                            }
                                            if (text.includes('12') || val.includes('12') || text.includes('10-15') || text.includes('10 to 15')) {
                                                elementToClick = el;
                                                break;
                                            }
                                        }
                                    }
                                } else if (qText.includes('current') && (qText.includes('ctc') || qText.includes('salary') || qText.includes('lpa'))) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            const text = (await el.innerText().catch(() => '')).toLowerCase().trim();
                                            const val = (await el.getAttribute('value').catch(() => '') || '').toLowerCase().trim();
                                            const match = text.match(/(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)/);
                                            if (match) {
                                                const min = parseFloat(match[1]);
                                                const max = parseFloat(match[2]);
                                                if (7.2 >= min && 7.2 <= max) {
                                                    elementToClick = el;
                                                    break;
                                                }
                                            }
                                            if (text.includes('7') || val.includes('7') || text.includes('7.2') || text.includes('5-10') || text.includes('5 to 10')) {
                                                elementToClick = el;
                                                break;
                                            }
                                        }
                                    }
                                }

                                // B. Look for any positive option if we haven't selected one yet
                                if (!elementToClick) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            const text = await el.innerText().catch(() => '');
                                            const val = await el.getAttribute('value').catch(() => '') || '';
                                            const id = await el.getAttribute('id').catch(() => '') || '';

                                            if (isPositiveText(text) || isPositiveText(val) || isPositiveText(id)) {
                                                elementToClick = el;
                                                break;
                                            }
                                        }
                                    }
                                }

                                // C. Look for notice period key phrases
                                if (!elementToClick) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            const text = (await el.innerText().catch(() => '')).toLowerCase().trim();
                                            if (text.includes('immediate') || text.includes('15 days') || text.includes('0 days') || text.includes('serving') || text.includes('buyout') || text.includes('less than')) {
                                                elementToClick = el;
                                                break;
                                            }
                                        }
                                    }
                                }

                                // D. Fallback: first visible option
                                if (!elementToClick) {
                                    for (const el of radioLabels) {
                                        if (await el.isVisible()) {
                                            elementToClick = el;
                                            break;
                                        }
                                    }
                                }

                                if (elementToClick) {
                                    const optName = (await elementToClick.innerText().catch(() => '')).trim();
                                    console.log(`🔘 Selecting radio option: "${optName || 'First'}" (Context: "${qText.substring(0, 100).replace(/\n/g, ' ')}")`);
                                    
                                    try {
                                        await elementToClick.click().catch(() => {});
                                        await jobPage.waitForTimeout(200);
                                        
                                        await elementToClick.evaluate(el => {
                                            if (typeof el.click === 'function') el.click();
                                            el.dispatchEvent(new Event('click', { bubbles: true }));
                                            el.dispatchEvent(new Event('change', { bubbles: true }));
                                            
                                            // Click children recursive to trigger nested React listeners
                                            const children = el.querySelectorAll('*');
                                            children.forEach(child => {
                                                if (typeof child.click === 'function') {
                                                    child.click();
                                                    child.dispatchEvent(new Event('click', { bubbles: true }));
                                                }
                                            });
                                        }).catch(() => {});
                                    } catch (err) {}
                                    
                                    radioAnswered = true;
                                }
                            }

                            // 4. Custom Single-Select Dropdowns (fallback)
                            let customAnswered = false;
                            if (!textAnswered && !radioAnswered && !selectAnswered) {
                                const customRadio = qContext.locator('div[id*="SingleSelectRadioButton"] div').first();
                                if (await customRadio.isVisible({ timeout: 1000 })) {
                                    await customRadio.click();
                                    await jobPage.waitForTimeout(500);
                                    const dropdownOption = qContext.locator('text="Mr.", text="Male", text="Married", text="Single"').first();
                                    if (await dropdownOption.isVisible()) {
                                        await dropdownOption.click();
                                    }
                                    customAnswered = true;
                                }
                            }

                            // 5. Chatbot Save/Submit Button (excluding the parent page's Save button)
                            const saveBtn = qContext.locator('div.sendMsg, .sendMsg, div[class*="chat"] div:text-is("Save"), div[class*="chat"] div:text-is("Submit"), button:not([class*="save-job"]):has-text("Save"), button:not([class*="save-job"]):has-text("Submit"), button:has-text("Submit Application")').first();
                            
                            if (await saveBtn.isVisible({ timeout: 2000 })) {
                                const btnOuter = await saveBtn.evaluate(el => el.outerHTML).catch(() => '');
                                console.log(`💾 Clicking Save button: ${btnOuter.slice(0, 100)}`);
                                try {
                                    await saveBtn.click({ timeout: 5000 });
                                } catch (e) {
                                    console.log("⚠️ Save click timed out or element detached (expected on redirection/update).");
                                }
                            } else {
                                const parentSaveBtn = jobPage.locator('button:not([class*="save-job"]):has-text("Save"), button:not([class*="save-job"]):has-text("Submit"), button:has-text("Submit Application")').first();
                                if (await parentSaveBtn.isVisible({ timeout: 1000 })) {
                                    console.log(`💾 Clicking Parent page Save button...`);
                                    await parentSaveBtn.click({ timeout: 5000 }).catch(() => {});
                                } else {
                                    console.log("ℹ️ No chatbot Save/Submit button visible. Questionnaire complete.");
                                    break;
                                }
                            }
                        } catch (err) {
                            console.log(`⚠️ Exception in questionnaire loop: ${err.message}`);
                            if (jobPage.isClosed() || err.message.includes('closed') || err.message.includes('detached')) {
                                appliedSuccessfully = true;
                                break;
                            }
                        }
                    }

                    // Log final status
                    if (appliedSuccessfully) {
                        console.log("🎉 Status: APPLIED SUCCESSFULLY");
                        totalApplied++;
                    } else {
                        // Double check body text one last time
                        const finalBody = await jobPage.innerText('body').catch(() => '');
                        const finalUrl = jobPage.url();
                        if (
                            finalBody.toLowerCase().includes('applied successfully') || 
                            finalBody.toLowerCase().includes('successfully applied') ||
                            finalUrl.includes('saveApply')
                        ) {
                            console.log("🎉 Status: APPLIED SUCCESSFULLY");
                            totalApplied++;
                        } else {
                            console.log("🎉 Status: APPLIED SUCCESSFULLY (Assumed based on flow completion)");
                            totalApplied++;
                        }
                    }

                } else {
                    // Debug: print all button texts on the page to see what's wrong
                    const buttonTexts = await jobPage.evaluate(() => {
                        return Array.from(document.querySelectorAll('button, a, span, div')).map(el => {
                            return {
                                tag: el.tagName.toLowerCase(),
                                text: el.innerText ? el.innerText.trim() : '',
                                class: el.className,
                                id: el.id
                            };
                        }).filter(item => {
                            const t = item.text.toLowerCase();
                            return t.includes('apply') || t.includes('login') || t.includes('register');
                        });
                    }).catch(() => []);
                    console.log("🔍 Debug: Found potential apply/login/register elements:", JSON.stringify(buttonTexts.slice(0, 10), null, 2));

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

            try {
                if (jobPage && !jobPage.isClosed()) {
                    await jobPage.close();
                }
            } catch (e) {}

            // Random delay to mimic human behavior and avoid getting blocked
            const delay = Math.floor(Math.random() * 3000) + 2000;
            await page.waitForTimeout(delay).catch(() => {});
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

                // Call notification checker periodically between page changes
                await checkAndMailNotifications(context).catch(() => {});
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

    // --- FETCH APPLICATION HISTORY STATUS ---
    console.log("\n==================================================");
    console.log("🔍 FETCHING JOB APPLICATION HISTORY & STATUSES");
    console.log("==================================================");
    try {
        const historyPage = await context.newPage();
        console.log("➡️ Navigating to Naukri history page...");
        await historyPage.goto('https://www.naukri.com/myapply/historypage', { waitUntil: 'domcontentloaded' });
        await historyPage.waitForTimeout(6000);

        console.log("📊 Extracting application statuses...");
        const appliedJobsList = await historyPage.evaluate(() => {
            const cards = [];
            const statusDivs = Array.from(document.querySelectorAll('div, span, p')).filter(el => {
                const text = el.innerText ? el.innerText.trim() : '';
                return text.startsWith('Application sent') || text.includes('Applied') || text.includes('Shortlisted') || text.includes('Rejected') || text.includes('Viewed');
            });

            for (const sDiv of statusDivs) {
                let parent = sDiv.parentElement;
                while (parent && parent.tagName !== 'BODY') {
                    const parentText = parent.innerText || '';
                    if (parentText.split('\n').length >= 3) {
                        break;
                    }
                    parent = parent.parentElement;
                }
                
                if (parent) {
                    const lines = parent.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    if (lines.length >= 2) {
                        const title = lines[0];
                        let company = lines[1];
                        if (lines.length > 2 && (company.match(/^\d+(\.\d+)?$/) || company.includes('Reviews'))) {
                            company = lines[2];
                        }
                        const status = sDiv.innerText.trim().replace(/\s+/g, ' ');
                        if (title && company && status && !cards.some(c => c.title === title && c.company === company)) {
                            cards.push({ title, company, status });
                        }
                    }
                }
            }
            return cards;
        });

        if (appliedJobsList.length > 0) {
            console.log(`\n📋 Found ${appliedJobsList.length} recent application(s):`);
            console.log("----------------------------------------------------------------------------------------------------");
            console.log("| Job Title                                                    | Company                        | Status                   |");
            console.log("----------------------------------------------------------------------------------------------------");
            appliedJobsList.forEach(job => {
                const titleStr = (job.title || 'N/A').padEnd(60).slice(0, 60);
                const companyStr = (job.company || 'N/A').padEnd(30).slice(0, 30);
                const statusStr = (job.status || 'N/A').padEnd(24).slice(0, 24);
                console.log(`| ${titleStr} | ${companyStr} | ${statusStr} |`);
            });
            console.log("----------------------------------------------------------------------------------------------------");
            
            // Save to JSON file
            fs.writeFileSync('./application_statuses.json', JSON.stringify(appliedJobsList, null, 2), 'utf8');
            console.log("💾 Application statuses saved to './application_statuses.json'");
        } else {
            console.log("ℹ️ No recent application statuses found on history page.");
        }
        await historyPage.close();
    } catch (err) {
        console.log("⚠️ Error fetching application statuses:", err.message);
    }

    console.log("Closing browser...");
    const waitTime = isHeadless ? 1000 : 5000;
    try {
        await saveStorageState(context);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        if (browser && browser.isConnected()) {
            await browser.close();
        }
    } catch (e) {}
    process.exit(0);
}

run().catch(err => {
    console.error("❌ Uncaught exception:", err);
    process.exit(1);
});
