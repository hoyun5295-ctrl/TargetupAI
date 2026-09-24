/**
 * SNS 0924 — 올릴 글 재설계 · 채널 관리 계약 (docs/2026-09-24-sns-channel-design.md)
 *
 * 잠그는 것
 *   1. 캡션 CT(B-3) — 태그 사유 · 본문 태그가 채널 태그 자리를 먼저 씀 · 두 번 붙지 않음 · 채울 자리 게시 불가
 *   2. 화면 미러가 서버와 **같은 표에 같은 답**(태그 판정 · 조립 · AI 모드 · 이름 공간 · AI 표시 문구 · 자리표시 규약)
 *   3. AI 캡션 가드(B-6) — 토큰을 잃거나 없던 링크를 넣으면 버리고 **버렸다고 말한다** · 없던 태그·혜택 제거 · 끝 태그 줄 그대로
 *   4. 맞춤법 판정(B-7) — 위치는 서버가 · 보호 구간 · 편집 거리 · 새 숫자 · 띄어쓰기 분류
 *   5. composeId(uuid v5) — 서버와 화면이 같은 id · 표준 시험값
 *   6. 예약 시각 · 폴링 · 채널 요약 · 계정 이름 · 라우트 정적 계약(user?.id 0)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), withCopyRules: (s: string) => s }));

import { callAIWithFallback } from '../../services/ai';
import { getSnsAdapter, listSnsAdapters } from '../sns';
import {
  buildSnsCaption, checkSnsTag, extractBodyHashtags, normalizeSnsTags, findBodyHashtagSpans, findSnsLinkSpans,
  SNS_BENEFIT_PLACEHOLDER_SOURCE, SNS_URL_PLACEHOLDER_SOURCE,
} from '../sns-caption-rules';
import { generateSnsCaption, splitTrailingTagLines, snsCaptionMode } from '../sns-caption-ai';
import { judgeSnsSpellCandidates } from '../sns-spell-check';
import { snsUuidV5, snsComposePostId, SNS_COMPOSE_NAMESPACE } from '../sns-compose';
import { parseSnsScheduleAt } from '../sns-schedule';
import { snsFailureAction } from '../sns-retry';
import { BRAND_AI_IMAGE_NOTICE } from '../brand-message';
import {
  buildSnsCaption as viewBuild, checkSnsTag as viewCheck, extractBodyHashtags as viewExtract,
  splitTrailingTagLines as viewSplit, snsCaptionMode as viewMode, SNS_AI_IMAGE_NOTICE as VIEW_NOTICE,
  hasSnsInFlight, snsChannelSummary, snsAccountName, type SnsAccount,
} from '../../../../frontend/src/utils/sns-view';
import { snsComposePostId as viewPostId, SNS_COMPOSE_NAMESPACE as VIEW_NS } from '../../../../frontend/src/utils/sns-draft';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const ROUTE = readFileSync(resolve(__dirname, '../../routes/sns.ts'), 'utf8');
const ig = getSnsAdapter('instagram')!.capabilities;
const th = getSnsAdapter('threads')!.capabilities;

describe('캡션 CT(B-3) — 태그', () => {
  it('형식 위반은 사유를 돌려준다(말없이 버리지 않는다 · K1)', () => {
    expect(checkSnsTag('#여름 세일')).toEqual({ ok: true, tag: '여름세일' });
    expect(checkSnsTag('bad-tag')).toMatchObject({ ok: false, reason: '태그에는 한글·영문·숫자·밑줄만 쓸 수 있어요.' });
    expect(checkSnsTag('2026')).toMatchObject({ ok: false, reason: '숫자만으로는 태그가 되지 않아요.' });
    expect(checkSnsTag('ㅋㅋ')).toMatchObject({ ok: false, reason: '자음·모음만으로는 태그를 만들 수 없어요.' });
    expect(checkSnsTag('가'.repeat(51))).toMatchObject({ ok: false });
    expect(checkSnsTag('  ')).toBeNull();
  });

  it('본문 태그 — 링크 조각·숫자만·붙은 글자는 태그가 아니다', () => {
    const body = '새 메뉴 #여름 #여름 https://a.com/x#anchor abc#붙음 #1 #Summer';
    expect(extractBodyHashtags(body)).toEqual(['여름', 'Summer']);
    const spans = findBodyHashtagSpans(body);
    expect(spans.map((s) => body.slice(s.start, s.end))).toEqual(['#여름', '#여름', '#Summer']);
    expect(findSnsLinkSpans('보기 hanjul.ai/a 와 https://x.com/b').map((s) => s.text)).toEqual(['hanjul.ai/a', 'https://x.com/b']);   // 글 속 순서
  });

  it('인스타 5 · Threads 1(첫 태그만) — 공식 값', () => {
    expect(ig.maxTags).toBe(5);
    expect(th.maxTags).toBe(1);
    expect(th.tagFirstOnly).toBe(true);
  });

  it('본문 태그가 채널 태그 자리를 먼저 쓰고, 본문에 있는 칩은 두 번 붙지 않는다', () => {
    const r = buildSnsCaption({ body: '글 #여름 #카페', tags: ['카페', '디저트', '빙수', '신메뉴', '서울'], aiNotice: false }, ig);
    expect(r.bodyTags).toEqual(['여름', '카페']);
    expect(r.alreadyInBody).toEqual(['카페']);
    expect(r.keptTags).toEqual(['디저트', '빙수', '신메뉴']);   // 5 − 2 = 3
    expect(r.droppedTags).toEqual(['서울']);
    expect(r.text).toBe('글 #여름 #카페\n\n#디저트 #빙수 #신메뉴');
  });

  it('본문 태그가 상한을 넘으면 인스타만 경고 · Threads 는 표시 방식이라 경고하지 않는다', () => {
    const body = '#a1 #b2 #c3 #d4 #e5 #f6';
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, ig).bodyTagsOver).toBe(true);
    expect(buildSnsCaption({ body, tags: [], aiNotice: false }, th).bodyTagsOver).toBe(false);
  });

  it('채울 자리 표기가 남으면 게시 불가(넘침 0 이어도)', () => {
    const r = buildSnsCaption({ body: '오늘 [혜택 안내: 직접 수정해주세요] 입니다', tags: [], aiNotice: false }, ig);
    expect(r.placeholderLeft).toBe(true);
    expect(r.ok).toBe(false);
    expect(buildSnsCaption({ body: '[매장 직접 방문 시 증정]', tags: [], aiNotice: false }, ig).placeholderLeft).toBe(false);
  });

  it('AI 표시가 본문 끝 독립 줄로 이미 있으면 다시 붙이지 않는다', () => {
    const r = buildSnsCaption({ body: `글\n${BRAND_AI_IMAGE_NOTICE}`, tags: [], aiNotice: true }, ig);
    expect(r.text.split(BRAND_AI_IMAGE_NOTICE).length - 1).toBe(1);
    expect(r.aiNoticeApplied).toBe(true);
  });
});

describe('화면 미러 = 서버(같은 표에 같은 답)', () => {
  const bodies = [
    '', '글만', '글 #여름 #카페', '#a1 #b2 #c3 #d4 #e5 #f6', `사진 글\n${BRAND_AI_IMAGE_NOTICE}`,
    '링크 https://hanjul.ai/x#frag 와 #태그', '오늘 [URL 입력] 확인', 'ㄱ'.repeat(300), '줄바꿈\n\n#끝태그 #둘',
  ];
  const tagSets = [[], ['카페', '디저트'], ['여름', 'Summer', 'x_y', '서울', '부산', '대구', '광주']];

  it('buildSnsCaption — 전 채널 × 표', () => {
    for (const a of listSnsAdapters()) {
      for (const body of bodies) for (const tags of tagSets) for (const aiNotice of [false, true]) {
        const s = buildSnsCaption({ body, tags, aiNotice }, a.capabilities);
        const v = viewBuild({ body, tags, aiNotice }, a.capabilities);
        expect(v, `${a.platform} · ${JSON.stringify(body).slice(0, 30)}`).toEqual(s);
      }
    }
  });

  it('태그 판정 · 본문 태그 · 끝 태그 줄 · AI 모드', () => {
    for (const raw of ['#여름', 'bad-tag', '2026', 'ㅋㅋ', ' 가 나 ', '가'.repeat(51), '']) {
      expect(viewCheck(raw)).toEqual(checkSnsTag(raw));
    }
    for (const body of bodies) {
      expect(viewExtract(body)).toEqual(extractBodyHashtags(body));
      expect(viewSplit(body)).toEqual(splitTrailingTagLines(body));
      for (const [imageCount, videoCount] of [[0, 0], [2, 0], [0, 1]]) {
        expect(viewMode({ body, imageCount, videoCount })).toEqual(snsCaptionMode({ body, imageCount, videoCount }));
      }
    }
  });

  it('AI 표시 문구 · 자리표시 규약 · 이름 공간이 같다', () => {
    expect(VIEW_NOTICE).toBe(BRAND_AI_IMAGE_NOTICE);
    const placeholders = readFileSync(resolve(FRONT, 'utils/message-placeholders.ts'), 'utf8');
    expect(placeholders).toContain(`const BENEFIT_PLACEHOLDER_SOURCE = '${SNS_BENEFIT_PLACEHOLDER_SOURCE.replace(/\\/g, '\\\\')}'`);
    expect(placeholders).toContain(`const URL_PLACEHOLDER_SOURCE = '${SNS_URL_PLACEHOLDER_SOURCE.replace(/\\/g, '\\\\')}'`);
    expect(VIEW_NS).toBe(SNS_COMPOSE_NAMESPACE);
  });

  it('작성 구역이 태그 판정·조립을 미러로만 한다(화면 안 인라인 규칙 0)', () => {
    const COMPOSER = readFileSync(resolve(FRONT, 'components/sns/SnsComposer.tsx'), 'utf8');
    expect(COMPOSER).toMatch(/buildSnsCaption\(/);
    expect(COMPOSER).toMatch(/checkSnsTag\(/);
    expect(COMPOSER).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
    expect(COMPOSER).not.toMatch(/opus|sonnet|haiku|gpt-|claude|anthropic/i);
    // IME 조합 중 Enter 는 태그를 만들지 않는다(설계 B-5)
    expect(COMPOSER).toMatch(/isComposing \|\| e\.keyCode === 229/);
  });
});

describe('composeId — uuid v5', () => {
  it('표준 시험값(RFC 4122 DNS 이름 공간)', () => {
    expect(snsUuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('서버와 화면이 같은 게시물 id 를 만든다 · 사용자·회사가 다르면 다르다', async () => {
    const c = '11111111-1111-4111-8111-111111111111';
    const u = '22222222-2222-4222-8222-222222222222';
    const x = '33333333-3333-4333-8333-333333333333';
    expect(await viewPostId(c, u, x)).toBe(snsComposePostId(c, u, x));
    expect(snsComposePostId(c, null, x)).not.toBe(snsComposePostId(c, u, x));
  });
});

describe('AI 캡션 가드(B-6)', () => {
  const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
  const media = { images: [], imageCount: 0, videoCount: 0 };
  const base = { companyId: 'c', action: 'write' as const, tags: [], tagSet: ['카페', '여름'], media };
  beforeEach(() => { ai.mockReset(); });

  it('토큰을 잃으면 결과를 버리고 버렸다고 말한다(가짜 성공 0 · K9)', async () => {
    ai.mockResolvedValue(JSON.stringify({ caption: '링크 없이 다듬은 글', tags: [] }));
    const r = await generateSnsCaption({ ...base, body: '주문은 https://shop.kr/a 에서 하세요' });
    expect(r.changed).toBe(false);
    expect(r.caption).toBe('주문은 https://shop.kr/a 에서 하세요');
    expect(r.note).toMatch(/넣지 않았어요/);
  });

  it('토큰은 되돌리고 · 없던 태그는 지우고 · 끝 태그 줄은 그대로 다시 붙인다 · 태그는 세트 안에서만', async () => {
    ai.mockImplementation(async (p: { userMessage: string }) => {
      const keys = p.userMessage.match(/\{\{k\d+\}\}/g) ?? [];
      return JSON.stringify({ caption: `새로 다듬은 글이에요 ${keys.join(' ')} #바이럴`, tags: ['여름', '지어낸태그'] });
    });
    const r = await generateSnsCaption({ ...base, body: '글이에요 https://shop.kr/a\n\n#카페 #라떼' });
    expect(r.changed).toBe(true);
    expect(r.caption).toContain('https://shop.kr/a');
    expect(r.caption).not.toContain('#바이럴');
    expect(r.caption.endsWith('\n\n#카페 #라떼')).toBe(true);
    expect(r.tags).toEqual(['여름']);
    // 끝 태그 줄은 모델에 보내지 않는다
    expect(ai.mock.calls[0][0].userMessage).not.toContain('#라떼');
  });

  it('원문에 없던 링크를 넣으면 버린다', async () => {
    ai.mockResolvedValue(JSON.stringify({ caption: '좋은 글 evil.com 방문', tags: [] }));
    const r = await generateSnsCaption({ ...base, body: '좋은 글' });
    expect(r.changed).toBe(false);
    expect(r.note).toMatch(/링크/);
  });

  it('원문에 없던 혜택은 채울 자리로 바뀐다(게시 불가로 이어진다)', async () => {
    ai.mockResolvedValue(JSON.stringify({ caption: '오늘 30% 할인 행사', tags: [] }));
    const r = await generateSnsCaption({ ...base, body: '오늘 행사' });
    expect(r.caption).not.toContain('30%');
    expect(buildSnsCaption({ body: r.caption, tags: [], aiNotice: false }, ig).placeholderLeft).toBe(true);
  });

  it('사진 초안(Q2 가) — 숫자·행사·혜택 문장은 빠지고, 짧으면 결과 없이 한 줄 안내', async () => {
    const photo = { images: [{ media_type: 'image/jpeg', data: 'x' }], imageCount: 1, videoCount: 0 };
    ai.mockResolvedValue(JSON.stringify({ caption: '햇살 가득한 창가 자리예요. 오늘만 20% 할인! 따뜻한 라떼 한 잔 어떠세요?', tags: [] }));
    const r = await generateSnsCaption({ ...base, body: '', media: photo });
    expect(r.mode).toBe('photo_draft');
    expect(r.caption).toBe('햇살 가득한 창가 자리예요. 따뜻한 라떼 한 잔 어떠세요?');
    expect(ai.mock.calls[0][0].images).toHaveLength(1);

    ai.mockResolvedValue(JSON.stringify({ caption: '오늘만 50% 세일!', tags: [] }));
    const short = await generateSnsCaption({ ...base, body: '', media: photo });
    expect(short.changed).toBe(false);
    expect(short.caption).toBe('');
    expect(short.note).toBe('한 줄만 써 주시면 다듬어 드릴게요.');
  });

  it('영상만 · 아무것도 없음 = 잠금(AI 를 부르지 않는다)', async () => {
    const r = await generateSnsCaption({ ...base, body: '', media: { images: [], imageCount: 0, videoCount: 1 } });
    expect(r.mode).toBe('locked');
    expect(ai).not.toHaveBeenCalled();
  });

  it('다시 쓰기는 지난 안을 "피할 안"으로 싣는다(캐시 키가 바뀐다)', async () => {
    ai.mockResolvedValue(JSON.stringify({ caption: '다른 표현의 글', tags: [] }));
    await generateSnsCaption({ ...base, action: 'again', body: '원래 글', previous: '지난 안 글' });
    expect(ai.mock.calls[0][0].userMessage).toContain('지난 안 글');
  });
});

describe('맞춤법 판정(B-7)', () => {
  const body = '오늘 새로 오픈 했어요. 됬어요 확인 https://a.com 30% 할인 #해시태그 한줄로 카페';

  it('before 가 원문에 한 번일 때만 · 낱말 경계까지 넓힌 자리', () => {
    const r = judgeSnsSpellCandidates(body, [{ before: '됬어요', after: '됐어요', reason: '맞춤법' }]);
    expect(r).toHaveLength(1);
    expect(body.slice(r[0].start, r[0].end)).toBe('됬어요');
    expect(r[0]).toMatchObject({ after: '됐어요', kind: 'typo' });
    expect(judgeSnsSpellCandidates('가 가 가', [{ before: '가', after: '까' }])).toHaveLength(0);
  });

  it('띄어쓰기는 공백만 다를 때 · 공백 밖 글자가 다르면 오타로 본다', () => {
    const r = judgeSnsSpellCandidates(body, [{ before: '오픈 했어요', after: '오픈했어요' }]);
    expect(r[0].kind).toBe('spacing');
    expect(r[0].before).toBe('오픈 했어요');
  });

  it('보호 구간(링크·금액·#태그·회사명)을 건드리면 버린다', () => {
    expect(judgeSnsSpellCandidates(body, [{ before: 'https://a.com', after: 'https://b.com' }])).toHaveLength(0);
    expect(judgeSnsSpellCandidates(body, [{ before: '30% 할인', after: '30%할인' }])).toHaveLength(0);
    expect(judgeSnsSpellCandidates(body, [{ before: '#해시태그', after: '#해시 태그' }])).toHaveLength(0);
    expect(judgeSnsSpellCandidates(body, [{ before: '한줄로 카페', after: '한 줄로 카페' }], ['한줄로'])).toHaveLength(0);
  });

  it('뜻을 바꾸는 긴 교체 · 새 숫자는 버린다', () => {
    expect(judgeSnsSpellCandidates(body, [{ before: '확인', after: '살펴보기' }])).toHaveLength(0);
    expect(judgeSnsSpellCandidates('사과 세개', [{ before: '세개', after: '3개' }])).toHaveLength(0);
  });
});

describe('예약 시각 · 실패 할 일 · 폴링', () => {
  const now = Date.parse('2026-09-24T03:00:00Z');

  it('오프셋 없는 값은 한국 시간 · 60초 넘게 지난 시각은 400', () => {
    const r = parseSnsScheduleAt('2026-09-24T13:00', now);
    expect(r.ok && r.at?.toISOString()).toBe('2026-09-24T04:00:00.000Z');
    expect(parseSnsScheduleAt('2026-09-24T02:58:00Z', now)).toMatchObject({ ok: false, code: 'SCHEDULE_IN_PAST' });
    expect(parseSnsScheduleAt('내일', now)).toMatchObject({ ok: false, code: 'SCHEDULE_INVALID' });
    expect(parseSnsScheduleAt('', now)).toEqual({ ok: true, at: null });
  });

  it('실패 줄 할 일 — 결과 모름은 확인 · 끊김은 다시 연결 · 대체된 줄은 없음', () => {
    const f = { status: 'failed', platformPostId: null, lastErrorCode: null, verifyGaveUpAt: null, scheduledAt: null, superseded: false, accountActive: true };
    expect(snsFailureAction({ ...f, lastErrorCode: 'PUBLISH_OUTCOME_UNKNOWN' }, now)).toBe('check');
    expect(snsFailureAction({ ...f, accountActive: false }, now)).toBe('reconnect');
    expect(snsFailureAction({ ...f, superseded: true }, now)).toBe('none');
    expect(snsFailureAction({ ...f, scheduledAt: '2026-09-30T00:00:00Z' }, now)).toBe('retry_at');
    expect(snsFailureAction(f, now)).toBe('publish_now');
    expect(snsFailureAction({ ...f, lastErrorCode: 'MEDIA_FORMAT' }, now)).toBe('rewrite');
  });

  it('폴링 — 먼 예약은 두드리지 않고 10분 안 예약·올리는 중은 두드린다(E8)', () => {
    const t = { targetId: 't', platform: 'instagram', permalink: null, verifiedAt: null, deletedOnPlatformAt: null, verifyGaveUpAt: null, platformPostId: null, lastError: null, lastErrorCode: null };
    expect(hasSnsInFlight([{ targets: [{ ...t, status: 'scheduled', scheduledAt: new Date(now + 3_600_000).toISOString() }] }], now)).toBe(false);
    expect(hasSnsInFlight([{ targets: [{ ...t, status: 'scheduled', scheduledAt: new Date(now + 300_000).toISOString() }] }], now)).toBe(true);
    expect(hasSnsInFlight([{ targets: [{ ...t, status: 'claimed' }] }], now)).toBe(true);
    expect(hasSnsInFlight([{ targets: [{ ...t, status: 'claimed', superseded: true }] }], now)).toBe(false);
  });
});

describe('채널 카드 · 계정 이름(C5 · A-0-3)', () => {
  const acc = (over: Partial<SnsAccount>): SnsAccount => ({
    id: 'a', platform: 'instagram', username: 'shop', displayName: null, avatarUrl: null, status: 'active',
    statusReason: null, connectedAt: '2026-09-01T00:00:00Z', lastVerifiedAt: null, tokenExpiresAt: null, ...over,
  });

  it('카드 배지 = 가장 나쁜 계정(둘째 계정이 끊겨도 연결됨이던 결함 K7)', () => {
    const s = snsChannelSummary([acc({ id: 'a' }), acc({ id: 'b', username: 'two', status: 'reauth_required' })]);
    expect(s.worst?.id).toBe('b');
    expect(s.badge?.label).toBe('다시 연결 필요');
    expect(s.count).toBe(2);
    expect(s.connected).toBe(true);
    expect(snsChannelSummary([acc({ renewFailing: true })]).badge?.label).toBe('연장 확인 필요');
  });

  it('같은 채널에 같은 이름이면 연결한 날로 가른다', () => {
    const a = acc({ id: 'a', connectedAt: '2026-09-01T00:00:00Z' });
    const b = acc({ id: 'b', connectedAt: '2026-09-10T00:00:00Z' });
    expect(snsAccountName(a, [a, b])).toMatch(/^@shop · 9월 \d+일 연결$/);
    expect(snsAccountName(acc({ username: null, displayName: '매장' }), [])).toBe('매장');
    expect(snsAccountName(acc({ username: null, displayName: null }), [])).toBe('이름 없음');
  });
});

describe('라우트 정적 계약', () => {
  it('JWT 는 userId 다 — routes/sns.ts 에 user?.id 0(K6)', () => {
    expect(ROUTE).not.toMatch(/user\?\.id\b/);
  });

  it('게시는 CT 한 곳(composeSnsPost)만 · AI 한도 초과는 429', () => {
    expect(ROUTE).toMatch(/composeSnsPost\(/);
    expect(ROUTE).toMatch(/AiRateLimitExceeded'\) return res\.status\(429\)/);
  });

  it('다시 연결은 같은 응답에 승인 주소를 싣는다(C2 1탭)', () => {
    const r = ROUTE.slice(ROUTE.indexOf("router.post('/accounts/:id/reconnect'"));
    expect(r.slice(0, 800)).toMatch(/startSnsAuth\(companyId, userId, row\.platform\)/);
  });
});

describe('입력 정규화', () => {
  it('normalizeSnsTags 는 형식 위반을 빼고 대소문자 무시로 한 번만', () => {
    expect(normalizeSnsTags(['Cafe', 'cafe', 'ㅋㅋ', '#라떼'])).toEqual(['Cafe', '라떼']);
  });
});
