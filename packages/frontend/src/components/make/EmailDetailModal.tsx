/**
 * EmailDetailModal — 보낸 이메일 상세 창(★ 2026-09-27 만들기 개편 · 목업 (마) ④)
 *
 * 왼쪽 = 받은편지함 모양 표지 · 보낸 메일 · 광고 여부 · 수정/테스트 발송/HTML 저장/복제/삭제(완성분만 테스트·HTML)
 * 오른쪽 = 성과(서버 집계 · 많이 누른 링크 · 오픈 시간대) · 발송 이력 · 받은 사람별 · AI 진단(기존 창) /
 *          안 연 사람에게 문자로 · 안 연 사람에게 다시 보내기(기존 창 · 1회)
 * 숫자 = email_campaigns 집계 + GET /campaigns/:id/events(최근 500건 표본) — 표본이면 그렇다고 밝힌다.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, PenLine, Send, Download, CopyPlus, Trash2, Loader2, Sparkles, Smartphone, RefreshCw, Clock } from 'lucide-react';
import type { EmailCampaign } from '../email/email-campaign-types';
import { StatusChip } from './HomeParts';
import { emailChipStatus } from '../../utils/make-flow';
import { MK_BTN_OUTLINE, MK_BTN_PRIMARY, MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';

interface EventRow { email: string; eventType: string; url: string | null; occurredAt: string }
interface RecipientRow { email: string; openedAt: string | null; clickedAt: string | null; bouncedAt: string | null; unsubscribedAt: string | null; openCount: number; clickCount: number }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.min(6, Math.max(1, b.length)))}${c}`);
const EVENT_LABEL: Record<string, string> = { delivered: '받음', processed: '처리', sent: '보냄', open: '열어 봄', click: '누름', bounce: '반송', dropped: '반송', spam_report: '스팸 신고', unsubscribe: '수신거부' };

export default function EmailDetailModal({ campaign, cover, authHeaders, onClose, onEdit, onTest, onExportHtml, onClone, onDelete, onInsight, onNonOpener, onSend, onCancelSchedule, onOpenEvents, exporting, cloning }: {
  campaign: EmailCampaign;
  cover: string | null;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onEdit: () => void;
  onTest: () => void;
  onExportHtml: () => void;
  onClone: () => void;
  onDelete: () => void;
  onInsight: () => void;
  onNonOpener: () => void;
  onSend: () => void;
  onCancelSchedule: () => void;
  /** 전체 발송 이력 창(기존 · 페이지 넘김) */
  onOpenEvents: () => void;
  exporting?: boolean;
  cloning?: boolean;
}) {
  const c = campaign;
  const status = emailChipStatus(c);
  const [tab, setTab] = useState<'perf' | 'events' | 'people' | 'ai'>('perf');
  const [data, setData] = useState<{ events: EventRow[]; recipients: RecipientRow[]; total: number } | null>(null);
  const [opensSample, setOpensSample] = useState<EventRow[] | null>(null);
  const [clicksSample, setClicksSample] = useState<EventRow[] | null>(null);
  const sent = c.sentCount || 0;

  useEffect(() => {
    if (sent === 0) { setData({ events: [], recipients: [], total: 0 }); return; }
    let alive = true;
    (async () => {
      try {
        const [all, opens, clicks] = await Promise.all([
          fetch(`/api/email/campaigns/${c.id}/events?limit=200`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/email/campaigns/${c.id}/events?limit=500&event_type=open`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/email/campaigns/${c.id}/events?limit=500&event_type=click`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (!alive) return;
        setData({ events: Array.isArray(all?.events) ? all.events : [], recipients: Array.isArray(all?.recipients) ? all.recipients : [], total: Number(all?.recipients_total) || 0 });
        setOpensSample(Array.isArray(opens?.events) ? opens.events : []);
        setClicksSample(Array.isArray(clicks?.events) ? clicks.events : []);
      } catch { if (alive) setData({ events: [], recipients: [], total: 0 }); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, sent]);

  const links = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of clicksSample || []) { const u = (e.url || '').trim(); if (u) m.set(u, (m.get(u) || 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [clicksSample]);
  const hours = useMemo(() => {
    const arr = Array.from({ length: 24 }, () => 0);
    for (const e of opensSample || []) { const d = new Date(e.occurredAt); if (!Number.isNaN(d.getTime())) arr[d.getHours()] += 1; }
    return arr;
  }, [opensSample]);
  const maxH = Math.max(1, ...hours);
  const top = hours.indexOf(Math.max(...hours));
  const sampleCapped = (opensSample?.length || 0) >= 500 || (clicksSample?.length || 0) >= 500;

  return (
    <div className={MK_MODAL_BACKDROP} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${MK_MODAL} w-full max-w-[1060px] max-h-[92vh] flex flex-col md:flex-row overflow-hidden`} role="dialog" aria-label={`${c.name} 상세`}>
        <aside className="md:w-[250px] shrink-0 border-b md:border-b-0 md:border-r border-slate-200 p-5 flex flex-col gap-4 overflow-y-auto mk-scroll">
          <div className="rounded-xl overflow-hidden border border-slate-200">
            <div className="bg-white px-3 py-2.5 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[#9a4f2c] text-white text-[12px] font-bold flex items-center justify-center shrink-0">{(c.fromName || 'H').slice(0, 1)}</span>
              <div className="min-w-0"><div className="text-[12px] font-bold text-slate-900 truncate">{c.fromName || '보내는 사람'}</div><div className="text-[11px] text-slate-600 truncate">{c.subject}</div></div>
            </div>
            <div className="h-[120px] bg-white">{cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11.5px] text-slate-500">보낸 메일</div>
            <div className="h-9 px-3 rounded-lg bg-slate-100 border border-slate-200 flex items-center text-[12.5px] font-semibold text-slate-900 truncate">{c.fromEmail || '-'}</div>
            <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2">
              <div className="text-[12.5px] font-bold text-slate-900">{c.isAd ? '광고 메일' : '정보 메일'}</div>
              <div className="text-[11px] text-slate-500">{c.isAd ? '(광고) 표기 · 수신거부 붙음' : '광고 표기 없음'}</div>
            </div>
          </div>
          <dl className="space-y-1.5 text-[12px] border-t border-slate-200 pt-3">
            <div className="flex justify-between"><dt className="text-slate-500">다시 보낸 횟수</dt><dd className="text-slate-700 font-semibold">{c.resendGeneration ?? 0} / 1회</dd></div>
            {c.status === 'scheduled' && c.scheduledAt && <div className="flex justify-between"><dt className="text-slate-500">예약</dt><dd className="text-amber-700 font-semibold">{new Date(c.scheduledAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">완성</dt><dd className="text-slate-700 font-semibold">{c.completed ? '완성' : '완성 전'}</dd></div>
          </dl>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <button type="button" onClick={onEdit} className={MK_BTN_OUTLINE}><PenLine className="w-4 h-4" />수정</button>
            <button type="button" onClick={onTest} disabled={!c.completed} title={c.completed ? undefined : '완성한 이메일만 테스트로 보낼 수 있어요'} className={MK_BTN_OUTLINE}><Send className="w-4 h-4" />테스트 발송</button>
            <button type="button" onClick={onExportHtml} disabled={!c.completed || exporting} title={c.completed ? undefined : '완성한 이메일만 저장할 수 있어요'} className={MK_BTN_OUTLINE}>{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}HTML 저장</button>
            <button type="button" onClick={onClone} disabled={cloning} className={MK_BTN_OUTLINE}>{cloning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CopyPlus className="w-4 h-4" />}복제</button>
            <button type="button" onClick={onDelete} className="col-span-2 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="w-4 h-4" />삭제</button>
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col p-5 md:p-6 overflow-hidden">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><h3 className="text-[19px] font-bold text-slate-900 truncate">{c.name}</h3><StatusChip status={status} /></div>
              <div className="text-[12px] text-slate-500 mt-1 truncate">{c.sentAt ? `${new Date(c.sentAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${sent.toLocaleString()}명 · ` : ''}제목 "{c.subject}"</div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex gap-1 border-b border-slate-200 mt-4">
            {([['perf', '성과'], ['events', '발송 이력'], ['people', '받은 사람별'], ['ai', 'AI 진단']] as Array<[typeof tab, string]>).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px inline-flex items-center gap-1 ${tab === k ? 'text-slate-900 border-violet-500' : 'text-slate-500 border-transparent hover:text-slate-700'}`}>{k === 'ai' && <Sparkles className="w-3.5 h-3.5" />}{l}</button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto mk-scroll pt-4">
            {status === 'failed' && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-900">보내지 못했어요. 회사 메일 연결을 확인한 뒤 다시 보내 주세요.</div>}
            {status === 'draft' && <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[12.5px] text-slate-600">아직 보내지 않은 이메일이에요.</div>}
            {tab === 'perf' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <Tile k="보냄" v={sent} />
                  <Tile k="오픈" v={c.openCount || 0} p={pct(c.openCount || 0, sent)} />
                  <Tile k="클릭" v={c.clickCount || 0} p={pct(c.clickCount || 0, sent)} />
                  <Tile k="반송" v={c.bounceCount || 0} p={pct(c.bounceCount || 0, sent)} />
                  <Tile k="수신거부" v={c.unsubscribeCount || 0} p={pct(c.unsubscribeCount || 0, sent)} />
                </div>
                {sent > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-[13px] font-bold text-slate-900 mb-3">많이 누른 링크</div>
                      {clicksSample === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : links.length === 0 ? <div className="text-[12px] text-slate-400">아직 누른 링크가 없어요.</div> : links.map(([u, n]) => (
                        <div key={u} className="grid grid-cols-[1fr_120px_40px] items-center gap-2 py-1 text-[12px]">
                          <span className="text-slate-600 truncate" title={u}>{u.replace(/^https?:\/\//, '')}</span>
                          <span className="h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${(n / links[0][1]) * 100}%` }} /></span>
                          <b className="text-slate-900 text-right">{n}</b>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-[13px] font-bold text-slate-900 mb-3">오픈 시간대</div>
                      <div className="flex items-end gap-[3px] h-[72px]">
                        {hours.map((h, i) => <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-violet-600 to-violet-400" style={{ height: `${Math.max(4, (h / maxH) * 100)}%`, opacity: h ? 1 : 0.25 }} title={`${i}시 ${h}회`} />)}
                      </div>
                      <div className="flex justify-between text-[10.5px] text-slate-400 mt-1"><span>0시</span><span>12시</span><span>23시</span></div>
                      {Math.max(...hours) > 0 && (
                        <div className="mt-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2.5 text-[12px] text-slate-700 flex gap-2"><Clock className="w-4 h-4 text-fuchsia-700 shrink-0 mt-0.5" />{top}시에 가장 많이 열었어요. 다음에도 이 시간에 보내면 좋아요.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : tab === 'events' ? (
              !data ? <Spin /> : data.events.length === 0 ? <Empty text="발송 이력이 없어요." /> : (
                <div className="space-y-1">
                  <div className="flex justify-end mb-1"><button type="button" onClick={onOpenEvents} className="text-[12px] font-semibold text-violet-700 hover:text-violet-800">전체 이력 보기</button></div>
                  {data.events.slice(0, 100).map((e, i) => (
                    <div key={i} className="grid grid-cols-[120px_90px_1fr] gap-2 items-center h-9 px-3 rounded-lg bg-white text-[12px] text-slate-700">
                      <span className="text-slate-500">{new Date(e.occurredAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold">{EVENT_LABEL[e.eventType] || e.eventType}</span>
                      <span className="truncate text-slate-500">{maskEmail(e.email)}</span>
                    </div>
                  ))}
                </div>
              )
            ) : tab === 'people' ? (
              !data ? <Spin /> : data.recipients.length === 0 ? <Empty text="받은 사람 기록이 없어요." /> : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_70px_70px_80px] gap-2 px-3 py-2 text-[11px] text-slate-400 bg-white"><span>메일</span><span>오픈</span><span>클릭</span><span>상태</span></div>
                  {data.recipients.slice(0, 100).map((r) => (
                    <div key={r.email} className="grid grid-cols-[1fr_70px_70px_80px] gap-2 px-3 py-2 text-[12px] text-slate-700 border-t border-slate-100">
                      <span className="truncate">{maskEmail(r.email)}</span><span>{r.openCount || 0}</span><span>{r.clickCount || 0}</span>
                      <span className={r.bouncedAt || r.unsubscribedAt ? 'text-rose-700' : r.openedAt ? 'text-emerald-700' : 'text-slate-400'}>{r.bouncedAt ? '반송' : r.unsubscribedAt ? '수신거부' : r.openedAt ? '열어 봄' : '안 열어 봄'}</span>
                    </div>
                  ))}
                  {data.total > 100 && <div className="px-3 py-2 text-[11.5px] text-slate-400 border-t border-slate-100">최근 100명만 보여요 · 전체 {data.total.toLocaleString()}명</div>}
                </div>
              )
            ) : (
              <div className="py-8 text-center">
                <div className="text-[14px] font-bold text-slate-900">AI가 이 메일 성과를 풀어 드려요</div>
                <div className="text-[12.5px] text-slate-500 mt-1.5">오픈·클릭 기록으로 무엇이 잘 됐는지, 다음에 무엇을 바꾸면 좋을지 알려 드려요.</div>
                <button type="button" onClick={onInsight} disabled={sent === 0} className="mt-4 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40"><Sparkles className="w-4 h-4" />AI 진단 받기</button>
                {sent === 0 && <div className="text-[11.5px] text-slate-400 mt-2">보낸 뒤에 받을 수 있어요.</div>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-slate-200 flex-wrap">
            <span className="mr-auto text-[10px] text-slate-400 italic">Data source: 메일 집계 · 링크·시간대 = 최근 500건 표본{sampleCapped ? '(상한 도달)' : ''} · 오픈 = 메일 이미지 로딩 기준</span>
            {c.status === 'scheduled' && <button type="button" onClick={onCancelSchedule} className={MK_BTN_OUTLINE}>예약 취소</button>}
            {c.status === 'completed' && sent > 0 && (
              <>
                <button type="button" onClick={onNonOpener} className={MK_BTN_OUTLINE}><Smartphone className="w-4 h-4" />안 연 사람에게 문자로</button>
                <button type="button" onClick={onNonOpener} className={MK_BTN_PRIMARY}><RefreshCw className="w-4 h-4" />안 연 사람에게 다시 보내기 · {Math.max(0, sent - (c.openCount || 0) - (c.bounceCount || 0)).toLocaleString()}명</button>
              </>
            )}
            {(c.status === 'draft' || c.status === 'failed') && <button type="button" onClick={onSend} className={MK_BTN_PRIMARY}><Send className="w-4 h-4" />{c.status === 'failed' ? '다시 보내기' : '보내기'}</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ k, v, p }: { k: string; v: number; p?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] text-slate-500">{k}</div>
      <div className="text-[18px] font-extrabold text-slate-900 leading-tight mt-0.5">{v.toLocaleString()}{typeof p === 'number' && <span className="text-[11.5px] font-bold text-violet-700 ml-1.5">{p}%</span>}</div>
    </div>
  );
}
function Spin() { return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>; }
function Empty({ text }: { text: string }) { return <div className="py-14 text-center text-[13px] text-slate-400">{text}</div>; }
