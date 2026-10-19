/**
 * TodayRecommendCard.tsx — 대시보드 「오늘의 추천」 칸 (★ 2026-10-19 · docs/2026-10-19-dashboard-four-cards-design.md §2-4)
 *
 * Harold 1019 「요금제 · 발송 현황 · DB 현황 말고 하나 더」 → AI 한줄로 기준 빈 고리 = 「그래서 오늘 뭘 보내지」.
 *   - 읽기 = 기존 self-diagnosis 1회(SQL만 · AI 0 · 차감 0) · 브리핑 우선 · 없으면 규칙 추천 = AI 한줄로 추천 띠와 같은 판정(lib/hub-recommend)
 *   - 누름 = hubRecAction 하나: 기본 = AI 한줄로 입력창에 그 한 줄 · 여정 굳히기 = 여정 화면 · 이메일 · 모바일 DM 추천 = 그 화면
 *   - 모두 보기 = AI 한줄로 화면과 같은 추천 창(HubRecommendModal)
 *   - 잠김 갈래 = 구독 잠김(대시보드가 앎 · 읽지 않음 → 잠김 창) / 요금제 잠김(서버 403 = AI 한줄로 버튼과 같은 isAiOperatorAllowed → AI 한줄로 소개 창)
 *   - 다시 읽기 = 다시 시도 · revalidateKey(요금제 코드 · 구독 상태 · 진단 완료)가 바뀔 때(체험 지급 뒤 잠김이 풀린다 · Codex D1 · D2)
 * 모양(TodayRecommendView)과 읽기(기본 내보내기)를 나눴다 — 모양은 상태만 받아 그린다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Lock, RotateCw, Sparkles } from 'lucide-react';
import HubRecommendModal from '../ai-line/HubRecommendModal';
import {
  buildHubRecs, hubRecAction, hubRecLabel, loadSelfDiagnosis, stashAiLineObjective, stashJourneyObjective,
  type AutoMarketingSummary, type CompanyHealthDiagnosis, type DiagnosisBrief, type HubRec,
} from '../../lib/hub-recommend';
import { DASH_CARD, DashCardHead, DashHeadLink, DashSource } from './dash-card';

export type RecLockReason = 'plan' | 'subscription';
export type RecViewState = 'loading' | 'ready' | 'error' | 'locked';

/** 추천 하나의 대상 수 · 채널 표시(있을 때만 · 담당자 화면은 서버가 숫자를 비운다) */
function recMeta(r: HubRec): string[] {
  const out: string[] = [];
  const count = r.rec.targetCount;
  if (count != null && count > 0) out.push(`${count.toLocaleString()}명`);
  if (r.kind === 'brief') {
    if (r.rec.opportunityType === 'journey_promotion') out.push('성과 검증');
    if (r.rec.recommendedChannel === 'email') out.push('이메일 추천');
    if (r.rec.recommendedChannel === 'dm') out.push('모바일 DM 추천');
  }
  return out;
}

/** 1순위 버튼 글자 — 한 줄 넘기기는 「이 한 줄로 시작」 · 그 밖은 AI 한줄로 띠와 같은 글자 */
function startLabel(r: HubRec): string {
  return hubRecAction(r).kind === 'line' ? '이 한 줄로 시작' : hubRecLabel(r);
}

export function TodayRecommendView({
  state, lockReason, recs, useBrief, enterClass, onRun, onOpenAll, onLocked, onRetry, onStartLine,
}: {
  state: RecViewState;
  lockReason: RecLockReason;
  recs: HubRec[];
  useBrief: boolean;
  enterClass: string;
  onRun: (r: HubRec) => void;
  onOpenAll: () => void;
  onLocked: (reason: RecLockReason) => void;
  onRetry: () => void;
  onStartLine: () => void;
}) {
  const first = recs[0];
  const firstMeta = first ? recMeta(first) : [];
  return (
    <div className={`${DASH_CARD} ${enterClass}`} style={{ animationDelay: '240ms' }} data-card="rec">
      <DashCardHead
        bar="bg-violet-600"
        title="오늘의 추천"
        right={state === 'ready' && recs.length > 0 ? <DashHeadLink label="모두 보기" onClick={onOpenAll} /> : undefined}
      />

      {state === 'loading' && (
        <div className="flex-1 flex flex-col gap-2" aria-busy="true" aria-label="추천을 불러오는 중">
          <div className="h-[104px] rounded-xl bg-violet-50/60 motion-safe:animate-pulse" />
          <div className="h-9 rounded-lg bg-gray-50 motion-safe:animate-pulse" />
          <div className="h-9 rounded-lg bg-gray-50 motion-safe:animate-pulse" />
        </div>
      )}

      {state === 'locked' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-violet-200 bg-violet-50/40 px-3 py-5">
          <span className="w-9 h-9 rounded-xl bg-white ring-1 ring-violet-100 flex items-center justify-center mb-2"><Lock className="w-4 h-4 text-violet-500" /></span>
          <div className="text-[13px] font-semibold text-gray-800 break-keep">
            {lockReason === 'subscription' ? '이용이 멈춰 추천을 볼 수 없어요' : 'AI 한줄로 요금제에서 열려요'}
          </div>
          <p className="mt-1 text-[11px] text-gray-500 leading-relaxed break-keep">매일 오전 우리 고객 데이터를 보고 오늘 보낼 한 줄을 골라 드려요.</p>
          <button type="button" onClick={() => onLocked(lockReason)} className="mt-3 inline-flex h-8 items-center gap-0.5 rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 transition-colors">
            {lockReason === 'subscription' ? '자세히 보기' : '어떤 기능인지 보기'} <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-5">
          <div className="text-[13px] font-semibold text-gray-700 break-keep">추천을 불러오지 못했어요</div>
          <p className="mt-1 text-[11px] text-gray-500 break-keep">잠시 뒤 다시 시도해 주세요.</p>
          <button type="button" onClick={onRetry} className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
            <RotateCw className="w-3.5 h-3.5" /> 다시 시도
          </button>
        </div>
      )}

      {state === 'ready' && !first && (
        <div className="flex-1 flex flex-col items-center justify-center text-center rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-5">
          <span className="w-9 h-9 rounded-xl bg-white ring-1 ring-violet-100 flex items-center justify-center mb-2"><Sparkles className="w-4 h-4 text-violet-500" /></span>
          <div className="text-[13px] font-semibold text-gray-800 break-keep">오늘은 새 추천이 없어요</div>
          <p className="mt-1 text-[11px] text-gray-500 break-keep">보내고 싶은 내용을 한 줄로 적어 바로 시작하세요.</p>
          <button type="button" onClick={onStartLine} className="mt-3 inline-flex h-8 items-center gap-0.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 transition-colors">
            AI 한줄로 시작 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {state === 'ready' && first && (
        <>
          <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50/40 p-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold">1순위</span>
              {firstMeta.map((m) => <span key={m} className="text-[11px] font-semibold text-violet-700 tabular-nums whitespace-nowrap">{m}</span>)}
            </div>
            <div className="mt-1 text-[13px] font-bold text-gray-900 leading-snug break-keep line-clamp-3" title={first.rec.title}>{first.rec.title}</div>
            <button type="button" onClick={() => onRun(first)} className="mt-2.5 w-full inline-flex h-8 items-center justify-center gap-0.5 rounded-lg bg-violet-600 text-xs font-semibold text-white shadow-sm shadow-violet-600/20 hover:bg-violet-700 transition-colors">
              {startLabel(first)} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-1 -mx-1.5">
            {recs.slice(1, 3).map((r, i) => {
              const meta = recMeta(r);
              return (
                <button key={r.kind === 'rule' ? r.rec.id : `brief-${i + 1}`} type="button" onClick={() => onRun(r)} className="w-full flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-gray-50 transition-colors min-w-0">
                  <span className="mt-px w-[18px] h-[18px] rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 flex items-center justify-center shrink-0 tabular-nums">{i + 2}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[13px] font-semibold text-gray-800 leading-snug break-keep line-clamp-2" title={r.rec.title}>{r.rec.title}</span>
                    {meta.length > 0 && <span className="block mt-0.5 text-[11px] text-gray-400 tabular-nums break-keep">{meta.join(' · ')}</span>}
                  </span>
                  <ChevronRight className="mt-0.5 w-3.5 h-3.5 text-gray-300 shrink-0" />
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-auto">
        <DashSource>{useBrief ? '매일 오전 일일 분석(우리 고객 데이터)' : '회사 실측 신호(일일 분석이 쌓이기 전 기본 추천)'}</DashSource>
      </div>
    </div>
  );
}

export default function TodayRecommendCard({ ready, subscriptionLocked, revalidateKey, enterClass, onLocked, onStartLine }: {
  /** 요금제 정보를 받았는가(받기 전 = 자리 표시 · 읽지 않음) */
  ready: boolean;
  /** 구독 만료 · 정지 = 읽지 않고 잠김 */
  subscriptionLocked: boolean;
  /** 접근을 바꿀 수 있는 값이 바뀌면 달라지는 열쇠 → 다시 읽기 */
  revalidateKey: string;
  enterClass: string;
  onLocked: (reason: RecLockReason) => void;
  onStartLine: () => void;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'locked'>('loading');
  const [data, setData] = useState<{ diagnosis: CompanyHealthDiagnosis; brief: DiagnosisBrief | null; autoMarketing: AutoMarketingSummary } | null>(null);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

  // 읽기 = 요금제 정보를 받은 뒤 · 구독 잠김이 아닐 때 · 다시 시도와 열쇠가 바뀔 때 · 늦게 온 옛 응답은 버린다
  useEffect(() => {
    if (!ready || subscriptionLocked) return;
    let alive = true;
    setState('loading');
    void loadSelfDiagnosis().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setData({ diagnosis: res.diagnosis, brief: res.brief, autoMarketing: res.autoMarketing ?? { active: 0, pendingProposals: 0 } });
        setState('ready');
      } else {
        setState(res.locked ? 'locked' : 'error');
      }
    });
    return () => { alive = false; };
  }, [ready, subscriptionLocked, revalidateKey, reload]);

  const run = (r: HubRec) => {
    setOpen(false);
    const a = hubRecAction(r);
    if (a.kind === 'line') { stashAiLineObjective(a.objective); navigate('/ai-line'); return; }
    if (a.kind === 'journey') { stashJourneyObjective(a.objective); navigate('/ai-journeys'); return; }
    navigate(a.path);
  };
  const closeModal = useCallback(() => setOpen(false), []);

  const shown: RecViewState = subscriptionLocked ? 'locked' : !ready ? 'loading' : state;
  const built = data ? buildHubRecs(data.diagnosis, data.brief) : { recs: [] as HubRec[], useBrief: false };
  return (
    <>
      {/* 구독 잠김 = 읽지 않음 · 그 밖의 잠김 = 서버 403(요금제) */}
      <TodayRecommendView
        state={shown}
        lockReason={subscriptionLocked ? 'subscription' : 'plan'}
        recs={built.recs}
        useBrief={built.useBrief}
        enterClass={enterClass}
        onRun={run}
        onOpenAll={() => setOpen(true)}
        onLocked={onLocked}
        onRetry={() => setReload((n) => n + 1)}
        onStartLine={onStartLine}
      />
      {open && data && (
        <HubRecommendModal
          diagnosis={data.diagnosis}
          brief={data.brief}
          recs={built.recs}
          useBrief={built.useBrief}
          autoMarketing={data.autoMarketing}
          onClose={closeModal}
          onRun={run}
        />
      )}
    </>
  );
}
