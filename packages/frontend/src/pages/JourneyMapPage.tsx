/**
 * JourneyMapPage — 여정 지도 (★ 2026-09-29 여정 V2 1차 · 2026-09-30 2차 · 설계서 docs/2026-09-29-journey-v2-master-design.md §3 · §5)
 *
 * 고객이 가입부터 첫 구매 · 재구매 · 이탈까지 어느 여정을 지나는지 한 화면에서 본다.
 *   - 표면 = 오퍼레이터 캔버스 뷰(OUI_ · 아우라 없음 · 전면 폭). 옛 여정 목록은 그대로 두고 [지도 | 목록] 전환만 더했다.
 *   - 데이터 = GET /api/ai/operator/journeys/lifecycle-map 하나(의미는 서버 · 화면은 그리기만).
 *   - 60초마다 · 탭으로 돌아올 때 다시 읽는다(보이지 않을 때는 읽지 않는다).
 *   - 2차: [문장으로 만들기](인터뷰 → 초안 → 이어붙이기 점검) · [켜기 전 점검](모두 켜기) · 선 고치기 1클릭(행동은 서버가 정함) · 칸 창 [문안 고치기].
 *   - [만들기] = 목록 화면의 기존 1클릭 생성으로 보낸다(?preset=시작 사건).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, List, Loader2, Map as MapIcon, MessageSquarePlus, Power, RefreshCw, Search, Sparkles } from 'lucide-react';
import {
  OUI_BACK, OUI_BTN_AI, OUI_BTN_GHOST, OUI_BTN_OUTLINE, OUI_BTN_PRIMARY, OUI_HEADER, OUI_HEADER_ROW, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER,
  OUI_SRC, OUI_SUBTITLE, OUI_TITLE, OUI_WRAP_FULL,
} from '../utils/operator-ui';
import { goBackOr } from '../lib/scroll-restoration';
import LifecycleMapCanvas, { type MapStatusFilter } from '../components/journey/map/LifecycleMapCanvas';
import GapFinderModal, { type GapOpportunity } from '../components/journey/map/GapFinderModal';
import MapStepDrawer from '../components/journey/map/MapStepDrawer';
import InterviewModal from '../components/journey/map/InterviewModal';
import BatchActivateModal from '../components/journey/map/BatchActivateModal';
import ProductJourneyModal from '../components/journey/map/ProductJourneyModal';
import JourneyMessageEditModal from '../components/journey/JourneyMessageEditModal';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import { LINE_STYLE, type AttachFix, type CreateMode, type LifecycleMapData, type MapJourney, type MapStep } from '../utils/journey-map';

const REFRESH_MS = 60_000;

const FILTERS: Array<{ key: MapStatusFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '켜짐' },
  { key: 'paused', label: '멈춤' },
  { key: 'draft', label: '초안' },
];

function timeText(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

async function patchOptions(journeyId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/ai/operator/journeys/${journeyId}/options`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.success) throw new Error(d?.error || '바꾸지 못했어요.');
}

export default function JourneyMapPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<LifecycleMapData | null>(null);
  const [opportunities, setOpportunities] = useState<GapOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [gapOpen, setGapOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [batch, setBatch] = useState<{ open: boolean; preselect: string[] }>({ open: false, preselect: [] });
  const [drawer, setDrawer] = useState<{ journey: MapJourney; step: MapStep } | null>(null);
  const [editTarget, setEditTarget] = useState<{ journey: MapJourney; returnToBatch: string[] | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const confirmResolve = useRef<(() => void) | null>(null);
  const focusId = searchParams.get('focus');

  const load = useCallback(async (quiet: boolean) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const [mr, or] = await Promise.all([
        fetch('/api/ai/operator/journeys/lifecycle-map', { headers }),
        fetch('/api/ai/operator/journeys-opportunities', { headers }).catch(() => null),
      ]);
      const md = await mr.json().catch(() => ({}));
      if (md?.success && md.map) {
        setData(md.map as LifecycleMapData);
        setError(null);
      } else if (md?.code === 'AI_OPERATOR_GATED') {
        setError('AI Operator 진입 권한이 없습니다. 관리자에게 문의해 주세요.');
      } else if (!quiet) {
        setError(md?.error || '여정 지도를 불러오지 못했어요.');
      }
      const od = or ? await or.json().catch(() => null) : null;
      if (od?.success && Array.isArray(od.opportunities)) setOpportunities(od.opportunities);
    } catch {
      if (!quiet) setError('네트워크 오류로 여정 지도를 불러오지 못했어요.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  // 60초마다 · 탭으로 돌아오면 다시 읽는다(보이지 않을 때는 읽지 않는다).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(true); };
    const t = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const focusJourney = useCallback((id: string) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('focus', id); return n; }, { replace: true });
  }, [setSearchParams]);

  const create = useCallback((triggerEvent: string, objective?: string, mode?: CreateMode) => {
    // ★ 2026-09-30 V2 3차 — 상품을 골라야 하는 여정(상품 재구매)은 상품 고르기 창으로(1클릭 프리셋으로 만들 수 없다).
    if (mode === 'product') { setProductOpen(true); return; }
    const qs = new URLSearchParams({ preset: triggerEvent });
    if (objective) qs.set('objective', objective);
    navigate(`/ai-journeys?${qs.toString()}`);
  }, [navigate]);

  const openJourney = useCallback((id: string) => navigate(`/ai-journeys/${id}`), [navigate]);

  /** 확인 창 하나로 묻고, 확인하면 run · 닫으면 아무것도 안 한다. 끝나면 풀린다(이어붙이기 점검이 다시 읽는 시점). */
  const ask = (state: Omit<ConfirmState, 'onConfirm'>, run: () => Promise<void>): Promise<void> => new Promise((resolve) => {
    confirmResolve.current = resolve;
    setConfirm({
      ...state,
      onConfirm: async () => {
        try {
          await run();
        } catch (e: any) {
          toast.error(e?.message || '처리하지 못했어요.');
        } finally {
          await load(true);
          resolve();
          confirmResolve.current = null;
        }
      },
    });
  });

  /** 선 · 점검 줄의 1클릭 고치기 — 행동은 서버가 정한다(AttachFix). 켜진 여정은 자동 종료 켜기만 바로 한다. */
  const handleFix = useCallback(async (fix: AttachFix): Promise<void> => {
    const j = fix.journeyId ? data?.journeys.find((x) => x.id === fix.journeyId) : undefined;
    switch (fix.action) {
      case 'create':
        if (fix.triggerEvent) create(fix.triggerEvent, undefined, fix.createMode);
        return;
      case 'activate':
        if (fix.journeyId) setBatch({ open: true, preselect: [fix.journeyId] });
        return;
      case 'goal_exit_on':
        return ask({
          mode: 'info',
          title: '목표를 이루면 멈춤 켜기',
          description: j?.status === 'active'
            ? `지금 진행 중인 ${Number(fix.activeCount || 0).toLocaleString('ko-KR')}명에게도 바로 적용돼요. 이미 목표를 이룬 고객은 다음 문자 전에 여정을 마치고, 다음 여정이 이어받을 수 있어요.`
            : '목표를 이룬 고객은 남은 문자를 받지 않고 여정을 마쳐요. 다음 여정이 이어받을 수 있어요.',
          confirmLabel: '켜기',
        }, async () => {
          await patchOptions(fix.journeyId!, { goalExitEnabled: true });
          toast.success('목표를 이루면 멈추도록 켰어요.');
        });
      case 'allow_reentry_on':
        return ask({
          mode: 'info',
          title: '다음 구매 때 다시 받기 켜기',
          description: '같은 고객이 다시 사면 이 여정을 또 받아요. 설정을 바꾸면 켜기 전 점검을 다시 받아야 해요.',
          confirmLabel: '켜기',
        }, async () => {
          await patchOptions(fix.journeyId!, { allowReentry: true });
          toast.success('다음 구매 때 다시 받도록 켰어요.');
        });
      case 'pause_and_allow_reentry':
        return ask({
          mode: 'warning',
          title: '일시정지하고 다시 받기 켜기',
          description: `${j?.name || '받는 여정'}을 일시정지한 뒤 다음 구매 때 다시 받기를 켭니다. 일시정지 동안 새 고객은 들어오지 않아요. 다시 켜기는 켜기 전 점검에서 합니다.`,
          confirmLabel: '일시정지하고 켜기',
        }, async () => {
          const res = await fetch(`/api/ai/operator/journeys/${fix.journeyId}/pause`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ reason: '여정 지도: 다시 받기 켜기' }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d?.success) throw new Error(d?.error || '일시정지하지 못했어요.');
          await patchOptions(fix.journeyId!, { allowReentry: true });
          toast.success('일시정지하고 다시 받기를 켰어요. 켜기 전 점검에서 다시 켜 주세요.');
        });
      default:
        return;
    }
  }, [data, create]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ★ 2026-09-30 V2 5차 — 새 판으로 고치기: 복제 초안을 만든다(옛 판은 그대로 돈다). 새 판을 켜는 순간 옛 판은 새 고객을 받지 않고
   * 진행 중 고객만 마무리한다. 이미 만든 새 판 초안이 있으면 그것으로 간다.
   */
  const newVersion = (j: MapJourney) => ask({
    mode: 'info',
    title: '새 판으로 고치기',
    description: `${j.name}을(를) 그대로 복사한 초안을 만들어요. 지금 여정은 계속 돌고, 새 판을 켜는 순간부터 새 고객은 새 판이 받습니다(옛 판은 진행 중인 고객만 마무리).`,
    confirmLabel: '새 판 만들기',
  }, async () => {
    const res = await fetch(`/api/ai/operator/journeys/${j.id}/new-version`, { method: 'POST', headers: jsonHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d?.success) throw new Error(d?.error || '새 판을 만들지 못했어요.');
    toast.success(d.existing
      ? '이미 만든 새 판 초안이 있어 그리로 갑니다.'
      : `새 판 초안을 만들었어요.${Number(d.variantsNotCopied) > 0 ? ` A/B 변형 ${d.variantsNotCopied}개는 옮기지 않았어요(판마다 반응을 따로 봅니다).` : ''}`);
    focusJourney(String(d.journeyId));
  });

  const counts = useMemo(() => {
    const js = data?.journeys || [];
    return {
      all: js.length,
      active: js.filter((j) => j.status === 'active').length,
      paused: js.filter((j) => j.status === 'paused').length,
      draft: js.filter((j) => j.status === 'draft').length,
    };
  }, [data]);

  const gapCount = useMemo(() => {
    if (!data) return 0;
    return data.ghosts.filter((g) => g.available).length
      + data.lines.filter((l) => l.tier === 'warn').length
      + data.overlaps.length
      + data.journeys.filter((j) => j.broadAudience && j.status !== 'ended').length;
  }, [data]);

  if (loading && !data) {
    return (
      <div className={OUI_PAGE_CENTER}>
        <div className="flex flex-col items-center gap-3 text-white/60">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
          <span className="text-xs">여정 지도를 그리는 중</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={OUI_PAGE_CENTER}>
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="text-sm text-rose-300">{error || '여정 지도를 불러오지 못했어요.'}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load(false)} className={OUI_BTN_PRIMARY}>다시 불러오기</button>
            <button type="button" onClick={() => navigate('/ai-journeys')} className={OUI_BTN_GHOST}>여정 목록으로</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${OUI_PAGE} md:h-screen md:flex md:flex-col`}>
      <div className={OUI_HEADER}>
        <div className={`${OUI_WRAP_FULL} ${OUI_HEADER_ROW}`}>
          <button onClick={() => goBackOr(navigate, '/ai-journeys')} className={OUI_BACK} aria-label="여정 목록으로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-fuchsia-400 to-purple-500`}>
            <MapIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={`${OUI_TITLE} truncate`}>여정 지도</h1>
            <p className={OUI_SUBTITLE}>가입부터 첫 구매 · 재구매 · 이탈까지 여정이 어떻게 이어지는지 한 화면에서 봅니다</p>
          </div>
          <button type="button" onClick={() => setGapOpen(true)} className={OUI_BTN_OUTLINE} aria-label="빈 곳 찾기">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">빈 곳 찾기</span>
            {gapCount > 0 && <span className="rounded-full bg-violet-500/30 px-1.5 text-[11px] tabular-nums">{gapCount}</span>}
          </button>
          <button type="button" onClick={() => setInterviewOpen(true)} className={OUI_BTN_AI} aria-label="문장으로 만들기">
            <MessageSquarePlus className="w-4 h-4" />
            <span className="hidden sm:inline">문장으로 만들기</span>
          </button>
        </div>
      </div>

      {/* 도구 줄: 지도/목록 · 상태 · 찾기 · 범례 · 갱신 */}
      <div className="border-b border-white/10 bg-slate-950">
        <div className={`${OUI_WRAP_FULL} py-2.5 flex flex-wrap items-center gap-2`}>
          <div className="flex items-center rounded-lg border border-white/10 p-0.5" role="group" aria-label="보기 방식">
            <span className="h-7 px-2.5 rounded-md text-xs font-semibold bg-white/10 text-white inline-flex items-center gap-1"><MapIcon className="w-3.5 h-3.5" />지도</span>
            <button type="button" onClick={() => navigate('/ai-journeys')} className="h-7 px-2.5 rounded-md text-xs text-white/55 hover:text-white inline-flex items-center gap-1 transition-colors">
              <List className="w-3.5 h-3.5" />목록
            </button>
          </div>
          <div className="flex items-center gap-1" role="tablist" aria-label="여정 상태">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={statusFilter === f.key}
                onClick={() => setStatusFilter(f.key)}
                className={statusFilter === f.key
                  ? 'h-8 px-3 rounded-lg text-xs font-semibold bg-violet-600/80 text-white'
                  : 'h-8 px-3 rounded-lg text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white transition-colors'}
              >
                {f.label} <span className="tabular-nums text-white/60">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <label className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="여정 이름 · 시작 사건 찾기"
              aria-label="여정 찾기"
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-slate-900 border border-white/10 text-xs placeholder-white/30 focus:outline-none focus:border-violet-400"
            />
          </label>
          <div className="hidden xl:flex items-center gap-3 ml-auto text-[11px] text-white/50">
            {(['solid', 'warn', 'empty'] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke={LINE_STYLE[t].stroke} strokeWidth="2" strokeDasharray={LINE_STYLE[t].dash} /></svg>
                {LINE_STYLE[t].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-400/50" aria-hidden />같이 받음</span>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="h-8 px-2 rounded-lg text-[11px] text-white/50 hover:bg-white/10 hover:text-white inline-flex items-center gap-1 transition-colors disabled:opacity-50 xl:ml-0 ml-auto"
            aria-label="다시 읽기"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="tabular-nums">{timeText(data.generatedAt)}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className={`${OUI_WRAP_FULL} pt-3`}>
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{error}</div>
        </div>
      )}

      {/* 캔버스: 데스크톱은 이 칸 안에서만 스크롤(레인 머리 고정) · 모바일은 페이지 스크롤 */}
      <div className="md:flex-1 md:min-h-0 md:overflow-auto">
        <LifecycleMapCanvas
          data={data}
          statusFilter={statusFilter}
          search={search}
          focusId={focusId}
          onFocusJourney={focusJourney}
          onOpenStep={(journey, step) => setDrawer({ journey, step })}
          onOpenJourney={openJourney}
          onCreate={(t, mode) => create(t, undefined, mode)}
          onFix={(f) => void handleFix(f)}
          onNewVersion={(j) => void newVersion(j)}
        />
        <div className={`${OUI_WRAP_FULL} pb-6 ${OUI_SRC}`}>
          출처: 여정 · 여정 진행 기록(최근 30일) · {timeText(data.generatedAt)} 기준
          {data.judgedAt ? ` · 구매 확인 예정은 ${timeText(data.judgedAt)} 판정` : ''}
        </div>
      </div>

      {/* 초안이 있으면 켜기 전 점검 입구(자동으로 켜지 않는다) */}
      {counts.draft > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-white/10 bg-slate-950/95 backdrop-blur-md">
          <div className={`${OUI_WRAP_FULL} py-2.5 flex items-center gap-3`}>
            <span className="flex-1 text-xs text-white/65">초안 {counts.draft}개가 켜지기를 기다려요.</span>
            <button type="button" onClick={() => setBatch({ open: true, preselect: [] })} className={OUI_BTN_PRIMARY}>
              <Power className="w-4 h-4" />
              켜기 전 점검
            </button>
          </div>
        </div>
      )}

      <GapFinderModal
        open={gapOpen}
        onClose={() => setGapOpen(false)}
        data={data}
        opportunities={opportunities}
        onCreate={(t, o, mode) => { setGapOpen(false); create(t, o, mode); }}
        onFocusJourney={focusJourney}
        onFix={(f) => void handleFix(f)}
      />
      <InterviewModal
        open={interviewOpen}
        onClose={() => setInterviewOpen(false)}
        onFix={handleFix}
        onFocusJourney={focusJourney}
        onActivateMany={(ids) => { void load(true).then(() => setBatch({ open: true, preselect: ids })); }}
        onCreated={() => void load(true)}
      />
      <ProductJourneyModal
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onCreated={(id) => { void load(true).then(() => focusJourney(id)); }}
      />
      <BatchActivateModal
        open={batch.open}
        onClose={() => setBatch({ open: false, preselect: [] })}
        data={data}
        preselect={batch.preselect}
        onEditMessages={(j) => {
          const keep = batch.preselect.length > 0 ? batch.preselect : [];
          setBatch({ open: false, preselect: [] });
          setEditTarget({ journey: j, returnToBatch: keep.length > 0 ? keep : [j.id] });
        }}
        onDone={() => void load(true)}
      />
      <MapStepDrawer
        journey={drawer?.journey || null}
        step={drawer?.step || null}
        onClose={() => setDrawer(null)}
        onOpenJourney={openJourney}
        onEditMessages={(j) => { setDrawer(null); setEditTarget({ journey: j, returnToBatch: null }); }}
      />
      {editTarget && (
        <JourneyMessageEditModal
          journeyId={editTarget.journey.id}
          journeyName={editTarget.journey.name}
          journeyStatus={editTarget.journey.status}
          token={localStorage.getItem('token') || ''}
          onClose={() => {
            const back = editTarget.returnToBatch;
            setEditTarget(null);
            if (back) setBatch({ open: true, preselect: back });
          }}
          onSaved={() => void load(true)}
        />
      )}
      <ConfirmModal
        state={confirm}
        onClose={() => {
          setConfirm(null);
          if (confirmResolve.current) { confirmResolve.current(); confirmResolve.current = null; }
        }}
      />
    </div>
  );
}
