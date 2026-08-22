/**
 * Customer360Modal — 고객 한 명의 활동 기록을 **자기 모달**로 연다 (★ 2026-08-22)
 *
 * 왜 모달인가 (Harold 확정):
 *   처음엔 고객 목록 옆에 패널을 붙였다가, 고객을 고르면 목록을 300px로 접는 마스터-디테일로 갔다.
 *   둘 다 나빴다 — 붙이면 표는 컬럼이 잘리고 패널은 칩이 가로 스크롤에 갇혔고, 접으면 목록을 다시 보려고
 *   여닫는 동작이 늘었다. **목록은 목록대로 전체 폭을 쓰고, 360은 자기 창에서 넓게 쓴다**가 답이다.
 *
 * 층: 고객 목록 모달(z-50) 위에 z-[60]. 그 위로 확인 다이얼로그(z-[2100])가 다시 뜬다.
 * ⛔ 스크림·박스에 `transform`·`backdrop-filter`를 넣지 않는다(CUI_MODAL 주석의 P0 경위).
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Customer360Panel from './Customer360Panel';

interface Props {
  show: boolean;
  customerId: string | null;
  fallbackName?: string | null;
  fallbackPhone?: string | null;
  basicInfo?: React.ReactNode;
  onClose: () => void;
  onOpenCampaign?: (campaignId: string) => void;
}

export default function Customer360Modal({
  show, customerId, fallbackName, fallbackPhone, basicInfo, onClose, onOpenCampaign,
}: Props) {
  // ESC로 이 창만 닫는다. 아래 고객 목록 모달까지 닫히지 않게 캡처 단계에서 받아 전파를 끊는다.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, onClose]);

  if (!show || !customerId) return null;

  // 껍데기 규격은 고객 DB 조회 모달과 같다(같은 스크림·모서리·그림자·폭).
  // ⛔ 높이는 `max-h`다 — `h-[88vh]` 고정이면 기록이 적은 고객에서 아래가 텅 빈다.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div
        className="bg-white rounded-xl shadow-2xl w-[1100px] max-w-full max-h-[88vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="고객 활동 기록"
      >
        <Customer360Panel
          customerId={customerId}
          fallbackName={fallbackName}
          fallbackPhone={fallbackPhone}
          basicInfo={basicInfo}
          onClose={onClose}
          onOpenCampaign={onOpenCampaign}
        />
      </div>
    </div>,
    document.body,
  );
}
