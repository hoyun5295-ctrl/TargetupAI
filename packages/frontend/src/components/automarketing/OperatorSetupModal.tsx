// 세부설정으로 시작 — 풀 컨트롤 모달 (2026-06-27)
// 기본 4개(이름·목표·채널·주기+시각)는 펼쳐 두고, 고급 4개는 요약만 보이는 접힘 카드.
// 다크 톤 모달: bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl. 콘텐츠 티어 z-50(인터럽트 z-[2000] 아래).
import { ReactNode, useState } from 'react';
import {
  Brain, X, Gift, Layers, Bell, Wallet, ChevronDown, ChevronUp, Loader2, AlertCircle,
} from 'lucide-react';
import { ContinuousOperator, Schedule, OperatorStatus, won } from './types';
import CopyStylePicker from './CopyStylePicker';

const INP = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 transition-colors';
const LAB = 'text-xs font-medium text-white/70 block mb-1.5';
const POLICY_LABEL: Record<string, string> = { daily: '매일', weekly: '매주', monthly: '매달' };

interface Props {
  editing: Partial<ContinuousOperator>;
  setEditing: (e: Partial<ContinuousOperator>) => void;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

export default function OperatorSetupModal({ editing, setEditing, saving, error, onClose, onSubmit }: Props) {
  const isEdit = !!editing.id;
  const phones = editing.adminPhoneNumbers || [];
  const canSubmit = !!editing.name?.trim() && !!editing.objective?.trim() && !saving;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-white/10 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-white">{isEdit ? '자동 마케팅 수정' : '세부설정으로 시작'}</h3>
            <p className="text-[11px] text-white/50 mt-0.5">기본만 정하면 됩니다. 고급 설정은 필요할 때만 펼치세요.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="text-xs text-white/40">기본</div>

          <div>
            <label className={LAB}>이름 <span className="text-rose-400">*</span></label>
            <input type="text" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={INP} placeholder="예: VIP 재구매 유도" maxLength={100} />
          </div>

          <div>
            <label className={LAB}>마케팅 목표 (자연어) <span className="text-rose-400">*</span></label>
            <textarea value={editing.objective || ''} onChange={(e) => setEditing({ ...editing, objective: e.target.value })} className={`${INP} h-20 resize-none leading-relaxed`} placeholder="예: VIP 등급 고객 중 최근 30일 미구매 고객에게 재구매를 유도" maxLength={500} />
          </div>

          <div>
            <label className={LAB}>발송 채널</label>
            <div className="flex gap-2">
              {(['sms', 'lms', 'mms'] as const).map((ch) => {
                const on = (editing.channel || 'lms') === ch;
                return (
                  <button key={ch} type="button" onClick={() => setEditing({ ...editing, channel: ch })} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${on ? 'bg-indigo-500/30 border-indigo-400/50 text-indigo-100' : 'bg-white/5 border-white/10 text-white/60 hover:text-white/90'}`}>
                    {ch.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={LAB}>문안 느낌 (선택)</label>
            <CopyStylePicker value={editing.copyStyle ?? null} onChange={(next) => setEditing({ ...editing, copyStyle: next })} disabled={saving} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LAB}>추천 주기</label>
              <select value={editing.schedule || 'daily'} onChange={(e) => setEditing({ ...editing, schedule: e.target.value as Schedule })} className={INP}>
                <option value="daily">매일</option>
                <option value="weekly">매주</option>
                <option value="monthly">매월</option>
              </select>
            </div>
            <div>
              <label className={LAB}>발송 희망 시각 (KST)</label>
              <input type="time" value={editing.scheduleTime || '09:00'} onChange={(e) => setEditing({ ...editing, scheduleTime: e.target.value })} className={INP} />
            </div>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
            <span className="min-w-0">
              <span className="text-xs text-white/80 block">발송 시각을 AI에게 맡기기</span>
              <span className="text-[10px] text-white/40 block mt-0.5">
                {editing.sendTimeMode === 'ai_optimal'
                  ? '고객 반응(클릭)이 가장 많았던 시간대에 맞춰 발송합니다. 데이터가 부족하면 희망 시각대로 나갑니다.'
                  : '끄면 위에서 정한 희망 시각 정각에 발송됩니다.'}
              </span>
            </span>
            <button type="button" onClick={() => setEditing({ ...editing, sendTimeMode: editing.sendTimeMode === 'ai_optimal' ? 'fixed' : 'ai_optimal' })} className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-3 ${editing.sendTimeMode === 'ai_optimal' ? 'bg-indigo-500' : 'bg-white/15'}`} aria-label="발송 시각 AI 조정">
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${editing.sendTimeMode === 'ai_optimal' ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          {editing.schedule === 'weekly' && (
            <div>
              <label className={LAB}>발송 요일</label>
              <select value={editing.scheduleDayOfWeek ?? 1} onChange={(e) => setEditing({ ...editing, scheduleDayOfWeek: Number(e.target.value) })} className={INP}>
                {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <option key={i} value={i}>{d}요일</option>)}
              </select>
            </div>
          )}
          {editing.schedule === 'monthly' && (
            <div>
              <label className={LAB}>발송 날짜 (매월)</label>
              <select value={editing.scheduleDayOfMonth ?? 1} onChange={(e) => setEditing({ ...editing, scheduleDayOfMonth: Number(e.target.value) })} className={INP}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}일</option>)}
              </select>
              <div className="text-[10px] text-white/40 mt-1">없는 날짜(예: 31일)는 그 달 말일에 발송됩니다.</div>
            </div>
          )}
          {isEdit && (
            <div>
              <label className={LAB}>상태</label>
              <select value={editing.status || 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value as OperatorStatus })} className={INP}>
                <option value="active">활성 (새 캠페인 추천)</option>
                <option value="paused">일시 중지 (추천 멈춤)</option>
              </select>
            </div>
          )}

          <div className="h-px bg-white/10 my-1" />
          <div className="text-xs text-white/40">고급 설정 · 필요할 때만 펼치기</div>

          <Section icon={<Gift className="w-4 h-4" />} title="혜택 내용" summary={editing.benefitContent?.trim() ? '입력됨' : '비우면 제안 단계에서 작성'}>
            <input type="text" value={editing.benefitContent || ''} onChange={(e) => setEditing({ ...editing, benefitContent: e.target.value })} className={INP} placeholder="예: 마스크팩 30% 할인 쿠폰 (유효기간 발급일+3일)" maxLength={200} />
            <div className="text-[10px] text-white/40">입력하면 생성 문안의 [혜택 내용을 입력해주세요] 자리에 그대로 들어갑니다. 비워두면 제안 단계에서 작성합니다. AI가 혜택을 임의로 만들지 않습니다.</div>
          </Section>

          <Section icon={<Layers className="w-4 h-4" />} title="다단계 시퀀스" summary={editing.sequenceEnabled ? `${editing.sequenceDelayDays ?? 3}일 후 미반응자 리마인드` : '미반응자 리마인드 · 꺼짐'}>
            <label className="flex items-center justify-between">
              <span className="text-xs text-white/80">1차 발송 후 미반응자 리마인드</span>
              <button type="button" onClick={() => setEditing({ ...editing, sequenceEnabled: !editing.sequenceEnabled })} className={`relative w-10 h-5 rounded-full transition-colors ${editing.sequenceEnabled ? 'bg-indigo-500' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${editing.sequenceEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </label>
            {editing.sequenceEnabled && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/70">리마인드 대기</span>
                  <input type="number" min={1} max={30} value={editing.sequenceDelayDays ?? 3} onChange={(e) => setEditing({ ...editing, sequenceDelayDays: e.target.value === '' ? null : Number(e.target.value) })} className={`${INP} w-16 text-center`} />
                  <span className="text-xs text-white/70">일 후</span>
                </div>
                <textarea value={editing.sequenceReminderContent || ''} onChange={(e) => setEditing({ ...editing, sequenceReminderContent: e.target.value })} className={`${INP} h-20 resize-none`} placeholder="리마인드 문안을 직접 작성해주세요 (예: 아직 확인 못 하셨나요? 준비한 혜택이 곧 마감됩니다)" maxLength={2000} />
                <div className="text-[10px] text-white/40">리마인드 문안은 담당자가 직접 작성합니다. 발송 전 담당자에게 예약 알림이 전송됩니다.</div>
              </div>
            )}
          </Section>

          <Section icon={<Bell className="w-4 h-4" />} title="발송 정책·담당자 알림" summary={`${POLICY_LABEL[editing.deliveryPolicy || 'daily']} · 담당자 ${phones.length}명`}>
            <div>
              <label className="text-[11px] text-white/60 block mb-1">발송 주기</label>
              <select value={editing.deliveryPolicy || 'daily'} onChange={(e) => setEditing({ ...editing, deliveryPolicy: e.target.value as 'daily' | 'weekly' | 'monthly' })} className={INP}>
                <option value="daily">매일 — 매일 새 제안</option>
                <option value="weekly">매주 — 주 1회 새 제안</option>
                <option value="monthly">매달 — 월 1회 새 제안</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-white/60 block mb-1">담당자 연락처 (쉼표, 최대 3명)</label>
                <input type="text" value={phones.join(', ')} onChange={(e) => setEditing({ ...editing, adminPhoneNumbers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3) })} className={INP} placeholder="01012345678, 01098765432" />
              </div>
              <div>
                <label className="text-[11px] text-white/60 block mb-1">백업 담당자 (휴가 대비)</label>
                <input type="text" value={editing.backupAdminPhone ?? ''} onChange={(e) => setEditing({ ...editing, backupAdminPhone: e.target.value.trim() || null })} className={INP} placeholder="01087654321" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-white/60 block mb-1">담당자 알림 채널</label>
                <div className={`${INP} flex items-center text-white/70`}>문자 (LMS)</div>
                <div className="text-[10px] text-white/40 mt-1">담당자 안내는 문자로 발송됩니다.</div>
              </div>
              <div>
                <label className="text-[11px] text-white/60 block mb-1">자율 발송 준비 시간 (분)</label>
                <input type="number" min="10" max="1440" value={editing.autoSendLeadMinutes ?? 120} onChange={(e) => setEditing({ ...editing, autoSendLeadMinutes: Number(e.target.value) })} className={INP} />
              </div>
            </div>
            <div className="text-[10px] text-white/40 leading-relaxed">발송 희망 시각의 준비 시간(기본 120분) 전에 문안을 생성해 스팸필터 테스트를 거치고, 담당자에게 실제 문안과 발송 정보(일시·대상·예상 비용)를 문자로 안내합니다. 희망 시각 정각에 자동 발송되며, 그 전까지 [정지]로 취소할 수 있습니다. 스팸필터를 통과한 문안만 나갑니다.</div>
          </Section>

          <Section icon={<Wallet className="w-4 h-4" />} title="비용 제어" summary={editing.budgetMonthly ? `월 ${won(editing.budgetMonthly)}` : '예산 무제한'} accent>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-white/60 block mb-1">월 예산 (원)</label>
                <input type="number" min="0" step="10000" value={editing.budgetMonthly ?? ''} onChange={(e) => setEditing({ ...editing, budgetMonthly: e.target.value === '' ? null : Number(e.target.value) })} className={INP} placeholder="예: 2000000" />
              </div>
              <div>
                <label className="text-[11px] text-white/60 block mb-1">일별 한도 (원)</label>
                <input type="number" min="0" step="5000" value={editing.budgetDaily ?? ''} onChange={(e) => setEditing({ ...editing, budgetDaily: e.target.value === '' ? null : Number(e.target.value) })} className={INP} placeholder="비움 = 무제한" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-white/60 block mb-1">알림 임계값 (%)</label>
              <input type="number" min="50" max="100" step="5" value={editing.budgetAlertThreshold ?? 80} onChange={(e) => setEditing({ ...editing, budgetAlertThreshold: Number(e.target.value) })} className={INP} />
              <div className="text-[10px] text-white/40 mt-1">사용률이 임계값에 도달하면 담당자에게 알림 (기본 80%). 예산 초과 시 새 제안 생성이 자동 차단됩니다.</div>
            </div>
          </Section>

          {error && (
            <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors">취소</button>
          <button onClick={onSubmit} disabled={!canSubmit} className="flex-1 px-4 py-2 bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-50 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />저장 중</> : isEdit ? '수정 저장' : '자동마케팅 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, summary, accent, children }: { icon: ReactNode; title: string; summary: string; accent?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border overflow-hidden ${accent ? 'border-indigo-400/30' : 'border-white/10'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className={accent ? 'text-indigo-300' : 'text-white/50'}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-white">{title}</div>
          {!open && <div className="text-xs text-white/45 mt-0.5 truncate">{summary}</div>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
      </button>
      {open && <div className="px-4 pb-4 pt-3 space-y-3 border-t border-white/10">{children}</div>}
    </div>
  );
}
