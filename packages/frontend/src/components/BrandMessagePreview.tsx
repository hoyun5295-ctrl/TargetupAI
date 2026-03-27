/**
 * BrandMessagePreview — 카카오 말풍선 스타일 미리보기
 *
 * 유형별 미리보기 렌더링.
 * KakaoRcsPage 브랜드MSG 탭에서 BrandMessageEditor와 나란히 배치.
 */

interface Button { name: string; type: string; url_mobile?: string; }
interface CommerceInfo { title: string; regular_price: number; discount_price?: number; discount_rate?: number; }
interface CarouselItem { header?: string; message?: string; imageUrl?: string; commerce?: CommerceInfo; buttons?: Button[]; }

interface BrandMessagePreviewProps {
  bubbleType: string;
  message?: string;
  header?: string;
  additionalContent?: string;
  imageUrl?: string;
  imageLink?: string;
  buttons?: Button[];
  videoUrl?: string;
  commerce?: CommerceInfo;
  carouselItems?: CarouselItem[];
  listItems?: { title: string; desc: string; imgUrl: string }[];
  couponTitle?: string;
  isAd?: boolean;
  unsubPhone?: string;
}

export default function BrandMessagePreview({
  bubbleType, message, header, additionalContent,
  imageUrl, buttons, videoUrl, commerce,
  carouselItems, listItems, couponTitle, isAd, unsubPhone,
}: BrandMessagePreviewProps) {
  return (
    <div className="w-[300px] mx-auto">
      {/* 카카오톡 헤더 */}
      <div className="bg-[#B2C7DA] rounded-t-2xl px-4 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-xs font-bold">K</div>
        <span className="text-xs font-medium text-gray-800">카카오톡</span>
      </div>

      {/* 채팅 영역 */}
      <div className="bg-[#B2C7DA] px-3 pb-4 rounded-b-2xl min-h-[300px]">
        <div className="flex gap-2 mt-2">
          <div className="w-8 h-8 rounded-full bg-gray-300 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] text-gray-600 mb-1">브랜드</div>

            {/* 말풍선 */}
            <div className="bg-white rounded-2xl rounded-tl-sm overflow-hidden shadow-sm max-w-[250px]">
              {/* 광고 표시 */}
              {isAd && (
                <div className="px-3 pt-2">
                  <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">광고</span>
                </div>
              )}

              {/* 헤더 */}
              {header && (
                <div className="px-3 pt-2">
                  <div className="text-xs font-bold text-gray-900">{header}</div>
                </div>
              )}

              {/* 이미지 (IMAGE, WIDE, COMMERCE) */}
              {imageUrl && (bubbleType === 'IMAGE' || bubbleType === 'WIDE' || bubbleType === 'COMMERCE') && (
                <div className="mt-1">
                  <img src={imageUrl} alt="" className="w-full object-cover" style={{ maxHeight: bubbleType === 'WIDE' ? '120px' : '160px' }}
                    onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" fill="%23e5e7eb"><rect width="200" height="120"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12">이미지</text></svg>'; }} />
                </div>
              )}

              {/* 동영상 (PREMIUM_VIDEO) */}
              {bubbleType === 'PREMIUM_VIDEO' && videoUrl && (
                <div className="mt-1 bg-gray-900 flex items-center justify-center" style={{ height: '140px' }}>
                  <div className="text-center">
                    <div className="text-3xl">▶</div>
                    <div className="text-[9px] text-gray-400 mt-1">카카오TV</div>
                  </div>
                </div>
              )}

              {/* 커머스 가격 정보 */}
              {commerce && (
                <div className="px-3 py-2">
                  <div className="text-xs font-bold text-gray-900">{commerce.title}</div>
                  {commerce.discount_rate && (
                    <span className="text-xs font-bold text-red-500 mr-1">{commerce.discount_rate}%</span>
                  )}
                  {commerce.discount_price ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-bold">{commerce.discount_price.toLocaleString()}원</span>
                      <span className="text-[10px] text-gray-400 line-through">{commerce.regular_price.toLocaleString()}원</span>
                    </div>
                  ) : (
                    <div className="text-sm font-bold">{commerce.regular_price.toLocaleString()}원</div>
                  )}
                  {additionalContent && <div className="text-[10px] text-gray-500 mt-1">{additionalContent}</div>}
                </div>
              )}

              {/* 본문 (TEXT, IMAGE, WIDE, PREMIUM_VIDEO) */}
              {message && (
                <div className="px-3 py-2">
                  <div className="text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap">{message}</div>
                </div>
              )}

              {/* 아이템 리스트 (WIDE_ITEM_LIST) */}
              {bubbleType === 'WIDE_ITEM_LIST' && listItems && listItems.length > 0 && (
                <div className="divide-y">
                  {listItems.filter(i => i.title).map((item, idx) => (
                    <div key={idx} className="px-3 py-2 flex gap-2 items-center">
                      {item.imgUrl && <img src={item.imgUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-gray-900 truncate">{item.title}</div>
                        {item.desc && <div className="text-[10px] text-gray-500 truncate">{item.desc}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 쿠폰 */}
              {couponTitle && (
                <div className="mx-3 mb-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  <div className="text-[10px] font-bold text-amber-700">🎟️ {couponTitle}</div>
                </div>
              )}

              {/* 버튼 */}
              {buttons && buttons.length > 0 && (
                <div className="border-t divide-y">
                  {buttons.map((btn, idx) => (
                    <div key={idx} className="px-3 py-2 text-center">
                      <span className="text-[11px] text-blue-600 font-medium">{btn.name || `버튼 ${idx + 1}`}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 수신거부 */}
              {isAd && unsubPhone && (
                <div className="px-3 py-1.5 bg-gray-50 border-t">
                  <div className="text-[9px] text-gray-400">채널 차단하기 | 수신거부 {unsubPhone}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 캐러셀 미리보기 */}
        {(bubbleType === 'CAROUSEL_FEED' || bubbleType === 'CAROUSEL_COMMERCE') && carouselItems && carouselItems.length > 0 && (
          <div className="mt-2 ml-10">
            <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
              {carouselItems.map((item, idx) => (
                <div key={idx} className="bg-white rounded-xl overflow-hidden shadow-sm shrink-0" style={{ width: '180px', scrollSnapAlign: 'start' }}>
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-24 object-cover" />}
                  <div className="p-2">
                    {item.header && <div className="text-[10px] font-bold text-gray-900">{item.header}</div>}
                    {item.message && <div className="text-[9px] text-gray-600 mt-0.5 line-clamp-2">{item.message}</div>}
                    {item.commerce && (
                      <div className="mt-1">
                        <div className="text-[10px] font-bold">{item.commerce.discount_price ? item.commerce.discount_price.toLocaleString() : item.commerce.regular_price.toLocaleString()}원</div>
                      </div>
                    )}
                  </div>
                  {item.buttons && item.buttons.length > 0 && (
                    <div className="border-t px-2 py-1.5 text-center">
                      <span className="text-[9px] text-blue-600">{item.buttons[0]?.name || '버튼'}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-center mt-1">
              <span className="text-[9px] text-gray-500">{carouselItems.length}개 카드 ← 좌우 스크롤</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
