/**
 * C142 — 그룹웨어 오류접수 4건(등급 순서 · 매일 주기 · 대행 SMS 바이트 · 대행 조회) · 설계서 docs/2026-11-17-c142-staff-tickets-design.md §4
 *
 * A 등급 순서(뿌리 R56 넓힘) — 잠금 사유 한 벌 · 잠금에 unlock · 잠금을 그리는 화면마다 단추 · 창을 여는 자리가 라우트 안
 * B 매일 주기(Q9 해제 · Harold 1117 「경고를 보고 직접 눌러야만」) — 짝 지문 · 판정 값 범위 · 저장 셋 · 질문표
 * C 대행 SMS 바이트(뿌리 R68 길이 축) — 명단 전원 측정 · 문안을 쓰는 모든 자리 = 판정 · 발송 직전 문
 * D 대행 조회(뿌리 R73 넓힘) — 서버 조건 · LIKE escape · 날짜 CT · 상한 + 잘림
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 = 등재한 것만 지킨다 · LESSONS_BACKEND 1014).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { scanSources } from './source-scan';

vi.mock('../messageUtils', async (orig) => ({
  ...(await orig<typeof import('../messageUtils')>()),
  prepareFieldMappings: vi.fn(async () => ({})),
  getOpt080Number: vi.fn(async () => '0801234567'),
}));

import {
  resolveSegmentAvailability, checkSchedulePairing, repeatAckKey, pairFingerprint, readRepeatAck,
  GRADE_ORDER_LOCK_REASON, GRADE_ORDER_UNLOCK, type CompanySegmentFacts,
} from '../automarketing-segment';
import { resolveTriggerAvailability, toAvailabilityMap, type CompanyJourneyFacts } from '../journey-trigger-capability';
import { buildOperatorQuestions, decideOperatorAnswers, type OperatorQuestionFacts } from '../automarketing-interview';
import { measureAgencyMaxSmsBytes, agencySmsBytesOverText } from '../agency-send-preview';
import { SMS_MAX_BYTES } from '../message-byte';

const BACK_SRC = resolve(__dirname, '../..');
const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(resolve(BACK_SRC, rel), 'utf-8');

/** 소스에서 이름 붙은 함수 본문(다음 최상위 선언 전까지) */
function fnBody(src: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`함수 없음: ${name}`);
  const rest = src.slice(m.index + 1);
  const next = /\n(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(|\n(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/.exec(rest);
  return src.slice(m.index, next ? m.index + 1 + next.index : undefined);
}
/** 위치 앞의 가장 가까운 함수 이름 */
function enclosingFn(src: string, at: number): string {
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  let name = '';
  for (let m = re.exec(src); m && m.index < at; m = re.exec(src)) name = m[1];
  return name;
}

const BASE_FACTS: CompanySegmentFacts = {
  hasRecentPurchaseDate: true, hasBirthday: true, hasGradeValues: true, hasGradeOrder: false,
  hasPurchaseCount: true, hasPurchaseAmount: true, hasJoinedAt: true,
};

// ═════════════ A 등급 순서 ═════════════
describe('A 등급 순서 잠금 — 사유 한 벌 · unlock · 단추 · 라우트 안 창', () => {
  it('K-A2 값: 등급 값 있음 · 순서 없음 = vip · grade_up 잠김 + unlock · 순서 있음 = 열림 · 값 없음 = unlock 없음', () => {
    const locked = resolveSegmentAvailability({ ...BASE_FACTS, hasGradeOrder: false });
    for (const k of ['vip', 'grade_up']) {
      const a = locked.find((x) => x.key === k)!;
      expect(a.available).toBe(false);
      expect(a.reason).toBe(GRADE_ORDER_LOCK_REASON);
      expect(a.unlock).toBe(GRADE_ORDER_UNLOCK);
    }
    const open = resolveSegmentAvailability({ ...BASE_FACTS, hasGradeOrder: true });
    for (const k of ['vip', 'grade_up']) expect(open.find((x) => x.key === k)).toMatchObject({ available: true });
    for (const a of open) expect(a.unlock).toBeUndefined();
    const none = resolveSegmentAvailability({ ...BASE_FACTS, hasGradeValues: false, hasGradeOrder: false });
    for (const k of ['vip', 'grade_up']) {
      const a = none.find((x) => x.key === k)!;
      expect(a.available).toBe(false);
      expect(a.unlock).toBeUndefined();
    }
    // 등급과 무관한 잠금(데이터 연동)은 unlock 이 없다 — 풀 단추가 화면에 없으니 단추를 그리면 거짓말
    const noPurchase = resolveSegmentAvailability({ ...BASE_FACTS, hasRecentPurchaseDate: false });
    expect(noPurchase.find((x) => x.key === 'dormant')).toMatchObject({ available: false });
    expect(noPurchase.find((x) => x.key === 'dormant')!.unlock).toBeUndefined();
  });

  it('K-A2 여정: 등급 상승 시작점 = 같은 사유 · unlock · 지도(toAvailabilityMap)가 unlock 을 싣는다', () => {
    const facts = { hasGrade: true, hasGradeOrder: false } as unknown as CompanyJourneyFacts;
    const g = resolveTriggerAvailability(facts).find((x) => x.key === 'grade')!;
    expect(g).toMatchObject({ available: false, reason: GRADE_ORDER_LOCK_REASON, unlock: GRADE_ORDER_UNLOCK });
    expect(toAvailabilityMap(resolveTriggerAvailability(facts)).grade).toMatchObject({ unlock: GRADE_ORDER_UNLOCK });
    const open = toAvailabilityMap(resolveTriggerAvailability({ hasGrade: true, hasGradeOrder: true } as unknown as CompanyJourneyFacts)).grade;
    expect(open.available).toBe(true);
    expect(open.unlock).toBeUndefined();
  });

  it('K-A1 소스: 「등급 순서」 잠금 사유 문장은 상수 한 곳 · 옛 두 벌 문장 0', () => {
    const files = scanSources(BACK_SRC);
    const old = files.filter((f) => /등급 순서를 확인하면 열립니다|등급 순서를 한 번 정해 주시면 열립니다/.test(f.src));
    expect(old.map((f) => f.rel)).toEqual([]);
    const defs = files.filter((f) => f.src.includes("'고객등급 순서를 아직 정하지 않으셨어요."));
    expect(defs.map((f) => f.rel.replace(/\\/g, '/'))).toEqual(['utils/automarketing-segment.ts']);
    // 사유를 쓰는 자리 = unlock 과 짝(같은 줄 · 같은 객체)
    for (const f of files) {
      for (const line of f.src.split('\n')) {
        if (line.includes('reason: GRADE_ORDER_LOCK_REASON')) expect(line, `${f.rel}: ${line.trim()}`).toContain('unlock: GRADE_ORDER_UNLOCK');
      }
    }
  });

  it('K-A5 서버: 잠금 사유를 옮겨 싣는 줄 전수(기계 추출) = 같은 줄에 unlock 도 싣는다(Codex 구현 1R · 지도 잠금 목록이 빠졌던 모양)', () => {
    const SOURCES = /toAvailabilityMap|resolveTriggerAvailability|listSegmentAvailability|resolveSegmentAvailability|availabilityByEvent|flowPlan|lockedTriggers|capOf\(/;
    const COPY = /reason:\s*(?:cap!?|v|a|p|verdict|availability)\??\.reason|reason:\s*cap\s*\?\s*cap!?\.reason/;
    const copies: string[] = [];
    for (const f of scanSources(BACK_SRC)) {
      if (!SOURCES.test(f.src)) continue;
      f.src.split('\n').forEach((line, i) => {
        if (!COPY.test(line)) return;
        copies.push(`${f.rel}:${i + 1}`);
        // 주석을 뺀 코드에 unlock 칸이 있어야 한다(줄 끝 주석의 「unlock」 글자로 통과하지 않게 · 변이 확인 1117)
        const code = line.replace(/\/\/.*$/, '');
        expect(code, `${f.rel}:${i + 1} 잠금 사유를 옮기면서 unlock 을 버린다`).toMatch(/\bunlock:\s/);
      });
    }
    expect(copies.length).toBeGreaterThanOrEqual(10);
  });

  it('K-A3 화면: 등급 순서 창을 그리는 파일 = 라우트 트리 안 · unlock 을 읽는 화면 = 단추를 그린다', () => {
    // App.tsx 에서 import 를 따라간 집합(라우트 트리)
    const reach = new Set<string>();
    const stack = [resolve(FRONT_SRC, 'App.tsx')];
    const resolveImport = (from: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null;
      const base = resolve(dirname(from), spec);
      for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) if (existsSync(c) && /\.tsx?$/.test(c)) return c;
      return null;
    };
    while (stack.length) {
      const f = stack.pop()!;
      if (reach.has(f)) continue;
      reach.add(f);
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const r = resolveImport(f, m[1] || m[2]);
        if (r) stack.push(r);
      }
    }
    const front = scanSources(FRONT_SRC).filter((f) => f.path.endsWith('.tsx'));
    const modalUsers = front.filter((f) => /<GradeOrderModal\b/.test(f.src));
    expect(modalUsers.length).toBeGreaterThanOrEqual(4);   // 자동마케팅 쪽 · 대상 고르기 · 여정 · 여정 지도
    for (const f of modalUsers) expect(reach.has(f.path), `라우트 밖 = ${f.rel}`).toBe(true);
    // 잠금의 unlock 을 읽는 화면 파일 = 단추(GradeOrderUnlockButton) 또는 단추 이름 상수(칩 lockedAction)를 쓴다
    const readers = front.filter((f) => /unlock\s*===\s*'grade_order'|\.unlock\s*\?|u\s*===\s*'grade_order'/.test(f.src));
    expect(readers.length).toBeGreaterThanOrEqual(5);
    for (const f of readers) expect(/GradeOrderUnlockButton|GRADE_ORDER_UNLOCK_LABEL/.test(f.src), f.rel).toBe(true);
    // ★ Codex 구현 1R — 잠금 모양(시작 사건 잠금 목록 · 빈 자리 · 막힌 목록 · 흐름 계획 잠긴 칸 · 대상 축 · 막힘 창 · 붙이기 점검)을 그리는 화면 전수(기계 추출)
    //   = 단추를 그리거나, 등급 순서 잠금이 올 수 없는 다른 잠금이다(이유 적은 목록 · 늘리면 그 줄에 이유)
    const LOCK_SHAPE = /lockedTriggers|data\.ghosts|\.blocked\.map|capability\?\.reason|status === 'locked'|lockedReason|SegmentAvailability|blockUnlock|AttachCheckRow/;
    const NOT_GRADE: Record<string, string> = {
      'components/journey/InfoAlertJourneyBuilder.tsx': '정보 알림 시작 사건(예약 · 배송 등) = 등급 시작점이 없다',
      'components/journey/map/ProductJourneyModal.tsx': '상품 목록 잠금(문 연동) = 등급 순서와 무관',
      'components/planner/PlannerConfirmView.tsx': '플래너 발송의 보류 상태(locked = 크레딧) = 잠금 사유가 아니다',
      'pages/PlannerEventDetailPage.tsx': '플래너 발송의 보류 상태 = 잠금 사유가 아니다',
      'pages/AiLinePage.tsx': '매장 미배정 막힘(blockedReason) = 등급 순서와 무관',
    };
    const lockRenderers = front.filter((f) => LOCK_SHAPE.test(f.src)).map((f) => ({ rel: f.rel.replace(/\\/g, '/'), src: f.src }));
    expect(lockRenderers.length).toBeGreaterThanOrEqual(10);
    for (const f of lockRenderers) {
      if (NOT_GRADE[f.rel]) continue;
      expect(/GradeOrderUnlockButton|GRADE_ORDER_UNLOCK_LABEL|lockedAction/.test(f.src), `잠금을 그리는데 등급 순서 단추가 없다 = ${f.rel}`).toBe(true);
    }
    // 쓰이지 않던 옛 고객 화면(단추가 있는 줄 알게 만든 파일)은 없다
    expect(existsSync(resolve(FRONT_SRC, 'pages/CustomersTab.tsx'))).toBe(false);
  });
});

// ═════════════ B 매일 주기 ═════════════
describe('B 반복 짝(매일 · 매주 + 상태 조건) — 명시 선택 + 지문', () => {
  const ALL = { segmentKey: 'all' };
  it('K-B1 값 범위: 주기 × 대상 × ack', () => {
    const repeating = ['all', 'dormant', 'recent_buyers', 'vip', 'new_customers'];
    const change = ['birthday', 'grade_up', 'first_purchase', 'returned', 'went_quiet', 'spent_more'];
    for (const schedule of ['daily', 'weekly']) {
      for (const k of repeating) {
        const t = { segmentKey: k };
        const key = repeatAckKey(schedule, t)!;
        expect(key, `${schedule} ${k}`).toMatch(/^(day|week):[0-9a-f]{16}$/);
        const blocked = checkSchedulePairing(schedule, t);
        expect(blocked.ok).toBe(false);
        if (!blocked.ok) {
          expect(blocked.ackKey).toBe(key);
          expect(blocked.reason).toContain(`지금 대상에게 ${schedule === 'daily' ? '매일' : '매주'} 보내기`);
        }
        const ok = checkSchedulePairing(schedule, t, key);
        expect(ok).toEqual({ ok: true, repeatNotice: expect.stringContaining('같은 고객이') });
        // 다른 주기의 지문 · 다른 대상의 지문 = 막힘
        expect(checkSchedulePairing(schedule, t, repeatAckKey(schedule === 'daily' ? 'weekly' : 'daily', t)).ok).toBe(false);
        expect(checkSchedulePairing(schedule, t, repeatAckKey(schedule, { segmentKey: k === 'all' ? 'dormant' : 'all' })).ok).toBe(false);
      }
      for (const k of change) {
        expect(repeatAckKey(schedule, { segmentKey: k })).toBe(null);
        expect(checkSchedulePairing(schedule, { segmentKey: k })).toEqual({ ok: true });
      }
    }
    for (const schedule of ['monthly', 'yearly', null]) {
      expect(repeatAckKey(schedule, ALL)).toBe(null);
      expect(checkSchedulePairing(schedule, ALL)).toEqual({ ok: true });
    }
    // 칸 조건 = 반복 · 조건 없음 = 반복 아님
    expect(repeatAckKey('daily', { conditions: [{ field: 'grade', operator: 'eq', value: 'VIP' }] })).toMatch(/^day:/);
    expect(repeatAckKey('daily', { conditions: [] })).toBe(null);
  });

  it('K-B1 지문 = 기준 숫자 · 칸 조건 값이 바뀌면 다르다 · 말(term) · 순서는 무관 (Codex 설계 1R #1)', () => {
    expect(repeatAckKey('daily', { segmentKey: 'dormant', segmentParams: { days: 90 } }))
      .not.toBe(repeatAckKey('daily', { segmentKey: 'dormant', segmentParams: { days: 30 } }));
    const c1 = [{ field: 'total_purchase_amount', operator: 'gte', value: 1000000, term: '큰손' }, { field: 'grade', operator: 'eq', value: 'VIP', term: 'VIP' }];
    const c2 = [{ field: 'grade', operator: 'eq', value: 'VIP', term: '우수' }, { field: 'total_purchase_amount', operator: 'gte', value: 1000000, term: '고액' }];
    const c3 = [{ field: 'grade', operator: 'eq', value: 'VIP' }, { field: 'total_purchase_amount', operator: 'gte', value: 10000 }];
    expect(repeatAckKey('daily', { conditions: c1 })).toBe(repeatAckKey('daily', { conditions: c2 }));
    expect(repeatAckKey('daily', { conditions: c1 })).not.toBe(repeatAckKey('daily', { conditions: c3 }));
    // 바뀜 판정(저장 경로)도 같은 정체
    expect(pairFingerprint('daily', { segmentKey: 'dormant', segmentParams: { days: 90 } }))
      .not.toBe(pairFingerprint('daily', { segmentKey: 'dormant', segmentParams: { days: 30 } }));
    expect(pairFingerprint('monthly', ALL)).not.toBe(pairFingerprint('daily', ALL));
    // 밖에서 온 값은 지문 모양만
    expect(readRepeatAck('day:0123456789abcdef')).toBe('day:0123456789abcdef');
    for (const bad of ['', 'month:0123456789abcdef', 'day:XYZ', 'day:0123456789abcdef0', 1, null, undefined, {}]) expect(readRepeatAck(bad)).toBe(null);
  });

  it('K-A4 제안 = 열린 축만(잠긴 「등급이 오른 고객」을 가리키지 않는다)', () => {
    const vipDaily = (avail?: (k: any) => boolean) => checkSchedulePairing('daily', { segmentKey: 'vip' }, null, avail);
    const closed = vipDaily(() => false);
    const open = vipDaily(() => true);
    const unknown = vipDaily();
    expect(!closed.ok && closed.suggestKey).toBe(null);
    expect(!closed.ok && closed.reason).not.toContain('등급이 오른 고객');
    expect(!open.ok && open.suggestKey).toBe('grade_up');
    expect(!unknown.ok && unknown.suggestKey).toBe(null);
  });

  const qFacts = (over: Partial<OperatorQuestionFacts>): OperatorQuestionFacts => ({
    translation: { kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: false },
    axes: [], everyoneCount: null, schedule: 'daily', benefitAsk: null, callbackCandidates: null, adminPhoneMissing: false, ...over,
  });

  it('K-B4 질문표 ③: 「지금 대상에게 매일 보내기」 열림(값 = 지문) · 제안 = 열린 축만 · 같은 지문이면 다시 묻지 않음', () => {
    const qs = buildOperatorQuestions(qFacts({ availableKeys: [] }));
    const q3 = qs.find((q) => q.id === 'schedule')!;
    expect(q3).toBeTruthy();
    const keep = q3.options!.find((o) => o.value.startsWith('keep:'))!;
    expect(keep.disabled).toBeFalsy();
    expect(keep.value).toBe(`keep:${repeatAckKey('daily', { segmentKey: 'vip', segmentParams: {} })}`);
    expect(q3.options!.some((o) => o.value === 'axis:grade_up')).toBe(false);   // 잠긴 축 제안 0
    const withOpen = buildOperatorQuestions(qFacts({ availableKeys: ['grade_up'] })).find((q) => q.id === 'schedule')!;
    expect(withOpen.options!.some((o) => o.value === 'axis:grade_up')).toBe(true);
    // 답 = 그 지문 · 모양이 틀리면 거절
    const d = decideOperatorAnswers(qs, { schedule: keep.value });
    expect(d.ok && d.patch.repeatAck).toBe(keep.value.slice('keep:'.length));
    // 보관본에 지문이 있으면 ③ 을 다시 묻지 않는다
    const again = buildOperatorQuestions(qFacts({ availableKeys: [], repeatAck: keep.value.slice(5) }));
    expect(again.some((q) => q.id === 'schedule')).toBe(false);
  });

  it('K-B4 질문표 ②: 반복 짝도 축 그대로 고른다(옛 「· 매월로 보내요」 주기 바꾸기 0) · 잠긴 축 = unlock', () => {
    const qs = buildOperatorQuestions(qFacts({
      translation: { kind: 'blocked', code: 'NO_CONDITION', reason: '' },
      axes: [
        { key: 'dormant', label: '휴면 고객', available: true, reason: '' },
        { key: 'vip', label: '상위 등급 고객', available: false, reason: GRADE_ORDER_LOCK_REASON, unlock: GRADE_ORDER_UNLOCK },
      ],
    }));
    const q2 = qs.find((q) => q.id === 'audience')!;
    expect(q2.options!.some((o) => o.value.includes('|monthly'))).toBe(false);
    expect(q2.options!.find((o) => o.value === 'axis:dormant')).toMatchObject({ desc: expect.stringContaining('같은 고객이 매일') });
    expect(q2.options!.find((o) => o.value === 'axis:vip')).toMatchObject({ disabled: true, unlock: GRADE_ORDER_UNLOCK });
  });

  it('K-B2 소스: checkSchedulePairing 을 부르는 모든 자리 = ack 를 넘긴다(반복 여부만 보는 자리 = 이유 적은 목록)', () => {
    const REPEAT_ONLY: Record<string, string> = {
      'utils/automarketing-interview.ts#axisOption': '② 보기 설명에 경고를 붙일지만 본다(고른 뒤 ③ 이 묻는다)',
      'utils/continuous-operator.ts#pairingReason': '저장 경로의 막힘 사유 문장만 만든다(판정은 lockAndCheckPairing 의 지문 비교)',
    };
    const seen: string[] = [];
    for (const f of scanSources(BACK_SRC)) {
      const rel = f.rel.replace(/\\/g, '/');
      if (rel === 'utils/automarketing-segment.ts') continue;   // 정의
      for (const m of f.src.matchAll(/checkSchedulePairing\(/g)) {
        const at = m.index!;
        const fn = enclosingFn(f.src, at);
        const call = f.src.slice(at, f.src.indexOf(';', at));
        if (/^checkSchedulePairing\(\s*\)|typeof checkSchedulePairing/.test(call)) continue;
        const key = `${rel}#${fn}`;
        seen.push(key);
        const args = call.slice('checkSchedulePairing('.length);
        const depth0Commas = [...args].reduce((acc, ch, i, arr) => {
          const before = arr.slice(0, i).join('');
          const open = (before.match(/[({[]/g) || []).length - (before.match(/[)}\]]/g) || []).length;
          return acc + (ch === ',' && open === 0 ? 1 : 0);
        }, 0);
        if (REPEAT_ONLY[key]) continue;
        expect(depth0Commas, `${key} 가 ack 를 넘기지 않는다: ${call.slice(0, 160)}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(6);
  });

  it('K-B3 소스: 저장 셋 = 반복 동의를 승인 기록에 같은 트랜잭션에서 쓴다 · 요청 동의가 바뀜 판정보다 먼저', () => {
    const op = read('utils/continuous-operator.ts');
    const lock = fnBody(op, 'lockAndCheckPairing');
    expect(lock.indexOf('if (ack)')).toBeGreaterThan(0);
    expect(lock.indexOf('if (ack)')).toBeLessThan(lock.indexOf("when === 'always' || changed"));
    expect(lock).toMatch(/pairFingerprint\(schedule, target\)/);
    expect(fnBody(op, 'updateOperator')).toMatch(/writeRepeatAck\(run, operatorId, checked\.repeatAck\)/);
    expect(fnBody(op, 'approveOperatorWindow')).toMatch(/repeatAck: checked\.repeatAck/);
    const create = fnBody(op, 'registerOperator');
    expect(create).toMatch(/checkSchedulePairing\(schedule, pairTarget, readRepeatAck\(input\.repeatAck\)\)/);
    expect(create).toMatch(/repeatAck: acceptedRepeatAck/);
  });
});

// ═════════════ C 대행 SMS 바이트 ═════════════
describe('C 대행 SMS 길이 — 명단 전원 · 문안을 쓰는 모든 자리 · 발송 직전', () => {
  it('K-C2 값: 표본 밖 최장 반례를 잡는다(옛 상위 5명 표본이 놓치던 모양)', async () => {
    const content = '%이름%님 쿠폰 %쿠폰%';
    // 원래 값 점수(바이트 × 등장 수)가 높지만 이름 칸은 앞뒤 공백을 지워 실제 문장은 짧은 여섯 줄
    const padded = Array.from({ length: 6 }, () => ({ vars: { 이름: ' '.repeat(120), 쿠폰: '' } }));
    // 점수는 낮지만 실제로 가장 긴 문장(쿠폰 칸은 그대로 나간다)
    const longest = { vars: { 이름: '', 쿠폰: 'X'.repeat(100) } };
    const bytes = await measureAgencyMaxSmsBytes({ companyId: 'c', userId: null, content, isAd: false, adText: false, recipients: [...padded, longest] });
    expect(bytes).toBeGreaterThan(SMS_MAX_BYTES);
    expect(bytes).toBeGreaterThanOrEqual(100);
    const short = await measureAgencyMaxSmsBytes({ companyId: 'c', userId: null, content, isAd: false, adText: false, recipients: padded });
    expect(short).toBeLessThanOrEqual(SMS_MAX_BYTES);
    // 광고 표기 + 080 이 붙으면 그만큼 길다(실제 발송과 같은 조립)
    const ad = await measureAgencyMaxSmsBytes({ companyId: 'c', userId: null, content: '안내', isAd: true, adText: true, recipients: [] });
    const plain = await measureAgencyMaxSmsBytes({ companyId: 'c', userId: null, content: '안내', isAd: false, adText: false, recipients: [] });
    expect(ad).toBeGreaterThan(plain);
    expect(agencySmsBytesOverText(91)).toContain('91바이트');
    expect(agencySmsBytesOverText(91)).not.toMatch(/[·—]/);
  });

  it('K-C1 소스: 대행 표의 문안을 쓰는 자리 전수(기계 추출) = 그 자리의 판정이 있다', () => {
    const GUARD: Record<string, RegExp> = {
      'utils/agency-send-change.ts#editAgencyContentTx': /agencySmsBytesOver\(row, body\)/,
      // ★ 2026-11-24 그대로 보내기 = 표식의 보낼 글을 쓴다 · 쓰기 전에 같은 판정
      // ★ 2026-11-27 C167-C 한 트랜잭션 승인으로 바꿔 씀 · 같은 판정(표식 글 = pre.text)
      'utils/agency-send-change.ts#overrideSpamBlockTx': /agencySmsBytesOver\(row, (String\()?pre\.text/,
      'utils/agency-send-intake.ts#createRequestCore': /measureAgencyMaxSmsBytes\(/,
      // 검사 결과 저장 = runSpamRound 가 낸 글(원문 · 이어 본 글 · 다듬은 글)만 · 그 셋을 runSpamRound 가 잰다(아래)
      'utils/agency-send-worker.ts#saveTestResult': /UPDATE agency_send_requests/,
    };
    const writers: string[] = [];
    for (const f of scanSources(BACK_SRC)) {
      const rel = f.rel.replace(/\\/g, '/');
      for (const m of f.src.matchAll(/INSERT INTO agency_send_requests\b|UPDATE agency_send_requests\s+SET[^`]*?\bcurrent_content\s*=/g)) {
        const fn = enclosingFn(f.src, m.index!);
        const key = `${rel}#${fn}`;
        writers.push(key);
        expect(GUARD[key], `분류 없는 문안 쓰기 = ${key}`).toBeTruthy();
        expect(fnBody(f.src, fn)).toMatch(GUARD[key]);
      }
    }
    expect(new Set(writers)).toEqual(new Set(Object.keys(GUARD)));
    const worker = read('utils/agency-send-worker.ts');
    const round = fnBody(worker, 'runSpamRound');
    expect((round.match(/agencySmsBytesOver\(/g) || []).length).toBeGreaterThanOrEqual(3);   // 원문 · 이어 본 글 · 다듬은 글
    expect(round.indexOf('agencySmsBytesOver(row, original)')).toBeLessThan(round.indexOf('autoSpamTestWithRegenerate('));
    const dispatch = fnBody(worker, 'dispatchAttempt');
    expect(dispatch.indexOf('agencySmsBytesOver(row, content)')).toBeGreaterThan(0);
    expect(dispatch.indexOf('agencySmsBytesOver(row, content)')).toBeLessThan(dispatch.indexOf('INSERT INTO campaign_send_staging'));
    // 표본 고르기는 없다(옛 상위 5명)
    expect(read('utils/agency-send-preview.ts')).not.toMatch(/slice\(0, 5\)/);
  });
});

// ═════════════ D 대행 조회 ═════════════
describe('D 대행 조회 — 서버 조건 · escape · 날짜 CT · 상한 + 잘림', () => {
  it('K-D1 소스', () => {
    const admin = read('routes/admin.ts');
    const list = admin.slice(admin.indexOf("router.get('/agency-send', authenticate"), admin.indexOf("router.get('/agency-send/:id/preview'"));
    expect(list).toMatch(/likePattern\(/);
    expect(list).toMatch(/buildDateRangeFilter\(dateCol/);
    expect(list).toMatch(/LIMIT \$\{AGENCY_LEDGER_LIMIT \+ 1\}/);
    expect(list).toMatch(/truncated/);
    // 옛 화면 검색 칸 전부(고객사 · 신청자 이름 · 아이디 · 파일명 · 문안)
    for (const col of ['c.company_name', 'u.name', 'u.login_id', 'a.file_name', 'a.current_content']) expect(list).toContain(`${col} ILIKE`);
    const intake = fnBody(read('utils/agency-send-intake.ts'), 'readRecentRejectedIntakes');
    expect(intake).toMatch(/likePattern\(filter\?\.q\)/);
    expect(intake).toMatch(/buildDateRangeFilter\('i\.claimed_at'/);
    expect(intake).toMatch(/REJECTED_FILTER_LIMIT \+ 1/);
    // 화면은 더 이상 받은 200건 안에서 거르지 않는다
    const panel = readFileSync(resolve(FRONT_SRC, 'components/admin/AgencySendLedgerPanel.tsx'), 'utf-8');
    expect(panel).not.toMatch(/content_preview\]\s*\n?\s*\.some/);
    expect(panel).toMatch(/qs\.set\('q'/);
  });
});
