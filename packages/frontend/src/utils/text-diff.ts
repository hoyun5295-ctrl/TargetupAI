/**
 * 문안 비포/애프터 하이라이트 — 단일 정의 (2026-08-08 분리)
 *
 * 기원 = D152-6 (2026-05-12) Harold 명시: "지금은 뭐가 바꼈는지 올라갔다 내려갔다 확인해야하잖아".
 *   AI가 고친 결과를 원본과 나란히 놓고 **바뀐 부분만** 강조해 한 화면에서 체감하게 한다.
 *
 * 왜 CT로 나왔나
 *   직접발송 모달(AiRefineModal) 안에만 있어서 여정 다듬기는 후보를 세로로 쌓아 보여 주고 있었다
 *   (2026-08-08 Harold 접수 — "3종 의미가 없어, 비포 애프터처럼"). 같은 로직 두 벌을 만들지 않는다.
 *
 * ⛔ 어절 단위로 끊지 않는다 — "20분전" vs "20분 전"처럼 어절이 공백으로 갈리는 경우
 *   전체가 added로 잘못 강조된다(D152-6 정정3). 글자 단위 LCS라야 정확하다.
 *   외부 의존성 없이 자체 구현한다.
 */

export interface DiffChunk {
  text: string;
  /** 원본에 없던 부분인가 — 화면이 이 값만 강조한다. */
  added: boolean;
}

/** 원본 대비 결과에서 **추가된 부분**을 글자 단위로 갈라 낸다. */
export function highlightAdditions(original: string, modified: string): DiffChunk[] {
  const src = String(original || '');
  const dst = String(modified || '');
  const m = src.length;
  const n = dst.length;

  const width = n + 1;
  const dp = new Int32Array((m + 1) * width);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cur = i * width + j;
      if (src.charCodeAt(i - 1) === dst.charCodeAt(j - 1)) {
        dp[cur] = dp[cur - width - 1] + 1;
      } else {
        const a = dp[cur - width];
        const b = dp[cur - 1];
        dp[cur] = a > b ? a : b;
      }
    }
  }

  const result: DiffChunk[] = [];
  let i = m;
  let j = n;
  while (j > 0) {
    const isSame = i > 0 && src.charCodeAt(i - 1) === dst.charCodeAt(j - 1);
    const isAdded = !isSame && (i === 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j]);

    if (isSame) {
      if (result.length > 0 && !result[0].added) {
        result[0].text = dst[j - 1] + result[0].text;
      } else {
        result.unshift({ text: dst[j - 1], added: false });
      }
      i -= 1;
      j -= 1;
    } else if (isAdded) {
      if (result.length > 0 && result[0].added) {
        result[0].text = dst[j - 1] + result[0].text;
      } else {
        result.unshift({ text: dst[j - 1], added: true });
      }
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return result;
}

/** 결과에서 **빠진 부분**(원본에만 있던 것)을 갈라 낸다 — 비포 쪽에 표시한다. */
export function highlightRemovals(original: string, modified: string): DiffChunk[] {
  // 방향만 뒤집으면 같은 문제다 — "결과 기준 추가"가 "원본 기준 삭제"다.
  return highlightAdditions(modified, original);
}
