/**
 * 여정 · 자동마케팅 핵심 결함 처방 — 순수 · 계약 시험(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md)
 *   CT 하나마다 describe 하나 · 대상은 소스에서 기계로 뽑는다(3-0 표 · 줄 단위 대조).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { SEND_HOURS } from '../../config/defaults';
import {
  NIGHT_ARRIVE_HOUR, BUSINESS_DAY_HOUR, shiftToSendableHour, calculateNextRunAt, dailyFirstRunAt, firstRunAtFor,
  isNightExemptStep, sendWindowStateFor, sendableAt,
} from '../send-time-util';
import { pauseReasonView, MANUAL_PAUSE_REASON, ANCHOR_COMPLETED_PAUSE_REASON, pausedSetSql, pausedCaseSetSql } from '../journey-pause-reason';
import { cdpEventNameMatchSql, netPurchaseSql } from '../cdp-order-revenue';

/** 백엔드 소스(시험 · 검증 파일 제외) 전수 — 계약 시험 대상은 손 목록이 아니라 이 목록에서 뽑는다 */
const SRC_ROOT = join(__dirname, '..', '..');
function sourceFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue; }
      if (!/\.ts$/.test(name) || /\.(test|pg|verify)\.ts$/.test(name)) continue;
      out.push({ rel: relative(SRC_ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(SRC_ROOT);
  return out;
}
/** 주석 줄 · 줄 끝 주석을 뺀 코드 줄(문자열 안 // 는 드물어 시험 목적에 충분) */
function codeLines(text: string): Array<{ n: number; line: string }> {
  const out: Array<{ n: number; line: string }> = [];
  let inBlock = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    let line = raw.replace(/\/\*.*?\*\//g, '');   // 한 줄 안에서 닫히는 주석(/** … */) 지움
    if (inBlock) { const e = line.indexOf('*/'); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
    const s = line.indexOf('/*'); if (s >= 0 && line.indexOf('*/', s) < 0) { line = line.slice(0, s); inBlock = true; }
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//')) return;
    const c = line.search(/\s\/\/\s/); if (c >= 0) line = line.slice(0, c);
    out.push({ n: i + 1, line });
  });
  return out;
}
const CT_TIME = 'utils/send-time-util.ts';

/** KST 벽시계 → UTC Date */
const kst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi, s));

describe('CT-J7 보낼 시각(3-10 · 3-12 · §4 ⑤ ⑥)', () => {
  it('밤 도착 = 발송 창 시작 한 숫자 · 다음 평일 = 9시 따로', () => {
    expect(NIGHT_ARRIVE_HOUR).toBe(SEND_HOURS.start);
    expect(NIGHT_ARRIVE_HOUR).toBe(8);
    expect(BUSINESS_DAY_HOUR).toBe(9);
  });
  it('밤 · 새벽 문자 = 발송 창 시작(8시)', () => {
    expect(shiftToSendableHour(kst(2026, 11, 2, 23))).toEqual(kst(2026, 11, 3, 8));
    expect(shiftToSendableHour(kst(2026, 11, 3, 7, 30))).toEqual(kst(2026, 11, 3, 8));
    expect(shiftToSendableHour(kst(2026, 11, 3, 14))).toEqual(kst(2026, 11, 3, 14));
  });
  it('다음 평일 = 9시(바로 · 하루 묶음 두 갈래 같은 시각)', () => {
    expect(calculateNextRunAt('next_business_day', 0, null, kst(2026, 11, 2, 15))).toEqual(kst(2026, 11, 3, 9));
    expect(dailyFirstRunAt('next_business_day', 0, null, kst(2026, 11, 2, 15))).toEqual(kst(2026, 11, 3, 9));
    expect(dailyFirstRunAt('next_business_day', 0, null, kst(2026, 11, 6, 15))).toEqual(kst(2026, 11, 9, 9));
  });
  it('밤 예외 칸 = 알림톡 · 대체 = 템플릿 글(S · L) · 대체 없음(N)만 · 직접 쓴 대체(A · B)는 문자 규칙', () => {
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: 'N' })).toBe(true);
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: 'S' })).toBe(true);
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: 'L' })).toBe(true);
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: 'A' })).toBe(false);
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: 'B' })).toBe(false);
    expect(isNightExemptStep({ channel: 'kakao', alimtalk_next_type: null })).toBe(true);   // 기본값 = 정규화 함수의 기본
    expect(isNightExemptStep({ channel: 'lms', alimtalk_next_type: 'N' })).toBe(false);
    expect(isNightExemptStep({ channel: 'sms' })).toBe(false);
    // 보내지 않는 칸 = 밀 까닭이 없다(뒤 알림톡이 아침으로 밀리지 않게) · 칸 종류를 안 주면 메시지 칸
    expect(isNightExemptStep({ step_type: 'wait', channel: null })).toBe(true);
    expect(isNightExemptStep({ step_type: 'condition' })).toBe(true);
    expect(isNightExemptStep({ step_type: 'message', channel: 'lms' })).toBe(false);
    expect(isNightExemptStep({ step_type: 'message', channel: 'kakao', alimtalk_next_type: 'B' })).toBe(false);
  });
  it('밤 예외면 밤에도 그 시각 그대로(바로 · 하루 묶음 · 다시 켜기)', () => {
    const night = kst(2026, 11, 2, 23);
    expect(calculateNextRunAt('relative', 0, null, night, { nightExempt: true })).toEqual(night);
    expect(calculateNextRunAt('relative', 0, null, night)).toEqual(kst(2026, 11, 3, 8));
    expect(firstRunAtFor('immediate', 'relative', 0, null, night, { nightExempt: true })).toEqual(night);
    expect(dailyFirstRunAt('specific_hour', 0, 22, kst(2026, 11, 2, 3), { nightExempt: true })).toEqual(kst(2026, 11, 3, 22));
    expect(dailyFirstRunAt('specific_hour', 0, 22, kst(2026, 11, 2, 3))).toEqual(kst(2026, 11, 4, 8));
    expect(sendableAt(night, true)).toEqual(night);
    expect(sendableAt(night, false)).toEqual(kst(2026, 11, 3, 8));
  });
  it('발송 창 판정 = 한 함수(문자 = 창 · 적재 여유 · 밤 예외 = 늘 열림)', () => {
    expect(sendWindowStateFor(kst(2026, 11, 2, 14), false).open).toBe(true);
    const shut = sendWindowStateFor(kst(2026, 11, 2, 22), false);
    expect(shut.open).toBe(false);
    expect(shut.next).toEqual(kst(2026, 11, 3, 8));
    expect(sendWindowStateFor(kst(2026, 11, 2, 22), true).open).toBe(true);
    expect(sendWindowStateFor(kst(2026, 11, 3, 6), false).next).toEqual(kst(2026, 11, 3, 8));
  });
});

describe('CT-J7 배선 — 보낼 시각 판정 · 계산은 send-time-util 밖 0(설계서 3-0 · Harold 「CT 를 쓰는 것 전부 배선」)', () => {
  const files = sourceFiles();
  it('창 판정 · 다음 창 · 밤 도착 사본 정의 0', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.rel === CT_TIME) continue;
      for (const { n, line } of codeLines(f.text)) {
        if (/function\s+(isWithinSendHours|computeNextSendWindow|sendWindowState|nextDayWindowStart|nextDaySendWindowStart|shiftToSendableHour)\b/.test(line)) bad.push(`${f.rel}:${n}`);
        if (/\b(NIGHT_ARRIVE_HOUR|BUSINESS_DAY_HOUR)\b\s*=[^=]/.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('SEND_HOURS 로 시각을 직접 비교 · 맞추는 식 0(판정 = CT · 설정값을 순수 판정 함수에 넘기는 것 · 문구 표기는 허용)', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.rel === CT_TIME || f.rel === 'config/defaults.ts') continue;
      for (const { n, line } of codeLines(f.text)) {
        if (/[<>]=?\s*SEND_HOURS\.(start|end)\b/.test(line) || /SEND_HOURS\.(start|end)\s*[<>]=?/.test(line)) bad.push(`${f.rel}:${n}`);
        if (/setUTCHours\(\s*SEND_HOURS\./.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('여정 파일의 시각 계산 = 밤 예외 여부를 넘긴다 · 발송 창 밀기 직접 호출 0', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /^utils\/journey-[^/]+\.ts$/.test(x.rel))) {
      for (const { n, line } of codeLines(f.text)) {
        if (/\b(calculateNextRunAt|firstRunAtFor|dailyFirstRunAt)\(/.test(line) && !/import /.test(line) && !/nightExempt/.test(line)) bad.push(`${f.rel}:${n}`);
        if (/\bshiftToSendableHour\(/.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('여정 · 자동마케팅 고객 문구의 시각 숫자 0(상수 문구 함수로)', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /^utils\/(journey-|continuous-operator|operator-|automarketing-|autosend-)/.test(x.rel))) {
      for (const { n, line } of codeLines(f.text)) {
        if (/(아침|오전)\s*[0-9]{1,2}\s*시/.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('CT-J2 여정 멈춤 — 멈춤 쓰기는 SET 조각 · 사람 멈춤은 상수(설계서 3-0 · 3-5)', () => {
  const files = sourceFiles();
  /** 템플릿 문자열 안의 `UPDATE journeys …` 문장들(별칭 j 포함 · journey_executions 등 다른 표 제외) */
  const journeyUpdates = (text: string): string[] => {
    const out: string[] = [];
    const re = /`([^`]*?\bUPDATE\s+journeys\b(?!_)[^`]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  };
  it('journeys 를 멈춤으로 만드는 UPDATE = CT 조각을 쓴다(사유 칸을 문장에 직접 쓰지 않는다)', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.rel === 'utils/journey-pause-reason.ts') continue;
      for (const sql of journeyUpdates(f.text)) {
        // SET 절만 본다(WHERE 의 status = 'paused' 는 읽기 · 사유를 NULL 로 비우는 다시 켜기는 멈춤 쓰기가 아니다)
        const afterSet = sql.slice(sql.search(/\bSET\b/) + 3);
        const cut = afterSet.search(/\b(WHERE|RETURNING|FROM)\b/);
        const setPart = cut >= 0 ? afterSet.slice(0, cut) : afterSet;
        const pausesIt = /status\s*=\s*'paused'/.test(setPart) || /pause_reason\s*=(?!\s*NULL)/.test(setPart);
        if (pausesIt && !/\$\{\s*(pausedSetSql|pausedCaseSetSql|setSql)\b/.test(setPart)) bad.push(`${f.rel}: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('조각 = 상태 · 멈춘 시각 · 사유를 한 번에 · 사유는 매개변수', () => {
    const pp: any[] = ['x'];
    expect(pausedSetSql(pp, '사유')).toBe(`status = 'paused', paused_at = NOW(), pause_reason = $2`);
    expect(pp).toEqual(['x', '사유']);
    expect(pausedCaseSetSql('$4::text', '$5::text')).toContain(`WHEN $4::text = 'paused' THEN $5::text`);
  });
  it('사람 멈춤 = 상수 비교 · 날짜 기준 마침 = 마침 · 시스템 멈춤 문장은 사람 멈춤으로 읽히지 않는다', () => {
    expect(pauseReasonView(MANUAL_PAUSE_REASON).kind).toBe('manual');
    expect(pauseReasonView(ANCHOR_COMPLETED_PAUSE_REASON).kind).toBe('completed');
    // 실행기 자동 멈춤에 넘기는 글자(소스에서 뽑음) 전부 = manual · completed 아님
    const ex = files.find((f) => f.rel === 'utils/journey-executor.ts')!.text;
    const lits = [...ex.matchAll(/pauseJourney\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(lits.length).toBeGreaterThan(0);
    for (const t of lits) expect([t, pauseReasonView(t).kind]).not.toEqual([t, 'manual']);
  });
  it('사람 멈춤 입구 두 곳 = 상수(화면이 보낸 글자를 사유로 쓰지 않는다)', () => {
    const ai = files.find((f) => f.rel === 'routes/ai.ts')!.text;
    const route = ai.slice(ai.indexOf("router.post('/operator/journeys/:id/pause'"), ai.indexOf("router.post('/operator/journeys/:id/pause'") + 900);
    expect(route).toContain('MANUAL_PAUSE_REASON');
    expect(route).not.toMatch(/req\.body\??\.reason/);
    const ph = files.find((f) => f.rel === 'utils/journey-pause-handler.ts')!.text;
    expect(ph).toMatch(/pauseJourneyLineage\([^)]*MANUAL_PAUSE_REASON\)/);
  });
});

describe('CT-J3 결제된 구매 — 구매 사건 판정은 CT 밖 0(설계서 3-0 · 3-4 · 취소 · 환불 · 결제 전 = 구매 아님)', () => {
  const files = sourceFiles();
  /** 파일의 템플릿 문자열 문장들 */
  const templates = (text: string): string[] => {
    const out: string[] = [];
    const re = /`([^`]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  };
  /** 관측 · 원천(허용) — 판정이 아니라 「사건이 들어오는가 · 표식」을 보는 자리(3-0 줄 단위 대조 · 이유) */
  const OBSERVE: Record<string, string> = {
    'utils/cdp-order-revenue.ts': 'CT 자신',
    'utils/cdp-orders.ts': '적재 · 표식을 쓰는 원천',
    'utils/customer-purchase-aggregates.ts': '웹훅이 고객 누계를 쓴 표식 보호(★ C99 = 그 판정은 지웠고 회사 갈래 = two-door-purchase netPurchaseSql)',
    'utils/journey-purchase-ledger.ts': '문 안내 = 자사몰 주문이 마지막으로 들어온 때(관측 · ★ C99 문 판정 삭제)',
    'utils/cdp-diagnostics.ts': '수집 감시',
    'utils/mall-integration-monitor.ts': '수집 감시',
    'utils/company-data-profile.ts': '구매 데이터가 있는 회사인가',
    'utils/planner-participation.ts': '고정 이름(PLANNER_JOIN_EVENT) · 구매가 올 수 없음',
  };
  it('구매 이름을 글자로 거르는 SQL = netPurchaseSql · cdpEventNameMatchSql 을 지난다(허용 = 관측 · 이유)', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (OBSERVE[f.rel]) continue;
      for (const sql of templates(f.text)) {
        if (!/event_name\s*(=\s*'purchase'|IN\s*\([^)]*'purchase')/.test(sql) && !/properties->>'items_omitted'/.test(sql)) continue;
        if (/netPurchaseSql\(|cdpEventNameMatchSql\(/.test(sql)) continue;
        if (/ct-observe:/.test(sql)) continue;   // 문장 안 표식 = 판정이 아닌 관측(이유를 그 자리에 적는다)
        bad.push(`${f.rel}: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('사건 이름을 매개변수로 비교하는 SQL = cdpEventNameMatchSql(구매가 오면 같은 판정)', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (OBSERVE[f.rel]) continue;
      for (const sql of templates(f.text)) {
        if (/\bevent_name\s*=\s*\$\d/.test(sql)) bad.push(`${f.rel}: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('조각 = 이름이 같고 · 구매면 결제된 구매까지 · 매개변수 형 한 번(text)', () => {
    const sql = cdpEventNameMatchSql('e', '$2');
    expect(sql).toContain(`e.event_name = $2::text`);
    expect(sql).toContain(`$2::text <> 'purchase'`);
    expect(sql).toContain(netPurchaseSql('e'));
  });
  it('3-4 ② 진입 뒤 취소 = 구매로 시작한 여정의 칸 처리 앞에서 끝(문자 · 대기 · 조건 공통 · 판정 = journey-goal-purchase · 결제된 구매 조각)', async () => {
    const { ENTRY_PURCHASE_VOIDED_SQL } = await import('../journey-goal-purchase');
    expect(ENTRY_PURCHASE_VOIDED_SQL).toContain(`NOT ${netPurchaseSql('ev')}`);
    expect(ENTRY_PURCHASE_VOIDED_SQL).toContain("e.entry_event_properties->'__entry'->>'src' = 'trigger'");
    const ex = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'journey-executor.ts'), 'utf8')).map((l) => l.line).join('\n');
    const fn = ex.slice(ex.indexOf('async function processStepBatch('), ex.indexOf('\n}\n', ex.indexOf('async function processStepBatch(')));
    const at = fn.indexOf('const voided = await query(ENTRY_PURCHASE_VOIDED_SQL,');
    expect(at).toBeGreaterThan(-1);
    expect(fn).toContain("if (getTriggerContract(String(head.trigger_event || ''))?.purchaseStream) {");
    expect(fn).toContain("await logStepMany([...endedIds], step.id, 'skipped', 'order_cancelled');");
    expect(fn).toContain("`UPDATE journey_executions SET status = 'ended', completed_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'active' RETURNING id`");
    for (const go of ['return processWaitBatch(', 'return processConditionBatch(', 'return processMessageBatch(']) expect(at).toBeLessThan(fn.indexOf(go));
    // 조회 실패 = 던진다(취소된 주문에 보내지 않는 쪽) — 그 문장에 catch 를 달지 않는다
    expect(fn.slice(at, fn.indexOf(';', at))).not.toMatch(/\.catch\(/);
  });
});

describe('CT 조각 별칭 정합 — 조각에 넘긴 이름 = 그 문장이 정한 이름(★ 1102 실 PG 가 잡은 journey-opportunities 「FROM customers c」 + customers 참조)', () => {
  const FRAG = /\$\{(netPurchaseSql|cdpEventNameMatchSql|newSignupSql|journeyClickSql|journeySignupSinceSql|journeyStepIsAdSql|purchasedSinceEntrySql)\('(\w+)'/g;
  const DEF = new Set(['utils/cdp-order-revenue.ts', 'utils/customer-joined-at.ts', 'utils/journey-click.ts', 'utils/journey-ad-policy.ts', 'utils/journey-goal-purchase.ts']);
  const KW = new Set(['where', 'join', 'left', 'right', 'inner', 'full', 'cross', 'on', 'group', 'order', 'limit', 'using', 'union', 'having', 'window', 'for', 'as', 'set', 'returning', 'and', 'or']);
  const TABLES = new Set(['customers', 'cdp_events', 'journeys', 'journey_steps', 'journey_executions', 'purchases']);
  /** 조각을 돌려주는 함수(그 별칭의 FROM 은 부르는 쪽 문장) · 이유 · 실 PG 로 돈 자리 */
  const ALIAS_FROM_CALLER: Record<string, string> = {
    "utils/automarketing-segment.ts c": '축 조건 조각 = 대상 SQL(FROM customers c · operator-audience)에 붙는다 · 실 PG = core-fix-sql-1102 새로 가입 축 셈',
  };
  /** 그 조각 자리 앞뒤 문장 창(같은 쿼리 = 앞 SQL 시작 · 뒤 끝까지 · 넉넉히) */
  const windowOf = (text: string, at: number) => text.slice(Math.max(0, at - 2500), at + 1500);
  it('별칭 이름 = 창 안 FROM · JOIN · 묶음 뒤에 정해져 있다 · 표 이름 = 그 창에서 그 표에 별칭이 없다', () => {
    const bad: string[] = [];
    let sites = 0;
    for (const f of sourceFiles()) {
      if (DEF.has(f.rel)) continue;
      for (const m of f.text.matchAll(FRAG)) {
        sites++;
        const a = m[2];
        const win = windowOf(f.text, m.index!);
        if (TABLES.has(a)) {
          // 그 자리에서 가장 가까운 그 표의 FROM · JOIN(앞 · 뒤 · SELECT 목록 자리면 FROM 이 뒤에 온다) = 그 문장 · 거기 별칭이 있으면 표 이름 참조는 틀림
          const here = m.index! - Math.max(0, m.index! - 2500);
          const occ = [...win.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+${a}\\b(?:\\s+(?:AS\\s+)?(\\w+))?`, 'gi'))];
          const near = occ.sort((x, y) => Math.abs(x.index! - here) - Math.abs(y.index! - here))[0];
          if (!near) bad.push(`${f.rel}: ${m[1]}('${a}') · 그 표의 FROM · JOIN 이 없다`);
          else if (near[1] && !KW.has(near[1].toLowerCase())) bad.push(`${f.rel}: ${m[1]}('${a}') · 그 표에 별칭(${near[1]})이 있다`);
        } else if (ALIAS_FROM_CALLER[`${f.rel} ${a}`]) {
          continue;
        } else {
          const declared = new RegExp(`(?:\\b(?:FROM|JOIN)\\s+(?:LATERAL\\s+)?\\w+\\s+(?:AS\\s+)?${a}\\b)|(?:\\)\\s+(?:AS\\s+)?${a}\\b)|(?:\\}\\s+(?:AS\\s+)?${a}\\b)`, 'i').test(win);
          if (!declared) bad.push(`${f.rel}: ${m[1]}('${a}') · 그 별칭을 정한 FROM · JOIN 이 없다`);
        }
      }
    }
    expect(sites).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});

describe('CT-J1 보낼 판 — 최신 판 읽기 · 신뢰도 칸 · 보낼 수 있는가 판정은 CT 밖 0(설계서 3-0 · 3-18)', () => {
  const files = sourceFiles();
  /** 판 쓰기 · 판정 · 읽기 조각 파일(신뢰도 칸 이름을 쓰는 자리 · 이유) */
  const CONFIDENCE_OWNERS: Record<string, string> = {
    'utils/journey-step-versions.ts': '판 읽기 조각(latestSnapshotSql · 별칭 confidence 로 준다)',
    'utils/journey-pretest-notifier.ts': '판정 조각(stepSendableSql) · 검사 결과 쓰기',
    'utils/journey-builder.ts': '판 쓰기(INSERT · 켤 때 100 · 켠 뒤 고치기 0)',
    'utils/journey-pretest-candidate.ts': '판 쓰기(수정안 반영 = 새 판 100 · 후보 검사가 그 글로 통과 · CT-J12)',
  };
  it('신뢰도 칸 이름(confidence_score) = 판 쓰기 · 판정 · 읽기 조각 파일 밖 0', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (CONFIDENCE_OWNERS[f.rel]) continue;
      for (const { n, line } of codeLines(f.text)) if (/confidence_score/.test(line)) bad.push(`${f.rel}:${n}`);
    }
    expect(bad).toEqual([]);
  });
  it('「그 칸 최신 판」 읽기(스냅샷 표 · created_at 늦은 순) = latestSnapshotSql 밖 0', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.rel === 'utils/journey-step-versions.ts') continue;
      const code = codeLines(f.text).map((l) => l.line).join('\n');
      if (/FROM\s+journey_step_snapshots[\s\S]{0,300}?ORDER\s+BY\s+[\w.]*created_at\s+DESC/i.test(code)) bad.push(f.rel);
    }
    expect(bad).toEqual([]);
  });
  it('판정 조각 = 최신 판 = 넘긴 판 · 그 판 신뢰도 100 · 보류 아님(같은 읽기 조각 · 보류 조각)', async () => {
    const { latestSnapshotSql } = await import('../journey-step-versions');
    const { stepSendableSql, stepHeldSql } = await import('../journey-pretest-notifier');
    const sql = stepSendableSql('j.id', '$2::uuid', '$5::uuid');
    expect(sql).toContain(`(SELECT ls_s.id FROM ${latestSnapshotSql('j.id', '$2::uuid')} ls_s) IS NOT DISTINCT FROM $5::uuid`);
    expect(sql).toMatch(/WHERE ss_c\.id = \$5::uuid\), 100\) >= 100/);
    expect(sql).toContain(`AND NOT ${stepHeldSql('j.id', '$2::uuid')}`);
  });
  it('실행기 = 본문을 읽은 판 id 를 선점 문장까지 들고 간다(문자 칸 = 선점 매개변수 $5)', () => {
    const ex = readFileSync(join(SRC_ROOT, 'utils', 'journey-executor.ts'), 'utf8');
    expect(ex).toContain('snapshotId = snap.id ? String(snap.id) : null;');
    expect(ex).toContain('return processMessageBatch(execs, step, res, { pendingSnapshotAt, snapshotReadFailed, snapshotId });');
    expect(ex).toContain('variantByExec, snapshotId: snap.snapshotId }, res)');
    expect(ex).toContain('textStep ? [unit.map((r) => r.exec.execution_id), step.id, campaignId, c.sendCost, c.snapshotId]');
  });
});

describe('CT-J4 날짜 기준 · 한 번 보내기 = (여정 · 칸 · 날) 뽑기 한 번 · 상한 멈춤은 잠금 안(설계서 3-17 · Codex 설계 3R · 4R #1)', () => {
  const src = readFileSync(join(SRC_ROOT, 'utils', 'journey-anchor-scheduler.ts'), 'utf8');
  const code = codeLines(src).map((l) => l.line).join('\n');
  const body = (fn: string) => { const at = code.indexOf(fn); expect(at, fn).toBeGreaterThan(-1); return code.slice(at, code.indexOf('\n}\n', at)); };
  /** 순서 = 잠금 → 이미 뽑았나(멱등) → 상한 셈 → 멈춤 → 넣기 · 멈춤 쓰기 = 잠금 뒤에만 */
  const order = (b: string, idem: string) => {
    const lock = b.indexOf('await lockEntryIfActive(client,');
    const again = b.indexOf(idem);
    const count = b.indexOf('Number(cap) + 1, scopeSql, consent)');
    const pause = b.indexOf('pausedSetSql(');
    const ins = b.indexOf('INSERT INTO journey_executions');
    expect([lock, again, count, pause, ins].every((x) => x > -1)).toBe(true);
    expect(lock).toBeLessThan(again);
    expect(again).toBeLessThan(count);
    expect(count).toBeLessThan(pause);
    expect(pause).toBeLessThan(ins);
    expect(b.match(/pausedSetSql\(/g)).toHaveLength(1);
    expect(b.slice(pause - 200, pause)).toContain('await client.query(');   // 멈춤 = 넣기 트랜잭션 연결(잠금을 쥔 채)
    // 잠금 앞 셈 = 대상이 있는가만(LIMIT 1 · 빠른 길)
    expect(b.slice(0, lock)).toMatch(/selectAnchorAudienceIds\([^;]*, 1, scopeSql, consent\)\)\.length === 0\)/);
  };
  it('날짜 기준 칸: 잠금 → 「이 칸 · 이날 이미 뽑았나」(같은 함수 · 트랜잭션 연결) → 상한 → 넣기', () => {
    order(body('export async function dispatchAnchorStep('), 'await anchorStepDispatched(j.id, step.id, sendDate, (t, p) => client.query(t, p))');
  });
  it('한 번 보내기: 잠금 → 「실행이 이미 있나」 → 상한 → 넣기', () => {
    order(body('export async function dispatchOneShotJourney('), "const again = await client.query(`SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid LIMIT 1`, [journeyId]);");
  });
  it('「이미 뽑았나」 판정 = anchorStepDispatched 한 함수(표식 표를 읽는 곳 = 그 함수 · 넣기 문장 ON CONFLICT 뿐)', () => {
    const reads = codeLines(src).filter((l) => /FROM journey_anchor_dispatch\b/.test(l.line));
    expect(reads).toHaveLength(1);
    expect(body('export async function anchorStepDispatched(')).toContain('FROM journey_anchor_dispatch');
  });
});

describe('CT-J8 광고 판정 — 저장값 is_ad 를 직접 판정하는 자리 = CT 밖 0 · 알림톡 = 정보성 · 화면 사본 = 같은 함수(설계서 3-11)', () => {
  const RAW_AD = /\bis_ad\s*(?:!==|===|IS\s+DISTINCT\s+FROM|=)\s*(?:false|true)\b|!!\s*[\w.]+\.is_ad\b|\.isAd\s*!==\s*undefined/i;
  it('서버 여정 · 상황판 파일: is_ad 직접 판정 0(판정 = resolveJourneyAdFlag · journeyStepIsAdSql)', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      if (!/^utils\/(journey-|manager-board)/.test(f.rel) || f.rel === 'utils/journey-ad-policy.ts') continue;
      for (const { n, line } of codeLines(f.text)) {
        if (!RAW_AD.test(line)) continue;
        if (f.rel === 'utils/journey-builder.ts' && /patch\.isAd !== undefined \? !!patch\.isAd : null/.test(line)) continue;   // 칸 PATCH 저장 값(쓰기 · 읽을 때 CT 가 다시 판정)
        bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('화면 여정 파일: is_ad 직접 판정 0 · 「isAd !== false」 = 저장 값 정규화(쓰기) 자리만', () => {
    const FE = join(SRC_ROOT, '..', '..', 'frontend', 'src');
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const rel = relative(FE, p).split('\\').join('/');
        if (!/journey/i.test(rel) || rel === 'utils/journey-ad-policy.ts') continue;
        for (const { n, line } of codeLines(readFileSync(p, 'utf8'))) {
          if (/\.is_ad\s*(?:!==|===)/.test(line)) out.push(`${rel}:${n}`);
          // 쓰기 정규화 = 칸 PATCH 몸통 · 저장 정의(서버가 읽을 때 CT 로 다시 판정)
          if (/isAd\s*!==\s*false/.test(line) && !/out\.isAd = b\.isAd !== false|isAd: s\.isAd !== false, delayHours/.test(line)) out.push(`${rel}:${n}`);
        }
      }
    };
    walk(FE);
    expect(out).toEqual([]);
  });
  it('화면 사본 = 서버 함수(채널 × 저장값 표 전부 같다) · 알림톡 = 늘 정보성', async () => {
    const be = await import('../journey-ad-policy');
    const fe = await import('../../../../frontend/src/utils/journey-ad-policy');
    for (const ch of ['sms', 'lms', 'mms', 'kakao', 'KAKAO', ' kakao ', '', null, undefined]) {
      for (const flag of [true, false, null, undefined]) {
        expect(fe.resolveJourneyAdFlag(ch as any, flag as any), `${ch}/${flag}`).toBe(be.resolveJourneyAdFlag(ch as any, flag as any));
      }
    }
    expect(be.resolveJourneyAdFlag('kakao', true)).toBe(false);
    expect(be.resolveJourneyAdFlag('lms', false)).toBe(true);
  });
  it('SQL 조각 = 같은 규칙(채널만 · 저장값 0) · 여정 지도 「마케팅 여정」 = 조각', async () => {
    const { journeyStepIsAdSql } = await import('../journey-ad-policy');
    const { MARKETING_JOURNEY_SQL } = await import('../journey-lifecycle-map');
    expect(journeyStepIsAdSql('ms')).not.toMatch(/is_ad/);
    expect(MARKETING_JOURNEY_SQL).toContain(journeyStepIsAdSql('ms'));
    expect(MARKETING_JOURNEY_SQL).not.toMatch(/is_ad/);
  });
  it('수신 거름: 정보성 칸 = 활성 · 번호 유효만(광고 동의 · 광고 거부는 광고 칸만 · §4 ⑦)', async () => {
    const { isCustomerSendable } = await import('../journey-safety-filter');
    const noConsent = { is_active: true, sms_opt_in: false, is_opt_out: true, is_invalid: false };
    expect(isCustomerSendable(noConsent)).toBe(false);
    expect(isCustomerSendable(noConsent, { informational: true })).toBe(true);
    expect(isCustomerSendable({ ...noConsent, is_invalid: true }, { informational: true })).toBe(false);
    expect(isCustomerSendable({ ...noConsent, is_active: false }, { informational: true })).toBe(false);
    const ex = readFileSync(join(SRC_ROOT, 'utils', 'journey-executor.ts'), 'utf8');
    expect(ex).toContain('{ informational: !isAd })) return { kind: \'skip\', reason: \'opt_out_or_inactive\' };');
    expect(ex).toContain("if (isAd && unsubPhones.has(String(customer.phone))) return { kind: 'skip', reason: 'unsubscribed' };");
  });
});

describe('CT-J9 여정 링크 클릭 — 클릭 판정은 journeyClickSql 밖 0(그 여정 · 그 칸 링크 · 설계서 3-15 · D12 · D13)', () => {
  /** 관측(허용 · 이유) — 판정이 아니라 고객 활동 시간대 */
  const OBSERVE = /ct-observe:/;
  it("여정 · 상황판 파일 SQL 에서 'message_click' 글자 = CT 파일 · 관측 표식 줄 밖 0", () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      if (!/^utils\/(journey-|manager-board)/.test(f.rel) || f.rel === 'utils/journey-click.ts') continue;
      for (const { n, line } of codeLines(f.text)) {
        if (/'message_click'/.test(line) && !OBSERVE.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('조각 = 이름 · 회사 · 여정 id · (칸 id) 글자 비교', async () => {
    const { journeyClickSql } = await import('../journey-click');
    const sql = journeyClickSql('ce', { companyExpr: '$3::uuid', journeyExpr: 'je.journey_id', stepExpr: '$2::uuid' });
    expect(sql).toContain("ce.event_name = 'message_click'");
    expect(sql).toContain('ce.company_id = $3::uuid');
    expect(sql).toContain("ce.properties->>'journey_id' = (je.journey_id)::text");
    expect(sql).toContain("ce.properties->>'step_id' = ($2::uuid)::text");
    expect(journeyClickSql('ce', { companyExpr: 'x', journeyExpr: 'y' })).not.toContain('step_id');
  });
  it('실행기 목표 클릭 · 옛 앞 칸 클릭 · 이 칸 링크 = 칸 id 까지 좁힌 조각 · AI 지시문 = 새 조건 · 옛 꼴 = 새 조건으로 저장', () => {
    const ex = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'journey-executor.ts'), 'utf8')).map((l) => l.line).join('\n');
    expect(ex.match(/journeyClickSql\('ce', \{ companyExpr: '\$\d::uuid', journeyExpr: 'je\.journey_id', stepExpr: '(?:jsl\.step_id|\$2::uuid)' \}\)/g)).toHaveLength(3);
    const b = readFileSync(join(SRC_ROOT, 'utils', 'journey-builder.ts'), 'utf8');
    expect(b).not.toContain('3. journey_step_clicked:');
    expect(b).toContain('3. step_link_clicked: {"type":"step_link_clicked","step_ref_order"');
    expect(b).toContain("base.conditionJsonb = s.conditionJsonb.type === 'journey_step_clicked'");
  });
});

describe('CT-J10 보낼 글 — 채울 자리 · 없는 변수 · 장바구니 변수 · 제목 변수 판정 한 곳 · 켜기 · 검증 · 칸 저장 · 보내기 전 검사 · 실행기가 부른다(설계서 3-3 · 3-13)', () => {
  it('결정 표', async () => {
    const { journeyCopyIssue } = await import('../send-placeholder-gate');
    const known = new Set(['고객명', '등급']);
    const ctx = { knownVarNames: known, cartJourney: false };
    expect(journeyCopyIssue({ bodies: ['%고객명%님 [혜택 안내: 직접 수정해주세요]'], subjects: [] }, ctx)?.code).toBe('PLACEHOLDER_UNEDITED');
    expect(journeyCopyIssue({ bodies: ['%고객명%님 %쿠폰코드% 드려요'], subjects: [] }, ctx)?.code).toBe('UNKNOWN_VARIABLE');
    expect(journeyCopyIssue({ bodies: ['%고객명%님 %쿠폰코드% 드려요'], subjects: [] }, ctx)?.message).toContain('%쿠폰코드%');
    expect(journeyCopyIssue({ bodies: ['30%할인+10%적립 %고객명%님'], subjects: [] }, ctx)).toBeNull();   // 퍼센트 글자 ≠ 변수(치환과 같은 쪼개기)
    expect(journeyCopyIssue({ bodies: ['담은 {{ cart.product_name }} 잊지 마세요'], subjects: [] }, ctx)?.code).toBe('CART_VARIABLE');
    expect(journeyCopyIssue({ bodies: ['담은 {{ cart.product_name }} 잊지 마세요'], subjects: [] }, { ...ctx, cartJourney: true })).toBeNull();
    expect(journeyCopyIssue({ bodies: ['안녕하세요'], subjects: ['%고객명%님께'] }, ctx)?.code).toBe('SUBJECT_VARIABLE');
    expect(journeyCopyIssue({ bodies: ['%고객명%님 %등급% 혜택'], subjects: ['가을 안내'] }, ctx)).toBeNull();
  });
  it('없는 변수 = 치환(replaceVariables)이 실제로 지우는 이름과 같다', async () => {
    const { replaceVariables } = await import('../messageUtils');
    const { unknownVarNames } = await import('../var-tokens');
    const maps: any = { 고객명: { column: 'name', type: 'string' } };
    const text = '%고객명%님 %쿠폰코드% 드려요 50%할인';
    const out = replaceVariables(text, { name: '홍' }, maps, undefined, { skipLiquid: true });
    expect(unknownVarNames(text, new Set(Object.keys(maps)))).toEqual(['쿠폰코드']);
    expect(out).toBe('홍님  드려요 50%할인');   // 판정이 고른 이름만 빈칸이 된다
  });
  it('판정 호출 자리 = 켜기 · 켜기 검증 · 켜진 칸 저장(409) · 보내기 전 검사(유료 검사 앞) · 실행기(효과 자리) · 안내 문구', () => {
    const rd = (f: string) => codeLines(readFileSync(join(SRC_ROOT, 'utils', f), 'utf8')).map((l) => l.line).join('\n');
    const b = rd('journey-builder.ts');
    const gate = b.slice(b.indexOf('async function activationBlockCore('), b.indexOf('\n}\n', b.indexOf('async function activationBlockCore(')));   // ★ C104 G1 관문 본체 · 판정 = 나갈 판마다
    expect(gate).toContain('journeyCopyIssue({ bodies: [body], subjects: [ver.subject] }');
    // 켜진 칸 저장(사람이 고침) = 저장 뒤 같은 트랜잭션에서 판정 · 채우기 길 = 판정 밖(자리를 줄이는 일 · 남은 칸 = 실행기 보류)
    const chk = b.slice(b.indexOf('async function assertStepCopySendable('), b.indexOf('\n}\n', b.indexOf('async function assertStepCopySendable(')));
    expect(chk).toContain("if (ci) throw new JourneyStepGateError(ci.message, 'COPY_ISSUE');");
    const upd = b.slice(b.indexOf('export async function updateJourneyStep('), b.indexOf('\n}\n', b.indexOf('export async function updateJourneyStep(')));
    expect(upd.indexOf('await assertStepCopySendable(run, companyId, stepId);')).toBeGreaterThan(upd.indexOf('const out = await applyStepPatchInLock(run, journey, companyId, journeyId, stepId, patch);'));
    expect((b.match(/assertStepCopySendable\(/g) || []).length).toBe(2);   // 정의 + 부르는 곳 하나
    const patch = b.slice(b.indexOf('export async function applyStepPatchInLock('), b.indexOf('\n}\n', b.indexOf('export async function applyStepPatchInLock(')));
    expect(patch).not.toContain('COPY_ISSUE');
    expect(rd('journey-pretest-validator.ts')).toContain('journeyCopyIssue({ bodies: [msg.body], subjects: [msg.subject] }');
    const n = rd('journey-pretest-notifier.ts');
    const pb = n.slice(n.indexOf('async function processBundle('), n.indexOf('\n}\n', n.indexOf('async function processBundle(')));
    expect(pb.indexOf('journeyCopyIssue(')).toBeGreaterThan(-1);
    expect(pb.indexOf('journeyCopyIssue(')).toBeLessThan(pb.indexOf('runStepSpamTest('));   // 유료 검사 전
    expect(n).toContain("const copy = mode === 'pretest_held' ? await journeyStepCopyIssueNow(");
    const ex = rd('journey-executor.ts');
    const mb = ex.slice(ex.indexOf('async function processMessageBatch('), ex.indexOf('async function applyRowOutcomes('));
    expect(mb.indexOf('const copyIssue = journeyCopyIssue(')).toBeGreaterThan(-1);
    expect(mb.indexOf('const copyIssue = journeyCopyIssue(')).toBeLessThan(mb.indexOf('const custRes = await query('));
    expect(mb).toContain('await holdStepForCopyIssue(');
  });
  it('여정 파일에서 채울 자리 · 변수 판정 정규식을 따로 쓰지 않는다(판정 = send-placeholder-gate · var-tokens · liquid-templating)', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      if (!/^utils\/journey-/.test(f.rel)) continue;
      for (const { n, line } of codeLines(f.text)) {
        if (/\\\{\\\{\\s\*cart\\\.|\(직접\|작성해\|수정해\|입력해|%\(\[가-힣/.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('CT-J11 기준선 — 심는 판정 · 심기 = 한 곳 · 켜기 트랜잭션 안(설계서 3-5 ② · 3-6)', () => {
  it('결정 표: 초안 · 사람 멈춤 재개 · 떼기 = 심음 · 시스템 멈춤 재개 = 안 심음', async () => {
    const { baselineReseedDue } = await import('../journey-entry-ledger');
    const { MANUAL_PAUSE_REASON } = await import('../journey-pause-reason');
    expect(baselineReseedDue({ status: 'draft', pauseReason: null })).toBe(true);
    expect(baselineReseedDue({ status: 'paused', pauseReason: MANUAL_PAUSE_REASON })).toBe(true);
    expect(baselineReseedDue({ status: 'paused', pauseReason: null })).toBe(true);   // 옛 빈 사유 = 사람 멈춤
    expect(baselineReseedDue('detach')).toBe(true);
    expect(baselineReseedDue({ status: 'paused', pauseReason: '잔액 부족' })).toBe(false);
    expect(baselineReseedDue({ status: 'paused', pauseReason: '대량 진입 감지 (3건 > 상한 1건). 자동 정지, 담당자 확인 필요' })).toBe(false);
  });
  it('두 심기 함수를 부르는 자리 = CT(reseedOnActivate) 밖 0 · 기준 시각은 심을 때마다 지금', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      if (f.rel === 'utils/journey-entry-ledger.ts') continue;
      for (const { n, line } of codeLines(f.text)) if (/\bseed(?:Baseline|GradeState)ForJourney\(/.test(line)) bad.push(`${f.rel}:${n}`);
    }
    expect(bad).toEqual([]);
    const led = readFileSync(join(SRC_ROOT, 'utils', 'journey-entry-ledger.ts'), 'utf8');
    expect(led.match(/UPDATE journeys SET entry_baseline_at = NOW\(\) WHERE id = \$1::uuid`/g)).toHaveLength(2);
    expect(led).not.toContain('entry_baseline_at IS NULL');
  });
  it('켜기 = 잠근 행의 옛 상태 · 멈춘 이유로 판정 · active 로 바꾸기 전 · 같은 트랜잭션 · 실패 = 되돌림', () => {
    const b = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'journey-builder.ts'), 'utf8')).map((l) => l.line).join('\n');
    const fn = b.slice(b.indexOf('export async function activateJourney('), b.indexOf('\n}\n', b.indexOf('export async function activateJourney(')));
    const lock = fn.indexOf('await lockLineageEntry(actClient, journeyId);');
    const prev = fn.indexOf('paused_at::text AS paused_raw, start_kind, pause_reason, trigger_event FROM journeys');
    const seed = fn.indexOf('await reseedOnActivate((t, p) => actClient.query(t, p), journeyId, companyId, prev.trigger_event,');
    const upd = fn.indexOf("status = 'active',");
    expect([lock, prev, seed, upd].every((x) => x > -1)).toBe(true);
    expect(lock).toBeLessThan(prev);
    expect(prev).toBeLessThan(seed);
    expect(seed).toBeLessThan(upd);
    expect(fn.slice(seed, upd)).toContain("await actClient.query('ROLLBACK');");
  });
  it('다시 켜기 커서 · 기준선 = 같은 사람 멈춤 판정(isHumanPause)', () => {
    const r = readFileSync(join(SRC_ROOT, 'utils', 'journey-resume.ts'), 'utf8');
    expect(r).toContain('const human = isHumanPause(prev.pauseReason ?? null);');
    expect(r).toContain('if (human) await run.query(RESUME_CURSOR_SQL, [journeyId, approvedAt]);');
    const led = readFileSync(join(SRC_ROOT, 'utils', 'journey-entry-ledger.ts'), 'utf8');
    expect(led).toContain("return from.status !== 'paused' || isHumanPause(from.pauseReason);");
  });
});

describe('D2 · 3-12 지움 — 하루 묶음 이상치 관문 · 다시 켜기 일 단위 밀기 = 0', () => {
  it('소스에 없다', () => {
    const bad = sourceFiles().filter((f) => /dailyVolumeGate|DAILY_VOLUME_GATE|daily_volume_gate|RESUME_SHIFT_SQL/.test(codeLines(f.text).map((l) => l.line).join('\n'))).map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});

describe('CT-J6 가입 근거 — 고객 행 쓰기 · 신규 판정 = customer-joined-at 한 곳(설계서 3-6 · D19 · D20)', () => {
  it('고객 행을 만드는 문장(INSERT INTO customers) = 가입 근거 칸을 이른 값으로 쓴다', () => {
    const inserts = sourceFiles().filter((f) => /INSERT INTO customers\s*\(/.test(f.text)).map((f) => f.rel).sort();
    expect(inserts).toEqual(['utils/cdp-identity.ts', 'utils/customer-upsert.ts']);
    const up = readFileSync(join(SRC_ROOT, 'utils', 'customer-upsert.ts'), 'utf8');
    expect(up).toContain("['joined_at', joinedAtUpsertSql('customers.joined_at', 'EXCLUDED.joined_at')],");
    expect(up).toMatch(/updateExclusions = new Set\(\[[\s\S]*'joined_at',/);
    const id = readFileSync(join(SRC_ROOT, 'utils', 'cdp-identity.ts'), 'utf8');
    expect(id).toContain("joined_at = ${joinedAtUpsertSql('customers.joined_at', 'EXCLUDED.joined_at')},");
  });
  it('신규 가입 여정 기준 시각 = journeySignupSinceSql 한 곳(시각 있음 = 기준선 시각 · 날짜뿐 = 그날 KST 시작 · 72시간) · 대상 SQL 이 부른다', async () => {
    const { journeySignupSinceSql, joinedAtDateOnlySql } = await import('../customer-joined-at');
    const sql = journeySignupSinceSql('c', 'B');
    expect(sql).toContain(`CASE WHEN ${joinedAtDateOnlySql('c')} THEN ((((B) AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul') ELSE (B) END`);
    expect(sql).toContain("NOW() - INTERVAL '72 hours'");
    const ex = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'journey-target-extractor.ts'), 'utf8')).map((l) => l.line).join('\n');
    expect(ex).toContain("const since = journeySignupSinceSql('c', `(SELECT entry_baseline_at FROM journeys WHERE id = ${jRef})`);");
    expect(ex).not.toMatch(/entry_baseline_at[^\n]*AT TIME ZONE/);   // 기준 시각 규칙을 대상 파일에서 따로 만들지 않는다
  });
  it('이미 있는 몰 고객(연결 · 번호 · 이메일로 찾음) 갱신도 가입 시각 = 이른 값 · 처음 만든 행 가입 시각 = 업서트와 같은 트랜잭션(run)(Codex 구현 1R)', () => {
    const id = readFileSync(join(SRC_ROOT, 'utils', 'cdp-identity.ts'), 'utf8');
    const sync = id.slice(id.indexOf('async function syncCustomerFields('), id.indexOf('\n}\n', id.indexOf('async function syncCustomerFields(')));
    expect(sync).toContain("joined_at = ${joinedAtUpsertSql('customers.joined_at', '$11::timestamptz')},");
    expect(sync).toContain('joinedAtFromSource(input.joinedAt),   // $11');
    const calls: string[] = [];
    for (const f of sourceFiles()) for (const m of f.text.matchAll(/stampFirstSeenJoinedAt\(([^,]+),/g)) if (!f.rel.endsWith('customer-joined-at.ts')) calls.push(`${f.rel}: ${m[1]}`);
    expect(calls.length).toBeGreaterThanOrEqual(7);
    expect(calls.filter((c) => !c.endsWith(': run'))).toEqual([]);
    const c = readFileSync(join(SRC_ROOT, 'routes', 'customers.ts'), 'utf8');
    expect(c).toContain('if (isMissingSchemaError(chunkErr)) throw chunkErr;');
  });
  it('고객 추가 주소(한 명 · 일괄) = 칸이 없으면 503 DB_MIGRATION_PENDING(db_alter_safety_net · 판정 = db-errors 한 곳)', () => {
    const c = readFileSync(join(SRC_ROOT, 'routes', 'customers.ts'), 'utf8');
    const n = (c.match(/if \(isMissingSchemaError\(error\)\) return res\.status\(503\)\.json\(migrationPendingBody\('customers\.joined_at/g) || []).length;
    expect(n).toBe(2);
  });
  it('이른 값 = 한쪽 NULL 이면 다른 쪽(지우기 · 덮어쓰기 0)', async () => {
    const { joinedAtUpsertSql, joinedAtFromSource } = await import('../customer-joined-at');
    expect(joinedAtUpsertSql('o', 'n')).toBe('LEAST(COALESCE(n, o), COALESCE(o, n))');
    expect(joinedAtFromSource('2026-11-02T15:00:00+09:00')).toBe('2026-11-02T06:00:00.000Z');   // 시각까지(날짜만 남기지 않는다)
    expect(joinedAtFromSource('')).toBeNull();
    expect(joinedAtFromSource('아님')).toBeNull();
  });
  it('받은 시각을 가입으로 찍는 길 = 싱크 incremental · 화면 추가 · 엑셀 신규로 올리기뿐', () => {
    const users = sourceFiles().filter((f) => f.rel !== 'utils/customer-joined-at.ts' && /stampFirstSeenJoinedAt\(/.test(codeLines(f.text).map((l) => l.line).join('\n'))).map((f) => f.rel).sort();
    expect(users).toEqual(['routes/customers.ts', 'routes/sync.ts', 'routes/upload.ts']);
    const sync = readFileSync(join(SRC_ROOT, 'routes', 'sync.ts'), 'utf8');
    expect(sync.match(/if \(mode === 'incremental'\) await stampFirstSeenJoinedAt\(/g)).toHaveLength(2);
    const upload = readFileSync(join(SRC_ROOT, 'routes', 'upload.ts'), 'utf8');
    expect(upload.match(/if \(asNewCustomers\) await stampFirstSeenJoinedAt\(/g)).toHaveLength(2);
    expect(upload).toContain('const asNewCustomers = req.body?.asNewCustomers === true;');
  });
  it('여정 · 자동마케팅 · 추천 · 다음 행동에서 「신규 · 새로」를 created_at 으로 가르지 않는다(가입 근거 조각)', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      if (!/^utils\/(journey-|automarketing|operator-|next-action|continuous-operator)/.test(f.rel)) continue;
      for (const { n, line } of codeLines(f.text)) {
        if (/\b(?:c\.)?created_at\s*(?:>=?|>)\s*(?:NOW\(\)|\$\d)/.test(line) && /customers|\bc\.created_at/.test(line)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
    const ext = readFileSync(join(SRC_ROOT, 'utils', 'journey-target-extractor.ts'), 'utf8');
    expect(ext).not.toMatch(/buildExistingCustomerPredicate|existingPred/);
    expect(readFileSync(join(SRC_ROOT, 'utils', 'automarketing-segment.ts'), 'utf8')).toContain("return `AND ${newSignupSql('c', `$${params.length}::timestamptz`)}`;");
  });
  it('켜기 판정 근거 = 가입 근거 칸만(구매 수 · 포인트는 근거 아님)', async () => {
    const { resolveNewCustomerJudgement } = await import('../journey-identity-signals');
    expect(resolveNewCustomerJudgement({ hasPurchaseCount: true, hasPoints: true }).canJudge).toBe(false);
    expect(resolveNewCustomerJudgement({ signupDateColumn: 'joined_at' }).canJudge).toBe(true);
  });
});

describe('CT-J12 · 3-9 주간 회사 묶음 검사 · 수정안 = 원문은 사람이 누를 때만(설계서 3-9)', () => {
  const rd = (f: string) => codeLines(readFileSync(join(SRC_ROOT, 'utils', f), 'utf8')).map((l) => l.line).join('\n');
  it('주 시작 = 지금 앞의 가장 가까운 일요일 21:00 KST', async () => {
    const { weeklyCheckWeekStart } = await import('../journey-weekly-check');
    expect(weeklyCheckWeekStart(kst(2026, 11, 2, 9))).toEqual(kst(2026, 11, 1, 21));    // 월요일 아침 = 어제 밤
    expect(weeklyCheckWeekStart(kst(2026, 11, 1, 20, 59))).toEqual(kst(2026, 10, 25, 21));   // 일요일 21시 앞 = 지난주
    expect(weeklyCheckWeekStart(kst(2026, 11, 1, 21))).toEqual(kst(2026, 11, 1, 21));
    expect(weeklyCheckWeekStart(kst(2026, 11, 7, 23))).toEqual(kst(2026, 11, 1, 21));
  });
  it('남은 칸 판정 = 고르기 SQL 한 곳 · LIMIT 앞(결정 없음 · 보류 + 수정안 일 남음 · 변이 칸 · 마침 기록 · 후보 끝 · 만드는 중 10분 안 = 빠짐 · R12)', () => {
    const n = rd('journey-pretest-notifier.ts');
    const fn = n.slice(n.indexOf('export async function weeklyCheckRows('), n.indexOf('\n}\n', n.indexOf('export async function weeklyCheckRows(')));
    expect(fn).toContain("AND (dec.status IS NULL OR (dec.status = 'held' AND ${heldPending}))");
    for (const s of ['NOT EXISTS (SELECT 1 FROM journey_step_variants v WHERE v.step_id = s.id)', "wd.status = '${WEEKLY_DONE_STATUS}'", "c.status IN ('passed', 'blocked', 'failed')", "c.status = 'generating' AND c.claimed_at >= NOW() - INTERVAL '${CANDIDATE_GENERATING_TTL_MINUTES} minutes'"]) expect(fn, s).toContain(s);
    expect(fn.indexOf('${heldPending}')).toBeLessThan(fn.indexOf('LIMIT ${Number(limit)}'));
    // 고른 뒤 JS 로 다시 거르지 않는다(판정 두 벌 0)
    const w = rd('journey-weekly-check.ts');
    expect(w).toContain('const pick = interleaveByCompany(rows, (r) => String(r.company_id))[0];');
    expect(w).not.toMatch(/weeklyStepDone|\.find\(/);
    // 수정안을 만들 수 없는 보류(보낼 글 판정) = 이번 주 마침 기록
    const ws = n.slice(n.indexOf('export async function weeklyCheckStep('), n.indexOf('\n}\n', n.indexOf('export async function weeklyCheckStep(')));
    expect(ws).toMatch(/if \(copyIssue\) \{[\s\S]*?'\$\{WEEKLY_DONE_STATUS\}'[\s\S]*?return;\n  \}/);
  });
  it('주간 한 칸 = 보낼 글 판정(유료 앞) → 지난주 결과 재사용 없음 → 보류 → 수정안(원문 불변 · 반영 0)', () => {
    const n = rd('journey-pretest-notifier.ts');
    const fn = n.slice(n.indexOf('export async function weeklyCheckStep('), n.indexOf('\n}\n', n.indexOf('export async function weeklyCheckStep(')));
    expect(fn.indexOf('journeyCopyIssue(')).toBeLessThan(fn.indexOf('runStepSpamTest('));
    expect(fn.slice(fn.indexOf('runStepSpamTest('), fn.indexOf('runStepSpamTest(') + 400)).not.toContain('reuseDays');
    expect(fn).toContain('await holdCurrent(b, summary, snapId, body);');
    expect(fn).toContain('await testCandidate(b, summary, snapId, regenBody,');
    expect(fn).not.toMatch(/UPDATE journey_steps|applyPassedCandidate/);
    // 수정안 검사 통과 = 후보 passed + 보류 유지(자동 반영 0)
    const tc = n.slice(n.indexOf('async function testCandidate('), n.indexOf('async function holdCurrent('));
    expect(tc).toContain("if (await moveCandidate(snapId, ['testing'], 'passed')) summary.passed++;");
    expect(n).not.toMatch(/SET message_body = \$2/);
  });
  it('[이 글로 보내기] = 잠금 → 최신 판 = 후보 판 · 후보 passed → 칸 글 → 새 판 100 → 결정 notified(한 트랜잭션 · CT-J12 한 곳)', () => {
    const c = rd('journey-pretest-candidate.ts');
    const fn = c.slice(c.indexOf('export async function applyPassedCandidate('), c.indexOf('\n}\n', c.indexOf('export async function applyPassedCandidate(')));
    const order = ['withJourneyValidationReset(companyId, journeyId,', "if (String(latest || '') !== snapshotId) return 'stale' as const;", "AND status = 'passed' FOR UPDATE", 'UPDATE journey_steps SET message_template = $3', 'await createStepSnapshot(companyId, journeyId, stepId, run);', 'SET confidence_score = 100', "'notified', $4::uuid, NOW())", '{ keepMarker: true }'];
    let at = -1;
    for (const o of order) { const i = fn.indexOf(o, at + 1); expect(i, o).toBeGreaterThan(at); at = i; }
    // 칸 글을 후보 글로 바꾸는 쓰기 = 이 함수 밖 0
    const bad = sourceFiles().filter((f) => f.rel !== 'utils/journey-pretest-candidate.ts' && /journey_pretest_candidates[\s\S]{0,400}UPDATE journey_steps|UPDATE journey_steps[\s\S]{0,200}cand\./.test(f.text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });
  it('통과한 글 7일 정기 재검사 갈래 0 · 주간 워커가 앱과 함께 돈다 · 월요일 요약 = 걸린 칸 수', () => {
    expect(rd('journey-pretest-notifier.ts')).not.toContain('b.confidence >= 100');
    expect(readFileSync(join(SRC_ROOT, 'app.ts'), 'utf8')).toContain('startWeeklyStepCheckWorker();');
    expect(rd('manager-weekly-digest.ts')).toContain("heldSteps: board.todos.filter((t) => t.kind === 'held_step').length,");
  });
});

describe('3-7 · 3-8 진입 속도 · 진입 정보(D4 · D5)', () => {
  const src = (f: string) => codeLines(readFileSync(join(SRC_ROOT, 'utils', f), 'utf8')).map((l) => l.line).join('\n');
  it('회차 상한 = JOURNEY_COUNT_CAP 하나(재진입 · 진입 감시 · 숫자 상한 상수 0) · 재진입 1시간 · 잘린 상태 트리거 = 다음 회차', () => {
    const r = src('journey-reentry-worker.ts');
    expect(r).toContain('const WORKER_INTERVAL_MS = 60 * 60 * 1000;');
    expect(r).toContain('let pickLimit = cap != null ? cap + 1 : JOURNEY_COUNT_CAP;');
    expect(r).toContain('const ids = picked.slice(0, JOURNEY_COUNT_CAP);');
    for (const f of ['journey-reentry-worker.ts', 'journey-trigger-watcher.ts']) {
      expect(src(f), f).not.toMatch(/\b(?:LIMIT|slice\(0,)\s*\d{3,}/);
      expect(src(f), f).not.toMatch(/const [A-Z_]*(?:BATCH|LIMIT)[A-Z_]* = [\d_]+;/);
    }
    const w = src('journey-trigger-watcher.ts');
    expect(w).toContain('return { ...r, truncated: ids.length >= extractLimit };');
    expect(w).toContain('if (isStateTrigger && !result.paused && !result.truncated) _stateTriggerRanAt.set(j.id, Date.now());');
  });
  it('사건 · 상태 넣기 = 진입 정보를 entryPropsFor 에서 받는다(진입 감시 · 재진입 · 날짜 기준 · 한 번 보내기 = 허용 · 진입 정보 없음)', () => {
    const ALLOW: Record<string, string> = { 'journey-anchor-scheduler.ts': '날짜 기준 · 한 번 보내기 = 진입 사건 없음' };
    const files = readdirSync(join(SRC_ROOT, 'utils')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const inserters = files.filter((f) => /INSERT INTO journey_executions/.test(src(f)));
    expect(inserters.sort()).toEqual(['journey-anchor-scheduler.ts', 'journey-reentry-worker.ts', 'journey-trigger-watcher.ts']);
    for (const f of inserters) {
      if (ALLOW[f]) continue;
      expect(src(f), f).toMatch(/await entryPropsFor\(j, ids\)/);
      for (const m of src(f).matchAll(/INSERT INTO journey_executions[\s\S]*?\)/g)) expect(m[0], f).toContain('entry_event_properties');
    }
    // 진입 정보 판정(장바구니 · 포인트) = 그 함수 밖 0
    expect(src('journey-trigger-watcher.ts')).not.toMatch(/points_at_entry|selectCartAbandonProperties/);
    expect(src('journey-reentry-worker.ts')).not.toMatch(/points_at_entry|selectCartAbandonProperties/);
  });
});

describe('3-16 · D14 켜진 여정 A/B 칸 고치기 = 막음 · 화면 = A/B 문안 보이고 본문 잠금', () => {
  const FE = join(SRC_ROOT, '..', '..', 'frontend', 'src');
  it('서버 = 잠금 안에서 변이 수를 보고 409(AB_STEP_COPY_LOCKED) · 채우기 길(fillJourneyCopyFacts) 밖 · 상세 = 칸마다 A/B 문안', () => {
    const b = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'journey-builder.ts'), 'utf8')).map((l) => l.line).join('\n');
    const fn = b.slice(b.indexOf('export async function updateJourneyStep('), b.indexOf('\n}\n', b.indexOf('export async function updateJourneyStep(')));
    const gate = fn.indexOf('&& ((await loadVariantRowsByStep([stepId], run)).get(stepId)?.length ?? 0) > 0) {');
    expect(gate).toBeGreaterThan(-1);
    // ★ C104 G3 — 상태 무관(초안 · 멈춘 여정도 A/B 판이 나간다) · 문구 = 상태별 한 쌍
    expect(fn).toContain('if ((patch.messageTemplate !== undefined || patch.subject !== undefined)');
    expect(fn).toContain("throw new JourneyStepGateError(abStepCopyLockedMessage(journey.status), 'AB_STEP_COPY_LOCKED');");
    expect(gate).toBeLessThan(fn.indexOf('const out = await applyStepPatchInLock(run, journey, companyId, journeyId, stepId, patch);'));
    const fill = b.slice(b.indexOf('export async function fillJourneyCopyFacts('), b.indexOf('\n}\n', b.indexOf('export async function fillJourneyCopyFacts(')));
    expect(fill).not.toContain('AB_STEP_COPY_LOCKED');
    const det = b.slice(b.indexOf('export async function getJourneyDetail('), b.indexOf('\n}\n', b.indexOf('export async function getJourneyDetail(')));
    expect(det).toContain('ab_variants: (abByStep.get(String(s.id)) || []).map(');
  });
  it('화면 = 같은 문장 · 같은 판정(작업 화면 · 문안 수정 창) · 잠그면 휴대폰 편집기 · AI · 넣을 데이터 줄 없음', async () => {
    const { AB_STEP_COPY_LOCKED_MESSAGE, AB_STEP_COPY_LOCKED_DRAFT_MESSAGE } = await import('../journey-builder');
    const list = readFileSync(join(FE, 'components', 'journey', 'JourneyAbCopyList.tsx'), 'utf8');
    expect(list).toContain(`export const AB_STEP_COPY_LOCKED_MESSAGE = '${AB_STEP_COPY_LOCKED_MESSAGE}';`);
    expect(list).toContain(`export const AB_STEP_COPY_LOCKED_DRAFT_MESSAGE = '${AB_STEP_COPY_LOCKED_DRAFT_MESSAGE}';`);
    expect(list).toContain('return (variants?.length ?? 0) > 0;');   // ★ C104 G3 상태 무관
    const ws = readFileSync(join(FE, 'components', 'journey', 'workspace', 'JourneyWorkspace.tsx'), 'utf8');
    expect(ws).toContain('const selAbLocked = !!selRaw && abCopyLocked(selRaw.ab_variants);');
    expect(ws).toContain('copyLock={selRaw && selAbLocked ? (');
    const modal = readFileSync(join(FE, 'components', 'journey', 'JourneyMessageEditModal.tsx'), 'utf8');
    expect(modal).toContain('{abCopyLocked(s.abVariants) ? (');
    const studio = readFileSync(join(FE, 'components', 'journey', 'JourneyStepStudio.tsx'), 'utf8');
    expect(studio).toContain('{copyLock ?? (');
    expect(studio).toContain('{!copyLock && (onAi || onDecorate || onUndoAi) && (');
    expect(studio).toContain('{!copyLock && (\n          <Row name="넣을 데이터">');
  });
});

describe('CT-O1 자동마케팅 회차 — 회차 키 · 잠금 안 확인 · 교체(본 id 조건 · 수 비교) · 넣기 한 트랜잭션(설계서 3-1 · D3)', () => {
  it('회차 상태: 끝을 냄(예약 · 보냄 · 승인 · 거부 · 생략 · 멈춤) · 담당자 손(대기 · 검토) · 만료 = 셈 밖', async () => {
    const { roundState } = await import('../operator-round');
    const run = (rows: any[]) => async () => ({ rows });
    expect(await roundState(run([{ id: 'a', status: 'expired' }]), 'o', 'k')).toEqual({ done: false, openIds: [] });
    expect(await roundState(run([{ id: 'a', status: 'pending' }, { id: 'b', status: 'admin_review' }]), 'o', 'k')).toEqual({ done: false, openIds: ['a', 'b'] });
    for (const st of ['scheduled', 'sending', 'sent', 'approved', 'rejected', 'skipped', 'admin_stopped']) {
      expect((await roundState(run([{ id: 'a', status: st }]), 'o', 'k')).done, st).toBe(true);
    }
  });
  it('교체 = 본 id 만 · 그 상태일 때만 · 돌아온 수 = 본 수일 때만 참', async () => {
    const { replaceRoundCas } = await import('../operator-round');
    const calls: any[] = [];
    const run = (n: number) => async (sql: string, params?: any[]) => { calls.push({ sql, params }); return { rows: Array.from({ length: n }, (_, i) => ({ id: String(i) })) }; };
    expect(await replaceRoundCas(run(2), ['a', 'b'])).toBe(true);
    expect(await replaceRoundCas(run(1), ['a', 'b'])).toBe(false);
    expect(calls[0].sql).toContain('WHERE id = ANY($1::uuid[]) AND status IN (\'pending\', \'admin_review\')');
    expect(await replaceRoundCas(run(0), [])).toBe(true);
  });
  it('비리마인드 제안 넣기 = 회차 잠금 안 · 잠금 안 다시 확인 → 교체 → 지난 회차 만료 → 넣기 · 회차 키를 제안에 · 다음 생성 = 그 회차 다음', () => {
    const o = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8')).map((l) => l.line).join('\n');
    const fn = o.slice(o.indexOf('async function generateProposalForOperatorRound('), o.indexOf('\n}\n', o.indexOf('async function generateProposalForOperatorRound(')));
    const order = ['const preRound = await roundState(', 'withRoundLock(operator.id, roundKey, async (run) => {', 'const st = await roundState(run, operator.id, roundKey);', 'await replaceRoundCas(run, st.openIds)', "IS DISTINCT FROM $2`", 'INSERT INTO operator_proposals', "meta: { ...(orchestratorResult?.meta || {}), roundKey,", 'autoExecuteEligible, roundAt);'];
    let at = -1;
    for (const x of order) { const i = fn.indexOf(x, at + 1); expect(i, x).toBeGreaterThan(at); at = i; }
    expect(fn).not.toMatch(/AND id <> \$2::uuid/);   // 넣은 뒤 만료(「방금 만든 것 제외」) 0
    // 운영자 제안 넣기 = 회차(이 함수) · 리마인드(회차 아님) 둘뿐
    expect((o.match(/INSERT INTO operator_proposals/g) || []).length).toBe(2);
    const rem = o.slice(o.lastIndexOf('INSERT INTO operator_proposals') - 3000, o.lastIndexOf('INSERT INTO operator_proposals'));
    expect(rem).toMatch(/is_reminder|리마인드/);
  });
  it('지금 실행 · 미리보기 시작 = 사람(교체) · 워커 = 만들지 않음', () => {
    expect(readFileSync(join(SRC_ROOT, 'routes', 'ai.ts'), 'utf8')).toContain("const proposal = await generateProposalForOperator(req.params.id, { manual: true });");
    expect(readFileSync(join(SRC_ROOT, 'utils', 'automarketing-preview.ts'), 'utf8')).toContain('manual: true');
    const o = readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8');
    expect(o).toContain('if (preRound.done || (!opts?.manual && preRound.openIds.length > 0)) {');
  });
});

describe('CT-O2 자동마케팅 상한 갈래 · 3-2 승인 = 정한 시각 · 회차 안내(설계서 3-2 · B-1102-1)', () => {
  it('결정 표: 회사 자율 = 상한 + 예산 · 승인 기간 = 예산만 · 사람 승인 = 둘 다 안 봄', async () => {
    const { operatorCapPolicy, operatorCapPathOf } = await import('../autosend-policy');
    const v = { recipients: 5000, cost: 90000, maxRecipients: 1000, maxCost: 50000 };
    expect(operatorCapPolicy('company_auto', v)).toMatchObject({ checksCap: true, checksBudget: true });
    expect(operatorCapPolicy('company_auto', v).overReason).toContain('5,000명');
    expect(operatorCapPolicy('approval_window', v)).toEqual({ checksCap: false, checksBudget: true, overReason: null });
    expect(operatorCapPolicy('human_approved', v)).toEqual({ checksCap: false, checksBudget: false, overReason: null });
    expect(operatorCapPathOf({ reviewed_by: 'u', proposal_json: { meta: { capPath: 'company_auto' } } })).toBe('human_approved');
    expect(operatorCapPathOf({ reviewed_by: null, proposal_json: { meta: { capPath: 'approval_window' } } })).toBe('approval_window');
    expect(operatorCapPathOf({ reviewed_by: null, proposal_json: {} })).toBe('company_auto');   // 옛 행 = 더 엄격
    // 리마인드 = 1차가 따른 갈래 · 회차(리마인드 아님)가 사람 승인 갈래를 싣지 못한다
    expect(operatorCapPathOf({ reviewed_by: null, proposal_json: { meta: { is_reminder: true, capPath: 'human_approved' } } })).toBe('human_approved');
    expect(operatorCapPathOf({ reviewed_by: null, proposal_json: { meta: { capPath: 'human_approved' } } })).toBe('company_auto');
    expect(operatorCapPathOf({ reviewed_by: null, proposal_json: { meta: { is_reminder: true } } })).toBe('company_auto');
  });
  it('자동 실행 상한(대상 수 · 비용) 비교 = 판정 함수 밖 0(운영자 파일)', () => {
    const o = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8')).map((l) => l.line);
    const bad = o.filter((l) => /[<>]=?\s*(?:Number\()?(?:ctx\.|L\.)?(?:cdp_auto_execute_)?max_(?:recipients|cost(?:_krw)?)\b/.test(l));
    expect(bad).toEqual([]);
    const all = o.join('\n');
    // ★ Codex 구현 1R — 유효한 승인 기간 = 회사 자율보다 먼저
    expect(all).toContain("const capPath: OperatorCapPath | null = approvalActive ? 'approval_window' : companyAuto ? 'company_auto' : null;");
    expect(all).toContain('const r = await dispatchProposalSend(p, sendPath);');
    // 리마인드 = 1차 갈래를 싣는다(null = 지금 승인 = 사람 승인)
    expect(all).toContain("      capPath ?? 'human_approved',");
    expect(all).toMatch(/is_reminder: true,\n\s*capPath: parentCapPath,/);
    expect(all).toContain('if (operatorCapPolicy(sendPath, { recipients: 0, cost: 0, maxRecipients: 0, maxCost: 0 }).checksBudget) try {');
  });
  it('회사 자동 상한 칸(cdp_auto_execute_max_*)을 읽는 백엔드 파일 = 이유 붙은 목록 · 운영자 파일은 판정 함수 인자로만(설계서 3-2 E ⑨)', () => {
    const ALLOW: Record<string, string> = {
      'routes/admin.ts': '슈퍼관리자 회사 설정 저장 · 응답(판정 0)',
      'utils/continuous-operator.ts': '회차 자격 · 발송 직전 = 값을 읽어 operatorCapPolicy 에 넘긴다(위험도 상한 cdp_auto_execute_max_risk 는 준법 관문 · 그대로)',
    };
    const files: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, rel ? `${rel}/${name}` : name); continue; }
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        if (/cdp_auto_execute_max_/.test(codeLines(readFileSync(p, 'utf8')).map((l) => l.line).join('\n'))) files.push(rel ? `${rel}/${name}` : name);
      }
    };
    walk(SRC_ROOT, '');
    expect(files.sort()).toEqual(Object.keys(ALLOW).sort());
    const o = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8')).map((l) => l.line);
    const uses = o.filter((l) => /cdp_auto_execute_max_(recipients|cost_krw)/.test(l));
    for (const l of uses) {
      expect(/^\s*cdp_auto_execute_max_(recipients|cost_krw): number;$/.test(l) || /COALESCE\(c\.cdp_auto_execute_max_(recipients|cost_krw), \d+\) AS /.test(l) || /operatorCapPolicy\(capPath,/.test(l), l).toBe(true);
    }
  });
  it('승인 = 정한 시각(아직이면 그 시각 예약 · 지났으면 지금 · 야간 = 다음 창) · 화면 확인 창 = 같은 말', () => {
    const o = codeLines(readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8')).map((l) => l.line).join('\n');
    const fn = o.slice(o.indexOf('export async function approveProposal('), o.indexOf('\n}\n', o.indexOf('export async function approveProposal(')));
    expect(fn).toContain('const atRound = roundTime && roundTime.getTime() > nowApprove.getTime() ? shiftToSendableHour(roundTime) : null;');
    expect(fn).toContain('const sendAt = atRound ?? shiftToSendableHour(nowApprove);');
    expect(fn.indexOf('const atRound')).toBeLessThan(fn.indexOf('await dispatchProposalSend(claim.rows[0])'));
    const page = readFileSync(join(SRC_ROOT, '..', '..', 'frontend', 'src', 'pages', 'ContinuousOperatorPage.tsx'), 'utf8');
    expect(page).toContain('승인하면 ${schedLabel}에 보내요.');
    expect(page).toContain('지났어요. 지금 보낼까요?');
  });
  it('회차 안내 = 사람 승인 예약 · 승인 대기 각 한 번(원장 = admin_notified_at · meta.unapprovedNoticeAt · 보낸 뒤 기록) · 발송 패스 안', async () => {
    const o = readFileSync(join(SRC_ROOT, 'utils', 'continuous-operator.ts'), 'utf8');
    const fn = o.slice(o.indexOf('async function deliverRoundNotices('));
    expect(fn).toContain("p.status = 'scheduled' AND p.reviewed_by IS NOT NULL AND p.admin_notified_at IS NULL");
    expect(fn).toContain("p.status = 'pending' AND p.proposal_json->'meta'->>'unapprovedNoticeAt' IS NULL");
    expect(fn.indexOf('if (ok) await query(`UPDATE operator_proposals SET admin_notified_at = NOW()')).toBeGreaterThan(fn.indexOf("'[AI 자동마케팅] 발송 예정 안내'"));
    expect(o).toContain('await deliverRoundNotices().catch(');
    // 안내 때 거름 = SQL 안 · LIMIT 앞(R12 · 규칙 = autoSendLeadMinutesSql = resolveAutoSendLeadMinutes 의 SQL 판)
    expect(fn).toContain("AND p.scheduled_send_at - (${autoSendLeadMinutesSql('o.auto_send_lead_minutes')} * INTERVAL '1 minute') <= NOW()");
    expect(fn.indexOf('autoSendLeadMinutesSql(')).toBeLessThan(fn.indexOf('LIMIT ${ROUND_NOTICE_BATCH}'));
    expect(fn).not.toContain('resolveAutoSendLeadMinutes(');
    // 못 보낸 안내 = 시도 상한(meta.roundNoticeAttempts · 고르기 SQL 이 뺀다 · 상한 = 운영 경보) · 두 갈래 모두
    expect(fn).toContain("AND COALESCE((p.proposal_json->'meta'->>'roundNoticeAttempts')::int, 0) < ${NOTICE_MAX_ATTEMPTS}");
    expect((fn.match(/else await countRoundNoticeFailure\(String\(r\.id\), op\);/g) || []).length).toBe(2);
    // 사람 승인 회차 안내 = 문안 문자를 앞에 보내지 않는다 → 「위 문안」이 아니라 「승인하신 문안」
    expect(fn).toContain('unitCost: 0, stopUrl, approved: true,');
    const { buildAutoSendPrepInfoBody } = await import('../autosend-policy');
    const body = buildAutoSendPrepInfoBody({ sendAtLabel: '11월 3일 14:00', recipientCount: 120, costEstimate: 3600, channelLabel: '', unitCost: 0, stopUrl: null, approved: true });
    expect(body.split('\n')[0]).toBe('11월 3일 14:00에 승인하신 문안이 120명에게 발송됩니다.');
    expect(body).not.toContain('위 문안');
    expect(body.split('\n')[1]).toBe('예상 비용 약 3,600원');
  });
});
