# FormDrill Privacy Policy


**Effective Date:** October 23, 2026  
**Publisher / Developer:** Anushka Sharma  
**Contact Email:** annushkaa2604@gmail.com  
**Website / Repository:** https://anushka1330.github.io/formdrill-privacy/ 

---

## 1. Overview & Core Philosophy
FormDrill is a client-side Chrome extension (Manifest V3) created to assist students, applicants, and job-seekers in completing lengthy, repetitive application forms (such as scholarships, fellowships, university admissions, clubs, and internships). 

FormDrill operates under a strict **local-by-default, privacy-first principle**:
- FormDrill does **not** transmit data to external servers.
- FormDrill does **not** require an account, login, or registration.
- FormDrill does **not** integrate third-party analytics, tracking beacons, advertising networks, or remote telemetry.
- FormDrill does **not** use remote cloud AI services or remote API keys. All field classification, word counting, outline drafting, and consistency checks run entirely inside your browser's local JavaScript runtime.

---

## 2. Information Stored Locally on Your Device
All information managed by FormDrill is stored strictly on your local device using Chrome's extension storage API (`chrome.storage.local`). This data is never transferred to the developer or any third party:

1. **User Profile Information**:
   - **Personal & Contact Details**: Full name, first/last name, email, phone number, date of birth, nationality, city, state/province, country, current address, permanent address, and postal code.
   - **Proficient Languages**: Up to 7 user-entered languages.
   - **Education Details**: 10th and 12th Standard records (school name, board, stream, passing year, results/grades) and Higher Education details (institution, degree, major, graduation year, GPA).
   - **Certificates & Documents**: Certificate names, issuing organizations, and any supporting files (images or PDFs, max 5 MB) that you choose to attach. Attached documents are converted into local data URLs and stored exclusively on your device.
   - **Skills & Categories**: Skills categorized into Technical, Communication, Tools, or Practical Skills.
   - **Hobbies & Interests**: User-added hobbies, categories, and achievements.
   - **Government & Competitive Exams**: Exam names, years, and optional scorecard file attachments.
   - **Work & Experience**: Company name, job title, start/end dates, roles/responsibilities, and optional supporting document attachments.
   - **Links & Online Profiles**: LinkedIn, GitHub, portfolio, coding profiles, and custom URLs.
   - **General Form Details & Custom Fields**: Occupation, organization, designation, preferred contact/location, reusable short answers, and user-defined key-value fields.
   - **Facts & Achievements**: Verified or unverified bullet points you enter to help outline essay prompts.

2. **Form Snapshots**:
   - Field values that you explicitly save via the popup or workspace to preserve progress across multi-step or session-expired forms.
   - **Strict Sensitive-Data Exclusion**: FormDrill automatically detects and strictly excludes passwords, authentication tokens, CSRF tokens, credit card numbers, CVVs, card expiration dates, social security numbers, and one-time passwords (OTPs) from snapshots.

3. **Drafts & Settings**:
   - Essay outlines and written drafts you save for application prompts.
   - Extension preferences, such as first-run onboarding completion status.

---

## 3. Web Page Access & Permissions
FormDrill requests only the minimal permissions required for its functionality:

| Permission | Purpose & Scope |
|---|---|
| `activeTab` | Grants temporary access to inspect and interact with the active web page only when you explicitly invoke the FormDrill toolbar action or workspace. FormDrill has no permanent host permissions and never monitors your background browsing activity. |
| `scripting` | Allows FormDrill to inject its local content script into the active tab on demand to scan form fields and apply user-approved values. |
| `storage` | Grants access to Chrome's local extension storage (`chrome.storage.local`) to persist your profile, drafts, snapshots, and preferences on your device. |
| `sidePanel` | Displays the FormDrill workspace as a companion side panel beside the active webpage in supported versions of Chrome. |

---

## 4. How Web Page Data is Handled
- **Reading Fields**: When you click "Scan", FormDrill inspects form inputs, accessible same-origin iframes, rich-text editors, and custom dropdowns on the page to categorize them and determine match confidence. Field labels and values are processed in browser memory and are not stored unless you save a snapshot or draft.
- **Filling Fields**: FormDrill only writes values to fields that you explicitly review and approve. FormDrill **never automatically submits forms** and never clicks submit buttons.
- **Excluded Inputs**: Password fields, payment inputs, file upload elements, and hidden security tokens are never scanned or populated.

---

## 5. What FormDrill Does NOT Collect or Share
- No personal data collection by the developer.
- No remote telemetry, diagnostic crash reports, or analytics.
- No cookies, session identifiers, or browsing history tracking.
- No data selling, renting, or monetization.
- No third-party network requests.

---

## 6. User Control & Data Retention
You retain complete control over your data directly within the **Settings & privacy** tab of the FormDrill workspace:
- **Export Data**: Download your entire profile as a readable JSON file (`formdrill-profile.json`).
- **Import Data**: Import and validate an existing profile JSON file.
- **Selective Deletion**: Delete individual facts, languages, education records, drafts, or snapshots at any time.
- **Delete All Data**: Click "Delete all data" to permanently erase all stored profiles, snapshots, drafts, and settings via `chrome.storage.local.clear()`.

---

## 7. Contact Information & Developer Details
For questions, feedback, or support regarding this privacy policy or FormDrill, please reach out to:
- **Developer / Publisher:** Anushka Sharma 
- **Contact Email:** annushkaa2604@gmail.com
- **Project URL:** https://anushka1330.github.io/formdrill-privacy/