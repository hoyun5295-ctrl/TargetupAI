/**
 * MakeSendModal — 보내기 창(★ 2026-09-27 만들기 개편 · 목업 ⑤ · 설계서 §1 불변 5·6)
 *
 * 채널 카드(모바일 DM · 이메일) 두 장. 고른 카드 안에서 받는 사람 · 문안 · 보낼 때 · 점검 · 크레딧 줄/발송 요금 줄 · [링크만 받기] · [N명에게 보내기].
 *   DM   = POST /api/dm/:id/send-to-target(검증된 발송 파이프라인 그대로) · 발행비는 선견적(GET publish-quote)으로 먼저 보이고
 *          누르는 순간 서버 값이 이긴다(PUBLISH_FEE_REQUIRED → 확인 창 → confirmPublishFee 재요청) · 잠금은 서버(S6~S8).
 *   이메일 = 완성(50 · 처음 한 번) → POST /api/email/campaigns/:id/send · 받는 사람 고르기는 EmailRecipientsModal(원본 이관).
 * 문자 기본 문안은 DM 내용으로 채운다(AI 0 · 자동 과금 0). 개별 회신(고객별 매장번호)은 보내는 번호 칸에서 고른다(★1007). 더 자세한 설정(AI 문안·꾸미기·스팸 검사)은 [자세히 설정] = 기존 발송 창.
 * ⛔ native dialog 0 · 모델명 0 · 금액 하드코딩 0(서버 견적·단가 표 CT).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Smartphone, Mail, Users, Type, Clock, Check, AlertCircle, Link2, Send, Loader2, Phone, Settings2, Copy, Sparkles,
} from 'lucide-react';
import { useToast } from '../ToastProvider';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import CreditConfirmModal from '../credit/CreditConfirmModal';
import { DateTimeField, isoToLocalInput, localInputToIso } from '../DateTimeField';
import TargetExtractModal, { type ExtractedTarget } from '../TargetExtractModal';
import EmailRecipientsModal from '../email/EmailRecipientsModal';
import SmtpConnectModal from '../email/SmtpConnectModal';
import type { EmailCampaign } from '../email/email-campaign-types';
import { hasUnsupportedSmsChars, SMS_CHARSET_BLOCK_MESSAGE } from '../../utils/smsSafeChars';
import { CONFIRM_CREDIT_COSTS } from '../../constants/credit';
import { defaultDmSmsText, isNightAdHour } from '../../utils/make-flow';
import { MK_BTN_OUTLINE, MK_BTN_PRIMARY, MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';

export interface SendDm { id: string; title: string; brand?: string | null; heroSub?: string | null }
export interface SendEmail { id: string; name: string; subject: string; isAd: boolean; completed: boolean; hasPlaceholder?: boolean }
export type SendChannel = 'dm' | 'email';

const token = () => localStorage.getItem('token');
const authGet = () => ({ Authorization: `Bearer ${token()}` });
const authJson = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
const fmt = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '-');
const pad = (n: number) => String(n).padStart(2, '0');
const localNextMorning = () => {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(10, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type When = 'now' | 'scheduled' | 'recommend';
/** 발신번호 select 특수값 — 고객별 등록매장 번호(개별 회신) · DmSendAndTrackModal 과 같은 값 */
const INDIVIDUAL_CB = '__individual__';

export default function MakeSendModal({
  open, onClose, channel: initialChannel, dm, email, beforeSend, makeOther, onSent, onOpenAdvancedDm, onSmtpChanged,
}: {
  open: boolean;
  onClose: () => void;
  channel: SendChannel;
  dm: SendDm | null;
  email: SendEmail | null;
  /** 보내기 전 저장 배리어(수정 중인 화면 = 저장 안 된 편집분을 먼저 저장) · false = 멈춤 */
  beforeSend?: (c: SendChannel) => Promise<boolean>;
  /** 없는 채널을 같은 재료로 만들기(결과 화면) */
  makeOther?: { channel: SendChannel; label: string; busy?: boolean; run: () => void } | null;
  onSent?: (c: SendChannel) => void;
  /** 기존 DM 발송 창(자세히 설정) */
  onOpenAdvancedDm?: () => void;
  /** 이메일 카드에서 회사 메일을 연결(저장)한 뒤 · 여는 화면이 연결 상태를 다시 읽는다(★2026-10-03) */
  onSmtpChanged?: () => void;
}) {
  const [active, setActive] = useState<SendChannel>(initialChannel);
  useEffect(() => { if (open) setActive(initialChannel); }, [open, initialChannel]);
  if (!open) return null;
  const other: SendChannel = active === 'dm' ? 'email' : 'dm';
  const otherExists = other === 'dm' ? !!dm : !!email;

  return (
    <div className={MK_MODAL_BACKDROP} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${MK_MODAL} w-full max-w-[560px] max-h-[94vh] overflow-y-auto mk-scroll p-5 md:p-6`} role="dialog" aria-label="보내기">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-bold text-slate-900">보내기</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        {active === 'dm' && dm && <DmCard dm={dm} beforeSend={beforeSend} onSent={() => { onSent?.('dm'); onClose(); }} onOpenAdvanced={onOpenAdvancedDm} />}
        {active === 'email' && email && <EmailCard email={email} beforeSend={beforeSend} onSent={() => { onSent?.('email'); onClose(); }} onSmtpChanged={onSmtpChanged} />}
        {((active === 'dm' && !dm) || (active === 'email' && !email)) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-500">먼저 저장된 초안이 있어야 보낼 수 있어요.</div>
        )}

        {/* 다른 채널 카드(접힘) */}
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3 flex-wrap">
          {other === 'email' ? <Mail className="w-4 h-4 text-violet-700 shrink-0" /> : <Smartphone className="w-4 h-4 text-violet-700 shrink-0" />}
          <b className="text-[14px] text-slate-900">{other === 'email' ? '이메일' : '모바일 DM'}</b>
          <span className="text-[12px] text-slate-500 flex-1 min-w-[160px]">
            {otherExists
              ? (other === 'email' ? `제목: ${email?.subject || '(제목 없음)'}` : `${dm?.title || '(제목 없음)'}`)
              : (makeOther && makeOther.channel === other ? '아직 만들지 않았어요 · 같은 재료로 바로 만들 수 있어요' : '아직 만들지 않았어요')}
          </span>
          {otherExists ? (
            <button type="button" onClick={() => setActive(other)} className={MK_BTN_OUTLINE}>{other === 'email' ? '이메일 보내기' : 'DM 보내기'}</button>
          ) : makeOther && makeOther.channel === other ? (
            <button type="button" onClick={makeOther.run} disabled={makeOther.busy} className={MK_BTN_OUTLINE}>
              {makeOther.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{makeOther.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── DM 카드 ───────────────────────────────────────────

interface Quote { required: boolean; cost: number; source: string }

function DmCard({ dm, beforeSend, onSent, onOpenAdvanced }: { dm: SendDm; beforeSend?: (c: SendChannel) => Promise<boolean>; onSent: () => void; onOpenAdvanced?: () => void }) {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  // ★ 2026-09-27 Codex 2R — [링크만 받기] = 첫 발행 규칙(via=publish)이라 발송용 견적(via=send · 발송 이력 있으면 0)과 다르다. 따로 받는다
  const [linkQuote, setLinkQuote] = useState<Quote | null>(null);
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  const [target, setTarget] = useState<ExtractedTarget | null>(null);
  const [targetFailed, setTargetFailed] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [callbacks, setCallbacks] = useState<Array<{ phone: string; isDefault: boolean }>>([]);
  const [callback, setCallback] = useState('');
  const [opt080, setOpt080] = useState<string | null>(null);
  const [fatal, setFatal] = useState<{ link: boolean; blocking: number } | null>(null);
  const [isAd, setIsAd] = useState(true);
  const [subject, setSubject] = useState((dm.title || '').trim().slice(0, 40));
  const [message, setMessage] = useState(() => defaultDmSmsText({ brand: dm.brand, title: dm.title, sub: dm.heroSub }));
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState<When>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState<null | 'send' | 'link'>(null);
  const [feeFor, setFeeFor] = useState<null | 'send' | 'link'>(null);
  const [feeSource, setFeeSource] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  const beforeRef = useRef(beforeSend);
  beforeRef.current = beforeSend;
  const [barrierFailed, setBarrierFailed] = useState(false);

  // 열 때 = 저장 배리어 → 선견적 · 잔액 · 전체 대상 수 · 발신번호 · 080 · 검수(링크·잠금)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (beforeRef.current && !(await beforeRef.current('dm'))) { if (alive) { setBarrierFailed(true); setBlockMsg('저장하지 못해 보낼 수 없어요. 잠시 뒤 다시 열어 주세요.'); } return; }
      const jobs: Array<Promise<void>> = [
        (async () => {
          const r = await fetch(`/api/dm/${dm.id}/publish-quote?via=send`, { headers: authGet() });
          const d = await r.json().catch(() => ({}));
          if (alive && r.ok && d?.success) setQuote({ required: !!d.required, cost: Number(d.cost) || 0, source: String(d.source || 'dm-builder') });
        })(),
        (async () => {
          const r = await fetch(`/api/dm/${dm.id}/publish-quote?via=publish`, { headers: authGet() });
          const d = await r.json().catch(() => ({}));
          if (alive && r.ok && d?.success) setLinkQuote({ required: !!d.required, cost: Number(d.cost) || 0, source: String(d.source || 'dm-builder') });
        })(),
        (async () => {
          const r = await fetch('/api/companies/my-credit', { headers: authGet() });
          const d = await r.json().catch(() => ({}));
          if (alive && r.ok && d?.success !== false) setBalance({ total: Number(d.total) || 0, enabled: d.creditEnabled !== false });
        })(),
        (async () => {
          const r = await fetch('/api/targets/count', { method: 'POST', headers: authJson(), body: JSON.stringify({ channel: 'dm', filter: {} }) });
          const d = await r.json().catch(() => ({}));
          if (!alive) return;
          if (r.ok && d?.success) setTarget({ filter: {}, isAll: true, explanation: '문자 수신 동의 고객 전체', matchCount: Number(d.matchCount) || 0, channelEligibleCount: Number(d.channelEligibleCount) || 0, samples: Array.isArray(d.samples) ? d.samples : [] });
          else setTargetFailed(true);
        })(),
        (async () => {
          const r = await fetch('/api/companies/callback-numbers', { headers: authGet() });
          const d = r.ok ? await r.json().catch(() => null) : null;
          const list: Array<{ phone: string; isDefault: boolean }> = (Array.isArray(d?.numbers) ? d.numbers : []).filter((c: any) => c?.phone).map((c: any) => ({ phone: String(c.phone), isDefault: !!c.is_default }));
          if (!alive) return;
          setCallbacks(list);
          setCallback((prev) => prev || (list.find((c) => c.isDefault) || list[0])?.phone || '');
        })(),
        (async () => {
          const r = await fetch('/api/companies/settings', { headers: authGet() });
          const d = await r.json().catch(() => ({}));
          if (alive) setOpt080(String(d?.reject_number || '').trim());
        })(),
        (async () => {
          const r = await fetch(`/api/dm/${dm.id}/validate`, { method: 'POST', headers: authJson(), body: '{}' });
          const d = await r.json().catch(() => ({}));
          const items: any[] = Array.isArray(d?.items) ? d.items : [];
          if (alive && r.ok) setFatal({ link: items.some((i) => i.area === 'link' && i.severity === 'fatal'), blocking: items.filter((i) => i.severity === 'fatal' && !i.overridable).length });
        })(),
      ];
      await Promise.allSettled(jobs);
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [dm.id]);

  const effectiveTime = useMemo(() => (when === 'now' ? new Date() : scheduledAt ? new Date(scheduledAt) : null), [when, scheduledAt]);
  const night = isAd && !!effectiveTime && isNightAdHour(effectiveTime);
  const count = target?.channelEligibleCount ?? 0;
  const isIndividualCb = callback === INDIVIDUAL_CB;
  const feeCost = quote?.required ? (quote.cost || CONFIRM_CREDIT_COSTS[quote.source] || 0) : 0;

  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: !!fatal && !fatal.link, label: fatal?.link ? '버튼 주소 빠짐' : '링크 정상' },
    ...(isAd ? [
      { ok: true, label: '광고 표기' },
      { ok: !!opt080, label: opt080 ? '수신거부 번호' : '수신거부 번호 없음' },
      { ok: !night, label: night ? '야간 광고 제한 시간' : '야간 광고 제한 시간 아님' },
    ] : []),
  ];

  const problem: string | null = (barrierFailed ? '저장하지 못해 보낼 수 없어요. 잠시 뒤 다시 열어 주세요.' : null)
    || (fatal && fatal.blocking > 0 ? `고칠 곳 ${fatal.blocking}곳을 먼저 채워 주세요.` : null)
    || (!target ? (targetFailed ? '받는 사람을 골라 주세요.' : null) : count === 0 ? '받는 사람이 0명이에요.' : null)
    || (!message.trim() ? '문자 문안을 넣어 주세요.' : null)
    || (callbacks.length === 0 && ready ? '등록된 발신번호가 없어요. 발신번호 관리에서 등록해 주세요.' : null)
    || (isAd && opt080 === '' ? '광고 문자는 무료수신거부(080) 번호가 필요해요.' : null)
    || (night ? '밤 9시부터 아침 8시까지는 광고 문자를 보낼 수 없어요.' : null)
    || (when !== 'now' && !scheduledAt ? '보낼 시각을 골라 주세요.' : null);

  const sendNow = useCallback(async (opts: { feeConfirmed?: boolean; exclusion?: boolean } = {}) => {
    if (!target) return;
    if (hasUnsupportedSmsChars(message, subject)) { toast.warning(SMS_CHARSET_BLOCK_MESSAGE); return; }
    setBusy('send');
    setBlockMsg(null);
    try {
      const r = await fetch(`/api/dm/${dm.id}/send-to-target`, {
        method: 'POST', headers: authJson(),
        body: JSON.stringify({
          filter: target.filter, allCustomers: !!target.isAll,
          messageText: message.trim(), subject: subject.trim(), isAd,
          // ★ 2026-10-07 남지현 접수: 개별 회신 = 자세히 설정 창과 같은 값(callback 비움 + 플래그) · 미등록·미보유 고객은 서버 CT-08이 제외 확인
          callback: isIndividualCb ? undefined : callback, useIndividualCallback: isIndividualCb,
          confirmCallbackExclusion: !!opts.exclusion,
          confirmPublishFee: !!opts.feeConfirmed,
          scheduledAt: when === 'now' ? null : new Date(scheduledAt).toISOString(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.callbackConfirmRequired) {
        setConfirm({ mode: 'warning', title: '회신번호 없는 고객 제외', description: String(d.message || ''), confirmLabel: '제외하고 보내기', onConfirm: () => { void sendNow({ ...opts, exclusion: true }); } });
        return;
      }
      if (!r.ok && d?.code === 'PUBLISH_FEE_REQUIRED') { setFeeSource(String(d.costSource || 'dm-builder')); setFeeFor('send'); return; }
      if (!r.ok || !d?.success) { setBlockMsg(d?.error || '보내지 못했어요.'); return; }
      toast.success(when === 'now' ? `${fmt(Number(d.sent))}명에게 보냈어요. 열람 현황은 DM 상세 창에서 볼 수 있어요.` : `${fmt(Number(d.sent))}명 예약했어요.`);
      onSent();
    } catch (e: any) {
      setBlockMsg(e?.message || '보내지 못했어요.');
    } finally {
      setBusy(null);
    }
  }, [dm.id, target, message, subject, isAd, callback, isIndividualCb, when, scheduledAt, toast, onSent]);

  /** 발행비 견적 두 벌(발송 · 링크)을 서버에서 다시 받는다 — 실패 = 모름(null · 링크만 받기 잠김) */
  const reloadQuotes = useCallback(async () => {
    const one = async (via: 'send' | 'publish'): Promise<Quote | null> => {
      try {
        const r = await fetch(`/api/dm/${dm.id}/publish-quote?via=${via}`, { headers: authGet() });
        const d = await r.json().catch(() => ({}));
        return r.ok && d?.success ? { required: !!d.required, cost: Number(d.cost) || 0, source: String(d.source || 'dm-builder') } : null;
      } catch { return null; }
    };
    const [s, l] = await Promise.all([one('send'), one('publish')]);
    setQuote(s);
    setLinkQuote(l);
  }, [dm.id]);

  /** 링크만 받기 = 첫 발행. 화면이 확인한 금액(expected_fee)을 싣는다 — 서버 금액이 더 크면 차감 전에 402 로 멈춘다(Codex 3R) */
  const publishLink = useCallback(async (expectedFee: number) => {
    setBusy('link');
    setBlockMsg(null);
    try {
      const r = await fetch(`/api/dm/${dm.id}/publish`, { method: 'POST', headers: authJson(), body: JSON.stringify({ expected_fee: expectedFee }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 402 && d?.code === 'PUBLISH_FEE_REQUIRED') {
        setLinkQuote({ required: true, cost: Number(d.cost) || 0, source: String(d.costSource || 'dm-builder') });
        setFeeSource(String(d.costSource || 'dm-builder'));
        setFeeFor('link');
        return;
      }
      if (!r.ok || !d?.short_url) { setBlockMsg(d?.error || '주소를 만들지 못했어요.'); return; }
      setLinkUrl(String(d.short_url));
      await reloadQuotes();
    } catch (e: any) {
      setBlockMsg(e?.message || '주소를 만들지 못했어요.');
    } finally {
      setBusy(null);
    }
  }, [dm.id, reloadQuotes]);

  const onSendClick = () => {
    if (problem) { setBlockMsg(problem); return; }
    if (quote?.required) { setFeeSource(quote.source); setFeeFor('send'); return; }
    setConfirm({
      mode: 'info',
      title: when === 'now' ? `${fmt(count)}명에게 지금 보낼까요?` : `${fmt(count)}명에게 예약할까요?`,
      description: `문자(LMS) ${fmt(count)}건 요금은 발송 잔액에서 회사 단가로 차감돼요.${isAd ? ' (광고) 표기와 무료수신거부 번호가 자동으로 붙어요.' : ''}`,
      confirmLabel: when === 'now' ? '보내기' : '예약',
      onConfirm: () => { void sendNow(); },
    });
  };
  const onLinkClick = () => {
    if (fatal && fatal.blocking > 0) { setBlockMsg(`고칠 곳 ${fatal.blocking}곳을 먼저 채워 주세요.`); return; }
    // 발행비를 모르면 주소를 만들지 않는다(링크만 받기 = 첫 발행 · 확인 없이 차감되는 길을 막는다 · Codex 1R·2R = 링크용 견적)
    if (!linkQuote) { setBlockMsg('발행 비용을 확인하지 못했어요. 잠시 뒤 창을 다시 열어 주세요.'); return; }
    if (linkQuote.required) { setFeeSource(linkQuote.source); setFeeFor('link'); return; }
    void publishLink(0);
  };

  const bubble = useMemo(() => {
    const body = message.trim();
    const parts = body.split('%DM링크%');
    return { ad: isAd, parts, tail: isAd ? `무료수신거부 ${opt080 || '080 번호 필요'}` : '' };
  }, [message, isAd, opt080]);

  return (
    <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 md:p-5">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
        <Smartphone className="w-4 h-4 text-violet-700" /><b className="text-[15px] text-slate-900">모바일 DM</b>
        <span className="text-[12px] text-slate-500">문자에 DM 링크를 담아 보내요</span>
      </div>

      <Row icon={<Users className="w-4 h-4" />} label="받는 사람">
        {target ? (
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-[14px] text-slate-900">{target.isAll ? '문자 수신 동의 고객' : '고른 고객'} {fmt(count)}명</b>
            <button type="button" onClick={() => setExtractOpen(true)} className="text-[12.5px] font-semibold text-violet-700 hover:text-violet-800">바꾸기</button>
          </div>
        ) : targetFailed ? (
          <button type="button" onClick={() => setExtractOpen(true)} className={MK_BTN_OUTLINE}>받는 사람 고르기</button>
        ) : <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
      </Row>

      <Row icon={<Type className="w-4 h-4" />} label="문자 문안">
        {editing ? (
          <div className="space-y-2">
            <input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 40))} placeholder="문자 제목" className="w-full h-9 px-3 rounded-lg bg-slate-100 border border-slate-300 text-[13px] text-slate-900 outline-none focus:border-violet-300" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="w-full px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 text-[13px] leading-relaxed text-slate-900 outline-none focus:border-violet-300 resize-none" />
            <div className="text-[11.5px] text-slate-400">%DM링크% 자리에 받는 사람별 DM 링크가 들어가요. 없으면 끝에 붙어요.</div>
            <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] font-semibold text-violet-700">다 됐어요</button>
          </div>
        ) : (
          <div>
            <div className="rounded-2xl bg-slate-200 text-slate-900 px-4 py-3 text-[13px] leading-[1.7] max-w-[340px] whitespace-pre-wrap">
              {bubble.ad ? '(광고)' : ''}{bubble.parts.map((p, i) => (
                <span key={i}>{p}{i < bubble.parts.length - 1 && <span className="inline-block align-middle mx-0.5 px-1.5 py-0.5 rounded-md bg-violet-200 text-violet-800 text-[11px] font-bold">DM 링크 자동</span>}</span>
              ))}
              {bubble.parts.length === 1 && <span className="inline-block align-middle ml-1 px-1.5 py-0.5 rounded-md bg-violet-200 text-violet-800 text-[11px] font-bold">DM 링크 자동</span>}
              {bubble.tail && <>{'\n'}{bubble.tail}</>}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 flex items-center gap-2 flex-wrap">
              DM 내용으로 채웠어요 · <button type="button" onClick={() => setEditing(true)} className="font-semibold text-violet-700 hover:text-violet-800">다듬기</button>
              <label className="inline-flex items-center gap-1.5 ml-2 cursor-pointer"><input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="accent-violet-500" />광고 문자</label>
            </div>
          </div>
        )}
      </Row>

      <Row icon={<Phone className="w-4 h-4" />} label="보내는 번호">
        {callbacks.length > 0 ? (
          <select value={callback} onChange={(e) => setCallback(e.target.value)} className="h-9 px-2.5 rounded-lg bg-slate-100 border border-slate-300 text-[13px] text-slate-900 outline-none">
            {callbacks.map((c) => <option key={c.phone} value={c.phone}>{c.phone}{c.isDefault ? ' (기본)' : ''}</option>)}
            <option value={INDIVIDUAL_CB}>고객별 매장번호 (개별 회신)</option>
          </select>
        ) : <span className="text-[12.5px] text-slate-500">{ready ? '등록된 번호가 없어요' : '불러오는 중'}</span>}
      </Row>

      <Row icon={<Clock className="w-4 h-4" />} label="보낼 때">
        <div className="space-y-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {([['now', '지금'], ['scheduled', '예약'], ['recommend', '추천 시간']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setWhen(k); if (k === 'recommend') setScheduledAt(localNextMorning()); }}
                className={`h-8 px-3.5 rounded-lg text-[12.5px] font-semibold ${when === k ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
          {when === 'scheduled' && <DateTimeField value={localInputToIso(scheduledAt)} onChange={(iso) => setScheduledAt(isoToLocalInput(iso))} tone="dark" />}
          {when === 'recommend' && scheduledAt && <div className="text-[12px] text-slate-500">내일 오전 10시 · 문자 열람이 많은 시간대예요</div>}
        </div>
      </Row>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-3 border-b border-slate-200">
        {checks.map((c) => (
          <span key={c.label} className={`inline-flex items-center gap-1.5 text-[12px] ${c.ok ? 'text-slate-600' : 'text-amber-700'}`}>
            {c.ok ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5" />}{c.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-3">
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
          <div className="text-[11px] text-slate-500">크레딧</div>
          {quote?.required ? (
            <>
              <div className="text-[14.5px] font-bold text-slate-900 mt-0.5">DM 발행 {fmt(feeCost)}</div>
              <div className="text-[11.5px] text-slate-500 mt-0.5">처음 한 번만{balance?.enabled ? ` · 남은 ${fmt(balance.total)}` : ''}</div>
            </>
          ) : (
            <>
              <div className="text-[14.5px] font-bold text-slate-900 mt-0.5">{quote ? '추가 크레딧 없음' : '확인 중'}</div>
              <div className="text-[11.5px] text-slate-500 mt-0.5">{quote ? '이미 발행한 DM이에요' : ' '}</div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
          <div className="text-[11px] text-slate-500">문자 발송 요금</div>
          <div className="text-[14.5px] font-bold text-slate-900 mt-0.5">LMS {fmt(count)}건</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">발송 잔액에서 차감 · 회사 단가 적용</div>
        </div>
      </div>

      {linkUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="text-[13px] font-semibold text-emerald-900 break-all flex-1 select-all">{linkUrl}</span>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(linkUrl); toast.success('주소를 복사했어요.'); } catch { toast.error('복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.'); } }} className={MK_BTN_OUTLINE}><Copy className="w-4 h-4" />복사</button>
        </div>
      )}
      {blockMsg && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-900 inline-flex items-start gap-2 w-full"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{blockMsg}</div>}

      <div className="flex items-center justify-end gap-2 pt-4 flex-wrap">
        {onOpenAdvanced && <button type="button" onClick={onOpenAdvanced} className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-900"><Settings2 className="w-4 h-4" />자세히 설정</button>}
        <button type="button" onClick={onLinkClick} disabled={!!busy || !ready} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-[13.5px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">
          {busy === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}링크만 받기
        </button>
        <button type="button" onClick={onSendClick} disabled={!!busy || !ready || !target} className={`${MK_BTN_PRIMARY} h-11 px-5`}>
          {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{fmt(count)}명에게 {when === 'now' ? '보내기' : '예약'}
        </button>
      </div>

      <TargetExtractModal show={extractOpen} channel="dm" onClose={() => setExtractOpen(false)} onApply={(t) => { setTarget(t); setExtractOpen(false); }} allowDirectPick />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <CreditConfirmModal
        open={!!feeFor}
        source={feeSource || 'dm-builder'}
        costOverride={feeFor === 'link' ? (linkQuote?.required && linkQuote.source === feeSource ? linkQuote.cost : undefined) : (quote?.required && quote.source === feeSource ? feeCost : undefined)}
        description={feeFor === 'send' ? `처음 보낼 때 한 번만 발행 크레딧이 들어요. 확인하면 ${fmt(count)}명에게 ${when === 'now' ? '바로 보내요' : '예약해요'}. 문자 요금은 발송 잔액에서 따로 차감돼요.` : '받는 사람에게 보낼 DM 주소를 만들어요. 문자는 보내지 않아요.'}
        onConfirm={() => { const f = feeFor; setFeeFor(null); if (f === 'send') void sendNow({ feeConfirmed: true }); else void publishLink(linkQuote?.required ? linkQuote.cost : 0); }}
        onCancel={() => setFeeFor(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────── 이메일 카드 ───────────────────────────────────────────

function EmailCard({ email, beforeSend, onSent, onSmtpChanged }: { email: SendEmail; beforeSend?: (c: SendChannel) => Promise<boolean>; onSent: () => void; onSmtpChanged?: () => void }) {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  // ★ 2026-10-03 연결 판정 = 발송 관문과 같은 GET /api/email/status(담당자도 읽는다 · 관리자 전용 /smtp-config 는 담당자에게 403 이라
  //   연결된 회사도 「연결 필요」로 막혔다) · canManage = 연결 창을 열 수 있는 관리자 여부(남지현 접수)
  const [smtp, setSmtp] = useState<{ ok: boolean; from: string; canManage: boolean } | null>(null);
  const [smtpOpen, setSmtpOpen] = useState(false);
  const loadSmtp = useCallback(async () => {
    const r = await fetch('/api/email/status', { headers: authGet() });
    const d = await r.json().catch(() => ({}));
    // 조회 실패 = 권한을 모른다 → 연결 버튼을 보인다(관리자에게 「요청」 안내가 잘못 뜨지 않게 · 저장 권한은 서버가 다시 본다)
    setSmtp({ ok: r.ok && !!d?.smtp_configured, from: String(d?.from_email || ''), canManage: r.ok ? d?.can_manage === true : true });
  }, []);
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  const [allTotal, setAllTotal] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ payload: any; total: number } | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [when, setWhen] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [completed, setCompleted] = useState(email.completed);
  const [busy, setBusy] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const beforeRef = useRef(beforeSend);
  beforeRef.current = beforeSend;
  const [barrierFailed, setBarrierFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (beforeRef.current && !(await beforeRef.current('email'))) { if (alive) { setBarrierFailed(true); setBlockMsg('저장하지 못해 보낼 수 없어요. 잠시 뒤 다시 열어 주세요.'); } return; }
      await Promise.allSettled([
        (async () => { if (alive) await loadSmtp(); })(),
        (async () => {
          const r = await fetch('/api/companies/my-credit', { headers: authGet() });
          const d = await r.json().catch(() => ({}));
          if (alive && r.ok && d?.success !== false) setBalance({ total: Number(d.total) || 0, enabled: d.creditEnabled !== false });
        })(),
        (async () => {
          const r = await fetch('/api/email/recipients/preview', { method: 'POST', headers: authJson(), body: '{}' });
          const d = await r.json().catch(() => ({}));
          if (alive && d?.success) setAllTotal(Number(d.total) || 0);
        })(),
      ]);
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [email.id]);

  const total = picked ? picked.total : (allTotal ?? 0);
  const payload = useMemo(() => {
    if (picked) return picked.payload;
    const p: any = { mode: when === 'now' ? 'immediate' : 'scheduled', target: { type: 'customers' } };
    if (when === 'scheduled' && scheduledAt) p.scheduled_at = new Date(scheduledAt).toISOString();
    return p;
  }, [picked, when, scheduledAt]);

  const problem: string | null = (barrierFailed ? '저장하지 못해 보낼 수 없어요. 잠시 뒤 다시 열어 주세요.' : null)
    || (smtp && !smtp.ok ? (smtp.canManage ? '회사 메일(발신 설정)을 먼저 연결해 주세요.' : '회사 메일이 아직 연결되지 않았어요. 회사 관리자에게 연결을 요청해 주세요.') : null)
    || (email.hasPlaceholder ? '직접 채워야 하는 자리가 남아 있어요. 수정 화면에서 채워 주세요.' : null)
    || (ready && total === 0 ? '받는 사람이 0명이에요.' : null)
    || (!picked && when === 'scheduled' && !scheduledAt ? '보낼 시각을 골라 주세요.' : null);

  const doSend = useCallback(async () => {
    setBusy(true);
    setBlockMsg(null);
    try {
      if (!completed) {
        const c = await fetch(`/api/email/campaigns/${email.id}/complete`, { method: 'POST', headers: authJson() });
        const cd = await c.json().catch(() => ({}));
        if (!c.ok || !cd?.success) { setBlockMsg(cd?.code === 'INSUFFICIENT_CREDIT' ? '크레딧이 부족해요. 충전 뒤 다시 보내 주세요.' : (cd?.error || '완성 처리에 실패했어요.')); return; }
        setCompleted(true);
      }
      const r = await fetch(`/api/email/campaigns/${email.id}/send`, { method: 'POST', headers: authJson(), body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) { setBlockMsg(d?.error || '보내지 못했어요.'); return; }
      toast.success(d.scheduled ? `예약했어요: ${new Date(d.scheduledAt).toLocaleString('ko-KR')} (${fmt(Number(d.total))}명)` : `${fmt(Number(d.total))}명에게 보내기 시작했어요.`);
      onSent();
    } catch (e: any) {
      setBlockMsg(e?.message || '보내지 못했어요.');
    } finally {
      setBusy(false);
    }
  }, [completed, email.id, payload, toast, onSent]);

  const onSendClick = () => {
    if (problem) { setBlockMsg(problem); return; }
    if (!completed) { setFeeOpen(true); return; }
    setConfirm({
      mode: email.isAd ? 'warning' : 'info',
      title: payload.mode === 'scheduled' ? `${fmt(total)}명에게 예약할까요?` : `${fmt(total)}명에게 지금 보낼까요?`,
      description: `회사 메일(${smtp?.from || '발신 주소'})로 보내요. 발송 요금은 없어요.${email.isAd ? ' (광고) 표기와 수신거부 링크가 자동으로 붙어요.' : ''}`,
      confirmLabel: payload.mode === 'scheduled' ? '예약' : '보내기',
      onConfirm: () => { void doSend(); },
    });
  };

  const sendTest = async () => {
    const to = testTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast.warning('받을 메일 주소를 확인해 주세요.'); return; }
    try {
      const r = await fetch(`/api/email/campaigns/${email.id}/test-send`, { method: 'POST', headers: authJson(), body: JSON.stringify({ emails: [to] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) { toast.error(d?.error || '테스트로 보내지 못했어요.'); return; }
      toast.success(`${to}로 보냈어요. 받은편지함·스팸함을 확인해 주세요.`);
      setTestOpen(false);
    } catch (e: any) { toast.error(e?.message || '테스트로 보내지 못했어요.'); }
  };

  const campaignForPicker = { id: email.id, name: email.name, isAd: email.isAd } as unknown as EmailCampaign;

  return (
    <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 md:p-5">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
        <Mail className="w-4 h-4 text-violet-700" /><b className="text-[15px] text-slate-900">이메일</b>
        <span className="text-[12px] text-slate-500">회사 메일로 보내요</span>
      </div>

      <Row icon={<Users className="w-4 h-4" />} label="받는 사람">
        <div className="flex items-center gap-2 flex-wrap">
          <b className="text-[14px] text-slate-900">{picked ? `고른 받는 사람 ${fmt(total)}명` : allTotal === null ? '확인 중' : `이메일 수신 동의 고객 ${fmt(total)}명`}</b>
          <button type="button" onClick={() => setPickOpen(true)} className="text-[12.5px] font-semibold text-violet-700 hover:text-violet-800">바꾸기</button>
          {picked && <button type="button" onClick={() => setPicked(null)} className="text-[12px] text-slate-400 hover:text-slate-900">전체로</button>}
        </div>
      </Row>
      <Row icon={<Type className="w-4 h-4" />} label="제목">
        <div className="text-[13.5px] text-slate-800">{email.isAd ? '(광고) ' : ''}{email.subject || '(제목 없음)'}</div>
      </Row>
      <Row icon={<Mail className="w-4 h-4" />} label="보내는 메일">
        {smtp === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : smtp.ok ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-800"><Check className="w-4 h-4 text-emerald-600" />{smtp.from}</span>
        ) : (
          smtp.canManage
            ? <button type="button" onClick={() => setSmtpOpen(true)} className={MK_BTN_OUTLINE}>회사 메일 연결하기</button>
            : <span className="text-[12.5px] text-slate-600">회사 관리자에게 회사 메일 연결을 요청해 주세요</span>
        )}
      </Row>
      {!picked && (
        <Row icon={<Clock className="w-4 h-4" />} label="보낼 때">
          <div className="space-y-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              {([['now', '지금'], ['scheduled', '예약']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setWhen(k)} className={`h-8 px-3.5 rounded-lg text-[12.5px] font-semibold ${when === k ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{l}</button>
              ))}
            </div>
            {when === 'scheduled' && <DateTimeField value={localInputToIso(scheduledAt)} onChange={(iso) => setScheduledAt(isoToLocalInput(iso))} tone="dark" />}
          </div>
        </Row>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-3 border-b border-slate-200">
        {[
          { ok: !!smtp?.ok, label: smtp?.ok ? '회사 메일 연결' : '회사 메일 연결 필요' },
          { ok: !email.hasPlaceholder, label: email.hasPlaceholder ? '채울 자리 남음' : '채울 자리 없음' },
          ...(email.isAd ? [{ ok: true, label: '광고 표기 · 수신거부 자동' }] : []),
        ].map((c) => (
          <span key={c.label} className={`inline-flex items-center gap-1.5 text-[12px] ${c.ok ? 'text-slate-600' : 'text-amber-700'}`}>
            {c.ok ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5" />}{c.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-3">
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
          <div className="text-[11px] text-slate-500">크레딧</div>
          <div className="text-[14.5px] font-bold text-slate-900 mt-0.5">{completed ? '추가 크레딧 없음' : `이메일 완성 ${fmt(CONFIRM_CREDIT_COSTS['email-campaign-complete'])}`}</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">{completed ? '이미 완성한 이메일이에요' : `처음 한 번만${balance?.enabled ? ` · 남은 ${fmt(balance.total)}` : ''}`}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
          <div className="text-[11px] text-slate-500">발송 요금</div>
          <div className="text-[14.5px] font-bold text-slate-900 mt-0.5">없음</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">회사 메일로 나가요</div>
        </div>
      </div>

      {testOpen && (
        <div className="mt-3 flex items-center gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="테스트로 받을 메일 주소" className="flex-1 h-10 px-3 rounded-lg bg-slate-100 border border-slate-300 text-[13px] text-slate-900 outline-none focus:border-violet-300" />
          <button type="button" onClick={() => { void sendTest(); }} className={MK_BTN_OUTLINE}>받아 보기</button>
        </div>
      )}
      {blockMsg && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-900 inline-flex items-start gap-2 w-full"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{blockMsg}</div>}

      <div className="flex items-center justify-end gap-2 pt-4 flex-wrap">
        {completed && smtp?.ok && !testOpen && (
          <button type="button" onClick={() => setTestOpen(true)} className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-900"><Sparkles className="w-4 h-4" />테스트로 받아 보기</button>
        )}
        <button type="button" onClick={onSendClick} disabled={busy || !ready} className={`${MK_BTN_PRIMARY} h-11 px-5`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{fmt(total)}명에게 {payload.mode === 'scheduled' ? '예약' : '보내기'}
        </button>
      </div>

      {pickOpen && (
        <EmailRecipientsModal
          campaign={campaignForPicker}
          authHeaders={authJson}
          onProceed={(p, t) => { setPicked({ payload: p, total: t }); setPickOpen(false); }}
          onClose={() => setPickOpen(false)}
          onToast={(m, ty) => { const k = ty || 'info'; toast[k](m); }}
        />
      )}
      <SmtpConnectModal
        open={smtpOpen}
        onClose={() => setSmtpOpen(false)}
        onSaved={() => { setBlockMsg(null); void loadSmtp(); onSmtpChanged?.(); }}
      />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <CreditConfirmModal
        open={feeOpen}
        source="email-campaign-complete"
        description={`처음 보낼 때 한 번만 이메일 완성 크레딧이 들어요. 확인하면 ${fmt(total)}명에게 ${payload.mode === 'scheduled' ? '예약해요' : '바로 보내요'}.`}
        onConfirm={() => { setFeeOpen(false); void doSend(); }}
        onCancel={() => setFeeOpen(false)}
      />
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3 border-b border-slate-200">
      <div className="w-[88px] shrink-0 flex items-center gap-1.5 text-[12.5px] text-slate-500 self-start pt-1.5">{icon}{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
