/**
 * SyncActiveBlockModal.tsx
 * ========================
 * SyncAgent v1.5.0 — 싱크 사용 중 고객 DB 수동 변경 차단 모달 (설계서 §4-4)
 *
 * 표시 조건 (둘 중 하나):
 *   1. 프론트 사전 체크: company.use_db_sync === true
 *   2. 백엔드 응답: HTTP 403 { code: 'SYNC_ACTIVE_BLOCK' }
 *
 * 허용 (이 모달 표시 안 함):
 *   - 직접발송 수신자 엑셀 (일회성 목록)
 *   - 수신거부 엑셀 업로드 (unsubscribes 독립)
 *   - AI 발송 / 조회 / 분석
 */

import React from 'react';
import { X, Link as LinkIcon } from 'lucide-react';

interface SyncActiveBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 서버 응답의 error 메시지 (선택) */
  message?: string;
}

export default function SyncActiveBlockModal({ isOpen, onClose, message }: SyncActiveBlockModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <LinkIcon className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">싱크에이전트 사용 중</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition"
            aria-label="닫기"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-gray-700">
          <p>
            이 회사는 현재 <strong className="text-blue-700">싱크에이전트</strong>를 통해
            고객사 DB 서버와 자동으로 동기화 중입니다.
          </p>
          <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
            고객 DB를 수동으로 수정하면 다음 동기화 시 소스 DB 데이터로 다시 덮어써져
            <strong> 변경 내용이 유실</strong>됩니다.
          </p>
          <p>
            고객 정보를 변경하려면 <strong>귀사의 DB 서버에서 직접 수정</strong>해주세요.
            변경 내용은 싱크 주기에 맞춰 한줄로에 자동 반영됩니다.
          </p>
          {message && message !== '' && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 font-mono">
              {message}
            </p>
          )}
          <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            문의: 한줄로 고객센터
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
        >
          확인
        </button>
      </div>
    </div>
  );
}
