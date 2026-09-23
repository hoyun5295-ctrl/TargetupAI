/**
 * SNS 1차-B 어댑터 요청 형태 (2026-09-23 · docs/2026-09-23-sns-1b-design.md §2 · §3-7)
 *
 * ⚠ 기준 = 공식 문서(raw 전). 이 테스트는 "문서가 적은 형태로 보내는가"를 잠근다 — 실측에서 다르면
 *   어댑터 블록과 이 테스트를 **같이** 고친다(문서 기준 값이 코드 한 곳·테스트 한 곳에만 있게).
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSnsAdapter, isSnsPublishAdapter, type ISnsPublishAdapter, type SnsPublishRequest } from '../sns';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Call = { url: string; init?: RequestInit };
function mockFetch(responder: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = responder(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  return calls;
}
function formOf(c: Call): URLSearchParams {
  return new URLSearchParams(String(c.init?.body ?? ''));
}
function pub(p: 'instagram' | 'threads' | 'facebook_page' | 'x'): ISnsPublishAdapter {
  const a = getSnsAdapter(p);
  if (!isSnsPublishAdapter(a)) throw new Error('not publish adapter');
  return a;
}
const video = { kind: 'video' as const, url: 'https://h/api/sns/m/V', absPath: '', mime: 'video/mp4', bytes: 10 };
const image = (n: number) => ({ kind: 'image' as const, url: `https://h/api/sns/m/I${n}`, absPath: '', mime: 'image/jpeg', bytes: 10 });
function req(media: SnsPublishRequest['media'], format = 'feed'): SnsPublishRequest {
  return { externalAccountId: 'ACC', accessToken: 'TOK', caption: '글 #태그', format, media };
}

describe('인스타 릴스', () => {
  it('영상 1개 = REELS + video_url + share_to_feed', async () => {
    const calls = mockFetch(() => ({ body: { id: 'C1' } }));
    const r = await pub('instagram').createPost(req([video], 'video'));
    expect(r).toEqual({ containerId: 'C1', ready: false });
    expect(calls[0].url).toBe('https://graph.instagram.com/ACC/media');
    const f = formOf(calls[0]);
    expect(f.get('media_type')).toBe('REELS');
    expect(f.get('video_url')).toBe(video.url);
    expect(f.get('share_to_feed')).toBe('true');
    expect(f.get('caption')).toBe('글 #태그');
  });

  it('영상과 사진을 섞으면 보내지 않는다', async () => {
    const calls = mockFetch(() => ({ body: { id: 'x' } }));
    await expect(pub('instagram').createPost(req([video, image(1)]))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('상태 확인은 status_code 를 축으로 보고 status 를 사유로 남긴다', async () => {
    mockFetch(() => ({ body: { status_code: 'ERROR', status: 'Error: 2207026' } }));
    const st = await pub('instagram').pollContainer(req([video]), 'C1');
    expect(st).toMatchObject({ raw: 'ERROR', ready: false, failed: true, detail: 'Error: 2207026' });
  });
});

describe('Threads 영상', () => {
  it('영상 1개 = VIDEO + video_url + text', async () => {
    const calls = mockFetch(() => ({ body: { id: 'T1' } }));
    await pub('threads').createPost(req([video], 'video'));
    expect(calls[0].url).toBe('https://graph.threads.net/ACC/threads');
    const f = formOf(calls[0]);
    expect(f.get('media_type')).toBe('VIDEO');
    expect(f.get('video_url')).toBe(video.url);
    expect(f.get('text')).toBe('글 #태그');
  });

  it('처리 실패 사유는 error_message 원문', async () => {
    mockFetch(() => ({ body: { status: 'ERROR', error_message: 'INVALID_DURATION' } }));
    expect((await pub('threads').pollContainer(req([video]), 'T1')).detail).toBe('INVALID_DURATION');
  });
});

describe('페이스북 페이지', () => {
  it('로그인 1회 → 페이지 N개 · 페이지 토큰 · 글쓰기 권한 판정 · 로그인한 사람 id 를 남긴다', async () => {
    const calls = mockFetch((c) => {
      if (c.url.includes('/me/accounts')) {
        return { body: { data: [
          { id: 'P1', name: '한줄로', access_token: 'PT1', tasks: ['CREATE_CONTENT', 'ANALYZE'], picture: { data: { url: 'https://img/1' } } },
          { id: 'P2', name: '보기만', access_token: 'PT2', tasks: ['ANALYZE'] },
        ] } };
      }
      return { body: { id: 'U9' } };
    });
    const list = await pub('facebook_page').fetchAccounts!('LONG_USER_TOKEN');
    expect(calls[0].url).toContain('/v26.0/me?');
    expect(calls[1].url).toContain('/v26.0/me/accounts?');
    expect(list.map((a) => a.profile.externalAccountId)).toEqual(['P1', 'P2']);
    expect(list[0].token.accessToken).toBe('PT1');
    expect(list[0].token.expiresAt).toBeNull();
    expect(list[0].profile.eligible).toBe(true);
    expect(list[1].profile.eligible).toBe(false);
    expect(list[0].profile.raw).toMatchObject({ owner_user_id: 'U9' });
  });

  it('createPost 는 밖에 아무것도 보내지 않는다(실제 게시는 publish 에서만)', async () => {
    const calls = mockFetch(() => ({ body: {} }));
    const r = await pub('facebook_page').createPost(req([image(1)]));
    expect(r.ready).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('글 · 사진 · 여러 장 · 영상의 경로와 본문', async () => {
    let calls = mockFetch(() => ({ body: { id: 'POST' } }));
    await pub('facebook_page').publish(req([]), 'direct');
    expect(calls[0].url).toBe('https://graph.facebook.com/v26.0/ACC/feed');
    expect(formOf(calls[0]).get('message')).toBe('글 #태그');

    calls = mockFetch(() => ({ body: { id: 'PH', post_id: 'ACC_PH' } }));
    expect((await pub('facebook_page').publish(req([image(1)]), 'direct')).platformPostId).toBe('ACC_PH');
    expect(calls[0].url).toBe('https://graph.facebook.com/v26.0/ACC/photos');
    expect(formOf(calls[0]).get('url')).toBe(image(1).url);
    expect(formOf(calls[0]).get('caption')).toBe('글 #태그');

    let n = 0;
    calls = mockFetch((c) => ({ body: { id: c.url.endsWith('/photos') ? `F${++n}` : 'MULTI' } }));
    expect((await pub('facebook_page').publish(req([image(1), image(2)]), 'direct')).platformPostId).toBe('MULTI');
    expect(formOf(calls[0]).get('published')).toBe('false');
    const feed = formOf(calls[2]);
    expect(calls[2].url).toBe('https://graph.facebook.com/v26.0/ACC/feed');
    expect(JSON.parse(feed.get('attached_media[0]')!)).toEqual({ media_fbid: 'F1' });
    expect(JSON.parse(feed.get('attached_media[1]')!)).toEqual({ media_fbid: 'F2' });

    calls = mockFetch(() => ({ body: { id: 'VID' } }));
    expect((await pub('facebook_page').publish(req([video], 'video'), 'direct')).platformPostId).toBe('VID');
    expect(calls[0].url).toBe('https://graph-video.facebook.com/v26.0/ACC/videos');
    expect(formOf(calls[0]).get('file_url')).toBe(video.url);
    expect(formOf(calls[0]).get('description')).toBe('글 #태그');
  });

  it('영상은 처리 중이면 아직 없는 것으로 본다 · 끝나면 절대 주소 permalink', async () => {
    mockFetch(() => ({ body: { id: 'VID', status: { video_status: 'processing' } } }));
    expect((await pub('facebook_page').fetchPost(req([], 'video'), 'VID')).exists).toBe(false);
    mockFetch(() => ({ body: { id: 'VID', status: { video_status: 'ready' }, permalink_url: '/page/videos/VID/' } }));
    expect(await pub('facebook_page').fetchPost(req([], 'video'), 'VID')).toMatchObject({ exists: true, permalink: 'https://www.facebook.com/page/videos/VID/' });
  });
});

describe('X', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-x-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const creds = { clientId: 'CID', clientSecret: 'SEC', redirectUri: 'https://h/api/sns/auth/callback/x' };

  it('토큰 교환 = Basic 인증 + code_verifier', async () => {
    const calls = mockFetch(() => ({ body: { access_token: 'AT', refresh_token: 'RT', expires_in: 7200, scope: 'tweet.write' } }));
    const t = await pub('x').exchangeToken(creds, 'CODE', { codeVerifier: 'VER' });
    expect(calls[0].url).toBe('https://api.x.com/2/oauth2/token');
    expect((calls[0].init?.headers as any).Authorization).toBe(`Basic ${Buffer.from('CID:SEC').toString('base64')}`);
    const f = formOf(calls[0]);
    expect(f.get('grant_type')).toBe('authorization_code');
    expect(f.get('code_verifier')).toBe('VER');
    expect(t.refreshToken).toBe('RT');
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('갱신은 refresh token 으로 하고 새로 온 값을 돌려준다(1회용 대비)', async () => {
    const calls = mockFetch(() => ({ body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 } }));
    const t = await pub('x').refreshToken(creds, 'AT', 'RT');
    expect(formOf(calls[0]).get('grant_type')).toBe('refresh_token');
    expect(formOf(calls[0]).get('refresh_token')).toBe('RT');
    expect(t).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2' });
    await expect(pub('x').refreshToken(creds, 'AT', null)).rejects.toThrow();
  });

  it('글만 = 업로드 0 · 게시 본문은 text 만', async () => {
    let calls = mockFetch(() => ({ body: {} }));
    const c = await pub('x').createPost(req([]));
    expect(calls).toHaveLength(0);
    calls = mockFetch(() => ({ body: { data: { id: 'TW1', text: '글' } } }));
    expect((await pub('x').publish(req([]), c.containerId)).platformPostId).toBe('TW1');
    expect(calls[0].url).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ text: '글 #태그' });
  });

  it('사진 = media/upload(tweet_image) 뒤 media_ids 로 게시', async () => {
    const f1 = path.join(dir, 'a.jpg');
    fs.writeFileSync(f1, Buffer.from([0xff, 0xd8, 0xff]));
    let n = 0;
    const calls = mockFetch((c) => (c.url.endsWith('/2/media/upload') ? { body: { data: { id: `M${++n}` } } } : { body: { data: { id: 'TW' } } }));
    const media = [{ ...image(1), absPath: f1 }, { ...image(2), absPath: f1 }];
    const c = await pub('x').createPost(req(media));
    expect(c).toEqual({ containerId: 'M1,M2', ready: true });
    const up = calls[0].init?.body as FormData;
    expect(up.get('media_category')).toBe('tweet_image');
    await pub('x').publish(req(media), c.containerId);
    expect(JSON.parse(String(calls[2].init?.body)).media).toEqual({ media_ids: ['M1', 'M2'] });
  });

  it('영상 = initialize → append(segment_index) → finalize · STATUS 로 처리 확인', async () => {
    const f = path.join(dir, 'v.mp4');
    fs.writeFileSync(f, Buffer.alloc(5 * 1024 * 1024, 1));   // 조각 2개
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/initialize')) return { body: { data: { id: '777' } } };
      if (c.url.endsWith('/finalize')) return { body: { data: { id: '777', processing_info: { state: 'pending' } } } };
      if (c.url.includes('command=STATUS')) return { body: { data: { processing_info: { state: 'succeeded' } } } };
      return { body: { data: {} } };
    });
    const v = { ...video, absPath: f, bytes: 5 * 1024 * 1024 };
    const c = await pub('x').createPost(req([v], 'video'));
    expect(c).toEqual({ containerId: '777', ready: false });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ media_type: 'video/mp4', total_bytes: v.bytes, media_category: 'tweet_video' });
    const appends = calls.filter((x) => x.url.includes('/append'));
    expect(appends).toHaveLength(2);
    expect((appends[1].init?.body as FormData).get('segment_index')).toBe('1');
    expect(calls.some((x) => x.url.endsWith('/777/finalize'))).toBe(true);
    const st = await pub('x').pollContainer(req([v], 'video'), '777');
    expect(st.ready).toBe(true);
  });

  it('확인은 1건 조회 · 주소는 사용자 이름 없이 열리는 형태', async () => {
    mockFetch(() => ({ body: { data: { id: 'TW9', text: '글' } } }));
    expect(await pub('x').fetchPost(req([]), 'TW9')).toEqual({ exists: true, permalink: 'https://x.com/i/web/status/TW9' });
    mockFetch(() => ({ status: 404, body: {} }));
    expect((await pub('x').fetchPost(req([]), 'TW9')).exists).toBe(false);
  });
});
