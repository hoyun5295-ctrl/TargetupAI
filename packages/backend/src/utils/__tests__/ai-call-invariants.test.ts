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

  it('불변식 2 — anthropic.messages.create 직접 호출 파일은 모델별 요청 형태 CT(claudeRequestShape) 동반 의무 (새 모델은 생각 끄기 형태가 모델마다 다르다 · 0930 실측)', () => {
    const offenders = sources()
      .filter(({ src }) => /anthropic\s*\.messages\.(create|batches)/.test(src) && !src.includes('claudeRequestShape'))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('불변식 2-2 — 옛 두 갈래 판정(isAdaptiveOnlyModel) 재유입 금지 · 직접 호출부가 thinking 을 손으로 적지 않는다', () => {
    const offenders = sources()
      .filter(({ rel }) => !rel.includes('__tests__') && !rel.endsWith('config/defaults.ts') && !rel.endsWith('config\\defaults.ts'))
      .filter(({ src }) => src.includes('isAdaptiveOnlyModel') || /thinking:\s*\{\s*type:\s*'(disabled|between_tools)'/.test(src))
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

  // ★ 2026-09-30 WP4 — AI 응답 JSON 은 CT(extractJsonFromAiText · 코드펜스 · 머리말 · 문자열 안 제어문자 복구) 하나로만 푼다.
  //   0930 점검 때 AI 호출 파일에 인라인 JSON.parse 가 30곳 넘게 있었다(0630 줄바꿈 제어문자 사고 부류가 파일마다 다시 열려 있었다).
  //   AI 호출 파일에 남아도 되는 JSON.parse 는 DB 값 · 요청 본문을 푸는 아래 인자뿐이다. 새 인자가 필요하면 AI 응답이 아닌지 확인하고 여기에 더한다.
  it('불변식 4 — AI 호출 파일의 JSON.parse 는 DB 값 허용 목록만 (AI 응답 = extractJsonFromAiText)', () => {
    const DB_VALUE_ARGS = new Set([
      'row.memory_value', 'raw', 'ex.rows[0].memory_value', 'dm.brand_kit', 'metaStr', 'data', 'p.proposal_json', 'value',
    ]);
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      if (rel.includes('__tests__') || /\.test\.ts$/.test(rel)) continue;
      if (!/callAIWithFallback\(|anthropic\s*\.messages\./.test(src)) continue;
      for (const m of src.matchAll(/JSON\.parse\(([^)]*)\)/g)) {
        if (!DB_VALUE_ARGS.has(m[1].trim())) offenders.push(`${rel}: JSON.parse(${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  // ★ 2026-09-30 — 대체 경로 실패 문구가 "AI 서비스 일시 장애 (Claude + GPT 모두 실패)"였고, 여러 라우트가 err.message 를 화면에 그대로 돌려줬다.
  //   모델·업체 이름은 사용자 노출 금지(no_model_name_ui_exposure). 상세는 console 로그에만 남긴다.
  it('불변식 5 — 대체 경로(OpenAI)를 가진 파일의 throw 문구에 모델 · 업체 이름 금지', () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      if (rel.includes('__tests__') || !src.includes('api.openai.com')) continue;
      for (const m of src.matchAll(/throw new Error\(\s*[`'"]([^`'"]*)[`'"]/g)) {
        if (/claude|gpt|openai|anthropic/i.test(m[1])) offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);
});
