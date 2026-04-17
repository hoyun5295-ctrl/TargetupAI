/**
 * dm-text-diff.ts — DM 텍스트 비교 유틸 (프론트 전용)
 *
 * 소비처:
 *  - components/dm/modals/AiImproveModal (AI 개선 제안 diff)
 *  - components/dm/modals/VersionHistoryModal (버전 side-by-side diff)
 *  - components/dm/modals/AbTestModal (variant 간 본문 비교)
 *
 * 알고리즘: LCS(Longest Common Subsequence) 기반 diff
 *  - 단어 단위(diffByWord): 한 문장 내 변경점 하이라이트
 *  - 줄 단위(diffByLine): 섹션 본문/JSON 스냅샷 비교
 *  - 의미 단위(tokenize): 공백 + 한글/영문 경계로 분절
 */

export type DiffOp = 'equal' | 'insert' | 'delete' | 'replace';

export type DiffChunk = {
  op: DiffOp;
  before: string;
  after: string;
};

// ────────────── Tokenizer ──────────────

/**
 * 한/영/숫자/기호/공백 경계로 문자열 분절.
 * 한 토큰에 한 덩어리(단어 or 공백) 단위로 포함.
 */
export function tokenizeWords(text: string): string[] {
  if (!text) return [];
  // 한글 연속 / 영문/숫자 연속 / 공백 / 그 외 1문자
  const re = /[가-힣]+|[a-zA-Z0-9]+|\s+|./g;
  return text.match(re) || [];
}

export function tokenizeLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}

// ────────────── LCS 기반 diff ──────────────

/**
 * 토큰 배열 2개를 받아 diff chunk 배열 반환.
 * Myers diff의 축약판 — 중간 크기(<10k 토큰)에 충분한 성능.
 */
function diffTokens(a: string[], b: string[]): DiffChunk[] {
  const n = a.length;
  const m = b.length;

  // DP 테이블 (LCS 길이)
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack: op 시퀀스 생성
  const ops: Array<{ op: 'equal' | 'insert' | 'delete'; token: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ op: 'equal', token: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ op: 'delete', token: a[i - 1] });
      i--;
    } else {
      ops.push({ op: 'insert', token: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ op: 'delete', token: a[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ op: 'insert', token: b[j - 1] });
    j--;
  }
  ops.reverse();

  // 연속된 같은 op 묶기 + delete+insert 인접 → replace 병합
  const chunks: DiffChunk[] = [];
  let cur: DiffChunk | null = null;

  const flush = () => {
    if (cur) {
      chunks.push(cur);
      cur = null;
    }
  };

  for (const o of ops) {
    if (o.op === 'equal') {
      if (cur?.op === 'equal') {
        cur.before += o.token;
        cur.after += o.token;
      } else {
        flush();
        cur = { op: 'equal', before: o.token, after: o.token };
      }
    } else if (o.op === 'delete') {
      if (cur?.op === 'delete' || cur?.op === 'replace') {
        cur.before += o.token;
      } else {
        flush();
        cur = { op: 'delete', before: o.token, after: '' };
      }
    } else {
      // insert
      if (cur?.op === 'insert') {
        cur.after += o.token;
      } else if (cur?.op === 'delete') {
        cur.op = 'replace';
        cur.after = o.token;
      } else if (cur?.op === 'replace') {
        cur.after += o.token;
      } else {
        flush();
        cur = { op: 'insert', before: '', after: o.token };
      }
    }
  }
  flush();
  return chunks;
}

// ────────────── Public API ──────────────

/**
 * 단어 단위 diff. 한 문장 내 변경점 하이라이트에 적합.
 */
export function diffByWord(before: string, after: string): DiffChunk[] {
  return diffTokens(tokenizeWords(before || ''), tokenizeWords(after || ''));
}

/**
 * 줄 단위 diff. 섹션 본문 비교/버전 스냅샷 비교에 적합.
 */
export function diffByLine(before: string, after: string): DiffChunk[] {
  return diffTokens(tokenizeLines(before || ''), tokenizeLines(after || ''));
}

/**
 * 변경 요약: 추가/삭제/치환 건수.
 */
export function summarizeDiff(chunks: DiffChunk[]): {
  insertions: number;
  deletions: number;
  replacements: number;
  unchanged: number;
} {
  let insertions = 0;
  let deletions = 0;
  let replacements = 0;
  let unchanged = 0;
  for (const c of chunks) {
    if (c.op === 'insert') insertions++;
    else if (c.op === 'delete') deletions++;
    else if (c.op === 'replace') replacements++;
    else unchanged++;
  }
  return { insertions, deletions, replacements, unchanged };
}

/**
 * JSON 객체 스냅샷 비교 (버전 히스토리 sections[] 비교용).
 * 단순 JSON.stringify 직렬화 후 줄 단위 diff.
 */
export function diffJson(before: unknown, after: unknown): DiffChunk[] {
  const s1 = JSON.stringify(before, null, 2);
  const s2 = JSON.stringify(after, null, 2);
  return diffByLine(s1, s2);
}
