/**
 * JourneyMessageEditModal.tsx — 저장 여정 문안(본문·제목) 수정 모달
 *
 * 역할: 초안·일시정지 여정의 message step 본문·제목만 안전하게 수정.
 *   - 발송 일정·단계 구조 변경은 새 여정(삭제 후 재생성) — 진행 중 execution 무결성 보존.
 *   - 활성 여정은 수정 차단(목록에서 일시정지 후 진입) — updateJourneyStep active 차단과 동일.
 *   - 일시정지 여정 = 재개 시 최신 snapshot(수정 본문)으로 발송(journey-executor ORDER BY created_at DESC).
 *   - 저장 = PATCH /operator/journeys/:id/steps/:stepId (messageTemplate, subject) 재사용 — backend 신규 0.
 *
 * 영구 룰 준수: 다크 톤 + violet 액센트 + Source caption / useToast(native dialog 0) / 수정 1클릭 진입.
 */

import { useEffect, useState } from 'react';
import { X, PenLine, Loader2, Save, Info, MessageSquare } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface MessageStep {
  id: string;
  stepOrder: number;
  channel: string;
  messageTemplate: string;
  subject: string;
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
        }));
      setSteps(msgSteps);
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
        toast.error(`Step ${s.stepOrder} 본문이 비어있거나 너무 짧습니다.`);
        return;
      }
      if ((s.channel === 'lms' || s.channel === 'mms') && !s.subject.trim()) {
        toast.error(`Step ${s.stepOrder} ${CHANNEL_LABEL[s.channel]} 제목을 입력해주세요.`);
        return;
      }
    }
    setSaving(true);
    try {
      for (const s of changed) {
        const res = await fetch(`/api/ai/operator/journeys/${journeyId}/steps/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messageTemplate: s.messageTemplate, subject: s.subject }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          toast.error(data?.error || `Step ${s.stepOrder} 저장에 실패했습니다.`);
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
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-purple-500/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              <PenLine className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">문안 수정</h3>
              <p className="text-[11px] text-white/50 mt-0.5 truncate">{journeyName}</p>
            </div>
          </div>
          {!saving && (
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors shrink-0" aria-label="닫기">
              <X className="w-4 h-4 text-white/50" />
            </button>
          )}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 안내 */}
          <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-400/20">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
              <div className="text-[12px] text-cyan-100/90 leading-relaxed">
                문안(본문·제목)만 고칠 수 있습니다. 발송 일정·단계 구조를 바꾸려면 새 여정을 만들어 주세요(진행 중 발송 보호).
                {journeyStatus === 'paused' && ' 일시정지 여정은 재개하면 새 문안으로 발송됩니다.'}
                {journeyStatus === 'draft' && ' 초안 여정은 활성화 시 이 문안으로 발송됩니다.'}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-white/50 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-400/30 text-[13px] text-rose-100">{error}</div>
          ) : steps.length === 0 ? (
            <div className="py-10 text-center text-white/50 text-sm">수정할 문안 단계가 없습니다.</div>
          ) : (
            steps.map((s) => {
              const needSubject = s.channel === 'lms' || s.channel === 'mms';
              return (
                <div key={s.id} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-200 font-semibold">
                      Step {s.stepOrder}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-white/70 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />{CHANNEL_LABEL[s.channel] || s.channel.toUpperCase()}
                    </span>
                  </div>

                  {needSubject && (
                    <div>
                      <label className="block text-[11px] text-white/50 mb-1">제목</label>
                      <input
                        type="text"
                        value={s.subject}
                        onChange={(e) => patchStep(s.id, { subject: e.target.value })}
                        disabled={saving}
                        maxLength={50}
                        placeholder={`${CHANNEL_LABEL[s.channel]} 제목`}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950/60 border border-white/10 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">본문</label>
                    <textarea
                      value={s.messageTemplate}
                      onChange={(e) => patchStep(s.id, { messageTemplate: e.target.value })}
                      disabled={saving}
                      rows={4}
                      maxLength={2000}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950/60 border border-white/10 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:outline-none resize-y disabled:opacity-50"
                    />
                    <div className="text-[10px] text-white/40 mt-1 text-right">{s.messageTemplate.length} / 2000</div>
                  </div>
                </div>
              );
            })
          )}

          <div className="text-[10px] text-white/30 italic">
            Data source — journey_steps (문안 수정은 PATCH steps · 발송은 활성화 시점 snapshot 기준)
          </div>
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || changed.length === 0}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-violet-500/30 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {changed.length > 0 ? `${changed.length}개 단계 저장` : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
