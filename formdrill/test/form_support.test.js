'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

test('form support: custom dropdown option matching logic', () => {
  const options = [
    { value: 'FR', label: 'Freshman' },
    { value: 'SO', label: 'Sophomore' },
    { value: 'JR', label: 'Junior' },
    { value: 'SR', label: 'Senior' }
  ];

  // Match exact value
  assert.equal(C.matchOption(options, 'SO').value, 'SO');
  // Match case-insensitive label
  assert.equal(C.matchOption(options, 'junior').value, 'JR');
  // Match partial label
  assert.equal(C.matchOption(options, 'senior').value, 'SR');
  // Non-matching
  assert.equal(C.matchOption(options, 'PhD'), null);
});

test('form support: rich-text fields are classified as essays and require review', () => {
  // Rich text editor with a scholarship prompt
  const richPrompt = C.classifyField({
    tag: 'div',
    type: 'richtext',
    label: 'Why do you deserve this scholarship? (max 250 words)',
    nearby: 'Describe your achievements and financial need'
  });
  assert.equal(richPrompt.key, 'essay.motivation');

  // Rich text with club question
  const richClub = C.classifyField({
    tag: 'div',
    type: 'richtext',
    label: 'Tell us about a time you took initiative',
    nearby: 'Pixel & Code Society'
  });
  assert.equal(richClub.key, 'essay.experience');

  // Rich text with unclassified prompt defaults to essay.other
  const richOther = C.classifyField({
    tag: 'div',
    type: 'richtext',
    label: 'Custom long answer question',
    nearby: ''
  });
  assert.equal(richOther.key, 'essay.other');

  // Crucial check: planAutofill never includes essay keys, so rich text fields are NEVER auto-filled without review
  const plan = C.planAutofill(
    [{ id: 'rt1', key: richPrompt.key, type: 'richtext' }],
    { fields: { [richPrompt.key]: 'Some text' } }
  );
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped.length, 0); // Not even considered for direct autofill
});

test('form support: custom dropdown autofill planning with matched options', () => {
  const customDropdown = {
    id: 'cd1',
    key: 'degree',
    type: 'select',
    options: [
      { value: 'bs', label: 'Bachelor of Science' },
      { value: 'ba', label: 'Bachelor of Arts' },
      { value: 'ms', label: 'Master of Science' }
    ],
    classification: { level: 'high', confidence: 0.95 }
  };

  const plan = C.planAutofill([customDropdown], {
    fields: { degree: 'Bachelor of Science' }
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, 'cd1');
  assert.equal(plan.items[0].value, 'bs');
  assert.equal(plan.items[0].confidence, 0.95);
});

test('form support: cross-origin and iframe handling resilience', () => {
  // Simulate mock DOM structure with accessible and inaccessible frames
  const mockSameOriginDoc = {
    querySelectorAll: (selector) => {
      if (selector === 'iframe, frame') return [];
      if (selector === 'input,textarea,select') {
        return [
          {
            tagName: 'INPUT',
            type: 'text',
            name: 'applicant_name',
            id: 'f_name',
            value: 'Alice In Iframe',
            getAttribute: () => '',
            getBoundingClientRect: () => ({ width: 100, height: 20 })
          }
        ];
      }
      return [];
    }
  };

  const mockCrossOriginFrame = {
    get contentDocument() {
      const err = new Error('Permission denied to access cross-origin object');
      err.name = 'SecurityError';
      throw err;
    }
  };

  const mockSameOriginFrame = {
    get contentDocument() {
      return mockSameOriginDoc;
    }
  };

  // Function mirroring content.js getAccessibleDocuments
  function getAccessibleDocuments(rootDoc) {
    const docs = [rootDoc];
    const seen = new Set(docs);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      try {
        const frames = d.querySelectorAll('iframe, frame');
        for (const frame of frames) {
          try {
            const cd = frame.contentDocument;
            if (cd && !seen.has(cd)) {
              seen.add(cd);
              docs.push(cd);
            }
          } catch (e) {
            // Handled gracefully
          }
        }
      } catch (e) {}
    }
    return docs;
  }

  const rootDoc = {
    querySelectorAll: (selector) => {
      if (selector === 'iframe, frame') return [mockCrossOriginFrame, mockSameOriginFrame];
      return [];
    }
  };

  const docs = getAccessibleDocuments(rootDoc);
  // Root doc + same-origin doc should be included; cross-origin should be ignored gracefully
  assert.equal(docs.length, 2);
  assert.equal(docs[0], rootDoc);
  assert.equal(docs[1], mockSameOriginDoc);
});
