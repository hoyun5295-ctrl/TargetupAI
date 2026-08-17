/**
 * EmptyState.tsx — 비어 있는 목록 (카카오 & RCS 표면 전용)
 *
 * 왜 있는가 (2026-08-17):
 *   빈 상태 3곳이 전부 **큰 이모지 한 글자 + 회색 문장**이었다(💬 · 📢 · 📱).
 *   이모지는 기기·OS마다 다르게 그려져 화면 톤을 통제할 수 없고, 무엇보다
 *   "다음에 뭘 누르면 되는지"를 알려주지 않았다. 아이콘 + 제목 + 설명 + **바로 시작하는 버튼**으로 바꾼다.
 *
 *   행동 버튼은 선택이다 — 권한이 없는 사용자에게는 버튼 없이 안내만 나가야 한다.
 */
import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';
import { KUI_BTN_PRIMARY, KUI_EMPTY, KUI_EMPTY_BADGE, KUI_EMPTY_DESC, KUI_EMPTY_TITLE } from '../../utils/kakao-ui';

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: Props) {
  return (
    <div className={KUI_EMPTY}>
      <div className={KUI_EMPTY_BADGE}>
        <Icon className="w-5 h-5" strokeWidth={1.6} />
      </div>
      <p className={KUI_EMPTY_TITLE}>{title}</p>
      {description && <p className={KUI_EMPTY_DESC}>{description}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={`${KUI_BTN_PRIMARY} mt-5`}>
          <Plus className="w-[15px] h-[15px]" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
