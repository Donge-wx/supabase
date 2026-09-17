'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { transformSource, applyPack, restorePack, eligible, cleanJSXText,
  DICTIONARY, CONFIG, parse, validateDictionary } = require('../scripts/localize.cjs')
const fixture = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8')
const navPath = 'apps/studio/components/layouts/Navigation/NavigationBar/NavigationBar.utils.tsx'
const dbPath = 'apps/studio/components/layouts/DatabaseLayout/DatabaseMenu.utils.tsx'
const uiPath = 'apps/studio/components/interfaces/Test.tsx'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-zh-test-'))
function makeSource(root) {
  for (const [from, to] of [['_document.tsx', CONFIG.htmlDocument],
    ['NavigationBar.utils.tsx', navPath], ['DatabaseMenu.utils.tsx', dbPath]]) {
    const file = path.join(root, to)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fixture(from))
  }
}
test('436 reviewed translation entries; Simplified Chinese is the default', () => {
  assert.equal(CONFIG.defaultLocale, 'zh-CN')
  assert.equal(Object.keys(DICTIONARY).length, 436)
  validateDictionary(DICTIONARY)
})
for (const [name, expected] of Object.entries(require('./fixtures/manifest.json'))) {
  test('upstream Git blob integrity: ' + name, () => {
    const bytes = Buffer.from(fixture(name))
    const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    assert.equal(sha, expected)
  })
}
test('real upstream document uses zh-CN in server-rendered HTML', () => {
  const out = transformSource(fixture('_document.tsx'), CONFIG.htmlDocument)
  assert.match(out.source, /<Html lang="zh-CN">/)
  assert.doesNotMatch(out.source, /lang="en"/)
})
test('real upstream primary navigation translated without route/key changes', () => {
  const original = fixture('NavigationBar.utils.tsx')
  const out = transformSource(original, navPath)
  assert.equal(out.hits.length, 13)
  assert.match(out.source, /label: "表格编辑器"/)
  assert.match(out.source, /label: "SQL 编辑器"/)
  assert.match(out.source, /label: "身份认证"/)
  assert.deepEqual(out.source.match(/key: '[^']+'/g), original.match(/key: '[^']+'/g))
  assert.deepEqual(out.source.match(/`[^`]+`/g), original.match(/`[^`]+`/g))
})
test('real upstream database menu name/title properties localized', () => {
  const original = fixture('DatabaseMenu.utils.tsx')
  const out = transformSource(original, dbPath)
  assert.match(out.source, /title: "访问控制"/)
  assert.match(out.source, /name: "列权限"/)
  assert.match(out.source, /name: "数据表"/)
  assert.deepEqual(out.source.match(/key: '[^']+'/g), original.match(/key: '[^']+'/g))
  assert.deepEqual(out.source.match(/getDatabaseURL\('[^']+'\)/g), original.match(/getDatabaseURL\('[^']+'\)/g))
})
test('database record object, SQL, identifiers and string comparisons stay intact', () => {
  const original = `const row = { name: 'Name', title: 'Settings', label: 'Save', value: 'Delete' };
const sql = "SELECT 'Save' AS value";
const isDelete = row.value === 'Delete';
const View = () => <button>Save</button>;`
  const out = transformSource(original, uiPath)
  assert.match(out.source, /name: 'Name', title: 'Settings', label: 'Save', value: 'Delete'/)
  assert.match(out.source, /"SELECT 'Save' AS value"/)
  assert.match(out.source, /row.value === 'Delete'/)
  assert.match(out.source, /<button>\{"保存"\}<\/button>/)
})
test('translate display attributes but never ids, form values, keys or URLs', () => {
  const original = `<input id="Name" name="Name" value="Name" placeholder="Name" title="Description" aria-label="Name" data-key="Save" />`
  const out = transformSource(original, uiPath).source
  assert.match(out, /placeholder=\{"名称"\}/)
  assert.match(out, /title=\{"说明"\}/)
  assert.match(out, /id="Name" name="Name" value="Name"/)
  assert.match(out, /data-key="Save"/)
})
test('code, pre, editable content and explicit no-localize regions untouched', () => {
  const original = `<><pre>Save</pre><code>Delete</code><textarea>Save</textarea><div contentEditable>Save</div><span data-no-localize>Save</span></>`
  assert.equal(transformSource(original, uiPath).source, original)
})
test('API response expressions and dynamic data are never runtime-translated', () => {
  const original = `<><span>{record.name}</span><span>{error.message}</span><span>{'Save'}</span></>`
  const out = transformSource(original, uiPath).source
  assert.match(out, /\{record.name\}/)
  assert.match(out, /\{error.message\}/)
  assert.match(out, /\{"保存"\}/)
})
test('ternary display values translate; conditional business expression stays original', () => {
  const out = transformSource(`<button>{mode === 'Save' ? 'Save' : 'Cancel'}</button>`, uiPath).source
  assert.match(out, /mode === 'Save' \? "保存" : "取消"/)
})
test('fallback on unknown English; records an untranslated candidate', () => {
  const original = `<span>Not yet translated phrase</span>`
  const out = transformSource(original, uiPath)
  assert.equal(out.source, original)
  assert.equal(out.missing[0].source, 'Not yet translated phrase')
})
test('JSON-safe replacements preserve quotation marks and JSX syntax', () => {
  const out = transformSource(`<button title="Save">Save</button>`, uiPath, { Save: '保存“引号”与 "双引号"' })
  parse(uiPath, out.source)
  assert.equal(out.hits.length, 2)
})
test('sonner static toast messages translate; external error messages do not', () => {
  const original = `import { toast } from 'sonner'; toast.success('Saved'); toast.error(error.message);`
  const out = transformSource(original, uiPath, { Saved: '已保存' }).source
  assert.match(out, /toast.success\("已保存"\)/)
  assert.match(out, /toast.error\(error.message\)/)
})
test('a function merely named toast is not rewritten without a sonner import', () => {
  const original = `other.toast('Save'); toast.error('Save');`
  assert.equal(transformSource(original, uiPath).source, original)
})
test('whitespace around inline text remains stable', () => {
  assert.equal(cleanJSXText('\n    Save\n  '), 'Save')
  const out = transformSource(`<span>Save <b>{name}</b></span>`, uiPath).source
  assert.match(out, /\{"保存 "\}/)
})
test('direct source transformation is idempotent', () => {
  const first = transformSource(fixture('NavigationBar.utils.tsx'), navPath).source
  assert.equal(transformSource(first, navPath).source, first)
})
test('English build keeps original text', () => {
  const src = fixture('NavigationBar.utils.tsx')
  assert.equal(transformSource(src, navPath, DICTIONARY, 'en').source, src)
})
test('unsupported locales and invalid dictionary entries fail explicitly', () => {
  assert.throws(() => transformSource('<div />', uiPath, DICTIONARY, 'zh-TW'), /Unsupported/)
  assert.throws(() => validateDictionary({ Save: '' }), /Invalid/)
})
test('API routes, tests, data modules and declarations are excluded', () => {
  for (const p of ['apps/studio/pages/api/users.ts', 'apps/studio/data/customers.ts',
    'apps/studio/components/Foo.test.tsx', 'apps/studio/components/__mocks__/Fake.ts',
    'apps/studio/components/Types.d.ts']) assert.equal(eligible(p), false, p)
  assert.equal(eligible(navPath), true)
})
test('apply, repeat apply and restore on exact upstream files', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true }))
  makeSource(root)
  const report = applyPack(root)
  assert.equal(report.changedSourceFiles, 3)
  assert.equal(applyPack(root).alreadyApplied, true)
  assert.equal(restorePack(root).restoredSourceFiles, 3)
  assert.equal(fs.readFileSync(path.join(root, navPath), 'utf8'), fixture('NavigationBar.utils.tsx'))
})
test('dry run never modifies source or creates localization metadata', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true }))
  makeSource(root)
  applyPack(root, { dryRun: true })
  assert.equal(fs.existsSync(path.join(root, '.studio-localization')), false)
  assert.equal(fs.readFileSync(path.join(root, navPath), 'utf8'), fixture('NavigationBar.utils.tsx'))
})
test('restore refuses to overwrite manual source edits', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true }))
  makeSource(root); applyPack(root)
  fs.appendFileSync(path.join(root, navPath), '\n// manual edit\n')
  assert.throws(() => restorePack(root), /Refusing to overwrite/)
})
test('interrupted apply cannot overwrite its original backups', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true }))
  makeSource(root)
  fs.mkdirSync(path.join(root, '.studio-localization'))
  fs.writeFileSync(path.join(root, '.studio-localization/pending.json'), '[]')
  assert.throws(() => applyPack(root), /Interrupted/)
})
