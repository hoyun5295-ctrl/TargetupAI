/**
 * ★ 2026-10-28 P2 설치별 값 분류 — 정규화 · 적용 판정 · 지문 · 설정 스키마(docs/2026-10-28-sync-value-check-summary-guard-design.md §3)
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCustomer, resolveValueMaps, singleSourceColumn, builtinValueJudgement, valueMapSourceOf, valueMapsDigest,
} from './index';
import { AgentConfigSchema } from '../config/schema';

const SRC = valueMapSourceOf({ type: 'oracle', host: 'h', port: 1521, database: 'D', username: 'SYNC_READER' });
const T = { table: 'V_CUSTOMER_MST', source: SRC };
const MAPS = {
  sms_opt_in: { column: 'YN_SMS', ...T, values: { 수신: true, 미수신: false, Y: false } },
  is_opt_out: { column: 'YN_WITHDRAW', ...T, values: { 회원: false, 휴면: true } },
  gender: { column: 'TP_GENDER', ...T, values: { 남자고객: 'M' as const } },
};

describe('normalizeCustomer + valueMaps', () => {
  it('낱말표가 모르는 글자만 표로 바꾼다', () => {
    const r = normalizeCustomer({ phone: '01000000001', sms_opt_in: ' 수신 ', is_opt_out: '회원', gender: '남자고객' }, { valueMaps: MAPS });
    expect(r.sms_opt_in).toBe(true);
    expect(r.gender).toBe('M');
    expect('sms_opt_in_unknown' in r).toBe(false);
    expect('opt_out_unknown' in r).toBe(false);
  });

  it('낱말표가 아는 값은 표가 반대로 적혀 있어도 그대로(Y = 동의)', () => {
    expect(normalizeCustomer({ phone: '01000000001', sms_opt_in: 'Y' }, { valueMaps: MAPS }).sms_opt_in).toBe(true);
  });

  it('탈퇴 표의 「휴면 = 탈퇴」는 수신거부로 접는다 · 낱말표 「탈퇴」도 그대로 접는다', () => {
    expect(normalizeCustomer({ phone: '01000000001', sms_opt_in: '수신', is_opt_out: '휴면' }, { valueMaps: MAPS }).sms_opt_in).toBe(false);
    expect(normalizeCustomer({ phone: '01000000001', sms_opt_in: '수신', is_opt_out: '탈퇴' }, { valueMaps: MAPS }).sms_opt_in).toBe(false);
  });

  it('표에도 없는 글자 = 지금 규칙(알아볼 수 없음 표시 · 탈퇴는 접음)', () => {
    const r = normalizeCustomer({ phone: '01000000001', sms_opt_in: '수신안함', is_opt_out: '정지' }, { valueMaps: MAPS });
    expect(r.sms_opt_in).toBe(false);
    expect(r.opt_out_unknown).toBe('정지');
  });

  it('표 없음 = 지금과 같다', () => {
    const row = { phone: '01000000001', sms_opt_in: '수신', is_opt_out: '회원', gender: '남자고객', custom_fields: { custom_1: 'A' } };
    expect(normalizeCustomer(row, { valueMaps: undefined })).toEqual(normalizeCustomer(row));
  });

  it('prototype 키 글자는 표에서 찾지 않는다', () => {
    const r = normalizeCustomer({ phone: '01000000001', sms_opt_in: 'constructor' }, { valueMaps: MAPS });
    expect(r.sms_opt_in).toBe(null);
    expect(r.sms_opt_in_unknown).toBe('constructor');
  });
});

describe('resolveValueMaps 적용 판정', () => {
  const mapping = { HP: 'phone', YN_SMS: 'sms_opt_in', YN_WITHDRAW: 'is_opt_out', TP_GENDER: 'gender' };

  it('단일 원본 컬럼 · 고객 테이블 · 원본이 모두 같을 때만', () => {
    expect(resolveValueMaps(MAPS, mapping, T)).toEqual(MAPS);
    expect(resolveValueMaps(MAPS, { ...mapping, YN_SMS: 'custom_1', SMS2: 'sms_opt_in' }, T)?.sms_opt_in).toBeUndefined();
    expect(resolveValueMaps(MAPS, mapping, { ...T, table: 'V_OTHER' })).toBeUndefined();
    expect(resolveValueMaps(MAPS, mapping, { ...T, source: valueMapSourceOf({ type: 'oracle', host: 'h2', port: 1521, database: 'D', username: 'SYNC_READER' }) })).toBeUndefined();
  });

  it('두 컬럼이 한 필드(이어붙이기)면 쓰지 않는다 · 매핑에 없으면 쓰지 않는다 · 표 없음 = undefined', () => {
    expect(resolveValueMaps(MAPS, { ...mapping, SMS2: 'sms_opt_in' }, T)?.sms_opt_in).toBeUndefined();
    expect(resolveValueMaps({ sms_opt_in: MAPS.sms_opt_in }, { HP: 'phone' }, T)).toBeUndefined();
    expect(resolveValueMaps(undefined, mapping, T)).toBeUndefined();
    expect(singleSourceColumn({ A: 'gender', B: 'gender' }, 'gender')).toBeNull();
  });

  it('원본 식별에는 비밀번호가 없다', () => {
    expect(valueMapSourceOf({ type: 'oracle', host: 'h', password: 'secret-pw' } as any)).not.toContain('secret-pw');
  });

  it('지문은 저장 순서와 무관 · 분류가 바뀌면 달라진다', () => {
    const reordered = { gender: MAPS.gender, is_opt_out: MAPS.is_opt_out, sms_opt_in: { ...MAPS.sms_opt_in, values: { Y: false, 미수신: false, 수신: true } } };
    expect(valueMapsDigest(reordered)).toBe(valueMapsDigest(MAPS));
    expect(valueMapsDigest({ ...MAPS, is_opt_out: { ...MAPS.is_opt_out, values: { 회원: true, 휴면: true } } })).not.toBe(valueMapsDigest(MAPS));
  });

  it('낱말표 판정 한 곳', () => {
    expect(builtinValueJudgement('sms_opt_in', '수신')).toBeNull();
    expect(builtinValueJudgement('is_opt_out', '탈퇴')).toBe(true);
    expect(builtinValueJudgement('gender', '여자')).toBe('F');
  });
});

describe('설정 스키마 valueMaps', () => {
  const base = {
    server: { apiKey: 'k', apiSecret: 's' },
    database: { type: 'oracle', host: 'h', database: 'd' },
    sync: { customerTable: 'C' },
    mapping: {},
    agent: {},
  };

  it('없으면 없음 · 맞으면 보존', () => {
    expect(AgentConfigSchema.parse(base).valueMaps).toBeUndefined();
    expect(AgentConfigSchema.parse({ ...base, valueMaps: MAPS }).valueMaps).toEqual(MAPS);
  });

  it('잘못된 칸(값 꼴 · 원본 · 테이블 빠짐)은 버리고 기동은 막지 않는다', () => {
    const bad1 = AgentConfigSchema.parse({ ...base, valueMaps: { sms_opt_in: { column: 'X', ...T, values: { 수신: 'yes' } } } });
    expect(bad1.valueMaps).toBeUndefined();
    expect(bad1.sync.customerTable).toBe('C');
    expect(AgentConfigSchema.parse({ ...base, valueMaps: { sms_opt_in: { column: 'X', values: { 수신: true } } } }).valueMaps).toBeUndefined();
  });
});
