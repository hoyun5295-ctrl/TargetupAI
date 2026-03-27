/**
 * BrandMessageEditor — 브랜드메시지 8종 유형 작성 에디터
 *
 * KakaoRcsPage 브랜드MSG 탭에서 사용.
 * 자유형(8종) + 기본형(템플릿) 발송 UI.
 */
import { useState } from 'react';
import BrandMessagePreview from './BrandMessagePreview';

// ============================================================
// 상수 (프론트 컨트롤타워 — 백엔드 CT-12와 동기)
// ============================================================
export const BUBBLE_TYPES = [
  { code: 'TEXT', label: '텍스트', icon: '💬', maxMsg: 1300, maxBtn: 5, needImage: false, needHeader: false, desc: '텍스트 + 버튼' },
  { code: 'IMAGE', label: '이미지', icon: '🖼️', maxMsg: 1300, maxBtn: 5, needImage: true, needHeader: false, desc: '이미지 + 텍스트 + 버튼' },
  { code: 'WIDE', label: '와이드', icon: '🌅', maxMsg: 76, maxBtn: 2, needImage: true, needHeader: false, desc: '가로 배너 + 짧은 텍스트' },
  { code: 'WIDE_ITEM_LIST', label: '리스트', icon: '📋', maxMsg: 0, maxBtn: 2, needImage: false, needHeader: true, desc: '헤더 + 아이템 3~4개', minItems: 3, maxItems: 4 },
  { code: 'CAROUSEL_FEED', label: '캐러셀', icon: '🎠', maxMsg: 0, maxBtn: 0, needImage: false, needHeader: false, desc: '좌우 스크롤 카드 2~6개', minItems: 2, maxItems: 6 },
  { code: 'PREMIUM_VIDEO', label: '동영상', icon: '🎬', maxMsg: 76, maxBtn: 1, needImage: false, needHeader: true, desc: '카카오TV 동영상', needVideo: true },
  { code: 'COMMERCE', label: '커머스', icon: '🛒', maxMsg: 0, maxBtn: 2, needImage: true, needHeader: false, desc: '상품 카드 + 가격', needCommerce: true },
  { code: 'CAROUSEL_COMMERCE', label: '캐러셀 커머스', icon: '🛍️', maxMsg: 0, maxBtn: 0, needImage: false, needHeader: false, desc: '상품 캐러셀 2~6개', minItems: 2, maxItems: 6, needCommerce: true },
] as const;

export const BUTTON_TYPES = [
  { code: 'WL', label: '웹링크' },
  { code: 'AL', label: '앱링크' },
  { code: 'BK', label: '봇키워드' },
  { code: 'MD', label: '메시지전달' },
  { code: 'BF', label: '비즈니스폼' },
  { code: 'BC', label: '상담톡전환' },
  { code: 'BT', label: '봇전환' },
  { code: 'AC', label: '채널추가' },
];

export const TARGETING_OPTIONS = [
  { code: 'I', label: '채널 친구', desc: '광고주 지정 대상 중 채널 친구만' },
  { code: 'M', label: '마수동 전체', desc: '마케팅 수신동의 전체' },
  { code: 'N', label: '비친구만', desc: '마수동 중 채널 친구 제외' },
];

// ============================================================
// 인터페이스
// ============================================================
interface Button { name: string; type: string; url_mobile?: string; url_pc?: string; }
interface CarouselItem { header?: string; message?: string; imageUrl?: string; imageLink?: string; buttons?: Button[]; commerce?: CommerceInfo; }
interface CommerceInfo { title: string; regular_price: number; discount_price?: number; discount_rate?: number; }

interface BrandMessageEditorProps {
  profiles: { id: string; profile_key: string; profile_name: string }[];
  onSend: (data: any) => void;
  sending: boolean;
}

export default function BrandMessageEditor({ profiles, onSend, sending }: BrandMessageEditorProps) {
  const [mode, setMode] = useState<'free' | 'template'>('free');
  const [bubbleType, setBubbleType] = useState('TEXT');
  const [senderKey, setSenderKey] = useState('');
  const [targeting, setTargeting] = useState('I');
  const [isAd, setIsAd] = useState(true);

  // 메시지 내용
  const [message, setMessage] = useState('');
  const [header, setHeader] = useState('');
  const [additionalContent, setAdditionalContent] = useState('');

  // 버튼
  const [buttons, setButtons] = useState<Button[]>([]);

  // 이미지
  const [imageUrl, setImageUrl] = useState('');
  const [imageLink, setImageLink] = useState('');

  // 쿠폰
  const [couponTitle, setCouponTitle] = useState('');
  const [couponDesc, setCouponDesc] = useState('');
  const [couponUrl, setCouponUrl] = useState('');

  // 동영상
  const [videoUrl, setVideoUrl] = useState('');

  // 커머스
  const [commerceTitle, setCommerceTitle] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [discountRate, setDiscountRate] = useState('');

  // 캐러셀
  const [carouselItems, setCarouselItems] = useState<CarouselItem[]>([
    { header: '', message: '', imageUrl: '', buttons: [] },
    { header: '', message: '', imageUrl: '', buttons: [] },
  ]);

  // 아이템 리스트 (WIDE_ITEM_LIST)
  const [listItems, setListItems] = useState<{ title: string; desc: string; imgUrl: string; link: string }[]>([
    { title: '', desc: '', imgUrl: '', link: '' },
    { title: '', desc: '', imgUrl: '', link: '' },
    { title: '', desc: '', imgUrl: '', link: '' },
  ]);

  // 대체 발송
  const [resendType, setResendType] = useState('NO');
  const [resendFrom, setResendFrom] = useState('');
  const [resendMessage, setResendMessage] = useState('');

  // 수신거부
  const [unsubPhone, setUnsubPhone] = useState('');
  const [unsubAuth, setUnsubAuth] = useState('');

  // 기본형(템플릿)
  const [templateCode, setTemplateCode] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  const selectedType = BUBBLE_TYPES.find(t => t.code === bubbleType) || BUBBLE_TYPES[0];

  // 버튼 추가/삭제
  const addButton = () => {
    if (buttons.length >= selectedType.maxBtn) return;
    setButtons([...buttons, { name: '', type: 'WL', url_mobile: '' }]);
  };
  const removeButton = (idx: number) => setButtons(buttons.filter((_, i) => i !== idx));
  const updateButton = (idx: number, field: string, value: string) => {
    setButtons(buttons.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };

  // 캐러셀 아이템 추가/삭제
  const addCarouselItem = () => {
    const maxItems = (selectedType as any).maxItems || 6;
    if (carouselItems.length >= maxItems) return;
    setCarouselItems([...carouselItems, { header: '', message: '', imageUrl: '', buttons: [] }]);
  };
  const removeCarouselItem = (idx: number) => {
    const minItems = (selectedType as any).minItems || 2;
    if (carouselItems.length <= minItems) return;
    setCarouselItems(carouselItems.filter((_, i) => i !== idx));
  };
  const updateCarouselItem = (idx: number, field: string, value: any) => {
    setCarouselItems(carouselItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  // 아이템 리스트 추가/삭제
  const addListItem = () => {
    if (listItems.length >= 4) return;
    setListItems([...listItems, { title: '', desc: '', imgUrl: '', link: '' }]);
  };
  const removeListItem = (idx: number) => {
    if (listItems.length <= 3) return;
    setListItems(listItems.filter((_, i) => i !== idx));
  };

  // 발송
  const handleSend = () => {
    const data: any = {
      mode,
      bubbleType,
      senderKey,
      targeting,
      isAd,
      message: message || undefined,
      header: header || undefined,
      additionalContent: additionalContent || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
      resendType,
      resendFrom: resendFrom || undefined,
      resendMessage: resendMessage || undefined,
      unsubscribePhone: unsubPhone || undefined,
      unsubscribeAuth: unsubAuth || undefined,
    };

    // 이미지
    if (imageUrl) data.image = { img_url: imageUrl, img_link: imageLink || undefined };

    // 쿠폰
    if (couponTitle) data.coupon = { title: couponTitle, description: couponDesc || undefined, link: couponUrl ? { url_mobile: couponUrl } : undefined };

    // 동영상
    if (videoUrl) data.video = { video_url: videoUrl };

    // 커머스
    if (commerceTitle) {
      data.commerce = {
        title: commerceTitle,
        regular_price: Number(regularPrice) || 0,
        discount_price: discountPrice ? Number(discountPrice) : undefined,
        discount_rate: discountRate ? Number(discountRate) : undefined,
      };
    }

    // 아이템 리스트 (WIDE_ITEM_LIST)
    if (bubbleType === 'WIDE_ITEM_LIST') {
      data.itemList = listItems.filter(item => item.title).map(item => ({
        title: item.title,
        description: item.desc || undefined,
        img_url: item.imgUrl || undefined,
        link: item.link ? { url_mobile: item.link } : undefined,
      }));
    }

    // 캐러셀
    if (bubbleType === 'CAROUSEL_FEED' || bubbleType === 'CAROUSEL_COMMERCE') {
      data.carouselItems = carouselItems.map(item => ({
        header: item.header || undefined,
        message: item.message || undefined,
        attachment: {
          ...(item.imageUrl ? { image: { img_url: item.imageUrl, img_link: item.imageLink || undefined } } : {}),
          ...(item.buttons && item.buttons.length > 0 ? { button: item.buttons } : {}),
        },
        ...(item.commerce ? { commerce: item.commerce } : {}),
      }));
    }

    // 기본형(템플릿)
    if (mode === 'template') {
      data.templateCode = templateCode;
      if (Object.keys(templateVars).length > 0) {
        data.messageVariableJson = JSON.stringify(templateVars);
      }
    }

    onSend(data);
  };

  // 미리보기 데이터
  const previewData = {
    bubbleType,
    message: message || undefined,
    header: header || undefined,
    additionalContent: additionalContent || undefined,
    imageUrl: imageUrl || undefined,
    buttons: buttons.length > 0 ? buttons : undefined,
    videoUrl: videoUrl || undefined,
    commerce: commerceTitle ? {
      title: commerceTitle,
      regular_price: Number(regularPrice) || 0,
      discount_price: discountPrice ? Number(discountPrice) : undefined,
      discount_rate: discountRate ? Number(discountRate) : undefined,
    } : undefined,
    carouselItems: (bubbleType === 'CAROUSEL_FEED' || bubbleType === 'CAROUSEL_COMMERCE') ? carouselItems : undefined,
    listItems: bubbleType === 'WIDE_ITEM_LIST' ? listItems.filter(i => i.title).map(i => ({ title: i.title, desc: i.desc, imgUrl: i.imgUrl })) : undefined,
    couponTitle: couponTitle || undefined,
    isAd,
    unsubPhone: unsubPhone || undefined,
  };

  return (
    <div className="flex gap-8">
      {/* 좌측: 에디터 */}
      <div className="flex-1 min-w-0 space-y-6">
      {/* 모드 선택 */}
      <div className="flex gap-2">
        <button onClick={() => setMode('free')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'free' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          자유형 발송
        </button>
        <button onClick={() => setMode('template')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'template' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          기본형 (템플릿)
        </button>
      </div>

      {/* 유형 선택 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">메시지 유형</label>
        <div className="grid grid-cols-4 gap-2">
          {BUBBLE_TYPES.map(t => (
            <button key={t.code} onClick={() => { setBubbleType(t.code); setButtons([]); }}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                bubbleType === t.code ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">{t.icon}</div>
              <div className="text-xs font-bold">{t.label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 발신 프로필 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">발신 프로필</label>
          <select value={senderKey} onChange={(e) => setSenderKey(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">-- 선택 --</option>
            {profiles.map(p => (
              <option key={p.id} value={p.profile_key}>{p.profile_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">타겟팅</label>
          <select value={targeting} onChange={(e) => setTargeting(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            {TARGETING_OPTIONS.map(t => (
              <option key={t.code} value={t.code}>{t.label} — {t.desc}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 광고 여부 */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" />
        광고 메시지 (수신거부 표시 필요)
      </label>

      {/* 기본형: 템플릿 코드 */}
      {mode === 'template' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 코드</label>
          <input type="text" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="템플릿 코드 입력" />
        </div>
      )}

      {/* 헤더 (WIDE_ITEM_LIST, PREMIUM_VIDEO) */}
      {selectedType.needHeader && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">헤더 (최대 20자)</label>
          <input type="text" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={20} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="헤더 입력" />
          <div className="text-xs text-gray-400 mt-1 text-right">{header.length}/20</div>
        </div>
      )}

      {/* 본문 (TEXT, IMAGE, WIDE, PREMIUM_VIDEO) */}
      {selectedType.maxMsg > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">본문 (최대 {selectedType.maxMsg}자)</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={selectedType.maxMsg} rows={selectedType.maxMsg > 100 ? 6 : 3}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder="메시지 본문 입력" />
          <div className="text-xs text-gray-400 mt-1 text-right">{message.length}/{selectedType.maxMsg}</div>
        </div>
      )}

      {/* 이미지 (IMAGE, WIDE, COMMERCE) */}
      {selectedType.needImage && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <label className="block text-sm font-bold text-gray-700">이미지 {selectedType.needImage && <span className="text-red-500">*</span>}</label>
          <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="이미지 URL (jpg/png, 5MB, 800x400px)" />
          <input type="text" value={imageLink} onChange={(e) => setImageLink(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="클릭 시 이동 URL (선택)" />
          {imageUrl && <img src={imageUrl} alt="미리보기" className="w-full max-h-40 object-cover rounded-lg border" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />}
        </div>
      )}

      {/* 동영상 (PREMIUM_VIDEO) */}
      {(selectedType as any).needVideo && (
        <div className="bg-gray-50 rounded-lg p-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">카카오TV URL <span className="text-red-500">*</span></label>
          <input type="text" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://tv.kakao.com/v/123456" />
        </div>
      )}

      {/* 커머스 (COMMERCE, CAROUSEL_COMMERCE) */}
      {(selectedType as any).needCommerce && bubbleType === 'COMMERCE' && (
        <div className="bg-amber-50 rounded-lg p-4 space-y-2">
          <label className="block text-sm font-bold text-gray-700">상품 정보 <span className="text-red-500">*</span></label>
          <input type="text" value={commerceTitle} onChange={(e) => setCommerceTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="상품명" />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={regularPrice} onChange={(e) => setRegularPrice(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="정가 (원)" />
            <input type="number" value={discountPrice} onChange={(e) => setDiscountPrice(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="할인가 (선택)" />
            <input type="number" value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="할인율% (선택)" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">부가정보 (최대 34자)</label>
            <input type="text" value={additionalContent} onChange={(e) => setAdditionalContent(e.target.value)} maxLength={34} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="예: 무료배송, 한정수량" />
          </div>
        </div>
      )}

      {/* 아이템 리스트 (WIDE_ITEM_LIST) */}
      {bubbleType === 'WIDE_ITEM_LIST' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-gray-700">아이템 (3~4개)</label>
            {listItems.length < 4 && (
              <button onClick={addListItem} className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">+ 아이템 추가</button>
            )}
          </div>
          {listItems.map((item, idx) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2 relative">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500">아이템 {idx + 1}</span>
                {listItems.length > 3 && <button onClick={() => removeListItem(idx)} className="text-xs text-red-500 hover:text-red-700">삭제</button>}
              </div>
              <input type="text" value={item.title} onChange={(e) => { const n = [...listItems]; n[idx].title = e.target.value; setListItems(n); }} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="타이틀 (최대 25자)" maxLength={25} />
              <input type="text" value={item.desc} onChange={(e) => { const n = [...listItems]; n[idx].desc = e.target.value; setListItems(n); }} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="설명 (선택)" />
              <input type="text" value={item.imgUrl} onChange={(e) => { const n = [...listItems]; n[idx].imgUrl = e.target.value; setListItems(n); }} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="이미지 URL (선택)" />
              <input type="text" value={item.link} onChange={(e) => { const n = [...listItems]; n[idx].link = e.target.value; setListItems(n); }} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="클릭 링크 (선택)" />
            </div>
          ))}
        </div>
      )}

      {/* 캐러셀 (CAROUSEL_FEED, CAROUSEL_COMMERCE) */}
      {(bubbleType === 'CAROUSEL_FEED' || bubbleType === 'CAROUSEL_COMMERCE') && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-gray-700">캐러셀 아이템 (2~6개)</label>
            {carouselItems.length < 6 && (
              <button onClick={addCarouselItem} className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">+ 아이템 추가</button>
            )}
          </div>
          {carouselItems.map((item, idx) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500">카드 {idx + 1}</span>
                {carouselItems.length > 2 && <button onClick={() => removeCarouselItem(idx)} className="text-xs text-red-500 hover:text-red-700">삭제</button>}
              </div>
              <input type="text" value={item.header || ''} onChange={(e) => updateCarouselItem(idx, 'header', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="카드 제목" />
              <textarea value={item.message || ''} onChange={(e) => updateCarouselItem(idx, 'message', e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder="카드 본문" />
              <input type="text" value={item.imageUrl || ''} onChange={(e) => updateCarouselItem(idx, 'imageUrl', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="이미지 URL" />
              {bubbleType === 'CAROUSEL_COMMERCE' && (
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" value={item.commerce?.title || ''} onChange={(e) => updateCarouselItem(idx, 'commerce', { ...(item.commerce || { title: '', regular_price: 0 }), title: e.target.value })} className="border rounded-lg px-2 py-1.5 text-xs" placeholder="상품명" />
                  <input type="number" value={item.commerce?.regular_price || ''} onChange={(e) => updateCarouselItem(idx, 'commerce', { ...(item.commerce || { title: '', regular_price: 0 }), regular_price: Number(e.target.value) })} className="border rounded-lg px-2 py-1.5 text-xs" placeholder="정가" />
                  <input type="number" value={item.commerce?.discount_price || ''} onChange={(e) => updateCarouselItem(idx, 'commerce', { ...(item.commerce || { title: '', regular_price: 0 }), discount_price: Number(e.target.value) })} className="border rounded-lg px-2 py-1.5 text-xs" placeholder="할인가" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 버튼 에디터 */}
      {selectedType.maxBtn > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-bold text-gray-700">버튼 (최대 {selectedType.maxBtn}개)</label>
            {buttons.length < selectedType.maxBtn && (
              <button onClick={addButton} className="text-xs px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200">+ 버튼 추가</button>
            )}
          </div>
          {buttons.map((btn, idx) => (
            <div key={idx} className="flex gap-2 items-center bg-gray-50 rounded-lg p-2">
              <select value={btn.type} onChange={(e) => updateButton(idx, 'type', e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs w-24">
                {BUTTON_TYPES.map(bt => <option key={bt.code} value={bt.code}>{bt.label}</option>)}
              </select>
              <input type="text" value={btn.name} onChange={(e) => updateButton(idx, 'name', e.target.value)} className="flex-1 border rounded-lg px-2 py-1.5 text-xs" placeholder="버튼명" />
              {(btn.type === 'WL' || btn.type === 'AL') && (
                <input type="text" value={btn.url_mobile || ''} onChange={(e) => updateButton(idx, 'url_mobile', e.target.value)} className="flex-1 border rounded-lg px-2 py-1.5 text-xs" placeholder="URL" />
              )}
              <button onClick={() => removeButton(idx)} className="text-red-400 hover:text-red-600 text-sm px-1">×</button>
            </div>
          ))}
        </div>
      )}

      {/* 쿠폰 */}
      <details className="bg-gray-50 rounded-lg">
        <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">🎟️ 쿠폰 (선택)</summary>
        <div className="px-4 pb-3 space-y-2">
          <input type="text" value={couponTitle} onChange={(e) => setCouponTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="쿠폰 타이틀 (예: 10% 할인 쿠폰)" />
          <input type="text" value={couponDesc} onChange={(e) => setCouponDesc(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="쿠폰 설명 (선택)" />
          <input type="text" value={couponUrl} onChange={(e) => setCouponUrl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="쿠폰 URL (선택)" />
        </div>
      </details>

      {/* 대체 발송 */}
      <details className="bg-gray-50 rounded-lg">
        <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">📨 대체 발송 (선택)</summary>
        <div className="px-4 pb-3 space-y-2">
          <select value={resendType} onChange={(e) => setResendType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="NO">대체발송 없음</option>
            <option value="SM">SMS</option>
            <option value="LM">LMS</option>
            <option value="MM">MMS</option>
          </select>
          {resendType !== 'NO' && (
            <>
              <input type="text" value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="대체발송 발신번호" />
              <textarea value={resendMessage} onChange={(e) => setResendMessage(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder="대체발송 메시지 (빈칸이면 본문 재사용)" />
            </>
          )}
        </div>
      </details>

      {/* 수신거부 */}
      {isAd && (
        <details className="bg-gray-50 rounded-lg" open>
          <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">🚫 수신거부 080</summary>
          <div className="px-4 pb-3 grid grid-cols-2 gap-2">
            <input type="text" value={unsubPhone} onChange={(e) => setUnsubPhone(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="080 번호" />
            <input type="text" value={unsubAuth} onChange={(e) => setUnsubAuth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="인증번호" />
          </div>
        </details>
      )}

      {/* 발송 버튼 */}
      <button onClick={handleSend} disabled={sending || !senderKey}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        {sending ? '발송 중...' : '브랜드메시지 발송'}
      </button>
      </div>

      {/* 우측: 미리보기 */}
      <div className="w-[380px] shrink-0">
        <div className="sticky top-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">미리보기</h3>
          <BrandMessagePreview {...previewData} />
        </div>
      </div>
    </div>
  );
}
