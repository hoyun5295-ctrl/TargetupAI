/**
 * 정보 알림 여정 빌더 — 컴팩트 버튼+모달 (2026-06-30 여정 일반화 SP-A)
 *
 * 알림톡은 정보성(거래 통지)만 — 카카오 승인 템플릿이 본체.
 * AI Operator 디자인 표준(feedback_design_modal_first_simplicity): 컴팩트 메인 + 버튼→모달.
 *   - [알림톡 선택] 버튼 → 모달(승인 템플릿 선택). 선택 요약 표시.
 *   - 언제 보낼까(event/one_shot/standing) = 카드 (event면 거래 이벤트 / one_shot면 즉시·예약).
 *   - [대상] 버튼 → 조건 모달. event=이벤트 발생 고객+조건 / segment=조건으로 대상 지정.
 */

import { useState } from 'react';
import { Bell, ShoppingBag, CalendarCheck, ShoppingCart, Truck, ArrowLeft, Zap, Clock, Users, MessageSquare } from 'lucide-react';
import AlimtalkChannelPanel, {
  validateAlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
  type AlimtalkChannelState,
} from '../alimtalk/AlimtalkChannelPanel';
import { ModalShell, SummaryButton, AudienceModal, buildCustomerConditions, audienceSummary, type AudienceCondition } from './JourneyBuilderUi';
import { DateTimeField, isoToLocalInput, localInputToIso } from '../DateTimeField';

export type InfoAlertStartKind = 'event' | 'one_shot' | 'standing';

export interface InfoAlertBuildResult {
  templateCode: 'repeat' | 'reservation' | 'cart' | 'custom';
  startKind: InfoAlertStartKind;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  oneShotScheduledAt: string | null;
  name: string;
  step: {
    messageTemplate: string;
    alimtalkProfileId: string;
    alimtalkTemplateCode: string;
    alimtalkVariableMap: Record<string, string>;
    alimtalkNextType: 'N' | 'S' | 'L' | 'A' | 'B';
    alimtalkNextContents: string;
    alimtalkNextSubject?: string;
  };
}

const TX_EVENTS = [
  { key: 'purchase', templateCode: 'repeat' as const, triggerEvent: 'cdp.purchase', label: '주문 완료', desc: '구매가 일어나면', icon: ShoppingBag, gradient: 'from-emerald-400 to-teal-500', gated: false, filters: {} as Record<string, any> },
  { key: 'reservation', templateCode: 'reservation' as const, triggerEvent: 'cdp.reservation_created', label: '예약 확인', desc: '예약이 등록되면', icon: CalendarCheck, gradient: 'from-blue-400 to-indigo-500', gated: false, filters: {} },
  { key: 'cart', templateCode: 'cart' as const, triggerEvent: 'cdp.cart_abandon', label: '장바구니', desc: '장바구니에 담기면', icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500', gated: false, filters: { abandon_hours: 24 } },
  { key: 'shipped', templateCode: 'cart' as const, triggerEvent: 'custom_order_shipped', label: '배송 시작', desc: '배송이 시작되면', icon: Truck, gradient: 'from-violet-400 to-purple-500', gated: true, filters: {} },
];
type TxKey = (typeof TX_EVENTS)[number]['key'];

const EVENT_FIELDS: Record<TxKey, { key: string; label: string }[]> = {
  purchase: [{ key: 'order_no', label: '주문번호' }, { key: 'product_name', label: '상품명' }, { key: 'total_amount', label: '결제금액' }],
  reservation: [{ key: 'reservation_no', label: '예약번호' }, { key: 'reservation_date', label: '예약일시' }],
  cart: [{ key: 'product_name', label: '상품명' }],
  shipped: [{ key: 'tracking_no', label: '운송장번호' }, { key: 'carrier', label: '택배사' }],
};

const START_KINDS: { key: InfoAlertStartKind; label: string; desc: string; icon: typeof Zap; gradient: string }[] = [
  { key: 'event', label: '거래가 일어날 때', desc: '주문·예약·장바구니·배송 시 자동', icon: Zap, gradient: 'from-emerald-400 to-teal-500' },
  { key: 'one_shot', label: '지금 또는 예약', desc: '대상군에게 1회 발송', icon: Clock, gradient: 'from-sky-400 to-blue-500' },
  { key: 'standing', label: '조건 충족 시 계속', desc: '조건 만족 고객 상시', icon: Users, gradient: 'from-fuchsia-400 to-purple-500' },
];

const EMPTY_STATE: AlimtalkChannelState = {
  profileId: '', templateCode: '', templateId: '', variableMap: {}, nextType: 'N', nextContents: '', nextSubject: '',
};

interface Props {
  senders: AlimtalkSenderProfile[];
  templates: AlimtalkTemplate[];
  customerFieldOptions: { key: string; label: string }[];
  hasMallIntegration?: boolean;
  embedded?: boolean;
  onBuild: (result: InfoAlertBuildResult) => void;
  onBack: () => void;
}

export default function InfoAlertJourneyBuilder({ senders, templates, customerFieldOptions, hasMallIntegration = false, embedded = false, onBuild, onBack }: Props) {
  const [alimtalk, setAlimtalk] = useState<AlimtalkChannelState>(EMPTY_STATE);
  const [startKind, setStartKind] = useState<InfoAlertStartKind>('event');
  const [txKey, setTxKey] = useState<TxKey>('purchase');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [conditions, setConditions] = useState<AudienceCondition[]>([]);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showAudience, setShowAudience] = useState(false);

  const tx = TX_EVENTS.find((t) => t.key === txKey) || TX_EVENTS[0];
  const selectedTemplate = templates.find((t) => t.template_code === alimtalk.templateCode);
  const eventVars = startKind === 'event' ? (EVENT_FIELDS[txKey] || []) : [];

  // ★ 2026-07-27: 전환재발송 검증 공용 CT — 여정 활성화(백엔드)에서 막히기 전에 여기서 먼저 알려준다.
  const fallbackViolation = validateAlimtalkChannelState(alimtalk);
  const canBuild = Boolean(alimtalk.profileId && alimtalk.templateCode)
    && !fallbackViolation
    && (startKind !== 'one_shot' || scheduleMode === 'now' || !!scheduledAt);

  const handleBuild = () => {
    if (!canBuild) return;
    const conds = buildCustomerConditions(conditions);
    const triggerFilters: Record<string, any> = startKind === 'event' ? { ...tx.filters } : {};
    if (conds) Object.assign(triggerFilters, conds);
    const name = startKind === 'event' ? `${tx.label} 알림` : startKind === 'one_shot' ? '알림톡 1회 발송' : '알림톡 상시 발송';
    onBuild({
      templateCode: startKind === 'event' ? tx.templateCode : 'custom',
      startKind,
      triggerEvent: startKind === 'event' ? tx.triggerEvent : 'custom',
      triggerFilters,
      oneShotScheduledAt: startKind === 'one_shot' && scheduleMode === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      name,
      step: {
        messageTemplate: selectedTemplate?.content || '',
        alimtalkProfileId: alimtalk.profileId,
        alimtalkTemplateCode: alimtalk.templateCode,
        alimtalkVariableMap: alimtalk.variableMap,
        alimtalkNextType: alimtalk.nextType,
        alimtalkNextContents: alimtalk.nextContents,
        alimtalkNextSubject: alimtalk.nextSubject,
      },
    });
  };

  const noTemplates = senders.length === 0 || templates.length === 0;
  const templateSummary = noTemplates
    ? '승인된 발신프로필·템플릿이 없습니다'
    : selectedTemplate
      ? (selectedTemplate.template_name || selectedTemplate.template_code)
      : '알림톡 템플릿을 선택하세요';

  return (
    <div className="space-y-3 text-white">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10" aria-label="뒤로"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center"><Bell className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-base md:text-lg font-semibold">정보 알림 만들기</h2>
            <p className="text-xs text-white/50">카카오 승인 템플릿으로 알림톡 발송 (광고 아님)</p>
          </div>
        </div>
      )}

      {/* 어떤 알림톡 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<MessageSquare className="w-4 h-4 text-white" />} label="어떤 알림톡" value={templateSummary} accent="teal" onClick={() => setShowTemplate(true)} />

      {/* 언제 보낼까 — 시작 방식 카드 */}
      <div>
        <div className="text-xs font-semibold text-white/70 mb-1.5">언제 보낼까요</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {START_KINDS.map((sk) => {
            const Icon = sk.icon;
            const active = sk.key === startKind;
            return (
              <button key={sk.key} onClick={() => setStartKind(sk.key)} className={`p-3 rounded-xl border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.07] border-white/15 hover:bg-white/[0.12]'}`}>
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${sk.gradient} flex items-center justify-center mb-2`}><Icon className="w-4 h-4 text-white" /></div>
                <div className="text-sm font-semibold text-white">{sk.label}</div>
                <div className="text-[11px] text-white/60 mt-0.5">{sk.desc}</div>
              </button>
            );
          })}
        </div>

        {startKind === 'event' && (
          <div className="mt-2">
            <p className="text-[11px] text-white/50 mb-1.5">어떤 거래에 보낼까요 — 이벤트 변수(#{'{주문번호}'} 등) 사용 가능</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TX_EVENTS.map((t) => {
                const Icon = t.icon;
                const active = t.key === txKey;
                const locked = t.gated && !hasMallIntegration;
                return (
                  <button key={t.key} onClick={() => { if (!locked) setTxKey(t.key); }} disabled={locked}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.1]'} ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${t.gradient} flex items-center justify-center mb-1.5`}><Icon className="w-3.5 h-3.5 text-white" /></div>
                    <div className="text-xs font-semibold text-white">{t.label}</div>
                    <div className="text-[10px] text-white/55 mt-0.5">{locked ? '자사몰 연동 시' : t.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {startKind === 'one_shot' && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              {(['now', 'scheduled'] as const).map((m) => (
                <button key={m} onClick={() => setScheduleMode(m)} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${scheduleMode === m ? 'bg-sky-500/20 border-sky-400/60 text-white' : 'bg-white/[0.06] border-white/15 text-white/70 hover:bg-white/[0.1]'}`}>
                  {m === 'now' ? '지금 발송' : '예약 발송'}
                </button>
              ))}
            </div>
            {scheduleMode === 'scheduled' && (
              <DateTimeField
                value={localInputToIso(scheduledAt)}
                onChange={(iso) => setScheduledAt(isoToLocalInput(iso))}
                tone="dark"
              />
            )}
            <p className="text-[10px] text-white/40 italic">발송 가능 시간(08~21시 KST) 밖이면 다음 가능 시각으로 자동 조정됩니다.</p>
          </div>
        )}

        {startKind !== 'event' && (
          <p className="text-[11px] text-amber-200/70 mt-2">이벤트 데이터가 없어 템플릿 변수는 고객 필드(이름·등급 등)만 매핑됩니다.</p>
        )}
      </div>

      {/* 대상 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<Users className="w-4 h-4 text-white" />} label={startKind === 'event' ? '대상 (이벤트 발생 고객 + 조건)' : '대상'} value={audienceSummary(conditions)} accent="teal" onClick={() => setShowAudience(true)} />

      <div className="flex justify-end items-center gap-3 pt-1">
        {alimtalk.templateCode && fallbackViolation && (
          <span className="text-[11px] text-rose-300">{fallbackViolation}</span>
        )}
        <button onClick={handleBuild} disabled={!canBuild} className="px-5 py-3 bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">다음 — 흐름 검토</button>
      </div>

      {showTemplate && (
        <ModalShell title="어떤 알림톡을 보낼까요" subtitle="카카오 승인 템플릿 선택 (광고 아님)" icon={<MessageSquare className="w-4 h-4 text-white" />} onClose={() => setShowTemplate(false)}
          footer={<button onClick={() => setShowTemplate(false)} className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 text-sm font-medium hover:opacity-90">완료</button>}>
          {senders.length === 0 ? (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">승인된 발신프로필이 없습니다. 알림톡 발송 메뉴에서 발신프로필을 먼저 등록해주세요.</div>
          ) : templates.length === 0 ? (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">승인된 알림톡 템플릿이 없습니다. 알림톡 발송 메뉴에서 템플릿 등록 + 검수 통과 후 사용해주세요.</div>
          ) : (
            <AlimtalkChannelPanel
              senders={senders}
              templates={templates}
              customerFieldOptions={[...customerFieldOptions, ...eventVars]}
              value={alimtalk}
              onChange={setAlimtalk}
            />
          )}
        </ModalShell>
      )}
      {showAudience && (
        <AudienceModal initial={conditions} onSave={(c) => { setConditions(c); setShowAudience(false); }} onClose={() => setShowAudience(false)} />
      )}
    </div>
  );
}
