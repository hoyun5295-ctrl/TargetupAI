import type { FieldMeta } from './DirectTargetFilterModal';

// ★ 정규식 특수문자 이스케이프
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
}

// ★ D43-3c: 동적 변수 치환 함수
const replaceVarsWithMeta = (text: string, recipient: any, fieldsMeta: FieldMeta[], fallback: boolean = false) => {
  if (!text || !recipient) return text;
  let result = text;
  fieldsMeta.forEach(fm => {
    if (fm.field_key === 'phone' || fm.field_key === 'sms_opt_in') return;
    const pattern = new RegExp(escapeRegExp(fm.variable), 'g');
    const val = recipient[fm.field_key];
    const display = val != null && val !== '' ? String(val) : (fallback ? fm.display_name : '');
    result = result.replace(pattern, display);
  });
  return result;
};

// 직접발송용 하드코딩 치환 (직접발송은 기존 유지)
const replaceVarsDirect = (text: string, recipient: any, selectedCallback: string, fallback: boolean = false) => {
  if (!text || !recipient) return text;
  return text
    .replace(/%이름%/g, recipient.name || (fallback ? '홍길동' : ''))
    .replace(/%기타1%/g, recipient.extra1 || (fallback ? '기타1' : ''))
    .replace(/%기타2%/g, recipient.extra2 || (fallback ? '기타2' : ''))
    .replace(/%기타3%/g, recipient.extra3 || (fallback ? '기타3' : ''))
    .replace(/%회신번호%/g, recipient.callback || selectedCallback || '');
};

export default function DirectPreviewModal({
  show, onClose,
  directMessage, directMsgType, directSubject,
  directRecipients, targetRecipients, showTargetSend,
  selectedCallback, mmsUploadedImages,
  formatPhoneNumber, calculateBytes, getFullMessage,
  targetFieldsMeta,
}: DirectPreviewModalProps) {
  if (!show) return null;

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
                {/* 상단 - 회신번호 */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                  <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                  <span className="text-[11px] font-bold text-emerald-600">{formatPhoneNumber(selectedCallback) || '회신번호'}</span>
                </div>
                {/* LMS/MMS 제목 */}
                {(directMsgType === 'LMS' || directMsgType === 'MMS') && directSubject && (
                  <div className="px-4 py-2 bg-orange-50 border-b border-orange-200">
                    <span className="text-sm font-bold text-orange-700">{directSubject}</span>
                  </div>
                )}
                {/* 메시지 영역 */}
                <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                  {mmsUploadedImages.length > 0 && mmsUploadedImages.map((img, idx) => (
                    <img key={idx} src={img.url} alt="" className="w-full h-auto rounded mb-1.5" />
                  ))}
                  <div className="flex gap-2 mt-1">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[13px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                      {/* ★ D43-3c: 동적 변수 치환 (폰 프레임) */}
                      {(() => {
                        const firstR = showTargetSend ? targetRecipients[0] : directRecipients[0];
                        const fullMsg = getFullMessage(directMessage);
                        if (showTargetSend && targetFieldsMeta.length > 0) {
                          return replaceVarsWithMeta(fullMsg, firstR, targetFieldsMeta, true);
                        }
                        return replaceVarsDirect(fullMsg, firstR, selectedCallback, true);
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
                      : replaceVarsDirect(fullMsg, firstR, selectedCallback, true);
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
              <div className="text-sm font-medium text-gray-700 mb-2">📋 수신자별 미리보기 (최대 10건)</div>
              <div className="border rounded-lg overflow-hidden flex-1 overflow-y-auto" style={{ maxHeight: '420px' }}>
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-24">수신번호</th>
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
                        msg = replaceVarsDirect(msg, r, selectedCallback, false);
                      }
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 font-mono text-gray-600">{r.phone}</td>
                          <td className="px-2 py-1.5 text-gray-700 whitespace-pre-wrap leading-snug">{msg}</td>
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
