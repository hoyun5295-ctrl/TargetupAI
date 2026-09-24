// SnsPostModal — 올린 글 상세 창 (2026-09-25 · Harold 0925 목업 승인)
// 설계 = docs/2026-09-24-sns-channel-design.md §12(0925 올린 기록 카드 그리드)
//
// 왼쪽 = 올린 사진·영상(글만 있으면 본문) · 오른쪽 = 채널 탭마다 계정·상태·게시물 보기·**그 채널에 올라간 글 그대로**.
// 실패·확인 필요 채널의 할 일 버튼은 그 탭 안에만 둔다(카드에는 두지 않는다 · 난잡해지지 않게).
// ⛔ 바깥을 눌러 닫지 않는다(다른 SNS 창과 같다 · 닫기 = X · ESC). native dialog 0.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Link2, RefreshCw, CopyPlus, Loader2, Play, ImageIcon } from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import {
  SNS_ACTION_LABEL, SNS_TARGET_DISPLAY, snsTargetDisplayState, snsTargetAccountName, SNS_AI_IMAGE_NOTICE,
  type SnsPostView, type SnsSpec, type SnsAccount, type SnsTargetView,
} from '../../utils/sns-view';
import { OUI_BTN_PRIMARY, OUI_BTN_OUTLINE } from '../../utils/operator-ui';

interface Props {
  post: SnsPostView;
  specs: SnsSpec[];
  accounts: SnsAccount[];
  busyTargetId: string | null;
  onClose: () => void;
  onReconnect: (accountId: string) => void;
  onRetry: (t: SnsTargetView) => void;
  onReuse: (post: SnsPostView) => void;
}

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 인증 주소 사진을 blob 으로 받아 띄운다(`<img src>` 에 인증 주소를 넣지 않는다 · B-0923-4). */
function AuthImage({ url, className, alt = '' }: { url: string; className: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setSrc(null);
    setFailed(false);
    fetchAuthObjectUrl(url)
      .then((u) => { if (alive) { made = u; setSrc(u); } else URL.revokeObjectURL(u); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  if (src) return <img src={src} alt={alt} className={className} />;
  return (
    <div className={`${className} flex items-center justify-center`}>
      {failed ? <ImageIcon className="w-5 h-5 text-white/25" /> : <Loader2 className="w-5 h-5 animate-spin text-white/30" />}
    </div>
  );
}

export default function SnsPostModal({ post, specs, accounts, busyTargetId, onClose, onReconnect, onRetry, onReuse }: Props) {
  const latest = useMemo(() => post.targets.filter((t) => !t.superseded), [post]);
  const [tab, setTab] = useState(0);
  const media = post.media ?? post.media_ids.map((id) => ({ id, kind: 'image' }));
  const photos = media.filter((m) => m.kind !== 'video');
  const video = media.find((m) => m.kind === 'video');
  const [shown, setShown] = useState(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setTab(0); setShown(0); }, [post.id]);
  useEffect(() => { if (tab >= latest.length) setTab(0); }, [latest.length, tab]);

  // ESC 닫기 + 뒤 화면 스크롤 잠금 + 처음 초점은 닫기 버튼 — **열릴 때 한 번만**
  //   (부모가 폴링으로 다시 그려 onClose 가 새로 와도 초점이 닫기 버튼으로 튀지 않게 ref 로 부른다)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);

  const labelOf = (platform: string) => specs.find((s) => s.platform === platform)?.label || platform;
  const t = latest[tab];
  const state = t ? snsTargetDisplayState(t) : null;
  const look = state ? SNS_TARGET_DISPLAY[state] : null;
  const action = t?.action ?? 'none';

  // 올라간 글 = 본문 + 꼬리(태그 줄 · AI 표시). 꼬리만 색을 달리해 무엇이 붙었는지 보이게 한다.
  const caption = t?.caption || post.body || '';
  const bodyPart = post.body && caption.startsWith(post.body) ? post.body : caption;
  const tailPart = caption.slice(bodyPart.length);
  const noticeAt = tailPart.lastIndexOf(SNS_AI_IMAGE_NOTICE);
  const tagPart = noticeAt >= 0 ? tailPart.slice(0, noticeAt) : tailPart;
  const noticePart = noticeAt >= 0 ? tailPart.slice(noticeAt) : '';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sns-post-modal-title">
      <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-white/10">
          <div className="min-w-0 flex-1">
            <p id="sns-post-modal-title" className="text-sm font-semibold text-white">올린 글</p>
            <p className="text-xs text-white/45 mt-0.5 tabular-nums">
              {when(post.scheduled_at ?? post.created_at)} · {post.scheduled_at ? '예약해서 올림' : '바로 올림'} · {latest.length}곳
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} className="p-2 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
          {/* 왼쪽 — 올린 것 */}
          <div className="p-4 border-b md:border-b-0 md:border-r border-white/10 flex flex-col gap-2.5 min-h-0">
            {photos.length > 0 ? (
              <>
                <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-950/60">
                  <AuthImage url={`/api/sns/media/${photos[Math.min(shown, photos.length - 1)].id}`} className="w-full h-full object-contain" alt="올린 사진" />
                </div>
                {photos.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {photos.map((m, i) => (
                      <button key={m.id} onClick={() => setShown(i)} aria-label={`${i + 1}번째 사진`} aria-pressed={i === shown}
                        className={`w-11 h-11 rounded-lg overflow-hidden border transition-colors ${i === shown ? 'border-violet-400/70' : 'border-white/10 hover:border-white/30'}`}>
                        <AuthImage url={`/api/sns/media/${m.id}?thumb=1`} className="w-full h-full object-cover bg-white/5" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : video ? (
              <div className="relative aspect-square rounded-xl overflow-hidden bg-[radial-gradient(120%_90%_at_30%_20%,#1f2a4a_0%,#0b1224_70%)] flex flex-col items-center justify-center gap-3">
                <span className="w-14 h-14 rounded-full bg-slate-950/65 flex items-center justify-center"><Play className="w-6 h-6 text-white" /></span>
                <span className="text-xs text-white/55">영상은 채널에서 볼 수 있어요</span>
              </div>
            ) : (
              <div className="aspect-square rounded-xl bg-slate-950/50 border border-white/10 p-5 overflow-y-auto">
                <p className="text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap break-keep">{post.body || '(글 없음)'}</p>
              </div>
            )}
          </div>

          {/* 오른쪽 — 채널별 */}
          <div className="p-4 sm:p-5 flex flex-col gap-3 min-h-0">
            <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="채널">
              {latest.map((x, i) => {
                const s = SNS_TARGET_DISPLAY[snsTargetDisplayState(x)];
                return (
                  <button key={x.targetId} role="tab" aria-selected={i === tab} onClick={() => setTab(i)}
                    className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-2 transition-colors ${
                      i === tab ? 'bg-violet-500/15 border-violet-400/45 text-white' : 'bg-white/[0.03] border-white/10 text-white/65 hover:text-white hover:border-white/25'
                    }`}>
                    <span className="relative inline-flex">
                      <SnsChannelLogo platform={x.platform} size={14} />
                      <i className={`absolute -right-1 -bottom-1 w-1.5 h-1.5 rounded-full ring-2 ring-slate-900 ${s.dot}`} />
                    </span>
                    {labelOf(x.platform)}
                  </button>
                );
              })}
            </div>

            {t && look && (
              <>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-white/55">{snsTargetAccountName(t, accounts)}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded border ${look.badge}`}>{look.label}</span>
                  {state === 'gone' && <span className="text-white/40">채널에서 삭제된 것으로 확인됐어요</span>}
                  <div className="flex-1" />
                  {t.permalink && (
                    <a href={t.permalink} target="_blank" rel="noreferrer" className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                      게시물 보기 <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {(state === 'fail' || state === 'check') && t.lastError && (
                  <p className={`text-xs leading-relaxed rounded-lg border px-3 py-2 break-keep ${
                    state === 'check' ? 'text-amber-100 bg-amber-500/[0.08] border-amber-400/25' : 'text-rose-100 bg-rose-500/[0.08] border-rose-400/25'
                  }`}>{t.lastError}</p>
                )}

                <p className="text-[11px] text-white/45">이 채널에 올라간 글 그대로</p>
                <div className="flex-1 min-h-[8rem] md:max-h-[40vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/45 px-3.5 py-3 text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap break-words">
                  {bodyPart}
                  {tagPart && <span className="text-violet-300">{tagPart}</span>}
                  {noticePart && <span className="text-white/40">{noticePart}</span>}
                  {!caption && <span className="text-white/35">(글 없음)</span>}
                </div>

                {action !== 'none' && (
                  <div className="flex gap-2 flex-wrap">
                    {action === 'reconnect' && t.accountId && (
                      <button onClick={() => onReconnect(t.accountId!)} className={`${OUI_BTN_OUTLINE} !text-amber-100 !border-amber-400/40 hover:!bg-amber-500/15`}>
                        <Link2 className="w-3.5 h-3.5" /> {SNS_ACTION_LABEL.reconnect}
                      </button>
                    )}
                    {(action === 'retry_at' || action === 'publish_now') && (
                      <button onClick={() => onRetry(t)} disabled={busyTargetId === t.targetId} className={OUI_BTN_OUTLINE}>
                        {busyTargetId === t.targetId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        {SNS_ACTION_LABEL[action]}{action === 'retry_at' && t.scheduledAt ? ` · ${when(t.scheduledAt)}` : ''}
                      </button>
                    )}
                    {action === 'check' && !t.permalink && t.checkUrl && (
                      <a href={t.checkUrl} target="_blank" rel="noreferrer" className={OUI_BTN_OUTLINE}>
                        {SNS_ACTION_LABEL.check} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-3 border-t border-white/10">
          <span className="text-[11px] text-white/45 break-keep">
            {latest.length > 1 ? '채널마다 올라간 글이 다를 수 있어요. 위 탭으로 바꿔 보세요.' : ''}
          </span>
          <button onClick={() => onReuse(post)} className={OUI_BTN_PRIMARY}>
            <CopyPlus className="w-3.5 h-3.5" /> 불러와서 다시 쓰기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
