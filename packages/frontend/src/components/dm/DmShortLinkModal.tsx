/**
 * DmShortLinkModal — 고객사 자체 URL 단축(hlj.kr) 발급/관리 모달 (2026-07-10 박성용 신기능)
 *
 * 고객사가 직접 만든 MDM 등 외부 URL을 hlj.kr/<code>로 단축 + 클릭 집계.
 * 발급 = CreditConfirmModal 확인 후 1회. 비활성 토글 = 즉시 홈 폴백(오발급 대응).
 * ★ 2026-09-16 한글 주소 지정 칸 신설 + 20크레딧(박성용 접수 · Harold 확정). 주소를 비우면 종전 난수다 —
 *   추가 입력을 요구하지 않고, 원하는 사람만 채운다. 단가는 원장(CONFIRM_CREDIT_COSTS)에서 읽는다.
 * 다크 모달 + createPortal + 모바일 반응형 + Source caption. native dialog 0.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Loader2, Copy, Power, MousePointerClick, AlertTriangle } from 'lucide-react';
import CreditConfirmModal from '../credit/CreditConfirmModal';
import { CONFIRM_CREDIT_COSTS } from '../../constants/credit';
import { useToast } from '../ToastProvider';

/** 발급 1건 단가 — 확인 모달과 같은 원장에서 읽는다(두 값이 갈리면 표시가 실차감과 어긋난다) */
const SHORT_LINK_CREDIT = CONFIRM_CREDIT_COSTS['dm-custom-short-link'];

interface ShortLink {
  id: string;
  code: string;
  targetUrl: string;
  title: string | null;
  isActive: boolean;
  clickCount: number;
  createdAt: string;
  shortUrl: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function DmShortLinkModal({ open, onClose }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  /** ★ 2026-09-16 사용자 지정 한글 주소 — 비우면 서버가 난수를 붙인다(종전 동작) */
  const [slug, setSlug] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInputError(null);
    setSlug('');
    void loadLinks();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLinks = async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/dm/short-links', { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '목록 조회에 실패했습니다.');
      setLinks(Array.isArray(data.links) ? data.links : []);
      setDailyLimit(Number(data.dailyLimit) || null);
    } catch (e: any) {
      setListError(e?.message || '목록 조회에 실패했습니다.');
    } finally {
      setListLoading(false);
    }
  };

  const handleCreate = async () => {
    setConfirmOpen(false);
    setCreating(true);
    setInputError(null);
    try {
      const res = await fetch('/api/dm/short-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined, slug: slug.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 다시 시도해주세요.');
        // ★ 2026-09-16 주소 선점 — 크레딧은 빠지지 않았다. 그 사실을 함께 알려야 다시 시도한다.
        if (data.code === 'SHORT_LINK_SLUG_TAKEN') {
          throw new Error(`${data.error || '이미 사용 중인 주소입니다.'} (크레딧은 차감되지 않았습니다)`);
        }
        throw new Error(data.error || '단축 링크 생성에 실패했습니다.');
      }
      setLinks((prev) => [data.link, ...prev]);
      setUrl('');
      setTitle('');
      setSlug('');
      if (data.link?.shortUrl) {
        await copyText(data.link.shortUrl, '단축 URL이 생성되고 복사되었습니다.');
      } else {
        toast.success('단축 URL이 생성되었습니다.');
      }
    } catch (e: any) {
      setInputError(e?.message || '단축 링크 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const copyText = async (text: string, message = '복사되었습니다.') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error('복사에 실패했습니다. 직접 선택해 복사해주세요.');
    }
  };

  const handleToggle = async (link: ShortLink) => {
    setTogglingId(link.id);
    try {
      const res = await fetch(`/api/dm/short-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ isActive: !link.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '상태 변경에 실패했습니다.');
      setLinks((prev) => prev.map((l) => (l.id === link.id ? data.link : l)));
      toast.info(data.link.isActive ? '링크를 다시 활성화했습니다.' : '링크를 비활성화했습니다. 접속 시 서비스 홈으로 이동합니다.');
    } catch (e: any) {
      toast.error(e?.message || '상태 변경에 실패했습니다.');
    } finally {
      setTogglingId(null);
    }
  };

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-slate-950 via-violet-950/30 to-slate-950 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0">
                <Link2 className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-bold text-base">단축 URL 만들기</h3>
                <p className="text-xs text-white/50 mt-0.5">내가 만든 페이지 주소를 hlj.kr 짧은 주소로, 클릭 수까지 집계</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors shrink-0" aria-label="닫기">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* 생성 폼 */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <label className="text-xs text-white/60 font-medium mb-1.5 block">단축할 URL</label>
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setInputError(null); }}
                  placeholder="https:// 로 시작하는 전체 주소"
                  disabled={creating}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
                />
              </div>
              {/* ★ 2026-09-16 한글 주소 지정(박성용 접수) — 비우면 종전대로 난수가 붙는다.
                  발행 DM 별칭과 같은 규칙(2~20자·한글/영문/숫자/-/_)이라 서버 검증 함수도 같다. */}
              <div>
                <label className="text-xs text-white/60 font-medium mb-1.5 block">
                  주소 직접 지정 <span className="text-white/30 font-normal">(선택 · 비우면 자동)</span>
                </label>
                <div className="flex items-stretch rounded-lg border border-white/10 bg-slate-950 focus-within:border-violet-400 overflow-hidden">
                  <span className="px-3 py-2.5 text-sm text-white/35 border-r border-white/10 shrink-0 select-none">hlj.kr/</span>
                  <input
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value); setInputError(null); }}
                    placeholder="예: 여름세일"
                    maxLength={20}
                    disabled={creating}
                    className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-sm text-white placeholder-white/30 focus:outline-none"
                  />
                </div>
                <div className="text-[11px] text-white/35 mt-1">
                  한글·영문·숫자·하이픈·밑줄 2~20자. 한 번 만든 주소는 다른 곳에 다시 쓸 수 없습니다.
                </div>
              </div>
              <div>
                <label className="text-xs text-white/60 font-medium mb-1.5 block">이름 (선택, 목록 구분용)</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 7월 신상품 MDM"
                  maxLength={100}
                  disabled={creating}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
                />
              </div>
              {inputError && (
                <div className="flex items-start gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg p-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{inputError}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-white/40">
                  http/https 공개 주소만 가능 · 내부망/IP 불가{dailyLimit ? ` · 하루 ${dailyLimit}건` : ''}
                </span>
                <button
                  onClick={() => { if (url.trim()) setConfirmOpen(true); }}
                  disabled={creating || url.trim().length < 10}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  단축 URL 생성
                </button>
              </div>
            </div>

            {/* 목록 */}
            <div>
              <div className="text-sm font-semibold text-white/80 mb-2">내 단축 링크</div>
              {listLoading ? (
                <div className="flex items-center justify-center py-10 text-white/50 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-violet-300" />
                  <span className="text-sm">불러오는 중...</span>
                </div>
              ) : listError ? (
                <div className="flex items-start gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg p-3">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{listError}</span>
                </div>
              ) : links.length === 0 ? (
                <div className="text-center py-10 text-white/40 text-sm">아직 만든 단축 링크가 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {links.map((l) => (
                    <div key={l.id} className={`border rounded-xl p-3 ${l.isActive ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-violet-300">{l.shortUrl || `(${l.code})`}</span>
                        {!l.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">비활성</span>}
                        <span className="inline-flex items-center gap-1 text-[11px] text-white/50 ml-auto">
                          <MousePointerClick className="w-3 h-3" />클릭 {l.clickCount.toLocaleString()}
                        </span>
                      </div>
                      {l.title && <div className="text-xs text-white/70 mt-1">{l.title}</div>}
                      <div className="text-[11px] text-white/40 mt-0.5 break-all">{l.targetUrl}</div>
                      <div className="flex items-center gap-2 mt-2">
                        {l.shortUrl && (
                          <button
                            onClick={() => copyText(l.shortUrl!)}
                            className="inline-flex items-center gap-1 text-[11px] text-violet-200 border border-violet-400/30 hover:bg-violet-500/20 px-2 py-1 rounded-lg transition-colors"
                          >
                            <Copy className="w-3 h-3" />복사
                          </button>
                        )}
                        <button
                          onClick={() => handleToggle(l)}
                          disabled={togglingId === l.id}
                          className="inline-flex items-center gap-1 text-[11px] text-white/60 border border-white/15 hover:bg-white/10 px-2 py-1 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {togglingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                          {l.isActive ? '비활성화' : '활성화'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 푸터 */}
          <div className="px-5 py-3 border-t border-white/10 shrink-0">
            {/* ★ 2026-09-16 크레딧 수치는 원장(CONFIRM_CREDIT_COSTS)에서 읽는다 — 하드코딩은 값이 바뀌는 날 거짓말이 된다 */}
            <div className="text-[10px] text-white/30 italic">Data source: dm_custom_short_links 실시간 · 발급 1건 = {SHORT_LINK_CREDIT}크레딧 · 비활성 시 접속은 서비스 홈으로 이동</div>
          </div>
        </div>
      </div>

      <CreditConfirmModal
        open={confirmOpen}
        source="dm-custom-short-link"
        description={
          slug.trim()
            // ★ 2026-09-16 지정 주소는 되돌릴 수 없다 — 확인 창에 그 주소를 그대로 보여준다(오타 방지).
            ? `"${url.trim().slice(0, 60)}${url.trim().length > 60 ? '…' : ''}"을(를) hlj.kr/${slug.trim()} 주소로 발급합니다. 한 번 만든 주소는 다시 쓸 수 없으니 문구를 확인해주세요.`
            : `"${url.trim().slice(0, 80)}${url.trim().length > 80 ? '…' : ''}"을(를) hlj.kr 단축 주소로 발급합니다. 발급 후 클릭 수가 집계됩니다.`
        }
        onConfirm={() => { void handleCreate(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>,
    document.body,
  );
}
