/**
 * C134 S3 — 합성 회사 여정 세트(서버가 만들고 켠다) · 계약 시험(★ 2026-11-15)
 *   (설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §12 · 실 PG 판 = journey-selfcheck-set-1115.pg.test.ts)
 *
 * 1. 세트 표 ↔ 시작 종류 등록부 — 만들 수 있는 시작 종류 전부가 「넣음」 또는 「뺌(사유)」에 있다(등록부에서 기계로 · 새 종류 = 빨간불).
 * 2. 세트 글 — 혜택 · 링크 · 채울 자리 0 · 변수는 고객명 하나 · LMS 는 제목 · SMS 는 광고 표기가 붙어도 한 통에 든다.
 * 3. 세트 정의 지문 ↔ 판 번호 — 글이나 칸을 고치고 판 번호를 안 올리면 빨간불(판을 안 올리면 차단된 초안이 옛 글로 남는다).
 * 4. 워커는 여정을 지우지 않는다(소스 계약 · 설계 Codex 2R #1) · 통과 표식을 찍는 문장은 CT 한 곳.
 * 5. 순수 판정의 값 범위(검증 결과 → 다음 시도 · 대상 회사 · 때).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  SELFCHECK_SET, SELFCHECK_SET_EXCLUDED, setJourneyName, setDefFingerprint, setCompanyIds, classifyValidation, inSetWindow,
  SET_CAP, MAX_VALIDATIONS, RETRY_SOON_MINUTES, RAISE_REV_SQL, LINK_SQL, CLAIM_CREATE_SQL, CLAIM_VALIDATION_SQL, LOCK_ROW_SQL, type SetDef,
} from '../journey-selfcheck-set';
import { TRIGGER_CONTRACTS, isCreatableTriggerEvent, reentryFloorDays } from '../journey-trigger-capability';

const SRC = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

describe('세트 표 ↔ 시작 종류 등록부(기계 추출)', () => {
  const creatable = TRIGGER_CONTRACTS.filter((c) => isCreatableTriggerEvent(c.event)).map((c) => c.event);
  const inSet = SELFCHECK_SET.map((d) => d.triggerEvent);
  const excluded = Object.keys(SELFCHECK_SET_EXCLUDED);

  it('만들 수 있는 시작 종류 전부가 「넣음」 또는 「뺌(사유)」에 있다 · 둘 다에 있는 것 0', () => {
    expect(creatable.length).toBeGreaterThanOrEqual(15);   // 등록부를 못 읽어 빈 채로 통과하지 않게(1115 = 15종)
    expect(creatable.filter((e) => !inSet.includes(e) && !excluded.includes(e))).toEqual([]);
    expect(inSet.filter((e) => excluded.includes(e))).toEqual([]);
    for (const e of excluded) expect(String(SELFCHECK_SET_EXCLUDED[e]).length).toBeGreaterThan(5);
  });
  it('세트의 시작 종류는 전부 만들 수 있는 것이고 세트 키 · 시작 종류가 겹치지 않는다(11개)', () => {
    expect(SELFCHECK_SET).toHaveLength(11);
    expect(inSet.filter((e) => !creatable.includes(e))).toEqual([]);
    expect(new Set(SELFCHECK_SET.map((d) => d.key)).size).toBe(11);
    expect(new Set(inSet).size).toBe(11);
    expect(excluded.filter((e) => !creatable.includes(e))).toEqual([]);   // 뺌 표에 없는 종류를 적어 두지 않는다
  });
  it('다시 받기 값이 계약을 지난다 — 다시 받아야 하는 시작 종류는 켜 두고, 대기 일수는 계약 최솟값 이상', () => {
    for (const d of SELFCHECK_SET) {
      const c = TRIGGER_CONTRACTS.find((x) => x.event === d.triggerEvent)!;
      if (c.reentryRequired) expect(d.allowReentry, d.key).toBe(true);
      if (d.allowReentry) expect(Number(d.reentryCooldownDays), d.key).toBeGreaterThanOrEqual(reentryFloorDays(d.triggerEvent));
    }
  });
  it('포인트 여정의 기준값은 1 이상(0 이면 켜기 관문이 막는다) · 상품 여정은 상품과 문이 있다', () => {
    const points = SELFCHECK_SET.find((d) => d.key === 'points')!;
    expect(Number(points.triggerFilters.points_min)).toBeGreaterThanOrEqual(1);
    const product = SELFCHECK_SET.find((d) => d.key === 'product')!;
    expect(product.triggerFilters.product_keys).toEqual(['SK-101']);
    expect(product.triggerFilters.door).toBe('ledger');
  });
});

describe('세트 글(혜택 · 링크 · 지어낸 값 0 · 변수는 고객명 하나)', () => {
  const steps = SELFCHECK_SET.flatMap((d) => d.steps.map((s, i) => ({ key: `${d.key}#${i + 1}`, ...s })));
  /** EUC-KR 바이트(한글 2 · 그 밖 1) — 세트 글에는 한글 · ASCII 뿐이다(아래 시험이 확인) */
  const bytes = (t: string) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);

  it('문자 칸 14개 = LMS 11 + SMS 3 · 첫 칸은 바로 · 둘째 칸은 기다린 뒤', () => {
    expect(steps).toHaveLength(14);
    expect(steps.filter((s) => s.channel === 'lms')).toHaveLength(11);
    expect(steps.filter((s) => s.channel === 'sms')).toHaveLength(3);
    for (const d of SELFCHECK_SET) {
      expect(d.steps[0].delayHours, d.key).toBe(0);
      expect(d.steps[0].channel, d.key).toBe('lms');
      for (const s of d.steps.slice(1)) expect(s.delayHours, d.key).toBeGreaterThanOrEqual(24);
    }
  });
  it('채울 자리 · 링크 · 숫자(금액 · 할인율 · 날짜) · 고객명 밖의 변수가 없다', () => {
    for (const s of steps) {
      const all = `${s.subject || ''}\n${s.body}`;
      expect(all, s.key).not.toMatch(/[\[\]{}]/);
      expect(all, s.key).not.toMatch(/https?:|www\.|\.com|\.kr/i);
      expect(all, s.key).not.toMatch(/[0-9]/);
      expect((s.body.match(/%[^%\s]+%/g) || []).filter((v) => v !== '%고객명%'), s.key).toEqual([]);
      expect(s.subject || '', s.key).not.toContain('%');   // 제목은 글자 그대로 나간다
      expect(all, s.key).not.toMatch(/할인|쿠폰|적립|무료|증정|사은품|이벤트|특가|혜택/);
    }
  });
  it('LMS 는 제목이 있고 SMS 는 없다 · SMS 본문은 이름 다섯 글자를 넣어도 50바이트 안(광고 표기 · 수신거부가 붙어도 한 통)', () => {
    for (const s of steps) {
      if (s.channel === 'lms') expect((s.subject || '').trim().length, s.key).toBeGreaterThan(0);
      else {
        expect(s.subject, s.key).toBeUndefined();
        expect(bytes(s.body.replace('%고객명%', '가나다라마')), s.key).toBeLessThanOrEqual(50);
      }
      expect(s.body.trim().length, s.key).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('세트 정의 지문 ↔ 판 번호', () => {
  // 글 · 칸 · 시작 조건을 고치면 그 행의 판 번호를 올리고 이 표의 지문을 새 값으로 바꾼다.
  //   판을 안 올리면: 이미 만든 초안이 옛 글로 남고(스팸 검사에 걸린 글이면 영영 안 켜진다) 워커는 새 글을 쓰지 않는다.
  const PINNED: Record<string, [rev: number, fingerprint: string]> = {
    signup: [1, '84b933fc6a'],
    first_purchase: [1, '82438cd039'],
    purchase: [1, '9d644f69c9'],
    product: [1, '1f64d58d87'],
    dormant: [1, 'ad6eab53ce'],
    dormant_return: [1, 'acd9c7ed87'],
    cycle_lapsed: [1, '29b9bff511'],
    birthday: [1, 'ad7f9c9c2c'],
    points: [1, '9d63bd17b5'],
    cart: [1, 'cd49355000'],
    browse: [1, '9b706625d2'],
  };
  it('행마다 (판 번호 · 지문)이 고정한 값과 같다', () => {
    const now = Object.fromEntries(SELFCHECK_SET.map((d) => [d.key, [d.rev, setDefFingerprint(d)]]));
    expect(now).toEqual(PINNED);
  });
  it('지문은 글 · 제목 · 기다림 · 채널 · 시작 조건 · 다시 받기 값마다 달라지고 판 번호 · 이름에는 안 달라진다', () => {
    const base: SetDef = JSON.parse(JSON.stringify(SELFCHECK_SET[0]));
    const fp = setDefFingerprint(base);
    const changed: Array<(d: SetDef) => void> = [
      (d) => { d.steps[0].body += ' '; },
      (d) => { d.steps[0].subject = '다른 제목'; },
      (d) => { d.steps[1].delayHours += 1; },
      (d) => { d.steps[1].channel = 'lms'; },
      (d) => { d.triggerFilters = { ...d.triggerFilters, recent_hours: 48 }; },
      (d) => { d.allowReentry = !d.allowReentry; },
      (d) => { d.reentryCooldownDays = 99; },
      (d) => { d.triggerEvent = 'purchase.first'; },
      (d) => { d.steps.pop(); },
    ];
    for (const [i, change] of changed.entries()) {
      const d: SetDef = JSON.parse(JSON.stringify(base));
      change(d);
      expect(setDefFingerprint(d), `바꿈 ${i}`).not.toBe(fp);
    }
    expect(setDefFingerprint({ ...base, rev: 9, label: '다른 이름' })).toBe(fp);
  });
  it('이름 = 「자동 점검 · 이름」 · 판이 2 이상이면 끝에 (판 N)', () => {
    expect(setJourneyName(SELFCHECK_SET[0])).toBe('자동 점검 · 신규 가입');
    expect(setJourneyName({ ...SELFCHECK_SET[0], rev: 2 })).toBe('자동 점검 · 신규 가입 (판 2)');
    expect(new Set(SELFCHECK_SET.map(setJourneyName)).size).toBe(11);
  });
});

describe('소스 계약', () => {
  const worker = read('utils/journey-selfcheck-set.ts');
  /** 주석을 뺀 글(계약은 실행되는 글만 본다) */
  const code = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('워커는 여정을 지우지 않는다 — 지우는 함수를 들이지 않고 지우는 문장을 쓰지 않는다', () => {
    expect(code).not.toMatch(/\bdeleteJourney\b/);
    expect(code).not.toMatch(/\bdeleteJourneyStep\b/);
    expect(code).not.toMatch(/DELETE\s+FROM/i);
    expect(code).not.toMatch(/\b(pauseJourney|endJourney|archiveJourney)\b/);   // 멈추기 · 끝내기 · 보관도 워커의 일이 아니다
  });
  it('워커가 직접 쓰는 표는 자기 원장 하나 — journeys · journey_steps 에 쓰는 문장이 없다', () => {
    const writes = [...code.matchAll(/\b(UPDATE|INSERT\s+INTO)\s+([a-z_]+)/gi)].map((m) => m[2].toLowerCase());
    expect(writes.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(writes)]).toEqual(['journey_selfcheck_set']);
  });
  it('통과 표식을 찍는 문장은 CT 한 곳(journey-pretest-mark.ts)뿐이다 — 운영 코드 전 파일에서 뽑는다', () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
        else if (/\.ts$/.test(e.name) && !/\.(test|sanity)\.ts$/.test(e.name)
          && /SET\s+last_pretest_passed_at\s*=\s*NOW\(\)/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(SRC, p).replace(/\\/g, '/'));
      }
    })(SRC);
    expect(hits.sort()).toEqual(['utils/journey-pretest-mark.ts']);
  });
  it('검증 시도를 잡는 문장이 횟수와 다음 시도 시각을 함께 쓴다(시도 시작이 근거를 남긴다) · 상한 · 때 · 이어진 여정 · 판 조건', () => {
    const q = CLAIM_VALIDATION_SQL.replace(/\s+/g, ' ');
    expect(q).toContain('SET validations = validations + 1, next_validate_at = NOW() + INTERVAL \'1 day\'');
    expect(q).toContain('AND journey_id = $3::uuid');
    expect(q).toContain('AND def_rev = $4::int');
    expect(q).toContain('AND validations < $5::int');
    expect(q).toContain('AND (next_validate_at IS NULL OR next_validate_at <= NOW())');
    expect(q).toContain('RETURNING');
    expect(code.indexOf('CLAIM_VALIDATION_SQL,')).toBeGreaterThan(-1);
    expect(code.indexOf('CLAIM_VALIDATION_SQL,')).toBeLessThan(code.indexOf('pretestAndMark('));   // 잡은 뒤에만 검증
  });
  it('만들기 시도를 잡는 문장이 다음 시도 시각을 먼저 쓴다(만든 뒤 실패가 되풀이돼도 그 행은 하루에 한 번만 만든다) · 잡은 뒤에만 만든다', () => {
    const q = CLAIM_CREATE_SQL.replace(/\s+/g, ' ');
    expect(q).toContain("SET next_validate_at = NOW() + INTERVAL '1 day'");
    expect(q).toContain('AND journey_id IS NULL AND def_rev = $3::int');
    expect(q).toContain('AND (next_validate_at IS NULL OR next_validate_at <= NOW())');
    expect(q).toContain('RETURNING');
    expect(code.indexOf('CLAIM_CREATE_SQL,')).toBeGreaterThan(-1);
    expect(code.indexOf('CLAIM_CREATE_SQL,')).toBeLessThan(code.indexOf('await createSetJourney('));
    expect(code.indexOf('await createSetJourney(')).toBeLessThan(code.indexOf('LINK_SQL,'));   // 다 만든 뒤에만 잇는다
  });
  it('판 올림 = 원장 한 문장(이어진 여정이 없거나 보관 안 한 초안일 때만) · 잇는 문장 = 여정 없음 + 정의 판과 같을 때만', () => {
    const raise = RAISE_REV_SQL.replace(/\s+/g, ' ');
    expect(raise).toContain('SET journey_id = NULL, def_rev = $3::int, validations = 0, next_validate_at = NULL');
    expect(raise).toContain('AND s.def_rev < $3::int');
    expect(raise).toContain("AND (s.journey_id IS NULL OR EXISTS (SELECT 1 FROM journeys j WHERE j.id = s.journey_id AND j.status = 'draft' AND j.archived_at IS NULL))");
    const link = LINK_SQL.replace(/\s+/g, ' ');
    expect(link).toContain('SET journey_id = $3::uuid');
    expect(link).toContain('AND journey_id IS NULL AND def_rev = $4::int');
  });
  it('켜는 마지막 순간 — 원장 행을 잠근 뒤(FOR UPDATE) 이어진 여정 · 판을 다시 확인하고 초안일 때만 켠다 · 판 올림도 같은 잠금 안에서 낸다', () => {
    expect(LOCK_ROW_SQL.replace(/\s+/g, ' ')).toBe('SELECT journey_id, def_rev FROM journey_selfcheck_set WHERE company_id = $1::uuid AND set_key = $2 FOR UPDATE');
    const lock = code.slice(code.indexOf('async function withRowLock'));
    const iBegin = lock.indexOf("await client.query('BEGIN')");
    const iLock = lock.indexOf('client.query(LOCK_ROW_SQL,');
    const iWork = lock.indexOf('await work(client,');
    const iCommit = lock.indexOf("await client.query('COMMIT')");
    expect(iBegin).toBeGreaterThan(-1);
    expect([iBegin < iLock, iLock < iWork, iWork < iCommit]).toEqual([true, true, true]);

    const act = code.slice(code.indexOf('async function activateLinked'), code.indexOf('async function withRowLock'));
    expect(act).toContain('return withRowLock(companyId, def.key, async (client, cur) => {');
    const iCheck = act.indexOf('if (!cur || cur.journeyId !== journeyId || cur.defRev !== def.rev) {');
    const iOn = act.indexOf('await activateJourneysInOrder(');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iOn);
    expect(act.slice(iOn, act.indexOf('});', iOn))).toContain('draftOnly: true,');
    expect(act).toContain('await client.query(REASON_SQL,');                                  // 사유는 잠금을 쥔 연결로(다른 연결이면 자기 잠금을 기다린다)
    expect(act).not.toMatch(/\bnoteReason\(|[^.]query\(/);
    expect(code).toContain('await withRowLock(companyId, def.key, async (client) => (await client.query(RAISE_REV_SQL,');
    expect(code).not.toMatch(/[^.]query\(RAISE_REV_SQL/);                                     // 잠금 없이 판 올림을 내는 자리 0
  });
  it('초안일 때만 = 켜는 함수가 잠근 여정 행의 상태로 판정한다(같은 트랜잭션 · 켜는 문장 앞) · 관문 함수 둘이 그 조건을 넘긴다', () => {
    const jb = read('utils/journey-builder.ts');
    const fn = jb.slice(jb.indexOf('export async function activateJourney('), jb.indexOf('// 활성화 종결 직후 = step snapshot 보존'));
    const iRead = fn.indexOf('FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,\n      [journeyId, companyId],');
    const iGate = fn.indexOf("if (draftOnly && String(prev?.status || '') !== 'draft') {\n      await actClient.query('ROLLBACK');\n      return { ok: false,");
    expect(fn).toContain('  draftOnly: boolean = false,\n): Promise<{');                         // 다섯째 인자 · 안 주면 거짓(종전 그대로)
    const iUpdate = fn.indexOf("UPDATE journeys SET\n      status = 'active',");
    expect(iRead).toBeGreaterThan(-1);
    expect([iRead < iGate, iGate < iUpdate]).toEqual([true, true]);
    expect(fn.slice(fn.indexOf("await actClient.query('BEGIN')"), iGate)).not.toContain("query('COMMIT')");
    const ja = read('utils/journey-activation.ts');
    expect(ja.replace(/\s+/g, ' ')).toContain(
      'const result = opts.draftOnly ? await activateJourney(companyId, journeyId, userId, { requireActiveSource: opts.requireActiveSource, setCap: opts.setCap }, true)'
      + ' : await activateJourney(companyId, journeyId, userId, { requireActiveSource: opts.requireActiveSource, setCap: opts.setCap });');
    const batch = ja.slice(ja.indexOf('export async function activateJourneysInOrder('));
    expect(batch).toContain("if (opts.draftOnly && j.status !== 'draft') {");
    expect(batch.slice(batch.indexOf('await activateJourneyGuarded(companyId, j.id, userId, {'), batch.indexOf('items.push({ journeyId: j.id, name: j.name, result });')))
      .toContain('...(opts.draftOnly ? { draftOnly: true } : {}),');
  });
  it('합성 데이터 워커의 tick 이 세트 tick 을 부른다(합성 회사 목록을 넘긴다)', () => {
    const demo = read('utils/demo-data.ts');
    expect(demo).toMatch(/const \{ journeySetTick \} = await import\('\.\/journey-selfcheck-set'\);\s*\n\s*await journeySetTick\(realism, now\);/);
  });
});

describe('순수 판정의 값 범위', () => {
  const ok = { ok: true, failedSteps: [], totalCost: 0, estimatedWeeklyTriggerCount: 0, confidenceScore: 95 };
  const failed = (...reasons: string[]) => ({ ...ok, ok: false, failedSteps: reasons.map((reason, i) => ({ stepId: `s${i}`, variantId: null, reason: reason as any, details: '' })) });

  it('검증 결과 → 다음 시도', () => {
    expect(classifyValidation({ result: ok, marked: true })).toBe('passed');
    expect(classifyValidation({ result: ok, marked: false })).toBe('soon');                                  // 검증하는 사이 판이 바뀜
    expect(classifyValidation({ result: failed('spam_check_pending'), marked: false })).toBe('soon');
    expect(classifyValidation({ result: failed('spam_check_unavailable'), marked: false })).toBe('tomorrow');
    expect(classifyValidation({ result: failed('spam_check_pending', 'spam_check_unavailable'), marked: false })).toBe('tomorrow');
    for (const r of ['spam_filter_failed', 'copy_issue', 'placeholder_unedited', 'subject_missing', 'variable_mapping_invalid', 'alimtalk_template_unusable']) {
      expect(classifyValidation({ result: failed(r), marked: false }), r).toBe('never');
      expect(classifyValidation({ result: failed('spam_check_pending', r), marked: false }), r).toBe('never');   // 글 문제가 하나라도 있으면 기다려도 안 풀린다
    }
    expect(classifyValidation({ result: failed(), marked: false })).toBe('never');                           // 문자 칸이 없다
    expect(classifyValidation({ result: failed('모르는 사유'), marked: false })).toBe('tomorrow');             // 모르는 사유 = 덜 쓰는 쪽
  });
  it('대상 회사 = 스위치 ENV 에 적힌 uuid 만(비면 0곳)', () => {
    const A = '11111111-1111-4111-8111-111111111111';
    expect(setCompanyIds({})).toEqual(new Set());
    expect(setCompanyIds({ JOURNEY_SELFCHECK_SET_COMPANY_IDS: '' })).toEqual(new Set());
    expect(setCompanyIds({ JOURNEY_SELFCHECK_SET_COMPANY_IDS: ` ${A.toUpperCase()}, 회사, abc ` })).toEqual(new Set([A]));
  });
  it('때 = 09:00 ~ 18:00 KST', () => {
    expect(inSetWindow(new Date('2026-11-16T08:59:59+09:00'))).toBe(false);
    expect(inSetWindow(new Date('2026-11-16T09:00:00+09:00'))).toBe(true);
    expect(inSetWindow(new Date('2026-11-16T17:59:59+09:00'))).toBe(true);
    expect(inSetWindow(new Date('2026-11-16T18:00:00+09:00'))).toBe(false);
  });
  it('상수 — 최대 인원 200 · 검증 시도 5 · 검사 중이면 30분 뒤', () => {
    expect([SET_CAP, MAX_VALIDATIONS, RETRY_SOON_MINUTES]).toEqual([200, 5, 30]);
  });
});
