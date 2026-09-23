// SnsComposer — SNS 작성 구역 (2026-09-21 S2)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-2
//
// 한 번 쓰면 고른 채널 수만큼 갈라진다. 그 갈라짐을 **사용자가 누르기 전에 미리 보여주는 것**이 이 화면의 일이다.
//
// ⛔ 원본을 멋대로 자르지 않는다(Harold 확정 2026-09-21).
//    사진을 올리는 즉시 채널마다 "원본 그대로"인지 "여백을 채우는지"를 표시한다. 잘린다는 말은 나오지 않는다 —
//    기본이 pad 라 잘리지 않기 때문이다.
// ⛔ 추가 입력을 요구하지 않는다. 사진을 올리고 글을 쓰면 그걸로 끝이고, 규격 맞춤은 서버가 알아서 한다.
//
// ★ 2026-09-23 1차-B(docs/2026-09-23-sns-1b-design.md §3-10) — 영상 1개(사진과 섞지 않음) · 4MB 조각 업로드와 진행률 ·
//   받지 못하는 채널 칩은 잠그고 칩 아래 사유 한 줄 · 글자 게이지는 채널마다 그 채널 방식으로 세어 가장 빠듯한 곳을 보여 준다.
//   판정 규칙은 서버 CT 의 미러(`utils/sns-view.ts`)만 쓴다. 저장할 때 서버가 같은 규칙으로 다시 판정한다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, ImageOff, Loader2, Send, X, CheckCircle2, Info, Clock, Sparkles, Library, Play } from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import SnsAssetPicker from './SnsAssetPicker';
import { useToast } from '../ToastProvider';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import {
  snsAccountAbility, snsMediaBlockReason, countSnsCaption, formatSnsDuration, SNS_VIDEO_MAX_BYTES,
  type SnsAccount, type SnsSpec,
} from '../../utils/sns-view';
import { OUI_CARD, OUI_BTN_PRIMARY, OUI_BTN_GHOST, OUI_BTN_OUTLINE, OUI_SRC } from '../../utils/operator-ui';

interface UploadedMedia {
  id: string;
  /** ★ 1차-B — 영상은 1개이고 사진과 섞이지 않는다 */
  kind: 'image' | 'video';
  width: number;
  height: number;
  /** 영상 길이(초). 판독이 못 읽었으면 null */
  durationSec: number | null;
  /** 화면 미리보기 blob 주소. 못 받았으면 null(사진은 서버에 있어 올리기는 된다). */
  previewUrl: string | null;
  /** 채널마다 이 미디어를 어떻게 하는가. `accepted:false` 면 그 채널은 이 미디어를 받지 않는다(영상 판정) */
  fits: { platform: string; label: string; untouched: boolean; notice: string; accepted?: boolean }[];
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
  /** 어느 입구가 사진을 받는 중인가. 로더는 누른 버튼에만 돈다. */
  const [uploading, setUploading] = useState<null | 'file' | 'asset'>(null);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  /** AI가 채웠다는 표시. 사용자가 한 글자라도 고치면 사라진다(§4-2). */
  const [refined, setRefined] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 영상 조각 업로드 진행률(0~100). 올리는 중이 아니면 null */
  const [progress, setProgress] = useState<number | null>(null);

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  /**
   * 미리보기 blob 주소 반납. 목록에서 빠진 사진(빼기 · 게시 뒤 비우기)과 화면을 떠날 때 남은 것을 여기 한 곳에서 돌려준다.
   * 안 돌려주면 탭을 닫을 때까지 사진이 메모리에 남는다.
   */
  const liveUrls = useRef<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    const now = media.map((m) => m.previewUrl).filter((u): u is string => !!u);
    for (const u of liveUrls.current) if (!now.includes(u)) URL.revokeObjectURL(u);
    liveUrls.current = now;
  }, [media]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const u of liveUrls.current) URL.revokeObjectURL(u);
      liveUrls.current = [];
    };
  }, []);

  /**
   * 서버에 저장된 사진을 목록에 붙인다. 두 입구(직접 올리기 · 소재에서 고르기)가 같이 쓴다.
   * ★ 2026-09-23 B-0923-4: 미리보기 주소 `/api/sns/media/:id` 는 로그인이 필요해 `<img src>` 에 그대로 넣으면 401 로 깨졌다
   *   (`<img>` 는 Authorization 헤더를 못 붙인다). 공용 CT 로 헤더를 실어 받아 blob 주소로 띄운다.
   *   못 받으면 null: 사진은 이미 서버에 있어 올리기는 그대로 되고, 칸에는 깨진 그림 대신 빈 사진 표시가 선다.
   */
  const appendMedia = async (
    data: { media: { id: string; width: number; height: number; kind?: string; durationSec?: number | null }; fits?: unknown },
    /** ★ 1차-B — 영상은 이미 손에 든 파일로 미리 본다(300MB 를 다시 내려받지 않는다). 이 주소도 여기서부터 반납 대상이다 */
    localPreview?: string,
  ) => {
    let previewUrl: string | null = localPreview ?? null;
    if (!localPreview) {
      try { previewUrl = await fetchAuthObjectUrl(`/api/sns/media/${data.media.id}`); } catch { /* 미리보기만 못 띄운다 */ }
    }
    if (!alive.current) { if (previewUrl) URL.revokeObjectURL(previewUrl); return; }
    setMedia((prev) => [...prev, {
      id: data.media.id,
      kind: data.media.kind === 'video' ? 'video' : 'image',
      width: data.media.width,
      height: data.media.height,
      durationSec: typeof data.media.durationSec === 'number' ? data.media.durationSec : null,
      previewUrl,
      fits: Array.isArray(data.fits) ? data.fits : [],
    }]);
  };

  /** 연결돼서 실제로 고를 수 있는 계정만. 해제·확인 필요는 여기 안 나온다. */
  const usable = useMemo(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts],
  );
  const specOf = (platform: string) => specs.find((s) => s.platform === platform);

  /**
   * 글자수 기준 = **가장 빠듯한 채널**. ★ 1차-B — 채널마다 그 채널 방식으로 센다(X 는 한글·이모지 2 · 링크 23).
   * 상한이 가장 작은 채널이 아니라 "쓴 비율이 가장 높은 채널"을 고른다 — 같은 글이 X 에서는 두 배로 세어지기 때문이다.
   */
  const gauge = useMemo(() => {
    const picked = usable.filter((a) => selected.includes(a.id));
    // 태그와 줄바꿈 몫을 미리 센다(서버가 조립하는 형태와 같은 계산).
    const tagText = tags.length ? `\n\n${tags.map((t) => `#${t}`).join(' ')}` : '';
    const text = `${body}${tagText}`;
    let worst: { label: string; limit: number; used: number; ratio: number } | null = null;
    for (const a of picked) {
      const spec = specOf(a.platform);
      if (!spec) continue;
      const used = countSnsCaption(text, spec.capabilities.captionCounting);
      const limit = spec.capabilities.maxCaptionChars;
      const ratio = limit > 0 ? used / limit : 0;
      if (!worst || ratio > worst.ratio) worst = { label: spec.label, limit, used, ratio };
    }
    return worst;
  }, [usable, selected, specs, body, tags]);

  const hasVideo = media.some((m) => m.kind === 'video');
  const summary = useMemo(() => ({
    images: media.filter((m) => m.kind !== 'video').length,
    videos: media.filter((m) => m.kind === 'video').length,
  }), [media]);

  /**
   * 채널마다 지금 미디어를 받을 수 있는가. 사유는 서버 저장 거절과 **같은 문장**이다(미러 CT).
   *   hard  = 채널이 지금 닫혀 있다(개방 판정) → 언제나 잠금
   *   media = 이 미디어 조합·이 영상을 받지 못한다 → 미디어가 있을 때만 잠금(고른 뒤 사진을 넣는 순서도 되게)
   */
  const blockOf = useMemo(() => {
    const map = new Map<string, { hard: boolean; reason: string }>();
    for (const a of usable) {
      const spec = specOf(a.platform);
      if (!spec || !spec.available) { map.set(a.id, { hard: true, reason: '지금은 이 채널에 올릴 수 없어요.' }); continue; }
      const reason = snsMediaBlockReason(summary, spec.capabilities);
      if (reason) { map.set(a.id, { hard: false, reason }); continue; }
      const v = media.find((m) => m.kind === 'video');
      const fit = v?.fits.find((f) => f.platform === a.platform);
      if (fit && fit.accepted === false) map.set(a.id, { hard: false, reason: fit.notice });
    }
    return map;
  }, [usable, specs, summary, media]);

  const isLocked = (accountId: string) => {
    const b = blockOf.get(accountId);
    return !!b && (b.hard || media.length > 0);
  };

  // 미디어가 바뀌어 받지 못하게 된 채널은 선택에서 뺀다(칩 아래 사유는 그대로 남는다).
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => !isLocked(id));
      return next.length === prev.length ? prev : next;
    });
  }, [blockOf]);

  /**
   * ★ 1차-B 영상 업로드 — 4MB 조각으로 순서대로 보낸다(nginx 본문 상한을 바꾸지 않는다 · 설계 1b §3-2).
   * 조각은 3번까지 다시 보낸다(서버는 같은 조각을 받은 것으로 본다). 마무리 응답이 오면 appendMedia 로 붙인다.
   */
  const uploadVideo = async (file: File) => {
    if (file.size > SNS_VIDEO_MAX_BYTES) {
      toast.error(`영상이 너무 커요. ${Math.floor(SNS_VIDEO_MAX_BYTES / 1024 / 1024)}MB 이하로 올려 주세요.`);
      return;
    }
    const localUrl = URL.createObjectURL(file);
    let handed = false;
    setProgress(0);
    try {
      const startRes = await fetch('/api/sns/media/uploads', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, bytes: file.size }),
      });
      const started = await startRes.json();
      if (!started?.success) { toast.error(started?.error || '영상을 올리지 못했습니다.'); return; }
      const chunk = Number(started.chunkBytes);
      const total = Math.ceil(file.size / chunk);
      for (let i = 0; i < total; i++) {
        if (!alive.current) return;
        const part = file.slice(i * chunk, Math.min(file.size, (i + 1) * chunk));
        let ok = false;
        let reason = '';
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const r = await fetch(`/api/sns/media/uploads/${started.uploadId}/chunks/${i}`, {
              method: 'PUT',
              headers: { ...auth(), 'Content-Type': 'application/octet-stream' },
              body: part,
            });
            const d = await r.json().catch(() => null);
            if (r.ok && d?.success) ok = true;
            else {
              reason = d?.error || '';
              if (r.status >= 400 && r.status < 500) break;   // 요청이 잘못된 것 — 다시 보내도 같다
            }
          } catch { /* 연결 끊김 — 다시 보낸다 */ }
        }
        if (!ok) { toast.error(reason || '영상을 올리는 중 연결이 끊겼어요. 다시 올려 주세요.'); return; }
        setProgress(Math.round(((i + 1) / total) * 100));
      }
      const doneRes = await fetch(`/api/sns/media/uploads/${started.uploadId}/complete`, { method: 'POST', headers: auth() });
      const data = await doneRes.json();
      if (!data?.success) { toast.error(data?.error || '영상을 올리지 못했습니다.'); return; }
      handed = true;
      await appendMedia(data, localUrl);
    } catch {
      toast.error('영상을 올리지 못했습니다.');
    } finally {
      if (!handed) URL.revokeObjectURL(localUrl);
      setProgress(null);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov)$/i.test(f.name);
    // ★ 1차-B — 영상은 한 개만, 사진과 섞지 않는다(설계 1b §3-1). 막히는 이유를 그 자리에서 말한다.
    if (list.some(isVideo) || hasVideo) {
      if (list.length > 1 || media.length > 0) {
        toast.error('영상은 한 개만, 사진과 섞지 않고 올릴 수 있어요.');
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      setUploading('file');
      try {
        await uploadVideo(list[0]);
      } finally {
        setUploading(null);
        if (fileRef.current) fileRef.current.value = '';
      }
      return;
    }
    setUploading('file');
    try {
      for (const file of list.slice(0, 10)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/sns/media', { method: 'POST', headers: auth(), body: form });
        const data = await res.json();
        if (!data?.success) { toast.error(data?.error || '사진을 올리지 못했습니다.'); continue; }
        await appendMedia(data);
      }
    } catch {
      toast.error('사진을 올리지 못했습니다.');
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * 소재 라이브러리에서 가져오기. 서버가 파일을 복사하고 `asset_id` 를 남긴다 —
   * 그 표식이 있어야 우리가 만든 사진에 AI 표시가 자동으로 붙는다(§3-9).
   */
  const pickFromLibrary = async (assetIds: string[]) => {
    setUploading('asset');
    try {
      for (const assetId of assetIds) {
        const res = await fetch('/api/sns/media/from-asset', {
          method: 'POST',
          headers: { ...auth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId }),
        });
        const data = await res.json();
        if (!data?.success) { toast.error(data?.error || '소재를 가져오지 못했습니다.'); continue; }
        await appendMedia(data);
      }
    } catch {
      toast.error('소재를 가져오지 못했습니다.');
    } finally {
      setUploading(null);
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
    if (!body.trim() && media.length === 0) { toast.error('글이나 사진·영상 중 하나는 있어야 해요.'); return; }
    const stuck = usable.filter((a) => selected.includes(a.id) && blockOf.get(a.id));
    if (stuck.length > 0) {
      toast.error(stuck.map((a) => `${specOf(a.platform)?.label || a.platform}: ${blockOf.get(a.id)!.reason}`).join(' '));
      return;
    }
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
    // ★ 1차-B — 영상은 손대지 않는다(다시 인코딩 0). 받지 못하는 채널은 이미 칩에서 빠져 있다.
    if (media.some((m) => m.kind === 'video')) return { touched: [] as string[], allUntouched: true, video: true };
    const pickedPlatforms = new Set(usable.filter((a) => selected.includes(a.id)).map((a) => a.platform));
    const touched: string[] = [];
    for (const m of media) {
      for (const f of m.fits) {
        if (pickedPlatforms.has(f.platform) && !f.untouched && !touched.includes(f.label)) touched.push(f.label);
      }
    }
    return { touched, allUntouched: touched.length === 0, video: false };
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
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple hidden
          onChange={(e) => void upload(e.target.files)} />

        {media.length === 0 ? (
          /* 반반 — 직접 올리기 / 소재에서 고르기. 이미 만들어 둔 소재를 다시 올리게 하지 않는다. */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button onClick={() => fileRef.current?.click()} disabled={uploading !== null}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2">
              {uploading === 'file' ? <Loader2 className="w-6 h-6 animate-spin text-violet-400" /> : <ImagePlus className="w-6 h-6 text-white/40" />}
              <span className="text-sm text-white/70">직접 올리기</span>
              <span className="text-[11px] text-white/40">사진 또는 영상(MP4·MOV) 한 개</span>
            </button>
            <button onClick={() => setPickerOpen(true)} disabled={uploading !== null}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2">
              {uploading === 'asset' ? <Loader2 className="w-6 h-6 animate-spin text-violet-400" /> : <Library className="w-6 h-6 text-white/40" />}
              <span className="text-sm text-white/70">소재에서 고르기</span>
              <span className="text-[11px] text-white/40">이미지 스튜디오에서 만든 소재</span>
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {media.map((m, i) => (
                <div key={m.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-white/10 bg-white/5">
                  {m.kind === 'video' ? (
                    <>
                      {m.previewUrl && <video src={m.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />}
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="w-7 h-7 rounded-full bg-slate-950/65 flex items-center justify-center">
                          <Play className="w-3.5 h-3.5 text-white" />
                        </span>
                      </span>
                      {m.durationSec !== null && (
                        <span className="absolute right-1 bottom-1 text-[10px] px-1 rounded bg-slate-950/70 text-white/80">{formatSnsDuration(m.durationSec)}</span>
                      )}
                    </>
                  ) : m.previewUrl ? <img src={m.previewUrl} alt="" className="w-full h-full object-cover" /> : (
                    <div className="w-full h-full flex items-center justify-center" title="미리보기를 불러오지 못했습니다. 올리기는 그대로 됩니다.">
                      <ImageOff className="w-5 h-5 text-white/30" />
                    </div>
                  )}
                  {m.kind !== 'video' && <span className="absolute left-1 top-1 text-[10px] px-1 rounded bg-slate-950/70 text-white/70">{i + 1}</span>}
                  <button onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                    className="absolute right-1 top-1 p-0.5 rounded bg-slate-950/70 text-white/70 hover:text-white" aria-label="빼기">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {!hasVideo && (<>
              <button onClick={() => fileRef.current?.click()} disabled={uploading !== null}
                className="w-24 h-24 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                title="직접 올리기">
                {uploading === 'file' ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
              </button>
              <button onClick={() => setPickerOpen(true)} disabled={uploading !== null}
                className="w-24 h-24 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                title="소재에서 고르기">
                {uploading === 'asset' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Library className="w-5 h-5" />}
              </button>
              </>)}
            </div>

            {/* ⛔ 잘린다는 말이 나오지 않는다 — 기본이 여백 채우기라 잘리지 않는다. */}
            {fitSummary && (
              <div className="mt-3 flex items-start gap-1.5">
                {fitSummary.allUntouched
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  : <Info className="w-3.5 h-3.5 text-white/40 flex-shrink-0 mt-0.5" />}
                <p className="text-[11px] text-white/55 leading-relaxed break-keep">
                  {fitSummary.video
                    ? '고른 채널 모두 영상을 그대로 올립니다.'
                    : fitSummary.allUntouched
                      ? '고른 채널 모두 사진을 그대로 올립니다.'
                      : `${fitSummary.touched.join(' · ')}는 규격이 달라 여백을 채워 올립니다. 사진은 잘리지 않아요.`}
                </p>
              </div>
            )}
          </>
        )}

        {/* ★ 1차-B — 영상 조각 업로드 진행률(보낸 조각 기준) */}
        {progress !== null && (
          <div className="mt-3" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-[11px] text-white/55 mb-1">
              <span>영상 올리는 중</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-violet-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 2. 채널 */}
      <div className={`${OUI_CARD} p-4`}>
        <p className="text-xs text-white/60 mb-2.5">올릴 채널</p>
        <div className="flex gap-2 flex-wrap">
          {usable.map((a) => {
            const on = selected.includes(a.id);
            const spec = specOf(a.platform);
            const locked = isLocked(a.id);
            return (
              <button key={a.id}
                onClick={() => { if (!locked) setSelected((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id])); }}
                disabled={locked && !on}
                aria-disabled={locked}
                className={`px-3 py-2 rounded-xl border text-xs inline-flex items-center gap-2 transition-colors ${
                  on ? 'bg-violet-600 border-violet-500 text-white'
                    : locked ? 'bg-white/[0.02] border-white/5 text-white/30 cursor-not-allowed'
                      : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                }`}>
                <SnsChannelLogo platform={a.platform} size={15} muted={!on} />
                <span>{spec?.label || a.platform}</span>
                {a.username && <span className={on ? 'text-white/70' : 'text-white/40'}>@{a.username}</span>}
              </button>
            );
          })}
        </div>
        {/* ★ 1차-B — 받지 못하는 채널은 칩 아래 사유 한 줄. 미디어가 없을 때는 고른 채널의 것만(사진을 넣기 전에 겁주지 않는다). */}
        {(() => {
          const lines = usable
            .filter((a) => blockOf.get(a.id) && (media.length > 0 || blockOf.get(a.id)!.hard || selected.includes(a.id)))
            .map((a) => ({ id: a.id, text: `${specOf(a.platform)?.label || a.platform}: ${blockOf.get(a.id)!.reason}` }));
          if (lines.length === 0) return null;
          return (
            <ul className="mt-2.5 space-y-1">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start gap-1.5 text-[11px] text-amber-200/80 break-keep">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          );
        })()}
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
