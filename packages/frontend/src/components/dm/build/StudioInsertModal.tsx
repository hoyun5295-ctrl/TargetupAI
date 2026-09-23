/**
 * StudioInsertModal — 이미지 스튜디오를 블록 창 위에 겹쳐 띄우고, 만든 그림을 그 자리에 넣는다 (★ 2026-09-16 설계서 §4)
 *
 * 새 생성 엔진을 만들지 않는다. 기존 경로를 그대로 지난다:
 *   GET /api/image-studio/templates → POST /api/image-studio/generate(2크레딧·서버 차감) → POST /api/image-studio/save(라이브러리 보관)
 * 저장된 그림의 공개 주소를 호출부(블록)에 돌려준다. 실패하면 블록은 사진 없는 상태로 남는다(조립이 막히지 않는다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import { useToast } from '../../ToastProvider';
import { fetchAuthObjectUrl } from '../../../lib/auth-download';

const token = () => localStorage.getItem('token');
const authFetch = (url: string, opts: RequestInit = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` } });

interface StudioTemplate { id: string; name: string; category: string; exampleUrl: string | null }

export default function StudioInsertModal({
  open, onClose, onInserted, defaultTitle, defaultSubtitle,
}: {
  open: boolean;
  onClose: () => void;
  onInserted: (url: string) => void;
  defaultTitle?: string;
  defaultSubtitle?: string;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [picked, setPicked] = useState<string>('');
  const [title, setTitle] = useState(defaultTitle || '');
  const [subtitle, setSubtitle] = useState(defaultSubtitle || '');
  const [busy, setBusy] = useState<'gen' | 'save' | null>(null);
  // ★ 2026-09-23 미리보기는 blob 주소로 띄운다. 만든 그림의 주소(`/api/image-studio/temp/:id`)는 로그인 토큰이
  //   있어야 열리는데 `<img src>` 는 토큰을 못 붙여 결과 화면이 빈칸이었다(0922 남지현 접수 · 「이 그림 넣기」는 tempId 로 저장해 정상).
  //   preview = null 은 미리보기를 못 받은 경우다 — 넣기는 그대로 된다.
  const [made, setMade] = useState<{ tempId: string; preview: string | null } | null>(null);
  const previewUrl = useRef<string | null>(null);
  const dropPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);
  useEffect(() => dropPreview, [dropPreview]);

  useEffect(() => {
    if (!open) { dropPreview(); return; }
    dropPreview();
    setMade(null);
    setTitle(defaultTitle || '');
    setSubtitle(defaultSubtitle || '');
    authFetch('/api/image-studio/templates')
      .then((r) => r.json())
      .then((d) => {
        const list: StudioTemplate[] = Array.isArray(d?.templates) ? d.templates : (Array.isArray(d?.data) ? d.data : []);
        setTemplates(list);
        setPicked((p) => p || list[0]?.id || '');
      })
      .catch(() => setTemplates([]));
  }, [open, defaultTitle, defaultSubtitle, dropPreview]);

  const generate = useCallback(async () => {
    if (!picked || busy) return;
    setBusy('gen');
    try {
      const r = await authFetch('/api/image-studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: picked, presetKey: 'poster', texts: { title, subtitle } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success || !d?.images?.[0]) {
        toast.error(d?.error || '그림을 만들지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      let preview: string | null = null;
      try { preview = await fetchAuthObjectUrl(d.images[0].url); } catch { /* 미리보기만 못 띄운다 · 넣기는 tempId 로 된다 */ }
      dropPreview();
      previewUrl.current = preview;
      setMade({ tempId: d.images[0].tempId, preview });
    } finally {
      setBusy(null);
    }
  }, [picked, title, subtitle, busy, toast, dropPreview]);

  const insert = useCallback(async () => {
    if (!made || busy) return;
    setBusy('save');
    try {
      const r = await authFetch('/api/image-studio/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempId: made.tempId, title: title || '블록 사진' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success || !d?.asset?.url) {
        toast.error(d?.error || '그림을 보관하지 못했어요.');
        return;
      }
      onInserted(d.asset.url);
      toast.success('만든 그림을 블록에 넣었어요. 라이브러리에도 보관했어요.');
    } finally {
      setBusy(null);
    }
  }, [made, title, busy, onInserted, toast]);

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="✨ 이미지 스튜디오"
      subtitle="템플릿을 고르고 문구를 넣으면 이 블록의 사진 자리에 바로 들어갑니다"
      size="lg"
      footer={made
        ? <ModalButton variant="primary" onClick={insert} disabled={busy === 'save'}>{busy === 'save' ? '넣는 중...' : '이 그림 넣기'}</ModalButton>
        : <ModalButton variant="primary" onClick={generate} disabled={!picked || busy === 'gen'}>{busy === 'gen' ? '만드는 중...' : '만들기 (2크레딧)'}</ModalButton>}
    >
      {made ? (
        <div className="space-y-3">
          {made.preview
            ? <img src={made.preview} alt="만든 그림 미리보기" className="w-full max-h-[52vh] object-contain rounded-xl border border-slate-200 bg-slate-100" />
            : (
              <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-[12.5px] text-slate-500">
                미리보기를 불러오지 못했어요. 「이 그림 넣기」를 누르면 만든 그림이 그대로 들어갑니다.
              </div>
            )}
          <button type="button" onClick={() => { dropPreview(); setMade(null); }} className="text-[12px] text-slate-500 hover:text-slate-800">다시 만들기</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[38vh] overflow-auto pr-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPicked(t.id)}
                className={`rounded-xl overflow-hidden border text-left transition ${picked === t.id ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-200 hover:border-slate-300'}`}
              >
                {t.exampleUrl
                  ? <img src={t.exampleUrl} alt={t.name} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                  : <div className="w-full aspect-[3/4] bg-slate-50" />}
                <div className="px-2 py-1.5 text-[11px] font-semibold truncate">{t.name}</div>
              </button>
            ))}
            {templates.length === 0 && <div className="col-span-full text-[12px] text-slate-400 py-6 text-center">템플릿을 불러오는 중이에요</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">제목</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="가을 신상 20종 입고"
                className="w-full px-3 py-2 rounded-[10px] bg-white border border-slate-300 text-[13px] text-slate-900 placeholder-slate-400 outline-none" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-slate-500 mb-1">부제</span>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="이번 주말까지 무료 배송"
                className="w-full px-3 py-2 rounded-[10px] bg-white border border-slate-300 text-[13px] text-slate-900 placeholder-slate-400 outline-none" />
            </label>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            넣은 문구만 그림에 새겨집니다. 가격·할인율은 새기지 않아요. 만든 그림은 라이브러리에도 보관됩니다.
          </p>
        </div>
      )}
    </ModalBase>
  );
}
