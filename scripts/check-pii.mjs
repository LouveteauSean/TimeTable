#!/usr/bin/env node
/**
 * check-pii.mjs — 隐私门禁：确保学生名单数据没有进入任何会公开的文件。
 *
 * 需要本地存在私有数据（private/data.raw.json，已在 .gitignore 中排除）：
 *   npm run check:pii
 *
 * 检查范围：除 private/、dist-full/、.git/、node_modules/ 之外的所有文本文件，
 * 以及 dist/ 产物。命中任何学生姓名 / 学号即失败（exit 1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'private', 'data.raw.json');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'private', 'dist-full']);
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.txt', '.yml', '.yaml', '.svg', '.ps1']);

if (!fs.existsSync(RAW)) {
  console.log('跳过：未找到 private/data.raw.json（该文件不随仓库分发，属预期）。');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const people = Array.isArray(raw.people) ? raw.people : [];
const names = [...new Set(people.map((p) => String(p.name || '').trim()).filter((n) => n.length >= 2))];
const codes = [...new Set(people.map((p) => String(p.code || '').trim()).filter((c) => c.length >= 5))];
console.log(`隐私门禁：用 ${names.length} 个姓名 / ${codes.length} 个学号比对公开文件…\n`);

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    files.push(path.join(dir, entry.name));
  }
})(ROOT);

const hits = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const name of names) {
    if (text.includes(name)) hits.push({ file, kind: '姓名', value: name });
  }
  for (const code of codes) {
    if (text.includes(code)) hits.push({ file, kind: '学号', value: code });
  }
}

if (hits.length === 0) {
  console.log(`PASS: 已扫描 ${files.length} 个文本文件，未发现学生姓名/学号。`);
  process.exit(0);
}

console.error(`FAIL: 发现 ${hits.length} 处隐私数据！`);
const byFile = new Map();
for (const hit of hits) {
  const rel = path.relative(ROOT, hit.file);
  if (!byFile.has(rel)) byFile.set(rel, []);
  byFile.get(rel).push(`${hit.kind}:${hit.value}`);
}
for (const [file, items] of byFile) {
  console.error(`  ${file}  ->  ${[...new Set(items)].slice(0, 8).join(', ')}`);
}
process.exit(1);
