/**
 * SNS 1차-B 규칙 CT (2026-09-23 · docs/2026-09-23-sns-1b-design.md §3-4 · §3-9 · 불변 22·23)
 *
 * 잠그는 것
 *   1. 채널이 받지 못하는 미디어 조합은 **저장 전에** 사유 한 문장으로 막는다(워커에서 터지지 않게)
 *   2. 영상 판정은 확인된 위반만 막는다 — 판독이 못 읽은 값(null)은 통과(불변 22)
 *   3. X 는 한글·이모지를 2자, 링크를 23자로 센다 — 1자로 세면 통과시킨 글을 X 가 거부한다
 *   4. 화면(sns-view.ts)과 서버가 **같은 표에 같은 답**을 낸다(칩 잠금과 저장 거절이 갈리지 않게)
 *   5. 실비 채널은 월 상한 없이는 열리지 않는다(불변 23)
 */
import { describe, it, expect } from 'vitest';
import { listSnsAdapters, getSnsAdapter } from '../sns';
import { snsMediaBlockReason, planSnsVideoFit } from '../sns-media-fit';
import { countSnsCaption, buildSnsCaption } from '../sns-caption-rules';
import { snsChannelAvailable } from '../sns-availability';
import {
  snsMediaBlockReason as viewMediaBlockReason,
  planSnsVideoFit as viewVideoFit,
  countSnsCaption as viewCount,
  SNS_VIDEO_MAX_BYTES as VIEW_VIDEO_MAX,
} from '../../../../frontend/src/utils/sns-view';
import { SNS_VIDEO_MAX_BYTES } from '../sns-media';

const cap = (p: 'instagram' | 'threads' | 'facebook_page' | 'x') => getSnsAdapter(p)!.capabilities;

describe('capabilities 1차-B 필드 — 전 채널이 직접 선언한다', () => {
  it('영상을 받는 채널은 영상 규격을 갖고, 받지 않으면 null 이다', () => {
    for (const a of listSnsAdapters()) {
      expect(a.capabilities.publishVideo).toBe(a.capabilities.video !== null);
      expect(a.capabilities.maxMediaCount).toBeGreaterThan(0);
      expect(['scheduled', 'at_use', 'none']).toContain(a.capabilities.tokenRefresh);
      expect(['chars', 'x_weighted']).toContain(a.capabilities.captionCounting);
      expect(a.capabilities.pollIntervalSec).toBeGreaterThan(0);
    }
  });

  it('공식 문서 값 — 인스타 릴스 3초~15분·300MB·가로 1920 / Threads 5분 / X 사진 4장·가중 280', () => {
    expect(cap('instagram').video).toMatchObject({ minSec: 3, maxSec: 900, maxBytes: 300 * 1024 * 1024, maxWidth: 1920 });
    expect(cap('instagram').publishText).toBe(false);
    expect(cap('threads').video?.maxSec).toBe(300);
    expect(cap('x').maxMediaCount).toBe(4);
    expect(cap('x').captionCounting).toBe('x_weighted');
    expect(cap('x').tokenRefresh).toBe('at_use');
    // 0917 deferred → 1차-B immediate(공식 요금 = 글 읽기 건당 $0.005 · 설계 §3-7)
    expect(cap('x').verify).toBe('immediate');
  });
});

describe('채널별 미디어 수용 판정', () => {
  it('인스타는 글만 올릴 수 없다 · Threads·페이스북·X 는 된다', () => {
    const none = { images: 0, videos: 0 };
    expect(snsMediaBlockReason(none, cap('instagram'))).toMatch(/사진이나 영상/);
    expect(snsMediaBlockReason(none, cap('threads'))).toBeNull();
    expect(snsMediaBlockReason(none, cap('facebook_page'))).toBeNull();
    expect(snsMediaBlockReason(none, cap('x'))).toBeNull();
  });

  it('X 는 사진 4장까지 · 인스타는 10장까지', () => {
    expect(snsMediaBlockReason({ images: 5, videos: 0 }, cap('x'))).toMatch(/4장/);
    expect(snsMediaBlockReason({ images: 4, videos: 0 }, cap('x'))).toBeNull();
    expect(snsMediaBlockReason({ images: 11, videos: 0 }, cap('instagram'))).toMatch(/10장/);
  });

  it('영상은 한 개 · 사진과 섞지 않는다(1차-B 공통)', () => {
    for (const p of ['instagram', 'threads', 'facebook_page', 'x'] as const) {
      expect(snsMediaBlockReason({ images: 0, videos: 2 }, cap(p))).toMatch(/한 개/);
      expect(snsMediaBlockReason({ images: 1, videos: 1 }, cap(p))).toMatch(/함께/);
      expect(snsMediaBlockReason({ images: 0, videos: 1 }, cap(p))).toBeNull();
    }
  });
});

describe('영상 판정 — 확인된 위반만 막는다(불변 22)', () => {
  const ok = { bytes: 50 * 1024 * 1024, durationSec: 30, width: 1080, height: 1920, videoCodec: 'avc1' };

  it('정상 세로 영상은 네 채널 모두 받는다', () => {
    for (const p of ['instagram', 'threads', 'facebook_page', 'x'] as const) {
      expect(planSnsVideoFit(ok, cap(p).video).accepted).toBe(true);
    }
  });

  it('인스타는 3초 미만·15분 초과·가로 1920 초과·다른 코덱을 막는다', () => {
    expect(planSnsVideoFit({ ...ok, durationSec: 2 }, cap('instagram').video).notice).toMatch(/3초/);
    expect(planSnsVideoFit({ ...ok, durationSec: 901 }, cap('instagram').video).notice).toMatch(/15분/);
    expect(planSnsVideoFit({ ...ok, width: 2160, height: 3840 }, cap('instagram').video).notice).toMatch(/1920/);
    expect(planSnsVideoFit({ ...ok, videoCodec: 'apch' }, cap('instagram').video).accepted).toBe(false);
  });

  it('Threads 는 5분을 넘으면 막는다 · 같은 영상이 인스타에는 된다', () => {
    const six = { ...ok, durationSec: 360 };
    expect(planSnsVideoFit(six, cap('threads').video).accepted).toBe(false);
    expect(planSnsVideoFit(six, cap('instagram').video).accepted).toBe(true);
  });

  it('X 는 1:3~3:1 밖의 비율을 막는다', () => {
    expect(planSnsVideoFit({ ...ok, width: 400, height: 1600 }, cap('x').video).accepted).toBe(false);
  });

  it('⛔ 못 읽은 값(null)은 막지 않는다', () => {
    const unknown = { bytes: 1024, durationSec: null, width: null, height: null, videoCodec: null };
    for (const p of ['instagram', 'threads', 'facebook_page', 'x'] as const) {
      expect(planSnsVideoFit(unknown, cap(p).video).accepted).toBe(true);
    }
  });

  it('영상을 받지 않는 규격(null)이면 막는다', () => {
    expect(planSnsVideoFit(ok, null).accepted).toBe(false);
  });
});

describe('X 가중 글자 수', () => {
  it('영문 1 · 한글 2 · 이모지 2 · 링크 23', () => {
    expect(countSnsCaption('abc', 'x_weighted')).toBe(3);
    expect(countSnsCaption('한줄로', 'x_weighted')).toBe(6);
    expect(countSnsCaption('😀', 'x_weighted')).toBe(2);
    expect(countSnsCaption('👩‍👩‍👧', 'x_weighted')).toBe(2);   // 결합 이모지도 한 덩어리
    expect(countSnsCaption('https://hanjul.ai/very/long/path?x=1', 'x_weighted')).toBe(23);
    expect(countSnsCaption('hanjul.ai', 'x_weighted')).toBe(23);
    expect(countSnsCaption('한줄로 https://hanjul.ai', 'x_weighted')).toBe(6 + 1 + 23);
  });

  it('chars 방식은 코드포인트 수 그대로다(1차-A 동작 보존)', () => {
    expect(countSnsCaption('한줄로', 'chars')).toBe(3);
    expect(countSnsCaption('😀', 'chars')).toBe(1);
  });

  it('한글 141자는 X 상한(280 가중)을 넘고 인스타는 통과한다', () => {
    const body = '가'.repeat(141);
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, cap('x')).ok).toBe(false);
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, cap('instagram')).ok).toBe(true);
  });
});

describe('화면 판정 = 서버 판정 (같은 표 · 같은 답)', () => {
  const summaries = [
    { images: 0, videos: 0 }, { images: 1, videos: 0 }, { images: 4, videos: 0 }, { images: 5, videos: 0 },
    { images: 11, videos: 0 }, { images: 21, videos: 0 }, { images: 0, videos: 1 }, { images: 0, videos: 2 }, { images: 2, videos: 1 },
  ];
  const probes = [
    { bytes: 50e6, durationSec: 30, width: 1080, height: 1920, videoCodec: 'avc1' },
    { bytes: 50e6, durationSec: 2, width: 1080, height: 1920, videoCodec: 'hvc1' },
    { bytes: 50e6, durationSec: 400, width: 1080, height: 1920, videoCodec: 'avc1' },
    { bytes: 50e6, durationSec: 30, width: 2160, height: 3840, videoCodec: 'avc1' },
    { bytes: 50e6, durationSec: 30, width: 400, height: 1600, videoCodec: 'mp4v' },
    { bytes: 400e6, durationSec: 30, width: 1080, height: 1920, videoCodec: 'avc1' },
    { bytes: 1, durationSec: null, width: null, height: null, videoCodec: null },
  ];
  const texts = ['', 'abc', '한줄로 AI', '😀👩‍👩‍👧 hanjul.ai', 'https://a.co/x 글 #태그', '가'.repeat(200)];

  it('영상 크기 상한이 같다 — 화면이 보내기 전에 막는 값 = 서버가 시작에서 막는 값', () => {
    expect(VIEW_VIDEO_MAX).toBe(SNS_VIDEO_MAX_BYTES);
  });

  it('미디어 수용 · 영상 판정 · 글자 수가 모든 채널에서 같다', () => {
    for (const a of listSnsAdapters()) {
      for (const s of summaries) expect(viewMediaBlockReason(s, a.capabilities as any)).toBe(snsMediaBlockReason(s, a.capabilities));
      for (const p of probes) expect(viewVideoFit(p, a.capabilities.video as any)).toEqual(planSnsVideoFit(p, a.capabilities.video));
      for (const t of texts) expect(viewCount(t, a.capabilities.captionCounting)).toBe(countSnsCaption(t, a.capabilities.captionCounting));
    }
  });
});

describe('개방 판정 — 코드 · 자격 · 실비 상한 셋 다(불변 23)', () => {
  const env = {
    INSTAGRAM_CLIENT_ID: 'a', INSTAGRAM_CLIENT_SECRET: 'b', INSTAGRAM_REDIRECT_URI: 'https://h/api/sns/auth/callback/instagram',
    X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b', X_REDIRECT_URI: 'https://h/api/sns/auth/callback/x',
  } as Record<string, string | undefined>;

  // ★ 0924 — 심사 전 채널(X·페북)은 채널 회사 명단까지 본다. 이 표의 X 판정은 명단에 든 회사('c1') 기준.
  const gated = { ...env, SNS_X_COMPANY_IDS: 'c1' } as Record<string, string | undefined>;

  it('자격 ENV 가 없으면 준비 중', () => {
    expect(snsChannelAvailable(getSnsAdapter('instagram')!, 'c1', env).ok).toBe(true);
    expect(snsChannelAvailable(getSnsAdapter('threads')!, 'c1', env).ok).toBe(false);
  });

  it('⛔ X 는 자격이 있어도 월 상한이 비었거나 0 이면 열리지 않는다', () => {
    expect(snsChannelAvailable(getSnsAdapter('x')!, 'c1', gated).ok).toBe(false);
    expect(snsChannelAvailable(getSnsAdapter('x')!, 'c1', { ...gated, SNS_X_MONTHLY_POST_CAP: '0' }).ok).toBe(false);
    expect(snsChannelAvailable(getSnsAdapter('x')!, 'c1', { ...gated, SNS_X_MONTHLY_POST_CAP: 'abc' }).ok).toBe(false);
    expect(snsChannelAvailable(getSnsAdapter('x')!, 'c1', { ...gated, SNS_X_MONTHLY_POST_CAP: '30' }).ok).toBe(true);
  });
});

describe('★ 0924 채널 회사 명단 — 심사 전 채널은 명단에 든 회사에만 연다(fail-closed)', () => {
  const full = {
    FACEBOOK_PAGE_CLIENT_ID: 'a', FACEBOOK_PAGE_CLIENT_SECRET: 'b', FACEBOOK_PAGE_REDIRECT_URI: 'https://h/api/sns/auth/callback/facebook_page',
    X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b', X_REDIRECT_URI: 'https://h/api/sns/auth/callback/x', SNS_X_MONTHLY_POST_CAP: '5',
    INSTAGRAM_CLIENT_ID: 'a', INSTAGRAM_CLIENT_SECRET: 'b', INSTAGRAM_REDIRECT_URI: 'https://h/api/sns/auth/callback/instagram',
  } as Record<string, string | undefined>;

  it('⛔ 명단 ENV 가 없으면 닫힌다 — SNS 전체 명단(SNS_COMPANY_IDS=*)으로 넘어가지 않는다(R-01)', () => {
    const prev = process.env.SNS_COMPANY_IDS;
    process.env.SNS_COMPANY_IDS = '*';
    try {
      expect(snsChannelAvailable(getSnsAdapter('facebook_page')!, 'c1', full).ok).toBe(false);
      expect(snsChannelAvailable(getSnsAdapter('x')!, 'c1', full).ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.SNS_COMPANY_IDS; else process.env.SNS_COMPANY_IDS = prev;
    }
  });

  it('명단에 든 회사만 열리고 `*` 는 전 회사다', () => {
    const env2 = { ...full, SNS_FACEBOOK_PAGE_COMPANY_IDS: 'c1', SNS_X_COMPANY_IDS: '*' };
    expect(snsChannelAvailable(getSnsAdapter('facebook_page')!, 'c1', env2).ok).toBe(true);
    expect(snsChannelAvailable(getSnsAdapter('facebook_page')!, 'c2', env2).ok).toBe(false);
    expect(snsChannelAvailable(getSnsAdapter('x')!, 'c2', env2).ok).toBe(true);
    expect(snsChannelAvailable(getSnsAdapter('x')!, null, env2).ok).toBe(false);
  });

  it('인스타·Threads 는 채널 명단과 무관하다(지금 동작 그대로)', () => {
    expect(snsChannelAvailable(getSnsAdapter('instagram')!, 'c9', full).ok).toBe(true);
    expect(snsChannelAvailable(getSnsAdapter('instagram')!, 'c9', { ...full, SNS_X_COMPANY_IDS: 'c1' }).ok).toBe(true);
  });
});
