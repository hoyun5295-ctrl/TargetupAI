/**
 * TemplateDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch } from 'react';
import { getAlimtalkTemplateStatus } from '../../../utils/formatDate';

export interface TemplateDetailModalProps {
  setTemplateDetail: Dispatch<any>;
  templateDetail: any;
}

export default function TemplateDetailModal(props: TemplateDetailModalProps) {
  const { setTemplateDetail, templateDetail } = props;
  if (!(templateDetail)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-base font-bold">템플릿 상세</h3>
                <p className="text-xs text-gray-500">{templateDetail.company_name || '-'} · {getAlimtalkTemplateStatus(templateDetail.status).label}</p>
              </div>
              <button onClick={() => setTemplateDetail(null)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 overflow-auto space-y-4 text-sm" style={{ userSelect: 'text' }}>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-400 mb-0.5">템플릿명</div><div className="text-gray-800">{templateDetail.template_name || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">템플릿코드</div><div className="text-gray-800 font-mono">{templateDetail.template_code || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">카테고리</div><div className="text-gray-800">{templateDetail.category || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">유형</div><div className="text-gray-800">{templateDetail.message_type || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">발신프로필</div><div className="text-gray-800">{templateDetail.profile_name || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">요청일</div><div className="text-gray-800">{(templateDetail.requested_at || templateDetail.created_at) ? new Date(templateDetail.requested_at || templateDetail.created_at).toLocaleString('ko-KR') : '-'}</div></div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">템플릿 내용</div>
                <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.content || '-'}</div>
              </div>
              {/* ★ 2026-06-22: 강조 표기 + 버튼 + 부가정보 — 검수/문의 응대 시 등록 내용 확인 (처리메모 요청) */}
              {templateDetail.emphasize_type && templateDetail.emphasize_type !== 'NONE' && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">강조 표기 ({templateDetail.emphasize_type})</div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.emphasize_title || '-'}</div>
                </div>
              )}
              {(() => {
                const raw = (templateDetail as any).buttons;
                let btns: any[] = [];
                if (Array.isArray(raw)) btns = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { const p = JSON.parse(raw); if (Array.isArray(p)) btns = p; } catch { /* 파싱 실패 무시 */ } }
                if (btns.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">버튼 ({btns.length})</div>
                    <div className="space-y-1">
                      {btns.map((b: any, i: number) => {
                        const nm = b?.name || b?.buttonName || b?.title || `버튼 ${i + 1}`;
                        const tp = b?.linkType || b?.type || b?.linkTypeCode || '';
                        const url = b?.linkMo || b?.urlMobile || b?.url || b?.linkPc || b?.urlPc || '';
                        return (
                          <div key={i} className="bg-gray-50 border rounded px-3 py-1.5 text-xs text-gray-800">
                            <span className="font-medium">{nm}</span>
                            {tp ? <span className="text-gray-400"> · {tp}</span> : null}
                            {url ? <span className="text-gray-400 break-all"> · {url}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {/* ★ 2026-07-28 서수란 접수 — 업체가 등록 시 입력한 부가기능이 상세에 하나도 안 나와
                  발송 실패 원인(대표링크 누락 등)을 슈퍼관리자에서 확인할 수 없었다(무주덕유산리조트).
                  값은 이미 kakao_templates에 저장돼 있고 목록 API가 kt.*로 실어 보낸다 — 렌더만 없었다.
                  대표링크만 채우면 같은 접수가 반복되므로 등록 폼이 받는 항목을 한 번에 노출한다.
                  값이 없는 항목은 그리지 않는다(기존 강조표기·버튼 블록과 동일한 규칙). */}
              {(() => {
                const raw = (templateDetail as any).represent_link;
                let rl: any = null;
                if (raw && typeof raw === 'object') rl = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { rl = JSON.parse(raw); } catch { /* 파싱 실패 무시 */ } }
                const mo = rl?.urlMobile || rl?.linkMo || '';
                const pc = rl?.urlPc || rl?.linkPc || '';
                const ios = rl?.schemeIos || '';
                const and = rl?.schemeAndroid || '';
                if (!mo && !pc && !ios && !and) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">대표링크 (말풍선 전역 클릭)</div>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1 text-xs text-gray-800">
                      {mo && <div><span className="text-gray-400">Mobile</span> <span className="break-all">{mo}</span></div>}
                      {pc && <div><span className="text-gray-400">PC</span> <span className="break-all">{pc}</span></div>}
                      {ios && <div><span className="text-gray-400">iOS scheme</span> <span className="break-all">{ios}</span></div>}
                      {and && <div><span className="text-gray-400">Android scheme</span> <span className="break-all">{and}</span></div>}
                    </div>
                  </div>
                );
              })()}
              {templateDetail.preview_message && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">미리보기 메시지 (앱 알림 문구)</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.preview_message}</div>
                </div>
              )}
              {templateDetail.template_header && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">헤더</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.template_header}</div>
                </div>
              )}
              {templateDetail.ad_content && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">광고 문구</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.ad_content}</div>
                </div>
              )}
              {(() => {
                const raw = (templateDetail as any).quick_replies;
                let qrs: any[] = [];
                if (Array.isArray(raw)) qrs = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { const p = JSON.parse(raw); if (Array.isArray(p)) qrs = p; } catch { /* 파싱 실패 무시 */ } }
                if (qrs.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">바로연결 ({qrs.length})</div>
                    <div className="space-y-1">
                      {qrs.map((q: any, i: number) => (
                        <div key={i} className="bg-gray-50 border rounded px-3 py-1.5 text-xs text-gray-800">
                          <span className="font-medium">{q?.name || q?.title || `바로연결 ${i + 1}`}</span>
                          {(q?.linkMo || q?.urlMobile) ? <span className="text-gray-400 break-all"> · {q.linkMo || q.urlMobile}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {templateDetail.security_flag && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  보안 템플릿: 메인 디바이스(모바일) 외 서브 디바이스에는 메시지 내용이 노출되지 않습니다.
                </div>
              )}
              {templateDetail.extra_content && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">부가 정보</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.extra_content}</div>
                </div>
              )}
              {templateDetail.reject_reason && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">반려 사유</div>
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 whitespace-pre-wrap break-words text-red-700">{templateDetail.reject_reason}</div>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end flex-shrink-0">
              <button onClick={() => setTemplateDetail(null)} className="whitespace-nowrap px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-[13px] font-medium">닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
