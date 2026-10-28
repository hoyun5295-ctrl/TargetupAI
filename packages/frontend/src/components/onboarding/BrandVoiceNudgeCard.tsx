/**
 * BrandVoiceNudgeCard.tsx — D225+ Brand Voice 미등록 회사 알림 카드 (2026-05-28 Harold 명시)
 *
 * 본질: 회사 목소리를 아직 배우지 않은 회사 = 대시보드 알림 카드.
 * ★ 2026-10-28 AI 메모리 설계 K13-3 — 판정 = 서버 voice_learned(확인된 학습) · 문구 = 최근 90일 보낸 문자 수 · 과장 문구(100% 일치 · 1~5건) 삭제 ·
 *   버튼 = /ai-memory?learn=voice(브랜드 학습 창 · 브랜드 보이스 탭 · 보낸 문자 고르기 바로 열기).
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

// ★2026-08-16 suppress — 마케팅 진단 카드 노출 중에는 미렌더(설계서 §5-2. 미등록 소견은 진단 리포트가 흡수).
export default function BrandVoiceNudgeCard({ suppress = false }: { suppress?: boolean }) {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sentCount, setSentCount] = useState(0);
  // ★ 2026-10-29 서버 상태값 그대로(배운 뒤 확인만 남은 회사에 「아직 배우지 않았어요」라고 말하던 결함 · Harold 1029)
  const [status, setStatus] = useState<string>('none');

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
      if (data.success && data.voice_learned !== true) {
        setShow(true);
        setStatus(String(data.status || 'none'));
        // 최근 90일 사람이 보낸 문자 수(보낼 수 있는 사람만 · 못 읽으면 0 = 일반 문구)
        if (data.permissions?.canEdit) {
          const c = await fetch('/api/ai-memory/brand-voice/sent-candidates', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
          const since = Date.now() - 90 * 86400000;
          setSentCount(Array.isArray(c?.candidates) ? c.candidates.filter((x: any) => x?.sentAt && Date.parse(x.sentAt) >= since).length : 0);
        }
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

  if (suppress || loading || !show) return null;
  const copy: { title: string; body?: string; button?: string } =
    status === 'review_pending' ? { title: '배운 내용 확인이 남았어요', body: '확인하면 그때부터 AI 문안이 우리 회사 목소리로 나와요.', button: '배운 내용 확인하기' }
    : status === 'incomplete' ? { title: '목소리 배우기가 끝나지 않았어요', body: '다시 배우기를 누르면 이어서 배워요.', button: '다시 배우기' }
    : { title: '우리 회사 목소리를 아직 배우지 않았어요' };

  return (
    <div className="mb-6 rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-950/60 via-fuchsia-950/40 to-slate-900/80 backdrop-blur-md shadow-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-bold text-white">{copy.title}</h3>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-semibold">NEW</span>
            </div>

            <p className="text-sm text-violet-100 leading-relaxed mb-3">
              {copy.body ?? (sentCount > 0
                ? <>최근 90일 보낸 문자가 <strong className="text-amber-200">{sentCount}건</strong> 있어요. 이 문자로 말투 · 줄띄움 · 기호를 배우면 AI 문안이 그 꼴로 나와요.</>
                : <>평소 보내던 문자를 올리면 말투 · 줄띄움 · 기호를 배워 AI 문안이 그 꼴로 나와요.</>)}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate('/ai-memory?learn=voice')}
                className="px-4 py-2 text-xs bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg flex items-center gap-2 font-semibold shadow-lg transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {copy.button ?? (sentCount > 0 ? '이 문자로 목소리 배우기' : '목소리 배우기')}
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
