/**
 * 보관 기한 정리 CT (★2026-09-28 한줄로 V2 차수 4 · Harold 승인 수정본 · 칸·외래키 실측 = 2026-09-28 information_schema 14칸 · FK 0)
 *
 * 못 박는 것
 *   1. 로그성 기록(이메일 이벤트 · 카카오 웹훅 · 문안 시드 사용)은 LOG_RETENTION_DAYS(1년 이상 · 전송자격인증 4.1·4.2) 뒤에만 지운다.
 *   2. 임시·작성 중: SNS 연결 임시 행 = 만료 1일 뒤 · 인터뷰 세션 = 작성 중(draft·generating)만 90일 · 이벤트 초안 = 90일.
 *   3. 행 삭제는 5,000행씩 끊고, 한 표가 실패해도 다른 표는 계속한다.
 *   4. 풀분석 PDF = 90일 뒤 파일을 지우고 경로를 비운다. 보관 폴더 밖 경로는 건드리지 않는다.
 *   5. 취소·만료 대행 접수 이미지는 지우지 않는다(Codex 1R high 3 · 큐·여정·자동마케팅·보관함·재예약 접수가 같은 파일을 쓸 수 있다).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const calls: Array<{ sql: string; params: any[] }> = [];
let handler: (sql: string, params: any[]) => any = () => ({ rows: [], rowCount: 0 });
vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => { calls.push({ sql, params }); return handler(sql, params); }),
}));

import { LOG_RETENTION_DAYS } from '../../config/defaults';
import {
  RETENTION_RULES, RETENTION_BATCH, sweepRetentionRows, sweepExpiredAnalysisPdfs,
} from '../retention-sweeper';

let tmp = '';
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-')); });
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무시 */ } });
beforeEach(() => { calls.length = 0; handler = () => ({ rows: [], rowCount: 0 }); });

const touch = (p: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };

describe('보관 기한 표', () => {
  const rule = (t: string) => RETENTION_RULES.find((r) => r.table === t)!;
  it('로그성 기록은 1년 이상(LOG_RETENTION_DAYS) 뒤에만', () => {
    expect(LOG_RETENTION_DAYS).toBeGreaterThanOrEqual(365);
    for (const t of ['email_events', 'kakao_webhook_events', 'best_copy_seed_usage']) expect(rule(t).days).toBe(LOG_RETENTION_DAYS);
    expect(rule('email_events').column).toBe('created_at');
    expect(rule('kakao_webhook_events').column).toBe('received_at');
    expect(rule('best_copy_seed_usage').column).toBe('used_at');
  });
  it('임시·작성 중은 짧게 — 인터뷰 세션은 작성 중 상태만', () => {
    expect(rule('sns_oauth_states')).toMatchObject({ column: 'expires_at', days: 1, key: 'state_nonce' });
    expect(rule('one_step_sessions')).toMatchObject({ column: 'updated_at', days: 90 });
    expect(rule('one_step_sessions').extraWhere).toBe("status IN ('draft', 'generating')");
    expect(rule('event_campaign_drafts')).toMatchObject({ column: 'updated_at', days: 90 });
  });
  it('AI 운영자 제안 기록은 지우지 않는다(학습 현황 집계가 쓴다)', () => {
    expect(RETENTION_RULES.map((r) => r.table)).not.toContain('operator_proposals');
  });
});

describe('행 정리', () => {
  it('5,000행씩 끊어 지우고 다 지울 때까지 반복한다', async () => {
    let n = 0;
    handler = (sql) => (sql.startsWith('DELETE FROM email_events') ? { rowCount: n++ === 0 ? RETENTION_BATCH : 12 } : { rowCount: 0 });
    const out = await sweepRetentionRows();
    expect(out.email_events).toBe(RETENTION_BATCH + 12);
    const del = calls.filter((c) => c.sql.startsWith('DELETE FROM email_events'));
    expect(del).toHaveLength(2);
    const cond = 'created_at < NOW() - make_interval(days => $1::int)';
    // 바깥 DELETE 에도 같은 조건 — 후보 선택 뒤 방금 저장된 행은 다시 판정해 남긴다(Codex 1R medium)
    expect(del[0].sql).toBe(`DELETE FROM email_events WHERE id IN (SELECT id FROM email_events WHERE ${cond} LIMIT ${RETENTION_BATCH}) AND ${cond}`);
    expect(del[0].params).toEqual([LOG_RETENTION_DAYS]);
  });
  it('인터뷰 세션은 작성 중 조건을 붙인다', async () => {
    await sweepRetentionRows();
    const s = calls.find((c) => c.sql.startsWith('DELETE FROM one_step_sessions'))!;
    expect(s.sql).toContain("updated_at < NOW() - make_interval(days => $1::int) AND status IN ('draft', 'generating')");
    expect(s.params).toEqual([90]);
  });
  it('한 표가 실패해도 다른 표는 계속한다', async () => {
    handler = (sql) => { if (sql.startsWith('DELETE FROM sns_oauth_states')) throw new Error('boom'); return { rowCount: 0 }; };
    const out = await sweepRetentionRows();
    expect(out.sns_oauth_states).toBe(-1);
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM best_copy_seed_usage'))).toBe(true);
  });
});

describe('풀분석 PDF', () => {
  it('90일 지난 PDF 파일을 지우고 경로를 비운다 · 보관 폴더 밖은 건드리지 않는다', async () => {
    const pdfDir = path.join(tmp, 'pdfs');
    const inside = touch(path.join(pdfDir, 'job-1.pdf'));
    const outside = touch(path.join(tmp, 'elsewhere', 'job-2.pdf'));
    handler = (sql) => (sql.includes('FROM full_analysis_jobs')
      ? { rows: [{ id: 'job-1', pdf_path: inside }, { id: 'job-2', pdf_path: outside }] }
      : { rows: [], rowCount: 1 });
    const removed = await sweepExpiredAnalysisPdfs({ pdfDir });
    expect(removed).toBe(1);
    expect(fs.existsSync(inside)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    const sel = calls.find((c) => c.sql.includes('FROM full_analysis_jobs'))!;
    expect(sel.sql).toContain("status = 'done' AND pdf_path IS NOT NULL AND updated_at < NOW() - INTERVAL '90 days'");
    const upd = calls.find((c) => c.sql.startsWith('UPDATE full_analysis_jobs'))!;
    expect(upd.sql).toContain('SET pdf_path = NULL');
    expect(upd.params).toEqual([['job-1']]);
  });
});

describe('취소·만료 대행 접수 이미지 — 지우지 않는다(Codex 1R high 3)', () => {
  it('정리 작업이 대행 접수 이미지를 판정·삭제하지 않는다(파일 참조를 한곳에서 관리하기 전에는 안전하게 판정할 수 없다)', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'retention-sweeper.ts'), 'utf8');
    expect(src).not.toMatch(/FROM agency_send_requests/);
    expect(src).not.toMatch(/unlinkSync\([^)]*mms/i);
  });
});

describe('풀분석 PDF 다운로드', () => {
  it('파일을 먼저 열고(열기 실패 = 410 PDF_EXPIRED) 열린 파일로 보낸다 · 읽기 오류를 처리한다(Codex 1R medium)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
    const i = src.indexOf("router.get('/operator/performance/full-analysis/download/:id'");
    const route = src.slice(i, src.indexOf('router.', i + 20));
    expect(route).toContain("fd = fsmod.openSync(job.pdf_path, 'r')");
    expect(route).toContain("res.status(410).json({ success: false, code: 'PDF_EXPIRED'");
    expect(route).toContain("fsmod.createReadStream('', { fd })");
    expect(route).toContain("require('stream').pipeline(stream, res,");
    expect(route).not.toContain('existsSync(job.pdf_path)');
  });
});
