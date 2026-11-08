import ZoneFrame from '../components/zone/ZoneFrame';
import { ChevronRight } from 'lucide-react';
import { creditText } from '../constants/credit';
/**
 * ImageStudioPage — P4 AI 이미지 스튜디오 (2026-07-19 v2 · 템플릿 갤러리 재정의)
 *
 * 흐름(Harold 확정): 템플릿(=서버 은닉 프롬프트) 선택 → 원본 이미지 넣기(누끼 자동) → 간단 문구 입력
 *   → 생성 AI가 [제품 + 어울리는 배경 + 지정 문구 타이포]를 한 장의 완성 포스터(3:4)로 렌더 → 결과 카드에서 채널로.
 *  - 문구 = 고객사가 직접 지정한 텍스트만 이미지에 새김(AI 임의 혜택 생성 없음).
 *  - temp 산출물 = fetch+blob 표시(인증 endpoint) · 7일 후 자동 삭제.
 *  - 모델명 UI 노출 금지 / native dialog 금지(useToast · ConfirmModal).
 *
 * ★ 2026-10-16 개편(설계서 docs/2026-10-16-image-studio-picker-channel-design.md)
 *   - 고르기 = 공용 TemplatePicker(DM 삽입 창과 같은 부품) · hidden 감싸개로 숨겨 보던 쪽을 지킨다(언마운트 금지).
 *   - 만들기 = 공용 StudioMake(DM 삽입 창과 같은 부품).
 *   - 결과 카드에서 채널로 바로: 저장(이미 저장됐으면 생략) → 성공했을 때만 편집기로. 저장해도 카드를 지우지 않는다.
 * ★ 2026-11-07 브랜드 로고 층(설계서 docs/2026-11-07-c112-studio-brand-logo-design.md) — 카드 = 바탕 id · 로고 줄 = 공용 StudioLogoControls ·
 *   저장 = 보이는 그대로(확정 설정 layers) · 저장한 카드 그림 = 저장된 소재 주소(실물).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Wand2, Check, Save, ChevronLeft, Sparkles, FolderOpen,
  Layers, Smartphone, Mail, X, type LucideIcon,
} from 'lucide-react';
import { putStudioDraft, studioDraftFromAsset, STUDIO_INAPP_DRAFT_KEY, STUDIO_DM_DRAFT_KEY, STUDIO_EMAIL_DRAFT_KEY, type StudioDraft } from '../lib/studio-draft';
import type { StudioTexts } from '../lib/studio-texts';
import { useToast } from '../components/ToastProvider';
import { useAuthStore } from '../stores/authStore';
import AssetLibraryPickerModal from '../components/assets/AssetLibraryPickerModal';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import TemplatePicker, { type StudioTemplatePublic } from '../components/studio/TemplatePicker';
import { useStudioMake, StudioMakeFields, TemplateExampleCard } from '../components/studio/StudioMake';
import StudioUsePicker, { STUDIO_USES, studioUseOfPreset, type StudioUsePick, type StudioUseKey } from '../components/studio/StudioUsePicker';   // ★ C118 A1 용도 고르기
import StudioWatermark from '../components/studio/StudioWatermark';
import StudioLogoControls from '../components/studio/StudioLogoControls';
import { layersForSave, logoSettingsOf, LOGO_LIMIT_TEXT, type LogoCandidate, type LogoCardState, type LogoSettings } from '../lib/studio-layers';
import { saveStudioTemp, studioPost, newStudioAttempt, type SavedStudioAsset } from '../lib/studio-api';

const token = () => localStorage.getItem('token');
const authFetch = (url: string, opts: RequestInit = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` } });

interface Candidate extends LogoCardState {
  tempId: string; url: string; blob: string | null; presetKey: string; title?: string;
  /** ★ C114 D8 할인 포스터 = 「포스터에 들어간 숫자」(서버가 보낸 값 그대로) */
  discountCheck?: string | null;
  /** ★ 2026-11-05 인앱 포스터 재구성 §3-8 — 생성에 쓴 글(인앱 통짜 장 글로 넘긴다) */
  texts?: StudioTexts;
  /** ★ 2026-10-16 저장되면 카드에 남는다 · 채널 버튼은 이 주소로 바로 간다(다시 저장하지 않는다 · 두 번째 저장 = 409) */
  saved?: SavedStudioAsset;
  /** 저장 실패 표시 — storage_full = 정리 뒤 다시 저장 가능 · expired = 임시 그림 기간 만료 */
  note?: 'storage_full' | 'expired';
}
type LibAsset = { id: string; url: string; filename: string | null; bytes: number; channelSpec?: string | null };

// ★ 2026-07-30 채널 축 폐기(Harold) — 생성 = 'poster' 단일(3:4·채널 무관·2크레딧). 완성 포스터는 인앱/DM/이메일 어디든 통짜 삽입.
// ★ MMS 전용 생성 없음(Harold 확정 2026-07-19) — 항상 고품질 생성·저장, MMS는 발송 시 라이브러리 소재 자동 변환.
const GENERATE_PRESET_KEY = 'poster';
const presetLabel = (key: string) =>
  studioUseOfPreset(key)?.label || (key === 'inapp-poster' ? '인앱 포스터' : key === 'dm-card' ? '모바일 DM' : key === 'email-hero' ? '이메일 히어로' : key);
// 소재 channel_spec → 짧은 한글 라벨(용도 배지·캡션). 백엔드 channelLabelKo 미러.
const specKo = (s?: string | null) => (s === 'poster' ? '포스터' : s === 'inapp-poster' ? '인앱' : s === 'dm' ? 'DM' : s === 'email' ? '이메일' : s === 'mms' ? 'MMS' : s === 'free' ? '자유' : '소재');

// ★ 2026-10-16 채널 버튼 목록 하나 — 발사대 창과 결과 카드가 같은 목록을 그린다.
//   인앱메시지 = 회사 관리자 전용(공유 화면 · LESSONS_FRONTEND 2026-07-21 역할 게이트). 판정은 ChannelButtons 한 곳.
interface StudioChannel { key: 'inapp' | 'dm' | 'email'; label: string; draftKey: string; path: string; adminOnly?: boolean; icon: LucideIcon; box: string; iconColor: string }
const STUDIO_CHANNELS: StudioChannel[] = [
  { key: 'inapp', label: '인앱메시지 만들기', draftKey: STUDIO_INAPP_DRAFT_KEY, path: '/inapp-messages', adminOnly: true, icon: Layers, box: 'border-rose-300 bg-rose-50 hover:bg-rose-100', iconColor: 'text-rose-700' },
  { key: 'dm', label: '모바일 DM 만들기', draftKey: STUDIO_DM_DRAFT_KEY, path: '/dm-builder', icon: Smartphone, box: 'border-amber-300 bg-amber-50 hover:bg-amber-100', iconColor: 'text-amber-700' },
  { key: 'email', label: '이메일 만들기', draftKey: STUDIO_EMAIL_DRAFT_KEY, path: '/email-campaigns', icon: Mail, box: 'border-cyan-300 bg-cyan-50 hover:bg-cyan-100', iconColor: 'text-cyan-700' },
];
function ChannelButtons({ isAdmin, disabled, onPick, only = null }: { isAdmin: boolean; disabled?: boolean; onPick: (ch: StudioChannel) => void; only?: StudioChannel['key'] | null }) {
  // ★ C118 A2 용도로 만든 그림 = 그 용도 채널 하나(자유 형태 = 셋)
  return (
    <>
      {STUDIO_CHANNELS.filter((ch) => (!ch.adminOnly || isAdmin) && (!only || ch.key === only)).map((ch) => (
        <button key={ch.key} type="button" onClick={() => onPick(ch)} disabled={disabled} className={`flex items-center gap-2 px-3.5 py-3 rounded-xl border ${ch.box} text-xs font-semibold text-slate-800 transition disabled:opacity-40`}>
          <ch.icon className={`w-4 h-4 ${ch.iconColor}`} /> {ch.label}
        </button>
      ))}
    </>
  );
}

type Stage = 'gallery' | 'setup' | 'result';

export default function ImageStudioPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const authUser = useAuthStore((s) => s.user);
  // ★ 인앱메시지 = 회사 관리자 전용(공유 화면). 사용자에겐 채널 버튼에서 인앱을 숨김.
  const isCompanyAdmin = authUser?.userType === 'company_admin' || authUser?.userType === 'super_admin';

  const [ready, setReady] = useState(true);
  const [stage, setStage] = useState<Stage>('gallery');
  const [busyMsg, setBusyMsg] = useState('');
  const [template, setTemplate] = useState<StudioTemplatePublic | null>(null);
  const make = useStudioMake(template);
  // ★ 2026-10-31 포스터를 만든 뒤 템플릿을 다시 고르면 새 제작 = 입력 칸을 처음으로(Harold 「이미 제작할 때 넣었던 것들이 그대로 있어」 · 결과의 「문구·상품 수정」은 그대로 둔다)
  const madeRef = useRef(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // 내 라이브러리(저장 소재) — 갤러리 첫 화면 폴더. 소재 클릭 = 채널 발사대(인앱/DM/이메일).
  const [assetAction, setAssetAction] = useState<LibAsset | null>(null);
  const [libManageOpen, setLibManageOpen] = useState(false); // 전체 보기·관리(검색·삭제) — 픽커 재사용
  const [libAssets, setLibAssets] = useState<LibAsset[]>([]);
  const [libUsage, setLibUsage] = useState<{ usedBytes: number; limitBytes: number } | null>(null);
  /** ★ 2026-10-26 S16 — 라이브러리 조회 실패 = 「소재 없음」이 아니다(다시 불러오기 줄) */
  const [libFailed, setLibFailed] = useState(false);
  const loadLibrary = useCallback(async () => {
    try {
      const r = await authFetch('/api/assets');
      const d = await r.json().catch(() => null);
      setLibFailed(!(r.ok && d?.success));
      if (r.ok && d?.success) {
        setLibAssets(Array.isArray(d.assets) ? d.assets.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename, bytes: a.bytes, channelSpec: a.channel_spec ?? null })) : []);
        setLibUsage(d.usage || null);
      }
    } catch { setLibFailed(true); }
  }, []);

  // 결과
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const objectUrls = useRef<string[]>([]);
  const loadBlob = useCallback(async (url: string): Promise<string> => {
    const r = await authFetch(url);
    // ★ Codex E4 — 오류 응답 본문을 그림처럼 띄우지 않는다(띄우면 결과를 놓은 것으로 보고 시도 표를 버려 같은 수정이 다시 걷혔다)
    if (!r.ok) throw new Error('결과 그림을 불러오지 못했어요. 같은 지시로 다시 눌러 주세요(다시 걷지 않아요).');
    const b = await r.blob();
    if (!String(b.type || '').startsWith('image/')) throw new Error('결과 그림을 불러오지 못했어요. 같은 지시로 다시 눌러 주세요(다시 걷지 않아요).');
    const u = URL.createObjectURL(b);
    objectUrls.current.push(u);
    return u;
  }, []);

  useEffect(() => {
    authFetch('/api/image-studio/status').then((r) => r.json()).then((d) => setReady(!!d?.ready)).catch(() => setReady(true));
    loadLibrary();
    return () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 완성 포스터 생성 — ★ 2026-11-08 C118 A1 · A2 「만들기」 = 용도 고르기 → 고른 용도마다 칸(얼린 본문 + 표) → 차례로 ──
  const [usePickerOpen, setUsePickerOpen] = useState(false);
  type UseSlot = { use: StudioUseKey; presetKey: string; label: string; poster: string; body: Record<string, unknown>; token: string };
  const [failedSlots, setFailedSlots] = useState<UseSlot[]>([]);
  const generate = async () => {
    if (!template) { toast.error('템플릿을 먼저 골라주세요'); return; }
    if (!ready) { toast.error('이미지 스튜디오가 준비 중입니다'); return; }
    setUsePickerOpen(true);
  };
  const runSlot = async (slot: UseSlot, i: number, n: number): Promise<boolean> => {
    // ★ C118 E1 안내 = 줄 나눔(여러 장 = 「N장 중 i번째」 · 굵은 줄 = 포스터 이름 · 작은 줄 = 걸리는 시간) · 만드는 중 카드가 줄마다 그린다
    const r = await make.runGenerateBody(slot.body, slot.token, false, `${n > 1 ? `${n}장 중 ${i + 1}번째` : ''}\n${slot.poster}를 만들고 있어요\n약 20~30초 걸려요`);
    if (!r) return false;
    if (r.preview) objectUrls.current.push(r.preview);
    madeRef.current = true;
    setCandidates((prev) => [{ tempId: r.tempId, url: r.url, blob: r.preview, presetKey: slot.presetKey, title: r.title, texts: r.texts, logo: r.logo, layered: r.layered, logoFailed: r.logoFailed, discountCheck: r.discountCheck ?? null }, ...prev]);
    return true;
  };
  const runUses = async (pick: StudioUsePick) => {
    setUsePickerOpen(false);
    const slots: UseSlot[] = [];
    for (const key of pick.uses) {
      const u = STUDIO_USES.find((x) => x.key === key);
      if (!u) continue;
      const body = make.buildGenerateBody({ presetKey: u.presetKey, textPosition: u.key === 'inapp' ? pick.zone : null });
      if (!body) return;
      slots.push({ use: u.key, presetKey: u.presetKey, label: u.label, poster: u.poster, body, token: newStudioAttempt() });
    }
    const failed: UseSlot[] = [];
    for (let i = 0; i < slots.length; i++) {
      if (!(await runSlot(slots[i], i, slots.length))) failed.push(slots[i]);
    }
    setFailedSlots((prev) => [...failed, ...prev]);
    if (slots.length > 0) setStage('result');
  };
  // 실패 · 응답 유실 칸 = 같은 표 + 같은 얼린 본문(입력을 바꿨어도 · 한 번만 걷힘)
  const retrySlot = async (slot: UseSlot) => {
    if (await runSlot(slot, 0, 1)) setFailedSlots((prev) => prev.filter((x) => x !== slot));
  };
  void GENERATE_PRESET_KEY;

  // ── AI 수정 ──────────────────────────
  // ★ 2026-09-30 4K 격상 제거(Harold 확정) — 생성 모델이 "같은 그림 4K"를 새로 그려 원본과 다른 포스터가 나왔다(운영 실측 3584×4800 · 구도·색 변경).
  //   모든 채널이 2048px 원본으로 충분하다(MMS 는 저장 때 1080px). 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4
  // ★ 2026-10-19 B-1016-3② 결과를 못 받은 수정은 같은 표로 다시(같은 그림 · 같은 지시일 때만 서버가 같은 시도로 본다)
  const editAttemptRef = useRef<string | null>(null);
  const editPoster = async (c: Candidate, instruction: string) => {
    setBusyMsg('AI가 포스터를 수정하는 중...');
    try {
      if (!editAttemptRef.current) editAttemptRef.current = newStudioAttempt();
      const { status, ok, data } = await studioPost('/api/image-studio/edit', { tempId: c.tempId, instruction, attemptToken: editAttemptRef.current });
      if (status === 402) { toast.error('크레딧이 부족합니다'); return; }
      if (!ok || !data.image?.tempId) throw new Error(data?.error || '수정에 실패했어요');
      const blob = await loadBlob(data.image.url);
      // ★ 2026-11-07 새 바탕에 그 카드의 확정 설정 그대로 로고(D10 · 실패 = 바탕 + 다시 얹기)
      const lay = await make.relayer(data.image.tempId, logoSettingsOf(c.logo), false);
      const logoState: LogoCardState = lay || { logo: null, layered: null, logoFailed: true };
      setCandidates((prev) => [{ tempId: data.image.tempId, url: data.image.url, blob, presetKey: c.presetKey, title: c.title, texts: c.texts, ...logoState }, ...prev]);
      // 결과를 화면에 놓은 뒤에만 표를 버린다(Codex E3 — 미리보기를 못 받으면 표를 남겨 같은 지시 재시도가 기억 결과를 받는다 · 다시 걷지 않는다)
      editAttemptRef.current = null;
      toast.success('수정 완료');
      setEditFor(null); setEditText('');
    } catch (e: any) {
      toast.error(e?.message || '수정에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 저장 (공용 saveStudioTemp · 저장 공간 가득 / 이미 저장됨을 DM 삽입 창과 같은 방식으로 가른다) ──
  //   ★ 2026-10-16 저장해도 카드를 지우지 않는다(옛: 지워서 채널로 갈 재료가 사라졌다). 저장된 카드는 AI 수정을 숨긴다(저장이 임시 그림을 소비해 /edit 404).
  const saveCandidate = async (c: Candidate): Promise<SavedStudioAsset | null> => {
    if (c.saved) return c.saved;
    const r = await saveStudioTemp(c.tempId, c.title, layersForSave(c.logo, c.logoFailed, false));
    if (r.ok) {
      setCandidates((prev) => prev.map((x) => (x.tempId === c.tempId ? { ...x, saved: r.asset, note: undefined } : x)));
      setEditFor((cur) => (cur === c.tempId ? null : cur));
      return r.asset;
    }
    const note = r.code === 'STORAGE_FULL' ? 'storage_full' : r.code === 'EXPIRED' ? 'expired' : undefined;
    if (note) setCandidates((prev) => prev.map((x) => (x.tempId === c.tempId ? { ...x, note } : x)));
    toast.error(r.error);
    // 키트 로고가 바뀜 · 못 쓰게 됨 = 미리보기를 다시 받는다(자리 그대로 · 크기는 새 로고 기준 자동) · 보이는 그대로 다시 저장
    if (r.code === 'LOGO_CHANGED') await applyLogo(c, { ...logoSettingsOf(c.logo), size: null });
    return null;
  };

  // ── 로고 줄(★ 2026-11-07 · 0크레딧 · 응답의 확정 설정이 카드 표시값) ──
  const patchLogo = (tempId: string, st: LogoCardState) => setCandidates((prev) => prev.map((x) => (x.tempId === tempId ? { ...x, ...st } : x)));
  const applyLogo = async (c: Candidate, s: LogoSettings) => {
    const st = await make.relayer(c.tempId, s, false);
    if (st) patchLogo(c.tempId, st);
  };
  const saveLogoFor = async (c: Candidate, lc: LogoCandidate) => {
    const st = await make.saveFoundLogo(lc, c.tempId, false);
    if (st) patchLogo(c.tempId, st);
  };

  const saveOnly = async (c: Candidate) => {
    setBusyMsg('라이브러리에 저장 중...');
    try {
      if (await saveCandidate(c)) {
        toast.success('라이브러리에 저장했어요. 위 버튼으로 바로 채널에 쓸 수 있어요');
        loadLibrary();
      }
    } finally {
      setBusyMsg('');
    }
  };

  // ── 채널로 보내기 — 편집기가 초안을 1회 꺼내 쓴다(studio-draft · 맨 주소 = 딥링크면 받는 쪽이 초안을 건너뛴다) ──
  // ★ 2026-11-05 §3-8 — 새 결과 카드 = 생성에 쓴 글 · 그림에 글이 든 판(인앱 = 통짜) · 라이브러리 소재 = 소재 용도로 판정
  const launch = (ch: StudioChannel, draft: StudioDraft) => {
    putStudioDraft(ch.draftKey, draft);
    navigate(ch.path);
  };
  // 누른 카드를 먼저 저장 → 나머지를 차례로(병렬 금지 · 서버 용량 판정에 잠금이 없다) → 첫 실패에서 멈추고 이동하지 않는다.
  const saveAndGo = async (c: Candidate, ch: StudioChannel, others: Candidate[]) => {
    setBusyMsg('라이브러리에 저장 중...');
    try {
      const asset = await saveCandidate(c);
      if (!asset) return;
      for (const o of others) {
        if (!(await saveCandidate(o))) return;
      }
      launch(ch, { imageUrl: asset.url, name: c.title || null, texts: c.texts || null, textInImage: true });
    } finally {
      setBusyMsg('');
    }
  };
  // 확인 단계는 한 곳: 저장 안 한 다른 포스터가 있을 때만(이 화면을 떠나면 다시 볼 수 없다 · 되돌릴 수 없는 일).
  const goChannel = (c: Candidate, ch: StudioChannel) => {
    const others = candidates.filter((x) => x.tempId !== c.tempId && !x.saved && x.note !== 'expired');
    if (!others.length) { void saveAndGo(c, ch, []); return; }
    setConfirm({
      mode: 'warning',
      title: '저장하지 않은 포스터가 있어요',
      description: `저장하지 않은 포스터 ${others.length}장은 이 화면을 떠나면 다시 볼 수 없어요.`,
      confirmLabel: '모두 저장하고 이동',
      onConfirm: () => saveAndGo(c, ch, others),
      altLabel: '이것만 저장하고 이동',
      onAlt: () => saveAndGo(c, ch, []),
      cancelLabel: '머무르기',
    });
  };

  // ★ 2026-07-21 다운로드 제거(전 직원 요청 — 악용 소지). 소재는 한줄로 채널/발송으로만 활용, 파일 반출 차단.
  //   화면 표시본엔 워터마크 오버레이(스크린샷 유출 억제), 발송물은 원본 유지.

  const busy = !!busyMsg || !!make.busyMsg;
  const overlayMsg = busyMsg || make.busyMsg;
  const overlayLines = (() => {
    const ls = String(overlayMsg || '').split('\n');
    if (ls.length === 1) return { step: '', title: ls[0], notes: [] as string[] };
    return { step: ls[0], title: ls[1] || '', notes: ls.slice(2).filter(Boolean) };
  })();

  // 0단계 — 내 라이브러리 폴더(저장 소재 띠) · 고르기 첫 화면에만(TemplatePicker rootExtra)
  const libraryStrip = libFailed && libAssets.length === 0 ? (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-slate-700 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-violet-700" /> 내 라이브러리를 불러오지 못했어요</p>
      <button onClick={() => void loadLibrary()} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100">다시 불러오기</button>
    </section>
  ) : libAssets.length > 0 ? (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-violet-700" /> 내 라이브러리
          <span className="text-[11px] text-slate-400 font-normal">
            {libAssets.length}개{libUsage ? ` · 저장 공간 ${(libUsage.usedBytes / 1048576).toFixed(1)}MB / ${(libUsage.limitBytes / 1073741824).toFixed(1)}GB` : ''}
          </span>
        </h2>
        <button onClick={() => setLibManageOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100">
          전체 보기·관리
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {libAssets.slice(0, 14).map((a) => (
          <button key={a.id} onClick={() => setAssetAction(a)} className="shrink-0 w-20 text-left group" title={a.filename || ''}>
            <div className="relative rounded-lg overflow-hidden border border-slate-200 group-hover:border-violet-300 transition">
              <img src={a.url} alt={a.filename || ''} loading="lazy" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-20 h-20 object-cover" />
              {a.channelSpec && <span className="absolute top-1 left-1 text-[8px] px-1 py-px rounded bg-black/65 text-white/85 font-semibold">{specKo(a.channelSpec)}</span>}
            </div>
            {a.filename && <div className="mt-0.5 text-[9px] text-slate-400 truncate">{a.filename.replace(/\.[^.]+$/, '')}</div>}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 italic mt-2">소재를 클릭하면 인앱·DM·이메일로 바로 만들거나 MMS로 변환할 수 있어요.</p>
    </section>
  ) : null;

  const studioSteps: Array<[Stage, string]> = [['gallery', '템플릿'], ['setup', '문구·상품'], ['result', '완성 포스터']];
  return (
    <ZoneFrame
      moduleId="image-studio"
      command={{
        lead: (
          <span className="inline-flex items-center gap-1.5 text-[12.5px]">
            {studioSteps.map(([k, label], i) => (
              <span key={k} className={`inline-flex items-center gap-1 ${stage === k ? 'text-slate-900 font-semibold' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full text-[11px] font-bold inline-flex items-center justify-center ${stage === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                {label}
                {i < studioSteps.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
              </span>
            ))}
          </span>
        ),
        facts: [{ label: '저장 소재', value: `${libAssets.length}개` }],
        actions: stage !== 'gallery'
          ? [{ label: '템플릿으로', icon: ChevronLeft, onClick: () => setStage('gallery') }, { label: '저장 소재 관리', icon: FolderOpen, onClick: () => setLibManageOpen(true) }]
          : [{ label: '저장 소재 관리', icon: FolderOpen, onClick: () => setLibManageOpen(true) }],
      }}
      blocks={!ready ? [{ text: '이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.' }] : []}
      commitBar={stage === 'setup' && template ? (
        <>
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
            <b className="text-[13px] text-slate-900 truncate max-w-[16rem]">{template.name}</b>
            <span className="tabular-nums">상품 {make.items.length}/3</span>
            {make.discountBuild && (make.discountBuild.ok
              ? <span className="text-rose-700 font-semibold break-keep">{make.discountBuild.line}</span>
              : <span className="text-slate-400 break-keep">{make.discountBuild.error}</span>)}
            <span className="text-slate-400">{creditText('image-studio-generate')}, 성공했을 때만 차감</span>
          </div>
          <button onClick={() => generate()} disabled={busy || !ready || (!!make.discountBuild && !make.discountBuild.ok)} className="shrink-0 text-white inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 text-sm font-bold disabled:opacity-40">
            <Sparkles className="w-4 h-4" /> 완성 포스터 만들기
          </button>
        </>
      ) : undefined}
    >
      <div className="space-y-6">
        {/* 1단계 — 템플릿 고르기. ⛔ 언마운트하지 않고 숨긴다(보던 쪽 유지 · 감싸개에 display 클래스 금지). */}
        <div hidden={stage !== 'gallery'}>
          <TemplatePicker onPick={(t) => { if (busy) return; if (madeRef.current) { make.restart(t); madeRef.current = false; } setTemplate(t); setStage('setup'); }} rootExtra={libraryStrip} />
        </div>

        {/* 2단계 — 상품 + 문구 (공용 StudioMake · DM 삽입 창과 같은 부품) */}
        {stage === 'setup' && template && (
          <section className="grid grid-cols-1 lg:grid-cols-9 gap-5">
            {/* 좌: 예시 프리뷰(깨끗한 대형 이미지 하나) — 상품·문구·힌트는 전부 우측이 든다 */}
            <div className="lg:col-span-3 space-y-4">
              <TemplateExampleCard template={template} />
            </div>
            <div className="lg:col-span-6 space-y-4">
              <StudioMakeFields make={make} disabled={busy} />
            </div>
          </section>
        )}

        {/* 3단계 — 결과 · 카드에서 채널로 바로 */}
        {stage === 'result' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800 mr-2">완성 포스터</h2>
              <span className="text-[11px] text-slate-400 mr-1">채널 버튼을 누르면 라이브러리에 저장하고 바로 그 편집기가 열려요. MMS는 발송 화면에서 첨부할 때 자동 변환돼요.</span>
              <button onClick={() => setStage('setup')} className="ml-auto text-xs text-slate-400 hover:text-slate-600">문구·상품 수정</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* ★ C118 A2 만들지 못한 용도 = 그 칸만 다시(같은 표 · 같은 본문) */}
              {failedSlots.map((slot) => (
                <div key={slot.token} className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex flex-col gap-2">
                  <b className="text-[13px] text-rose-900 break-keep">{slot.poster}를 만들지 못했어요</b>
                  <p className="text-[12px] text-rose-800 break-keep">크레딧은 만든 그림에만 차감돼요. 같은 내용으로 다시 만들 수 있어요.</p>
                  <button type="button" onClick={() => void retrySlot(slot)} disabled={busy} className="self-start h-9 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold disabled:opacity-40">다시 만들기</button>
                </div>
              ))}
              {candidates.map((c) => {
                // 저장한 카드 = 저장된 소재(실물) · 그 전 = 로고 미리보기 · 없으면 바탕
                const shown = c.saved?.url || c.layered || c.blob;
                return (
                <div key={c.tempId} className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-100">
                  <div className="relative">
                    {shown
                      ? <img src={shown} alt="완성 포스터" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-full object-contain max-h-[480px] bg-slate-100" />
                      : <div className="h-64 flex items-center justify-center px-6 text-center text-[12px] text-slate-500">미리보기를 불러오지 못했어요. 저장하면 라이브러리에서 볼 수 있어요.</div>}
                    {shown && <StudioWatermark />}
                    <span className="absolute top-2 left-2 z-20 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-black/70 text-white border border-white/20">{presetLabel(c.presetKey)}{studioUseOfPreset(c.presetKey) ? ` · ${studioUseOfPreset(c.presetKey)!.size}` : ''}</span>
                  </div>
                  <div className="p-3 space-y-2 bg-white">
                    {c.discountCheck && (
                      <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800 break-keep">포스터에 들어간 숫자: <b className="font-bold">{c.discountCheck}</b>. 그림 속 숫자가 같은지 꼭 확인해 주세요.</p>
                    )}
                    {c.note === 'expired' ? (
                      <p className="text-[12px] text-rose-700">기간이 지나 저장할 수 없어요. 다시 만들어 주세요.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <ChannelButtons isAdmin={isCompanyAdmin} disabled={busy} onPick={(ch) => goChannel(c, ch)}
                          only={(() => { const k = studioUseOfPreset(c.presetKey)?.key; return k === 'inapp' || k === 'dm' || k === 'email' ? k : null; })()} />
                      </div>
                    )}
                    {c.note === 'storage_full' && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-800 flex items-center gap-2 flex-wrap">
                        <span className="flex-1 min-w-[10rem]">저장 공간이 가득 찼어요. 안 쓰는 소재를 정리한 뒤 다시 눌러 주세요.</span>
                        <button type="button" onClick={() => setLibManageOpen(true)} className="px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-800 font-semibold hover:bg-rose-100">저장 소재 정리</button>
                      </div>
                    )}
                    {c.note !== 'expired' && (
                      <StudioLogoControls logo={c.logo} failed={c.logoFailed} saved={!!c.saved} disabled={busy} onChange={(s) => void applyLogo(c, s)} onFind={make.findLogo} onUse={(lc) => void saveLogoFor(c, lc)} />
                    )}
                    {c.note !== 'expired' && (
                      <div className="flex flex-wrap gap-2">
                        {c.saved ? (
                          <span className="flex-1 min-w-[8rem] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800">
                            <Check className="w-3.5 h-3.5" /> 라이브러리에 저장됨
                          </span>
                        ) : (
                          <>
                            <button onClick={() => saveOnly(c)} disabled={busy} className="flex-1 min-w-[8rem] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                              <Save className="w-3.5 h-3.5" /> 라이브러리에 저장
                            </button>
                            <button onClick={() => { setEditFor(editFor === c.tempId ? null : c.tempId); setEditText(''); }} disabled={busy} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                              <Wand2 className="w-3.5 h-3.5" /> AI 수정 <span className="text-slate-400">1</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {editFor === c.tempId && !c.saved && (
                      <div className="flex gap-2">
                        <input value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="배경·무드를 어떻게 바꿀까요? (예: 더 밝고 화사하게)" className="flex-1 px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300"
                          onKeyDown={(e) => { if (e.key === 'Enter' && editText.trim()) editPoster(c, editText.trim()); }} />
                        <button onClick={() => editText.trim() && editPoster(c, editText.trim())} disabled={busy || !editText.trim()} className="px-3 py-2 rounded-lg bg-violet-200 text-xs font-semibold hover:bg-violet-500 disabled:opacity-40">적용</button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            <p className="text-[12px] text-slate-500">{LOGO_LIMIT_TEXT}</p>
            <p className="text-[10px] text-slate-400 italic">생성 약 30초 · 저장하지 않은 결과는 이 화면을 떠나면 볼 수 없어요(7일 뒤 자동 삭제) · MMS는 발송 시 첨부 창에서 자동 변환</p>
          </section>
        )}
      </div>

      {/* 라이브러리 소재 발사대 모달 — 완성 포스터는 어느 채널이든 그대로(전체) 사용. 변환·크롭·추가과금 없음. */}
      {assetAction && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-bold">이 소재로 바로 만들기</h3>
              <button onClick={() => setAssetAction(null)} className="text-slate-400 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-100" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col md:flex-row">
              {/* 좌 — 이미지 크게·선명 + 워터마크 */}
              <div className="md:w-[58%] bg-slate-100 p-4 flex items-center justify-center">
                <div className="relative w-full max-h-[64vh] flex items-center justify-center">
                  <img src={assetAction.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} className="max-w-full max-h-[64vh] object-contain rounded-lg" />
                  <StudioWatermark />
                </div>
              </div>
              {/* 우 — 채널 메뉴 (전 채널 그대로 사용 · 변환 없음) */}
              <div className="md:w-[42%] p-5 flex flex-col gap-2.5 border-t md:border-t-0 md:border-l border-slate-200">
                <div className="text-[11px] text-slate-400 mb-1">
                  {assetAction.filename && <div className="text-slate-600 font-medium break-all leading-snug">{assetAction.filename.replace(/\.[^.]+$/, '')}</div>}
                  <div className="mt-2 text-slate-400 leading-relaxed">이 포스터는 문구·상품이 이미 들어가 있어, 어느 채널이든 <b className="text-slate-500 font-semibold">전체가 그대로</b> 쓰여요. 잘림·추가 비용 없음.</div>
                </div>
                <ChannelButtons isAdmin={isCompanyAdmin} onPick={(ch) => launch(ch, studioDraftFromAsset(assetAction))} />
                <div className="mt-1 text-[10px] text-slate-400 leading-relaxed">MMS로 보낼 때는 발송 화면의 ‘라이브러리에서 가져오기’로 첨부하면 자동으로 규격(≤300KB)에 맞춰져요. 특정 채널 전용 비율이 필요하면 스튜디오에서 그 비율로 새로 만들면 돼요.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 처리 오버레이 */}
      {busy && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-slate-900/60 px-4" role="status" aria-live="polite">
          {/* ★ C118 A5 = 흰 카드 위 진한 글씨(옛 = 어두운 흐림 위 회색 글씨 · 안 보였다) */}
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl px-6 py-6 text-center">
            <Loader2 className="w-9 h-9 animate-spin text-violet-700 mx-auto mb-3" />
            {/* ★ C118 E1 줄 = [위 작은 줄(여러 장)] · 굵은 줄 · 작은 줄들 · 한 줄 메시지 = 굵은 줄 하나(지금 그대로) */}
            {overlayLines.step && <p className="text-[12.5px] font-semibold text-violet-700 mb-1">{overlayLines.step}</p>}
            <p className="text-[15px] font-bold text-slate-900 break-keep">{overlayLines.title}</p>
            {overlayLines.notes.map((t) => <p key={t} className="text-[13px] text-slate-600 mt-1.5 break-keep">{t}</p>)}
            <p className="text-[13px] text-slate-600 mt-1.5">창을 닫지 마세요</p>
          </div>
        </div>
      )}

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <StudioUsePicker open={usePickerOpen} isAdmin={isCompanyAdmin} zoneLocked={!!make.discountKind} onClose={() => setUsePickerOpen(false)} onConfirm={(p) => void runUses(p)} />

      {/* 라이브러리 전체 보기·관리 — 검색·삭제(픽커 재사용), 소재 클릭 = 발사대 모달 */}
      <AssetLibraryPickerModal
        open={libManageOpen}
        onClose={() => { setLibManageOpen(false); loadLibrary(); }}
        onPick={(a) => setAssetAction({ id: a.id, url: a.url, filename: a.filename, bytes: a.bytes, channelSpec: (a as any).channel_spec ?? (a as any).channelSpec ?? null })}
      />
    </ZoneFrame>
  );
}
