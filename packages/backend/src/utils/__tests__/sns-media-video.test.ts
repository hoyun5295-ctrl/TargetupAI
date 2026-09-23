/**
 * SNS 영상 업로드 · 미디어별 게시본 (2026-09-23 1차-B · docs/2026-09-23-sns-1b-design.md §3-2 · §3-5)
 *
 * 잠그는 것
 *   1. 조각은 순서대로만 받고, 같은 조각 재전송은 받은 것으로 본다(응답 유실 재시도)
 *   2. 마무리에서 moov 가 뒤에 있으면 앞당긴 파일을 보관한다(무손실 · 불변 21)
 *   3. 형식·크기 밖은 시작부터 막는다(300MB 를 올리고 거부 0)
 *   4. ⛔ D2 — 게시본은 target·미디어마다 따로다(캐러셀이 마지막 사진 N장으로 나가던 것)
 *   5. 서명 서빙 = 사진은 게시본 · 영상은 보관본 그대로
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const COMPANY = '11111111-2222-3333-4444-555555555555';
let dir: string;
let media: typeof import('../sns-media');
let probe: typeof import('../sns-video-probe');

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
}
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };

/** [ftyp][mdat(크게)][moov] — moov 가 뒤에 있는 최소 영상 */
function moovLastVideo(mdatBytes: number): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom', 'ascii'), u32(0x200), Buffer.from('isomavc1', 'ascii'));
  const mdat = box('mdat', Buffer.alloc(mdatBytes, 7));
  const mvhd = box('mvhd', u32(0), u32(0), u32(0), u32(1000), u32(5000), Buffer.alloc(80));
  const stco = box('stco', u32(0), u32(1), u32(ftyp.length + 8));
  const moov = box('moov', mvhd, box('trak', box('mdia', box('minf', box('stbl', stco)))));
  return Buffer.concat([ftyp, mdat, moov]);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-media-'));
  vi.stubEnv('SNS_MEDIA_PATH', path.join(dir, 'media'));
  vi.stubEnv('SNS_RENDER_PATH', path.join(dir, 'render'));
  vi.resetModules();
  media = await import('../sns-media');
  probe = await import('../sns-video-probe');
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function upload(file: Buffer, name = 'clip.mp4') {
  const { uploadId, chunkBytes } = await media.startSnsVideoUpload({ companyId: COMPANY, userId: null, originalName: name, totalBytes: file.length });
  for (let i = 0; i * chunkBytes < file.length; i++) {
    await media.appendSnsVideoChunk({ companyId: COMPANY, uploadId, index: i, chunk: file.subarray(i * chunkBytes, (i + 1) * chunkBytes) });
  }
  return { uploadId, chunkBytes };
}

describe('영상 조각 업로드', () => {
  it('여러 조각 → 마무리 → moov 를 앞당겨 보관한다(크기 그대로)', async () => {
    const file = moovLastVideo(5 * 1024 * 1024);   // 조각 2개
    const { uploadId } = await upload(file);
    const stored = await media.completeSnsVideoUpload({ companyId: COMPANY, uploadId });
    expect(stored.relocated).toBe(true);
    expect(stored.format).toBe('mp4');
    expect(stored.bytes).toBe(file.length);
    const abs = media.snsMediaAbsPath(stored.relPath);
    expect((await probe.probeSnsVideoFile(abs)).fastStart).toBe(true);
    expect(stored.probe.durationSec).toBeCloseTo(5, 3);
    // 세션 조각은 남지 않는다
    expect(fs.readdirSync(path.join(dir, 'media', '_incoming', COMPANY))).toEqual([]);
  });

  it('같은 조각을 다시 보내면 받은 것으로 본다 · 건너뛴 조각은 거절한다', async () => {
    const file = moovLastVideo(5 * 1024 * 1024);
    const { uploadId, chunkBytes } = await media.startSnsVideoUpload({ companyId: COMPANY, userId: null, originalName: 'a.mov', totalBytes: file.length });
    await expect(media.appendSnsVideoChunk({ companyId: COMPANY, uploadId, index: 1, chunk: file.subarray(chunkBytes) }))
      .rejects.toMatchObject({ code: 'OUT_OF_ORDER' });
    const first = await media.appendSnsVideoChunk({ companyId: COMPANY, uploadId, index: 0, chunk: file.subarray(0, chunkBytes) });
    const again = await media.appendSnsVideoChunk({ companyId: COMPANY, uploadId, index: 0, chunk: file.subarray(0, chunkBytes) });
    expect(again.received).toBe(first.received);
  });

  it('끝까지 안 올라온 영상은 마무리하지 않는다', async () => {
    const file = moovLastVideo(5 * 1024 * 1024);
    const { uploadId, chunkBytes } = await media.startSnsVideoUpload({ companyId: COMPANY, userId: null, originalName: 'b.mp4', totalBytes: file.length });
    await media.appendSnsVideoChunk({ companyId: COMPANY, uploadId, index: 0, chunk: file.subarray(0, chunkBytes) });
    await expect(media.completeSnsVideoUpload({ companyId: COMPANY, uploadId })).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });

  it('형식·크기 밖은 시작부터 막는다', async () => {
    await expect(media.startSnsVideoUpload({ companyId: COMPANY, userId: null, originalName: 'x.avi', totalBytes: 10 }))
      .rejects.toMatchObject({ code: 'BAD_FORMAT' });
    await expect(media.startSnsVideoUpload({ companyId: COMPANY, userId: null, originalName: 'x.mp4', totalBytes: media.SNS_VIDEO_MAX_BYTES + 1 }))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('영상 정보가 없는 파일은 마무리에서 거절하고 조각을 치운다', async () => {
    const junk = Buffer.from('this is not a video file at all');
    const { uploadId } = await upload(junk, 'junk.mp4');
    await expect(media.completeSnsVideoUpload({ companyId: COMPANY, uploadId })).rejects.toMatchObject({ code: 'UNREADABLE' });
  });
});

describe('⛔ D2 — 게시본은 target·미디어마다 따로다', () => {
  const T = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const M1 = '99999999-8888-7777-6666-555555555551';
  const M2 = '99999999-8888-7777-6666-555555555552';

  it('같은 target 의 사진 두 장이 다른 파일이 된다', () => {
    expect(media.snsRenderFileName(T, M1)).not.toBe(media.snsRenderFileName(T, M2));
    expect(() => media.snsRenderFileName(T, '../x')).toThrow();
  });

  it('서명 서빙 = 사진은 그 미디어의 게시본 · 영상은 보관본 그대로', () => {
    const img = media.resolveSnsServeFile({ companyId: COMPANY, targetId: T, media: { id: M1, kind: 'image', path: `${COMPANY}/a.jpg`, format: 'jpeg' } });
    expect(img.contentType).toBe('image/jpeg');
    expect(img.absPath).toContain(`${T}-${M1}.jpg`);
    const vid = media.resolveSnsServeFile({ companyId: COMPANY, targetId: T, media: { id: M2, kind: 'video', path: `${COMPANY}/v.mov`, format: 'mov' } });
    expect(vid.contentType).toBe('video/quicktime');
    expect(vid.absPath).toContain('v.mov');
  });
});
