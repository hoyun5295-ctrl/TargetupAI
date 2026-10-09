/**
 * MapStepEditModal — 지도에서 칸을 누르면 뜨는 편집 창 (★ 2026-10-09 고객 관계 지도 · 설계서 §4 · MapStepDrawer 대체)
 *
 * 구도: 왼쪽 = 이 여정의 미니 척추(칸 이동 · 창 유지) · 오른쪽 = 숫자판 3 + 출처 + 편집기.
 *   편집기 = JourneyStepStudio 단일 칸 모드(SMS · LMS · MMS 만). 알림톡 · 대기 · 조건 칸은 읽기 전용 + [여정 자세히 보기].
 * ⛔ 무엇을 고칠 수 있는지는 서버 편집 정책(journey.edit · PATCH 게이트와 같은 함수)이 정한다 — 화면이 따로 판정하지 않는다.
 * ⛔ 저장 = 칸 하나씩 · 바뀐 묶음만 보낸다(켜진 여정 = 본문 · 제목만 + 고정 사실 확인).
 * 전문은 여정 상세 조회(/operator/journeys/:id → {journey, steps})에서 받는다(옛 서랍은 d.detail.steps 를 읽어 전문을 못 받았다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Flag, GitBranch, Hourglass, Loader2, Lock, MessageSquare, Save, Undo2, X } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import JourneyStepStudio, { type StudioStep, type StudioDelayMode } from '../JourneyStepStudio';
import { useToast } from '../../ToastProvider';
import { stepChannelLabel } from '../../../utils/journey-labels';
import { countText, type MapJourney, type MapStep } from '../../../utils/journey-map';

interface Props {
  journey: MapJourney | null;
  step: MapStep | null;
  generatedAt: string;
  onClose: () => void;
  onOpenJourney: (id: string) => void;
  onNewVersion: (journey: MapJourney) => void;
  onSaved: () => void;
}

interface RawStep {
  id: string;
  step_order: number;
  step_type: string;
  channel: string | null;
  message_template: string | null;
  subject: string | null;
  is_ad: boolean | null;
  delay_hours: number | null;
  delay_mode: string | null;
  target_hour_kst: number | null;
  mms_image_paths: string[] | null;
  wait_event_name?: string | null;
}

const STUDIO_CHANNELS = ['sms', 'lms', 'mms'];
const timeText = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function toStudio(r: RawStep): StudioStep {
  return {
    stepOrder: r.step_order,
    channel: String(r.channel || 'lms'),
    messageTemplate: String(r.message_template || ''),
    subject: r.subject || '',
    isAd: r.is_ad !== false,
    delayHours: Number(r.delay_hours || 0),
    delayMode: (r.delay_mode || 'relative') as StudioDelayMode,
    targetHourKst: r.target_hour_kst ?? undefined,
    mmsImagePaths: r.mms_image_paths || [],
  };
}

/** 바뀐 키만 — 묶음(문안 · 간격 · 구조)별로 서버 정책이 판정한다. */
function diffPatch(a: StudioStep, b: StudioStep): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (a.messageTemplate !== b.messageTemplate) out.messageTemplate = b.messageTemplate;
  if ((a.subject || '') !== (b.subject || '')) out.subject = b.subject || '';
  if (a.channel !== b.channel) out.channel = b.channel;
  if (JSON.stringify(a.mmsImagePaths || []) !== JSON.stringify(b.mmsImagePaths || [])) out.mmsImagePaths = b.mmsImagePaths || [];
  if (a.delayHours !== b.delayHours) out.delayHours = b.delayHours;
  if ((a.delayMode || 'relative') !== (b.delayMode || 'relative')) out.delayMode = b.delayMode || 'relative';
  if ((a.targetHourKst ?? null) !== (b.targetHourKst ?? null) && b.targetHourKst != null) out.targetHourKst = b.targetHourKst;
  return out;
}

export default function MapStepEditModal({ journey, step, generatedAt, onClose, onOpenJourney, onNewVersion, onSaved }: Props) {
  const toast = useToast();
  const open = !!journey && !!step;
  const [raw, setRaw] = useState<RawStep[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioStep | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);
  // 지금 고치는 칸(늦게 온 AI 응답이 다른 칸에 들어가지 않게 · Codex 1R high)
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const load = useCallback(async (jid: string) => {
    setLoadError(null);
    try {
      const r = await fetch(`/api/ai/operator/journeys/${jid}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) throw new Error(d?.error || '여정을 불러오지 못했어요.');
      setRaw(Array.isArray(d.steps) ? d.steps : []);
    } catch (e: any) {
      setLoadError(e?.message || '여정을 불러오지 못했어요.');
      setRaw([]);
    }
  }, []);

  useEffect(() => {
    if (!journey || !step) return;
    setRaw(null);
    setSelected(step.stepId);
    setConfirmActive(false);
    setUndo(null);
    void load(journey.id);
  }, [journey, step, load]);

  const rawSel = useMemo(() => (raw || []).find((r) => String(r.id) === selected) || null, [raw, selected]);
  const mapSel = useMemo(() => journey?.steps.find((s) => s.stepId === selected) || null, [journey, selected]);
  const original = useMemo(() => (rawSel ? toStudio(rawSel) : null), [rawSel]);

  useEffect(() => { setDraft(original); setConfirmActive(false); setUndo(null); }, [original]);

  if (!journey || !step) return null;
  const edit = journey.edit;
  const editable = !!rawSel && rawSel.step_type === 'message' && STUDIO_CHANNELS.includes(String(rawSel.channel || '').toLowerCase()) && edit.copy;
  const patch = original && draft ? diffPatch(original, draft) : {};
  const dirty = Object.keys(patch).length > 0;
  const timingChanged = ['delayHours', 'delayMode', 'targetHourKst'].some((k) => k in patch);
  const isActive = journey.status === 'active';

  const hoursFromStart = (() => {
    if (!raw || !rawSel) return 0;
    return raw.filter((r) => r.step_order <= rawSel.step_order).reduce((s, r) => s + Number(r.delay_hours || 0), 0);
  })();

  /** 칸 이동 — 요청 중 · 저장 중 · 저장하지 않은 고친 내용이 있으면 옮기지 않는다(고친 내용이 다른 칸에 저장되거나 사라지지 않게). */
  const pickStep = (id: string) => {
    if (id === selected) return;
    if (aiBusy || saving) { toast.warning('AI 다듬기나 저장이 끝난 뒤 옮겨 주세요.'); return; }
    if (dirty) { toast.warning('저장하지 않은 고친 내용이 있어요. 저장하거나 되돌린 뒤 옮겨 주세요.'); return; }
    setSelected(id);
  };

  const runAi = async () => {
    if (!draft || !raw || !rawSel) return;
    const forStep = String(rawSel.id);
    setAiBusy(true);
    try {
      const prev = raw.filter((r) => r.step_order < rawSel.step_order && r.step_type === 'message');
      let acc = 0;
      const prevMsgs = raw.filter((r) => r.step_order < rawSel.step_order).map((r) => { acc += Number(r.delay_hours || 0); return { r, h: acc }; })
        .filter(({ r }) => prev.includes(r) && String(r.message_template || '').trim())
        .map(({ r, h }) => ({ stepOrder: r.step_order, hoursFromTrigger: h, message: String(r.message_template || '').trim() }));
      const res = await fetch('/api/ai/operator/journeys-refine-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          message: draft.messageTemplate,
          channel: draft.channel,
          isAd: draft.isAd,
          journey: { triggerLabel: journey.triggerLabel, objective: journey.name, stepOrder: rawSel.step_order, hoursFromTrigger: hoursFromStart, previousMessages: prevMsgs },
          variants: 1,
        }),
      });
      const d = await res.json().catch(() => ({}));
      const next = d?.candidates?.[0]?.message;
      if (!res.ok || !d?.success || !next) throw new Error(d?.error || 'AI 다듬기를 받지 못했어요.');
      if (selectedRef.current !== forStep) { toast.warning('다른 칸으로 옮겨 다듬은 문안을 넣지 않았어요.'); return; }
      setUndo(draft.messageTemplate);
      setDraft((cur) => (cur && selectedRef.current === forStep ? { ...cur, messageTemplate: String(next) } : cur));
      toast.success('AI 가 다듬은 문안을 넣었어요. 저장해야 반영돼요.');
    } catch (e: any) {
      toast.error(e?.message || 'AI 다듬기를 받지 못했어요.');
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!draft || !rawSel || !dirty) return;
    if (isActive && !confirmActive) { setConfirmActive(true); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = isActive
        ? { ...(patch.messageTemplate !== undefined ? { messageTemplate: patch.messageTemplate } : {}), ...(patch.subject !== undefined ? { subject: patch.subject } : {}), allowActiveMessageEdit: true }
        : patch;
      const res = await fetch(`/api/ai/operator/journeys/${journey.id}/steps/${rawSel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) throw new Error(d?.error || '저장하지 못했어요.');
      toast.success(isActive ? '문안을 바꿨어요. 발송 2시간 전에 다시 검사합니다.' : '저장했어요. 켜기 전 점검을 다시 받아야 해요.');
      setConfirmActive(false);
      await load(journey.id);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const Kind = ({ s }: { s: MapStep }) => {
    const Icon = s.kind === 'wait' ? Hourglass : s.kind === 'condition' ? GitBranch : MessageSquare;
    return <Icon className="w-3.5 h-3.5 shrink-0" />;
  };
  const stepTitle = (s: MapStep) => (s.kind === 'message' ? `${s.order}번째 문자 · ${stepChannelLabel(s.channel)}` : s.kind === 'condition' ? `${s.order}번째 · 조건` : s.kind === 'wait' ? `${s.order}번째 · 기다림` : `${s.order}번째 칸`);

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="jmap-edit-title" panelClassName="w-full max-w-5xl md:h-[88vh]">
      <div className="flex min-h-0 flex-1 flex-col text-slate-900">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <h2 id="jmap-edit-title" className="text-[15px] font-semibold truncate">{journey.name}</h2>
            <p className="mt-0.5 text-[12px] text-slate-500 truncate">{journey.triggerLabel} 때 시작 · {mapSel ? stepTitle(mapSel) : ''}</p>
          </div>
          <button type="button" onClick={() => onOpenJourney(journey.id)} className="hidden md:inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-slate-600 border border-slate-200 hover:bg-slate-50">
            <ExternalLink className="w-3.5 h-3.5" /> 여정 자세히 보기
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>

        {/* 모바일 칸 번호 줄 */}
        <div className="md:hidden flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-slate-200">
          {journey.steps.map((s) => (
            <button key={s.stepId} type="button" onClick={() => pickStep(s.stepId)}
              className={`shrink-0 h-8 px-3 rounded-full text-[12px] ${selected === s.stepId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {s.order}번째
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 미니 척추 */}
          <nav className="hidden md:block w-[232px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/60 px-3 py-4" aria-label="이 여정의 칸">
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 truncate">{journey.triggerLabel} 때 시작</div>
            <ol className="mt-1 space-y-1">
              {journey.steps.map((s) => (
                <li key={s.stepId}>
                  <div className="pl-4 py-0.5 text-[11px] text-slate-400">↓ {s.intervalLabel}</div>
                  <button type="button" onClick={() => pickStep(s.stepId)}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 transition ${selected === s.stepId ? 'border-indigo-300 bg-white shadow-sm ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-800">
                      <Kind s={s} /><span className="truncate">{stepTitle(s)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{s.timingLabel}</div>
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex items-center gap-1.5 pl-1 text-[11px] text-slate-500"><Flag className="w-3 h-3" />{journey.endNote}</div>
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* 숫자판 */}
            {mapSel && (
              <div className="px-5 pt-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">지금 이 칸 차례</div>
                    <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-slate-900">{mapSel.waitingHere.toLocaleString('ko-KR')}<span className="ml-0.5 text-[12px] font-normal text-slate-500">명</span></div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">이 칸 뒤 {journey.goalLabel}</div>
                    <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-emerald-700">{mapSel.exitsAfter == null ? <span className="text-[13px] font-normal text-slate-500">{journey.goalExitEnabled ? '출구 자리 아님' : '자동 종료 꺼짐'}</span> : countText(mapSel.exitsAfter)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">이 칸을 받은 고객</div>
                    <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-slate-900">{mapSel.outOfWindow ? <span className="text-[13px] font-normal text-slate-500">측정 창 밖</span> : countText(mapSel.reached, '0')}</div>
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] italic text-slate-400">Data source: 여정 진행 기록 · 최근 {journey.windowDays}일 들어온 고객 · {timeText(generatedAt)} 기준</p>
              </div>
            )}

            <div className="px-5 pt-3 pb-5">
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                <span>{edit.reason}</span>
              </div>

              {raw === null ? (
                <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />칸을 불러오는 중</div>
              ) : loadError ? (
                <div className="py-10 text-center text-[12px] text-rose-700">{loadError}</div>
              ) : editable && draft ? (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <JourneyStepStudio
                    steps={[draft]}
                    index={0}
                    onIndex={() => undefined}
                    onPatch={(_i, p) => setDraft((cur) => (cur ? { ...cur, ...p } : cur))}
                    onSave={() => void save()}
                    onAi={() => void runAi()}
                    aiBusy={aiBusy}
                    saving={saving}
                    maxSteps={1}
                    triggerLabel={journey.triggerLabel}
                    single
                    bare
                    stacked
                    lockChannel={!edit.structure}
                    lockTiming={!edit.timing}
                  />
                </div>
              ) : rawSel ? (
                <div className="space-y-3">
                  {rawSel.step_type === 'message' ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {rawSel.subject && <div className="text-[13px] font-semibold mb-1.5">{rawSel.subject}</div>}
                      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-slate-700">{rawSel.message_template || '문안이 비어 있어요.'}</pre>
                      <p className="mt-2 text-[11px] text-slate-500">{stepChannelLabel(rawSel.channel)} 칸은 여정 자세히 보기에서 고쳐요.</p>
                    </div>
                  ) : rawSel.step_type === 'wait' ? (
                    <p className="text-[13px] leading-relaxed text-slate-600">{rawSel.wait_event_name ? '정한 행동이 일어나면 바로 다음 칸으로, 늦어도 정한 시간이 지나면 다음 칸으로 넘어갑니다.' : '정한 시간만큼 기다린 뒤 다음 칸으로 넘어갑니다.'}</p>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-slate-600">조건에 맞는지 보고 갈래를 나눕니다. 조건은 여정 자세히 보기에서 고쳐요.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* 바닥 줄 */}
        <div className="border-t border-slate-200 px-5 py-3">
          {confirmActive && (
            <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>켜진 여정의 문안을 바꿉니다. 다음 발송부터 바뀐 문안이 나가고, 발송 2시간 전에 스팸 검사를 다시 합니다. 이미 이 칸 차례가 된 고객은 검사 전에 바뀐 문안을 받을 수 있어요. 검사에 걸리면 자동으로 고쳐 쓰고(1크레딧) 그래도 걸리면 여정이 자동으로 멈춥니다.</span>
            </div>
          )}
          {timingChanged && journey.status === 'paused' && journey.counts.inProgress > 0 && (
            <p className="mb-2 text-[12px] text-slate-500">이미 다음 발송 시각이 잡힌 고객은 그 시각 그대로 받아요. 바뀐 간격은 이 칸 차례가 아직 안 잡힌 고객부터 적용됩니다.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {undo != null && (
              <button type="button" onClick={() => { if (draft) setDraft({ ...draft, messageTemplate: undo }); setUndo(null); }} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-[12px] text-slate-600 border border-slate-200 hover:bg-slate-50">
                <Undo2 className="w-3.5 h-3.5" /> AI 다듬기 전으로
              </button>
            )}
            {journey.canNewVersion && !edit.structure && (
              <button type="button" onClick={() => { onClose(); onNewVersion(journey); }} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-[12px] text-slate-700 border border-slate-200 hover:bg-slate-50">
                <Copy className="w-3.5 h-3.5" /> 새 판으로 고치기
              </button>
            )}
            <span className="flex-1" />
            {confirmActive && (
              <button type="button" onClick={() => setConfirmActive(false)} className="h-9 px-3 rounded-lg text-[12px] text-slate-600 border border-slate-200 hover:bg-slate-50">취소</button>
            )}
            {editable && (
              <button type="button" onClick={() => void save()} disabled={!dirty || saving}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {confirmActive ? '그대로 저장' : '이 칸 저장'}
              </button>
            )}
            {!editable && (
              <button type="button" onClick={() => onOpenJourney(journey.id)} className="inline-flex items-center gap-1 h-9 px-4 rounded-lg text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800">
                <ExternalLink className="w-3.5 h-3.5" /> 여정 자세히 보기
              </button>
            )}
          </div>
        </div>
      </div>
    </JourneyModalShell>
  );
}
