'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

/* ---- emptyProfile shape ---- */
test('emptyProfile has lists for all sections', () => {
  const p = C.emptyProfile();
  assert.equal(p.v, 1);
  assert.deepEqual(p.fields, {});
  assert.deepEqual(p.facts, []);
  for (const k of C.LIST_SECTIONS) {
    assert.ok(Array.isArray(p.lists[k]), `lists.${k} should be an array`);
    assert.equal(p.lists[k].length, 0);
  }
});

/* ---- backward-compatible normalisation ---- */
test('normalizeProfile migrates old profile without lists', () => {
  const old = { v: 1, fields: { fullName: 'Alice', email: 'a@example.com' }, facts: [] };
  const norm = C.normalizeProfile(old);
  assert.equal(norm.fields.fullName, 'Alice');
  for (const k of C.LIST_SECTIONS) {
    assert.ok(Array.isArray(norm.lists[k]), `lists.${k} should default to []`);
  }
});

test('normalizeProfile preserves existing lists', () => {
  const p = C.emptyProfile();
  p.lists.languages = [{ id: 'l1', name: 'English' }, { id: 'l2', name: 'Hindi' }];
  p.lists.skills = [{ id: 's1', name: 'Python', category: 'Technical Skills' }];
  const norm = C.normalizeProfile(p);
  assert.equal(norm.lists.languages.length, 2);
  assert.equal(norm.lists.languages[0].name, 'English');
  assert.equal(norm.lists.skills.length, 1);
});

test('normalizeProfile clamps languages to 7', () => {
  const p = C.emptyProfile();
  p.lists.languages = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `Lang${i}` }));
  const norm = C.normalizeProfile(p);
  assert.equal(norm.lists.languages.length, 7);
});

/* ---- language limits in validateProfile ---- */
test('validateProfile rejects more than 7 languages', () => {
  const p = C.emptyProfile();
  p.lists.languages = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, name: `Lang${i}` }));
  const v = C.validateProfile(p);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /7 languages/.test(e)));
});

test('validateProfile rejects language entry with no name', () => {
  const p = C.emptyProfile();
  p.lists.languages = [{ id: 'l1', name: '' }];
  const v = C.validateProfile(p);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Language 1 has no name/.test(e)));
});

test('validateProfile accepts 1 to 7 valid languages', () => {
  const p = C.emptyProfile();
  p.lists.languages = [{ id: 'l1', name: 'English' }, { id: 'l2', name: 'Tamil' }];
  const v = C.validateProfile(p);
  assert.equal(v.ok, true, v.errors.join(', '));
});

test('validateProfile accepts empty lists', () => {
  const p = C.emptyProfile();
  const v = C.validateProfile(p);
  assert.equal(v.ok, true, v.errors.join(', '));
});

/* ---- new autofill classification rules ---- */
const cls = (o) => C.classifyField({ tag: 'input', type: 'text', ...o });

test('new fields classified: dob, nationality, addresses', () => {
  assert.equal(cls({ label: 'Date of birth', type: 'date' }).key, 'dob');
  assert.equal(cls({ autocomplete: 'bday', label: 'DOB' }).key, 'dob');
  assert.equal(cls({ label: 'Nationality' }).key, 'nationality');
  assert.equal(cls({ label: 'Current address' }).key, 'currentAddress');
  assert.equal(cls({ label: 'Permanent address' }).key, 'permanentAddress');
  assert.equal(cls({ label: 'Home address' }).key, 'currentAddress');
  assert.equal(cls({ label: 'Residential address' }).key, 'currentAddress');
});

test('new fields classified: occupation, organization, designation', () => {
  assert.equal(cls({ label: 'Occupation' }).key, 'occupation');
  assert.equal(cls({ label: 'Employment status' }).key, 'occupation');
  assert.equal(cls({ label: 'Company name' }).key, 'organization');
  assert.equal(cls({ label: 'Designation' }).key, 'designation');
  assert.equal(cls({ label: 'Job title' }).key, 'designation');
});

test('nationality distinct from country', () => {
  const nat = cls({ label: 'Nationality' });
  const ctr = cls({ label: 'Country of residence' });
  assert.equal(nat.key, 'nationality');
  assert.equal(ctr.key, 'country');
  assert.notEqual(nat.key, ctr.key);
});

test('current vs permanent address not confused', () => {
  const cur = cls({ label: 'Current address' });
  const perm = cls({ label: 'Permanent address' });
  assert.equal(cur.key, 'currentAddress');
  assert.equal(perm.key, 'permanentAddress');
});

test('gradYear also matches passing year', () => {
  assert.equal(cls({ label: 'Passing year' }).key, 'gradYear');
  assert.equal(cls({ label: 'Year of passing' }).key, 'gradYear');
});

test('gpa also matches percentage result', () => {
  assert.equal(cls({ label: 'Percentage' }).key, 'gpa');
  assert.equal(cls({ label: 'Result' }).key, 'gpa');
});

/* ---- autofill planning with new fields ---- */
test('planAutofill works with new profile fields', () => {
  const profile = C.normalizeProfile({
    v: 1, fields: {
      dob: '2000-05-15', nationality: 'Indian',
      currentAddress: '12 Main St', occupation: 'Student'
    }, facts: []
  });
  const fields = [
    { id: 'f1', key: 'dob', classification: { level: 'high', confidence: 0.95 } },
    { id: 'f2', key: 'nationality', classification: { level: 'high', confidence: 0.9 } },
    { id: 'f3', key: 'currentAddress', classification: { level: 'medium', confidence: 0.7 } },
    { id: 'f4', key: 'occupation', classification: { level: 'high', confidence: 0.85 } }
  ];
  const plan = C.planAutofill(fields, profile);
  assert.equal(plan.items.length, 4);
  assert.ok(plan.items.every((it) => it.value));
});

/* ---- import / export round-trip ---- */
test('profile with all new lists round-trips through JSON', () => {
  const p = C.emptyProfile();
  p.fields = { fullName: 'Anushka', email: 'a@example.com' };
  p.lists.languages = [{ id: 'l1', name: 'English' }];
  p.lists.certificates = [{ id: 'c1', name: 'AWS Cloud', org: 'Amazon' }];
  p.lists.skills = [{ id: 's1', name: 'Python', category: 'Technical Skills' }];
  p.lists.hobbies = [{ id: 'h1', name: 'Photography', category: 'Art and Creativity', achievements: '' }];
  p.lists.exams = [{ id: 'e1', name: 'GATE 2024', year: '2024' }];
  p.lists.work = [{ id: 'w1', company: 'Acme', title: 'Intern', startDate: '2024-06', endDate: '', role: 'Backend dev' }];
  p.lists.links = [{ id: 'lk1', label: 'GitHub', url: 'https://github.com/anushka' }];
  p.lists.customFields = [{ id: 'cf1', name: 'Preferred IDE', value: 'VS Code' }];

  const exported = JSON.stringify(p);
  const imported = C.normalizeProfile(JSON.parse(exported));
  assert.equal(imported.fields.fullName, 'Anushka');
  assert.equal(imported.lists.languages[0].name, 'English');
  assert.equal(imported.lists.certificates[0].name, 'AWS Cloud');
  assert.equal(imported.lists.skills[0].category, 'Technical Skills');
  assert.equal(imported.lists.hobbies[0].name, 'Photography');
  assert.equal(imported.lists.exams[0].name, 'GATE 2024');
  assert.equal(imported.lists.work[0].company, 'Acme');
  assert.equal(imported.lists.links[0].url, 'https://github.com/anushka');
  assert.equal(imported.lists.customFields[0].name, 'Preferred IDE');
});

/* ---- delete-all-data compatibility ---- */
test('emptyProfile resets all list sections to empty arrays', () => {
  const fresh = C.emptyProfile();
  for (const k of C.LIST_SECTIONS) {
    assert.deepEqual(fresh.lists[k], [], `${k} should be empty after reset`);
  }
});
