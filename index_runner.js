const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
require('dotenv').config();

const MY_EMAIL = 'am618035@gmail.com';
const APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || process.env.NAUKRI_PASSWORD;

console.log("==================================================");
console.log("🕒 NAUKRI AUTO-APPLY RUNNER STARTED");
console.log("==================================================");
console.log("This script will run the Naukri auto-apply script, send an email, and exit.");
console.log("Email notifications will be sent to: " + MY_EMAIL + "\n");

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
        subject: `Naukri Auto-Apply: ${status}`,
        text: `The Naukri Job Auto-Apply ran at ${new Date().toLocaleString()}.\n\nStatus: ${status}\n\nLogs:\n${details}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email notification sent successfully (${status}).`);
    } catch (error) {
        console.log(`⚠️  Could not send email notification. Ensure you have added EMAIL_APP_PASSWORD to your .env file.`);
        console.log(`   Error: ${error.message}`);
    }
}

function runAutoApply() {
    console.log(`\n[${new Date().toLocaleString()}] 🚀 Launching Naukri Auto-Apply...`);
    
    const child = spawn('node', ['index.js'], {
        env: process.env,
        cwd: __dirname,
    });
    
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
        console.log(`\n[${new Date().toLocaleString()}] ✅ Auto-apply script finished with code ${code}.`);
        
        // Success criteria: exited with 0 AND contains FINAL REPORT
        const isSuccess = (code === 0) && logs.includes("FINAL REPORT");
        
        console.log(`➡️  Sending email report...`);
        await sendNotification(isSuccess, logs);
        
        console.log(`✅ All done! Exiting...`);
        process.exit(isSuccess ? 0 : 1);
    });
}

runAutoApply();
