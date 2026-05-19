# Naukri Auto Apply Bot

This is a Playwright JS bot that automates the process of applying to jobs on Naukri.com.

## Features:
- **Easy Apply Filter**: Identifies jobs that can be applied directly on Naukri ("APPLIED SUCCESSFULLY") and skips jobs that require external applications ("REDIRECT NOT APPLY").
- **Self-Healing Capabilities**: Uses robust, fallback locators (e.g. multiple ways to find the Apply button, Login button, etc.) to handle minor UI changes or dynamic elements without crashing.
- **Resume Upload**: Automatically attempts to upload your resume if Naukri prompts for it during the easy apply flow.
- **Human-like Delays**: Adds random delays between actions to prevent getting blocked by Naukri's bot detection.

## Setup Instructions

1. **Install Dependencies**
   If you haven't already, install the Node.js packages:
   ```bash
   npm install
   npx playwright install chromium
   ```

2. **Configure your Details**
   Open the `.env` file in this directory and fill out your information:
   ```env
   NAUKRI_EMAIL=your_actual_email@gmail.com
   NAUKRI_PASSWORD=your_actual_password
   JOB_KEYWORD=frontend developer
   RESUME_PATH=/Users/ajaymishra/Desktop/my_resume.pdf
   ```
   *(Note: Leave `RESUME_PATH` blank if your resume is already updated on your Naukri profile and you just want the bot to click "Apply".)*

3. **Run the Bot**
   Execute the script using node:
   ```bash
   node index.js
   ```

## Note on Captchas
The browser runs in "headed" (visible) mode. When it attempts to log in, if Naukri presents a CAPTCHA or an OTP challenge, you will have roughly 30 seconds to solve it manually on the screen before the bot proceeds to search for jobs.
