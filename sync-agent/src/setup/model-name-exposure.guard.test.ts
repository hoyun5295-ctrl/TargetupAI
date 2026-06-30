/**
 * 모델명 사용자 노출 자동 차단 가드 (2026-06-30 — isae 원격 설치 중 claude-opus-4-7 화면 노출 재발 차단)
 *
 * 배경: setup CLI가 AI 매핑 완료 메시지에 `모델=${modelUsed}`(= claude-opus-4-7)을 그대로 찍어
 *   원격 설치 화면에 모델명이 노출됐다. "조심하라"는 수동 규칙으로는 반복 재발 → 자동 차단으로 전환.
 *
 * 규칙(no_model_name_ui_exposure): 모델명은 사용자 화면(콘솔/로거/textContent/응답)에 절대 노출 금지.
 *   서버에서 받은 modelUsed 값은 데이터로 흘려보내는 건 되지만(객체 필드 plumbing),
 *   문자열에 끼워 사용자에게 보여주는(템플릿 ${}/문자열 +) 건 금지. 코드 주석은 예외.
 *
 * 이 테스트는 src 전체를 스캔해, 모델명 리터럴 또는 modelUsed를 화면 출력에 끼우는 코드가 있으면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

// 모델명 ID 리터럴(claude-opus-4-7 등)
const MODEL_LITERAL = /claude-(opus|sonnet|haiku)/i;
// modelUsed 변수를 템플릿 문자열 ${...}에 끼워 넣는 경우 (= 화면 출력 직전 형태)
const MODEL_IN_TEMPLATE = /\$\{[^}]*\bmodelUsed\b[^}]*\}/;
// modelUsed 변수를 문자열 + 연결로 붙이는 경우
const MODEL_IN_CONCAT = /['"`]\s*\+\s*[\w.]*\bmodelUsed\b|\bmodelUsed\b\s*\+\s*['"`]/;

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('모델명 사용자 노출 가드', () => {
  it('src 코드에 모델명 리터럴 / modelUsed 화면출력이 없어야 한다', () => {
    const violations: string[] = [];

    for (const file of walkTsFiles(SRC_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (isCommentLine(trimmed)) return; // 주석은 예외

        if (MODEL_LITERAL.test(line)) {
          violations.push(`${file}:${idx + 1} — 모델명 리터럴: ${trimmed}`);
        }
        if (MODEL_IN_TEMPLATE.test(line) || MODEL_IN_CONCAT.test(line)) {
          violations.push(`${file}:${idx + 1} — modelUsed 화면 출력: ${trimmed}`);
        }
      });
    }

    expect(violations, `\n모델명 노출 발견:\n${violations.join('\n')}\n`).toEqual([]);
  });
});
