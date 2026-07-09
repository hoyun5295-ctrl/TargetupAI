import React, { useState, useEffect } from 'react';
import {
  Sparkles, X, ArrowLeft, ArrowRight, Eye, Users, Smartphone,
  Megaphone, MessageSquare, FileText, Image as ImageIcon, AlertTriangle,
  Loader2, Target, Shield, Calendar, Check, CheckCircle2,
  ShieldCheck, Send, Camera, Edit3,
} from 'lucide-react';
import { buildAdMessageFront, buildAdSubjectFront, replaceVarsBySampleCustomer } from '../utils/formatDate';
import { highlightVars } from '../utils/highlightVars';
import MmsImagePreview from './shared/MmsImagePreview';
import TargetRecipientsModal, { arrayPager } from './TargetRecipientsModal';

interface AiCampaignResultPopupProps {
  show: boolean;
  onClose: () => void;
  aiStep: number;
  setAiStep: (step: number) => void;
  aiResult: any;
  setAiResult: (result: any) => void;
  selectedChannel: string;
  setSelectedChannel: (ch: string) => void;
  selectedAiMsgIdx: number;
  setSelectedAiMsgIdx: (idx: number) => void;
  editingAiMsg: number | null;
  setEditingAiMsg: (idx: number | null) => void;
  isAd: boolean;
  setIsAd: (v: boolean) => void;
  user: any;
  aiLoading: boolean;
  handleAiGenerateChannelMessage: () => void;
  testSentResult: string | null;
  testSending: boolean;
  testCooldown: boolean;
  handleTestSend: () => void;
  setShowPreview: (v: boolean) => void;
  setShowAiSendModal: (v: boolean) => void;
  setShowSpamFilter: (v: boolean) => void;
  setSpamFilterData: (data: any) => void;
  setShowMmsUploadModal: (v: boolean) => void;
  mmsUploadedImages: {serverPath: string; url: string; filename: string; originalName?: string; size: number}[];
  setMmsUploadedImages: React.Dispatch<React.SetStateAction<{serverPath: string; url: string; filename: string; originalName?: string; size: number}[]>>;
  wrapAdText: (text: string) => string;
  calculateBytes: (text: string) => number;
  optOutNumber: string;
  selectedCallback: string;
  campaign: any;
  formatRejectNumber: (num: string) => string;
  targetRecipients?: any[];
  sampleCustomer?: Record<string, string>;
}

// 6 sub-agent 흐름 — target/count/channel 즉시 완료, message 진행 중, compliance/schedule 700ms 간격
const SUB_AGENT_STEPS = [
  { id: 'target', label: '타겟 분석', Icon: Target, doneMs: 0 },
  { id: 'count', label: '고객 수 집계', Icon: Users, doneMs: 0 },
  { id: 'channel', label: '채널 선정', Icon: Smartphone, doneMs: 0 },
  { id: 'message', label: '메시지 생성', Icon: Sparkles, doneMs: -1 },
  { id: 'compliance', label: '광고법 검수', Icon: Shield, doneMs: 1400 },
  { id: 'schedule', label: '발송 준비', Icon: Calendar, doneMs: 2800 },
] as const;

const CHANNEL_OPTIONS = [
  { key: 'SMS', label: 'SMS', Icon: MessageSquare },
  { key: 'LMS', label: 'LMS', Icon: FileText },
  { key: 'MMS', label: 'MMS', Icon: ImageIcon },
] as const;

const VARIABLE_ALIAS_MAP = {
  '이름': ['고객명', '성함', '고객이름'],
  '고객등급': ['등급', '멤버십등급', '회원등급'],
  '등록매장정보': ['매장명', '매장', '지점', '등록매장'],
  '최근구매매장': ['구매매장', '최근매장'],
  '보유포인트': ['포인트', '적립금'],
  '최근구매금액': ['구매금액', '구매액'],
  '누적구매금액': ['총구매금액', '총구매액', '누적구매'],
};

export default function AiCampaignResultPopup({
  show, onClose, aiStep, setAiStep, aiResult, setAiResult,
  selectedChannel, setSelectedChannel, selectedAiMsgIdx, setSelectedAiMsgIdx,
  editingAiMsg, setEditingAiMsg, isAd, setIsAd, user, aiLoading,
  handleAiGenerateChannelMessage, testSentResult, testSending, testCooldown,
  handleTestSend, setShowPreview, setShowAiSendModal, setShowSpamFilter,
  setSpamFilterData, setShowMmsUploadModal, mmsUploadedImages, setMmsUploadedImages,
  wrapAdText, calculateBytes, optOutNumber, selectedCallback, campaign,
  formatRejectNumber, targetRecipients, sampleCustomer,
}: AiCampaignResultPopupProps) {
  const [showLmsAlert, setShowLmsAlert] = useState(false);
  const [lmsAlertBytes, setLmsAlertBytes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // 2026-07-09: 추출된 타겟 카드 클릭 → 추출 대상 리스트 (메모리 보유 recipients · 15명/페이징)
  const [showTargetList, setShowTargetList] = useState(false);

  // 6 sub-agent 로딩 시각 효과 — aiLoading state 흐름
  useEffect(() => {
    if (aiLoading) {
      setElapsedMs(0);
      const t = setInterval(() => setElapsedMs(v => v + 100), 100);
      return () => clearInterval(t);
    } else {
      setElapsedMs(0);
    }
  }, [aiLoading]);

  if (!show) return null;

  const targetCount = aiResult?.target?.count || 0;
  const targetDescription = aiResult?.target?.description || '추천 타겟';
  const recommendedChannel = aiResult?.recommendedChannel || 'SMS';
  const channelReason = aiResult?.channelReason || '추천 채널입니다';
  const topInsight = aiResult?.topInsight
    || `${targetDescription} ${targetCount.toLocaleString()}명에게 ${recommendedChannel} 발송이 최적입니다.`;

  // 스팸필터 진입 흐름 (기존 흐름 유지 + 함수 분리)
  const handleSpamFilterClick = () => {
    const msg = aiResult?.messages?.[selectedAiMsgIdx]?.message_text || campaign.messageContent || '';
    const cb = selectedCallback || '';
    const sc = sampleCustomer || {};
    const hasSample = sc && Object.keys(sc).length > 0;
    const replaceVars = (text: string) => hasSample
      ? replaceVarsBySampleCustomer(text, sc, {
          removeUnmatched: true,
          aliasMap: VARIABLE_ALIAS_MAP,
        })
      : text;
    const smsRaw = buildAdMessageFront(msg, 'SMS', isAd, optOutNumber);
    const lmsRaw = buildAdMessageFront(msg, 'LMS', isAd, optOutNumber);
    const smsMsg = replaceVars(smsRaw);
    const lmsMsg = replaceVars(lmsRaw);
    const subj = aiResult?.messages?.[selectedAiMsgIdx]?.subject || '';
    setSpamFilterData({
      sms: smsMsg,
      lms: lmsMsg,
      callback: cb,
      msgType: selectedChannel as 'SMS' | 'LMS' | 'MMS',
      subject: subj,
      isAd,
      firstRecipient: sampleCustomer || undefined,
    });
    setShowSpamFilter(true);
  };

  // 캠페인 확정 진입 흐름 (SMS bytes > 90 시 LMS sub-modal — B-D75-01 흐름 유지)
  const handleConfirmClick = () => {
    const selectedMsg = aiResult?.messages?.[selectedAiMsgIdx];
    if (selectedChannel === 'SMS') {
      const msg = selectedMsg?.message_text || '';
      const bytes = calculateBytes(wrapAdText(msg));
      if (bytes > 90) {
        setLmsAlertBytes(bytes);
        setShowLmsAlert(true);
        return;
      }
    }
    setShowAiSendModal(true);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-full max-w-5xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* sticky 헤더 — gradient + Sparkles + BETA 배지 + 보조 액션 + 닫기 */}
        <div className="sticky top-0 z-30 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-white font-bold text-lg whitespace-nowrap">AI 추천 결과</h3>
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  {aiStep === 1 ? '타겟 & 채널 확인' : '캠페인 메시지 확정'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {aiStep === 2 && (
                <>
                  <button
                    onClick={() => setAiStep(1)}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 hover:bg-white/5 rounded transition-colors flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> 채널 변경
                  </button>
                  <button
                    onClick={() => setShowPreview(true)}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 hover:bg-white/5 rounded transition-colors flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" /> 미리보기
                  </button>
                </>
              )}
              <button
                onClick={() => { onClose(); setAiStep(1); }}
                className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Step 1: AI 자율 진단 + 광고성 + 채널 선택 + 0건 차단 + 다음 버튼 (또는 6 sub-agent 로딩) */}
        {aiStep === 1 && (
          <div className="p-6 space-y-5">

            {/* AI 자율 진단 카드 — 타겟 + AI 추천 채널 통합 */}
            <div className="rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-violet-500/10 border border-violet-400/20 p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-md shadow-violet-500/20">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-violet-300 font-medium mb-1">AI 자율 진단</div>
                  <div className="text-sm text-white/90 leading-relaxed">
                    {topInsight}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => { if (targetRecipients && targetRecipients.length > 0) setShowTargetList(true); }}
                  disabled={!targetRecipients || targetRecipients.length === 0}
                  className="bg-white/5 border border-white/10 rounded-lg p-3 text-left w-full hover:bg-white/10 hover:border-violet-400/30 transition-colors disabled:cursor-default disabled:hover:bg-white/5 disabled:hover:border-white/10"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1">
                    <Users className="w-3 h-3" /> 추출된 타겟
                  </div>
                  <div className="text-sm text-white/80 mb-1 line-clamp-1">{targetDescription}</div>
                  <div className="text-2xl text-violet-300 font-bold">
                    {targetCount.toLocaleString()}<span className="text-sm text-white/50 ml-1">명</span>
                  </div>
                  {targetRecipients && targetRecipients.length > 0 && (
                    <div className="mt-1 text-[10px] font-semibold text-violet-300/80">리스트 보기 →</div>
                  )}
                </button>
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1">
                    <Smartphone className="w-3 h-3" /> AI 추천 채널
                  </div>
                  <div className="text-lg text-fuchsia-300 font-bold mb-1">{recommendedChannel}</div>
                  <div className="text-xs text-white/60 leading-snug line-clamp-2">{channelReason}</div>
                </div>
              </div>

              <div className="text-[10px] text-white/30 italic mt-3">
                Data source — AI 추천 (자율 진단 + customer-filter)
              </div>
            </div>

            {/* 광고성 toggle 라인 — amber 액센트 별도 분리 */}
            <div className="flex items-center justify-between rounded-xl bg-amber-500/5 border border-amber-400/20 p-4 gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Megaphone className="w-4 h-4 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-white/90 font-medium">광고성 메시지</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {isAd ? '(광고) 표기 + 무료거부번호 필수 포함' : '알림성 메시지 (표기 불필요)'}
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isAd}
                  onChange={(e) => setIsAd(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>

            {/* 채널 선택 3 카드 */}
            <div>
              <div className="text-xs text-white/60 mb-2">채널 선택</div>
              <div className="grid grid-cols-3 gap-2">
                {CHANNEL_OPTIONS.map(({ key: ch, label, Icon }) => (
                  <button
                    key={ch}
                    onClick={() => { setSelectedChannel(ch); if (ch !== 'MMS') setMmsUploadedImages([]); }}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg border transition-all ${
                      selectedChannel === ch
                        ? 'border-violet-400/50 bg-violet-500/10 text-violet-200 shadow-lg shadow-violet-500/20'
                        : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 0건 차단 카드 — D77 흐름 유지 (자동 완화 X) */}
            {targetCount === 0 && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-rose-300 font-medium text-sm mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  추출된 고객이 0명입니다
                </div>
                <div className="text-rose-300/70 text-xs">
                  타겟 조건을 정정하거나, 고객 DB에 데이터를 업로드해주세요.
                </div>
              </div>
            )}

            {/* 다음 버튼 또는 6 sub-agent 로딩 시각 효과 */}
            {aiLoading ? (
              <div className="rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-violet-500/10 border border-violet-400/20 p-5">
                <div className="flex items-center gap-2 text-violet-300 font-medium text-sm mb-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI가 메시지를 생성 중입니다
                </div>
                <div className="space-y-2">
                  {SUB_AGENT_STEPS.map(step => {
                    const isImmediateDone = step.doneMs === 0;
                    const isTimedDone = step.doneMs > 0 && elapsedMs >= step.doneMs;
                    const isMessageStep = step.doneMs === -1;
                    const isDone = isImmediateDone || isTimedDone;
                    const isRunning = !isDone && (
                      isMessageStep ||
                      (step.doneMs > 0 && elapsedMs >= (step.doneMs - 700))
                    );
                    const Icon = step.Icon;
                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                          isDone
                            ? 'bg-emerald-500/10 border-emerald-400/20'
                            : isRunning
                              ? 'bg-violet-500/10 border-violet-400/30 shadow-md shadow-violet-500/10'
                              : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isDone
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : isRunning
                                ? 'bg-violet-500/20 text-violet-300'
                                : 'bg-white/5 text-white/30'
                          }`}
                        >
                          {isDone
                            ? <Check className="w-4 h-4" />
                            : isRunning
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Icon className="w-4 h-4" />
                          }
                        </div>
                        <div
                          className={`text-sm ${
                            isDone
                              ? 'text-emerald-200'
                              : isRunning
                                ? 'text-violet-200 font-medium'
                                : 'text-white/40'
                          }`}
                        >
                          {step.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <button
                onClick={handleAiGenerateChannelMessage}
                disabled={targetCount === 0}
                className="w-full py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-xl font-medium hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/30 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
              >
                {targetCount === 0 ? (
                  <>추출된 고객이 0명입니다. 다시 추출해주세요</>
                ) : (
                  <>다음 — AI 메시지 생성 <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            )}
          </div>
        )}

        {/* Step 2: 6 sub-agent 결과 + 폰 UI carousel + MMS + 1-click 3 액션 카드 */}
        {aiStep === 2 && (
          <div className="p-6 space-y-5">

            {/* 6 sub-agent 결과 카드 — 모두 완료 표시 */}
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-400/20 p-4">
              <div className="flex items-center gap-2 text-emerald-300 font-medium text-sm mb-3">
                <Check className="w-4 h-4" />
                AI 진단 종결 — 6 단계 완료
              </div>
              <div className="grid grid-cols-3 max-md:grid-cols-2 gap-2">
                {SUB_AGENT_STEPS.map(step => (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                  >
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    <div className="text-xs text-white/70">{step.label}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-white/30 italic mt-2">
                Data source — AI 6 sub-agent (자율 진단)
              </div>
            </div>

            {/* 선택된 채널 + 광고성 칩 */}
            <div className="flex items-center gap-2 text-xs text-white/60 flex-wrap">
              <span>선택된 채널:</span>
              <span className="px-2 py-0.5 bg-violet-500/20 text-violet-200 border border-violet-400/30 rounded font-medium">
                {selectedChannel}
              </span>
              {isAd && (
                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-200 border border-amber-400/30 rounded font-medium">
                  광고성
                </span>
              )}
            </div>

            {/* 메시지 3안 폰 UI carousel — 외곽 다크 + 메시지 영역 화이트 */}
            <div>
              <div className="text-sm text-white/80 mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-violet-300" />
                {selectedChannel} 메시지 추천 (택1)
              </div>
              <div className="grid grid-cols-3 max-md:grid-cols-1 gap-4">
                {aiResult?.messages?.length > 0 ? (
                  aiResult.messages.map((msg: any, idx: number) => {
                    const isSelected = selectedAiMsgIdx === idx;
                    const isEditing = editingAiMsg === idx;
                    return (
                      <label key={msg.variant_id || idx} className="group cursor-pointer">
                        <input
                          type="radio"
                          name="message"
                          className="hidden"
                          checked={isSelected}
                          onChange={() => { setSelectedAiMsgIdx(idx); setEditingAiMsg(null); }}
                        />
                        {/* 폰 외곽 — 다크 톤 (선택 시 violet→fuchsia 그라데이션 glow) */}
                        <div
                          className={`rounded-[1.8rem] p-[3px] transition-all ${
                            isSelected
                              ? 'bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-500/30'
                              : 'bg-slate-800 hover:bg-slate-700'
                          }`}
                        >
                          <div className="bg-slate-900 rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                            {/* 폰 헤더 — 다크 톤 */}
                            <div className="px-4 py-2.5 bg-gradient-to-r from-slate-950 to-violet-950/30 flex justify-between items-center shrink-0 border-b border-white/5">
                              <span className="text-[11px] text-white/40 font-medium">문자메시지</span>
                              <div className="flex items-center gap-1.5">
                                {isSelected && !isEditing && (
                                  <button
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingAiMsg(idx); }}
                                    className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 border border-violet-400/30 rounded hover:bg-violet-500/30 transition-colors flex items-center gap-1"
                                  >
                                    <Edit3 className="w-2.5 h-2.5" /> 수정
                                  </button>
                                )}
                                <span className="text-[11px] font-bold text-violet-300">
                                  {msg.variant_id}. {msg.variant_name}
                                </span>
                              </div>
                            </div>
                            {/* LMS/MMS 제목 — amber 액센트 (광고 표기 색상 통일) */}
                            {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && msg.subject && !isEditing && (
                              <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-400/20 shrink-0">
                                <span className="text-[11px] font-bold text-amber-300">
                                  {buildAdSubjectFront(msg.subject, selectedChannel, isAd)}
                                </span>
                              </div>
                            )}
                            {/* 메시지 영역 — 다크 폰 모드 (모달 톤 통일) */}
                            <div className="flex-1 overflow-y-auto p-3 bg-slate-900">
                              {isEditing ? (
                                <div className="h-full flex flex-col gap-2">
                                  {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && (
                                    <input
                                      type="text"
                                      value={msg.subject || ''}
                                      onChange={(e) => {
                                        const updated = [...aiResult.messages];
                                        updated[idx] = { ...updated[idx], subject: e.target.value };
                                        setAiResult({ ...aiResult, messages: updated });
                                      }}
                                      placeholder="LMS 제목"
                                      className="w-full text-[12px] px-2 py-1.5 bg-white/5 border border-amber-400/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400/60 text-white placeholder-white/30"
                                    />
                                  )}
                                  <textarea
                                    value={msg.message_text}
                                    onChange={(e) => {
                                      const updated = [...aiResult.messages];
                                      updated[idx] = {
                                        ...updated[idx],
                                        message_text: e.target.value,
                                        byte_count: calculateBytes(e.target.value),
                                      };
                                      setAiResult({ ...aiResult, messages: updated });
                                    }}
                                    className="flex-1 w-full text-[12px] leading-[1.6] p-2 bg-white/5 border border-violet-400/30 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400/60 text-white placeholder-white/30"
                                    autoFocus
                                  />
                                  <button
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingAiMsg(null); }}
                                    className="py-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[11px] font-medium rounded-lg hover:from-violet-500 hover:to-fuchsia-500 transition-colors flex items-center justify-center gap-1"
                                  >
                                    <Check className="w-3 h-3" /> 수정 완료
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                                    <Smartphone className="w-3.5 h-3.5 text-violet-300" />
                                  </div>
                                  <div className="rounded-2xl rounded-tl-sm p-3 shadow-sm text-[12px] leading-[1.6] whitespace-pre-wrap break-all overflow-hidden text-white/90 max-w-[95%] bg-slate-800 border border-white/10">
                                    {/* D93 흐름 유지 — %변수% 하이라이트 (dark theme — amber 다크 톤) */}
                                    {highlightVars(wrapAdText(msg.message_text || ''), 'dark')}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* 하단 바이트 — 다크 톤 + rose 초과 표시 */}
                            <div className="px-3 py-2 border-t border-white/5 bg-slate-950 text-center shrink-0">
                              {(() => {
                                const bytes = calculateBytes(wrapAdText(msg.message_text || ''));
                                const limit = selectedChannel === 'SMS' ? 90 : 2000;
                                const isOver = bytes > limit;
                                return (
                                  <>
                                    <span
                                      className={`text-[10px] ${
                                        isOver
                                          ? 'text-rose-400 font-bold'
                                          : isEditing
                                            ? 'text-violet-300 font-medium'
                                            : 'text-white/40'
                                      }`}
                                    >
                                      {bytes} / {limit} bytes
                                    </span>
                                    {isOver && (
                                      <div className="text-[10px] text-rose-400 mt-1 flex items-center justify-center gap-1">
                                        <AlertTriangle className="w-2.5 h-2.5" />
                                        {selectedChannel === 'SMS'
                                          ? 'SMS 90바이트 초과 — LMS 전환 필요'
                                          : 'LMS 2000바이트 초과'}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <div className="col-span-3 text-center py-8 text-white/40">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    메시지를 불러오는 중...
                  </div>
                )}
              </div>
            </div>

            {/* MMS 이미지 첨부 — MMS 선택 시만 (B4 D141 흐름 유지) */}
            {selectedChannel === 'MMS' && (
              <div>
                <div className="text-sm text-white/80 mb-3 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-violet-300" />
                  이미지 첨부 (MMS)
                </div>
                <div
                  onClick={() => setShowMmsUploadModal(true)}
                  className="border-2 border-dashed border-white/15 rounded-xl p-4 bg-white/5 cursor-pointer hover:border-violet-400/50 hover:bg-violet-500/10 transition-all"
                >
                  {mmsUploadedImages.length > 0 ? (
                    <div className="flex items-center gap-3">
                      <MmsImagePreview images={mmsUploadedImages} size="sm" compact />
                      <div className="text-sm text-violet-300 font-medium flex items-center gap-1">
                        <Edit3 className="w-3.5 h-3.5" />
                        {mmsUploadedImages.length}장 첨부됨 (클릭하여 정정)
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-2">
                      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                        <Camera className="w-5 h-5 text-white/40" />
                      </div>
                      <div className="text-sm text-white/60">클릭하여 이미지를 첨부합니다</div>
                      <div className="text-xs text-white/30">JPG만 · 300KB 이하 · 최대 3장</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* testSentResult 안내 — emerald (성공) / rose (실패) */}
            {testSentResult && (
              <div
                className={`rounded-xl p-3 text-sm whitespace-pre-wrap border ${
                  testSentResult.startsWith('✅')
                    ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-400/30 text-rose-300'
                }`}
              >
                {testSentResult}
              </div>
            )}

            {/* 1-click 3 액션 카드 — amber/cyan/emerald color-coded */}
            <div className="grid grid-cols-3 max-md:grid-cols-1 gap-3 pt-2">
              <button
                onClick={handleSpamFilterClick}
                className="rounded-xl bg-amber-500/10 border border-amber-400/30 hover:bg-amber-500/20 hover:border-amber-400/50 p-4 text-left transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4 text-amber-300" />
                  </div>
                  <div className="text-xs text-amber-200 font-medium">검증</div>
                </div>
                <div className="text-sm text-white font-bold mb-0.5">스팸필터 테스트</div>
                <div className="text-[11px] text-white/50">금지 단어 + 발신번호 검증</div>
              </button>

              <button
                onClick={handleTestSend}
                disabled={testSending || testCooldown}
                className="rounded-xl bg-cyan-500/10 border border-cyan-400/30 hover:bg-cyan-500/20 hover:border-cyan-400/50 p-4 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    {testSending
                      ? <Loader2 className="w-4 h-4 text-cyan-300 animate-spin" />
                      : <Send className="w-4 h-4 text-cyan-300" />}
                  </div>
                  <div className="text-xs text-cyan-200 font-medium">테스트</div>
                </div>
                <div className="text-sm text-white font-bold mb-0.5">
                  {testSending ? '발송 중...' : testCooldown ? '10초 대기' : '담당자 테스트'}
                </div>
                <div className="text-[11px] text-white/50">내 휴대전화로 1건 발송</div>
              </button>

              <button
                onClick={handleConfirmClick}
                className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-400/40 hover:from-emerald-500/30 hover:to-emerald-500/20 hover:border-emerald-400/60 p-4 text-left transition-all shadow-lg shadow-emerald-500/20"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/30 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  </div>
                  <div className="text-xs text-emerald-200 font-medium">메인 액션</div>
                </div>
                <div className="text-sm text-white font-bold mb-0.5">캠페인 확정</div>
                <div className="text-[11px] text-white/50">발송 시간 + 회신번호 설정</div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* LMS 자동 전환 sub-modal — 90byte 초과 시 (B-D75-01 흐름 + 다크 톤 정정) */}
      {showLmsAlert && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="p-5 bg-gradient-to-r from-amber-500/20 to-orange-500/10 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-300" />
                </div>
                <h3 className="text-white font-bold text-base">메시지 길이 초과</h3>
              </div>
            </div>
            <div className="p-5">
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-rose-300">
                  {lmsAlertBytes} <span className="text-base text-white/40">/ 90 byte</span>
                </div>
                <div className="text-white/60 text-sm mt-1">SMS 제한을 초과했습니다</div>
              </div>
              <div className="bg-violet-500/10 border border-violet-400/30 rounded-lg p-3 mb-4">
                <div className="text-sm text-violet-200">
                  <div className="font-medium mb-1">LMS로 전환하시겠습니까?</div>
                  <div className="text-violet-300/80 text-xs">LMS는 최대 2,000byte까지 발송 가능합니다</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLmsAlert(false)}
                  className="flex-1 py-2.5 border border-white/20 rounded-lg text-white/70 font-medium hover:bg-white/5 transition-colors"
                >
                  닫기
                </button>
                <button
                  onClick={() => { setSelectedChannel('LMS'); setShowLmsAlert(false); }}
                  className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-lg font-medium hover:from-violet-500 hover:to-fuchsia-500 shadow-md shadow-violet-500/30 transition-all"
                >
                  LMS 전환
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2026-07-09: 추출된 타겟 리스트 (메모리 보유 recipients · 15명/페이징) */}
      <TargetRecipientsModal
        show={showTargetList}
        onClose={() => setShowTargetList(false)}
        title="추출된 타겟"
        criteria={targetDescription}
        channelLabel={selectedChannel}
        fetchPage={arrayPager(targetRecipients || [])}
        sourceLabel="AI 캠페인 추출 대상 (customer-filter)"
      />
    </div>
  );
}
