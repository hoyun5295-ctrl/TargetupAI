// ★ 2026-07-06 AI 직접 호출 불변식 — 소스 스캔 기계 검증 (Harold 지시 "다신 실수 안 하게").
//   기원: 7/1 Sonnet 5 전환의 전수 정정 sweep이 SDK 호출 패턴으로만 grep해 raw fetch 1곳(upload.ts /mapping)을
//   놓쳤고, 적응형 사고 블록이 첫 블록으로 오면 빈 매핑인데 "호출 성공" 로그가 찍히는 사고가 됨(0706 박성용).
//   교훈 문서가 아니라 이 테스트가 재유입을 차단한다 — 어기면 npm test가 실패한다.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..'); // packages/backend/src

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('AI 직접 호출 불변식 (소스 전수 스캔)', () => {
  const files = walkTsFiles(SRC_ROOT);

  it('불변식 1 — api.anthropic.com/v1/messages raw fetch 금지 (SDK 또는 callAIWithFallback만 — 모델 게이팅 정합을 우회하는 경로 재유입 차단)', () => {
    const offenders = files
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        // Batch API(/v1/messages/batches)는 별도 — 단건 메시지 endpoint 직접 fetch만 금지
        return src.includes("api.anthropic.com/v1/messages'") || src.includes('api.anthropic.com/v1/messages"');
      })
      .map((f) => path.relative(SRC_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('불변식 2 — anthropic.messages.create 직접 호출 파일은 isAdaptiveOnlyModel 게이팅 동반 의무 (Sonnet 5·Opus 4.7+는 thinking 생략 시 자동 ON)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (/anthropic\s*\.messages\.create\s*\(/.test(src) && !src.includes('isAdaptiveOnlyModel')) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('불변식 3 — Claude 응답 첫 블록 가정(content[0].text/type) 금지 — text 타입 블록 탐색 의무 (사고 블록 선행 시 빈손 차단)', () => {
    const offenders: string[] = [];
    const firstBlockPattern = /\.content\??\.?\[0\]\??\.(text|type)/;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/anthropic/i.test(src)) continue; // Claude 응답을 다루는 파일만 (타 API 오탐 차단)
      if (firstBlockPattern.test(src)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
