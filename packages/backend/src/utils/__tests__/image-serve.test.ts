/**
 * image-serve.test.ts — 서빙 이미지 최적화 계약 (2026-09-08)
 *
 * 경위 = 남지현 접수 진단 중 발견한 "1792×2400 · 2.4MB 원본이 메일에 그대로 실려 나감".
 * 이 테스트가 지키는 것 = ①큰 것은 줄어든다 ②작은 것·애니메이션·깨진 파일은 건드리지 않는다
 * ③실패해도 이미지는 나간다(원본 폴백) ④품질 하한(표시 기준 1400px · JPEG 92).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { getServePath, SERVE_MAX_WIDTH, SERVE_JPEG_QUALITY, isOptimizableImage } from '../image-serve';

let dir = '';

const makeJpeg = async (name: string, width: number, height: number): Promise<string> => {
  const p = path.join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 200 } } })
    .jpeg({ quality: 95 })
    .toFile(p);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-serve-'));
});

afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 무시 */ }
});

describe('서빙 이미지 최적화 — 품질 기준과 폴백', () => {
  it('품질 기준값 — 표시 폭(이메일 본문 552 · 셸 600)의 2배 이상을 남긴다', () => {
    expect(SERVE_MAX_WIDTH).toBeGreaterThanOrEqual(1200);
    expect(SERVE_JPEG_QUALITY).toBeGreaterThanOrEqual(90);
  });

  it('큰 원본은 표시 기준 폭으로 줄어들고 원본 파일은 그대로 남는다', async () => {
    const src = await makeJpeg('big.jpg', 1792, 2400);
    const before = fs.statSync(src);

    const served = await getServePath(src);
    expect(served).not.toBe(src);                                  // 변환본이 나간다
    const meta = await sharp(served).metadata();
    expect(meta.width).toBe(SERVE_MAX_WIDTH);
    expect(fs.statSync(served).size).toBeLessThan(before.size);     // 용량이 줄었다

    const after = fs.statSync(src);
    expect(after.size).toBe(before.size);                           // ⛔ 원본 무변경(품질이 필요하면 되돌린다)
  });

  it('표시 기준 안의 원본은 그대로 낸다 (재인코딩은 품질만 깎는다)', async () => {
    const src = await makeJpeg('small.jpg', 800, 600);
    expect(await getServePath(src)).toBe(src);
  });

  it('두 번째 요청은 만들어 둔 변환본을 재사용한다', async () => {
    const src = await makeJpeg('cache.jpg', 2000, 1000);
    const first = await getServePath(src);
    const stat1 = fs.statSync(first);
    const second = await getServePath(src);
    expect(second).toBe(first);
    expect(fs.statSync(second).mtimeMs).toBe(stat1.mtimeMs);        // 다시 만들지 않았다
  });

  it('원본이 교체되면 변환본을 다시 만든다', async () => {
    const src = await makeJpeg('replace.jpg', 2000, 1000);
    const first = await getServePath(src);
    // 크기로 판정하면 단색 그림끼리 우연히 같아진다 — 색으로 본다(첫 그림은 g < r).
    const firstPx = await sharp(first).resize(1, 1).raw().toBuffer();
    expect(firstPx[1]).toBeLessThan(firstPx[0]);
    // 다른 그림으로 교체(폭도 다르게) + mtime 을 미래로 밀어 교체를 확정한다.
    // sharp가 방금 읽은 경로에 그대로 쓰면 윈도우에서 잠기므로 버퍼로 만들어 덮어쓴다.
    const replaced = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 10, g: 200, b: 60 } } })
      .jpeg({ quality: 95 }).toBuffer();
    fs.writeFileSync(src, replaced);
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(src, future, future);

    const again = await getServePath(src);
    expect(again).toBe(first);                                      // 경로는 같고
    const againPx = await sharp(again).resize(1, 1).raw().toBuffer();
    expect(againPx[1]).toBeGreaterThan(againPx[0]);                 // 내용은 새 원본(g > r)에서 다시 만들어졌다
  });

  it('애니메이션 GIF는 손대지 않는다 (프레임이 깨진다)', async () => {
    const src = path.join(dir, 'anim.gif');
    fs.writeFileSync(src, Buffer.from('GIF89a fake', 'utf8'));
    expect(await getServePath(src)).toBe(src);
    expect(isOptimizableImage('anim.gif')).toBe(false);
  });

  it('깨진 파일·없는 파일은 원본 경로로 흘린다 (서빙은 실패보다 원본이 낫다)', async () => {
    const broken = path.join(dir, 'broken.jpg');
    fs.writeFileSync(broken, Buffer.from('이건 이미지가 아니다', 'utf8'));
    expect(await getServePath(broken)).toBe(broken);

    const missing = path.join(dir, 'nope.jpg');
    expect(await getServePath(missing)).toBe(missing);
  });

  it('PNG는 무손실로 줄인다 (투명도·경계 보존)', async () => {
    const src = path.join(dir, 'big.png');
    await sharp({ create: { width: 2000, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png().toFile(src);
    const served = await getServePath(src);
    const meta = await sharp(served).metadata();
    expect(meta.width).toBe(SERVE_MAX_WIDTH);
    expect(meta.channels).toBe(4);                                  // 알파 채널 유지
  });
});
