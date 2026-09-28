/**
 * utils/retention-sweeper.ts — 보관 기한 정리 CT (★ 2026-09-28 한줄로 V2 차수 4 · Harold 승인 수정본)
 *
 * 기준
 *   - 로그성 기록(이메일 이벤트 · 카카오 웹훅 · 문안 시드 사용) = LOG_RETENTION_DAYS(1년 이상 · 전송자격인증 4.1·4.2).
 *   - 임시·작성 중 = 짧게: SNS 연결 임시 행(만료 1일 뒤) · 인터뷰 세션(작성 중만 90일) · 이벤트 초안(90일).
 *   - 파일 = 풀분석 PDF 90일.
 *   - 지우지 않는 것 = AI 운영자 제안 기록(학습 현황 집계가 쓴다) · DM·재료 이미지 · **취소·만료 대행 접수 이미지**(별도 설계).
 *     ★ 대행 이미지는 Codex 1R high 3건으로 뺐다: 같은 파일을 MySQL 큐(file_name1~3 · 적재 직후 캠페인은 completed) ·
 *     여정 단계 · 자동마케팅 · 문자 보관함 · 재예약되는 expired 접수가 쓸 수 있어, 파일 참조를 한곳에서 관리하기 전에는
 *     「안 쓰는 파일」을 안전하게 판정할 수 없다(잘못 지우면 예약 MMS 발송 실패).
 * 실측 = 2026-09-28 information_schema(기준 칸 14개 · 이 표들을 가리키는 외래키 0). 기간 인덱스는 sns_oauth_states.expires_at 뿐이라
 *   하루 1번 · 5,000행씩 끊어 지운다(잠금·WAL 폭주 방지). 실패는 표·파일마다 격리한다(정리 실패가 서비스를 막지 않는다).
 */
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../config/database';
import { LOG_RETENTION_DAYS } from '../config/defaults';
import { FULL_ANALYSIS_PDF_DIR } from './full-analysis-job';

export interface RetentionRule {
  table: string;
  /** 행 식별 칸(PK) */
  key: string;
  /** 기한을 재는 시각 칸 */
  column: string;
  days: number;
  /** 추가 조건(고정 문자열 · 사용자 값 없음) */
  extraWhere?: string;
}

export const RETENTION_RULES: RetentionRule[] = [
  { table: 'sns_oauth_states', key: 'state_nonce', column: 'expires_at', days: 1 },
  { table: 'one_step_sessions', key: 'id', column: 'updated_at', days: 90, extraWhere: "status IN ('draft', 'generating')" },
  { table: 'event_campaign_drafts', key: 'id', column: 'updated_at', days: 90 },
  { table: 'email_events', key: 'id', column: 'created_at', days: LOG_RETENTION_DAYS },
  { table: 'kakao_webhook_events', key: 'event_id', column: 'received_at', days: LOG_RETENTION_DAYS },
  { table: 'best_copy_seed_usage', key: 'id', column: 'used_at', days: LOG_RETENTION_DAYS },
];

export const RETENTION_BATCH = 5000;
/** 한 번 돌 때 표마다 최대 반복(= 최대 100만 행) — 밀린 양이 커도 하루에 끝까지 잡아먹지 않게 */
const MAX_BATCHES = 200;
const PDF_DAYS = 90;

/** 표마다 지운 행 수(-1 = 그 표 실패). */
export async function sweepRetentionRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of RETENTION_RULES) {
    const cond = `${r.column} < NOW() - make_interval(days => $1::int)${r.extraWhere ? ` AND ${r.extraWhere}` : ''}`;
    // 바깥 DELETE 에도 같은 조건 — 후보를 고른 뒤 그 행이 방금 저장(updated_at = NOW())됐으면 잠금을 기다린 뒤 다시 판정해 남긴다(Codex 1R)
    const sql = `DELETE FROM ${r.table} WHERE ${r.key} IN (SELECT ${r.key} FROM ${r.table} WHERE ${cond} LIMIT ${RETENTION_BATCH}) AND ${cond}`;
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const res = await query(sql, [r.days]);
        const n = Number(res.rowCount || 0);
        total += n;
        if (n < RETENTION_BATCH) break;
      }
      out[r.table] = total;
    } catch (err: any) {
      console.warn(`[retention] ${r.table} 정리 실패(다음 표 계속):`, err?.message || err);
      out[r.table] = -1;
    }
  }
  return out;
}

function isInsideDir(dir: string, p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false;
  const root = path.resolve(dir) + path.sep;
  const resolved = path.resolve(p);
  return resolved.startsWith(root) && resolved.length > root.length;
}

/** 90일 지난 풀분석 PDF 파일을 지우고 경로를 비운다(다운로드는 「보관 기간이 지났다」로 답한다). 보관 폴더 밖 경로는 건드리지 않는다. */
export async function sweepExpiredAnalysisPdfs(opts: { pdfDir?: string } = {}): Promise<number> {
  const pdfDir = opts.pdfDir || FULL_ANALYSIS_PDF_DIR;
  const r = await query(
    `SELECT id, pdf_path FROM full_analysis_jobs
      WHERE status = 'done' AND pdf_path IS NOT NULL AND updated_at < NOW() - INTERVAL '${PDF_DAYS} days'
      LIMIT 1000`,
  );
  const cleared: string[] = [];
  for (const row of r.rows as any[]) {
    if (!isInsideDir(pdfDir, row.pdf_path)) continue;
    try {
      if (fs.existsSync(row.pdf_path)) fs.unlinkSync(row.pdf_path);
      cleared.push(String(row.id));
    } catch (err: any) {
      console.warn('[retention] 풀분석 PDF 삭제 실패(다음 파일 계속):', err?.message || err);
    }
  }
  if (cleared.length > 0) {
    await query(`UPDATE full_analysis_jobs SET pdf_path = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [cleared]);
  }
  return cleared.length;
}

export async function runRetentionSweep(): Promise<void> {
  try {
    const rows = await sweepRetentionRows();
    const deleted = Object.entries(rows).filter(([, n]) => n !== 0);
    if (deleted.length > 0) console.log('[retention] 행 정리:', deleted.map(([t, n]) => `${t}=${n}`).join(' · '));
  } catch (err: any) {
    console.warn('[retention] 행 정리 오류:', err?.message || err);
  }
  try {
    const n = await sweepExpiredAnalysisPdfs();
    if (n > 0) console.log(`[retention] 풀분석 PDF ${n}개 삭제(${PDF_DAYS}일)`);
  } catch (err: any) {
    console.warn('[retention] 풀분석 PDF 정리 오류:', err?.message || err);
  }
}

/** 하루 1번(기동 10분 뒤 첫 회) — app.ts 기동 시 등록 */
export function startRetentionSweeper(): void {
  if (process.env.VITEST) return;
  setTimeout(() => { void runRetentionSweep(); }, 10 * 60 * 1000);
  setInterval(() => { void runRetentionSweep(); }, 24 * 60 * 60 * 1000);
}
