/**
 * GradeOrderUnlockButton — 등급 순서 잠금을 푸는 단추 하나(★ 2026-11-17 C142 · B-1117-1 · 뿌리 R56)
 *
 * 옛: 잠금 사유가 「등급 순서를 확인하면 열립니다」라고만 하고 그 일을 하는 단추가 화면에 0이었다
 *   (여는 자리는 쓰이지 않는 옛 고객 화면에만 남았고 여정 쪽 단추는 1024 에 지워졌다).
 * 지금: 서버가 잠금에 unlock 'grade_order' 를 싣고, 그 잠금을 그리는 화면마다 이 단추를 그린다(글자 = 서버 사유가 부르는 이름).
 *   창(GradeOrderModal)은 그 화면의 쪽(page)이 하나 갖고 있고, 이 단추는 그 창을 여는 손만 받는다.
 */
import { ListOrdered } from 'lucide-react';

/** 서버 사유 문장 속 단추 이름과 같은 글자(GRADE_ORDER_LOCK_REASON 「[등급 순서 정하기]」) */
export const GRADE_ORDER_UNLOCK_LABEL = '등급 순서 정하기';
export const GRADE_ORDER_REVISE_LABEL = '등급 순서 바꾸기';

export default function GradeOrderUnlockButton({ onClick, revise = false, className = '' }: {
  onClick: () => void;
  /** 이미 열린 축에서 순서를 고칠 때(영구 입구) */
  revise?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`inline-flex items-center gap-1 h-8 md:h-7 px-2.5 rounded-lg border border-amber-300 bg-amber-50 text-[12px] font-medium text-amber-900 hover:bg-amber-100 transition-colors ${className}`}
    >
      <ListOrdered className="w-3.5 h-3.5" />
      {revise ? GRADE_ORDER_REVISE_LABEL : GRADE_ORDER_UNLOCK_LABEL}
    </button>
  );
}
