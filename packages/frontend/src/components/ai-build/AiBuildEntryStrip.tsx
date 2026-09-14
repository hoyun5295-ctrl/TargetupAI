/**
 * AiBuildEntryStrip — 목록 상단 2칸 카드띠 [AI 자동제작 | 직접 제작] (2026-09-14 T6 · 설계서 §3-1 · §4-1)
 *
 * 좌 = AI 자동제작(OUI_CARD_ACCENT · 화면당 강조 카드 1개 · NEW) → /quick-campaign?channel=dm|email(전체 페이지 · 모달 금지).
 * 우 = 직접 제작(OUI_CARD dashed) → 호출부의 직접 제작 진입(옛 "자유 시작"·"비주얼로 만들기"). enabled=false 면 아무것도 그리지 않는다(ENV 미노출).
 */
import { useNavigate } from 'react-router-dom';
import { Sparkles, PencilLine } from 'lucide-react';
import { OUI_BADGE_NEW, OUI_CARD, OUI_CARD_ACCENT } from '../../utils/operator-ui';
import type { BuildChannel } from '../../utils/ai-build';

export default function AiBuildEntryStrip({ channel, enabled, onDirect, directDesc, disabled }: {
  channel: BuildChannel;
  enabled: boolean;
  onDirect: () => void;
  directDesc: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  if (!enabled) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <button type="button" disabled={disabled} onClick={() => navigate(`/quick-campaign?channel=${channel}`)}
        className={`${OUI_CARD_ACCENT} text-left p-4 md:p-5 hover:border-violet-300/60 transition-colors disabled:opacity-50`}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/20 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white flex items-center gap-2">AI 자동제작 <span className={OUI_BADGE_NEW}>NEW</span></div>
            <div className="text-[11px] text-white/60 mt-0.5">재료만 넣으면 완성본까지</div>
          </div>
        </div>
        <p className="text-[12px] text-white/70 mt-3 leading-relaxed">행사 내용과 사진, 상품을 넣고 버튼 하나면 {channel === 'email' ? '이메일' : '모바일 DM'} 완성본이 편집기에 열려요.</p>
      </button>
      <button type="button" disabled={disabled} onClick={onDirect}
        className={`${OUI_CARD} border-dashed text-left p-4 md:p-5 hover:bg-white/[0.08] hover:border-white/25 transition-colors disabled:opacity-50`}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
            <PencilLine className="w-4 h-4 text-white/85" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">직접 제작</div>
            <div className="text-[11px] text-white/60 mt-0.5">빈 캔버스에서 시작</div>
          </div>
        </div>
        <p className="text-[12px] text-white/60 mt-3 leading-relaxed">{directDesc}</p>
      </button>
    </div>
  );
}
