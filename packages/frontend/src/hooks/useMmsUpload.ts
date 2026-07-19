import { useState } from 'react';

/**
 * useMmsUpload — MMS 이미지 업로드 공용 훅 (컨트롤타워)
 *
 * 기존 Dashboard 인라인 3핸들러(handleMmsSlotUpload / handleMmsMultiUpload / handleMmsImageRemove)를
 * 단일 훅으로 통합해 여러 발송 화면(직접발송 · AI Operator 등)이 동일 업로드 로직을 재사용한다.
 * (no_inline_duplication — 업로드 검증/순서강제/서버 삭제 로직을 화면마다 복붙하지 않는다.)
 *
 * 검증 규칙 (이통사 정합):
 *  - JPG/JPEG만 (PNG/GIF 미지원)
 *  - 300KB 이하
 *  - 최대 3장, 왼쪽(앞) 슬롯부터 순서대로 등록 강제 (빈 앞슬롯 있는 상태에서 뒷슬롯 업로드 차단)
 *
 * @param onError 검증/업로드 실패 시 사용자 안내 콜백 (화면별 토스트/배너로 표시)
 */
export interface MmsUploadImage {
  serverPath: string;
  url: string;
  filename: string;
  originalName?: string;
  size: number;
}

const MAX_SLOTS = 3;
const MAX_BYTES = 300 * 1024;

function isJpg(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith('.jpg') || n.endsWith('.jpeg');
}

export function useMmsUpload(onError: (msg: string) => void) {
  const [mmsUploadedImages, setMmsUploadedImages] = useState<MmsUploadImage[]>([]);
  const [mmsUploading, setMmsUploading] = useState(false);

  // 단일 슬롯 업로드
  const handleMmsSlotUpload = async (file: File, slotIndex: number) => {
    // ★ 왼쪽(앞) 슬롯부터 순서대로 등록 강제 — 배열 hole(빈 자리) 방지
    if (slotIndex > mmsUploadedImages.length) {
      onError(`이미지 ${mmsUploadedImages.length + 1}번부터 순서대로 등록해주세요`);
      return;
    }
    if (!isJpg(file.name)) {
      onError('JPG 파일만 업로드 가능합니다 (PNG/GIF 미지원)');
      return;
    }
    if (file.size > MAX_BYTES) {
      onError(`${(file.size / 1024).toFixed(0)}KB — 300KB 이하만 가능합니다`);
      return;
    }

    setMmsUploading(true);
    try {
      const formData = new FormData();
      formData.append('images', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/mms-images/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success && data.images.length > 0) {
        setMmsUploadedImages(prev => {
          // 위 guard로 slotIndex ≤ prev.length 보장 → 배열 hole 없음
          const updated = [...prev];
          updated[slotIndex] = data.images[0];
          return updated;
        });
      } else {
        onError(data.error || '업로드 실패');
      }
    } catch {
      onError('이미지 업로드 중 오류 발생');
    } finally {
      setMmsUploading(false);
    }
  };

  // 다중 선택 한번에 첨부
  const handleMmsMultiUpload = async (files: FileList) => {
    const currentCount = mmsUploadedImages.length;
    const available = MAX_SLOTS - currentCount;
    if (available <= 0) {
      onError('최대 3장까지 첨부 가능합니다');
      return;
    }
    const filesToUpload = Array.from(files).slice(0, available);
    for (const file of filesToUpload) {
      if (!isJpg(file.name)) {
        onError(`${file.name}: JPG 파일만 업로드 가능합니다`);
        return;
      }
      if (file.size > MAX_BYTES) {
        onError(`${file.name}: ${(file.size / 1024).toFixed(0)}KB — 300KB 이하만 가능합니다`);
        return;
      }
    }
    setMmsUploading(true);
    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('images', file);
        const token = localStorage.getItem('token');
        const res = await fetch('/api/mms-images/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await res.json();
        if (res.ok && data.success && data.images.length > 0) {
          setMmsUploadedImages(prev => [...prev, data.images[0]]);
        }
      }
    } catch {
      onError('이미지 업로드 중 오류 발생');
    } finally {
      setMmsUploading(false);
    }
  };

  // ★ 2026-07-19 P4: 라이브러리 소재 → MMS 변환 첨부 (서버가 ≤300KB JPG 자동 변환 — 기존 업로드 계약과 동일 응답)
  const handleMmsFromAsset = async (assetId: string) => {
    if (mmsUploadedImages.length >= MAX_SLOTS) {
      onError('최대 3장까지 첨부 가능합니다');
      return;
    }
    setMmsUploading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/image-studio/mms-from-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.image) {
        setMmsUploadedImages(prev => (prev.length >= MAX_SLOTS ? prev : [...prev, data.image]));
      } else {
        onError(data.error || 'MMS 변환에 실패했습니다');
      }
    } catch {
      onError('MMS 변환 중 오류 발생');
    } finally {
      setMmsUploading(false);
    }
  };

  // 슬롯 삭제 (서버 unlink 시도 후 UI 제거)
  const handleMmsImageRemove = async (index: number) => {
    const img = mmsUploadedImages[index];
    if (img) {
      try {
        const token = localStorage.getItem('token');
        await fetch(img.url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      } catch { /* 서버 삭제 실패해도 UI에서는 제거 */ }
    }
    setMmsUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  return {
    mmsUploadedImages,
    setMmsUploadedImages,
    mmsUploading,
    handleMmsSlotUpload,
    handleMmsMultiUpload,
    handleMmsImageRemove,
    handleMmsFromAsset,
  };
}
