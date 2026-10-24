const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../extension'), m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
test('manifest is MV3, least-privilege, no broad host access', () => {
  assert.equal(m.manifest_version, 3); assert.equal(m.host_permissions, undefined); assert.equal(m.content_scripts, undefined);
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage']);
  assert.ok(!/unsafe-eval|unsafe-inline/.test(m.content_security_policy.extension_pages));
});
test('every referenced file exists', () => {
  const refs = [m.action.default_popup, m.side_panel.default_path, m.options_ui.page.split('#')[0], m.background.service_worker, ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  for (const r of refs) assert.ok(fs.existsSync(path.join(dir, r)), r + ' missing');
});
test('no eval / innerHTML / secrets in shipped code', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') || x.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\beval\(|new Function\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s), f + ' uses unsafe API');
    assert.ok(!/sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['"][^'"]+/i.test(s), f + ' may contain a secret');
    assert.ok(!/\.submit\(|requestSubmit/.test(s), f + ' submits forms');
  }
});
test('extension pages have unique titles', () => {
  const t = ['popup.html', 'app.html'].map((f) => /<title>(.*?)<\/title>/.exec(fs.readFileSync(path.join(dir, f), 'utf8'))[1]);
  assert.equal(new Set(t).size, t.length);
});
