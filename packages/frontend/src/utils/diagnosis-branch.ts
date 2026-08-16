/**
 * CT: 마케팅 진단 문진 분기 판정 (2026-08-17 신설 — DiagnosisWizard에서 원형 이동)
 *
 * 위저드가 화면 안에 갖고 있던 판정을 순수 함수로 분리한다. 이유는 둘이다.
 *   1. 이 판정은 **서버 `plan-recommend.visibleQuestions`와 같은 규칙**이어야 한다.
 *      두 벌이 어긋나면 화면은 묻는데 서버는 고아 답이라 400을 내거나, 그 반대가 된다.
 *      분리해 두면 백엔드 계약 테스트가 실 seed로 두 판정을 대조할 수 있다.
 *   2. 위저드 안(JSX 파일)에 있으면 테스트가 컴포넌트를 통째로 끌어와야 해 잠글 수 없었다.
 *
 * 규칙(서버와 동일) — show_when은 같은 섹션의 앞 게이트 1개만 참조하고, 분기의 분기는 없다.
 * 그래서 가시 집합은 답 전체 기준 단일 패스로 결정적이다.
 */

/** 판정에 필요한 최소 모양 — 프론트 DTO·백엔드 정의가 구조적으로 둘 다 만족한다. */
export interface BranchQuestion {
  key: string;
  show_when?: { q: string; in: string[] } | null;
  options: Array<{ key: string }>;
}

/** 가시 문항 — show_when 없는 문항 + 조건 충족 분기. */
export function visiblePath<T extends BranchQuestion>(
  questions: T[],
  answers: Record<string, string>,
): T[] {
  return questions.filter((q) => {
    if (!q.show_when) return true;
    const v = answers[q.show_when.q];
    return typeof v === 'string' && q.show_when.in.includes(v);
  });
}

/**
 * 고아 답 제거 — 비가시 문항의 답을 지우고, 지운 것이 또 다른 분기를 닫을 수 있어 고정점까지 반복.
 * 지운 답은 stash에 보관해 같은 게이트 답으로 돌아오면 복원한다(다시 안 묻는다).
 *
 * ⚠ `prefilled`(서버 실측 선치환)를 반드시 함께 넘긴다 — 가시성 판정은 화면 렌더와 **같은 답 집합**으로
 *   해야 한다. 빠뜨리면 선치환된 게이트의 분기가 "안 보이는 문항"으로 판정돼 방금 고른 답이 즉시
 *   지워지고, 커서가 같은 문항으로 되돌아온다(2026-08-17 퍼널 A 진행 불가 사고의 원인).
 *   지우는 대상은 사용자가 답한 것뿐이고 prefilled는 판정 입력으로만 쓴다.
 */
export function pruneAnswers(
  questions: BranchQuestion[],
  answers: Record<string, string>,
  stash: Record<string, string>,
  prefilled: Record<string, string> = {},
): Record<string, string> {
  let cur = { ...answers };
  // 화면 렌더와 **같은 답 집합**으로 판정한다(어긋나면 방금 고른 답이 고아로 지워진다)
  const effOf = (a: Record<string, string>) => ({ ...prefilled, ...a });
  for (let i = 0; i < questions.length; i++) {
    const visible = new Set(visiblePath(questions, effOf(cur)).map((q) => q.key));
    const orphan = Object.keys(cur).filter((k) => !visible.has(k));
    if (orphan.length === 0) break;
    for (const k of orphan) {
      stash[k] = cur[k];
      delete cur[k];
    }
  }
  // 다시 열린 분기는 stash에서 복원(같은 답으로 돌아온 경우 재질문 생략)
  for (let i = 0; i < questions.length; i++) {
    const visible = visiblePath(questions, effOf(cur));
    let restored = false;
    for (const q of visible) {
      if (cur[q.key] === undefined && stash[q.key] !== undefined && q.options.some((o) => o.key === stash[q.key])) {
        cur = { ...cur, [q.key]: stash[q.key] };
        restored = true;
      }
    }
    if (!restored) break;
  }
  return cur;
}
