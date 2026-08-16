/**
 * DiagnosisReportView — 진단 리포트 라우터 (2026-08-16 · v3 개편)
 *
 * 스냅샷 불변 계약: result는 제출 시점 스키마 그대로 산다(백필·마이그레이션 없음).
 * 그래서 렌더는 스냅샷 버전이 고른다 — v2(스토리형) = ReportV2View / v1 = ReportV1View(현행 동결).
 * 모르는 버전 = 요약·추천만 그리는 최소 뷰(fail-soft — 재열람 계약은 어떤 스냅샷에서도 깨지지 않는다).
 */
import ReportV1View from './ReportV1View';
import ReportV2View from './ReportV2View';
import type { DiagnosisResultDto } from './diagnosisApi';

interface Props {
  result: DiagnosisResultDto;
  outcome?: DiagnosisResultDto['grant_outcome'];
  trialExpiresAt?: string | null;
  /** v2 표지 1층 — A는 회사명, B는 폼 뒤 재렌더에서 회사명(없으면 서버 접점 구절). */
  coverTitle?: string | null;
  /** 퍼널 B 폼 앞 미리보기(v2) — 실행 순서·예시·견적 대신 부재 안내. */
  previewMode?: boolean;
  onFirstSend?: () => void;
  onConsult?: () => void;
  onSeePlans?: () => void;
  onLater?: () => void;
}

export default function DiagnosisReportView(props: Props) {
  const { result } = props;
  if (result?.v === 2 && result.stage !== undefined) {
    return <ReportV2View {...props} />;
  }
  if (result?.v === 1 || (result && result.v === undefined)) {
    const { coverTitle: _coverTitle, previewMode: _previewMode, ...v1Props } = props;
    return <ReportV1View {...v1Props} />;
  }
  // 모르는 버전 — 최소 표시(백지 금지)
  return (
    <div className="flex flex-col gap-4 break-keep">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-base font-bold text-white">{result?.summary ?? '진단 리포트'}</p>
        <p className="mt-1.5 text-[13px] text-white/60">이전 형식으로 저장된 리포트예요. 자세한 내용은 담당자에게 문의해 주세요.</p>
      </div>
      {result?.recommendation && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/50">추천 요금제</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {result.recommendation.plan_name} · 월 {Number(result.recommendation.monthly_price ?? 0).toLocaleString()}원
          </p>
        </div>
      )}
    </div>
  );
}
