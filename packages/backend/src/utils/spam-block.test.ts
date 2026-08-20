/**
 * 금칙어 차단 체계 — 전송자격인증 5.2 (★2026-08-18)
 *
 * ★2026-08-19 탐지 전용으로 좁혔다 — 이 체계는 **발송을 막지 않는다.**
 *   차단 판정을 차감 **뒤**(큐 적재)에 뒀던 것이 뿌리였다. 돈이 이미 움직인 자리라
 *   무엇으로 막든 환불 멱등이 깨진다(같은 캠페인 재차단 시 환불 0 = 실차감 잔존).
 *   막는 동작을 없애면 그 결함은 성립 자체를 안 한다. 차단은 게이트를 차감 **앞** preflight로
 *   옮기는 재설계 뒤에 연다(브랜드메시지 0818(6)과 같은 자리).
 *
 * 이 테스트가 지키는 것
 *   1. 단일 요소 규칙은 **만들 수 없다**. "대출" 하나로 막으면 금융 고객사가 발송을 못 한다.
 *   2. 조합은 **요소가 전부** 맞아야 걸린다. 하나라도 빠지면 통과다.
 *   3. ★ 판정 결과에 **막는 값이 없다** — 걸려도 결과는 걸린 규칙 목록뿐이다.
 *   4. ★ DB에 `mode='block'`이 들어 있어도 코드가 읽지 않는다(데이터로 차단을 켤 수 없다).
 *   5. 예외 회사는 그 규칙에 걸리지 않는다.
 *   6. 규칙 조회가 실패하면 **전량 통과**한다(fail-open). 필터 오류로 전 고객 발송이 멈추면 안 된다.
 *   7. ★ 탐지 로그는 **규칙별 1행**으로 접어 단일 INSERT — 개인화 1만 건이 1만 INSERT가 되지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../config/database';
import {
  maskSample,
  validateElements, matchesElement, matchesRule, evaluateContent,
  loadActiveRules, invalidateSpamBlockCache, logSpamBlockHits, MIN_ELEMENTS, MAX_ELEMENTS,
  BlockRule,
} from './spam-block';

const q = query as unknown as ReturnType<typeof vi.fn>;

const COMPANY = 'company-1';

function rule(over: Partial<BlockRule> = {}): BlockRule {
  return {
    id: 'r1',
    name: '무직자 당일대출',
    elements: [
      { type: 'keyword', value: '무직자' },
      { type: 'keyword', value: '당일' },
    ],
    source: 'kisa',
    exemptCompanyIds: [],
    ...over,
  };
}

describe('단일 키워드 차단은 만들 수 없다', () => {
  it(`요소 ${MIN_ELEMENTS}개 미만은 거부한다`, () => {
    const r = validateElements([{ type: 'keyword', value: '대출' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('통과하면 안 된다');
    expect(r.error).toContain('단일 키워드 차단은 정상 문자를 막습니다');
  });

  it(`요소 ${MAX_ELEMENTS}개 초과는 거부한다`, () => {
    const many = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({ type: 'keyword', value: `w${i}` }));
    expect(validateElements(many).ok).toBe(false);
  });

  it('정상 조합은 통과한다', () => {
    const r = validateElements([
      { type: 'keyword', value: '무직자' },
      { type: 'url', value: 'bit.ly' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('빈 값·잘못된 유형은 거부한다', () => {
    expect(validateElements([{ type: 'keyword', value: '' }, { type: 'keyword', value: 'a' }]).ok).toBe(false);
    expect(validateElements([{ type: 'unknown', value: 'a' }, { type: 'keyword', value: 'b' }]).ok).toBe(false);
    expect(validateElements('배열아님').ok).toBe(false);
  });
});

describe('요소 판별', () => {
  it('키워드는 공백·대소문자를 흡수한다', () => {
    expect(matchesElement({ type: 'keyword', value: '무직자' }, '무 직 자 대출')).toBe(true);
    expect(matchesElement({ type: 'url', value: 'BIT.LY' }, '지금 bit.ly/abc 확인')).toBe(true);
  });

  it('전화번호는 표기가 달라도 숫자로 비교한다', () => {
    expect(matchesElement({ type: 'phone', value: '010-1234-5678' }, '문의 01012345678')).toBe(true);
    expect(matchesElement({ type: 'phone', value: '01012345678' }, '문의 010-1234-5678')).toBe(true);
  });

  it('없는 요소는 false', () => {
    expect(matchesElement({ type: 'keyword', value: '무직자' }, '신상품 안내드립니다')).toBe(false);
  });
});

describe('★ 조합은 전부 맞아야 걸린다 — 정상 문자 보호의 핵심', () => {
  it('요소가 전부 있으면 걸린다', () => {
    expect(matchesRule(rule(), '무직자 당일 승인 가능합니다')).toBe(true);
  });

  it('★ 하나라도 빠지면 통과한다 — "당일 배송"은 스팸이 아니다', () => {
    expect(matchesRule(rule(), '당일 배송 안내드립니다')).toBe(false);
    expect(matchesRule(rule(), '무직자 지원 프로그램 안내')).toBe(false);
  });

  it('★ 단일 요소 규칙이 DB에 있어도 적용하지 않는다 — 이중 방어', () => {
    const single = rule({ elements: [{ type: 'keyword', value: '대출' }] });
    expect(matchesRule(single, '대출 상담 안내')).toBe(false);
  });
});

describe('★ 판정 결과에 막는 값이 없다 — 탐지 전용', () => {
  it('걸려도 결과는 걸린 규칙 목록뿐이다', () => {
    const v = evaluateContent('무직자 당일 승인', [rule()], COMPANY);
    expect(v).toEqual({ hits: [{ ruleId: 'r1', ruleName: '무직자 당일대출' }] });
  });

  it('★ 판정 결과에 발송을 막는 필드가 존재하지 않는다 — 소비처가 막을 근거를 못 얻는다', () => {
    const v = evaluateContent('무직자 당일 승인', [rule()], COMPANY) as Record<string, unknown>;
    expect(v).not.toHaveProperty('action');
    expect(v).not.toHaveProperty('message');
  });

  it('여러 규칙이 걸리면 전부 기록된다 — 우열을 가리지 않는다', () => {
    const v = evaluateContent('무직자 당일 승인', [rule({ id: 'a' }), rule({ id: 'b' })], COMPANY);
    expect(v.hits.map((h) => h.ruleId)).toEqual(['a', 'b']);
  });

  it('안 걸리면 hits가 비어 있다', () => {
    expect(evaluateContent('신상품 안내드립니다', [rule()], COMPANY)).toEqual({ hits: [] });
  });
});

describe('★ 예외 회사는 걸리지 않는다', () => {
  it('예외 목록에 있으면 그 규칙을 건너뛴다 — 금융사에 "대출"은 정상 업무다', () => {
    const exempt = rule({ exemptCompanyIds: [COMPANY] });
    expect(evaluateContent('무직자 당일 승인', [exempt], COMPANY).hits).toHaveLength(0);
    expect(evaluateContent('무직자 당일 승인', [exempt], 'other-company').hits).toHaveLength(1);
  });

  it('회사 id가 없으면 예외를 적용하지 않는다(검사는 그대로 돈다)', () => {
    const exempt = rule({ exemptCompanyIds: [COMPANY] });
    expect(evaluateContent('무직자 당일 승인', [exempt], null).hits).toHaveLength(1);
  });
});

describe('★ 규칙 조회 실패는 발송을 막지 않는다 (fail-open)', () => {
  beforeEach(() => {
    q.mockReset();
    invalidateSpamBlockCache();
  });

  it('테이블이 없으면 빈 규칙 — 전량 통과', async () => {
    q.mockRejectedValue(new Error('relation "spam_block_rules" does not exist'));
    await expect(loadActiveRules()).resolves.toEqual([]);
  });

  it('DB 오류도 빈 규칙 — 필터 오류로 전 고객 발송이 멈추면 안 된다', async () => {
    q.mockRejectedValue(new Error('connection terminated'));
    await expect(loadActiveRules()).resolves.toEqual([]);
  });

  it('로드 시 단일 요소 규칙을 걸러낸다', async () => {
    q.mockResolvedValue({
      rows: [
        { id: 'a', name: '단일', elements: [{ type: 'keyword', value: '대출' }], mode: 'block', source: 'kisa', exempt_company_ids: [] },
        { id: 'b', name: '조합', elements: [{ type: 'keyword', value: '무직자' }, { type: 'keyword', value: '당일' }], mode: 'block', source: 'kisa', exempt_company_ids: [] },
      ],
      rowCount: 2,
    });
    const rules = await loadActiveRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('b');
  });

  it('★ DB에 mode=block이 들어 있어도 코드가 읽지 않는다 — 데이터로 차단을 켤 수 없다', async () => {
    q.mockResolvedValue({
      rows: [{ id: 'c', name: 'x', elements: [{ type: 'keyword', value: 'a' }, { type: 'keyword', value: 'b' }], mode: 'block', source: null, exempt_company_ids: null }],
      rowCount: 1,
    });
    const rules = await loadActiveRules();
    expect(rules[0]).not.toHaveProperty('mode');
    // 그 규칙에 걸려도 결과는 여전히 hits뿐이다
    expect(evaluateContent('a b', rules, COMPANY)).toEqual({ hits: [{ ruleId: 'c', ruleName: 'x' }] });
  });

  it('★ 규칙 조회 SQL이 mode 컬럼을 읽지 않는다 — 소스 불변식', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });
    await loadActiveRules();
    expect(q.mock.calls[0][0]).not.toMatch(/\bmode\b/);
  });

  it('★ 겹친 호출은 조회를 하나만 낸다 (0819 Codex 2R — PG 풀 고갈)', async () => {
    let release: (v: any) => void = () => {};
    q.mockReturnValue(new Promise((r) => { release = r; }));

    const calls = [loadActiveRules(), loadActiveRules(), loadActiveRules()];
    expect(q).toHaveBeenCalledTimes(1); // 셋이 진행 중인 조회 하나를 함께 기다린다

    release({ rows: [], rowCount: 0 });
    const results = await Promise.all(calls);
    expect(results.every((r) => r.length === 0)).toBe(true);
  });

  it('★ 무효화 뒤 호출은 낡은 세대의 조회를 공유하지 않는다 (0819 Codex 2R)', async () => {
    const two = (id: string) => ({
      id, name: id, elements: [{ type: 'keyword', value: 'a' }, { type: 'keyword', value: 'b' }],
      source: 'kisa', exempt_company_ids: [],
    });
    let releaseOld: (v: any) => void = () => {};
    q.mockReturnValueOnce(new Promise((r) => { releaseOld = r; }));

    const oldCall = loadActiveRules();          // 세대 0 조회 진행 중
    invalidateSpamBlockCache();                 // 새 규칙이 커밋됐다 → 세대 1

    q.mockResolvedValueOnce({ rows: [two('new')], rowCount: 1 });
    const newCall = loadActiveRules();          // 세대 1 호출

    releaseOld({ rows: [two('old')], rowCount: 1 });
    const [oldRules, newRules] = await Promise.all([oldCall, newCall]);

    expect(oldRules[0].id).toBe('old');
    expect(newRules[0].id).toBe('new');         // 낡은 조회를 물려받지 않는다
    expect(q).toHaveBeenCalledTimes(2);
  });

  it('★ 조회 중 무효화가 들어오면 낡은 결과로 캐시를 채우지 않는다', async () => {
    let release: (v: any) => void = () => {};
    q.mockReturnValueOnce(new Promise((r) => { release = r; }));

    const pending = loadActiveRules();
    invalidateSpamBlockCache();                 // 로드 중 규칙이 바뀌었다
    release({ rows: [], rowCount: 0 });
    await pending;

    // 캐시가 채워졌다면 두 번째 호출이 조회를 내지 않는다 — 채우지 않았으므로 조회가 한 번 더 나야 한다
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await loadActiveRules();
    expect(q).toHaveBeenCalledTimes(2);
  });
});

describe('★ 탐지 로그는 규칙별 1행으로 접어 단일 INSERT (0818 Codex critical 2 — 직렬 INSERT)', () => {
  beforeEach(() => {
    q.mockReset();
    q.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('개인화 문안 3종이 같은 규칙에 걸리면 INSERT는 1회 · 건수는 합산된다', async () => {
    const hits = [{ ruleId: 'r1', ruleName: '무직자 당일대출' }];
    await logSpamBlockHits({
      entries: [
        { verdict: { hits }, affectedRows: 4000, contentSample: '홍길동님 무직자 당일' },
        { verdict: { hits }, affectedRows: 3000, contentSample: '김철수님 무직자 당일' },
        { verdict: { hits }, affectedRows: 3000, contentSample: '이영희님 무직자 당일' },
      ],
      companyId: COMPANY, userId: 'u1', source: 'campaign',
    });
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('INSERT INTO spam_block_hits');
    expect(params).toContain(10000); // affected_rows 합산
  });

  it('규칙이 둘이면 한 INSERT 안에 2행이 들어간다', async () => {
    await logSpamBlockHits({
      entries: [{
        verdict: { hits: [{ ruleId: 'r1', ruleName: 'a' }, { ruleId: 'r2', ruleName: 'b' }] },
        affectedRows: 5, contentSample: 'x',
      }],
      companyId: COMPANY,
    });
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][1]).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  it('걸린 게 없으면 DB를 건드리지 않는다', async () => {
    await logSpamBlockHits({ entries: [{ verdict: { hits: [] }, affectedRows: 9, contentSample: 'x' }], companyId: COMPANY });
    expect(q).not.toHaveBeenCalled();
  });

  it('★ 기록 실패가 호출부로 새어 나가지 않는다 — 로그 때문에 발송이 죽으면 안 된다', async () => {
    q.mockRejectedValue(new Error('connection terminated'));
    await expect(logSpamBlockHits({
      entries: [{ verdict: { hits: [{ ruleId: 'r1', ruleName: 'a' }] }, affectedRows: 1, contentSample: 'x' }],
      companyId: COMPANY,
    })).resolves.toBeUndefined();
  });

  it('표본은 마스킹해서 저장한다', async () => {
    await logSpamBlockHits({
      entries: [{ verdict: { hits: [{ ruleId: 'r1', ruleName: 'a' }] }, affectedRows: 1, contentSample: '01052958517 무직자 당일' }],
      companyId: COMPANY,
    });
    expect(q.mock.calls[0][1].join('|')).not.toContain('01052958517');
  });
});

describe('★ 0818 Codex 정정 — 중복 요소로 하한을 우회할 수 없다', () => {
  it('같은 값을 두 번 넣으면 하나로 접혀 하한 미달로 거부된다', () => {
    const r = validateElements([
      { type: 'keyword', value: '대출' },
      { type: 'keyword', value: '대출' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('통과하면 안 된다');
    expect(r.error).toContain('단일 키워드');
  });

  it('공백·대소문자만 다른 값도 중복으로 본다', () => {
    const r = validateElements([
      { type: 'keyword', value: 'Bit.LY' },
      { type: 'keyword', value: 'bit. ly' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('서로 다른 값 2개는 그대로 통과한다', () => {
    const r = validateElements([
      { type: 'keyword', value: '무직자' },
      { type: 'keyword', value: '당일' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('거부되면 안 된다');
    expect(r.elements).toHaveLength(2);
  });
});

describe('★ 0818 Codex 정정 — 로그 표본에 개인정보를 남기지 않는다', () => {
  it('4자리 이상 숫자열을 가린다', () => {
    const masked = maskSample('01052958517 님 주문 20260818001 확인');
    expect(masked).not.toContain('01052958517');
    expect(masked).not.toContain('20260818001');
    expect(masked).toContain('님 주문');
  });

  it('짧은 숫자는 그대로 둔다 — 문맥이 사라지면 추적을 못 한다', () => {
    expect(maskSample('3만원 할인')).toContain('3만원');
  });
});
