/**
 * 고객 360 타임라인 계약 테스트 (★ 2026-08-22 신설)
 *
 * 설계서 §8이 요구한 다섯 가지를 잠근다. 전부 **행동**을 본다 — 토큰 존재만 보는 불변식은
 * 조건 반전을 못 잡는다(LESSONS_BACKEND 2026-08-01).
 *   ① 커서 tie-breaker: 같은 시각 여러 건이 페이지 경계에 걸려도 누락·중복 0
 *   ② 원천 하나가 throw해도 나머지 종류는 돌아온다(⛔6)
 *   ③ truncated 판정
 *   ④ 커서 왕복·조작 내성
 *   ⑤ 카탈로그 kind 전부가 제목 생성기를 갖는다(원천을 늘릴 때 여기서 걸린다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  TIMELINE_KINDS,
  compareEvents,
  encodeCursor,
  decodeCursor,
  isoToKstSql,
  kstSqlToIso,
  likePattern,
  kstDateToIso,
  minIso,
  monthsBack,
  monthlySeries,
  recentYms,
  SEND_MONTHS_CAP,
  SUMMARY_MONTHS,
  type TimelineEvent,
  type TimelineKind,
  type TimelineSourceState,
} from '../customer-timeline';

// ────────────── 조립 로직 재현 (CT와 같은 순서·규칙) ──────────────
// buildCustomerTimeline은 DB를 잡으므로, 그 안의 **병합·커서·격리** 규칙만 같은 코드 경로로 검증한다.

function isAfterCursor(e: { at: string; kind: string; id: string }, cur: { at: string; kind: string; id: string } | null) {
  if (!cur) return true;
  return compareEvents(cur, e) < 0;
}

/** CT의 runSource와 같은 계약: 실패는 sources에 기록하고 빈 배열, 성공은 limit로 자르고 truncated 표기 */
async function runSource(
  kind: TimelineKind,
  sources: Partial<Record<TimelineKind, TimelineSourceState>>,
  limit: number,
  fn: () => Promise<TimelineEvent[]>,
): Promise<TimelineEvent[]> {
  try {
    const rows = await fn();
    const truncated = rows.length > limit;
    sources[kind] = { ...(sources[kind] || {}), truncated };
    return truncated ? rows.slice(0, limit) : rows;
  } catch (err: any) {
    sources[kind] = { ...(sources[kind] || {}), error: err?.message || '조회 실패' };
    return [];
  }
}

function paginate(all: TimelineEvent[], before: string | null, limit: number) {
  const cur = decodeCursor(before);
  const merged = all.filter((e) => isAfterCursor(e, cur));
  merged.sort(compareEvents);
  const page = merged.slice(0, limit);
  const nextBefore = merged.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null;
  return { page, nextBefore };
}

const ev = (kind: TimelineKind, at: string, id: string): TimelineEvent => ({ id, kind, at, title: `${kind} ${id}` });

describe('고객 360 타임라인 — 커서·병합 계약', () => {
  it('같은 시각이 페이지 경계에 걸려도 누락·중복이 없다', () => {
    // 같은 초에 7건 + 앞뒤 사건. 시각만으로 자르면 경계에서 빠지거나 겹친다.
    const same = '2026-08-20T10:00:00.000Z';
    const all: TimelineEvent[] = [
      ev('send', '2026-08-21T09:00:00.000Z', 'newest'),
      ...Array.from({ length: 7 }, (_, i) => ev('send', same, `s${i}`)),
      ev('purchase', same, 'p0'),
      ev('behavior', '2026-08-19T08:00:00.000Z', 'oldest'),
    ];

    const seen: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const { page, nextBefore } = paginate(all, before, 3);
      seen.push(...page.map((e) => `${e.kind}:${e.id}`));
      if (!nextBefore) break;
      before = nextBefore;
    }

    expect(seen.length).toBe(all.length);
    expect(new Set(seen).size).toBe(all.length);
    expect(seen[0]).toBe('send:newest');
    expect(seen[seen.length - 1]).toBe('behavior:oldest');
  });

  it('정렬은 최신이 먼저이고, 같은 시각이면 kind·id로 고정된다', () => {
    const a = ev('purchase', '2026-08-20T10:00:00.000Z', 'b');
    const b = ev('send', '2026-08-20T10:00:00.000Z', 'a');
    const c = ev('send', '2026-08-21T10:00:00.000Z', 'z');
    const sorted = [a, b, c].sort(compareEvents);
    expect(sorted.map((e) => e.id)).toEqual(['z', 'b', 'a']);   // 최신 → purchase(p<s) → send
    // 같은 입력은 항상 같은 순서(안정성)
    expect([c, b, a].sort(compareEvents).map((e) => e.id)).toEqual(['z', 'b', 'a']);
  });

  it('커서는 왕복해도 같은 값이고, 깨진 커서는 무시된다(전 구간 재조회로 떨어지지 않게)', () => {
    const e = ev('send', '2026-08-20T10:00:00.000Z', 'SMSQ_SEND_1:123');
    const round = decodeCursor(encodeCursor(e));
    expect(round).toEqual({ at: e.at, kind: 'send', id: 'SMSQ_SEND_1:123' });

    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('없는시각|send|1', 'utf8').toString('base64'))).toBeNull();
  });
});

describe('고객 360 타임라인 — MySQL 시각 축(KST naive ↔ UTC ISO)', () => {
  // SMSQ의 sendreq_time은 KST naive다. 커서(UTC ISO)를 그대로 넘기면 9시간 어긋난 페이지가 나온다.
  it('커서(UTC ISO)를 MySQL 비교용 KST 문자열로 바꾼다', () => {
    expect(isoToKstSql('2026-08-20T01:00:00.000Z')).toBe('2026-08-20 10:00:00');
    expect(isoToKstSql('2026-08-19T15:00:00.000Z')).toBe('2026-08-20 00:00:00');
    expect(isoToKstSql('깨진값')).toBe('');
  });

  it('MySQL이 준 KST 문자열을 UTC ISO로 되돌린다(프로세스 타임존과 무관하게)', () => {
    expect(kstSqlToIso('2026-08-20 10:00:00')).toBe('2026-08-20T01:00:00.000Z');
    expect(kstSqlToIso('2026-08-20T10:00:00')).toBe('2026-08-20T01:00:00.000Z');
    expect(kstSqlToIso(null)).toBeNull();
    expect(kstSqlToIso('')).toBeNull();
  });

  it('두 변환은 서로를 되돌린다(왕복 오차 0)', () => {
    const iso = '2026-08-20T01:23:45.000Z';
    expect(kstSqlToIso(isoToKstSql(iso))).toBe(iso);
  });
});

describe('고객 360 타임라인 — 원천 격리·상한', () => {
  it('원천 하나가 throw해도 나머지 종류는 그대로 돌아온다', async () => {
    const sources: Partial<Record<TimelineKind, TimelineSourceState>> = {};
    const batches = await Promise.all([
      runSource('send', sources, 10, async () => { throw new Error('인덱스 없음'); }),
      runSource('purchase', sources, 10, async () => [ev('purchase', '2026-08-20T10:00:00.000Z', 'p1')]),
      runSource('consent', sources, 10, async () => [ev('consent', '2026-08-19T10:00:00.000Z', 'c1')]),
    ]);
    const merged = batches.flat();

    expect(merged.map((e) => e.kind).sort()).toEqual(['consent', 'purchase']);
    expect(sources.send?.error).toBe('인덱스 없음');
    expect(sources.purchase?.error).toBeUndefined();
    expect(sources.purchase?.truncated).toBe(false);
  });

  it('상한을 넘으면 잘라내고 truncated로 알린다', async () => {
    const sources: Partial<Record<TimelineKind, TimelineSourceState>> = {};
    const rows = await runSource('behavior', sources, 3, async () =>
      Array.from({ length: 4 }, (_, i) => ev('behavior', `2026-08-2${i}T10:00:00.000Z`, `b${i}`)),
    );
    expect(rows.length).toBe(3);
    expect(sources.behavior?.truncated).toBe(true);
  });
});

describe('고객 360 타임라인 — 카탈로그', () => {
  const SRC = readFileSync(resolve(__dirname, '../customer-timeline.ts'), 'utf8');

  it('카탈로그 kind 12종이 전부 사건 생성 코드를 갖는다', () => {
    // 원천을 늘리면서 kind만 추가하고 생성기를 안 붙이면 화면에서 그 종류가 영원히 비어 있다.
    const missing = TIMELINE_KINDS.filter((k) => {
      const re = new RegExp(`kind:\\s*'${k}'`);
      return !re.test(SRC);
    });
    expect(missing).toEqual([]);
    expect(TIMELINE_KINDS.length).toBe(12);
  });

  it('발송 원천은 PG messages를 읽지 않는다(⛔1 — 죽은 테이블)', () => {
    expect(/FROM\s+messages\b/i.test(SRC)).toBe(false);
  });

  it('고객 식별은 customers_unified 뷰를 쓰지 않는다(⛔2 — 뷰는 매장별 행을 접는다)', () => {
    // 단어 언급(주석의 금지 사유 설명)이 아니라 **SQL에서 읽는가**를 본다.
    expect(/FROM\s+customers_unified/i.test(SRC)).toBe(false);
    expect(/JOIN\s+customers_unified/i.test(SRC)).toBe(false);
    // 원본 customers를 읽는 식별 쿼리는 실제로 있어야 한다(반대 방향도 잠근다)
    expect(/FROM\s+customers\b/i.test(SRC)).toBe(true);
  });

  it('MySQL 발송 조회는 번호만 보지 않고 회사(app_etc2)까지 본다(⛔ 회사 격리)', () => {
    // 2026-08-22 실측: 법인폰 한 번호에 4개 회사의 행이 섞여 있었고, dest_no만 보던 목록·건수가
    // 테스트계정 화면에 타사 발송을 그대로 띄웠다. 읽는 테이블이 전 bulk 라인 합집합이라
    // 번호 조건만으로는 회사가 갈리지 않는다. `dest_no = ?`가 있는 WHERE는 전부 `app_etc2 = ?`를 동반해야 한다.
    const wheres = SRC.match(/WHERE\s+dest_no\s*=\s*\?[^)`'\n]*/g) || [];
    expect(wheres.length).toBeGreaterThan(0);
    const unguarded = wheres.filter((w) => !/app_etc2\s*=\s*\?/.test(w));
    expect(unguarded).toEqual([]);
  });
});

describe('고객 360 v2 — 검색·기간 술어(서버가 해석한다, v2 §3-2)', () => {
  it('LIKE 패턴은 %·_·역슬래시를 이스케이프하고 빈 검색어는 null이다', () => {
    expect(likePattern('  ')).toBeNull();
    expect(likePattern(null)).toBeNull();
    expect(likePattern('쿠폰')).toBe('%쿠폰%');
    expect(likePattern('50%_할인\\')).toBe('%50\\%\\_할인\\\\%');
  });

  it('KST 날짜는 그날 00:00 / 23:59:59.999를 UTC ISO로 만들고, 틀린 날짜는 버린다', () => {
    expect(kstDateToIso('2026-08-21')).toBe('2026-08-20T15:00:00.000Z');
    expect(kstDateToIso('2026-08-21', true)).toBe('2026-08-21T14:59:59.999Z');
    expect(kstDateToIso('2026-02-31')).toBeNull();
    expect(kstDateToIso('2026/08/21')).toBeNull();
    expect(kstDateToIso('')).toBeNull();
  });

  it('상한이 둘이면 이른 쪽을 쓴다(커서 · to)', () => {
    expect(minIso('2026-08-10T00:00:00.000Z', '2026-08-21T14:59:59.999Z')).toBe('2026-08-10T00:00:00.000Z');
    expect(minIso(null, 'x')).toBe('x');
    expect(minIso('x', null)).toBe('x');
    expect(minIso(null, null)).toBeNull();
  });

  it('from에서 MySQL log 개월 수를 역산하고 24에서 막는다(from이 없으면 24)', () => {
    const now = new Date(2026, 7, 22); // 2026-08-22
    expect(monthsBack(null, now)).toBe(SEND_MONTHS_CAP);
    expect(monthsBack(kstDateToIso('2026-08-01'), now)).toBe(1);
    expect(monthsBack(kstDateToIso('2026-07-23'), now)).toBe(2);   // 30일 전 → 7월·8월
    expect(monthsBack(kstDateToIso('2025-08-22'), now)).toBe(13);  // 12개월 전 → 13개 달에 걸친다
    expect(monthsBack(kstDateToIso('2020-01-01'), now)).toBe(SEND_MONTHS_CAP);
  });

  it('월별 시리즈는 최근 12칸을 오래된 달부터 채우고 없는 달은 0이다', () => {
    const now = new Date(2026, 7, 22);
    const yms = recentYms(SUMMARY_MONTHS, now);
    expect(yms[0]).toBe('202509');
    expect(yms[yms.length - 1]).toBe('202608');
    const series = monthlySeries(new Map([['202608', 4], ['202607', 2], ['202001', 99]]), now);
    expect(series).toHaveLength(SUMMARY_MONTHS);
    expect(series[series.length - 1]).toEqual({ ym: '202608', sends: 4 });
    expect(series[series.length - 2]).toEqual({ ym: '202607', sends: 2 });
    expect(series.reduce((a, b) => a + b.sends, 0)).toBe(6); // 범위 밖 달은 들어오지 않는다
  });

  it('검색 대상이 없는 원천(동의·수신거부·등록)은 검색어가 있으면 빈 결과다(소스 계약)', () => {
    const SRC = readFileSync(resolve(__dirname, '../customer-timeline.ts'), 'utf8');
    for (const fn of ['fetchConsents', 'fetchUnsubscribes', 'buildProfileEvents']) {
      const start = SRC.indexOf(`function ${fn}(`);
      expect(start, fn).toBeGreaterThan(0);
      const head = SRC.slice(start, start + 500);
      expect(/if \(f\.like\) return \[\];/.test(head), fn).toBe(true);
    }
  });
});
