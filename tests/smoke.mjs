#!/usr/bin/env node
/**
 * tests/smoke.mjs — 产物自检（零依赖，CI 可跑）。
 *
 *   npm test
 *
 * 校验 dist/index.html：单文件结构、内嵌数据（且必须已脱敏）、无外部请求、
 * 关键 DOM 锚点齐全、体积在预算内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist', 'index.html');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`);
  }
}

if (!fs.existsSync(DIST)) {
  console.error(`错误：找不到 ${path.relative(ROOT, DIST)}，请先执行 npm run build`);
  process.exit(2);
}

const html = fs.readFileSync(DIST, 'utf8');
const bytes = Buffer.byteLength(html);
console.log(`检查 ${path.relative(ROOT, DIST)} (${(bytes / 1024).toFixed(1)} KB)\n`);

/* ---------- 单文件结构 ---------- */
check('以 <!DOCTYPE html> 开头', html.trimStart().startsWith('<!DOCTYPE html>'));
check('只有一个内联 <script>', (html.match(/<script/gi) || []).length === 1);
check('只有一个 </script>', (html.match(/<\/script>/gi) || []).length === 1);
check('模板占位符已全部替换', !/\/\*__[A-Z]+__\*\//.test(html));

/* ---------- 内嵌数据 ---------- */
const DATA_MARK = 'window.__TT_DATA__ = ';
const start = html.indexOf(DATA_MARK);
check('包含内嵌数据', start >= 0);
let data = null;
if (start >= 0) {
  const jsonStart = start + DATA_MARK.length;
  const jsonEnd = html.indexOf('};', jsonStart);
  try {
    data = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    check('内嵌数据可解析', false, err.message);
  }
}
if (data) {
  check('内嵌数据可解析', true);
  check('数据不含学生名单（people）', !('people' in data), '公开构建必须已脱敏');
  check('数据顶层字段合法', ['title', 'periods', 'classes'].every((k) => k in data), Object.keys(data).join(','));
  check('班级数量为 24', Array.isArray(data.classes) && data.classes.length === 24, `实际 ${data.classes?.length}`);
  const entries = (data.classes || []).reduce((n, c) => n + (c.entries?.length || 0), 0);
  check('课时条目为 396', entries === 396, `实际 ${entries}`);
  const serialized = JSON.stringify(data);
  check('数据中不含“学号”字样', !serialized.includes('学号'));
}

/* ---------- 无外部请求 ---------- */
const external = [...html.matchAll(/https?:\/\/[^\s"'<>()]+/g)]
  .map((m) => m[0])
  .filter((u) => !u.startsWith('http://www.w3.org/'));
check('无外部网络请求（含字体/CDN）', external.length === 0, external.join(', '));
check('无外部样式表', !/<link[^>]+rel=["']stylesheet/i.test(html));
check('无 Google Fonts 引用', !/fonts\.(googleapis|gstatic)/.test(html));

/* ---------- 关键 DOM 锚点 ---------- */
for (const id of ['app', 'searchBox', 'searchClear', 'goBtn', 'entitySeg', 'pickBtn', 'weekBar', 'weekNav', 'wkPrev', 'wkNum', 'wkNext', 'wkToday', 'weekMarks', 'gridCard', 'gridTitle', 'gridSub', 'ttTable', 'modalMask', 'pickMask']) {
  check(`包含 #${id}`, new RegExp(`id=["']${id}["']`).test(html));
}
check('包含页脚', html.includes('2026-2027学年秋季学期'));
check('包含无障碍 noscript 提示', html.includes('<noscript>'));

/* ---------- 体积预算 ---------- */
check('体积 < 400 KB', bytes < 400 * 1024, `${(bytes / 1024).toFixed(1)} KB`);
check('体积 > 100 KB（数据已内嵌）', bytes > 100 * 1024, `${(bytes / 1024).toFixed(1)} KB`);

console.log('');
if (failures) {
  console.error(`FAIL: ${failures} 项未通过`);
  process.exit(1);
}
console.log('PASS: 全部检查通过');
