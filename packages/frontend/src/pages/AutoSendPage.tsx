/**
 * ★ D188 Phase 2-B-4 (2026-05-21) 자동발송 영구 폐기 — Harold 명시 "사용 고객사 0 + 여정 빌더가 진짜 업그레이드".
 *
 * 기존 D69~D182 자동발송 매트릭스 (목록 + AutoSendFormModal 5단계 위저드)를 영구 폐기하고,
 * 본 페이지는 단순 안내 페이지로 변경합니다.
 *
 * 운영 데이터 영역:
 *   - auto_campaigns 테이블 + plans.auto_campaign_enabled + plans.max_auto_campaigns 컬럼 보존 (운영 안전망)
 *   - utils/auto-campaign-worker.ts 5분 cron 유지 (기존 활성 매트릭스 자연 소멸)
 *   - routes/auto-campaigns.ts POST (신규 생성)만 410 Gone 차단, GET (조회)는 유지
 *
 * 신규 사용자 진입 시 → 여정 빌더(/ai-journeys) 안내 + 진입 버튼 제공.
 * 헤더 메뉴 "자동발송" 영구 제거 (DashboardHeader.tsx 영역 정합).
 */

import { useNavigate } from 'react-router-dom';
import { Workflow, ArrowRight, Sparkles } from 'lucide-react';

export default function AutoSendPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-amber-50/30 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-8 py-10 bg-gradient-to-r from-fuchsia-50 via-purple-50 to-amber-50 border-b border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white flex items-center justify-center">
                <Workflow size={26} strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">자동발송 → 여정 빌더로 통합</h1>
                <p className="text-sm text-gray-500 mt-1">D188 (2026-05-21) 한줄로 마케팅 자동화 업그레이드</p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-8 space-y-6">
            <div className="text-base text-gray-700 leading-relaxed">
              기존 <strong>자동발송</strong> 기능은 <strong className="text-fuchsia-600">여정 빌더(Journey Builder)</strong>로
              영구 통합되었습니다. 여정 빌더는 기존 자동발송의 단순 반복 스케줄을 넘어, 7 표준 여정 자동 생성 + 자연어 AI Operator 진입 +
              메시지 / 대기 / 조건 분기 step + 다채널 (SMS/LMS/MMS/알림톡) + A/B 테스트 + Bandit 자동 최적화까지 갖춘
              한줄로 마케팅 자동화의 진짜 업그레이드입니다.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="text-xs font-semibold text-gray-500 mb-1">기존 자동발송</div>
                <div className="text-sm text-gray-700">단순 반복 스케줄 (매주/매월/매일 정시 발송)</div>
              </div>
              <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-4">
                <div className="text-xs font-semibold text-fuchsia-600 mb-1">여정 빌더 (신규)</div>
                <div className="text-sm text-gray-700">
                  7 표준 여정 + 자연어 AI 진입 + 메시지/대기/조건 step + 다채널 + A/B + Bandit
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="text-xs font-semibold text-amber-700 mb-1">전환 안내</div>
                <div className="text-sm text-gray-700">
                  기존 활성 자동발송 캠페인은 자연 소멸까지 유지됩니다. 신규 등록은 여정 빌더만 사용해주세요.
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate('/ai-journeys')}
                className="w-full md:w-auto px-8 py-4 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-700 hover:to-purple-700 text-white rounded-xl font-bold text-base shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
              >
                <Sparkles size={18} strokeWidth={2} />
                <span>여정 빌더로 이동</span>
                <ArrowRight size={18} strokeWidth={2} />
              </button>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed pt-3 border-t border-gray-100">
              D188 Phase 2-B-4 (2026-05-21). 자동발송 헤더 메뉴 영구 제거 + 본 페이지 안내 페이지 변경. 기존 운영 데이터(auto_campaigns 테이블 + plans 컬럼) 보존 안전망 정합.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
