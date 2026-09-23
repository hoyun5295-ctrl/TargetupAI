/**
 * ExcelDownloadButton.tsx — 목록 엑셀 받기 버튼 (카카오 & RCS 표면)
 *
 * ★ 2026-09-23 신설(숭실원격평생교육원 요청 · 알림톡·브랜드·RCS 템플릿 엑셀 다운로드).
 *   세 탭이 같은 버튼을 쓰므로 한 벌로 둔다. 받는 동안은 눌리지 않는다(두 번 눌러 파일 두 개 방지).
 *   받기 자체는 공용 인증 다운로드 헬퍼(lib/auth-download.ts)가 한다.
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadAuthFile } from '../../lib/auth-download';
import { CUI_BTN_OUTLINE } from '../../utils/console-ui';

interface Props {
  /** 인증이 필요한 엑셀 endpoint */
  url: string;
  /** 서버가 파일명을 주지 않을 때만 쓰는 이름 */
  fallbackName: string;
  onError: (message: string) => void;
  /** 받을 행이 없으면 끈다 */
  disabled?: boolean;
}

export default function ExcelDownloadButton({ url, fallbackName, onError, disabled }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadAuthFile(url, fallbackName, onError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      className={CUI_BTN_OUTLINE}
      title={disabled ? '받을 템플릿이 없습니다' : '전체 목록을 엑셀로 받습니다'}
      aria-label="엑셀 다운로드"
    >
      {busy
        ? <Loader2 className="w-[15px] h-[15px] animate-spin" />
        : <Download className="w-[15px] h-[15px]" />}
      {/* 좁은 화면은 아이콘만 — 툴바가 줄바꿈 없이 검색칸·등록 버튼과 한 줄에 선다 */}
      <span className="hidden sm:inline">{busy ? '받는 중' : '엑셀 다운로드'}</span>
    </button>
  );
}
