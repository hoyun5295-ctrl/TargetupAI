/**
 * ★ 2026-11-06 C107 추가 과제 계약 시험(설계서 docs/2026-11-06-c107-followups-design.md)
 *
 * F1 · 뿌리 R64 — 스팸 몰림 경보가 세는 결과 코드 = 한줄로 결과 표 라벨 「스팸」 ∪ 비토 대역 표 제목 「스팸」(둘 다 기계 추출 · 손 목록 0).
 *   옛 목록은 결과 표에서만 뽑아 비토 라인 스팸 차단(40016 · 49004 · 49010 · 39004 · 39010)을 세지 못했다.
 * F4 · 뿌리 R67 — 결과 판정(성공 · 대기)을 결과 CT(SUCCESS_CODES · PENDING_CODES) 대신 손으로 적은 자리 0.
 *   옛 관리 통계 시험 발송 요약은 (6, 1000, 1800) · 100 을 손으로 적어 대체 성공 7830 · 7831 과 대기 104 를 실패로 셌다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { STATUS_CODE_MAP, SPAM_BLOCK_STATUS_CODES, getStatusType, SMSQ_FRIEND_COLUMN, BRAND_FRIEND_DELIVERED_SQL, tallyKakaoFallback } from '../sms-result-map';
import { HANJUL_BAND_CODES } from '../result-code-hanjul-band.generated';
import { billingMsgTypeSql, BILLING_MSG_TYPE_SQL } from '../send-usage-aggregation';
import { buildDeductDescription, parseAlimtalkUnits, parseDeductDescription, resolveAlimtalkLedgerUnits } from '../deduct-reference';
import { calcAlimtalkUnitDiff, resolveAlimtalkMix, parseReadHigh, mergeReadHigh, READ_HIGH_KEYS } from '../refund-calc';
import { READ_HIGH_UPDATE_SQL } from '../mysql-refund-sweeper';

const SRC = join(__dirname, '..', '..');
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('C107F F1 스팸 몰림 코드 = 결과 표 ∪ 비토 대역 표(R64)', () => {
  it('목록 = 두 표에서 「스팸」을 뽑은 합집합과 같다', () => {
    const fromMap = Object.entries(STATUS_CODE_MAP).filter(([, v]) => v.label.includes('스팸')).map(([k]) => Number(k));
    const fromBand = Object.entries(HANJUL_BAND_CODES).filter(([, v]) => v.title.includes('스팸')).map(([k]) => Number(k));
    const want = [...new Set([...fromMap, ...fromBand])].sort((a, b) => a - b);
    expect([...SPAM_BLOCK_STATUS_CODES].sort((a, b) => a - b)).toEqual(want);
    expect(fromBand.length).toBeGreaterThan(0);
    expect(SPAM_BLOCK_STATUS_CODES).toEqual(expect.arrayContaining([40016, 49004, 49010, 39004, 39010]));
  });

  it('목록의 코드는 전부 실패 유형이고, 카카오 채널 제재(제목에 「스팸」 없음)는 들어가지 않는다', () => {
    for (const c of SPAM_BLOCK_STATUS_CODES) expect(getStatusType(c), String(c)).toBe('fail');
    expect(SPAM_BLOCK_STATUS_CODES).not.toContain(21025);
    expect(SPAM_BLOCK_STATUS_CODES).not.toContain(21027);
  });
});

describe('C107F F4 결과 판정 손 목록 0(R67)', () => {
  const files = walk(SRC).filter((f) => !f.replace(/\\/g, '/').endsWith('/utils/sms-result-map.ts')
    && !/\.generated\.ts$/.test(f));

  it('status_code IN / NOT IN 바로 뒤에 숫자를 손으로 적은 SQL 조각이 없다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/status_code\s+(NOT\s+)?IN\s*\(\s*\d/i.test(line)) offenders.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('집계 CASE 가 결과 코드 숫자 하나로 성공 · 대기를 가르지 않는다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/CASE WHEN status_code\s*(=|!=|<>)\s*\d/i.test(line)) offenders.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('성공 · 대기 코드 배열을 CT 밖에서 다시 적지 않는다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/\[\s*6\s*,\s*1000\b|\[\s*100\s*,\s*104\s*\]/.test(line)) offenders.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ── ② 브랜드 친구 · 비친구 단가 = 받는 사람의 실제 친구 여부(뿌리 R65 · 설계서 §2 H-a ~ H-c) ──

describe('C107F HC1 후불 청구 식 = 표마다(친구 칸 유무) · 실제 친구 Y 먼저', () => {
  it('친구 칸 있는 표 = 브랜드 갈래 첫 판정이 k_friend_yn = Y · 대체 갈래가 그보다 먼저 · 없는 표 = 종전 글자', () => {
    const withF = billingMsgTypeSql(true);
    const without = billingMsgTypeSql(false);
    expect(without).toBe(BILLING_MSG_TYPE_SQL);
    expect(without).not.toContain(SMSQ_FRIEND_COLUMN);
    const friendAt = withF.indexOf(`WHEN ${SMSQ_FRIEND_COLUMN} = 'Y' THEN 'F'`);
    expect(friendAt).toBeGreaterThan(-1);
    expect(friendAt).toBeLessThan(withF.indexOf('JSON_VALID(k_etc_json)'));
    const brandAt = withF.indexOf("WHEN msg_type = 'F' THEN");
    expect(brandAt).toBeGreaterThan(-1);
    expect(withF.indexOf('WHEN')).toBeLessThan(brandAt);   // 대체(7830 · 7831) WHEN 이 브랜드 WHEN 보다 먼저(C107 K1 ③)
    expect(withF.replace(`WHEN ${SMSQ_FRIEND_COLUMN} = 'Y' THEN 'F' `, '')).toBe(without);
  });

  it('세 청구 집계 함수는 상수가 아니라 표마다 함수를 부른다', () => {
    const agg = readSrc('utils/send-usage-aggregation.ts');
    for (const fn of ['smsAggByRunDateType', 'testSmsAggByUserDateType', 'smsAggByDateType']) {
      const start = agg.indexOf(`export async function ${fn}(`);
      expect(start, fn).toBeGreaterThan(-1);
      const body = agg.slice(start, agg.indexOf('\n}\n', start));
      expect(body, fn).toContain('const friendTables = await getFriendColumnTables();');
      expect(body, fn).toContain('const billingType = billingMsgTypeSql(friendTables.has(t));');
      expect(body, fn).not.toContain('${BILLING_MSG_TYPE_SQL}');
    }
  });

  it('친구 칸 이름을 SQL 에 쓰는 파일은 전부 표마다 친구 칸 유무(getFriendColumnTables)로 고른다(칸 없는 표에 쓰면 쿼리 전체가 죽는다)', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (rel === 'utils/sms-result-map.ts') continue;
      const src = readFileSync(f, 'utf8');
      const code = src.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
      const uses = /\bk_friend_yn\b|SMSQ_FRIEND_COLUMN|BRAND_FRIEND_DELIVERED_SQL/.test(code);
      if (uses && !/getFriendColumnTables\(\)/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    expect(BRAND_FRIEND_DELIVERED_SQL).toContain(`${SMSQ_FRIEND_COLUMN} = 'Y'`);
  });
});

describe('C107F HC2 차감 문구 친구 조각 = 생산 · 되읽기 짝', () => {
  const units = { KAKAO: 23.1, SMS: 25.96, LMS: 25.96, FRIEND: 16.5 };
  it('친구 조각이 있으면 되읽고 · 없는 옛 행은 종전대로 · 건수 · 단가 되읽기는 그대로', () => {
    const d = buildDeductDescription('campaign', 'BRAND', 10, 25.96, 0, units, '브랜드메시지');
    expect(d).toContain('결과별 정산: 브랜드메시지 23.1원 · 친구 16.5원 · SMS 대체 25.96원 · LMS 대체 25.96원');
    expect(parseAlimtalkUnits(d)).toEqual(units);
    expect(parseDeductDescription(d)).toEqual({ count: 10, unitPrice: 25.96 });
    const old = buildDeductDescription('campaign', 'BRAND', 10, 25.96, 0, { KAKAO: 23.1, SMS: 25.96, LMS: 25.96 }, '브랜드메시지');
    expect(parseAlimtalkUnits(old)).toEqual({ KAKAO: 23.1, SMS: 25.96, LMS: 25.96 });
    expect(old).not.toContain('친구');
  });
  it('한 캠페인 · 축의 과금 행이 친구 단가가 서로 다르면 결과별 정산을 하지 않는다(추측 0)', () => {
    const a = buildDeductDescription('campaign', 'BRAND', 1, 23.1, 0, { KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 16.5 }, '브랜드메시지');
    const b2 = buildDeductDescription('campaign', 'BRAND', 1, 23.1, 0, { KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 17 }, '브랜드메시지');
    expect(resolveAlimtalkLedgerUnits([{ amount: 23.1, description: a }, { amount: 23.1, description: b2 }])).toBeNull();
    expect(resolveAlimtalkLedgerUnits([{ amount: 23.1, description: a }, { amount: 23.1, description: a }])).toEqual({ KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 16.5 });
  });
});

describe('C107F HC3 선불 정산 = 친구 성공 × (차감 단가 − 친구 단가) · BRAND 축 두 범위', () => {
  it('친구 성공은 카카오 성공의 부분집합 · 그 수만큼 친구 단가로 차액', () => {
    const { mix } = resolveAlimtalkMix({ kakao: 5, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 0, sub: 0, friendKakao: 3 }, 5);
    expect(mix).toEqual({ kakao: 2, sms: 0, lms: 0, other: 0, friend: 3 });
    expect(calcAlimtalkUnitDiff({ deductUnit: 23.1, units: { KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 16.5 }, mix })).toBe(19.8);
    // 친구 단가 조각이 없는 옛 차감 = 친구 성공도 카카오 단가(차액 0 · 종전)
    expect(calcAlimtalkUnitDiff({ deductUnit: 23.1, units: { KAKAO: 23.1, SMS: 23.1, LMS: 23.1 }, mix })).toBe(0);
    // 친구 칸이 없는 표만 있는 캠페인(friendKakao 없음) = 종전
    expect(resolveAlimtalkMix({ kakao: 5, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 0, sub: 0 }, 5).mix).toEqual({ kakao: 5, sms: 0, lms: 0, other: 0, friend: 0 });
    // 무료는 차액이 작은 성공부터 덮는다(친구 차액이 가장 크면 마지막)
    expect(calcAlimtalkUnitDiff({ deductUnit: 23.1, units: { KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 16.5 }, mix, freeCount: 2 })).toBe(19.8);
    expect(calcAlimtalkUnitDiff({ deductUnit: 23.1, units: { KAKAO: 23.1, SMS: 23.1, LMS: 23.1, FRIEND: 16.5 }, mix, freeCount: 3 })).toBe(13.2);
  });

  it('스위퍼가 BRAND 축 scope brand(문자 + 브랜드)에서도 결과별 차액을 재고 · 기준 칸을 따로 남긴다', () => {
    const sw = readSrc('utils/mysql-refund-sweeper.ts');
    expect(sw).toContain("const diffKey = axis.scope === 'all' ? 'unitDiff' as const : axis.scope === 'brand' ? 'brandUnitDiff' as const : null;");
    expect(sw).toContain('const alimUnits = diffKey ? resolveAlimtalkLedgerUnits(dedRes.rows as any[]) : null;');
    expect(sw).not.toMatch(/alimUnits = axis\.scope === 'all'/);
    expect(READ_HIGH_KEYS).toContain('brandUnitDiff');
    expect(READ_HIGH_UPDATE_SQL).toContain("'brandUnitDiff'");
    expect(sw).toContain('next.nonBrandSuccess, next.brandUnitDiff, gen]');
    expect(mergeReadHigh(parseReadHigh({ unitDiff: 5 }), { brandUnitDiff: 19.799 }).brandUnitDiff).toBe(19.8);
    expect(parseReadHigh({ unitDiff: 5 }).brandUnitDiff).toBe(0);
  });

  it('선불 차감이 비친구 대상 브랜드에 친구 단가 조각을 싣는다(같은 잠금 행 · 친구가 더 쌀 때만)', () => {
    const pre = readSrc('utils/prepaid.ts');
    expect(pre).toContain("if (messageType === 'BRAND' && resolveBrandAudience(brand?.targeting) === 'nonfriend') {");
    expect(pre).toContain("resolveChargeUnitPriceDetailed(c, 'BRAND', { ...(brand || {}), targeting: 'I' })");
    expect(pre).toContain('friend.price < resolved.price');
  });
});

describe('C107F HC4 화면 · 통계 칸 = 실제 친구 성공을 친구 단가 · 친구 칸으로', () => {
  it('카카오 분리 집계가 브랜드 실제 친구 성공만 센다(대체 · 실패 · 친구 칸 없는 행 제외)', () => {
    const t = tallyKakaoFallback([
      { msg_type: 'F', status_code: 1800, cnt: 3, friend: true },
      { msg_type: 'F', status_code: 1800, cnt: 2, friend: false },
      { msg_type: 'F', status_code: 7830, cnt: 1, friend: true },
      { msg_type: 'F', status_code: 3018, cnt: 1, friend: true },
      { msg_type: 'K', status_code: 1800, cnt: 4, friend: true },
    ]);
    expect(t.friendSuccess).toBe(3);
    expect(t.success).toBe(9);
  });
  it('발송결과 예상 비용 · 관리 통계 내보내기가 친구 성공 수를 친구 단가 · 친구 칸으로 쓴다', () => {
    const modal = readFileSync(join(SRC, '..', '..', 'frontend', 'src', 'components', 'ResultsModal.tsx'), 'utf8');
    expect(modal).toContain('const friendOk = Math.min(Math.max(0, Number(bsp.friendSuccess) || 0), bsp.success);');
    expect(modal).toContain('friendOk * perBrand + (bsp.success - friendOk) * brandUnit');
    const admin = readSrc('routes/admin.ts');
    expect(admin).toContain("const friendOk = kakaoKey === 'BRAND_NF' ? Math.min(split?.friendSuccess ?? 0, split?.success ?? 0) : 0;");
    // ★ 2026-11-08 C117 D9 — 친구 몫 칸 이름 = 청구 유형 이름 원천(캠페인 이름 함수는 고른 대상으로 바뀌었다)
    expect(admin).toContain("addExportBucket(c, 'BRAND', billingTypeLabelOf('BRAND'), 0, friendOk, friendOk, 0, 0);");
    const stats = readSrc('utils/stats-aggregation.ts');
    expect(stats).toContain('GROUP BY app_etc1, msg_type, is_sub, is_friend, status_code');
  });
});
