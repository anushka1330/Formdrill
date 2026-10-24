/* FormDrill core: pure logic, no DOM/Chrome APIs. Loaded by content script, extension pages and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FormDrillCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const norm = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.[\]]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const isEmpty = (v) => v === '' || v == null || v === false;

  /* ---------- profile ---------- */
  const PROFILE_FIELDS = [
    ['fullName', 'Full name', 'Personal'], ['firstName', 'First name', 'Personal'], ['lastName', 'Last name', 'Personal'],
    ['email', 'Email', 'Personal'], ['phone', 'Phone', 'Personal'],
    ['dob', 'Date of birth', 'Personal'], ['nationality', 'Nationality', 'Personal'],
    ['state', 'State / province', 'Personal'], ['country', 'Country', 'Personal'],
    ['currentAddress', 'Current address', 'Personal'], ['permanentAddress', 'Permanent address', 'Personal'],
    ['city', 'City', 'Personal'], ['postalCode', 'Postal code', 'Personal'],
    ['institution', 'Institution', 'Education'], ['degree', 'Degree / program', 'Education'], ['major', 'Major / field', 'Education'],
    ['gradYear', 'Graduation year', 'Education'], ['gpa', 'GPA / grade', 'Education'],
    ['website', 'Personal portfolio / website', 'Links'], ['linkedin', 'LinkedIn', 'Links'], ['github', 'GitHub', 'Links'],
    ['codingProfile', 'Coding profile URL', 'Links'],
    ['occupation', 'Occupation / current status', 'General'], ['organization', 'Organisation / company', 'General'],
    ['designation', 'Designation / role title', 'General'], ['preferredContact', 'Preferred contact method', 'General'],
    ['preferredLocation', 'Preferred location', 'General']
  ].map(([key, label, section]) => ({ key, label, section }));
  /* List-style sections stored in profile.lists (arrays of objects). */
  const LIST_SECTIONS = ['languages', 'edu10', 'edu12', 'certificates', 'skills', 'hobbies', 'exams', 'work', 'links', 'customFields'];
  const EDUCATION_STREAMS = ['Science', 'Commerce', 'Arts/Humanities', 'Vocational', 'Other'];
  const SKILL_CATEGORIES = ['Technical Skills', 'Communication Skills', 'Software and Tools', 'Other Practical Skills'];
  const HOBBY_CATEGORIES = ['Sports and Fitness', 'Reading and Writing', 'Music and Dance', 'Art and Creativity', 'Technology', 'Travel and Exploration', 'Volunteering and Social Activities', 'Other'];
  const LINK_LABELS = ['LinkedIn', 'GitHub', 'Personal Portfolio', 'Coding Profile', 'Other'];
  const FACT_SECTIONS = ['Education', 'Skills', 'Projects', 'Clubs & volunteering', 'Awards', 'Work & internships', 'Goals', 'Personal experience', 'Writing preferences'];
  const FACT_STATUS = ['verified', 'unverified'];
  const emptyProfile = () => ({ v: 1, fields: {}, facts: [], lists: { languages: [], edu10: [], edu12: [], certificates: [], skills: [], hobbies: [], exams: [], work: [], links: [], customFields: [] } });
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validateProfile(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['Profile must be an object.'] };
    if (!p.fields || typeof p.fields !== 'object' || Array.isArray(p.fields)) errors.push('Profile fields are missing.');
    else for (const [k, v] of Object.entries(p.fields)) {
      if (typeof v !== 'string') errors.push(`Field "${k}" must be text.`);
      else if (v.length > 5000) errors.push(`Field "${k}" is too long.`);
    }
    if (p.fields && p.fields.email && !EMAIL_RE.test(p.fields.email)) errors.push('Email address looks invalid.');
    if (p.fields && p.fields.website && !validUrl(p.fields.website)) errors.push('Website must be a full http(s) URL.');
    if (!Array.isArray(p.facts)) errors.push('Facts must be a list.');
    else p.facts.forEach((f, i) => {
      if (!f || typeof f.text !== 'string' || !f.text.trim()) errors.push(`Fact ${i + 1} has no text.`);
      else if (f.text.length > 2000) errors.push(`Fact ${i + 1} is too long.`);
      if (f && !FACT_STATUS.includes(f.status)) errors.push(`Fact ${i + 1} needs a status (verified or unverified).`);
    });
    /* Validate list sections (arrays). Each entry must be a plain object; no deep field validation needed here. */
    if (p.lists !== undefined) {
      if (typeof p.lists !== 'object' || Array.isArray(p.lists)) errors.push('Profile lists must be an object.');
      else for (const k of LIST_SECTIONS) {
        if (p.lists[k] !== undefined && !Array.isArray(p.lists[k])) errors.push(`Profile list "${k}" must be an array.`);
      }
      /* Languages: between 0 and 7, each must have a name string */
      const langs = Array.isArray(p.lists && p.lists.languages) ? p.lists.languages : [];
      if (langs.length > 7) errors.push('At most 7 languages are supported.');
      langs.forEach((l, i) => { if (!l || typeof l.name !== 'string' || !l.name.trim()) errors.push(`Language ${i + 1} has no name.`); });
    }
    return { ok: errors.length === 0, errors };
  }
  function normalizeProfile(p) {
    const base = emptyProfile();
    if (!p || typeof p !== 'object') return base;
    for (const [k, v] of Object.entries(p.fields || {})) if (typeof v === 'string') base.fields[k] = v;
    base.facts = (Array.isArray(p.facts) ? p.facts : []).filter((f) => f && typeof f.text === 'string' && f.text.trim())
      .map((f, i) => ({ id: String(f.id || 'f' + Date.now().toString(36) + i), text: f.text.trim(), section: FACT_SECTIONS.includes(f.section) ? f.section : 'Personal experience', status: f.status === 'verified' ? 'verified' : 'unverified' }));
    /* Migrate list sections — keep any valid array, default to empty. */
    const src = (p.lists && typeof p.lists === 'object' && !Array.isArray(p.lists)) ? p.lists : {};
    for (const k of LIST_SECTIONS) base.lists[k] = Array.isArray(src[k]) ? src[k].filter((x) => x && typeof x === 'object') : [];
    /* Clamp languages to 7. */
    base.lists.languages = base.lists.languages.slice(0, 7);
    return base;
  }

  /* ---------- sensitivity ---------- */
  const SENSITIVE = /passw(or)?d|passport|token|csrf|xsrf|secret|cvv|cvc|card[-_ ]?num|cc[-_ ]?(num|exp|csc)|ssn|social[-_ ]?security|(^|[^a-z])otp([^a-z]|$)/i;
  function isSensitive(m) {
    const t = String(m.type || '').toLowerCase(), ac = String(m.autocomplete || '');
    if (['password', 'hidden', 'file'].includes(t)) return true;
    if (/^cc-|password|one-time-code/.test(ac)) return true;
    return SENSITIVE.test((m.name || '') + ' ' + (m.id || ''));
  }

  /* ---------- field classification ---------- */
  const RULES = [
    { key: 'firstName', ac: ['given-name'], re: /\b(first|given) name\b|\bforename\b/ },
    { key: 'lastName', ac: ['family-name'], re: /\b(last|family) name\b|\bsurname\b/ },
    { key: 'fullName', ac: ['name'], re: /\b(full|legal|applicant|candidate|your) name\b|^name$/ },
    { key: 'email', ac: ['email'], types: ['email'], re: /\be ?mail\b/ },
    { key: 'phone', ac: ['tel'], types: ['tel'], re: /\b(phone|mobile|telephone|cell|contact number)\b/ },
    { key: 'dob', ac: ['bday'], types: ['date'], re: /\b(date of birth|birth ?date|dob|born on)\b/ },
    { key: 'nationality', re: /\bnationality\b/ },
    { key: 'currentAddress', ac: ['street-address', 'address-line1'], re: /\b(current|present|residential|home|mailing) address\b|^address$|\baddress line\b/ },
    { key: 'permanentAddress', re: /\b(permanent|native|hometown) address\b/ },
    { key: 'city', ac: ['address-level2'], re: /\b(city|town)\b/ },
    { key: 'state', ac: ['address-level1'], re: /\b(state|province|region)\b/ },
    { key: 'postalCode', ac: ['postal-code'], re: /\b(zip|postal|postcode|pin code)\b/ },
    { key: 'country', ac: ['country', 'country-name'], re: /\bcountry (of (residence|origin|citizenship))?\b|\bcountry$/ },
    { key: 'institution', re: /\b(institution|college|university|school)( name)?\b/ },
    { key: 'degree', re: /\b(degree|program of study|programme|course of study)\b/ },
    { key: 'major', re: /\b(major|field of study|department|branch)\b/ },
    { key: 'gradYear', re: /\bgraduat\w*\b|\bgrad year\b|\bpassing year\b|\byear of pass(ing|out)\b|\bpass(ed)? (out )?year\b/ },
    { key: 'gpa', re: /\b(gpa|cgpa|grade point|percentage|marks|result|score)\b/ },
    { key: 'linkedin', re: /linkedin/ },
    { key: 'github', re: /github/ },
    { key: 'codingProfile', re: /leetcode|codeforces|hackerrank|codechef|coding profile/ },
    { key: 'website', types: ['url'], re: /\b(website|portfolio|personal site|blog)\b/ },
    { key: 'occupation', re: /\b(occupation|employment status|current status|profession)\b/ },
    { key: 'organization', re: /\b(organisation|organization|company|employer|institute)( name)?\b/ },
    { key: 'designation', re: /\b(designation|job title|position|role|title)\b/ },
    { key: 'preferredContact', re: /preferred (contact|communication) (method|mode)/ },
    { key: 'preferredLocation', re: /preferred (location|city|work location)/ }
  ];
  const ESSAY = [
    { key: 'essay.motivation', re: /\bwhy\b.*\b(you|join|apply|deserve|interested|want)\b|statement of purpose|motivation|personal statement/ },
    { key: 'essay.experience', re: /relevant experience|previous (activities|experience)|tell us about a time|initiative|describe .*(project|experience|time)|work experience/ },
    { key: 'essay.goals', re: /\b(goals?|future plans|career|aspirations)\b/ },
    { key: 'essay.contribution', re: /contribut|\bevent\b|pitch|differently|\bideas?\b/ }
  ];
  function score(rule, f, t) {
    const p = [];
    if (rule.ac && rule.ac.includes(norm(f.autocomplete))) p.push([0.95, 'autocomplete attribute']);
    if (rule.types && rule.types.includes(f.type)) p.push([0.8, 'input type']);
    if (rule.re) {
      if (rule.re.test(t.label)) p.push([0.8, 'label / aria text']);
      if (rule.re.test(t.name)) p.push([0.65, 'name / id']);
      if (rule.re.test(t.ph)) p.push([0.4, 'placeholder']);
      if (rule.re.test(t.near)) p.push([0.3, 'nearby text']);
    }
    return { s: p.length ? Math.min(0.99, 1 - p.reduce((a, x) => a * (1 - x[0]), 1)) : 0, reasons: p.map((x) => x[1]) };
  }
  function classifyField(f) {
    const t = { label: norm((f.label || '') + ' ' + (f.aria || '')), name: norm((f.name || '') + ' ' + (f.id || '')), ph: norm(f.placeholder), near: norm(f.nearby) };
    const isLong = f.tag === 'textarea' || f.type === 'richtext' || (f.maxlength || 0) > 200;
    const rules = isLong ? ESSAY.concat(RULES.filter((r) => r.key === 'address')) : RULES;
    const ranked = rules.map((r) => { const x = score(r, f, t); return { key: r.key, confidence: x.s, reasons: x.reasons }; })
      .filter((x) => x.confidence > 0).sort((a, b) => b.confidence - a.confidence);
    if (!ranked.length) return { key: isLong ? 'essay.other' : '', confidence: isLong ? 0.5 : 0, level: 'low', ambiguous: false, alternatives: [], reasons: [] };
    const top = ranked[0], second = ranked[1];
    const ambiguous = !!second && second.confidence >= top.confidence - 0.15 && second.confidence >= 0.5;
    const level = ambiguous ? 'low' : top.confidence >= 0.8 ? 'high' : top.confidence >= 0.5 ? 'medium' : 'low';
    return { key: top.key, confidence: Number(top.confidence.toFixed(2)), level, ambiguous, alternatives: ranked.slice(0, 3).map((x) => x.key), reasons: top.reasons };
  }

  /* ---------- application category ---------- */
  const CATEGORIES = { scholarship: 'Scholarship / financial aid', club: 'Club / society', internship: 'Internship / job', admissions: 'Admissions / academic program', leadership: 'Leadership / student council', fellowship: 'Fellowship / volunteering / competition', general: 'General form' };
  const CAT_RULES = {
    scholarship: [/scholarship/g, /financial (aid|need)|tuition|bursary|stipend/g],
    club: [/\bclub\b/g, /\bsociety\b|\bchapter\b|membership/g],
    internship: [/internship|\bintern\b/g, /employer|resume|cover letter|\bjob\b|work experience/g],
    admissions: [/admission|undergraduate|postgraduate|graduate program/g, /statement of purpose|transcript/g],
    leadership: [/student council|leadership position|nomination|elected/g, /\bpresident\b|\bcandidate\b/g],
    fellowship: [/fellowship|volunteer|hackathon|competition/g]
  };
  function detectCategory(text) {
    const t = String(text || '').toLowerCase(), scores = {};
    for (const [c, res] of Object.entries(CAT_RULES)) scores[c] = res.reduce((n, re, i) => n + (t.match(re) || []).length * (i === 0 ? 2 : 1), 0);
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return { category: best[1] === 0 ? 'general' : best[0], scores, suggested: true };
  }

  /* ---------- text, limits, validation ---------- */
  const countWords = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  function extractWordLimit(text) {
    const s = String(text || '');
    const m = s.match(/(\d{2,5})\s*words?\b/i) || s.match(/word limit[:\s]*(\d{2,5})/i);
    return m ? Number(m[1]) : null;
  }
  function checkWordLimit(text, limit) { const n = countWords(text); return { words: n, limit: limit || null, over: !!limit && n > limit }; }
  function validUrl(v) { try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; } }
  function validateValue(f) {
    const v = f.value;
    if (isEmpty(v) || typeof v !== 'string') return null;
    if (f.type === 'email' || f.key === 'email') return EMAIL_RE.test(v) ? null : 'is not a valid email address';
    if (f.type === 'url' || f.key === 'website') return validUrl(v) ? null : 'is not a valid http(s) URL';
    if (f.type === 'number') return Number.isFinite(Number(v)) ? null : 'is not a number';
    if (f.type === 'date') { const d = new Date(v + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(d) ? null : 'is not a valid date'; }
    return null;
  }
  const GENERIC = [[/passionate about/i, '"passionate about" is generic: show it with an example'], [/since (i was )?a (young age|child)/i, '"since a young age" is a common opener'], [/hard[- ]?working/i, '"hard-working" is a claim; show it instead'], [/team player/i, '"team player" is a claim; give a specific team moment'], [/make a (positive )?difference/i, '"make a difference": say what, for whom'], [/dream (job|come true)/i, '"dream come true" is generic'], [/unique opportunity/i, '"unique opportunity": say what is unique'], [/fast learner/i, '"fast learner": cite something you learned quickly']];
  function genericFlags(text) {
    const out = GENERIC.filter(([re]) => re.test(text || '')).map((x) => x[1]);
    if (countWords(text) > 60 && !/\d/.test(text)) out.push('No numbers, dates or names yet: concrete specifics make answers more convincing');
    return out;
  }
  const hasPlaceholders = (t) => /\[(Add|Opening|Closing|Body)[^\]]*\]/.test(t || '');

  /* ---------- matching options / autofill planning ---------- */
  function matchOption(options, value) {
    const v = norm(value);
    if (!v || !options) return null;
    return options.find((o) => norm(o.value) === v || norm(o.label) === v) || options.find((o) => norm(o.label).includes(v) || (norm(o.label) && v.includes(norm(o.label)))) || null;
  }
  function planAutofill(fields, profile) {
    const items = [], skipped = [];
    for (const f of fields) {
      const key = f.key || (f.classification && f.classification.key);
      if (!key || key.startsWith('essay.')) continue;
      const value = profile.fields && profile.fields[key];
      if (!value) { skipped.push({ id: f.id, reason: 'No saved value in profile' }); continue; }
      let out = value;
      if (f.options) { const o = matchOption(f.options, value); if (!o) { skipped.push({ id: f.id, reason: 'No matching option for your saved value' }); continue; } out = o.value; }
      const c = f.classification || {};
      items.push({ id: f.id, key, value: out, confidence: c.confidence || 0, level: c.level || 'low', needsConfirm: c.level !== 'high' });
    }
    return { items, skipped };
  }
  // Consent gate: nothing is applied unless the caller passes explicit approved ids.
  function applyPlan(items, approvedIds, setter) {
    const ok = new Set(Array.isArray(approvedIds) ? approvedIds : []);
    const applied = [], skipped = [];
    for (const it of items) (ok.has(it.id) && setter(it.id, it.value) ? applied : skipped).push(it.id);
    return { applied, skipped };
  }

  /* ---------- review / readiness ---------- */
  // Flags start/end date pairs (same label apart from the start/end word) where start is after end.
  function dateConflicts(fields) {
    const START = /\b(start|from|begin\w*)\b/, END = /\b(end|to|until|finish\w*)\b/, out = [];
    const ds = fields.filter((f) => f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(f.value || ''));
    const stem = (f, re) => norm(f.label || f.name).replace(re, '').replace(/\s+/g, ' ').trim();
    for (const a of ds) for (const b of ds) {
      if (a === b || !START.test(norm(a.label || a.name)) || !END.test(norm(b.label || b.name))) continue;
      if (stem(a, new RegExp(START.source, 'g')) === stem(b, new RegExp(END.source, 'g')) && a.value > b.value) out.push({ startId: a.id, endId: b.id, message: `${a.label || a.name} (${a.value}) is after ${b.label || b.name} (${b.value})` });
    }
    return out;
  }
  function checkConsistency(fields, profile) {
    const issues = [];
    const prof = (profile && typeof profile === 'object') ? profile : { fields: {}, facts: [] };
    const pFields = prof.fields || {};
    const pFacts = Array.isArray(prof.facts) ? prof.facts : [];
    const essayFields = (fields || []).filter((f) => f && typeof f.value === 'string' && f.value.trim() && (String(f.key || '').startsWith('essay.') || f.tag === 'textarea' || f.type === 'richtext'));
    const allTextFields = (fields || []).filter((f) => f && typeof f.value === 'string' && f.value.trim());

    const gradYearRe = /\b(?:graduat\w*|class of)\s*(?:in\s*)?(\b20\d{2}\b)/i;
    const gpaRe = /(?:gpa|grade point average|cgpa)\s*(?:of|is|:)?\s*([0-4](?:\.\d{1,2})?|\b[0-4]\.\d{1,2}\b)/i;
    const gpaRe2 = /\b([0-4]\.\d{1,2})\s*(?:gpa|cgpa)\b/i;

    // 1. Graduation year
    let profileGrad = pFields.gradYear ? String(pFields.gradYear).match(/\b20\d{2}\b/)?.[0] : null;
    if (!profileGrad) {
      for (const fact of pFacts) {
        const m = (fact.text || '').match(gradYearRe);
        if (m) { profileGrad = m[1]; break; }
      }
    }
    if (profileGrad) {
      for (const f of allTextFields) {
        if (f.key === 'gradYear' && f.value) {
          const valYear = f.value.match(/\b20\d{2}\b/)?.[0];
          if (valYear && valYear !== profileGrad) {
            issues.push({ severity: 'error', id: f.id, message: `Graduation year mismatch: form field has "${valYear}", but profile states "${profileGrad}". Review to ensure consistency.` });
          }
        }
      }
      for (const f of essayFields) {
        const m = f.value.match(gradYearRe);
        if (m && m[1] !== profileGrad) {
          issues.push({ severity: 'warn', id: f.id, message: `Possible inconsistency in "${f.label || 'essay'}": mentions graduating in ${m[1]}, but profile graduation year is ${profileGrad}.` });
        }
      }
    }

    // 2. Cross-essay graduation year contradiction
    for (let i = 0; i < essayFields.length; i++) {
      for (let j = i + 1; j < essayFields.length; j++) {
        const m1 = essayFields[i].value.match(gradYearRe);
        const m2 = essayFields[j].value.match(gradYearRe);
        if (m1 && m2 && m1[1] !== m2[1]) {
          issues.push({ severity: 'warn', id: essayFields[j].id, message: `Possible inconsistency across answers: "${essayFields[i].label || 'essay'}" mentions graduation in ${m1[1]}, while "${essayFields[j].label || 'essay'}" mentions ${m2[1]}.` });
        }
      }
    }

    // 3. GPA
    let profileGpa = pFields.gpa ? String(pFields.gpa).match(/\b[0-4](?:\.\d{1,2})?\b/)?.[0] : null;
    if (!profileGpa) {
      for (const fact of pFacts) {
        const m = (fact.text || '').match(gpaRe) || (fact.text || '').match(gpaRe2);
        if (m) { profileGpa = m[1]; break; }
      }
    }
    if (profileGpa) {
      for (const f of allTextFields) {
        if (f.key === 'gpa' && f.value) {
          const valGpa = f.value.match(/\b[0-4](?:\.\d{1,2})?\b/)?.[0];
          if (valGpa && Number(valGpa) !== Number(profileGpa)) {
            issues.push({ severity: 'error', id: f.id, message: `GPA mismatch: form field has "${valGpa}", but profile states "${profileGpa}". Review to ensure accuracy.` });
          }
        }
      }
      for (const f of essayFields) {
        const m = f.value.match(gpaRe) || f.value.match(gpaRe2);
        if (m && Number(m[1]) !== Number(profileGpa)) {
          issues.push({ severity: 'warn', id: f.id, message: `Possible inconsistency in "${f.label || 'essay'}": mentions GPA ${m[1]}, but profile GPA is ${profileGpa}.` });
        }
      }
    }

    // 4. Cross-essay GPA contradiction
    for (let i = 0; i < essayFields.length; i++) {
      for (let j = i + 1; j < essayFields.length; j++) {
        const m1 = essayFields[i].value.match(gpaRe) || essayFields[i].value.match(gpaRe2);
        const m2 = essayFields[j].value.match(gpaRe) || essayFields[j].value.match(gpaRe2);
        if (m1 && m2 && Number(m1[1]) !== Number(m2[1])) {
          issues.push({ severity: 'warn', id: essayFields[j].id, message: `Possible inconsistency across answers: "${essayFields[i].label || 'essay'}" mentions GPA ${m1[1]}, while "${essayFields[j].label || 'essay'}" mentions GPA ${m2[1]}.` });
        }
      }
    }

    // 5. Institution and Major
    if (pFields.institution) {
      const pInstNorm = norm(pFields.institution);
      for (const f of allTextFields) {
        if (f.key === 'institution' && f.value && norm(f.value) !== pInstNorm) {
          issues.push({ severity: 'warn', id: f.id, message: `Institution mismatch: form has "${f.value}", but your profile institution is "${pFields.institution}".` });
        }
      }
    }
    if (pFields.major) {
      const pMajorNorm = norm(pFields.major);
      for (const f of allTextFields) {
        if (f.key === 'major' && f.value && norm(f.value) !== pMajorNorm) {
          issues.push({ severity: 'warn', id: f.id, message: `Major mismatch: form has "${f.value}", but your profile major is "${pFields.major}".` });
        }
      }
    }

    // 6. Chronological date conflict within essay texts (e.g. from 2024 to 2021)
    const dateRangeRe = /\b(?:from|between)?\s*(\b20\d{2}\b)\s*(?:to|-|until|through|and)\s*(\b20\d{2}\b)/gi;
    for (const f of essayFields) {
      let match;
      while ((match = dateRangeRe.exec(f.value)) !== null) {
        const y1 = parseInt(match[1], 10), y2 = parseInt(match[2], 10);
        if (y1 > y2) {
          issues.push({ severity: 'error', id: f.id, message: `Date order conflict in "${f.label || 'essay'}": "${match[0].trim()}" has start year (${y1}) after end year (${y2}).` });
        }
      }
    }
    return issues;
  }
  function readiness(fields, ctx) {
    const reviewed = new Set((ctx && ctx.reviewed) || []), issues = [];
    const add = (severity, id, message) => issues.push({ severity, id, message });
    for (const f of fields) {
      const name = f.label || f.name || f.placeholder || 'Unlabelled field';
      const key = f.key || '';
      if (f.required && isEmpty(f.value)) add('error', f.id, `Required field is empty: ${name}`);
      const limit = f.wordLimit || extractWordLimit(`${f.label} ${f.nearby}`);
      if (typeof f.value === 'string' && limit && countWords(f.value) > limit) add('error', f.id, `${name}: ${countWords(f.value)} words, limit is ${limit}`);
      const bad = validateValue({ ...f, key });
      if (bad) add('error', f.id, `${name} ${bad}`);
      if (key.startsWith('essay.')) {
        const v = typeof f.value === 'string' ? f.value : '';
        if (!v.trim()) { if (!f.required) add('warn', f.id, `Unanswered prompt: ${name}`); }
        else {
          if (hasPlaceholders(v)) add('error', f.id, `${name}: outline placeholders like [Add …] are still in the text`);
          genericFlags(v).forEach((g) => add('info', f.id, `${name}: ${g}`));
          if (!reviewed.has(f.id)) add('info', f.id, `${name}: you have not marked this answer as reviewed`);
        }
      } else if (!key) add('info', f.id, `Not recognised reliably: ${name}`);
    }
    dateConflicts(fields).forEach((c) => add('error', c.endId, 'Date conflict: ' + c.message));
    if (ctx && ctx.profile) checkConsistency(fields, ctx.profile).forEach((c) => add(c.severity, c.id, c.message));
    return issues;
  }

  /* ---------- snapshots ---------- */
  const fieldKey = (f) => norm(f.name || f.idAttr || f.label || f.placeholder || '').replace(/ /g, '_') + ':' + f.type;
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function buildSnapshot(fields, meta) {
    const items = [];
    for (const f of fields) {
      if (isSensitive({ type: f.type, name: f.name, id: f.idAttr, autocomplete: f.autocomplete })) continue;
      if (isEmpty(f.value)) continue;
      items.push({ fieldKey: fieldKey(f), type: f.type, label: String(f.label || f.name || '').slice(0, 120), value: f.value });
    }
    const keys = fields.map(fieldKey).sort();
    return { v: 1, id: 's' + Date.now().toString(36), name: String(meta.name || 'Untitled').slice(0, 80), savedAt: meta.savedAt || new Date().toISOString(), origin: meta.origin || '', step: meta.step || '', signature: hash(keys.join('|')), keys, items };
  }
  function parseSnapshot(json) {
    const s = typeof json === 'string' ? JSON.parse(json) : json;
    if (!s || s.v !== 1 || !Array.isArray(s.items) || !Array.isArray(s.keys)) throw new Error('Not a valid FormDrill snapshot.');
    return s;
  }
  function diffSnapshot(snap, fields) {
    const cur = new Map(fields.map((f) => [fieldKey(f), f]));
    const matched = snap.items.filter((i) => cur.has(i.fieldKey) && cur.get(i.fieldKey).type === i.type);
    const missing = snap.keys.filter((k) => !cur.has(k));
    const added = [...cur.keys()].filter((k) => !snap.keys.includes(k));
    return { matched, missing, added, structureChanged: missing.length > 0 || added.length > 0 };
  }

  /* ---------- drafting help (no AI needed) ---------- */
  const CLUB_IDEAS = [[/design|art|creative|media|photo/, 'Idea to personalise: a one-week campus visual challenge on a theme members vote on, with a small exhibition at the end.'], [/cod|program|tech|software|robot|data|\bai\b/, 'Idea to personalise: a hands-on workshop where members build and ship a small tool that solves a campus annoyance.'], [/entrepreneur|business|startup|finance|market/, 'Idea to personalise: a small experiment with one hypothesis, one week and one measurable result to test a business idea.'], [/debate|speak|writing|literary|model un/, 'Idea to personalise: a low-stakes open-mic or debate night for first-timers, with peer feedback.'], [/volunteer|service|community|environment|sustain/, 'Idea to personalise: a one-day community drive with a clear goal and a follow-up to measure what changed.']];
  function brainstormPrompts(category, question) {
    const q = String(question || '').toLowerCase(), out = [];
    if (category === 'club') {
      out.push({ kind: 'question', text: "Which of your real experiences best shows initiative or curiosity about this club's topic?" });
      for (const [re, idea] of CLUB_IDEAS) if (re.test(q)) out.push({ kind: 'idea', text: idea });
      out.push({ kind: 'question', text: 'What would you want to try, build or organise in your first term? Make it small enough to finish.' });
    } else if (category === 'scholarship') {
      out.push({ kind: 'question', text: 'What are your actual goals, and how does this scholarship change what is possible?' }, { kind: 'question', text: 'What obstacle have you faced, and what did you do about it?' }, { kind: 'question', text: 'Which accomplishments can you support with a date, number or name?' });
    } else if (category === 'internship') {
      out.push({ kind: 'question', text: 'Which project of yours is closest to this role? What did you personally do and what happened?' }, { kind: 'question', text: 'Which requirements in the posting do you have documented evidence for?' });
    } else {
      out.push({ kind: 'question', text: 'What information is this question really asking for?' }, { kind: 'question', text: 'Which saved fact best answers it?' });
    }
    return out;
  }
  const APPROACHES = { creative: 'Open with a vivid, specific moment. Keep your voice.', concise: 'Answer directly in the first sentence, then one example, then stop.', leadership: 'Lead with a time you took initiative: situation, action, result.', technical: 'Describe what you built or learned, the hard part, and what you would do next.', community: 'Focus on the people you worked with and what the group gained.' };
  function scaffold(o) {
    const lines = ['[Opening: answer the question directly in one sentence]'];
    if (o.approach && APPROACHES[o.approach]) lines.push(`(Approach, ${o.approach}: ${APPROACHES[o.approach]})`);
    (o.facts || []).forEach((f) => lines.push(`- ${f.text}${f.status === 'unverified' ? ' (unverified)' : ''}`));
    if (!(o.facts || []).length) lines.push('[Add: pick facts from your profile, or write what you actually did]');
    lines.push('[Add: what changed because of it, with a number or name if you have one]', '[Closing: connect this to what you want next]');
    if (o.wordLimit) lines.push(`(Word budget: about ${o.wordLimit} words; roughly 15% opening, 65% body, 20% closing)`);
    return lines.join('\n');
  }


  return { norm, isEmpty, PROFILE_FIELDS, FACT_SECTIONS, LIST_SECTIONS, EDUCATION_STREAMS, SKILL_CATEGORIES, HOBBY_CATEGORIES, LINK_LABELS, CATEGORIES, emptyProfile, validateProfile, normalizeProfile, isSensitive, classifyField, detectCategory, countWords, extractWordLimit, checkWordLimit, validUrl, validateValue, genericFlags, hasPlaceholders, matchOption, planAutofill, applyPlan, readiness, dateConflicts, checkConsistency, fieldKey, buildSnapshot, parseSnapshot, diffSnapshot, brainstormPrompts, APPROACHES, scaffold };
});
