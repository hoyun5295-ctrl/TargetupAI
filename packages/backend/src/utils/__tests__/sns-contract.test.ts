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
import { planSnsFit } from '../sns-media-fit';
import { buildSnsCaption, normalizeSnsTags, tightestCaptionChannel } from '../sns-caption-rules';
import { buildSnsIdempotencyKey } from '../sns-idempotency';
import { signSnsMediaToken, verifySnsMediaToken, isSnsMediaUrlLive } from '../sns-signed-media';
import { snsTargetBadge, canRetrySnsTarget, hasSnsInFlight } from '../../../../frontend/src/utils/sns-view';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const SNS_PAGE = readFileSync(resolve(FRONT, 'pages/SnsPage.tsx'), 'utf8');
const SNS_VIEW = readFileSync(resolve(FRONT, 'utils/sns-view.ts'), 'utf8');
const MODULES = readFileSync(resolve(FRONT, 'constants/ai-operator-modules.ts'), 'utf8');
const HUB = readFileSync(resolve(FRONT, 'pages/AiOperatorPage.tsx'), 'utf8');
const WALK = readFileSync(resolve(FRONT, 'components/AiOperatorWalkthroughModal.tsx'), 'utf8');
const INTROS = readFileSync(resolve(FRONT, 'constants/plan-feature-intros.ts'), 'utf8');
const APP = readFileSync(resolve(FRONT, 'App.tsx'), 'utf8');
const PLAN_GUARD = readFileSync(resolve(__dirname, '../plan-guard.ts'), 'utf8');
const ROUTE_SRC = readFileSync(resolve(__dirname, '../../routes/sns.ts'), 'utf8');
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

  it('★ 1차-B(0923) — 네 채널 모두 코드가 준비돼 있고, 실제 개방은 자격 ENV·실비 상한이 정한다(sns-availability)', () => {
    for (const p of ['instagram', 'threads', 'facebook_page', 'x'] as const) {
      expect(getSnsAdapter(p)!.available).toBe(true);
    }
    // 화면 specs 는 어댑터의 available 을 그대로 싣지 않고 개방 판정 함수를 거친다(코드 배포만으로 열리지 않게).
    // ★ 0924 — 회사 id 를 함께 넘긴다(채널 회사 명단 · 심사 전 채널).
    expect(ROUTE_SRC).toMatch(/available:\s*snsChannelAvailable\(a, companyId\)\.ok/);
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
    // ★ 2026-09-24 30 → 5 — Meta @creators 공지(2025-12-18) '게시물당 해시태그 최대 5개'
    expect(ig.capabilities.maxTags).toBe(5);
    expect(ig.capabilities.publishCarousel).toBe(true);
    // ★ 1차-B(0923) — 릴스가 열렸다(문서 기준 · raw 전 · 설계 1b §2)
    expect(ig.capabilities.publishVideo).toBe(true);
    expect(ig.scopes).toContain('instagram_business_content_publish');
  });

  it('X 만 실비 채널이고 업로드 방식이다(§1-1)', () => {
    const x = getSnsAdapter('x')!;
    expect(x.capabilities.metered).toBe(true);
    expect(x.capabilities.mediaTransfer).toBe('upload');
    // ★ 1차-B(0923) deferred → immediate — 공식 요금 = 글 읽기 건당 $0.005 · 타임라인 대조는 읽은 글 수만큼 과금(설계 1b §3-7)
    expect(x.capabilities.verify).toBe('immediate');
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

  it('★ 1차-B — X 는 PKCE 값 없이 연결 주소를 만들지 않는다 · 페이스북은 로그인 1회에 계정 N개를 선언한다', () => {
    const x = getSnsAdapter('x')!;
    expect(x.pkce).toBe(true);
    expect(() => x.buildAuthorizeUrl({ clientId: 'a', clientSecret: 'b', redirectUri: 'c' }, 's')).toThrow();
    const url = x.buildAuthorizeUrl({ clientId: 'a', clientSecret: 'sec', redirectUri: 'c' }, 's', { codeChallenge: 'CH' });
    expect(url).toContain('code_challenge=CH');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).not.toContain('sec');
    const fb = getSnsAdapter('facebook_page')!;
    expect(typeof fb.fetchAccounts).toBe('function');
    expect(fb.deauthKey).toBe('owner');
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

describe('⛔ 원본을 멋대로 자르지 않는다 (Harold 확정 2026-09-21)', () => {
  const ig = { imageAspectMin: 0.8, imageAspectMax: 1.91, imageMaxWidth: 1440, imageMaxBytes: 8 * 1024 * 1024 };

  it('허용 범위 안이면 **아무것도 하지 않는다** — 손대는 것이 기본이 아니다', () => {
    for (const [w, h] of [[1080, 1080], [1080, 1350], [1200, 628], [1000, 1250]]) {
      const plan = planSnsFit(w, h, ig);
      expect(plan.needsAspectChange, `${w}x${h} 는 범위 안인데 비율을 바꿨다`).toBe(false);
      expect(plan.notice).toBe('');   // 하지 않은 일을 설명하지 않는다
    }
  });

  it('범위 밖이어도 **가장 가까운 경계**로 간다 — 정사각으로 보내지 않는다(여백 최소)', () => {
    // 3:4 = 0.75 세로 포스터 → 1:1(1.0) 이 아니라 4:5(0.8)
    const plan = planSnsFit(1200, 1600, ig);
    expect(plan.needsAspectChange).toBe(true);
    expect(plan.targetAspect).toBeCloseTo(0.8, 5);
    expect(plan.targetAspect).not.toBeCloseTo(1.0, 5);

    // 초광각 3:1 = 3.0 → 1.91
    const wide = planSnsFit(3000, 1000, ig);
    expect(wide.targetAspect).toBeCloseTo(1.91, 5);
  });

  it('기본 방식은 언제나 pad — crop 은 명시해야만 나온다', () => {
    expect(planSnsFit(1200, 1600, ig).mode).toBe('pad');
    expect(planSnsFit(1200, 1600, ig).notice).toContain('잘리지 않아요');
    expect(planSnsFit(1200, 1600, ig, 'crop').mode).toBe('crop');
  });

  it('캔버스가 원본을 통째로 담는다 — 어느 변도 원본보다 작지 않다(= 잘림 0)', () => {
    for (const [w, h] of [[1200, 1600], [3000, 1000], [400, 900]]) {
      const plan = planSnsFit(w, h, ig);
      if (!plan.needsAspectChange || plan.resized) continue;
      expect(plan.canvasWidth).toBeGreaterThanOrEqual(w);
      expect(plan.canvasHeight).toBeGreaterThanOrEqual(h);
    }
  });

  it('워커가 게시본을 구울 때 crop 을 기본으로 쓰지 않는다(소스 스캔)', () => {
    const WORKER = readFileSync(resolve(__dirname, '../sns-publish-worker.ts'), 'utf8');
    expect(WORKER).toMatch(/mode: 'pad'/);
    expect(WORKER).not.toMatch(/mode: 'crop'/);
  });

  it('화면이 "잘린다"고 말하지 않는다 — 잘리지 않으므로', () => {
    const COMPOSER = readFileSync(resolve(FRONT, 'components/sns/SnsComposer.tsx'), 'utf8');
    // 사용자에게 보이는 문구에 "잘" 이 들어가는 곳은 "잘리지 않아요" 뿐이어야 한다.
    const scary = [...COMPOSER.matchAll(/'[^'\n]*잘[^'\n]*'/g)].map((m) => m[0]);
    expect(scary.filter((s) => !s.includes('잘리지 않아요'))).toEqual([]);
  });
});

describe('소재 라이브러리 픽커 (§4-2 · §3-9)', () => {
  const COMPOSER = readFileSync(resolve(FRONT, 'components/sns/SnsComposer.tsx'), 'utf8');
  const ROUTE = readFileSync(resolve(__dirname, '../../routes/sns.ts'), 'utf8');

  it('사진 넣는 입구가 둘이다 — 직접 올리기 · 소재에서 고르기', () => {
    expect(COMPOSER).toMatch(/직접 올리기/);
    expect(COMPOSER).toMatch(/소재에서 고르기/);
    expect(COMPOSER).toMatch(/\/api\/sns\/media\/from-asset/);
  });

  it('★ 소재 경유 미디어만 asset_id 를 갖는다 — AI 표시 자동 부착의 유일한 근거(§3-9)', () => {
    // 직접 업로드 INSERT 에는 asset_id 가 없고, 소재 경유 INSERT 에만 있다.
    const direct = ROUTE.slice(ROUTE.indexOf("router.post('/media'"), ROUTE.indexOf("router.get('/assets'"));
    const fromAsset = ROUTE.slice(ROUTE.indexOf("router.post('/media/from-asset'"));
    expect(direct).not.toMatch(/INSERT INTO sns_media[\s\S]{0,300}asset_id/);
    expect(fromAsset).toMatch(/INSERT INTO sns_media[\s\S]{0,300}asset_id/);
  });

  it('소재는 회사 조건으로만 꺼낸다 — 남의 회사 소재를 가져올 수 없다', () => {
    expect(ROUTE).toMatch(/FROM cdp_assets\s*\n?\s*WHERE company_id = \$1::uuid/);
    expect(ROUTE).toMatch(/FROM cdp_assets WHERE id = \$1::uuid AND company_id = \$2::uuid/);
  });
});

describe('작성 구역 미리보기 · 인증 주소는 헤더를 실어 받는다 (B-0923-4)', () => {
  // 0923 접수: 소재에서 고른 사진이 작성 구역에서 깨진 그림으로 보였다.
  // `/api/sns/media/:id` 는 authenticate 뒤라 `<img src>` 로 부르면 401 이다(`<img>` 는 Authorization 헤더를 못 붙인다).
  // 직접 올리기도 같은 주소를 써서 똑같이 깨졌다. 처방 = 공용 CT `fetchAuthObjectUrl`(B-0923-1 과 같은 뿌리).
  const COMPOSER = readFileSync(resolve(FRONT, 'components/sns/SnsComposer.tsx'), 'utf8');
  const ROUTE = readFileSync(resolve(__dirname, '../../routes/sns.ts'), 'utf8');

  it('미리보기 주소는 인증 뒤에 둔다 · 공개로 풀어서 고치지 않는다(불변 14)', () => {
    const authAt = ROUTE.indexOf('router.use(authenticate)');
    const mediaAt = ROUTE.indexOf("router.get('/media/:id'");
    expect(authAt).toBeGreaterThan(-1);
    expect(mediaAt).toBeGreaterThan(authAt);
    expect(ROUTE).not.toMatch(/snsPublicRouter\.get\('\/media\//);
  });

  it('미리보기 주소를 그대로 쓰지 않고 공용 CT 로 받는다', () => {
    expect(COMPOSER).toMatch(/import \{[^}]*fetchAuthObjectUrl[^}]*\} from '\.\.\/\.\.\/lib\/auth-download'/);
    const uses = [...COMPOSER.matchAll(/`\/api\/sns\/media\/\$\{/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(COMPOSER.slice(Math.max(0, u.index! - 40), u.index)).toMatch(/fetchAuthObjectUrl\($/);
    }
  });

  it('두 입구가 같은 함수로 사진을 붙인다 · 한쪽만 고쳐지지 않게', () => {
    const upload = COMPOSER.slice(COMPOSER.indexOf('const upload = async'), COMPOSER.indexOf('const pickFromLibrary'));
    // ★ 2026-09-24 pickFromLibrary 다음 함수 = lookupMedia(불러와서 쓰기 · 같은 appendMedia 를 쓴다)
    const pick = COMPOSER.slice(COMPOSER.indexOf('const pickFromLibrary'), COMPOSER.indexOf('const lookupMedia'));
    expect(upload).toMatch(/await appendMedia\(data\)/);
    expect(pick).toMatch(/await appendMedia\(data\)/);
    expect(upload).not.toMatch(/setMedia\(/);
    expect(pick).not.toMatch(/setMedia\(/);
  });

  it('못 받은 미리보기는 깨진 그림 대신 빈 사진 표시로 그린다', () => {
    expect(COMPOSER).toMatch(/m\.previewUrl\s*\?\s*<img src=\{m\.previewUrl\}/);
  });

  it('다 쓴 blob 주소를 돌려준다 · 빼기·게시 뒤 비우기·화면 이탈', () => {
    expect(COMPOSER).toMatch(/URL\.revokeObjectURL/);
  });

  it('로더는 누른 입구에서만 돈다', () => {
    expect(COMPOSER).toMatch(/uploading === 'file'/);
    expect(COMPOSER).toMatch(/uploading === 'asset'/);
  });
});

describe('캡션 규칙 CT', () => {
  const igSpec = { maxCaptionChars: 2200, maxTags: 30 };
  const xSpec = { maxCaptionChars: 280, maxTags: 10 };

  it('⛔ 상한을 넘어도 **자르지 않는다** — 넘었다는 사실만 돌려준다(고객 문안 불변)', () => {
    const long = 'ㄱ'.repeat(400);
    const r = buildSnsCaption({ body: long, tags: [], aiNotice: false }, xSpec);
    expect(r.ok).toBe(false);
    expect(r.overBy).toBeGreaterThan(0);
    expect(r.text).toContain(long);           // 원문이 그대로 들어 있다
    expect([...r.text].length).toBe(r.length);
  });

  it('태그는 상한까지만 싣고 나머지는 알린다(잘라내는 것이 아니라 안 싣는 것)', () => {
    const tags = Array.from({ length: 15 }, (_, i) => `태그${i}`);
    const r = buildSnsCaption({ body: '글', tags, aiNotice: false }, xSpec);
    expect(r.droppedTags).toHaveLength(5);
    expect(r.text).not.toContain('#태그10');
  });

  it('AI 표시는 끌 수 없고 글자수에 포함된다(§3-9)', () => {
    const r = buildSnsCaption({ body: '글', tags: [], aiNotice: true }, igSpec);
    expect(r.aiNoticeApplied).toBe(true);
    expect(r.text).toContain('AI로 생성된 이미지입니다');
    const without = buildSnsCaption({ body: '글', tags: [], aiNotice: false }, igSpec);
    expect(r.length).toBeGreaterThan(without.length);
  });

  it('같은 글이 채널마다 다르게 판정된다 — 기준은 가장 빡빡한 채널', () => {
    const body = 'ㄱ'.repeat(500);
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, igSpec).ok).toBe(true);
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, xSpec).ok).toBe(false);
    const tightest = tightestCaptionChannel([
      { platform: 'instagram', label: '인스타그램', spec: igSpec },
      { platform: 'x', label: 'X', spec: xSpec },
    ]);
    expect(tightest?.platform).toBe('x');
  });

  it('태그 형식 위반은 싣지 않는다', () => {
    expect(normalizeSnsTags(['좋아요', '#중복', '중복', 'bad tag!', ''])).toEqual(['좋아요', '중복']);
  });
});

describe('멱등키 (§3-6)', () => {
  const company = '11111111-2222-3333-4444-555555555555';
  const target = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const material = { caption: '글 #태그', mediaIds: ['m1', 'm2'], format: 'carousel' };

  it('94자 고정 — 설계서가 못 박은 값', () => {
    expect(buildSnsIdempotencyKey(company, target, material)).toHaveLength(94);
  });

  it('같은 내용이면 항상 같은 키(랜덤 0) · 내용이 바뀌면 다른 키', () => {
    const a = buildSnsIdempotencyKey(company, target, material);
    expect(buildSnsIdempotencyKey(company, target, material)).toBe(a);
    expect(buildSnsIdempotencyKey(company, target, { ...material, caption: '다른 글' })).not.toBe(a);
    // 순서가 바뀌면 다른 게시물이다
    expect(buildSnsIdempotencyKey(company, target, { ...material, mediaIds: ['m2', 'm1'] })).not.toBe(a);
  });
});

describe('서명 미디어 URL (§3-7 · 불변 14)', () => {
  const base = {
    targetId: '11111111-2222-3333-4444-555555555555',
    mediaId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    companyId: '99999999-8888-7777-6666-555555555555',
    salt: 's',
  };
  const SEC = 'media-secret';

  it('서명 왕복 · 변조 거부', () => {
    const token = signSnsMediaToken(base, SEC);
    expect(verifySnsMediaToken(token, SEC)).toEqual(base);
    expect(verifySnsMediaToken(`${token}x`, SEC)).toBeNull();
    expect(verifySnsMediaToken(token, 'other')).toBeNull();
  });

  it('게시가 확인되면 **즉시 죽는다** — 서명이 통과해도 상태가 막는다', () => {
    const now = new Date();
    const live = { status: 'submitted', container_created_at: now, created_at: now, verified_at: null };
    expect(isSnsMediaUrlLive(live, now)).toBe(true);
    expect(isSnsMediaUrlLive({ ...live, verified_at: now }, now)).toBe(false);
    expect(isSnsMediaUrlLive({ ...live, status: 'failed' }, now)).toBe(false);
    expect(isSnsMediaUrlLive({ ...live, status: 'cancelled' }, now)).toBe(false);
    expect(isSnsMediaUrlLive({ ...live, status: 'scheduled' }, now)).toBe(false);
  });

  it('절대 상한 36시간을 넘으면 상태와 무관하게 죽는다', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 37 * 60 * 60 * 1000);
    expect(isSnsMediaUrlLive({ status: 'submitted', container_created_at: null, created_at: old, verified_at: null }, now)).toBe(false);
  });
});

describe('이력 배지 판정 (§3-5)', () => {
  const base = {
    targetId: 't', platform: 'instagram', status: 'draft',
    permalink: null, verifiedAt: null, deletedOnPlatformAt: null,
    verifyGaveUpAt: null, platformPostId: null, lastError: null, lastErrorCode: null,
  };

  it('⛔ 올라갔을 가능성이 있으면 "다시 시도"를 열지 않는다(이중 게시 차단)', () => {
    const submittedWithId = { ...base, status: 'submitted', platformPostId: 'p1' };
    expect(snsTargetBadge(submittedWithId).label).toBe('올렸고 확인 중');
    expect(canRetrySnsTarget(submittedWithId)).toBe(false);
    // 게시 id 를 못 받은 실패만 재시도 대상이다
    expect(canRetrySnsTarget({ ...base, status: 'failed' })).toBe(true);
    expect(canRetrySnsTarget({ ...base, status: 'failed', platformPostId: 'p1' })).toBe(false);
  });

  it('증거 컬럼이 상태보다 앞선다 — 삭제 감지·확인 포기·재연결', () => {
    expect(snsTargetBadge({ ...base, status: 'published', deletedOnPlatformAt: 'x' }).label).toBe('게시물 없음');
    expect(snsTargetBadge({ ...base, status: 'submitted', platformPostId: 'p', verifyGaveUpAt: 'x' }).label).toBe('올렸고 확인 못함');
    expect(snsTargetBadge({ ...base, status: 'failed', lastErrorCode: 'REAUTH_REQUIRED' }).label).toBe('계정 확인 필요');
  });

  it('진행 중이 없으면 폴링하지 않는다', () => {
    expect(hasSnsInFlight([{ targets: [{ ...base, status: 'published', verifiedAt: 'x' }] }])).toBe(false);
    expect(hasSnsInFlight([{ targets: [{ ...base, status: 'submitted' }] }])).toBe(true);
  });
});

describe('워커 계약 (§3-4 · §2-8 · §2-15)', () => {
  const WORKER = readFileSync(resolve(__dirname, '../sns-publish-worker.ts'), 'utf8');
  const RECON = readFileSync(resolve(__dirname, '../sns-reconcile-worker.ts'), 'utf8');

  it('이중 게시 3겹 — 선점·소유권·게시 직전 재확인', () => {
    expect(WORKER).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(WORKER).toMatch(/lock_token = \$2::uuid/);            // 소유권 확인하며 쓴다
    expect(WORKER).toMatch(/stage = 'publish_called'/);           // 게시 직전 재확인 자리
  });

  it('소급 게시 0 — 첫 tick 은 세기만 하고, 지난 예약은 선점 전에 닫는다', () => {
    expect(WORKER).toMatch(/armed/);
    // 주석이 아니라 **실행되는 SQL** 의 순서를 본다 — stale 정리가 선점 UPDATE 보다 앞에 있어야 한다.
    const claimSql = WORKER.indexOf(`SET status = 'claimed', lock_token`);
    expect(claimSql, '선점 UPDATE 를 못 찾으면 이 게이트가 죽은 것이다').toBeGreaterThan(-1);
    expect(WORKER.indexOf('SCHEDULE_EXPIRED')).toBeLessThan(claimSql);
  });

  it('대조 워커는 게시 호출까지 간 행을 scheduled 로 되돌리지 않는다(이중 게시 차단)', () => {
    expect(RECON).toMatch(/stage = 'publish_called'[\s\S]*?status = 'submitted'|status = 'submitted'[\s\S]*?stage = 'publish_called'/);
    expect(RECON).toMatch(/stage IS NULL OR stage <> 'publish_called'/);
  });

  it('종결·확정은 대조 조회에서 뺀다(BUGS 818행 되돌림 회귀 방지)', () => {
    expect(RECON).toMatch(/verify_gave_up_at IS NULL/);
    expect(RECON).toMatch(/deleted_on_platform_at IS NULL/);
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
