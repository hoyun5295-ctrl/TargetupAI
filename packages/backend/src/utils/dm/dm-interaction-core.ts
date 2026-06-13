/**
 * dm-interaction-core.ts — DM 인터랙션 순수 코어 (DB-free, ts-node TDD)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts
 * 임의 상수 0 — 확률/등급/인원은 호출부(섹션 props·dm_prizes)에서 주입.
 */

// 시드 RNG (xmur3 해시 + mulberry32) — Math.random/Date.now 미사용, 추첨 재현 가능
export function makeSeededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 룰렛 실시간 ---
export type RouletteSegmentLite = { id: string; label: string; probability: number };
export type SegmentPrize = { prizeId: string; remaining: number };
export type RoulettePick = { segmentId: string; label: string; won: boolean; prizeId: string | null };

/** 가중 랜덤으로 세그먼트 선택. 당첨 세그먼트라도 재고 0이면 won=false(꽝). rng 주입(테스트 결정적). */
export function pickRouletteSegment(
  segments: RouletteSegmentLite[],
  prizeBySegment: Record<string, SegmentPrize>,
  rng: () => number,
): RoulettePick {
  if (!segments || segments.length === 0) {
    return { segmentId: '', label: '', won: false, prizeId: null };
  }
  const weights = segments.map((s) =>
    typeof s.probability === 'number' && s.probability > 0 ? s.probability : 0,
  );
  const total = weights.reduce((acc, w) => acc + w, 0);
  let idx = 0;
  if (total <= 0) {
    idx = Math.min(segments.length - 1, Math.floor(rng() * segments.length));
  } else {
    let r = rng() * total;
    for (let i = 0; i < segments.length; i++) {
      idx = i;
      r -= weights[i];
      if (r < 0) break;
    }
  }
  const seg = segments[idx];
  const prize = prizeBySegment[seg.id];
  const won = !!(prize && prize.remaining > 0);
  return { segmentId: seg.id, label: seg.label, won, prizeId: won ? prize.prizeId : null };
}

// --- 마감 후 자동 랜덤 추첨 ---
export type DrawEntry = { responseId: string; key: string }; // key = customer_id 또는 anonymous_id
export type RankPrize = { prizeId: string; rank: number; count: number };
export type DrawnWinner = { responseId: string; key: string; rank: number; prizeId: string };

/** 응모자 풀에서 등급(rank asc)별 인원만큼 시드 셔플로 추첨. 1인 1회·중복 당첨 제외·응모<인원이면 가능분만. */
export function drawWinners(entries: DrawEntry[], prizesByRank: RankPrize[], seed: string): DrawnWinner[] {
  const rng = makeSeededRng(seed);
  const seen = new Set<string>();
  const pool: DrawEntry[] = [];
  for (const e of entries) {
    if (e.key && seen.has(e.key)) continue;
    if (e.key) seen.add(e.key);
    pool.push(e);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const ranks = [...prizesByRank].sort((x, y) => x.rank - y.rank);
  const winners: DrawnWinner[] = [];
  let cursor = 0;
  for (const p of ranks) {
    for (let k = 0; k < p.count && cursor < pool.length; k++) {
      const e = pool[cursor++];
      winners.push({ responseId: e.responseId, key: e.key, rank: p.rank, prizeId: p.prizeId });
    }
  }
  return winners;
}

// --- 엑셀 사전 지정 파싱 ---
export type RawWinnerRow = Record<string, any>;
export type ParsedWinner = { name: string; phone: string; email: string | null; rank: number | null };
export type WinnerParseResult = { winners: ParsedWinner[]; errors: { row: number; message: string }[] };

/** 한/영 헤더 모두 허용(이름/name, 전화/phone, 이메일/email, 등급/rank). 행별 오류 수집. */
export function parseWinnerRows(rows: RawWinnerRow[]): WinnerParseResult {
  const winners: ParsedWinner[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; // 헤더 1행 + 1-based
    const name = String(row['이름'] ?? row['name'] ?? '').trim();
    const phone = String(row['전화'] ?? row['전화번호'] ?? row['phone'] ?? '').replace(/[^0-9]/g, '');
    const email = String(row['이메일'] ?? row['email'] ?? '').trim();
    const rankRaw = row['등급'] ?? row['rank'];
    if (!name && !phone) {
      errors.push({ row: line, message: '이름·전화가 모두 비어 있음' });
      return;
    }
    if (!phone) {
      errors.push({ row: line, message: '전화번호 누락' });
      return;
    }
    let rank: number | null = null;
    if (rankRaw !== undefined && rankRaw !== null && String(rankRaw).trim() !== '') {
      const n = Number(rankRaw);
      if (!Number.isInteger(n) || n < 1) {
        errors.push({ row: line, message: `등급 값 오류: ${String(rankRaw)}` });
        return;
      }
      rank = n;
    }
    winners.push({ name, phone, email: email || null, rank });
  });
  return { winners, errors };
}

/** 룰렛 확률 합계(A 룰렛 editor 검증 공용). */
export function sumProbabilities(segments: { probability?: number }[]): number {
  return segments.reduce((acc, s) => acc + (typeof s.probability === 'number' ? s.probability : 0), 0);
}

// --- 결과 분석(G) — 실데이터만, 임의 상수 0 ---
export type EventInsightStats = {
  total_responses: number;
  unique_participants: number;
  views: number;
  winners: number;
  by_section: Array<{ section_type: string; responses: number; members: number }>;
};
export type EventInsight = { hasData: boolean; headline: string; lines: string[] };

/** 응모·당첨·열람 실측 → 사실 기반 인사이트. 데이터 0이면 insufficient(추정 0). 비율은 실측 분모만(div0 가드). */
export function buildEventInsight(s: EventInsightStats): EventInsight {
  const responses = s.total_responses || 0;
  const views = s.views || 0;
  if (responses === 0 && views === 0) {
    return { hasData: false, headline: '아직 데이터가 충분하지 않습니다.', lines: ['열람·응모가 쌓이면 분석이 표시됩니다.'] };
  }
  const ko = (n: number) => n.toLocaleString('ko-KR');
  const lines: string[] = [`열람 ${ko(views)}회 · 응모 ${ko(responses)}건`];
  if (views > 0) {
    const rate = Math.round((s.unique_participants / views) * 1000) / 10;
    lines.push(`참여 전환율 ${rate}% (순참여 ${ko(s.unique_participants)}명 / 열람 ${ko(views)}회)`);
  }
  const members = s.by_section.reduce((a, x) => a + (x.members || 0), 0);
  if (responses > 0) {
    const memberPct = Math.round((members / responses) * 1000) / 10;
    lines.push(`회원 참여 비중 ${memberPct}% (회원 ${ko(members)} / 전체 ${ko(responses)})`);
  }
  if (s.winners > 0) lines.push(`당첨 ${ko(s.winners)}명 처리 완료`);
  const headline = responses > 0 ? `응모 ${ko(responses)}건이 모였습니다.` : `열람 ${ko(views)}회 · 아직 응모 전입니다.`;
  return { hasData: true, headline, lines };
}
