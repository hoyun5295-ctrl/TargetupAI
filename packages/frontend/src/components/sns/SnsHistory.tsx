// SnsHistory — 예약과 올린 기록 (2026-09-21 S3 · ★ 2026-09-24 E1~E8)
// 설계 SoT = docs/2026-09-24-sns-channel-design.md §6(E1~E8) · 이전 = 0917 §4-3 · §3-5
//
// 두 블록 = '예약 N'(날짜 머리 · 다음 시각 순) → '올린 기록'. 같은 글이 두 블록에 동시에 나오지 않는다(서버 CT).
// ★ 2026-09-25 올린 기록 = 카드 5 × 2 · 페이지 번호(서버 10개씩) · 카드를 누르면 상세 창(SnsPostModal) — Harold 0925 목업 승인.
//   카드에는 문제가 있을 때만 표시를 붙이고, 할 일 버튼은 상세 창 채널 탭 안에만 둔다(난잡하지 않게).
// 채널 줄의 버튼은 서버가 정한 할 일(action) 하나로 정해진다 — 화면이 상태를 보고 추론하지 않는다.
// ⛔ 올라갔을 수 있는 줄에는 다시 올리기를 **열지 않는다** — 채널에서 확인 · 불러와서 쓰기만.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Loader2, XCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, ImageIcon, CalendarClock, Clock, Play,
} from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import SnsPostModal from './SnsPostModal';
import ConfirmModal, { ConfirmState } from '../ConfirmModal';
import { DateTimeField } from '../DateTimeField';
import { useToast } from '../ToastProvider';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import {
  hasSnsInFlight, nextSnsScheduledAt, snsTargetAccountName, SNS_POLL_LEAD_MS,
  snsPostCardState, snsTargetDisplayState, SNS_TARGET_DISPLAY,
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

/** 카드 표지 — 사진 썸네일(정사각 채움). 못 받으면 아이콘. */
function SnsCover({ mediaId }: { mediaId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    fetchAuthObjectUrl(`/api/sns/media/${mediaId}?thumb=1`)
      .then((u) => { if (alive) { made = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => { /* 못 받음 — 아이콘 */ });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [mediaId]);
  return url
    ? <img src={url} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-white/20" /></div>;
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
  // ★ 0925 올린 기록 페이지 · 상세 창
  const [page, setPage] = useState(1);
  const pageRef = useRef(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [modalPost, setModalPost] = useState<SnsPostView | null>(null);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = async (nextPage: number = pageRef.current) => {
    try {
      const res = await fetch(`/api/sns/posts?page=${nextPage}`, { headers: auth() });
      const data = await res.json();
      if (data?.success) {
        const size = Number(data.pageSize) || 10;
        const count = Number(data.total) || 0;
        const lastPage = Math.max(1, Math.ceil(count / size));
        // 글이 줄어 지금 페이지가 비었으면 마지막 페이지로 간다
        if (nextPage > lastPage && Array.isArray(data.posts) && data.posts.length === 0) { void load(lastPage); return; }
        pageRef.current = Number(data.page) || nextPage;
        setPage(pageRef.current);
        setPageSize(size);
        setTotal(count);
        setUpcoming(Array.isArray(data.upcoming) ? data.upcoming : []);
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        if (data.attention) attentionRef.current(data.attention);
      }
    } catch {
      /* 목록 조회 실패는 조용히 — 다음 폴링이 되살린다 */
    } finally {
      setLoading(false);
      setPageLoading(false);
    }
  };

  const goPage = (n: number) => {
    setPageLoading(true);
    void load(n);
  };

  /** 글 하나를 서버에서 다시 읽는다(상세 창 새로 고침 · 지금 페이지 밖 글 열기). */
  const fetchPost = async (id: string): Promise<SnsPostView | null> => {
    try {
      const res = await fetch(`/api/sns/posts/${id}`, { headers: auth() });
      const data = await res.json().catch(() => null);
      return res.ok && data?.success ? (data.post as SnsPostView) : null;
    } catch {
      return null;
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
  // ★ 0925 — 예약 글이면 그 줄로 옮겨 강조, 기록 글이면 상세 창을 연다(지금 페이지 밖이면 서버에서 그 글만 읽는다).
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPostId) { handledFocus.current = null; return; }
    if (loading || handledFocus.current === focusPostId) return;
    handledFocus.current = focusPostId;
    const el = upcoming.some((p) => p.id === focusPostId) ? document.getElementById(`sns-post-${focusPostId}`) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setOpen((prev) => ({ ...prev, [focusPostId]: true }));
      setFlash(focusPostId);
      return;
    }
    const inPage = posts.find((p) => p.id === focusPostId);
    if (inPage) { setModalPost(inPage); return; }
    void fetchPost(focusPostId).then((p) => {
      if (p) setModalPost(p);
      else toastRef.current.error('그 글을 찾지 못했어요. 목록을 새로 고쳐 주세요.');
    });
  }, [focusPostId, loading, all]); // eslint-disable-line react-hooks/exhaustive-deps

  // 목록이 새로 오면 열려 있는 상세 창도 새 값으로(폴링으로 상태가 바뀐 것을 창에서도 보게)
  useEffect(() => {
    setModalPost((cur) => (cur ? all.find((p) => p.id === cur.id) ?? cur : cur));
  }, [all]);

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
      if (modalPost) void fetchPost(modalPost.id).then((p) => { if (p) setModalPost(p); });
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  /** 페이지 번호는 지금 페이지 둘레 5개까지 */
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, pageCount - 4));
    const end = Math.min(pageCount, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [page, pageCount]);

  /** 카드 — 표지(사진·영상·글) · 첫 줄 · 채널 로고와 상태 점 · 날짜. 문제가 있을 때만 표시. */
  const postCard = (p: SnsPostView) => {
    const latest = p.targets.filter((t) => !t.superseded);
    const state = snsPostCardState(p.targets);
    const media = p.media ?? p.media_ids.map((id) => ({ id, kind: 'image' }));
    const first = media[0];
    const toneCls = {
      rose: 'bg-rose-500/25 text-rose-100 border-rose-400/45',
      amber: 'bg-amber-500/25 text-amber-100 border-amber-400/40',
      violet: 'bg-violet-500/25 text-violet-100 border-violet-400/40',
      gray: 'bg-slate-950/60 text-white/70 border-white/15',
    } as const;
    const ring = state?.tone === 'rose' ? 'border-rose-400/40' : state?.tone === 'amber' ? 'border-amber-400/35' : 'border-white/10';
    const d = new Date(p.scheduled_at ?? p.created_at);
    const day = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return (
      <button key={p.id} onClick={() => setModalPost(p)} aria-label={`${when(p.scheduled_at ?? p.created_at)} 올린 글 열기`}
        className={`text-left rounded-2xl border ${ring} bg-white/5 hover:bg-white/[0.07] hover:border-violet-400/40 overflow-hidden flex flex-col transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70`}>
        <div className="relative aspect-square bg-[#0b1224] overflow-hidden">
          {first && first.kind === 'video' ? (
            <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(120%_90%_at_30%_20%,#1f2a4a_0%,#0b1224_70%)]">
              <span className="w-10 h-10 rounded-full bg-slate-950/65 flex items-center justify-center"><Play className="w-4 h-4 text-white" /></span>
            </div>
          ) : first ? (
            <SnsCover mediaId={first.id} />
          ) : (
            <div className="w-full h-full p-3.5 bg-gradient-to-br from-[#111a33] to-[#0b1224] relative">
              <p className="text-xs leading-relaxed text-white/70 whitespace-pre-wrap break-keep line-clamp-[7]">{p.body || '(글 없음)'}</p>
              <span className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-b from-transparent to-[#0b1224]" />
            </div>
          )}
          {media.length > 1 && (
            <span className="absolute right-2 top-2 text-[11px] px-1.5 rounded-md bg-slate-950/75 text-white/80">{media.length}장</span>
          )}
          {state && (
            <span className={`absolute left-2 top-2 text-[11px] px-1.5 py-0.5 rounded-md border backdrop-blur-sm ${toneCls[state.tone]}`}>{state.label}</span>
          )}
        </div>
        <div className="p-3 flex flex-col gap-2 flex-1">
          <p className="text-xs leading-normal text-white/80 line-clamp-2 break-keep min-h-[2.25rem]">{(p.body || '').split('\n')[0] || '(글 없음)'}</p>
          <div className="mt-auto flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5">
              {latest.map((t) => {
                const look = SNS_TARGET_DISPLAY[snsTargetDisplayState(t)];
                return (
                  <span key={t.targetId} className="relative inline-flex" title={`${snsTargetAccountName(t, accounts)} · ${look.label}`}>
                    <SnsChannelLogo platform={t.platform} size={17} />
                    <i className={`absolute -right-0.5 -bottom-0.5 w-[7px] h-[7px] rounded-full ring-2 ring-[#0e1528] ${look.dot}`} />
                  </span>
                );
              })}
            </span>
            <span className="text-[11px] text-white/45 tabular-nums whitespace-nowrap">{day}</span>
          </div>
        </div>
      </button>
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

      {/* 올린 기록 — 카드 5 × 2 · 페이지 번호 · 누르면 상세 창 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white/80 inline-flex items-center gap-2">
            올린 기록 {total > 0 && <span className="text-xs font-medium text-white/35 tabular-nums">{total}개</span>}
            {pageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />}
          </h2>
          {pageCount > 1 && (
            <nav className="flex items-center gap-1" aria-label="올린 기록 페이지">
              <button onClick={() => goPage(page - 1)} disabled={page <= 1 || pageLoading} aria-label="이전 페이지"
                className="h-8 min-w-[2rem] px-2 rounded-lg text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {pageNumbers.map((n) => (
                <button key={n} onClick={() => goPage(n)} disabled={pageLoading} aria-current={n === page ? 'page' : undefined}
                  className={`h-8 min-w-[2rem] px-2 rounded-lg text-xs tabular-nums border transition-colors ${
                    n === page ? 'bg-violet-500/20 border-violet-400/35 text-violet-100 font-semibold' : 'border-transparent text-white/55 hover:bg-white/10 hover:text-white'
                  }`}>
                  {n}
                </button>
              ))}
              <button onClick={() => goPage(page + 1)} disabled={page >= pageCount || pageLoading} aria-label="다음 페이지"
                className="h-8 min-w-[2rem] px-2 rounded-lg text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </nav>
          )}
        </div>
        {posts.length === 0 ? (
          <div className={`${OUI_CARD} ${OUI_EMPTY}`}>
            <div className={OUI_EMPTY_ICON}><RefreshCw className="w-5 h-5 text-white/40" /></div>
            <p className={OUI_EMPTY_TITLE}>아직 올린 글이 없어요</p>
            <p className={OUI_EMPTY_DESC}>위에서 사진과 글을 올리면 여기에 쌓입니다.</p>
          </div>
        ) : (
          <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 transition-opacity ${pageLoading ? 'opacity-60' : ''}`}>
            {posts.map((p) => postCard(p))}
          </div>
        )}
      </div>

      <p className={OUI_SRC}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      {modalPost && (
        <SnsPostModal
          post={modalPost}
          specs={specs}
          accounts={accounts}
          busyTargetId={busyId}
          onClose={() => setModalPost(null)}
          onReconnect={onReconnect}
          onRetry={(t) => void retry(t)}
          onReuse={(p) => { setModalPost(null); onCompose({ kind: 'reuse', post: p }); }}
        />
      )}
    </section>
  );
}
