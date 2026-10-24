# FormDrill

FormDrill is a privacy-first, local-by-default Chrome extension (Manifest V3) designed to help students, applicants, and job-seekers complete long, high-stakes application forms (scholarships, clubs, fellowships, internships, and university admissions).

FormDrill provides confidence-based field classification and autofill, grounded essay drafting assistance, multi-step progress snapshots, and comprehensive readiness and consistency checks.

> **Core Principle:** FormDrill helps you present your real qualifications clearly and consistently. It **never** invents qualifications, **never** shares data with any remote server, and **never automatically submits forms**.

---

## Features

1. **Confidence-Based Autofill, Review & Reliable Undo:**
   - Classifies fields using labels, ARIA attributes, autocomplete tags, and proximity heuristics with high, medium, and low confidence levels.
   - Pre-selects only high-confidence matches in a review checklist before writing to the page.
   - **Persistent Undo:** Both the extension popup and the Workspace Assistant display an **Undo last fill** button whenever an autofill or draft apply operation can be reversed. It safely restores previous field values (and returns previously empty fields to empty), preserves unrelated manual user edits, handles standard inputs, custom dropdowns, and rich-text editors, and never submits the form.
2. **Missing Form Support (Now Complete):**
   - **Accessible Same-Origin Iframes:** Scans and fills forms across accessible same-origin or permitted frames while gracefully handling cross-origin security restrictions.
   - **Rich-Text Editors:** Detects `contenteditable` elements and ARIA `role="textbox"` rich editors. Extracts word count limits, gates content application behind explicit draft review, and updates text safely.
   - **Accessible Custom Dropdowns:** Detects accessible custom dropdown widgets (`role="combobox"`, `role="listbox"`, `aria-haspopup="listbox"`), extracts options, reads selected states, and safely applies selections.
3. **Application Readiness & Consistency Checks:**
   - Detects start/end date contradictions (e.g., project start date after end date).
   - Detects graduation year contradictions between profile facts and essay responses or across multiple essays.
   - Detects GPA contradictions between profile entries and draft text.
   - Detects institution and major mismatches.
   - Detects chronological contradictions in essay text (e.g., "from 2024 to 2021").
   - Identifies generic cliches, unreplaced scaffold placeholders (`[Add ...]`), and unanswered required prompts.
4. **Form Snapshots & Progress Preservation:**
   - Saves form progress locally to `chrome.storage.local`.
   - Strictly excludes passwords, authentication tokens, payment details, and card numbers.
   - Compares the current form structure against saved snapshots before restoring.
5. **Essay Drafting Tools:**
   - Build structured outlines from your saved profile facts.
   - Save multiple drafts locally per question.
   - Word-count tracking and limit enforcement.
   - Brainstorm prompts tailored to application category (scholarship, club, internship, general).

---

## Loading the Extension in Google Chrome

To load FormDrill for personal use or manual testing:

1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. In the top-right corner, toggle on **Developer mode**.
4. In the top-left toolbar, click **Load unpacked**.
5. Select the `extension/` folder inside this project (`formdrill/extension`).
6. FormDrill will appear in your extensions list. Pin it to the Chrome toolbar for quick access.
7. **Testing Local Form Samples:**
   - On the `chrome://extensions` page, click **Details** under FormDrill.
   - Toggle on **Allow access to file URLs**.
   - Open `sample/forms.html` or `sample/advanced_forms.html` in Chrome.
   - Click the FormDrill toolbar icon to test scanning, autofill, snapshots, workspace tools, and Undo.

> **No server, API key, or backend setup is required.** FormDrill runs entirely inside the browser.

---

## Testing & Quality Assurance

FormDrill includes a complete unit test suite (built into Node.js) and comprehensive end-to-end browser test suites (Playwright):

### 1. Run Unit Tests (Node.js)
```bash
npm test
```
Runs 41 automated tests covering:
- Field classification and confidence scoring.
- Option matching and autofill planning.
- Profile validation and backward-compatible list normalization.
- Multi-section profile support: Personal info, 1-7 proficient languages, 10th & 12th standard education, certificates, categorized skills, hobbies with achievements, competitive exams, work experience, online profiles, and custom key-value fields.
- Snapshot serialization and sensitive field exclusion.
- Fact consistency checks across essays and profile records.
- Rich-text editor classification and review gating.
- Custom dropdown planning and option extraction.

### 2. Run Syntax Checks
```bash
npm run check
```
Verifies syntax of all extension JavaScript files across Windows, macOS, and Linux without external shell dependencies.

### 3. Run Browser End-to-End Tests (Playwright)
Prerequisites:
```bash
pip install playwright
python -m playwright install chromium
```

Run test suites:
```bash
python test/e2e/popup.e2e.py          # 19 checks: popup UI, scan, review list, autofill, persistent popup undo, snapshots
python test/e2e/workspace.e2e.py      # 48 checks: workspace onboarding, profile, assistant, essay cards, workspace undo, snapshots, readiness
python test/e2e/form_support.e2e.py   # 15 checks: same-origin iframes, rich-text editors, custom dropdowns, consistency checks
python test/e2e/undo.e2e.py           # 42 checks: standard & advanced forms, empty restoration, unrelated edit preservation, repeated undos, zero form submissions
```
**Total:** 124 automated browser verification checks passing against Chromium.

---

## Architecture Overview

| File | Purpose |
|---|---|
| `extension/manifest.json` | Manifest V3 specification with minimal permissions (`activeTab`, `scripting`, `storage`, `sidePanel`). No optional host permissions. |
| `extension/background.js` | Service worker managing extension lifecycle and first-run onboarding. |
| `extension/core.js` | Pure business logic: classification, autofill planning, consistency checks, snapshot diffing. No network calls. |
| `extension/content.js` | Injected on demand via `activeTab`. Reads DOM, accessible iframes, rich editors, custom dropdowns, and applies approved values. |
| `extension/shared.js` | Safe DOM utilities, Chrome local storage bridge, tab communication. |
| `extension/popup.*` | Action popup providing quick scans, category identification, reviewable autofill, and snapshot saving. |
| `extension/app.*` | Full workspace (side panel or tab): Profile editor, Assistant drafting cards, Readiness checks, Snapshot management, Settings. |

---

## Packaging for Chrome Web Store

To build clean distribution packages:
```bash
npm run package
```
This generates two clean, deterministic ZIP files in the `dist/` directory:
1. `dist/formdrill-extension-0.1.0.zip` (and alias `dist/formdrill-0.1.0.zip`):
   Contains only the extension files ready for upload to the Chrome Web Store Developer Dashboard.
2. `dist/formdrill-project-0.1.0.zip`:
   Complete source archive containing all tests, scripts, samples, and documentation (excluding temporary build artifacts, git history, and node modules).

---

## Chrome Web Store Publication Checklist

Before submitting to the Chrome Web Store:
1. **Developer Registration:** Register as a Chrome Web Store developer at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Privacy Policy Hosting:**
   - Complete the bracketed fields in `PRIVACY.md` (Publisher Name, Support Email, Date).
   - Host the completed privacy policy at a public HTTPS URL (e.g., GitHub Pages).
   - Link the URL in the Developer Dashboard store listing.
3. **Store Listing Assets:**
   - Provide a verified support email address.
   - Upload at least one 1280×800 or 640×400 PNG/JPEG screenshot of the extension.
   - Upload small promotional tile (440×280 PNG).
   - Single-purpose statement: `"Assisting applicants with completing long application forms through confidence-based autofill, grounded essay drafting, and readiness checks."`
4. **Permission Justification:**
   - `activeTab`: Used solely to inspect and populate form fields on the active page upon user request.
   - `scripting`: Used to inject content scripts into the active tab on demand.
   - `storage`: Used to persist user profile, snapshots, and drafts locally on the device.
   - `sidePanel`: Used to display the workspace companion beside application forms.
