// SnsComposer — SNS 작성 구역 (2026-09-21 S2 · ★ 2026-09-24 올릴 글 재설계)
// 설계 SoT = docs/2026-09-24-sns-channel-design.md §4(B-1~B-8) · §6(D1~D3 · E6 · E7 · 쓰던 글 보존) · §8
//
// 한 번 쓰면 고른 채널 수만큼 갈라진다. 그 갈라짐을 **사용자가 누르기 전에 미리 보여주는 것**이 이 화면의 일이다.
//   - 글 상자 안 꼬리 = 올릴 때 글 끝에 붙는 태그 줄 · AI 표시(읽기 전용)
//   - 채널별 글 = 실제로 채널에 올라가는 문자열 그대로(서버 CT 미러로 만든다 · 서버가 같은 값인지 대조한다)
//   - 태그 패널 = 자주 쓰는 태그는 새 글마다 모두 켜진 채 시작(Harold 0924 Q3 나) · [모두 끄기]
//   - AI = 글이 있으면 다듬기 · 글이 없고 사진이 있으면 사진 보고 첫 글(Q2 가) · 즉시 적용 + [원래 글로]
//
// ⛔ 원본을 멋대로 자르지 않는다(Harold 확정 2026-09-21). 사진은 여백을 채우고, 글은 상한을 넘어도 자르지 않고 알린다.
// ⛔ 추가 입력을 요구하지 않는다. 판정 규칙은 서버 CT 의 미러(`utils/sns-view.ts`)만 쓴다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import {
  ImagePlus, ImageOff, Loader2, Send, X, CheckCircle2, Info, Sparkles, Library, Play,
  SpellCheck, Undo2, RefreshCw, Minimize2, Plus, Pencil, Check, ChevronDown, AlertTriangle, Link2, Bookmark,
} from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import SnsAssetPicker from './SnsAssetPicker';
import ConfirmModal, { ConfirmState } from '../ConfirmModal';
import { DateTimeField } from '../DateTimeField';
import { useToast } from '../ToastProvider';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import { highlightAdditions, highlightRemovals } from '../../utils/text-diff';
import {
  snsMediaBlockReason, formatSnsDuration, SNS_VIDEO_MAX_BYTES,
  buildSnsCaption, checkSnsTag, extractBodyHashtags, normalizeSnsTags, snsCaptionMode,
  snsAccountName, snsNeedsReconnect, SNS_AI_IMAGE_NOTICE,
  type SnsAccount, type SnsSpec, type SnsComposeDefaults, type SnsPostView, type SnsCaptionView,
} from '../../utils/sns-view';
import {
  snsDraftKey, readSnsDraft, writeSnsDraft, removeSnsDraft, newSnsComposeId, snsComposePostId,
} from '../../utils/sns-draft';
import {
  OUI_CARD, OUI_BTN_PRIMARY, OUI_BTN_GHOST, OUI_BTN_OUTLINE, OUI_BTN_AI, OUI_SRC,
} from '../../utils/operator-ui';

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
  /** ★ 0924 B-8 — 우리가 만든 이미지인가(AI 표시 부착 대상 · 서버 판정 CT 결과) */
  aiNotice: boolean;
}

/** 기록 화면이 작성 구역에 넘기는 요청 — 글 고치기(E6) · 불러와서 쓰기(E7) */
export interface SnsComposeRequest {
  kind: 'edit' | 'reuse';
  post: SnsPostView;
  nonce: number;
}

interface Props {
  specs: SnsSpec[];
  accounts: SnsAccount[];
  defaults: SnsComposeDefaults | null;
  companyId: string | null;
  userId: string | null;
  request: SnsComposeRequest | null;
  onRequestHandled: () => void;
  onPublished: () => void;
  /** 끊긴 계정 칩 [다시 연결] */
  onReconnect: (accountId: string) => void;
  /** 계정 상태가 바뀐 것 같을 때(409) 화면 1콜을 다시 읽는다 */
  onAccountsChanged: () => void;
  /** '이미 저장된 글' [보기] */
  onShowPost: (postId: string) => void;
}

interface SpellIssue {
  id: string;
  start: number;
  end: number;
  before: string;
  after: string;
  kind: 'typo' | 'spacing';
  reason: string;
}

interface AiState {
  /** AI 쓰기 직전 사용자 글(다시 쓰기의 면허 · [원래 글로]) */
  base: string;
  /** AI 가 준 글 */
  result: string;
  /** 지금 원래 글을 보고 있는가 */
  showingBase: boolean;
  /** 표시 모드(바뀐 곳 강조). 누르면 편집으로 넘어간다 */
  display: boolean;
  /** ★ 0925 사진 초안에서 AI 가 읽은 사진 속 글(잘못 읽었으면 사람이 바로 보게) */
  imageText: string[];
}

interface Replacing {
  postId: string;
  accountIds: string[];
  mediaIds: string[];
  whenIso: string | null;
}

const AI_DIFF_MAX = 1500;

function whenText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  return x.size === new Set(b).size && b.every((v) => x.has(v));
}

const lower = (s: string) => s.toLowerCase();

export default function SnsComposer({
  specs, accounts, defaults, companyId, userId, request, onRequestHandled, onPublished, onReconnect, onAccountsChanged, onShowPost,
}: Props) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [body, setBodyState] = useState('');
  const bodyRef = useRef('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  /** 어느 입구가 사진을 받는 중인가. 로더는 누른 버튼에만 돈다. */
  const [uploading, setUploading] = useState<null | 'file' | 'asset'>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 영상 조각 업로드 진행률(0~100). 올리는 중이 아니면 null */
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [composeId, setComposeId] = useState<string>(() => newSnsComposeId());
  const [replacing, setReplacing] = useState<Replacing | null>(null);
  const [reusedBody, setReusedBody] = useState<string | null>(null);
  const [alreadySaved, setAlreadySaved] = useState<string | null>(null);
  const [replaceGone, setReplaceGone] = useState(false);
  /** 409 CAPTION_CHANGED — 서버 확정본. sig 가 같을 때만 유효(무엇이든 바뀌면 미러로 돌아간다) */
  const [serverCaptions, setServerCaptions] = useState<{ sig: string; map: Record<string, string> } | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // ── 태그 ──
  const [setTags, setSetTags] = useState<string[]>([]);
  const [setInvalid, setSetInvalid] = useState<Array<{ raw: string; reason: string }>>([]);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [setLoaded, setSetLoaded] = useState(false);
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [onTags, setOnTags] = useState<string[]>([]);
  const [aiOn, setAiOn] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagEdit, setTagEdit] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const composingRef = useRef(false);

  // ── AI · 맞춤법 ──
  const [ai, setAi] = useState<AiState | null>(null);
  const [aiBusy, setAiBusy] = useState<null | 'write' | 'again' | 'fit'>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [spell, setSpell] = useState<{ body: string; issues: SpellIssue[] } | null>(null);
  const [spellBusy, setSpellBusy] = useState(false);

  /** 처음 한 번만 — 복원·요청·기본값 중 먼저 온 것이 초기 상태를 정한다 */
  const initRef = useRef<{ restored: boolean; defaultsApplied: boolean; tagsApplied: boolean }>({ restored: false, defaultsApplied: false, tagsApplied: false });

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });
  const jsonHeaders = () => ({ ...auth(), 'Content-Type': 'application/json' });

  /** 사용자가 직접 고칠 때 — 맞춤법 결과·AI 표시 모드를 끝낸다 */
  const setBodyByUser = (v: string) => {
    bodyRef.current = v;
    setBodyState(v);
    setSpell(null);
    setAiNote(null);
    setAi((prev) => (prev && (v === prev.base || v === prev.result) ? prev : null));
  };
  /** 기계가 바꿀 때(맞춤법 고치기 · AI 적용 · 불러오기) */
  const setBodyByApp = (v: string) => {
    bodyRef.current = v;
    setBodyState(v);
  };

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

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
   * 서버에 저장된 사진을 목록에 붙인다. 입구(직접 올리기 · 소재에서 고르기 · 불러오기)가 같이 쓴다.
   * ★ 2026-09-23 B-0923-4: 미리보기 주소 `/api/sns/media/:id` 는 로그인이 필요해 `<img src>` 에 그대로 넣으면 401 로 깨졌다
   *   (`<img>` 는 Authorization 헤더를 못 붙인다). 공용 CT 로 헤더를 실어 받아 blob 주소로 띄운다.
   *   못 받으면 null: 사진은 이미 서버에 있어 올리기는 그대로 되고, 칸에는 깨진 그림 대신 빈 사진 표시가 선다.
   */
  const appendMedia = async (
    data: { media: { id: string; width: number; height: number; kind?: string; durationSec?: number | null; aiNotice?: boolean }; fits?: unknown },
    /** ★ 1차-B — 영상은 이미 손에 든 파일로 미리 본다(300MB 를 다시 내려받지 않는다). 이 주소도 여기서부터 반납 대상이다 */
    localPreview?: string,
  ) => {
    let previewUrl: string | null = localPreview ?? null;
    if (!localPreview && data.media.kind !== 'video') {
      try { previewUrl = await fetchAuthObjectUrl(`/api/sns/media/${data.media.id}`); } catch { /* 미리보기만 못 띄운다 */ }
    }
    if (!alive.current) { if (previewUrl) URL.revokeObjectURL(previewUrl); return; }
    setMedia((prev) => (prev.some((x) => x.id === data.media.id) ? prev : [...prev, {
      id: data.media.id,
      kind: data.media.kind === 'video' ? 'video' : 'image',
      width: data.media.width,
      height: data.media.height,
      durationSec: typeof data.media.durationSec === 'number' ? data.media.durationSec : null,
      previewUrl,
      fits: Array.isArray(data.fits) ? data.fits as UploadedMedia['fits'] : [],
      aiNotice: data.media.aiNotice === true,
    }]));
  };

  const specOf = (platform: string) => specs.find((s) => s.platform === platform);
  const labelOf = (platform: string) => specOf(platform)?.label || platform;

  /** 작성 칩에 보일 계정 — 해제된 것만 빼고 전부(끊긴 계정은 [다시 연결] 칩으로 · C6) */
  const shownAccounts = useMemo(() => accounts.filter((a) => a.status !== 'revoked'), [accounts]);
  /** 연결돼서 실제로 고를 수 있는 계정 */
  const usable = useMemo(() => accounts.filter((a) => a.status === 'active'), [accounts]);
  const nameOf = (a: SnsAccount) => snsAccountName(a, accounts);

  const hasVideo = media.some((m) => m.kind === 'video');
  const summary = useMemo(() => ({
    images: media.filter((m) => m.kind !== 'video').length,
    videos: media.filter((m) => m.kind === 'video').length,
  }), [media]);
  const aiNotice = media.some((m) => m.aiNotice);

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

  // 미디어가 바뀌어 받지 못하게 된 채널은 선택에서 뺀다(칩 아래 사유는 그대로 남는다). 끊긴 계정도 뺀다.
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => usable.some((a) => a.id === id) && !isLocked(id));
      return next.length === prev.length ? prev : next;
    });
  }, [blockOf, usable]);

  // ── 태그: 칩 목록 = 자주 쓰는 태그 + 이 글에서 더한 태그 + 켜져 있는데 둘 다에 없는 것(불러온 글) ──
  const chipList = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of [...setTags, ...extraTags, ...onTags]) {
      const k = lower(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }, [setTags, extraTags, onTags]);
  const onKeys = useMemo(() => new Set(onTags.map(lower)), [onTags]);
  const setKeys = useMemo(() => new Set(setTags.map(lower)), [setTags]);
  /** 서버로 보내는 순서 = 칩 표시 순서(미러와 서버가 같은 순서로 조립하게) */
  const activeTags = useMemo(() => chipList.filter((t) => onKeys.has(lower(t))), [chipList, onKeys]);

  // 자주 쓰는 태그 불러오기
  const loadTagSet = useCallback(async () => {
    try {
      const res = await fetch('/api/sns/tag-set', { headers: auth() });
      const data = await res.json();
      if (!data?.success) return;
      const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
      setSetTags(tags);
      setSetInvalid(Array.isArray(data.invalid) ? data.invalid : []);
      setSeeds(Array.isArray(data.seeds) ? data.seeds.map(String) : []);
      setSetLoaded(true);
      // Q3 나 — 새 글은 자주 쓰는 태그가 모두 켜진 채 시작한다(복원·불러오기가 먼저 정했으면 건드리지 않는다)
      if (!initRef.current.tagsApplied) {
        initRef.current.tagsApplied = true;
        setOnTags(tags);
      }
    } catch { /* 태그 없이도 쓸 수 있다 */ }
  }, []);

  useEffect(() => { void loadTagSet(); }, [loadTagSet]);

  // D1 — 지난번 채널을 한 번만 골라 둔다(복원된 글·불러온 글이 있으면 적용하지 않는다)
  useEffect(() => {
    if (!defaults || initRef.current.defaultsApplied || initRef.current.restored) return;
    if (usable.length === 0) return;
    initRef.current.defaultsApplied = true;
    const ids = defaults.accountIds.filter((id) => usable.some((a) => a.id === id));
    if (ids.length) setSelected(ids);
  }, [defaults, usable]);

  // ── 채널별 확정본(미러) ──
  const picked = useMemo(() => usable.filter((a) => selected.includes(a.id)), [usable, selected]);
  const captions = useMemo(() => picked.map((a) => {
    const spec = specOf(a.platform);
    const cap: SnsCaptionView | null = spec ? buildSnsCaption({ body, tags: activeTags, aiNotice }, spec.capabilities) : null;
    return { account: a, spec, cap };
  }).filter((c): c is { account: SnsAccount; spec: SnsSpec; cap: SnsCaptionView } => !!c.spec && !!c.cap), [picked, specs, body, activeTags, aiNotice]);

  /** 꼬리·카운터 기준 = 칩 예산(maxTags − 본문 태그 수)이 가장 큰 채널(B-2). 고른 채널이 없으면 고를 수 있는 채널로 본다. */
  const tailBasis = useMemo(() => {
    const pool = captions.length
      ? captions
      : usable.map((a) => {
        const spec = specOf(a.platform);
        return spec ? { account: a, spec, cap: buildSnsCaption({ body, tags: activeTags, aiNotice }, spec.capabilities) } : null;
      }).filter((c): c is { account: SnsAccount; spec: SnsSpec; cap: SnsCaptionView } => !!c);
    if (!pool.length) return null;
    return [...pool].sort((x, y) => (y.spec.capabilities.maxTags - y.cap.bodyTags.length) - (x.spec.capabilities.maxTags - x.cap.bodyTags.length))[0];
  }, [captions, usable, specs, body, activeTags, aiNotice]);

  const bodyTags = useMemo(() => extractBodyHashtags(body), [body]);
  const overChannels = captions.filter((c) => c.cap.overBy > 0);
  const worstOver = [...overChannels].sort((x, y) => y.cap.overBy - x.cap.overBy)[0] ?? null;
  const placeholderLeft = captions.some((c) => c.cap.placeholderLeft) || (captions.length === 0 && tailBasis?.cap.placeholderLeft);

  const sig = JSON.stringify([body, activeTags, media.map((m) => m.id), [...selected].sort()]);
  const serverMap = serverCaptions && serverCaptions.sig === sig ? serverCaptions.map : null;
  const textOf = (c: { account: SnsAccount; cap: SnsCaptionView }) => serverMap?.[c.account.id] ?? c.cap.text;

  /** 켜진 칩이 꼬리에 없으면 이유(글에 이미 있어요 · 인스타그램에 안 실려요) */
  const chipReason = (tag: string): string | null => {
    const k = lower(tag);
    if (!onKeys.has(k)) return null;
    if (bodyTags.some((t) => lower(t) === k)) return '글에 이미 있어요';
    const dropped = captions.filter((c) => c.cap.droppedTags.some((t) => lower(t) === k)).map((c) => c.spec.label);
    const uniq = Array.from(new Set(dropped));
    return uniq.length ? `${uniq.join(' · ')}에 안 실려요` : null;
  };

  // ── 채널별 글 펼침 규칙: 넘침 · 빠진 태그 · X · 같은 채널 계정 2개 이상 · 서버 확정본 ──
  const hasX = captions.some((c) => c.account.platform === 'x');
  const samePlatformTwice = new Set(captions.map((c) => c.account.platform)).size < captions.length;
  const mustOpen = hasX || overChannels.length > 0 || captions.some((c) => c.cap.droppedTags.length > 0) || samePlatformTwice || !!serverMap;
  const allSame = captions.length > 0 && captions.every((c) => textOf(c) === textOf(captions[0]));

  // ── 사진 올리기(1차-B 그대로) ──

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
        headers: jsonHeaders(),
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
   * 소재 라이브러리에서 가져오기. 서버가 파일을 복사하고 `asset_id` 를 남긴다.
   * 이미지 스튜디오에서 만든 소재면 AI 표시가 붙는다(★ 0924 B-8 · 직접 올려 둔 소재는 붙지 않는다).
   */
  const pickFromLibrary = async (assetIds: string[]) => {
    setUploading('asset');
    try {
      for (const assetId of assetIds) {
        const res = await fetch('/api/sns/media/from-asset', {
          method: 'POST',
          headers: jsonHeaders(),
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

  /** 불러와서 쓰기·복원 — 예전 미디어를 회사 조건으로 다시 읽어 같은 함수로 붙인다(E7). */
  const lookupMedia = async (ids: string[]): Promise<number> => {
    if (!ids.length) return 0;
    try {
      const res = await fetch('/api/sns/media/lookup', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ mediaIds: ids }) });
      const data = await res.json();
      if (!data?.success) return ids.length;
      for (const item of Array.isArray(data.items) ? data.items : []) await appendMedia(item);
      return Array.isArray(data.missing) ? data.missing.length : 0;
    } catch {
      return ids.length;
    }
  };

  // ── AI 캡션 쓰기(B-6) ──

  const aiMode = snsCaptionMode({ body, imageCount: summary.images, videoCount: summary.videos });
  const aiActive = !!ai && (body === ai.result || body === ai.base);

  const runAi = async (action: 'write' | 'again' | 'fit', fitPlatform?: string) => {
    if (aiBusy) return;
    const current = bodyRef.current;
    const sentBody = action === 'again' && ai ? ai.base : current;
    setAiBusy(action);
    setAiNote(null);
    try {
      const res = await fetch('/api/sns/caption', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          body: sentBody,
          tags: activeTags,
          mediaIds: media.map((m) => m.id),
          action,
          previous: action === 'again' ? current : undefined,
          fitPlatform,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!alive.current) return;
      // ⛔ 요청 중에 글이 바뀌었으면 넣지 않는다(사용자가 쓴 것을 AI 가 덮지 않게)
      if (bodyRef.current !== current) { toastRef.current.info('쓰는 동안 글이 바뀌어 AI 글을 넣지 않았어요.'); return; }
      if (!res.ok || !data?.success) {
        setAiNote(data?.error || 'AI가 글을 쓰지 못했어요. 한 번 더 눌러 주세요.');
        return;
      }
      if (Array.isArray(data.tags) && data.tags.length) {
        const add = normalizeSnsTags(data.tags);
        setOnTags((prev) => [...prev, ...add.filter((t) => !prev.some((p) => lower(p) === lower(t)))]);
        setAiOn((prev) => [...prev, ...add.map(lower)]);
      }
      if (data.changed) {
        const base = action === 'again' && ai ? ai.base : current;
        const result = String(data.caption ?? '');
        const imageText = Array.isArray(data.imageText) ? data.imageText.map(String).filter(Boolean) : [];
        setAi({ base, result, showingBase: false, display: true, imageText: action === 'again' && ai ? (imageText.length ? imageText : ai.imageText) : imageText });
        setBodyByApp(result);
        setSpell(null);
      }
      setAiNote(data.note || (data.changed ? null : '고칠 곳을 찾지 못했어요.'));
    } catch {
      setAiNote('AI가 글을 쓰지 못했어요. 한 번 더 눌러 주세요.');
    } finally {
      setAiBusy(null);
    }
  };

  const swapAi = () => {
    if (!ai) return;
    if (ai.showingBase) { setBodyByApp(ai.result); setAi({ ...ai, showingBase: false, display: true }); }
    else { setBodyByApp(ai.base); setAi({ ...ai, showingBase: true, display: false }); }
    setSpell(null);
  };

  /** 표시 모드 → 편집. 누른 글자 자리로 커서를 옮긴다. */
  const toEdit = (offset: number) => {
    setAi((prev) => (prev ? { ...prev, display: false } : prev));
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      const at = Math.max(0, Math.min(offset, el.value.length));
      el.setSelectionRange(at, at);
    });
  };

  const aiDiff = useMemo(() => {
    if (!ai || ai.showingBase || !ai.display || body !== ai.result) return null;
    if (ai.result.length > AI_DIFF_MAX || ai.base.length > AI_DIFF_MAX || !ai.base.trim()) return { chunks: null, removed: 0 };
    const chunks = highlightAdditions(ai.base, ai.result);
    const removed = highlightRemovals(ai.base, ai.result).filter((c) => c.added && c.text.trim()).length;
    return { chunks, removed };
  }, [ai, body]);

  // ── 맞춤법 검사(B-7) ──

  const runSpell = async () => {
    const sent = bodyRef.current;
    if (!sent.trim() || spellBusy) return;
    setSpellBusy(true);
    try {
      const res = await fetch('/api/sns/typo-check', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ body: sent }) });
      const data = await res.json().catch(() => null);
      if (!alive.current) return;
      if (bodyRef.current !== sent) { toastRef.current.info('검사하는 동안 글이 바뀌었어요. 한 번 더 눌러 주세요.'); return; }
      if (!res.ok || !data?.success) { toastRef.current.error(data?.error || '맞춤법을 검사하지 못했어요.'); return; }
      setSpell({ body: sent, issues: Array.isArray(data.issues) ? data.issues : [] });
    } catch {
      toastRef.current.error('맞춤법을 검사하지 못했어요.');
    } finally {
      setSpellBusy(false);
    }
  };

  const selectIssue = (it: SpellIssue) => {
    const el = textRef.current;
    if (!el) return;
    setAi((prev) => (prev ? { ...prev, display: false } : prev));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(it.start, it.end); });
  };

  /** 고치기 — 원문 자리가 그대로일 때만 바꾸고, 뒤쪽 항목의 자리를 밀어 준다. */
  const applyIssues = (targets: SpellIssue[]) => {
    if (!spell) return;
    let text = bodyRef.current;
    let rest = [...spell.issues];
    for (const it of [...targets].sort((a, b) => b.start - a.start)) {
      const cur = rest.find((r) => r.id === it.id);
      if (!cur) continue;
      if (text.slice(cur.start, cur.end) !== cur.before) { rest = rest.filter((r) => r.id !== cur.id); continue; }
      text = text.slice(0, cur.start) + cur.after + text.slice(cur.end);
      const delta = cur.after.length - cur.before.length;
      rest = rest
        .filter((r) => r.id !== cur.id)
        .map((r) => (r.start >= cur.end ? { ...r, start: r.start + delta, end: r.end + delta } : r))
        .filter((r) => r.end <= cur.start || r.start >= cur.start + cur.after.length);
    }
    setBodyByApp(text);
    setAi(null);
    setSpell({ body: text, issues: rest });
  };

  // ── 태그 패널(B-5) ──

  /** 글자열에서 태그를 꺼내 켠다. 거절된 것은 칸에 남기고 사유 한 줄. */
  const addTagsFrom = (raw: string): string => {
    const parts = raw.split(/[\s,#]+/).map((p) => p.trim()).filter(Boolean);
    const bad: string[] = [];
    let reason: string | null = null;
    const good: string[] = [];
    for (const p of parts) {
      const r = checkSnsTag(p);
      if (!r) continue;
      if (!r.ok) { bad.push(p); reason = reason || r.reason; continue; }
      good.push(r.tag);
    }
    if (good.length) {
      setExtraTags((prev) => [...prev, ...good.filter((t) => !setKeys.has(lower(t)) && !prev.some((p) => lower(p) === lower(t)))]);
      setOnTags((prev) => [...prev, ...good.filter((t) => !prev.some((p) => lower(p) === lower(t)))]);
    }
    setTagError(reason);
    return bad.join(' ');
  };

  const onTagChange = (v: string) => {
    if (composingRef.current) { setTagInput(v); return; }
    // 구분자(공백·쉼표·가운데 #)가 들어오면 그 앞까지 태그로 만든다
    let cut = -1;
    for (let i = v.length - 1; i >= 0; i -= 1) {
      const ch = v[i];
      if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\t' || (ch === '#' && i > 0)) { cut = i; break; }
    }
    if (cut < 0) { setTagInput(v); setTagError(null); return; }
    const left = addTagsFrom(v.slice(0, cut));
    const rest = v.slice(cut).replace(/^[\s,]+/, '');
    setTagInput(left ? `${left} ${rest}`.trim() : rest);
  };

  const onTagSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (composingRef.current) return;
    setTagInput(addTagsFrom(tagInput));
  };

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중 Enter 는 조합을 끝내는 키다 — 태그를 만들지 않는다(설계 B-5)
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
  };

  const onTagPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\s,#]/.test(text)) return;
    e.preventDefault();
    setTagInput(addTagsFrom(`${tagInput} ${text}`));
  };

  const toggleTag = (tag: string) => {
    const k = lower(tag);
    if (onKeys.has(k)) {
      setOnTags((prev) => prev.filter((t) => lower(t) !== k));
      setAiOn((prev) => prev.filter((t) => t !== k));
    } else {
      setOnTags((prev) => [...prev, tag]);
    }
  };

  const patchTagSet = async (payload: { add?: string[]; remove?: string[] }, okText?: string) => {
    setTagSaving(true);
    try {
      const res = await fetch('/api/sns/tag-set', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(payload) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) { toastRef.current.error(data?.error || '자주 쓰는 태그를 저장하지 못했어요.'); return false; }
      const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
      setSetTags(tags);
      setSetInvalid(Array.isArray(data.invalid) ? data.invalid : []);
      const keys = new Set(tags.map(lower));
      setExtraTags((prev) => prev.filter((t) => !keys.has(lower(t))));
      if (tags.length) setSeeds([]);
      if (okText) toastRef.current.success(okText);
      return true;
    } catch {
      toastRef.current.error('자주 쓰는 태그를 저장하지 못했어요.');
      return false;
    } finally {
      setTagSaving(false);
    }
  };

  const saveBodyTags = async () => {
    const missing = bodyTags.filter((t) => !setKeys.has(lower(t)));
    if (!missing.length) return;
    await patchTagSet({ add: missing }, `자주 쓰는 태그에 ${missing.length}개를 저장했어요.`);
  };

  // ── 전체 비우기 · 불러오기 ──

  const resetAll = (opts?: { keepSelected?: boolean }) => {
    setMedia([]);
    setBodyByApp('');
    setScheduledAt('');
    setExtraTags([]);
    setOnTags(setTags);
    setAiOn([]);
    setTagInput('');
    setTagError(null);
    setAi(null);
    setAiNote(null);
    setSpell(null);
    setServerCaptions(null);
    setReplacing(null);
    setReusedBody(null);
    setAlreadySaved(null);
    setReplaceGone(false);
    setComposeId(newSnsComposeId());
    if (!opts?.keepSelected) setSelected([]);
  };

  const hasContent = body.trim().length > 0 || media.length > 0;

  const loadPost = async (req: SnsComposeRequest) => {
    const post = req.post;
    const latest = post.targets.filter((t) => !t.superseded);
    resetAll();
    initRef.current.tagsApplied = true;
    initRef.current.defaultsApplied = true;
    setBodyByApp(post.body || '');
    const tags = normalizeSnsTags(post.tags || []);
    setOnTags(tags);
    setExtraTags(tags.filter((t) => !setKeys.has(lower(t))));
    const accountIds = Array.from(new Set(latest.map((t) => t.accountId).filter((x): x is string => !!x)));
    if (req.kind === 'edit') {
      setSelected(accountIds);
      const whenIso = post.nextAt ?? post.scheduled_at ?? null;
      setReplacing({ postId: post.id, accountIds, mediaIds: post.media_ids, whenIso });
      setScheduledAt(whenIso ?? '');
    } else {
      // 불러와서 쓰기 — 지금 쓸 수 있는 계정만(연결됨 · 열린 채널 · 건당 비용 채널 제외)
      setSelected(accountIds.filter((id) => {
        const a = usable.find((x) => x.id === id);
        const spec = a ? specOf(a.platform) : undefined;
        return !!a && !!spec?.available && !spec.capabilities.metered;
      }));
      setReusedBody(post.body || '');
    }
    const missing = await lookupMedia(post.media_ids || []);
    if (missing > 0) toastRef.current.warning(`예전 사진·영상 ${missing}개를 찾지 못했어요. 다시 올려 주세요.`);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!request) return;
    const req = request;
    onRequestHandled();
    if (hasContent || replacing) {
      setConfirmState({
        mode: 'warning',
        title: '쓰던 글을 비우고 불러올까요?',
        description: '지금 쓰던 글과 사진은 사라져요.',
        confirmLabel: '불러오기',
        onConfirm: () => { void loadPost(req); },
      });
    } else {
      void loadPost(req);
    }
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 쓰던 글 보존 ──
  const draftKey = snsDraftKey(companyId, userId);

  // 복원(처음 한 번). 이 composeId 로 이미 저장된 글이 있으면 복원하지 않는다(응답만 놓친 경우).
  useEffect(() => {
    if (!draftKey) return;
    const d = readSnsDraft(draftKey);
    if (!d || (!d.body.trim() && d.mediaIds.length === 0)) return;
    initRef.current.restored = true;
    initRef.current.tagsApplied = true;
    let cancelled = false;
    (async () => {
      const postId = companyId ? await snsComposePostId(companyId, userId, d.composeId) : null;
      if (postId) {
        try {
          const res = await fetch('/api/sns/posts', { headers: auth() });
          const data = await res.json();
          const ids = new Set([...(data?.upcoming ?? []), ...(data?.posts ?? [])].map((p: { id: string }) => p.id));
          if (ids.has(postId)) {
            // 이미 올라간 글 — 복원하지 않고 새 글 상태(자주 쓰는 태그 켜짐)로 돌아간다
            removeSnsDraft(draftKey);
            initRef.current.restored = false;
            initRef.current.tagsApplied = false;
            void loadTagSet();
            return;
          }
        } catch { /* 확인 못 하면 복원한다 — 올리기에서 서버가 같은 글인지 다시 본다 */ }
      }
      if (cancelled || !alive.current) return;
      setBodyByApp(d.body);
      setOnTags(normalizeSnsTags(d.onTags || []));
      setExtraTags(normalizeSnsTags(d.extraTags || []));
      setSelected(Array.isArray(d.selected) ? d.selected : []);
      if (d.scheduledAt && new Date(d.scheduledAt).getTime() > Date.now()) setScheduledAt(d.scheduledAt);
      setComposeId(d.composeId || newSnsComposeId());
      if (d.replacesPostId) setReplacing({ postId: d.replacesPostId, accountIds: d.selected || [], mediaIds: d.mediaIds || [], whenIso: d.scheduledAt || null });
      await lookupMedia(d.mediaIds || []);
      toastRef.current.info('쓰던 글을 이어서 불러왔어요.');
    })();
    return () => { cancelled = true; };
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1초 뒤 저장(비었으면 지운다)
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      if (!body.trim() && media.length === 0) { removeSnsDraft(draftKey); return; }
      writeSnsDraft(draftKey, {
        body,
        onTags: activeTags,
        extraTags,
        mediaIds: media.map((m) => m.id),
        selected,
        scheduledAt: scheduledAt && new Date(scheduledAt).getTime() > Date.now() ? scheduledAt : '',
        composeId,
        replacesPostId: replacing?.postId ?? null,
        savedAt: Date.now(),
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [draftKey, body, activeTags, extraTags, media, selected, scheduledAt, composeId, replacing]);

  // 다른 탭에서 올리기에 성공하면(보존 글이 지워지면) 이 탭의 composeId 를 새로 만든다
  useEffect(() => {
    if (!draftKey) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === draftKey && e.newValue === null) setComposeId(newSnsComposeId());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [draftKey]);

  // ── 올리기(S5 · §8) ──

  const scheduledMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const scheduleInPast = Number.isFinite(scheduledMs) && scheduledMs < nowTick;

  const lockReason = (() => {
    if (usable.length === 0) return '연결된 채널이 없어요. 아래 채널 카드에서 다시 연결해 주세요.';
    if (selected.length === 0) return '올릴 채널을 골라 주세요.';
    if (!body.trim() && media.length === 0) return '글이나 사진·영상 중 하나는 있어야 해요.';
    if (scheduleInPast) return '이미 지난 시각이에요. 다른 시각을 고르거나 지금 올려 주세요.';
    if (placeholderLeft) return '글에 채워야 할 자리가 남아 있어요. [ ] 안을 직접 고쳐 주세요.';
    if (overChannels.length) return `${overChannels.map((c) => c.spec.label).join(' · ')} 글자 수를 넘었어요.`;
    return null;
  })();

  const publish = async () => {
    if (lockReason) { toast.error(lockReason); return; }
    const stuck = picked.filter((a) => blockOf.get(a.id));
    if (stuck.length > 0) {
      toast.error(stuck.map((a) => `${labelOf(a.platform)}: ${blockOf.get(a.id)!.reason}`).join(' '));
      return;
    }
    setBusy(true);
    try {
      const expected = Object.fromEntries(captions.map((c) => [c.account.id, textOf(c)]));
      const res = await fetch('/api/sns/posts', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          body,
          tags: activeTags,
          mediaIds: media.map((m) => m.id),
          accountIds: selected,
          composeId,
          expected,
          publish: { scheduledAt: scheduledAt || null },
          replacesPostId: replacing?.postId ?? null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        const when = data.scheduledAt && scheduledAt ? whenText(data.scheduledAt) : '';
        if (data.existing) toast.info('이 글은 이미 올렸어요. 기록에서 확인해 주세요.');
        else if (replacing) toast.success(`예약 글을 고쳤어요${when ? ` · ${when}` : ''}.`);
        else toast.success(scheduledAt ? `예약했어요 · ${when}` : '올리는 중이에요. 채널에서 확인되면 게시됨으로 바뀝니다.');
        removeSnsDraft(draftKey);
        resetAll({ keepSelected: true });
        onPublished();
        return;
      }
      const code = data?.code;
      if (code === 'CAPTION_CHANGED' && data?.captions) {
        setServerCaptions({ sig, map: data.captions });
        setChannelsOpen(true);
        toast.warning(data.error || '올라갈 글이 화면과 달라요. 바뀐 글을 확인하고 다시 눌러 주세요.');
        onAccountsChanged();
        return;
      }
      if (code === 'ACCOUNT_STATE_CHANGED') {
        toast.error(data.error || '연결이 바뀐 채널이 있어요. 채널을 다시 확인해 주세요.');
        onAccountsChanged();
        return;
      }
      if (code === 'COMPOSE_ALREADY_SAVED') { setAlreadySaved(data.postId || ''); return; }
      if (code === 'REPLACE_TARGET_GONE') {
        setReplacing(null);
        setReplaceGone(true);
        setComposeId(newSnsComposeId());
        return;
      }
      if (code === 'CAPTION_NOT_OK') setChannelsOpen(true);
      toast.error(data?.error || '올리지 못했습니다.');
    } catch {
      toast.error('올리지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  };

  /** 고른 채널 중 이 사진을 손대지 않고 올리는 곳 / 여백을 채우는 곳 */
  const fitSummary = useMemo(() => {
    if (media.length === 0 || selected.length === 0) return null;
    // ★ 1차-B — 영상은 손대지 않는다(다시 인코딩 0). 받지 못하는 채널은 이미 칩에서 빠져 있다.
    if (media.some((m) => m.kind === 'video')) return { touched: [] as string[], allUntouched: true, video: true };
    const pickedPlatforms = new Set(picked.map((a) => a.platform));
    const touched: string[] = [];
    for (const m of media) {
      for (const f of m.fits) {
        if (pickedPlatforms.has(f.platform) && !f.untouched && !touched.includes(f.label)) touched.push(f.label);
      }
    }
    return { touched, allUntouched: touched.length === 0, video: false };
  }, [media, selected, picked]);

  // D1 고지 — 선택이 기본값과 같을 때만
  const defaultsNote = (() => {
    if (!defaults || replacing || reusedBody !== null) return null;
    if (defaults.source === 'none' || !defaults.accountIds.length) return null;
    if (!sameSet(selected, defaults.accountIds.filter((id) => usable.some((a) => a.id === id)))) return null;
    return defaults.source === 'last_post' ? '지난번에 올린 채널을 골라 뒀어요.' : '연결된 채널이 하나라 골라 뒀어요.';
  })();
  const droppedLines = (defaults?.dropped ?? []).map((d) => {
    const a = accounts.find((x) => x.id === d.accountId);
    if (!a) return null;
    const who = `${labelOf(a.platform)} ${nameOf(a)}`;
    const why = d.reason === 'metered' ? '글마다 비용이 드는 채널이라 직접 골라 주세요.'
      : d.reason === 'closed' ? '지금은 열려 있지 않아 뺐어요.'
        : '연결이 끊겨 뺐어요.';
    return { id: d.accountId, text: `${who}: ${why}` };
  }).filter((x): x is { id: string; text: string } => !!x);

  const publishLabel = (() => {
    if (replacing) return '예약 글 고치기';
    const n = selected.length;
    if (scheduledAt && !scheduleInPast) return `${n}곳에 예약하기 · ${whenText(scheduledAt)}`;
    return `${n}곳에 올리기`;
  })();

  // 연결된 계정도 끊긴 계정도 없으면 작성 구역을 그리지 않는다(화면 순서 §7 · 채널 카드가 위로 간다)
  if (shownAccounts.length === 0) return null;

  const tail = tailBasis?.cap;
  const tailTags = tail?.keptTags ?? [];
  // 꼬리 = 확정본에서 본문 뒤에 붙은 부분(미러가 조립한 그대로) · 본문 끝에 이미 표시가 있으면 다시 붙지 않는다
  const tailNotice = !!tail && tail.text.slice(body.trim() ? body.length : 0).includes(SNS_AI_IMAGE_NOTICE);
  const mediaLocked = !!replacing;
  const allSetInBody = bodyTags.length > 0 && bodyTags.every((t) => setKeys.has(lower(t)));
  const bodyOverLines = captions
    .filter((c) => c.cap.bodyTagsOver)
    .map((c) => `${c.spec.label}은 태그를 ${c.spec.capabilities.maxTags}개까지만 태그로 보여 줘요. 글에 쓴 태그는 ${c.cap.bodyTags.length}개예요.`);

  return (
    <section ref={sectionRef} className="space-y-3 scroll-mt-24">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-white/80">올리기</h2>
          <p className="text-xs text-white/50 mt-0.5">한 번 쓰면 고른 채널마다 규격에 맞춰 각각 올라갑니다.</p>
        </div>
        {(hasContent || replacing) && (
          <button onClick={() => resetAll({ keepSelected: !replacing })} className={OUI_BTN_GHOST}>
            <X className="w-3.5 h-3.5" /> {replacing ? '그만 고치기' : '비우기'}
          </button>
        )}
      </div>

      {replacing && (
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 flex items-start gap-2">
          <Pencil className="w-4 h-4 text-sky-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-sky-100 leading-relaxed break-keep">
            {replacing.whenIso ? `${whenText(replacing.whenIso)} 예약 글을 고치는 중이에요.` : '예약 글을 고치는 중이에요.'}
            {' '}글·태그·시각만 바꿀 수 있고 사진과 채널은 그대로예요.
          </p>
        </div>
      )}
      {replaceGone && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100 leading-relaxed break-keep">
            고치던 예약이 이미 올라가기 시작했거나 취소됐어요. 이 글은 새 글로 올릴 수 있어요.
          </p>
        </div>
      )}
      {alreadySaved !== null && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100 leading-relaxed break-keep flex-1 min-w-[12rem]">
            이 글은 이미 저장됐어요. 고친 내용은 반영되지 않았어요.
          </p>
          <div className="flex gap-2">
            {alreadySaved && (
              <button onClick={() => onShowPost(alreadySaved)} className={OUI_BTN_GHOST}>보기</button>
            )}
            <button onClick={() => { setComposeId(newSnsComposeId()); setAlreadySaved(null); }} className={OUI_BTN_OUTLINE}>
              새 글로 올리기
            </button>
          </div>
        </div>
      )}

      {/* 1. 사진 */}
      <div className={`${OUI_CARD} p-4`}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple hidden
          onChange={(e) => void upload(e.target.files)} />

        {media.length === 0 ? (
          /* 반반 — 직접 올리기 / 소재에서 고르기. 이미 만들어 둔 소재를 다시 올리게 하지 않는다. */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button onClick={() => fileRef.current?.click()} disabled={uploading !== null || mediaLocked}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2 disabled:opacity-50">
              {uploading === 'file' ? <Loader2 className="w-6 h-6 animate-spin text-violet-400" /> : <ImagePlus className="w-6 h-6 text-white/40" />}
              <span className="text-sm text-white/70">직접 올리기</span>
              <span className="text-[11px] text-white/40">사진 또는 영상(MP4·MOV) 한 개</span>
            </button>
            <button onClick={() => setPickerOpen(true)} disabled={uploading !== null || mediaLocked}
              className="py-10 rounded-xl border border-dashed border-white/15 hover:border-violet-400/40 hover:bg-white/[0.03] transition-colors flex flex-col items-center gap-2 disabled:opacity-50">
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
                  {m.aiNotice && <span className="absolute left-1 bottom-1 text-[9px] px-1 rounded bg-violet-600/80 text-white">AI</span>}
                  {!mediaLocked && (
                    <button onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                      className="absolute right-1 top-1 p-0.5 rounded bg-slate-950/70 text-white/70 hover:text-white" aria-label="빼기">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              {!hasVideo && !mediaLocked && (<>
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
          {shownAccounts.map((a) => {
            const spec = specOf(a.platform);
            const label = spec?.label || a.platform;
            // C6 — 끊긴 계정은 [다시 연결] 칩 · 확인 필요·확인 중은 고를 수 없다
            if (snsNeedsReconnect(a)) {
              return (
                <button key={a.id} onClick={() => onReconnect(a.id)} disabled={!!replacing}
                  className="px-3 py-2 rounded-xl border text-xs inline-flex items-center gap-2 bg-amber-500/10 border-amber-400/30 text-amber-100 hover:bg-amber-500/20 transition-colors disabled:opacity-50">
                  <SnsChannelLogo platform={a.platform} size={15} muted />
                  <span>{label}</span>
                  <span className="text-amber-200/70">{nameOf(a)}</span>
                  <span className="inline-flex items-center gap-1 font-semibold"><Link2 className="w-3 h-3" />다시 연결</span>
                </button>
              );
            }
            if (a.status !== 'active') {
              return (
                <span key={a.id} aria-disabled
                  className="px-3 py-2 rounded-xl border text-xs inline-flex items-center gap-2 bg-white/[0.02] border-white/5 text-white/35 cursor-not-allowed">
                  <SnsChannelLogo platform={a.platform} size={15} muted />
                  <span>{label}</span>
                  <span>{nameOf(a)}</span>
                  <span className="text-amber-200/70">{a.status === 'pending' ? '확인 중' : '계정 확인 필요'}</span>
                </span>
              );
            }
            const on = selected.includes(a.id);
            const locked = isLocked(a.id) || !!replacing;
            return (
              <button key={a.id}
                onClick={() => { if (!locked) setSelected((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id])); }}
                disabled={locked && !on}
                aria-disabled={locked}
                aria-pressed={on}
                className={`px-3 py-2 rounded-xl border text-xs inline-flex items-center gap-2 transition-colors ${
                  on ? 'bg-violet-600 border-violet-500 text-white'
                    : locked ? 'bg-white/[0.02] border-white/5 text-white/30 cursor-not-allowed'
                      : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                }`}>
                <SnsChannelLogo platform={a.platform} size={15} muted={!on} />
                <span>{label}</span>
                <span className={on ? 'text-white/70' : 'text-white/40'}>{nameOf(a)}</span>
              </button>
            );
          })}
        </div>
        {/* ★ 1차-B — 받지 못하는 채널은 칩 아래 사유 한 줄. 미디어가 없을 때는 고른 채널의 것만(사진을 넣기 전에 겁주지 않는다). */}
        {(() => {
          const lines = usable
            .filter((a) => blockOf.get(a.id) && (media.length > 0 || blockOf.get(a.id)!.hard || selected.includes(a.id)))
            .map((a) => ({ id: a.id, text: `${labelOf(a.platform)} ${nameOf(a)}: ${blockOf.get(a.id)!.reason}` }));
          const all = [...lines, ...(reusedBody === null && !replacing ? droppedLines : [])];
          if (all.length === 0 && !defaultsNote) return null;
          return (
            <ul className="mt-2.5 space-y-1">
              {defaultsNote && (
                <li className="flex items-start gap-1.5 text-[11px] text-white/50 break-keep">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-px text-emerald-400/80" />
                  <span>{defaultsNote}</span>
                </li>
              )}
              {all.map((l) => (
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

      {/* 3. 글 · 태그 — 반반(좁은 화면은 글 → 태그) */}
      <div className={`${OUI_CARD} p-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 왼쪽: 글 */}
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-xs text-white/60">올릴 글</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* ⛔ 1클릭 — 누르면 바로 채워진다. 중간에 무엇도 묻지 않는다(§2-17). */}
                <button onClick={() => void runAi('write')} disabled={!!aiBusy || aiMode.mode === 'locked'}
                  title={aiMode.reason ?? undefined} className={OUI_BTN_AI}>
                  {aiBusy === 'write' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  AI로 캡션 쓰기
                </button>
                <button onClick={() => void runSpell()} disabled={spellBusy || !body.trim() || !!aiBusy} className={OUI_BTN_OUTLINE}>
                  {spellBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SpellCheck className="w-3.5 h-3.5" />}
                  맞춤법 검사
                </button>
              </div>
            </div>
            <p className="text-[11px] text-white/40 mb-2 break-keep">
              {aiMode.mode === 'refine' ? '쓴 글을 다듬고 맞춤법까지 바로잡아요. 링크·가격·혜택은 그대로 둬요.'
                : aiMode.mode === 'photo_draft' ? '사진을 보고 첫 글을 써 드려요. 가격·행사 같은 사실은 쓰지 않아요.'
                  : aiMode.reason}
            </p>

            {aiActive && ai && (
              <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-violet-200/80 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  {ai.showingBase ? '원래 글을 보고 있어요' : 'AI가 쓴 글이에요. 자유롭게 고쳐 주세요.'}
                  {!ai.showingBase && aiDiff && aiDiff.removed > 0 && ` · 지운 곳 ${aiDiff.removed}`}
                </span>
                <div className="flex-1" />
                <button onClick={swapAi} disabled={!!aiBusy} className={`${OUI_BTN_GHOST} !h-7 !px-2 !text-[11px]`}>
                  <Undo2 className="w-3 h-3" /> {ai.showingBase ? 'AI 글로' : '원래 글로'}
                </button>
                {!ai.showingBase && (
                  <button onClick={() => void runAi('again')} disabled={!!aiBusy} className={`${OUI_BTN_GHOST} !h-7 !px-2 !text-[11px]`}>
                    {aiBusy === 'again' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 다시 쓰기
                  </button>
                )}
              </div>
            )}
            {/* ★ 0925 A안 — AI 가 사진에서 읽은 글. 이 글에 있는 사실만 초안에 쓸 수 있다(잘못 읽었으면 여기서 보인다). */}
            {aiActive && ai && !ai.showingBase && ai.imageText.length > 0 && (
              <p className="mb-2 text-[11px] text-white/45 break-keep">
                <span className="text-white/60">사진에서 읽은 글</span> · {ai.imageText.join(' · ')}
              </p>
            )}

            {/* 글 상자 = 글 + 꼬리(올릴 때 글 끝에 붙는 것 · 읽기 전용) */}
            <div className="relative rounded-xl border border-white/10 bg-white/[0.04] focus-within:border-violet-400/40 transition-colors">
              {aiDiff && aiDiff.chunks ? (
                <div role="textbox" aria-readonly tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') toEdit(body.length); }}
                  className="min-h-[8.5rem] px-3 py-2.5 text-sm text-white whitespace-pre-wrap break-words cursor-text">
                  {(() => {
                    let offset = 0;
                    return aiDiff.chunks.map((c, i) => {
                      const start = offset;
                      offset += c.text.length;
                      return (
                        <span key={i} onClick={() => toEdit(start + c.text.length)}
                          className={c.added ? 'bg-violet-500/25 text-violet-50 rounded-sm' : undefined}>
                          {c.text}
                        </span>
                      );
                    });
                  })()}
                </div>
              ) : (
                <textarea
                  ref={textRef}
                  value={body}
                  readOnly={!!aiBusy}
                  onChange={(e) => setBodyByUser(e.target.value)}
                  rows={6}
                  placeholder={summary.images > 0 ? '올릴 글을 써 주세요. 비워 두고 AI로 캡션 쓰기를 누르면 사진을 보고 첫 글을 써 드려요.' : '올릴 글을 써 주세요.'}
                  className="w-full bg-transparent px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none resize-y rounded-xl"
                />
              )}
              {(tailTags.length > 0 || tailNotice) && (
                <button type="button" onClick={() => tagInputRef.current?.focus()}
                  className="w-full text-left px-3 pb-2.5 pt-2 border-t border-dashed border-white/10 space-y-1">
                  <span className="block text-[10px] text-white/35">올릴 때 글 끝에 붙어요{tailBasis && captions.length > 1 ? ` · ${tailBasis.spec.label} 기준` : ''}</span>
                  {tailTags.length > 0 && (
                    <span className="block text-[12px] text-violet-300 break-words">{tailTags.map((t) => `#${t}`).join(' ')}</span>
                  )}
                  {tailNotice && <span className="block text-[12px] text-white/40">{SNS_AI_IMAGE_NOTICE}</span>}
                </button>
              )}
              {aiBusy && (
                <div className="absolute inset-0 rounded-xl bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center gap-2 text-xs text-violet-100" role="status" aria-live="polite">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-300" />
                  {aiBusy === 'fit' ? 'AI가 길이를 맞추는 중이에요' : aiMode.mode === 'photo_draft' ? 'AI가 사진을 보고 쓰는 중이에요' : 'AI가 글을 쓰는 중이에요'}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              {aiNote ? <span className="text-[11px] text-amber-200/80 break-keep">{aiNote}</span> : <span />}
              {tail && (
                <span className={`text-[11px] ${tail.overBy > 0 ? 'text-rose-300' : 'text-white/45'}`}>
                  {tail.length.toLocaleString()} / {tail.limit.toLocaleString()} · {tailBasis!.spec.label} 기준
                </span>
              )}
            </div>

            {overChannels.length > 0 && (
              <div className="mt-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-rose-100 flex-1 min-w-[10rem] break-keep">
                  {overChannels.map((c) => `${c.spec.label} ${c.cap.overBy.toLocaleString()}자 넘어요`).join(' · ')}
                </span>
                {worstOver && aiMode.mode === 'refine' && (
                  <button onClick={() => void runAi('fit', worstOver.account.platform)} disabled={!!aiBusy}
                    className={`${OUI_BTN_OUTLINE} !h-7 !px-2 !text-[11px]`}>
                    {aiBusy === 'fit' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minimize2 className="w-3 h-3" />}
                    {worstOver.spec.label} 길이에 맞게 줄이기
                  </button>
                )}
              </div>
            )}
            {placeholderLeft && (
              <p className="mt-2 text-[11px] text-amber-200/80 break-keep">글에 채워야 할 자리가 남아 있어요. [ ] 안을 직접 고쳐 주세요.</p>
            )}
            {reusedBody !== null && body === reusedBody && body.trim() && (
              <p className="mt-2 text-[11px] text-amber-200/80 break-keep">예전에 올린 글과 같아요. 그대로 올리면 같은 글이 한 번 더 올라가요.</p>
            )}

            {/* 맞춤법 결과 */}
            {spell && spell.body === body && (
              <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                {spell.issues.length === 0 ? (
                  <p className="text-[11px] text-white/55 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> 고칠 곳을 찾지 못했어요.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] text-white/60">고칠 곳 {spell.issues.length}개</span>
                      <button onClick={() => applyIssues(spell.issues)} className={`${OUI_BTN_OUTLINE} !h-7 !px-2 !text-[11px]`}>
                        <Check className="w-3 h-3" /> 모두 고치기
                      </button>
                    </div>
                    <ul className="space-y-1.5">
                      {spell.issues.map((it) => (
                        <li key={it.id} className="flex items-center gap-2 flex-wrap text-[12px]">
                          <button onClick={() => selectIssue(it)} className="text-left min-w-0 flex-1 break-keep hover:bg-white/5 rounded px-1 -mx-1">
                            <span className="line-through text-rose-300/80">{it.before}</span>
                            <span className="text-white/35 mx-1">→</span>
                            <span className="text-emerald-300">{it.after}</span>
                            <span className="text-white/35 ml-1.5 text-[11px]">{it.kind === 'spacing' ? '띄어쓰기' : it.reason}</span>
                          </button>
                          <button onClick={() => applyIssues([it])} className="text-[11px] text-violet-300 hover:text-violet-200">고치기</button>
                          <button onClick={() => setSpell({ ...spell, issues: spell.issues.filter((x) => x.id !== it.id) })}
                            className="text-[11px] text-white/40 hover:text-white/70">그대로 두기</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* D3 — 글에 쓴 태그 */}
            {bodyTags.length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] text-white/50">
                <span>글에 쓴 태그 {bodyTags.length}개 · 글 그대로 올라가요</span>
                {allSetInBody ? (
                  <span className="text-emerald-300/80 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />자주 쓰는 태그에 있어요</span>
                ) : (
                  <button onClick={() => void saveBodyTags()} disabled={tagSaving} className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1 disabled:opacity-50">
                    <Bookmark className="w-3 h-3" /> 자주 쓰는 태그에 저장
                  </button>
                )}
              </div>
            )}
            {bodyOverLines.map((l) => (
              <p key={l} className="mt-1 text-[11px] text-amber-200/80 break-keep">{l}</p>
            ))}
          </div>

          {/* 오른쪽: 태그 */}
          <div className="min-w-0 md:border-l md:border-white/10 md:pl-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <span className="text-xs text-white/60">태그</span>
                <span className="text-[11px] text-white/35 ml-1.5">켜진 태그가 글 끝에 붙어요</span>
              </div>
              <div className="flex items-center gap-1">
                {activeTags.length > 0 && (
                  <button onClick={() => { setOnTags([]); setAiOn([]); }} className={`${OUI_BTN_GHOST} !h-7 !px-2 !text-[11px]`}>모두 끄기</button>
                )}
                {(setTags.length > 0 || setInvalid.length > 0) && (
                  <button onClick={() => setTagEdit((v) => !v)} className={`${OUI_BTN_GHOST} !h-7 !px-2 !text-[11px]`}>
                    {tagEdit ? <><Check className="w-3 h-3" /> 완료</> : <><Pencil className="w-3 h-3" /> 편집</>}
                  </button>
                )}
              </div>
            </div>

            <form onSubmit={onTagSubmit} className="flex gap-1.5">
              <input
                ref={tagInputRef}
                value={tagInput}
                onChange={(e) => onTagChange(e.target.value)}
                onKeyDown={onTagKeyDown}
                onPaste={onTagPaste}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={(e) => { composingRef.current = false; onTagChange((e.target as HTMLInputElement).value); }}
                placeholder="태그 입력 후 Enter (여러 개는 띄어서)"
                aria-label="태그 입력"
                className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-lg px-3 h-9 text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/40"
              />
              <button type="submit" disabled={!tagInput.trim()} className={OUI_BTN_OUTLINE}>
                <Plus className="w-3.5 h-3.5" /> 추가
              </button>
            </form>
            {tagError && <p className="mt-1.5 text-[11px] text-rose-300 break-keep">{tagError}</p>}

            {chipList.length > 0 ? (
              <div className="mt-3 flex gap-1.5 flex-wrap">
                {chipList.map((t) => {
                  const k = lower(t);
                  const on = onKeys.has(k);
                  const saved = setKeys.has(k);
                  const byAi = aiOn.includes(k);
                  const reason = chipReason(t);
                  if (tagEdit && saved) {
                    return (
                      <span key={t} className="text-[11px] pl-2 pr-1 py-1 rounded-lg border border-white/15 bg-white/[0.04] text-white/70 inline-flex items-center gap-1">
                        #{t}
                        <button onClick={() => void patchTagSet({ remove: [t] })} disabled={tagSaving}
                          className="p-0.5 rounded hover:bg-white/10 hover:text-white" aria-label={`${t} 자주 쓰는 태그에서 빼기`}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  }
                  return (
                    <span key={t} className="inline-flex items-center gap-0.5">
                      <button onClick={() => toggleTag(t)} aria-pressed={on}
                        title={reason ?? undefined}
                        className={`text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1 transition-colors ${
                          on
                            ? reason ? 'bg-violet-500/10 text-violet-200/70 border-violet-400/25 border-dashed' : 'bg-violet-500/20 text-violet-100 border-violet-400/40'
                            : 'bg-transparent text-white/40 border-white/10 hover:text-white/70 hover:border-white/25'
                        }`}>
                        {byAi && on && <Sparkles className="w-3 h-3 text-fuchsia-300" />}
                        #{t}
                        {reason && <span className="text-[10px] text-white/40">· {reason}</span>}
                      </button>
                      {!saved && (
                        <button onClick={() => void patchTagSet({ add: [t] }, `#${t} 를 자주 쓰는 태그에 저장했어요.`)} disabled={tagSaving}
                          className="p-1 rounded text-white/35 hover:text-violet-200 hover:bg-white/5 disabled:opacity-50" title="자주 쓰는 태그에 저장"
                          aria-label={`${t} 자주 쓰는 태그에 저장`}>
                          <Bookmark className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            ) : setLoaded && (
              <p className="mt-3 text-[11px] text-white/40 break-keep">자주 쓰는 태그를 저장해 두면 새 글마다 켜진 채로 시작해요.</p>
            )}

            {tagEdit && setInvalid.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[11px] text-amber-200/80">지금 규칙에 맞지 않는 태그예요. 빼 주세요.</p>
                <div className="flex gap-1.5 flex-wrap">
                  {setInvalid.map((v) => (
                    <span key={v.raw} title={v.reason}
                      className="text-[11px] pl-2 pr-1 py-1 rounded-lg border border-rose-400/30 bg-rose-500/10 text-rose-100 inline-flex items-center gap-1">
                      {v.raw}
                      <button onClick={() => void patchTagSet({ remove: [v.raw] })} disabled={tagSaving}
                        className="p-0.5 rounded hover:bg-white/10" aria-label={`${v.raw} 빼기`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {setLoaded && setTags.length === 0 && seeds.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-white/45 mb-1.5">지난 글에서 자주 쓴 태그예요. 누르면 자주 쓰는 태그에 저장하고 켜요.</p>
                <div className="flex gap-1.5 flex-wrap">
                  {seeds.map((t) => (
                    <button key={t} disabled={tagSaving}
                      onClick={async () => { if (await patchTagSet({ add: [t] })) setOnTags((prev) => (prev.some((p) => lower(p) === lower(t)) ? prev : [...prev, t])); }}
                      className="text-[11px] px-2 py-1 rounded-lg border border-dashed border-white/20 text-white/60 hover:text-white hover:border-violet-400/40 inline-flex items-center gap-1 disabled:opacity-50">
                      <Plus className="w-3 h-3" /> #{t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. 채널별 글 — 실제로 올라가는 문자열 그대로 */}
      {captions.length > 0 && (
        <div className={`${OUI_CARD} p-4`}>
          {allSame && !mustOpen && !channelsOpen ? (
            <button onClick={() => setChannelsOpen(true)} className="w-full flex items-center gap-2 text-left">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-white/70 flex-1 min-w-0 break-keep">
                {captions.map((c) => `${c.spec.label} ${nameOf(c.account)}`).join(' · ')}
                {captions.length > 1 ? ` ${captions.length}곳 모두 이 글 그대로 올라가요` : '에 이 글 그대로 올라가요'}
              </span>
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-xs text-white/60">채널별로 올라가는 글</span>
                {!mustOpen && (
                  <button onClick={() => setChannelsOpen(false)} className="text-[11px] text-white/40 hover:text-white/70">접기</button>
                )}
              </div>
              {serverMap && (
                <p className="mb-2.5 text-[11px] text-amber-200/80 break-keep">서버가 확정한 글이에요. 이대로 괜찮으면 다시 눌러 주세요.</p>
              )}
              <div className="space-y-2.5">
                {captions.map((c) => (
                  <div key={c.account.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <SnsChannelLogo platform={c.account.platform} size={14} />
                      <span className="text-[11.5px] text-white/75">{c.spec.label}</span>
                      <span className="text-[11px] text-white/40">{nameOf(c.account)}</span>
                      <div className="flex-1" />
                      <span className={`text-[11px] ${c.cap.overBy > 0 ? 'text-rose-300' : 'text-white/40'}`}>
                        {c.cap.length.toLocaleString()} / {c.cap.limit.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-white/80 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{textOf(c) || '(글 없음)'}</p>
                    {c.cap.droppedTags.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-white/45 break-keep">
                        {c.spec.capabilities.tagFirstOnly
                          ? `${c.spec.label}은 태그를 ${c.spec.capabilities.maxTags}개만 태그로 보여 줘요. 빠지는 태그: `
                          : `태그 자리가 모자라 빠지는 태그: `}
                        {c.cap.droppedTags.map((t) => `#${t}`).join(' ')}
                      </p>
                    )}
                    {c.cap.overBy > 0 && (
                      <p className="mt-1 text-[11px] text-rose-300">{c.cap.overBy.toLocaleString()}자 넘어요. 글을 줄여 주세요.</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 5. 실행 */}
      <div className={`${OUI_CARD} p-4`}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-full sm:w-72">
            <DateTimeField value={scheduledAt} onChange={setScheduledAt} clearable title="올릴 시각 선택" />
          </div>
          {scheduledAt && !replacing && (
            <button onClick={() => setScheduledAt('')} className={OUI_BTN_GHOST}>지금 올리기</button>
          )}
          <div className="flex-1" />
          <button onClick={() => void publish()} disabled={busy || !!lockReason || !!aiBusy} className={`${OUI_BTN_PRIMARY} w-full sm:w-auto justify-center`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {publishLabel}
          </button>
        </div>
        {lockReason && hasContent && (
          <p className={`mt-2 text-[11px] break-keep ${scheduleInPast || overChannels.length || placeholderLeft ? 'text-rose-300' : 'text-white/45'}`}>{lockReason}</p>
        )}
        {!scheduledAt && !replacing && (
          <p className="mt-2 text-[11px] text-white/35">시각을 고르지 않으면 누르는 즉시 올라가요.</p>
        )}
      </div>

      <SnsAssetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pickFromLibrary} />
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </section>
  );
}
