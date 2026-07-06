/**
 * EventCampaignModal — 행사 캠페인 자동 생성 (2026-07-07(4))
 *
 * 행사 내용 한 번 입력 → 모바일DM / 이메일 / 인앱 중 "선택한 채널만" AI 초안 생성.
 * - 무조건 3채널 생성 없음: 채널 슬롯별 예상 크레딧 표시 + 선택분만 생성·과금 (크레딧 낭비 차단)
 * - 인앱 표시 불가 회사(네이버 단독 등) = 인앱 슬롯 잠금 (기존 display-eligibility 게이트 재사용)
 * - 빈 슬롯은 나중에 "이 행사로 이어서 만들기" — 행사 원문 재입력 없이 채널 추가
 * - 편집 진입 = 각 채널 기존 편집기 그대로 (sessionStorage 초안 handoff, 30분 TTL)
 * - 혜택 영구 룰 양립: 행사 원문에 기재된 혜택만 원문 그대로 (백엔드 event-brief CT 검증)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Layers, Loader2, Lock, Mail, Smartphone, Sparkles, X } from 'lucide-react';
import { CONFIRM_CREDIT_COSTS } from '../constants/credit';

type ChannelKey = 'dm' | 'email' | 'inapp';

// 백엔드 ai-credit-calc CREDIT_COST_MAP 1:1 (dm-ai-generate 5 / email-ai-generate 3 / inapp-ai-generator 3)
const CH_COSTS: Record<ChannelKey, number> = {
  dm: CONFIRM_CREDIT_COSTS['dm-ai-generate'] ?? 5,
  email: CONFIRM_CREDIT_COSTS['email-ai-generate'] ?? 3,
  inapp: CONFIRM_CREDIT_COSTS['inapp-ai-generator'] ?? 3,
};

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

const CHANNELS: ChannelMeta[] = [
  { key: 'dm', label: '모바일 DM', desc: '카드형 미디어 페이지 + 문자 발송', icon: Smartphone },
  { key: 'email', label: '이메일', desc: '비주얼 블록 이메일', icon: Mail },
  { key: 'inapp', label: '인앱 메시지', desc: '자사몰 팝업·슬라이드', icon: Layers },
];

export default function EventCampaignModal({ open, onClose, initialText }: {
  open: boolean;
  onClose: () => void;
  initialText?: string;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [sel, setSel] = useState<Record<ChannelKey, boolean>>({ dm: true, email: true, inapp: true });
  const [inappBlock, setInappBlock] = useState<string | null>(null);
  const [running, setRunning] = useState<ChannelKey | null>(null);
  const [results, setResults] = useState<Partial<Record<ChannelKey, any>>>({});
  const [errs, setErrs] = useState<Partial<Record<ChannelKey, string>>>({});

  const token = () => localStorage.getItem('token');
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });

  useEffect(() => {
    if (!open) return;
    setText(initialText || '');
    setResults({});
    setErrs({});
    // 인앱 표시 가능성 — 표시할 곳 없으면 슬롯 잠금 (크레딧 낭비 차단)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalCost = useMemo(
    () => CHANNELS.reduce((sum, c) => sum + (sel[c.key] && !results[c.key] ? CH_COSTS[c.key] : 0), 0),
    [sel, results],
  );

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
    } catch (e: any) {
      setErrs((er) => ({ ...er, [ch]: e?.message || '생성 실패' }));
    } finally {
      setRunning(null);
    }
  };

  const generateSelected = async () => {
    for (const c of CHANNELS) {
      if (sel[c.key] && !results[c.key] && !(c.key === 'inapp' && inappBlock)) {
        // 순차 생성 — 실패한 채널은 오류 표시 후 다음 채널 계속 (이미 성공분 크레딧은 각 채널 몫)
        // eslint-disable-next-line no-await-in-loop
        await generateOne(c.key);
      }
    }
  };

  const openEditor = (ch: ChannelKey) => {
    const r = results[ch];
    if (!r) return;
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
  const busy = running !== null;
  const anyResult = CHANNELS.some((c) => !!results[c.key]);

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
              <h3 className="text-base font-bold text-white">행사 캠페인 자동 생성</h3>
              <p className="text-[11px] text-white/50">행사 내용 한 번 입력 — 고른 채널만 AI 초안 생성, 이미지 업로드와 잔손질만 하면 됩니다</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 행사 내용 입력 */}
          <div>
            <label className="text-xs font-bold text-white/80 mb-1.5 block">행사 내용</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy || anyResult}
              placeholder={'행사 내용을 자유롭게 붙여넣어 주세요. 한 줄이든 줄바꿈 나열이든 무관합니다.\n예)\n여름맞이 신상품 출시전\n7/10~7/20\n전 품목 신상품 대상\n구매 고객 사은품 증정'}
              className="w-full h-32 px-3 py-2.5 bg-slate-950/60 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 resize-y focus:outline-none focus:border-fuchsia-400/40"
            />
            <p className="text-[10px] text-white/40 mt-1">행사 내용에 직접 적으신 혜택만 초안에 그대로 사용됩니다 — AI가 혜택을 지어내지 않습니다.</p>
          </div>

          {/* 채널 3슬롯 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {CHANNELS.map((c) => {
              const Ic = c.icon;
              const locked = c.key === 'inapp' && !!inappBlock;
              const done = !!results[c.key];
              const err = errs[c.key];
              const isRunning = running === c.key;
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
                        ? <span className="text-emerald-300">생성 완료 — {summaryOf(c.key)}</span>
                        : locked
                          ? <span className="text-amber-300/80">표시할 곳 없음 — 연동 후 이용 가능</span>
                          : <span className="text-white/50">예상 {CH_COSTS[c.key]} 크레딧</span>}
                    </p>
                    {err && <p className="text-[10px] text-rose-300 mt-1">{err}</p>}
                  </button>
                  {isRunning && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-fuchsia-200"><Loader2 className="w-3 h-3 animate-spin" /> 생성 중...</div>
                  )}
                  {done && (
                    <button onClick={() => openEditor(c.key)} className="mt-2 w-full text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-lg py-1.5">
                      편집 열기 (이미지·잔손질)
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
              {totalCost > 0 ? <>선택 채널 생성 시 <strong className="text-white/80">{totalCost} 크레딧</strong>이 차감됩니다 (성공한 채널만)</> : anyResult ? '빈 슬롯은 언제든 이 행사로 이어서 만들 수 있습니다' : '생성할 채널을 선택해주세요'}
            </p>
            <button
              onClick={generateSelected}
              disabled={busy || !text.trim() || totalCost === 0}
              className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {busy ? '생성 중...' : anyResult ? '선택 채널 마저 생성' : '선택 채널 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
