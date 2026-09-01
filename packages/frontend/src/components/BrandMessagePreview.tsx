/**
 * BrandMessagePreview — 카카오 말풍선 스타일 미리보기
 *
 * ★ 2026-07-31 빈 상태 신설. 전에는 본문·이미지·버튼이 모두 비면 '광고' 칩만 든 흰 박스 하나가
 *   400px 파란 면에 덩그러니 남아, 사용자 눈에는 **고장으로 읽혔다**(Harold 실측 지적).
 *   지금은 자리표시 말풍선과 한 줄 안내가 대신 뜬다. 프로필도 선택한 발신프로필 이름을 그대로 쓴다.
 */

interface Button { name: string; type: string; url_mobile?: string; }

interface BrandMessagePreviewProps {
  bubbleType: string;
  message?: string;
  header?: string;
  imageUrl?: string;
  buttons?: Button[];
  couponTitle?: string;
  isAd?: boolean;
  unsubPhone?: string;
  /** 선택한 발신프로필 이름 — 없으면 자리표시 */
  profileName?: string;
  /**
   * ★ 2026-09-01 AI 생성 이미지 안내 문구 — 값이 있으면 본문 아래에 "자동 추가" 표시와 함께 보여준다.
   * 실제 발송에서는 본문 끝 줄바꿈 뒤에 이 문구가 그대로 붙는다(backend CT-12 appendAiImageNotice).
   * 문구 텍스트는 편집기가 소유한다 — 여기서 다시 적지 않는다(두 벌 금지).
   */
  aiNoticeText?: string;
}

export default function BrandMessagePreview({
  bubbleType, message, header, imageUrl, buttons, couponTitle, isAd, unsubPhone, profileName, aiNoticeText,
}: BrandMessagePreviewProps) {
  const hasContent = Boolean(
    (message && message.trim()) || (header && header.trim()) || imageUrl || couponTitle ||
    (buttons && buttons.some((b) => b.name)),
  );

  return (
    <div className="w-full max-w-[340px] mx-auto rounded-2xl overflow-hidden ring-1 ring-slate-900/5 shadow-sm">
      {/* 카카오톡 헤더 */}
      <div className="bg-[#A8BDD0] px-4 py-2.5 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[#FEE500] flex items-center justify-center text-[11px] font-bold text-[#3C1E1E]">K</div>
        <span className="text-[13px] font-medium text-slate-800">카카오톡</span>
      </div>

      {/* 채팅 영역 */}
      <div className="bg-[#B2C7DA] px-3.5 pb-5 min-h-[360px]">
        <div className="flex gap-2.5 pt-3.5">
          <div className="w-9 h-9 rounded-2xl bg-white/70 shrink-0 flex items-center justify-center text-[11px] font-bold text-slate-400">
            {(profileName || '브').slice(0, 1)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-700/80 mb-1 truncate">{profileName || '발신프로필 미선택'}</div>

            {hasContent ? (
              <div className="bg-white rounded-2xl rounded-tl-md overflow-hidden shadow-sm max-w-[268px]">
                {isAd && (
                  <div className="px-3.5 pt-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded">광고</span>
                  </div>
                )}

                {header && (
                  <div className="px-3.5 pt-2.5">
                    <div className="text-sm font-bold text-slate-900">{header}</div>
                  </div>
                )}

                {imageUrl && (bubbleType === 'IMAGE' || bubbleType === 'WIDE') && (
                  <div className="mt-1">
                    <img
                      src={imageUrl}
                      alt=""
                      className="w-full object-cover"
                      style={{ maxHeight: bubbleType === 'WIDE' ? '132px' : '170px' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" fill="%23f1f5f9"><rect width="200" height="120"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%2394a3b8" font-size="12">이미지를 불러올 수 없습니다</text></svg>';
                      }}
                    />
                  </div>
                )}

                {message && (
                  <div className="px-3.5 py-2.5">
                    <div className="text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap break-words">{message}</div>
                  </div>
                )}

                {/* AI 생성 이미지 안내 문구 — 발송 시 본문 끝에 자동으로 붙는 줄을 미리 보여준다 */}
                {aiNoticeText && message && message.trim() && (
                  <div className="relative mx-3.5 mb-2.5 rounded-lg bg-violet-50 ring-1 ring-violet-200/70 px-2.5 py-1.5">
                    <span className="absolute -top-2 right-2 text-[8px] font-bold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 px-1.5 py-px rounded-full">
                      자동 추가
                    </span>
                    <span className="text-[12px] text-slate-600 leading-relaxed">{aiNoticeText}</span>
                  </div>
                )}

                {couponTitle && (
                  <div className="mx-3.5 mb-2.5 rounded-xl bg-amber-50 ring-1 ring-amber-200/80 px-2.5 py-2">
                    <div className="text-[11px] font-bold text-amber-700">{couponTitle}</div>
                  </div>
                )}

                {buttons && buttons.length > 0 && (
                  <div className="border-t border-slate-100">
                    {buttons.map((btn, idx) => (
                      <div key={idx} className="px-3.5 py-2.5 text-center border-b last:border-b-0 border-slate-100">
                        <span className="text-[12px] text-slate-600 font-medium">{btn.name || `버튼 ${idx + 1}`}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isAd && unsubPhone && (
                  <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100">
                    <div className="text-[10px] text-slate-400">채널 차단하기 | 수신거부 {unsubPhone}</div>
                  </div>
                )}
              </div>
            ) : (
              /* 빈 상태 — 자리표시 말풍선. 고장이 아니라 "아직 안 썼다"로 읽히게 한다 */
              <div className="bg-white/85 rounded-2xl rounded-tl-md shadow-sm max-w-[268px] px-3.5 py-4 space-y-2">
                {isAd && <div className="h-3 w-8 rounded bg-slate-100" />}
                {(bubbleType === 'IMAGE' || bubbleType === 'WIDE') && (
                  <div className={`w-full rounded-lg bg-slate-100 ${bubbleType === 'WIDE' ? 'h-14' : 'h-20'}`} />
                )}
                <div className="h-2 w-full rounded-full bg-slate-100" />
                <div className="h-2 w-4/5 rounded-full bg-slate-100" />
                <div className="h-2 w-2/3 rounded-full bg-slate-100" />
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  본문을 입력하면 실제 받는 모습 그대로 여기에 보입니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
