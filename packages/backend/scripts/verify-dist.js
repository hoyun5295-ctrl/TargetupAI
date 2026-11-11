#!/usr/bin/env node
'use strict';
/**
 * ★ 2026-11-11 빌드 판 검증 (뿌리 R88) — safe-build.sh 가 판을 바꿔 끼우기 전에 부른다.
 *
 * 경위: 11-10 22:46 빌드에서 dist/routes/billing.js 한 파일에 소스 원문 120줄이 끼어든 판이 만들어졌고
 *   (같은 커밋을 다시 빌드하면 안 나온다), 옛 관문은 app.js 존재 · 크기 · 폴더만 봐서 그대로 끼워졌다.
 *   운영이 dist 를 직접 실행(11-10~)하므로 재시작에서 부팅 실패 → 22:47 ~ 08:38 정지.
 *
 * 보는 것 둘:
 *   1. 문법 — 판 안의 .js 전부를 node 가 모듈을 읽을 때와 같은 포장(Module.wrap)으로 컴파일한다(실행은 하지 않는다).
 *   2. 재현 — 같은 소스를 두 번 빌드한 두 판이 파일 목록 · 내용까지 같은가(한 번만 깨진 산출물을 가른다).
 *
 * 사용: node scripts/verify-dist.js <판> [<두 번째 판>]   · 종료 0 = 통과 · 1 = 어긋남
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

/** 판 안의 파일 전부(상대 경로 · 정렬) */
function listFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return base === dir ? out.sort() : out;
}

/** .js 전부 문법 검사 — 실행하지 않고 컴파일만 */
function checkSyntax(dir) {
  const files = listFiles(dir).filter((f) => f.endsWith('.js'));
  const errors = [];
  for (const rel of files) {
    const full = path.join(dir, rel);
    const src = fs.readFileSync(full, 'utf8').replace(/^﻿/, '').replace(/^#!.*/, '');
    try {
      new vm.Script(Module.wrap(src), { filename: full });
    } catch (e) {
      const where = /:(\d+)\n/.exec(String((e && e.stack) || ''));
      errors.push({ file: rel, line: where ? Number(where[1]) : null, message: String((e && e.message) || e) });
    }
  }
  return { count: files.length, errors };
}

/** 두 판 대조 — 한쪽에만 있는 파일 · 내용이 다른 파일 */
function compareDirs(a, b) {
  const fa = listFiles(a);
  const fb = new Set(listFiles(b));
  const onlyA = fa.filter((f) => !fb.has(f));
  const setA = new Set(fa);
  const onlyB = [...fb].filter((f) => !setA.has(f)).sort();
  const differ = fa.filter((f) => fb.has(f) && !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  return { count: fa.length, onlyA, onlyB, differ };
}

function main(argv) {
  const [dirA, dirB] = argv;
  if (!dirA || !fs.existsSync(dirA) || (dirB && !fs.existsSync(dirB))) {
    console.error('[verify-dist] 사용: node scripts/verify-dist.js <판> [<두 번째 판>] — 폴더가 없습니다');
    return 1;
  }
  let bad = 0;
  const syn = checkSyntax(dirA);
  if (syn.count === 0) {
    console.error(`[verify-dist] ${dirA} 에 .js 가 하나도 없습니다`);
    bad++;
  }
  for (const e of syn.errors.slice(0, 20)) console.error(`[verify-dist] 문법 오류 ${e.file}${e.line ? ':' + e.line : ''} — ${e.message}`);
  bad += syn.errors.length;
  if (dirB) {
    const cmp = compareDirs(dirA, dirB);
    for (const f of cmp.onlyA.slice(0, 20)) console.error(`[verify-dist] 첫 판에만 있음 ${f}`);
    for (const f of cmp.onlyB.slice(0, 20)) console.error(`[verify-dist] 둘째 판에만 있음 ${f}`);
    for (const f of cmp.differ.slice(0, 20)) console.error(`[verify-dist] 두 판이 다름 ${f}`);
    bad += cmp.onlyA.length + cmp.onlyB.length + cmp.differ.length;
    if (bad === 0) console.log(`[verify-dist] 통과 — .js ${syn.count}개 문법 · 두 판 ${cmp.count}개 파일 일치`);
  } else if (bad === 0) {
    console.log(`[verify-dist] 통과 — .js ${syn.count}개 문법`);
  }
  if (bad > 0) console.error(`[verify-dist] 실패 — 어긋남 ${bad}건 · 이 판은 끼우지 않습니다`);
  return bad > 0 ? 1 : 0;
}

module.exports = { listFiles, checkSyntax, compareDirs, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
