// SnsHistory — 예약·이력 구역 (2026-09-21 S3)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-3 · §3-5
//
// 한 줄 = 게시물 묶음, 그 아래 채널 줄 N. 배지 판정은 `utils/sns-view.ts` 가 소유하고 여기는 그린다.
// ⛔ "올렸고 확인 중"에는 다시 올리기를 **열지 않는다** — 올라갔을 수 있는데 또 올리면 두 개가 된다.

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Loader2, XCircle } from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import { useToast } from '../ToastProvider';
import {
  SNS_POST_BADGE, snsTargetBadge, canRetrySnsTarget, hasSnsInFlight,
  type SnsTargetView, type SnsSpec,
} from '../../utils/sns-view';
import { OUI_CARD, OUI_EMPTY, OUI_EMPTY_DESC, OUI_EMPTY_ICON, OUI_EMPTY_TITLE, OUI_SRC } from '../../utils/operator-ui';

interface SnsPostRow {
  id: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  targets: SnsTargetView[];
}

interface Props {
  specs: SnsSpec[];
  reloadKey: number;
}

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function SnsHistory({ specs, reloadKey }: Props) {
  const toast = useToast();
  const [posts, setPosts] = useState<SnsPostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = async () => {
    try {
      const res = await fetch('/api/sns/posts', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (data?.success) setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch {
      /* 목록 조회 실패는 조용히 — 다음 폴링이 되살린다 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [reloadKey]);

  // 진행 중인 것이 있을 때만 폴링한다. 끝난 목록을 계속 두드리지 않는다.
  useEffect(() => {
    if (!hasSnsInFlight(posts)) return;
    const timer = setInterval(() => { void load(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [posts]);

  const retry = async (targetId: string) => {
    try {
      const res = await fetch(`/api/sns/targets/${targetId}/retry`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!data?.success) { toastRef.current.error(data?.error || '다시 시도하지 못했습니다.'); return; }
      toastRef.current.success('다시 올립니다.');
      void load();
    } catch {
      toastRef.current.error('다시 시도하지 못했습니다.');
    }
  };

  const cancel = async (postId: string) => {
    try {
      const res = await fetch(`/api/sns/posts/${postId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!data?.success) { toastRef.current.error(data?.error || '취소하지 못했습니다.'); return; }
      toastRef.current.success('예약을 취소했습니다.');
      void load();
    } catch {
      toastRef.current.error('취소하지 못했습니다.');
    }
  };

  const labelOf = (platform: string) => specs.find((s) => s.platform === platform)?.label || platform;

  if (loading) {
    return (
      <div className={`${OUI_CARD} p-8 flex justify-center`}>
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <section className="space-y-3">
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
            const cancellable = p.targets.some((t) => t.status === 'scheduled');
            return (
              <div key={p.id} className={`${OUI_CARD} p-4`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>}
                      <span className="text-[11px] text-white/40">
                        {p.scheduled_at ? `${when(p.scheduled_at)} 예정` : when(p.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-white/80 mt-1.5 line-clamp-2 break-keep">{p.body || '(사진만)'}</p>
                  </div>
                  {cancellable && (
                    <button onClick={() => void cancel(p.id)}
                      className="p-1.5 rounded-lg text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors" aria-label="예약 취소">
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="mt-3 space-y-1.5">
                  {p.targets.map((t) => {
                    const b = snsTargetBadge(t);
                    return (
                      <div key={t.targetId} className="flex items-center gap-2 flex-wrap text-[11.5px]">
                        <SnsChannelLogo platform={t.platform} size={14} />
                        <span className="text-white/70">{labelOf(t.platform)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                        {b.hint && <span className="text-white/35">{b.hint}</span>}
                        {t.lastError && t.status === 'failed' && <span className="text-rose-200/70 break-keep">{t.lastError}</span>}
                        <div className="flex-1" />
                        {t.permalink && (
                          <a href={t.permalink} target="_blank" rel="noreferrer"
                            className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                            게시물 보기 <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {canRetrySnsTarget(t) && (
                          <button onClick={() => void retry(t.targetId)}
                            className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> 다시 시도
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className={OUI_SRC}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>
    </section>
  );
}
