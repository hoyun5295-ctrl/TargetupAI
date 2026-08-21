/**
 * EventCampaignModal — 행사 캠페인 자동 생성 (2026-07-07(4) · 2026-07-08 이미지 판독 + 초안 DB 보관)
 *
 * 행사 내용 한 번 입력(텍스트 또는 이미지) → 모바일DM / 이메일 / 인앱 중 "선택한 채널만" AI 초안 생성.
 * - 이미지 판독(2026-07-08): 스샷을 올리면 vision AI가 "보이는 것만 그대로 전사"해 행사 내용 텍스트를 채움(수정 가능).
 *   전사 텍스트가 곧 원문 → 혜택·가격 날조 방지 검증(event-brief) 그대로 작동 + 사용자 눈 확인 이중.
 * - 무조건 3채널 생성 없음: 채널 슬롯별 예상 크레딧 표시 + 선택분만 생성·과금 (크레딧 낭비 차단)
 * - 인앱 표시 불가 회사(네이버 단독 등) = 인앱 슬롯 잠금 (기존 display-eligibility 게이트 재사용)
 * - 생성 초안 소멸 방지(2026-07-08): 3채널 생성 세트를 계정 DB(event_campaign_drafts)에 보관.
 *   편집 열기를 눌러도 세트 유지 → 재개(resumeDraftId)로 나머지 채널을 하나씩 이어서 편집.
 * - 편집 진입 = 각 채널 기존 편집기 그대로 (sessionStorage 초안 handoff, 30분 TTL)
 * - 혜택 영구 룰 양립: 행사 원문에 기재된 혜택만 원문 그대로 (백엔드 event-brief CT 검증)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, FolderOpen, ImagePlus, Layers, Loader2, Lock, Mail, Smartphone, Sparkles, X } from 'lucide-react';
import { CONFIRM_CREDIT_COSTS } from '../constants/credit';
import { downscaleToJpeg } from '../utils/image-downscale';
import AssetLibraryPickerModal from './assets/AssetLibraryPickerModal';
import { assetsToFiles } from '../lib/asset-to-file';
import { useAuthStore } from '../stores/authStore';

type ChannelKey = 'dm' | 'email' | 'inapp';
type ChannelStatus = 'generated' | 'opened';

// 백엔드 ai-credit-calc CREDIT_COST_MAP 1:1 (dm-ai-generate 5 / email-ai-generate 3 / inapp-ai-generator 3)
const CH_COSTS: Record<ChannelKey, number> = {
  dm: CONFIRM_CREDIT_COSTS['dm-ai-generate'] ?? 5,
  email: CONFIRM_CREDIT_COSTS['email-ai-generate'] ?? 3,
  inapp: CONFIRM_CREDIT_COSTS['inapp-ai-generator'] ?? 3,
};

// 이미지 판독 크레딧 (백엔드 CREDIT_COST_MAP 'event-image-extract' 3과 1:1)
const IMAGE_EXTRACT_COST = 3;
const MAX_IMAGES = 5;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const DRAFT_TTL_MS = 30 * 60 * 1000;
export const EVENT_DM_DRAFT_KEY = 'hj_event_dm_draft';
export const EVENT_EMAIL_DRAFT_KEY = 'hj_event_email_draft';
export const EVENT_INAPP_DRAFT_KEY = 'hj_event_inapp_pkg';

/** 수신 페이지 공용 — 신선한(30분 안) 초안만 꺼내고 즉시 제거 */
export function takeEventDraft<T = any>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const d = JSON.parse(raw);
    if (!d || Date.now() - (d.ts || 0) > DRAFT_TTL_MS) return null;
    return d as T;
  } catch {
    return null;
  }
}

interface ChannelMeta {
  key: ChannelKey;
  label: string;
  desc: string;
  icon: any;
}

// ★ 2026-08-08 export — 임시 보관 목록(EventCampaignResumeBar)이 같은 라벨을 쓴다.
//   별도 라벨 표를 만들면 그것이 또 하나의 죽은 사본이 된다(발송 사전 라벨 단일소스 규약과 같은 이유).
export const CHANNELS: ChannelMeta[] = [
  { key: 'dm', label: '모바일 DM', desc: '카드형 미디어 페이지 + 문자 발송', icon: Smartphone },
  { key: 'email', label: '이메일', desc: '비주얼 블록 이메일', icon: Mail },
  { key: 'inapp', label: '인앱 메시지', desc: '자사몰 팝업·슬라이드', icon: Layers },
];

export default function EventCampaignModal({ open, onClose, initialText, resumeDraftId }: {
  open: boolean;
  onClose: () => void;
  initialText?: string;
  /** 지정 시 = 임시 보관한 행사 세트 재개(초안 복원). 미지정 = 새 행사. */
  resumeDraftId?: string;
}) {
  const navigate = useNavigate();
  // ★ 2026-07-21 채널 접근 정책(Harold 확정): 이메일=담당자 개방 / 인앱=회사 관리자 전용(공유 화면). 백엔드 게이트와 정합.
  const isCompanyAdmin = useAuthStore((s) => s.user?.userType === 'company_admin' || s.user?.userType === 'super_admin');
  const emailBlock = null; // 이메일은 담당자도 생성 가능
  const [text, setText] = useState('');
  const [sel, setSel] = useState<Record<ChannelKey, boolean>>({ dm: true, email: true, inapp: isCompanyAdmin });
  const [inappBlock, setInappBlock] = useState<string | null>(isCompanyAdmin ? null : '관리자만 이용 가능');
  const [running, setRunning] = useState<ChannelKey | null>(null);
  const [results, setResults] = useState<Partial<Record<ChannelKey, any>>>({});
  const [errs, setErrs] = useState<Partial<Record<ChannelKey, string>>>({});
  // ★ 2026-07-08 이미지 판독
  const [images, setImages] = useState<File[]>([]);
  const [libOpen, setLibOpen] = useState(false); // ★ P4: 라이브러리에서 선택 분기
  const [extracting, setExtracting] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // ★ 2026-07-08 생성 초안 DB 보관
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<'text' | 'image'>('text');
  const [chStatus, setChStatus] = useState<Partial<Record<ChannelKey, ChannelStatus>>>({});

  const token = () => localStorage.getItem('token');
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
  // 채널 잠금 사유 (인앱=표시 불가 / 이메일=관리자 전용). null=선택 가능.
  const blockOf = (key: ChannelKey): string | null => (key === 'inapp' ? inappBlock : key === 'email' ? emailBlock : null);

  useEffect(() => {
    if (!open) return;
    setImages([]);
    setImgErr(null);
    setExtracting(false);
    // 인앱 표시 가능성 — 표시할 곳 없으면 슬롯 잠금 (크레딧 낭비 차단). ★ 인앱=회사 관리자 전용이라 관리자만 조회·개방(비관리자는 잠금 유지).
    if (isCompanyAdmin) {
      fetch('/api/cdp/inapp/display-eligibility', { headers: headers() })
        .then((r) => r.json())
        .then((data) => {
          const e = data?.eligibility || data;
          if (e && e.canCreateWeb === false) {
            setInappBlock(String(e.blockReasonWeb || '인앱 메시지를 표시할 수 있는 쇼핑몰 연동이 없습니다.'));
            setSel((s) => ({ ...s, inapp: false }));
          } else {
            setInappBlock(null);
            setSel({ dm: true, email: true, inapp: true });
          }
        })
        .catch(() => setInappBlock(null));
    }

    if (resumeDraftId) {
      // 임시 보관한 세트 재개 — 초안 복원
      setText('');
      setResults({});
      setErrs({});
      setChStatus({});
      setDraftId(null);
      fetch(`/api/event-campaigns/drafts/${resumeDraftId}`, { headers: headers() })
        .then((r) => r.json())
        .then((data) => {
          const d = data?.draft;
          if (!d) return;
          setDraftId(d.id);
          setText(d.event_text || '');
          setSourceKind(d.source_kind === 'image' ? 'image' : 'text');
          const ch = d.channels || {};
          const nextResults: Partial<Record<ChannelKey, any>> = {};
          const nextStatus: Partial<Record<ChannelKey, ChannelStatus>> = {};
          for (const k of CHANNELS.map((c) => c.key)) {
            // ★ 인앱=회사 관리자 전용. 비관리자 복원 시 인앱 payload·편집 진입 차단.
            if (k === 'inapp' && !isCompanyAdmin) continue;
            if (ch[k] && ch[k].payload) {
              nextResults[k] = ch[k].payload;
              nextStatus[k] = ch[k].status === 'opened' ? 'opened' : 'generated';
            }
          }
          setResults(nextResults);
          setChStatus(nextStatus);
        })
        .catch(() => {});
    } else {
      setText(initialText || '');
      setResults({});
      setErrs({});
      setChStatus({});
      setDraftId(null);
      setSourceKind('text');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeDraftId]);

  // 썸네일 URL — images 변경/언마운트 시 revoke (메모리 누수 차단)
  const previews = useMemo(() => images.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [images]);
  useEffect(() => () => { previews.forEach((p) => URL.revokeObjectURL(p.url)); }, [previews]);

  const totalCost = useMemo(
    () => CHANNELS.reduce((sum, c) => sum + (sel[c.key] && !results[c.key] ? CH_COSTS[c.key] : 0), 0),
    [sel, results],
  );

  const busy = running !== null || extracting;
  const anyResult = CHANNELS.some((c) => !!results[c.key]);

  // ── 이미지 판독 ──────────────────────────────────────────────
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const valid = picked.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type) && f.size <= 5 * 1024 * 1024);
    setImages((prev) => [...prev, ...valid].slice(0, MAX_IMAGES));
    setImgErr(picked.length > valid.length ? '일부 파일은 형식·용량(5MB) 초과로 제외됐어요. JPG·PNG·WebP만 가능합니다.' : null);
    e.target.value = '';
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const extractFromImages = async () => {
    if (!images.length || extracting) return;
    setExtracting(true);
    setImgErr(null);
    try {
      const fd = new FormData();
      for (let i = 0; i < images.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await downscaleToJpeg(images[i]);
        fd.append('images', blob, `shot_${i + 1}.jpg`);
      }
      const res = await fetch('/api/event-campaigns/extract-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` }, // multipart — Content-Type 자동(수동 지정 금지)
        body: fd,
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '이미지 판독 실패'));
      setText(String(data.event_text || ''));
      setSourceKind('image');
      setImages([]);
    } catch (e: any) {
      setImgErr(e?.message || '이미지 판독 실패');
    } finally {
      setExtracting(false);
    }
  };

  // ── 생성 초안 DB 보관 ────────────────────────────────────────
  const ensureDraft = async (): Promise<string | null> => {
    if (draftId) return draftId;
    try {
      const res = await fetch('/api/event-campaigns/drafts', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ event_text: text, source_kind: sourceKind, channels: {} }),
      });
      const data = await res.json();
      if (data?.success && data.id) {
        setDraftId(data.id);
        return data.id;
      }
    } catch {
      // 보관 실패는 생성 흐름을 막지 않음 (best-effort)
    }
    return null;
  };

  const persistChannel = async (ch: ChannelKey, payload: any, status: ChannelStatus): Promise<void> => {
    const id = await ensureDraft();
    if (!id) return;
    try {
      await fetch(`/api/event-campaigns/drafts/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ channel: ch, channel_data: { payload, status } }),
      });
      setChStatus((s) => ({ ...s, [ch]: status }));
    } catch {
      // best-effort
    }
  };

  // ── 채널 생성 ────────────────────────────────────────────────
  const generateOne = async (ch: ChannelKey): Promise<void> => {
    setRunning(ch);
    setErrs((e) => ({ ...e, [ch]: undefined }));
    try {
      let url = '';
      let body: any = {};
      if (ch === 'dm') { url = '/api/dm/ai/one-shot-generate'; body = { prompt: '', event_text: text }; }
      if (ch === 'email') { url = '/api/email/ai/generate-sections'; body = { event_text: text, is_ad: true }; }
      if (ch === 'inapp') { url = '/api/cdp/inapp/ai-generate'; body = { event_text: text }; }
      const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (data?.code === 'INAPP_DISPLAY_UNAVAILABLE') throw new Error(String(data.error || '인앱 표시 가능 채널이 없습니다.'));
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '생성 실패'));
      const payload = ch === 'dm' ? data.data : ch === 'email' ? data.data : data.package;
      if (!payload) throw new Error('생성 결과가 비어 있습니다. 다시 시도해주세요.');
      setResults((r) => ({ ...r, [ch]: payload }));
      // 생성 성공 시 세트에 보관 (소멸 방지) — sequential 호출이라 draftId 경쟁 없음
      await persistChannel(ch, payload, 'generated');
    } catch (e: any) {
      setErrs((er) => ({ ...er, [ch]: e?.message || '생성 실패' }));
    } finally {
      setRunning(null);
    }
  };

  const generateSelected = async () => {
    for (const c of CHANNELS) {
      if (sel[c.key] && !results[c.key] && !blockOf(c.key)) {
        // 순차 생성 — 실패한 채널은 오류 표시 후 다음 채널 계속 (이미 성공분 크레딧은 각 채널 몫)
        // eslint-disable-next-line no-await-in-loop
        await generateOne(c.key);
      }
    }
  };

  const openEditor = (ch: ChannelKey) => {
    const r = results[ch];
    if (!r) return;
    // 편집 상태 보관 (best-effort, 나머지 채널 payload 유지) — navigate 즉시
    void persistChannel(ch, r, 'opened');
    if (ch === 'dm') {
      sessionStorage.setItem(EVENT_DM_DRAFT_KEY, JSON.stringify({ ts: Date.now(), prompt: text, data: r }));
      navigate('/dm-builder');
    } else if (ch === 'email') {
      sessionStorage.setItem(EVENT_EMAIL_DRAFT_KEY, JSON.stringify({ ts: Date.now(), data: r, isAd: true }));
      navigate('/email-campaigns');
    } else {
      sessionStorage.setItem(EVENT_INAPP_DRAFT_KEY, JSON.stringify({ ts: Date.now(), pkg: r }));
      navigate('/inapp-messages');
    }
    onClose();
  };

  const summaryOf = (ch: ChannelKey): string => {
    const r = results[ch];
    if (!r) return '';
    if (ch === 'dm') return `섹션 ${(r.sections || []).length}개 · ${r.layout_mode === 'slides' ? '슬라이드형' : '스크롤형'}`;
    if (ch === 'email') return `${(r.subjects && r.subjects[0]) || r.name || '제목 생성됨'} · 블록 ${(r.sections || []).length}개`;
    const m = r.message || {};
    return `${m.title || '(제목)'} · ${m.template || ''}${m.card_style && m.card_style !== 'classic' ? ` · ${m.card_style}` : ''}`;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/25">
              <CalendarRange className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">원클릭 캠페인</h3>
              <p className="text-[11px] text-white/50">행사 내용을 붙여넣거나 이미지로 불러오면 고른 채널만 AI 초안 생성, 잔손질만 하면 됩니다</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 이미지로 행사 내용 불러오기 */}
          {!anyResult && (
            <div className="rounded-xl border border-dashed border-violet-400/30 bg-violet-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white/80">
                  <ImagePlus className="w-3.5 h-3.5 text-violet-300" /> 이미지로 행사 내용 불러오기
                </span>
                <span className="text-[10px] text-white/40">스샷 여러 장 가능 (최대 {MAX_IMAGES}장)</span>
              </div>
              <p className="text-[10px] text-white/45 mt-1">상품 목록·행사 안내 이미지를 올리면 AI가 보이는 내용(상품·정가·할인·기간·혜택)을 그대로 읽어 아래 행사 내용에 채워 드려요.</p>

              {previews.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {previews.map((p, i) => (
                    <div key={p.url} className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/10">
                      <img src={p.url} alt={`업로드 이미지 ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeImage(i)}
                        disabled={busy}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-rose-600 disabled:opacity-40"
                        aria-label="이미지 제거"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={onPickImages} />
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || images.length >= MAX_IMAGES}
                  className="text-[11px] font-medium text-violet-100 border border-violet-400/40 hover:bg-violet-500/15 rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  직접 업로드
                </button>
                <button
                  type="button"
                  onClick={() => setLibOpen(true)}
                  disabled={busy || images.length >= MAX_IMAGES}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-100 border border-emerald-400/40 hover:bg-emerald-500/15 rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  <FolderOpen className="w-3 h-3" /> 라이브러리에서
                </button>
                <AssetLibraryPickerModal
                  open={libOpen}
                  onClose={() => setLibOpen(false)}
                  multiSelect
                  onPick={async (a) => {
                    const fs = await assetsToFiles([a]);
                    setImages((prev) => [...prev, ...fs].slice(0, MAX_IMAGES));
                  }}
                  onPickMany={async (assets) => {
                    const fs = await assetsToFiles(assets);
                    setImages((prev) => [...prev, ...fs].slice(0, MAX_IMAGES));
                  }}
                />
                <button
                  type="button"
                  onClick={() => extractFromImages()}
                  disabled={busy || images.length === 0}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {extracting ? '이미지 판독 중...' : `이미지로 행사 내용 불러오기 (예상 ${IMAGE_EXTRACT_COST} 크레딧)`}
                </button>
              </div>
              {imgErr && <p className="text-[10px] text-rose-300 mt-1.5">{imgErr}</p>}
            </div>
          )}

          {/* 행사 내용 입력 */}
          <div>
            <label className="text-xs font-bold text-white/80 mb-1.5 block">행사 내용</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy || anyResult}
              placeholder={'행사 내용을 자유롭게 붙여넣거나, 위에서 이미지로 불러오세요. 한 줄이든 줄바꿈 나열이든 무관합니다.\n예)\n여름맞이 신상품 출시전\n7/10~7/20\n전 품목 신상품 대상\n구매 고객 사은품 증정'}
              className="w-full h-32 px-3 py-2.5 bg-slate-950/60 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 resize-y focus:outline-none focus:border-fuchsia-400/40"
            />
            <p className="text-[10px] text-white/40 mt-1">행사 내용에 직접 적으신(또는 이미지에서 읽어온) 혜택만 초안에 그대로 사용됩니다. AI가 혜택을 지어내지 않습니다.</p>
          </div>

          {/* 채널 3슬롯 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {CHANNELS.map((c) => {
              const Ic = c.icon;
              const locked = !!blockOf(c.key);
              const done = !!results[c.key];
              const err = errs[c.key];
              const isRunning = running === c.key;
              const opened = chStatus[c.key] === 'opened';
              return (
                <div
                  key={c.key}
                  className={`rounded-xl border p-3 transition-colors ${done ? 'bg-emerald-500/10 border-emerald-400/40' : locked ? 'bg-white/[0.03] border-white/10 opacity-60' : sel[c.key] ? 'bg-violet-500/15 border-violet-400/50' : 'bg-slate-950/50 border-white/10'}`}
                >
                  <button
                    type="button"
                    disabled={locked || busy || done}
                    onClick={() => setSel((s) => ({ ...s, [c.key]: !s[c.key] }))}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                        <Ic className="w-3.5 h-3.5" /> {c.label}
                      </span>
                      {locked ? <Lock className="w-3.5 h-3.5 text-white/40" /> : (
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${sel[c.key] || done ? 'bg-violet-500 border-violet-400 text-white' : 'border-white/25 text-transparent'}`}>✓</span>
                      )}
                    </div>
                    <p className="text-[10px] text-white/45 mt-1">{c.desc}</p>
                    <p className="text-[10px] mt-1.5">
                      {done
                        ? <span className="text-emerald-300">{opened ? '편집함' : '생성 완료'}: {summaryOf(c.key)}</span>
                        : locked
                          ? <span className="text-amber-300/80">{c.key === 'email' ? '관리자만 생성 가능' : '표시할 곳 없음. 연동 후 이용 가능'}</span>
                          : <span className="text-white/50">예상 {CH_COSTS[c.key]} 크레딧</span>}
                    </p>
                    {err && <p className="text-[10px] text-rose-300 mt-1">{err}</p>}
                  </button>
                  {isRunning && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-fuchsia-200"><Loader2 className="w-3 h-3 animate-spin" /> 생성 중...</div>
                  )}
                  {done && (
                    <button onClick={() => openEditor(c.key)} className="mt-2 w-full text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-lg py-1.5">
                      {opened ? '다시 편집 열기' : '편집 열기 (이미지·잔손질)'}
                    </button>
                  )}
                  {!done && anyResult && !locked && !sel[c.key] && (
                    <button
                      onClick={() => { setSel((s) => ({ ...s, [c.key]: true })); generateOne(c.key); }}
                      disabled={busy || !text.trim()}
                      className="mt-2 w-full text-[11px] text-violet-200 border border-dashed border-violet-400/40 hover:bg-violet-500/10 rounded-lg py-1.5 disabled:opacity-40"
                    >
                      + 이 행사로 이어서 만들기 ({CH_COSTS[c.key]} 크레딧)
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 실행 */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-white/45">
              {totalCost > 0 ? <>선택 채널 생성 시 <strong className="text-white/80">{totalCost} 크레딧</strong>이 차감됩니다 (성공한 채널만)</> : anyResult ? '빈 슬롯은 언제든 이 행사로 이어서 만들 수 있습니다 · 초안은 임시 보관됩니다' : '생성할 채널을 선택해주세요'}
            </p>
            <button
              onClick={generateSelected}
              disabled={busy || !text.trim() || totalCost === 0}
              className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {running !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {running !== null ? '생성 중...' : anyResult ? '선택 채널 마저 생성' : '선택 채널 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
