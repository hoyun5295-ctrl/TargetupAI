/**
 * MmsImagePreview — MMS 이미지 미리보기 공용 컴포넌트
 *
 * ★ B3/B5/B7(0417 PDF #3/#5/#7) 통합 해결 컨트롤타워
 *   - 발송창 썸네일(작음) + 미리보기 팝업(중간) + 상세 팝업(큼) 모든 케이스 단일 컴포넌트
 *   - 파일명 표시(hover title / below label) 옵션
 *   - flex-wrap + min-w-0 + object-contain 으로 프레임 오버플로우 방지
 *   - mmsServerPathToUrl + getMmsImagePath + getMmsImageDisplayName 기존 컨트롤타워 재사용
 *
 * 사용처:
 *   - DirectSendPanel/AiCampaignSendModal/AiCustomSendFlow/TargetSendModal 발송창 썸네일
 *   - ResultsModal 폰 프레임 미리보기 + 메시지내용 상세 팝업
 *   - CalendarModal 우측 상세 패널
 *   - ScheduledCampaignModal 예약대기 팝업
 */

import { mmsServerPathToUrl } from '../../utils/formatDate';
import { getMmsImagePath, getMmsImageDisplayName } from '../../utils/mmsImage';

export interface MmsImagePreviewProps {
  /** MMS 이미지 배열 — 객체({path, originalName}/{serverPath, url, filename, originalName?}) 또는 문자열(레거시) 혼재 수용 */
  images: any[];
  /** 표시 크기 (xs 썸네일, sm 폰프레임, md 상세, lg 독립, full 전폭) */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full';
  /** 파일명 하단 표시 여부 (기본: false — title 속성만) */
  showFilename?: boolean;
  /** flex 래핑 — 3장 이상에서도 프레임 오버플로우 방지 (기본: true) */
  wrap?: boolean;
  /** 클릭 시 확대 콜백 */
  onImageClick?: (url: string, filename: string) => void;
  /** 여백 없음 (폰 프레임 내부용) */
  compact?: boolean;
  /** full 모드에서 이미지 최대 높이 (예: '160px') */
  maxHeight?: string;
  /** 테두리 클래스 (기본: 'border', 커스텀: 'border border-purple-200' 등) */
  borderColor?: string;
  /** 각 이미지 개별 삭제 콜백 (설정 시 우상단 × 버튼 렌더) */
  onRemove?: (index: number) => void;
}

const SIZE_CLASSES: Record<NonNullable<MmsImagePreviewProps['size']>, string> = {
  xs: 'w-10 h-10', // 발송창 썸네일
  sm: 'w-16 h-16', // 폰 프레임 내부
  md: 'w-24 h-24', // 발송결과 상세 팝업
  lg: 'w-32 h-32', // 독립 모달
  full: 'w-full h-auto', // 폰 프레임 내부 전폭 미리보기
};

/** 이미지 객체/문자열에서 표시용 URL 추출 — 업로드 직후(img.url) 우선, 없으면 serverPath 변환 */
function resolveImageUrl(imgItem: any): string {
  if (!imgItem) return '';
  if (typeof imgItem === 'object' && imgItem.url) return imgItem.url;
  const serverPath = getMmsImagePath(imgItem) || (imgItem as any).serverPath || '';
  return mmsServerPathToUrl(serverPath);
}

export default function MmsImagePreview({
  images,
  size = 'sm',
  showFilename = false,
  wrap = true,
  onImageClick,
  compact = false,
  maxHeight,
  borderColor,
  onRemove,
}: MmsImagePreviewProps) {
  if (!images || !Array.isArray(images) || images.length === 0) return null;

  const sizeCls = SIZE_CLASSES[size];
  const containerCls = `${compact ? '' : 'mt-2 pt-2 border-t border-gray-100'} flex ${wrap ? 'flex-wrap' : ''} gap-1.5 min-w-0 max-w-full`;
  const borderCls = borderColor || 'border';

  return (
    <div className={containerCls}>
      {images.map((imgItem: any, idx: number) => {
        const filename = getMmsImageDisplayName(imgItem, `이미지${idx + 1}`);
        const url = resolveImageUrl(imgItem);
        const isFull = size === 'full';
        const imgStyle = (isFull && maxHeight) ? { maxHeight, objectFit: 'cover' as const } : undefined;
        return (
          <div key={idx} className={`relative flex flex-col items-center shrink-0 ${isFull ? 'w-full' : ''} min-w-0`}>
            <img
              src={url}
              alt={filename}
              title={filename}
              onClick={() => onImageClick?.(url, filename)}
              style={imgStyle}
              className={`${sizeCls} ${isFull ? '' : 'object-cover'} rounded ${borderCls} ${onImageClick ? 'cursor-pointer hover:ring-2 hover:ring-emerald-400 transition' : ''}`}
            />
            {onRemove && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] rounded-bl flex items-center justify-center hover:bg-red-600"
                title="삭제"
              >×</button>
            )}
            {showFilename && (
              <div
                className="mt-1 text-[10px] text-gray-500 max-w-full truncate"
                style={{ maxWidth: size === 'xs' ? '48px' : size === 'sm' ? '72px' : size === 'md' ? '104px' : size === 'lg' ? '136px' : undefined }}
                title={filename}
              >
                {filename}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
