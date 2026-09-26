/**
 * 스팸 검사·맞춤법 사용 현황 — 슈퍼관리자 ceo 전용 (★2026-09-26 Harold 지시)
 *
 * 요구: 어제(0925) 배포한 스팸 검사(무료 체험 3회)·맞춤법(무료 월 5회) 사용 현황을 슈퍼관리자 "발송 관리"에서 **ceo 계정만** 본다.
 *   다른 계정은 메뉴 자체가 보이지 않고, 주소로 직접 불러도 서버가 403.
 * 원천(새 칸 0): spam_filter_tests(source) · spell_check_uses(직접발송) · agency_send_events 'spell_checked'(대행).
 * 무료 한도 표시는 고객 화면(/api/send-checks/status)과 같은 함수(readSpamTrialStatus · loadPlanContext+isActivePaidPlan · readSpellUsage).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parsePrecheckUsageQuery, precheckPeriodStartSql, spamSourceBucket, summarizePrecheckGroups,
  buildPrecheckCompanyRows, precheckSubLabel, precheckResultLabel,
} from '../precheck-usage';
import { PERMISSION_MATRIX, canRead } from '../admin-role';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const front = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');

describe('조회 조건 정규화', () => {
  it('모르는 값은 기본값(오늘 · 전체 · 1쪽) · 회사 id는 uuid만', () => {
    expect(parsePrecheckUsageQuery({})).toEqual({ period: 'today', kind: 'all', companyId: null, page: 1 });
    expect(parsePrecheckUsageQuery({ period: '7d', kind: 'spell', companyId: 'x; DROP', page: '-3' }))
      .toEqual({ period: '7d', kind: 'spell', companyId: null, page: 1 });
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parsePrecheckUsageQuery({ period: 'month', kind: 'spam', companyId: id, page: '2' }))
      .toEqual({ period: 'month', kind: 'spam', companyId: id, page: 2 });
  });

  it('기간 시작 = 한국 시각 자정 기준(오늘 · 최근 7일 = 오늘 포함 7일 · 이번 달 1일)', () => {
    expect(precheckPeriodStartSql('today')).toBe(`(date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul'`);
    expect(precheckPeriodStartSql('7d')).toBe(`(date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '6 days') AT TIME ZONE 'Asia/Seoul'`);
    expect(precheckPeriodStartSql('month')).toBe(`(date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul'`);
  });
});

describe('구분', () => {
  it('스팸 검사: 무료 체험 · 자동(유료·무료 자동 둘 다) · 그 밖 = 유료(표시값 없는 옛 행 포함)', () => {
    expect(spamSourceBucket('trial')).toBe('trial');
    expect(spamSourceBucket('auto_ai')).toBe('auto');
    expect(spamSourceBucket('auto_ai_free')).toBe('auto');
    expect(spamSourceBucket('manual')).toBe('paid');
    expect(spamSourceBucket(null)).toBe('paid');
  });

  it('라벨', () => {
    expect(precheckSubLabel('spam', 'trial')).toBe('무료 체험');
    expect(precheckSubLabel('spam', 'manual')).toBe('유료');
    expect(precheckSubLabel('spam', 'auto_ai_free')).toBe('자동');
    expect(precheckSubLabel('spell', 'direct')).toBe('직접발송');
    expect(precheckSubLabel('spell', 'agency')).toBe('대행');
    expect(precheckResultLabel({ kind: 'spam', status: 'active', issues: null, blocked: false })).toBe('진행 중');
    expect(precheckResultLabel({ kind: 'spam', status: 'completed', issues: null, blocked: true })).toBe('차단 있음');
    expect(precheckResultLabel({ kind: 'spam', status: 'completed', issues: null, blocked: false })).toBe('완료');
    expect(precheckResultLabel({ kind: 'spell', status: 'done', issues: 2, blocked: null })).toBe('고칠 곳 2');
    expect(precheckResultLabel({ kind: 'spell', status: 'done', issues: 0, blocked: null })).toBe('고칠 곳 없음');
    expect(precheckResultLabel({ kind: 'spell', status: 'failed', issues: 0, blocked: null })).toBe('실패');
    expect(precheckResultLabel({ kind: 'spell', status: 'reserved', issues: 0, blocked: null })).toBe('진행 중');
  });
});

describe('집계', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const groups = [
    { company_id: A, kind: 'spam', sub: 'manual', status: 'completed', cnt: 4, last_at: '2026-09-26T05:00:00Z' },
    { company_id: A, kind: 'spam', sub: 'trial', status: 'completed', cnt: 2, last_at: '2026-09-26T06:00:00Z' },
    { company_id: B, kind: 'spam', sub: 'auto_ai_free', status: 'completed', cnt: 1, last_at: '2026-09-26T01:00:00Z' },
    { company_id: A, kind: 'spell', sub: 'direct', status: 'done', cnt: 3, last_at: '2026-09-26T07:00:00Z' },
    { company_id: A, kind: 'spell', sub: 'direct', status: 'failed', cnt: 1, last_at: '2026-09-26T02:00:00Z' },
    { company_id: B, kind: 'spell', sub: 'agency', status: 'done', cnt: 2, last_at: '2026-09-26T03:00:00Z' },
  ];

  it('요약 = 종류별 합 · 구분별 합 · 맞춤법 실패', () => {
    expect(summarizePrecheckGroups(groups)).toEqual({
      total: 13,
      spam: { total: 7, paid: 4, trial: 2, auto: 1 },
      spell: { total: 6, direct: 4, agency: 2, failed: 1 },
    });
  });

  it('업체별 = 회사마다 한 줄 · 마지막 사용 = 가장 늦은 시각 · 최근 사용 순', () => {
    const rows = buildPrecheckCompanyRows(groups);
    expect(rows.map((r) => r.companyId)).toEqual([A, B]);
    expect(rows[0]).toMatchObject({ spamPaid: 4, spamTrial: 2, spamAuto: 0, spellDirect: 4, spellAgency: 0, lastAt: '2026-09-26T07:00:00Z' });
    expect(rows[1]).toMatchObject({ spamPaid: 0, spamTrial: 0, spamAuto: 1, spellDirect: 0, spellAgency: 2, lastAt: '2026-09-26T03:00:00Z' });
  });
});

describe('ceo 전용 게이트', () => {
  it('권한표: 최고 등급만 읽기 · 그 밖 없음', () => {
    const p = PERMISSION_MATRIX.find((x) => x.key === 'precheckUsage');
    expect(p).toBeTruthy();
    expect(canRead('super', 'precheckUsage')).toBe(true);
    expect(canRead('lead', 'precheckUsage')).toBe(false);
    expect(canRead('support', 'precheckUsage')).toBe(false);
  });

  it('판정 CT = 자기 ENV 축(기본 ceo) + 권한표 키', () => {
    expect(src('utils/audit-log.ts')).toContain(
      "return isSuperAdminAllowed(superAdminId, 'PRECHECK_USAGE_VIEWER_IDS', 'ceo', 'precheck-usage', 'precheckUsage');",
    );
  });

  it('서버: 접근 확인 + 조회는 판정 CT를 통과해야만(아니면 403)', () => {
    const a = src('routes/admin.ts');
    expect(a).toContain("router.get('/precheck-usage/access', authenticate, requireSuperAdmin,");
    const body = a.slice(a.indexOf("router.get('/precheck-usage', authenticate, requireSuperAdmin,"));
    expect(body.indexOf('isPrecheckUsageViewer(req.user?.userId)')).toBeGreaterThan(-1);
    expect(body.indexOf('isPrecheckUsageViewer(req.user?.userId)')).toBeLessThan(body.indexOf('loadPrecheckUsage('));
    expect(body.slice(0, body.indexOf('loadPrecheckUsage('))).toContain('res.status(403)');
  });

  it('화면: 허용 계정에만 메뉴 항목 · 탭도 허용일 때만 그린다', () => {
    const d = front('pages/AdminDashboard.tsx');
    expect(d).toContain("...(precheckUsageAllowed ? [{ key: 'precheckUsage', label: '점검 사용 현황' }] : [])");
    expect(d).toContain("{activeTab === 'precheckUsage' && precheckUsageAllowed && (");
    expect(d).toContain("fetch('/api/admin/precheck-usage/access'");
    const tab = front('components/admin/PrecheckUsageTab.tsx');
    expect(tab).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(tab).not.toMatch(/Opus|Sonnet|Haiku|Claude|GPT|Anthropic/);
  });
});
