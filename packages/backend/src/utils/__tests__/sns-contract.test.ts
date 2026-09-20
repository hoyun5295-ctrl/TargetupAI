/**
 * SNS 채널 계약 테스트 (2026-09-20 S1)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-5 · §3-11
 *
 * 이 파일이 잠그는 것 = "값이 두 곳에 적히면 실패한다".
 *   프론트에 테스트 파일이 0이라, 화면 사전·필터 정합은 **백엔드가 프론트 소스를 읽어** 단정한다
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
const SNS_VIEW = readFileSync(resolve(FRONT, 'utils/sns-view.ts'), 'utf8');
const MODULES = readFileSync(resolve(FRONT, 'constants/ai-operator-modules.ts'), 'utf8');
const HUB = readFileSync(resolve(FRONT, 'pages/AiOperatorPage.tsx'), 'utf8');
const WALK = readFileSync(resolve(FRONT, 'components/AiOperatorWalkthroughModal.tsx'), 'utf8');
const INTROS = readFileSync(resolve(FRONT, 'constants/plan-feature-intros.ts'), 'utf8');
const APP = readFileSync(resolve(FRONT, 'App.tsx'), 'utf8');
const PLAN_GUARD = readFileSync(resolve(__dirname, '../plan-guard.ts'), 'utf8');
const AI_ROUTE = readFileSync(resolve(__dirname, '../../routes/ai.ts'), 'utf8');
const SECRET = 'test-secret-for-sns-state';

describe('SNS 상수 컨트롤타워', () => {
  it('상태 목록은 설계서 개수와 같다 — 늘리면 여기서 멈춘다(불변 7)', () => {
    expect(SNS_TARGET_STATUSES).toHaveLength(7);
    expect(SNS_POST_STATUSES).toHaveLength(7);
    expect(SNS_ACCOUNT_STATUSES).toHaveLength(7);
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
    expect(snsPublishEnabled(null, '*')).toBe(false);
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
  it('플랫폼 4개가 모두 등록돼 있다 — 화면은 채널을 추론하지 않는다(§3-3)', () => {
    const platforms = listSnsAdapters().map((a) => a.platform).sort();
    expect(platforms).toEqual([...SNS_PLATFORMS].sort());
  });

  it('1차-A 는 열려 있고 1차-B 는 스켈레톤(available:false)이다', () => {
    expect(getSnsAdapter('instagram')!.available).toBe(true);
    expect(getSnsAdapter('threads')!.available).toBe(true);
    expect(getSnsAdapter('facebook_page')!.available).toBe(false);
    expect(getSnsAdapter('x')!.available).toBe(false);
  });

  it('capabilities 는 전 채널이 직접 선언한다', () => {
    for (const a of listSnsAdapters()) {
      expect(a.capabilities.maxCaptionChars).toBeGreaterThan(0);
      expect(a.capabilities.dailyLimit).toBeGreaterThan(0);
      expect(['immediate', 'deferred', 'none']).toContain(a.capabilities.verify);
      expect(['pull_url', 'upload']).toContain(a.capabilities.mediaTransfer);
      expect(a.label.length).toBeGreaterThan(0);
    }
  });

  it('인스타 상수는 S0 실측값(§1-4)이다 — 바꾸려면 새 raw 가 있어야 한다', () => {
    const ig = getSnsAdapter('instagram')!;
    expect(ig.capabilities.dailyLimit).toBe(100);
    expect(ig.capabilities.maxCaptionChars).toBe(2200);
    expect(ig.capabilities.maxTags).toBe(30);
    expect(ig.capabilities.publishCarousel).toBe(true);
    expect(ig.capabilities.publishVideo).toBe(false);
    expect(ig.scopes).toContain('instagram_business_content_publish');
  });

  it('X 만 실비 채널이고 업로드 방식이다(§1-1)', () => {
    const x = getSnsAdapter('x')!;
    expect(x.capabilities.metered).toBe(true);
    expect(x.capabilities.mediaTransfer).toBe('upload');
    expect(x.capabilities.verify).toBe('deferred');
    expect(listSnsAdapters().filter((a) => a.capabilities.metered).map((a) => a.platform)).toEqual(['x']);
  });

  it('authorize URL 은 state 와 redirect_uri 를 싣고 시크릿은 싣지 않는다', () => {
    const ig = getSnsAdapter('instagram')!;
    const url = ig.buildAuthorizeUrl(
      { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://hanjul.ai/api/sns/auth/callback/instagram' },
      'STATE-1',
    );
    expect(url).toContain('client_id=cid');
    expect(url).toContain('state=STATE-1');
    expect(url).toContain(encodeURIComponent('https://hanjul.ai/api/sns/auth/callback/instagram'));
    expect(url).not.toContain('sec');
  });

  it('스켈레톤 채널은 연결을 시도하면 사유와 함께 막는다', () => {
    const fb = getSnsAdapter('facebook_page')!;
    expect(() => fb.buildAuthorizeUrl({ clientId: 'a', clientSecret: 'b', redirectUri: 'c' }, 's')).toThrow();
  });
});

describe('화면 계약 — 프론트 소스 스캔(프론트 테스트 파일 0이라 백엔드가 본다)', () => {
  it('계정 배지 사전이 계정 상태 7개를 빠짐없이 덮는다', () => {
    const dict = SNS_VIEW.slice(SNS_VIEW.indexOf('SNS_ACCOUNT_BADGE'), SNS_VIEW.indexOf('liveSnsAccounts'));
    const missing = SNS_ACCOUNT_STATUSES.filter((s) => !new RegExp(`(^|\\s)${s}:`, 'm').test(dict));
    expect(missing, '사전에 없는 상태는 화면이 그리지 않는다 — 배지가 사라진다').toEqual([]);
  });

  it('화면이 ENV 를 다시 계산하지 않는다 — 서버 플래그 하나만 본다(§2-16)', () => {
    expect(SNS_PAGE).not.toMatch(/SNS_COMPANY_IDS/);
    expect(SNS_PAGE).toMatch(/data\.enabled/);
    // 채널 목록도 서버가 준 specs 로만 그린다(화면에 하드코딩된 채널 배열 0)
    expect(SNS_PAGE).toMatch(/specs\.map/);
  });

  it('native dialog 0 · 모델명 0', () => {
    for (const src of [SNS_PAGE, SNS_VIEW]) {
      expect(src).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
      expect(src).not.toMatch(/opus|sonnet|haiku|gpt-|claude|anthropic/i);
    }
  });

  it('승인 창 메시지를 성공 신호로 쓰지 않는다 — 받으면 서버를 다시 읽는다(§3-10)', () => {
    expect(SNS_PAGE).toMatch(/e\.origin !== window\.location\.origin/);
    expect(SNS_PAGE).toMatch(/stateNonce/);
  });
});

describe('허브 타일 계약 (§3-11)', () => {
  it('SNS 카드가 개방 플래그를 달고 있다 — 플래그 없이 올리면 전 회사에 보인다', () => {
    expect(MODULES).toMatch(/label: 'SNS 채널'[^}]*path: '\/sns', flag: 'sns'/);
  });

  it('카드를 숨기지 않는다 — 아직인 회사는 같은 안내 창으로 보낸다(Harold 확정)', () => {
    expect(HUB).toMatch(/if \(!isCardOpen\(card, featureFlags\) && featureId\) \{ setPlanFeatureId\(featureId\); return; \}/);
    expect(HUB).not.toMatch(/\.filter\(\(card\) => isCardOpen\(/);
    // 워크스루는 "이런 메뉴가 있습니다" 안내라 거르지 않는다. 거르면 순차 개방 기능이 안내에서 사라진다.
    expect(WALK).not.toMatch(/isCardOpen/);
  });

  it('AI 자율 예측은 버린 것이 아니라 AI 메모리 안에서 들어간다 — 입구 실존', () => {
    const MEMORY = readFileSync(resolve(FRONT, 'pages/AiMemoryPage.tsx'), 'utf8');
    expect(MEMORY, '타일만 내리고 입구를 안 내면 주소를 아는 사람만 쓰는 죽은 기능이 된다')
      .toMatch(/navigate\('\/predictive'\)/);
    expect(MODULES).not.toMatch(/label: 'AI 자율 예측'/);
  });

  it('안내 원장에 SNS 항목이 있고 경로가 카드와 같다', () => {
    expect(INTROS).toMatch(/id: 'sns', path: '\/sns'/);
  });

  it('허브 카드 경로에 그 기능 id 로 입구가 걸려 있다(주소로 직접 들어와도 같은 안내)', () => {
    expect(APP).toMatch(/<PlanGate featureId="sns"><SnsPage \/><\/PlanGate>/);
  });

  it('기한 넘긴 NEW 배지가 남아 있지 않다 — 라벨 3단 정책', () => {
    expect(MODULES).not.toMatch(/label: '마케팅 플래너'[^}]*badge: 'NEW'/);
    expect(MODULES).not.toMatch(/label: '이미지 스튜디오'[^}]*badge: 'NEW'/);
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
