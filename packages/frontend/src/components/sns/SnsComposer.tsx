// SnsComposer — SNS 작성 구역 (2026-09-21 S2)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-2
//
// 한 번 쓰면 고른 채널 수만큼 갈라진다. 그 갈라짐을 **사용자가 누르기 전에 미리 보여주는 것**이 이 화면의 일이다.
//
// ⛔ 원본을 멋대로 자르지 않는다(Harold 확정 2026-09-21).
//    사진을 올리는 즉시 채널마다 "원본 그대로"인지 "여백을 채우는지"를 표시한다. 잘린다는 말은 나오지 않는다 —
//    기본이 pad 라 잘리지 않기 때문이다.
// ⛔ 추가 입력을 요구하지 않는다. 사진을 올리고 글을 쓰면 그걸로 끝이고, 규격 맞춤은 서버가 알아서 한다.

import { useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, X, CheckCircle2, Info, Clock, Sparkles, Library } from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import SnsAssetPicker from './SnsAssetPicker';
import { useToast } from '../ToastProvider';
import { snsAccountAbility, type SnsAccount, type SnsSpec } from '../../utils/sns-view';
import { OUI_CARD, OUI_BTN_PRIMARY, OUI_BTN_GHOST, OUI_BTN_OUTLINE, OUI_SRC } from '../../utils/operator-ui';

interface UploadedMedia {
  id: string;
  width: number;
  height: number;
  previewUrl: string;
  fits: { platform: string; label: string; untouched: boolean; notice: string }[];
}

interface Props {
  specs: SnsSpec[];
  accounts: SnsAccount[];
  onPublished: () => void;
}

export default function SnsComposer({ specs, accounts, onPublished }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [body, setBody] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  /** AI가 채웠다는 표시. 사용자가 한 글자라도 고치면 사라진다(§4-2). */
  const [refined, setRefined] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  /** 연결돼서 실제로 고를 수 있는 계정만. 해제·확인 필요는 여기 안 나온다. */
  const usable = useMemo(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts],
  );
  const specOf = (platform: string) => specs.find((s) => s.platform === platform);

  /** 글자수 기준 = **상한이 가장 빡빡한 채널**. 여기만 지키면 나머지는 통과한다. */
  const gauge = useMemo(() => {
    const picked = usable.filter((a) => selected.includes(a.id));
    const caps = picked.map((a) => specOf(a.platform)).filter(Boolean) as SnsSpec[];
    if (caps.length === 0) return null;
    const tightest = caps.reduce((min, c) => (c.capabilities.maxCaptionChars < min.capabilities.maxCaptionChars ? c : min), caps[0]);
    // 태그와 줄바꿈 몫을 미리 센다(서버가 조립하는 형태와 같은 계산).
    const tagText = tags.length ? `\n\n${tags.map((t) => `#${t}`).join(' ')}` : '';
    const used = [...`${body}${tagText}`].length;
    return { label: tightest.label, limit: tightest.capabilities.maxCaptionChars, used };
  }, [usable, selected, specs, body, tags]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/sns/media', { method: 'POST', headers: auth(), body: form });
        const data = await res.json();
        if (!data?.success) { toast.error(data?.error || '사진을 올리지 못했습니다.'); continue; }
        setMedia((prev) => [...prev, {
          id: data.media.id,
          width: data.media.width,
          height: data.media.height,
          previewUrl: `/api/sns/media/${data.media.id}`,
          fits: Array.isArray(data.fits) ? data.fits : [],
        }]);
      }
    } catch {
      toast.error('사진을 올리지 못했습니다.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * 소재 라이브러리에서 가져오기. 서버가 파일을 복사하고 `asset_id` 를 남긴다 —
   * 그 표식이 있어야 우리가 만든 사진에 AI 표시가 자동으로 붙는다(§3-9).
   */
  const pickFromLibrary = async (assetIds: string[]) => {
    setUploading(true);
    try {
      for (const assetId of assetIds) {
        const res = await fetch('/api/sns/media/from-asset', {
          method: 'POST',
          headers: { ...auth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId }),
        });
        const data = await res.json();
        if (!data?.success) { toast.error(data?.error || '소재를 가져오지 못했습니다.'); continue; }
        setMedia((prev) => [...prev, {
          id: data.media.id,
          width: data.media.width,
          height: data.media.height,
          previewUrl: `/api/sns/media/${data.media.id}`,
          fits: Array.isArray(data.fits) ? data.fits : [],
        }]);
      }
    } catch {
      toast.error('소재를 가져오지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  /** AI로 캡션 쓰기 — 한 번 누르면 글과 태그가 함께 채워진다. */
  const refine = async () => {
    setRefining(true);
    try {
      const res = await fetch('/api/sns/caption', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!data?.success) { toast.error(data?.error || '글을 다듬지 못했습니다.'); return; }
      setBody(String(data.caption ?? body));
      if (Array.isArray(data.tags) && data.tags.length) {
        setTags((prev) => {
          const merged = [...prev];
          for (const t of data.tags) if (!merged.some((x) => x.toLowerCase() === String(t).toLowerCase())) merged.push(String(t));
          return merged;
        });
      }
      setRefined(true);
      if (data.note) toast.success(data.note);
    } catch {
      toast.error('글을 다듬지 못했습니다.');
    } finally {
      setRefining(false);
    }
  };

  const addTag = () => {
    const raw = tagInput.trim().replace(/^#+/, '');
    if (!raw) return;
    if (tags.some((t) => t.toLowerCase() === raw.toLowerCase())) { setTagInput(''); return; }
    setTags((prev) => [...prev, raw]);
    setTagInput('');
  };

  const publish = async () => {
    if (selected.length === 0) { toast.error('올릴 채널을 골라 주세요.'); return; }
    if (!body.trim() && media.length === 0) { toast.error('글이나 사진 중 하나는 있어야 해요.'); return; }
    setBusy(true);
    try {
      const saveRes = await fetch('/api/sns/posts', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, tags, mediaIds: media.map((m) => m.id), accountIds: selected }),
      });
      const saved = await saveRes.json();
      if (!saved?.success) { toast.error(saved?.error || '저장하지 못했습니다.'); return; }

      const pubRes = await fetch(`/api/sns/posts/${saved.postId}/publish`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledAt || null }),
      });
      const pub = await pubRes.json();
      if (!pub?.success) { toast.error(pub?.error || '게시를 시작하지 못했습니다.'); return; }

      toast.success(scheduledAt ? '예약했습니다.' : '올리는 중입니다. 채널에서 확인되면 게시됨으로 바뀝니다.');
      setMedia([]); setBody(''); setTags([]); setSelected([]); setScheduledAt('');
      onPublished();
    } catch {
      toast.error('게시를 시작하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /** 고른 채널 중 이 사진을 손대지 않고 올리는 곳 / 여백을 채우는 곳 */
  const fitSummary = useMemo(() => {
    if (media.length === 0 || selected.length === 0) return null;
    const pickedPlatforms = new Set(usable.filter((a) => selected.includes(a.id)).map((a) => a.platform));
    const touched: string[] = [];
    for (const m of media) {
      for (const f of m.fits) {
        if (pickedPlatforms.has(f.platform) && !f.untouched && !touched.includes(f.label)) touched.push(f.label);
      }
    }
    return { touched, allUntouched: touched.length === 0 };
  }, [media, selected, usable]);

  if (usable.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-white/80">올리기</h2>
        <p className="text-xs text-white/50 mt-0.5">한 번 쓰면 고른 채널마다 규격에 맞춰 각각 올라갑니다.</p>
      </div>

      {/* 1. 사진 */}
      <div className={`${OUI_CARD} p-4`}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(e) => void upload(e.target.files)} />

        {media.length === 0 ? (
          /* 반반 — 직접 올리기 / 소재에서 고르기. 이미 만들어 둔 소재를 다시 올리게 하지 않는다. */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin text-violet-400" /> : <ImagePlus className="w-6 h-6 text-white/40" />}
              <span className="text-sm text-white/70">직접 올리기</span>
              <span className="text-[11px] text-white/40">내 컴퓨터에서 고르기</span>
            </button>
            <button onClick={() => setPickerOpen(true)} disabled={uploading}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2">
              <Library className="w-6 h-6 text-white/40" />
              <span className="text-sm text-white/70">소재에서 고르기</span>
              <span className="text-[11px] text-white/40">이미지 스튜디오에서 만든 소재</span>
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {media.map((m, i) => (
                <div key={m.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-white/10 bg-white/5">
                  <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                  <span className="absolute left-1 top-1 text-[10px] px-1 rounded bg-slate-950/70 text-white/70">{i + 1}</span>
                  <button onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                    className="absolute right-1 top-1 p-0.5 rounded bg-slate-950/70 text-white/70 hover:text-white" aria-label="빼기">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-24 h-24 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                title="직접 올리기">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
              </button>
              <button onClick={() => setPickerOpen(true)} disabled={uploading}
                className="w-24 h-24 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                title="소재에서 고르기">
                <Library className="w-5 h-5" />
              </button>
            </div>

            {/* ⛔ 잘린다는 말이 나오지 않는다 — 기본이 여백 채우기라 잘리지 않는다. */}
            {fitSummary && (
              <div className="mt-3 flex items-start gap-1.5">
                {fitSummary.allUntouched
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  : <Info className="w-3.5 h-3.5 text-white/40 flex-shrink-0 mt-0.5" />}
                <p className="text-[11px] text-white/55 leading-relaxed break-keep">
                  {fitSummary.allUntouched
                    ? '고른 채널 모두 사진을 그대로 올립니다.'
                    : `${fitSummary.touched.join(' · ')}는 규격이 달라 여백을 채워 올립니다. 사진은 잘리지 않아요.`}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. 채널 */}
      <div className={`${OUI_CARD} p-4`}>
        <p className="text-xs text-white/60 mb-2.5">올릴 채널</p>
        <div className="flex gap-2 flex-wrap">
          {usable.map((a) => {
            const on = selected.includes(a.id);
            const spec = specOf(a.platform);
            return (
              <button key={a.id}
                onClick={() => setSelected((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))}
                className={`px-3 py-2 rounded-xl border text-xs inline-flex items-center gap-2 transition-colors ${
                  on ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                }`}>
                <SnsChannelLogo platform={a.platform} size={15} muted={!on} />
                <span>{spec?.label || a.platform}</span>
                {a.username && <span className={on ? 'text-white/70' : 'text-white/40'}>@{a.username}</span>}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <p className={`${OUI_SRC} mt-2.5`}>
            Data source: 채널 규격은 각 채널이 알려준 값
          </p>
        )}
      </div>

      {/* 3. 글·태그 */}
      <div className={`${OUI_CARD} p-4`}>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="text-xs text-white/60">올릴 글</span>
          {/* ⛔ 1클릭 — 누르면 바로 채워진다. 중간에 무엇도 묻지 않는다(§2-17). */}
          <button onClick={() => void refine()} disabled={refining || !body.trim()} className={OUI_BTN_OUTLINE}>
            {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI로 캡션 쓰기
          </button>
        </div>
        {refined && (
          <p className="text-[11px] text-violet-200/70 mb-2">AI가 채운 문구입니다. 자유롭게 고쳐 주세요.</p>
        )}
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); setRefined(false); }}
          rows={5}
          placeholder="올릴 글을 써 주세요."
          className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/40 resize-y"
        />

        <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap items-center">
            {tags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-1 rounded-lg bg-violet-500/15 text-violet-200 border border-violet-400/25 inline-flex items-center gap-1">
                #{t}
                <button onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="hover:text-white" aria-label="태그 빼기">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addTag(); } }}
              onBlur={addTag}
              placeholder="태그 입력"
              className="w-24 bg-transparent border-b border-white/15 text-[11px] text-white placeholder-white/25 focus:outline-none focus:border-violet-400/40 py-1"
            />
          </div>

          {gauge && (
            <span className={`text-[11px] ${gauge.used > gauge.limit ? 'text-rose-300' : 'text-white/45'}`}>
              {gauge.used} / {gauge.limit} · {gauge.label} 기준
            </span>
          )}
        </div>
      </div>

      {/* 4. 실행 */}
      <div className={`${OUI_CARD} p-4 flex items-center gap-3 flex-wrap`}>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-white/40" />
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-violet-400/40"
          />
          {scheduledAt && (
            <button onClick={() => setScheduledAt('')} className={OUI_BTN_GHOST}>지금 올리기</button>
          )}
        </div>
        <div className="flex-1" />
        <button onClick={() => void publish()} disabled={busy || selected.length === 0} className={OUI_BTN_PRIMARY}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {scheduledAt ? '예약하기' : '올리기'}
        </button>
      </div>

      <SnsAssetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pickFromLibrary} />
    </section>
  );
}

export { snsAccountAbility };
