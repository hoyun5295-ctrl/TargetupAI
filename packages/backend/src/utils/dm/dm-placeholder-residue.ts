/**
 * dm-placeholder-residue.ts — DM 고객 화면에 찍히는 빈 자리 글자 판정 CT(순수 · DB 0) — ★ 2026-10-24 세 채널 구조체크 ⑮
 *
 * 옛: 이 판정이 플래너(planner-execution)에만 있어, 편집기 첫 발행 관문(dm-publish-gate · 저장 글자만 봄)과 [보내기]는
 *     렌더러가 빈 값 자리에 찍는 「이미지를 추가해주세요」 · 「[질문을 작성해주세요]」 같은 글자를 못 보고 고객에게 내보냈다.
 * 지금: 렌더러가 찍는 글자 목록과 판정이 여기 한 곳이다. 소비처 = 발행 관문 dmPublishStaticBlock(첫 발행 · 보내기) · 플래너 DM 점검.
 * ⛔ 렌더러(dm-section-renderer)에 빈 자리 글자를 새로 만들면 아래 목록에 더한다.
 */

/**
 * (순수) 발행된 DM 화면에 남은 빈 자리 — **고객이 보는 렌더 결과**에서 찾는다.
 * 여기 문구는 DM 렌더러가 빈 값 자리에 실제로 찍는 문자열이다(dm-section-renderer · 섹션 기본값 · 혜택 placeholder).
 * ⛔ "입력해주세요" 같은 일반 낱말로 잡지 않는다 — 설문 답변칸 안내처럼 정상 문구가 걸린다. 렌더러 리터럴만 본다.
 */
const DM_PLACEHOLDER_LITERALS: Array<{ text: string; label: string }> = [
  { text: '[직접 작성해주세요]', label: '직접 작성 문구' },
  { text: '[혜택 직접 작성해주세요]', label: '혜택 문구' },
  { text: '이미지를 추가해주세요', label: '이미지' },
  { text: '[상품을 추가해주세요]', label: '상품' },
  { text: '[슬라이드를 추가해주세요]', label: '슬라이드' },
  { text: '[질문을 작성해주세요]', label: '설문 질문' },
  { text: '[설문 질문을 추가해주세요]', label: '설문 질문' },
  { text: '[헤드라인을 작성해주세요]', label: '헤드라인' },
  { text: '[상품 소개: 직접 작성해주세요]', label: '상품 소개' },   // ★ 2026-10-24 ② 근거 없는 효능을 뺀 자리(copy-benefit-detector EFFICACY_PLACEHOLDER)
  { text: '[YouTube URL을 입력해주세요]', label: '영상 주소' },
  { text: '[Instagram URL을 입력해주세요]', label: 'SNS 주소' },
  { text: '[매장 정보를 추가해주세요]', label: '매장 정보' },
  { text: '[리뷰를 추가해주세요]', label: '리뷰' },
];

export interface DmPlaceholderResidue {
  label: string;
  count: number;
}

/** (순수) 렌더된 HTML에서 빈 자리 문구를 센다. 결과가 비면 완성이다. */
export function findDmPlaceholderResidue(renderedHtml: string): DmPlaceholderResidue[] {
  // 태그 제거 — 속성값(placeholder="답변을 입력해주세요")은 보지 않고 사람이 읽는 텍스트만 본다.
  const text = String(renderedHtml || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  const byLabel = new Map<string, number>();
  for (const { text: needle, label } of DM_PLACEHOLDER_LITERALS) {
    let idx = text.indexOf(needle);
    let count = 0;
    while (idx >= 0) {
      count++;
      idx = text.indexOf(needle, idx + needle.length);
    }
    if (count > 0) byLabel.set(label, (byLabel.get(label) || 0) + count);
  }
  return Array.from(byLabel.entries()).map(([label, count]) => ({ label, count }));
}

/** (순수) 빈 자리 요약 문구 — 통지·화면 공용. 예: "이미지 2곳 · 직접 작성 문구 3곳". */
export function describeDmResidue(residue: DmPlaceholderResidue[]): string {
  return residue.map((r) => `${r.label} ${r.count}곳`).join(' · ');
}
