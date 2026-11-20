/**
 * 그룹웨어 오류접수 넷 + AI 한줄로 접수 계약(★ 2026-11-20 · 설계서 docs/2026-11-20-staff-tickets-four-design.md §4)
 *
 * 못 박는 뿌리:
 *   R100 반복 날짜 조건의 상대 기준(days_passed · 회사 날짜 칸 days_*) · 회차마다 그날(KST) 기준
 *   R101 조건 모양 판정 한 곳(filterConditionIssues) · 표 밖 기준 = 0건 · 쓰는 자리 · 실행 자리 전수
 *   R102 AI 문자 글 꼴 정리 한 곳(tidyAiSmsLayout) · 출구 셋 · 링크 목적지 보존
 *   R33(넓힘) 혜택 칸 답으로 자리표 채우기 + 조사 · 판정 무변경 · 길이 = 실제 합성 글
 *   R1 칸 고른 뒤 기준 = 서버 한 곳(D3) · 조건 문구 한 벌(D9) · 날짜 프리셋 · 글 한 곳
 *   개선 E1 · E2-1 · E2-2
 * 표본 값은 실제 함수 실측(1120)에서 옮겼다. 변이 결과 = 설계서 §10.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  buildCustomerFilter, buildFilterWhereClauseCompat, filterConditionIssues, filterConditionIssueMessage,
  FILTER_OPERATOR_TEXT, MIXED_BASE_WHERE_KEYS, RECURRING_RELATIVE_DATE_RULE,
} from '../customer-filter';
import { conditionForPick, pickLockReason } from '../audience-condition';
import { tidyAiSmsLayout } from '../ai-sms-layout';
import { linkSpans, rewriteDropsLinks, textLinks } from '../voice-form-slots';
import { applyBenefitToBody } from '../autosend-policy';
import { BENEFIT_PLACEHOLDER, BENEFIT_VALUE_PLACEHOLDERS, replaceInventedBenefits } from '../copy-benefit-detector';
import { smsAdTotalBytes } from '../sms-ad-bytes';
import { buildAdMessage } from '../messageUtils';
import { eucKrByteLength } from '../message-byte';
import { buildAdMessageFront, calculateSmsBytes } from '../../../../frontend/src/utils/formatDate';
import { buildDynamicFiltersFromSelection, dateFilterValueText } from '../../../../frontend/src/utils/customerFilterBuild';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const read = (rel: string) => readFileSync(join(PKG, rel), 'utf8').replace(/\r\n/g, '\n');
const BE = (rel: string) => read(`backend/src/${rel}`);
const FE = (rel: string) => read(`frontend/src/${rel}`);
/** backend/src 운영 파일(시험 제외) — 경로 = src 기준 */
function backendFiles(): string[] {
  const root = join(PKG, 'backend', 'src');
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(p); continue; }
      if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && !/\.d\.ts$/.test(n)) out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}
const ALL = backendFiles();
const src = (rel: string) => BE(rel);
/** 주석 줄을 뺀 소스(소비처 판정용) */
const code = (rel: string) => src(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

afterEach(() => { vi.useRealTimers(); });

const STD_DATE = 'recent_purchase_date';
const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
const mixed = (f: Record<string, unknown>) => buildFilterWhereClauseCompat(f, 2);
const structured = (f: Record<string, unknown>) =>
  buildCustomerFilter(f, { tableAlias: '', startParamIndex: 2, storeCodeMode: 'subquery', companyIdParamRef: '$1', inputFormat: 'structured' });

// ─────────────────────────────── R100 ───────────────────────────────
describe('R100 상대 날짜 기준 — 회차마다 그날(KST) 기준으로 다시 센다', () => {
  // 2026-11-19 15:30Z = KST 11-20 00:30 → 오늘(KST) − 90 = 2026-08-22 · 14:30Z = KST 11-19 23:30 → 2026-08-21
  const cases: Array<[string, (f: Record<string, unknown>) => { sql: string; params: any[] }, string, string]> = [
    ['mixed 표준', mixed, STD_DATE, '2026-08-22'],
    ['structured 표준', structured, STD_DATE, '2026-08-22'],
    ['mixed 회사 칸', mixed, 'custom_fields.custom_3', '20260822'],
    ['structured 회사 칸', structured, 'custom_3', '20260822'],
  ];
  for (const [name, conv, key, expected] of cases) {
    for (const op of ['days_within', 'days_passed'] as const) {
      it(`${name} · ${op} = SQL · 비교 방향 · KST 경계에서 하루 옮겨짐`, () => {
        at('2026-11-19T15:30:00Z');
        const a = conv({ [key]: { operator: op, value: 90 } });
        expect(a.sql).not.toMatch(/AND FALSE/);
        expect(a.sql).toContain(op === 'days_within' ? '>=' : '<=');
        expect(a.params).toEqual([expected]);
        at('2026-11-19T14:30:00Z');
        const b = conv({ [key]: { operator: op, value: 90 } });
        expect(b.params).toEqual([expected.includes('-') ? '2026-08-21' : '20260821']);
        expect(filterConditionIssues({ [key]: { operator: op, value: 90 } }, { format: conv === mixed ? 'mixed' : 'structured' })).toEqual([]);
      });
    }
    it(`${name} · 일수가 틀리면 0건(2junk)`, () => {
      const r = conv({ [key]: { operator: 'days_passed', value: '2junk' } });
      expect(r.sql).toMatch(/AND FALSE/);
    });
  }
  it('날짜 기준(표의 날짜 키) 전부가 기준 문구 표에 있다 · days_passed 문구 = 「일 이상 지남」', () => {
    for (const k of ['date_gte', 'date_lte', 'days_within', 'days_passed', 'birth_month']) expect(Object.keys(FILTER_OPERATOR_TEXT)).toContain(k);
    expect(FILTER_OPERATOR_TEXT.days_passed).toBe('일 이상 지남');
  });
  // 반복해서 쓰는 조건의 생산자 = 자동마케팅 번역 · 저장 세그먼트 생성(자동발송 창은 2026-05-21 폐기 · 어디서도 그리지 않음 = 생산자 아님 · 설계서 §10)
  it('반복 생산자 지시문 둘에만 상대 기준 규칙 · 한 번 발송 지시(추천 · AI 한줄로)는 글자 무변경', () => {
    const users = ALL.filter((f) => src(f).includes('${RECURRING_RELATIVE_DATE_RULE}'));
    expect(users).toEqual(['services/ai.ts', 'utils/ai-segment-generator.ts']);
    const ai = src('services/ai.ts');
    expect(ai.split('${RECURRING_RELATIVE_DATE_RULE}').length - 1).toBe(1);
    expect(ai).toContain('7. ${RECURRING_RELATIVE_DATE_RULE} unexpressed 에 넣는 날짜 조건도 같은 꼴로 적는다.');   // 자동마케팅 번역 = 늘 반복
    expect(src('utils/ai-segment-generator.ts')).toContain('9. 저장해 두고 다시 세는 조건이다. ${RECURRING_RELATIVE_DATE_RULE}');
    expect(ai).not.toMatch(/options\?\.recurring/);
    expect(RECURRING_RELATIVE_DATE_RULE).toContain('days_passed N');
  });
  it('직접 타겟 날짜 칩 · 값 꼴 · 글 = CT 한 곳(화면 두 파일에 프리셋 · 손 글 0)', () => {
    for (const f of ['components/DirectTargetFilterModal.tsx', 'components/TargetDirectPickPanel.tsx']) {
      const s = FE(f);
      expect([f, /DAYS_PRESETS|days:\s*\d+/.test(s)]).toEqual([f, false]);
      expect([f, s.includes("import DateDayChips from './DateDayChips';")]).toEqual([f, true]);
      expect([f, /`최근 \$\{|일 이내`|이내'/.test(s)]).toEqual([f, false]);
    }
    expect(FE('components/DateDayChips.tsx')).toContain("from '../utils/customerFilterBuild'");
    const fields = [{ field_key: 'last_purchase_date', data_type: 'date' } as any];
    expect(buildDynamicFiltersFromSelection(['last_purchase_date'], { last_purchase_date: 'over:90' }, fields).dynamicFilters)
      .toEqual({ recent_purchase_date: { operator: 'days_passed', value: 90 } });
    expect(buildDynamicFiltersFromSelection(['last_purchase_date'], { last_purchase_date: '30' }, fields).dynamicFilters)
      .toEqual({ recent_purchase_date: { operator: 'days_within', value: 30 } });
    expect(dateFilterValueText('30')).toBe('30일 이내');
    expect(dateFilterValueText('over:90')).toBe('90일 이상 지남');
    expect(dateFilterValueText('month:3')).toBe('3월');
  });
});

// ─────────────────────────────── R101 ───────────────────────────────
describe('R101 조건 모양 판정 한 곳 — 깨진 조건 = 그 조건이 빠진 넓은 대상이 아니다', () => {
  type Row = [string, 'mixed' | 'structured', Record<string, unknown>, 'invalid' | 'empty', 'false' | 'throw-or-false' | 'nosql'];
  const rows: Row[] = [
    ['structured 기본 칸 표 밖 기준', 'structured', { gender: { operator: 'gte', value: 'F' } }, 'invalid', 'false'],
    ['structured 나이 표 밖 기준', 'structured', { age: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['mixed 나이 표 밖 기준', 'mixed', { age: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['structured 숫자 표 밖 기준', 'structured', { points: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['mixed 숫자 표 밖 기준', 'mixed', { points: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['structured 날짜 표 밖 기준', 'structured', { [STD_DATE]: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['mixed 날짜 표 밖 기준', 'mixed', { [STD_DATE]: { operator: 'contains', value: '3' } }, 'invalid', 'false'],
    ['structured 회사 칸 표 밖 기준', 'structured', { custom_3: { operator: 'regex', value: 'x' } }, 'invalid', 'false'],
    ['mixed 회사 칸 표 밖 기준', 'mixed', { 'custom_fields.custom_3': { operator: 'regex', value: 'x' } }, 'invalid', 'false'],
    ['mixed 숫자 틀린 값', 'mixed', { points: { operator: 'gte', value: 'abc' } }, 'invalid', 'throw-or-false'],
    ['structured 나이 틀린 값', 'structured', { age: { operator: 'gte', value: 'abc' } }, 'invalid', 'throw-or-false'],
    ['mixed 날짜 틀린 일수', 'mixed', { [STD_DATE]: { operator: 'days_passed', value: '2junk' } }, 'invalid', 'false'],
    ['mixed 회사 날짜 달력에 없는 날', 'mixed', { 'custom_fields.custom_3': { operator: 'date_gte', value: '2026-02-31' } }, 'invalid', 'throw-or-false'],
    ['mixed 모르는 칸', 'mixed', { zzz_unknown: { operator: 'eq', value: '1' } }, 'invalid', 'nosql'],
    ['structured 모르는 칸', 'structured', { zzz_unknown: { operator: 'eq', value: '1' } }, 'invalid', 'nosql'],
    ['mixed 빈 값', 'mixed', { grade: { operator: 'eq', value: '' } }, 'empty', 'nosql'],
    ['structured 빈 값', 'structured', { grade: { operator: 'eq', value: '' } }, 'empty', 'nosql'],
  ];
  for (const [name, format, filter, reason, shape] of rows) {
    it(`${name} = 판정 CT 가 짚고 변환 결과가 「조건이 빠진 SQL」이 아니다`, () => {
      const key = Object.keys(filter)[0];
      expect(filterConditionIssues(filter, { format })).toEqual([{ field: key, reason }]);
      if (shape === 'nosql') return;   // 모르는 칸 · 빈 값 = 변환 무변경(부르는 쪽이 판정 CT 로 막는다)
      const conv = format === 'mixed' ? mixed : structured;
      let r: { sql: string; params: any[] } | null = null;
      try { r = conv(filter); } catch { r = null; }
      if (shape === 'false') expect(r?.sql).toMatch(/AND FALSE/);
      else expect(r === null || /AND FALSE/.test(r.sql) || r.params.some((p) => p === null || Number.isNaN(p))).toBe(true);
    });
  }
  // ★ 구현 때 발견(설계서 §10) — 허용 표가 받은 기준을 변환기가 0건으로 닫으면 칸을 다시 골라도 같은 기준이 돌아와 막다른 길(R101 = 판정 한 곳)
  it('자동마케팅 허용 표(audience-condition OPS_BY_TYPE · CUSTOM_OPS) = 변환기 표 — 허용한 기준이 변환에서 0건 · 빈 조각이 되지 않는다', () => {
    const t = src('utils/audience-condition.ts');
    const setOf = (re: RegExp) => [...((t.match(re) || [])[1] || '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const OPS: Record<'string' | 'number' | 'date' | 'custom', string[]> = {
      string: setOf(/string: new Set\(\[([^\]]*)\]\)/),
      number: setOf(/number: new Set\(\[([^\]]*)\]\)/),
      date: setOf(/date: new Set\(\[([^\]]*)\]\)/),
      custom: setOf(/const CUSTOM_OPS = new Set\(\[([^\]]*)\]\)/),
    };
    for (const k of Object.keys(OPS) as Array<keyof typeof OPS>) expect([k, OPS[k].length > 0]).toEqual([k, true]);
    const sample = (op: string, kind: keyof typeof OPS): unknown => {
      if (op === 'days_within' || op === 'days_passed') return 30;
      if (op === 'birth_month') return 3;
      if (op === 'between') return kind === 'date' ? ['2026-01-01', '2026-02-01'] : [1, 5];
      if (op === 'in') return ['a', 'b'];
      if (op === 'contains') return 'a';
      if (op === 'date_gte' || op === 'date_lte') return '2026-01-01';
      if (op === 'gte' || op === 'lte') return kind === 'date' ? '2026-01-01' : 5;
      return kind === 'number' ? 5 : 'a';
    };
    const fields: Array<[keyof typeof OPS, string]> = [['string', 'name'], ['number', 'points'], ['date', STD_DATE], ['custom', 'custom_fields.custom_3']];
    for (const [kind, key] of fields) {
      for (const op of OPS[kind]) {
        const r = mixed({ [key]: { operator: op, value: sample(op, kind) } });
        expect([kind, op, /AND FALSE/.test(r.sql) || !r.sql.trim()]).toEqual([kind, op, false]);
      }
    }
  });
  // Codex 구현 1R #1 — 최상위 꼴이 객체가 아니면(배열 · 글자) 변환기가 키를 못 읽어 조건이 통째로 빠진다
  it('최상위 꼴이 객체가 아닌 조건 = 깨진 조건(빈 조건으로 넘기지 않는다) · 없음(null · undefined) = 조건 없음', () => {
    const arr = [{ field: 'grade', operator: 'eq', value: 'VIP' }];
    for (const format of ['mixed', 'structured'] as const) {
      expect(filterConditionIssues(arr, { format })).toEqual([{ field: '', reason: 'invalid' }]);
      expect(filterConditionIssues('grade=VIP', { format })).toEqual([{ field: '', reason: 'invalid' }]);
      expect(filterConditionIssues(null, { format })).toEqual([]);
      expect(filterConditionIssues(undefined, { format })).toEqual([]);
    }
    expect(filterConditionIssueMessage(filterConditionIssues(arr))).toBe('「알 수 없는 칸」 조건을 쓸 수 없어요. 대상 조건을 다시 만들어 주세요.');
    expect(src('utils/saved-segments.ts')).toContain('if (filter === undefined || filter === null) return;');
  });
  it('지금 거절되는 사례는 계속 거절 · mixed 나이 gte 는 이제 옮긴다', () => {
    expect(filterConditionIssues({ gender: { operator: 'gte', value: 'F' }, grade: { operator: 'eq', value: 'VIP' } }, { format: 'structured' }))
      .toEqual([{ field: 'gender', reason: 'invalid' }]);
    const m = mixed({ age: { operator: 'gte', value: 30 } });
    expect(m.sql).toContain('>=');
    expect(m.params).toEqual([30]);
    expect(filterConditionIssues({ age: { operator: 'gte', value: 30 } })).toEqual([]);
  });
  it('판정 밖 키 = 기본 WHERE 가 소유하는 키 한 목록(변환기 SPECIAL_FIELDS 와 같은 목록) · 거절 문구 = 무시', () => {
    expect([...MIXED_BASE_WHERE_KEYS]).toEqual(['phone', 'sms_opt_in']);
    expect(src('utils/customer-filter.ts')).toContain('...MIXED_BASE_WHERE_KEYS,');
    const iss = filterConditionIssues({ phone: { operator: 'contains', value: '010' } });
    expect(iss).toEqual([{ field: 'phone', reason: 'ignored' }]);
    expect(filterConditionIssueMessage(iss)).toBeNull();
    expect(filterConditionIssueMessage([{ field: 'recent_purchase_date', reason: 'invalid' }])).toBe('「최근구매일」 조건을 쓸 수 없어요. 대상 조건을 다시 만들어 주세요.');
  });
  it('조건을 저장하는 쓰는 자리 전수(소스 추출) = 판정 CT 를 부르거나 사유가 적힌 예외', () => {
    const writers = new Set<string>();
    for (const f of ALL) {
      const s = src(f);
      const re = /\b(INSERT INTO|UPDATE)\s+[a-z_]+/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const tail = s.slice(m.index, m.index + 900);
        const stmt = tail.slice(0, Math.max(tail.indexOf('`', 1), 1) > 0 ? tail.indexOf('`', 1) : tail.length);
        if (/\b(target_filter|filter_jsonb)\b/.test(stmt)) writers.add(f);
      }
    }
    const GUARDED: Record<string, RegExp> = {
      'routes/auto-campaigns.ts': /filterConditionIssueMessage\(filterConditionIssues\(target_filter\)\)/,
      'utils/saved-segments.ts': /assertSegmentFilterUsable\(data\.filter\)/,
      'utils/ai-segment-generator.ts': /assertSegmentFilterUsable\(filter\)/,
    };
    const EXEMPT: Record<string, string> = {
      'routes/campaigns.ts': '한 번 발송 · 그 자리에서 변환기가 0건으로 막음(표 밖 기준 = AND FALSE) · 다시 세지 않음',
      'utils/auto-campaign-worker.ts': '자동발송 행을 회차 캠페인으로 복사 · 실행 판정은 발송 갈래에서(아래 시험)',
      'utils/copy-seed-curator.ts': '학습 기록',
      'utils/training-logger.ts': '학습 기록',
    };
    expect([...writers].sort()).toEqual([...Object.keys(GUARDED), ...Object.keys(EXEMPT)].sort());
    for (const [f, re] of Object.entries(GUARDED)) expect([f, re.test(src(f))]).toEqual([f, true]);
    expect(src('routes/auto-campaigns.ts').match(/filterConditionIssueMessage\(filterConditionIssues\(target_filter\)\)/g)?.length).toBe(2);   // 새로 · 수정
    expect(src('utils/saved-segments.ts').match(/assertSegmentFilterUsable\(data\.filter\)/g)?.length).toBe(2);   // 저장 · 수정
  });
  it('자동발송 워커 발송 갈래 = 빈 조건 판정 바로 뒤에 판정 CT · 걸리면 markFailed', () => {
    const w = src('utils/auto-campaign-worker.ts');
    const empty = w.indexOf('if (!filterResult.where.trim()) {');
    const issue = w.indexOf('const conditionIssue = filterConditionIssueMessage(filterConditionIssues(ac.target_filter));');
    expect(empty).toBeGreaterThan(0);
    expect(issue).toBeGreaterThan(empty);
    expect(w.slice(issue, issue + 500)).toContain('await markFailed(ac, `${conditionIssue} 자동발송을 열어 대상 조건을 다시 설정해주세요.`);');
  });
  it('「못 옮김」을 키마다 다시 재는 자리 = 판정 CT 하나 · sql.trim() = 판정 CT + 빈 WHERE 전체 열림 판정 세 자리만', () => {
    const perKey = ALL.filter((f) => /build(FilterWhereClauseCompat|CustomerFilter)\(\{\s*\[/.test(code(f)));
    expect(perKey).toEqual(['utils/customer-filter.ts']);
    const trims = ALL.filter((f) => /\.sql\.trim\(\)/.test(code(f)));
    expect(trims).toEqual(['services/ai-line.ts', 'utils/all-customers-signal.ts', 'utils/customer-filter.ts', 'utils/operator-audience.ts']);   // customer-filter = 판정 CT 자신
    expect(src('services/ai-line.ts')).toContain('if (filterConditionIssues({ [key]: cond }).length === 0) conditions.push(');
    expect(src('utils/audience-condition.ts')).toContain("filterConditionIssues(out).find((i) => i.reason !== 'ignored')");
    expect(src('utils/ai-segment-generator.ts')).toContain("filterConditionIssues(filter, { format: 'structured' })");
  });
});

// ─────────────────────────────── R102 ───────────────────────────────
describe('R102 AI 문자 글 꼴 정리 한 곳', () => {
  const TABLE: Array<[string, string]> = [
    ['[www.invitocorp.com](https://www.invitocorp.com)', 'https://www.invitocorp.com'],
    ['[https://a.example.com/x](https://a.example.com/x)', 'https://a.example.com/x'],
    ['[보러 가기](https://a.example.com/x)', '보러 가기 https://a.example.com/x'],
    ['[b.example.com](https://a.example.com/x)', 'https://a.example.com/x'],
    ['[A.Example.com/Path?q=1](https://A.Example.com/Path?q=1)', 'https://A.Example.com/Path?q=1'],
    ['**굵게** 와 __밑줄__ 그리고 * 주석', '굵게 와 밑줄 그리고 * 주석'],
    ['보기 https://a.example.com/__VIP__/x', '보기 https://a.example.com/__VIP__/x'],
    ['확인해 보세요 ▶\nhttps://a.example.com/e', '확인해 보세요\n▶ https://a.example.com/e'],
    ['알려드려요 ★ 이번 주말', '알려드려요\n★ 이번 주말'],
    ['확인해 보세요 ▶\n다음 안내', '확인해 보세요 ▶\n다음 안내'],   // 다음 줄이 링크로 시작하지 않으면 가리킴 표시를 옮기지 않는다(판정기 기준)
    ['__안내 https://a.example.com/x__ 끝', '__안내 https://a.example.com/x__ 끝'],   // 굵게 짝이 주소 끝 「__」와 맞물림 = 목적지가 바뀌므로 보존 확인이 원문 그대로
    ['__상품 안내 [보기](shop.example.com?file=__sale__.png)__', '상품 안내 보기 shop.example.com?file=__sale__.png'],   // Codex 구현 6R — 닫는 표시 = 덩어리 끝만(「__.png」 은 경계 아님)
    ['**할인**! 이번 주', '**할인**! 이번 주'],   // 닫는 표시 뒤 문장 부호 = 덩어리 안 = 정리 안 함
    ['만족도 ★★★★★ 후기', '만족도 ★★★★★ 후기'],
    ['  줄 머리 공백\n\t탭  겹  공백', '줄 머리 공백\n탭 겹 공백'],
    // Codex 구현 1R #2 — 목적지 안 짝 괄호 · 목적지 뒤에 붙은 글자(조사)는 띄움 · 문장 부호는 그대로
    ['[행사 페이지](https://shop.example.com/event)를 확인하세요', '행사 페이지 https://shop.example.com/event 를 확인하세요'],
    ['[안내](https://shop.example.com/item(v2)/sale)', '안내 https://shop.example.com/item(v2)/sale'],
    ['[https://shop.example.com/e](https://shop.example.com/e). 확인', 'https://shop.example.com/e. 확인'],
    ['본문 \uE301 섞임 [보기](https://a.example.com/x)', '본문 \uE301 섞임 보기 https://a.example.com/x'],
    // Codex 구현 2R — 경계 = 링크 판정기에 묻는다(쉼표 · 굵게 표시가 붙으면 판정기가 주소로 읽으므로 띄움)
    ['[행사](https://shop.example.com/event),혜택도 확인하세요', '행사 https://shop.example.com/event ,혜택도 확인하세요'],
    ['**[상품 보기](https://shop.example.com/event)**', '상품 보기 https://shop.example.com/event'],
    ['**https://a.example.com/x**다음', '**https://a.example.com/x**다음'],
    ['[보기](https://a.example.com/x.)', '보기 https://a.example.com/x.'],   // 목적지 읽기 = textLinks 한 곳(마크다운 목적지도 판정기로 읽음 = 끝 「.」을 뗀 같은 목적지 · Codex 구현 4R)   // 정리하면 판정기가 「x다음」으로 읽음 = 원문 그대로
  ];
  it.each(TABLE)('%j → %j', (input, out) => { expect(tidyAiSmsLayout(input)).toBe(out); });
  it('정리 뒤 목적지(textLinks · 한 곳) = 정리 전 목적지 · 판정기가 읽는 글자 = 그 목적지(덧붙음 · 바뀜 · 빠짐 0)', () => {
    const reads = (t: string) => new Set(linkSpans(t).map((sp) => sp.link));
    for (const [input] of TABLE) {
      const done = tidyAiSmsLayout(input);
      if (done === input) continue;   // 정리하지 않은 글(원문 그대로) = 잃은 목적지 없음
      const after = reads(done);
      for (const h of textLinks(input)) expect([input, h, after.has(h)]).toEqual([input, h, true]);
    }
  });
  // Codex 구현 4R — 목적지 읽기가 둘이면 그 사이로 샌다: 마크다운에 싼 scheme 없는 주소 · 끝 부호도 같은 함수가 읽는다
  it('목적지 읽기(textLinks) = 마크다운 목적지 + 판정기 · 링크를 지운 다시 쓰기는 빠진다', () => {
    expect(textLinks('안내 [보기](shop.example.com/x.)')).toEqual(['shop.example.com/x']);
    expect(textLinks('[보기](https://a.example.com/item(v2)/sale) 와 https://b.example.com/y')).toEqual(['https://a.example.com/item(v2)/sale', 'https://b.example.com/y']);
    expect(rewriteDropsLinks('안내 내용을 자세히 확인해 주세요.', '안내 [보기](shop.example.com/x.)')).toBe(true);
    expect(rewriteDropsLinks(tidyAiSmsLayout('안내 [보기](shop.example.com/x.) 꼭'), '안내 [보기](shop.example.com/x.)')).toBe(false);
    expect(textLinks('그냥 글 https://a.example.com/x.')).toEqual(linkSpans('그냥 글 https://a.example.com/x.').map((sp) => sp.link));   // 마크다운 없는 글 = 옛 읽기 그대로
    // Codex 구현 5R — 판정기가 다 못 읽는 주소(scheme 없는 주소 바로 뒤 ?)도 마크다운 · 맨 글이 같은 읽기 · 굵게 규칙은 덩어리 안 글자를 바꾸지 않는다
    const q = 'shop.example.com?tag=__vip__&next=https://return.example/event';
    expect(tidyAiSmsLayout('[보기](' + q + ')')).toBe('보기 ' + q);
    expect(textLinks('[보기](' + q + ') 확인')).toEqual(textLinks('보기 ' + q + ' 확인'));
    expect(rewriteDropsLinks('보기 shop.example.com?tag=x 확인', '[보기](shop.example.com?tag=x) 확인')).toBe(false);
    expect(tidyAiSmsLayout('**굵게** 안내 ' + q)).toBe('굵게 안내 ' + q);
  });
  it('부르는 자리 = 출구 셋(생성 출구 · 다듬기 · sanitizeForSms)뿐 · 생성 출구에서는 링크 단계 뒤 · 전송자 이름 앞', () => {
    const callers = ALL.filter((f) => f !== 'utils/ai-sms-layout.ts' && /tidyAiSmsLayout\(/.test(code(f)));
    expect(callers).toEqual(['services/ai.ts', 'utils/copy-exit-guards.ts', 'utils/message-sanitizer.ts']);
    const g = src('utils/copy-exit-guards.ts');
    const tidy = g.indexOf("if (channel !== '카카오' && channel !== 'KAKAO') msgField = tidyAiSmsLayout(msgField);");
    expect(tidy).toBeGreaterThan(g.indexOf('const once = ensureOnceLink(msgField, ctx.onceLink);'));
    expect(tidy).toBeGreaterThan(g.indexOf('const linkApplied = applyBrandLinkTokens(msgField, ctx.brandLinks);'));
    expect(tidy).toBeLessThan(g.indexOf('const sender = ensureSenderName(msgField'));
    const ai = src('services/ai.ts');
    const strip = ai.indexOf('    text = stripIncompatibleEmojis(text);');
    const t2 = ai.indexOf('    text = tidyAiSmsLayout(text);');
    expect(strip).toBeGreaterThan(0);
    expect(t2).toBeGreaterThan(strip);
    expect(ai.indexOf('rewriteDropsLinks(text, originalMessage)')).toBeGreaterThan(t2);   // 대조 = 변환 없이 두 글 그대로 · 목적지 읽기 = textLinks 한 곳(Codex 구현 3R · 4R)
    expect(ai).not.toContain('unwrapMarkdownLinks');
    expect(src('utils/message-sanitizer.ts')).toContain('  const text = tidyAiSmsLayout(rawText);');
  });
  // Codex 구현 3R — 다듬기 주소 대조 두 쪽 = 같은 CT · 같은 목적지를 지킨 후보는 빠지지 않는다(원문 그대로 돌아오는 꼴 포함)
  it('다듬기 주소 대조 = 두 쪽 모두 꼴 정리 CT 를 지난 글', () => {
    for (const [orig, cand] of [
      ['[보기](https://a.example.com/x.)를 확인하세요', '[보기](https://a.example.com/x.)를 꼭 확인하세요'],
      ['[행사](https://shop.example.com/event),혜택도 확인하세요', '[행사](https://shop.example.com/event),혜택도 꼭 확인하세요'],
      ['지금 확인해 보세요 ▶\nhttps://a.example.com/e', '이번 주 확인해 보세요 ▶\nhttps://a.example.com/e'],
    ]) {
      const dropped = rewriteDropsLinks(tidyAiSmsLayout(cand), tidyAiSmsLayout(orig));
      expect([orig, dropped]).toEqual([orig, false]);
    }
    expect(rewriteDropsLinks(tidyAiSmsLayout('[보기](https://a.example.com/y)'), tidyAiSmsLayout('[보기](https://a.example.com/x)'))).toBe(true);   // 목적지가 바뀐 후보 = 뺌
  });
  it('sanitizeForSms 소비처 = AI 출력 파일만(허용 목록 · 낡으면 실패)', () => {
    const users = ALL.filter((f) => f !== 'utils/message-sanitizer.ts' && /\bsanitizeForSms\(/.test(code(f)));
    expect(users).toEqual(['utils/journey-ai-editor.ts', 'utils/journey-ai-generator.ts', 'utils/operator-message-decorator.ts', 'utils/variant-generator.ts']);
  });
});

// ─────────────────────────────── R33 ───────────────────────────────
describe('R33(넓힘) 혜택 칸 답으로 자리표 채우기 · 판정 무변경 · 길이 = 실제 합성 글', () => {
  const GROUND = '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘\n[혜택] 30% 할인행사';
  it('판정 무변경 — 반례 셋과 실측 표본이 지금 결과 그대로', () => {
    expect(replaceInventedBenefits('쿠폰은 사용하지 마세요', GROUND)).toBe('쿠폰은 사용하지 마세요');
    expect(replaceInventedBenefits('쿠폰 보내지 마세요', GROUND)).toBe('쿠폰 보내지 마세요');
    expect(replaceInventedBenefits('평균 구매금액은 3만원', GROUND)).toBe(`평균 구매금액은 ${BENEFIT_PLACEHOLDER}`);
    expect(replaceInventedBenefits('30% 할인 쿠폰을 드려요', GROUND)).toBe(`${BENEFIT_PLACEHOLDER}을 드려요`);
    expect(replaceInventedBenefits('30% 할인', GROUND)).toBe('30% 할인');
  });
  it('채우는 자리 = 혜택 값 자리표 목록 둘 · 목록 밖은 그대로', () => {
    expect([...BENEFIT_VALUE_PLACEHOLDERS]).toEqual([BENEFIT_PLACEHOLDER, '[혜택 내용을 입력해주세요]']);
    expect(applyBenefitToBody('[혜택 적용 기한: 직접 입력해주세요]', 'X')).toBe('[혜택 적용 기한: 직접 입력해주세요]');
    expect(applyBenefitToBody('[혜택몰] 오픈', 'X')).toBe('[혜택몰] 오픈');
    expect(applyBenefitToBody(`[혜택몰] ${BENEFIT_PLACEHOLDER}`, '사은품')).toBe('[혜택몰] 사은품');
    expect(applyBenefitToBody('[혜택 내용을 입력해주세요]은 덤', '할인')).toBe('할인은 덤');
    expect(applyBenefitToBody(BENEFIT_PLACEHOLDER, '')).toBe(BENEFIT_PLACEHOLDER);   // 답 없음 = 자리표(발송 길목이 막음)
  });
  it.each([
    [`${BENEFIT_PLACEHOLDER}을 드려요`, '30% 할인행사', '30% 할인행사를 드려요'],
    [`${BENEFIT_PLACEHOLDER}를 드려요`, '사은품', '사은품을 드려요'],
    [`${BENEFIT_PLACEHOLDER}으로 결제`, '쿠폰', '쿠폰으로 결제'],
    [`${BENEFIT_PLACEHOLDER}로 결제`, '적립금', '적립금으로 결제'],   // ㄹ 받침 + 으로 = 로
    [`${BENEFIT_PLACEHOLDER}으로 결제`, '포인트 1000P', '포인트 1000P으로 결제'],   // 한글로 안 끝남 = 그대로
    [`${BENEFIT_PLACEHOLDER}이 기다려요`, '30% OFF', '30% OFF이 기다려요'],
    [`${BENEFIT_PLACEHOLDER} 이번 주만`, '사은품', '사은품 이번 주만'],
    [`${BENEFIT_PLACEHOLDER}이번 주만`, '사은품', '사은품이번 주만'],   // 「이번」 = 조사 아님
    [`${BENEFIT_PLACEHOLDER}와 함께`, '무료배송', '무료배송과 함께'],
    [`${BENEFIT_PLACEHOLDER}과 함께`, '무료배송', '무료배송과 함께'],
  ])('조사 맞춤 %j + %j → %j', (body, benefit, out) => { expect(applyBenefitToBody(body, benefit)).toBe(out); });
  it('혜택 칸 답을 받는 문자 생성 길 = 채우기 CT 를 지난다(generateMessages 부르는 자리 전수)', () => {
    const gens = ALL.filter((f) => f !== 'services/ai.ts' && /\bgenerateMessages\(/.test(code(f)));
    const FILLS: Record<string, string> = {
      'services/ai-line.ts': 'applyBenefitToBody(body, input.facts.benefit)',
      'services/ai-orchestrator.ts': 'm.body = applyBenefitToBody(m.body, ctx.benefitContent);',
      'utils/planner-copy.ts': 'applyBenefitToBody(String(nv.message_text',
      'utils/continuous-operator.ts': '',   // 회차 문안 = 나가는 문안 한 함수(operator-final-copy)가 채움
    };
    const NO_ANSWER: Record<string, string> = {
      'routes/ai.ts': 'AI 캠페인 문안 생성 · 혜택 칸 답 없음(자리표 = 사람이 채움)',
      'utils/auto-campaign-worker.ts': '자동발송 AI 문안 · 혜택 칸 답 없음',
      'utils/proposal-trial.ts': '제안 페이지 체험 · 혜택 칸 답 없음',
    };
    expect(gens).toEqual([...Object.keys(FILLS), ...Object.keys(NO_ANSWER)].sort());
    for (const [f, needle] of Object.entries(FILLS)) if (needle) expect([f, src(f).includes(needle)]).toEqual([f, true]);
    expect(src('utils/operator-final-copy.ts')).toContain('const body = applyBenefitToBody(stripIncompatibleEmojis(rawBody), ctx.benefit);');
  });
  it('AI 한줄로 카드 = 채우기 · 꾸미기 뒤 마지막 본문으로 바이트', () => {
    const s = src('services/ai-line.ts');
    const fill = s.indexOf('body: applyBenefitToBody(body, input.facts.benefit)');
    const bytes = s.indexOf("if (channel === 'SMS') for (const c of cards) c.byteCount = eucKrByteLength(c.body);");
    expect(fill).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(fill);
  });
  const AD_TABLE: Array<[string, string]> = [
    ['봄 세일 안내', '0801234567'],
    ['봄 세일 안내', ''],
    ['(광고) 봄 세일 안내\n무료거부 0801234567', '0801234567'],
    ['봄 세일 안내\n\n\n', '0801234567'],
    ['가'.repeat(30), '0801112222'],
  ];
  it('광고 SMS 합계 = 실제 발송 합성 글(buildAdMessage)의 길이 · 화면 미러 = 서버와 같은 글', () => {
    for (const [body, opt] of AD_TABLE) {
      expect(smsAdTotalBytes(body, true, opt)).toBe(eucKrByteLength(buildAdMessage(body, 'SMS', true, opt)));
      expect(buildAdMessageFront(body, 'SMS', true, opt)).toBe(buildAdMessage(body, 'SMS', true, opt));
      expect(calculateSmsBytes(buildAdMessageFront(body, 'SMS', true, opt))).toBe(smsAdTotalBytes(body, true, opt));
    }
    expect(smsAdTotalBytes('봄 세일', false, '0801234567')).toBe(eucKrByteLength('봄 세일'));
    const ai = src('services/ai.ts');
    expect(ai).toContain('smsAdTotalBytes(');
    expect(src('services/ai-orchestrator.ts')).toContain('smsAdTotalBytes(m.body, !!targetResult.is_ad, ctx.companyInfo.reject_number) > SMS_MAX_BYTES');
    const page = FE('pages/AiLinePage.tsx');
    expect(page).toContain("calculateSmsBytes(buildAdMessageFront(body, 'SMS', !!adEnabled, proposal?.channel?.rejectNumber || ''))");
    expect(page).toContain("const smsSendBytes = calculateSmsBytes(buildAdMessageFront(rawActiveBody, 'SMS', !!isAd, rawReject));");
    expect(page).toContain('smsSendBytes > 90');
  });
});

// ─────────────────────────────── R1 ───────────────────────────────
describe('R1(D3) 칸 고른 뒤 기준 = 서버 한 곳', () => {
  const opt = (dataType: 'string' | 'number' | 'date', kind: 'custom' | 'standard' = 'custom', field = 'custom_fields.custom_3') =>
    ({ field, label: '칸', kind, dataType, fillCount: 3, samples: dataType === 'number' ? ['1', '2', '3'] : ['a'] } as any);
  it('잠금 = 번역기가 받는 검사 그대로(따로 둔 허용 표 없음) · 기준 없는 말 + 날짜 칸 = 잠금(방향을 짐작하지 않는다)', () => {
    expect(conditionForPick({ term: '포인트' }, opt('date'))).toBeNull();
    expect(pickLockReason({ term: '포인트' }, opt('date'))).toContain('날짜 기준');
    expect(conditionForPick({ term: '포인트' }, opt('number'))).toMatchObject({ field: 'custom_fields.custom_3', operator: 'gte', value: 1 });
    expect(conditionForPick({ term: '구매', operator: 'days_passed', value: 90 }, opt('date'))).toMatchObject({ operator: 'days_passed', value: 90 });
    // Codex 구현 1R #3 — 회사 숫자 칸의 「중 하나」 = 번역기가 받으므로 열림 · 표준 숫자 칸은 번역기가 받지 않으므로 잠김
    expect(pickLockReason({ term: '회원구분', operator: 'in', value: ['1', '2'] }, opt('number'))).toBeNull();
    expect(pickLockReason({ term: '포인트', operator: 'in', value: ['1', '2'] }, opt('number', 'standard', 'points'))).toBeTruthy();
    expect(pickLockReason({ term: '구매', operator: 'days_passed', value: 90 }, opt('number', 'standard', 'points'))).toContain('날짜 기준');
    // 날짜가 아닌 값 + 날짜 칸 = 허용 표는 받아도 변환기가 0건 → 잠금(검사 = validateCondition 뒤 conditionsToFilters 까지 · 숫자는 normalizeDate 가 엑셀 일련번호로 읽으므로 글자로)
    expect(conditionForPick({ term: 'x', operator: 'gte', value: 'abc' }, opt('date', 'standard', 'recent_purchase_date'))).toBeNull();
    expect(conditionForPick({ term: 'x', operator: 'gte', value: '2026-01-01' }, opt('date', 'standard', 'recent_purchase_date'))).toMatchObject({ operator: 'gte' });
    // 잠금 없음 ⇔ 조건이 나옴(한 판정)
    const opts = [opt('date'), opt('number'), opt('string'), opt('number', 'standard', 'points'), opt('date', 'standard', 'recent_purchase_date')];
    const srcs = [{ term: 'x' }, { term: 'x', operator: 'in', value: ['1'] }, { term: 'x', operator: 'days_passed', value: 30 }, { term: 'x', operator: 'gte', value: '2026-01-01' }, { term: 'x', operator: 'gte', value: 5 }];
    for (const o of opts) for (const s of srcs) {
      expect([o.field, o.dataType, s.operator, pickLockReason(s, o) === null]).toEqual([o.field, o.dataType, s.operator, conditionForPick(s, o) !== null]);
    }
  });
  it('화면 applyPick = 칸만 보낸다(기준 · 값 규칙 0)', () => {
    const m = FE('components/automarketing/OperatorPreviewModal.tsx');
    const body = m.slice(m.indexOf('const applyPick = () => {'), m.indexOf('const thresholdDirty'));
    expect(body).toContain('{ term: pickFor, field: opt.field }');
    expect(body.replace(/\/\/.*$/gm, '')).not.toMatch(/operator|dataType ===/);
    expect(m).toContain('const off = !!o.disabled || !!lock;');
  });
});

describe('R1(D9) 조건 문구 한 벌', () => {
  const tableKeys = (s: string, head: string) => {
    const i = s.indexOf(head);
    const lit = s.slice(s.indexOf('{', i + head.length - 1), s.indexOf('};', i));
    return [...lit.matchAll(/([a-z_]+):\s*'/g)].map((m) => m[1]);
  };
  // 화면 표 = 승인 창 하나(자동발송 창 = 폐기 · 그리지 않음 · 설계서 §10) · 직접 타겟 날짜 글 = customerFilterBuild CT(위 R100)
  it('기준 표의 모든 키를 승인 창 문구 표가 가진다', () => {
    const op = FE('components/automarketing/OperatorPreviewModal.tsx');
    const k1 = tableKeys(op, 'const OP_TEXT: Record<string, string> = ');
    for (const k of Object.keys(FILTER_OPERATOR_TEXT)) expect(['OperatorPreviewModal', k, k1.includes(k)]).toEqual(['OperatorPreviewModal', k, true]);
    const fe = (rel: string) => readFileSync(join(PKG, 'frontend', 'src', rel), 'utf8');
    expect(/import\s+AutoSendFormModal|<AutoSendFormModal/.test(['pages/AutoSendPage.tsx', 'pages/Dashboard.tsx', 'App.tsx'].map(fe).join('\n'))).toBe(false);
  });
  it('서버 문구 자리 둘 = 표를 읽는다', () => {
    expect(src('utils/audience-translate.ts')).toMatch(/OP_TEXT\s*=\s*FILTER_OPERATOR_TEXT/);
    expect(src('utils/ai-line.ts')).toContain('FILTER_OPERATOR_TEXT.days_passed');
  });
});

// ─────────────────────────────── 개선 ───────────────────────────────
describe('개선 E1 · E2-1 · E2-2', () => {
  it('E1 브랜드 기본정보 예시 = 우리 이름(고객사 이름 0)', () => {
    const s = FE('components/AiMemory/BrandBasicInfoTab.tsx');
    expect(s).not.toContain('폴라초이스');
    expect(s).toContain('예: 한줄로');
    expect(s).toContain('예: 주식회사 인비토');
  });
  it('E2-1 번호 칸 = 서버가 기본 번호를 정하지 못할 때만 · 숨으면 보내는 번호 = 기본 번호', () => {
    const s = FE('components/journey/map/InterviewModal.tsx');
    expect(s).toContain('const askCallback = !!prepared && !noCallback && !prepared.callback.defaultPhone;');
    expect(s).toContain("const sendPhone = askCallback ? callbackPhone : (prepared?.callback.defaultPhone || '');");
    expect(s).toContain('const canBuild = plans.length > 0 && !noCallback && !!sendPhone;');
    expect(s).toContain('callbackNumber: sendPhone || undefined');
    expect(s).toContain('{prepared && (noCallback || askCallback) && (');
    expect(s).not.toMatch(/callbackNumber:\s*callbackPhone/);
  });
  it('E2-2 만든 직후 · 계획 열기 = 시작 칸 · 그 여정에서 한 번만', () => {
    expect(FE('pages/JourneysPage.tsx')).toContain("onFocusJourney={(id) => openWorkspace(id, 'start')}");
    const w = FE('components/journey/workspace/JourneyWorkspace.tsx');
    expect(w).toContain('const startOnceRef = useRef<string | null>(null);');
    expect(w).toContain("if (startOnceRef.current !== journeyId) { startOnceRef.current = journeyId; setSelected('start'); }");
  });
});
