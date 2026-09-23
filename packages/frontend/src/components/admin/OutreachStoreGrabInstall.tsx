/**
 * ★ 2026-09-24 네이버 스토어 [한줄로 가져오기] 북마크 버튼 설치 칸(설계서 docs/2026-09-23-outreach-direct-send-design.md §9-1)
 * 확인 화면·작업대 공용. 버튼을 크롬 북마크바로 끌어다 놓으면 끝(처음 한 번). 이 화면에서 누르면 실행하지 않고 안내만 한다.
 */
import { useEffect, useRef } from 'react';
import { Store } from 'lucide-react';
import { useToast } from '../ToastProvider';
import { buildGrabBookmarklet, ensureGrabKey } from './outreach-store-grab';

export default function OutreachStoreGrabInstall() {
  const toast = useToast();
  const ref = useRef<HTMLAnchorElement>(null);

  // javascript: 주소는 JSX href 로 주지 않고 마운트 뒤 속성으로 심는다(React 경고 회피 · 앱 주소·열쇠는 이 브라우저 기준)
  useEffect(() => {
    ref.current?.setAttribute('href', buildGrabBookmarklet(window.location.origin, ensureGrabKey()));
  }, []);

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-xs text-gray-700 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <a ref={ref} draggable onClick={(e) => { e.preventDefault(); toast.info('이 버튼을 크롬 북마크바로 끌어다 놓으세요. 네이버 스토어 화면에서 누르면 됩니다.'); }}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium cursor-grab select-none">
          <Store className="w-3.5 h-3.5" /> 한줄로 가져오기
        </a>
        <span>이 버튼을 크롬 북마크바로 끌어다 놓으세요(처음 한 번).</span>
      </div>
      <p className="text-[11px] text-gray-500">
        네이버 스토어 화면에서 북마크를 누르면, 지금 보이는 화면의 행사 문구가 같은 스토어 주소로 등록된 업체에 들어옵니다. 한줄로 서버는 네이버에 접속하지 않습니다.
      </p>
    </div>
  );
}
