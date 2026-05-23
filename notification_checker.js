const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const fs = require('fs');
require('dotenv').config();

const EMAIL = process.env.NAUKRI_EMAIL;
const PASSWORD = process.env.NAUKRI_PASSWORD;
const MY_EMAIL = 'am618035@gmail.com';
const APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || process.env.NAUKRI_PASSWORD;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes

const SEEN_FILE = './seen_notifications.json';

let seenNotifications = [];
try {
    if (fs.existsSync(SEEN_FILE)) {
        seenNotifications = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    }
} catch (e) {
    console.log("Could not load seen notifications file. Starting fresh.");
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: MY_EMAIL,
        pass: APP_PASSWORD
    }
});

async function resilientAction(page, actionName, locators, actionType = 'click', value = '') {
    for (const locator of locators) {
        try {
            if (await locator.isVisible({ timeout: 4000 })) {
                if (actionType === 'click') {
                    await locator.click({ timeout: 4000 });
                } else if (actionType === 'fill') {
                    await locator.click({ timeout: 2000 }).catch(() => {});
                    await locator.focus({ timeout: 2000 }).catch(() => {});
                    await locator.fill(value, { timeout: 4000 });
                }
                return true;
            }
        } catch (e) {}
    }
    console.log(`[Warning] Could not perform action: ${actionName}`);
    return false;
}

async function sendEmailNotification(newNotifications) {
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

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email alert sent successfully to ${MY_EMAIL}.`);
    } catch (error) {
        console.log(`❌ Could not send email notification.`);
        console.log(`   Error: ${error.message}`);
    }
}

async function checkNotifications() {
    console.log(`\n[${new Date().toLocaleString()}] 🔍 Starting Notification Scan...`);
    
    if (!EMAIL || !PASSWORD) {
        console.error("❌ Please provide NAUKRI_EMAIL and NAUKRI_PASSWORD in the .env file.");
        return;
    }

    const browser = await chromium.launch({ headless: false, slowMo: 150 });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
        console.log("➡️  Navigating to Naukri login...");
        await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        await page.waitForSelector('#usernameField', { state: 'visible', timeout: 20000 }).catch(() => {});

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
            try { await page.locator('button[type="submit"]').click({ timeout: 2000 }); } catch (e) { }
        }

        console.log("⏳ Waiting for dashboard to load... (Please solve CAPTCHA if prompted)");
        await page.waitForURL(/.*naukri.com\/(mnjuser\/homepage|jobs|mnjuser\/profile|mnjuser\/notifications).*/, { timeout: 120000 });
        console.log("✅ Logged in successfully.");

        // Wait for page to render
        await page.waitForTimeout(5000);

        console.log("🔔 Locating and clicking Notification Bell...");
        const clickedBell = await resilientAction(page, 'Click Bell Icon', [
            page.locator('.nI-gNb-icon-bell').first(),
            page.locator('[class*="bell"]').first(),
            page.locator('.nI-gNb-notification').first(),
            page.locator('a[href*="notifications"]').first()
        ]);

        if (!clickedBell) {
            console.log("❌ Could not find Bell icon on page. Retrying by direct navigation...");
            await page.goto('https://www.naukri.com/mnjuser/notifications', { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(5000);
        } else {
            console.log("✅ Clicked Bell icon. Waiting for drawer/dropdown...");
            await page.waitForTimeout(5000);
        }

        await page.screenshot({ path: '/Users/ajaymishra/Desktop/help/naukri-auto-apply/naukri_notifications_screenshot.png' });
        console.log("📸 Screenshot saved to naukri_notifications_screenshot.png");

        // Locate notification items
        const rawItems = await page.locator('.nI-gNb-ncr__menu-item, .nI-gNb-ncr__menu-item-content, .notification-item, .notification-card, [class*="notification"] li, [class*="drawer"] [class*="card"], .dropdown-list-item, .nI-gNb-notification-dropdown a, [class*="notification"] a, .nI-gNb-drawer a, .nI-gNb-drawer li, .nI-gNb-drawer div').all();
        const drawerInfo = await page.evaluate(() => {
            const divs = Array.from(document.querySelectorAll('div, section, aside'));
            const drawerDiv = divs.find(el => {
                const className = typeof el.className === 'string' ? el.className : '';
                return className.includes('drawer') || className.includes('Drawer') || className.includes('notification') || className.includes('Notification');
            });
            if (!drawerDiv) return "No drawer div found.";
            return Array.from(drawerDiv.querySelectorAll('*')).map(el => {
                return {
                    tag: el.tagName.toLowerCase(),
                    class: typeof el.className === 'string' ? el.className : '',
                    id: el.id || '',
                    text: el.innerText ? el.innerText.trim().slice(0, 100) : ''
                };
            }).filter(item => item.text.length > 5);
        }).catch(err => err.message);
        console.log("🔍 Drawer DOM Info:", JSON.stringify(drawerInfo, null, 2));

        console.log(`📊 Found ${rawItems.length} potential notification elements.`);

        let fetchedNotifications = [];
        for (const item of rawItems) {
            try {
                const text = await item.innerText().catch(() => '');
                const cleanedText = text.replace(/\s+/g, ' ').trim();
                if (cleanedText) {
                    console.log(`🔍 Item text: "${cleanedText}"`);
                    if (cleanedText.length > 5 && !fetchedNotifications.includes(cleanedText)) {
                        fetchedNotifications.push(cleanedText);
                    }
                }
            } catch (e) {}
        }

        console.log(`📋 Extracted ${fetchedNotifications.length} unique notifications.`);

        // Find new ones
        const newNotifications = fetchedNotifications.filter(notif => !seenNotifications.includes(notif));

        if (newNotifications.length > 0) {
            console.log(`🎉 Found ${newNotifications.length} new notifications!`);
            newNotifications.forEach(notif => console.log(`👉  New: "${notif}"`));
            
            // Send email
            await sendEmailNotification(newNotifications);

            // Update seen list
            seenNotifications = [...newNotifications, ...seenNotifications].slice(0, 100); // keep last 100
            fs.writeFileSync(SEEN_FILE, JSON.stringify(seenNotifications, null, 2));
        } else {
            console.log("ℹ️  No new notifications detected.");
        }

    } catch (err) {
        console.error("❌ Error during notification check:", err.message);
    } finally {
        console.log("Closing browser...");
        await browser.close().catch(() => {});
    }
}

// Run immediately, then start loop
(async () => {
    await checkNotifications();
    if (process.argv.includes('--once')) {
        console.log("Exiting because --once flag was passed.");
        process.exit(0);
    }
    console.log(`🕒 Notification Checker loop active. Checking every ${CHECK_INTERVAL_MS / 1000 / 60} minutes...`);
    setInterval(checkNotifications, CHECK_INTERVAL_MS);
})();
