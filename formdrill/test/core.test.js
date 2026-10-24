const test = require('node:test'), assert = require('node:assert/strict'), C = require('../extension/core.js');
const cls = (o) => C.classifyField({ tag: 'input', type: 'text', ...o });

test('classifies equivalent labels to the same key', () => {
  for (const l of ['Full name', 'Applicant name', 'Legal name']) assert.equal(cls({ label: l }).key, 'fullName');
  for (const l of ['Institution', 'College name', 'University']) assert.equal(cls({ label: l }).key, 'institution');
});
test('essay prompts map to essay keys', () => {
  const e = (label) => C.classifyField({ tag: 'textarea', type: 'textarea', label }).key;
  assert.equal(e('Why are you applying?'), 'essay.motivation');
  assert.equal(e('Statement of purpose'), 'essay.motivation');
  assert.equal(e('Relevant experience'), 'essay.experience');
  assert.equal(e('Previous activities'), 'essay.experience');
});
test('confidence: autocomplete/label high, placeholder-only low, ambiguity flagged', () => {
  assert.equal(cls({ autocomplete: 'email', label: 'Email' }).level, 'high');
  const p = cls({ placeholder: 'your email' }); assert.equal(p.key, 'email'); assert.equal(p.level, 'low');
  const a = cls({ label: 'Name of university and college school' }); assert.ok(a.confidence > 0);
  assert.equal(cls({ label: 'Favourite colour' }).key, '');
});
test('checkbox/radio/select option matching', () => {
  const o = [{ value: 'IN', label: 'India' }, { value: 'CA', label: 'Canada' }];
  assert.equal(C.matchOption(o, 'india').value, 'IN'); assert.equal(C.matchOption(o, 'IN').value, 'IN'); assert.equal(C.matchOption(o, 'Peru'), null);
  const plan = C.planAutofill([{ id: 'a', key: 'country', options: o, classification: { level: 'high', confidence: 0.9 } }, { id: 'b', key: 'country', options: o, classification: { level: 'high', confidence: 0.9 } }], { fields: { country: 'Peru' } });
  assert.equal(plan.items.length, 0); assert.equal(plan.skipped.length, 2);
});
test('textarea and text inputs planned; essays never autofilled', () => {
  const plan = C.planAutofill([{ id: 'a', key: 'email', classification: { level: 'high', confidence: 0.98 } }, { id: 'b', key: 'essay.motivation', classification: { level: 'medium', confidence: 0.6 } }], { fields: { email: 'a@example.com' } });
  assert.deepEqual(plan.items.map((i) => i.id), ['a']);
});
test('consent required before applying values', () => {
  const calls = []; const items = [{ id: 'a', value: 'x' }, { id: 'b', value: 'y' }];
  assert.deepEqual(C.applyPlan(items, [], (i) => calls.push(i)).applied, []); assert.equal(calls.length, 0);
  assert.deepEqual(C.applyPlan(items, undefined, (i) => calls.push(i)).applied, []);
  assert.deepEqual(C.applyPlan(items, ['b'], (i) => { calls.push(i); return true; }).applied, ['b']); assert.deepEqual(calls, ['b']);
});
test('profile validation', () => {
  assert.equal(C.validateProfile({ fields: { email: 'bad' }, facts: [] }).ok, false);
  assert.equal(C.validateProfile({ fields: { website: 'javascript:alert(1)' }, facts: [] }).ok, false);
  assert.equal(C.validateProfile({ fields: { email: 'a@example.com' }, facts: [{ text: 'Built a thing', status: 'verified' }] }).ok, true);
  assert.equal(C.validateProfile({ fields: {}, facts: [{ text: 'x', status: 'maybe' }] }).ok, false);
  assert.deepEqual(C.normalizeProfile('junk'), C.emptyProfile());
});
test('word limits', () => {
  assert.equal(C.extractWordLimit('Why? (max 250 words)'), 250); assert.equal(C.extractWordLimit('Word limit: 120'), 120); assert.equal(C.extractWordLimit('Tell us'), null);
  assert.equal(C.checkWordLimit('one two three', 2).over, true); assert.equal(C.checkWordLimit('one two', 2).over, false);
});
test('format validation and readiness', () => {
  assert.match(C.validateValue({ type: 'email', value: 'nope' }), /email/); assert.equal(C.validateValue({ type: 'date', value: '2024-13-45' }) !== null, true);
  const issues = C.readiness([
    { id: '1', label: 'Name', required: true, value: '', key: 'fullName', type: 'text' },
    { id: '2', label: 'Why? (max 5 words)', key: 'essay.motivation', value: 'one two three four five six', type: 'textarea', wordLimit: 5 },
    { id: '3', label: 'Pitch', key: 'essay.contribution', value: '[Add: something]', type: 'textarea' },
    { id: '4', label: 'Mystery', key: '', value: 'x', type: 'text' }], { reviewed: [] });
  const msgs = issues.map((i) => i.message).join('|');
  assert.match(msgs, /Required field is empty/); assert.match(msgs, /6 words, limit is 5/); assert.match(msgs, /placeholders/); assert.match(msgs, /Not recognised/);
});
test('generic wording flagged', () => assert.ok(C.genericFlags('I am passionate about coding and a team player.').length >= 2));
test('snapshots exclude privacy-sensitive fields', () => {
  const f = (o) => ({ type: 'text', label: o.name, idAttr: '', autocomplete: '', ...o });
  const s = C.buildSnapshot([f({ name: 'full_name', value: 'Test Person' }), f({ name: 'password', type: 'password', value: 'hunter2' }), f({ name: 'csrf_token', value: 'abc' }), f({ name: 'card_number', value: '4111' }), f({ name: 'x', autocomplete: 'cc-number', value: '4111' })], { name: 'n' });
  assert.equal(s.items.length, 1); assert.ok(!JSON.stringify(s).includes('hunter2'));
});
test('snapshot round-trip and changed-form detection', () => {
  const fields = [{ type: 'text', name: 'a', label: 'A', value: 'v' }, { type: 'checkbox', name: 'b', label: 'B', value: true }];
  const s = C.parseSnapshot(JSON.stringify(C.buildSnapshot(fields, { name: 'x' })));
  assert.equal(C.diffSnapshot(s, fields).structureChanged, false); assert.equal(C.diffSnapshot(s, fields).matched.length, 2);
  const d = C.diffSnapshot(s, [fields[0], { type: 'text', name: 'new', label: 'New' }]);
  assert.equal(d.structureChanged, true); assert.equal(d.missing.length, 1); assert.equal(d.added.length, 1);
  assert.throws(() => C.parseSnapshot('{"v":2}'));
});
test('category detection and club prompts', () => {
  assert.equal(C.detectCategory('Brightfield Scholarship financial need').category, 'scholarship');
  assert.equal(C.detectCategory('Join our coding club society').category, 'club');
  assert.equal(C.detectCategory('Contact us').category, 'general');
  assert.ok(C.brainstormPrompts('club', 'join our design society').some((p) => p.kind === 'idea'));
  assert.ok(C.hasPlaceholders(C.scaffold({ facts: [], wordLimit: 100 })));
});
test('start/end date conflicts are detected', () => {
  const f = [{ id: 'a', type: 'date', label: 'Project start date', value: '2024-09-01' }, { id: 'b', type: 'date', label: 'Project end date', value: '2024-03-01' }];
  assert.equal(C.dateConflicts(f).length, 1); assert.match(C.readiness(f, {}).map((i) => i.message).join('|'), /Date conflict/);
  f[1].value = '2025-01-01'; assert.equal(C.dateConflicts(f).length, 0);
});
test('richtext fields classified as essays and never autofilled without review', () => {
  const rt = cls({ type: 'richtext', tag: 'div', label: 'Tell us about a time you took initiative' });
  assert.equal(rt.key, 'essay.experience');
  const plan = C.planAutofill([{ id: 'r1', key: 'essay.experience', type: 'richtext' }], { fields: { 'essay.experience': 'sample' } });
  assert.equal(plan.items.length, 0);
});
test('consistency checks: flags mismatches across profile facts and essay text', () => {
  const profile = {
    fields: { gradYear: '2027', gpa: '3.9', institution: 'State University', major: 'Computer Science' },
    facts: [{ id: 'f1', text: 'Graduating in 2027 with a 3.9 GPA', status: 'verified' }]
  };
  const fields = [
    { id: '1', key: 'gradYear', label: 'Graduation Year', value: '2025', type: 'text' },
    { id: '2', key: 'gpa', label: 'Cumulative GPA', value: '3.2', type: 'text' },
    { id: '3', key: 'institution', label: 'College', value: 'Other College', type: 'text' },
    { id: '4', key: 'major', label: 'Major', value: 'History', type: 'text' },
    { id: '5', key: 'essay.motivation', label: 'Why apply?', value: 'I look forward to graduating in 2024 and maintaining my 3.5 GPA.', type: 'textarea' },
    { id: '6', key: 'essay.goals', label: 'Future goals', value: 'After graduating in 2028, I will continue research.', type: 'textarea' },
    { id: '7', key: 'essay.experience', label: 'Experience', value: 'I worked at Acme from 2024 to 2021.', type: 'textarea' }
  ];
  const issues = C.checkConsistency(fields, profile);
  const msgs = issues.map((i) => i.message).join(' | ');

  // Field vs profile mismatches
  assert.match(msgs, /Graduation year mismatch: form field has "2025", but profile states "2027"/);
  assert.match(msgs, /GPA mismatch: form field has "3.2", but profile states "3.9"/);
  assert.match(msgs, /Institution mismatch: form has "Other College", but your profile institution is "State University"/);
  assert.match(msgs, /Major mismatch: form has "History", but your profile major is "Computer Science"/);

  // Essay vs profile mismatches
  assert.match(msgs, /mentions graduating in 2024, but profile graduation year is 2027/);
  assert.match(msgs, /mentions GPA 3.5, but profile GPA is 3.9/);

  // Cross-essay contradictions
  assert.match(msgs, /Possible inconsistency across answers.*graduation in 2024.*2028/);

  // Chronological date order conflict in essay text
  assert.match(msgs, /Date order conflict.*start year \(2024\) after end year \(2021\)/);

  // Integrated into readiness
  const readyIssues = C.readiness(fields, { profile });
  assert.ok(readyIssues.some((i) => i.message.includes('Graduation year mismatch')));
});

