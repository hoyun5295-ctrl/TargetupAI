import { X, FileText } from 'lucide-react';
import { calculateSmsBytes, formatCampaignMessageForDisplay, buildAdSubjectFront, getAlimtalkTemplateStatus } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';

/**
 * 발송결과 — 캠페인 상세 모달 (ResultsModal에서 분리, 흰 톤 모던 재설계).
 *   - 상태 라벨/badge 클래스는 부모(ResultsModal)의 단일 로직 결과를 props로 받아 렌더 (중복 정의 X).
 *   - 알림톡 캠페인은 템플릿명/코드 + 검수상태 badge 카드 노출 (getAlimtalkTemplateStatus 활용).
 */
interface CampaignDetailModalProps {
  campaign: any;                                                   // selectedCampaign
  detail: any;                                                     // campaignDetail (charts)
  alimtalkTemplateInfo: { code: string; name: string; status: string } | null;
  firstMessageContent?: string;                                    // messages[0]?.msg_contents (실발송 텍스트 우선)
  statusLabel: string;                                             // 부모 getStatusLabel(campaign)
  statusBadgeClass: string;                                        // 부모 getStatusColor(campaign)
  onClose: () => void;
  onShowMessages: () => void;                                      // 발송 내역 보기 → 부모 팝업 오픈
  onImageClick: (url: string, filename: string) => void;          // MMS 이미지 확대
}

const MSG_TYPE_LABEL: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡' };

export default function CampaignDetailModal({
  campaign,
  detail,
  alimtalkTemplateInfo,
  firstMessageContent,
  statusLabel,
  statusBadgeClass,
  onClose,
  onShowMessages,
  onImageClick,
}: CampaignDetailModalProps) {
  const isAlimtalk = campaign.send_channel === 'alimtalk';
  const isKakao = campaign.send_channel === 'kakao';
  const channelLabel = isAlimtalk ? '알림톡' : isKakao ? '카카오' : (MSG_TYPE_LABEL[campaign.message_type] || campaign.message_type || 'SMS');
  const channelChipClass = isAlimtalk
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    : isKakao
      ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
      : 'bg-violet-50 text-violet-700 border border-violet-200';

  // 차트 집계 (campaignDetail.charts.successFail). detail 로딩 전이면 0 처리.
  const sf = detail?.charts?.successFail;
  const sent = sf ? (sf.sent || (sf.success + sf.fail) || 0) : 0;
  const success = sf?.success || 0;
  const fail = sf?.fail || 0;
  const pending = Math.max(0, sent - success - fail);
  const denom = sent || (success + fail) || 1;
  const successRate = sf ? Math.round((success / denom) * 100) : 0;
  const clicks = sf?.clicks || 0;
  const clickRate = (clicks && success) ? Math.round((clicks / success) * 100) : 0;

  const carriers = detail?.charts?.carriers && typeof detail.charts.carriers === 'object' ? detail.charts.carriers : {};
  const errors = detail?.charts?.errors && typeof detail.charts.errors === 'object' ? detail.charts.errors : {};
  const carrierEntries = Object.entries(carriers) as [string, number][];
  const errorEntries = Object.entries(errors) as [string, number][];
  const carrierMax = carrierEntries.reduce((m, [, v]) => Math.max(m, Number(v) || 0), 0) || 1;
  const errorMax = errorEntries.reduce((m, [, v]) => Math.max(m, Number(v) || 0), 0) || 1;

  const isLmsType = campaign.message_type === 'LMS' || campaign.message_type === 'MMS' || campaign.message_type === 'L' || campaign.message_type === 'M';
  const subject = campaign.subject || campaign.message_subject;
  const previewBody = formatCampaignMessageForDisplay(campaign, firstMessageContent);
  const mmsImages = Array.isArray(campaign.mms_image_paths) ? campaign.mms_image_paths : [];

  const previewChannelName = isAlimtalk ? '알림톡' : isKakao ? '카카오톡' : '문자메시지';
  const previewTypeLabel = isAlimtalk ? '알림톡' : isKakao ? '카카오' : (MSG_TYPE_LABEL[campaign.message_type] || campaign.message_type);
  const previewMaxBytes = (campaign.message_type === 'SMS' || campaign.message_type === 'S') ? 90 : 2000;

  const fmtFull = (dt: string) => new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtShort = (dt: string) => new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const infoRows: { label: string; value: string }[] = [
    { label: '캠페인명', value: campaign.campaign_name },
    ...(isLmsType && subject ? [{ label: '제목', value: buildAdSubjectFront(subject || '', campaign.message_type, campaign.is_ad ?? false) }] : []),
    { label: '유형', value: `${campaign.send_type === 'direct' ? '수동' : 'AI'} / ${channelLabel}` },
    { label: '발송자', value: campaign.created_by_name || '-' },
    { label: '회신번호', value: campaign.callback_number || '-' },
    { label: '전송건수', value: `${(campaign.sent_count || campaign.target_count || 0).toLocaleString()}건` },
    { label: '성공 / 실패', value: `${(campaign.success_count || 0).toLocaleString()} / ${(campaign.fail_count || 0).toLocaleString()}` },
    { label: '등록일시', value: campaign.created_at ? fmtFull(campaign.created_at) : '-' },
    // ★ 2026-06-13: 예약 우선 — 예약 캠페인은 sent_at이 등록 시점에 찍혀(0609 교훈) 발송일시가
    //   등록일시와 같게 보이던 표시 문제(에이치피오 직원 신고). 실제 발송 시각 = scheduled_at 우선.
    { label: '발송일시', value: campaign.scheduled_at
        ? `${fmtFull(campaign.scheduled_at)}${campaign.status === 'cancelled' ? ' (예약취소)' : campaign.status === 'scheduled' ? ' (예약)' : ''}`
        : campaign.sent_at ? fmtFull(campaign.sent_at) : '-' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-2 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[880px] max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 — 캠페인명 + 채널 chip + 상태 badge + 발송일시 */}
        <div className="flex justify-between items-start gap-3 px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-10">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 truncate">{campaign.campaign_name}</h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${channelChipClass}`}>{channelLabel}</span>
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${statusBadgeClass}`}>{statusLabel}</span>
              <span className="text-xs text-slate-400">
                {campaign.scheduled_at
                  ? `${fmtShort(campaign.scheduled_at)}${campaign.status === 'scheduled' ? ' 예약' : campaign.status === 'cancelled' ? ' 예약취소' : ''}`
                  : campaign.sent_at ? fmtShort(campaign.sent_at) : ''}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 상단 요약 4 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="text-xs text-slate-500 mb-1">성공률</div>
              <div className={`text-2xl font-bold ${successRate >= 50 ? 'text-emerald-600' : 'text-rose-500'}`}>{successRate}%</div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${successRate >= 50 ? 'bg-emerald-500' : 'bg-rose-400'}`} style={{ width: `${Math.min(100, successRate)}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="text-xs text-slate-500 mb-1">클릭률</div>
              <div className="text-2xl font-bold text-violet-600">{clickRate}%</div>
              <div className="text-[11px] text-slate-400 mt-1">{clicks.toLocaleString()} 클릭</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="text-xs text-slate-500 mb-1">전송 / 성공</div>
              <div className="text-2xl font-bold text-slate-900">{sent.toLocaleString()}</div>
              <div className="text-[11px] text-emerald-600 mt-1">성공 {success.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <div className="text-xs text-slate-500 mb-1">실패 / 대기</div>
              <div className="text-2xl font-bold text-rose-600">{fail.toLocaleString()}</div>
              <div className="text-[11px] text-amber-500 mt-1">대기 {pending.toLocaleString()}</div>
            </div>
          </div>

          {/* 알림톡 검수상태 카드 */}
          {isAlimtalk && alimtalkTemplateInfo && (() => {
            const st = getAlimtalkTemplateStatus(alimtalkTemplateInfo.status);
            return (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm shrink-0"><FileText className="w-5 h-5 text-white" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-emerald-700/70">알림톡 템플릿</div>
                    <div className="font-bold text-slate-900 truncate">{alimtalkTemplateInfo.name || '(템플릿명 미설정)'}</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium shrink-0 ${st.badgeClass}`}>{st.label}</span>
                </div>
                <div className="text-xs text-slate-500 mt-2">템플릿코드 <span className="font-mono text-slate-700">{alimtalkTemplateInfo.code || '-'}</span></div>
              </div>
            );
          })()}

          {/* 폰 미리보기 + 캠페인 정보 + 분포 */}
          <div className="flex flex-col md:flex-row gap-5">
            {/* 폰 미리보기 */}
            <div className="md:flex-shrink-0 mx-auto md:mx-0">
              <div className="text-xs text-slate-500 mb-2 font-medium">메시지 미리보기</div>
              <div className="w-[240px] rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200/50">
                <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '400px' }}>
                  <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-slate-100 flex justify-between items-center shrink-0 border-b border-slate-200">
                    <span className="text-[11px] text-slate-400 font-medium">{previewChannelName}</span>
                    <span className="text-[11px] font-bold text-emerald-600">{previewTypeLabel}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-emerald-600">T</div>
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-slate-100 text-[11.5px] leading-[1.7] whitespace-pre-wrap break-all text-slate-700 max-w-[95%]">
                        {isAlimtalk && alimtalkTemplateInfo ? (
                          <>
                            <div className="font-bold text-emerald-700 mb-1 pb-1 border-b border-emerald-100">{alimtalkTemplateInfo.name || '(템플릿명 미설정)'}</div>
                            <div className="text-[10px] text-slate-400 mb-2">템플릿코드: {alimtalkTemplateInfo.code || '-'}</div>
                            <div>{previewBody}</div>
                          </>
                        ) : (
                          <>
                            {isLmsType && subject && (
                              <div className="font-bold text-slate-900 mb-1 pb-1 border-b border-slate-200">{buildAdSubjectFront(subject || '', campaign.message_type, campaign.is_ad ?? false)}</div>
                            )}
                            {previewBody}
                          </>
                        )}
                        {mmsImages.length > 0 && (
                          <MmsImagePreview images={mmsImages} size="sm" onImageClick={onImageClick} />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-center shrink-0">
                    <span className="text-[10px] text-slate-400">{calculateSmsBytes(previewBody)} / {previewMaxBytes} bytes</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 캠페인 정보 + 분포 */}
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <div className="text-xs text-slate-500 mb-2 font-medium">캠페인 정보</div>
                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {infoRows.map(row => (
                    <div key={row.label} className="flex px-4 py-2.5 text-sm">
                      <span className="w-24 flex-shrink-0 text-slate-500">{row.label}</span>
                      <span className="text-slate-800 font-medium break-all">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 통신사별 분포 (모던 바) */}
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500 mb-2 font-medium">통신사별 분포</div>
                {carrierEntries.length > 0 ? (
                  <div className="space-y-2">
                    {carrierEntries.map(([carrier, count]) => (
                      <div key={carrier}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="font-medium text-slate-600">{carrier}</span>
                          <span className="font-bold text-slate-700">{Number(count).toLocaleString()}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-500" style={{ width: `${Math.round((Number(count) / carrierMax) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 text-center py-2">성공 건 없음</div>
                )}
                <div className="text-[10px] text-slate-400 italic mt-2">Data source — 통신사 발송 결과(MySQL)</div>
              </div>

              {/* 실패사유 분포 (모던 바) */}
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500 mb-2 font-medium">실패사유 분포</div>
                {errorEntries.length > 0 ? (
                  <div className="space-y-2">
                    {errorEntries.map(([reason, count]) => (
                      <div key={reason}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="font-medium text-rose-600 break-all">{reason}</span>
                          <span className="font-bold text-slate-700">{Number(count).toLocaleString()}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-500" style={{ width: `${Math.round((Number(count) / errorMax) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 text-center py-2">실패 건 없음</div>
                )}
                <div className="text-[10px] text-slate-400 italic mt-2">Data source — 통신사 실패 코드(MySQL)</div>
              </div>

              <button
                onClick={onShowMessages}
                className="w-full py-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 text-sm font-semibold transition-colors"
              >
                발송 내역 보기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
