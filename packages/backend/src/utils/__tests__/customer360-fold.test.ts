/**
 * 고객 360 v2 — 접기·날짜 묶음·하이라이트 순수 함수 계약 (★ 2026-08-22)
 *
 * 대상은 frontend의 `timeline-fold.ts`(React 의존 0)를 그대로 import한다(선례: 프론트 소스 계약 테스트).
 * 설계서 v2 §4가 요구하는 다섯 가지:
 *   ① 성공·실패는 한 묶음으로 접지 않는다(키에 status)
 *   ② 10분 창 · 3건 이상일 때만 접는다
 *   ③ 꼬리 규칙 — 배열 끝에 닿은 묶음은 다음 페이지가 있으면 접지 않는다
 *   ④ 상한(maxRun)을 넘으면 새 묶음
 *   ⑤ 날짜가 다르면 접지 않는다 · 날짜 머리 건수는 묶음을 펼친 수로 센다
 */
import { describe, it, expect } from 'vitest';
import { foldRuns, groupByDay, splitHighlight, eventKey, foldKey } from '../../../../frontend/src/components/customer360/timeline-fold';

const dayOf = (iso: string) => iso.slice(0, 10);
const at = (m: number, s = 0) => new Date(Date.UTC(2026, 7, 21, 7, m, s)).toISOString(); // 2026-08-21 16:mm KST
const send = (id: string, iso: string, status: string | null = 'success', title = 'LMS 발송 · 주말 특가', ref?: string) => ({
  id, kind: 'send', at: iso, title, status, ref: ref ? { type: 'campaign', id: ref } : undefined,
});

describe('고객 360 v2 — 반복 접기', () => {
  it('같은 캠페인·같은 상태가 10분 안에 3건 이상이면 한 줄로 접힌다(최신이 first, 범위는 오래된→최신)', () => {
    const evs = [send('a', at(37)), send('b', at(36)), send('c', at(35)), send('d', at(20))];
    const out = foldRuns(evs, { dayOf });
    expect(out.map((x) => x.type)).toEqual(['run', 'single']);
    const run = out[0];
    if (run.type !== 'run') throw new Error('run 아님');
    expect(run.count).toBe(3);
    expect(run.first.id).toBe('a');
    expect(run.fromAt).toBe(at(35));
    expect(run.toAt).toBe(at(37));
    expect(run.key).toBe('run:send:a');
  });

  it('성공과 실패는 섞어 접지 않는다(실패 1건이 "N건" 뒤에 숨지 않는다)', () => {
    const evs = [send('a', at(37)), send('b', at(36), 'fail'), send('c', at(35)), send('d', at(34))];
    const out = foldRuns(evs, { dayOf });
    // a | b(fail) | c,d → a·b·c·d 전부 single (연속 3건이 없다)
    expect(out.map((x) => x.type)).toEqual(['single', 'single', 'single', 'single']);
    expect(foldKey(send('x', at(1), 'fail'))).not.toBe(foldKey(send('x', at(1), 'success')));
  });

  it('2건은 접지 않고, 10분을 넘으면 새 묶음이다', () => {
    expect(foldRuns([send('a', at(37)), send('b', at(36))], { dayOf }).every((x) => x.type === 'single')).toBe(true);
    const evs = [send('a', at(37)), send('b', at(36)), send('c', at(35)), send('d', at(26)), send('e', at(25)), send('f', at(24))];
    const out = foldRuns(evs, { dayOf });
    // a·b·c (첫 사건 37분 기준 10분 안) / d는 37-26=11분이라 밖 → d·e·f가 두 번째 묶음
    expect(out.map((x) => (x.type === 'run' ? `run${x.count}` : 'single'))).toEqual(['run3', 'run3']);
  });

  it('꼬리 규칙 — 배열 끝에 닿은 묶음은 다음 페이지가 있으면 접지 않는다', () => {
    const evs = [send('a', at(37)), send('b', at(36)), send('c', at(35))];
    expect(foldRuns(evs, { dayOf, hasMore: true }).every((x) => x.type === 'single')).toBe(true);
    expect(foldRuns(evs, { dayOf, hasMore: false })[0].type).toBe('run');
    // 꼬리가 아닌 묶음은 hasMore와 무관하게 접힌다
    const withTail = [...evs, send('z', at(1), 'fail')];
    expect(foldRuns(withTail, { dayOf, hasMore: true })[0].type).toBe('run');
  });

  it('상한을 넘으면 새 묶음 · 날짜가 다르면 접지 않는다 · 캠페인 참조가 없으면 제목으로 묶는다', () => {
    const many = Array.from({ length: 7 }, (_, i) => send(`m${i}`, at(30, 59 - i)));
    const out = foldRuns(many, { dayOf, maxRun: 5 });
    expect(out.map((x) => (x.type === 'run' ? x.count : 1))).toEqual([5, 1, 1]);

    const acrossDay = [
      send('a', '2026-08-21T00:00:30.000Z'), send('b', '2026-08-21T00:00:20.000Z'),
      send('c', '2026-08-20T23:59:50.000Z'), // 자정을 넘긴 3건째 — dayOf(UTC 날짜)가 다르면 앞 2건만 남아 접히지 않는다
    ];
    expect(foldRuns(acrossDay, { dayOf }).every((x) => x.type === 'single')).toBe(true);

    const byRef = [send('a', at(3), 'success', '제목 A', 'camp-1'), send('b', at(2), 'success', '제목 B', 'camp-1'), send('c', at(1), 'success', '제목 C', 'camp-1')];
    expect(foldRuns(byRef, { dayOf })[0].type).toBe('run');
    const byTitle = [send('a', at(3), 'success', '같은 제목'), send('b', at(2), 'success', '같은 제목'), send('c', at(1), 'success', '다른 제목')];
    expect(foldRuns(byTitle, { dayOf }).every((x) => x.type === 'single')).toBe(true);
  });

  it('행 키는 kind:id다(id는 원천 안에서만 유일하다)', () => {
    expect(eventKey({ id: '7', kind: 'send', at: at(1), title: '' })).toBe('send:7');
    expect(eventKey({ id: '7', kind: 'purchase', at: at(1), title: '' })).toBe('purchase:7');
  });
});

describe('고객 360 v2 — 날짜 묶음·하이라이트', () => {
  it('날짜별로 묶고 그날 종류별 건수는 묶음을 펼친 수로 센다', () => {
    const items = foldRuns(
      [send('a', at(37)), send('b', at(36)), send('c', at(35)), { id: 'p', kind: 'purchase', at: at(10), title: '구매', status: null }, send('z', '2026-08-20T01:00:00.000Z')],
      { dayOf },
    );
    const groups = groupByDay(items, dayOf);
    expect(groups.map((g) => g.day)).toEqual(['2026-08-21', '2026-08-20']);
    expect(groups[0].counts).toEqual({ send: 3, purchase: 1 });
    expect(groups[1].counts).toEqual({ send: 1 });
  });

  it('하이라이트는 대소문자 무시 부분 일치 구간만 표시하고, 검색어가 비면 통째로 한 조각이다', () => {
    expect(splitHighlight('LMS 발송 · 주말 쿠폰 안내', '쿠폰')).toEqual([
      { text: 'LMS 발송 · 주말 ', hit: false }, { text: '쿠폰', hit: true }, { text: ' 안내', hit: false },
    ]);
    expect(splitHighlight('abcABC', 'abc')).toEqual([{ text: 'abc', hit: true }, { text: 'ABC', hit: true }]);
    expect(splitHighlight('없음', 'x')).toEqual([{ text: '없음', hit: false }]);
    expect(splitHighlight('그대로', '')).toEqual([{ text: '그대로', hit: false }]);
  });
});
