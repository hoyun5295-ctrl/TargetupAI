/**
 * TrialUpsellModal — 무료 체험을 다 썼을 때 뜨는 요금제 안내 창 (2026-09-25 Harold 지시 · 목업 승인)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md §6
 *
 * 순서 = 지금까지 써 본 효과(우리 검사 기록) → 스타터 카드 한 장 → [스타터 요금제 알아보기] · [다음에 할게요].
 * "이번 문자는 검사 없이 그대로 보낼 수 있어요"로 막지 않는다는 것을 알린다.
 * ⛔ 가격·크레딧·무료 문자 수량은 요금제 표(`GET /api/plans`)에서 읽는다. 화면에 숫자를 적어 두지 않는다.
 * ⛔ 효과를 장담하는 말을 쓰지 않는다. 기능이 실제로 하는 일만 적는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react';
import type { SendCheckStatus } from '../../utils/send-checks';

interface StarterPlan {
  name: string;
  price: number;
  credits: number;
  freeSms: number;
  freeLms: number;
}

interface Props {
  kind: 'spam' | 'spell' | null;
  status: SendCheckStatus | null;
  onClose: () => void;
}

export default function TrialUpsellModal({ kind, status, onClose }: Props) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<StarterPlan | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!kind) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/plans');
        const data = await res.json();
        const row = (data.plans || []).find((p: any) => String(p.plan_code).toUpperCase() === 'STARTER');
        if (!row || !alive) return;
        const q = (data.planQuotas || {})[String(row.plan_code)] || {};
        setPlan({
          name: String(row.plan_name || '스타터'),
          price: Number(row.monthly_price) || 0,
          credits: Number(row.ai_credits_per_month) || 0,
          freeSms: Number(q.SMS) || 0,
          freeLms: Number(q.LMS) || 0,
        });
      } catch {
        /* 카드 숫자 없이도 창은 뜬다 */
      }
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { alive = false; document.removeEventListener('keydown', onKey, true); };
  }, [kind]);

  if (!kind) return null;
  const spam = status?.spamTrial;
  const spell = status?.spell;
  const spellLimit = spell?.limit ?? 5;
  const spellUsed = Math.min(spell?.used ?? 0, spellLimit);
  const spamLimit = spam?.limit ?? 3;
  const spamUsed = Math.min(spam?.used ?? 0, spamLimit);
  const planName = plan?.name || '스타터';

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-stone-900/55" role="dialog" aria-modal="true" aria-labelledby="ds-upsell-title">
      <div className="ds-upsell w-full max-w-[460px]">
        <div className="ds-upsell__top">
          <button type="button" className="ds-dlg__x ds-upsell__x" onClick={onClose} aria-label="닫기"><X size={16} strokeWidth={2} /></button>
          <span className="ds-upsell__eyebrow"><i />{kind === 'spam' ? '무료 스팸 검사 체험 끝' : '이번 달 무료 맞춤법 검사 끝'}</span>
          <h2 id="ds-upsell-title">
            {kind === 'spam' ? `무료 스팸 검사 ${spamLimit}번을 모두 썼어요` : `이번 달 무료 맞춤법 검사 ${spellLimit}번을 모두 썼어요`}
          </h2>
          <p>
            {kind === 'spam'
              ? `${planName}부터는 보낼 때마다 막히는지 먼저 확인할 수 있어요.`
              : `다음 달 1일에 다시 ${spellLimit}번이 채워져요. ${planName}부터는 횟수 걱정 없이 쓸 수 있어요.`}
          </p>
        </div>

        <div className="ds-upsell__body">
          <div className="ds-upsell__recap">
            <div className="ds-upsell__h">지금까지 이렇게 썼어요</div>
            <div className="ds-upsell__row">
              <span className="ds-upsell__ic ds-upsell__ic--amber"><ShieldCheck size={15} strokeWidth={2.2} /></span>
              <span className="ds-upsell__t">
                스팸 검사 <span className="ds-num">{spamUsed}</span>번
                <small>{(spam?.blockedFound ?? 0) > 0 ? `막히는 문자 ${spam?.blockedFound}번을 보내기 전에 찾았어요` : '보내기 전에 3사 수신을 확인했어요'}</small>
              </span>
              <span className="ds-upsell__meter">{Array.from({ length: spamLimit }, (_, i) => <i key={i} className={i < spamUsed ? 'is-on is-amber' : ''} />)}</span>
            </div>
            <div className="ds-upsell__row">
              <span className="ds-upsell__ic ds-upsell__ic--emerald">가</span>
              <span className="ds-upsell__t">
                맞춤법 검사 <span className="ds-num">{spellUsed}</span>번
                <small>{(spell?.issuesFound ?? 0) > 0 ? `이번 달 고칠 곳 ${spell?.issuesFound}곳을 찾았어요` : '이번 달 검사한 횟수예요'}</small>
              </span>
              <span className="ds-upsell__meter">{Array.from({ length: spellLimit }, (_, i) => <i key={i} className={i < spellUsed ? 'is-on is-emerald' : ''} />)}</span>
            </div>
          </div>

          <div className="ds-upsell__plan">
            <div className="ds-upsell__plan-head">
              <b>{planName}</b>
              {plan && plan.price > 0 && <span className="ds-num">{plan.price.toLocaleString()}원<small>/월</small></span>}
            </div>
            {plan && plan.price > 0 && <div className="ds-upsell__vat">VAT 별도</div>}
            <ul>
              <li><i><Check size={11} strokeWidth={3} /></i><span><b>스팸 검사</b>를 보낼 때마다<small>테스트 문자는 발송 요금으로 청구돼요</small></span></li>
              <li><i><Check size={11} strokeWidth={3} /></i><span><b>맞춤법 검사</b> 무제한<small>크레딧이 들지 않아요</small></span></li>
              {plan && plan.credits > 0 && (
                <li><i><Check size={11} strokeWidth={3} /></i><span>매달 <b className="ds-num">AI 크레딧 {plan.credits.toLocaleString()}</b><small>AI 문구 추천 · AI 다듬기 같은 AI 기능에 써요</small></span></li>
              )}
              {plan && (plan.freeSms > 0 || plan.freeLms > 0) && (
                <li><i><Check size={11} strokeWidth={3} /></i><span>매달 <b>무료 문자</b> {plan.freeSms > 0 && <span className="ds-num">SMS {plan.freeSms.toLocaleString()}건</span>}{plan.freeSms > 0 && plan.freeLms > 0 && ' · '}{plan.freeLms > 0 && <span className="ds-num">LMS {plan.freeLms.toLocaleString()}건</span>}<small>요금제에 들어 있는 수량만큼 먼저 차감돼요</small></span></li>
              )}
            </ul>
          </div>
        </div>

        <div className="ds-upsell__foot">
          <button type="button" className="ds-upsell__cta" onClick={() => { onClose(); navigate('/pricing'); }}>
            {planName} 요금제 알아보기<ArrowRight size={15} strokeWidth={2.2} />
          </button>
          <button type="button" className="ds-upsell__later" onClick={onClose}>다음에 할게요</button>
          <div className="ds-upsell__reassure">이번 문자는 검사 없이 그대로 보낼 수 있어요.</div>
        </div>
        <p className="ds-upsell__src">Data source: 요금제 표 · 검사 기록</p>
      </div>
    </div>
  );
}
