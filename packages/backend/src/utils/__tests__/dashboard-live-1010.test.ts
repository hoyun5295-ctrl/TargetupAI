/**
 * ★ 2026-10-10 대시보드 B안(의미 있는 움직임만) — 「지금 돌고 있는 자동화」 판정 잠금.
 *   움직임은 서버가 준 상태에만 붙는다: 켜진 여정 · 켜진 자동 마케팅만 개수에 들어가고, 꺼짐 · 지난 예약은 빠진다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { countdownText, countdownTickMs, serialRunner, summarizeLive } from '../../../../frontend/src/utils/dashboard-live';

const NOW = Date.parse('2026-10-10T08:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('summarizeLive', () => {
  it('켜진 여정 + 켜진 자동 마케팅만 센다 · 멈춤 · 크레딧 부족 · 초안 · 종료는 빠진다', () => {
    const s = summarizeLive({
      operators: [
        { name: '주말 재구매', status: 'active', nextRunAt: iso(NOW + 3_600_000) },
        { name: '멈춤', status: 'paused', nextRunAt: iso(NOW + 60_000) },
        { name: '잔액 없음', status: 'paused_no_credit', nextRunAt: iso(NOW + 60_000) },
      ],
      journeys: [
        { name: '첫 구매 감사', status: 'active', stats_total_entered: '120' },
        { name: '생일', status: 'active', stats_total_entered: 8 },
        { name: '초안', status: 'draft', stats_total_entered: 999 },
        { name: '끝남', status: 'ended', stats_total_entered: 999 },
      ],
      scheduled: [],
      sending: null,
      now: NOW,
    });
    expect(s.running).toBe(3);
    expect(s.journeys).toEqual({ count: 2, firstName: '첫 구매 감사', entered: 128 });
    expect(s.auto).toEqual({ count: 1, nextName: '주말 재구매', nextRunAt: NOW + 3_600_000 });
  });

  it('다음 회차 = 가장 이른 운영자 · 비었거나 지난 운영자가 먼저(워커가 다음 분에 집는다)', () => {
    const base = { status: 'active' as const };
    const later = summarizeLive({
      operators: [{ ...base, name: 'B', nextRunAt: iso(NOW + 7_200_000) }, { ...base, name: 'A', nextRunAt: iso(NOW + 60_000) }],
      journeys: [], scheduled: [], sending: null, now: NOW,
    });
    expect(later.auto?.nextName).toBe('A');
    const due = summarizeLive({
      operators: [{ ...base, name: 'A', nextRunAt: iso(NOW + 60_000) }, { ...base, name: '비어 있음', nextRunAt: null }],
      journeys: [], scheduled: [], sending: null, now: NOW,
    });
    expect(due.auto).toEqual({ count: 2, nextName: '비어 있음', nextRunAt: null });
  });

  it('예약 대기 = 지금 이후만 · 가장 이른 것이 다음 발송', () => {
    const s = summarizeLive({
      operators: [], journeys: [], sending: null, now: NOW,
      scheduled: [
        { campaign_name: '지남', scheduled_at: iso(NOW - 60_000) },
        { campaign_name: 'VIP 신상', scheduled_at: iso(NOW + 5_400_000) },
        { campaign_name: '시각 없음', scheduled_at: null },
        { campaign_name: '가을 세일', scheduled_at: iso(NOW + 1_800_000) },
      ],
    });
    expect(s.scheduled).toEqual({ count: 2, nextName: '가을 세일', nextAt: NOW + 1_800_000 });
    expect(s.running).toBe(0);
  });

  it('아무것도 없으면 전부 비어 있다(빈 띠 = 시작 안내)', () => {
    const s = summarizeLive({ operators: [], journeys: [], scheduled: [], sending: null, now: NOW });
    expect(s).toEqual({ running: 0, journeys: null, auto: null, scheduled: null, sending: null, stalled: null });
  });

  it('크레딧이 부족해 멈춘 자동 마케팅 = 정지 칸 · 자동으로 도는 수에는 안 들어간다', () => {
    const s = summarizeLive({
      operators: [{ name: 'A', status: 'paused_no_credit', nextRunAt: null }, { name: 'B', status: 'paused_no_credit', nextRunAt: null }],
      journeys: [], scheduled: [], sending: null, now: NOW,
    });
    expect(s.stalled).toEqual({ count: 2 });
    expect(s.running).toBe(0);
    expect(s.auto).toBeNull();
  });
});

describe('countdownText', () => {
  it('지났거나 비었으면 null(= 곧) · 하루 안 = 시:분:초 · 하루 이상 = 일·시간', () => {
    expect(countdownText(null)).toBeNull();
    expect(countdownText(0)).toBeNull();
    expect(countdownText(-5000)).toBeNull();
    expect(countdownText((45 * 60 + 7) * 1000)).toBe('00:45:07');
    expect(countdownText((1 * 3600 + 17 * 60 + 55) * 1000)).toBe('1시간 17분');
    expect(countdownText((2 * 86400 + 5 * 3600 + 30) * 1000)).toBe('2일 5시간');
  });

  it('초가 도는 것은 마지막 1시간뿐(그 밖은 1분마다 다시 그림)', () => {
    expect(countdownTickMs(59 * 60 * 1000)).toBe(1000);
    expect(countdownTickMs(3_600_000)).toBe(60_000);
    expect(countdownTickMs(null)).toBe(60_000);
    expect(countdownTickMs(0)).toBe(60_000);
  });
});

describe('대시보드 화면 계약', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const dash = readFileSync(resolve(FRONT, 'pages/Dashboard.tsx'), 'utf8');
  const strip = readFileSync(resolve(FRONT, 'components/dashboard/LiveAutomationStrip.tsx'), 'utf8');
  const isComment = (line: string) => /^\s*(\/\/|\*|\{\/\*)/.test(line);

  it('늘 깜빡이던 REAL-TIME 표시는 없고 서버가 계산한 시각을 쓴다', () => {
    // 옛 표시 = JSX 안 한 줄짜리 글자(주석의 경위 설명은 남아 있어도 된다)
    expect(dash).not.toMatch(/^\s*REAL-TIME\s*$/m);
    expect(dash).toContain('formatKstClock(dbAsOf)');
    // 브라우저 시각(new Date())이 아니라 dashboard-cards 응답 asOf(캐시 엔벨로프 at)
    expect(dash).toContain("setDbAsOf(typeof cardsData?.asOf === 'number' ? new Date(cardsData.asOf) : null)");
    expect(dash).not.toContain('setDbAsOf(new Date())');
    const companies = readFileSync(resolve(__dirname, '../../routes/companies.ts'), 'utf8');
    expect(companies).toContain('const { value: cards, at: cardsAt } = await swrCacheWithAt({');
    expect(companies).toContain('asOf: cardsAt,');
  });

  it('띠는 읽기만 한다(쓰기 요청 0) · 퍼지는 고리는 머리 점 하나', () => {
    expect(strip).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/);
    expect(strip.match(/animate-ping/g)?.length).toBe(1);
    expect(strip).toContain('motion-safe:animate-ping');
  });

  it('발송 끝 상태 = 통신 실패는 끝으로 보지 않는다 · 접수 끝 4초 · 실패 1분 · 여정 403 은 칸만 숨김', () => {
    expect(strip).toContain('if (!pr.ok || !pr.body?.success) { setPollFail(true); return; }');
    expect(strip).toContain('const DONE_SHOW_MS = { sent: 4000, failed: 60_000 } as const;');
    expect(strip).toContain('else if (jr.status === 403) setJourneys([]);');
  });

  it('움직임 줄이기 = 이번에 붙인 들어오기 전부 정지 · 무한 ping 은 motion-safe 로만', () => {
    const files = [
      'components/dashboard/LiveAutomationStrip.tsx', 'components/CampaignSuccessModal.tsx', 'components/ToastProvider.tsx',
      'components/UploadProgressModal.tsx', 'components/marketing-diagnosis/DiagnosisHeroCard.tsx', 'utils/dashboard-live.ts',
      'components/dashboard/CardDetailModal.tsx', 'components/AiOperatorLoginPromo.tsx', 'components/dashboard/CountUp.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(FRONT, f), 'utf8');
      for (const line of src.split('\n')) {
        if (isComment(line)) continue;
        if (/animate-(in|dialog-in|backdrop-in)\b/.test(line)) expect(line, f).toContain('motion-reduce:animate-none');
        if (/animate-ping/.test(line)) expect(line, f).toMatch(/motion-safe:animate-ping/);
        // 임의 값 duration · delay · ease 는 애니메이션 플러그인과 이름이 겹쳐 CSS 가 생성되지 않는다(1010 빌드 경고 ambiguous)
        expect(line, f).not.toMatch(/\b(duration|delay|ease)-\[/);
      }
    }
    // 대시보드 = 공용 상수(ENTER_ONCE) 하나 · 페이지를 새로 열 때 1회
    expect(dash).toContain("const ENTER = intro ? ENTER_ONCE : '';");
    expect(dash).toContain('const [intro] = useState(dashboardIntroPending);');
  });

  it('주의 점은 두 번 퍼지고 멈춘다(반복 횟수 = 단축 속성 한 줄)', () => {
    const tw = readFileSync(resolve(__dirname, '../../../../frontend/tailwind.config.js'), 'utf8');
    expect(tw).toContain("'ping-twice': 'ping 1s cubic-bezier(0, 0, 0.2, 1) 2',");
    expect(dash.match(/motion-safe:animate-ping-twice/g)?.length).toBe(2);
  });
});

describe('회의론자 최종 검증 조건(2026-10-10)', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const dash = readFileSync(resolve(FRONT, 'pages/Dashboard.tsx'), 'utf8');
  const strip = readFileSync(resolve(FRONT, 'components/dashboard/LiveAutomationStrip.tsx'), 'utf8');
  const campaigns = readFileSync(resolve(__dirname, '../../routes/campaigns.ts'), 'utf8');

  it('① 끝 문구는 status 로 가른다 — 단계 sent 는 적재 끝일 뿐(0건 = failed · 취소 = cancelled)', () => {
    expect(campaigns).toContain('SELECT target_count, processed_count, send_phase, sent_count, fail_count, created_by, status FROM campaigns WHERE id = $1 AND company_id = $2');
    expect(campaigns).toContain('status: r.status || null,');
    expect(strip).toContain("if (status === 'cancelled') return;");
    expect(strip).toContain("phase: phase === 'failed' || status === 'failed' ? 'failed' : 'sent'");
    // 적재 중 단계일 때만 발송 칸(단계 없는 옛 sending 행은 끝없이 남지 않게)
    expect(strip).toContain("const SENDING_ACTIVE = new Set(['preparing', 'queued', 'processing']);");
  });

  it('② 늦게 끝난 읽기가 새 결과를 덮지 않는다(읽기는 하나씩 · 4R) · 끝난 캠페인은 되살아나지 않는다 · 끝 판정은 3초 진행률만', () => {
    expect(strip).toContain('const runLoad = useMemo(() => serialRunner(load), [load]);');
    expect(strip).not.toMatch(/void load\(\)/);
    expect(strip).toContain('if (finished.current.has(id)) return;');
    expect(strip).toContain('finished.current.has(c.id)');
    // load 안에서는 finish 를 부르지 않는다
    const load = strip.slice(strip.indexOf('const load = useCallback('), strip.indexOf('}, [get]);'));
    expect(load).not.toContain('finish(');
  });

  it('③ 자동화 수는 두 축이 다 확인됐을 때만 버튼에 · 일부 실패면 기준 시각을 숨긴다', () => {
    expect(strip).toContain("setRunOk(op.ok && (jr.ok || jr.status === 403));");
    expect(strip).toContain('const runningShown = runOk ? s.running : 0;');
    expect(strip).toContain('{asOf && !shownPartial && <span');
  });

  it('④ 다시 읽기 신호는 즉시 직접발송 · 타겟발송 접수 두 곳뿐(/:id/send 경로는 응답 전에 끝난다) · 3초 재시도 없음', () => {
    expect(dash.match(/setLiveRefresh\(\(n\) => n \+ 1\)/g)?.length).toBe(2);
    expect(strip).toContain('useEffect(() => { if (refreshKey) void runLoad(); }, [refreshKey, runLoad]);');
    expect(strip).not.toContain('setTimeout(() => { void load(); }, 3000)');
  });

  it('⑤ 빈 띠도 자리표시와 같은 높이 · 숨었던 창이 다시 보이면 바로 읽는다', () => {
    expect(strip).toContain('min-h-[86px]');
    expect(strip).toContain("document.addEventListener('visibilitychange', onVisible);");
    expect(strip).toContain("document.removeEventListener('visibilitychange', onVisible);");
  });

  it('주의 점 · 크레딧 · 첫 업로드 공개 보완', () => {
    // 주의 점도 페이지를 새로 열 때만
    expect(dash).toContain("${intro ? 'motion-safe:animate-ping-twice' : ''}");
    expect(dash).toContain('attention={intro}');
    // 잔여가 늘어난 이벤트 = 원장 다시 읽기 · 이력 창 열 때 다시 읽기
    expect(dash).toContain('if (b > cur) { void loadCredit(); return; }');
    expect(dash).toContain('setShowCreditHistory(true); void loadCredit();');
    // 공개 플래그는 다시 읽기 앞에서
    const reveal = dash.slice(dash.indexOf('const revealAfterUpload = async () => {'), dash.indexOf('await loadDashboardCards();\n  };'));
    expect(reveal).toContain('setDbReveal(true)');
    expect(dash).toContain("if (pData?.status === 'unknown') return;");
  });

  it('분 표시 카운트다운은 다음 분 경계에 다시 그린다', () => {
    expect(countdownTickMs(3_600_000 + 25_000)).toBe(25_000);
    expect(countdownTickMs(7_200_000)).toBe(60_000);
  });
});

describe('Codex 1R 정정(2026-10-10)', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const dash = readFileSync(resolve(FRONT, 'pages/Dashboard.tsx'), 'utf8');
  const strip = readFileSync(resolve(FRONT, 'components/dashboard/LiveAutomationStrip.tsx'), 'utf8');

  it('발송 칸의 주인은 하나 — 따라가는 동안 1분 읽기는 칸을 바꾸지 않는다 · 기다린 뒤 끝났으면 그리지 않는다', () => {
    const load = strip.slice(strip.indexOf('const load = useCallback('), strip.indexOf('}, [get]);'));
    expect(load).toContain('if (!tracked.current && c?.id && !finished.current.has(c.id)) {');
    expect(load).toContain('if (SENDING_ACTIVE.has(pr.body.phase) && !finished.current.has(c.id) && !tracked.current) {');
    // 1분 읽기에서 칸을 지우는 setSending(null) 은 없다(지우는 것은 3초 진행률의 끝 · 404 뿐)
    expect(load).not.toMatch(/setSending\(\(?s?\)? ?=?>? ?null|setSending\(null\)/);
    expect(strip).toContain('if (tracked.current === id) tracked.current = null;');
  });

  it('3초 진행률 실패도 머리에 「일부 상태를 확인하지 못했어요」 · 성공하면 풀린다', () => {
    expect(strip).toContain('if (!pr.ok || !pr.body?.success) { setPollFail(true); return; }');
    expect(strip).toContain('const shownPartial = partial || pollFail;');
    expect(strip).toContain('{asOf && !shownPartial && <span');
  });

  it('크레딧 조회 사이 차감이 끼면 응답을 버리지 않고 그 사이 가장 작은 잔여로 눌러 쓴다 · 옛 조회는 새 조회를 덮지 않는다(2R)', () => {
    expect(dash).toContain('const during = creditEvents.current.filter((e) => e.gen > gen).map((e) => e.balance);');
    expect(dash).toContain('setCreditInfo(cap !== null && Number(d.total) > cap ? { ...d, total: cap } : d);');
    // 4R — 조회는 하나씩(서버 읽기 순서 = 반영 순서) · 순번 비교 없음
    expect(dash).toContain('const loadCredit = useRef(serialRunner(async () => {');
    expect(dash).not.toContain('creditApplied');
    expect(dash).toContain('creditGen.current += 1;');
    expect(dash).not.toContain('loadCredit(false)');
  });
});

describe('Codex 2R 정정 — 응답 반영 규칙 하나(정리된 요청 응답 버림 · 겹치지 않게)', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const dash = readFileSync(resolve(FRONT, 'pages/Dashboard.tsx'), 'utf8');
  const strip = readFileSync(resolve(FRONT, 'components/dashboard/LiveAutomationStrip.tsx'), 'utf8');

  it('3초 진행률: 겹치지 않게 하나씩 · 정리됐거나 더 따라가지 않는 칸의 응답은 버린다 · 모든 요청 10초 제한(3R)', () => {
    expect(strip).toContain('if (busy) return;');
    expect(strip).toContain('try { pr = await get(`/api/campaigns/${sendingId}/send-progress`); } finally { busy = false; }');
    expect(strip).toContain('const get = fetchJson;');
    const util = readFileSync(resolve(FRONT, 'utils/dashboard-live.ts'), 'utf8');
    expect(util).toContain('const timer = setTimeout(() => ctl.abort(), timeoutMs);');
    expect(util).toContain('signal: ctl.signal');
    expect(strip).toContain('if (!alive || tracked.current !== sendingId) return;');
    expect(strip).toContain('return () => { alive = false; clearInterval(t); };');
  });

  it('카드 다시 읽기: 늦게 끝난 옛 요청은 새 결과를 덮지 않는다', () => {
    expect(dash).toContain('const loadDashboardCards = useRef(serialRunner(async () => {');
    expect(dash).not.toContain('cardsApplied');
  });
});

describe('serialRunner — 하나씩만 · 도는 동안 들어온 요청은 끝난 뒤 한 번으로(4R)', () => {
  it('겹친 요청 3개 = 실행 2번(지금 것 + 합친 한 번) · 동시에 둘이 돌지 않는다', async () => {
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const gates: Array<() => void> = [];
    const run = serialRunner(async () => {
      running += 1; runs += 1; maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((r) => gates.push(r));
      running -= 1;
    });
    const first = run();
    void run(); void run(); // 첫 실행이 도는 동안 들어온 두 요청 → 한 번으로 합침
    expect(runs).toBe(1);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(2);
    gates.shift()!();
    await first;
    expect(runs).toBe(2);
    expect(maxRunning).toBe(1);
  });

  it('끝난 뒤 새 요청은 다시 돈다 · 실행이 던져도 다음 요청이 막히지 않는다', async () => {
    let runs = 0;
    const run = serialRunner(async () => { runs += 1; if (runs === 1) throw new Error('x'); });
    await run().catch(() => {});
    await run();
    expect(runs).toBe(2);
  });
});

describe('폭별 실측 정정(1010 · 빌드 CSS · 390~1920)', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const strip = readFileSync(resolve(FRONT, 'components/dashboard/LiveAutomationStrip.tsx'), 'utf8');
  const upload = readFileSync(resolve(FRONT, 'components/UploadProgressModal.tsx'), 'utf8');

  it('5칸은 xl 에서만 5등분(1100 폭에서 예약 시각이 잘렸다) · 「외 N개」는 말줄임 밖 · 모바일 머리 둘째 줄 고정', () => {
    expect(strip).toContain("'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'");
    expect(strip).toContain('<span className="shrink-0 font-semibold text-gray-500">외 {s.journeys.count - 1}개</span>');
    expect(strip).toContain('<div className="flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">');
  });

  it('업로드 진행 막대 시간 = 인라인(임의 값 duration 클래스는 CSS 가 생성되지 않는다)', () => {
    expect(upload).toContain("transitionDuration: running ? '1900ms' : '300ms'");
  });
});

