# FormDrill Privacy Policy (Draft for Publication)

> **Important Note for Publisher:** Before submitting FormDrill to the Chrome Web Store, host this document at a publicly accessible URL (e.g., GitHub Pages, your personal website, or Notion), fill in the bracketed `[REQUIRED: ...]` placeholders, and link it in the Chrome Web Store Developer Dashboard.

**Last Updated:** [REQUIRED: Insert Date, e.g., October 2026]  
**Publisher / Developer:** [REQUIRED: Insert Developer/Publisher Name]  
**Contact Email:** [REQUIRED: Insert Valid Support/Contact Email]  

---

## 1. Core Principle: Local-First & Privacy by Default
FormDrill is designed to assist users with completing application forms (scholarships, internships, clubs, and general forms) without harvesting, selling, or centralizing user personal data.

FormDrill does **not** operate a remote user database, tracking infrastructure, or analytics service.

## 2. Information Stored Locally on Your Device
All profile data, application responses, form snapshots, and settings remain stored strictly on your local device using Chrome's local extension storage API (`chrome.storage.local`):
- **User Profile Data:** Profile fields (name, email, phone, education, links) and saved factual bullet points that you enter.
- **Form Snapshots:** Field values you explicitly choose to save to preserve progress across application sessions. FormDrill strictly excludes passwords, authentication tokens, payment details, CVV/CVC codes, and sensitive government IDs from snapshots.
- **Drafts:** Answers and outlines you save within the FormDrill workspace.
- **Settings:** Your configuration preferences (e.g., whether optional AI features are enabled and your chosen endpoint).

This data is never transmitted to the extension developer or any third party unless you explicitly choose to configure and invoke an optional AI endpoint.

## 3. Web Page Access and Data Handling
- **On-Demand Access (`activeTab`):** FormDrill only accesses a web page when you explicitly click the FormDrill toolbar action or use the workspace. It never runs background scripts across all visited sites.
- **Reading Form Fields:** FormDrill inspects form inputs, accessible same-origin iframes, rich-text editors, and accessible dropdowns to categorize fields and calculate matching confidence scores. This data is processed locally in browser memory.
- **Writing Form Fields:** FormDrill only fills fields when you explicitly review high-confidence matches and click **Apply** or **Restore**. FormDrill **never** automatically submits any form or clicks submit buttons.
- **Exclusion of Sensitive Fields:** Password fields, payment inputs, file uploads, and hidden security tokens are never scanned or filled.

## 4. Optional AI-Assisted Writing
- **Off by Default:** AI features are disabled by default. No API keys are bundled with the extension.
- **Self-Hosted / Custom Endpoints:** If you enable AI assistance, you must provide your own compatible server endpoint (HTTPS, or `http://localhost` for local development).
- **Explicit Consent and Full Transparency:** Before any data leaves your browser:
  1. FormDrill presents an inspection modal showing the exact destination server and the exact JSON payload.
  2. Only the specific facts and draft text you select are included. Contact information (such as phone numbers and private emails) and unselected profile facts are never included.
  3. Chrome prompts for host permission to that single origin.
  4. No request is dispatched until you explicitly click **Send**.
- **Third-Party AI Policies:** The operator of your configured AI endpoint (and upstream providers such as Anthropic) governs any data processed by that endpoint. Please review their privacy policy and terms of service.

## 5. What FormDrill Does NOT Collect
- No analytics, telemetry, or behavioral tracking.
- No user accounts, passwords, or authentication credentials.
- No browsing history or search activity.
- No cookies or session tokens.
- No advertising data or data sales to data brokers.

## 6. User Control and Data Management
You retain full control over your data at all times via **Settings & privacy** in the FormDrill workspace:
- **Export Data:** Download your complete profile as a JSON file to your local computer.
- **Import Data:** Restore or migrate your profile from a JSON file.
- **Selective Deletion:** Remove individual facts, profile entries, drafts, or form snapshots at any time.
- **Delete All Data:** A single button permanently wipes all stored local data (`chrome.storage.local.clear()`).

## 7. Compliance and Contact
For questions regarding this privacy policy or FormDrill's data practices, please contact:
- **Email:** [REQUIRED: Insert Contact Email]
- **Repository / Website:** [REQUIRED: Insert Website/Repository URL]

*(This draft policy provides factual disclosure of extension behavior; have it reviewed against the applicable legal requirements of your target publication jurisdictions prior to release.)*
