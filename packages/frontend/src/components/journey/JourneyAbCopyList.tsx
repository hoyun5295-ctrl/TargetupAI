/**
 * ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-16 · D14 — 켜진 여정의 A/B 칸 = 나가는 글(A/B 문안)을 보이고 본문 칸을 잠근다.
 *   서버도 같은 판정으로 막는다(journey-builder updateJourneyStep · 409 AB_STEP_COPY_LOCKED · 같은 문장 · 문장 일치 = 계약 시험).
 *   변이 본문 · 제목이 비면 칸 글로 나간다(서버 applyVariantToStep 와 같은 규칙).
 */
export interface AbVariantCopy {
  variant_id: string;
  message_template: string | null;
  subject: string | null;
}

export const AB_STEP_COPY_LOCKED_MESSAGE = 'A/B 문안이 있는 칸은 A/B 창에서 고치거나 모양 바꾸기로 고쳐 주세요.';

/** 이 칸 본문을 잠그는가(켜진 여정 · A/B 문안 1개 이상) — 작업 화면 · 문안 수정 창이 같은 판정. */
export function abCopyLocked(journeyStatus: string | null | undefined, variants: AbVariantCopy[] | null | undefined): boolean {
  return journeyStatus === 'active' && (variants?.length ?? 0) > 0;
}

export default function JourneyAbCopyList({ variants, baseBody, baseSubject, onOpenAb }: {
  variants: AbVariantCopy[];
  baseBody: string | null;
  baseSubject: string | null;
  onOpenAb?: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12.5px] leading-relaxed text-indigo-900">
        이 칸은 A/B 문안으로 나가요. {AB_STEP_COPY_LOCKED_MESSAGE}
      </p>
      {variants.map((v) => {
        const subject = v.subject || baseSubject;
        return (
          <div key={v.variant_id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-1 text-[12px] font-semibold text-slate-500">{v.variant_id} 문안</div>
            {subject && <div className="mb-1 break-words text-[13.5px] font-semibold text-slate-800">{subject}</div>}
            <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-slate-700">{v.message_template || baseBody || '문안이 비어 있어요.'}</pre>
          </div>
        );
      })}
      {onOpenAb && (
        <button type="button" onClick={onOpenAb}
          className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">
          A/B 창 열기
        </button>
      )}
    </div>
  );
}
