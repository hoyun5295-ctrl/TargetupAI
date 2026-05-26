/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 3: 고객 임포트 + AI 컬럼 매핑
 *
 * 기존 customer 업로드 메뉴 안내 + 본 step에서는 진입 안내만.
 * (file upload + multer + xlsx 파싱 = 분량 큰 영역 = 차후 본질 강화)
 */

import { useNavigate } from 'react-router-dom';
import { Upload, ExternalLink, ArrowRight, Check, Users } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
  onSync: () => void;
}

export default function Step3Import({ state, onNext, onSync }: Props) {
  const navigate = useNavigate();
  const completed = state.completedSteps.includes(3);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-fuchsia-500/20 border border-fuchsia-400/30 flex items-center justify-center flex-shrink-0">
            <Upload className="w-5 h-5 text-fuchsia-300" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white mb-1.5">고객 데이터 임포트 + AI 자동 매핑</h2>
            <p className="text-[12px] text-white/65 leading-relaxed">
              Excel/CSV 파일을 업로드하면 AI가 자동으로 컬럼을 매핑합니다 (이름, 휴대폰, 생일, 구매일 등). 사용자 정의 필드는 custom_fields로 자동 저장.
            </p>
          </div>
        </div>
      </div>

      {state.importedCustomerCount > 0 && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-emerald-300" />
            <p className="text-sm text-emerald-100">
              현재 임포트된 고객 <b>{state.importedCustomerCount.toLocaleString()}명</b>
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => navigate('/address-book')}
          className="flex items-center gap-2 px-5 py-2.5 bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded-lg text-sm font-semibold"
        >
          <ExternalLink className="w-4 h-4" />
          고객 DB 메뉴로 이동
        </button>
        <button
          onClick={onSync}
          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-lg text-sm"
        >
          상태 새로고침
        </button>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-white/10">
        <p className="text-[11px] text-white/40">
          {completed ? '✓ 완성된 step. 추가 임포트도 가능합니다.' : '고객 데이터 임포트 후 다음 단계로 진입하세요.'}
        </p>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-semibold"
        >
          {completed ? <Check className="w-4 h-4" /> : null}
          다음 단계 (4/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
