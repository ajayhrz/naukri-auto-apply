const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'naukri-state.json');

function getStorageStatePath() {
    return process.env.NAUKRI_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE;
}

function isHeadless() {
    return true; // Force headless for all scripts
}

async function launchNaukriBrowser() {
    const headless = isHeadless();
    console.log(`Launching browser: headless=${headless}`);
    return chromium.launch({
        headless,
        slowMo: headless ? 0 : 150,
        args: ['--disable-blink-features=AutomationControlled'],
    });
}

async function createNaukriContext(browser) {
    const statePath = getStorageStatePath();
    const hasState = fs.existsSync(statePath);
    if (hasState) {
        console.log(`🔐 Loading saved session from ${statePath}`);
    }

    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(hasState ? { storageState: statePath } : {}),
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return context;
}

async function saveStorageState(context) {
    const statePath = getStorageStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    console.log(`💾 Saved session to ${statePath}`);
}

async function dismissOverlays(page) {
    const dismissSelectors = [
        'button:has-text("Accept")',
        'button:has-text("Got it")',
        'button:has-text("I agree")',
        '.crossIcon',
        '[class*="crossIcon"]',
    ];
    for (const sel of dismissSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 })) {
                await btn.click({ timeout: 2000 });
                await page.waitForTimeout(500);
            }
        } catch (_) {}
    }
}

async function assertLoginPageReachable(page) {
    const title = await page.title();
    if (/access denied/i.test(title)) {
        const debugPath = process.env.LOGIN_DEBUG_SCREENSHOT || 'naukri-login-blocked.png';
        await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
        throw new Error(
            `Naukri blocked this browser ("${title}"). Use headed mode (do not set PLAYWRIGHT_HEADLESS=true). ` +
                `On Linux CI use xvfb-run. Save a session locally: node scripts/save-naukri-session.js`
        );
    }
}

async function resilientFill(page, actionName, locators, value) {
    for (const locator of locators) {
        try {
            if (await locator.isVisible({ timeout: 5000 })) {
                await locator.click({ timeout: 2000 }).catch(() => {});
                await locator.fill('', { timeout: 2000 }).catch(() => {});
                await locator.fill(value, { timeout: 5000 });
                return true;
            }
        } catch (_) {}
    }
    console.log(`[Self-Healing Warning] Could not perform action: ${actionName}`);
    return false;
}

const LOGGED_IN_URL = /naukri\.com\/(mnjuser\/(homepage|profile)|jobs)/;

async function isLoggedIn(page) {
    return LOGGED_IN_URL.test(page.url());
}

async function trySessionLogin(page) {
    console.log('➡️  Checking saved session...');
    await page.goto('https://www.naukri.com/mnjuser/profile', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    if (await isLoggedIn(page) && !(await page.locator('#usernameField').isVisible({ timeout: 2000 }).catch(() => false))) {
        console.log('✅ Already logged in via saved session.');
        return true;
    }
    return false;
}

async function loginWithCredentials(page, email, password) {
    console.log('➡️  Navigating to Naukri login...');
    await page.goto('https://www.naukri.com/nlogin/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);
    await assertLoginPageReachable(page);

    try {
        await page.waitForSelector('#usernameField', { state: 'visible', timeout: 30000 });
    } catch (_) {
        const debugPath = process.env.LOGIN_DEBUG_SCREENSHOT || 'naukri-login-debug.png';
        await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
        throw new Error(`Login form not found. Screenshot: ${debugPath}`);
    }

    console.log('✍️ Filling email field...');
    const emailFilled = await resilientFill(page, 'Fill Email', [
        page.locator('#usernameField'),
        page.getByLabel(/email|username/i),
        page.locator('input[placeholder*="Email" i]'),
        page.locator('input[placeholder*="Username" i]'),
        page.getByPlaceholder(/email|username/i),
    ], email);
    if (!emailFilled) {
        throw new Error('Failed to fill email on login page.');
    }
    console.log('✅ Email filled.');

    console.log('✍️ Filling password field...');
    const passwordFilled = await resilientFill(page, 'Fill Password', [
        page.locator('#passwordField'),
        page.getByLabel(/password/i),
        page.locator('input[type="password"]').first(),
        page.getByPlaceholder(/password/i),
    ], password);
    if (!passwordFilled) {
        throw new Error('Failed to fill password on login page.');
    }
    console.log('✅ Password filled.');

    console.log('➡️  Submitting login...');
    const loginBtn = page.locator('button[type="submit"], button.login-btn, .loginButton').first();
    if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await loginBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    console.log('⏳ Waiting for login... (solve CAPTCHA manually if a browser window is visible)');
    try {
        await page.waitForURL(LOGGED_IN_URL, { timeout: 120000 });
    } catch (_) {
        if (!(await isLoggedIn(page))) {
            throw new Error('Login did not complete within 120 seconds.');
        }
    }
    console.log('✅ Logged in successfully.');
}

async function ensureNaukriLogin(page, context, { email, password }) {
    if (await trySessionLogin(page)) {
        return;
    }

    if (!email || !password) {
        throw new Error(
            'Not logged in and no saved session. Set NAUKRI_EMAIL/NAUKRI_PASSWORD or run: node scripts/save-naukri-session.js'
        );
    }

    await loginWithCredentials(page, email, password);
    await saveStorageState(context);
}

module.exports = {
    getStorageStatePath,
    launchNaukriBrowser,
    createNaukriContext,
    ensureNaukriLogin,
    loginWithCredentials,
    saveStorageState,
    dismissOverlays,
};
