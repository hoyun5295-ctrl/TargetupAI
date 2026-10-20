/**
 * JourneyMessageEditModal.tsx — 저장 여정 문안(본문·제목) 수정 모달
 *
 * 역할: 초안·일시정지 여정의 message step 본문·제목만 안전하게 수정.
 *   - 발송 일정·단계 구조 변경은 새 여정(삭제 후 재생성) — 진행 중 execution 무결성 보존.
 *   - 활성 여정은 수정 차단(목록에서 일시정지 후 진입) — updateJourneyStep active 차단과 동일.
 *   - 일시정지 여정 = 재개 시 최신 snapshot(수정 본문)으로 발송(journey-executor ORDER BY created_at DESC).
 *   - 저장 = PATCH /operator/journeys/:id/steps/:stepId (messageTemplate, subject) 재사용 — backend 신규 0.
 *
 * 레이아웃: 전체화면 + step을 가로 컬럼(좌→우)으로 펼쳐 한눈에 편집, 컬럼이 많으면 우측 스크롤.
 *   - 편집 ↔ 미리보기 토글: 미리보기는 mergeAndHighlightVars로 샘플 고객 변수 치환 모습을 보여준다.
 *   - 빈 변수 경고: default 필터 없는 {{ }} 변수는 값 누락 시 줄이 비므로 컬럼마다 경고를 띄운다.
 *
 * 영구 룰 준수: 다크 톤 + violet 액센트 + Source caption / useToast(native dialog 0) / 수정 1클릭 진입.
 * ★ 2026-10-20 여정 V.3 §9-4 — 칸마다 큰 휴대폰(PhoneComposer) 한 벌. (광고) · 무료수신거부를 합성한 바이트로 세고(옛: 글자 수만 세서 단문 90바이트를
 *   넘겨도 몰랐다) · [받는 모습]은 칸마다 서버 미리보기. 알림톡 칸은 템플릿 문안이라 글 칸 그대로.
 */

import { useEffect, useState } from 'react';
import { X, PenLine, Loader2, Save, Info, MessageSquare, AlertTriangle } from 'lucide-react';
import { useToast } from '../ToastProvider';
import { findUndefaultedLiquidVars } from '../../utils/highlightVars';
import { LMS_SUBJECT_MAX_CHARS } from '../../utils/formatDate';
import PhoneComposer from './PhoneComposer';

interface MessageStep {
  id: string;
  stepOrder: number;
  channel: string;
  messageTemplate: string;
  subject: string;
  isAd: boolean;
}

interface Props {
  journeyId: string;
  journeyName: string;
  journeyStatus: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS', lms: 'LMS', mms: 'MMS', kakao: '알림톡', email: '이메일',
};

export default function JourneyMessageEditModal({
  journeyId, journeyName, journeyStatus, token, onClose, onSaved,
}: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [steps, setSteps] = useState<MessageStep[]>([]);
  const [initial, setInitial] = useState<Record<string, { messageTemplate: string; subject: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [opt080, setOpt080] = useState('');

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, saving]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || '여정 조회에 실패했습니다.');
        setLoading(false);
        return;
      }
      const msgSteps: MessageStep[] = (data.steps || [])
        .filter((s: any) => (s.step_type || 'message') === 'message')
        .map((s: any) => ({
          id: s.id,
          stepOrder: s.step_order,
          channel: s.channel || 'sms',
          messageTemplate: s.message_template || '',
          subject: s.subject || '',
          isAd: s.is_ad !== false,
        }));
      setSteps(msgSteps);
      // 080 수신거부 번호 — 휴대폰 무료수신거부 줄 · 바이트 합성(회사 값 · 실패하면 번호 없이 「무료수신거부」만)
      fetch('/api/ai/operator/journeys-callback-numbers', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json()).then((cd) => { if (cd?.success) setOpt080(cd.opt080Number || ''); }).catch(() => undefined);
      const init: Record<string, { messageTemplate: string; subject: string }> = {};
      msgSteps.forEach((s) => { init[s.id] = { messageTemplate: s.messageTemplate, subject: s.subject }; });
      setInitial(init);
    } catch (e: any) {
      setError(e?.message || '여정 조회 중 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  const patchStep = (id: string, patch: Partial<MessageStep>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const changed = steps.filter(
    (s) => initial[s.id] && (initial[s.id].messageTemplate !== s.messageTemplate || initial[s.id].subject !== s.subject)
  );

  const handleSave = async () => {
    for (const s of changed) {
      if (!s.messageTemplate.trim() || s.messageTemplate.trim().length < 10) {
        toast.error(`${s.stepOrder}번째 칸 문안이 비어 있거나 너무 짧아요.`);
        return;
      }
      if ((s.channel === 'lms' || s.channel === 'mms') && s.subject.length > LMS_SUBJECT_MAX_CHARS) {
        toast.error(`${s.stepOrder}번째 칸 제목이 ${LMS_SUBJECT_MAX_CHARS}자를 넘어요.`);
        return;
      }
      if ((s.channel === 'lms' || s.channel === 'mms') && !s.subject.trim()) {
        toast.error(`${s.stepOrder}번째 칸 제목을 써 주세요.`);
        return;
      }
    }
    setSaving(true);
    try {
      for (const s of changed) {
        const res = await fetch(`/api/ai/operator/journeys/${journeyId}/steps/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // ★ 2026-07-11 활성 중 문안 수정 — 명시 opt-in(문안 키만). 백엔드가 새 snapshot + 발송 전 스팸 재검사 강제.
          body: JSON.stringify({ messageTemplate: s.messageTemplate, subject: s.subject, allowActiveMessageEdit: journeyStatus === 'active' }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          toast.error(data?.error || `${s.stepOrder}번째 칸을 저장하지 못했어요.`);
          setSaving(false);
          return;
        }
      }
      toast.success(
        journeyStatus === 'paused'
          ? '문안을 저장했습니다. 재개하면 새 문안으로 발송됩니다.'
          : '문안을 저장했습니다.'
      );
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '저장 중 오류가 발생했습니다.');
      setSaving(false);
    }
  };


  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-3"
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-[96vw] h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 via-fuchsia-50 to-purple-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              <PenLine className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">문안 수정</h3>
              <p className="text-[12px] text-slate-500 mt-0.5 truncate">{journeyName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!saving && (
              <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" aria-label="닫기">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            )}
          </div>
        </div>

        {/* 안내 바 */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-cyan-50 flex items-start gap-2 shrink-0">
          <Info className="w-4 h-4 text-cyan-700 shrink-0 mt-0.5" />
          <div className="text-[12px] text-cyan-900 leading-relaxed">
            여기서는 문안(본문 · 제목)을 고쳐요. 간격 · 칸 모양은 여정 작업 화면에서 고쳐요.
            {journeyStatus === 'paused' && ' 일시정지 여정은 재개하면 새 문안으로 발송됩니다.'}
            {journeyStatus === 'draft' && ' 초안 여정은 활성화 시 이 문안으로 발송됩니다.'}
            {journeyStatus === 'active' && ' 운영 중 여정입니다. 저장 즉시 새 문안이 적용되고, 다음 발송 전 자동 스팸 검사를 다시 거칩니다. 단 2시간 이내로 예정된 발송에는 재검사 전에 적용될 수 있으니 저장 전 문안을 한 번 더 확인해주세요.'}
          </div>
        </div>

        {/* 본문 — 가로 스텝 컬럼 */}
        <div className="flex-1 min-h-0 p-4">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-[13px] text-rose-900 max-w-md">{error}</div>
            </div>
          ) : steps.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">수정할 문안 단계가 없습니다.</div>
          ) : (
            <div className="h-full flex gap-5 overflow-x-auto pb-2">
              {steps.map((s) => {
                const phone = s.channel === 'sms' || s.channel === 'lms' || s.channel === 'mms';
                const undefaulted = findUndefaultedLiquidVars(s.messageTemplate);
                return (
                  <div key={s.id} className="flex w-[min(396px,calc(100vw-56px))] shrink-0 flex-col gap-2 overflow-y-auto">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[12px] font-semibold text-violet-800">{s.stepOrder}번째 칸</span>
                      <span className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600"><MessageSquare className="h-3 w-3" />{CHANNEL_LABEL[s.channel] || '문자'}</span>
                    </div>
                    {undefaulted.length > 0 && (
                      <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                        <div className="text-[12px] leading-relaxed text-amber-900">
                          값이 없으면 그 줄이 비어요.{' '}
                          <code className="break-all rounded bg-amber-100 px-1 text-amber-900">{undefaulted.join(', ')}</code>
                          {' '}에{' '}
                          <code className="rounded bg-amber-100 px-1 text-amber-900">| default: &apos;...&apos;</code>
                          {' '}를 붙여 주세요.
                        </div>
                      </div>
                    )}
                    {phone ? (
                      <PhoneComposer
                        channel={s.channel as 'sms' | 'lms' | 'mms'}
                        subject={s.subject}
                        body={s.messageTemplate}
                        isAd={s.isAd}
                        opt080Number={opt080}
                        onSubject={saving ? undefined : (v) => patchStep(s.id, { subject: v })}
                        onBody={saving ? undefined : (v) => patchStep(s.id, { messageTemplate: v })}
                        journeyId={journeyId}
                        resetKey={s.id}
                      />
                    ) : (
                      <textarea
                        value={s.messageTemplate}
                        onChange={(e) => patchStep(s.id, { messageTemplate: e.target.value })}
                        disabled={saving}
                        maxLength={2000}
                        aria-label={`${s.stepOrder}번째 칸 문안`}
                        className="min-h-[320px] w-full resize-none rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-[14px] leading-relaxed text-slate-900 focus:border-violet-300 focus:outline-none disabled:opacity-50"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2 p-4 border-t border-slate-200 bg-slate-100 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || changed.length === 0}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {changed.length > 0 ? `${changed.length}개 단계 저장` : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
