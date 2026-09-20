/**
 * SNS 게시 계약 테스트 (2026-09-20 S1)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-5 · §3-11
 *
 * 이 파일이 잠그는 것 = "값이 두 곳에 적히면 실패한다".
 *   프론트에 테스트 파일이 0이라, 화면 사전·상수 정합은 **백엔드가 프론트 소스를 읽어** 단정한다
 *   (`plan-feature-modal-contract.test.ts` 와 같은 방식).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  SNS_PLATFORMS, SNS_ACCOUNT_STATUSES, SNS_TARGET_STATUSES, SNS_POST_STATUSES,
  SNS_TARGET_TERMINAL, derivePostStatus, snsPublishEnabled, isSnsPlatform,
  type SnsTargetStatus,
} from '../sns-constants';
import { signSnsState, verifySnsState } from '../sns-auth-state';
import { listSnsAdapters, getSnsAdapter } from '../sns';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const SNS_PAGE = readFileSync(resolve(FRONT, 'pages/SnsPage.tsx'), 'utf8');
const PLAN_GUARD = readFileSync(resolve(__dirname, '../plan-guard.ts'), 'utf8');
const AI_ROUTE = readFileSync(resolve(__dirname, '../../routes/ai.ts'), 'utf8');
const SECRET = 'test-secret-for-sns-state';

describe('SNS 상수 컨트롤타워', () => {
  it('상태 목록은 설계서 개수와 같다 — 늘리면 여기서 멈춘다(불변 7)', () => {
    expect(SNS_TARGET_STATUSES).toHaveLength(7);
    expect(SNS_POST_STATUSES).toHaveLength(7);
    expect(SNS_ACCOUNT_STATUSES).toHaveLength(7);
    // 종결 상태는 대조 워커가 조회·UPDATE 양쪽에서 제외하는 축이다(BUGS 818행 회귀 선례).
    expect([...SNS_TARGET_TERMINAL].sort()).toEqual(['cancelled', 'failed', 'published']);
  });

  it('isSnsPlatform 은 목록 밖 값을 받지 않는다', () => {
    for (const p of SNS_PLATFORMS) expect(isSnsPlatform(p)).toBe(true);
    expect(isSnsPlatform('tiktok')).toBe(false);
    expect(isSnsPlatform('')).toBe(false);
    expect(isSnsPlatform(null)).toBe(false);
  });

  it('derivePostStatus — 자식 집계 파생표(§3-5)를 그대로 재현한다', () => {
    const t = (...s: SnsTargetStatus[]) => derivePostStatus(s);
    expect(t()).toBe('draft');
    expect(t('draft', 'draft')).toBe('draft');
    expect(t('scheduled', 'draft')).toBe('scheduled');
    expect(t('claimed', 'scheduled')).toBe('publishing');
    expect(t('submitted', 'published')).toBe('publishing');
    expect(t('published', 'published')).toBe('published');
    expect(t('published', 'failed')).toBe('partial_failed');
    expect(t('failed', 'failed')).toBe('failed');
    expect(t('cancelled', 'cancelled')).toBe('cancelled');
  });

  it('snsPublishEnabled — 비면 미노출, `*` 는 전 회사(ai-auto-build 미러)', () => {
    expect(snsPublishEnabled('c1', '')).toBe(false);
    expect(snsPublishEnabled('c1', undefined)).toBe(false);
    expect(snsPublishEnabled(null, '*')).toBe(false);          // 회사가 없으면 열지 않는다
    expect(snsPublishEnabled('c1', '*')).toBe(true);
    expect(snsPublishEnabled('c1', 'c2, c1 ,c3')).toBe(true);
    expect(snsPublishEnabled('c9', 'c2,c3')).toBe(false);
  });
});

describe('OAuth state 서명', () => {
  const base = { companyId: '11111111-2222-3333-4444-555555555555', platform: 'instagram' as const, nonce: 'n-1', ts: Date.now() };

  it('서명한 값은 그대로 되읽힌다', () => {
    const state = signSnsState(base, SECRET);
    expect(verifySnsState(state, { secret: SECRET })).toEqual({
      companyId: base.companyId, platform: 'instagram', nonce: 'n-1',
    });
  });

  it('다른 열쇠·변조·형식 위반은 전부 null', () => {
    const state = signSnsState(base, SECRET);
    expect(verifySnsState(state, { secret: 'other' })).toBeNull();
    expect(verifySnsState(`${state}x`, { secret: SECRET })).toBeNull();
    expect(verifySnsState('no-dot', { secret: SECRET })).toBeNull();
    expect(verifySnsState(null, { secret: SECRET })).toBeNull();
  });

  it('만료와 미래 시각을 둘 다 막는다(시계 왜곡·위조 방어)', () => {
    const old = signSnsState({ ...base, ts: Date.now() - 31 * 60 * 1000 }, SECRET);
    expect(verifySnsState(old, { secret: SECRET })).toBeNull();
    const future = signSnsState({ ...base, ts: Date.now() + 31 * 60 * 1000 }, SECRET);
    expect(verifySnsState(future, { secret: SECRET })).toBeNull();
  });

  it('회사 id 가 uuid 가 아니면 받지 않는다', () => {
    const bad = signSnsState({ ...base, companyId: 'not-a-uuid' }, SECRET);
    expect(verifySnsState(bad, { secret: SECRET })).toBeNull();
  });
});

describe('어댑터 계약', () => {
  it('1차-A 채널이 등록돼 있고 capabilities 를 직접 선언한다(추론 0)', () => {
    const platforms = listSnsAdapters().map((a) => a.platform);
    expect(platforms).toContain('instagram');
    expect(platforms).toContain('threads');
    for (const a of listSnsAdapters()) {
      expect(SNS_PLATFORMS).toContain(a.platform);
      expect(a.capabilities.maxCaptionChars).toBeGreaterThan(0);
      expect(a.capabilities.dailyLimit).toBeGreaterThan(0);
      expect(['immediate', 'deferred', 'none']).toContain(a.capabilities.verify);
      expect(['pull_url', 'upload']).toContain(a.capabilities.mediaTransfer);
    }
  });

  it('인스타 상수는 S0 실측값(§1-4)이다 — 바꾸려면 새 raw 가 있어야 한다', () => {
    const ig = getSnsAdapter('instagram')!;
    expect(ig.capabilities.dailyLimit).toBe(100);        // content_publishing_limit 실측
    expect(ig.capabilities.maxCaptionChars).toBe(2200);
    expect(ig.capabilities.maxTags).toBe(30);
    expect(ig.capabilities.publishCarousel).toBe(true);  // 캐러셀 컨테이너 실측
    expect(ig.capabilities.publishVideo).toBe(false);    // 릴스는 1차-B
    expect(ig.scopes).toContain('instagram_business_content_publish');
  });

  it('authorize URL 은 state 와 redirect_uri 를 싣는다', () => {
    const ig = getSnsAdapter('instagram')!;
    const url = ig.buildAuthorizeUrl(
      { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://hanjul.ai/api/sns/auth/callback/instagram' },
      'STATE-1',
    );
    expect(url).toContain('client_id=cid');
    expect(url).toContain('state=STATE-1');
    expect(url).toContain(encodeURIComponent('https://hanjul.ai/api/sns/auth/callback/instagram'));
    expect(url).not.toContain('sec');   // 시크릿은 승인 창 주소에 실리지 않는다
  });
});

describe('화면 계약 — 프론트 소스 스캔(프론트 테스트 파일 0이라 백엔드가 본다)', () => {
  it('계정 배지 사전이 계정 상태 7개를 빠짐없이 덮는다', () => {
    const dict = SNS_PAGE.slice(SNS_PAGE.indexOf('const ACCOUNT_BADGE'), SNS_PAGE.indexOf('export default function'));
    const missing = SNS_ACCOUNT_STATUSES.filter((s) => !new RegExp(`(^|\\s)${s}:`, 'm').test(dict));
    expect(missing, '사전에 없는 상태는 화면이 그리지 않는다 — 배지가 사라진다').toEqual([]);
  });

  it('화면이 ENV 를 다시 계산하지 않는다 — 서버 플래그 하나만 본다(§2-16)', () => {
    expect(SNS_PAGE).not.toMatch(/SNS_COMPANY_IDS/);
    expect(SNS_PAGE).toMatch(/data\.enabled/);
  });

  it('native dialog 0 · 모델명 0', () => {
    expect(SNS_PAGE).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
    expect(SNS_PAGE).not.toMatch(/opus|sonnet|haiku|gpt-|claude|anthropic/i);
  });

  it('승인 창 메시지를 성공 신호로 쓰지 않는다 — 받으면 서버를 다시 읽는다(§3-10)', () => {
    // payload 에 success 가 없어야 하고, 수신 쪽은 origin 과 stateNonce 를 둘 다 본다.
    expect(SNS_PAGE).toMatch(/e\.origin !== window\.location\.origin/);
    expect(SNS_PAGE).toMatch(/stateNonce/);
    expect(SNS_PAGE).not.toMatch(/d\.success|data\.success\s*===\s*true\s*\)\s*\{[^}]*setAccounts/);
  });
});

describe('게이트 계약', () => {
  it('요금제 키가 판정 코드에 실존한다(FREE 만 차단)', () => {
    expect(PLAN_GUARD).toMatch(/\|\s*'sns_publish'/);
    expect(PLAN_GUARD).toMatch(/case 'sns_publish':/);
  });

  it('허브 접근 응답이 SNS 플래그를 싣는다 — 타일보다 먼저 배포되는 축(§3-11)', () => {
    expect(AI_ROUTE).toMatch(/features:\s*\{\s*sns:\s*snsPublishEnabled\(companyId\)/);
  });
});
