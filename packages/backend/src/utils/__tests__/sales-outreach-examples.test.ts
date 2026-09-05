/**
 * sales-outreach-examples.test.ts — 실물 예시 학습 CT의 순수 함수 + 원천 병합 계약 (2026-09-05 · 설계서 §20)
 * DB는 mock(순수 함수만 실행).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { query: vi.fn(async () => ({ rows: [] })) }, default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { normalizeShortCodeInput, parseCodeList, brandKeyOf, suggestEmailForDm } from '../sales-outreach-examples';
import { exemplarSourceFromRows, mergeExemplarSources, pickOutreachExemplars, countOutreachExemplars } from '../sales-outreach-exemplars';

describe('normalizeShortCodeInput · parseCodeList', () => {
  it('URL·접두를 걷고 대소문자를 보존한다 · 형식 밖은 null', () => {
    expect(normalizeShortCodeInput('https://hlj.kr/Q59eDMq')).toBe('Q59eDMq');
    expect(normalizeShortCodeInput('hlj.kr/lb0NuGC ')).toBe('lb0NuGC');
    expect(normalizeShortCodeInput('https://hanjul.ai/api/dm/v/dm-guUAc2J?r=abc')).toBe('guUAc2J');
    expect(normalizeShortCodeInput('dm-PXSYpl6')).toBe('PXSYpl6');
    expect(normalizeShortCodeInput('PXSYpl6')).toBe('PXSYpl6');
    expect(normalizeShortCodeInput('abc')).toBeNull();
    expect(normalizeShortCodeInput('has space here')).toBeNull();
    expect(normalizeShortCodeInput('')).toBeNull();
  });
  it('목록 파싱 — 줄·쉼표·공백 구분 · 중복 제거 · 상한 · 형식 밖 보고', () => {
    const r = parseCodeList('올리브영 https://hlj.kr/Q59eDMq (남주임)\n쿠팡 https://hlj.kr/lb0NuGC\nhlj.kr/Q59eDMq, xx', 10);
    expect(r.codes).toEqual(['Q59eDMq', 'lb0NuGC']);
    expect(r.invalid).toEqual(['xx']); // 한글 라벨·직원 표기는 조용히 넘긴다 · 코드처럼 생긴 것만 보고
    expect(parseCodeList('a1b2c3d4 e5f6g7h8 a1b2c3d4', 1).codes).toEqual(['a1b2c3d4']);
  });
});

describe('brandKeyOf · suggestEmailForDm', () => {
  const emails = [
    { id: 'e1', name: '탑텐', subject: '9월의 탑텐 PICK, 지금 만나보세요' },
    { id: 'e2', name: 'SPAO 스파오', subject: '커브드 팬츠' },
    { id: 'e3', name: 'ZIGZAG 초대장', subject: '%고객명%님 당신을 위한 추천템' },
    { id: 'e4', name: '스타일난다(3CE)', subject: '3CE가 전하는 나만의 컬러 완성' },
    { id: 'e5', name: '아디제로 EVO SL x SFTM 협업', subject: '하나의 예' },
  ];
  it('직원 표기·기호를 걷은 키', () => {
    expect(brandKeyOf('무신사(임은지2)')).toBe('무신사');
    expect(brandKeyOf('난다(3CE)(임은지3)')).toBe('난다3ce');
  });
  it('같은 브랜드를 가리키는 이메일을 제안 · 없으면 null', () => {
    expect(suggestEmailForDm('탑텐', emails)).toBe('e1');
    expect(suggestEmailForDm('스파오', emails)).toBe('e2');
    expect(suggestEmailForDm('난다(3CE)(임은지3)', emails)).toBe('e4');
    expect(suggestEmailForDm('미구하라', emails)).toBeNull();
  });
});

describe('exemplarSourceFromRows · mergeExemplarSources', () => {
  it('행 → 채널:업종군 키 + 머리줄 · 병합은 DB 먼저 · 같은 본문 1번', () => {
    const rows = [
      { channel: 'DM' as const, industryCode: 'fashion', content: '  1. header\n  2. hero\n    headline: 가을 신상' },
      { channel: 'EMAIL' as const, industryCode: 'food', content: '제목: 초대\n  1. header' },
      { channel: 'DM' as const, industryCode: 'nope', content: '' },
    ];
    const src = exemplarSourceFromRows(rows);
    expect(Object.keys(src).sort()).toEqual(['DM:fashion', 'EMAIL:commerce']);
    expect(src['DM:fashion'][0].startsWith('[예시 · DM · fashion]\n  1. header')).toBe(true);
    expect(src['EMAIL:commerce'][0].startsWith('[예시 · EMAIL · commerce] 제목: 초대')).toBe(true);
    const seed = { 'DM:fashion': ['[예시 · DM · fashion]\n  1. header\n  2. hero\n    headline:  가을 신상', '[예시 · DM · fashion]\n  1. cta'], 'DM:beauty': ['[예시 · DM · beauty]\n  1. hero'] };
    const merged = mergeExemplarSources(src, seed);
    expect(merged['DM:fashion']).toHaveLength(2); // DB 1 + seed 중 다른 본문 1(같은 본문은 1번)
    expect(merged['DM:fashion'][0]).toBe(src['DM:fashion'][0]);
    expect(merged['DM:beauty']).toHaveLength(1);
    expect(countOutreachExemplars('DM', merged)).toBe(3);
    expect(pickOutreachExemplars('DM', 'fashion', { source: merged, max: 1 })).toBe(src['DM:fashion'][0]);
  });
});
