const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MY_EMAIL = process.env.NOTIFY_EMAIL || 'am618035@gmail.com';
const APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || process.env.LINKEDIN_PASSWORD;

console.log('==================================================');
console.log('🕒 LINKEDIN CONNECTION RUNNER STARTED');
console.log('==================================================');
console.log('Email notifications will be sent to: ' + MY_EMAIL + '\n');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MY_EMAIL, pass: APP_PASSWORD },
});

async function sendNotification(success, details) {
    const status = success ? 'SUCCESS ✅' : 'FAILED ❌';
    try {
        await transporter.sendMail({
            from: MY_EMAIL,
            to: MY_EMAIL,
            subject: `LinkedIn Connection: ${status}`,
            text: `LinkedIn Connection Assistant ran at ${new Date().toLocaleString()}.\n\nStatus: ${status}\n\nLogs:\n${details}`,
        });
        console.log(`📧 Email notification sent (${status}).`);
    } catch (error) {
        console.log(`⚠️  Could not send email: ${error.message}`);
    }
}

const child = spawn('node', ['linkedin_connection.js'], {
    env: process.env,
    cwd: __dirname,
});

let logs = '';
child.stdout.on('data', (d) => {
    process.stdout.write(d);
    logs += d.toString();
});
child.stderr.on('data', (d) => {
    process.stderr.write(d);
    logs += d.toString();
});

child.on('close', async (code) => {
    const isSuccess = code === 0 && logs.includes('Connection Run Finished');
    await sendNotification(isSuccess, logs);
    process.exit(isSuccess ? 0 : 1);
});
