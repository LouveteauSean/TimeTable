#!/usr/bin/env node
/**
 * prepare-data.mjs — 从私有导出生成公开课表数据（剔除学生名单等个人信息）。
 *
 * 公开仓库只包含"课表本身"：班级 / 课时条目 / 节次 / 学期信息。
 * 学生名单（姓名、学号）属于个人隐私，**绝不进入仓库与发布产物**；
 * 维护者本地保留 private/data.raw.json（已在 .gitignore 中排除），用本脚本生成公开数据。
 *
 * 用法：
 *   node scripts/prepare-data.mjs                       # 默认 private/data.raw.json -> src/data/timetable.json
 *   node scripts/prepare-data.mjs --input <raw.json> --output <out.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const inputPath = path.resolve(ROOT, argValue('--input', 'private/data.raw.json'));
const outputPath = path.resolve(ROOT, argValue('--output', 'src/data/timetable.json'));

if (!fs.existsSync(inputPath)) {
  console.error(`错误：找不到私有数据 ${inputPath}`);
  console.error('说明：学生名单数据不随仓库分发。维护者需在本地放置 private/data.raw.json 后再执行本脚本。');
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

if (!Array.isArray(raw.classes) || !Array.isArray(raw.periods)) {
  console.error('错误：私有数据缺少 classes/periods 字段');
  process.exit(2);
}

const requiredEntryFields = ['course', 'teacher', 'weeks', 'day', 'period'];
let entryCount = 0;
for (const klass of raw.classes) {
  if (!klass.name || !Array.isArray(klass.entries)) {
    console.error(`错误：班级 ${klass.name ?? '(未命名)'} 数据不完整`);
    process.exit(2);
  }
  for (const entry of klass.entries) {
    for (const field of requiredEntryFields) {
      if (entry[field] === undefined) {
        console.error(`错误：${klass.name} 的条目缺少字段 ${field}`);
        process.exit(2);
      }
    }
    entryCount += 1;
  }
}

/** 只保留课表所需字段；显式白名单，避免以后私有导出新增个人信息字段被误带入。 */
const sanitizeEntry = (e) => ({
  course: e.course,
  code: e.code ?? '',
  teacher: e.teacher ?? '',
  weekText: e.weekText ?? '',
  klass: e.klass ?? '',
  room: e.room ?? '',
  weeks: Array.isArray(e.weeks) ? e.weeks.slice() : [],
  day: e.day,
  period: e.period,
});

const publicData = {
  title: raw.title || '',
  semesterStart: raw.semesterStart || '2026-08-31',
  periods: raw.periods.map((p) => ({ no: p.no, time: p.time, section: p.section })),
  classes: raw.classes.map((klass) => ({
    name: klass.name,
    title: klass.title || '',
    notes: Array.isArray(klass.notes) ? klass.notes.slice() : [],
    entries: klass.entries.map(sanitizeEntry),
  })),
};

// 防御性检查：公开数据里不允许出现任何人员名单字段
const serialized = JSON.stringify(publicData);
for (const forbidden of ['"people"', '学号 2', '学生名单']) {
  if (serialized.includes(forbidden)) {
    console.error(`错误：公开数据中检测到疑似隐私内容 ${forbidden}`);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(publicData, null, 2) + '\n', 'utf8');

const courses = new Set();
const teachers = new Set();
const rooms = new Set();
for (const klass of publicData.classes) {
  for (const entry of klass.entries) {
    courses.add(entry.course);
    for (const t of String(entry.teacher).split(/[、,，]/)) if (t.trim() && t.trim() !== '体育课') teachers.add(t.trim());
    if (entry.room && entry.room !== '无地点安排') rooms.add(entry.room.trim());
  }
}

console.log('公开课表数据已生成');
console.log('  输出       :', path.relative(ROOT, outputPath));
console.log('  班级       :', publicData.classes.length);
console.log('  课时条目   :', entryCount);
console.log('  课程 / 教师 / 教室:', courses.size, '/', teachers.size, '/', rooms.size);
console.log('  已剔除     : 学生名单（people）等个人信息字段');
