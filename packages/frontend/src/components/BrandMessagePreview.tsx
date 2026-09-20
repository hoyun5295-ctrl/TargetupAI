/**
 * BrandMessagePreview — 카카오톡 실수신 화면 기준 미리보기
 *
 * ★ 2026-07-31 빈 상태 신설. 전에는 본문·이미지·버튼이 모두 비면 '광고' 칩만 든 흰 박스 하나가
 *   400px 파란 면에 덩그러니 남아, 사용자 눈에는 **고장으로 읽혔다**(Harold 실측 지적).
 *   지금은 자리표시 말풍선과 한 줄 안내가 대신 뜬다. 프로필도 선택한 발신프로필 이름을 그대로 쓴다.
 *
 * ★ 2026-09-20 광고·수신거부 표기를 **실수신 화면에 맞췄다**(Harold 단말 캡처 2026-09-17 · 채널 친구 대상).
 *   옛 그림 = 말풍선 **안**에 「광고」 칩 + 「채널 차단하기 | 수신거부 080…」 띠. 실제 카카오톡에는 둘 다 없다.
 *   실제 = 발신 이름 **앞**에 `(광고)`, 말풍선 **아래 바깥**에 `수신거부 | 홈 > 채널 차단`. 080 번호는 화면에 보이지 않는다.
 *   ⚠ 비친구 대상(M·N)의 실수신 화면은 아직 캡처가 없다 — 확인되면 그 갈래만 따로 그린다.
 *   시각은 상수로 적지 않는다(미리보기 상수 목업 = 거짓 표시 · LESSONS_FRONTEND 0707). 렌더 시점의 지금 시각을 쓴다.
 *
 * ★ 2026-09-20(2) 자유형 5종(와이드 리스트·프리미엄 동영상·커머스·캐러셀 2종) 그리기 추가.
 *   ⚠ 5종의 배치는 템플릿 등록 화면 미리보기와 규격 문서를 따른 것이고 **실수신 캡처로 확인한 그림이 아니다.**
 *   유형별 실측에서 단말 캡처를 받으면 그 유형부터 맞춘다.
 */
import { ChevronLeft, BadgeCheck, Search, Menu, Play } from 'lucide-react';

interface Button { name: string; type: string; url_mobile?: string; }

export interface PreviewCommerce { title: string; regular: string; discount: string; rate: string }
export interface PreviewRich {
  additional?: string;
  items?: { imageUrl?: string; title: string }[];
  /** 프리미엄 동영상 — 썸네일이 없으면 어두운 자리표시 */
  video?: { thumbUrl?: string };
  commerce?: PreviewCommerce;
  carousel?: {
    intro?: { imageUrl?: string; header: string; content: string };
    cards: { imageUrl?: string; header: string; message: string; additional: string; commerce?: PreviewCommerce; buttons: string[] }[];
    tail: boolean;
  };
}

interface BrandMessagePreviewProps {
  bubbleType: string;
  message?: string;
  header?: string;
  imageUrl?: string;
  buttons?: Button[];
  couponTitle?: string;
  isAd?: boolean;
  /** 선택한 발신프로필 이름 — 없으면 자리표시 */
  profileName?: string;
  /**
   * ★ 2026-09-01 AI 생성 이미지 안내 문구 — 값이 있으면 본문 아래에 "자동 추가" 표시와 함께 보여준다.
   * 실제 발송에서는 본문 끝 줄바꿈 뒤에 이 문구가 그대로 붙는다(backend CT-12 appendAiImageNotice).
   * 문구 텍스트는 편집기가 소유한다 — 여기서 다시 적지 않는다(두 벌 금지).
   */
  aiNoticeText?: string;
  /** 5종이 더하는 내용 — 없으면 종전 3종 그림 그대로 */
  rich?: PreviewRich;
}

/** 카카오톡 말풍선 옆 시각 표기 — 오전/오후 h:mm */
const kakaoTime = (d: Date): string => {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
};

/** '189000'·'189,000' → '189,000'. 숫자가 아니면 입력 그대로(미리보기는 고쳐 쓰지 않는다) */
const won = (raw: string): string => {
  const v = String(raw || '').trim().replace(/,/g, '');
  return /^\d+$/.test(v) ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(raw || '').trim();
};

const BROKEN_IMG =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" fill="%23f1f5f9"><rect width="200" height="120"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%2394a3b8" font-size="12">이미지를 불러올 수 없습니다</text></svg>';

function Img({ src, className, style }: { src?: string; className: string; style?: React.CSSProperties }) {
  if (!src) return <div className={`${className} bg-slate-100`} style={style} />;
  return (
    <img src={src} alt="" className={`${className} object-cover block`} style={style}
      onError={(e) => { (e.target as HTMLImageElement).src = BROKEN_IMG; }} />
  );
}

function Price({ c, add }: { c: PreviewCommerce; add?: string }) {
  const hasDiscount = !!c.discount.trim();
  return (
    <div className="px-3 pt-2.5 pb-2">
      <div className="text-[12.5px] font-bold text-[#191919] break-words">{c.title || '상품명'}</div>
      <div className="flex items-baseline flex-wrap gap-x-1.5 mt-1">
        {hasDiscount && c.rate.trim() && <span className="text-[12px] font-extrabold text-[#ff3b30] tabular-nums">{c.rate}%</span>}
        <span className="text-[15px] font-extrabold text-[#191919] tabular-nums">{won(hasDiscount ? c.discount : c.regular) || '0'}원</span>
        {hasDiscount && <span className="text-[11px] text-[#a0a0a0] line-through tabular-nums">{won(c.regular)}원</span>}
      </div>
      {add && add.trim() && <div className="text-[11px] text-[#8b8b8b] mt-1 whitespace-pre-wrap break-words">{add}</div>}
    </div>
  );
}

function KBtn({ name }: { name: string }) {
  return (
    <div className="h-8 rounded-md bg-[#f3f3f3] flex items-center justify-center px-2">
      <span className="text-[12px] text-[#2e2e2e] truncate">{name}</span>
    </div>
  );
}

export default function BrandMessagePreview({
  bubbleType, message, header, imageUrl, buttons, couponTitle, isAd, profileName, aiNoticeText, rich,
}: BrandMessagePreviewProps) {
  const car = rich?.carousel;
  const hasContent = Boolean(
    (message && message.trim()) || (header && header.trim()) || imageUrl || couponTitle ||
    (buttons && buttons.some((b) => b.name)) ||
    rich?.video || rich?.commerce?.title.trim() || rich?.items?.some((it) => it.imageUrl || it.title.trim()) ||
    car?.cards.some((c) => c.imageUrl || c.header.trim() || c.message.trim() || c.commerce?.title.trim()),
  );
  const name = profileName || '발신프로필 미선택';
  const time = <span className="shrink-0 pb-0.5 text-[9.5px] text-[#4e6072] whitespace-nowrap tabular-nums">{kakaoTime(new Date())}</span>;

  return (
    <div className="w-full max-w-[352px] mx-auto rounded-[20px] overflow-hidden ring-1 ring-slate-900/5 shadow-sm">
      {/* 채팅방 상단 — 채널 이름이 제목이다 */}
      <div className="bg-[#A9BFD3] px-3 py-2.5 flex items-center gap-2 text-[#1f2d3a]">
        <ChevronLeft size={16} strokeWidth={2.2} className="shrink-0" />
        <span className="min-w-0 truncate text-[13px] font-semibold">{name}</span>
        {!!profileName && <BadgeCheck size={13} strokeWidth={2} className="shrink-0 text-[#3b4b5a]" />}
        <span className="ml-auto flex items-center gap-2.5 shrink-0 text-[#2b3b4a]">
          <Search size={15} strokeWidth={2} />
          <Menu size={15} strokeWidth={2} />
        </span>
      </div>

      {/* 채팅 영역 */}
      <div className="bg-[#B2C7DA] px-3 pb-5 min-h-[400px]">
        <div className="flex gap-2 pt-3.5">
          <div className="w-8 h-8 rounded-xl bg-white/80 shrink-0 flex items-center justify-center text-[11px] font-bold text-slate-400">
            {(profileName || '브').slice(0, 1)}
          </div>
          <div className="flex-1 min-w-0">
            {/* 광고 표기는 말풍선 안이 아니라 이름 앞이다 */}
            <div className="text-[11px] text-[#3b4b5a] mb-1 truncate">{isAd ? '(광고) ' : ''}{name}</div>

            {hasContent && car ? (
              /* 캐러셀 — 카드가 옆으로 이어진다(말풍선 하나가 아니라 카드 열) */
              <>
                <div className="flex gap-2 overflow-x-auto pb-1 -mr-3 pr-3">
                  {car.intro && (
                    <div className="w-[168px] shrink-0 rounded-xl overflow-hidden shadow-sm bg-[#3b4b5a] text-white">
                      <Img src={car.intro.imageUrl} className="w-full h-[104px]" />
                      <div className="px-2.5 pt-2 text-[12.5px] font-bold break-words">{car.intro.header || '인트로 제목'}</div>
                      <div className="px-2.5 pb-2.5 pt-0.5 text-[11.5px] leading-[1.5] text-white/90 whitespace-pre-wrap break-words">{car.intro.content}</div>
                    </div>
                  )}
                  {car.cards.map((c, i) => (
                    <div key={i} className="w-[168px] shrink-0 rounded-xl overflow-hidden shadow-sm bg-white">
                      <Img src={c.imageUrl} className="w-full h-[104px]" />
                      {c.commerce ? (
                        <Price c={c.commerce} add={c.additional} />
                      ) : (
                        <>
                          <div className="px-2.5 pt-2 text-[12.5px] font-bold text-[#191919] break-words">{c.header || `카드 ${i + 1}`}</div>
                          <div className="px-2.5 pb-2 pt-0.5 text-[11.5px] leading-[1.5] text-[#333] whitespace-pre-wrap break-words">{c.message}</div>
                        </>
                      )}
                      {c.buttons.length > 0 && (
                        <div className="px-2 pb-2 space-y-1.5">{c.buttons.map((b, bi) => <KBtn key={bi} name={b || `버튼 ${bi + 1}`} />)}</div>
                      )}
                    </div>
                  ))}
                  {car.tail && (
                    <div className="w-[68px] shrink-0 rounded-xl bg-white/90 grid place-items-center text-[11.5px] font-bold text-[#3b4b5a]">더보기</div>
                  )}
                </div>
                <div className="mt-1">{time}</div>
              </>
            ) : hasContent ? (
              <div className="flex items-end gap-1.5">
                <div className="bg-white rounded-[4px_14px_14px_14px] overflow-hidden shadow-sm w-full max-w-[232px]">
                  {imageUrl && (
                    <Img src={imageUrl} className="w-full" style={{ maxHeight: bubbleType === 'WIDE' ? '176px' : '150px' }} />
                  )}

                  {rich?.video && (
                    <div className="relative">
                      <Img src={rich.video.thumbUrl} className={`w-full h-[130px] ${rich.video.thumbUrl ? '' : '!bg-slate-700'}`} />
                      <span className="absolute inset-0 grid place-items-center">
                        <span className="w-10 h-10 rounded-full bg-black/55 grid place-items-center text-white"><Play size={16} fill="currentColor" strokeWidth={0} /></span>
                      </span>
                    </div>
                  )}

                  {header && (
                    <div className="px-3 pt-2.5">
                      <div className="text-[13.5px] font-bold text-[#191919] break-words">{header}</div>
                    </div>
                  )}

                  {rich?.items && rich.items.length > 0 && (
                    <div className="pt-2">
                      {rich.items.map((it, i) => (i === 0 ? (
                        <div key={i} className="px-3 pb-2">
                          <Img src={it.imageUrl} className="w-full h-[104px] rounded-lg" />
                          {it.title.trim() && <div className="text-[12px] text-[#191919] mt-1.5 break-words">{it.title}</div>}
                        </div>
                      ) : (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-1.5 border-t border-[#f0f0f0]">
                          <Img src={it.imageUrl} className="w-10 h-10 rounded-md shrink-0" />
                          <span className="min-w-0 text-[12px] text-[#191919] truncate">{it.title || `아이템 ${i + 1}`}</span>
                        </div>
                      )))}
                      <div className="h-2" />
                    </div>
                  )}

                  {rich?.commerce && <Price c={rich.commerce} add={rich.additional} />}

                  {message && (
                    <div className="px-3 py-2.5">
                      <div className="text-[12.5px] leading-[1.55] text-[#191919] whitespace-pre-wrap break-words">{message}</div>
                    </div>
                  )}

                  {/* AI 생성 이미지 안내 문구 — 발송 시 본문 끝에 자동으로 붙는 줄을 미리 보여준다 */}
                  {aiNoticeText && message && message.trim() && (
                    <div className="relative mx-3 mb-2.5 rounded-lg bg-violet-50 ring-1 ring-violet-200/70 px-2.5 py-1.5">
                      <span className="absolute -top-2 right-2 text-[8px] font-bold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 px-1.5 py-px rounded-full">
                        자동 추가
                      </span>
                      <span className="text-[12px] text-slate-600 leading-relaxed">{aiNoticeText}</span>
                    </div>
                  )}

                  {couponTitle && (
                    <div className="mx-2.5 mb-2.5 rounded-lg ring-1 ring-inset ring-slate-200 px-2.5 py-2">
                      <div className="text-[11.5px] font-bold text-[#191919]">{couponTitle}</div>
                    </div>
                  )}

                  {buttons && buttons.length > 0 && (
                    <div className="px-2 pb-2 space-y-1.5">
                      {buttons.map((btn, idx) => <KBtn key={idx} name={btn.name || `버튼 ${idx + 1}`} />)}
                    </div>
                  )}
                </div>
                {time}
              </div>
            ) : (
              /* 빈 상태 — 자리표시 말풍선. 고장이 아니라 "아직 안 썼다"로 읽히게 한다 */
              <div className="bg-white/85 rounded-[4px_14px_14px_14px] shadow-sm max-w-[232px] px-3 py-3.5 space-y-2">
                {(bubbleType === 'IMAGE' || bubbleType === 'WIDE') && (
                  <div className={`w-full rounded-lg bg-slate-100 ${bubbleType === 'WIDE' ? 'h-14' : 'h-20'}`} />
                )}
                <div className="h-2 w-full rounded-full bg-slate-100" />
                <div className="h-2 w-4/5 rounded-full bg-slate-100" />
                <div className="h-2 w-2/3 rounded-full bg-slate-100" />
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  내용을 입력하면 실제 받는 모습 그대로 여기에 보입니다.
                </p>
              </div>
            )}

            {/* 수신거부 안내는 말풍선 아래 바깥에 뜬다 — 080 번호는 화면에 보이지 않는다 */}
            {hasContent && isAd && (
              <div className="text-[10px] text-[#51647a] mt-1.5 ml-0.5">
                수신거부<span className="mx-1 opacity-60">|</span>홈 &gt; 채널 차단
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
