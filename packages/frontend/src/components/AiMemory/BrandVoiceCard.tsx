/**
 * BrandVoiceCard.tsx — 회사 목소리(브랜드 보이스) 학습 카드
 *
 * ★ 2026-10-28 AI 메모리 설계(docs/2026-10-28-ai-memory-brand-voice-design.md) K5 · K7 · K8 · K9 · K13 전면 개편:
 *   - 우리 목소리 칸표(종류 5 × 배움 여부 · 표본 수) · 상태 칩(학습 미완 · 확인 대기 · 견본 미완 · 적용 중)
 *   - 대표 문안 = 한 건씩 올리기 · 고치기(다른 사람이 먼저 고쳤으면 409) · 빼기(관리자) · 성격 · 종류 · 출처 칩
 *   - [저장하고 배우기] 한 버튼(금액 = 서버 단가) → 뼈대 확인(칸을 눌러 되돌림 · 글자를 골라 칸으로) → 견본 두 장
 *   - 보낸 문자 고르기 창(최근 보낸 문자 · 미리 체크 · 휴대폰 모양) · 성격별 가이드라인(사람이 고친 칸 · AI 에게 다시 맡기기)
 *   - 법이 정한 칸은 잠긴 한 줄 · 학습 중 잠금 · 금액은 서버가 내려준 값(화면 숫자 0) · native dialog 0 · 모델명 0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Plus, Trash2, Save, RotateCcw, Loader2, CheckCircle2, AlertCircle, Smartphone, Pencil, Link2, Lock,
  Inbox, Wand2, Eye, X, RefreshCw,
} from 'lucide-react';
import BrandLinkChips from '../BrandLinkChips';
import JourneyModalShell from '../journey/JourneyModalShell';

type Kind = 'marketing' | 'notice';
type ContentType = 'promo' | 'launch' | 'howto' | 'greeting' | 'notice';
type Channel = 'SMS' | 'LMS' | 'MMS';
type VoiceStatus = 'none' | 'incomplete' | 'review_pending' | 'sample_pending' | 'ready';

interface VoiceMessage {
  id: string;
  priority: number;
  channel: Channel;
  subject: string;
  text: string;
  imageUrl: string | null;
  contentType: ContentType | null;
  contentTypeSource: 'admin' | 'ai' | null;
  kind: Kind | null;
  kindSource: 'admin' | 'ai' | null;
  source: 'admin_input' | 'sent_history';
  pendingSkeleton: string | null;
  pendingExtractGen: number | null;
  reviewedSkeleton: string | null;
  updatedAt: string;
}

interface Shape {
  n: number;
  lineLenP50: number | null;
  lineLenP90: number | null;
  maxBlankRun: number | null;
  paragraphs: { min: number; max: number } | null;
  symbols: string[];
}

interface Guideline {
  tone_signature: string;
  avg_length_chars: number;
  frequent_expressions: string[];
  greeting_pattern: string;
  cta_patterns: string[];
  signature: string;
  emoji_whitelist: string[];
  hook_types?: string[];
  body_structure?: string[];
  sentence_ending_style?: '해요체' | '합쇼체' | '혼합';
  sentence_ending_examples?: string[];
  customer_address?: string;
  length_range?: { min_chars: number; max_chars: number };
  link_habit?: { uses_url: boolean; position: 'body_end' | 'mid' | 'none'; avg_urls_per_message: number };
  shape?: Shape;
  signature_locked?: string;
  signature_mode?: 'append' | 'ai_blend';
  slogans?: string[];
  required_words?: string[];
  banned_words?: string[];
}

type AdminRow = Record<string, { value: unknown; at: string; by: string | null }>;
type Phrases = Partial<Pick<Guideline, 'frequent_expressions' | 'cta_patterns' | 'signature' | 'greeting_pattern' | 'sentence_ending_examples'>>;

interface SampleItem { kind: Kind; ground: string; isAd: boolean; subject: string; message: string; shape: { lines: number; paragraphs: number; maxLineLen: number; symbols: string[] } }

interface VoiceData {
  messages: VoiceMessage[];
  guideline: Guideline | null;
  resolved: Record<Kind, Guideline | null>;
  admin: Partial<Record<Kind, AdminRow>>;
  pending_phrases: Record<Kind, Phrases>;
  state: { gen: number; guidelineGen: number; extractGen: number | null; reviewedExtractGen: number | null; extractError: { code: string } | null; sample: SampleItem[] | null };
  status: VoiceStatus;
  relearn_suggestion: { newCount: number } | null;
  voice_learned: boolean;
  prices: { extract: number; sample: number; learn: number };
  permissions: { canEdit: boolean; canDelete: boolean };
  content_types: Array<{ key: ContentType; label: string; kind: Kind }>;
  keep_limit: number;
}

interface Candidate { campaignId: string; channel: Channel; subject: string; text: string; isAd: boolean; sentAt: string | null; sentCount: number; preselected: boolean }

interface BrandVoiceCardProps {
  apiBase: string;
  token: string;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onConfirm: (opts: { title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void }) => void;
  /** ★ K13-2 바로 열기(?learn=voice) — 문안이 없으면 보낸 문자 고르기부터 연다 */
  autoStart?: boolean;
}

const KIND_LABEL: Record<Kind, string> = { marketing: '마케팅', notice: '안부 · 알림' };
const STATUS_LABEL: Record<VoiceStatus, { text: string; tone: string }> = {
  none: { text: '아직 배운 목소리가 없어요', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
  incomplete: { text: '다시 배우기가 필요해요', tone: 'bg-amber-50 text-amber-800 border-amber-300' },
  review_pending: { text: '배운 내용 확인 대기', tone: 'bg-sky-50 text-sky-800 border-sky-300' },
  sample_pending: { text: '견본 미완', tone: 'bg-violet-50 text-violet-800 border-violet-300' },
  ready: { text: '목소리 적용 중', tone: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
};
const TONE_OPTIONS = ['친근/캐주얼', '정중/격조', '활기/감성', '정보/실용', '럭셔리/세련'];

// ─────────────── 뼈대 칸(발송 차단 규격 · 서버 brand-voice-skeleton 과 같은 꼴) ───────────────
const SLOT_RE = /\[[^\]\n]{0,60}직접\s?(?:입력|작성|수정)해\s?주세요\]/g;
const SLOT_KINDS: Array<{ label: string; slot: string }> = [
  { label: '상품명', slot: '[상품명: 직접 입력해주세요]' },
  { label: '행사명', slot: '[행사명: 직접 입력해주세요]' },
  { label: '매장', slot: '[매장: 직접 입력해주세요]' },
  { label: '기간', slot: '[기간: 직접 입력해주세요]' },
  { label: '혜택', slot: '[혜택 안내: 직접 수정해주세요]' },
  { label: '숫자', slot: '[숫자: 직접 입력해주세요]' },
];

/** 법 꼬리(광고 머리 · 080 줄)만 뗀 원문(서버 normalizeForShape 와 같은 판정 · 되돌리기 짝 찾기용) */
function normalizeOriginal(text: string): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/^\s*\[Web발신\]\s*\n?/i, '').replace(/^\s*[(（]\s*광고\s*[)）]\s*/, '')
    .split('\n').filter((l) => !/^\s*(무료\s*수신\s*거부|무료거부|수신거부)\s*[:：]?\s*0?\d[\d-]{6,}\s*$/.test(l)).join('\n')
    .replace(/\s*(무료\s*수신\s*거부|무료거부)\s*[:：]?\s*0?\d[\d-]{6,}\s*$/, '').replace(/\n+$/, '').replace(/^\n+/, '');
}

type Piece = { slot: boolean; s: string };
function splitSkeleton(sk: string): Piece[] {
  const out: Piece[] = [];
  let pos = 0;
  for (const m of sk.matchAll(SLOT_RE)) {
    if (m.index! > pos) out.push({ slot: false, s: sk.slice(pos, m.index) });
    out.push({ slot: true, s: m[0] });
    pos = m.index! + m[0].length;
  }
  if (pos < sk.length) out.push({ slot: false, s: sk.slice(pos) });
  return out;
}

/** 칸 하나를 원문 글자로 되돌린다(앞뒤가 글자 조각일 때만 · 그 사이 원문이 곧 그 칸의 글자) */
function revertSlot(sk: string, original: string, slotIndex: number): string | null {
  const pieces = splitSkeleton(sk);
  const src = normalizeOriginal(original);
  let pos = 0;
  const spans: Array<{ from: number; to: number } | null> = [];
  for (const p of pieces) {
    if (p.slot) { spans.push(null); continue; }
    const at = src.indexOf(p.s, pos);
    if (at < 0) return null;
    spans.push({ from: at, to: at + p.s.length });
    pos = at + p.s.length;
  }
  const i = pieces.findIndex((p, k) => p.slot && pieces.slice(0, k + 1).filter((x) => x.slot).length === slotIndex + 1);
  if (i < 0) return null;
  const prev = i > 0 ? pieces[i - 1] : null;
  const next = i < pieces.length - 1 ? pieces[i + 1] : null;
  if ((prev && prev.slot) || (next && next.slot)) return null;
  const from = prev ? spans[i - 1]!.to : 0;
  const to = next ? spans[i + 1]!.from : src.length;
  const text = src.slice(from, to);
  return pieces.map((p, k) => (k === i ? text : p.s)).join('');
}

function SkeletonView({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
      {splitSkeleton(text).map((p, i) => p.slot
        ? <span key={i} className="inline-block mx-0.5 px-1.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[12px]">{p.s.replace(/^\[|:.*$/g, '')}</span>
        : <span key={i}>{p.s}</span>)}
    </div>
  );
}

export default function BrandVoiceCard({ apiBase, token, onToast, onConfirm, autoStart = false }: BrandVoiceCardProps) {
  const [data, setData] = useState<VoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'save' | 'learn' | 'review' | 'sample' | 'guide' | 'reset'>(null);
  const [editor, setEditor] = useState<{ id: string | null; updatedAt: string | null; draft: { channel: Channel; subject: string; text: string; imageUrl: string | null; contentType: ContentType | null } } | null>(null);
  const [picker, setPicker] = useState<{ loading: boolean; list: Candidate[]; picked: Set<string> } | null>(null);
  const [review, setReview] = useState<{ edits: Record<string, string>; editing: string | null } | null>(null);
  const [samples, setSamples] = useState<SampleItem[] | null>(null);
  const [guide, setGuide] = useState<{ kind: Kind; editing: boolean; draft: Partial<Guideline> } | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const autoStarted = useRef(false);
  const auth = { Authorization: `Bearer ${token}` };
  const json = { 'Content-Type': 'application/json', ...auth };
  const learning = busy === 'learn' || busy === 'review' || busy === 'sample';

  async function load(): Promise<VoiceData | null> {
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice`, { headers: auth });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '목소리 정보를 불러오지 못했어요.');
      setData(d);
      return d;
    } catch (err: any) {
      onToast(err.message || '목소리 정보를 불러오지 못했어요.', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !data) return;
    autoStarted.current = true;
    if (data.messages.length === 0 && data.permissions.canEdit) openPicker();
  /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoStart, data]);

  const typeLabel = useMemo(() => Object.fromEntries((data?.content_types || []).map((c) => [c.key, c.label])) as Record<ContentType, string>, [data]);

  // ─────────────── 대표 문안 한 건씩 ───────────────
  function openNew() {
    if (!data) return;
    if (data.messages.length >= data.keep_limit) { onToast(`대표 문안은 ${data.keep_limit}건까지 둘 수 있어요.`, 'info'); return; }
    setEditor({ id: null, updatedAt: null, draft: { channel: 'LMS', subject: '', text: '', imageUrl: null, contentType: null } });
  }
  function openEdit(m: VoiceMessage) {
    setEditor({ id: m.id, updatedAt: m.updatedAt, draft: { channel: m.channel, subject: m.subject, text: m.text, imageUrl: m.imageUrl, contentType: m.contentTypeSource === 'admin' ? m.contentType : null } });
  }
  async function saveEditor() {
    if (!editor) return;
    if (editor.draft.text.trim().length < 10) { onToast('본문을 10자 이상 적어 주세요.', 'error'); return; }
    setBusy('save');
    try {
      const body = JSON.stringify({ ...editor.draft, ...(editor.updatedAt ? { updatedAt: editor.updatedAt } : {}) });
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/messages${editor.id ? `/${editor.id}` : ''}`, { method: editor.id ? 'PUT' : 'POST', headers: json, body });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '저장하지 못했어요.');
      setEditor(null);
      onToast('저장했어요. [다시 배우기]를 누르면 이 문안까지 배워요.', 'success');
      await load();
    } catch (err: any) {
      onToast(err.message || '저장하지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  }
  function removeMessage(m: VoiceMessage) {
    onConfirm({
      title: '대표 문안 빼기',
      description: '이 문안을 대표 문안에서 뺄까요? 다음 배우기부터 이 문안은 쓰지 않아요.',
      confirmLabel: '빼기',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/message/${m.id}`, { method: 'DELETE', headers: auth });
          const d = await res.json();
          if (!res.ok || !d.success) throw new Error(d.error || '빼지 못했어요.');
          setEditor(null);
          onToast('뺐어요.', 'success');
          await load();
        } catch (err: any) {
          onToast(err.message || '빼지 못했어요.', 'error');
        }
      },
    });
  }

  // ─────────────── 보낸 문자 고르기(K8-2) ───────────────
  async function openPicker() {
    setPicker({ loading: true, list: [], picked: new Set() });
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/sent-candidates`, { headers: auth });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '보낸 문자를 불러오지 못했어요.');
      const list: Candidate[] = d.candidates || [];
      setPicker({ loading: false, list, picked: new Set(list.filter((c) => c.preselected).map((c) => c.campaignId)) });
    } catch (err: any) {
      setPicker(null);
      onToast(err.message || '보낸 문자를 불러오지 못했어요.', 'error');
    }
  }

  // ─────────────── 배우기 · 확인 · 견본(K7-4 · K5-4 · K9) ───────────────
  async function learn(opts: { messages?: Array<Partial<Candidate> & { text: string }>; relearn?: boolean } = {}) {
    setBusy('learn');
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/extract-guideline`, {
        method: 'POST', headers: json,
        body: JSON.stringify({
          relearn: opts.relearn === true,
          messages: (opts.messages || []).map((c) => ({ channel: c.channel, subject: c.subject, text: c.text, source: 'sent_history', campaignId: c.campaignId })),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        await load();
        throw new Error(d.error || '아직 못 배웠어요.');
      }
      setPicker(null);
      const fresh = await load();
      if (fresh && fresh.state.extractGen != null && fresh.state.reviewedExtractGen !== fresh.state.extractGen) setReview({ edits: {}, editing: null });
      else if (fresh) onToast('이미 배운 세대예요. 크레딧은 빠지지 않았어요.', 'info');
    } catch (err: any) {
      onToast(err.message || '아직 못 배웠어요.', 'error');
    } finally {
      setBusy(null);
    }
  }
  async function confirmReview(withSample: boolean) {
    if (!data || data.state.extractGen == null) return;
    setBusy('review');
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/review`, {
        method: 'POST', headers: json, body: JSON.stringify({ seenExtractGen: data.state.extractGen, skeletons: review?.edits || {} }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) { await load(); throw new Error(d.error || '확인하지 못했어요.'); }
      setReview(null);
      const fresh = await load();
      if (withSample && fresh) await makeSample(fresh.state.gen);
      else onToast('확인했어요. 이제 문안 생성에 이 목소리가 쓰여요.', 'success');
    } catch (err: any) {
      onToast(err.message || '확인하지 못했어요.', 'error');
    } finally {
      setBusy((b) => (b === 'review' ? null : b));
    }
  }
  async function makeSample(gen: number) {
    setBusy('sample');
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/sample`, { method: 'POST', headers: json, body: JSON.stringify({ gen }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '견본을 만들지 못했어요.');
      setSamples(d.samples || []);
      await load();
    } catch (err: any) {
      onToast(err.message || '견본을 만들지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  }

  // ─────────────── 성격별 가이드라인(K5-4 사람 행) ───────────────
  async function saveGuide() {
    if (!guide) return;
    setBusy('guide');
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/update-guideline`, { method: 'POST', headers: json, body: JSON.stringify({ kind: guide.kind, guideline: guide.draft }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '저장하지 못했어요.');
      onToast(d.changed?.length ? '고친 칸을 저장했어요. 다음 문안부터 이 값이 먼저 쓰여요.' : '바뀐 칸이 없어요.', d.changed?.length ? 'success' : 'info');
      setGuide({ ...guide, editing: false, draft: {} });
      await load();
    } catch (err: any) {
      onToast(err.message || '저장하지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  }
  async function returnToAi(kind: Kind, field: string) {
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/admin-field/reset`, { method: 'POST', headers: json, body: JSON.stringify({ kind, field }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || '바꾸지 못했어요.');
      onToast('이 칸은 다시 배운 값으로 써요.', 'success');
      await load();
    } catch (err: any) {
      onToast(err.message || '바꾸지 못했어요.', 'error');
    }
  }
  function resetAll() {
    onConfirm({
      title: '배운 목소리 초기화',
      description: '배운 가이드라인 · 고친 칸 · 뼈대를 모두 지웁니다. 대표 문안은 남아요. 지운 뒤 [다시 배우기]로 다시 배울 수 있어요.',
      confirmLabel: '초기화',
      cancelLabel: '취소',
      onConfirm: async () => {
        setBusy('reset');
        try {
          const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/guideline`, { method: 'DELETE', headers: auth });
          const d = await res.json();
          if (!res.ok || !d.success) throw new Error(d.error || '초기화하지 못했어요.');
          setGuide(null);
          onToast('초기화했어요.', 'success');
          await load();
        } catch (err: any) {
          onToast(err.message || '초기화하지 못했어요.', 'error');
        } finally {
          setBusy(null);
        }
      },
    });
  }

  if (loading || !data) {
    return (
      <div className="rounded-2xl border border-violet-200 bg-white p-6">
        <div className="flex items-center gap-3 text-violet-800"><Loader2 className="w-5 h-5 animate-spin" /><span>목소리 정보를 불러오는 중이에요</span></div>
      </div>
    );
  }

  const { prices, permissions, status } = data;
  const st = STATUS_LABEL[status];
  const creditErr = data.state.extractError?.code === 'credit';
  const reviewedTypes = new Set(data.messages.filter((m) => m.reviewedSkeleton && m.contentType).map((m) => m.contentType));
  const primary = (() => {
    if (status === 'none') return { label: data.messages.length ? `저장하고 배우기 · ${prices.learn}크레딧` : '보낸 문자에서 배우기', run: () => (data.messages.length ? learn() : openPicker()) };
    if (status === 'incomplete') return { label: `다시 배우기 · ${prices.learn}크레딧`, run: () => learn({ relearn: data.state.guidelineGen === data.state.gen }) };
    if (status === 'review_pending') return { label: '배운 내용 확인하기', run: () => setReview({ edits: {}, editing: null }) };
    if (status === 'sample_pending') return { label: `견본 다시 만들기 · ${prices.sample}크레딧`, run: () => makeSample(data.state.gen) };
    return { label: '견본 보기', run: () => setSamples(data.state.sample || []) };
  })();

  return (
    <>
      <div className="rounded-2xl border border-violet-200 bg-white overflow-hidden">
        {/* 머리 · 상태 · 주 버튼 */}
        <div className="px-5 py-4 border-b border-violet-100 flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5 text-white" /></div>
          <div className="flex-1 min-w-[220px]">
            <h3 className="text-base font-semibold text-slate-900">우리 회사 목소리</h3>
            <p className="text-xs text-slate-600 mt-0.5">보낸 문자의 말투 · 줄띄움 · 기호를 배워 모든 자동 문안이 그 꼴로 나와요. 행사 · 상품만 적으면 돼요.</p>
          </div>
          <span className={`text-[11px] px-2 py-1 rounded-full border font-semibold ${st.tone}`}>{st.text}</span>
          {permissions.canEdit && (
            <button onClick={primary.run} disabled={!!busy}
              className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-semibold flex items-center gap-2 disabled:opacity-50">
              {busy === 'learn' || busy === 'sample' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{primary.label}
            </button>
          )}
        </div>

        {/* 안내 줄(실패 · 다시 배우기 제안) */}
        {(creditErr || data.relearn_suggestion) && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center gap-2 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {creditErr
              ? <span>크레딧이 부족해 아직 못 배웠어요. 문안은 저장돼 있어요. 충전한 뒤 [다시 배우기]를 눌러 주세요.</span>
              : <span>마지막으로 배운 뒤 새로 보낸 문자가 {data.relearn_suggestion!.newCount}건 있어요. 다시 배울까요?</span>}
            {!creditErr && permissions.canEdit && (
              <button onClick={openPicker} disabled={!!busy} className="ml-auto px-3 py-1.5 rounded-lg border border-amber-300 bg-white font-semibold hover:bg-amber-100">보낸 문자 고르기</button>
            )}
          </div>
        )}

        <div className="p-5 space-y-6">
          {/* 우리 목소리 칸표(K13-1) */}
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-2">종류별로 배운 목소리</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {data.content_types.map((c) => {
                const n = data.messages.filter((m) => m.contentType === c.key).length;
                const ok = reviewedTypes.has(c.key);
                return (
                  <button key={c.key} type="button" disabled={ok || !permissions.canEdit || !!busy} onClick={openPicker}
                    className={`rounded-xl border px-3 py-2.5 text-left ${ok ? 'border-emerald-300 bg-emerald-50' : 'border-dashed border-slate-300 bg-white hover:border-violet-400 hover:bg-violet-50'}`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> : <Plus className="w-3.5 h-3.5 text-slate-500" />}{c.label}
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">{ok ? `대표 문안 ${n}건` : n ? `${n}건 · 확인 전` : '보낸 문자에서 채우기'}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 대표 문안 카드(K13-4) */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h4 className="text-sm font-semibold text-slate-900">대표 문안 {data.messages.length}건</h4>
              <span className="text-[11px] text-slate-500">최대 {data.keep_limit}건</span>
              {permissions.canEdit && (
                <div className="ml-auto flex gap-2">
                  <button onClick={openPicker} disabled={!!busy} className="px-3 py-1.5 text-xs rounded-lg border border-violet-300 text-violet-800 hover:bg-violet-50 flex items-center gap-1"><Inbox className="w-3.5 h-3.5" />보낸 문자 고르기</button>
                  <button onClick={openNew} disabled={!!busy} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />직접 올리기</button>
                </div>
              )}
            </div>
            {data.messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
                아직 대표 문안이 없어요. 최근에 보낸 문자를 고르면 바로 배울 수 있어요.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.messages.map((m) => (
                  <button key={m.id} type="button" onClick={() => permissions.canEdit && !busy && openEdit(m)}
                    className="text-left rounded-xl border border-slate-200 bg-white hover:border-violet-300 p-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">{m.channel}</span>
                      {m.kind && <TagChip ai={m.kindSource !== 'admin'} text={KIND_LABEL[m.kind]} />}
                      {m.contentType ? <TagChip ai={m.contentTypeSource !== 'admin'} text={typeLabel[m.contentType] || m.contentType} /> : <span className="text-[11px] text-slate-500">종류 미정</span>}
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200">{m.source === 'sent_history' ? '보낸 문자' : '직접 올림'}</span>
                    </div>
                    <div className="text-xs text-slate-800 whitespace-pre-wrap line-clamp-4">{m.text}</div>
                    <div className="mt-auto text-[11px] text-slate-500">{m.reviewedSkeleton ? '뼈대 확인됨' : m.pendingSkeleton ? '뼈대 확인 대기' : '다음 배우기 때 뼈대를 만들어요'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 성격별 가이드라인 요약(K13-4 · K5-2) */}
          {(data.resolved.marketing || data.resolved.notice) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(['marketing', 'notice'] as const).filter((k) => data.resolved[k]).map((k) => {
                const g = data.resolved[k]!;
                return (
                  <div key={k} className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-semibold text-slate-900">{KIND_LABEL[k]} 말투</h4>
                      <button onClick={() => setGuide({ kind: k, editing: false, draft: {} })} className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-violet-300 bg-white text-violet-900 hover:bg-violet-100 flex items-center gap-1"><Eye className="w-3.5 h-3.5" />자세히</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Mini label="톤" value={g.tone_signature || '배우는 중'} />
                      <Mini label="어체" value={g.sentence_ending_style || '배우는 중'} />
                      <Mini label="한 줄 길이" value={g.shape?.lineLenP90 != null ? `보통 ${g.shape.lineLenP50}자` : `표본 ${g.shape?.n ?? 0}건 · 3건부터 재요`} />
                      <Mini label="쓰는 기호" value={g.shape?.symbols?.length ? g.shape.symbols.slice(0, 6).join(' ') : '없음'} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 브랜드 링크 */}
          <div>
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-1"><Link2 className="w-4 h-4 text-violet-700" />브랜드 링크</h4>
            <p className="text-xs text-slate-600 mb-2">공식몰 · 이벤트관 주소를 올려 두면 문안 편집기에서 한 번에 넣고, AI 도 올린 주소만 문안에 넣어요.</p>
            <BrandLinkChips tone="light" onToast={onToast} />
          </div>

          {permissions.canDelete && (data.guideline || Object.keys(data.admin.marketing || {}).length + Object.keys(data.admin.notice || {}).length > 0) && (
            <div className="flex justify-end">
              <button onClick={resetAll} disabled={!!busy} className="px-3 py-1.5 text-xs text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-50 flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" />배운 목소리 초기화</button>
            </div>
          )}
        </div>
      </div>

      {/* 대표 문안 한 건 창 */}
      <JourneyModalShell open={!!editor} onClose={() => setEditor(null)} labelledBy="bv-editor-title" panelClassName="w-full max-w-4xl" disableDismiss={busy === 'save'}>
        {editor && (
          <div className="flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
              <Smartphone className="w-4 h-4 text-violet-700" />
              <h4 id="bv-editor-title" className="text-sm font-semibold text-slate-900">{editor.id ? '대표 문안 고치기' : '대표 문안 올리기'}</h4>
              <button onClick={() => setEditor(null)} className="ml-auto p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col md:flex-row gap-5">
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {(['SMS', 'LMS', 'MMS'] as const).map((c) => (
                    <button key={c} type="button" aria-pressed={editor.draft.channel === c} onClick={() => setEditor({ ...editor, draft: { ...editor.draft, channel: c } })}
                      className={`h-9 rounded-lg border text-xs font-semibold ${editor.draft.channel === c ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-slate-200 text-slate-600'}`}>{c}</button>
                  ))}
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">종류</div>
                  <div className="flex flex-wrap gap-1.5">
                    <ChoiceChip on={editor.draft.contentType === null} onClick={() => setEditor({ ...editor, draft: { ...editor.draft, contentType: null } })} text="자동 판정" />
                    {data.content_types.map((c) => (
                      <ChoiceChip key={c.key} on={editor.draft.contentType === c.key} onClick={() => setEditor({ ...editor, draft: { ...editor.draft, contentType: c.key } })} text={c.label} />
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">자동 판정 = 배울 때 AI 가 종류를 정해요. 직접 고르면 그대로 둬요.</p>
                </div>
                {editor.draft.channel !== 'SMS' && (
                  <input value={editor.draft.subject} onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, subject: e.target.value } })} placeholder="제목(LMS · MMS)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-violet-500 focus:outline-none" />
                )}
                <textarea value={editor.draft.text} onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, text: e.target.value } })} rows={10} maxLength={2000}
                  placeholder="실제로 보낸 문자를 줄띄움 그대로 붙여 넣어 주세요."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-violet-500 focus:outline-none resize-none" />
                <div className="text-[11px] text-slate-500 text-right">{editor.draft.text.length}자 / 2000자</div>
                {editor.draft.channel === 'MMS' && (
                  <input value={editor.draft.imageUrl || ''} onChange={(e) => setEditor({ ...editor, draft: { ...editor.draft, imageUrl: e.target.value || null } })} placeholder="이미지 주소(선택)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-violet-500 focus:outline-none" />
                )}
              </div>
              <Phone subject={editor.draft.channel === 'SMS' ? '' : editor.draft.subject} body={editor.draft.text} />
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200">
              {editor.id && permissions.canDelete && (
                <button onClick={() => { const m = data.messages.find((x) => x.id === editor.id); if (m) removeMessage(m); }} className="px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />빼기</button>
              )}
              <button onClick={() => setEditor(null)} className="ml-auto px-4 py-2 text-sm border border-slate-300 rounded-lg">닫기</button>
              <button onClick={saveEditor} disabled={busy === 'save'} className="px-5 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}저장
              </button>
            </div>
          </div>
        )}
      </JourneyModalShell>

      {/* 보낸 문자 고르기(K8-2) */}
      <JourneyModalShell open={!!picker} onClose={() => setPicker(null)} labelledBy="bv-picker-title" panelClassName="w-full max-w-5xl" disableDismiss={learning}>
        {picker && (
          <div className="flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
              <Inbox className="w-4 h-4 text-violet-700" />
              <h4 id="bv-picker-title" className="text-sm font-semibold text-slate-900">최근 보낸 문자에서 고르기</h4>
              <button onClick={() => setPicker(null)} disabled={learning} className="ml-auto p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {picker.loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin" />보낸 문자를 모으는 중이에요</div>
              ) : picker.list.length === 0 ? (
                <div className="text-sm text-slate-600">최근 6개월에 직접 보낸 문자가 없어요. [직접 올리기]로 넣어 주세요.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {picker.list.map((c) => {
                    const on = picker.picked.has(c.campaignId);
                    return (
                      <button key={c.campaignId} type="button" aria-pressed={on}
                        onClick={() => { const next = new Set(picker.picked); if (on) next.delete(c.campaignId); else next.add(c.campaignId); setPicker({ ...picker, picked: next }); }}
                        className={`text-left rounded-2xl border-2 p-3 ${on ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">{c.channel}</span>
                          {c.isAd && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">광고</span>}
                          <span className="text-[11px] text-slate-500">{c.sentAt ? new Date(c.sentAt).toLocaleDateString('ko-KR') : ''}</span>
                          {on && <CheckCircle2 className="w-4 h-4 text-violet-700 ml-auto" />}
                        </div>
                        {c.subject && <div className="text-xs font-semibold text-slate-700 mb-1">{c.subject}</div>}
                        <div className="text-xs text-slate-800 whitespace-pre-wrap line-clamp-6">{c.text}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-600">{picker.picked.size}건 골랐어요 · 대표 문안에 더하고 바로 배워요</span>
              <button onClick={() => setPicker(null)} disabled={learning} className="ml-auto px-4 py-2 text-sm border border-slate-300 rounded-lg">닫기</button>
              <button disabled={learning || picker.picked.size === 0}
                onClick={() => learn({ messages: picker.list.filter((c) => picker.picked.has(c.campaignId)) })}
                className="px-5 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {busy === 'learn' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}이 {picker.picked.size}건으로 배우기 · {prices.learn}크레딧
              </button>
            </div>
          </div>
        )}
      </JourneyModalShell>

      {/* 배운 내용 확인(K5-4 · 뼈대 · 문구 칸) */}
      <JourneyModalShell open={!!review} onClose={() => setReview(null)} labelledBy="bv-review-title" panelClassName="w-full max-w-4xl" disableDismiss={learning}>
        {review && (
          <div className="flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
              <Eye className="w-4 h-4 text-violet-700" />
              <h4 id="bv-review-title" className="text-sm font-semibold text-slate-900">배운 내용 확인하기</h4>
              <button onClick={() => setReview(null)} disabled={learning} className="ml-auto p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-slate-700">AI 가 문안마다 상품 · 행사 · 기간 · 혜택 자리를 노란 칸으로 가렸어요. 이 뼈대만 새 문안의 본보기로 써요(원문은 쓰지 않아요). 빠진 사실은 글자를 골라 칸으로, 잘못 가린 칸은 눌러 되돌려 주세요.</p>
              {data.messages.filter((m) => m.pendingSkeleton && m.pendingExtractGen === data.state.extractGen).map((m) => {
                const sk = review.edits[m.id] ?? m.pendingSkeleton!;
                const editing = review.editing === m.id;
                const slotCount = splitSkeleton(sk).filter((p) => p.slot).length;
                return (
                  <div key={m.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">{m.channel}</span>
                      {m.contentType && <TagChip ai={m.contentTypeSource !== 'admin'} text={typeLabel[m.contentType] || m.contentType} />}
                      <span className="text-[11px] text-slate-500">칸 {slotCount}개</span>
                      <button onClick={() => setReview({ ...review, editing: editing ? null : m.id })} className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1"><Pencil className="w-3 h-3" />{editing ? '고치기 끝' : '고치기'}</button>
                    </div>
                    {editing ? (
                      <div className="space-y-2">
                        <textarea ref={textRef} defaultValue={sk} rows={8} onChange={(e) => setReview({ ...review, edits: { ...review.edits, [m.id]: e.target.value } })}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-violet-500 focus:outline-none" />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-slate-600">고른 글자를 칸으로</span>
                          {SLOT_KINDS.map((k) => (
                            <button key={k.label} type="button" className="text-[11px] px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                              onClick={() => {
                                const el = textRef.current;
                                if (!el || el.selectionStart === el.selectionEnd) { onToast('칸으로 바꿀 글자를 먼저 골라 주세요.', 'info'); return; }
                                const v = el.value.slice(0, el.selectionStart) + k.slot + el.value.slice(el.selectionEnd);
                                el.value = v;
                                setReview({ ...review, edits: { ...review.edits, [m.id]: v } });
                              }}>{k.label}</button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <SkeletonView text={sk} />
                        {slotCount > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: slotCount }, (_, i) => (
                              <button key={i} type="button" onClick={() => {
                                const back = revertSlot(sk, m.text, i);
                                if (back == null) { onToast('이웃한 칸이 있어 되돌릴 글자를 정할 수 없어요. [고치기]로 바꿔 주세요.', 'info'); return; }
                                setReview({ ...review, edits: { ...review.edits, [m.id]: back } });
                              }} className="text-[11px] px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50 flex items-center gap-1"><RefreshCw className="w-3 h-3" />{i + 1}번째 칸 되돌리기</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(['marketing', 'notice'] as const).filter((k) => Object.values(data.pending_phrases[k] || {}).some((v) => (Array.isArray(v) ? v.length : v))).map((k) => {
                const p = data.pending_phrases[k];
                return (
                  <div key={k} className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                    <div className="text-sm font-semibold text-slate-900 mb-1">{KIND_LABEL[k]} 말투에서 뽑은 문구</div>
                    <div className="text-xs text-slate-700 space-y-1">
                      {!!p.frequent_expressions?.length && <div>자주 쓰는 표현: <PhraseList items={p.frequent_expressions} /></div>}
                      {!!p.cta_patterns?.length && <div>행동 유도: <PhraseList items={p.cta_patterns} /></div>}
                      {p.greeting_pattern && <div>인사: <PhraseList items={[p.greeting_pattern]} /></div>}
                      {p.signature && <div>맺음: <PhraseList items={[p.signature]} /></div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-600">견본 {prices.sample}크레딧은 확인하고 견본을 만들 때 빠져요(처음 표시한 금액에 들어 있어요).</span>
              <button onClick={() => confirmReview(false)} disabled={learning} className="ml-auto px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-50">확인만</button>
              <button onClick={() => confirmReview(true)} disabled={learning} className="px-5 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {learning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}확인하고 견본 보기
              </button>
            </div>
          </div>
        )}
      </JourneyModalShell>

      {/* 견본(K9-4) */}
      <JourneyModalShell open={!!samples} onClose={() => setSamples(null)} labelledBy="bv-sample-title" panelClassName="w-full max-w-4xl">
        {samples && (
          <div className="flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
              <Smartphone className="w-4 h-4 text-violet-700" />
              <h4 id="bv-sample-title" className="text-sm font-semibold text-slate-900">이 목소리로 쓴 견본</h4>
              <button onClick={() => setSamples(null)} className="ml-auto p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              {samples.map((s) => (
                <div key={s.kind} className="space-y-2">
                  <div className="text-xs text-slate-700"><b>{KIND_LABEL[s.kind]}</b> · 요청 「{s.ground}」</div>
                  <Phone subject={s.subject} body={s.message} adNote={s.isAd} />
                  <div className="flex flex-wrap gap-1.5">
                    <Mini label="줄" value={`${s.shape.lines}줄`} />
                    <Mini label="문단" value={`${s.shape.paragraphs}개`} />
                    <Mini label="가장 긴 줄" value={`${s.shape.maxLineLen}자`} />
                    <Mini label="기호" value={s.shape.symbols.join(' ') || '없음'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </JourneyModalShell>

      {/* 성격별 가이드라인(사람 칸 · AI 에게 다시 맡기기 · 법 잠금) */}
      <JourneyModalShell open={!!guide} onClose={() => setGuide(null)} labelledBy="bv-guide-title" panelClassName="w-full max-w-3xl" disableDismiss={busy === 'guide'}>
        {guide && data.resolved[guide.kind] && (() => {
          const g = data.resolved[guide.kind]!;
          const admin = data.admin[guide.kind] || {};
          const val = (f: keyof Guideline) => (f in guide.draft ? (guide.draft as any)[f] : (g as any)[f]);
          const set = (f: keyof Guideline, v: unknown) => setGuide({ ...guide, draft: { ...guide.draft, [f]: v } });
          const src = (f: string) => (admin[f] ? '사람이 고침' : ['frequent_expressions', 'cta_patterns', 'signature', 'greeting_pattern', 'sentence_ending_examples'].includes(f) ? '확인된 학습' : '학습');
          const row = (f: keyof Guideline, label: string, kind: 'text' | 'list' | 'select', options?: string[]) => (
            <div key={f} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-800">{label}</span>
                <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full border ${admin[f] ? 'border-violet-400 text-violet-800' : 'border-dashed border-slate-300 text-slate-600'}`}>{src(f)}</span>
                {admin[f] && permissions.canEdit && <button onClick={() => returnToAi(guide.kind, f)} className="ml-auto text-[11px] text-violet-800 hover:underline">AI 에게 다시 맡기기</button>}
              </div>
              {guide.editing ? (
                kind === 'select' ? (
                  <select value={String(val(f) || '')} onChange={(e) => set(f, e.target.value)} className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded">
                    <option value="">(없음)</option>{options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : kind === 'list' ? (
                  <ListEditor values={(val(f) as string[]) || []} onChange={(v) => set(f, v)} />
                ) : (
                  <input value={String(val(f) || '')} onChange={(e) => set(f, e.target.value)} className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded" />
                )
              ) : kind === 'list' ? <PhraseList items={(val(f) as string[]) || []} /> : <div className="text-sm text-slate-800">{String(val(f) || '') || '(없음)'}</div>}
            </div>
          );
          return (
            <div className="flex flex-col max-h-[90vh]">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
                <h4 id="bv-guide-title" className="text-sm font-semibold text-slate-900">{KIND_LABEL[guide.kind]} 말투</h4>
                {permissions.canEdit && <button onClick={() => setGuide({ ...guide, editing: !guide.editing, draft: {} })} className="text-xs text-violet-800 hover:underline">{guide.editing ? '고치기 그만' : '직접 고치기'}</button>}
                <button onClick={() => setGuide(null)} className="ml-auto p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>법이 정한 것: (광고) 맨 앞 · 080 맨 끝 · 바이트 한도 · 이모지 불가</span>
                </div>
                {g.shape && (
                  <div className="rounded-lg border border-slate-200 p-2.5">
                    <div className="text-xs font-semibold text-slate-800 mb-1">코드가 잰 모양 · 표본 {g.shape.n}건</div>
                    <div className="flex flex-wrap gap-1.5">
                      <Mini label="한 줄" value={g.shape.lineLenP90 != null ? `${g.shape.lineLenP50}~${g.shape.lineLenP90}자` : '3건부터'} />
                      <Mini label="빈 줄 ↵" value={g.shape.maxBlankRun != null ? `연속 ${g.shape.maxBlankRun}줄까지` : '3건부터'} />
                      <Mini label="문단" value={g.shape.paragraphs ? `${g.shape.paragraphs.min}~${g.shape.paragraphs.max}개` : '3건부터'} />
                      <Mini label="기호" value={g.shape.symbols.slice(0, 10).join(' ') || '없음'} />
                    </div>
                  </div>
                )}
                {row('tone_signature', '톤', 'select', TONE_OPTIONS)}
                {row('sentence_ending_style', '어체', 'select', ['해요체', '합쇼체', '혼합'])}
                {row('customer_address', '고객 호칭', 'text')}
                {row('greeting_pattern', '인사 꼴', 'text')}
                {row('signature', '맺음 꼴', 'text')}
                {row('frequent_expressions', '자주 쓰는 표현', 'list')}
                {row('cta_patterns', '행동 유도', 'list')}
                {row('sentence_ending_examples', '대표 어미', 'list')}
                {row('emoji_whitelist', '쓰는 기호', 'list')}
                {guide.kind === 'marketing' && (
                  <>
                    {row('signature_locked', '늘 붙일 맺음말(브랜드 키트)', 'text')}
                    {row('slogans', '슬로건(브랜드 키트)', 'list')}
                    {row('required_words', '가능하면 넣을 말(브랜드 키트)', 'list')}
                    {row('banned_words', '쓰지 않을 말(브랜드 키트)', 'list')}
                  </>
                )}
              </div>
              {guide.editing && (
                <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200">
                  <span className="text-xs text-slate-600">고친 칸만 저장돼요. 다시 배워도 고친 칸은 그대로예요.</span>
                  <button onClick={saveGuide} disabled={busy === 'guide'} className="ml-auto px-5 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    {busy === 'guide' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}저장
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </JourneyModalShell>
    </>
  );
}

// ─────────────── 작은 조각 ───────────────

function TagChip({ ai, text }: { ai: boolean; text: string }) {
  return ai
    ? <span className="text-[11px] px-1.5 py-0.5 rounded border border-dashed border-violet-400 text-violet-800">{text} · AI</span>
    : <span className="text-[11px] px-1.5 py-0.5 rounded border border-violet-500 bg-violet-50 text-violet-900">{text}</span>;
}

function ChoiceChip({ on, onClick, text }: { on: boolean; onClick: () => void; text: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`h-8 px-3 rounded-full border text-xs font-semibold ${on ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{text}</button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 min-w-0">
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className="text-xs font-semibold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function PhraseList({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-slate-500">(없음)</span>;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {items.map((t, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[12px]"><SkeletonView text={t} /></span>)}
    </span>
  );
}

/** 목록 칸 편집 — 「/」로 나누는 글은 고치는 동안 초안으로 두고 칸을 벗어날 때 나눈다(K13-5) */
function ListEditor({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState(values.join(' / '));
  return (
    <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(draft.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean))}
      placeholder="여러 개는 / 로 나눠요"
      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded" />
  );
}

function Phone({ subject, body, adNote = false }: { subject: string; body: string; adNote?: boolean }) {
  return (
    <div className="w-full md:w-[320px] shrink-0 flex justify-center">
      <div className="w-full max-w-[300px] rounded-[2.5rem] border-4 border-slate-200 bg-slate-100 p-3">
        <div className="rounded-[2rem] bg-white overflow-hidden">
          <div className="p-4 min-h-[380px]">
            {adNote && <div className="text-[11px] text-slate-500 mb-1">(광고) 발송 때 자동으로 붙어요</div>}
            {subject && <div className="text-sm font-semibold text-slate-700 mb-2">{subject}</div>}
            <div className="rounded-2xl rounded-tl-sm bg-violet-100 text-violet-950 text-[14px] px-3.5 py-3 whitespace-pre-wrap leading-relaxed">{body || '(본문 없음)'}</div>
            {adNote && <div className="text-[11px] text-slate-500 mt-1">무료수신거부 080 발송 때 자동으로 붙어요</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
