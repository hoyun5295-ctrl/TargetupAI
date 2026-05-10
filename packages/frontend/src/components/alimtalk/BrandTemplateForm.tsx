/**
 * ★ D150-2 (2026-05-10): 브랜드메시지 템플릿 등록/수정/상세 폼
 *
 * - chatBubbleType 8종 동적 분기:
 *   TEXT / IMAGE / WIDE / WIDE_ITEM_LIST / CAROUSEL_FEED / PREMIUM_VIDEO / COMMERCE / CAROUSEL_COMMERCE
 * - 버튼 타입 6종: WL / AL / BK / MD / AC / BF
 * - 검수 없음 — 등록 즉시 ACTIVE
 * - 이미지 업로드 6종 통합 (default/wide/wide-list-first/wide-list/carousel-feed/carousel-commerce)
 *
 * 백엔드:
 *   POST /api/alimtalk/brand-templates                          (등록 — company_admin)
 *   PUT  /api/alimtalk/brand-templates/:templateKey             (수정 — company_admin)
 *   POST /api/alimtalk/images/brand/default                     (단건)
 *   POST /api/alimtalk/images/brand/wide                        (단건)
 *   POST /api/alimtalk/images/brand/wide-list/first             (단건)
 *   POST /api/alimtalk/images/brand/wide-list                   (다중 ≤3)
 *   POST /api/alimtalk/images/brand/carousel-feed               (다중 ≤10)
 *   POST /api/alimtalk/images/brand/carousel-commerce           (다중 ≤11)
 */

import { useState, type ReactNode } from 'react';

interface Profile {
  id: string;
  profile_key: string;
  profile_name: string;
}

interface BrandTemplate {
  id?: string;
  template_key?: string;
  manage_name?: string;
  chat_bubble_type?: string;
  status?: string;
  profile_id?: string;
  profile_key?: string | null;
  profile_name?: string | null;
  custom_template_code?: string | null;
  content?: string | null;
  header?: string | null;
  additional_content?: string | null;
  buttons?: any[] | null;
  attachment_json?: any;
  carousel_json?: any;
  coupon?: any;
  adult?: 'Y' | 'N' | null;
}

type ChatBubbleType =
  | 'TEXT'
  | 'IMAGE'
  | 'WIDE'
  | 'WIDE_ITEM_LIST'
  | 'CAROUSEL_FEED'
  | 'PREMIUM_VIDEO'
  | 'COMMERCE'
  | 'CAROUSEL_COMMERCE';

type ButtonType = 'WL' | 'AL' | 'BK' | 'MD' | 'AC' | 'BF';

interface BrandButton {
  name: string;
  type: ButtonType;
  url_mobile?: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
  bizFormId?: number;
}

interface BrandImageRef {
  img_url: string;
  img_link?: string;
}

interface BrandItemListItem {
  title?: string;
  description?: string;
  img_url?: string;
}

interface BrandCarouselListItem {
  header?: string;
  content?: string;
  img_url?: string;
  img_link?: string;
  url_mobile?: string;
  url_pc?: string;
  // 캐러셀 커머스 전용
  title?: string;
  regular_price?: number;
  discount_price?: number;
}

interface FormState {
  profileId: string;
  templateKey: string;
  customTemplateCode: string;
  manageName: string;
  chatBubbleType: ChatBubbleType;
  adult: 'Y' | 'N';
  header: string;
  content: string;
  additionalContent: string;
  attachmentImage: BrandImageRef | null;
  attachmentItemList: BrandItemListItem[];
  attachmentVideoUrl: string;
  attachmentCommerce: { title: string; regular_price: number | ''; discount_price: number | '' };
  carouselList: BrandCarouselListItem[];
  buttons: BrandButton[];
}

const CHAT_BUBBLE_OPTIONS: { value: ChatBubbleType; label: string; desc: string }[] = [
  { value: 'TEXT',              label: '텍스트',          desc: '본문 최대 1,300자' },
  { value: 'IMAGE',             label: '이미지',          desc: '이미지 + 본문 ≤400자' },
  { value: 'WIDE',              label: '와이드',          desc: '와이드 이미지 + 본문 ≤76자' },
  { value: 'WIDE_ITEM_LIST',    label: '와이드 리스트',    desc: '헤더 + 아이템 3~4개' },
  { value: 'CAROUSEL_FEED',     label: '캐러셀 피드',      desc: '카드 슬라이드 ≤10장' },
  { value: 'PREMIUM_VIDEO',     label: '프리미엄 동영상',  desc: '동영상 + 텍스트' },
  { value: 'COMMERCE',          label: '커머스',          desc: '상품 + 가격' },
  { value: 'CAROUSEL_COMMERCE', label: '캐러셀 커머스',    desc: '상품 슬라이드 ≤11장' },
];

const BUTTON_TYPE_OPTIONS: { value: ButtonType; label: string }[] = [
  { value: 'WL', label: '웹링크' },
  { value: 'AL', label: '앱링크' },
  { value: 'BK', label: '봇키워드' },
  { value: 'MD', label: '메시지 디자이너' },
  { value: 'AC', label: '채널 추가' },
  { value: 'BF', label: '비즈폼' },
];

function getToken(): string {
  return localStorage.getItem('token') || '';
}

function initialFormState(template: BrandTemplate | null | undefined): FormState {
  const t = template || {};
  const att = t.attachment_json || {};
  const car = t.carousel_json || {};
  return {
    profileId: t.profile_id || '',
    templateKey: t.template_key || '',
    customTemplateCode: t.custom_template_code || '',
    manageName: t.manage_name || '',
    chatBubbleType: (t.chat_bubble_type as ChatBubbleType) || 'TEXT',
    adult: (t.adult as 'Y' | 'N') || 'N',
    header: t.header || '',
    content: t.content || '',
    additionalContent: t.additional_content || '',
    attachmentImage: att.image || null,
    attachmentItemList: att.item?.list || [],
    attachmentVideoUrl: att.video?.url || '',
    attachmentCommerce: att.commerce
      ? {
          title: att.commerce.title || '',
          regular_price: att.commerce.regular_price ?? '',
          discount_price: att.commerce.discount_price ?? '',
        }
      : { title: '', regular_price: '', discount_price: '' },
    carouselList: car.list || [],
    buttons: (t.buttons as BrandButton[]) || [],
  };
}

interface Props {
  mode: 'create' | 'edit' | 'view';
  template?: BrandTemplate | null;
  profiles: Profile[];
  onClose: () => void;
  onSuccess: () => void;
  setToast?: (t: { show: boolean; type: 'success' | 'error'; message: string }) => void;
}

export default function BrandTemplateForm({ mode, template, profiles, onClose, onSuccess, setToast }: Props) {
  const isView = mode === 'view';
  const isEdit = mode === 'edit';

  const [form, setForm] = useState<FormState>(() => initialFormState(template));
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const uploadSingleImage = async (file: File, endpoint: string): Promise<BrandImageRef | null> => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '이미지 업로드 실패');
      }
      const url = data.imageUrl || data.imc?.data?.imageUrl;
      if (!url) throw new Error('이미지 URL을 찾을 수 없습니다');
      return { img_url: url };
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 중 오류');
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const uploadMultiImage = async (files: File[], endpoint: string): Promise<string[]> => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('images', f));
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '이미지 업로드 실패');
      }
      const list = data.images || data.imc?.data?.list || [];
      return list.map((it: any) => it.imageUrl || it.url || it.imgUrl).filter(Boolean);
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 중 오류');
      return [];
    } finally {
      setUploadingImage(false);
    }
  };

  const validate = (): string | null => {
    if (!form.profileId) return '발신프로필을 선택해주세요';
    if (!form.manageName.trim()) return '관리명을 입력해주세요';
    if (!form.chatBubbleType) return '메시지 유형을 선택해주세요';

    switch (form.chatBubbleType) {
      case 'TEXT':
        if (!form.content.trim()) return '본문이 필수입니다';
        break;
      case 'IMAGE':
      case 'WIDE':
        if (!form.content.trim()) return '본문이 필수입니다';
        if (!form.attachmentImage?.img_url) return '이미지를 업로드해주세요';
        break;
      case 'WIDE_ITEM_LIST':
        if (!form.header.trim()) return '헤더가 필수입니다';
        if (form.attachmentItemList.length < 3 || form.attachmentItemList.length > 4) return '아이템은 3~4개여야 합니다';
        break;
      case 'CAROUSEL_FEED':
      case 'CAROUSEL_COMMERCE':
        if (!form.carouselList.length) return '캐러셀 카드가 필수입니다';
        break;
      case 'PREMIUM_VIDEO':
        if (!form.attachmentVideoUrl.trim()) return '동영상 URL이 필수입니다';
        break;
      case 'COMMERCE':
        if (!form.attachmentImage?.img_url) return '이미지를 업로드해주세요';
        if (!form.attachmentCommerce.title.trim()) return '상품명이 필수입니다';
        break;
    }

    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload: any = {
      profileId: form.profileId,
      manageName: form.manageName.trim(),
      chatBubbleType: form.chatBubbleType,
      adult: form.adult,
    };
    if (form.templateKey.trim()) payload.templateKey = form.templateKey.trim();
    if (form.customTemplateCode.trim()) payload.customTemplateCode = form.customTemplateCode.trim();
    if (form.header.trim()) payload.header = form.header.trim();
    if (form.content.trim()) payload.content = form.content.trim();
    if (form.additionalContent.trim()) payload.additionalContent = form.additionalContent.trim();

    const att: any = {};
    if (form.attachmentImage?.img_url) att.image = form.attachmentImage;
    if (form.attachmentItemList.length > 0) att.item = { list: form.attachmentItemList };
    if (form.attachmentVideoUrl.trim()) att.video = { url: form.attachmentVideoUrl.trim() };
    if (form.attachmentCommerce.title.trim()) {
      att.commerce = {
        title: form.attachmentCommerce.title.trim(),
        regular_price: typeof form.attachmentCommerce.regular_price === 'number' ? form.attachmentCommerce.regular_price : undefined,
        discount_price: typeof form.attachmentCommerce.discount_price === 'number' ? form.attachmentCommerce.discount_price : undefined,
      };
    }
    if (Object.keys(att).length > 0) payload.attachment = att;

    if (form.carouselList.length > 0) payload.carousel = { list: form.carouselList };
    if (form.buttons.length > 0) payload.buttons = form.buttons;

    try {
      const targetKey = isEdit ? form.templateKey || template?.template_key || '' : '';
      const url = isEdit
        ? `/api/alimtalk/brand-templates/${encodeURIComponent(targetKey)}`
        : '/api/alimtalk/brand-templates';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        if (setToast) setToast({ show: true, type: 'success', message: isEdit ? '수정 완료' : '등록 완료' });
        onSuccess();
      } else {
        setError(data.error || (isEdit ? '수정 실패' : '등록 실패'));
      }
    } catch (e: any) {
      setError(e?.message || '오류가 발생했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const titleText = isView
    ? '브랜드메시지 템플릿 상세'
    : isEdit
      ? '브랜드메시지 템플릿 수정'
      : '브랜드메시지 템플릿 등록';

  const imageEndpointFor = (type: ChatBubbleType): string | null => {
    switch (type) {
      case 'IMAGE':
      case 'COMMERCE':
        return '/api/alimtalk/images/brand/default';
      case 'WIDE':
        return '/api/alimtalk/images/brand/wide';
      case 'WIDE_ITEM_LIST':
        return '/api/alimtalk/images/brand/wide-list/first';
      default:
        return null;
    }
  };

  const carouselImageEndpoint = (type: ChatBubbleType): string | null => {
    if (type === 'CAROUSEL_FEED') return '/api/alimtalk/images/brand/carousel-feed';
    if (type === 'CAROUSEL_COMMERCE') return '/api/alimtalk/images/brand/carousel-commerce';
    return null;
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="text-base font-semibold text-gray-900">{titleText}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 발신프로필 */}
          <Field label="발신프로필" required>
            <select
              value={form.profileId}
              onChange={(e) => set('profileId', e.target.value)}
              disabled={isView || isEdit}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white disabled:bg-gray-50"
            >
              <option value="">선택</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.profile_name}
                </option>
              ))}
            </select>
          </Field>

          {/* 관리명 */}
          <Field label="관리명" required hint="최대 30자">
            <input
              type="text"
              value={form.manageName}
              onChange={(e) => set('manageName', e.target.value)}
              disabled={isView}
              maxLength={30}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
              placeholder="회원가입 발송 템플릿_v1"
            />
          </Field>

          {/* 관리코드 */}
          <Field label="관리코드 (선택)" hint="고객사 내부 코드, 최대 30자">
            <input
              type="text"
              value={form.customTemplateCode}
              onChange={(e) => set('customTemplateCode', e.target.value)}
              disabled={isView}
              maxLength={30}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
              placeholder="CUST_JOIN_001"
            />
          </Field>

          {/* chatBubbleType */}
          <Field label="메시지 유형" required>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {CHAT_BUBBLE_OPTIONS.map((opt) => {
                const selected = form.chatBubbleType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isView || isEdit}
                    onClick={() => set('chatBubbleType', opt.value)}
                    className={`text-left rounded-lg border p-2.5 transition ${
                      selected
                        ? 'border-blue-400 bg-blue-50 text-blue-800'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    } ${isView || isEdit ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            {isEdit && (
              <p className="text-[11px] text-amber-600 mt-1">
                ※ 수정 시 메시지 유형은 변경할 수 없습니다.
              </p>
            )}
          </Field>

          {/* TEXT */}
          {form.chatBubbleType === 'TEXT' && (
            <Field label="본문" required hint="최대 1,300자">
              <textarea
                value={form.content}
                onChange={(e) => set('content', e.target.value)}
                disabled={isView}
                maxLength={1300}
                rows={6}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                placeholder="홍길동님 회원가입을 축하합니다."
              />
              <div className="text-[11px] text-gray-400 text-right">
                {form.content.length}/1300
              </div>
            </Field>
          )}

          {/* IMAGE / WIDE */}
          {(form.chatBubbleType === 'IMAGE' || form.chatBubbleType === 'WIDE') && (
            <>
              <Field
                label="본문"
                required
                hint={form.chatBubbleType === 'IMAGE' ? '최대 400자' : '최대 76자'}
              >
                <textarea
                  value={form.content}
                  onChange={(e) => set('content', e.target.value)}
                  disabled={isView}
                  maxLength={form.chatBubbleType === 'IMAGE' ? 400 : 76}
                  rows={form.chatBubbleType === 'IMAGE' ? 4 : 2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                />
              </Field>
              <SingleImageField
                label="이미지"
                required
                disabled={isView || uploadingImage}
                value={form.attachmentImage}
                onChange={(img) => set('attachmentImage', img)}
                endpoint={imageEndpointFor(form.chatBubbleType)!}
                upload={uploadSingleImage}
              />
            </>
          )}

          {/* WIDE_ITEM_LIST */}
          {form.chatBubbleType === 'WIDE_ITEM_LIST' && (
            <>
              <Field label="헤더" required hint="최대 20자">
                <input
                  type="text"
                  value={form.header}
                  onChange={(e) => set('header', e.target.value)}
                  disabled={isView}
                  maxLength={20}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                />
              </Field>
              <SingleImageField
                label="첫 이미지 (와이드)"
                disabled={isView || uploadingImage}
                value={form.attachmentImage}
                onChange={(img) => set('attachmentImage', img)}
                endpoint="/api/alimtalk/images/brand/wide-list/first"
                upload={uploadSingleImage}
              />
              <ItemListEditor
                disabled={isView}
                items={form.attachmentItemList}
                onChange={(items) => set('attachmentItemList', items)}
              />
            </>
          )}

          {/* PREMIUM_VIDEO */}
          {form.chatBubbleType === 'PREMIUM_VIDEO' && (
            <>
              <Field label="헤더 (선택)" hint="최대 20자">
                <input
                  type="text"
                  value={form.header}
                  onChange={(e) => set('header', e.target.value)}
                  disabled={isView}
                  maxLength={20}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                />
              </Field>
              <Field label="본문 (선택)" hint="최대 76자">
                <textarea
                  value={form.content}
                  onChange={(e) => set('content', e.target.value)}
                  disabled={isView}
                  maxLength={76}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                />
              </Field>
              <Field label="동영상 URL" required>
                <input
                  type="url"
                  value={form.attachmentVideoUrl}
                  onChange={(e) => set('attachmentVideoUrl', e.target.value)}
                  disabled={isView}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50 font-mono"
                  placeholder="https://..."
                />
              </Field>
            </>
          )}

          {/* COMMERCE */}
          {form.chatBubbleType === 'COMMERCE' && (
            <>
              <SingleImageField
                label="상품 이미지"
                required
                disabled={isView || uploadingImage}
                value={form.attachmentImage}
                onChange={(img) => set('attachmentImage', img)}
                endpoint="/api/alimtalk/images/brand/default"
                upload={uploadSingleImage}
              />
              <Field label="상품명" required>
                <input
                  type="text"
                  value={form.attachmentCommerce.title}
                  onChange={(e) =>
                    set('attachmentCommerce', {
                      ...form.attachmentCommerce,
                      title: e.target.value,
                    })
                  }
                  disabled={isView}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="정상가">
                  <input
                    type="number"
                    value={form.attachmentCommerce.regular_price}
                    onChange={(e) =>
                      set('attachmentCommerce', {
                        ...form.attachmentCommerce,
                        regular_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    disabled={isView}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                  />
                </Field>
                <Field label="할인가">
                  <input
                    type="number"
                    value={form.attachmentCommerce.discount_price}
                    onChange={(e) =>
                      set('attachmentCommerce', {
                        ...form.attachmentCommerce,
                        discount_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    disabled={isView}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                  />
                </Field>
              </div>
              <Field label="부가정보 (선택)" hint="최대 34자">
                <input
                  type="text"
                  value={form.additionalContent}
                  onChange={(e) => set('additionalContent', e.target.value)}
                  disabled={isView}
                  maxLength={34}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50"
                />
              </Field>
            </>
          )}

          {/* CAROUSEL_FEED / CAROUSEL_COMMERCE */}
          {(form.chatBubbleType === 'CAROUSEL_FEED' ||
            form.chatBubbleType === 'CAROUSEL_COMMERCE') && (
            <CarouselListEditor
              disabled={isView}
              type={form.chatBubbleType}
              items={form.carouselList}
              onChange={(list) => set('carouselList', list)}
              imageEndpoint={carouselImageEndpoint(form.chatBubbleType)!}
              uploadMulti={uploadMultiImage}
            />
          )}

          {/* 버튼 */}
          <ButtonsEditor
            disabled={isView}
            buttons={form.buttons}
            chatBubbleType={form.chatBubbleType}
            onChange={(buttons) => set('buttons', buttons)}
          />

          {/* 성인 메시지 */}
          <Field label="성인 메시지 여부">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={isView}
                checked={form.adult === 'Y'}
                onChange={(e) => set('adult', e.target.checked ? 'Y' : 'N')}
              />
              <span>성인용 메시지로 등록</span>
            </label>
          </Field>

          {/* 에러 */}
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">
              {error}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="border-t border-gray-100 px-6 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            {isView ? '닫기' : '취소'}
          </button>
          {!isView && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || uploadingImage}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {submitting ? '저장 중…' : isEdit ? '수정 완료' : '등록'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-gray-400 ml-2 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function SingleImageField({
  label,
  required,
  disabled,
  value,
  onChange,
  endpoint,
  upload,
}: {
  label: string;
  required?: boolean;
  disabled?: boolean;
  value: BrandImageRef | null;
  onChange: (img: BrandImageRef | null) => void;
  endpoint: string;
  upload: (file: File, endpoint: string) => Promise<BrandImageRef | null>;
}) {
  return (
    <Field label={label} required={required}>
      {value?.img_url ? (
        <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
          <img src={value.img_url} alt="" className="w-16 h-16 object-cover rounded border border-gray-200" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500 break-all">{value.img_url}</div>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-xs text-red-500 hover:text-red-700 mt-1"
              >
                제거
              </button>
            )}
          </div>
        </div>
      ) : (
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const img = await upload(f, endpoint);
            if (img) onChange(img);
            e.currentTarget.value = '';
          }}
          className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
        />
      )}
    </Field>
  );
}

function ItemListEditor({
  disabled,
  items,
  onChange,
}: {
  disabled?: boolean;
  items: BrandItemListItem[];
  onChange: (items: BrandItemListItem[]) => void;
}) {
  const update = (idx: number, partial: Partial<BrandItemListItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...partial } : it)));
  };
  const add = () => {
    if (items.length >= 4) return;
    onChange([...items, { title: '', description: '', img_url: '' }]);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Field label={`아이템 리스트 (${items.length}/4, 3~4개 필수)`}>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">아이템 #{idx + 1}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-xs text-red-500"
                >
                  제거
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder="제목 (최대 25자)"
              value={it.title || ''}
              onChange={(e) => update(idx, { title: e.target.value })}
              disabled={disabled}
              maxLength={25}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
            />
            <input
              type="text"
              placeholder="설명 (최대 30자)"
              value={it.description || ''}
              onChange={(e) => update(idx, { description: e.target.value })}
              disabled={disabled}
              maxLength={30}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
            />
            <input
              type="text"
              placeholder="이미지 URL (선택)"
              value={it.img_url || ''}
              onChange={(e) => update(idx, { img_url: e.target.value })}
              disabled={disabled}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-100"
            />
          </div>
        ))}
        {!disabled && items.length < 4 && (
          <button
            type="button"
            onClick={add}
            className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:bg-gray-50"
          >
            + 아이템 추가 (최소 3개)
          </button>
        )}
      </div>
    </Field>
  );
}

function CarouselListEditor({
  disabled,
  type,
  items,
  onChange,
  imageEndpoint,
  uploadMulti,
}: {
  disabled?: boolean;
  type: 'CAROUSEL_FEED' | 'CAROUSEL_COMMERCE';
  items: BrandCarouselListItem[];
  onChange: (items: BrandCarouselListItem[]) => void;
  imageEndpoint: string;
  uploadMulti: (files: File[], endpoint: string) => Promise<string[]>;
}) {
  const max = type === 'CAROUSEL_FEED' ? 10 : 11;
  const update = (idx: number, partial: Partial<BrandCarouselListItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...partial } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Field label={`캐러셀 카드 (${items.length}/${max}장)`}>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">카드 #{idx + 1}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-xs text-red-500"
                >
                  제거
                </button>
              )}
            </div>
            {it.img_url && (
              <img src={it.img_url} alt="" className="w-full h-24 object-cover rounded border border-gray-200" />
            )}
            {type === 'CAROUSEL_COMMERCE' && (
              <>
                <input
                  type="text"
                  placeholder="상품명"
                  value={it.title || ''}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="정상가"
                    value={it.regular_price ?? ''}
                    onChange={(e) =>
                      update(idx, {
                        regular_price: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    disabled={disabled}
                    className="border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                  />
                  <input
                    type="number"
                    placeholder="할인가"
                    value={it.discount_price ?? ''}
                    onChange={(e) =>
                      update(idx, {
                        discount_price: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    disabled={disabled}
                    className="border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                  />
                </div>
              </>
            )}
            {type === 'CAROUSEL_FEED' && (
              <>
                <input
                  type="text"
                  placeholder="헤더"
                  value={it.header || ''}
                  onChange={(e) => update(idx, { header: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                />
                <input
                  type="text"
                  placeholder="본문"
                  value={it.content || ''}
                  onChange={(e) => update(idx, { content: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                />
              </>
            )}
            <input
              type="text"
              placeholder="클릭 시 이동 URL (선택)"
              value={it.url_mobile || ''}
              onChange={(e) => update(idx, { url_mobile: e.target.value, url_pc: e.target.value })}
              disabled={disabled}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100 font-mono"
            />
          </div>
        ))}
        {!disabled && items.length < max && (
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              const slot = max - items.length;
              const urls = await uploadMulti(files.slice(0, slot), imageEndpoint);
              const newItems = urls.map((u) => ({ img_url: u } as BrandCarouselListItem));
              onChange([...items, ...newItems]);
              e.currentTarget.value = '';
            }}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        )}
      </div>
    </Field>
  );
}

function ButtonsEditor({
  disabled,
  buttons,
  chatBubbleType,
  onChange,
}: {
  disabled?: boolean;
  buttons: BrandButton[];
  chatBubbleType: ChatBubbleType;
  onChange: (buttons: BrandButton[]) => void;
}) {
  const maxBtn = (() => {
    switch (chatBubbleType) {
      case 'TEXT':
      case 'IMAGE':
        return 5;
      case 'WIDE':
      case 'WIDE_ITEM_LIST':
        return 2;
      case 'PREMIUM_VIDEO':
        return 1;
      case 'COMMERCE':
        return 2;
      default:
        return 5;
    }
  })();

  const update = (idx: number, partial: Partial<BrandButton>) => {
    onChange(buttons.map((b, i) => (i === idx ? { ...b, ...partial } : b)));
  };
  const add = () => {
    if (buttons.length >= maxBtn) return;
    onChange([...buttons, { name: '', type: 'WL' }]);
  };
  const remove = (idx: number) => onChange(buttons.filter((_, i) => i !== idx));

  return (
    <Field label={`버튼 (${buttons.length}/${maxBtn}개)`}>
      <div className="space-y-2">
        {buttons.map((b, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-600">버튼 #{idx + 1}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-xs text-red-500"
                >
                  제거
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={b.type}
                onChange={(e) => {
                  const newType = e.target.value as ButtonType;
                  // AC 버튼명은 '채널 추가' 고정 (D135+ B6)
                  update(idx, {
                    type: newType,
                    name: newType === 'AC' ? '채널 추가' : b.name,
                  });
                }}
                disabled={disabled}
                className="border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
              >
                {BUTTON_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="버튼명 (최대 14자)"
                value={b.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                disabled={disabled || b.type === 'AC'}
                maxLength={14}
                className="border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
              />
            </div>
            {(b.type === 'WL' || b.type === 'AL') && (
              <>
                <input
                  type="text"
                  placeholder="모바일 URL"
                  value={b.url_mobile || ''}
                  onChange={(e) => update(idx, { url_mobile: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-100"
                />
                <input
                  type="text"
                  placeholder="PC URL (선택)"
                  value={b.url_pc || ''}
                  onChange={(e) => update(idx, { url_pc: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-100"
                />
              </>
            )}
            {b.type === 'AL' && (
              <>
                <input
                  type="text"
                  placeholder="Android scheme"
                  value={b.scheme_android || ''}
                  onChange={(e) => update(idx, { scheme_android: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-100"
                />
                <input
                  type="text"
                  placeholder="iOS scheme"
                  value={b.scheme_ios || ''}
                  onChange={(e) => update(idx, { scheme_ios: e.target.value })}
                  disabled={disabled}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono disabled:bg-gray-100"
                />
              </>
            )}
            {b.type === 'BF' && (
              <input
                type="number"
                placeholder="비즈폼 ID"
                value={b.bizFormId ?? ''}
                onChange={(e) =>
                  update(idx, {
                    bizFormId: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                disabled={disabled}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs disabled:bg-gray-100"
              />
            )}
          </div>
        ))}
        {!disabled && buttons.length < maxBtn && (
          <button
            type="button"
            onClick={add}
            className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:bg-gray-50"
          >
            + 버튼 추가
          </button>
        )}
      </div>
    </Field>
  );
}
