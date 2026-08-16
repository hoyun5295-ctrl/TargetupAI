// ★ 2026-07-06 AI 직접 호출 불변식 — 소스 스캔 기계 검증 (Harold 지시 "다신 실수 안 하게").
//   기원: 7/1 Sonnet 5 전환의 전수 정정 sweep이 SDK 호출 패턴으로만 grep해 raw fetch 1곳(upload.ts /mapping)을
//   놓쳤고, 적응형 사고 블록이 첫 블록으로 오면 빈 매핑인데 "호출 성공" 로그가 찍히는 사고가 됨(0706 박성용).
//   교훈 문서가 아니라 이 테스트가 재유입을 차단한다 — 어기면 npm test가 실패한다.
import { describe, it, expect } from 'vitest';
import path from 'path';
// ★2026-08-17 스캔은 공용 헬퍼가 루트별 1회만 한다(불변식마다 트리를 다시 읽던 것이 pre-push 타임아웃의 원인).
import { scanSources, SCAN_TIMEOUT_MS } from './source-scan';

const SRC_ROOT = path.resolve(__dirname, '..', '..'); // packages/backend/src
const sources = () => scanSources(SRC_ROOT);

describe('AI 직접 호출 불변식 (소스 전수 스캔)', () => {
  it('불변식 1 — api.anthropic.com/v1/messages raw fetch 금지 (SDK 또는 callAIWithFallback만 — 모델 게이팅 정합을 우회하는 경로 재유입 차단)', () => {
    // Batch API(/v1/messages/batches)는 별도 — 단건 메시지 endpoint 직접 fetch만 금지
    const offenders = sources()
      .filter(({ src }) => src.includes("api.anthropic.com/v1/messages'") || src.includes('api.anthropic.com/v1/messages"'))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('불변식 2 — anthropic.messages.create 직접 호출 파일은 isAdaptiveOnlyModel 게이팅 동반 의무 (Sonnet 5·Opus 4.7+는 thinking 생략 시 자동 ON)', () => {
    const offenders = sources()
      .filter(({ src }) => /anthropic\s*\.messages\.create\s*\(/.test(src) && !src.includes('isAdaptiveOnlyModel'))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('불변식 3 — Claude 응답 첫 블록 가정(content[0].text/type) 금지 — text 타입 블록 탐색 의무 (사고 블록 선행 시 빈손 차단)', () => {
    const firstBlockPattern = /\.content\??\.?\[0\]\??\.(text|type)/;
    const offenders = sources()
      // Claude 응답을 다루는 파일만 (타 API 오탐 차단)
      .filter(({ src }) => /anthropic/i.test(src) && firstBlockPattern.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);
});
