/**
 * JourneyWorkspace — 여정 작업 화면 한 벌 (★ 2026-10-20 여정 V.3 §9 · 옛 상세 창 · 지도 칸 편집 창 · 지도 [자세히] 대체)
 *
 * 목록 카드 · 지도 카드 · 칸 점 어디서 눌러도 이 창이 열린다(주소 ?journey=ID&step=ID · 부모 화면 스크롤 유지).
 *   머리 = 이름 · 상태 · [멈추기 | 다시 켜기 | 켜기] · ⋯(진입 고객 · 정지 이력 · 켜기 전 미리 보기 · 끝내기 · 보관)
 *   숫자 = 서버 지도 응답(진행 중 · 최근 W일 들어옴 · 목표로 마침 · 지난 30일 운영 크레딧) + 멈춘 이유 한 줄과 고치기
 *   왼쪽 레일 = [시작] + 칸마다(채널 · 간격 · 지금 기다리는 사람 · 기다린 날) + [칸 넣기] · [AI 다음 칸 추천]
 *   가운데 = 큰 휴대폰(JourneyStepStudio 한 칸 모드) · 오른쪽 = 도구(보낼 때 · 넣기 · AI · 검사 · A/B · 담당자 알림 · 진단)
 *   바닥 = 확정 바 [고친 곳 N개 저장] + 언제부터 · 누구에게 · 추가 크레딧 0 한 줄
 *
 * 저장 규칙(서버가 정한 것을 따른다 · 화면이 새로 판정하지 않는다)
 *   - 칸 = 서버 편집 정책(지도 응답 edit · 칸 PATCH 게이트와 같은 함수)이 허용한 묶음은 그 자리에서 PATCH.
 *   - 켜진 여정의 칸 모양(채널 · 광고 · 이미지 · 칸 넣기 · 빼기) · 목표 끄기 · 목표 종류 = 새 모양(POST reshape · 복제 → 적용 → 사전검사 → 켜기 한 흐름).
 *     한 단계 확인(결과가 갈리는 갈림길) 뒤 긴 작업이라 화면을 막고 기다린다. 성공하면 새 판 id 로 옮겨 연다.
 *   - 옵션 = 옵션 주소(그 자리) · 409 겹침은 같은 바에서 고른다 · 인원 미리 세기 = dryRun(실발송과 같은 추출 함수).
 * ⛔ 「새 판」이라는 말을 쓰지 않는다 · 모델명 0 · 네이티브 확인 창 0 · 내부 코드 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Beaker, ExternalLink, Flag, GitBranch, Hourglass, Loader2, MessageSquare, Pause, Play, Plus,
  Power, Save, Sparkles, Trash2, Undo2, X,
} from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import JourneyStepStudio, { type StudioStep, type StudioDelayMode } from '../JourneyStepStudio';
import JourneyVariantsEditor from '../JourneyVariantsEditor';
import JourneyStepNotifyToggle from '../JourneyStepNotifyToggle';
import JourneyPauseLogsModal from '../JourneyPauseLogsModal';
import JourneyActionConfirmModal, { type JourneyActionMode } from '../JourneyActionConfirmModal';
import SpamFilterTestModal from '../../SpamFilterTestModal';
import ConfirmModal, { type ConfirmState } from '../../ConfirmModal';
import { ZoneMoreMenu } from '../../zone/ZoneHeader';
import { zoneBand } from '../../zone/zone-color';
import { useToast } from '../../ToastProvider';
import JourneyStartCard, { type EntryCount } from './JourneyStartCard';
import { formFromJourney, optionsDiff, entryCountBody, hasIncompleteCondition, rebaseForm, shapeOptionKeys as shapeOptionKeysOf, ENTRY_FORM_KEYS, type OptionForm } from '../../../utils/journey-start-form';
import { useJourneyActions } from './useJourneyActions';
import { CREDIT_EDIT_FREE } from '../../../utils/journey-credit-copy';
import { stepChannelLabel, formatDelayAfter } from '../../../utils/journey-labels';
import { buildAdMessageFront, buildAdSubjectFront, LMS_SUBJECT_MAX_CHARS } from '../../../utils/formatDate';
import { STATUS_META, countText, type LifecycleMapData, type MapJourney, type StepEditPolicy } from '../../../utils/journey-map';
import { JOURNEY_STATUS_LABEL } from '../../../utils/journey-row-actions';
import { TRIGGER_EVENTS } from '../../../utils/journey-trigger-catalog';

interface Props {
  journeyId: string | null;
  stepId?: string | null;
  /** 지도에서 열면 지도 응답(같은 서버 진실 · 다시 읽지 않는다). 없으면 창이 읽는다. */
  map?: LifecycleMapData | null;
  onClose: () => void;
  /** 저장 · 켜기 · 멈추기 뒤 부모 목록 · 지도를 다시 읽는다. */
  onChanged: () => void;
  /** 칸 이동 · 새 모양 뒤 새 id → 부모가 주소(?journey=&step=)를 바꾼다. */
  onNavigate: (journeyId: string, stepId: string | null) => void;
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
  notify_manager_on_pretest?: boolean | null;
  timingLabel?: string;
  conditionLabel?: string | null;
}

/** 새 칸(아직 서버에 없음). sent = 결과를 못 받은 넣기(넣기 전 서버 칸 id · 보낸 내용 지문) — 다음 저장 때 먼저 서버에서 찾는다(Codex 적대 B 2R). */
/** 새 칸 — clientId = 서버에 넣을 칸 id(화면이 만든다 · 다시 보내도 한 칸) · sent = 보냈는데 결과를 못 받음(확인 전까지 잠금). */
interface NewStep { tempId: string; clientId: string; step: StudioStep; sent?: boolean }

/** 칸 내용 지문(채널 · 간격 · 제목 · 문안) — 결과를 못 받은 넣기가 서버에 들어갔는지 칸 수가 아니라 내용으로 찾는다(다른 사람이 함께 칸을 넣어도 오판 없음). */
type Sel = 'start' | string;

const STUDIO_CHANNELS = ['sms', 'lms', 'mms'];
// 칸 묶음(서버 STEP_EDIT_KEYS 중 이 화면이 만지는 키) — 정책은 서버 응답(edit)이 정하고 화면은 묶음만 가른다.
const TIMING_KEYS = ['delayHours', 'delayMode', 'targetHourKst'];
const STRUCTURE_KEYS = ['channel', 'isAd', 'mmsImagePaths'];
const NEW_STEP_PREFIX = 'new:';

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

/** 바뀐 키만(칸 PATCH 몸통). */
function diffPatch(a: StudioStep, b: StudioStep): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (a.messageTemplate !== b.messageTemplate) out.messageTemplate = b.messageTemplate;
  if ((a.subject || '') !== (b.subject || '')) out.subject = b.subject || '';
  if (a.channel !== b.channel) out.channel = b.channel;
  if ((a.isAd !== false) !== (b.isAd !== false)) out.isAd = b.isAd !== false;
  if (JSON.stringify(a.mmsImagePaths || []) !== JSON.stringify(b.mmsImagePaths || [])) out.mmsImagePaths = b.mmsImagePaths || [];
  if (a.delayHours !== b.delayHours) out.delayHours = b.delayHours;
  if ((a.delayMode || 'relative') !== (b.delayMode || 'relative')) out.delayMode = b.delayMode || 'relative';
  if ((a.targetHourKst ?? null) !== (b.targetHourKst ?? null) && b.targetHourKst != null) out.targetHourKst = b.targetHourKst;
  return out;
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

function authJson(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}
async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.success === false) throw Object.assign(new Error(d?.error || '불러오지 못했어요.'), { code: d?.code });
  return d;
}
async function sendJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(url, { method, headers: authJson(), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data?.success !== false, status: r.status, data };
}

function stepTitle(r: { step_order: number; step_type: string; channel: string | null }): string {
  if (r.step_type === 'message') return `${r.step_order}번째 · ${stepChannelLabel(r.channel)}`;
  if (r.step_type === 'wait') return `${r.step_order}번째 · 기다림`;
  if (r.step_type === 'condition') return `${r.step_order}번째 · 조건`;
  return `${r.step_order}번째 칸`;
}

export default function JourneyWorkspace({ journeyId, stepId, map, onClose, onChanged, onNavigate }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const open = !!journeyId;

  const [detail, setDetail] = useState<{ journey: any; steps: RawStep[] } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [ownMap, setOwnMap] = useState<LifecycleMapData | null>(null);
  const [opt080, setOpt080] = useState('');
  const [decorateVars, setDecorateVars] = useState<Array<{ token: string; label: string }>>([]);
  const [live, setLive] = useState<any | null>(null);
  const [diag, setDiag] = useState<any | null>(null);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [selected, setSelected] = useState<Sel>('start');
  const selectedRef = useRef<Sel>('start');
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [drafts, setDrafts] = useState<Record<string, StudioStep>>({});
  const [newSteps, setNewSteps] = useState<NewStep[]>([]);
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set());
  const [initialForm, setInitialForm] = useState<OptionForm>({});
  const [form, setForm] = useState<OptionForm>({});
  const [count, setCount] = useState<EntryCount>({ loading: false, matched: null, cap: null, approximate: false, message: null });
  const initialFormRef = useRef(initialForm);
  initialFormRef.current = initialForm;
  const formRef = useRef(form);
  formRef.current = form;
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reshaping, setReshaping] = useState(false);
  const editLockRef = useRef(false);
  editLockRef.current = saving || reshaping;
  const [confirmShape, setConfirmShape] = useState(false);
  const [overlapAsk, setOverlapAsk] = useState<string[] | null>(null);
  const [variantsOpen, setVariantsOpen] = useState<string | null>(null);
  const [nextRec, setNextRec] = useState<{ loading: boolean; data: any | null }>({ loading: false, data: null });
  const [simOpen, setSimOpen] = useState(false);
  const [sim, setSim] = useState<{ loading: boolean; data: any | null; error: string | null }>({ loading: false, data: null, error: null });
  const [pauseLogsOpen, setPauseLogsOpen] = useState(false);
  const [actionMode, setActionMode] = useState<JourneyActionMode | null>(null);
  const [spamFor, setSpamFor] = useState<StudioStep | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const tempSeq = useRef(0);

  const mapData = map ?? ownMap;
  const mj: MapJourney | null = useMemo(() => mapData?.journeys.find((x) => x.id === journeyId) || null, [mapData, journeyId]);
  const journey = detail?.journey || null;
  /** 지금 여정의 상세가 도착했는가(다른 여정 응답 · 읽는 중이면 저장 안 함 · Codex 적대 B1). */
  const ready = !!detail && String(detail.journey?.id || '') === String(journeyId || '');
  const status: string = String(journey?.status || mj?.status || '');
  const isActive = status === 'active';
  const archived = !!journey?.archived_at;
  const locked = archived || status === 'ended' || !mj;
  const edit: StepEditPolicy = mj?.edit || { copy: false, timing: false, structure: false, ops: false, reason: '보관된 여정이에요. 복원한 뒤 고칠 수 있어요.' };
  const reshapeAllowed = isActive && mj?.startKind !== 'one_shot';
  const operationCost = mapData?.costs.operation ?? 10;
  const triggerLabel = mj?.triggerLabel || TRIGGER_EVENTS.find((t) => t.triggerEvent === journey?.trigger_event)?.label || '정한 사건';

  // ★ Codex 적대 B1 — 창은 계속 붙어 있어 A 를 닫고 B 를 열면 A 의 늦은 응답이 B 를 덮을 수 있었다. 요청 순번 + 지금 여정이 같을 때만 반영한다.
  const journeyIdRef = useRef<string | null>(journeyId);
  journeyIdRef.current = journeyId;
  const loadSeq = useRef(0);
  /**
   * 여정 읽기. open = 처음 열 때(고친 값까지 서버 값으로) · sync = 저장 일부 실패 · 멈추기 뒤(서버 기준만 갱신 · 아직 안 보낸 고친 값은 둔다 · Codex 적대 B4).
   */
  const load = useCallback(async (jid: string, withMap: boolean, mode: 'open' | 'sync' = 'open') => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current && jid === journeyIdRef.current;
    setLoadErr(null);
    try {
      const d = await getJson(`/api/ai/operator/journeys/${jid}`);
      if (!current()) return;
      const steps: RawStep[] = Array.isArray(d.steps) ? d.steps : [];
      setDetail({ journey: d.journey, steps });
      const f = formFromJourney(d.journey);
      if (mode === 'open') { setInitialForm(f); setForm(f); }
      else {
        // ★ Codex 적대 B 2R — 옛 sync 는 고친 폼 · 칸 초안을 통째로 두어 다른 사람이 바꾼 값까지 되돌릴 변경으로 만들었다.
        //   이전 기준(initialForm · 옛 칸) 대비 내가 실제로 바꾼 키만 새 서버 값 위에 얹는다. 이미 서버와 같으면(내가 저장한 값) 버린다.
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        const rebased = rebaseForm(initialFormRef.current, formRef.current, f);
        let conflicts = rebased.conflicts;
        setInitialForm(f);
        setForm(rebased.form);
        const newMap = new Map(steps.map((x) => [x.id, x] as const));
        const oldMap = rawMapRef.current;
        const nextDrafts: Record<string, StudioStep> = {};
        for (const [id, dr] of Object.entries(draftsRef.current)) {
          const nr = newMap.get(id);
          const or = oldMap.get(id);
          if (!nr || !or) continue;   // 서버에 없어진 칸(빼기 성공 · 결과를 못 받은 빼기)
          const os = toStudio(or);
          const ns = toStudio(nr);
          const merged: any = { ...ns };
          let any = false;
          for (const k of Object.keys(diffPatch(os, dr))) {
            if (same((dr as any)[k], (ns as any)[k])) continue;
            if (!same((os as any)[k], (ns as any)[k])) conflicts += 1;
            merged[k] = (dr as any)[k];
            any = true;
          }
          if (any) nextDrafts[id] = merged as StudioStep;
        }
        setDrafts(nextDrafts);
        const ids = new Set(steps.map((x) => x.id));
        setDeleteIds((m) => new Set([...m].filter((k) => ids.has(k))));
        // 결과를 못 받은 새 칸이 서버에 있으면(같은 칸 id) 대기 목록에서 빼고 그 칸으로 옮긴다.
        const landed = newStepsRef.current.filter((n) => ids.has(n.clientId));
        if (landed.length > 0) {
          setNewSteps((list) => list.filter((n) => !ids.has(n.clientId)));
          const sel = landed.find((n) => n.tempId === selectedRef.current);
          if (sel) setSelected(sel.clientId);
        }
        if (conflicts > 0) toastRef.current.warning(`다른 곳에서도 바뀐 곳 ${conflicts}군데는 내가 고친 값으로 남겨 뒀어요. 저장하면 내 값이 들어가요.`);
      }
    } catch (e: any) {
      if (current()) setLoadErr(e?.message || '여정을 불러오지 못했어요.');
    }
    const mine = () => jid === journeyIdRef.current;
    if (withMap) getJson('/api/ai/operator/journeys/lifecycle-map').then((m) => { if (mine()) setOwnMap(m.map || null); }).catch(() => undefined);
    getJson(`/api/ai/operator/journeys/${jid}/live-positions`).then((x) => { if (mine()) setLive(x.snapshot || null); }).catch(() => { if (mine()) setLive(null); });
    getJson(`/api/ai/operator/journeys/${jid}/step-diagnosis`).then((x) => { if (mine()) setDiag(x.diagnosis || null); }).catch(() => { if (mine()) setDiag(null); });
  }, []);

  // 창을 열 때 · 다른 여정으로 옮길 때 = 고친 값 전부 비우고 다시 읽는다.
  useEffect(() => {
    if (!journeyId) { loadSeq.current++; setDetail(null); return; }
    setDetail(null); setDrafts({}); setNewSteps([]); setDeleteIds(new Set()); setFailed({}); setUndo(null);
    setConfirmShape(false); setOverlapAsk(null); setVariantsOpen(null); setNextRec({ loading: false, data: null }); setSim({ loading: false, data: null, error: null });
    setCount({ loading: false, matched: null, cap: null, approximate: false, message: null });
    void load(journeyId, !map);
  }, [journeyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 회사 단위 값(080 · 꾸미기 칸)은 한 번만.
  useEffect(() => {
    if (!open) return;
    getJson('/api/ai/operator/journeys-callback-numbers').then((cd) => setOpt080(cd.opt080Number || '')).catch(() => undefined);
    getJson('/api/ai/operator/data-profile').then((dp) => {
      setDecorateVars((dp.safeFields || []).map((f: any) => ({ token: String(f.percentVar || f.label || '').trim(), label: String(f.label || f.percentVar || '').trim() })).filter((v: any) => v.token));
    }).catch(() => undefined);
  }, [open]);

  // 처음 고를 칸 = 주소의 칸 · 없으면 첫 문자 칸 · 칸이 없으면 시작.
  useEffect(() => {
    if (!detail) return;
    const has = stepId && detail.steps.some((s) => s.id === stepId);
    if (has) { setSelected(stepId!); return; }
    if (selectedRef.current !== 'start' && (detail.steps.some((s) => s.id === selectedRef.current) || selectedRef.current.startsWith(NEW_STEP_PREFIX))) return;
    const first = detail.steps.find((s) => s.step_type === 'message');
    setSelected(first ? first.id : 'start');
  }, [detail, stepId]);

  const rawById = useMemo(() => new Map((detail?.steps || []).map((s) => [s.id, s] as const)), [detail]);
  const rawMapRef = useRef(rawById);
  rawMapRef.current = rawById;
  const originalOf = (id: string) => { const r = rawById.get(id); return r ? toStudio(r) : null; };
  const currentOf = (id: string): StudioStep | null => {
    if (id.startsWith(NEW_STEP_PREFIX)) return newSteps.find((n) => n.tempId === id)?.step || null;
    return drafts[id] || originalOf(id);
  };
  const patchOf = (id: string) => { const o = originalOf(id); const d = drafts[id]; return o && d ? diffPatch(o, d) : {}; };
  const dirtyIds = Object.keys(drafts).filter((id) => Object.keys(patchOf(id)).length > 0);
  const optDiff = useMemo(() => optionsDiff(initialForm, form), [initialForm, form]);
  const optDirty = Object.keys(optDiff).length > 0;
  const dirtyCount = dirtyIds.length + newSteps.length + deleteIds.size + (optDirty ? 1 : 0);

  /** 켜진 여정에서 새 모양이 필요한 변경인가(서버 편집 정책 응답 · 옵션 판정과 같은 집합). */
  // 새 모양으로만 바뀌는 여정 옵션(서버 journeyOptionEditVerdict 와 같은 판정 · 짝 시험이 고정).
  const shapeOptionKeys = shapeOptionKeysOf(status, optDiff);
  const shapeStepIds = isActive ? dirtyIds.filter((id) => {
    const p = patchOf(id);
    return Object.keys(p).some((k) => (STRUCTURE_KEYS.includes(k) && !edit.structure) || (TIMING_KEYS.includes(k) && !edit.timing));
  }) : [];
  const needsShape = isActive && (shapeStepIds.length > 0 || newSteps.length > 0 || deleteIds.size > 0 || shapeOptionKeys.length > 0);

  // ── 인원 미리 세기(시작 조건) ──
  const countSeq = useRef(0);
  const runCount = useCallback(async () => {
    if (!journeyId || locked) return;
    if (hasIncompleteCondition(form)) { setCount({ loading: false, matched: null, cap: null, approximate: false, message: '조건 값을 채우면 인원을 셀게요.' }); return; }
    const seq = ++countSeq.current;
    setCount((c) => ({ ...c, loading: true, message: null }));
    const r = await sendJson(`/api/ai/operator/journeys/${journeyId}/options`, 'PATCH', entryCountBody(form)).catch(() => null);
    if (seq !== countSeq.current) return;
    if (r?.ok) setCount({ loading: false, matched: r.data.matched ?? null, cap: r.data.cap ?? null, approximate: r.data.approximate === true, message: null });
    else setCount({ loading: false, matched: null, cap: null, approximate: false, message: r?.data?.error || '인원을 세지 못했어요.' });
  }, [journeyId, form, locked]);
  // 시작 조건을 바꾸면 잠시 뒤 다시 센다(고른 즉시 「지금 맞는 N명」 · 상시 · 휴면은 처음 열 때도).
  const entryKey = JSON.stringify(Object.fromEntries(Object.entries(form).filter(([k]) => ENTRY_FORM_KEYS.has(k))));
  const firstCountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || selected !== 'start') return;
    const standing = ['custom', 'customer.dormant'].includes(String(detail.journey?.trigger_event));
    const touched = Object.keys(optDiff).some((k) => ENTRY_FORM_KEYS.has(k));
    if (!touched && !(standing && firstCountRef.current !== journeyId)) return;
    firstCountRef.current = journeyId;
    const t = window.setTimeout(() => { void runCount(); }, 600);
    return () => window.clearTimeout(t);
  }, [entryKey, selected, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 칸 이동 · 편집 ──
  const pickStep = (id: Sel) => {
    if (id === selected) return;
    if (aiBusy) { toast.warning('AI 다듬기가 끝난 뒤 옮겨 주세요.'); return; }
    setSelected(id);
    setVariantsOpen(null);
    if (journeyId && id !== 'start' && !id.startsWith(NEW_STEP_PREFIX)) onNavigate(journeyId, id);
  };
  /** 칸 고친 값 — 함수형 갱신으로 최신 고친 값 위에 합친다(늦게 온 응답이 그사이 고친 제목 · 간격을 되돌리지 않게 · Codex 적대 B6). */
  const patchStep = (id: string, p: Partial<StudioStep>) => {
    if (id === 'start' || editLockRef.current) return;
    if (id.startsWith(NEW_STEP_PREFIX)) { setNewSteps((list) => list.map((n) => (n.tempId === id && !n.sent ? { ...n, step: { ...n.step, ...p } } : n))); return; }
    setDrafts((d) => {
      const base = d[id] || originalOf(id);
      return base ? { ...d, [id]: { ...base, ...p } } : d;
    });
    setFailed((f) => { if (!f[id]) return f; const n = { ...f }; delete n[id]; return n; });
  };
  const patchSelected = (p: Partial<StudioStep>) => patchStep(selected, p);
  // 지금 본문(렌더 사이 최신 값) — AI 응답을 넣기 전에 요청 때 본문과 같은지 본다.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const newStepsRef = useRef(newSteps);
  newStepsRef.current = newSteps;
  const bodyNow = (id: string): string | null => {
    if (id.startsWith(NEW_STEP_PREFIX)) return newStepsRef.current.find((n) => n.tempId === id)?.step.messageTemplate ?? null;
    return (draftsRef.current[id] || originalOf(id))?.messageTemplate ?? null;
  };
  const applyAiBody = (id: string, sentBody: string, next: string, okText: string) => {
    if (selectedRef.current !== id) { toast.warning('다른 칸으로 옮겨 AI 문안을 넣지 않았어요.'); return; }
    if (bodyNow(id) !== sentBody) { toast.warning('AI가 다듬는 동안 문안을 고쳐서 넣지 않았어요. 다시 눌러 주세요.'); return; }
    setUndo({ id, text: sentBody });
    patchStep(id, { messageTemplate: next });
    toast.success(okText);
  };

  const addStep = (seed?: Partial<StudioStep>) => {
    if (editLockRef.current) return;
    const steps = detail?.steps || [];
    const order = steps.length - deleteIds.size + newSteps.length + 1;
    const tempId = `${NEW_STEP_PREFIX}${++tempSeq.current}`;
    const step: StudioStep = {
      stepOrder: order, channel: 'lms', messageTemplate: '', subject: String(journey?.name || '').slice(0, LMS_SUBJECT_MAX_CHARS), isAd: true,
      delayHours: 72, delayMode: 'relative', mmsImagePaths: [], ...seed,
    };
    setNewSteps((list) => [...list, { tempId, clientId: crypto.randomUUID(), step }]);
    setSelected(tempId);
  };
  const toggleDelete = (id: string) => {
    if (editLockRef.current) return;
    if (id.startsWith(NEW_STEP_PREFIX)) {
      setNewSteps((list) => list.filter((n) => n.tempId !== id));
      setSelected('start');
      return;
    }
    setDeleteIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const discardAll = () => {
    setDrafts({}); setNewSteps([]); setDeleteIds(new Set()); setForm(initialForm); setFailed({}); setUndo(null); setConfirmShape(false); setOverlapAsk(null);
    if (selected.startsWith(NEW_STEP_PREFIX)) setSelected('start');
  };

  // ── AI 다듬기 · 꾸미기 ──
  const hoursFromStart = (id: string): number => {
    const target = currentOf(id);
    if (!target) return 0;
    return (detail?.steps || []).filter((r) => r.step_order <= target.stepOrder).reduce((s, r) => s + Number((currentOf(r.id) || toStudio(r)).delayHours || 0), 0);
  };
  const runAi = async () => {
    const id = selected;
    const cur = id === 'start' ? null : currentOf(id);
    if (!cur) return;
    setAiBusy(true);
    try {
      let acc = 0;
      const prevMsgs = (detail?.steps || [])
        .filter((r) => r.step_order < cur.stepOrder)
        .map((r) => { const s = currentOf(r.id) || toStudio(r); acc += Number(s.delayHours || 0); return { r, s, h: acc }; })
        .filter(({ r, s }) => r.step_type === 'message' && s.messageTemplate.trim())
        .map(({ s, h }) => ({ stepOrder: s.stepOrder, hoursFromTrigger: h, message: s.messageTemplate.trim() }));
      const r = await sendJson('/api/ai/operator/journeys-refine-step', 'POST', {
        message: cur.messageTemplate, channel: cur.channel, isAd: cur.isAd,
        journey: { triggerLabel, objective: journey?.name, stepOrder: cur.stepOrder, hoursFromTrigger: hoursFromStart(id), previousMessages: prevMsgs },
        variants: 1,
      });
      const next = r.data?.candidates?.[0]?.message;
      if (!r.ok || !next) throw new Error(r.data?.error || 'AI 다듬기를 받지 못했어요.');
      applyAiBody(id, cur.messageTemplate, String(next), 'AI가 다듬은 문안을 넣었어요. 저장해야 반영돼요.');
    } catch (e: any) {
      toast.error(e?.message || 'AI 다듬기를 받지 못했어요.');
    } finally {
      setAiBusy(false);
    }
  };
  const runDecorate = async (tokens: string[]) => {
    const id = selected;
    const cur = id === 'start' ? null : currentOf(id);
    if (!cur) return;
    if (cur.messageTemplate.trim().length < 5) { toast.warning('꾸밀 문안을 먼저 써 주세요. AI 문안생성을 눌러도 돼요.'); return; }
    setAiBusy(true);
    try {
      const r = await sendJson('/api/ai/operator/decorate-message', 'POST', { message: cur.messageTemplate, selectedVars: tokens, channel: cur.channel, isAd: cur.isAd !== false });
      if (!r.ok || !r.data?.message) throw new Error(r.data?.error || 'AI 꾸미기를 받지 못했어요.');
      applyAiBody(id, cur.messageTemplate, String(r.data.message), '고객 정보를 문안에 녹였어요. 저장해야 반영돼요.');
    } catch (e: any) {
      toast.error(e?.message || 'AI 꾸미기를 받지 못했어요.');
    } finally {
      setAiBusy(false);
    }
  };

  // ── 저장 ──
  const afterSaved = async (jid: string) => {
    setDrafts({}); setNewSteps([]); setDeleteIds(new Set()); setFailed({}); setUndo(null); setConfirmShape(false); setOverlapAsk(null);
    await load(jid, !map);
    onChanged();
  };

  const saveOptions = async (body: Record<string, any>, acks?: string[]): Promise<'ok' | 'overlap' | 'fail'> => {
    if (!journeyId || Object.keys(body).length === 0) return 'ok';
    const r = await sendJson(`/api/ai/operator/journeys/${journeyId}/options`, 'PATCH', acks ? { ...body, acknowledgedOverlaps: acks } : body);
    if (r.ok) return 'ok';
    if (r.data?.code === 'OVERLAP_UNRESOLVED' && Array.isArray(r.data.pairs)) { setOverlapAsk(r.data.pairs.map(String)); return 'overlap'; }
    toast.error(r.data?.error || '시작 설정을 저장하지 못했어요.');
    return 'fail';
  };

  const saveStepsInPlace = async (ids: string[]): Promise<boolean> => {
    if (!journeyId) return false;
    let allOk = true;
    for (const id of ids) {
      const p = omit(patchOf(id), isActive ? [...shapeOnlyKeys(id)] : []);
      if (Object.keys(p).length === 0) continue;
      const body = isActive && ('messageTemplate' in p || 'subject' in p) ? { ...p, allowActiveMessageEdit: true } : p;
      const r = await sendJson(`/api/ai/operator/journeys/${journeyId}/steps/${id}`, 'PATCH', body);
      if (!r.ok) { allOk = false; setFailed((f) => ({ ...f, [id]: r.data?.error || '저장하지 못했어요.' })); }
    }
    return allOk;
  };
  /** 켜진 여정에서 이 칸 수정 중 새 모양으로 가는 키. */
  function shapeOnlyKeys(id: string): string[] {
    const p = patchOf(id);
    return Object.keys(p).filter((k) => (STRUCTURE_KEYS.includes(k) && !edit.structure) || (TIMING_KEYS.includes(k) && !edit.timing));
  }

  const validateCopy = (): string | null => {
    const check = (s: StudioStep, label: string) => {
      if (!s.messageTemplate.trim()) return `${label} 문안이 비어 있어요.`;
      if (s.channel !== 'sms' && !(s.subject || '').trim()) return `${label} 제목을 써 주세요.`;
      if (s.channel !== 'sms' && (s.subject || '').length > LMS_SUBJECT_MAX_CHARS) return `${label} 제목이 ${LMS_SUBJECT_MAX_CHARS}자를 넘어요.`;
      if (s.channel === 'mms' && (s.mmsImagePaths?.length ?? 0) === 0) return `${label} 사진 문자에 사진이 없어요.`;
      return null;
    };
    for (const id of dirtyIds) { const s = drafts[id]; const e = s && check(s, `${s.stepOrder}번째 칸`); if (e) return e; }
    for (const n of newSteps) { const e = check(n.step, '새 칸'); if (e) return e; }
    return null;
  };

  const save = async (acks?: string[]) => {
    if (!journeyId || !ready || dirtyCount === 0 || saving) return;
    const bad = validateCopy();
    if (bad) { toast.warning(bad); return; }
    if (needsShape && !confirmShape) { setConfirmShape(true); return; }
    const jid = journeyId;
    // 저장하는 동안 화면을 막는다(그사이 고친 값이 「저장 완료」와 함께 사라지지 않게 · Codex 적대 B5).
    setSaving(true);
    try {
      // 1) 옵션(그 자리 키) — 새 모양 키는 새 모양 흐름이 가져간다.
      const inPlaceOpts = omit(optDiff, shapeOptionKeys);
      const o = await saveOptions(inPlaceOpts, acks);
      if (o === 'fail') { await load(jid, false, 'sync'); return; }
      if (o === 'overlap') return;
      // 2) 칸(그 자리 묶음) — 켜진 여정의 문안 · 간격도 진행 중 고객에게 다음 발송부터 바로 간다.
      const ok = await saveStepsInPlace(dirtyIds.filter((id) => !deleteIds.has(id)));
      if (!ok) { toast.error('저장하지 못한 칸이 있어요. 빨간 표시를 확인해 주세요.'); await load(jid, false, 'sync'); return; }
      if (needsShape) {
        // 3) 새 모양 — 복제 → 적용 → 사전검사 → 켜기(서버 한 흐름 · 실패하면 복제본을 지운다).
        await runReshape({
          stepPatches: shapeStepIds.filter((id) => !deleteIds.has(id)).map((id) => ({ order: rawById.get(id)!.step_order, patch: pick(patchOf(id), shapeOnlyKeys(id)) })),
          deleteOrders: Array.from(deleteIds).map((id) => rawById.get(id)!.step_order),
          addSteps: newSteps.map((n) => stepDefinition(n.step)),
          options: Object.keys(pick(optDiff, shapeOptionKeys)).length > 0 ? pick(optDiff, shapeOptionKeys) : undefined,
        }, false);
        return;
      }
      // 3') 초안 · 멈춤 = 칸 빼기 · 넣기를 그 자리에서(뒤 순번부터 · 서버가 순번을 다시 매긴다).
      //   한 건씩 성공하면 바로 대기 목록에서 지운다 → 중간에 실패해도 다시 저장할 때 같은 칸을 두 번 넣거나 빼지 않는다(Codex 적대 B2).
      for (const id of Array.from(deleteIds).sort((a, b) => rawById.get(b)!.step_order - rawById.get(a)!.step_order)) {
        const r = await sendJson(`/api/ai/operator/journeys/${jid}/steps/${id}`, 'DELETE').catch(() => null);
        if (!r?.ok) { toast.error(r?.data?.error || '칸을 빼지 못했어요. 지금 상태를 다시 읽었어요.'); await load(jid, false, 'sync'); return; }
        setDeleteIds((m) => { const n = new Set(m); n.delete(id); return n; });
      }
      const dropNew = (tempId: string) => setNewSteps((list) => list.filter((x) => x.tempId !== tempId));
      for (const n of newSteps) {
        // 화면이 만든 칸 id 로 넣는다 → 결과를 못 받은 넣기를 다시 보내도 서버가 같은 칸을 돌려준다(두 번 넣기 0 · Codex 적대 B 3R).
        const r = await sendJson(`/api/ai/operator/journeys/${jid}/steps`, 'POST', { ...stepDefinition(n.step), clientStepId: n.clientId }).catch(() => null);
        if (r?.ok) { dropNew(n.tempId); continue; }
        // 「넣지 않았다」가 확정인 응답 = 4xx 뿐(주소의 검사 · 게이트는 넣기 전에 되돌린다). 연결 끊김 · 5xx(게이트웨이 502 · 504 포함) = 결과 모름(Codex 적대 B 4R).
        //   결과 모름 = 그 칸을 잠근다 · 한 번 잠근 칸은 풀지 않는다(서버가 그 칸을 돌려주거나 · 다시 읽어 보이거나 · 사람이 지울 때까지).
        //   풀었다가 늦게 들어간 첫 요청이 확인되면 그 뒤 고친 값이 사라진다.
        if (!(r && r.status >= 400 && r.status < 500)) {
          setNewSteps((list) => list.map((x) => (x.tempId === n.tempId ? { ...x, sent: true } : x)));
          toast.error('칸을 넣었는지 확인하지 못했어요. 다시 저장하면 같은 칸으로 확인해요.');
          await load(jid, false, 'sync');
          return;
        }
        toast.error(r.data?.error || '칸을 넣지 못했어요. 지금 상태를 다시 읽었어요.');
        await load(jid, false, 'sync');
        return;
      }
      toast.success(isActive ? '저장했어요. 다음 발송부터 바뀌어요.' : status === 'draft' ? '저장했어요. 켜기 전에 점검을 받아요.' : '저장했어요.');
      await afterSaved(jid);
    } catch (e: any) {
      toast.error(e?.message || '저장하지 못했어요.');
      await load(jid, false, 'sync');
    } finally {
      setSaving(false);
    }
  };

  const stepDefinition = (s: StudioStep) => ({
    stepType: 'message', channel: s.channel, messageTemplate: s.messageTemplate, subject: s.channel === 'sms' ? undefined : s.subject,
    isAd: s.isAd !== false, delayHours: s.delayHours, delayMode: s.delayMode, targetHourKst: s.targetHourKst, mmsImagePaths: s.channel === 'mms' ? s.mmsImagePaths : undefined,
  });

  const runReshape = async (change: Record<string, unknown>, confirmCallbackExclusion: boolean) => {
    if (!journeyId) return;
    setReshaping(true);
    try {
      const r = await sendJson(`/api/ai/operator/journeys/${journeyId}/reshape`, 'POST', { ...change, confirmCallbackExclusion });
      if (r.ok && r.data?.journeyId) {
        toast.success('바뀐 모양으로 켰어요. 새로 들어오는 고객부터 받아요. 진행 중인 고객은 지금 모양 그대로 끝까지 받아요.');
        const nextId = String(r.data.journeyId);
        setDrafts({}); setNewSteps([]); setDeleteIds(new Set()); setConfirmShape(false);
        onChanged();
        onNavigate(nextId, null);
        return;
      }
      if (r.data?.callbackConfirmRequired) {
        setConfirm({
          mode: 'warning',
          title: '매장번호가 등록되지 않은 고객이 있어요',
          description: `${Number(r.data.callbackUnregisteredCount || 0).toLocaleString('ko-KR')}명은 매장번호가 발신번호로 등록되지 않아 발송이 실패해요. 그대로 바꿀까요?`,
          confirmLabel: '그대로 바꾸기',
          onConfirm: () => runReshape(change, true),
        });
        return;
      }
      toast.error(r.data?.error || '바뀐 모양으로 옮기지 못했어요.');
      await load(journeyId, false, 'sync');
    } catch {
      // 결과를 못 받았다(연결 끊김) — 부모 목록 · 지도를 다시 읽어 바뀐 모양이 켜졌는지 보이게 한다.
      toast.error('바뀐 모양으로 옮겼는지 확인하지 못했어요. 목록을 다시 읽었어요.');
      onChanged();
      await load(journeyId, false, 'sync');
    } finally {
      setReshaping(false);
    }
  };

  // ── 닫기 · 행동 ──
  const askClose = () => {
    if (saving || reshaping) return;
    if (dirtyCount === 0) { onClose(); return; }
    setConfirm({ mode: 'warning', title: '저장하지 않은 고친 곳이 있어요', description: `고친 곳 ${dirtyCount}개를 저장하지 않았어요. 닫으면 사라져요.`, confirmLabel: '버리고 닫기', onConfirm: () => { discardAll(); onClose(); } });
  };
  const actions = useJourneyActions({ onChanged: () => { if (journeyId) void load(journeyId, !map, 'sync'); onChanged(); }, operationCost });
  const actionJourney = mj ? { id: mj.id, name: mj.name, status: mj.status, goalExitEnabled: mj.goalExitEnabled, thresholdRecipients: mj.thresholdRecipients, activationCost: mj.activationCost, pause: mj.pause }
    : journey ? { id: String(journey.id), name: String(journey.name), status: String(journey.status), activationCost: Number(journey.activation_cost || 0), pause: journey.pause_view || null } : null;

  const runFix = (action: string) => {
    if (action === 'plan_upgrade' || action === 'charge') { navigate('/pricing'); return; }
    if (action === 'resume' && actionJourney) { actions.activate(actionJourney); return; }
    if (action === 'edit_options' || action === 'edit_callback') { pickStep('start'); return; }
    if (action === 'edit_step') { const first = detail?.steps.find((s) => s.step_type === 'message'); if (first) pickStep(first.id); return; }
  };

  const openSim = async () => {
    if (!journeyId) return;
    setSimOpen(true);
    if (sim.data || sim.loading) return;
    setSim({ loading: true, data: null, error: null });
    try { const d = await getJson(`/api/ai/operator/journeys/${journeyId}/simulate`); setSim({ loading: false, data: d.simulation || null, error: null }); }
    catch (e: any) { setSim({ loading: false, data: null, error: e?.message || '미리 보지 못했어요.' }); }
  };
  const loadNextRec = async () => {
    if (!journeyId || nextRec.loading) return;
    setNextRec({ loading: true, data: null });
    try { const d = await getJson(`/api/ai/operator/journeys/${journeyId}/recommend-next-step`); setNextRec({ loading: false, data: d.recommendation || null }); }
    catch (e: any) { toast.error(e?.message || '추천을 받지 못했어요.'); setNextRec({ loading: false, data: null }); }
  };
  const runAction = async () => {
    if (!journeyId || !actionMode) return;
    const mode = actionMode;
    const method = mode === 'delete' ? 'DELETE' : mode === 'end' ? 'POST' : 'PATCH';
    const r = await sendJson(`/api/ai/operator/journeys/${journeyId}${mode === 'delete' ? '' : `/${mode}`}`, method);
    if (!r.ok) { toast.error(r.data?.error || '처리하지 못했어요.'); return; }
    setActionMode(null);
    onChanged();
    if (mode === 'delete' || mode === 'archive') onClose(); else void load(journeyId, !map);
  };

  // ── 그림 재료 ──
  const mapStepById = useMemo(() => new Map((mj?.steps || []).map((s) => [s.stepId, s] as const)), [mj]);
  const liveById = useMemo(() => new Map(((live?.positions || []) as any[]).map((p) => [String(p.stepId), p] as const)), [live]);
  const diagById = useMemo(() => new Map(((diag?.steps || []) as any[]).map((s) => [String(s.stepId), s] as const)), [diag]);
  const olderActive = (mj?.olderVersions || []).reduce((s, v) => s + Number(v.activeNow || 0), 0);
  const selRaw = selected !== 'start' && !selected.startsWith(NEW_STEP_PREFIX) ? rawById.get(selected) || null : null;
  const selStudio = selected === 'start' ? null : currentOf(selected);
  const selNew = selected.startsWith(NEW_STEP_PREFIX) ? newSteps.find((n) => n.tempId === selected) || null : null;
  const selEditable = !locked && !!selStudio && (selNew ? !selNew.sent : (selRaw?.step_type === 'message' && STUDIO_CHANNELS.includes(String(selRaw?.channel || '').toLowerCase())));
  const selDeleting = !!selRaw && deleteIds.has(selRaw.id);
  const canShapeSteps = !locked && (edit.structure || reshapeAllowed);
  const statusMeta = STATUS_META[status] || STATUS_META.draft;

  const statCells: Array<{ label: string; value: string; tone?: string }> = mj ? [
    { label: '지금 진행 중', value: `${mj.counts.inProgress.toLocaleString('ko-KR')}명` },
    { label: `최근 ${mj.windowDays}일 들어옴`, value: countText(mj.counts.entered, '0명') + (mj.counts.entered ? '명' : '') },
    { label: `${mj.goalLabel}로 마침`, value: mj.goalExitEnabled ? countText(mj.counts.goalMet, '0명') + (mj.counts.goalMet ? '명' : '') : '목표 끔' },
    { label: '지난 30일 운영 크레딧', value: mj.operationCredits30d == null ? '세는 중' : `${mj.operationCredits30d.toLocaleString('ko-KR')}` },
  ] : [];

  const bottomLine = needsShape
    ? `칸 모양 · 목표를 바꾸면 새로 들어오는 고객부터 바뀐 모양으로 받아요. 지금 진행 중인 ${(mj?.counts.inProgress || 0).toLocaleString('ko-KR')}명은 지금 모양 그대로 끝까지 받아요. ${CREDIT_EDIT_FREE}`
    : `${edit.reason} ${CREDIT_EDIT_FREE}`;

  const menuItems = [
    { label: '진입 고객 보기', icon: ExternalLink, onClick: () => { if (journeyId) navigate(`/ai-journeys/${journeyId}`); } },
    { label: '정지 이력', onClick: () => setPauseLogsOpen(true) },
    ...(status === 'draft' || status === 'paused' ? [{ label: '켜면 어떻게 될지 미리 보기', onClick: () => void openSim() }] : []),
    ...(!archived && status !== 'ended' ? [{ label: '끝내기', onClick: () => setActionMode('end'), danger: true, divider: true }] : []),
    ...(!archived && status !== 'active' ? [{ label: '보관함으로', onClick: () => setActionMode('archive') }] : []),
  ];

  const blocking = reshaping || saving;
  // React 18 은 inert 를 모르는 속성으로 그대로 넘긴다(문자열 값) · 막는 동안만 붙인다.
  const inertProps: Record<string, string> = blocking ? { inert: '' } : {};

  return (
    <>
      <JourneyModalShell open={open} onClose={askClose} labelledBy="jws-title" panelClassName="w-full max-w-[1480px]" disableDismiss={dirtyCount > 0 || saving || reshaping} fullHeight>
        <div className="relative flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-900">
          {/* 머리 띠 */}
          <header {...inertProps} className="shrink-0 px-4 py-3.5 text-white md:px-6" style={{ background: zoneBand('journeys') }}>
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusMeta.dot}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 id="jws-title" className="truncate text-[17px] font-semibold">{journey?.name || mj?.name || '여정'}</h2>
                <p className="mt-0.5 truncate text-[12.5px] text-white/70">
                  {JOURNEY_STATUS_LABEL[status] || ''}{archived ? ' · 보관' : ''} · {triggerLabel} 때 시작{mj?.endNote ? ` · ${mj.endNote}` : ''}
                </p>
              </div>
              {actionJourney && !archived && status === 'active' && (
                <button type="button" onClick={() => void actions.pause(actionJourney)} disabled={actions.busyId === actionJourney.id}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/20 disabled:opacity-50">
                  {actions.busyId === actionJourney.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}멈추기
                </button>
              )}
              {actionJourney && !archived && (status === 'paused' || status === 'draft') && (
                <button type="button" onClick={() => { if (dirtyCount > 0) { toast.warning('고친 곳을 먼저 저장해 주세요.'); return; } actions.activate(actionJourney); }}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-slate-900 hover:bg-slate-100">
                  {status === 'paused' ? <Play className="h-4 w-4" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />}{status === 'paused' ? '다시 켜기' : '켜기'}
                </button>
              )}
              <ZoneMoreMenu items={menuItems} tone="dark" />
              <button type="button" onClick={askClose} aria-label="작업 화면 닫기" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* 숫자 · 상태 한 줄 */}
          {mj && (
            <div {...inertProps} className="shrink-0 border-b border-slate-200 bg-white">
              <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
                {statCells.map((c) => (
                  <div key={c.label} className="min-w-0 bg-white px-4 py-2.5 md:px-6">
                    <div className="truncate text-[12px] text-slate-500">{c.label}</div>
                    <div className="mt-0.5 truncate text-[18px] font-bold tabular-nums text-slate-900">{c.value}</div>
                  </div>
                ))}
              </div>
              {(mj.pause || olderActive > 0 || (mj.health.tone === 'fix' || mj.health.tone === 'blocked' || mj.health.tone === 'quiet')) && (
                <div className="space-y-1.5 border-t border-slate-100 px-4 py-2.5 md:px-6">
                  {mj.pause && (
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
                      <Pause className="h-3.5 w-3.5 text-slate-400" aria-hidden /><span className="min-w-0 flex-1">{mj.pause.text}</span>
                      {mj.pause.fix && <button type="button" onClick={() => runFix(mj.pause!.fix!.action)} className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-800 hover:border-indigo-200 hover:text-indigo-700">{mj.pause.fix.label}</button>}
                    </div>
                  )}
                  {!mj.pause && (mj.health.tone === 'fix' || mj.health.tone === 'blocked' || mj.health.tone === 'quiet') && (
                    <div className={`flex items-center gap-2 text-[13px] ${mj.health.tone === 'quiet' ? 'text-slate-600' : 'text-amber-900'}`}>
                      <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${mj.health.tone === 'quiet' ? 'text-slate-400' : 'text-amber-600'}`} aria-hidden />{mj.health.text}
                    </div>
                  )}
                  {olderActive > 0 && <p className="text-[12.5px] text-slate-500">옛 모양으로 마무리 중 {olderActive.toLocaleString('ko-KR')}명</p>}
                </div>
              )}
            </div>
          )}

          {/* 작업대 */}
          <div {...inertProps} className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* 칸 레일 */}
            <nav aria-label="여정 칸" className="shrink-0 border-b border-slate-200 bg-white md:w-[264px] md:overflow-y-auto md:border-b-0 md:border-r">
              {!detail && !loadErr && <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중</div>}
              {loadErr && (
                <div className="space-y-2 px-4 py-6 text-center text-[13px] text-rose-700">
                  <p>{loadErr}</p>
                  <button type="button" onClick={() => journeyId && void load(journeyId, !map)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700">다시 읽기</button>
                </div>
              )}
              {detail && (
                <ol className="flex gap-2 overflow-x-auto px-3 py-3 md:block md:space-y-1.5 md:overflow-visible md:px-3 md:py-4">
                  <li className="shrink-0 md:shrink">
                    <button type="button" onClick={() => pickStep('start')} aria-current={selected === 'start'}
                      className={`w-[180px] rounded-xl border px-3 py-2.5 text-left transition md:w-full ${selected === 'start' ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                        <Flag className="h-3.5 w-3.5 text-indigo-600" aria-hidden />시작
                        {optDirty && <span className="ml-auto h-2 w-2 rounded-full bg-indigo-500" aria-label="고침" />}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-slate-500">{triggerLabel} 때</div>
                      <div className="truncate text-[12px] text-slate-500">{(form.customer_conditions || []).length > 0 ? `조건 ${(form.customer_conditions || []).length}개` : '조건 없음'} · 최대 {form.thresholdRecipients != null ? `${Number(form.thresholdRecipients).toLocaleString('ko-KR')}명` : '정하지 않음'}</div>
                    </button>
                  </li>
                  {detail.steps.map((r) => {
                    const ms = mapStepById.get(r.id);
                    const lp = liveById.get(r.id);
                    const dg = diagById.get(r.id);
                    const Icon = r.step_type === 'wait' ? Hourglass : r.step_type === 'condition' ? GitBranch : MessageSquare;
                    const cur = currentOf(r.id) || toStudio(r);
                    const dirty = dirtyIds.includes(r.id);
                    const del = deleteIds.has(r.id);
                    return (
                      <li key={r.id} className="shrink-0 md:shrink">
                        <div className="hidden pl-4 text-[12px] text-slate-400 md:block">↓ {formatDelayAfter(cur.delayHours)}</div>
                        <button type="button" onClick={() => pickStep(r.id)} aria-current={selected === r.id}
                          className={`w-[180px] rounded-xl border px-3 py-2.5 text-left transition md:w-full ${selected === r.id ? 'border-indigo-300 bg-white shadow-sm ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'} ${failed[r.id] ? 'border-rose-300' : ''}`}>
                          <div className={`flex items-center gap-1.5 text-[13px] font-medium ${del ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{stepTitle({ ...r, channel: cur.channel })}</span>
                            {dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-label="고침" />}
                            {dg && dg.severity !== 'good' && <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${dg.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-400'}`} aria-label="살펴볼 칸" />}
                          </div>
                          <div className="mt-0.5 truncate text-[12px] tabular-nums text-slate-500">
                            {ms ? (ms.waitingHere > 0 ? `지금 ${ms.waitingHere.toLocaleString('ko-KR')}명 기다림` : '기다리는 사람 없음') : (r.timingLabel || '')}
                            {lp?.avgWaitDays != null && ms && ms.waitingHere > 0 ? ` · 평균 ${Number(lp.avgWaitDays) < 1 ? '오늘' : `${Math.round(Number(lp.avgWaitDays))}일째`}` : ''}
                          </div>
                          {failed[r.id] && <div className="mt-0.5 truncate text-[12px] text-rose-700">{failed[r.id]}</div>}
                          {del && <div className="mt-0.5 text-[12px] text-rose-700">저장하면 빠져요</div>}
                        </button>
                      </li>
                    );
                  })}
                  {newSteps.map((n) => (
                    <li key={n.tempId} className="shrink-0 md:shrink">
                      <div className="hidden pl-4 text-[12px] text-slate-400 md:block">↓ {formatDelayAfter(n.step.delayHours)}</div>
                      <button type="button" onClick={() => pickStep(n.tempId)} aria-current={selected === n.tempId}
                        className={`w-[180px] rounded-xl border border-dashed px-3 py-2.5 text-left md:w-full ${selected === n.tempId ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-300 bg-white'}`}>
                        <div className="flex items-center gap-1.5 text-[13px] font-medium text-indigo-800"><Plus className="h-3.5 w-3.5" aria-hidden />새 칸 · {stepChannelLabel(n.step.channel)}</div>
                        <div className={`mt-0.5 text-[12px] ${n.sent ? 'text-amber-700' : 'text-slate-500'}`}>{n.sent ? '넣었는지 확인 중' : '저장하면 더해져요'}</div>
                      </button>
                    </li>
                  ))}
                  {canShapeSteps && (
                    <li className="shrink-0 md:shrink md:pt-1">
                      <button type="button" onClick={() => addStep()} className="flex h-full w-[150px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-[13px] font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700 md:w-full">
                        <Plus className="h-4 w-4" aria-hidden />칸 넣기
                      </button>
                    </li>
                  )}
                  {mj?.endNote && <li className="hidden items-center gap-1.5 pl-1 pt-1 text-[12px] text-slate-500 md:flex"><Flag className="h-3 w-3" aria-hidden />{mj.endNote}</li>}
                  {canShapeSteps && (
                    <li className="hidden md:block md:pt-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden />AI 다음 칸 추천</div>
                        {!nextRec.data ? (
                          <button type="button" onClick={() => void loadNextRec()} disabled={nextRec.loading} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12.5px] font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-indigo-200 disabled:opacity-50">
                            {nextRec.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}{nextRec.loading ? '흐름을 보는 중' : '추천 받기'}
                          </button>
                        ) : (
                          <div className="mt-2 space-y-2 text-[12.5px] text-slate-700">
                            <div className="text-slate-500">{formatDelayAfter(Number(nextRec.data.recommended?.delayHours || 0))} · {stepChannelLabel(nextRec.data.recommended?.channel || 'lms')}</div>
                            {nextRec.data.recommended?.messageTemplate && <p className="line-clamp-4 whitespace-pre-wrap leading-relaxed">{nextRec.data.recommended.messageTemplate}</p>}
                            {nextRec.data.recommended?.reasoning && <p className="text-[12px] text-slate-500">{nextRec.data.recommended.reasoning}</p>}
                            <button type="button" onClick={() => {
                              const rec = nextRec.data.recommended || {};
                              const ch = STUDIO_CHANNELS.includes(String(rec.channel)) ? String(rec.channel) : 'lms';
                              addStep({ channel: ch, messageTemplate: String(rec.messageTemplate || ''), delayHours: Number(rec.delayHours) || 72 });
                            }} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[12.5px] font-semibold text-white hover:bg-slate-800">
                              <Plus className="h-3.5 w-3.5" aria-hidden />이 칸 넣기
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )}
                </ol>
              )}
            </nav>

            {/* 휴대폰 · 도구 */}
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {detail && selected === 'start' && (
                <div className="mx-auto max-w-2xl p-4 md:p-6">
                  {locked && <p className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">{edit.reason}</p>}
                  <JourneyStartCard
                    journey={detail.journey}
                    triggerLabel={triggerLabel}
                    form={form}
                    setField={(k, v) => { if (!editLockRef.current) setForm((f) => ({ ...f, [k]: v })); }}
                    count={count}
                    onCount={() => void runCount()}
                    locked={locked}
                    isActive={isActive}
                    inProgress={mj?.counts.inProgress || 0}
                  />
                </div>
              )}
              {detail && selected !== 'start' && selStudio && (
                <div className="p-3 md:p-5">
                  {selEditable && !selDeleting ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <JourneyStepStudio
                        steps={[selStudio]}
                        index={0}
                        onIndex={() => undefined}
                        onPatch={(_i, p) => patchSelected(p)}
                        onSave={() => void save()}
                        onAi={() => void runAi()}
                        onDecorate={(_i, tokens) => void runDecorate(tokens)}
                        onSpamTest={() => { if (!selStudio.messageTemplate.trim()) { toast.warning('검사할 문안을 먼저 써 주세요.'); return; } if (!journey?.callback_number) { toast.warning('회신번호가 없어 검사할 수 없어요.'); return; } setSpamFor(selStudio); }}
                        decorateVars={decorateVars}
                        variables={decorateVars.map((v) => v.token.replace(/%/g, ''))}
                        opt080Number={opt080}
                        journeyId={selected.startsWith(NEW_STEP_PREFIX) ? undefined : journeyId || undefined}
                        senderLabel={journey?.callback_number || undefined}
                        triggerLabel={triggerLabel}
                        aiBusy={aiBusy}
                        saving={saving}
                        maxSteps={1}
                        single
                        bare
                        lockChannel={!edit.structure && !reshapeAllowed && !selected.startsWith(NEW_STEP_PREFIX)}
                        lockTiming={!edit.timing && !reshapeAllowed && !selected.startsWith(NEW_STEP_PREFIX)}
                        lockNote={selected.startsWith(NEW_STEP_PREFIX) ? (isActive ? '새 칸은 새로 들어오는 고객부터 받아요.' : undefined) : edit.reason}
                      />
                    </div>
                  ) : selNew?.sent ? (
                    <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[14px] leading-relaxed text-amber-900">
                      이 칸은 보냈지만 들어갔는지 아직 확인하지 못했어요. 저장을 누르면 같은 칸으로 확인해요(두 번 들어가지 않아요). 확인된 뒤 그 칸에서 고칠 수 있어요.
                    </div>
                  ) : selRaw ? (
                    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4">
                      {selDeleting ? (
                        <p className="text-[14px] text-slate-700">이 칸은 저장하면 빠져요. 그대로 두려면 아래 [빼지 않기]를 눌러 주세요.</p>
                      ) : selRaw.step_type === 'message' ? (
                        <>
                          {selRaw.subject && <div className="mb-1.5 text-[14px] font-semibold">{buildAdSubjectFront(selRaw.subject, String(selRaw.channel || 'lms').toUpperCase(), selRaw.is_ad !== false)}</div>}
                          <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-slate-700">{selRaw.channel === 'kakao' ? (selRaw.message_template || '문안이 비어 있어요.') : buildAdMessageFront(selRaw.message_template || '', String(selRaw.channel || 'lms').toUpperCase(), selRaw.is_ad !== false, opt080)}</pre>
                          <p className="mt-2 text-[12.5px] text-slate-500">{stepChannelLabel(selRaw.channel)} 칸은 등록한 템플릿으로 나가요. 문안 수정 창에서 고쳐요.</p>
                        </>
                      ) : selRaw.step_type === 'wait' ? (
                        <p className="text-[14px] leading-relaxed text-slate-700">{selRaw.wait_event_name ? '정한 행동이 일어나면 바로 다음 칸으로, 늦어도 정한 시간이 지나면 다음 칸으로 넘어가요.' : '정한 시간만큼 기다린 뒤 다음 칸으로 넘어가요.'}</p>
                      ) : (
                        <p className="text-[14px] leading-relaxed text-slate-700">{selRaw.conditionLabel || '조건에 맞는지 보고 갈래를 나눠요.'}</p>
                      )}
                    </div>
                  ) : null}

                  {/* 이 칸 도구 — A/B · 담당자 알림 · 진단 · 빼기 */}
                  {selRaw && (
                    <div className="mx-auto mt-3 max-w-[1100px] space-y-3">
                      {diagById.get(selRaw.id) && diagById.get(selRaw.id).severity !== 'good' && (
                        <div className={`rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed ${diagById.get(selRaw.id).severity === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                          <span className="font-semibold">이 칸에서 {Math.round(Number(diagById.get(selRaw.id).dropoutRate || 0) * 100)}%가 빠져요.</span> {diagById.get(selRaw.id).recommendation}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {selRaw.step_type === 'message' && (
                          <button type="button" onClick={() => setVariantsOpen((v) => (v === selRaw.id ? null : selRaw.id))} aria-expanded={variantsOpen === selRaw.id}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium ${variantsOpen === selRaw.id ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                            <Beaker className="h-4 w-4" aria-hidden />A/B 문안 시험
                          </button>
                        )}
                        {undo && undo.id === selRaw.id && (
                          <button type="button" onClick={() => { patchSelected({ messageTemplate: undo.text }); setUndo(null); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:border-slate-300">
                            <Undo2 className="h-4 w-4" aria-hidden />AI 전으로
                          </button>
                        )}
                        {canShapeSteps && (detail.steps.length - deleteIds.size + newSteps.length > 1 || selDeleting) && (
                          <button type="button" onClick={() => toggleDelete(selRaw.id)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-600 hover:border-rose-200 hover:text-rose-700">
                            <Trash2 className="h-4 w-4" aria-hidden />{selDeleting ? '빼지 않기' : '이 칸 빼기'}
                          </button>
                        )}
                      </div>
                      {variantsOpen === selRaw.id && (
                        <JourneyVariantsEditor
                          key={`v:${selRaw.id}`}
                          stepId={selRaw.id}
                          journeyId={journeyId!}
                          journeyStatus={status === 'ended' ? 'paused' : (status as 'draft' | 'active' | 'paused')}
                          defaultChannel={(selRaw.channel || 'sms') as 'sms' | 'lms' | 'mms' | 'kakao'}
                          defaultMessageTemplate={selRaw.message_template || ''}
                          defaultSubject={selRaw.subject || ''}
                          opt080Number={opt080}
                          onClose={() => setVariantsOpen(null)}
                        />
                      )}
                      {selRaw.step_type === 'message' && !locked && (
                        <JourneyStepNotifyToggle
                          key={`n:${selRaw.id}:${String(selRaw.notify_manager_on_pretest)}`}
                          journeyId={journeyId!}
                          stepId={selRaw.id}
                          stepOrder={selRaw.step_order}
                          totalSteps={detail.steps.filter((s) => s.step_type === 'message').length}
                          currentValue={selRaw.notify_manager_on_pretest ?? null}
                          token={localStorage.getItem('token') || ''}
                          onChange={() => { if (journeyId) void load(journeyId, false, 'sync'); }}
                        />
                      )}
                    </div>
                  )}
                  {selected.startsWith(NEW_STEP_PREFIX) && (
                    <div className="mx-auto mt-3 flex max-w-[1100px] justify-end">
                      <button type="button" onClick={() => toggleDelete(selected)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-600 hover:border-rose-200 hover:text-rose-700">
                        <Trash2 className="h-4 w-4" aria-hidden />새 칸 지우기
                      </button>
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>

          {/* 확정 바 */}
          {dirtyCount > 0 && (
            <div {...inertProps} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 md:px-6">
              {confirmShape && (
                <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>칸 모양을 바꾸면 새로 들어오는 고객부터 바뀐 모양으로 받아요. 지금 진행 중인 {(mj?.counts.inProgress || 0).toLocaleString('ko-KR')}명은 지금 모양 그대로 끝까지 받아요. 바꾸기 전에 점검을 다시 하고 바로 켜요.</span>
                </div>
              )}
              {overlapAsk && (
                <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>이 옵션을 끄면 같은 구매로 함께 시작되는 여정이 {overlapAsk.length}쌍 생겨요. 그대로 저장하면 같은 구매에 문자가 두 통 갈 수 있어요.</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-slate-500">{bottomLine}</p>
                <button type="button" onClick={discardAll} disabled={saving} className="h-10 rounded-lg border border-slate-200 px-3 text-[13px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">되돌리기</button>
                {confirmShape && <button type="button" onClick={() => setConfirmShape(false)} disabled={saving} className="h-10 rounded-lg border border-slate-200 px-3 text-[13px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">취소</button>}
                <button type="button" onClick={() => void save(overlapAsk || undefined)} disabled={saving || locked || !ready}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                  {overlapAsk ? '그대로 저장' : confirmShape ? '이렇게 바꾸기' : `고친 곳 ${dirtyCount}개 저장`}
                </button>
              </div>
            </div>
          )}

          {blocking && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/85 backdrop-blur-sm" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" aria-hidden />
              <p className="text-[14px] font-semibold text-slate-800">{reshaping || needsShape ? '바뀐 모양으로 옮기는 중' : '저장하는 중'}</p>
              {(reshaping || needsShape) && <p className="text-[12.5px] text-slate-500">점검하고 켜는 데 10초쯤 걸려요. 창을 닫지 말아 주세요.</p>}
            </div>
          )}
        </div>
      </JourneyModalShell>

      {/* 켜면 어떻게 될지 미리 보기 */}
      <JourneyModalShell open={simOpen} onClose={() => setSimOpen(false)} labelledBy="jws-sim-title" panelClassName="w-full max-w-lg" zIndexClassName="z-[70]">
        <div className="flex flex-col text-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <h2 id="jws-sim-title" className="flex-1 text-[15px] font-semibold">켜면 어떻게 될지 미리 보기</h2>
            <button type="button" onClick={() => setSimOpen(false)} aria-label="닫기" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3 px-5 py-4">
            {sim.loading && <div className="flex items-center gap-2 py-8 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />고객과 비용을 세는 중</div>}
            {sim.error && <p className="text-[13px] text-rose-700">{sim.error}</p>}
            {sim.data && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['들어올 고객', `${Number(sim.data.matchedCustomers || 0).toLocaleString('ko-KR')}명${sim.data.capped ? ' 넘음' : ''}`],
                    ['보낼 문자', `${Number(sim.data.totalEstimatedSends || 0).toLocaleString('ko-KR')}통`],
                    ['예상 발송비', `${Number(sim.data.totalEstimatedCost || 0).toLocaleString('ko-KR')}원`],
                    ['예상 매출', sim.data.estimatedRevenue != null ? `${Number(sim.data.estimatedRevenue).toLocaleString('ko-KR')}원` : '자료가 모자라요'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[12px] text-slate-500">{k}</div>
                      <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{v}</div>
                    </div>
                  ))}
                </div>
                {sim.data.reasoning && <p className="text-[13px] leading-relaxed text-slate-600">{sim.data.reasoning}</p>}
                {Array.isArray(sim.data.warnings) && sim.data.warnings.length > 0 && (
                  <ul className="space-y-1">
                    {sim.data.warnings.map((w: string, i: number) => <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{w}</li>)}
                  </ul>
                )}
                <p className="text-[12px] text-slate-400">실제로 보내지 않고 지금 고객 자료로 셌어요.</p>
              </>
            )}
          </div>
        </div>
      </JourneyModalShell>

      {pauseLogsOpen && journeyId && (
        <JourneyPauseLogsModal journeyId={journeyId} journeyName={journey?.name || mj?.name || '여정'} token={localStorage.getItem('token') || ''} onClose={() => setPauseLogsOpen(false)} />
      )}
      {actionMode && (
        <JourneyActionConfirmModal mode={actionMode} journeyName={journey?.name || mj?.name || '여정'} onConfirm={() => void runAction()} onClose={() => setActionMode(null)} />
      )}
      {spamFor && journey?.callback_number && (() => {
        const ch = String(spamFor.channel || 'lms').toUpperCase() as 'SMS' | 'LMS' | 'MMS';
        const sentBody = buildAdMessageFront(spamFor.messageTemplate, ch, spamFor.isAd !== false, opt080);
        return (
          <SpamFilterTestModal
            onClose={() => setSpamFor(null)}
            messageContentSms={spamFor.channel === 'sms' ? sentBody : undefined}
            messageContentLms={spamFor.channel !== 'sms' ? sentBody : undefined}
            callbackNumber={String(journey.callback_number)}
            messageType={ch}
            subject={buildAdSubjectFront(spamFor.subject || '', ch, spamFor.isAd !== false)}
            isAd={spamFor.isAd !== false}
          />
        );
      })()}
      {actions.node}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
