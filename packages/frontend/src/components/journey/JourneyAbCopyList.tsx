/**
 * ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-16 · D14 — 켜진 여정의 A/B 칸 = 나가는 글(A/B 문안)을 보이고 본문 칸을 잠근다.
 *   서버도 같은 판정으로 막는다(journey-builder updateJourneyStep · 409 AB_STEP_COPY_LOCKED · 같은 문장 · 문장 일치 = 계약 시험).
 *   변이 본문 · 제목이 비면 칸 글로 나간다(서버 applyVariantToStep 와 같은 규칙).
 */
export interface AbVariantCopy {
  /** ★ C105 H5 판 행 id(판마다 스팸 검사 · 서버 점검 항목 variantId 와 같은 id) */
  id?: string;
  variant_id: string;
  message_template: string | null;
  subject: string | null;
}

export const AB_STEP_COPY_LOCKED_MESSAGE = 'A/B 문안이 있는 칸은 A/B 창에서 고치거나 모양 바꾸기로 고쳐 주세요.';
/** ★ 2026-11-05 C104 G3 — 초안 · 멈춘 여정 문구(서버 journey-builder 같은 이름 · 같은 글 · 짝 시험) */
export const AB_STEP_COPY_LOCKED_DRAFT_MESSAGE = 'A/B 문안이 있는 칸은 A/B 창에서 고쳐 주세요. A/B 문안을 모두 지우면 이 칸 문안으로 나가요.';
export function abStepCopyLockedMessage(status: string | null | undefined): string {
  return status === 'active' ? AB_STEP_COPY_LOCKED_MESSAGE : AB_STEP_COPY_LOCKED_DRAFT_MESSAGE;
}

/**
 * ★ 2026-11-05 C104 Codex 구현 1R — 이 칸에서 나갈 글(서버 stepSendVersions 와 같은 규칙 · 화면 판정 입력 한 곳).
 *   A/B 문안이 있으면 그 판들(판 글 · 제목이 비면 칸 글 · 칸 제목) · 없으면 칸 글. 카카오 칸은 부르는 쪽이 판을 넘기지 않는다(켜기 검증과 같은 규칙).
 */
export function abSendCopies(variants: AbVariantCopy[] | null | undefined, baseBody: string | null | undefined, baseSubject: string | null | undefined): Array<{ body: string; subject: string }> {
  const list = variants ?? [];
  if (list.length === 0) return [{ body: baseBody || '', subject: baseSubject || '' }];
  return list.map((v) => ({ body: v.message_template || baseBody || '', subject: v.subject || baseSubject || '' }));
}

/** 이 칸 본문을 잠그는가(A/B 문안 1개 이상 · ★ C104 G3 상태 무관 = A/B 판이 있으면 칸 글은 어느 상태에서도 안 나간다) — 작업 화면 · 문안 수정 창 · 서버가 같은 판정. */
export function abCopyLocked(variants: AbVariantCopy[] | null | undefined): boolean {
  return (variants?.length ?? 0) > 0;
}

export default function JourneyAbCopyList({ journeyStatus, variants, baseBody, baseSubject, onOpenAb }: {
  journeyStatus: string | null | undefined;
  variants: AbVariantCopy[];
  baseBody: string | null;
  baseSubject: string | null;
  onOpenAb?: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12.5px] leading-relaxed text-indigo-900">
        이 칸은 A/B 문안으로 나가요. {abStepCopyLockedMessage(journeyStatus)}
      </p>
      {abSendCopies(variants, baseBody, baseSubject).map((c, i) => (
        <div key={variants[i].variant_id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-1 text-[12px] font-semibold text-slate-500">{variants[i].variant_id} 문안</div>
          {c.subject && <div className="mb-1 break-words text-[13.5px] font-semibold text-slate-800">{c.subject}</div>}
          <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-slate-700">{c.body || '문안이 비어 있어요.'}</pre>
        </div>
      ))}
      {onOpenAb && (
        <button type="button" onClick={onOpenAb}
          className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">
          A/B 창 열기
        </button>
      )}
    </div>
  );
}
