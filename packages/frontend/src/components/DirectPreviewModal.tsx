import type { FieldMeta } from './DirectTargetFilterModal';
import { replaceDirectVars, replaceVarsByFieldMeta, resolveRecipientCallback } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';

interface DirectPreviewModalProps {
  show: boolean;
  onClose: () => void;
  directMessage: string;
  directMsgType: string;
  directSubject: string;
  directRecipients: any[];
  targetRecipients: any[];
  showTargetSend: boolean;
  selectedCallback: string;
  mmsUploadedImages: { serverPath: string; url: string; filename: string; size: number }[];
  formatPhoneNumber: (phone: string) => string;
  calculateBytes: (text: string) => number;
  getFullMessage: (msg: string) => string;
  // ★ D43-3c: 타겟발송 동적 필드 메타
  targetFieldsMeta: FieldMeta[];
  // ★ D137 UI: 광고표기 ON/OFF — LMS/MMS 제목에 (광고) prefix 적용
  adTextEnabled?: boolean;
  // ★ D137 UI: 개별회신번호 컬럼 매핑 검증
  useIndividualCallback?: boolean;
  individualCallbackColumn?: string;
}

// ★ B+0407-1: 인라인 replaceVarsWithMeta 제거 — formatDate.ts replaceVarsByFieldMeta 컨트롤타워 사용
//   FieldMeta[] 그대로 ReplaceVarsFieldMeta[]로 호환됨 (필드 호환 — field_key, variable, data_type, display_name)
const replaceVarsWithMeta = (text: string, recipient: any, fieldsMeta: FieldMeta[], fallback: boolean = false) =>
  replaceVarsByFieldMeta(text, recipient, fieldsMeta as any, { fallback });

// ★ D97: 인라인 제거 → formatDate.ts replaceDirectVars 컨트롤타워 사용
// fallback=true → useFallbackLabels=true (미리보기용 라벨 표시)
const replaceVarsDirectWrap = (text: string, recipient: any, selectedCallback: string, fallback: boolean = false) => {
  if (!text || !recipient) return text;
  return replaceDirectVars(text, recipient, selectedCallback, fallback);
};

export default function DirectPreviewModal({
  show, onClose,
  directMessage, directMsgType, directSubject,
  directRecipients, targetRecipients, showTargetSend,
  selectedCallback, mmsUploadedImages,
  formatPhoneNumber, calculateBytes, getFullMessage,
  targetFieldsMeta,
  adTextEnabled = false,
  useIndividualCallback = false,
  individualCallbackColumn = '',
}: DirectPreviewModalProps) {
  if (!show) return null;

  // ★ D137 UI: 제목에 (광고) 자동 prefix — 이미 포함되어 있으면 중복 방지
  const subjectWithAd = adTextEnabled && directSubject
    ? (directSubject.trim().startsWith('(광고)') ? directSubject : `(광고) ${directSubject}`)
    : directSubject;

  // ★ D137 (0424): formatDate.ts resolveRecipientCallback 컨트롤타워 사용 (원칙 3 준수).
  // 인라인 중복 제거 — custom_fields JSONB 내부 키(custom_1~15) 지원 + fallbackCallback=selectedCallback.
  const resolveCallback = (r: any): string =>
    resolveRecipientCallback(r, !!useIndividualCallback, individualCallbackColumn || '', selectedCallback) || '';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className={`bg-white rounded-2xl shadow-2xl overflow-hidden ${(directMessage.includes('%') && (directRecipients.length > 0 || targetRecipients.length > 0)) ? 'w-[860px]' : 'w-[400px]'}`}>
        <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">📄 메시지 미리보기</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        
        <div className="p-6 flex gap-6">
          {/* 좌측: 폰 프레임 */}
          <div className="flex flex-col items-center shrink-0">
            <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200">
              <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[280px]" style={{ height: '420px' }}>
                {/* 상단 - 회신번호 (첫 수신자의 실제 적용 번호) */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                  <span className="text-[11px] text-gray-400 font-medium">{directMsgType === 'MMS' ? 'MMS' : directMsgType === 'LMS' ? 'LMS' : '문자메시지'}</span>
                  {(() => {
                    const firstR = showTargetSend ? targetRecipients[0] : directRecipients[0];
                    const cb = resolveCallback(firstR);
                    return (
                      <span className="text-[11px] font-bold text-emerald-600">
                        {cb ? formatPhoneNumber(cb) : '회신번호'}
                        {useIndividualCallback && individualCallbackColumn && (
                          <span className="ml-1 text-blue-500 font-medium">· {individualCallbackColumn}</span>
                        )}
                      </span>
                    );
                  })()}
                </div>
                {/* LMS/MMS 제목 — (광고) prefix 포함 */}
                {(directMsgType === 'LMS' || directMsgType === 'MMS') && subjectWithAd && (
                  <div className="px-4 py-2 bg-orange-50 border-b border-orange-200">
                    <span className="text-sm font-bold text-orange-700" style={{ wordBreak: 'keep-all' }}>{subjectWithAd}</span>
                  </div>
                )}
                {/* 메시지 영역 */}
                <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                  {/* ★ B3: 공용 컴포넌트 MmsImagePreview 사용 */}
                  {mmsUploadedImages.length > 0 && (
                    <MmsImagePreview images={mmsUploadedImages} size="full" compact />
                  )}
                  <div className="flex gap-2 mt-1">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[13px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                      {/* ★ D43-3c: 동적 변수 치환 (폰 프레임) */}
                      {(() => {
                        const firstR = showTargetSend ? targetRecipients[0] : directRecipients[0];
                        const fullMsg = getFullMessage(directMessage);
                        if (showTargetSend && targetFieldsMeta.length > 0) {
                          return replaceVarsWithMeta(fullMsg, firstR, targetFieldsMeta, true);
                        }
                        return replaceVarsDirectWrap(fullMsg, firstR, selectedCallback, true);
                      })()}
                    </div>
                  </div>
                </div>
                {/* 하단 바이트 */}
                <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                  {/* ★ D43-3c: 동적 변수 치환 (바이트 계산) */}
                  {(() => {
                    const firstR = showTargetSend ? targetRecipients[0] : directRecipients[0];
                    const fullMsg = getFullMessage(directMessage);
                    const mergedMsg = (showTargetSend && targetFieldsMeta.length > 0)
                      ? replaceVarsWithMeta(fullMsg, firstR, targetFieldsMeta, true)
                      : replaceVarsDirectWrap(fullMsg, firstR, selectedCallback, true);
                    const mergedBytes = calculateBytes(mergedMsg);
                    const limit = directMsgType === 'SMS' ? 90 : 2000;
                    const isOver = mergedBytes > limit;
                    return <span className={`text-[10px] ${isOver ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{mergedBytes} / {limit} bytes · {directMsgType}{isOver ? ' ⚠️ 초과' : ''}</span>;
                  })()}
                </div>
              </div>
            </div>
            {/* 폰 아래 안내 */}
            {mmsUploadedImages.length > 0 && (
              <div className="mt-2 p-2 bg-amber-50 rounded-lg text-xs text-amber-700 text-center w-full">
                ⚠️ 실제 수신 화면은 이통사별로 다를 수 있습니다
              </div>
            )}
            {(directMessage.includes('%')) && (
              <div className="mt-2 p-2 bg-blue-50 rounded-lg text-xs text-blue-700 text-center w-full">
                💡 첫 번째 수신자 정보로 표시됩니다
                {(!directRecipients[0] && !targetRecipients[0]) && ' (샘플)'}
              </div>
            )}
          </div>

          {/* 우측: 수신자별 미리보기 */}
          {(directMessage.includes('%') && (directRecipients.length > 0 || targetRecipients.length > 0)) && (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="text-sm font-medium text-gray-700 mb-2">
                📋 수신자별 미리보기 (최대 10건)
                {useIndividualCallback && individualCallbackColumn && (
                  <span className="ml-2 text-xs text-blue-600 font-normal">
                    · 회신번호: <strong>{individualCallbackColumn}</strong> 컬럼 매핑
                  </span>
                )}
              </div>
              <div className="border rounded-lg overflow-hidden flex-1 overflow-y-auto" style={{ maxHeight: '420px' }}>
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-24">수신번호</th>
                      {useIndividualCallback && individualCallbackColumn && (
                        <th className="px-2 py-1.5 text-left w-28 text-blue-700">회신번호</th>
                      )}
                      <th className="px-2 py-1.5 text-left">치환 메시지</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {/* ★ D43-3c: 동적 변수 치환 (수신자별 테이블) */}
                    {(showTargetSend ? targetRecipients : directRecipients).slice(0, 10).map((r: any, idx: number) => {
                      let msg = directMessage;
                      if (showTargetSend && targetFieldsMeta.length > 0) {
                        msg = replaceVarsWithMeta(msg, r, targetFieldsMeta, false);
                      } else {
                        msg = replaceVarsDirectWrap(msg, r, selectedCallback, false);
                      }
                      const rowCb = resolveCallback(r);
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 font-mono text-gray-600">{r.phone}</td>
                          {useIndividualCallback && individualCallbackColumn && (
                            <td className="px-2 py-1.5 font-mono text-xs">
                              {rowCb
                                ? <span className="text-blue-700 font-medium">{formatPhoneNumber(rowCb)}</span>
                                : <span className="text-red-500 font-medium">⚠ 없음</span>}
                            </td>
                          )}
                          <td className="px-2 py-1.5 text-gray-700 whitespace-pre-wrap leading-snug" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{msg}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex justify-center">
          <button 
            onClick={onClose}
            className="px-12 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
