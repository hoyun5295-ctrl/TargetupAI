/**
 * 정보 알림 여정 빌더 (2026-06-22)
 *
 * 알림톡은 정보성(거래 통지)만 가능 — 광고성 X. 마케팅 여정과 진입을 분기한다.
 * 거래 이벤트(주문완료/예약/장바구니) 선택 + 카카오 승인 템플릿 선택(공용 AlimtalkChannelPanel) →
 * 부모(JourneysPage)에 결과를 넘기면 부모가 aiPkg(kakao step)로 조립해 기존 검토(review) 흐름을 재사용한다.
 */

import { useState } from 'react';
import { Bell, ShoppingBag, CalendarCheck, ShoppingCart, Truck, ArrowLeft } from 'lucide-react';
import AlimtalkChannelPanel, {
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
  type AlimtalkChannelState,
} from '../alimtalk/AlimtalkChannelPanel';

export interface InfoAlertBuildResult {
  templateCode: 'repeat' | 'reservation' | 'cart';
  triggerEvent: string;
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
  { key: 'purchase', templateCode: 'repeat' as const, triggerEvent: 'cdp.purchase', label: '주문 완료', desc: '구매가 일어나면', icon: ShoppingBag, gradient: 'from-emerald-400 to-teal-500', gated: false },
  { key: 'reservation', templateCode: 'reservation' as const, triggerEvent: 'cdp.reservation_created', label: '예약 확인', desc: '예약이 등록되면', icon: CalendarCheck, gradient: 'from-blue-400 to-indigo-500', gated: false },
  { key: 'cart', templateCode: 'cart' as const, triggerEvent: 'cdp.cart_abandon', label: '장바구니', desc: '장바구니에 담기면', icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500', gated: false },
  // ★ 배송은 표준 이벤트가 없어 자사몰 custom 이벤트 연동이 선행돼야 함 — 미연동 시 잠금 + 안내
  { key: 'shipped', templateCode: 'cart' as const, triggerEvent: 'custom_order_shipped', label: '배송 시작', desc: '배송이 시작되면', icon: Truck, gradient: 'from-violet-400 to-purple-500', gated: true },
];

type TxKey = (typeof TX_EVENTS)[number]['key'];

// 거래 이벤트별 흔한 properties 변수 후보 (자사몰 cdp_events.properties 키 기준 — 실제 키가 다르면 매핑에서 수정 가능).
// 알림톡 #{변수}를 @@키@@로 매핑하면 journey-executor가 발송 시 진입 이벤트 데이터로 채운다(Phase 3).
const EVENT_FIELDS: Record<TxKey, { key: string; label: string }[]> = {
  purchase: [{ key: 'order_no', label: '주문번호' }, { key: 'product_name', label: '상품명' }, { key: 'total_amount', label: '결제금액' }],
  reservation: [{ key: 'reservation_no', label: '예약번호' }, { key: 'reservation_date', label: '예약일시' }],
  cart: [{ key: 'product_name', label: '상품명' }],
  shipped: [{ key: 'tracking_no', label: '운송장번호' }, { key: 'carrier', label: '택배사' }],
};

const EMPTY_STATE: AlimtalkChannelState = {
  profileId: '',
  templateCode: '',
  templateId: '',
  variableMap: {},
  nextType: 'N',
  nextContents: '',
  nextSubject: '',
};

interface Props {
  senders: AlimtalkSenderProfile[];
  templates: AlimtalkTemplate[];
  customerFieldOptions: { key: string; label: string }[];
  /** 자사몰(CDP) 연동 활성 여부 — 배송 등 custom 이벤트 트리거 잠금 해제용 (미연동 시 false). */
  hasMallIntegration?: boolean;
  /** 모달 안에 임베드 — 모달 헤더가 제목/닫기를 제공하므로 자체 헤더(뒤로+제목)를 숨긴다. */
  embedded?: boolean;
  onBuild: (result: InfoAlertBuildResult) => void;
  onBack: () => void;
}

export default function InfoAlertJourneyBuilder({ senders, templates, customerFieldOptions, hasMallIntegration = false, embedded = false, onBuild, onBack }: Props) {
  const [txKey, setTxKey] = useState<TxKey>('purchase');
  const [alimtalk, setAlimtalk] = useState<AlimtalkChannelState>(EMPTY_STATE);

  const tx = TX_EVENTS.find((t) => t.key === txKey) || TX_EVENTS[0];
  const selectedTemplate = templates.find((t) => t.template_code === alimtalk.templateCode);
  const canBuild = Boolean(alimtalk.profileId && alimtalk.templateCode);

  const handleBuild = () => {
    if (!canBuild) return;
    onBuild({
      templateCode: tx.templateCode,
      triggerEvent: tx.triggerEvent,
      name: `${tx.label} 알림`,
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
    <div className="space-y-4">
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
          <p className="text-xs text-white/50">거래가 일어나면 카카오 승인 템플릿으로 알림톡을 자동 발송합니다 (광고 아님)</p>
        </div>
      </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-white/80 mb-2">언제 보낼까요</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TX_EVENTS.map((t) => {
            const Icon = t.icon;
            const active = t.key === txKey;
            const locked = t.gated && !hasMallIntegration;
            return (
              <button
                key={t.key}
                onClick={() => { if (!locked) setTxKey(t.key); }}
                disabled={locked}
                className={`p-3 rounded-lg border text-left transition-colors ${active ? 'bg-teal-500/15 border-teal-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <div className={`w-7 h-7 rounded-md bg-gradient-to-br ${t.gradient} flex items-center justify-center mb-2`}>
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div className="text-xs font-medium">{t.label}</div>
                <div className="text-[10px] text-white/40 mt-0.5">{locked ? '자사몰 연동 시 사용 가능' : t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white/80 mb-2">어떤 알림톡을 보낼까요</h3>
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
            customerFieldOptions={[...customerFieldOptions, ...(EVENT_FIELDS[txKey] || [])]}
            value={alimtalk}
            onChange={setAlimtalk}
          />
        )}
      </div>

      <div className="flex justify-end">
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
