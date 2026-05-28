/**
 * BrandVoiceNudgeCard.tsx — D225+ Brand Voice 미등록 회사 알림 카드 (2026-05-28 Harold 명시)
 *
 * 본질: 회사 brand_guideline 미등록 시 = Dashboard 안 강력 push 카드 표시.
 *   "5건 등록 시 = AI 문안 = 회사 아이덴티티 100% 일치 / 미등록 시 = 일반 한국어 톤"
 *
 * 24h cooldown: "오늘 하루 보지 않기" 버튼 = localStorage 활용.
 *
 * 영구 룰 정합:
 *   - 다크 톤 + violet 액센트
 *   - 마케팅 담당자 UX — 1 클릭 = AI 메모리 페이지 진입
 *   - native dialog 0건
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Clock, X } from 'lucide-react';

const DISMISS_KEY = 'brand_voice_nudge_dismissed_until';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function dismissForToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS));
  } catch {
    // skip
  }
}

export default function BrandVoiceNudgeCard() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isDismissed()) {
      setLoading(false);
      return;
    }
    checkBrandVoiceStatus();
  }, []);

  async function checkBrandVoiceStatus() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await fetch('/api/ai-memory/brand-voice', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.success && (!data.registered || !data.guideline_extracted)) {
        setShow(true);
      }
    } catch {
      // skip — 조용히 무시
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    dismissForToday();
    setShow(false);
  }

  if (loading || !show) return null;

  return (
    <div className="mb-6 rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-950/60 via-fuchsia-950/40 to-slate-900/80 backdrop-blur-md shadow-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-bold text-white">회사 Brand Voice 학습 미완료</h3>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-semibold">NEW</span>
            </div>

            <p className="text-sm text-violet-100 leading-relaxed mb-3">
              AI 다듬기 + AI 자동 생성 = 현재 <strong className="text-amber-200">일반 한국어 톤</strong> 출력 중 (회사 아이덴티티 X).
              <br />
              <span className="text-violet-200/80">대표 LMS/MMS 문안 1~5건 등록 시 = 다음 발송부터 <strong className="text-emerald-200">회사 톤 100% 일치</strong> 자동 적용.</span>
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate('/ai-memory')}
                className="px-4 py-2 text-xs bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg flex items-center gap-2 font-semibold shadow-lg transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                지금 등록하기
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleDismiss}
                className="px-3 py-2 text-xs text-violet-200/70 hover:text-white rounded-lg border border-violet-500/30 hover:bg-violet-500/10 flex items-center gap-1.5 transition-colors"
              >
                <Clock className="w-3 h-3" />
                오늘 하루 보지 않기
              </button>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
