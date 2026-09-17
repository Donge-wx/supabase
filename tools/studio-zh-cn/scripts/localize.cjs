#!/usr/bin/env node
'use strict'
/**
 * Build-time localization. Only reviewed UI syntax is translated.
 * Never translate arbitrary string literals, API values, identifiers or runtime DOM text.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/config.json'), 'utf8'))
const DICTIONARY = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/zh-CN.json'), 'utf8'))
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
const posix = (p) => p.split(path.sep).join('/')
const PROTECTED_TAGS = /^(pre|code|textarea|script|style|Code|CodeBlock|CodeEditor|MonacoEditor|Editor|JsonEditor)$/

function validateDictionary(dictionary) {
  for (const [key, value] of Object.entries(dictionary)) {
    if (!key || key.trim() !== key || typeof value !== 'string' || !value.trim()) {
      throw new Error(`Invalid dictionary entry: ${JSON.stringify(key)}`)
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(key + value)) {
      throw new Error(`Control character in dictionary: ${key}`)
    }
  }
}
validateDictionary(DICTIONARY)

function parse(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (sf.parseDiagnostics.length) {
    throw new Error(`Syntax error in ${file}: ` + sf.parseDiagnostics.map(d =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '))
  }
  return sf
}

// Match React's whitespace handling for multi-line JSX text.
function cleanJSXText(raw) {
  const lines = raw.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) lastNonEmpty = i })
  let out = ''
  lines.forEach((line, i) => {
    let part = line.replace(/\t/g, ' ')
    if (i !== 0) part = part.replace(/^ +/, '')
    if (i !== lines.length - 1) part = part.replace(/ +$/, '')
    if (part) out += part + (i !== lastNonEmpty ? ' ' : '')
  })
  return out
}

function isProtected(node, sf) {
  for (let p = node.parent; p; p = p.parent) {
    const tag = ts.isJsxElement(p) ? p.openingElement : ts.isJsxSelfClosingElement(p) ? p : null
    if (tag && PROTECTED_TAGS.test(tag.tagName.getText(sf))) return true
    if (tag && tag.attributes.properties.some(a =>
      ts.isJsxAttribute(a) && ['contentEditable', 'data-no-localize'].includes(a.name.getText(sf)))) {
      return true
    }
  }
  return false
}

function transformSource(source, file, dictionary = DICTIONARY, locale = CONFIG.defaultLocale) {
  if (!CONFIG.supportedLocales.includes(locale)) throw new Error('Unsupported locale: ' + locale)
  const sf = parse(file, source)
  const edits = new Map()
  const hits = []
  const missing = []
  let langEdits = 0
  const normalizedFile = posix(file)
  const objectFields = new Set(CONFIG.objectPropertiesByFile[normalizedFile] || [])
  const attrs = new Set(CONFIG.jsxAttributes)
  const toastNames = new Set()
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && s.moduleSpecifier.text === 'sonner') {
      const bindings = s.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const i of bindings.elements) {
          if ((i.propertyName?.text || i.name.text) === 'toast') toastNames.add(i.name.text)
        }
      }
    }
  }
  function setEdit(start, end, replacement) {
    const key = `${start}:${end}`
    const old = edits.get(key)
    if (old && old.replacement !== replacement) throw new Error('Conflicting localization edits')
    edits.set(key, { start, end, replacement })
  }
  function translate(node, text, jsxText = false, attribute = false) {
    if (isProtected(node, sf)) return
    const cleaned = jsxText ? cleanJSXText(text) : text
    const key = cleaned.trim()
    if (!key || !/[A-Za-z]/.test(key)) return
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    if (!Object.hasOwn(dictionary, key)) {
      missing.push({ file: normalizedFile, line, source: key })
      return
    }
    if (locale === 'en') return
    const leading = cleaned.match(/^\s*/)[0]
    const trailing = cleaned.match(/\s*$/)[0]
    const value = leading + dictionary[key] + trailing
    const quoted = JSON.stringify(value)
    setEdit(jsxText ? node.pos : node.getStart(sf), node.end,
      jsxText || attribute ? `{${quoted}}` : quoted)
    hits.push({ file: normalizedFile, line, source: key, translated: dictionary[key] })
  }
  function displayExpression(expr) {
    if (!expr) return
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      translate(expr, expr.text)
    } else if (ts.isConditionalExpression(expr)) {
      // Never touch the condition; only the two displayed results.
      displayExpression(expr.whenTrue)
      displayExpression(expr.whenFalse)
    } else if (ts.isParenthesizedExpression(expr)) {
      displayExpression(expr.expression)
    } else if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) {
      displayExpression(expr.right)
    }
  }
  function visit(node) {
    if (ts.isJsxText(node)) translate(node, node.text, true)
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      const tag = node.parent.parent.tagName?.getText(sf)
      if (normalizedFile === CONFIG.htmlDocument && name === 'lang' && tag === 'Html') {
        if (!node.initializer || !ts.isStringLiteral(node.initializer)) {
          throw new Error('Upstream Html lang is no longer a static string; review the patch')
        }
        langEdits++
        if (node.initializer.text !== locale) {
          setEdit(node.initializer.getStart(sf), node.initializer.end, JSON.stringify(locale))
        }
      } else if (attrs.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) translate(node.initializer, node.initializer.text, false, true)
        else if (ts.isJsxExpression(node.initializer)) displayExpression(node.initializer.expression)
      }
    }
    if (ts.isJsxExpression(node) && node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      displayExpression(node.expression)
    }
    if (objectFields.size && ts.isPropertyAssignment(node) &&
      objectFields.has(node.name.getText(sf).replace(/^['"]|['"]$/g, ''))) {
      displayExpression(node.initializer)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && toastNames.has(node.expression.expression.text) &&
      ['success', 'error', 'warning', 'info', 'message'].includes(node.expression.name.text)) {
      displayExpression(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (normalizedFile === CONFIG.htmlDocument && langEdits !== 1) {
    throw new Error(`Expected one <Html lang> in ${file}, found ${langEdits}`)
  }
  const sorted = [...edits.values()].sort((a, b) => b.start - a.start)
  let boundary = source.length
  let output = source
  for (const e of sorted) {
    if (e.end > boundary) throw new Error('Overlapping localization edits in ' + file)
    output = output.slice(0, e.start) + e.replacement + output.slice(e.end)
    boundary = e.start
  }
  parse(file, output)
  return { source: output, hits, missing, changed: output !== source }
}

function eligible(file) {
  const p = posix(file)
  return /\.(ts|tsx)$/.test(p) &&
    !/(^|\/)(api|__tests__|__mocks__|fixtures|node_modules|\.git|\.next)(\/|$)/.test(p) &&
    !/\.(test|spec|stories|d)\.tsx?$/.test(p) &&
    (CONFIG.sourceRoots.some(root => p.startsWith(root + '/')))
}
function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) return []
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : []
  })
}
function safeTarget(root, rel) {
  const p = path.resolve(root, rel)
  if (!p.startsWith(root + path.sep)) throw new Error('Invalid source path')
  return p
}
function applyPack(root, { locale = CONFIG.defaultLocale, dryRun = false } = {}) {
  root = path.resolve(root)
  if (!fs.existsSync(path.join(root, CONFIG.htmlDocument))) throw new Error('Not a Supabase source checkout')
  const dir = path.join(root, '.studio-localization')
  const marker = path.join(dir, 'state.json')
  if (fs.existsSync(path.join(dir, 'pending.json'))) {
    throw new Error('Interrupted localization detected. Run restore before applying again.')
  }
  const dictHash = sha256(JSON.stringify(DICTIONARY))
  if (fs.existsSync(marker)) {
    const state = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (state.locale !== locale || state.dictionaryHash !== dictHash) {
      throw new Error('Language/pack changed. Run restore before applying the new pack.')
    }
    for (const file of state.files) {
      if (sha256(fs.readFileSync(safeTarget(root, file.path))) !== file.patchedHash) {
        throw new Error('Patched source was changed manually: ' + file.path)
      }
    }
    return { ...state.report, alreadyApplied: true }
  }
  const files = [...new Set(CONFIG.sourceRoots.flatMap(r => walk(path.join(root, r))))]
    .filter(p => eligible(path.relative(root, p))).sort()
  const plans = []
  const hits = []
  const missing = []
  for (const file of files) {
    const rel = posix(path.relative(root, file))
    const original = fs.readFileSync(file, 'utf8')
    const result = transformSource(original, rel, DICTIONARY, locale)
    hits.push(...result.hits)
    missing.push(...result.missing)
    if (result.changed) plans.push({ path: rel, original, patched: result.source })
  }
  const used = new Set(hits.map(h => h.source))
  const report = {
    locale, scannedSourceFiles: files.length, changedSourceFiles: plans.length,
    dictionaryEntries: Object.keys(DICTIONARY).length, matchedOccurrences: hits.length,
    matchedUniqueEntries: used.size, unmatchedUiOccurrences: missing.length,
    // This denominator is ONLY reviewed syntax candidates, not the whole product.
    coverageDenominator: 'supported static UI syntax only; not all Studio messages',
    unusedDictionaryEntries: Object.keys(DICTIONARY).filter(k => !used.has(k)),
    hits, missing,
  }
  if (!dryRun) {
    if (!plans.length && locale !== 'en') throw new Error('No changes found; verify the upstream version and locale')
    fs.mkdirSync(dir, { recursive: true })
    const stateFiles = plans.map(p => ({ path: p.path,
      originalHash: sha256(p.original), patchedHash: sha256(p.patched) }))
    // Save all originals before changing source; on an interrupted apply these are recoverable.
    for (const p of plans) {
      const backup = safeTarget(path.join(dir, 'originals'), p.path)
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.writeFileSync(backup, p.original)
    }
    fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify(stateFiles, null, 2) + '\n')
    for (const p of plans) fs.writeFileSync(safeTarget(root, p.path), p.patched)
    fs.writeFileSync(marker, JSON.stringify({ locale, dictionaryHash: dictHash,
      files: stateFiles, report }, null, 2) + '\n')
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    fs.unlinkSync(path.join(dir, 'pending.json'))
  }
  return report
}
function restorePack(root) {
  root = path.resolve(root)
  const dir = path.join(root, '.studio-localization')
  const marker = path.join(dir, 'state.json')
  const pending = path.join(dir, 'pending.json')
  const interrupted = !fs.existsSync(marker)
  if (interrupted && !fs.existsSync(pending)) throw new Error('No localization backup found')
  const files = interrupted ? JSON.parse(fs.readFileSync(pending, 'utf8')) :
    JSON.parse(fs.readFileSync(marker, 'utf8')).files
  for (const file of files) {
    const currentHash = sha256(fs.readFileSync(safeTarget(root, file.path)))
    if (![file.originalHash, file.patchedHash].includes(currentHash)) {
      throw new Error('Refusing to overwrite manual source changes: ' + file.path)
    }
    const original = fs.readFileSync(safeTarget(path.join(dir, 'originals'), file.path))
    if (sha256(original) !== file.originalHash) throw new Error('Corrupted source backup')
  }
  for (const file of files) fs.copyFileSync(safeTarget(path.join(dir, 'originals'), file.path),
    safeTarget(root, file.path))
  // Delete only the pack-owned bookkeeping files, never .git or runtime data.
  fs.rmSync(dir, { recursive: true })
  return { restoredSourceFiles: files.length }
}
if (require.main === module) {
  try {
    const [action = 'help', sourceRoot, ...flags] = process.argv.slice(2)
    if (!['apply', 'check', 'restore'].includes(action) || !sourceRoot) {
      console.log('Usage: node scripts/localize.cjs <apply|check|restore> SOURCE_DIR [--locale zh-CN|en]')
      process.exit(action === 'help' ? 0 : 1)
    }
    const localeIndex = flags.indexOf('--locale')
    const locale = localeIndex >= 0 ? flags[localeIndex + 1] : CONFIG.defaultLocale
    if (!CONFIG.supportedLocales.includes(locale)) throw new Error('Unsupported locale: ' + locale)
    const result = action === 'restore' ? restorePack(sourceRoot) :
      applyPack(sourceRoot, { locale, dryRun: action === 'check' })
    const { hits, missing, unusedDictionaryEntries, ...summary } = result
    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    console.error('汉化失败：' + error.message)
    process.exitCode = 1
  }
}
module.exports = { transformSource, applyPack, restorePack, eligible, cleanJSXText,
  validateDictionary, DICTIONARY, CONFIG, parse, sha256 }
