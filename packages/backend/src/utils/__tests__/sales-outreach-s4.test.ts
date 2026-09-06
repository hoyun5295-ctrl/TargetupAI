/**
 * sales-outreach-s4.test.ts — S4 삭제·열람 (2026-09-06 · 설계서 §6)
 *  순수: UA 3분류 · 산출물 페이지 열람 합산(60초 · 상한 50) · 전달 뒤 사람 열람 수 · 열람 요약 문장.
 *  소스 계약: dm_views 조인은 company_id 동반 · 삭제는 purged_at 선점 + deleted_at 스탬프 + 진행 중 거절 · 목록은 deleted_at 제외 ·
 *            sweeper 와 사람 삭제가 같은 파기 함수 · 아웃리치 DM track 은 ip·UA null · 공개 페이지가 열람을 기록.
 * DB·네트워크 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  classifyViewerUa, mergePreviewView, previewHumanViewsSince, summarizeOutreachViews, OUTREACH_PREVIEW_VIEWS_CAP,
} from '../sales-outreach-review';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('classifyViewerUa', () => {
  it('봇·모바일·데스크톱 3분류 · 빈 UA = bot(보수)', () => {
    expect(classifyViewerUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('mobile');
    expect(classifyViewerUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe('desktop');
    expect(classifyViewerUa('facebookexternalhit/1.1')).toBe('bot');
    expect(classifyViewerUa('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('bot');
    expect(classifyViewerUa('')).toBe('bot');
    expect(classifyViewerUa(null)).toBe('bot');
  });
});

describe('mergePreviewView', () => {
  const t0 = new Date('2026-09-06T01:00:00Z').getTime();
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  it('첫 열람 → 항목 1 · 60초 안 같은 분류는 n 만 증가 · 분류가 다르면 새 항목 · 총계는 항상 +1', () => {
    let v = mergePreviewView(null, { at: at(0), ua: 'desktop' });
    v = mergePreviewView(v, { at: at(30_000), ua: 'desktop' });
    v = mergePreviewView(v, { at: at(45_000), ua: 'mobile' });
    v = mergePreviewView(v, { at: at(200_000), ua: 'mobile' });
    expect(v.total).toBe(4); expect(v.human).toBe(4); expect(v.bot).toBe(0);
    expect(v.entries.length).toBe(3);
    expect(v.entries[0]).toMatchObject({ ua: 'desktop', n: 2 });
    expect(v.entries[1]).toMatchObject({ ua: 'mobile', n: 1 });
    expect(v.first_at).toBe(at(0)); expect(v.last_at).toBe(at(200_000));
  });
  it('봇은 bot 계수로 · 항목 상한 50(오래된 것부터 버림) · 총계는 잘리지 않는다', () => {
    let v = mergePreviewView(null, { at: at(0), ua: 'bot' });
    expect(v.bot).toBe(1); expect(v.human).toBe(0);
    for (let i = 1; i <= 70; i++) v = mergePreviewView(v, { at: at(i * 120_000), ua: i % 2 ? 'mobile' : 'desktop' });
    expect(v.entries.length).toBe(OUTREACH_PREVIEW_VIEWS_CAP);
    expect(v.total).toBe(71);
    expect(v.entries[0].at).toBe(at(21 * 120_000));
  });
  it('previewHumanViewsSince — 기준 시각 이후 사람 항목 n 합산 · 봇 제외 · 기준 없으면 전부', () => {
    let v = mergePreviewView(null, { at: at(0), ua: 'desktop' });
    v = mergePreviewView(v, { at: at(10_000), ua: 'desktop' });
    v = mergePreviewView(v, { at: at(500_000), ua: 'bot' });
    v = mergePreviewView(v, { at: at(900_000), ua: 'mobile' });
    expect(previewHumanViewsSince(v, at(400_000))).toBe(1);
    expect(previewHumanViewsSince(v, null)).toBe(3);
    expect(previewHumanViewsSince(null, null)).toBe(0);
  });
});

describe('summarizeOutreachViews (문장은 서버 완성)', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  it('열람 있음 → 기기·회수·전달 뒤 건수 문장 · unread3d false', () => {
    const r = summarizeOutreachViews({
      dm: { viewers: 2, opens: 5, firstAt: '2026-09-07T01:00:00Z', lastAt: '2026-09-08T02:00:00Z', seconds: 140, scroll: 90, afterForward: 3 },
      preview: mergePreviewView(null, { at: '2026-09-07T01:00:00Z', ua: 'desktop' }),
      forwardedAt: '2026-09-06T00:00:00Z', stage: 'sent', now,
    });
    expect(r.unread3d).toBe(false); expect(r.recontact).toBe(false);
    expect(r.sentences.some((t) => t.includes('2대 기기에서 5회'))).toBe(true);
    expect(r.sentences.some((t) => t.includes('전달 표시 뒤 열람 3건'))).toBe(true);
    expect(r.sentences.some((t) => t.includes('산출물 페이지를 사람이 1회'))).toBe(true);
    expect(r.preview?.afterForward).toBe(1);
    for (const t of r.sentences) expect(t).not.toContain('—');
  });
  it('전달 3일 경과 + 전달 뒤 신호 0 → unread3d · 재접촉 문장 · 전달 전 열람은 내부 확인일 수 있다', () => {
    const r = summarizeOutreachViews({
      dm: { viewers: 1, opens: 1, firstAt: '2026-09-05T01:00:00Z', lastAt: '2026-09-05T01:00:00Z', seconds: 0, scroll: null, afterForward: 0 },
      preview: mergePreviewView(null, { at: '2026-09-05T01:00:00Z', ua: 'desktop' }),
      forwardedAt: '2026-09-06T00:00:00Z', stage: 'sent', now,
    });
    expect(r.unread3d).toBe(true);
    expect(r.sentences.some((t) => t.includes('재접촉 후보'))).toBe(true);
    expect(r.sentences.some((t) => t.includes('내부 확인일 수 있습니다'))).toBe(true);
  });
  it('집계가 없으면(null) 그 축 문장을 내지 않는다 · 전달 3일이 안 지났으면 unread3d 아님', () => {
    const r = summarizeOutreachViews({ dm: null, preview: null, forwardedAt: '2026-09-09T00:00:00Z', stage: 'sent', now });
    expect(r.dm).toBeNull(); expect(r.preview).toBeNull(); expect(r.unread3d).toBe(false);
    expect(r.sentences.length).toBe(0);
    const r2 = summarizeOutreachViews({ dm: { viewers: 0, opens: 0, firstAt: null, lastAt: null, seconds: 0, scroll: null, afterForward: 0 }, preview: null, forwardedAt: null, stage: 'sent', now });
    expect(r2.sentences.some((t) => t.includes('열람 기록이 아직 없습니다'))).toBe(true);
    expect(r2.sentences.some((t) => t.includes('전달 표시가 없어'))).toBe(true);
  });
});

describe('소스 계약 — 삭제·열람 배선', () => {
  const jobs = code('utils/sales-outreach-jobs.ts');
  const sweeper = code('utils/sales-outreach-sweeper.ts');
  const purge = code('utils/sales-outreach-purge.ts');
  const dmRoute = code('routes/dm.ts');
  const pub = code('routes/outreach-public.ts');
  const routes = code('routes/sales-outreach.ts');

  it('dm_views 조인은 언제나 company_id 동반(조인 수 = company_id 조건 수 · 1곳 공용 조각)', () => {
    expect(count(jobs, 'JOIN dm_views v')).toBe(1);
    expect(count(jobs, 'v.company_id = ')).toBe(1);
    expect(jobs).toContain("(a.payload->>'dmId')::uuid");
  });
  it('사람 삭제 = purged_at 선점 + deleted_at 스탬프 + 진행 중·발송 중 거절 + 파기 실패 롤백 · 키 삭제 연산 없이 null 덮기', () => {
    const body = jobs.slice(jobs.indexOf('export async function deleteOutreachJob('), jobs.indexOf('export async function deleteOutreachJobsBulk('));
    expect(body).toContain('SET purged_at = NOW(), stage_results = COALESCE(stage_results, \'{}\'::jsonb) || $2::jsonb');
    expect(body).toContain('WHERE id = $1 AND purged_at IS NULL AND stage <> ALL($3) AND mail_result IS DISTINCT FROM \'sending\'');
    expect(body).toContain('purgeOutreachJobArtifacts(jobId, ctx.companyId)');
    expect(body).toContain('SET purged_at = NULL');
    expect(body).toContain('deleted_at: null');
    expect(body).not.toContain("- 'deleted_at'");
    expect(body.indexOf('await assertOperator(')).toBeLessThan(body.indexOf('await query('));
  });
  it('다중 삭제는 sent 를 건너뛰고 건별로 같은 함수를 부른다 · 상한 100', () => {
    const body = jobs.slice(jobs.indexOf('export async function deleteOutreachJobsBulk('), jobs.indexOf('export async function recordOutreachPreviewView('));
    expect(body).toContain("=== 'sent'");
    expect(body).toContain('await deleteOutreachJob(id, operatorSuperAdminId)');
    expect(body).toContain('list.length > 100');
  });
  it('목록·최근 건은 사람 삭제 건을 제외한다 · 중복 판정 LIMIT 300 없음 · view 필터 2종', () => {
    expect(count(jobs, "(stage_results->>'deleted_at') IS NULL")).toBeGreaterThanOrEqual(1);
    expect(count(jobs, "(j.stage_results->>'deleted_at') IS NULL")).toBe(1);
    expect(jobs).not.toContain('LIMIT 300');
    expect(jobs).toContain("view === 'viewed'");
    expect(jobs).toContain("view === 'unread3d'");
  });
  it('sweeper 와 사람 삭제가 같은 파기 함수 · sweeper 에 파일 삭제 본문이 남아 있지 않다 · 파기 모듈은 발송 능력 0', () => {
    expect(sweeper).toContain('purgeOutreachJobArtifacts(');
    expect(sweeper).not.toContain('unlinkSync');
    expect(sweeper).not.toContain('stopDm(');
    expect(purge).toContain('stopDm(');
    expect(purge).toContain('bannerUrl');
    expect(purge).not.toMatch(/sendOutreachProposalMail|sendOutreachTestMail|sendMail|runOutreachJob|runProduction/);
  });
  it('아웃리치 DM 열람 track 은 ip·user_agent 를 null 로 · 공개 산출물 페이지는 열람을 기록(UA 만 · 응답 비차단)', () => {
    expect(dmRoute).toContain('isOutreachDm ? null : (req.ip');
    expect(dmRoute).toContain("isOutreachDm ? null : (req.headers['user-agent']");
    expect(pub).toContain("recordOutreachPreviewView(req.params.code, req.headers['user-agent'] || null).catch(() => {})");
    const rec = jobs.slice(jobs.indexOf('export async function recordOutreachPreviewView('), jobs.indexOf('const DM_VIEW_AGG_SQL'));
    expect(rec).not.toContain('req.ip'); expect(rec).not.toContain('user_agent'); expect(rec).toContain('classifyViewerUa(userAgent)');
    expect(rec).toContain("COALESCE((stage_results->'views_preview'->>'total')::int, 0) = $3");
  });
  it('라우트 2개(단건 delete · delete-bulk) + 감사 로그 · 라우트 응답에 err 원문 없음', () => {
    expect(routes).toContain("router.post('/jobs/:id/delete'");
    expect(routes).toContain("router.post('/jobs/delete-bulk'");
    expect(routes).toContain("audit(req, 'delete', req.params.id, r)");
    expect(routes).toContain("audit(req, 'delete_bulk', null,");
  });
});
