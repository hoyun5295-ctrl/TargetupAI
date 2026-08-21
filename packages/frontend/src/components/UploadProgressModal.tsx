/**
 * UploadProgressModal — 고객 DB 저장 진행 상황
 *
 * 대시보드가 2초마다 `/api/upload/progress/:fileId`를 물어 그 응답을 그대로 내려준다.
 * 이 컴포넌트는 표시만 한다(폴링·종료 판정은 Dashboard가 소유).
 *
 * ★ 2026-08-21 표면 재작성(콘솔 톤 인디고). props·상태 판정 무변경.
 *   이모지 6곳(✅❌📤🔄⚠️💡) → lucide · blue/green 임의 색 → 진행 인디고 · 완료 에메랄드 · 실패 로즈.
 *   건수는 문장 안에 섞지 않고 타일로 뺐다 — 업로드 중 사용자가 보는 것은 "얼마나 됐나"와 "몇 건 들어갔나" 둘뿐이다.
 */

import { Upload, CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react';
import {
  CUI_MODAL, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC, CUI_MODAL_FOOT,
  CUI_BTN_PRIMARY, CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT,
  CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT,
} from '../utils/console-ui';

interface UploadProgressModalProps {
  show: boolean;
  uploadProgress: {
    status: string;
    total: number;
    processed: number;
    percent: number;
    insertCount: number;
    duplicateCount: number;
    errorCount: number;
    message: string;
  };
  onClose: () => void;
}

export default function UploadProgressModal({
  show,
  uploadProgress,
  onClose,
}: UploadProgressModalProps) {
  if (!show) return null;

  const done = uploadProgress.status === 'completed';
  const failed = uploadProgress.status === 'failed';
  const running = !done && !failed;

  const tone = done
    ? { badge: 'bg-emerald-600', bar: 'bg-emerald-500' }
    : failed
      ? { badge: 'bg-rose-600', bar: 'bg-rose-500' }
      : { badge: 'bg-indigo-600', bar: 'bg-indigo-600' };

  const title = done ? '업로드를 마쳤습니다' : failed ? '업로드하지 못했습니다' : '고객 데이터를 올리는 중';
  const hasCounts = uploadProgress.insertCount > 0 || uploadProgress.duplicateCount > 0 || uploadProgress.errorCount > 0;

  return (
    <div className="fixed inset-0 z-[9999] bg-neutral-900/45 flex items-center justify-center p-4 animate-in fade-in duration-150 motion-reduce:animate-none">
      <div className={`${CUI_MODAL} max-w-[440px]`} role="dialog" aria-modal="true" aria-label={title}>

        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-9 w-9 shrink-0 rounded-xl text-white grid place-items-center ${tone.badge}`}>
              {done
                ? <CheckCircle2 className="w-4 h-4" strokeWidth={1.9} />
                : failed
                  ? <XCircle className="w-4 h-4" strokeWidth={1.9} />
                  : <Upload className="w-4 h-4" strokeWidth={1.9} />}
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>{title}</h3>
              <p className={`${CUI_MODAL_DESC} tabular-nums`}>
                {(uploadProgress.processed || 0).toLocaleString()} / {(uploadProgress.total || 0).toLocaleString()}건
              </p>
            </div>
          </div>
          <span className="shrink-0 text-[15px] font-bold text-neutral-900 tabular-nums">{uploadProgress.percent || 0}%</span>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 진행바 */}
          <div className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${tone.bar}`}
              style={{ width: `${uploadProgress.percent || 0}%` }}
            />
          </div>

          {/* 건수 — 신규 · 업데이트 · 오류 */}
          {hasCounts && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2.5 text-center">
                <p className="text-[11.5px] text-neutral-500">새로 추가</p>
                <p className="mt-0.5 text-[17px] font-bold text-neutral-900 tabular-nums">{(uploadProgress.insertCount || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2.5 text-center">
                <p className="text-[11.5px] text-neutral-500">기존 갱신</p>
                <p className="mt-0.5 text-[17px] font-bold text-neutral-900 tabular-nums">{(uploadProgress.duplicateCount || 0).toLocaleString()}</p>
              </div>
              <div className={`rounded-xl px-3 py-2.5 text-center ring-1 ${uploadProgress.errorCount > 0 ? 'bg-rose-50 ring-rose-200' : 'bg-neutral-50 ring-neutral-200'}`}>
                <p className={`text-[11.5px] ${uploadProgress.errorCount > 0 ? 'text-rose-700' : 'text-neutral-500'}`}>오류</p>
                <p className={`mt-0.5 text-[17px] font-bold tabular-nums ${uploadProgress.errorCount > 0 ? 'text-rose-700' : 'text-neutral-900'}`}>
                  {(uploadProgress.errorCount || 0).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {running && (
            <div className={CUI_INFO}>
              <Loader2 className={`${CUI_INFO_ICON} animate-spin`} size={15} strokeWidth={1.9} />
              <p className={CUI_INFO_TEXT}>창을 닫거나 다른 일을 하셔도 처리는 계속됩니다.</p>
            </div>
          )}

          {failed && uploadProgress.message && (
            <div className={CUI_DANGER_BOX}>
              <Info className={CUI_DANGER_ICON} size={15} strokeWidth={1.9} />
              <p className={CUI_DANGER_TEXT}>{uploadProgress.message}</p>
            </div>
          )}

          {done && uploadProgress.message && (
            <div className="flex gap-2.5 p-3.5 rounded-lg border border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="text-emerald-700 shrink-0 mt-px" size={15} strokeWidth={1.9} />
              <p className="text-[13px] text-emerald-900 leading-relaxed">{uploadProgress.message}</p>
            </div>
          )}
        </div>

        {(done || failed) && (
          <div className={CUI_MODAL_FOOT}>
            <button type="button" onClick={onClose} className={CUI_BTN_PRIMARY}>확인</button>
          </div>
        )}
      </div>
    </div>
  );
}
