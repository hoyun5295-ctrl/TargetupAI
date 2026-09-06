/**
 * MaterialQuickPanel — 편집기 입구용 "재료로 만들기" (★ 2026-09-06 S6 · 설계서 §8)
 *
 * MaterialInput(compact) + 서버 견적 + 버튼 1개. 클릭 → 재료 저장(텍스트 비면 판독 자동 선행) → 채널 생성 라우트의 `materials` 분기 → onDone.
 *  - DM: POST /api/dm/ai/one-shot-generate { materials } → 초안 DM id(draft_id) · 호출부가 그 id 를 편집기로 연다
 *  - EMAIL: POST /api/email/ai/generate-sections { materials, is_ad } → sections·subjects·preheader · 호출부가 편집기 상태에 넣는다
 * 크레딧은 서버 견적(costOverride) 그대로 · native dialog 0 · 모델명 0. 원클릭 캠페인 페이지는 결과 2열 화면이 따로 있어 이 패널을 쓰지 않는다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Sparkles, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import MaterialInput, { type MaterialValue } from './MaterialInput';
import CreditConfirmModal from './credit/CreditConfirmModal';

interface Quote { enabled: boolean; plan_locked: boolean; total: number; parts: Array<{ key: string; label: string; cost: number }> }
export interface MaterialQuickDone { channel: 'dm' | 'email'; data: any; draftId: string | null; extracted: boolean; text: string }

const token = () => localStorage.getItem('token');
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });

export default function MaterialQuickPanel({ channel, isAd, disabled, onDone, onToast, defaultOpen }: {
  channel: 'dm' | 'email';
  isAd?: boolean;
  disabled?: boolean;
  onDone: (r: MaterialQuickDone) => void | Promise<void>;
  onToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [material, setMaterial] = useState<MaterialValue>({ files: [], text: '', link: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const hasText = material.text.trim().length >= 10;
  const canRun = material.files.length > 0 || hasText;

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/event-campaigns/materials/quote?images=${material.files.length}&has_text=${hasText ? 1 : 0}`, { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json();
        if (r.ok && d?.success) {
          // 이메일 채널은 생성 키가 다르다(email-ai-generate) — 견적 표시는 서버 부품 그대로, 생성 항목 라벨만 채널에 맞춘다
          setQuote({ enabled: d.enabled !== false, plan_locked: !!d.plan_locked, total: Number(d.total) || 0, parts: Array.isArray(d.parts) ? d.parts : [] });
        }
      } catch { /* 견적 실패 = 금액 미표시(차감은 서버) */ }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, material.files.length, hasText]);

  const run = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      setStage('재료를 저장하고 있습니다');
      const fd = new FormData();
      material.files.forEach((f, i) => fd.append('images', f, f.name || `material_${i + 1}`));
      if (hasText) fd.append('event_text', material.text.trim());
      const mr = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const md = await mr.json().catch(() => ({}));
      if (md?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!mr.ok || md?.success === false) throw new Error(String(md?.error || '재료를 저장하지 못했습니다.'));
      const images = Array.isArray(md.images) ? md.images : [];
      const text = String(md.event_text || '');
      const extracted = md.extracted === true;
      if (extracted && text) setMaterial((cur) => ({ ...cur, text }));

      setStage(channel === 'dm' ? '모바일 DM 구성을 만들고 있습니다' : '이메일 블록을 만들고 있습니다');
      const materials = { images, event_text: text, extracted, events: md.events || null, link: material.link.trim() || null };
      const url = channel === 'dm' ? '/api/dm/ai/one-shot-generate' : '/api/email/ai/generate-sections';
      const body = channel === 'dm' ? { materials } : { materials, is_ad: !!isAd };
      const gr = await fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
      const gd = await gr.json().catch(() => ({}));
      if (gd?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!gr.ok || gd?.success === false || !gd?.data) throw new Error(String(gd?.error || '시안을 만들지 못했습니다.'));
      await onDone({ channel, data: gd.data, draftId: gd.data.draft_id ? String(gd.data.draft_id) : null, extracted, text });
      if (extracted) onToast('이미지에서 읽은 내용을 입력칸에 채웠습니다. 확인·수정한 뒤 다시 만들면 혜택 수치가 그대로 반영됩니다.', 'warning');
    } catch (e: any) {
      onToast(e?.message || '시안을 만들지 못했습니다. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
      setBusy(false); setStage('');
    }
  };

  if (quote && !quote.enabled) return null;
  const planLocked = !!quote?.plan_locked;

  return (
    <div className="rounded-[10px] border border-violet-400/30 bg-violet-500/5">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={disabled}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-500/10 disabled:opacity-40 rounded-[10px]">
        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-fuchsia-300" /> 재료(이미지·행사 내용)로 만들기</span>
        {open ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          {planLocked && <div className="text-[11px] text-amber-200 inline-flex items-center gap-1"><Lock className="w-3 h-3" /> 모바일 DM 요금제에서 열립니다</div>}
          <MaterialInput value={material} onChange={setMaterial} disabled={busy || !!disabled || planLocked} compact={channel === 'email'} onReject={(m) => onToast(m, 'warning')} />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-white/45">
              {quote ? `${quote.parts.map((p) => `${p.label} ${p.cost}`).join(' + ')} = ${quote.total} 크레딧` : '견적 계산 중'}
            </span>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canRun || busy || !!disabled || planLocked}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-xs font-bold hover:brightness-110 disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {busy ? (stage || '만드는 중') : (channel === 'dm' ? '재료로 DM 초안 만들기' : '재료로 이메일 초안 만들기')}
            </button>
          </div>
        </div>
      )}
      <CreditConfirmModal
        open={confirmOpen}
        source={channel === 'dm' ? 'dm-ai-generate' : 'email-ai-generate'}
        costOverride={quote ? quote.total : undefined}
        description={channel === 'dm' ? '초안은 모바일 DM 목록에 저장되고 편집기에서 바로 이어집니다.' : '생성된 블록이 편집기의 현재 블록을 교체합니다.'}
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
