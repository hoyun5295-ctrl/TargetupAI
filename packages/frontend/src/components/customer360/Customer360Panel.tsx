/**
 * Customer360Panel — 고객 한 명의 활동 타임라인 (★ 2026-08-22 신설)
 *
 * 데이터는 `GET /api/customers/:id/timeline` 하나에서 온다. 제목·상태 문구는 **서버가 완성해서** 준다
 * (설계서 §2-5). 여기는 묶고 그리는 일만 한다.
 *
 * 구성: 헤더(이름·번호·등급·수신 상태) → 요약 4칸 → 접이식 기본 정보 → 종류 탭 → 날짜별 타임라인 → 더 보기.
 *
 * ⛔ **톤은 `CustomerDBModal`(고객 DB 조회)을 따른다.** 이 창은 그 목록에서 열리므로 같은 집이어야 한다:
 *   헤더 `bg-gray-50 border-b px-6 py-4` + 닫기 `w-8 h-8 rounded-full` 우측 끝 · 섹션 `px-6 py-3 border-b` ·
 *   날짜 머리는 표 헤더처럼 `bg-gray-50` sticky. 강조만 인디고(Harold 지시).
 *   처음엔 콘솔 톤(CUI_*)에 읽기 폭 880px을 씌웠는데, 1,100px 창에서 내용이 왼쪽에 몰려 오른쪽이 비고
 *   헤더 배경이 없어 요약과 구분이 사라졌다 — "각이 안 잡혔다"(2026-08-22 Harold). 폭 제한을 걷고 옛 언어로 맞췄다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Info, Loader2, RotateCcw, Clock } from 'lucide-react';
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
  /**
   * 종류 필터는 **하나만** 고른다(null = 전체).
   * ⛔ 처음엔 여러 개를 켜는 토글이었는데, 누를수록 쌓여서 무엇을 보고 있는지 알 수 없게 됐다
   *   (2026-08-22 Harold "다른 걸 선택하면 그걸로 바로 넘어가야지"). 탭처럼 고른 것 하나만 켠다.
   */
  const [active, setActive] = useState<TimelineKind | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [basicOpen, setBasicOpen] = useState(false);

  /** 늦게 온 응답이 그 사이 바뀐 고객·필터를 덮지 않게 한다 */
  const reqSeq = useRef(0);

  // 하나를 고르면 짝이 되는 종류까지 함께 본다(DM 열람 → 응답 포함, 발송 → 이메일 포함)
  const kindsParam = useMemo(
    () => (active ? (FILTER_EXPAND[active] || [active]).join(',') : ''),
    [active],
  );

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
  useEffect(() => { setActive(null); setBasicOpen(false); }, [customerId]);

  /** 같은 칩을 다시 누르면 전체로 돌아온다 */
  const selectKind = (k: TimelineKind) => setActive((prev) => (prev === k ? null : k));

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

      {/* ── 헤더 — 고객 DB 조회와 같은 언어(bg-gray-50 + border-b + px-6 py-4, X는 우측 끝) ── */}
      <div className="shrink-0 flex justify-between items-start gap-4 px-6 py-4 border-b bg-gray-50">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-gray-800 truncate">{name || '이름 없음'}</h3>
            {customer?.grade && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">{customer.grade}</span>
            )}
            {customer && (
              customer.isUnsubscribed ? (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600">수신거부</span>
              ) : (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${customer.smsOptIn ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {customer.smsOptIn ? '수신 동의' : '수신 미동의'}
                </span>
              )
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{PHONE_FMT(phone)}</span>
            {customer && customer.stores.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="truncate">{customer.stores.join(', ')}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors text-lg"
        >
          &times;
        </button>
      </div>

      {/* ── 요약 4칸 ── */}
      <div className="shrink-0 grid grid-cols-4 divide-x border-b">
        {[
          { label: '받은 메시지', value: data?.summary.sends, suffix: '건' },
          { label: '반응', value: data?.summary.engagements, suffix: '건' },
          { label: '구매', value: data?.summary.purchases, suffix: '건' },
        ].map((s) => (
          <div key={s.label} className="px-6 py-3">
            <div className="text-xs text-gray-400">{s.label}</div>
            <div className="mt-0.5 text-xl font-bold text-gray-800 tabular-nums">
              {loading && data == null ? '-' : (s.value ?? 0).toLocaleString()}
              <span className="ml-0.5 text-xs font-normal text-gray-400">{s.suffix}</span>
            </div>
          </div>
        ))}
        <div className="px-6 py-3">
          <div className="text-xs text-gray-400">마지막 활동</div>
          <div className="mt-0.5 text-base font-bold text-gray-800">
            {data?.summary.lastActivityAt ? dayLabel(data.summary.lastActivityAt) : '없음'}
          </div>
        </div>
      </div>

      {/* ── 기본 정보(접이식) — 옛 우측 패널이 보여주던 필드 표 ── */}
      {basicInfo && (
        <div className="shrink-0 border-b">
          <button
            type="button"
            onClick={() => setBasicOpen((v) => !v)}
            className="w-full px-6 py-2.5 flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {basicOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            기본 정보
          </button>
          {basicOpen && <div className="px-6 pb-4 max-h-[260px] overflow-y-auto">{basicInfo}</div>}
        </div>
      )}

      {/* ── 종류 탭 — 옛 화면의 필터 버튼과 같은 규격 ── */}
      <div className="shrink-0 px-6 py-2.5 border-b flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => setActive(null)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            active === null ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          전체
        </button>
        {FILTER_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => selectKind(k)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              active === k ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {KIND_STYLE[k].label}
          </button>
        ))}
      </div>

      {/* ── 타임라인 ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && data == null ? (
          <div className="py-20 flex flex-col items-center gap-2.5 text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            활동 기록을 불러오는 중
          </div>
        ) : error ? (
          <div className="py-20 flex flex-col items-center gap-3 text-center px-6">
            <p className="text-sm text-gray-600">{error}</p>
            <button
              type="button"
              onClick={() => load(null)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />다시 시도
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="py-20 flex flex-col items-center text-center px-6">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
              <Clock className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {active ? `${KIND_STYLE[active].label} 기록이 없습니다` : '아직 기록이 없습니다'}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {active ? '위에서 다른 종류를 골라 보세요' : '메시지를 보내거나 고객이 반응하면 여기에 쌓입니다'}
            </p>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.day}>
                {/* 날짜 머리 — 표 헤더와 같은 언어로 붙여 스크롤 중에도 기준이 남는다 */}
                <div className="sticky top-0 z-10 px-6 py-1.5 bg-gray-50 border-b text-xs font-semibold text-gray-500">
                  {g.day}
                </div>
                {g.items.map((e) => {
                  const style = KIND_STYLE[e.kind] || KIND_STYLE.behavior;
                  const Icon = style.icon;
                  const open = expanded.has(e.id);
                  const hasDetail = !!e.detail && Object.keys(e.detail).length > 0;
                  return (
                    <div key={`${e.kind}:${e.id}`} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => hasDetail && toggleExpand(e.id)}
                        className={`w-full text-left px-6 py-3 flex items-start gap-3 transition-colors ${hasDetail ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                      >
                        <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${style.tile}`}>
                          <Icon className="w-[15px] h-[15px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-800 truncate">{e.title}</span>
                            {e.status && STATUS_DOT[e.status] && (
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[e.status]}`} aria-hidden="true" />
                            )}
                          </span>
                          {e.subtitle && <span className="block mt-0.5 text-xs text-gray-500 truncate">{e.subtitle}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-gray-400 tabular-nums pt-0.5">{timeLabel(e.at)}</span>
                        {hasDetail && (
                          <ChevronDown className={`w-4 h-4 shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                        )}
                      </button>

                      {open && e.detail && (
                        <div className="px-6 pb-4 pl-[68px]">
                          <div className="rounded-lg bg-gray-50 border p-3 space-y-2">
                            {e.detail.content && (
                              <p className="text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{e.detail.content}</p>
                            )}
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {Object.entries(e.detail)
                                .filter(([k, v]) => k !== 'content' && v != null && v !== '' && typeof v !== 'object')
                                .map(([k, v]) => (
                                  <div key={k} className="flex items-center gap-1.5 min-w-0">
                                    <dt className="text-[11px] text-gray-400 shrink-0">{DETAIL_LABEL[k] || k}</dt>
                                    <dd className="text-xs text-gray-600 truncate">{String(v)}</dd>
                                  </div>
                                ))}
                            </dl>
                            {e.ref?.type === 'campaign' && onOpenCampaign && (
                              <button
                                type="button"
                                onClick={(ev) => { ev.stopPropagation(); onOpenCampaign(e.ref!.id); }}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                              >
                                발송 결과 보기<ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {(truncatedKinds.length > 0 || erroredKinds.length > 0) && (
              <div className="px-6 py-3 bg-blue-50/60 border-b text-xs text-blue-900 flex gap-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={1.9} />
                <div>
                  {truncatedKinds.length > 0 && <p>기록이 많아 일부만 보입니다. 아래에서 이어서 볼 수 있습니다.</p>}
                  {erroredKinds.length > 0 && (
                    <p>{erroredKinds.map((k) => KIND_STYLE[k as TimelineKind]?.label || k).join(' · ')} 기록은 지금 불러오지 못했습니다.</p>
                  )}
                </div>
              </div>
            )}

            {data?.nextBefore && (
              <div className="px-6 py-3">
                <button
                  type="button"
                  onClick={() => load(data.nextBefore)}
                  disabled={loadingMore}
                  className="w-full py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  {loadingMore ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />불러오는 중</> : '더 보기'}
                </button>
              </div>
            )}

            <p className="px-6 pb-3 text-[10px] text-gray-400 italic">
              Data source: 발송 큐 · 고객 DB · 자사몰 이벤트
            </p>
          </>
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
