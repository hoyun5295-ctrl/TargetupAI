/**
 * AgencySendPage — 대행발송 (★ 2026-08-22 신설 · ★ 2026-08-25 목록 개편, Harold 시안 승인)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md. 진입 = 헤더 "대행발송"(모든 회사에 보인다).
 *   못 쓰는 회사는 안내 모달(§4-8), 쓸 수 있는 회사는 접수 목록을 본다.
 *
 * 2026-08-25 개편(§15): 표를 진행판으로.
 *   1. 접수마다 6단계 진행 레일(접수 → 문안 검사 → 담당자 문자 → 승인 → 예약 → 발송)을 그린다
 *   2. 승인 기다리는 건은 문안 미리보기와 함께 최상단 "지금 할 일" 카드로 올라온다
 *   3. 끝난 건(취소·미발송)은 "같은 내용으로 다시 접수"로 명단·문안·담당자까지 그대로 되살린다
 *      (명단은 읽기 전용 API로 받아 오고, 새 접수는 기존 접수 API를 그대로 탄다 — 서버 쓰기 경로 신설 0)
 *
 * ⛔ 자격 판정은 서버 my-plan의 `agency_send_allowed` 하나만 믿는다(프론트가 요금제를 조합하지 않는다).
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔(`CUI_*`).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, Loader2, MessageSquare, Plus, RefreshCw, Send, X } from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import AgencySendIntroModal from '../components/agency/AgencySendIntroModal';
import AgencySendComposer, { type AgencyComposerPrefill } from '../components/agency/AgencySendComposer';
import AgencyOneStepModal from '../components/agency/AgencyOneStepModal';
import AgencySendDetail from '../components/agency/AgencySendDetail';
import {
  fetchAgencyRecipients, fetchAgencyRequests, formatWhenRelative, isApprovable, isRedoable,
  RAIL_STEPS, railFor, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE,
  type AgencySendRequest,
} from '../components/agency/agency-send-api';
import {
  CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_CELL_META, CUI_EMPTY, CUI_EMPTY_BADGE,
  CUI_EMPTY_DESC, CUI_EMPTY_TITLE, CUI_PANEL, CUI_PILL_BASE, CUI_PILL_TONE, CUI_WRAP,
} from '../utils/console-ui';

interface PlanSnapshot {
  planCode: string;
  allowed: boolean;
}

/**
 * 접수 입구 버튼 (★2026-08-25(6) · Harold 시안 A 승인 — "둘 다 각각의 개성으로")
 *
 * 두 갈래(요청서로 접수 · 직접 입력)가 **같은 뼈대**(아이콘 칸 + 제목 + 한 줄)를 쓰고 표면만 갈린다.
 * 종전에는 요청서 쪽이 회색 테두리라 "덜 중요한 것"으로 읽혔다 — 이 화면이 파는 길이 그쪽인데도.
 * ⛔ 색은 인디고 계열만 쓴다(바이올렛은 AI 화면 색 · LESSONS_FRONTEND 핵심 원칙).
 */
function EntryButton({ tone, icon, title, sub, onClick }: {
  tone: 'form' | 'new';
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  const solid = tone === 'new';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 pl-2 pr-2.5 sm:pl-2.5 sm:pr-3.5 rounded-xl border-[1.5px] inline-flex items-center gap-2 sm:gap-2.5 transition ` +
        `active:scale-[.98] motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/20 ${
        solid
          ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-700 ' +
            'shadow-[0_6px_16px_-8px_rgba(79,70,229,0.75)] hover:shadow-[0_8px_20px_-8px_rgba(79,70,229,0.9)]'
          : 'border-indigo-600/25 bg-white text-neutral-900 hover:border-indigo-600/50 hover:bg-indigo-50/40 ' +
            'shadow-[0_1px_2px_rgba(23,23,23,0.05)] hover:shadow-[0_4px_12px_-6px_rgba(79,70,229,0.35)]'
      }`}
    >
      <span className={`h-7 w-7 rounded-[9px] grid place-items-center shrink-0 ${
        solid ? 'bg-white/[0.16] text-white' : 'bg-indigo-50 text-indigo-600'}`}>
        {icon}
      </span>
      <span className="flex flex-col items-start leading-[1.15]">
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">{title}</span>
        {/* 좁은 화면에서는 설명 줄을 접고 아이콘과 제목만 남긴다 */}
        <span className={`hidden sm:block text-[11px] font-semibold mt-px ${solid ? 'text-white/80' : 'text-indigo-700'}`}>{sub}</span>
      </span>
    </button>
  );
}

/** 6단계 진행 레일. 표시 판정은 railFor(CT) 하나가 소유하고 여기는 그리기만 한다 */
function ProgressRail({ r }: { r: AgencySendRequest }) {
  const rail = railFor(r);
  // 흐름이 닿은 마지막 단계. 연결선은 이 값 하나로 단조롭게 칠한다(마디별 조건 분기를 두지 않는다)
  const reach = rail.fail ? rail.fail.at : (rail.now ?? Math.max(0, rail.doneBefore - 1));
  const lineOn = rail.muted ? 'bg-neutral-300' : 'bg-indigo-600';
  return (
    <div className="flex items-start flex-1 min-w-[340px]" aria-label="진행 단계">
      {RAIL_STEPS.map((label, i) => {
        const fail = rail.fail?.at === i;
        const now = !fail && rail.now === i;
        const done = !fail && !now && i < rail.doneBefore;
        return (
          <div key={label} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <span className={`absolute left-0 right-1/2 top-[9px] h-0.5 ${reach >= i ? lineOn : 'bg-neutral-200'}`} aria-hidden="true" />
            )}
            {i < RAIL_STEPS.length - 1 && (
              <span className={`absolute left-1/2 right-0 top-[9px] h-0.5 ${reach >= i + 1 ? lineOn : 'bg-neutral-200'}`} aria-hidden="true" />
            )}
            <span className={`relative z-10 h-5 w-5 rounded-full grid place-items-center border-2 ${
              fail ? 'bg-rose-500 border-rose-500 text-white'
                : now ? 'bg-white border-indigo-600'
                : done ? (rail.muted ? 'bg-neutral-300 border-neutral-300 text-white' : 'bg-indigo-600 border-indigo-600 text-white')
                : 'bg-white border-neutral-200'}`}>
              {fail ? <X className="w-2.5 h-2.5" strokeWidth={3.2} />
                : now ? <span className="h-[7px] w-[7px] rounded-full bg-indigo-600 animate-pulse" />
                : done ? <Check className="w-2.5 h-2.5" strokeWidth={3.2} />
                : null}
            </span>
            <span className={`mt-1 text-[11px] whitespace-nowrap ${
              fail ? 'text-rose-700 font-bold'
                : now ? 'text-indigo-700 font-bold'
                : done ? (rail.muted ? 'text-neutral-400 font-semibold' : 'text-indigo-700 font-semibold')
                : 'text-neutral-400 font-semibold'}`}>
              {fail ? rail.fail!.label : label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AgencySendPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [introOpen, setIntroOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [oneStepOpen, setOneStepOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState<AgencyComposerPrefill | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [requests, setRequests] = useState<AgencySendRequest[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [redoLoadingId, setRedoLoadingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      setRequests(await fetchAgencyRequests());
    } catch (e: any) {
      if (e?.code !== 'AGENCY_SEND_NOT_ALLOWED') toast.error(e?.message || '목록을 불러오지 못했습니다.');
    } finally {
      setListLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/companies/my-plan', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        const data = await res.json();
        if (!alive) return;
        const snapshot: PlanSnapshot = {
          planCode: String(data?.plan_code || 'FREE'),
          allowed: !!data?.agency_send_allowed,
        };
        setPlan(snapshot);
        if (snapshot.allowed) loadList();
        else setIntroOpen(true);
      } catch {
        // 판정을 못 받으면 열지 않는다. 안내를 띄우고 사용자가 다시 시도하게 둔다
        if (alive) { setPlan({ planCode: 'FREE', allowed: false }); setIntroOpen(true); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loadList]);

  // ★2026-08-26 §18: 이메일 접수는 워커가 만든다 — 사람 클릭 없이 생기는 첫 접수라,
  //   탭에 돌아온 순간만이라도 목록을 맞춘다(visibilitychange 1회 · 주기 폴링은 보류 = 완료 회신의 링크가 진입점).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && plan?.allowed) loadList();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [plan?.allowed, loadList]);

  const upsert = (r: AgencySendRequest) => {
    setRequests((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i < 0) return [r, ...prev];
      const next = [...prev];
      next[i] = r;
      return next;
    });
  };

  /** 같은 내용으로 다시 접수 — 명단을 받아 접수 창을 프리필로 연다. 새 접수는 기존 접수 API를 그대로 탄다 */
  const redo = async (r: AgencySendRequest) => {
    if (redoLoadingId) return;
    setRedoLoadingId(r.id);
    try {
      const recipients = await fetchAgencyRecipients(r.id);
      if (recipients.length === 0) { toast.error('이전 접수의 명단을 찾지 못했습니다.'); return; }
      setComposerPrefill({
        content: r.currentContent,
        subject: r.subject,
        isAd: r.isAd,
        callbackNumber: r.callbackNumber,
        managerPhones: r.managerPhones?.length ? r.managerPhones : [r.managerPhone].filter(Boolean),
        varMapping: r.varMapping || {},
        fileName: r.fileName,
        messageType: r.messageType,
        recipients,
        hadImages: (r.mmsImagePaths || []).length > 0,
      });
      setComposerOpen(true);
    } catch (e: any) {
      toast.error(e?.message || '이전 접수를 불러오지 못했습니다.');
    } finally {
      setRedoLoadingId(null);
    }
  };

  const waitingList = requests.filter((r) => isApprovable(r.status));
  const todo = waitingList[0] || null;
  const todoWhen = todo ? formatWhenRelative(todo.requestedAt) : null;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className={`${CUI_WRAP} py-3.5 flex items-center gap-3`}>
          <button
            type="button"
            onClick={() => goBackOr(navigate, '/dashboard')}
            className="h-8 w-8 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            aria-label="뒤로"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
            <Send className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">대행발송</h1>
            <p className="text-[12.5px] text-neutral-500">양식만 채우면, 나머지는 한줄로가 합니다</p>
          </div>
          {plan?.allowed && (
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={loadList} className={CUI_BTN_GHOST} aria-label="새로고침">
                <RefreshCw className={`w-[15px] h-[15px] ${listLoading ? 'animate-spin' : ''}`} />
              </button>
              <EntryButton
                tone="form"
                icon={<FileSpreadsheet className="w-[15px] h-[15px]" strokeWidth={2} />}
                title="요청서로 접수"
                sub="파일 2개면 끝납니다"
                onClick={() => setOneStepOpen(true)}
              />
              <EntryButton
                tone="new"
                icon={<Plus className="w-[15px] h-[15px]" strokeWidth={2.2} />}
                title="새 접수"
                sub="직접 입력합니다"
                onClick={() => setComposerOpen(true)}
              />
            </div>
          )}
        </div>
      </header>

      <div className={`${CUI_WRAP} py-6`}>
        {loading ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-12 grid place-items-center text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !plan?.allowed ? (
          <div className={CUI_EMPTY}>
            <div className={CUI_EMPTY_BADGE}><Send className="w-5 h-5 text-neutral-400" strokeWidth={2} /></div>
            <p className={CUI_EMPTY_TITLE}>아직 열려 있지 않은 기능입니다</p>
            <p className={CUI_EMPTY_DESC}>명단과 문안만 맡기면 검사와 예약까지 대신 해 드립니다.</p>
            <button type="button" onClick={() => setIntroOpen(true)} className={`${CUI_BTN_PRIMARY} mt-4`}>
              무엇을 해 주는지 보기
            </button>
          </div>
        ) : (
          <>
            {/* ── 지금 할 일: 승인 기다리는 접수 ── */}
            {todo && (
              <div className="mb-5 rounded-2xl border border-indigo-600/20 bg-gradient-to-br from-indigo-50 via-white to-white p-5 shadow-[0_8px_24px_-16px_rgba(23,23,23,0.18)] flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE.amber}`}>{STATUS_LABEL[todo.status]}</span>
                    <p className="text-[15px] font-extrabold tracking-[-0.015em] text-neutral-900">확인하실 문안이 도착했습니다</p>
                  </div>
                  <p className="text-[13px] text-neutral-700">
                    담당자 번호 <b>{(todo.managerPhones?.length || 1)}곳</b>으로 테스트 문자를 보내 드렸습니다.
                    받으신 문자 그대로 나가니, 확인하고 승인해 주세요.
                    {waitingList.length > 1 && <> 그 외 <b className="tabular-nums">{waitingList.length - 1}</b>건이 더 기다리고 있습니다.</>}
                  </p>
                  <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 max-w-[560px]">
                    <MessageSquare className="w-[15px] h-[15px] text-indigo-600 shrink-0 mt-0.5" strokeWidth={2} />
                    <p className="text-[13px] text-neutral-700 truncate">{todo.currentContent.slice(0, 90)}</p>
                  </div>
                </div>
                <div className="shrink-0 flex sm:flex-col items-center sm:items-end gap-2.5">
                  <button type="button" onClick={() => setDetailId(todo.id)} className={CUI_BTN_PRIMARY}>
                    문안 확인하고 승인하기<ArrowRight className="w-[15px] h-[15px]" />
                  </button>
                  {todoWhen && (
                    <p className="text-[12.5px] text-neutral-500"><b className="text-neutral-900">{todoWhen.big}</b> 발송 예정 · 발송 2시간 전까지 승인</p>
                  )}
                </div>
              </div>
            )}

            {requests.length === 0 ? (
              <div className={CUI_EMPTY}>
                <div className={CUI_EMPTY_BADGE}><Send className="w-5 h-5 text-neutral-400" strokeWidth={2} /></div>
                <p className={CUI_EMPTY_TITLE}>아직 접수한 건이 없습니다</p>
                <p className={CUI_EMPTY_DESC}>
                  명단 파일과 문안, 보낼 시각을 넣으면 스팸 검사부터 예약까지 이어서 처리합니다.
                </p>
                <button type="button" onClick={() => setComposerOpen(true)} className={`${CUI_BTN_PRIMARY} mt-4`}>
                  <Plus className="w-[15px] h-[15px]" />첫 접수 하기
                </button>
              </div>
            ) : (
              <div className={CUI_PANEL}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-neutral-50/60">
                  <p className="text-[13px] font-bold text-neutral-900">접수 내역</p>
                  <p className="text-[12.5px] text-neutral-500 tabular-nums">{requests.length}건</p>
                </div>
                <div className="divide-y divide-neutral-100">
                  {requests.map((r) => {
                    const when = formatWhenRelative(r.requestedAt);
                    const terminal = r.status === 'cancelled' || r.status === 'expired';
                    return (
                      <div
                        key={r.id}
                        onClick={() => setDetailId(r.id)}
                        className={`flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6 px-5 py-4 cursor-pointer transition-colors hover:bg-indigo-50/40 ${terminal ? 'opacity-70' : ''}`}
                      >
                        <div className="w-full lg:w-[280px] shrink-0 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-[13.5px] font-bold tracking-[-0.01em] truncate">
                              {r.fileName || r.currentContent.slice(0, 24)}
                            </p>
                            <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[STATUS_TONE[r.status]]} shrink-0`}>{STATUS_LABEL[r.status]}</span>
                          </div>
                          <p className={`${CUI_CELL_META} mt-0.5 truncate`}>
                            {/* ★0826 §18: 출처 라벨 = SOURCE_LABEL 단일표(fileName 유무 추정 폐지 — 이메일 접수도 파일명이 있어 구분이 안 됐다) */}
                            {SOURCE_LABEL[r.source] || SOURCE_LABEL.screen} · <span className="tabular-nums">{r.recipientCount.toLocaleString()}</span>명 · {r.messageType}{r.isAd ? ' · 광고' : ''}
                          </p>
                        </div>
                        <div className="hidden md:flex flex-1 min-w-0">
                          <ProgressRail r={r} />
                        </div>
                        <div className="flex items-center justify-between lg:justify-end gap-4 lg:w-[300px] shrink-0">
                          <div className="text-left lg:text-right lg:w-[124px]">
                            <p className={`text-[13.5px] font-bold tracking-[-0.01em] ${terminal ? 'text-neutral-500' : 'text-neutral-900'}`}>{when.big}</p>
                            <p className="text-[12px] text-neutral-500">{when.sub}</p>
                          </div>
                          <div className="w-[150px] flex justify-end" onClick={(e) => e.stopPropagation()}>
                            {isApprovable(r.status) ? (
                              <button type="button" onClick={() => setDetailId(r.id)} className={`${CUI_BTN_PRIMARY} h-8 px-3 text-[13px]`}>
                                승인하기
                              </button>
                            ) : isRedoable(r.status) ? (
                              <button
                                type="button"
                                onClick={() => redo(r)}
                                disabled={redoLoadingId !== null}
                                className={`${CUI_BTN_OUTLINE} h-8 px-3 text-[13px] whitespace-nowrap`}
                              >
                                {redoLoadingId === r.id ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : null}
                                같은 내용으로 다시 접수
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="mt-3 text-[10px] text-neutral-400 italic">Data source: 대행발송 접수 원장</p>
          </>
        )}
      </div>

      <AgencySendIntroModal
        show={introOpen}
        isPaidPlan={!!plan && plan.planCode !== 'FREE'}
        onClose={() => setIntroOpen(false)}
      />
      <AgencySendComposer
        show={composerOpen}
        prefill={composerPrefill}
        onClose={() => { setComposerOpen(false); setComposerPrefill(null); }}
        onCreated={(r) => upsert(r)}
      />
      <AgencyOneStepModal
        show={oneStepOpen}
        onClose={() => setOneStepOpen(false)}
        onCreated={(list) => list.forEach(upsert)}
      />
      <AgencySendDetail
        requestId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={(r) => upsert(r)}
      />
    </div>
  );
}
