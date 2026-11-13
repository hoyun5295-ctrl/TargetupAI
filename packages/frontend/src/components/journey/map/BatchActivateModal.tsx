/**
 * BatchActivateModal — 켜기 전 점검 · 모두 켜기 (★ 2026-09-30 여정 V2 2차 · 설계서 §5 "켜기")
 *
 * 한 창에서: 여정마다 사전 검증(기존 pretest-validate · 여정마다 차례로) · 한 번에 보낼 최대 인원(★ 2026-11-01 선택 · 비우면 제한 없음) ·
 *   처음 켜는 요금(서버 단가 × 초안 수) · 소급 없음 안내 · 겹치는 쌍마다 고르기(알고 둘 다 보냄 / 한쪽 빼기)
 *   → [모두 켜기] = 서버 activate-batch(받는 여정 먼저 · 여정마다 단건과 같은 게이트) → 카드별 결과.
 *
 * ⛔ 자동으로 켜지 않는다 · 게이트를 우회하지 않는다. 최대 인원을 바꾸면 서버가 검증 통과를 지우므로 그 여정은 다시 검증한다.
 * ★ 2026-11-05 C103 F2(설계서 docs/2026-11-05-intake-1104-fix-design.md) — 창을 열거나 고를 때 자동 검증(= 유료 스팸 검사) 0.
 *   [모두 켜기] = 누른 순간의 고른 여정 · 최대 인원 · 겹침 해소 · 매장번호 확인을 잡고 → 통과 아닌 여정 검증
 *   → 모두 통과면 같은 누름으로 켜기(잡아 둔 값만 · Codex 설계 1R H5). 그동안 고르기 · 칸 · 겹침 단추 · 줄 [점검]을 잠근다.
 *   ★ 2026-11-13 C133 F1 4 ~ 7번(단계가 열린 회사에만) — 고른 여정마다 무료 추정(모델 호출 0 · 차감 0)을 검사 **전에** 보인다:
 *     「지금 대상 n명 · 예상 발송 x건 · 발송비 약 y원」 · 켜면 바로 멈추는 여정은 그 줄에 안내하고 [모두 켜기]를 잠근다(지금 칸에 적힌 최대 인원으로 판정) ·
 *     아래 줄에 합계 · 선불 잔액이 모자라면 안내(잠그지 않는다) · 회사 피로도 상한이 꺼져 있으면 안내 + 설정 링크(여기서 값을 정하지 않는다).
 *   ★ 2026-11-13 C133 — 최대 인원은 따로 저장하지 않는다. 켜기 요청이 화면의 값을 싣고 서버가 켜는 그 문장에서 함께 쓴다(켜지는 값 = 화면의 값).
 * ⛔ 피로도는 겹침 해소 선택지가 아니다(회사 전체 설정 · 설계서 §5).
 * ★ 2026-11-13 C133 F1 8번(설계서 docs/2026-11-13-hanjul-v3-design.md §3-1) — 응답이 안 오면 창에 갇히던 것을 구간 둘로 갈라 푼다.
 *   검증 구간(최대 인원 저장 · 여정별 사전 검사) = 요청마다 시간 제한 · 닫기 = 취소(세대를 올리고 요청을 끊는다 · 남은 검증을 더 부르지 않는다).
 *   켜기 접수 뒤(activate-batch 를 보낸 뒤 = 서버가 여정을 차례로 켜고 차감한다 · 화면이 멈출 수 없다) = 닫기 = 숨김(「닫아도 계속 켜져요」).
 *   응답을 못 받으면 지도를 다시 읽어 여정 상태로 확인하게 한다(되돌리지 않는다 · 다시 눌러도 이미 켜진 여정은 다시 차감하지 않는다 = 서버 멱등).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Power, Users, X, XCircle } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import { journeyCapHelp } from '../../../utils/journey-cap-copy';
import { STANDING_TRIGGERS } from '../../../utils/journey-start-form';
import { sendJson } from '../../../utils/dashboard-live';
import { useV3Feature } from '../../../utils/v3-features';
import { fetchJourneyEstimate, createEstimateQueue, estimateLine, stopLine, sumEstimates, totalLine, balanceShort, type JourneyEstimate, type EstimateCell } from '../../../utils/journey-estimate';
import type { BatchActivationItem, LifecycleMapData, MapJourney } from '../../../utils/journey-map';

interface Props {
  open: boolean;
  onClose: () => void;
  data: LifecycleMapData;
  /** 처음 골라 둘 여정(문장으로 만들기 결과 · 선 고치기). 비우면 초안 전부. */
  preselect: string[];
  onEditMessages: (journey: MapJourney) => void;
  onDone: () => void;
}

type Check = { state: 'idle' | 'checking' | 'pass' | 'fail'; issues: string[]; weeklyCount?: number; weeklyCost?: number };

const REASON_TEXT: Record<string, string> = {
  placeholder_unedited: '채워야 할 자리표시(혜택 등)가 남아 있어요',
  variable_mapping_invalid: '알림톡 변수 연결이 비었어요',
  spam_filter_failed: '스팸 차단에 걸리는 문구가 있어요',
  spam_check_unavailable: '스팸 검사를 마치지 못했어요(잠시 뒤 다시 켜 주세요)',
  spam_check_pending: '스팸 검사 결과를 확인하고 있어요(잠시 뒤 다시 켜 주세요)',
  subject_missing: 'LMS 제목이 없어요',
  alimtalk_template_unusable: '알림톡 템플릿을 지금 보낼 수 없어요',
  copy_issue: '보낼 글에 고칠 곳이 있어요',
};

/** 칸을 고친 뒤 추정을 다시 묻기까지 기다리는 시간(ms) — 입력이 멈춘 뒤 한 번만 */
const ESTIMATE_DEBOUNCE_MS = 400;

/** 요청 시간 제한(ms) — 사전 검사는 칸마다 스팸 검사를 최대 30초씩 기다린다(여러 칸 = 몇 분) · 켜기는 여정을 차례로 켠다 */
const VALIDATE_TIMEOUT_MS = 300_000;
const ACTIVATE_TIMEOUT_MS = 300_000;

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function BatchActivateModal({ open, onClose, data, preselect, onEditMessages, onDone }: Props) {
  const candidates = useMemo(
    () => data.journeys.filter((j) => j.status === 'draft' || j.status === 'paused'),
    [data.journeys],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [confirmCb, setConfirmCb] = useState<Set<string>>(new Set());
  /** idle = 고르는 중 · validating = 검증 구간(닫기 = 취소) · activating = 켜기 접수 뒤(닫기 = 숨김) */
  const [phase, setPhase] = useState<'idle' | 'validating' | 'activating'>('idle');
  const running = phase !== 'idle';
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [results, setResults] = useState<BatchActivationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  // ★ C133 F1 4 ~ 7번 — 무료 추정(단계가 열린 회사에만)
  const navigate = useNavigate();
  const packOpen = useV3Feature('journey-pack');
  const [ests, setEsts] = useState<Record<string, EstimateCell>>({});
  /** 추정 요청 줄 — 한 번에 하나 · 답은 지금 원하는 것(창을 연 차례 · 칸 값)과 맞을 때만(utils/journey-estimate createEstimateQueue) */
  const estQueue = useMemo(() => createEstimateQueue({
    fetch: fetchJourneyEstimate,
    onCell: (id, cell) => setEsts((prev) => ({ ...prev, [id]: cell })),
  }), []);
  /** 창을 열 때마다 올린다 — 추정을 비우고 다시 묻게(앞서 열었을 때의 답을 그대로 믿지 않는다) */
  const [estEpoch, setEstEpoch] = useState(0);

  // 열 때 초기화 — 고른 여정 · 저장된 최대 인원.
  useEffect(() => {
    if (!open) return;
    const pre = preselect.length > 0 ? preselect.filter((id) => candidates.some((c) => c.id === id)) : candidates.filter((c) => c.status === 'draft').map((c) => c.id);
    setSelected(new Set(pre));
    setCaps(Object.fromEntries(candidates.map((c) => [c.id, c.thresholdRecipients != null ? String(c.thresholdRecipients) : ''])));
    setChecks({});
    setAcks(new Set());
    setConfirmCb(new Set());
    setResults(null);
    setError(null);
    setEsts({});
    setEstEpoch((n) => n + 1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 한 여정 검증(서버 사전 검증 = 스팸 검사 포함 · 같은 날 같은 글은 이어 보기) · 결과 상태를 돌려준다(stale = 그사이 다른 실행) */
  const validateOne = async (id: string, rid: number): Promise<'pass' | 'fail' | 'stale'> => {
    setChecks((prev) => ({ ...prev, [id]: { state: 'checking', issues: [] } }));
    {
      const res = await sendJson(`/api/ai/operator/journeys/${id}/pretest-validate`, { method: 'POST', signal: abortRef.current?.signal }, VALIDATE_TIMEOUT_MS);
      const d = res.body || {};
      if (rid !== runId.current) return 'stale';
      if (res.status === 0) {
        setChecks((prev) => ({ ...prev, [id]: { state: 'fail', issues: ['검증 응답을 받지 못했어요. 잠시 뒤 다시 점검해 주세요.'] } }));
        return 'fail';
      }
      const j = candidates.find((c) => c.id === id);
      const orderOf = (stepId: string) => j?.steps.find((s) => s.stepId === stepId)?.order;
      if (res.ok && d?.ok) {
        setChecks((prev) => ({ ...prev, [id]: { state: 'pass', issues: [], weeklyCount: d.estimatedWeeklyTriggerCount, weeklyCost: d.totalCost } }));
        return 'pass';
      } else {
        const issues: string[] = Array.isArray(d?.failedSteps) && d.failedSteps.length > 0
          ? d.failedSteps.slice(0, 3).map((f: any) => `${orderOf(f.stepId) ? `${orderOf(f.stepId)}번째 칸: ` : ''}${REASON_TEXT[f.reason] || '문안을 확인해 주세요'}`)
          : [d?.error || (res.status === 503 ? '검증을 준비 중이에요. 잠시 뒤 다시 시도해 주세요.' : '문안이 없거나 검증하지 못했어요.')];
        setChecks((prev) => ({ ...prev, [id]: { state: 'fail', issues } }));
        return 'fail';
      }
    }
  };
  /** 줄 [점검] = 사람이 누른 그 여정 하나만(★ C103 F2 · 열기 · 고르기 자동 검증 0) */
  const checkRow = (id: string) => { if (running) return; const rid = ++runId.current; abortRef.current = new AbortController(); void validateOne(id, rid); };

  const toggle = (id: string) => { if (running) return; setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const pairs = useMemo(() => data.overlaps.filter((o) => selected.has(o.a) || selected.has(o.b)), [data.overlaps, selected]);
  const nameOf = (id: string) => data.journeys.find((j) => j.id === id)?.name || '여정';
  const pairKey = (o: { a: string; b: string }) => [o.a, o.b].sort().join('|');

  const selectedList = candidates.filter((c) => selected.has(c.id));
  // ★ V.3 §5-1 — 처음 켜기 크레딧은 서버가 여정마다 정한다(새 판 초안 = 0 · 화면이 상태로 매기지 않는다).
  const credit = selectedList.reduce((s, c) => s + (Number(c.activationCost) || 0), 0);
  // ★ 2026-11-01 Harold — 최대 인원 = 선택(비움 = 제한 없음 · 넣으면 1 이상)
  const capOf = (id: string): number | null => (caps[id]?.trim() ? Math.floor(Number(caps[id])) : null);
  const capOk = (id: string) => { const n = capOf(id); return n == null || (Number.isFinite(n) && n >= 1); };
  const allCaps = selectedList.every((c) => capOk(c.id));
  const allAck = pairs.every((o) => acks.has(pairKey(o)));
  // ★ C133 F1 4 ~ 5번 — 고른 여정마다 지금 칸의 최대 인원으로 무료 추정을 묻는다(입력이 멈춘 뒤 · 요청 줄 하나 = 한 번에 하나 · 낡은 답은 버린다).
  //   모델 호출 0 · 차감 0 · 저장 0(읽기만). 닫힌 회사 · 결과 화면 · 닫힌 창은 묻지 않는다(빈 요청 = 도는 바퀴도 멈춘다).
  const estKey = packOpen && open && !results ? `${estEpoch}#${selectedList.map((c) => `${c.id}:${capOk(c.id) ? capOf(c.id) ?? 'none' : 'bad'}`).join('|')}` : '';
  useEffect(() => {
    if (!estKey) { estQueue.request({ epoch: estEpoch, items: [] }); return; }
    const items = selectedList.filter((c) => capOk(c.id)).map((c) => ({ id: c.id, cap: capOf(c.id) }));
    const timer = setTimeout(() => estQueue.request({ epoch: estEpoch, items }), ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [estKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 화면에서 사라지면 줄을 비운다 — 떠 있는 조회 하나가 끝난 뒤 남은 여정을 더 묻지 않는다(★ Codex 배포 B 2R · 옛: 사라진 뒤에도 고른 여정을 끝까지 셌다)
  useEffect(() => () => estQueue.request({ epoch: -1, items: [] }), [estQueue]);
  /** 이 창을 연 뒤 · 지금 칸의 값으로 판정한 추정만(다시 열기 전의 답 · 칸을 고친 뒤의 낡은 답 · 묻는 중 · 못 읽음 = null) */
  const cellOf = (id: string): EstimateCell | null => {
    const e = ests[id];
    return packOpen && e && capOk(id) && e.epoch === estEpoch && e.cap === capOf(id) ? e : null;
  };
  const estOf = (id: string): JourneyEstimate | null => cellOf(id)?.est || null;
  const estLoading = (id: string): boolean => packOpen && capOk(id) && (!cellOf(id) || cellOf(id)!.est === undefined);
  const selectedEsts = selectedList.map((c) => estOf(c.id));
  const total = sumEstimates(selectedEsts);
  const capStops = selectedEsts.some((e) => e?.firstRoundCapExceeded === true);
  const anyEst = selectedEsts.find((e) => !!e) || null;
  const lowBalance = balanceShort(anyEst?.prepaidBalance, total.cost);
  const fatigueOff = selectedEsts.some((e) => e?.fatigueCap === 'off');
  // ★ C103 F2 — 검증 통과는 누른 뒤 같은 누름 안에서(켤 때 검사 · 접수 2)
  //   ★ C133 F1 5번 — 켜면 바로 멈추는 여정이 있으면 잠근다(최대 인원을 늘리거나 비우면 풀린다 · 판정 = 지금 칸의 값)
  const ready = selectedList.length > 0 && allCaps && allAck && !running && !capStops;

  const run = async () => {
    if (!ready) return;
    // 누른 순간 값을 잡는다(Codex 설계 1R H5 · 이 뒤 화면 조작은 running 잠금 · 켜기 요청은 잡아 둔 값만)
    const at = {
      list: selectedList.map((c) => ({ id: c.id, name: c.name, cap: capOf(c.id) })),
      acks: [...acks],
      confirmCb: [...confirmCb],
      checks: { ...checks },
    };
    const rid = ++runId.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('validating');
    setProgress({ done: 0, total: at.list.length });
    setError(null);
    try {
      // 1) 최대 인원은 여기서 저장하지 않는다 — 아래 켜기 요청이 화면의 값을 싣고 서버가 켜는 문장에서 함께 쓴다.
      //   ★ C133 Codex 구현 1R ~ 3R(같은 계열) — 옛: 켜기 전에 최대 인원을 따로 저장했다. 저장과 켜기가 따로라
      //     ① 낡은 지도 값으로 저장을 건너뛰거나 ② 저장 응답을 잃거나 ③ 닫아서 끊은 저장이 켜진 뒤에 도착해 화면과 다른 값으로 돌 수 있었다.
      //     지금: 그런 요청이 없다(검증 구간에서 서버 값을 바꾸는 요청 0). 최대 인원은 사전 검사 통과 표식을 지우지 않는 값이라 다시 검증할 것도 없다.
      // 2) 검증 = 통과가 아닌 여정(스팸 검사는 이때만 · 같은 날 같은 글은 이어 보기 · 차례로)
      let allOk = true;
      let done = 0;
      for (const c of at.list) {
        if (at.checks[c.id]?.state === 'pass') { setProgress({ done: ++done, total: at.list.length }); continue; }
        const v = await validateOne(c.id, rid);
        if (v === 'stale') return;
        if (v !== 'pass') allOk = false;
        setProgress({ done: ++done, total: at.list.length });
      }
      if (!allOk) { setError('점검에서 고칠 곳이 나온 여정이 있어요. 줄마다 안내를 확인해 주세요.'); return; }
      // 3) 켜기 = 잡아 둔 값만. ⛔ 이 요청을 보낸 뒤로는 끊지 않는다(서버가 차례로 켜고 차감한다) — 닫기 = 숨김.
      if (rid !== runId.current) return;
      setPhase('activating');
      const res = await sendJson('/api/ai/operator/journeys-activate-batch', {
        method: 'POST',
        // ★ 2026-10-19 B-1009-5 — 고른 겹침 해소(쌍 키)를 함께 보낸다(서버가 다시 확인한다)
        // ★ C133 — 화면이 보여 준 최대 인원을 여정마다 싣는다(서버가 켜는 문장에서 이 값을 함께 쓴다 = 켜지는 값이 곧 화면의 값)
        body: { journeyIds: at.list.map((c) => c.id), confirmCallbackExclusionIds: at.confirmCb, acknowledgedOverlaps: at.acks, caps: Object.fromEntries(at.list.map((c) => [c.id, c.cap])) },
      }, ACTIVATE_TIMEOUT_MS);
      const d = res.body || {};
      if (res.status === 0 || (res.ok && !res.body)) {
        // 응답을 못 받았다(본문을 못 읽은 것 포함) = 켜졌는지 모른다 → 지도를 다시 읽어 여정 상태로 확인하게 한다(되돌리지 않는다)
        onDone();
        setError('켜기 응답을 받지 못했어요. 지도에서 여정 상태를 확인해 주세요. 다시 눌러도 이미 켜진 여정은 다시 차감하지 않아요.');
        return;
      }
      if (!res.ok || !d?.success) { setError(d?.error || '켜지 못했어요.'); return; }
      setResults(d.items || []);
      onDone();
    } finally {
      // 닫아서 취소한 실행(세대가 올라감)은 닫는 쪽이 이미 풀었다 — 그 뒤 새 실행의 잠금을 건드리지 않는다
      if (rid === runId.current) { setPhase('idle'); setProgress(null); }
    }
  };

  /** 닫기 — 검증 구간 = 취소(요청을 끊고 「검증 중」 표시를 되돌린다) · 켜기 접수 뒤 = 숨김(요청은 그대로 간다) */
  const handleClose = () => {
    if (phase !== 'activating') {
      runId.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      setChecks((prev) => Object.fromEntries(Object.entries(prev).filter(([, c]) => c.state !== 'checking')));
      setPhase('idle');
      setProgress(null);
    }
    onClose();
  };

  /**
   * ★ 2026-09-30 V2 3차 — 첫 구매 ↔ 주문 완료 겹침 해소: 주문 완료 여정(초안 · 멈춤)에서 첫 구매 고객을 뺀다.
   *   옵션을 바꾸면 서버가 검증 통과를 지우므로 그 여정을 다시 검증한다.
   */
  const excludeFirstPurchase = async (pairKeyValue: string, journeyId: string) => {
    if (running) return;
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/options`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ exclude_first_purchase: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) { setError(d?.error || '첫 구매 고객을 빼지 못했어요.'); return; }
      setAcks((prev) => new Set(prev).add(pairKeyValue));
      // ★ C103 F2 — 자동 재검증 0 · 옵션이 바뀌어 서버 통과가 지워졌으므로 「검사 전」으로(켤 때 · 줄 [점검]에서 검사)
      setChecks((prev) => { const n = { ...prev }; delete n[journeyId]; return n; });
    } catch {
      setError('네트워크 오류로 바꾸지 못했어요.');
    }
  };

  const retryWithCallback = (id: string) => {
    setConfirmCb((prev) => new Set(prev).add(id));
    setResults(null);
    setSelected(new Set([id]));
  };

  return (
    <JourneyModalShell open={open} onClose={handleClose} labelledBy="jmap-batch-title" panelClassName="w-full max-w-2xl">
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-200">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-violet-500 flex items-center justify-center shrink-0">
          <Power className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-batch-title" className="text-sm font-semibold text-slate-900">켜기 전 점검</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">받는 여정부터 차례로 켭니다. 켠 뒤에 조건을 새로 만족한 고객부터 보내요(지난 사건으로는 보내지 않아요).</p>
        </div>
        <button type="button" onClick={handleClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label={phase === 'validating' ? '검증 멈추고 닫기' : '닫기'}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {results ? (
          <div className="space-y-2">
            {results.map((it) => (
              <div key={it.journeyId} className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${it.result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                {it.result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 text-rose-700 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900">{it.name || nameOf(it.journeyId)}</div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {it.result.ok ? `${it.result.charged > 0 ? `켰어요 · ${it.result.charged} 크레딧` : it.result.firstActivation ? '켰어요 · 추가 크레딧 0' : '다시 켰어요'}${it.result.dispatchPending ? ' · 받는 분을 넣는 중(30분 안에 자동)' : ''}` : it.result.message}
                  </p>
                </div>
                {!it.result.ok && it.result.code === 'CALLBACK_CONFIRM_REQUIRED' && (
                  <button type="button" onClick={() => retryWithCallback(it.journeyId)} className="shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-500">
                    알고 켜기
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            {candidates.length === 0 && <div className="text-[11px] text-slate-400">켤 초안이나 멈춘 여정이 없어요.</div>}
            <div className="space-y-2">
              {candidates.map((c) => {
                const ck = checks[c.id];
                const on = selected.has(c.id);
                return (
                  <div key={c.id} className={`rounded-xl border px-3 py-3 ${on ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2.5">
                      <input type="checkbox" checked={on} onChange={() => toggle(c.id)} disabled={running} className="w-4 h-4 accent-violet-500" aria-label={`${c.name} 켜기에 넣기`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{c.name}</div>
                        <div className="text-[11px] text-slate-400">{c.status === 'draft' ? (c.activationCost > 0 ? `초안 · 처음 켜기 ${c.activationCost} 크레딧` : '초안 · 같은 여정이라 추가 크레딧 0') : '멈춤 · 다시 켜기 0 크레딧'} · {c.triggerLabel}</div>
                      </div>
                      {on && (
                        <span className="shrink-0 text-[11px] inline-flex items-center gap-1">
                          {!ck || ck.state === 'idle' ? <span className="text-slate-500">검사 전</span>
                            : ck.state === 'checking' ? <><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-700" /><span className="text-slate-500">검증 중</span></>
                            : ck.state === 'pass' ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /><span className="text-emerald-800">통과</span></>
                              : <><AlertCircle className="w-3.5 h-3.5 text-amber-700" /><span className="text-amber-800">고칠 곳</span></>}
                        </span>
                      )}
                    </div>
                    {on && (
                      <div className="mt-2.5 pl-6 space-y-2">
                        <label className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="shrink-0">한 번에 보낼 최대 인원</span>
                          <input
                            value={caps[c.id] ?? ''}
                            onChange={(e) => setCaps((prev) => ({ ...prev, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                            inputMode="numeric"
                            placeholder="비우면 제한 없음"
                            disabled={running}
                            className={`w-28 h-8 px-2 rounded-lg bg-white border text-xs tabular-nums focus:outline-none focus:border-violet-400 ${capOk(c.id) ? 'border-slate-200' : 'border-amber-300'}`}
                          />
                          <span className="text-slate-400">명</span>
                        </label>
                        {/* ★ 2026-11-05 C103 F5 — 최대 인원 뜻 = 공용 문구 한 곳([시작] 카드 · 켜기 창과 같은 글) */}
                        <p className={`text-[11px] ${capOf(c.id) == null ? 'text-amber-800' : 'text-slate-500'}`}>{journeyCapHelp(capOf(c.id), STANDING_TRIGGERS.includes(c.triggerEvent))}</p>
                        {/* ★ C133 F1 4 ~ 5번 — 검사 전에 보이는 무료 추정(단계가 열린 회사에만) */}
                        {packOpen && (() => {
                          const e = estOf(c.id);
                          if (!e) return estLoading(c.id) ? <p className="text-[11px] text-slate-400">대상을 세는 중</p> : null;
                          const stop = stopLine(e);
                          return (
                            <>
                              <p className="text-[11px] text-slate-600 tabular-nums">{estimateLine(e)}</p>
                              {stop && <p className="flex items-start gap-1 text-[11px] font-semibold text-amber-800"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{stop}</p>}
                            </>
                          );
                        })()}
                        {(!ck || ck.state === 'idle') && (
                          <button type="button" onClick={() => checkRow(c.id)} disabled={running} className="h-7 px-2.5 rounded-lg text-[11px] text-slate-600 border border-slate-300 hover:bg-slate-100 disabled:opacity-40">점검</button>
                        )}
                        {ck?.state === 'pass' && (ck.weeklyCount != null) && (
                          <p className="text-[11px] text-slate-400 tabular-nums">7일 예상 {Number(ck.weeklyCount).toLocaleString('ko-KR')}건 · 발송비 약 {Number(ck.weeklyCost || 0).toLocaleString('ko-KR')}원</p>
                        )}
                        {ck?.state === 'fail' && (
                          <div className="space-y-1">
                            {ck.issues.map((m) => <p key={m} className="text-[11px] text-amber-800">{m}</p>)}
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => onEditMessages(c)} disabled={running} className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-violet-900 border border-violet-200 hover:bg-violet-100 disabled:opacity-40">문안 고치기</button>
                              <button type="button" onClick={() => checkRow(c.id)} disabled={running} className="h-7 px-2.5 rounded-lg text-[11px] text-slate-600 border border-slate-300 hover:bg-slate-100 disabled:opacity-40">다시 점검</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {pairs.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-900">함께 시작되는 여정</h3>
                {pairs.map((o) => {
                  const k = pairKey(o);
                  return (
                    <div key={k} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-rose-900">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{nameOf(o.a)} · {nameOf(o.b)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-rose-900">같은 구매 한 번에 두 여정이 함께 시작돼 한 고객이 두 여정의 문자를 모두 받을 수 있어요.</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setAcks((prev) => new Set(prev).add(k))} disabled={running} className={acks.has(k) ? 'h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-rose-200 text-slate-900' : 'h-7 px-2.5 rounded-lg text-[11px] text-rose-900 border border-rose-200 hover:bg-rose-100'}>
                          알고 둘 다 보냄
                        </button>
                        {(() => {
                          const ja = data.journeys.find((j) => j.id === o.a);
                          const jb = data.journeys.find((j) => j.id === o.b);
                          const order = [ja, jb].find((j) => j?.triggerEvent === 'cdp.purchase');
                          const first = [ja, jb].find((j) => j?.triggerEvent === 'purchase.first');
                          if (!order || !first || (order.status !== 'draft' && order.status !== 'paused')) return null;
                          return (
                            <button type="button" onClick={() => void excludeFirstPurchase(k, order.id)} disabled={running} className="h-7 px-2.5 rounded-lg text-[11px] text-violet-900 border border-violet-200 hover:bg-violet-100 disabled:opacity-40">
                              {order.name}에서 첫 구매 고객 빼기
                            </button>
                          );
                        })()}
                        {[o.a, o.b].filter((id) => selected.has(id)).map((id) => (
                          <button key={id} type="button" onClick={() => { if (running) return; toggle(id); setAcks((prev) => { const n = new Set(prev); n.delete(k); return n; }); }} disabled={running} className="h-7 px-2.5 rounded-lg text-[11px] text-slate-600 border border-slate-300 hover:bg-slate-100 disabled:opacity-40">
                            {nameOf(id)} 이번엔 켜지 않기
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
        {/* ★ C133 F1 6 ~ 7번 — 안내만(켜기를 막지 않는다 · 값은 여기서 정하지 않는다) */}
        {!results && lowBalance && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />잔액이 모자라요 · 충전 뒤 켜 주세요(지금 잔액 {Math.round(anyEst?.prepaidBalance || 0).toLocaleString('ko-KR')}원)
          </p>
        )}
        {!results && fatigueOff && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
            <span>한 고객이 받는 광고 문자 상한이 꺼져 있어요.</span>
            <button type="button" onClick={() => { handleClose(); navigate('/settings'); }} disabled={phase === 'activating'}
              className="underline underline-offset-2 text-violet-800 hover:text-violet-600 disabled:opacity-40">설정에서 정하기</button>
          </p>
        )}
        {error && <p className="flex items-start gap-1.5 text-[11px] text-amber-800"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
      </div>

      <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
        {results ? (
          <>
            <span className="flex-1" />
            <button type="button" onClick={handleClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500">닫기</button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[11px] text-slate-500 tabular-nums" aria-live="polite">
              {phase === 'validating' ? (
                <>{progress ? `${progress.done}/${progress.total} 검증 중` : '검증 중'} · 닫으면 검증을 멈춰요</>
              ) : phase === 'activating' ? (
                <>켜는 중이에요. 닫아도 계속 켜져요.</>
              ) : (
                <>
                  {selectedList.length}개 켜기{totalLine(total, selectedList.length) ? ` · ${totalLine(total, selectedList.length)}` : ''} · {credit > 0 ? `처음 켜기 ${credit} 크레딧` : '크레딧 0'}
                  {!allCaps && selectedList.length > 0 ? ' · 최대 인원은 1 이상으로 넣거나 비워 주세요' : !allAck ? ' · 함께 시작되는 여정을 골라 주세요' : capStops ? ' · 켜면 바로 멈추는 여정이 있어요. 최대 인원을 늘리거나 비워 주세요' : ' · 켤 때 스팸 검사를 해요. 오늘 같은 글은 다시 검사하지 않아요.'}
                </>
              )}
            </span>
            <button type="button" onClick={() => void run()} disabled={!ready} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 inline-flex items-center gap-1.5">
              {running && <Loader2 className="w-4 h-4 animate-spin" />}
              모두 켜기
            </button>
          </>
        )}
      </div>
    </JourneyModalShell>
  );
}
