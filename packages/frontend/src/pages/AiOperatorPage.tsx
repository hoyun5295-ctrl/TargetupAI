/**
 * AiOperatorPage.tsx — AI 오퍼레이터(`/ai-operator` · 기능 12개 첫 화면 · ★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §4-2)
 *
 * 한 줄 입력 · 추천 띠 · 제안 결과는 AI 한줄로(`/ai-line` · AiLinePage)로 원형 이동했다. 이 화면은 기능을 찾는 곳이다.
 * 기능 카드 절 · 요금제 판정 · `?intro=`(PlanGate 가 돌려보낸 기능 안내) · 첫 진입 안내는 옛 코드 그대로다.
 * 옛 넘기기(`ai_operator_prefill_objective`)가 남아 있으면 AI 한줄로로 보낸다(그 화면이 받아 입력창에 채운다).
 * ⛔ 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import AiOperatorWalkthroughModal from '../components/AiOperatorWalkthroughModal';
import { useAuthStore } from '../stores/authStore';
import { SUB_MODULE_CARDS, HUB_CARD_ROWS, isCardOpen } from '../constants/ai-operator-modules';
import { SurfaceToneProvider } from '../components/zone/surface-tone';
import PlanFeatureModal from '../components/PlanFeatureModal';
import { usePlanFeatureIntros, loadPlanFeatureIntros, PLAN_FEATURE_MIN_PLAN } from '../constants/plan-feature-intros';
import { fetchAiOperatorAccess, fetchAiOperatorFeatures } from '../utils/ai-operator-access';
import AiHubBand from '../components/ai-line/AiHubBand';

export default function AiOperatorPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // ★ 2026-10-18 옛 넘기기 키가 남아 있으면(옛 링크 · 다른 탭) 한 줄 화면으로 — 그 화면이 키를 읽어 입력창에 채운다
  useEffect(() => {
    if (sessionStorage.getItem('ai_operator_prefill_objective')) navigate('/ai-line', { replace: true });
  }, [navigate]);
  // ★ 2026-09-15 AI Operator = 요금제와 상관없이 누구나 들어온다(Harold 지시). 기능을 쓸 수 있는지는 서버가 정한다
  //   (`/api/ai/operator/access` = isAiOperatorAllowed · 유료 요금제·AI 오퍼레이션 체험·슈퍼관리자).
  //   못 쓰는 회사가 카드나 [생성]을 누르면 이동·호출 대신 공통 안내 창을 연다. 판정 전·조회 실패는 잠그지 않는다(서버가 다시 막는다).
  const [planLocked, setPlanLocked] = useState(false);
  const [planFeatureId, setPlanFeatureId] = useState<string | null>(null);
  // ★ 2026-09-20 기능별 개방 플래그 — 카드 필터 축(설계서 §3-11). 모르면 빈 객체 = 그 카드는 안 보인다.
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  // ★ 2026-10-07 기능 안내 원장 = 서버(로그인한 사람에게만) · 화면에 들어오면 미리 받아 둔다
  const featureIntros = usePlanFeatureIntros();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    let alive = true;
    void fetchAiOperatorFeatures().then((f) => { if (alive) setFeatureFlags(f); });
    fetchAiOperatorAccess().then((allowed) => {
      if (!alive) return;
      const locked = allowed === false;
      setPlanLocked(locked);
      // 기능 화면 주소로 직접 들어왔다가 입구(PlanGate)에서 돌아온 경우 = 그 기능의 안내를 바로 연다
      const intro = searchParams.get('intro');
      if (intro) {
        if (locked) void loadPlanFeatureIntros().then((d) => { if (alive && d?.find(intro)) setPlanFeatureId(intro); });
        const next = new URLSearchParams(searchParams);
        next.delete('intro');
        setSearchParams(next, { replace: true });
      }
    });
    return () => { alive = false; };
    // 진입 1회만 판정한다(쿼리 정리로 searchParams가 바뀌어도 다시 묻지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SurfaceToneProvider tone="light">
    <div className="relative min-h-screen bg-slate-100 text-slate-900" data-zone-frame="hub">
      {/* ★ 2026-09-15 요금제 공통 안내 창 — 못 쓰는 회사가 카드를 눌렀을 때 */}
      <PlanFeatureModal featureId={planFeatureId} onClose={() => setPlanFeatureId(null)} />
      <AiHubBand
        active="hub"
        overlap={false}
        heading={(
          <>
            <h1 className="text-[24px] md:text-[30px] font-bold leading-[1.25] tracking-[-0.025em]">AI 오퍼레이터</h1>
            <p className="mt-2 text-[14px] text-slate-300">마케팅의 모든 일을 AI 와 함께 · 자동화 · 발송 채널 · 제작 도구 · 고객 이해와 분석</p>
          </>
        )}
      />
      <main className="relative max-w-[1240px] mx-auto px-4 md:px-6 pb-16">
          <section className="pt-8" data-zone="hub-cards">
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">이 안에서 바로 쓰는 기능</h2>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-5">{planLocked ? '누르면 어떤 기능인지 바로 볼 수 있어요' : '누르면 바로 이동합니다 · 한 줄 발송은 위 AI 한줄로 탭'}</p>
            <div className="space-y-7">
              {HUB_CARD_ROWS.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[13px] font-bold text-slate-900 relative pb-1 after:absolute after:left-0 after:bottom-0 after:w-6 after:h-[2px] after:bg-indigo-500">{row.label}</span>
                    <span className="flex-1 h-px bg-slate-200" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {SUB_MODULE_CARDS
                      .filter((card) => row.ids.includes(card.id) && (!card.adminOnly || (user as any)?.userType === 'company_admin'))
                      .map((card) => {
                        const Icon = card.icon;
                        return (
                          <button
                            key={card.label}
                            type="button"
                            onClick={async () => {
                              // ★ 2026-09-15 못 쓰는 회사 = 이동 대신 그 기능의 안내(요금제 공통 안내 창)
                              // ★ 2026-10-07 원장을 아직 못 받았으면 받은 뒤 판정(받기 전 눌러도 안내 없이 들어가지 않게)
                              const intros = featureIntros ?? await loadPlanFeatureIntros();
                              const featureId = intros?.idForPath(card.path) ?? null;
                              if (planLocked && featureId) { setPlanFeatureId(featureId); return; }
                              // ★ 2026-09-20 순차 개방 중인 기능(카드 flag) = 카드는 보이되 아직인 회사는 같은 안내 창으로.
                              //   숨기지 않는다 — 없는 메뉴는 물어볼 수도 없다(Harold 확정).
                              if (!isCardOpen(card, featureFlags) && featureId) { setPlanFeatureId(featureId); return; }
                              navigate(card.path);
                            }}
                            className="group relative flex items-center gap-3.5 p-4 min-h-[80px] rounded-2xl text-left bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(15,23,42,0.32)] transition-all duration-200"
                            data-zone="tile"
                          >
                            <span className={`shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}>
                              <Icon className="w-5 h-5 text-white" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[15px] font-semibold text-slate-900">{card.label}</span>
                              <span className="block text-[12.5px] leading-snug mt-0.5 text-slate-500">{card.description}</span>
                            </span>
                            {planLocked ? (
                              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200">
                                <Lock className="w-3 h-3" />
                                {PLAN_FEATURE_MIN_PLAN}부터
                              </span>
                            ) : (
                              <ArrowRight className="shrink-0 w-[18px] h-[18px] text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </section>
      </main>
      {/* ★ D193 (2026-05-22) Phase D-1 사용자 안내: 첫 진입 walkthrough 5단계 안내 (localStorage 1회 표시) */}
      <AiOperatorWalkthroughModal />
    </div>
    </SurfaceToneProvider>
  );
}
