/**
 * ★ 2026-10-28 P2 설치 값 확인 CT(setup/value-check.ts) — 마법사 · 설정 편집 공용
 */
import { describe, it, expect } from 'vitest';
import { runValueCheck, mergeTrimmed, VALUE_CHECK_LIMIT, type ValueCount } from './value-check';

function io(answers: Record<string, unknown>) {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines, asked,
    log: (l: string) => { lines.push(l); },
    askSelect: async (q: string, choices: { name: string; value: any }[]) => {
      asked.push(q);
      const key = Object.keys(answers).find((k) => q.includes(`"${k}"`));
      const want = key ? answers[key] : null;
      return choices.find((c) => c.value === want)?.value ?? null;
    },
  };
}

const connector = (byColumn: Record<string, { values: ValueCount[]; truncated?: boolean } | Error>) => ({
  countColumnValues: async (_t: string, column: string) => {
    const r = byColumn[column];
    if (r instanceof Error) throw r;
    return { values: r.values, truncated: !!r.truncated };
  },
});

const MAPPING = { HP: 'phone', YN_SMS: 'sms_opt_in', YN_WITHDRAW: 'is_opt_out', TP_GENDER: 'gender' };
const T = { table: 'V_CUSTOMER_MST', source: 'SRC' };

describe('runValueCheck', () => {
  it('엠티 구성 — 모르는 글자만 묻고 표에 넣는다 · 아는 값 · 빈 값은 묻지 않는다', async () => {
    const t = io({ 수신: true, 미수신: false, 회원: false });
    const out = await runValueCheck(connector({
      YN_SMS: { values: [{ value: '수신', count: 935291 }, { value: '미수신 ', count: 156455 }, { value: null, count: 3 }] },
      YN_WITHDRAW: { values: [{ value: '회원', count: 1000000 }, { value: '탈퇴', count: 91746 }] },
      TP_GENDER: { values: [{ value: '남자', count: 400000 }, { value: '여자', count: 691746 }] },
    }), T, MAPPING, undefined, t);
    expect(out).toEqual({
      sms_opt_in: { column: 'YN_SMS', ...T, values: { 수신: true, 미수신: false } },
      is_opt_out: { column: 'YN_WITHDRAW', ...T, values: { 회원: false } },
    });
    expect(t.asked).toHaveLength(3);
    expect(t.lines.join('\n')).toContain('수신동의 935,291 · 수신거부 156,455 · 값 없음 3');
  });

  it('「모름」은 표에 넣지 않는다 · 요약은 지금 규칙 결과', async () => {
    const t = io({});
    const out = await runValueCheck(connector({ YN_SMS: { values: [{ value: '수신', count: 5 }] }, YN_WITHDRAW: { values: [] }, TP_GENDER: { values: [] } }),
      T, MAPPING, undefined, t);
    expect(out).toBeUndefined();
    expect(t.lines.join('\n')).toContain('알 수 없음(신규 미동의) 5');
  });

  it(`값이 ${VALUE_CHECK_LIMIT}가지를 넘으면 분류하지 않는다`, async () => {
    const t = io({ 수신: true });
    const out = await runValueCheck(connector({ YN_SMS: { values: [{ value: '수신', count: 1 }], truncated: true }, YN_WITHDRAW: { values: [] }, TP_GENDER: { values: [] } }),
      T, MAPPING, undefined, t);
    expect(out).toBeUndefined();
    expect(t.asked).toHaveLength(0);
  });

  it('쿼리 실패 필드는 컬럼 · 테이블 · 원본이 같은 지난 표를 그대로 둔다 · 하나라도 다르면 버린다', async () => {
    const prev = {
      sms_opt_in: { column: 'YN_SMS', ...T, values: { 수신: true } },
      is_opt_out: { column: 'OLD_COL', ...T, values: { 회원: false } },
      gender: { column: 'TP_GENDER', table: 'V_CUSTOMER_MST', source: 'OTHER_DB', values: { 남자고객: 'M' as const } },
    };
    const err = new Error('ORA-01013');
    const out = await runValueCheck(connector({ YN_SMS: err, YN_WITHDRAW: err, TP_GENDER: err }), T, MAPPING, prev, io({}));
    expect(out).toEqual({ sms_opt_in: prev.sms_opt_in });
  });

  it('값 확인 미지원 원본 = 묻지 않고 맞는 지난 표만 남긴다', async () => {
    const t = io({});
    const prev = { sms_opt_in: { column: 'YN_SMS', ...T, values: { 수신: true } } };
    const out = await runValueCheck({}, T, MAPPING, prev, t);
    expect(out).toEqual(prev);
    expect(t.asked).toHaveLength(0);
  });

  it('이어 붙인 매핑은 값 확인을 하지 않는다', async () => {
    const t = io({ 수신: true });
    const out = await runValueCheck(connector({}), T, { YN_SMS: 'sms_opt_in', SMS2: 'sms_opt_in' }, undefined, t);
    expect(out).toBeUndefined();
    expect(t.lines.join('\n')).toContain('이어 붙인 매핑');
  });
});

describe('mergeTrimmed', () => {
  it('공백 지운 글자로 합치고 빈 글자 · NULL 은 값 없음 하나', () => {
    expect(mergeTrimmed([{ value: 'Y', count: 2 }, { value: ' Y', count: 3 }, { value: '', count: 1 }, { value: null, count: 4 }]))
      .toEqual({ rows: [{ value: 'Y', count: 5 }], blank: 5 });
  });
});
