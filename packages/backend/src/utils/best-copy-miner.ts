// best-copy-miner.ts — AI 전수 채굴 CT (2026-07-04 재설계).
//   업종 학습 코퍼스 "전건"을 AI가 배치 판정(마케팅성 분류 + 퀄리티 0~10점) →
//   점수·발송성과 결합 상위 후보를 탈색·게이트 후 검수용으로 반환한다.
//   옛 휴리스틱 채굴(최근 300건 + 통계 정렬, 정보성 기본값)이 예약안내를 "베스트"로 뽑던 결함의 근본 대체.
//   is_ad 라벨을 신뢰하지 않고 AI가 직접 마케팅성을 판별한다(라벨 오기 방어).
//   잡 저장 = 프로세스 메모리(관리자 도구 — pm2 재시작 시 소멸, 재실행하면 됨. DB 테이블 신설 없음).
import pool from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { getTenantRef } from './training-logger';
import { CURATED_SEED_KEY } from './copy-rag-retriever';
import { deBrand, hasIdentifierLeak } from './copy-deidentify';
import { scoreSpamRisk } from './copy-spam-risk';

const BATCH_SIZE = 20;      // AI 1회 판정 문안 수
const CONCURRENCY = 3;      // 동시 판정 배치 수
const TOP_N = 20;           // 최종 검수 후보 수
const MIN_SCORE = 6;        // 후보 최소 퀄리티 점수
const SPAM_SEED_EXCLUDE = 0.5;

export interface MiningCandidate {
  text: string;          // 탈색본
  messageType: string;
  score: number;         // AI 퀄리티 점수 0~10
  reason: string;        // AI 선정 이유(한 줄)
  sentCount: number;
  successCount: number;
}

export interface MiningJob {
  industryCode: string;
  status: 'running' | 'done' | 'error';
  totalMessages: number;    // 중복 제거 후 판정 대상 건수
  totalBatches: number;
  processedBatches: number;
  failedBatches: number;    // AI 응답 실패 배치(전체 실패 아님 — 나머지로 계속)
  candidates: MiningCandidate[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

interface CorpusItem { text: string; messageType: string; sentCount: number; successCount: number }

const jobs = new Map<string, MiningJob>();

export function getMiningJob(industryCode: string): MiningJob | null {
  return jobs.get(industryCode) || null;
}

/** 채굴 잡 시작 — 업종당 동시 1개. 이미 실행 중이면 기존 잡 유지. */
export function startMiningJob(industryCode: string): { started: boolean; already?: boolean } {
  const existing = jobs.get(industryCode);
  if (existing && existing.status === 'running') return { started: false, already: true };
  const job: MiningJob = {
    industryCode,
    status: 'running',
    totalMessages: 0,
    totalBatches: 0,
    processedBatches: 0,
    failedBatches: 0,
    candidates: [],
    startedAt: Date.now(),
  };
  jobs.set(industryCode, job);
  void runMining(job).catch((e) => {
    job.status = 'error';
    job.error = e?.message || '채굴 실패';
    job.finishedAt = Date.now();
  });
  return { started: true };
}

async function runMining(job: MiningJob): Promise<void> {
  const curatedTenant = getTenantRef(CURATED_SEED_KEY);
  // 전수 조회(LIMIT 없음) — 시드 sentinel 행 제외, 스팸 차단 이력 제외
  const res = await pool.query(
    `SELECT final_message, message_type, sent_count, success_count
     FROM ai_training_logs
     WHERE tenant_ref <> $1 AND industry_code = $2
       AND final_message IS NOT NULL AND length(final_message) >= 20
       AND COALESCE(spam_blocked, 0) = 0
     ORDER BY created_at DESC`,
    [curatedTenant, job.industryCode],
  );

  // 중복 제거(공백 정규화 키) — 같은 문안 반복 발송분은 1건만 판정
  const seen = new Set<string>();
  const items: CorpusItem[] = [];
  for (const r of res.rows) {
    const key = String(r.final_message).replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      text: r.final_message,
      messageType: r.message_type || 'LMS',
      sentCount: r.sent_count || 0,
      successCount: r.success_count || 0,
    });
  }
  job.totalMessages = items.length;

  const batches: CorpusItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
  job.totalBatches = batches.length;

  const judged: MiningCandidate[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map((b) => judgeBatch(b, job)));
    for (const r of results) judged.push(...r);
    job.processedBatches = Math.min(job.totalBatches, i + group.length);
  }

  // 점수 → 발송 성공률 순 정렬 후 탈색·게이트·중복 제거 → 최종 TOP_N
  judged.sort((a, b) =>
    (b.score - a.score) ||
    ((b.successCount / Math.max(1, b.sentCount)) - (a.successCount / Math.max(1, a.sentCount))),
  );
  const out: MiningCandidate[] = [];
  const dedup = new Set<string>();
  for (const c of judged) {
    if (out.length >= TOP_N) break;
    const clean = deBrand(c.text);
    if (!clean || clean.replace(/\s/g, '').length < 12) continue;
    if (hasIdentifierLeak(clean)) continue;
    if (scoreSpamRisk(clean).score >= SPAM_SEED_EXCLUDE) continue;
    const key = clean.replace(/\s+/g, ' ');
    if (dedup.has(key)) continue;
    dedup.add(key);
    out.push({ ...c, text: clean });
  }
  job.candidates = out;
  job.status = 'done';
  job.finishedAt = Date.now();
}

/** 배치 1개 AI 판정 — 실패 시 빈 배열(잡 전체는 계속, failedBatches 집계). */
async function judgeBatch(batch: CorpusItem[], job: MiningJob): Promise<MiningCandidate[]> {
  const numbered = batch
    .map((b, i) => `${i + 1}. ${String(b.text).slice(0, 400).replace(/\n/g, ' / ')}`)
    .join('\n');
  const system =
    '너는 문자(SMS/LMS) 마케팅 카피 심사위원이다. 각 문안을 판정한다: '
    + '(1) mkt: 마케팅/프로모션 목적이면 true. 예약안내·배송안내·본인인증·설문·시스템 통지 등 단순 안내는 false. '
    + '(2) s: 마케팅 문안 퀄리티 0~10점(후킹, 오퍼 전달 명확성, 구성, 행동 유도 기준). '
    + '(3) r: 한 줄 선정/탈락 이유(한국어 40자 이내). '
    + '반드시 JSON 배열만 출력: [{"i":1,"mkt":true,"s":8,"r":"..."}]';
  try {
    const raw = await callAIWithFallback({
      system,
      userMessage: numbered,
      maxTokens: 2000,
      temperature: 0.2,
      model: 'sonnet',
      creditCost: 0, // 내부 관리자 도구 — 사용자 크레딧 차감 없음
    });
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) { job.failedBatches++; return []; }
    let arr: any[] = [];
    try { arr = JSON.parse(m[0]); } catch { job.failedBatches++; return []; }
    const outs: MiningCandidate[] = [];
    for (const j of arr) {
      const idx = Number(j?.i) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= batch.length) continue;
      if (j?.mkt !== true) continue;
      const score = Math.max(0, Math.min(10, Number(j?.s) || 0));
      if (score < MIN_SCORE) continue;
      outs.push({
        text: batch[idx].text,
        messageType: batch[idx].messageType,
        score,
        reason: String(j?.r || '').slice(0, 80),
        sentCount: batch[idx].sentCount,
        successCount: batch[idx].successCount,
      });
    }
    return outs;
  } catch {
    job.failedBatches++;
    return [];
  }
}
