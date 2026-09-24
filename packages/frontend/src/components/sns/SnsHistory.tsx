// SnsHistory — 예약과 올린 기록 (2026-09-21 S3 · ★ 2026-09-24 E1~E8)
// 설계 SoT = docs/2026-09-24-sns-channel-design.md §6(E1~E8) · 이전 = 0917 §4-3 · §3-5
//
// 두 블록 = '예약 N'(날짜 머리 · 다음 시각 순) → '올린 기록'(최근 50). 같은 글이 두 블록에 동시에 나오지 않는다(서버 CT).
// 채널 줄의 버튼은 서버가 정한 할 일(action) 하나로 정해진다 — 화면이 상태를 보고 추론하지 않는다.
// ⛔ 올라갔을 수 있는 줄에는 다시 올리기를 **열지 않는다** — 채널에서 확인 · 불러와서 쓰기만.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink, RefreshCw, Loader2, XCircle, ChevronDown, ChevronUp, Link2, Pencil, CopyPlus, ImageIcon, CalendarClock, Clock,
} from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import ConfirmModal, { ConfirmState } from '../ConfirmModal';
import { DateTimeField } from '../DateTimeField';
import { useToast } from '../ToastProvider';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import {
  SNS_POST_BADGE, SNS_ACTION_LABEL, snsTargetBadge, hasSnsInFlight, nextSnsScheduledAt, snsTargetAccountName, SNS_POLL_LEAD_MS,
  type SnsTargetView, type SnsSpec, type SnsAccount, type SnsPostView, type SnsAttention,
} from '../../utils/sns-view';
import { OUI_CARD, OUI_EMPTY, OUI_EMPTY_DESC, OUI_EMPTY_ICON, OUI_EMPTY_TITLE, OUI_SRC, OUI_BTN_GHOST } from '../../utils/operator-ui';

interface Props {
  specs: SnsSpec[];
  accounts: SnsAccount[];
  reloadKey: number;
  /** 띠 [보기]가 가리키는 글 — 그 글로 옮겨 잠깐 강조한다 */
  focusPostId: string | null;
  onAttention: (a: SnsAttention) => void;
  onCompose: (req: { kind: 'edit' | 'reuse'; post: SnsPostView }) => void;
  onReconnect: (accountId: string) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayHead(iso: string | null | undefined): string {
  if (!iso) return '날짜 미정';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '날짜 미정';
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  if (same(d, today)) return `오늘 · ${base}`;
  if (same(d, tomorrow)) return `내일 · ${base}`;
  return base;
}

/** 목록 썸네일 — 사진만(영상·못 받음은 아이콘). 인증 주소라 공용 CT 로 받는다. */
function SnsThumb({ mediaId, count }: { mediaId: string | undefined; count: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId) return;
    let alive = true;
    let made: string | null = null;
    fetchAuthObjectUrl(`/api/sns/media/${mediaId}?thumb=1`)
      .then((u) => { if (alive) { made = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => { /* 영상·못 받음 — 아이콘 */ });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [mediaId]);
  return (
    <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden border border-white/10 bg-white/5 flex-shrink-0 flex items-center justify-center">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4 text-white/25" />}
      {count > 1 && <span className="absolute right-0.5 bottom-0.5 text-[9px] px-1 rounded bg-slate-950/75 text-white/80">{count}</span>}
    </div>
  );
}

export default function SnsHistory({ specs, accounts, reloadKey, focusPostId, onAttention, onCompose, onReconnect }: Props) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const attentionRef = useRef(onAttention);
  attentionRef.current = onAttention;

  const [upcoming, setUpcoming] = useState<SnsPostView[]>([]);
  const [posts, setPosts] = useState<SnsPostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = async () => {
    try {
      const res = await fetch('/api/sns/posts', { headers: auth() });
      const data = await res.json();
      if (data?.success) {
        setUpcoming(Array.isArray(data.upcoming) ? data.upcoming : []);
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        if (data.attention) attentionRef.current(data.attention);
      }
    } catch {
      /* 목록 조회 실패는 조용히 — 다음 폴링이 되살린다 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // E8 — 진행 중(올리는 중·확인 대기·10분 안 예약)이면 15초마다. 아니면 다음 예약 10분 전에 깨운다.
  const all = useMemo(() => [...upcoming, ...posts], [upcoming, posts]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    let timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
    let interval = false;
    if (hasSnsInFlight(all)) {
      timer = setInterval(() => { void load(); }, 15_000);
      interval = true;
    } else {
      const next = nextSnsScheduledAt(all);
      if (next !== null) {
        // setTimeout 상한(약 24.8일)을 넘지 않게 자른다
        const wait = Math.min(Math.max(1_000, next - SNS_POLL_LEAD_MS - Date.now()), 2_000_000_000);
        timer = setTimeout(() => { void load(); }, wait);
      }
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) { if (interval) clearInterval(timer as ReturnType<typeof setInterval>); else clearTimeout(timer as ReturnType<typeof setTimeout>); }
    };
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  // 띠 [보기] — 그 글로 옮겨 잠깐 강조(한 번만 · 폴링으로 목록이 바뀌어도 다시 끌고 가지 않는다)
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPostId) { handledFocus.current = null; return; }
    if (loading || handledFocus.current === focusPostId) return;
    const el = document.getElementById(`sns-post-${focusPostId}`);
    if (!el) return;
    handledFocus.current = focusPostId;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setOpen((prev) => ({ ...prev, [focusPostId]: true }));
    setFlash(focusPostId);
  }, [focusPostId, loading, all]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  const labelOf = (platform: string) => specs.find((s) => s.platform === platform)?.label || platform;

  const retry = async (t: SnsTargetView) => {
    setBusyId(t.targetId);
    try {
      const res = await fetch(`/api/sns/targets/${t.targetId}/retry`, { method: 'POST', headers: auth() });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // 다시 연결이 먼저면 그 줄에 [다시 연결]이 뜬다(창은 사용자가 누를 때만 연다 · 팝업 차단)
        toastRef.current.error(data?.error || '다시 올리지 못했습니다.');
        void load();
        return;
      }
      const at = data.scheduledAt ? new Date(data.scheduledAt).getTime() : 0;
      toastRef.current.success(at > Date.now() + 60_000 ? `${when(data.scheduledAt)}에 다시 올려요.` : '다시 올리고 있어요.');
      void load();
    } catch {
      toastRef.current.error('다시 올리지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const askCancel = (p: SnsPostView) => {
    setConfirmState({
      mode: 'danger',
      title: '예약을 취소할까요?',
      description: '취소한 예약은 되살릴 수 없어요. 글은 기록에서 불러와 다시 쓸 수 있어요.',
      confirmLabel: '예약 취소',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/sns/posts/${p.id}/cancel`, { method: 'POST', headers: auth() });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.success) { toastRef.current.error(data?.error || '취소하지 못했습니다.'); void load(); return; }
          toastRef.current.success('예약을 취소했어요.');
          void load();
        } catch {
          toastRef.current.error('취소하지 못했습니다.');
        }
      },
    });
  };

  const reschedule = async (p: SnsPostView, iso: string) => {
    if (!iso) return;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/sns/posts/${p.id}/reschedule`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: iso }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) { toastRef.current.error(data?.error || '시각을 바꾸지 못했습니다.'); void load(); return; }
      toastRef.current.success(`${when(data.scheduledAt)}로 바꿨어요.`);
      void load();
    } catch {
      toastRef.current.error('시각을 바꾸지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  /** 채널 줄 — 계정 이름 · 배지 · 사유 · 할 일 버튼(서버가 정한 action) */
  const targetLine = (p: SnsPostView, t: SnsTargetView) => {
    const b = snsTargetBadge(t);
    const action = t.action ?? 'none';
    const dim = !!t.superseded;
    return (
      <div key={t.targetId} className={`flex items-center gap-2 flex-wrap text-[11.5px] ${dim ? 'opacity-45' : ''}`}>
        <SnsChannelLogo platform={t.platform} size={14} />
        <span className="text-white/70">{labelOf(t.platform)}</span>
        <span className="text-white/40">{snsTargetAccountName(t, accounts)}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
        {dim && <span className="text-white/35">다시 올려 바뀐 줄</span>}
        {!dim && b.hint && <span className="text-white/35">{b.hint}</span>}
        {!dim && t.lastError && t.status === 'failed' && <span className="text-rose-200/70 break-keep">{t.lastError}</span>}
        {!dim && action === 'check' && <span className="text-amber-200/80">이미 올라갔을 수 있어요</span>}
        <div className="flex-1" />
        {t.permalink && (
          <a href={t.permalink} target="_blank" rel="noreferrer"
            className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            게시물 보기 <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {!dim && action === 'reconnect' && t.accountId && (
          <button onClick={() => onReconnect(t.accountId!)} className="text-amber-200 hover:text-amber-100 inline-flex items-center gap-1">
            <Link2 className="w-3 h-3" /> {SNS_ACTION_LABEL.reconnect}
          </button>
        )}
        {!dim && (action === 'retry_at' || action === 'publish_now') && (
          <button onClick={() => void retry(t)} disabled={busyId === t.targetId}
            className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1 disabled:opacity-50"
            title={action === 'retry_at' && t.scheduledAt ? `원래 시각 ${when(t.scheduledAt)}` : undefined}>
            {busyId === t.targetId ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {SNS_ACTION_LABEL[action]}{action === 'retry_at' && t.scheduledAt ? ` · ${when(t.scheduledAt)}` : ''}
          </button>
        )}
        {!dim && action === 'check' && !t.permalink && t.checkUrl && (
          <a href={t.checkUrl} target="_blank" rel="noreferrer" className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            {SNS_ACTION_LABEL.check} <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {!dim && (action === 'check' || action === 'rewrite') && (
          <button onClick={() => onCompose({ kind: 'reuse', post: p })} className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            <CopyPlus className="w-3 h-3" /> {SNS_ACTION_LABEL.rewrite}
          </button>
        )}
      </div>
    );
  };

  const captionsBlock = (p: SnsPostView) => {
    const rows = p.targets.filter((t) => !t.superseded && t.caption);
    if (!rows.length) return null;
    return (
      <div className="mt-3 space-y-2">
        {rows.map((t) => (
          <div key={t.targetId} className="rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
            <div className="flex items-center gap-1.5 mb-1 text-[11px] text-white/55">
              <SnsChannelLogo platform={t.platform} size={12} />
              {labelOf(t.platform)} · {snsTargetAccountName(t, accounts)}
            </div>
            <p className="text-[12px] text-white/75 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{t.caption}</p>
          </div>
        ))}
      </div>
    );
  };

  const upcomingGroups = useMemo(() => {
    const groups: Array<{ head: string; items: SnsPostView[] }> = [];
    for (const p of upcoming) {
      const head = dayHead(p.nextAt ?? p.scheduled_at);
      const g = groups.find((x) => x.head === head);
      if (g) g.items.push(p); else groups.push({ head, items: [p] });
    }
    return groups;
  }, [upcoming]);

  if (loading) {
    return (
      <div className={`${OUI_CARD} p-8 flex justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {/* 예약 */}
      {upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white/80 inline-flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-sky-300" /> 예약 {upcoming.length}
          </h2>
          {upcomingGroups.map((g) => (
            <div key={g.head} className="space-y-2">
              <p className="text-[11px] text-white/45">{g.head}</p>
              {g.items.map((p) => {
                const latest = p.targets.filter((t) => !t.superseded);
                const broken = latest.some((t) => t.accountStatus && t.accountStatus !== 'active');
                const expanded = !!open[p.id];
                return (
                  <div key={p.id} id={`sns-post-${p.id}`}
                    className={`${OUI_CARD} p-3.5 sm:p-4 transition-shadow ${flash === p.id ? 'ring-2 ring-violet-400/60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <SnsThumb mediaId={p.media_ids[0]} count={p.media_ids.length} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-sky-200 tabular-nums inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />{timeOnly(p.nextAt ?? p.scheduled_at)}
                          </span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {latest.map((t) => (
                              <span key={t.targetId} className="inline-flex items-center gap-1 text-[11px] text-white/55">
                                <SnsChannelLogo platform={t.platform} size={12} />{snsTargetAccountName(t, accounts)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-white/80 mt-1 line-clamp-2 break-keep">{p.body || '(글 없음)'}</p>
                        {broken && (
                          <p className="mt-1 text-[11px] text-amber-200/80 break-keep">연결이 끊긴 채널이 있어요. 다시 연결하면 이 시각에 그대로 올라가요.</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <div className="w-full sm:w-60">
                        <DateTimeField value={p.nextAt ?? p.scheduled_at ?? ''} onChange={(iso) => void reschedule(p, iso)}
                          title="바꿀 시각 선택" disabled={busyId === p.id} />
                      </div>
                      <button onClick={() => onCompose({ kind: 'edit', post: p })} disabled={broken}
                        title={broken ? '연결이 끊긴 채널이 있어 지금은 고칠 수 없어요' : undefined}
                        className={`${OUI_BTN_GHOST} disabled:opacity-40`}>
                        <Pencil className="w-3.5 h-3.5" /> 글 고치기
                      </button>
                      <button onClick={() => askCancel(p)} className={OUI_BTN_GHOST}>
                        <XCircle className="w-3.5 h-3.5" /> 예약 취소
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => setOpen((prev) => ({ ...prev, [p.id]: !expanded }))}
                        className="text-[11px] text-white/45 hover:text-white/75 inline-flex items-center gap-1">
                        올라갈 글 {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>
                    {expanded && captionsBlock(p)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* 올린 기록 */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/80">올린 기록</h2>
        {posts.length === 0 ? (
          <div className={`${OUI_CARD} ${OUI_EMPTY}`}>
            <div className={OUI_EMPTY_ICON}><RefreshCw className="w-5 h-5 text-white/40" /></div>
            <p className={OUI_EMPTY_TITLE}>아직 올린 글이 없어요</p>
            <p className={OUI_EMPTY_DESC}>위에서 사진과 글을 올리면 여기에 쌓입니다.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {posts.map((p) => {
              const badge = SNS_POST_BADGE[p.status];
              const expanded = !!open[p.id];
              const shown = expanded ? p.targets : p.targets.filter((t) => !t.superseded);
              const hasSuperseded = p.targets.some((t) => t.superseded);
              return (
                <div key={p.id} id={`sns-post-${p.id}`}
                  className={`${OUI_CARD} p-3.5 sm:p-4 transition-shadow ${flash === p.id ? 'ring-2 ring-violet-400/60' : ''}`}>
                  <div className="flex items-start gap-3">
                    {p.media_ids.length > 0 && <SnsThumb mediaId={p.media_ids[0]} count={p.media_ids.length} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>}
                        <span className="text-[11px] text-white/40">
                          {p.scheduled_at ? `${when(p.scheduled_at)} 예약` : when(p.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-white/80 mt-1.5 line-clamp-2 break-keep">{p.body || '(글 없음)'}</p>
                    </div>
                    <button onClick={() => onCompose({ kind: 'reuse', post: p })}
                      className="p-1.5 rounded-lg text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors flex-shrink-0"
                      title="불러와서 쓰기" aria-label="불러와서 쓰기">
                      <CopyPlus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {shown.map((t) => targetLine(p, t))}
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button onClick={() => setOpen((prev) => ({ ...prev, [p.id]: !expanded }))}
                      className="text-[11px] text-white/45 hover:text-white/75 inline-flex items-center gap-1">
                      {expanded ? '접기' : hasSuperseded ? '올라간 글 · 지난 시도' : '올라간 글'}
                      {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                  {expanded && captionsBlock(p)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className={OUI_SRC}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </section>
  );
}
