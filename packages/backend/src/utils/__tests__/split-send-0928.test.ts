/**
 * 분할 전송 — 건수 + 간격(분) · 끝나는 날 한도 · 화면과 서버 같은 계산 (★2026-09-28 Harold 지시 · 목업 승인)
 *
 * 요구: 분할 풍선의 예시 숫자(100·500·1,000·3,000)는 의미가 없다 → 건수와 "몇 분마다"를 직접 정한다.
 *       분할 시각과 건수의 정합성을 다시 점검한다.
 * 점검 결과(코드):
 *   ① 화면의 끝 시각 = 시작 + 회차×1분 — 서버는 21~08시를 건너뛴다(send-time-util calcSplitSendTime) → 화면이 틀렸다
 *   ② 끝나는 날 한도 없음 — 선불 실패 자동 환불(mysql-refund-sweeper)은 발송 기준 14일 안만 본다 → 그 뒤 실패분 미환불
 *   ③ 서버가 분할 건수를 검사하지 않는다(화면만 1~9,999)
 *   ④ 간격 1분 고정이 서버 6곳에 인라인(campaigns.ts 4 · direct-send-worker.ts 2)
 * 처방: 분할 CT 한 벌(send-time-util) = 검사·회차 시각·계획 · 한도 12일(14 − 결과 최장 2일) · 화면 시각표도 서버가 계산.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SPLIT_LIMITS, parseSplitSetting, readStoredSplit, splitSendTime, planSplitSchedule, calcSplitSendTime,
} from '../send-time-util';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const front = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');
/** KST 벽시계 → UTC Date */
const kst = (d: number, h: number, m: number) => new Date(Date.UTC(2027, 7, d, h - 9, m, 0));

describe('분할 값 검사(서버가 받는 값)', () => {
  it('끄면 분할 없음 · 켜면 건수 1~9,999 정수 · 간격 1~60분 정수', () => {
    expect(parseSplitSetting(false, 1000, 5)).toEqual({ ok: true, split: null });
    expect(parseSplitSetting(undefined, null, null)).toEqual({ ok: true, split: null });
    expect(parseSplitSetting(true, 1000, 5)).toEqual({ ok: true, split: { count: 1000, intervalMinutes: 5 } });
    expect(parseSplitSetting(true, '300', '10')).toEqual({ ok: true, split: { count: 300, intervalMinutes: 10 } });
    expect(parseSplitSetting(true, 9999, 60)).toEqual({ ok: true, split: { count: 9999, intervalMinutes: 60 } });
  });

  it('간격을 안 보낸 옛 화면·옛 요청 = 1분(지금까지와 같다)', () => {
    expect(parseSplitSetting(true, 500, undefined)).toEqual({ ok: true, split: { count: 500, intervalMinutes: 1 } });
    expect(parseSplitSetting(true, 500, null)).toEqual({ ok: true, split: { count: 500, intervalMinutes: 1 } });
  });

  it('범위 밖·소수·숫자 아님 = 거절(조용히 한 번에 보내지 않는다)', () => {
    for (const c of [0, -1, 10000, 1.5, 'abc', null]) {
      const r = parseSplitSetting(true, c, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.code).toBe('SPLIT_INVALID'); expect(r.error).toContain('9,999'); }
    }
    for (const g of [0, 61, 2.5, 'x']) {
      const r = parseSplitSetting(true, 100, g);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('60분');
    }
  });

  it('저장된 옛 캠페인 설정은 너그럽게 읽는다(예약 대기 중인 옛 분할이 그대로 나가게)', () => {
    expect(readStoredSplit({ splitEnabled: true, splitCount: 1000 })).toEqual({ count: 1000, intervalMinutes: 1 });
    expect(readStoredSplit({ splitEnabled: true, splitCount: 200, splitIntervalMinutes: 3 })).toEqual({ count: 200, intervalMinutes: 3 });
    expect(readStoredSplit({ splitEnabled: true, splitCount: 200, splitIntervalMinutes: 999 })).toEqual({ count: 200, intervalMinutes: 1 });
    expect(readStoredSplit({ splitEnabled: true, splitCount: 0 })).toBeNull();
    expect(readStoredSplit({ splitEnabled: false, splitCount: 100 })).toBeNull();
    expect(readStoredSplit(null)).toBeNull();
  });
});

describe('회차 시각 = 몇 번째 묶음 × 간격(분)을 발송 가능 시간 안에서 흘린다', () => {
  it('간격 1분이면 옛 식(Math.floor(i / 건수)분)과 같다', () => {
    const base = kst(18, 10, 0);
    for (const i of [0, 99, 100, 250, 999]) {
      expect(splitSendTime(base, i, { count: 100, intervalMinutes: 1 }).getTime())
        .toBe(calcSplitSendTime(base, Math.floor(i / 100)).getTime());
    }
  });

  it('간격 5분 = 묶음마다 5분씩', () => {
    const base = kst(18, 14, 0);
    const s = { count: 1000, intervalMinutes: 5 };
    expect(splitSendTime(base, 0, s)).toEqual(kst(18, 14, 0));
    expect(splitSendTime(base, 999, s)).toEqual(kst(18, 14, 0));
    expect(splitSendTime(base, 1000, s)).toEqual(kst(18, 14, 5));
    expect(splitSendTime(base, 3199, s)).toEqual(kst(18, 14, 15));
  });

  it('저녁 9시에 닿으면 다음 날 8시부터 이어서(간격이 있어도)', () => {
    const base = kst(18, 20, 50);
    const s = { count: 100, intervalMinutes: 5 };
    expect(splitSendTime(base, 100, s)).toEqual(kst(18, 20, 55));
    expect(splitSendTime(base, 200, s)).toEqual(kst(19, 8, 0));
    expect(splitSendTime(base, 300, s)).toEqual(kst(19, 8, 5));
  });
});

describe('분할 계획(화면 시각표 · 끝나는 날 한도)', () => {
  it('3,200명 · 1,000건씩 · 5분마다 = 4번 · 마지막 200건 · 시각표 전부', () => {
    const p = planSplitSchedule(kst(18, 14, 0), 3200, { count: 1000, intervalMinutes: 5 });
    expect(p.rounds).toBe(4);
    expect(p.lastCount).toBe(200);
    expect(p.lastAt).toEqual(kst(18, 14, 15));
    expect(p.slots.map((s) => [s.index, s.count])).toEqual([[0, 1000], [1, 1000], [2, 1000], [3, 200]]);
    expect(p.withinLimit).toBe(true);
  });

  it('회차가 많으면 앞 3번 + 마지막만 싣는다', () => {
    const p = planSplitSchedule(kst(18, 10, 0), 12000, { count: 1000, intervalMinutes: 1 });
    expect(p.rounds).toBe(12);
    expect(p.slots.map((s) => s.index)).toEqual([0, 1, 2, 11]);
  });

  it('받는 사람 0명 = 회차 0 · 한 번에 끝나면 1회', () => {
    expect(planSplitSchedule(kst(18, 10, 0), 0, { count: 100, intervalMinutes: 1 }).rounds).toBe(0);
    const one = planSplitSchedule(kst(18, 10, 0), 80, { count: 100, intervalMinutes: 1 });
    expect(one.rounds).toBe(1);
    expect(one.lastCount).toBe(80);
  });

  it(`마지막 회차가 시작부터 ${SPLIT_LIMITS.maxSpanDays}일을 넘으면 한도 밖`, () => {
    // 하루 창 = 13시간(780분). 100건씩 10분마다면 하루 78회차 = 7,800명.
    const s = { count: 100, intervalMinutes: 10 };
    expect(planSplitSchedule(kst(2, 8, 0), 7800 * 11, s).withinLimit).toBe(true);
    expect(planSplitSchedule(kst(2, 8, 0), 7800 * 12, s).withinLimit).toBe(false);
  });

  it('한도 11일의 근거 = 환불 워커 14일 − 문자 결과 최장 48시간 − 여유 1일(48시간 지난 캠페인 환불 집계 60분 주기)', () => {
    // ★Codex 0928 1R high — 12일(여유 0)이면 정확히 12일째 회차의 유실분이 만료 처리·60분 집계를 기다리는 사이 14일 창을 넘는다
    expect(SPLIT_LIMITS.maxSpanDays).toBe(11);
    expect(src('utils/mysql-refund-sweeper.ts')).toContain("ELSE INTERVAL '14 days' END)");
    expect(src('utils/mysql-refund-sweeper.ts')).toContain('경과(휴면)는 60분 1회만 실집계');
    expect(src('utils/expired-pending-sweeper.ts')).toContain('const EXPIRE_HOURS = 48;');
  });

  it('화면 범위·한도 상수 = 서버 CT 값(split-send.ts 주석의 계약)', () => {
    const f = front('utils/split-send.ts');
    expect(f).toContain(`export const SPLIT_COUNT_RANGE = { min: ${SPLIT_LIMITS.countMin}, max: ${SPLIT_LIMITS.countMax} } as const;`);
    expect(f).toContain(`export const SPLIT_INTERVAL_RANGE = { min: ${SPLIT_LIMITS.intervalMin}, max: ${SPLIT_LIMITS.intervalMax} } as const;`);
    expect(f).toContain(`export const SPLIT_MAX_SPAN_DAYS = ${SPLIT_LIMITS.maxSpanDays};`);
  });
});

describe('서버 배선 — 인라인 계산 0 · 모든 입구가 같은 CT', () => {
  it('옛 인라인(Math.floor(i / splitCount)분)이 남아 있지 않다', () => {
    for (const f of ['routes/campaigns.ts', 'utils/direct-send-worker.ts']) {
      const s = src(f);
      expect(s).not.toMatch(/Math\.floor\(\w+ \/ (cfg\.)?splitCount\)/);
      expect(s).not.toMatch(/calcSplitSendTime\(/);
    }
  });

  it('동기 직접발송: 받자마자 검사 · 차감 전에 끝나는 날 한도 · 회차 시각은 CT', () => {
    const s = src('routes/campaigns.ts');
    const body = s.slice(s.indexOf("router.post('/direct-send', async"));
    expect(body.indexOf('parseSplitSetting(splitEnabled, splitCount, splitIntervalMinutes)')).toBeGreaterThan(-1);
    expect(body).toContain("code: 'SPLIT_SPAN_TOO_LONG'");
    expect((body.match(/splitSendTime\(splitBase, i, split\)/g) || []).length).toBe(3); // 문자 1 · 브랜드 1 · 피로도 발송일 1(★0928 차수4 m076)
  });

  it('대량 커밋·자율 공용 길목(createDirectSendCampaign): 검사 + 한도 · 저장 설정에 간격', () => {
    const core = src('utils/direct-send-core.ts');
    expect(core).toContain('parseSplitSetting(spec.splitEnabled, spec.splitCount, spec.splitIntervalMinutes)');
    expect(core).toContain("'SPLIT_SPAN_TOO_LONG'");
    const spec = src('utils/direct-send-spec.ts');
    expect(spec).toContain('splitIntervalMinutes?: number;');
    expect(spec).toContain('splitIntervalMinutes: spec.splitIntervalMinutes,');
    const c = src('routes/campaigns.ts');
    const commit = c.slice(c.indexOf("router.post('/direct-send/commit'"), c.indexOf("router.get('/:id/send-progress'"));
    expect(commit).toContain('splitIntervalMinutes,');
  });

  it('워커: 저장 설정을 너그럽게 읽는 CT로 회차 시각을 매긴다', () => {
    const w = src('utils/direct-send-worker.ts');
    expect(w).toContain('const split = readStoredSplit(cfg);');
    expect(w).toContain('splitSendTime(');
  });

  it('미리보기 조회: /:id 보다 먼저 등록 · 같은 CT', () => {
    const c = src('routes/campaigns.ts');
    const at = c.indexOf("router.get('/split-preview'");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(c.indexOf("router.get('/:id', async"));
    expect(c.slice(at, at + 2500)).toContain('planSplitSchedule(');
  });
});

describe('화면 배선', () => {
  it('풍선: 예시 숫자 없음 · 건수·간격 두 칸 · 시각표는 서버 미리보기', () => {
    const p = front('components/direct-send/SplitSendPopover.tsx');
    expect(p).not.toContain('PRESETS');
    expect(p).toContain('보내는 간격');
    expect(p).toContain('한 번에 보낼 건수');
    expect(p).toContain('fetchSplitPreview(');
    expect(p).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(front('utils/split-send.ts')).toContain('/api/campaigns/split-preview?');
  });

  it('분할 칸 글자 = "N건 · M분마다"(직접발송·알림톡 같은 함수)', () => {
    // ★ 2026-09-29 R112 — 직접발송 발송 바는 공용 부품(SendBar · 직접 타겟 발송 창과 같이 쓴다)
    expect(front('components/DirectSendPanel.tsx')).toContain('<SendBar');
    expect(front('components/direct-send/SendBar.tsx')).toContain('splitTileLabel(splitCount, splitInterval)');
    expect(front('components/AlimtalkSendModal.tsx')).toContain('splitTileLabel(splitCount, splitInterval)');
  });

  it('보낼 때 간격을 싣는다 — 직접발송·타겟 발송·알림톡', () => {
    const d = front('pages/Dashboard.tsx');
    expect(d).toContain('splitIntervalMinutes: isAlimtalk ? (alimSplitEnabled ? alimSplitInterval : null) : (splitEnabled ? splitInterval : null),');
    expect(d).toContain('splitIntervalMinutes: isTargetAlimtalk ? null : (splitEnabled ? splitInterval : null),');
    expect(d).toContain('alimtalkSplitInterval: data.splitInterval,');
    // ★ 2026-09-29 R112 — 타겟 발송 창 발송 바 = 직접발송과 같은 부품(SendBar)이 간격 칸을 소유한다
    const t = front('components/TargetSendModal.tsx');
    expect(t).toContain('<SendBar');
    expect(t).toContain('setSplitInterval={setSplitInterval}');
    expect(front('components/direct-send/SendBar.tsx')).toContain('setSplitInterval(');
  });
});
