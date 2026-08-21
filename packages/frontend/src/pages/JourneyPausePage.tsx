/**
 * JourneyPausePage.tsx — D218+ (2026-05-26) 신설 (Public, 인증 X)
 *
 * 본질: 발송 2시간 전 담당자 LMS 안 단축 URL 진입 페이지.
 *   - 경로: /journey-pause/:token
 *   - 인증 X (token 자체가 HMAC-SHA256 서명 영역 — 24h TTL)
 *   - GET /journey-pause/:token → 본문 미리보기 + 여정명 + step + 발송 예정시각
 *   - "이 발송 정지" 확인 1 클릭 → POST /journey-pause/:token body { paused_phone }
 *   - 정지 종결 후 Toast 안내 + journey_step_pause_logs 영구 기록 (CT-94 영역)
 *
 * 영구 룰 정합:
 *   - feedback_design_quality_minimum_journey_level (다크 톤 + violet 액센트 + Source caption + 모바일 반응형)
 *   - feedback_no_native_browser_dialog (useToast + 커스텀 확인 영역)
 *   - feedback_marketing_user_ux_priority (1-click 정지)
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircle2, AlertTriangle, Loader2, MessageSquare, Calendar,
  PauseCircle, ShieldCheck, Phone, ArrowLeft,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';

interface PauseInfo {
  journey_name: string;
  step_order: number;
  channel: string;
  scheduled_send_at: string | null;
  message_body: string;
  message_subject: string | null;
  confidence_score: number | null;
}

type Phase = 'loading' | 'ready' | 'confirming' | 'pausing' | 'paused' | 'invalid' | 'error';

export default function JourneyPausePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<PauseInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pausedPhone, setPausedPhone] = useState('');

  useEffect(() => {
    if (!token) {
      setPhase('invalid');
      return;
    }
    loadInfo();
  }, [token]);

  const loadInfo = async () => {
    try {
      const res = await fetch(`/journey-pause/${token}`);
      if (res.status === 404) {
        setPhase('invalid');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || '조회 사고');
        setPhase('error');
        return;
      }
      setInfo(data);
      setPhase('ready');
    } catch (e: any) {
      setErrorMsg(e?.message || '호출 사고');
      setPhase('error');
    }
  };

  const confirmPause = async () => {
    if (!token) return;
    setPhase('pausing');
    try {
      const res = await fetch(`/journey-pause/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused_phone: pausedPhone.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('발송 정지가 처리되었습니다');
        setPhase('paused');
      } else {
        toast.error(data?.error || '정지 호출 사고');
        setPhase('confirming');
      }
    } catch (e: any) {
      toast.error(e?.message || '정지 호출 사고');
      setPhase('confirming');
    }
  };

  const dateStr = info?.scheduled_send_at
    ? new Date(info.scheduled_send_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '— 시각 미정 —';

  return (
    <div className="min-h-screen bg-violet-950 text-white px-4 py-8 md:py-16">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <PauseCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
              발송 정지 페이지
            </h1>
            <p className="text-[11px] md:text-[12px] text-white/50 mt-0.5">
              여정 자동 발송 2시간 전 안내 — 담당자 1-click 정지 영역
            </p>
          </div>
        </div>

        {/* loading */}
        {phase === 'loading' && (
          <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl p-8 text-center">
            <Loader2 className="w-8 h-8 text-violet-300 animate-spin mx-auto mb-3" />
            <div className="text-[13px] text-white/60">발송 정보 조회 중</div>
          </div>
        )}

        {/* invalid token */}
        {phase === 'invalid' && (
          <div className="bg-violet-900/40 border border-rose-400/30 rounded-2xl shadow-2xl p-8">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-300 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-rose-100 mb-2">유효하지 않은 정지 링크</h2>
                <div className="text-[13px] text-rose-100/80 leading-relaxed">
                  본 정지 링크는 24시간 동안만 유효합니다. 만료되었거나 위조된 token입니다.
                  최신 알림 LMS에서 정지 링크를 확인해주세요.
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/')}
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              메인 페이지로
            </button>
          </div>
        )}

        {/* error */}
        {phase === 'error' && (
          <div className="bg-violet-900/40 border border-amber-400/30 rounded-2xl shadow-2xl p-8">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-300 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-amber-100 mb-2">정지 정보 조회 사고</h2>
                <div className="text-[13px] text-amber-100/80 leading-relaxed">
                  {errorMsg || '알 수 없는 사고가 발생했습니다.'}
                </div>
              </div>
            </div>
            <button
              onClick={loadInfo}
              className="mt-5 px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded-lg text-sm font-semibold transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* ready — 발송 정보 + 정지 선택 */}
        {(phase === 'ready' || phase === 'confirming') && info && (
          <div className="space-y-4">
            {/* 발송 정보 카드 */}
            <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-5 border-b border-white/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-purple-500/10">
                <div className="text-[11px] text-white/50 mb-1">여정명</div>
                <div className="text-lg font-semibold text-white">{info.journey_name}</div>
                <div className="flex flex-wrap items-center gap-2 mt-3 text-[12px] text-white/70">
                  <span className="px-2 py-0.5 rounded-md bg-white/10 font-mono">
                    step {info.step_order}
                  </span>
                  {info.channel && (
                    <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-200 font-mono uppercase">
                      {info.channel}
                    </span>
                  )}
                  {info.confidence_score != null && info.confidence_score > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-200 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      신뢰도 {info.confidence_score}/100
                    </span>
                  )}
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-violet-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] text-white/50 mb-0.5">발송 예정 시각</div>
                    <div className="text-[14px] font-mono text-white">{dateStr}</div>
                  </div>
                </div>

                {info.message_subject && (
                  <div>
                    <div className="text-[11px] text-white/50 mb-1">제목 (LMS/MMS)</div>
                    <div className="text-[13px] text-white/90 p-2 bg-white/5 rounded-lg">
                      {info.message_subject}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1">
                    <MessageSquare className="w-3 h-3" />
                    본문 미리보기 (활성화 시점 snapshot)
                  </div>
                  <div className="text-[13px] text-white/90 p-3 bg-black/30 rounded-lg border border-white/5 whitespace-pre-wrap leading-relaxed">
                    {info.message_body}
                  </div>
                </div>
              </div>
            </div>

            {/* 정지 확인 카드 */}
            {phase === 'ready' && (
              <div className="bg-violet-900/40 border border-amber-400/30 rounded-2xl shadow-2xl p-5">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[14px] font-semibold text-amber-100">이 발송을 정지하시겠습니까?</div>
                    <div className="text-[12px] text-amber-100/80 mt-1 leading-relaxed">
                      정지 시 본 step의 미발송 execution이 일제히 paused 상태로 전환되며,
                      journey_step_pause_logs 테이블에 담당자 phone + 본문 snapshot + 시각이 영구 기록됩니다.
                      여정 자체는 재활성화 의무 영역.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setPhase('confirming')}
                  className="w-full px-4 py-3 bg-amber-500/20 hover:bg-amber-500/40 text-amber-100 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <PauseCircle className="w-4 h-4" />
                  이 발송 정지 진행
                </button>
              </div>
            )}

            {phase === 'confirming' && (
              <div className="bg-violet-900/40 border border-rose-400/40 rounded-2xl shadow-2xl p-5">
                <div className="text-[14px] font-semibold text-rose-100 mb-3">최종 확인 — 정지 후 복구 의무</div>
                <div className="mb-4">
                  <label className="block text-[12px] text-white/60 mb-1.5 flex items-center gap-1.5">
                    <Phone className="w-3 h-3" />
                    담당자 phone (선택 — 기록 보존)
                  </label>
                  <input
                    type="tel"
                    value={pausedPhone}
                    onChange={(e) => setPausedPhone(e.target.value)}
                    placeholder="010-1234-5678"
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-rose-400/50"
                  />
                  <div className="text-[10px] text-white/40 mt-1">
                    journey_step_pause_logs.paused_phone 영구 기록 영역
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPhase('ready')}
                    className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={confirmPause}
                    className="flex-1 px-4 py-2.5 bg-rose-500/30 hover:bg-rose-500/50 text-rose-100 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <PauseCircle className="w-4 h-4" />
                    정지 확정
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* pausing */}
        {phase === 'pausing' && (
          <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl p-8 text-center">
            <Loader2 className="w-8 h-8 text-rose-300 animate-spin mx-auto mb-3" />
            <div className="text-[13px] text-white/70">발송 정지 진행 중 — DB 트랜잭션 + journey_step_pause_logs 영구 기록</div>
          </div>
        )}

        {/* paused */}
        {phase === 'paused' && (
          <div className="bg-violet-900/40 border border-emerald-400/40 rounded-2xl shadow-2xl p-8">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-emerald-100 mb-2">발송 정지 종결</h2>
                <div className="text-[13px] text-emerald-100/80 leading-relaxed space-y-2">
                  <div>본 step의 미발송 execution이 paused 상태로 전환됐습니다.</div>
                  <div>여정 admin 페이지의 "정지 이력" 영역에서 영구 기록을 확인할 수 있습니다.</div>
                  <div>여정 재활성화는 admin 권한 영역.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Source caption */}
        <div className="text-[10px] text-white/30 italic mt-6 text-center">
          Data source — CT-94 journey-pause-handler (D218+ 신설) · token TTL 24h · HMAC-SHA256 서명 정합
        </div>
      </div>
    </div>
  );
}
