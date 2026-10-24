/**
 * JourneyMapPage — 여정 지도 (★ 2026-09-29 여정 V2 1차 · 2026-09-30 2차 · 설계서 docs/2026-09-29-journey-v2-master-design.md §3 · §5)
 *
 * 고객이 가입부터 첫 구매 · 재구매 · 이탈까지 어느 여정을 지나는지 한 화면에서 본다.
 *   - 표면 = 오퍼레이터 캔버스 뷰(OUI_ · 아우라 없음 · 전면 폭). 옛 여정 목록은 그대로 두고 [지도 | 목록] 전환만 더했다.
 *   - 데이터 = GET /api/ai/operator/journeys/lifecycle-map 하나(의미는 서버 · 화면은 그리기만).
 *   - 60초마다 · 탭으로 돌아올 때 다시 읽는다(보이지 않을 때는 읽지 않는다).
 *   - 2차: [문장으로 만들기](인터뷰 → 초안 → 이어붙이기 점검) · [켜기 전 점검](모두 켜기) · 선 고치기 1클릭(행동은 서버가 정함) · 칸 창 [문안 고치기].
 *   - [만들기] = 목록 화면의 기존 1클릭 생성으로 보낸다(?preset=시작 사건).
 *   ★ 2026-10-20 여정 V.3 §10 — 기본 [한눈에](요약 카드) · [칸까지] · 요약 한 줄(서버 summary) · 카드 · 칸 = 작업 화면(?journey=&step=) ·
 *     멈추기 · 다시 켜기 = 공용 훅 · 「새 판」 버튼 없음(고치기 = 작업 화면이 새 모양을 서버 한 흐름으로) · 판 아래 기준 줄 삭제(머리 표지 툴팁).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, List, Loader2, Map as MapIcon, MessageSquarePlus, Power, RefreshCw, Search, Sparkles } from 'lucide-react';
import { JOURNEY_TABS } from '../components/zone/zone-tabs';
import ZoneSegmented from '../components/zone/ZoneSegmented';
import { OUI_BTN_GHOST, OUI_BTN_PRIMARY, OUI_WRAP_FULL } from '../utils/operator-ui';
import ZoneFrame from '../components/zone/ZoneFrame';
import { zoneModule } from '../constants/ai-operator-modules';
import { goBackOr } from '../lib/scroll-restoration';
import LifecycleMapCanvas, { type MapStatusFilter } from '../components/journey/map/LifecycleMapCanvas';
import GapFinderModal, { type GapOpportunity } from '../components/journey/map/GapFinderModal';
import JourneyWorkspace from '../components/journey/workspace/JourneyWorkspace';
import { useJourneyActions } from '../components/journey/workspace/useJourneyActions';
import InterviewModal from '../components/journey/map/InterviewModal';
import BatchActivateModal from '../components/journey/map/BatchActivateModal';
import ProductJourneyModal from '../components/journey/map/ProductJourneyModal';
import JourneyAttachModal from '../components/journey/map/JourneyAttachModal';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import { journeyApiErrorText, type AttachFix, type CreateMode, type LifecycleMapData, type MapJourney } from '../utils/journey-map';

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
  // ★ 2026-10-23 한 줄 여정 한 길 — 지도 명령 줄 = 문장으로 만들기 창(그 문장을 바로 읽는다)
  const [interviewSentence, setInterviewSentence] = useState('');
  const [productOpen, setProductOpen] = useState(false);
  const [batch, setBatch] = useState<{ open: boolean; preselect: string[] }>({ open: false, preselect: [] });
  // ★ V.3 §9-1 — 작업 화면 = 주소(?journey=&step=) · 모두 켜기 창의 「문안 고치기」로 열었으면 닫을 때 그 창으로 돌아간다.
  const wsJourney = searchParams.get('journey');
  const wsStep = searchParams.get('step');
  const [returnToBatch, setReturnToBatch] = useState<string[] | null>(null);
  // ★ V.3 §10-2 D7 — 기본 = 한눈에(요약 카드) · 칸까지 = 옛 척추 그림.
  const [glance, setGlance] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // ★ V.3 §18 — 이 여정 뒤에 붙이기 창(앞 여정).
  const [attachFor, setAttachFor] = useState<MapJourney | null>(null);
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
  const openWorkspace = useCallback((id: string, step: string | null) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('journey', id); if (step) n.set('step', step); else n.delete('step'); return n; }, { replace: searchParams.has('journey') });
  }, [setSearchParams, searchParams]);
  const closeWorkspace = useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('journey'); n.delete('step'); return n; }, { replace: true });
    if (returnToBatch) { setBatch({ open: true, preselect: returnToBatch }); setReturnToBatch(null); }
  }, [setSearchParams, returnToBatch]);
  const journeyActions = useJourneyActions({ onChanged: () => { void load(true); }, operationCost: data?.costs.operation ?? 10 });

  const create = useCallback((triggerEvent: string, objective?: string, mode?: CreateMode) => {
    // ★ 2026-09-30 V2 3차 — 상품을 골라야 하는 여정(상품 재구매)은 상품 고르기 창으로(1클릭 프리셋으로 만들 수 없다).
    if (mode === 'product') { setProductOpen(true); return; }
    const qs = new URLSearchParams({ preset: triggerEvent });
    if (objective) qs.set('objective', objective);
    navigate(`/ai-journeys?${qs.toString()}`);
  }, [navigate]);

  const openEntrants = useCallback((id: string) => navigate(`/ai-journeys/${id}`), [navigate]);

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
          description: '같은 고객이 다시 사면 이 여정을 또 받아요. 켜진 여정도 멈추지 않고 바로 바뀌어요.',
          confirmLabel: '켜기',
        }, async () => {
          await patchOptions(fix.journeyId!, { allowReentry: true });
          toast.success('다음 구매 때 다시 받도록 켰어요.');
        });
      case 'exclude_first_purchase':
      case 'exclude_dormant_return':
        // 1클릭(덜 보내는 방향 · 켜진 채 그 자리 · 다음 진입부터) — 같은 구매에 문자 한 통만.
        try {
          await patchOptions(fix.journeyId!, { [fix.action]: true });
          toast.success(fix.action === 'exclude_first_purchase' ? '첫 구매 고객은 첫 구매 여정만 받아요.' : '돌아온 고객은 휴면 복귀 여정만 받아요.');
        } catch (e: any) {
          toast.error(e?.message || '바꾸지 못했어요.');
        } finally {
          await load(true);
        }
        return;
      default:
        return;
    }
  }, [data, create]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ★ V.3 §18 — 앞 여정에서 떼기(확인 한 단계 · 원래 시작으로). */
  const detach = (j: MapJourney): Promise<void> => ask({
    mode: 'warning',
    title: '앞 여정에서 떼기',
    description: `「${j.name}」는 원래 시작으로 돌아가요. 「${j.attachedAfter?.name || '앞 여정'}」을 마친 고객은 더 받지 않고, 진행 중 고객은 끝까지 받아요.`,
    confirmLabel: '떼기',
  }, async () => {
    const res = await fetch(`/api/ai/operator/journeys/${j.id}/detach`, { method: 'POST', headers: jsonHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d?.success) throw new Error(journeyApiErrorText(d, '떼지 못했어요.'));
    toast.success(`「${j.name}」를 앞 여정에서 뗐어요.`);
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

  const [mapLine, setMapLine] = useState('');
  const gapCount = data?.summary?.fixCount ?? 0;

  // ★ 2026-09-30 AI 존 대개편: 지도 = 여정 메뉴의 두 번째 탭(머리·명령 카드는 목록과 같은 틀)
  const mapTabs = JOURNEY_TABS;
  if (loading && !data) {
    return (
      <ZoneFrame moduleId="journeys" tabs={mapTabs} activeTab="map" backTo="/ai-journeys">
      <div className="py-24 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
          <span className="text-xs">여정 지도를 그리는 중</span>
        </div>
      </div>
      </ZoneFrame>
    );
  }

  if (!data) {
    return (
      <ZoneFrame moduleId="journeys" tabs={mapTabs} activeTab="map" backTo="/ai-journeys">
      <div className="py-24 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="text-sm text-rose-700">{error || '여정 지도를 불러오지 못했어요.'}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load(false)} className={OUI_BTN_PRIMARY}>다시 불러오기</button>
            <button type="button" onClick={() => navigate('/ai-journeys')} className={OUI_BTN_GHOST}>여정 목록으로</button>
          </div>
        </div>
      </div>
      </ZoneFrame>
    );
  }

  const oneLine = zoneModule('journeys').oneLine!;
  return (
    <ZoneFrame
      moduleId="journeys"
      tabs={mapTabs}
      activeTab="map"
      backTo="/ai-journeys"
      width="full"
      command={{
        line: {
          value: mapLine,
          onChange: setMapLine,
          // ★ 2026-10-23 한 줄 여정 한 길 — 목록과 같은 창(질문표 · 서버 초안)을 지도 위에서 바로 연다
          onSubmit: () => { const v = mapLine.trim(); if (v.length < 4) return; setInterviewSentence(v); setInterviewOpen(true); },
          placeholder: oneLine.placeholder,
          verb: oneLine.verb,
          icon: Sparkles,
        },
      }}
      stamp={{ text: `${timeText(data.generatedAt)} 기준 · 다시 읽기`, onRefresh: () => void load(true), loading: refreshing, title: data.judgedAt ? `구매 확인 예정 ${timeText(data.judgedAt)}` : undefined }}
      start={{
        items: [
          { icon: Sparkles, title: 'AI 진단', desc: gapCount > 0 ? `고객 구매 리듬으로 여정을 추천하고 손볼 곳 ${gapCount}곳을 알려 줘요` : '고객 구매 리듬을 재서 가입부터 재구매까지 여정을 추천해요', tint: 'from-fuchsia-400 to-purple-500', featured: true, badge: gapCount > 0 ? `${gapCount}곳` : undefined, onClick: () => setGapOpen(true) },
          { icon: MessageSquarePlus, title: '문장으로 만들기', desc: '하고 싶은 것을 문장으로 쓰면 지도에 놓아요', tint: 'from-sky-400 to-indigo-500', onClick: () => { setInterviewSentence(''); setInterviewOpen(true); } },
        ],
      }}
      blocks={error ? [{ text: error }] : []}
    >
      {/* 도구 줄: 상태 · 찾기 · 범례(캔버스와 같은 전폭 · 좌우 끝 한 줄) */}
      <div>
        <div className="pb-3 flex flex-wrap items-center gap-2">
          <ZoneSegmented
            ariaLabel="여정 상태"
            items={FILTERS.map((f) => ({ id: f.key, label: f.label, count: counts[f.key] }))}
            value={statusFilter}
            onChange={(id) => setStatusFilter(id)}
          />
          <ZoneSegmented
            ariaLabel="지도 보기"
            items={[{ id: 'glance', label: '한눈에' }, { id: 'steps', label: '칸까지' }]}
            value={glance ? 'glance' : 'steps'}
            onChange={(id) => setGlance(id === 'glance')}
          />
          <label className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-slate-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="여정 이름 · 시작 사건 찾기"
              aria-label="여정 찾기"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-slate-200 shadow-sm text-[13px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          {data.summary && (
            <p className="w-full text-[13px] text-slate-600 tabular-nums lg:ml-auto lg:w-auto">
              켜진 여정 {data.summary.activeJourneys.toLocaleString('ko-KR')}개 · 지금 진행 중 {data.summary.inProgressCustomers.toLocaleString('ko-KR')}명
              {data.summary.fixCount > 0 ? <> · <span className="font-semibold text-amber-800">손볼 곳 {data.summary.fixCount.toLocaleString('ko-KR')}곳</span></> : ' · 손볼 곳 없음'}
              {data.summary.operationCredits30d != null ? ` · 지난 30일 운영 ${data.summary.operationCredits30d.toLocaleString('ko-KR')}크레딧` : ''}
            </p>
          )}
        </div>
      </div>

      {/* 캔버스: 데스크톱은 이 칸 안에서만 스크롤(레인 머리 고정) · 모바일은 페이지 스크롤 */}
      <div className="rounded-2xl border border-slate-200 bg-white md:max-h-[calc(100vh-120px)] md:overflow-auto">
        <LifecycleMapCanvas
          data={data}
          statusFilter={statusFilter}
          search={search}
          focusId={focusId}
          glance={glance}
          busyId={journeyActions.busyId}
          onFocusJourney={focusJourney}
          onOpen={openWorkspace}
          onEntrants={openEntrants}
          onAction={(j) => {
            const aj = { id: j.id, name: j.name, status: j.status, goalExitEnabled: j.goalExitEnabled, thresholdRecipients: j.thresholdRecipients, activationCost: j.activationCost, pause: j.pause };
            if (j.status === 'active') void journeyActions.pause(aj);
            else if (j.status === 'paused') journeyActions.activate(aj);
            else if (j.status === 'draft') setBatch({ open: true, preselect: [j.id] });
          }}
          onCreate={(t, mode) => create(t, undefined, mode)}
          onFix={(f) => void handleFix(f)}
          onAttach={(j) => setAttachFor(j)}
          onDetach={(j) => void detach(j)}
        />
      </div>

      {/* 초안이 있으면 켜기 전 점검 입구(자동으로 켜지 않는다) */}
      {counts.draft > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-slate-100 backdrop-blur-md">
          <div className={`${OUI_WRAP_FULL} py-2.5 flex items-center gap-3`}>
            <span className="flex-1 text-xs text-slate-500">초안 {counts.draft}개가 켜지기를 기다려요.</span>
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
        onDrafted={(ids) => { void load(true).then(() => setBatch({ open: true, preselect: ids })); }}
      />
      <InterviewModal
        open={interviewOpen}
        initialSentence={interviewSentence || undefined}
        onClose={() => setInterviewOpen(false)}
        onFix={handleFix}
        onFocusJourney={focusJourney}
        onActivateMany={(ids) => { void load(true).then(() => setBatch({ open: true, preselect: ids })); }}
        onCreated={() => void load(true)}
      />
      <JourneyAttachModal
        open={!!attachFor}
        after={attachFor}
        onClose={() => setAttachFor(null)}
        onAttached={(id) => { void load(true).then(() => focusJourney(id)); }}
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
          setReturnToBatch(keep.length > 0 ? keep : [j.id]);
          const first = j.steps.find((st) => st.kind === 'message');
          openWorkspace(j.id, first ? first.stepId : null);
        }}
        onDone={() => void load(true)}
      />
      <JourneyWorkspace
        journeyId={wsJourney}
        stepId={wsStep}
        map={data}
        onClose={closeWorkspace}
        onChanged={() => void load(true)}
        onNavigate={openWorkspace}
      />
      {journeyActions.node}
      <ConfirmModal
        state={confirm}
        onClose={() => {
          setConfirm(null);
          if (confirmResolve.current) { confirmResolve.current(); confirmResolve.current = null; }
        }}
      />
    </ZoneFrame>
  );
}
