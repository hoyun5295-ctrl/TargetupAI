/**
 * Customer360Panel — 고객 한 명의 활동 타임라인 (★ 2026-08-22 신설)
 *
 * 데이터는 `GET /api/customers/:id/timeline` 하나에서 온다. 제목·상태 문구는 **서버가 완성해서** 준다
 * (설계서 §2-5). 여기는 묶고 그리는 일만 한다.
 *
 * 구성: 헤더(이름·번호·등급·매장·수신 상태) → 요약 4칸 → 접이식 기본 정보 → 필터 칩 → 날짜별 타임라인 → 더 보기.
 * 톤 = 콘솔 톤(`CUI_*`). 이모지 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Info, Loader2, RotateCcw, X, Clock } from 'lucide-react';
import {
  CUI_PILL_BASE, CUI_PILL_DOT, CUI_BTN_OUTLINE, CUI_BTN_GHOST,
  CUI_EMPTY_BADGE, CUI_EMPTY_TITLE, CUI_EMPTY_DESC,
  CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_CHIP_ON, CUI_CHIP_OFF,
} from '../../utils/console-ui';
import {
  KIND_STYLE, FILTER_KINDS, FILTER_EXPAND, STATUS_DOT, dayLabel, timeLabel,
  type TimelineKind,
} from './timeline-kinds';

interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  subtitle?: string;
  status?: string | null;
  detail?: Record<string, any>;
  ref?: { type: string; id: string };
}

interface TimelineResponse {
  success: boolean;
  customer: {
    id: string; name: string | null; phone: string | null; grade: string | null;
    stores: string[]; smsOptIn: boolean; isUnsubscribed: boolean; registeredAt: string | null;
  };
  summary: { sends: number; engagements: number; purchases: number; lastActivityAt: string | null };
  events: TimelineEvent[];
  nextBefore: string | null;
  sources: Record<string, { truncated?: boolean; error?: string; tables?: number }>;
  error?: string;
}

interface Props {
  customerId: string;
  /** 목록에서 넘어온 값 — 응답이 오기 전에도 헤더를 그린다(빈 화면을 보이지 않는다) */
  fallbackName?: string | null;
  fallbackPhone?: string | null;
  onClose: () => void;
  /** 접이식 "기본 정보"에 넣을 내용. 목록 화면이 이미 갖고 있는 필드 표를 그대로 받는다 */
  basicInfo?: React.ReactNode;
  /** 발송 결과 상세로 보내기(캠페인 참조가 있을 때만) */
  onOpenCampaign?: (campaignId: string) => void;
}

const PHONE_FMT = (p: string | null | undefined) => {
  const v = String(p || '').replace(/[^0-9]/g, '');
  if (v.length === 11) return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
  if (v.length === 10) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  return p || '';
};

export default function Customer360Panel({
  customerId, fallbackName, fallbackPhone, onClose, basicInfo, onOpenCampaign,
}: Props) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<TimelineKind>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [basicOpen, setBasicOpen] = useState(false);

  /** 늦게 온 응답이 그 사이 바뀐 고객·필터를 덮지 않게 한다 */
  const reqSeq = useRef(0);

  const kindsParam = useMemo(() => {
    if (active.size === 0) return '';
    const set = new Set<TimelineKind>();
    for (const k of active) {
      for (const x of (FILTER_EXPAND[k] || [k])) set.add(x);
    }
    return Array.from(set).join(',');
  }, [active]);

  const load = useCallback(async (before: string | null) => {
    const seq = ++reqSeq.current;
    if (before) setLoadingMore(true); else { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (before) params.set('before', before);
      if (kindsParam) params.set('kinds', kindsParam);
      const res = await fetch(`/api/customers/${customerId}/timeline?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const json: TimelineResponse = await res.json();
      if (seq !== reqSeq.current) return;
      if (!res.ok || !json.success) throw new Error(json.error || '활동 기록을 불러오지 못했습니다.');
      setData(json);
      setEvents((prev) => (before ? [...prev, ...json.events] : json.events));
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      if (!before) { setError(e?.message || '활동 기록을 불러오지 못했습니다.'); setEvents([]); }
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [customerId, kindsParam]);

  useEffect(() => { setExpanded(new Set()); load(null); }, [load]);
  useEffect(() => { setActive(new Set()); setBasicOpen(false); }, [customerId]);

  const toggleKind = (k: TimelineKind) => setActive((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // 날짜별 묶음
  const groups = useMemo(() => {
    const out: { day: string; items: TimelineEvent[] }[] = [];
    for (const e of events) {
      const day = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events]);

  const customer = data?.customer;
  const name = customer?.name ?? fallbackName ?? null;
  const phone = customer?.phone ?? fallbackPhone ?? null;
  const truncatedKinds = Object.entries(data?.sources || {}).filter(([, v]) => v?.truncated).map(([k]) => k);
  const erroredKinds = Object.entries(data?.sources || {}).filter(([, v]) => v?.error).map(([k]) => k);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* 헤더 */}
      <div className="shrink-0 px-5 py-4 border-b border-neutral-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900 truncate">{name || '이름 없음'}</h3>
              {customer?.grade && (
                <span className={`${CUI_PILL_BASE} bg-indigo-50 text-indigo-700`}>{customer.grade}</span>
              )}
              {customer && (
                customer.isUnsubscribed ? (
                  <span className={`${CUI_PILL_BASE} bg-rose-100 text-rose-800`}>
                    <span className={CUI_PILL_DOT} aria-hidden="true" />수신거부
                  </span>
                ) : (
                  <span className={`${CUI_PILL_BASE} ${customer.smsOptIn ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>
                    <span className={CUI_PILL_DOT} aria-hidden="true" />{customer.smsOptIn ? '수신 동의' : '수신 미동의'}
                  </span>
                )
              )}
            </div>
            <p className="mt-1 text-[13px] text-neutral-500 font-mono">{PHONE_FMT(phone)}</p>
            {customer && customer.stores.length > 0 && (
              <p className="mt-0.5 text-[12px] text-neutral-400 truncate">{customer.stores.join(' · ')}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* 요약 */}
        <div className="mt-3.5 grid grid-cols-4 gap-2">
          {[
            { label: '받은 메시지', value: data?.summary.sends },
            { label: '반응', value: data?.summary.engagements },
            { label: '구매', value: data?.summary.purchases },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200 px-2.5 py-2 text-center">
              <p className="text-[11px] text-neutral-500">{s.label}</p>
              <p className="mt-0.5 text-[16px] font-bold text-neutral-900 tabular-nums">
                {loading && data == null ? '-' : (s.value ?? 0).toLocaleString()}
              </p>
            </div>
          ))}
          <div className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200 px-2.5 py-2 text-center">
            <p className="text-[11px] text-neutral-500">마지막 활동</p>
            <p className="mt-0.5 text-[12.5px] font-semibold text-neutral-900">
              {data?.summary.lastActivityAt ? dayLabel(data.summary.lastActivityAt) : '없음'}
            </p>
          </div>
        </div>
      </div>

      {/* 기본 정보(접이식) — 기존 필드 표를 없애지 않는다 */}
      {basicInfo && (
        <div className="shrink-0 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => setBasicOpen((v) => !v)}
            className="w-full px-5 py-2.5 flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            {basicOpen ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
            기본 정보
          </button>
          {basicOpen && <div className="px-5 pb-4 max-h-[280px] overflow-y-auto">{basicInfo}</div>}
        </div>
      )}

      {/* 필터 칩 */}
      <div className="shrink-0 px-5 py-2.5 border-b border-neutral-200 flex items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => setActive(new Set())} className={active.size === 0 ? CUI_CHIP_ON : CUI_CHIP_OFF}>
          전체
        </button>
        {FILTER_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => toggleKind(k)} className={active.has(k) ? CUI_CHIP_ON : CUI_CHIP_OFF}>
            {KIND_STYLE[k].label}
          </button>
        ))}
      </div>

      {/* 타임라인 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {loading && data == null ? (
          <div className="py-16 grid place-items-center gap-2.5 text-[13px] text-neutral-500">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
            활동 기록을 불러오는 중
          </div>
        ) : error ? (
          <div className="py-14 grid place-items-center text-center gap-3">
            <p className="text-[13px] text-neutral-600">{error}</p>
            <button type="button" onClick={() => load(null)} className={CUI_BTN_OUTLINE}>
              <RotateCcw className="w-[15px] h-[15px]" />다시 시도
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="py-14 grid place-items-center text-center">
            <div className={CUI_EMPTY_BADGE}><Clock className="w-5 h-5" strokeWidth={1.6} /></div>
            <p className={CUI_EMPTY_TITLE}>{active.size > 0 ? '고른 종류의 기록이 없습니다' : '아직 기록이 없습니다'}</p>
            <p className={CUI_EMPTY_DESC}>
              {active.size > 0 ? '다른 종류를 골라 보세요' : '메시지를 보내거나 고객이 반응하면 여기에 쌓입니다'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.day}>
                <p className="text-[12px] font-semibold text-neutral-400 mb-2">{g.day}</p>
                <ul className="space-y-1">
                  {g.items.map((e) => {
                    const style = KIND_STYLE[e.kind] || KIND_STYLE.behavior;
                    const Icon = style.icon;
                    const open = expanded.has(e.id);
                    const hasDetail = !!e.detail && Object.keys(e.detail).length > 0;
                    return (
                      <li key={`${e.kind}:${e.id}`} className="rounded-xl transition hover:bg-neutral-50">
                        <button
                          type="button"
                          onClick={() => hasDetail && toggleExpand(e.id)}
                          className={`w-full text-left px-2.5 py-2 flex items-start gap-2.5 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className={`h-7 w-7 shrink-0 mt-0.5 rounded-lg grid place-items-center ${style.tile}`}>
                            <Icon className="w-[15px] h-[15px]" strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="text-[13.5px] font-medium text-neutral-900 truncate">{e.title}</span>
                              {e.status && STATUS_DOT[e.status] && (
                                <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${STATUS_DOT[e.status]}`} aria-hidden="true" />
                              )}
                            </span>
                            {e.subtitle && <span className="block text-[12px] text-neutral-500 mt-0.5 truncate">{e.subtitle}</span>}
                          </span>
                          <span className="shrink-0 text-[11.5px] text-neutral-400 tabular-nums mt-0.5">{timeLabel(e.at)}</span>
                        </button>

                        {open && e.detail && (
                          <div className="px-2.5 pb-3 pl-[46px]">
                            <div className="rounded-lg bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2.5 space-y-1.5">
                              {e.detail.content && (
                                <p className="text-[12.5px] text-neutral-700 whitespace-pre-wrap break-words leading-relaxed">{e.detail.content}</p>
                              )}
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                                {Object.entries(e.detail)
                                  .filter(([k, v]) => k !== 'content' && v != null && v !== '' && typeof v !== 'object')
                                  .map(([k, v]) => (
                                    <div key={k} className="flex items-center gap-1.5 min-w-0">
                                      <dt className="text-[11px] text-neutral-400 shrink-0">{DETAIL_LABEL[k] || k}</dt>
                                      <dd className="text-[11.5px] text-neutral-700 truncate">{String(v)}</dd>
                                    </div>
                                  ))}
                              </dl>
                              {e.ref?.type === 'campaign' && onOpenCampaign && (
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); onOpenCampaign(e.ref!.id); }}
                                  className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                                >
                                  발송 결과 보기<ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {(truncatedKinds.length > 0 || erroredKinds.length > 0) && (
              <div className={CUI_INFO}>
                <Info className={CUI_INFO_ICON} size={15} strokeWidth={1.9} />
                <div className={CUI_INFO_TEXT}>
                  {truncatedKinds.length > 0 && <p>기록이 많아 일부만 보입니다. 아래 "더 보기"로 이어서 볼 수 있습니다.</p>}
                  {erroredKinds.length > 0 && (
                    <p>{erroredKinds.map((k) => KIND_STYLE[k as TimelineKind]?.label || k).join(' · ')} 기록은 지금 불러오지 못했습니다.</p>
                  )}
                </div>
              </div>
            )}

            {data?.nextBefore && (
              <button
                type="button"
                onClick={() => load(data.nextBefore)}
                disabled={loadingMore}
                className={`${CUI_BTN_GHOST} w-full`}
              >
                {loadingMore ? <><Loader2 className="w-[15px] h-[15px] animate-spin" />불러오는 중</> : '더 보기'}
              </button>
            )}

            <p className="text-[10px] text-neutral-400 italic pt-1">
              Data source: 발송 큐 · 고객 DB · 자사몰 이벤트
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** detail 키 라벨 — 서버가 원문 필드명을 주므로 화면에서만 한국어로 바꾼다 */
const DETAIL_LABEL: Record<string, string> = {
  subject: '제목', callback: '발신번호', statusCode: '상태 코드', statusLabel: '상태',
  carrier: '통신사', requestedAt: '요청', sentAt: '발송', messageType: '유형',
  productName: '상품', productCode: '상품코드', quantity: '수량', amount: '금액', storeName: '매장',
  eventName: '이벤트', source: '출처', eventType: '유형', dwellSeconds: '머문 시간',
  pageReached: '도달 페이지', totalPages: '전체 페이지', durationSeconds: '머문 시간',
  maxScrollPct: '스크롤', openCount: '열람 횟수', sectionType: '구역',
  channel: '채널', consentType: '동의 유형', journeyName: '여정', executionStatus: '진행 상태',
  stepOrder: '단계', logStatus: '결과', reason: '사유', transcript: '통화 내용',
  response: '응답', durationSeconds2: '통화 시간', callStatus: '통화 상태', url: '링크',
};
