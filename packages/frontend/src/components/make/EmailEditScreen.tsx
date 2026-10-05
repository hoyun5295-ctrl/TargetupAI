/**
 * EmailEditScreen — 이메일 수정 화면(★ 2026-09-27 만들기 개편 · 목업 (라) ② · 설계서 §1 불변 3 · §5 EmailVisualEditor 이전)
 *
 * DM 수정 화면과 같은 칸 배치·같은 고치는 방법: 왼쪽 = 받은편지함 글(고정 칸) + 블록 · 가운데 = 휴대폰+PC(실제 발송 HTML) ·
 * 오른쪽 = 고른 블록 패널(같은 SectionPropsEditor · 이메일이 렌더하지 않는 칸은 감춘다) / 없으면 전체 설정.
 * 저장 = 자동(PATCH · 새 캠페인은 제목이 생기면 POST) · 완성(50)은 보내기 창에서 처음 보낼 때(또는 전체 설정 [완성만 하기]).
 * 옛 편집기의 기능(프리헤더 · 구도·배경·강조·장식·정렬·색 · 개인화 변수·조건부 표시 · 테마·서체 · AI 생성·다듬기 · 재료 입구 · 완성)은 전부 여기 있다.
 * ⛔ 이메일 렌더러는 섹션 표식이 없어 미리보기 탭 선택 0 — 블록은 왼쪽 목록으로 고른다(설계서 §9).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette, Type, Sparkles, Wand2, Loader2, Lock, ChevronUp, ChevronDown, Copy, Trash2, Inbox } from 'lucide-react';
import SectionPropsEditor from '../dm/panels/SectionPropsEditor';
import EmailDesignThemeModal from '../email/EmailDesignThemeModal';
import EmailFontModal from '../email/EmailFontModal';
import MaterialQuickPanel from '../MaterialQuickPanel';
import BuildResultBar from '../ai-build/BuildResultBar';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import EditShell, { BlockList, AddBlockButton, PalettePopover, BlockIcon, type BlockRowItem, type SaveTone } from './EditShell';
import PreviewPair from './PreviewPair';
import MakeSendModal from './MakeSendModal';
import { PanelBlock, TreatmentTiles, Swatches, Segmented, AlignControl, EMAIL_BACKGROUND_SWATCHES } from './StyleControls';
import { fetchEmailPreview, useRenderedHtml } from '../../hooks/useRenderedHtml';
import { emailHiddenFieldsFor } from '../../constants/email-editor-hidden-fields';
import { EMAIL_TREATMENT_OPTIONS, emailMotifLabel, type EmailDesign } from '../../utils/email-themes';
import { createSection, normalizeOrder, resequence, moveWithin, type Section, type SectionType } from '../../utils/dm-section-defaults';
import { blockLabel, blockPanelSub, blockSummary, emailPaletteItems, isAutoBlock, type MakePaletteItem } from '../../utils/make-flow';
import { peekBuildResult, clearBuildResult, type BuildResultHandoff } from '../../utils/ai-build';
import { AI_GENERATE_COSTS, CONFIRM_CREDIT_COSTS } from '../../constants/credit';
// ★ 2026-10-05 한줄로 시그니처(설계서 docs/2026-10-05-hanjul-signature-design.md §5) — 완성도 줄 · 보강 시트(혜택 · 기간 자리 0크레딧 채우기)
import ZoneCompletion from '../zone/ZoneCompletion';
import { LineFacts, LineFactsSheet, typedBenefit, type LineFactsValues, type LineFactsField } from '../zone/LineFacts';
import { countSlots, countEmailGatePlaceholders, fillSlots, fillSlotsDeep, stringsDeep } from '../../utils/one-line';
import type { FixItem } from '../../utils/make-flow';

// 렌더러가 실제로 읽는 타입에만 조작을 보인다(백엔드 EMAIL_* 미러 · EmailVisualEditor 와 같은 표 · 계약 = email-editor-parity.test)
const EMAIL_ALIGN_AWARE = new Set<SectionType>(['hero', 'header', 'text_card']);
const EMAIL_ACCENT_AWARE = new Set<SectionType>(['text_card', 'cta', 'coupon', 'promo_code', 'sns', 'store_info', 'product_carousel']);
const EMAIL_BAND_AWARE = new Set<SectionType>(['text_card', 'cta', 'coupon', 'promo_code', 'product_carousel', 'reviews']);
const EMAIL_MOTIF_AWARE = new Set<SectionType>(['hero', 'text_card']);
const INBOX_ID = '__inbox__';

interface EmailVar { field: string; token: string; label: string }
const DEFAULT_EMAIL_VARS: EmailVar[] = [
  { field: 'name', token: '{{ customer.name }}', label: '회원명' },
  { field: 'grade', token: '{{ customer.grade }}', label: '등급' },
  { field: 'points', token: '{{ customer.points }}', label: '포인트' },
  { field: 'region', token: '{{ customer.region }}', label: '지역' },
];

interface Snap { sections: Section[]; name: string; subject: string; isAd: boolean; design: EmailDesign | null }

export interface EmailEditScreenProps {
  initialSections: Section[];
  initialName?: string;
  initialSubject?: string;
  initialIsAd?: boolean;
  initialDesign?: EmailDesign | null;
  aiGenerated?: boolean;
  campaignId?: string;
  completed?: boolean;
  fromName?: string;
  hasPlaceholder?: boolean;
  /** 같은 재료로 만든 DM(있으면 머리 전환) */
  pairDmId?: string | null;
  /** ★ 2026-10-05 한 줄로 만든 이메일(스위치 켠 회사) — 완성도 줄 · 보강 시트를 그린다 */
  lineAssist?: { text: string; gapBenefit: boolean } | null;
  /** 결과에 혜택 자리가 없을 때 혜택을 넣어 새로 만든다(부모가 새 이메일로 연다) */
  onRegenerateWithBenefit?: (benefit: string) => void;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function EmailEditScreen({
  initialSections, initialName, initialSubject, initialIsAd, initialDesign, aiGenerated, campaignId: initialId, completed,
  fromName, hasPlaceholder, pairDmId, authHeaders, onClose, onSaved, onToast, lineAssist, onRegenerateWithBenefit,
}: EmailEditScreenProps) {
  const navigate = useNavigate();
  const [campaignId, setCampaignId] = useState<string | undefined>(initialId);
  const [sections, setSections] = useState<Section[]>(() => normalizeOrder(initialSections || []));
  const [name, setName] = useState(initialName || '새 이메일');
  const [subject, setSubject] = useState(initialSubject || '');
  const [isAd, setIsAd] = useState(initialIsAd ?? true);
  const [design, setDesign] = useState<EmailDesign | null>(initialDesign ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSubject ? null : INBOX_ID);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [completedState, setCompletedState] = useState(!!completed);
  const [sendOpen, setSendOpen] = useState(false);
  const [sample, setSample] = useState<string>('none');
  const [samples, setSamples] = useState<Array<{ label: string; customer: Record<string, any> }>>([]);
  const [emailVars, setEmailVars] = useState<EmailVar[]>(DEFAULT_EMAIL_VARS);
  const [buildBar, setBuildBar] = useState<BuildResultHandoff | null>(() => (initialId ? peekBuildResult(initialId) : null));
  // ★ 2026-10-05 한줄로 시그니처 — 완성도 줄(닫으면 사라짐) · 보강 시트
  const [lineBarOn, setLineBarOn] = useState(!!lineAssist);
  const [lineSheet, setLineSheet] = useState(false);
  const [lineValues, setLineValues] = useState<LineFactsValues>({});
  const lineAutoOpened = useRef(false);

  // ── 되돌리기(스냅샷 · 0.5초 묶음) ──
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const lastPush = useRef(0);
  const cur = (): Snap => ({ sections, name, subject, isAd, design });
  const record = () => {
    const now = Date.now();
    if (now - lastPush.current > 500) { past.current.push(cur()); if (past.current.length > 50) past.current.shift(); future.current = []; }
    lastPush.current = now;
  };
  const restore = (s: Snap) => { setSections(s.sections); setName(s.name); setSubject(s.subject); setIsAd(s.isAd); setDesign(s.design); };
  const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push(cur()); restore(p); lastPush.current = 0; };
  const redo = () => { const f = future.current.pop(); if (!f) return; past.current.push(cur()); restore(f); lastPush.current = 0; };
  const changeSections = (fn: (prev: Section[]) => Section[]) => { record(); setSections(fn); };

  useEffect(() => {
    fetch('/api/email/personalization-vars', { headers: authHeaders() }).then((r) => r.json()).then((d) => { if (d?.success && Array.isArray(d.vars) && d.vars.length) setEmailVars(d.vars); }).catch(() => {});
    fetch('/api/email/preview-customers', { headers: authHeaders() }).then((r) => r.json()).then((d) => { if (d?.success && Array.isArray(d.customers)) setSamples(d.customers.map((c: any) => ({ label: String(c.label), customer: c.customer || {} }))); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 미리보기(실제 발송 HTML · 광고면 법정 하단 문구까지) ──
  const sampleCustomer = sample !== 'none' ? samples.find((c) => c.label === sample)?.customer : null;
  const previewKey = JSON.stringify({ sections, design, isAd, campaignId, sample });
  const preview = useRenderedHtml(previewKey, (signal) => fetchEmailPreview({ sections, design, is_ad: isAd, campaign_id: campaignId || null, sampleCustomer }, signal), 450);

  // ── ★ 2026-10-05 한줄로 시그니처 · 완성도 줄 ──
  //   보내기 전에 N곳 = 발송 관문(email-ai PLACEHOLDER_PATTERN)과 같은 기준으로 센 자리 + 받은편지함 제목.
  //   혜택 · 기간 자리는 시트에서 값만 받아 그 자리에 넣는다(0크레딧 · 되돌리기 기록). 자리가 없는데 혜택이 빠졌으면 새로 만들기(생성비 1회).
  const lineTexts = useMemo(() => [...stringsDeep(sections), subject], [sections, subject]);
  const lineBenefitSlots = countSlots(lineTexts, 'benefit');
  const linePeriodSlots = countSlots(lineTexts, 'period');
  const lineOtherSlots = Math.max(0, countEmailGatePlaceholders(lineTexts) - lineBenefitSlots - linePeriodSlots);
  const lineCanRegen = !!lineAssist?.gapBenefit && lineBenefitSlots === 0 && !!onRegenerateWithBenefit;
  const lineFields: LineFactsField[] = [
    ...(lineBenefitSlots > 0 || lineCanRegen ? (['benefit'] as const) : []),
    ...(linePeriodSlots > 0 ? (['period'] as const) : []),
  ];
  const lineItems: FixItem[] = useMemo(() => {
    if (!lineAssist) return [];
    const out: FixItem[] = [];
    if (lineBenefitSlots > 0) out.push({ kind: 'must', title: `혜택 자리 ${lineBenefitSlots}곳이 비었어요`, sub: '적어 주시면 그 자리에 그대로 넣어요 · 무료', action: '채우기' });
    if (linePeriodSlots > 0) out.push({ kind: 'must', title: `기간 자리 ${linePeriodSlots}곳이 비었어요`, sub: '적어 주시면 그 자리에 그대로 넣어요 · 무료', action: '채우기' });
    if (lineOtherSlots > 0) out.push({ kind: 'must', title: `직접 채울 자리 ${lineOtherSlots}곳이 남았어요`, sub: '블록에서 그 자리를 고쳐 주세요' });
    if (!subject.trim()) out.push({ kind: 'must', title: '받은편지함 제목이 비었어요', sub: '위 제목 칸에 넣어 주세요' });
    if (lineCanRegen) out.push({ kind: 'suggest', title: '혜택을 적어 주시면 첫 줄이 혜택으로 시작해요', sub: `새 이메일로 만들어요 · ${AI_GENERATE_COSTS['email-ai-generate']}크레딧 · 지금 이메일은 그대로 남아요`, action: '넣기' });
    if (subject.trim()) out.push({ kind: 'ok', title: '받은편지함 제목 있음' });
    if (lineBenefitSlots + linePeriodSlots + lineOtherSlots === 0) out.push({ kind: 'ok', title: '채울 자리 없음' });
    if (isAd) out.push({ kind: 'ok', title: '광고 표기 · 수신거부 자동' });
    return out;
  }, [lineAssist, lineBenefitSlots, linePeriodSlots, lineOtherSlots, lineCanRegen, subject, isAd]);
  // 생성 직후 보내기 전에 채울 자리가 있으면 시트를 한 번만 연다(그 밖에는 줄의 [채우기]로 연다)
  useEffect(() => {
    if (!lineAssist || lineAutoOpened.current) return;
    lineAutoOpened.current = true;
    if (lineBenefitSlots + linePeriodSlots > 0) setLineSheet(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lineTypedPeriod = typeof lineValues.period === 'string' ? lineValues.period.trim() : '';
  const lineTypedBenefit = typedBenefit(lineValues);
  const lineFillable = (!!lineTypedBenefit && lineBenefitSlots > 0) || (!!lineTypedPeriod && linePeriodSlots > 0);
  const lineRegenReady = !lineFillable && !!lineTypedBenefit && lineCanRegen;
  const applyLineFill = () => {
    record();
    let next = sections;
    let nextSubject = subject;
    if (lineTypedBenefit && lineBenefitSlots > 0) { next = fillSlotsDeep(next, 'benefit', lineTypedBenefit); nextSubject = fillSlots(nextSubject, 'benefit', lineTypedBenefit); }
    if (lineTypedPeriod && linePeriodSlots > 0) { next = fillSlotsDeep(next, 'period', lineTypedPeriod); nextSubject = fillSlots(nextSubject, 'period', lineTypedPeriod); }
    setSections(next);
    setSubject(nextSubject);
    setLineSheet(false);
    setLineValues({});
    onToast('적어 주신 그대로 넣었어요', 'success');
  };
  const regenLineWithBenefit = () => {
    if (!lineTypedBenefit || !onRegenerateWithBenefit) return;
    const b = lineTypedBenefit;
    setLineSheet(false);
    void (dirty && canSave ? persist() : Promise.resolve(null)).then(() => onRegenerateWithBenefit(b));
  };

  // ── 자동 저장 ──
  const savedSnap = useRef<string>(JSON.stringify({ name, subject, isAd, sections, design }));
  const snapStr = JSON.stringify({ name, subject, isAd, sections, design });
  const dirty = snapStr !== savedSnap.current;
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(initialId ? Date.now() : null);
  const canSave = !!name.trim() && !!subject.trim() && sections.length > 0;
  // ★ 2026-10-01 저장은 한 번에 하나 — 앞 저장(자동 저장·나가기)이 가는 중이면 끝나기를 기다린 뒤 지금 내용으로 저장한다.
  //   새 메일은 앞 저장이 받은 id(campaignIdRef)로 수정한다 — 전에는 둘 다 새로 만들어 같은 메일이 두 건 생길 수 있었다.
  const campaignIdRef = useRef<string | null>(campaignId || null);
  campaignIdRef.current = campaignId || campaignIdRef.current; // 화면 상태가 우선 · 상태가 아직 안 따라온 사이(새로 만든 직후)만 ref 값
  const inflight = useRef<Promise<string | null> | null>(null);
  const persist = useCallback(async (): Promise<string | null> => {
    while (inflight.current) { try { await inflight.current; } catch { /* 앞 저장 실패는 아래에서 다시 시도 */ } }
    if (!canSave) return null;
    const run = (async (): Promise<string | null> => {
      const cid = campaignIdRef.current;
      const body: any = { name: name.trim(), subject: subject.trim(), is_ad: isAd, sections };
      if (design) body.design = design;
      else if (initialDesign) body.design = null;
      if (!cid && aiGenerated) body.ai_generated = true;
      const snap = JSON.stringify({ name, subject, isAd, sections, design });
      setSaving(true);
      try {
        const r = await fetch(cid ? `/api/email/campaigns/${cid}` : '/api/email/campaigns', { method: cid ? 'PATCH' : 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.success) { setSaveErr(d?.error || '저장하지 못했어요.'); return null; }
        const id = String(cid || d.campaign?.id || '');
        if (!cid && id) { campaignIdRef.current = id; setCampaignId(id); }
        savedSnap.current = snap;
        setSaveErr(null);
        setSavedAt(Date.now());
        onSaved();
        return id || null;
      } catch (e: any) {
        setSaveErr(e?.message || '저장하지 못했어요.');
        return null;
      } finally {
        setSaving(false);
      }
    })();
    inflight.current = run;
    try { return await run; } finally { if (inflight.current === run) inflight.current = null; }
  }, [canSave, name, subject, isAd, sections, design, initialDesign, aiGenerated, authHeaders, onSaved]);
  useEffect(() => {
    if (!dirty || !canSave || saving) return;
    const t = setTimeout(() => { void persist(); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, canSave, saving, persist, snapStr]);

  // ★ 2026-10-01 나가는 중 = 누른 것이 보이게(저장이 끝나야 닫힌다) · 다시 눌러도 한 번만 처리
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const save: { tone: SaveTone; text: string; onSaveNow?: () => void } = leaving ? { tone: 'saving', text: '저장하고 나가는 중' }
    : saving ? { tone: 'saving', text: '저장하는 중' }
    : saveErr ? { tone: 'error', text: saveErr, onSaveNow: () => { void persist(); } }
      : !subject.trim() ? { tone: 'manual', text: '받은편지함 제목을 넣으면 자동 저장돼요' }
        : sections.length === 0 ? { tone: 'manual', text: '블록을 하나 넣으면 자동 저장돼요' }
          : dirty ? { tone: 'dirty', text: '고치는 중 · 곧 자동 저장돼요' }
            : { tone: 'saved', text: savedAt ? '자동 저장됨' : '저장 전' };

  const leave = () => {
    if (leavingRef.current) return;
    if (!dirty) { onClose(); return; }
    if (canSave) {
      leavingRef.current = true;
      setLeaving(true);
      void persist().then((id) => {
        leavingRef.current = false;
        setLeaving(false);
        if (id) { onClose(); return; }
        // 저장이 실패하면 말없이 닫지 않는다(전에는 닫혀 고친 내용이 사라졌다)
        setConfirm({ mode: 'warning', title: '저장하지 못했어요', description: '지금 나가면 고친 내용이 사라져요. 계속 고치면 자동 저장을 다시 시도해요.', confirmLabel: '저장하지 않고 나가기', cancelLabel: '계속 고치기', onConfirm: () => onClose() });
      });
      return;
    }
    setConfirm({ mode: 'warning', title: '저장하지 않은 내용이 있어요', description: '받은편지함 제목과 블록이 있어야 저장돼요. 이대로 나가면 고친 내용이 사라져요.', confirmLabel: '저장하지 않고 나가기', cancelLabel: '계속 고치기', onConfirm: () => onClose() });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || themeOpen || fontOpen || sendOpen || confirm || paletteOpen) return;
      leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── 블록 조작(드래그·화살표 = 같은 moveWithin) ──
  const ordered = useMemo(() => sections.slice().sort((a, b) => a.order - b.order), [sections]);
  const selected = ordered.find((s) => s.id === selectedId) || null;
  const idx = selected ? ordered.findIndex((s) => s.id === selected.id) : -1;
  const updateProps = (patch: Record<string, any>) => {
    if (!selected) return;
    changeSections((prev) => prev.map((s) => {
      if (s.id !== selected.id) return s;
      let next = { ...s, props: { ...(s.props as any), ...patch } } as Section;
      if (typeof patch.image_url === 'string' && patch.image_url.trim() && s.type === 'hero' && (s as any).treatment === 'typographic') next = { ...next, treatment: 'classic' } as Section;
      return next;
    }));
  };
  const updateSection = (patch: Partial<Section>) => { if (selected) changeSections((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s))); };
  const move = (id: string, dir: -1 | 1) => changeSections((prev) => { const arr = prev.slice().sort((a, b) => a.order - b.order); const from = arr.findIndex((s) => s.id === id); return from < 0 ? prev : moveWithin(arr, from, from + dir); });
  const dup = (id: string) => changeSections((prev) => {
    const arr = prev.slice().sort((a, b) => a.order - b.order);
    const i = arr.findIndex((s) => s.id === id);
    if (i < 0) return prev;
    const copy: Section = JSON.parse(JSON.stringify(arr[i]));
    copy.id = `dup-${Date.now()}-${copy.type}`;
    arr.splice(i + 1, 0, copy);
    setSelectedId(copy.id);
    return resequence(arr);
  });
  const remove = (id: string) => setConfirm({ mode: 'danger', title: '이 블록을 뺄까요?', description: '빼도 위쪽 되돌리기로 살릴 수 있어요.', confirmLabel: '빼기', onConfirm: () => { changeSections((prev) => normalizeOrder(prev.filter((s) => s.id !== id))); setSelectedId(null); } });
  const add = (it: MakePaletteItem) => {
    setPaletteOpen(false);
    changeSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      const at = selected ? arr.findIndex((s) => s.id === selected.id) + 1 : arr.length;
      const created = createSection(it.section, at);
      arr.splice(at, 0, created);
      setSelectedId(created.id);
      return resequence(arr);
    });
  };

  // ── 변수 삽입(마지막으로 누른 입력칸 · 공용 편집기 무수정) ──
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const trackFocus = (e: React.FocusEvent) => { const t = e.target as HTMLElement; if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'email', 'url', 'search', ''].includes(t.type))) lastField.current = t as any; };
  const insertVar = (token: string, label: string) => {
    const el = lastField.current && document.contains(lastField.current) ? lastField.current : null;
    if (!el) { void navigator.clipboard?.writeText(token).then(() => onToast(`${label} 변수를 복사했어요. 칸에 붙여넣어 주세요`, 'info'), () => onToast(`직접 입력해 주세요: ${token}`, 'warning')); return; }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const st = el.selectionStart ?? el.value.length; const en = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, st) + token + el.value.slice(en);
    if (setter) setter.call(el, next); else el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(st + token.length, st + token.length); } catch { /* 일부 칸 */ } });
  };

  // ── AI(전체 교체 생성 · 다듬기) ──
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiEvent, setAiEvent] = useState('');
  const [aiBusy, setAiBusy] = useState<null | 'gen' | 'refine' | 'complete'>(null);
  const generate = async () => {
    if (aiBusy || (!aiPrompt.trim() && !aiEvent.trim())) return;
    setAiBusy('gen');
    try {
      const r = await fetch('/api/email/ai/generate-sections', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ prompt: aiPrompt.trim(), is_ad: isAd, ...(aiEvent.trim() ? { event_text: aiEvent.trim() } : {}) }) });
      const d = await r.json().catch(() => ({}));
      if (d?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족해요. 충전 뒤 다시 해 주세요.', 'warning'); return; }
      if (!d?.success || !d.data) { onToast(d?.error || '만들지 못했어요.', 'error'); return; }
      const g = d.data;
      record();
      setSections(normalizeOrder(g.sections || []));
      setSelectedId(g.sections?.[0]?.id || null);
      if (!subject && g.subjects?.[0]) setSubject(g.subjects[0]);
      if (g.preheader) setDesign((x) => ({ ...(x || {}), preheader: String(g.preheader).slice(0, 90) }));
      setAiPrompt('');
      onToast(`AI가 이메일을 새로 구성했어요. (${AI_GENERATE_COSTS['email-ai-generate']} 크레딧)`, 'success');
    } catch (e: any) { onToast(e?.message || '만들지 못했어요.', 'error'); } finally { setAiBusy(null); }
  };
  const refine = async () => {
    if (aiBusy || sections.length === 0) return;
    setAiBusy('refine');
    try {
      const r = await fetch('/api/email/ai/refine-sections', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections }) });
      const d = await r.json().catch(() => ({}));
      if (d?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족해요. 충전 뒤 다시 해 주세요.', 'warning'); return; }
      if (d?.success && Array.isArray(d.data?.sections)) { record(); setSections(normalizeOrder(d.data.sections)); onToast(d.changed === false ? '다듬을 글이 없어요.' : 'AI가 문구를 다듬었어요. (1 크레딧)', d.changed === false ? 'info' : 'success'); }
      else onToast(d?.error || '다듬지 못했어요.', 'error');
    } catch (e: any) { onToast(e?.message || '다듬지 못했어요.', 'error'); } finally { setAiBusy(null); }
  };
  const completeOnly = () => {
    if (!canSave) { onToast('받은편지함 제목과 블록이 있어야 완성할 수 있어요.', 'warning'); return; }
    setConfirm({
      mode: 'warning', title: `보내지 않고 완성만 할까요? (${CONFIRM_CREDIT_COSTS['email-campaign-complete']}크레딧)`,
      description: `완성하면 ${CONFIRM_CREDIT_COSTS['email-campaign-complete']}크레딧이 한 번 차감돼요(캠페인당 1회 · 환불 없음). 이후 수정·테스트 발송·HTML 저장·발송은 추가 차감이 없어요.`,
      confirmLabel: '완성하기',
      onConfirm: async () => {
        setAiBusy('complete');
        try {
          const id = dirty || !campaignId ? await persist() : campaignId;
          if (!id) return;
          const r = await fetch(`/api/email/campaigns/${id}/complete`, { method: 'POST', headers: authHeaders() });
          const d = await r.json().catch(() => ({}));
          if (d?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족해요. 충전 뒤 완성해 주세요.', 'warning'); return; }
          if (!d?.success) { onToast(d?.error || '완성하지 못했어요.', 'error'); return; }
          setCompletedState(true);
          onSaved();
          onToast('완성했어요. 이제 테스트 발송·HTML 저장·발송을 할 수 있어요.', 'success');
        } finally { setAiBusy(null); }
      },
    });
  };

  // ── 왼쪽 ──
  const items: BlockRowItem[] = ordered.map((s) => ({ id: s.id, type: s.type, label: blockLabel(s), summary: blockSummary(s), auto: isAutoBlock(s.type) }));
  const left = (
    <BlockList
      title="블록"
      hint={`${ordered.length}개 · 끌어서 순서 바꾸기`}
      items={items}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onReorder={(from, to) => changeSections((prev) => moveWithin(prev.slice().sort((a, b) => a.order - b.order), from, to))}
      top={(
        <button type="button" onClick={() => setSelectedId(INBOX_ID)} className={`w-full mb-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${selectedId === INBOX_ID ? 'border-sky-300 bg-sky-50' : 'border-sky-200 bg-sky-50 hover:bg-sky-50'}`}>
          <span className="w-9 h-9 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center shrink-0"><Inbox className="w-4 h-4" /></span>
          <span className="min-w-0"><b className="block text-[13px] text-slate-900">받은편지함에 보이는 글</b><span className="block text-[11.5px] text-slate-500 truncate">{subject ? subject : '제목 · 미리보기 글'}</span></span>
        </button>
      )}
      footer={(
        <AddBlockButton open={paletteOpen} onToggle={() => setPaletteOpen((v) => !v)}>
          <PalettePopover items={emailPaletteItems()} onPick={add} onClose={() => setPaletteOpen(false)} />
        </AddBlockButton>
      )}
    />
  );

  // ── 가운데 ──
  const center = (
    <PreviewPair
      kind="email"
      html={preview.html}
      loading={preview.loading}
      error={preview.error}
      inboxHead={{ from: fromName || '', subject: `${isAd ? '(광고) ' : ''}${subject}` }}
      phoneTop={samples.length > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-slate-500">받는 사람</span>
          <Segmented value={sample} onChange={setSample} options={[{ value: 'none', label: '변수 그대로' }, ...samples.map((c) => ({ value: c.label, label: c.label }))]} />
        </div>
      ) : undefined}
    />
  );

  // ── 오른쪽 ──
  const brand = (design?.palette?.primary as string) || '#9a4f2c';
  const right = selectedId === INBOX_ID ? (
    <div>
      <Head icon={<Inbox className="w-5 h-5" />} title="받은편지함에 보이는 글" sub="받는 사람이 메일함에서 먼저 보는 곳" />
      <PanelBlock title="제목" hint="메일함에 굵게 보여요">
        <Counter value={subject} max={80} onChange={(v) => { record(); setSubject(v); }} placeholder="예) 가을 신상 모음전 · 10일까지 전 품목 20%" />
      </PanelBlock>
      <PanelBlock title="미리보기 글" hint="제목 옆에 흐리게 보여요 · 비우면 본문 첫 문장">
        <Counter value={design?.preheader || ''} max={90} onChange={(v) => { record(); setDesign((d) => { const n: EmailDesign = { ...(d || {}) }; if (v.trim()) n.preheader = v; else delete n.preheader; return Object.keys(n).length ? n : null; }); }} placeholder="비우면 본문 첫 문장이 보여요" />
      </PanelBlock>
      <PanelBlock title="이메일 이름" hint="목록에서 구분하는 이름 · 받는 사람에게는 안 보여요">
        <Counter value={name} max={60} onChange={(v) => { record(); setName(v); }} />
      </PanelBlock>
      <PanelBlock title="광고 메일">
        <label className="inline-flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={isAd} onChange={(e) => { record(); setIsAd(e.target.checked); }} className="w-4 h-4 accent-violet-600" /><span className="text-[12.5px] text-slate-700">"(광고)" 표기와 수신거부가 보낼 때 자동으로 붙어요</span></label>
      </PanelBlock>
    </div>
  ) : selected ? (
    <div onFocus={trackFocus}>
      <Head icon={<BlockIcon type={selected.type} className="w-5 h-5" />} title={blockLabel(selected)} sub={blockPanelSub(selected.type)} right={(
        <div className="flex items-center gap-0.5">
          <IconBtn label="위로" disabled={idx <= 0} onClick={() => move(selected.id, -1)}><ChevronUp className="w-4 h-4" /></IconBtn>
          <IconBtn label="아래로" disabled={idx < 0 || idx >= ordered.length - 1} onClick={() => move(selected.id, 1)}><ChevronDown className="w-4 h-4" /></IconBtn>
          <IconBtn label="복제" onClick={() => dup(selected.id)}><Copy className="w-4 h-4" /></IconBtn>
          <IconBtn label="빼기" onClick={() => remove(selected.id)} danger><Trash2 className="w-4 h-4" /></IconBtn>
        </div>
      )} />
      <PanelBlock title="내용">
        <div className="mk-editor"><SectionPropsEditor key={selected.id} section={selected} onUpdate={updateProps} hiddenFields={emailHiddenFieldsFor(selected.type)} /></div>
        {selected.type === 'footer' && <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[11.5px] leading-relaxed ${isAd ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-slate-200 bg-white text-slate-500'}`}>{isAd ? '광고 메일이라 보내는 사람 정보와 수신거부 링크가 메일 맨 아래에 자동으로 붙어요. 가운데 미리보기 맨 끝에서 실제 문구를 확인하세요.' : '광고 메일이 아니어서 수신거부 링크가 붙지 않아요. 할인·행사 같은 광고 내용이 있으면 받은편지함 칸에서 광고 메일을 켜 주세요.'}</div>}
      </PanelBlock>
      {EMAIL_TREATMENT_OPTIONS[selected.type] && (
        <PanelBlock title={selected.type === 'cta' ? '모양' : selected.type === 'product_carousel' ? '배열' : '구도'} hint="누르면 가운데에 바로 보여요">
          <TreatmentTiles type={selected.type} options={EMAIL_TREATMENT_OPTIONS[selected.type]} value={(selected as any).treatment || 'classic'} onChange={(v) => updateSection({ treatment: v } as Partial<Section>)} color={brand} />
          {selected.type === 'hero' && (selected as any).treatment === 'split' && <div className="text-[11px] text-amber-700 mt-2">나란히 구도는 PC 메일에서 사진이 왼쪽, 글이 오른쪽으로 나가요. 휴대폰에서는 위아래로 쌓여요.</div>}
        </PanelBlock>
      )}
      {EMAIL_BAND_AWARE.has(selected.type) && (
        <PanelBlock title="배경">
          <Swatches options={EMAIL_BACKGROUND_SWATCHES} value={(selected as any).background || 'none'} onChange={(v) => updateSection({ background: (v === 'none' ? undefined : v) } as Partial<Section>)} />
        </PanelBlock>
      )}
      {EMAIL_ACCENT_AWARE.has(selected.type) && (
        <PanelBlock title="색" hint={selected.accent_color ? undefined : '브랜드 색'}>
          <Swatches options={[{ value: '', color: brand, label: '브랜드 색' }, { value: '#2b2320', color: '#2b2320', label: '진한 갈색' }, { value: '#c9a86b', color: '#c9a86b', label: '금색' }, { value: '#0f766e', color: '#0f766e', label: '청록' }]} value={selected.accent_color || ''} onChange={(v) => updateSection({ accent_color: v || undefined })} custom={{ value: selected.accent_color || brand, onChange: (hex) => updateSection({ accent_color: hex }) }} />
        </PanelBlock>
      )}
      {(selected.type === 'hero' || selected.type === 'text_card' || EMAIL_ALIGN_AWARE.has(selected.type)) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-t border-slate-200">
          {(selected.type === 'hero' || selected.type === 'text_card') && (
            <div>
              <div className="text-[12.5px] font-bold text-slate-900 mb-2.5">제목 강조</div>
              <Segmented value={((selected.props as any)?.headline_emphasis || '') as string} onChange={(v) => updateProps({ headline_emphasis: v || undefined })} options={[{ value: '', label: '없음' }, { value: 'marker', label: '형광펜' }, { value: 'underline', label: '밑줄' }]} />
            </div>
          )}
          {EMAIL_ALIGN_AWARE.has(selected.type) && (
            <div>
              <div className="text-[12.5px] font-bold text-slate-900 mb-2.5">정렬</div>
              <AlignControl value={(selected.align as any) || 'center'} onChange={(v) => updateSection({ align: v })} />
            </div>
          )}
        </div>
      )}
      {EMAIL_MOTIF_AWARE.has(selected.type) && (
        <PanelBlock title="포인트 장식" hint={`테마: ${emailMotifLabel(design?.art_direction?.accentMotif)}`}>
          <Segmented value={(selected.motif || '') as string} onChange={(v) => updateSection({ motif: (v || undefined) as Section['motif'] })} options={[{ value: '', label: '테마 따라' }, { value: 'none', label: '숨김' }]} />
        </PanelBlock>
      )}
      <PanelBlock title="받는 사람에 맞추기" hint="칸을 누른 뒤 변수를 누르면 그 자리에 들어가요">
        <div className="flex flex-wrap gap-1.5">
          {emailVars.map((v) => <button key={v.token} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.token, v.label)} className="h-7 px-2.5 rounded-full text-[11.5px] text-slate-600 border border-slate-300 bg-white hover:bg-violet-100">{v.label}</button>)}
        </div>
        <label className="flex items-center gap-2 mt-3 text-[12px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={!!selected.display_condition} onChange={(e) => updateSection({ display_condition: e.target.checked ? { field: 'grade', op: 'eq', value: '' } : undefined })} className="accent-violet-600" />특정 고객에게만 보이기
        </label>
        {selected.display_condition && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            <select value={selected.display_condition.field} onChange={(e) => updateSection({ display_condition: { ...selected.display_condition!, field: e.target.value } })} className="h-8 px-2 rounded-lg bg-slate-100 border border-slate-300 text-[12px] text-slate-900">
              {emailVars.filter((v) => v.field !== 'name').map((v) => <option key={v.field} value={v.field}>{v.label}</option>)}
            </select>
            <select value={selected.display_condition.op} onChange={(e) => updateSection({ display_condition: { ...selected.display_condition!, op: e.target.value as any } })} className="h-8 px-2 rounded-lg bg-slate-100 border border-slate-300 text-[12px] text-slate-900">
              <option value="eq">같음</option><option value="ne">다름</option><option value="gte">이상</option><option value="lte">이하</option><option value="gt">초과</option><option value="lt">미만</option><option value="contains">포함</option>
            </select>
            <input value={selected.display_condition.value} onChange={(e) => updateSection({ display_condition: { ...selected.display_condition!, value: e.target.value } })} placeholder="값(예: VIP)" className="h-8 w-24 px-2 rounded-lg bg-slate-100 border border-slate-300 text-[12px] text-slate-900" />
          </div>
        )}
      </PanelBlock>
    </div>
  ) : (
    <div className="flex flex-col min-h-full">
      <Head icon={<Palette className="w-5 h-5" />} title="전체 설정" sub="블록을 고르지 않았을 때 · 이메일 전체에 적용" />
      <PanelBlock title="디자인 테마" hint="색·서체·조판만 바뀌고 내용은 그대로">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setThemeOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-100"><Palette className="w-4 h-4" />테마 고르기</button>
          <button type="button" onClick={() => setFontOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-100"><Type className="w-4 h-4" />서체 고르기</button>
          <span className="text-[11.5px] text-slate-400">{design?.theme ? `지금: ${design.theme}` : '지금: 기본'}</span>
        </div>
      </PanelBlock>
      <PanelBlock title="AI로 다시 구성" hint="블록 전체를 새로 짜요">
        <div className="space-y-2">
          <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2} placeholder="예: 가을 신상 안내, VIP에게 정중한 톤" className="w-full px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 text-[12.5px] text-slate-900 placeholder-slate-400 outline-none resize-none" />
          <textarea value={aiEvent} onChange={(e) => setAiEvent(e.target.value)} rows={3} placeholder={'행사·상품 정보 붙여넣기(선택)\n상품명 · 가격 · 주소를 넣으면 상품 카드가 원문 그대로 만들어져요'} className="w-full px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 text-[12px] text-slate-900 placeholder-slate-400 outline-none resize-none" />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => { void generate(); }} disabled={!!aiBusy || (!aiPrompt.trim() && !aiEvent.trim())} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40">{aiBusy === 'gen' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}AI로 만들기 · {AI_GENERATE_COSTS['email-ai-generate']}</button>
            <button type="button" onClick={() => { void refine(); }} disabled={!!aiBusy || sections.length === 0} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold text-fuchsia-900 border border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100 disabled:opacity-40">{aiBusy === 'refine' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}문구 다듬기 · 1</button>
          </div>
          <MaterialQuickPanel channel="email" isAd={isAd} disabled={!!aiBusy} onToast={(m, t) => onToast(m, t)} onDone={({ data }) => {
            const g = data || {};
            record();
            setSections(normalizeOrder(g.sections || []));
            setSelectedId(g.sections?.[0]?.id || null);
            if (!subject && g.subjects?.[0]) setSubject(g.subjects[0]);
            if (g.preheader) setDesign((x) => ({ ...(x || {}), preheader: String(g.preheader).slice(0, 90) }));
            onToast(`재료로 블록 ${Array.isArray(g.sections) ? g.sections.length : 0}개를 만들었어요.`, 'success');
          }} />
        </div>
      </PanelBlock>
      <PanelBlock title="완성" hint={completedState ? '완성한 이메일이에요' : '처음 보낼 때 한 번 완성돼요'}>
        {completedState ? <div className="text-[12.5px] text-emerald-700">완성됨 · 테스트 발송·HTML 저장·발송에 추가 크레딧이 없어요</div> : (
          <button type="button" onClick={completeOnly} disabled={!!aiBusy} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"><Lock className="w-4 h-4" />보내지 않고 완성만 하기 · {CONFIRM_CREDIT_COSTS['email-campaign-complete']}</button>
        )}
      </PanelBlock>
    </div>
  );

  const beforeSend = async () => {
    if (!canSave) { onToast('받은편지함 제목과 블록이 있어야 보낼 수 있어요.', 'warning'); return false; }
    if (dirty || !campaignId) return !!(await persist());
    return true;
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-100 overflow-y-auto lg:overflow-hidden">
      <EditShell
        title={name}
        onTitle={(v) => { record(); setName(v); }}
        save={save}
        channel="email"
        pair={pairDmId ? { onSwitch: () => { void (dirty && canSave ? persist() : Promise.resolve(null)).then(() => navigate(`/dm-builder?id=${encodeURIComponent(pairDmId)}${campaignId ? `&pair=${encodeURIComponent(campaignId)}` : ''}`)); } } : null}
        onBack={leave}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        onSend={() => { void beforeSend().then((ok) => { if (ok) setSendOpen(true); }); }}
        banner={buildBar ? (
          <BuildResultBar handoff={buildBar} collapsed={dirty} onDismiss={() => { clearBuildResult(); setBuildBar(null); }} onRegenerate={() => { clearBuildResult(); setBuildBar(null); onClose(); navigate('/quick-campaign?channel=email&regen=1'); }} />
        ) : lineAssist && lineBarOn ? (
          <ZoneCompletion
            items={lineItems}
            onItem={(it) => { if (it.action === '채우기' || it.action === '넣기') setLineSheet(true); }}
            action={lineFields.length > 0 ? { label: '채우기', onClick: () => setLineSheet(true) } : null}
            onDismiss={() => setLineBarOn(false)}
          />
        ) : undefined}
        left={left}
        center={center}
        right={right}
      />
      {themeOpen && <EmailDesignThemeModal current={design} onApply={(d) => { record(); setDesign(d); }} onReset={() => { record(); setDesign((x) => (x?.preheader ? { preheader: x.preheader } : null)); }} onClose={() => setThemeOpen(false)} />}
      {fontOpen && <EmailFontModal current={design} onApply={(d) => { record(); setDesign(d); }} onReset={() => { record(); setDesign((x) => { if (!x) return null; const { font_family: _f, font_display: _d, ...rest } = x; return Object.keys(rest).length ? rest : null; }); }} onClose={() => setFontOpen(false)} />}
      <MakeSendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        channel="email"
        dm={null}
        email={campaignId ? { id: campaignId, name, subject, isAd, completed: completedState, hasPlaceholder } : null}
        beforeSend={async () => beforeSend()}
        onSent={() => { onSaved(); onClose(); }}
        onSmtpChanged={onSaved}
      />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      {lineAssist && (
        <LineFactsSheet
          open={lineSheet && lineFields.length > 0}
          onClose={() => setLineSheet(false)}
          title="한 가지만 더 알려 주시면 이렇게 좋아져요"
          reason="적어 주신 그대로만 씁니다 · 지금 이메일은 그대로 남아요"
          line={lineAssist.text}
          primary={lineRegenReady
            ? { label: `넣고 새로 만들기 · ${AI_GENERATE_COSTS['email-ai-generate']}크레딧`, tone: 'amber', onClick: regenLineWithBenefit, note: '새 이메일로 만들어요' }
            : { label: '채우기 · 무료', tone: 'indigo', disabled: !lineFillable, onClick: applyLineFill }}
        >
          <LineFacts fields={lineFields} values={lineValues} onChange={setLineValues} allowNone={false} />
        </LineFactsSheet>
      )}
    </div>
  );
}

function Head({ icon, title, sub, right }: { icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
      <span className="w-10 h-10 rounded-xl bg-violet-100 text-violet-800 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0 flex-1"><b className="block text-[15px] text-slate-900 truncate">{title}</b><span className="block text-[11.5px] text-slate-500 truncate">{sub}</span></div>
      {right}
    </div>
  );
}
function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30 ${danger ? 'text-rose-700 hover:bg-rose-100' : 'text-slate-600 hover:bg-slate-100'}`}>{children}</button>;
}
function Counter({ value, max, onChange, placeholder }: { value: string; max: number; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full h-11 pl-3.5 pr-16 rounded-xl bg-slate-100 border border-slate-300 text-[13.5px] text-slate-900 placeholder-slate-400 outline-none focus:border-violet-300" />
      <em className="not-italic absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{value.length} / {max}</em>
    </div>
  );
}
