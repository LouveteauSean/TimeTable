#!/usr/bin/env node
/**
 * build.mjs — 把模板 + 样式 + 数据 + 脚本打包成单文件静态站点。
 *
 *   npm run build                       # 公开构建：脱敏数据 -> dist/
 *   npm run build:full                  # 内部完整构建：含名单的私有数据 -> dist-full/（勿提交）
 *   node scripts/build.mjs --data <json> --out <dir>
 *
 * 设计：名单/学生相关 UI 由前端按数据自动开关（见 src/app.js 的 HAS_PEOPLE），
 * 因此同一份代码既能产出公开版，也能在服务器上用完整数据产出内部版。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dataPath = path.resolve(ROOT, argValue('--data', 'src/data/timetable.json'));
const outDir = path.resolve(ROOT, argValue('--out', 'dist'));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- 输入 ---------- */
const template = read('src/index.template.html');
const styles = [
  read('src/styles/base.css').replace(/\s+$/, ''),
  read('src/styles/extras.css').trim(),
  read('src/styles/enhanced.css').trim(),
].join('\n\n');
const appJs = read('src/app.js').trimEnd();
const favicon = fs.readFileSync(path.join(ROOT, 'src/favicon.svg'));

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (err) {
  console.error(`错误：无法读取数据 ${dataPath}\n${err.message}`);
  process.exit(2);
}

/* ---------- 数据校验 ---------- */
const problems = [];
if (!data.title || typeof data.title !== 'string') problems.push('缺少 title');
if (!Array.isArray(data.periods) || data.periods.length === 0) problems.push('缺少 periods');
if (!Array.isArray(data.classes) || data.classes.length === 0) problems.push('缺少 classes');
for (const klass of data.classes || []) {
  if (!klass.name) problems.push('班级缺少 name');
  if (!Array.isArray(klass.entries)) problems.push(`班级 ${klass.name} 缺少 entries`);
  for (const entry of klass.entries || []) {
    for (const field of ['course', 'teacher', 'weeks', 'day', 'period']) {
      if (entry[field] === undefined) problems.push(`${klass.name} 的条目缺少 ${field}`);
    }
  }
}
if (problems.length) {
  console.error('错误：数据校验失败\n  - ' + [...new Set(problems)].join('\n  - '));
  process.exit(2);
}

const hasPeople = Array.isArray(data.people) && data.people.length > 0;
if (hasPeople) {
  console.warn('⚠️  当前数据包含学生名单（people），产物属于内部版本，请勿提交到公开仓库或部署到公网。');
}

/* ---------- 拼装 ---------- */
const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');
const dataScript = 'window.__TT_DATA__ = ' + dataJson + ';';

let html = template
  .split('/*__CSS__*/').join(styles)
  .split('/*__DATA__*/').join(dataScript)
  .split('/*__APP__*/').join(appJs);

const leftovers = ['/*__CSS__*/', '/*__DATA__*/', '/*__APP__*/'].filter((m) => html.includes(m));
if (leftovers.length) {
  console.error('错误：模板占位符未替换：' + leftovers.join(', '));
  process.exit(1);
}

/* ---------- 产物校验（公开构建不允许外链） ---------- */
const external = [...html.matchAll(/https?:\/\/[^\s"'<>()]+/g)]
  .map((m) => m[0])
  .filter((u) => !u.startsWith('http://www.w3.org/'));
if (external.length) {
  console.warn('⚠️  产物包含外部链接：\n  - ' + [...new Set(external)].join('\n  - '));
}

fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, 'index.html');
fs.writeFileSync(target, html, 'utf8');
fs.writeFileSync(path.join(outDir, 'favicon.svg'), favicon);

const bytes = Buffer.byteLength(html);
const sha = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
const entryCount = data.classes.reduce((n, c) => n + c.entries.length, 0);
console.log(`构建完成  ${path.relative(ROOT, target)}`);
console.log(`  大小    : ${(bytes / 1024).toFixed(1)} KB  (sha256 ${sha})`);
console.log(`  数据    : ${data.classes.length} 个班级 / ${entryCount} 条课时${hasPeople ? ' / 含学生名单（内部）' : ' / 不含学生名单（公开）'}`);
console.log(`  外链    : ${external.length ? external.length + ' 个' : '无（完全离线可用）'}`);
console.log(`  名单功能: ${hasPeople ? '启用（数据含 people）' : '关闭（公开数据无 people）'}`);
