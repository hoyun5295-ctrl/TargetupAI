/**
 * StatusPill.tsx — 상태 칩 (카카오 & RCS 표면 전용)
 *
 * 왜 있는가 (2026-08-17):
 *   상태 표시가 표 4곳(발신프로필·알림톡·브랜드·RCS) + 모바일 카드 3곳에 흩어져 있었고,
 *   파일마다 `bg-amber-100 text-amber-700` 같은 값을 손으로 적어 색이 조금씩 달랐다.
 *   여기가 값을 소유하고 화면은 tone 이름만 넘긴다.
 *
 *   앞에 점을 단다 — 배경색이 옅어도 상태가 읽히고, 색으로만 구분하지 않게 된다.
 */
import { CUI_PILL_BASE, CUI_PILL_DOT, CUI_PILL_TONE, type CuiPillTone } from '../../utils/console-ui';

interface Props {
  label: string;
  tone?: CuiPillTone;
  /** 마우스를 올렸을 때 나오는 설명 — 발송 불가 사유처럼 한 줄로 못 담는 것만 */
  title?: string;
}

export default function StatusPill({ label, tone = 'neutral', title }: Props) {
  return (
    <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[tone]}`} title={title}>
      <span className={CUI_PILL_DOT} aria-hidden="true" />
      {label}
    </span>
  );
}
