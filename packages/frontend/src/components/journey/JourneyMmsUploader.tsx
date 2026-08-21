/**
 * ★ D189 #3 (2026-05-22): JourneyMmsUploader — Journey Step MMS 이미지 업로드 (최대 3개)
 *
 * 영역 정합:
 *   - routes/mms-images.ts POST /api/mms-images/upload 재사용 (multer + 300KB + JPG only)
 *   - step.mms_image_paths (text[]) 매트릭스 누적
 *   - mmsServerPathToUrl 패턴 — URL 단순 추출 (companyDir/filename)
 *
 * 영구 원칙:
 *   - JPG만 (PNG/GIF는 통신사 거절 위험)
 *   - 300KB 이하 (LIMITS.mmsImageSize)
 *   - 최대 3개 (LIMITS.mmsImageCount)
 *   - 한글 파일명 자동 ASCII 변환 (D152-1 영구 룰 — multer latin1 → utf-8 복원)
 *
 * UI 매트릭스:
 *   - 이미지 슬롯 grid (3 컬럼)
 *   - 업로드 버튼 (현재 < 3 시만 노출)
 *   - 미리보기 + 삭제 (hover 영역)
 *   - 클라이언트 측 사전 검증 (size + ext)
 */

import { useState, useRef } from 'react';
import { Image as ImageIcon, X, Loader2, Upload, FolderOpen } from 'lucide-react';
// ★ 2026-07-19 P4: 라이브러리 소재 → MMS 자동 변환(≤300KB) 첨부
import AssetLibraryPickerModal from '../assets/AssetLibraryPickerModal';

interface MmsImageItem {
  serverPath: string;
  url: string;
  filename: string;
}

interface Props {
  value: string[];
  onChange: (paths: string[]) => void;
  disabled?: boolean;
  maxCount?: number;
}

const MAX_FILE_SIZE = 300 * 1024;

/**
 * server absolute path → 미리보기 URL 변환
 * formatDate.ts mmsServerPathToUrl 패턴 정합 (companyDir/filename 추출)
 */
function serverPathToUrl(serverPath: string): string {
  const parts = serverPath.split(/[\\/]/);
  const filename = parts[parts.length - 1] || '';
  const companyDir = parts[parts.length - 2] || '';
  if (!filename || !companyDir) return '';
  return `/api/mms-images/${companyDir}/${filename}`;
}

export default function JourneyMmsUploader({ value, onChange, disabled, maxCount = 3 }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false); // ★ P4: 라이브러리 변환 첨부
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ★ P4: 라이브러리 소재 → 서버 MMS 변환(≤300KB JPG) → serverPath 누적
  const handleFromAsset = async (assetId: string) => {
    if (disabled || value.length >= maxCount) {
      setError(`최대 ${maxCount}개까지 업로드 가능합니다.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/image-studio/mms-from-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data.image?.serverPath) throw new Error(data?.error || 'MMS 변환 실패');
      onChange([...value, data.image.serverPath]);
    } catch (e: any) {
      setError(e?.message || 'MMS 변환 실패');
    } finally {
      setUploading(false);
    }
  };

  const items: MmsImageItem[] = value.map((serverPath) => ({
    serverPath,
    url: serverPathToUrl(serverPath),
    filename: serverPath.split(/[\\/]/).pop() || '',
  }));

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (disabled) return;

    if (value.length + files.length > maxCount) {
      setError(`최대 ${maxCount}개까지 업로드 가능합니다.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > MAX_FILE_SIZE) {
        setError(`${f.name}: 300KB 초과 (${(f.size / 1024).toFixed(0)}KB)`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      const lower = f.name.toLowerCase();
      const ext = lower.slice(lower.lastIndexOf('.'));
      if (ext !== '.jpg' && ext !== '.jpeg') {
        setError(`${f.name}: JPG 파일만 업로드 가능 (PNG/GIF는 통신사 거절 위험)`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/mms-images/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '업로드 실패');
      }
      const newPaths = (data.images || []).map((img: { serverPath: string }) => img.serverPath);
      onChange([...value, ...newPaths]);
    } catch (err: any) {
      setError(err?.message || '업로드 실패');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = (idx: number) => {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== idx));
  };

  const canAdd = value.length < maxCount && !disabled;

  return (
    <div className="border border-cyan-500/30 rounded-lg bg-cyan-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
          <ImageIcon className="w-3.5 h-3.5" />
          MMS 이미지 ({value.length}/{maxCount})
        </div>
        {canAdd && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 text-cyan-200 rounded text-[11px] flex items-center gap-1"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              이미지 추가
            </button>
            <button
              type="button"
              onClick={() => setLibOpen(true)}
              disabled={uploading}
              className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-200 rounded text-[11px] flex items-center gap-1"
              title="라이브러리 소재를 MMS 규격(≤300KB)으로 자동 변환해 첨부"
            >
              <FolderOpen className="w-3 h-3" />
              라이브러리
            </button>
          </div>
        )}
      </div>

      <AssetLibraryPickerModal open={libOpen} onClose={() => setLibOpen(false)} onPick={(a) => handleFromAsset(a.id)} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,image/jpeg"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* ★ 2026-07-30 Harold 지적 — 내부 코드명(KISA 매트릭스·D152-1 영구 룰)이 고객 화면에 노출되던 문구 정정. 규칙 자체(JPG·300KB·ASCII 변환)는 동일 */}
      <div className="text-[10px] text-cyan-200/60 leading-relaxed">
        JPG만 / 300KB 이하 / 1280x720 권장.
        한글 파일명은 자동으로 영문 파일명으로 바뀝니다.
        PNG/GIF는 통신사에서 거절될 수 있어요. JPG로 변환 후 업로드해주세요.
      </div>

      {error && (
        <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded text-[11px] text-rose-200">
          {error}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={img.url}
                alt={`MMS ${idx + 1}`}
                className="w-full h-20 object-cover rounded border border-white/10"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(idx)}
                  className="absolute top-1 right-1 p-0.5 bg-rose-500/80 hover:bg-rose-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="삭제"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
