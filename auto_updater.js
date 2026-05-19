const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
require('dotenv').config();

// 2 hours in milliseconds
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MY_EMAIL = 'am618035@gmail.com';
const APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || process.env.NAUKRI_PASSWORD;

console.log("==================================================");
console.log("🕒 NAUKRI AUTO-UPDATER STARTED");
console.log("==================================================");
console.log("Your profile will be automatically updated every 2 hours.");
console.log("Email notifications will be sent to: " + MY_EMAIL);
console.log("Press Ctrl+C to stop it at any time.\n");

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: MY_EMAIL,
        pass: APP_PASSWORD
    }
});

async function sendNotification(success, details) {
    const status = success ? "SUCCESS ✅" : "FAILED ❌";
    
    const mailOptions = {
        from: MY_EMAIL,
        to: MY_EMAIL,
        subject: `Naukri Auto-Updater: ${status}`,
        text: `The Naukri Profile Auto-Updater ran at ${new Date().toLocaleString()}.\n\nStatus: ${status}\n\nLogs:\n${details}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email notification sent successfully (${status}).`);
    } catch (error) {
        console.log(`⚠️  Could not send email notification. Ensure you have added EMAIL_APP_PASSWORD to your .env file.`);
        console.log(`   Error: ${error.message}`);
    }
}

function runUpdater() {
    console.log(`\n[${new Date().toLocaleString()}] 🚀 Launching Profile Updater...`);
    
    // Spawn the child process for update_profile.js
    const child = spawn('node', ['update_profile.js']);
    
    let logs = "";
    
    child.stdout.on('data', (data) => {
        process.stdout.write(data);
        logs += data.toString();
    });
    
    child.stderr.on('data', (data) => {
        process.stderr.write(data);
        logs += data.toString();
    });
    
    child.on('close', async (code) => {
        console.log(`\n[${new Date().toLocaleString()}] ✅ Updater finished.`);
        
        // Check logs to see if it actually bumped the profile successfully
        const isSuccess = logs.includes("Successfully updated Resume Headline");
        
        console.log(`➡️  Sending email report...`);
        await sendNotification(isSuccess, logs);
        
        console.log(`💤 Sleeping for 2 hours...`);
    });
}

// Run immediately on start
runUpdater();

// Run every 2 hours
setInterval(runUpdater, TWO_HOURS_MS);
