/**
 * StudioWatermark — 이미지 스튜디오 화면 표시본 워터마크 (2026-07-21 · 2026-10-16 공용으로 이동)
 *
 * 스크린샷 유출 억제용 CSS 오버레이(회사명 · 사용자 대각선 반복). DOM 레이어라 저장물·발송물 원본에는 들어가지 않는다.
 * ★ 2026-10-16 스튜디오 화면 지역 함수 → 공용. DM 삽입 창 미리보기에 없던 것을 씌운다(화면 워터마크 불변 · 설계서 §2-5).
 *   표시 글자는 부품이 로그인 정보로 직접 만든다(props 0 · 부르는 쪽마다 글자 만드는 코드를 복사하지 않는다).
 *   ⚠ `absolute inset-0` 이라 부르는 쪽이 `relative` 상자 안에 둬야 한다(없으면 화면 전체를 덮는다).
 */
import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';

export default function StudioWatermark() {
  const authUser = useAuthStore((s) => s.user);
  const text = useMemo(() => {
    const co = authUser?.company?.name || '';
    const who = authUser?.name || authUser?.loginId || '';
    return [co, who].filter(Boolean).join(' · ') || '한줄로';
  }, [authUser]);
  return (
    <div aria-hidden className="pointer-events-none select-none absolute inset-0 overflow-hidden z-10">
      <div className="absolute inset-[-60%] flex flex-wrap content-center justify-center gap-x-6 gap-y-5 -rotate-[28deg]">
        {Array.from({ length: 80 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap text-slate-900 text-[11px] font-semibold" style={{ opacity: 0.16, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{text}</span>
        ))}
      </div>
    </div>
  );
}
