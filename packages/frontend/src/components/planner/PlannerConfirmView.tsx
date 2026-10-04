/**
 * PlannerConfirmView — 행사 확인 본문 1벌 (★ 2026-10-04 보강 · 설계서 §5-3 · §5-4 · 목업 v2 (다)(라))
 *
 * 담당자 휴대폰 확인 화면(공개 · 로그인 없음)과 PC 행사 상세(로그인)가 **같은 부품**을 쓴다 — 두 화면이 갈리지 않게.
 * 본문은 서버가 조립한 그대로(utils/planner-confirm.ts buildConfirmView): 문자 = (광고)·무료거부까지 붙은 최종형 ·
 * 모바일 DM·메일 = 렌더러 출력 그대로. 미리보기는 sandbox iframe(스크립트 0 · 열람 비콘 0)으로 그린다.
 * 승인 확인 창 본문(ApproveBody)도 폰 시트 · PC 창이 같은 부품이다.
 */
import { useState } from 'react';
import { AlarmClock, Check, ChevronDown, Info, Lock, Maximize2, Pencil, RotateCcw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { PLANNER_SEND_KIND, plannerDay } from '../../constants/planner-status';
import type { AudienceCount, ConfirmSend, ConfirmView } from './planner-api';
import { won } from './planner-api';

/** 승인 전 DM 링크 자리(서버 PLANNER_DM_LINK_SENTINEL) — 실주소는 승인 때 정해진다 */
const DM_LINK_SENTINEL = '[[DM_LINK]]';

/** (순수) ISO 시각 → KST 'M/D(요)' */
function kstDayOf(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return plannerDay(new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
}

export function recipientsText(r: AudienceCount): string {
  if (r.state === 'blocked') return '대상을 정할 수 없어요';
  if (r.state === 'error' || r.count === null) return '받는 사람 수 확인 중 문제';
  return `${won(r.count)}명`;
}

export function SmsBubble({ text, linkPending, maxWidth = 300 }: { text: string; linkPending: boolean; maxWidth?: number }) {
  const parts = text.split(DM_LINK_SENTINEL);
  return (
    <div className="rounded-[18px] rounded-tl-md bg-slate-100 px-3.5 py-2.5 text-[14px] leading-[1.6] text-slate-900 whitespace-pre-wrap break-words" style={{ maxWidth }}>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="text-indigo-700 underline underline-offset-2" aria-label="승인 뒤 정해지는 링크 주소">{linkPending ? 'hanjul.ai/d/●●●●●' : ''}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function PreviewFrame({ title, html, height }: { title: string; html: string; height: number }) {
  return <iframe title={title} srcDoc={html} sandbox="" className="w-full bg-white block" style={{ height }} />;
}

function BigPreview({ title, html, onClose }: { title: string; html: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-6 bg-black/70" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 px-4 border-b border-slate-200 flex items-center">
          <h3 className="text-[14px] font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="ml-auto w-10 h-10 rounded-lg grid place-items-center text-slate-500 hover:bg-slate-100" aria-label="닫기"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <iframe title={title} srcDoc={html} sandbox="" className="flex-1 w-full bg-white" />
      </div>
    </div>
  );
}

function SpamLine({ sms }: { sms: NonNullable<ConfirmSend['sms']> }) {
  if (sms.spam === 'pass') {
    return (
      <p className="text-[12.5px] text-slate-600 flex items-start gap-1.5">
        <ShieldCheck className="w-[14px] h-[14px] text-emerald-600 mt-0.5 shrink-0" />
        <span>스팸 검사 통과{sms.checkedAt ? `(${kstDayOf(sms.checkedAt)})` : ''}{sms.linkPending ? ' · 링크 주소는 승인하면 정해지고, 그 주소로 한 번 더 검사해요' : ''}{sms.edited ? ' · 직접 고친 문안' : ''}</span>
      </p>
    );
  }
  if (sms.spam === 'pending') {
    return <p className="text-[12.5px] text-violet-800 flex items-start gap-1.5"><ShieldCheck className="w-[14px] h-[14px] mt-0.5 shrink-0" /><span>고치신 문안을 스팸 검사하고 있어요. 몇 분 걸려요. 통과하면 승인할 수 있어요.</span></p>;
  }
  return (
    <p className="text-[12.5px] text-amber-800 flex items-start gap-1.5">
      <TriangleAlert className="w-[14px] h-[14px] mt-0.5 shrink-0" />
      <span>{sms.error || '문자 문안을 준비하고 있어요. 준비되면 여기에 보여요.'}</span>
    </p>
  );
}

function EmailCard({ email, open: openInitially, height }: { email: NonNullable<ConfirmSend['email']>; open: boolean; height: number }) {
  const [open, setOpen] = useState(openInitially);
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white w-full">
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-full bg-stone-200 text-stone-700 grid place-items-center text-[12px] font-bold shrink-0">{(email.fromName || '?').slice(0, 1)}</span>
        <div className="min-w-0">
          <p className="text-[12.5px] text-slate-600 truncate">{email.fromName}</p>
          <p className="text-[14px] font-semibold truncate">{email.subject}</p>
        </div>
      </div>
      {open && email.html ? <PreviewFrame title="메일 미리보기" html={email.html} height={height} /> : null}
      {!openInitially && email.html && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="w-full h-11 border-t border-slate-100 text-[13px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 hover:bg-slate-50">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />{open ? '메일 본문 접기' : '메일 본문 펼치기'}
        </button>
      )}
    </div>
  );
}

const editBtn = 'h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1 whitespace-nowrap';

/**
 * 보낼 내용(발송 순서 줄) — mode = 'phone'(세로 쌓기) | 'pc'(문자 옆에 DM 실물 크기).
 * 고치기 버튼은 PC 승인 전(편집 콜백이 있을 때)만 · 폰은 바닥 바의 [문안 고치기] 하나.
 */
export function ConfirmTimeline({ view, mode, onEditCopy, onEditDm, onEditEmail }: {
  view: ConfirmView;
  mode: 'phone' | 'pc';
  onEditCopy?: (send: ConfirmSend) => void;
  onEditDm?: (dmId: string) => void;
  onEditEmail?: (campaignId: string) => void;
}) {
  const pc = mode === 'pc';
  const [big, setBig] = useState<{ title: string; html: string } | null>(null);
  const nextIdx = view.sends.findIndex((s) => s.status !== 'sent' && s.status !== 'skipped');
  return (
    <>
      <ol>
        {view.sends.map((s, i) => {
          const kind = PLANNER_SEND_KIND[s.kind];
          const sent = s.status === 'sent';
          const skipped = s.status === 'skipped';
          const isNext = i === nextIdx;
          const held = s.status === 'hold_credit' || s.status === 'locked';
          return (
            <li key={s.key} id={`send-${i + 1}`} className={`relative ${pc ? 'pl-12 pb-10' : 'pl-10 pb-8'} scroll-mt-24`}>
              {i < view.sends.length - 1 && <span className="absolute left-[13px] top-8 bottom-1 w-px bg-slate-300" aria-hidden="true" />}
              <span className="absolute left-0 top-0">
                {sent
                  ? <span className="w-7 h-7 rounded-full bg-emerald-600 text-white grid place-items-center"><Check className="w-[14px] h-[14px]" /></span>
                  : <span className={`w-7 h-7 rounded-full ${isNext ? 'bg-indigo-600' : skipped ? 'bg-slate-300' : 'bg-slate-900'} text-white text-[12.5px] font-bold grid place-items-center tabular-nums`}>{i + 1}</span>}
              </span>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-bold tabular-nums ${skipped ? 'text-slate-500 line-through' : ''}`}>{plannerDay(s.scheduledOn)} 오전 {view.sendHour}시 · {kind.long}</p>
                  <p className="text-[12.5px] text-slate-600 tabular-nums mt-0.5">
                    {recipientsText(s.recipients)} · {s.why}
                    {isNext && !sent && <> · <b className="text-indigo-700">다음 발송</b></>}
                  </p>
                </div>
                {pc && (
                  <div className="flex gap-1.5">
                    {s.sms?.editable && onEditCopy && <button type="button" className={editBtn} onClick={() => onEditCopy(s)}><Pencil className="w-[13px] h-[13px] text-slate-500" />문안 고치기</button>}
                    {s.dm && onEditDm && <button type="button" className={editBtn} onClick={() => onEditDm(s.dm!.dmId)}><Pencil className="w-[13px] h-[13px] text-slate-500" />모바일 DM 고치기</button>}
                    {s.email && onEditEmail && <button type="button" className={editBtn} onClick={() => onEditEmail(s.email!.campaignId)}><Pencil className="w-[13px] h-[13px] text-slate-500" />메일 고치기</button>}
                  </div>
                )}
              </div>
              {(held || skipped) && s.lockReason && (
                <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[13px] flex items-start gap-2 ${held ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" /><span>{s.lockReason}</span>
                </div>
              )}
              <div className="mt-3">
                {s.kind === 'email' && s.email && <EmailCard email={s.email} open={pc} height={pc ? 640 : 520} />}
                {s.kind === 'email' && !s.email && <p className="text-[13px] text-amber-800">메일 완성본이 아직 없어요.</p>}
                {s.kind !== 'email' && s.sms && (
                  <div className={pc && s.dm ? 'flex flex-wrap gap-8 items-start' : ''}>
                    <div className="space-y-2">
                      {s.sms.text ? <SmsBubble text={s.sms.text} linkPending={s.sms.linkPending} maxWidth={pc ? 300 : 320} /> : null}
                      <div style={{ maxWidth: pc ? 300 : undefined }}><SpamLine sms={s.sms} /></div>
                    </div>
                    {s.dm && (
                      <div className={pc ? 'w-[375px] max-w-full' : 'mt-3'}>
                        {s.dm.html ? (
                          <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                            <PreviewFrame title="모바일 DM 미리보기" html={s.dm.html} height={pc ? 540 : 480} />
                          </div>
                        ) : <p className="text-[13px] text-amber-800">모바일 DM 완성본이 아직 없어요.</p>}
                        {s.dm.html && (
                          <button type="button" onClick={() => setBig({ title: '모바일 DM', html: s.dm!.html! })}
                            className={`mt-2 ${pc ? 'h-10 px-3.5' : 'w-full h-11'} rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 hover:bg-slate-50`}>
                            <Maximize2 className="w-4 h-4" />모바일 DM 크게 보기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {s.result && (
                <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-emerald-950" style={{ maxWidth: pc ? 735 : undefined }}>
                  <p className="text-[12px] font-semibold text-emerald-800 mb-0.5">{plannerDay(s.scheduledOn)} 결과</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
                    {s.result.sentCount !== null && <span><b>{won(s.result.sentCount)}</b> 보냄</span>}
                    {s.result.successCount !== null && <span><b>{won(s.result.successCount)}</b> 성공</span>}
                    {s.result.openCount !== null && <span><b>{won(s.result.openCount)}</b> 열어봄</span>}
                    {s.result.clickCount !== null && <span><b>{won(s.result.clickCount)}</b> 클릭</span>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {big && <BigPreview title={big.title} html={big.html} onClose={() => setBig(null)} />}
    </>
  );
}

/** 휴대폰 요약(혜택 · 보내는 날 · 받는 사람 · 비용) — 카드 속 카드 대신 정의 목록 한 장 */
export function ConfirmSummary({ view }: { view: ConfirmView }) {
  const sms = view.sends.find((s) => s.kind !== 'email');
  const email = view.sends.find((s) => s.kind === 'email');
  const pending = view.sends.filter((s) => s.status !== 'sent' && s.status !== 'skipped');
  const q = view.quote;
  return (
    <dl className="mt-4 rounded-2xl bg-white border border-neutral-200 divide-y divide-neutral-100 text-[13.5px]">
      {view.event.benefitText && (
        <div className="px-4 py-3">
          <dt className="text-[12px] text-neutral-600 inline-flex items-center gap-1"><Lock className="w-[11px] h-[11px] text-violet-600" />혜택(적은 그대로)</dt>
          <dd className="font-semibold mt-0.5">{view.event.benefitText}</dd>
        </div>
      )}
      <div className="px-4 py-3 grid grid-cols-[72px_1fr] gap-2">
        <dt className="text-neutral-600">보내는 날</dt>
        <dd className="tabular-nums">
          <b>{view.firstSend ? `${plannerDay(view.firstSend)}부터 ${pending.length}번` : '남은 발송 없음'}</b>
          <span className="block text-[12.5px] text-neutral-600">그날 오전 {view.sendHour}시부터 나가요</span>
        </dd>
      </div>
      <div className="px-4 py-3 grid grid-cols-[72px_1fr] gap-2">
        <dt className="text-neutral-600">받는 사람</dt>
        <dd className="tabular-nums">
          {sms && <><b>문자 {recipientsText(sms.recipients)}</b>{email ? ' · ' : ''}</>}
          {email && <b>메일 {recipientsText(email.recipients)}</b>}
          <span className="block text-[12.5px] text-neutral-600">수신거부를 뺀 오늘 기준</span>
        </dd>
      </div>
      <div className="px-4 py-3 grid grid-cols-[72px_1fr] gap-2">
        <dt className="text-neutral-600">비용</dt>
        <dd className="tabular-nums">
          {view.approved ? <b>승인 때 냈어요</b> : q ? <b>승인할 때 {won(q.total)}크레딧</b> : <b>승인할 때 계산해요</b>}
          {q && q.parts.length > 0 && <span className="block text-[12.5px] text-neutral-600">{q.parts.map((p) => `${p.label} ${won(p.cost)}`).join(' · ')}</span>}
          {q && q.agency.paid && <span className="block text-[12.5px] text-neutral-600">이달 대행료는 냈어요</span>}
          <span className="block text-[12.5px] text-neutral-600 mt-0.5">발송일마다 문안 {view.copyCostPerSend} · 문자 발송비는 보낸 건수만큼</span>
        </dd>
      </div>
    </dl>
  );
}

/** 승인 확인 창 본문 — 폰 시트 · PC 창이 같은 부품(목업 approveBody) */
export function ApproveBody({ view }: { view: ConfirmView }) {
  const q = view.quote;
  const total = q?.total ?? 0;
  const pending = view.sends.filter((s) => s.status !== 'sent' && s.status !== 'skipped');
  const first = pending[0];
  const rest = pending.slice(1).map((s) => plannerDay(s.scheduledOn));
  return (
    <>
      <h3 className="text-[18px] font-bold tracking-[-0.02em]">'{view.event.title}' 행사를 승인할까요?</h3>
      <p className="text-[13px] text-slate-600 mt-1">아래 {pending.length}번이 정해진 날 그대로 나가요</p>
      <dl className="mt-3 divide-y divide-slate-100 text-[13.5px] tabular-nums border-y border-slate-100">
        <div className="py-2.5 flex justify-between gap-3">
          <dt className="text-slate-600">지금 빠지는 크레딧</dt>
          <dd className="text-right"><b className="text-[16px]">{won(total)}</b>
            {q && q.parts.length > 0 && <span className="block text-[12px] text-slate-600">{q.parts.map((p) => `${p.label} ${won(p.cost)}`).join(' · ')}</span>}
          </dd>
        </div>
        {view.balance !== null && (
          <div className="py-2.5 flex justify-between gap-3"><dt className="text-slate-600">보유 크레딧</dt><dd><b>{won(view.balance)} → {won(view.balance - total)}</b></dd></div>
        )}
        {first && (
          <div className="py-2.5 flex justify-between gap-3">
            <dt className="text-slate-600">첫 발송</dt>
            <dd className="text-right"><b>{plannerDay(first.scheduledOn)} 오전 {view.sendHour}시 · {PLANNER_SEND_KIND[first.kind].label} {recipientsText(first.recipients)}</b>
              {rest.length > 0 && <span className="block text-[12px] text-slate-600">이어서 {rest.join(' · ')} 오전 {view.sendHour}시</span>}
            </dd>
          </div>
        )}
      </dl>
      <ul className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 text-[12.5px] text-slate-700 space-y-1.5 leading-snug">
        <li className="flex gap-1.5"><RotateCcw className="w-[13px] h-[13px] text-indigo-600 mt-0.5 shrink-0" /><span>첫 발송 전까지 승인을 풀 수 있어요. 풀었다가 다시 승인해도 같은 비용이 두 번 빠지지 않아요.</span></li>
        <li className="flex gap-1.5"><Info className="w-[13px] h-[13px] text-amber-700 mt-0.5 shrink-0" /><span>모바일 DM 발행비·메일 완성비는 승인 뒤 행사를 취소해도 돌려드리지 않아요.</span></li>
      </ul>
    </>
  );
}

/** 승인 마감 줄 — "승인 마감 M/D(요) 20시 · N일 남음" */
export function DeadlineLine({ view, className = '' }: { view: ConfirmView; className?: string }) {
  if (!view.deadline || view.approved) return null;
  const d = view.deadline;
  const left = d.daysLeft > 0 ? `${d.daysLeft}일 남음` : d.daysLeft === 0 ? '오늘' : '지남';
  return <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}><AlarmClock className="w-4 h-4" />승인 마감 {plannerDay(d.date)} {d.hour}시 · {left}</span>;
}

/** PC 왼쪽 비용 카드 — 만들 때 · 승인할 때 · 발송일마다 문안 · 합계(사용자가 더하지 않는다) */
export function CostCard({ view }: { view: ConfirmView }) {
  const q = view.quote;
  const copyTotal = view.copyCostPerSend * view.carrierCount;
  const row = (l: string, v: string, d?: string, strong = false) => (
    <div className="flex justify-between gap-3 py-2">
      <dt className={strong ? 'font-semibold text-slate-900' : 'text-slate-600'}>{l}{d && <span className="block text-[12px] text-slate-500 font-normal">{d}</span>}</dt>
      <dd className={`tabular-nums text-right ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{v}</dd>
    </div>
  );
  return (
    <>
      <dl className="mt-1 text-[13px] divide-y divide-slate-100">
        {view.buildPaid > 0 && row('만들 때', `${won(view.buildPaid)} · 냄`, '모바일 DM·메일 완성본')}
        {view.approved ? row('승인 때', '냄', '크레딧 내역에서 볼 수 있어요')
          : row('승인할 때', q ? won(q.total) : '계산 중', q && q.parts.length > 0 ? q.parts.map((p) => `${p.label} ${won(p.cost)}`).join(' · ') : undefined, true)}
        {view.carrierCount > 0 && row('발송일마다 문안', `${view.copyCostPerSend} × ${view.carrierCount} = ${won(copyTotal)}`)}
        {!view.approved && q && row('합계', `${won(view.buildPaid + q.total + copyTotal)}크레딧`, '문자 발송비는 보낸 건수만큼 따로', true)}
      </dl>
      {q && <p className="text-[12px] text-slate-500 mt-2">{q.agency.paid ? '이달 대행료는 이미 냈어요' : `이달 첫 승인이라 대행료 ${won(q.agency.cost)}이 함께 빠져요`}</p>}
    </>
  );
}

/**
 * 문자 문안 고치기(승인 전 · 로그인한 담당자만 · §5-3) — 저장하면 스팸 검사를 다시 하고 새 리비전이 된다(옛 확인 링크는 무효).
 * 광고 표기 · 무료거부 줄 · 모바일 DM 링크는 발송 때 서버가 붙인다 — 여기서는 본문만 고친다.
 */
export function CopyEditDialog({ send, eventId, onClose, onSaved, onError }: {
  send: ConfirmSend;
  eventId: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState(send.sms?.rawText || '');
  const [saving, setSaving] = useState(false);
  const MAX = 1000;
  const save = async () => {
    if (!text.trim()) { onError('문안을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/marketing-planner/events/${encodeURIComponent(eventId)}/copy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ touchpointId: send.touchpointIds[0], text }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(String(d?.error || '문안을 저장하지 못했어요.')); return; }
      onSaved();
    } catch {
      onError('네트워크 문제로 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45" role="dialog" aria-modal="true" aria-label="문안 고치기">
      <div className="w-full md:max-w-[520px] bg-white rounded-t-[24px] md:rounded-2xl px-5 pt-3 md:pt-5 pb-6 shadow-2xl">
        <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto md:hidden" />
        <h3 className="mt-4 md:mt-0 text-[17px] font-bold">{plannerDay(send.scheduledOn)} 문자 문안 고치기</h3>
        <p className="text-[12.5px] text-slate-600 mt-1">(광고) 표기 · 무료거부 번호{send.kind !== 'sms' ? ' · 모바일 DM 링크' : ''}는 보낼 때 자동으로 붙어요. 저장하면 스팸 검사를 다시 해요.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={8}
          className="mt-3 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-[14px] leading-[1.65] outline-none focus:ring-2 focus:ring-indigo-500" aria-label="문자 문안" />
        <p className="text-[12px] text-slate-500 text-right tabular-nums">{text.length.toLocaleString()} / {MAX.toLocaleString()}자</p>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={onClose} disabled={saving} className="h-12 px-5 rounded-[10px] border border-slate-300 text-[14px] font-semibold text-slate-700">취소</button>
          <button type="button" onClick={() => { void save(); }} disabled={saving} className="flex-1 h-12 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-bold disabled:opacity-50">
            {saving ? '저장하는 중' : '저장하고 다시 검사'}
          </button>
        </div>
      </div>
    </div>
  );
}
