/**
 * KakaoSendHeader — 알림톡·브랜드메시지 발송 창 머리 (★2026-09-25 Harold 목업 v2 승인)
 *
 * 직접발송 창 머리(`DirectSendPanel` ds-modal__header)와 같은 틀이다: 왼쪽 = 채널 아이콘 + 제목 + 한 줄 설명,
 * 오른쪽 = 다른 두 채널로 가는 전환 버튼 + 창닫기.
 * 전환 버튼은 호출부(Dashboard)가 `onSwitch`를 줄 때만 그린다 — 이 창을 닫고 그 창을 여는 일은 호출부가 한다.
 */
import { Bell, Megaphone, SendHorizontal, X } from 'lucide-react';

export type SendChannel = 'sms' | 'alimtalk' | 'brand';

const SWITCH: Record<SendChannel, { label: string; sub: string; Icon: typeof Bell; tile: string; ring: string; title: string }> = {
  sms: {
    label: '문자 발송', sub: 'SMS · LMS · MMS', Icon: SendHorizontal,
    tile: 'from-emerald-500 to-teal-500 shadow-emerald-500/30', ring: 'hover:ring-emerald-300', title: '문자 발송 화면으로 전환',
  },
  alimtalk: {
    label: '알림톡 발송', sub: '검수 템플릿으로 보내기', Icon: Bell,
    tile: 'from-amber-400 to-orange-500 shadow-amber-500/30', ring: 'hover:ring-amber-300', title: '알림톡 발송 화면으로 전환',
  },
  brand: {
    label: '브랜드메시지', sub: '검수 없이 바로 보내기', Icon: Megaphone,
    tile: 'from-violet-500 to-fuchsia-500 shadow-violet-500/30', ring: 'hover:ring-violet-300', title: '브랜드메시지 발송 화면으로 전환',
  },
};

interface Props {
  channel: 'alimtalk' | 'brand';
  title: string;
  subtitle: string;
  onSwitch?: (to: SendChannel) => void;
  onClose: () => void;
}

export default function KakaoSendHeader({ channel, title, subtitle, onSwitch, onClose }: Props) {
  const HeadIcon = channel === 'alimtalk' ? Bell : Megaphone;
  const others: SendChannel[] = channel === 'alimtalk' ? ['sms', 'brand'] : ['sms', 'alimtalk'];
  return (
    <header className="ds-modal__header">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`ds-head-icon ${channel === 'alimtalk' ? 'ks-head-icon--amber' : 'ks-head-icon--violet'}`}>
          <HeadIcon size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="ds-head-title">{title}</div>
          <div className="ds-head-sub truncate">{subtitle}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onSwitch && others.map((to) => {
          const s = SWITCH[to];
          return (
            <button
              key={to}
              type="button"
              onClick={() => onSwitch(to)}
              className={`group inline-flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm hover:shadow-md transition text-left ${s.ring}`}
              title={s.title}
            >
              <span className={`w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center shadow-sm shrink-0 ${s.tile}`}>
                <s.Icon size={14} strokeWidth={2} className="text-white" />
              </span>
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-slate-800">{s.label}</span>
                <span className="hidden lg:block text-[10px] text-slate-400">{s.sub}</span>
              </span>
            </button>
          );
        })}
        <button type="button" className="ds-close-btn ds-t" onClick={onClose}>
          <X size={14} strokeWidth={1.75} />
          <span>창닫기</span>
        </button>
      </div>
    </header>
  );
}
