/**
 * useCustomerTimeline — 고객 360 조회 훅 (★ 2026-08-22 v2 신설)
 *
 * **이 창의 데이터 훅은 이 파일 하나다.** 표시 조각(Header·Rail·Toolbar·List·States)은 props만 받는 무훅 함수다.
 * 훅 개수 불일치 크래시(LESSONS_FRONTEND 2026-07-06)의 표면을 파일 1개로 줄인다.
 *
 * 규칙
 *   - 검색어는 입력값(qInput)과 적용값(qApplied)을 나눈다. 250ms 디바운스로 적용값만 바뀌고 조회는 적용값에만 묶인다.
 *     Enter는 디바운스를 건너뛴다. 확정 버튼은 없다(1클릭 하한).
 *   - 조건(종류·검색어·기간)이 바뀌면 before·events·expanded를 함께 버린다. 같은 커서를 다른 조건에 재사용하면 경계가 어긋난다.
 *   - 요약은 고객당 한 번(조건 없는 첫 로드)만 받는다. 이후 재조회는 `summary=0`. 칩 클릭마다 MySQL COUNT가 돌지 않고
 *     요약(마지막 활동 포함)이 조건에 따라 흔들리지 않는다(v2 §2-5).
 *   - 늦게 온 응답이 바뀐 조건을 덮지 않게 reqSeq를 유지한다.
 *   - 재조회 중 목록을 비우지 않는다(화면은 opacity만 내린다). 첫 로드만 스켈레톤.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FILTER_EXPAND, type TimelineKind } from './timeline-kinds';
import { DEFAULT_RANGE, buildTimelineParams, hasConditions, type RangeKey, type TimelineQuery } from './timeline-query';

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  subtitle?: string;
  status?: string | null;
  detail?: Record<string, any>;
  ref?: { type: string; id: string };
}

export interface TimelineCustomer {
  id: string; name: string | null; phone: string | null; grade: string | null;
  stores: string[]; smsOptIn: boolean; isUnsubscribed: boolean; registeredAt: string | null;
}

export interface TimelineSummary {
  sends: number | null;
  engagements: number;
  purchases: number;
  lastActivityAt: string | null;
  basis?: { months: number };
  monthly?: { ym: string; sends: number }[];
}

export interface TimelineSources {
  [kind: string]: { truncated?: boolean; error?: string; tables?: number; rangeCapped?: boolean } | undefined;
}

interface TimelineResponse {
  success: boolean;
  customer: TimelineCustomer;
  summary: TimelineSummary;
  events: TimelineEvent[];
  nextBefore: string | null;
  sources: TimelineSources;
  error?: string;
}

const DEBOUNCE_MS = 250;

export function useCustomerTimeline(customerId: string) {
  const [customer, setCustomer] = useState<TimelineCustomer | null>(null);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [sources, setSources] = useState<TimelineSources>({});
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);       // 첫 로드(스켈레톤)
  const [refreshing, setRefreshing] = useState(false); // 조건 변경 재조회(목록 유지 + 흐림)
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);

  // 조건
  const [active, setActive] = useState<TimelineKind | null>(null);
  const [qInput, setQInput] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  const reqSeq = useRef(0);
  const hasSummary = useRef(false);

  // 고객이 바뀌면 전부 초기화
  useEffect(() => {
    setCustomer(null); setSummary(null); setEvents([]); setSources({}); setNextBefore(null);
    setError(null); setMoreError(null); setLoading(true);
    setActive(null); setQInput(''); setQApplied(''); setRange(DEFAULT_RANGE);
    hasSummary.current = false;
  }, [customerId]);

  // 검색어 디바운스 — 적용값만 조회에 묶인다
  useEffect(() => {
    const t = setTimeout(() => setQApplied(qInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput]);

  const kindsParam = useMemo(
    () => (active ? (FILTER_EXPAND[active] || [active]).join(',') : ''),
    [active],
  );
  const query: TimelineQuery = useMemo(() => ({ kinds: kindsParam, q: qApplied, range }), [kindsParam, qApplied, range]);
  const conditioned = hasConditions(query);

  const load = useCallback(async (before: string | null) => {
    const seq = ++reqSeq.current;
    const first = !before;
    if (first) {
      // 요약을 아직 못 받았다 = 이 고객의 첫 화면이다 → 스켈레톤. 받았다 = 조건 변경 재조회 → 목록 유지 + 흐림
      if (!hasSummary.current) setLoading(true); else setRefreshing(true);
      setError(null);
    } else {
      setLoadingMore(true);
      setMoreError(null);
    }
    try {
      const params = buildTimelineParams(query, { before, withSummary: first && !hasSummary.current && !conditioned });
      const res = await fetch(`/api/customers/${customerId}/timeline?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const json: TimelineResponse = await res.json();
      if (seq !== reqSeq.current) return;
      if (!res.ok || !json.success) throw new Error(json.error || '활동 기록을 불러오지 못했습니다.');
      setCustomer(json.customer);
      if (!hasSummary.current && params.get('summary') !== '0') {
        setSummary(json.summary);
        hasSummary.current = true;
      }
      setSources(json.sources || {});
      setNextBefore(json.nextBefore);
      setEvents((prev) => (before ? [...prev, ...json.events] : json.events));
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      if (first) { setError(e?.message || '활동 기록을 불러오지 못했습니다.'); setEvents([]); setNextBefore(null); }
      else setMoreError(e?.message || '불러오지 못했습니다.');
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [customerId, query, conditioned]);

  // 조건이 바뀌면 첫 페이지부터
  useEffect(() => { load(null); }, [load]);

  const applyNow = useCallback(() => setQApplied(qInput.trim()), [qInput]);
  const clearQ = useCallback(() => { setQInput(''); setQApplied(''); }, []);
  const clearAll = useCallback(() => { setActive(null); setQInput(''); setQApplied(''); setRange(DEFAULT_RANGE); }, []);
  /** 같은 칩을 다시 누르면 전체로 돌아온다 */
  const selectKind = useCallback((k: TimelineKind | null) => setActive((prev) => (k === null || prev === k ? null : k)), []);
  const loadMore = useCallback(() => { if (nextBefore && !loadingMore) load(nextBefore); }, [nextBefore, loadingMore, load]);
  const retry = useCallback(() => load(null), [load]);

  return {
    customer, summary, events, sources, nextBefore,
    loading, refreshing, loadingMore, error, moreError,
    active, qInput, qApplied, range, conditioned,
    setQInput, applyNow, clearQ, clearAll, selectKind, setRange, loadMore, retry,
  };
}

export type CustomerTimelineState = ReturnType<typeof useCustomerTimeline>;
