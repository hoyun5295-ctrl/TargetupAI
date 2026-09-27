/**
 * QuickCampaignResultPage — 결과 화면(★ 2026-09-27 만들기 개편 · 설계서 §2 · 목업 ④)
 *
 * 주소 `/quick-campaign/result?channel=dm|email&draft=<id>&pair=<다른 채널 id>`.
 *   왼쪽 = 고칠 곳(서버 검수 판정 · 보내기 전에 채울 곳 먼저) · 가운데 = 받는 사람이 볼 실물(서버 렌더 · 블록 누르면 아래 시트에서 그 자리만)
 *   오른쪽 = 다른 채널(같은 재료로 1클릭 · 이미 있으면 그 실물) · 머리 = [자세히 편집](옛 딥링크 그대로) · [보내기](보내기 창).
 * 여기서 고친 DM 은 스토어 자동 저장(초안 = 발행 전이라 라이브 주소 없음). 이메일은 여기서 고치지 않는다(자세히 편집).
 * ⛔ 자동 발행 0 · 모델명 0 · native dialog 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, PenLine, Send, Smartphone, Mail, Check, AlertCircle, Eye, RotateCcw, ShoppingBag, Loader2, Monitor, Info } from 'lucide-react';
import { OUI_PAGE, OUI_PAGE_CENTER } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { useDmBuilderStore, selectAllSectionsFlat } from '../stores/dmBuilderStore';
import PreviewFrame from '../components/make/PreviewFrame';
import { PcBigModal } from '../components/make/PreviewPair';
import BlockSheet from '../components/make/BlockSheet';
import MakeSendModal from '../components/make/MakeSendModal';
import AiImproveModal from '../components/dm/modals/AiImproveModal';
import { useDmStorePreview } from '../components/make/useDmStorePreview';
import { fetchEmailPreview, useRenderedHtml } from '../hooks/useRenderedHtml';
import {
  buildErrorMessage, buildMaterialsPayload, loadBuildDraft, newAttemptToken, peekBuildResult, unappliedItemsOf,
} from '../utils/ai-build';
import { AI_GENERATE_COSTS } from '../constants/credit';
import { fixHeadline, fixItemsOf, makeResultPath, type FixItem, type MakeChannel } from '../utils/make-flow';
import { MK_BTN_AI, MK_BTN_GHOST, MK_BTN_PRIMARY, MK_BACK, MK_HEADER, MK_HEADER_ROW, MK_SUB, MK_TILE, MK_TITLE } from '../utils/make-ui';
import type { EmailCampaign } from '../components/email/email-campaign-types';
import '../styles/make.css';

const token = () => localStorage.getItem('token');
const authJson = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
const PHONE_W = 316;

export default function QuickCampaignResultPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const channel: MakeChannel = params.get('channel') === 'email' ? 'email' : 'dm';
  const draftId = String(params.get('draft') || '').trim();
  const pairId = String(params.get('pair') || '').trim() || null;
  const dmId = channel === 'dm' ? draftId : pairId;
  const emailId = channel === 'email' ? draftId : pairId;

  // ── DM(스토어 = 수정 화면과 같은 저장 축) ──
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const storeDmId = useDmBuilderStore((s) => s.dmId);
  const loadError = useDmBuilderStore((s) => s.loadError);
  const [dmReady, setDmReady] = useState(false);
  useEffect(() => {
    if (!dmId) { setDmReady(false); return; }
    let alive = true;
    (async () => {
      await loadDm(dmId);
      if (alive) setDmReady(useDmBuilderStore.getState().dmId === dmId);
    })();
    return () => { alive = false; };
  }, [dmId, loadDm]);
  const dmPreview = useDmStorePreview(dmReady && storeDmId === dmId);
  const title = useDmBuilderStore((s) => s.title);
  const flat = useDmBuilderStore(selectAllSectionsFlat);
  const pages = useDmBuilderStore((s) => s.pages);
  const selectedId = useDmBuilderStore((s) => s.selectedSectionId);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const selectPage = useDmBuilderStore((s) => s.selectPage);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const removeSection = useDmBuilderStore((s) => s.removeSection);
  const save = useDmBuilderStore((s) => s.save);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const isSaving = useDmBuilderStore((s) => s.isSaving);
  const openModal = useDmBuilderStore((s) => s.openModal);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const storeName = useDmBuilderStore((s) => s.storeName);
  const [sheetOpen, setSheetOpen] = useState(false);

  const focusSection = useCallback((id: string | null) => {
    if (!id) { selectSection(null); return; }
    const st = useDmBuilderStore.getState();
    const idx = st.pages.findIndex((p) => p.sections.some((s) => s.id === id));
    if (idx >= 0 && idx !== st.currentPageIndex) selectPage(idx);
    selectSection(id);
  }, [selectPage, selectSection]);
  const selected = useMemo(() => flat.find((s) => s.id === selectedId) || null, [flat, selectedId]);

  // 검수(서버 · 차감 0) — 저장이 끝난 뒤마다 다시 본다
  const [validation, setValidation] = useState<any>(null);
  const validateSeq = useRef(0);
  const runValidate = useCallback(async () => {
    if (!dmId) return;
    const my = ++validateSeq.current;
    try {
      const r = await fetch(`/api/dm/${dmId}/validate`, { method: 'POST', headers: authJson(), body: '{}' });
      const d = await r.json().catch(() => null);
      if (my === validateSeq.current && r.ok && d) setValidation(d);
    } catch { /* 다음 저장 뒤 다시 */ }
  }, [dmId]);
  useEffect(() => { if (dmReady && !isDirty && !isSaving) void runValidate(); }, [dmReady, isDirty, isSaving, runValidate]);

  const handoff = useMemo(() => (dmId ? peekBuildResult(dmId) : null) || (emailId ? peekBuildResult(emailId) : null), [dmId, emailId]);
  const draft = useMemo(() => loadBuildDraft(), []);
  const extraInfo = useMemo(() => {
    const out = handoff ? unappliedItemsOf(handoff) : [];
    // 직접 적은 상품(몰 미연동)은 카드가 아니라 글로 실린다(재료 계약 · 서버 resolveBuildProducts)
    if (draft?.products?.some((p) => p.source === 'manual')) out.unshift('상품이 글로 실렸어요 · 몰을 연동하면 사진과 구매 버튼이 붙어요');
    return out;
  }, [handoff, draft]);
  const dmItems: FixItem[] = useMemo(() => (dmReady ? fixItemsOf(validation, flat, extraInfo) : []), [dmReady, validation, flat, extraInfo]);

  // ── 이메일(여기서는 보기만 · 고치기 = 자세히 편집) ──
  const [email, setEmail] = useState<EmailCampaign | null>(null);
  const [emailSmtp, setEmailSmtp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!emailId) { setEmail(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/email/campaigns/${encodeURIComponent(emailId)}`, { headers: authJson() });
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok && d?.success && d.campaign) setEmail(d.campaign as EmailCampaign);
      } catch { /* 칸만 비운다 */ }
      try {
        const r = await fetch('/api/email/status', { headers: authJson() });
        const d = await r.json().catch(() => ({}));
        if (alive) setEmailSmtp(!!d?.smtp_configured);
      } catch { /* 모름 */ }
    })();
    return () => { alive = false; };
  }, [emailId]);
  const emailKey = email ? `${email.id}|${JSON.stringify(email.sections || [])}|${JSON.stringify(email.design || null)}|${email.isAd}` : null;
  const emailPreview = useRenderedHtml(emailKey, (signal) => fetchEmailPreview({ sections: email?.sections || [], design: email?.design, is_ad: !!email?.isAd, campaign_id: email?.id }, signal), 0);
  const emailItems: FixItem[] = useMemo(() => {
    if (!email) return [];
    const out: FixItem[] = [];
    if (email.hasPlaceholder) out.push({ kind: 'must', title: '직접 채울 자리가 남았어요', sub: '[자세히 편집]에서 채워 주세요', action: '고치기' });
    if (!email.subject?.trim()) out.push({ kind: 'must', title: '받은편지함 제목이 비었어요', sub: '[자세히 편집]에서 넣어 주세요', action: '고치기' });
    if (emailSmtp === false) out.push({ kind: 'suggest', title: '회사 메일 연결이 필요해요', sub: '만들기와 미리보기는 지금 돼요 · 보낼 때 연결해요' });
    if (email.subject?.trim()) out.push({ kind: 'ok', title: '받은편지함 제목 있음' });
    if (!email.hasPlaceholder) out.push({ kind: 'ok', title: '채울 자리 없음' });
    if (email.isAd) out.push({ kind: 'ok', title: '광고 표기·수신거부 자동' });
    return out;
  }, [email, emailSmtp]);
  const items = channel === 'dm' ? dmItems : emailItems;
  const head = fixHeadline(items);

  // ── 같은 재료로 다른 채널 1클릭(견적 = 서버 · 작은 차감이라 확인 창 없이 버튼에 금액) ──
  const otherChannel: MakeChannel = channel === 'dm' ? 'email' : 'dm';
  const otherCost = AI_GENERATE_COSTS[otherChannel === 'email' ? 'email-ai-generate' : 'dm-ai-generate'];
  const [makingOther, setMakingOther] = useState(false);
  const makeOther = useCallback(async () => {
    if (!draft || makingOther) return;
    setMakingOther(true);
    try {
      const base = { ...draft, channel: otherChannel as 'dm' | 'email' };
      const q = await fetch('/api/event-campaigns/materials/quote', { method: 'POST', headers: authJson(), body: JSON.stringify({ materials: buildMaterialsPayload(base, newAttemptToken(), 0) }) });
      const qd = await q.json().catch(() => ({}));
      if (!q.ok || qd?.success === false) throw new Error(buildErrorMessage(qd?.code, qd?.error, '견적을 계산하지 못했어요.'));
      if (qd?.gate && qd.gate.ok === false) throw new Error('재료가 부족해 만들 수 없어요. 만들기 화면에서 재료를 더 넣어 주세요.');
      const materials = buildMaterialsPayload(base, newAttemptToken(), Number(qd.total) || 0);
      const url = otherChannel === 'email' ? '/api/email/ai/generate-sections' : '/api/dm/ai/one-shot-generate';
      const r = await fetch(url, { method: 'POST', headers: authJson(), body: JSON.stringify({ materials }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) throw new Error(buildErrorMessage(d?.code, d?.error, '만들지 못했어요. 잠시 후 다시 시도해 주세요.'));
      const newId = String(d?.data?.draft_id || '');
      if (!newId) throw new Error('만들었지만 초안을 찾지 못했어요. 목록에서 확인해 주세요.');
      toast.success(otherChannel === 'email' ? '같은 재료로 이메일을 만들었어요.' : '같은 재료로 모바일 DM을 만들었어요.');
      setParams(new URLSearchParams(makeResultPath(channel, draftId, newId).split('?')[1]), { replace: true });
    } catch (e: any) {
      toast.error(e?.message || '만들지 못했어요.');
    } finally {
      setMakingOther(false);
    }
  }, [draft, makingOther, otherChannel, channel, draftId, setParams, toast]);

  // ── 보내기 · 다시 만들기 · PC 크게 보기 ──
  const [sendOpen, setSendOpen] = useState(false);
  const [pcOpen, setPcOpen] = useState<null | 'dm' | 'email'>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const saveBarrier = useCallback(async () => {
    const st = () => useDmBuilderStore.getState();
    for (let i = 0; i < 40 && st().isSaving; i++) await new Promise((r) => setTimeout(r, 150)); // eslint-disable-line no-await-in-loop
    if (st().dmId && st().isDirty) await st().save({ silent: true });
    return !st().isDirty;
  }, []);
  const heroSub = useMemo(() => String((flat.find((s) => s.type === 'hero')?.props as any)?.sub_copy || ''), [flat]);

  const suggestions = useMemo(() => {
    const out: Array<{ label: string; url: string; icon: 'home' | 'recent' }> = [];
    const site = String(brandKit?.contact?.website || '').trim();
    if (site) out.push({ label: '우리 홈페이지', url: /^https?:\/\//.test(site) ? site : `https://${site}`, icon: 'home' });
    const recent = flat.flatMap((s) => (s.type === 'cta' ? ((s.props as any)?.buttons || []) : [])).map((b: any) => String(b?.url || '').trim()).find((u: string) => /^https?:\/\//.test(u));
    const readLink = draft?.cards?.find((c) => c.link)?.link;
    const r = recent || readLink;
    if (r && r !== out[0]?.url) out.push({ label: `최근 쓴 주소 · ${r.replace(/^https?:\/\//, '').slice(0, 32)}`, url: r, icon: 'recent' });
    return out;
  }, [brandKit, flat, draft]);

  if (!draftId) return <div className={OUI_PAGE_CENTER}><span className="text-white/60 text-sm">열 초안이 없어요.</span></div>;

  const primaryLoading = channel === 'dm' ? (!dmReady && !loadError) : !email;
  const sendLocked = head.count > 0;
  const titleText = channel === 'dm' ? (title || '모바일 DM') : (email?.name || '이메일');
  // 같은 재료로 만든 짝(DM ↔ 이메일)을 수정 화면 머리 전환에 넘긴다
  const editPath = (c: MakeChannel, id: string) => {
    const other = c === 'dm' ? emailId : dmId;
    const pair = other && other !== id ? `&pair=${encodeURIComponent(other)}` : '';
    return c === 'dm' ? `/dm-builder?id=${encodeURIComponent(id)}${pair}` : `/email-campaigns?edit=${encodeURIComponent(id)}${pair}`;
  };

  return (
    <div className={`${OUI_PAGE} flex flex-col`} style={{ height: '100vh', overflow: 'hidden' }}>
      <OperatorAura />
      <div className={MK_HEADER}>
        <div className={`${MK_HEADER_ROW}`}>
          <button onClick={() => goBackOr(navigate, channel === 'dm' ? '/dm-builder' : '/email-campaigns')} className={MK_BACK} aria-label="돌아가기"><ArrowLeft className="w-5 h-5" /></button>
          <div className={`${MK_TILE} bg-gradient-to-br from-amber-400 to-fuchsia-500`}><Sparkles className="w-5 h-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className={MK_TITLE}>
              <span className="truncate">{titleText}</span>
              {items.length > 0 && (head.count > 0
                ? <span className="shrink-0 text-[11.5px] font-bold text-amber-300 bg-amber-500/15 border border-amber-400/40 rounded-full px-2 py-0.5">고칠 곳 {head.count}</span>
                : <span className="shrink-0 text-[11.5px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/40 rounded-full px-2 py-0.5">보낼 준비 완료</span>)}
            </h1>
            <p className={MK_SUB}>초안 · 방금 만들었어요 · 받는 사람이 보는 그대로 보여 드려요</p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => navigate(editPath(channel, draftId))} className={MK_BTN_GHOST}><PenLine className="w-4 h-4" /><span className="hidden sm:inline">자세히 편집</span></button>
            <div className="relative">
              <button type="button" onClick={() => { if (sendLocked) { const first = items.find((i) => i.kind === 'must' && i.sectionId); if (first?.sectionId) { focusSection(first.sectionId); setSheetOpen(true); } else toast.warning('고칠 곳을 먼저 채워 주세요.'); return; } setSendOpen(true); }}
                className={`${MK_BTN_PRIMARY} ${sendLocked ? 'opacity-60' : ''}`}><Send className="w-4 h-4" />보내기</button>
              {sendLocked && <div className="absolute right-0 top-full mt-1 whitespace-nowrap text-[11px] font-semibold text-amber-300">{items.find((i) => i.kind === 'must')?.title === '버튼이 갈 주소가 없어요' ? '링크를 넣으면 보내기가 열려요' : '고칠 곳을 채우면 보내기가 열려요'}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* 왼쪽 — 고칠 곳 */}
        <aside className="hidden md:flex w-[272px] shrink-0 flex-col border-r border-white/10 px-5 py-5">
          <div className="text-[11.5px] text-white/45 mb-2">고칠 곳</div>
          <div className={`text-[15px] font-bold mb-4 ${head.tone === 'warn' ? 'text-white' : head.tone === 'good' ? 'text-emerald-300' : 'text-white'}`}>
            {head.tone === 'warn' ? <>보내기 전에 <b className="text-amber-300">{head.count}곳</b>만 채워 주세요</> : head.text}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto mk-scroll space-y-2.5">
            {primaryLoading && <Loader2 className="w-5 h-5 animate-spin text-white/40" />}
            {items.map((it, i) => <FixRow key={i} item={it} onClick={() => {
              if (channel === 'dm' && it.sectionId) { focusSection(it.sectionId); setSheetOpen(true); }
              else if (channel === 'email' && it.kind === 'must') navigate(editPath('email', draftId));
            }} />)}
          </div>
          <div className="pt-4 space-y-2.5 border-t border-white/10 mt-3">
            <button type="button" onClick={() => navigate(`/quick-campaign?channel=${channel}`)} className="flex items-center gap-2 text-[12.5px] text-white/65 hover:text-white"><Eye className="w-4 h-4" />넣은 재료 다시 보기</button>
            {draft && (
              <button type="button" onClick={() => setConfirm({
                mode: 'warning', title: '같은 재료로 다시 만들까요?',
                description: `지금 고친 내용 대신 새 초안을 만들어요(${AI_GENERATE_COSTS[channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate']} 크레딧). 지금 초안은 목록에 그대로 남아요.`,
                confirmLabel: '다시 만들기', onConfirm: () => navigate(`/quick-campaign?channel=${channel}&regen=1`),
              })} className="flex items-center gap-2 text-[12.5px] text-white/65 hover:text-white"><RotateCcw className="w-4 h-4" />다시 만들기 · {AI_GENERATE_COSTS[channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate']} 크레딧</button>
            )}
            <div className="text-[11px] text-white/35">{channel === 'dm' ? '여기서 고친 내용은 바로 저장돼요' : '이메일은 [자세히 편집]에서 고쳐요'}</div>
          </div>
        </aside>

        {/* 가운데 — 받는 사람 실물 */}
        <main className="flex-1 min-w-0 flex flex-col items-center border-r border-white/10 px-4 py-5 overflow-hidden">
          <div className="w-full max-w-[380px] flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/85">{channel === 'dm' ? <Smartphone className="w-4 h-4 text-violet-300" /> : <Mail className="w-4 h-4 text-violet-300" />}{channel === 'dm' ? '모바일 DM' : '이메일'}</div>
            <div className="flex items-center gap-3 text-[11.5px] text-white/45">
              <span>받는 사람 화면 그대로</span>
              <button type="button" onClick={() => setPcOpen(channel)} className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"><Monitor className="w-3.5 h-3.5" />PC</button>
            </div>
          </div>
          <PhoneShell
            html={channel === 'dm' ? dmPreview.html : emailPreview.html}
            loading={channel === 'dm' ? dmPreview.loading : emailPreview.loading}
            error={channel === 'dm' ? (loadError || dmPreview.error) : emailPreview.error}
            selectedId={channel === 'dm' ? selectedId : null}
            onTap={channel === 'dm' ? (id) => { focusSection(id); setSheetOpen(true); } : undefined}
            inbox={channel === 'email' && email ? { from: email.fromName || '', subject: email.subject } : null}
          />
          {channel === 'dm' && <div className="text-[11.5px] text-white/40 mt-2.5 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" />블록을 누르면 그 자리만 고칠 수 있어요</div>}
        </main>

        {/* 오른쪽 — 다른 채널 */}
        <section className="hidden lg:flex w-[min(34vw,470px)] shrink-0 flex-col px-6 py-5 overflow-hidden">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/85 mb-3">{otherChannel === 'email' ? <Mail className="w-4 h-4 text-violet-300" /> : <Smartphone className="w-4 h-4 text-violet-300" />}{otherChannel === 'email' ? '이메일' : '모바일 DM'}</div>
          {otherChannel === 'email' && email ? (
            <div className="flex-1 min-h-0 flex flex-col items-center">
              <PhoneShell html={emailPreview.html} loading={emailPreview.loading} error={emailPreview.error} inbox={{ from: email.fromName || '', subject: email.subject }} small />
              <div className="flex items-center gap-3 mt-3">
                <button type="button" onClick={() => setPcOpen('email')} className="text-[12.5px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"><Monitor className="w-3.5 h-3.5" />PC로 보기</button>
                <button type="button" onClick={() => navigate(editPath('email', email.id))} className="text-[12.5px] text-white/65 hover:text-white inline-flex items-center gap-1"><PenLine className="w-3.5 h-3.5" />이메일 자세히 편집</button>
              </div>
            </div>
          ) : otherChannel === 'dm' && pairId && dmReady ? (
            <div className="flex-1 min-h-0 flex flex-col items-center">
              <PhoneShell html={dmPreview.html} loading={dmPreview.loading} error={dmPreview.error} small />
              <button type="button" onClick={() => navigate(editPath('dm', pairId))} className="mt-3 text-[12.5px] text-white/65 hover:text-white inline-flex items-center gap-1"><PenLine className="w-3.5 h-3.5" />DM 자세히 편집</button>
            </div>
          ) : (
            <div className="relative flex-1 min-h-0 rounded-2xl border border-dashed border-white/15 overflow-hidden">
              <div className="absolute inset-0 p-5 space-y-4 opacity-40" aria-hidden>
                <div className="flex gap-3 items-center"><span className="w-8 h-8 rounded-full bg-white/10" /><span className="h-2.5 rounded bg-white/10 flex-1" /></div>
                <div className="h-24 rounded-xl bg-white/[0.06]" /><div className="h-24 rounded-xl bg-white/[0.06]" /><div className="h-3 rounded bg-white/[0.06] w-2/3" />
              </div>
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-slate-900/95 p-5 text-center shadow-2xl">
                <div className="text-[15px] font-bold text-white">같은 재료로 {otherChannel === 'email' ? '이메일' : '모바일 DM'}도 만들 수 있어요</div>
                <div className="text-[12.5px] text-white/55 mt-1.5">{channel === 'dm' ? 'DM' : '이메일'}에 넣은 사진·문구·상품을 그대로 씁니다. 다시 넣을 것은 없어요.</div>
                {draft ? (
                  <button type="button" onClick={() => { void makeOther(); }} disabled={makingOther} className={`${MK_BTN_AI} h-[42px] px-5 text-[13.5px] mt-4`}>
                    {makingOther ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{otherChannel === 'email' ? '이메일도 만들기' : '모바일 DM도 만들기'}
                    <span className="text-[11px] font-bold bg-white/45 rounded-md px-1.5 py-0.5">{otherCost} 크레딧</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => navigate(`/quick-campaign?channel=${otherChannel}`)} className={`${MK_BTN_GHOST} mt-4`}>만들기 화면에서 {otherChannel === 'email' ? '이메일' : 'DM'} 만들기</button>
                )}
                {otherChannel === 'email' && emailSmtp === false && <div className="text-[11.5px] text-amber-300 mt-3 inline-flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />보내려면 회사 메일 연결이 필요해요. 만들기와 미리보기는 지금 돼요.</div>}
              </div>
            </div>
          )}
        </section>
      </div>

      {sheetOpen && channel === 'dm' && selected && (
        <BlockSheet
          section={selected}
          onUpdate={(patch) => updateSectionProps(selected.id, patch)}
          onClose={() => setSheetOpen(false)}
          onRemove={() => setConfirm({ mode: 'danger', title: '이 블록을 뺄까요?', description: '빼도 [자세히 편집]의 되돌리기로 살릴 수 있어요.', confirmLabel: '빼기', onConfirm: () => { removeSection(selected.id); setSheetOpen(false); } })}
          onDone={async () => { await save({ silent: true }); setSheetOpen(false); }}
          saving={isSaving}
          suggestions={suggestions}
          onAiRewrite={() => setOpenModal('ai-improve')}
        />
      )}
      <AiImproveModal open={openModal === 'ai-improve'} onClose={() => setOpenModal(null)} />
      <MakeSendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        channel={channel}
        dm={dmId && dmReady ? { id: dmId, title, heroSub, brand: storeName || null } : null}
        email={email ? { id: email.id, name: email.name, subject: email.subject, isAd: email.isAd, completed: !!email.completed, hasPlaceholder: email.hasPlaceholder } : null}
        beforeSend={async (c) => (c === 'dm' ? saveBarrier() : true)}
        makeOther={draft ? { channel: otherChannel, label: `${otherChannel === 'email' ? '이메일' : 'DM'}도 만들기 · ${otherCost}`, busy: makingOther, run: () => { void makeOther(); } } : null}
        onSent={() => navigate(channel === 'dm' ? '/dm-builder' : '/email-campaigns')}
        onOpenAdvancedDm={dmId ? () => navigate(`/dm-builder?id=${encodeURIComponent(dmId)}&send=1`) : undefined}
      />
      {pcOpen && <PcBigModal kind={pcOpen === 'email' ? 'email' : dmPreview.kind} html={pcOpen === 'email' ? emailPreview.html : dmPreview.html} onClose={() => setPcOpen(null)} />}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function FixRow({ item, onClick }: { item: FixItem; onClick: () => void }) {
  if (item.kind === 'ok') return <div className="flex items-center gap-2 text-[13px] text-white/80"><Check className="w-4 h-4 text-emerald-400 shrink-0" />{item.title}</div>;
  if (item.kind === 'info') return <div className="flex gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[12px] text-white/65"><ShoppingBag className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />{item.title}</div>;
  const must = item.kind === 'must';
  return (
    <button type="button" onClick={onClick} className={`w-full text-left flex items-start gap-2.5 rounded-xl border px-3 py-3 ${must ? 'border-amber-400/50 bg-amber-500/[0.07] hover:bg-amber-500/[0.12]' : 'border-violet-400/40 bg-violet-500/[0.07] hover:bg-violet-500/[0.12]'}`}>
      {must ? <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" /> : <Sparkles className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />}
      <span className="flex-1 min-w-0">
        <b className="block text-[13px] text-white leading-snug">{item.title}</b>
        {item.sub && <span className="block text-[11.5px] text-white/55 mt-0.5">{item.sub}</span>}
      </span>
      {item.action && <em className={`not-italic shrink-0 text-[11.5px] font-bold rounded-md px-2 py-1 ${must ? 'bg-amber-400 text-amber-950' : 'bg-violet-500/30 text-violet-100'}`}>{item.action}</em>}
    </button>
  );
}

function PhoneShell({ html, loading, error, selectedId, onTap, inbox, small = false }: {
  html: string; loading?: boolean; error?: string | null; selectedId?: string | null; onTap?: (id: string) => void; inbox?: { from: string; subject: string } | null; small?: boolean;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setH(Math.max(360, Math.min(small ? 620 : 700, el.clientHeight - 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [small]);
  const w = small ? 280 : PHONE_W;
  const headH = inbox ? 64 : 0;
  return (
    <div ref={box} className="flex-1 min-h-0 w-full flex justify-center">
      <div className="mk-phone relative" style={{ width: w + 20, height: h + 20 }}>
        <div className="mk-phone-screen" style={{ width: w, height: h }}>
          {inbox && (
            <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-200 bg-white" style={{ height: headH }}>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[#9a4f2c] text-white text-[12px] font-bold flex items-center justify-center">{(inbox.from || 'H').slice(0, 1)}</span>
                <div className="min-w-0"><div className="text-[12px] font-bold text-slate-900 truncate">{inbox.from || '보내는 사람'}</div><div className="text-[10.5px] text-slate-500">지금 · 나에게</div></div>
              </div>
              <div className="text-[12.5px] font-bold text-slate-900 mt-1 truncate">{inbox.subject || '제목을 넣어 주세요'}</div>
            </div>
          )}
          {html ? (
            <PreviewFrame html={html} viewport={375} displayWidth={w} displayHeight={h - headH} tap={!!onTap} selectedId={selectedId} onTap={onTap} title="받는 사람 화면 미리보기" />
          ) : (
            <div className="flex items-center justify-center text-slate-400 text-[12px]" style={{ height: h - headH }}>
              {error ? <span className="inline-flex items-center gap-1.5 text-rose-500 px-4 text-center"><AlertCircle className="w-4 h-4 shrink-0" />{error}</span> : <Loader2 className="w-5 h-5 animate-spin" />}
            </div>
          )}
          {loading && html && <span className="absolute right-4 top-4 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin text-white" /></span>}
        </div>
      </div>
    </div>
  );
}
