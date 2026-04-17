/**
 * 알림톡/브랜드메시지 공용 이미지 업로드 래퍼
 *
 * - 업로드 타입 9종 (uploadType)에 따라 엔드포인트 자동 선택
 * - 업로드 성공 시 IMC가 반환한 imageUrl + imageName을 onChange로 전달
 * - Phase 0(API KEY 미수령) 시 업로드 실패 가능 — 에러 메시지만 표시
 */

import { useRef, useState } from 'react';

type UploadType =
  | 'alimtalk_template'
  | 'alimtalk_highlight'
  | 'brand_default'
  | 'brand_wide'
  | 'brand_wide_list_first'
  | 'brand_wide_list'
  | 'brand_carousel_feed'
  | 'brand_carousel_commerce'
  | 'marketing_agree';

interface Props {
  uploadType: UploadType;
  value?: string; // 현재 imageUrl (미리보기)
  onChange: (imageUrl: string, imageName: string) => void;
  disabled?: boolean;
  /** marketing_agree 타입일 때만 필요 (senderKey 대신 senderId — 백엔드에서 profile_key 조회) */
  senderId?: string;
  /** 공통 라벨/힌트 커스터마이즈 */
  label?: string;
  hint?: string;
}

const ENDPOINT_MAP: Record<UploadType, string> = {
  alimtalk_template:    '/api/alimtalk/images/alimtalk/template',
  alimtalk_highlight:   '/api/alimtalk/images/alimtalk/highlight',
  brand_default:        '/api/alimtalk/images/brand/default',
  brand_wide:           '/api/alimtalk/images/brand/wide',
  brand_wide_list_first:'/api/alimtalk/images/brand/wide-list/first',
  brand_wide_list:      '/api/alimtalk/images/brand/wide-list',
  brand_carousel_feed:  '/api/alimtalk/images/brand/carousel-feed',
  brand_carousel_commerce: '/api/alimtalk/images/brand/carousel-commerce',
  marketing_agree:      '/api/alimtalk/images/marketing-agree/__SENDER__',
};

const HINT_MAP: Record<UploadType, string> = {
  alimtalk_template:     '800×400px / JPG·PNG / 500KB 이하',
  alimtalk_highlight:    '108×108px / JPG·PNG',
  brand_default:         '600×400px / JPG·PNG / 500KB 이하',
  brand_wide:            '800×420px / JPG·PNG / 500KB 이하',
  brand_wide_list_first: '800×400px / 리스트 첫 이미지',
  brand_wide_list:       '300×300px / 최대 3장',
  brand_carousel_feed:   '600×400px / 최대 10장',
  brand_carousel_commerce: '600×600px / 최대 11장',
  marketing_agree:       '증적자료 이미지 (슈퍼관리자 전용)',
};

function getToken(): string {
  return localStorage.getItem('token') || '';
}

export default function KakaoChannelImageUpload({
  uploadType,
  value,
  onChange,
  disabled,
  senderId,
  label,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setErr(null);
    setUploading(true);
    try {
      const endpoint = uploadType === 'marketing_agree'
        ? ENDPOINT_MAP[uploadType].replace('__SENDER__', senderId || '')
        : ENDPOINT_MAP[uploadType];

      const fd = new FormData();
      fd.append('image', file);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `업로드 실패 (${res.status})`);
      }

      const imc = data.imc?.data;
      if (!imc?.imageUrl || !imc?.imageName) {
        throw new Error('IMC 응답에 imageUrl/imageName 없음');
      }
      onChange(imc.imageUrl, imc.imageName);
    } catch (e: any) {
      setErr(e?.message || '업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-gray-600">{label}</label>
      )}

      <div className="flex gap-2 items-start">
        {value && (
          <img
            src={value}
            alt="preview"
            className="w-20 h-20 object-cover rounded-lg border border-gray-200"
          />
        )}

        <div className="flex-1">
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || uploading}
            className="text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg disabled:opacity-50"
          >
            {uploading ? '업로드 중...' : value ? '이미지 교체' : '이미지 업로드'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = '';
            }}
          />

          <p className="text-[11px] text-gray-400 mt-1">
            {hint || HINT_MAP[uploadType]}
          </p>
          {err && <p className="text-[11px] text-red-500 mt-1">{err}</p>}
        </div>
      </div>
    </div>
  );
}
