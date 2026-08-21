/**
 * DmKoreanAliasModal — 발행 DM 한글 주소 별칭 (2026-07-15 Harold 확정 — 이새 vo.la/반짝이새_07 사례)
 *
 * 발행된 DM의 공용 링크에 한글 주소(hlj.kr/반짝세일_07)를 붙인다 — 무료·DM당 1개(변경 가능).
 * 기존 랜덤 주소는 그대로 유효(별칭 추가 — 비파괴). 공용 링크라 개인 단위 추적은 없고
 * 클릭·열람 집계만 제공(상세 퍼널 = 발송 추적 모달의 [공용 링크] 탭).
 * 다크 모달 + createPortal + z-[2000] + 모바일 반응형 + Source caption. native dialog 0.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, X, Loader2, Copy, MousePointerClick, AlertTriangle, Check } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface AliasInfo {
  id: string;
  code: string;
  clickCount: number;
  shortUrl: string | null;
}

interface Props {
  open: boolean;
  dmId: string;
  dmTitle?: string;
  onClose: () => void;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

/** 서버(validateCustomSlug) 규칙의 표시용 미러 — 최종 판정은 서버가 단일 진실 */
const SLUG_HINT = /^[0-9A-Za-z가-힣_-]{2,20}$/;

export default function DmKoreanAliasModal({ open, dmId, dmTitle, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alias, setAlias] = useState<AliasInfo | null>(null);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSlug('');
    void loadAlias();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, dmId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAlias = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/alias`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '조회에 실패했습니다.');
      setAlias(data.alias || null);
      if (data.alias?.code) setSlug(String(data.alias.code));
    } catch (e: any) {
      setError(e?.message || '조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const s = slug.trim();
    if (!SLUG_HINT.test(s)) {
      setError('한글·영문·숫자·하이픈(-)·언더스코어(_) 2~20자로 입력해주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dm/${dmId}/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ slug: s }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '한글 주소 생성에 실패했습니다.');
      setAlias(data.alias);
      if (data.alias?.shortUrl) {
        await copyText(data.alias.shortUrl, alias ? '한글 주소가 변경되고 복사되었습니다.' : '한글 주소가 생성되고 복사되었습니다.');
      } else {
        toast.success('한글 주소가 저장되었습니다.');
      }
    } catch (e: any) {
      setError(e?.message || '한글 주소 생성에 실패했습니다.');
    } finally {
      setSaving(false);
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

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
              <AtSign className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">한글 주소 만들기</h3>
              <p className="text-[11px] text-white/40 truncate">{dmTitle || '발행 DM 공용 링크에 기억하기 쉬운 주소를 붙입니다'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-white/40 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중
            </div>
          ) : (
            <>
              {/* 입력 — hlj.kr/ 프리픽스 고정 표시 */}
              <div>
                <label className="block text-[11px] font-semibold text-white/50 mb-1.5">주소 문구 (한글 가능 · 2~20자)</label>
                <div className="flex items-stretch rounded-xl border border-white/15 bg-white/5 focus-within:border-violet-400/60 overflow-hidden">
                  <span className="flex items-center px-3 text-sm text-white/40 bg-white/5 border-r border-white/10 select-none">hlj.kr/</span>
                  <input
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void handleSave(); }}
                    placeholder="반짝세일_07"
                    maxLength={20}
                    className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none"
                  />
                </div>
                {error && (
                  <div className="flex items-start gap-1.5 mt-2 text-[11px] text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-[1px]" /> {error}
                  </div>
                )}
              </div>

              {/* 현재 별칭 + 클릭수 */}
              {alias?.shortUrl && (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Check className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
                      <span className="text-sm text-emerald-200 font-semibold truncate">{alias.shortUrl.replace(/^https?:\/\//, '')}</span>
                    </div>
                    <button
                      onClick={() => copyText(alias.shortUrl!)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-200 bg-emerald-400/15 hover:bg-emerald-400/25 transition-colors flex-shrink-0"
                    >
                      <Copy className="w-3 h-3" /> 복사
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                    <MousePointerClick className="w-3.5 h-3.5" /> 누적 클릭 {alias.clickCount.toLocaleString()}회. 상세 퍼널은 [발송 추적 → 공용 링크] 탭
                  </div>
                </div>
              )}

              {/* 안내 */}
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3.5 space-y-1.5">
                <p className="text-[11px] text-white/50 leading-relaxed">전체 대상 발송·카톡 공유·SNS에 쓰는 <span className="text-white/75 font-semibold">공용 주소</span>입니다. 기존 발행 주소도 계속 사용할 수 있어요.</p>
                <p className="text-[11px] text-white/50 leading-relaxed">공용 주소는 누가 열었는지 개인 단위 추적은 되지 않고, 클릭·열람 횟수로 집계됩니다. 고객별 추적은 문자 발송의 개인화 링크가 담당해요.</p>
                <p className="text-[11px] text-white/35">무료: DM 1개당 주소 1개, 언제든 변경 가능</p>
              </div>

              <button
                onClick={() => void handleSave()}
                disabled={saving || !slug.trim()}
                className="w-full h-11 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> 저장 중</>) : alias ? '주소 변경하고 복사' : '주소 만들고 복사'}
              </button>

              <div className="text-[10px] text-white/30 italic">Data source: dm_custom_short_links 클릭 집계 (실시간)</div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
