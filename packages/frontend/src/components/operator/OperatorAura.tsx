/**
 * OperatorAura: 작업면 상단 아우라 1개(2026-08-21 오퍼레이터 표면 단계 체계).
 *   바닥 root(`OUI_PAGE`, relative) 바로 아래 형제로 둔다. 헤더 근처 한 화면분만 살고 스크롤하면 사라진다.
 *   캔버스 뷰(여정 스튜디오·인앱 편집기)에서는 렌더하지 않는다(미리보기 실물 색 보호): 호출부가 조건부로 뺀다.
 *   ⛔ 이 요소나 조상에 filter·backdrop-filter·transform을 두지 않는다(blur는 아우라 자신에게만).
 */
import { OUI_AURA, OUI_AURA_WRAP } from '../../utils/operator-ui';

export default function OperatorAura() {
  return (
    <div className={OUI_AURA_WRAP} aria-hidden>
      <div className={OUI_AURA} />
    </div>
  );
}
