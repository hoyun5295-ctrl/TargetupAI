/**
 * ★ 2026-10-07 (Harold 「구멍 자체를 만들지 마」) 기능 안내 원장 · 영상 = 로그인한 사람에게만
 *   원장 = content/plan-feature-intros.ts · 영상 = assets/plan-feature(공개 폴더 밖) · 영상 주소 = 잠깐만 유효한 서명 주소.
 *   워터마크 = 기능 설명 화면에만 · 미가입 · 무료 체험 · 지정 계정(psy5868)만 · 정상 유료 고객사 = 없음.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const planCtx = vi.hoisted(() => ({ value: null as any }));
vi.mock('../plan-guard', async (orig) => {
  const real: any = await orig();
  return { ...real, loadPlanContext: vi.fn(async () => planCtx.value) };
});

import { signedMediaUrl, resolveSignedMedia, shouldWatermarkFeatureIntro, buildFeatureIntrosPayload, MEDIA_TTL_SEC } from '../plan-feature-intros-serve';

const FRONT = join(__dirname, '../../../../frontend');
const NOW = 1_800_000_000;

beforeEach(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1007';
  delete process.env.WATERMARK_LOGIN_IDS;
  planCtx.value = null;
});

const q = (url: string) => Object.fromEntries(new URL(`http://x${url}`).searchParams);

describe('영상 서명 주소', () => {
  it('서명 주소는 열리고 · 만료 · 다른 파일 · 다른 사용자 · 위조는 안 열린다', () => {
    const url = signedMediaUrl('/videos/plan-feature/journeys.mp4', 'u1', NOW);
    expect(url.startsWith('/api/plans/feature-media?f=journeys.mp4&')).toBe(true);
    const p = q(url);
    expect(resolveSignedMedia('journeys.mp4', p, NOW)).toMatch(/journeys\.mp4$/);
    expect(resolveSignedMedia('journeys.mp4', p, NOW + MEDIA_TTL_SEC + 1)).toBeNull();
    expect(resolveSignedMedia('mobile-dm.mp4', p, NOW)).toBeNull();
    expect(resolveSignedMedia('journeys.mp4', { ...p, u: 'u2' }, NOW)).toBeNull();
    expect(resolveSignedMedia('journeys.mp4', { ...p, s: 'AAAA' }, NOW)).toBeNull();
    expect(resolveSignedMedia('../app.ts', p, NOW)).toBeNull();
  });
  it('원장 밖 경로는 주소를 만들지 않는다', () => {
    expect(signedMediaUrl('/etc/passwd', 'u1', NOW)).toBe('');
  });
});

describe('워터마크 = 미가입 · 무료 체험 · 지정 계정만', () => {
  const company = { userId: 'u1', userType: 'company_admin', loginId: 'someone', companyId: 'c1' };
  it('정상 유료 = 없음 · 무료 체험 = 있음 · 미가입 = 있음', async () => {
    planCtx.value = { planCode: 'PRO', subscriptionStatus: 'paid', trialExpiresAt: null, isTrialActive: false };
    expect(await shouldWatermarkFeatureIntro(company)).toBe(false);
    planCtx.value = { planCode: 'TRIAL', subscriptionStatus: 'trial', trialExpiresAt: null, isTrialActive: true };
    expect(await shouldWatermarkFeatureIntro(company)).toBe(true);
    planCtx.value = { planCode: 'FREE', subscriptionStatus: null, trialExpiresAt: null, isTrialActive: false };
    expect(await shouldWatermarkFeatureIntro(company)).toBe(true);
  });
  it('지정 계정(기본 psy5868)은 요금제와 상관없이 · 슈퍼관리자는 없음', async () => {
    planCtx.value = { planCode: 'PRO', subscriptionStatus: 'paid', trialExpiresAt: null, isTrialActive: false };
    expect(await shouldWatermarkFeatureIntro({ ...company, loginId: 'PSY5868' })).toBe(true);
    expect(await shouldWatermarkFeatureIntro({ userId: 's1', userType: 'super_admin', loginId: 'ceo' })).toBe(false);
  });
  it('응답: 영상은 서명 주소로 · /about 구성은 허용 계정에만', async () => {
    planCtx.value = { planCode: 'PRO', subscriptionStatus: 'paid', trialExpiresAt: null, isTrialActive: false };
    const p = await buildFeatureIntrosPayload(company);
    const withVideo = p.intros.filter((f) => f.video);
    expect(withVideo.length).toBe(12);
    for (const f of withVideo) expect(f.video!.src.startsWith('/api/plans/feature-media?f=')).toBe(true);
    expect(p.about).toBeNull();
    expect((await buildFeatureIntrosPayload({ ...company, loginId: 'hoyun' })).about?.groups.length).toBe(4);
  });
});

describe('구멍 0 — 화면 코드 · 공개 폴더에 원장 · 영상이 없다', () => {
  it('화면 원장 파일에 기능 글이 없다 · 공개 폴더에 기능 영상이 없다', () => {
    const fe = readFileSync(join(FRONT, 'src/constants/plan-feature-intros.ts'), 'utf8');
    expect(fe).not.toMatch(/steps: \[|safeguards: \[|options: \[|summary: '/);
    expect(readFileSync(join(FRONT, 'src/constants/about-page.ts'), 'utf8')).not.toMatch(/ABOUT_GROUPS|ABOUT_GUARDS/);
    expect(existsSync(join(FRONT, 'public/videos/plan-feature'))).toBe(false);
    expect(readdirSync(join(__dirname, '../../../assets/plan-feature')).filter((f) => f.endsWith('.mp4')).length).toBe(12);
  });
  it('원장은 로그인 경로로만 · 영상 경로는 서명 확인 뒤 파일', () => {
    const plans = readFileSync(join(__dirname, '../../routes/plans.ts'), 'utf8');
    expect(plans).toContain("router.get('/feature-intros', authenticate,");
    const m = plans.slice(plans.indexOf("router.get('/feature-media'"));
    expect(m.indexOf('resolveSignedMedia')).toBeLessThan(m.indexOf('sendFile'));
  });
});
