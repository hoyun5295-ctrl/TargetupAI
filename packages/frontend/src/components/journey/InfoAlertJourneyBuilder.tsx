/**
 * 정보 알림 여정 빌더 — 템플릿 우선 (2026-06-30 여정 일반화 SP-A)
 *
 * 알림톡은 정보성(거래 통지)만 — 광고성 X. 카카오 승인 템플릿이 본체.
 * 흐름: ① 어떤 알림톡(승인 템플릿 선택) → ② 언제 보낼까(시작 방식) → ③ 누구에게(대상).
 *   - event    : 거래가 일어날 때(주문/예약/장바구니/배송). 이벤트 변수(#{주문번호} 등) 사용 가능.
 *   - one_shot : 지금 또는 예약 시각에 대상군 1회. 고객 필드 변수만.
 *   - standing : 조건 충족 고객에게 계속. 고객 필드 변수만.
 * 부모(JourneysPage)가 결과를 받아 start_kind/트리거/대상 조건을 저장 payload로 조립한다.
 */

import { useState } from 'react';
import { Bell, ShoppingBag, CalendarCheck, ShoppingCart, Truck, ArrowLeft, Zap, Clock, Users, Plus, X } from 'lucide-react';
import AlimtalkChannelPanel, {
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
  type AlimtalkChannelState,
} from '../alimtalk/AlimtalkChannelPanel';

export type InfoAlertStartKind = 'event' | 'one_shot' | 'standing';
export interface AudienceCondition { field: string; op: string; value: string; }

export interface InfoAlertBuildResult {
  templateCode: 'repeat' | 'reservation' | 'cart' | 'custom';
  startKind: InfoAlertStartKind;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  oneShotScheduledAt: string | null;   // ISO (예약) 또는 null(즉시)
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

// 대상 조건 — applyCustomerConditions 허용 필드(백엔드 정합).
const COND_FIELDS = [
  { key: 'grade', label: '등급' },
  { key: 'region', label: '지역' },
  { key: 'store_name', label: '매장명' },
  { key: 'store_code', label: '매장코드' },
  { key: 'age', label: '나이' },
  { key: 'purchase_count', label: '구매횟수' },
  { key: 'total_purchase_amount', label: '누적구매액' },
];
const COND_OPS = [
  { key: '==', label: '같음' },
  { key: '!=', label: '다름' },
  { key: '>=', label: '이상' },
  { key: '<=', label: '이하' },
  { key: '>', label: '초과' },
  { key: '<', label: '미만' },
];

const START_KINDS: { key: InfoAlertStartKind; label: string; desc: string; icon: typeof Zap; gradient: string }[] = [
  { key: 'event', label: '거래가 일어날 때', desc: '주문·예약·장바구니·배송 시 자동 발송', icon: Zap, gradient: 'from-emerald-400 to-teal-500' },
  { key: 'one_shot', label: '지금 또는 예약 발송', desc: '지정 대상군에게 1회 발송', icon: Clock, gradient: 'from-sky-400 to-blue-500' },
  { key: 'standing', label: '조건 충족 고객에게 계속', desc: '조건을 만족하는 고객에게 상시 발송', icon: Users, gradient: 'from-fuchsia-400 to-purple-500' },
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
  const [scheduledAt, setScheduledAt] = useState<string>(''); // datetime-local
  const [conditions, setConditions] = useState<AudienceCondition[]>([]);

  const tx = TX_EVENTS.find((t) => t.key === txKey) || TX_EVENTS[0];
  const selectedTemplate = templates.find((t) => t.template_code === alimtalk.templateCode);
  const eventVars = startKind === 'event' ? (EVENT_FIELDS[txKey] || []) : [];

  const canBuild = Boolean(alimtalk.profileId && alimtalk.templateCode)
    && (startKind !== 'one_shot' || scheduleMode === 'now' || !!scheduledAt);

  const addCondition = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const updateCondition = (i: number, patch: Partial<AudienceCondition>) =>
    setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));

  const handleBuild = () => {
    if (!canBuild) return;
    const validConds = conditions.filter((c) => c.field && c.op && String(c.value).trim() !== '');
    const triggerFilters: Record<string, any> = startKind === 'event' ? { ...tx.filters } : {};
    if (validConds.length > 0) {
      triggerFilters.customer_conditions = validConds.map((c) => ({ field: c.field, op: c.op, value: c.value }));
      triggerFilters.logic = 'AND';
    }
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

  return (
    <div className="space-y-4 text-white">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10" aria-label="뒤로">
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-semibold">정보 알림 만들기</h2>
            <p className="text-xs text-white/50">카카오 승인 템플릿으로 알림톡을 발송합니다 (광고 아님)</p>
          </div>
        </div>
      )}

      {/* ① 어떤 알림톡 */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-teal-300">①</span> 어떤 알림톡을 보낼까요</h3>
        {senders.length === 0 ? (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">
            승인된 발신프로필이 없습니다. 알림톡 발송 메뉴에서 발신프로필을 먼저 등록해주세요.
          </div>
        ) : templates.length === 0 ? (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">
            승인된 알림톡 템플릿이 없습니다. 알림톡 발송 메뉴에서 템플릿 등록 + 검수 통과 후 사용해주세요.
          </div>
        ) : (
          <AlimtalkChannelPanel
            senders={senders}
            templates={templates}
            customerFieldOptions={[...customerFieldOptions, ...eventVars]}
            value={alimtalk}
            onChange={setAlimtalk}
          />
        )}
      </div>

      {/* ② 언제 보낼까 (시작 방식) */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-teal-300">②</span> 언제 보낼까요</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {START_KINDS.map((sk) => {
            const Icon = sk.icon;
            const active = sk.key === startKind;
            return (
              <button
                key={sk.key}
                onClick={() => setStartKind(sk.key)}
                className={`p-3 rounded-xl border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.07] border-white/15 hover:bg-white/[0.12]'}`}
              >
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${sk.gradient} flex items-center justify-center mb-2`}>
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div className="text-sm font-semibold text-white">{sk.label}</div>
                <div className="text-[11px] text-white/60 mt-0.5">{sk.desc}</div>
              </button>
            );
          })}
        </div>

        {/* event → 거래 이벤트 선택 */}
        {startKind === 'event' && (
          <div className="mt-3">
            <p className="text-[11px] text-white/50 mb-1.5">어떤 거래에 보낼까요 — #{'{주문번호}'} 같은 이벤트 변수를 쓸 수 있어요</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TX_EVENTS.map((t) => {
                const Icon = t.icon;
                const active = t.key === txKey;
                const locked = t.gated && !hasMallIntegration;
                return (
                  <button
                    key={t.key}
                    onClick={() => { if (!locked) setTxKey(t.key); }}
                    disabled={locked}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.1]'} ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${t.gradient} flex items-center justify-center mb-1.5`}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="text-xs font-semibold text-white">{t.label}</div>
                    <div className="text-[10px] text-white/55 mt-0.5">{locked ? '자사몰 연동 시' : t.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* one_shot → 즉시/예약 */}
        {startKind === 'one_shot' && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              {(['now', 'scheduled'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setScheduleMode(m)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${scheduleMode === m ? 'bg-sky-500/20 border-sky-400/60 text-white' : 'bg-white/[0.06] border-white/15 text-white/70 hover:bg-white/[0.1]'}`}
                >
                  {m === 'now' ? '지금 발송' : '예약 발송'}
                </button>
              ))}
            </div>
            {scheduleMode === 'scheduled' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            )}
            <p className="text-[10px] text-white/40 italic">발송 가능 시간(08~21시 KST) 밖이면 다음 가능 시각으로 자동 조정됩니다.</p>
          </div>
        )}

        {startKind !== 'event' && (
          <p className="text-[11px] text-amber-200/70 mt-2">이벤트 데이터가 없어 템플릿 변수는 고객 필드(이름·등급 등)만 매핑됩니다.</p>
        )}
      </div>

      {/* ③ 누구에게 (대상 조건) */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-teal-300">③</span> 누구에게 보낼까요</h3>
        <p className="text-[11px] text-white/50 mb-2">
          {startKind === 'event'
            ? '거래가 일어난 고객에게 발송합니다. 조건을 더하면 그 중 일부에게만 보냅니다 (선택).'
            : '조건을 만족하는 고객에게 발송합니다. 조건이 없으면 전체 활성 고객이 대상입니다.'}
        </p>
        <div className="space-y-2">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} className="bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white [&>option]:bg-slate-800">
                {COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value })} className="bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white [&>option]:bg-slate-800">
                {COND_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="값" className="flex-1 min-w-0 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
              <button onClick={() => removeCondition(i)} className="p-1.5 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10" aria-label="조건 삭제">
                <X className="w-3.5 h-3.5 text-white/60" />
              </button>
            </div>
          ))}
          <button onClick={addCondition} className="inline-flex items-center gap-1 text-xs text-teal-300 hover:text-teal-200">
            <Plus className="w-3.5 h-3.5" /> 조건 추가
          </button>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={handleBuild}
          disabled={!canBuild}
          className="px-5 py-3 bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          다음 — 흐름 검토
        </button>
      </div>
    </div>
  );
}
