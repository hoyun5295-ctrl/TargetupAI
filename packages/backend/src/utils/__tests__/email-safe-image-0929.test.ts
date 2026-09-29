/**
 * 메일에 싣는 사진 = 메일 프로그램이 다 보여 주는 형식(JPEG·PNG·GIF)만
 * (★2026-09-29 서수란 접수 cmukvvy0z014hjna6gvsefoo2 "AI영업 이메일 하이웍스는 보이는데 아웃룩은 이미지 깨짐")
 *
 * 실측(Harold SQL 0929 · 토니모리 최신 메일 판): 사진 9장 중 1~2번 png·jpeg = 아웃룩 정상 · 3~9번 상품 사진 = WebP(RIFF…WEBP) = 아웃룩 "연결된 이미지를 표시할 수 없습니다".
 * 같은 메일 · 같은 서버 주소에서 형식만 갈랐다(윈도우용 아웃룩은 WebP 를 못 그린다 · 하이웍스는 브라우저가 그린다).
 * 처방 = 메일이 나가는 입구 두 곳(영업 메일 · 일반 메일)에서 우리 저장소 사진 중 WebP·AVIF·HEIC(파일 머리로 판별)를
 *   옆에 만든 JPEG(투명이면 PNG) 사본 주소로 갈아 끼운다. 저장된 메일 판 · DM · 미리보기는 그대로.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { emailSafeImageHtml, emailSafeCopyPaths, sniffImageFormat, clearEmailSafeImageCache } from '../email-safe-image';

const CO = '11111111-2222-3333-4444-555555555555';
let root = '';
let inapp = '';
let dm = '';
const opts = () => ({ dirs: { inapp, dm }, hosts: ['hanjul.ai'] });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-safe-'));
  inapp = path.join(root, 'inapp');
  dm = path.join(root, 'dm');
  fs.mkdirSync(path.join(inapp, CO), { recursive: true });
  fs.mkdirSync(path.join(dm, CO), { recursive: true });
  const rgb = { create: { width: 40, height: 30, channels: 3 as const, background: { r: 200, g: 80, b: 40 } } };
  const rgba = { create: { width: 40, height: 30, channels: 4 as const, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } };
  fs.writeFileSync(path.join(inapp, CO, 'p1.webp'), await sharp(rgb).webp().toBuffer());
  fs.writeFileSync(path.join(inapp, CO, 'alpha.webp'), await sharp(rgba).webp().toBuffer());
  fs.writeFileSync(path.join(inapp, CO, 'ok.jpeg'), await sharp(rgb).jpeg().toBuffer());
  fs.writeFileSync(path.join(inapp, CO, 'ok.png'), await sharp(rgba).png().toBuffer());
  // 이름은 .jpeg 인데 속은 AVIF(수집 경로가 image/avif 를 jpeg 로 이름 붙이던 경우) — 확장자가 아니라 파일 머리로 가른다
  fs.writeFileSync(path.join(inapp, CO, 'fake.jpeg'), await sharp(rgb).avif().toBuffer());
  fs.writeFileSync(path.join(dm, CO, 'up.webp'), await sharp(rgb).webp().toBuffer());
  fs.writeFileSync(path.join(inapp, CO, 'broken.webp'), Buffer.from('RIFF\0\0\0\0WEBPVP8 garbage'));
});
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ } });

describe('sniffImageFormat — 파일 머리로 형식을 가른다', () => {
  it('webp · avif(이름이 jpeg여도) · jpeg · png', () => {
    expect(sniffImageFormat(fs.readFileSync(path.join(inapp, CO, 'p1.webp')))).toBe('webp');
    expect(sniffImageFormat(fs.readFileSync(path.join(inapp, CO, 'fake.jpeg')))).toBe('avif');
    expect(sniffImageFormat(fs.readFileSync(path.join(inapp, CO, 'ok.jpeg')))).toBe('jpeg');
    expect(sniffImageFormat(fs.readFileSync(path.join(inapp, CO, 'ok.png')))).toBe('png');
  });
});

describe('emailSafeImageHtml — 우리 저장소의 WebP·AVIF 만 JPEG·PNG 사본 주소로', () => {
  it('WebP(불투명) → 옆에 .mail.jpg 사본(실제 JPEG) · 절대 주소의 호스트·쿼리는 그대로', async () => {
    clearEmailSafeImageCache();
    const src = `<img src="https://hanjul.ai/api/cdp/inapp/image/${CO}/p1.webp?fit=1x1" alt="">`;
    const out = await emailSafeImageHtml(src, opts());
    expect(out).toBe(`<img src="https://hanjul.ai/api/cdp/inapp/image/${CO}/p1.webp.mail.jpg?fit=1x1" alt="">`);
    const copy = path.join(inapp, CO, 'p1.webp.mail.jpg');
    expect(sniffImageFormat(fs.readFileSync(copy))).toBe('jpeg');
    const meta = await sharp(fs.readFileSync(copy)).metadata();
    expect([meta.width, meta.height]).toEqual([40, 30]);
  });
  it('투명 WebP → .mail.png(투명 유지) · 이름만 jpeg 인 AVIF → .mail.jpg', async () => {
    clearEmailSafeImageCache();
    const out = await emailSafeImageHtml(`<img src="/api/cdp/inapp/image/${CO}/alpha.webp"><img src="/api/cdp/inapp/image/${CO}/fake.jpeg">`, opts());
    expect(out).toContain(`/api/cdp/inapp/image/${CO}/alpha.webp.mail.png"`);
    expect(out).toContain(`/api/cdp/inapp/image/${CO}/fake.jpeg.mail.jpg"`);
    const meta = await sharp(fs.readFileSync(path.join(inapp, CO, 'alpha.webp.mail.png'))).metadata();
    expect(meta.hasAlpha).toBe(true);
  });
  it('DM 업로드 경로(/api/dm/v/images)도 같다 · 배경 이미지(url()) 속 주소도 바꾼다', async () => {
    clearEmailSafeImageCache();
    const out = await emailSafeImageHtml(`<td style="background-image:url('https://hanjul.ai/api/dm/v/images/${CO}/up.webp')">`, opts());
    expect(out).toContain(`/api/dm/v/images/${CO}/up.webp.mail.jpg'`);
    expect(fs.existsSync(path.join(dm, CO, 'up.webp.mail.jpg'))).toBe(true);
  });
  it('이미 메일에서 보이는 형식(JPEG·PNG)은 손대지 않는다', async () => {
    const src = `<img src="https://hanjul.ai/api/cdp/inapp/image/${CO}/ok.jpeg"><img src="/api/cdp/inapp/image/${CO}/ok.png">`;
    expect(await emailSafeImageHtml(src, opts())).toBe(src);
  });
  it('남의 호스트 · 외부 WebP · 우리 저장소에 없는 파일은 그대로(바꿀 수 없는 것은 건드리지 않는다)', async () => {
    const src = `<img src="https://evil.example/api/cdp/inapp/image/${CO}/p1.webp"><img src="https://cdn.example.com/a.webp"><img src="/api/cdp/inapp/image/${CO}/none.webp">`;
    expect(await emailSafeImageHtml(src, opts())).toBe(src);
  });
  it('변환 실패(깨진 파일)면 원래 주소 그대로 — 사진 때문에 발송이 멈추지 않는다', async () => {
    clearEmailSafeImageCache();
    const src = `<img src="/api/cdp/inapp/image/${CO}/broken.webp">`;
    expect(await emailSafeImageHtml(src, opts())).toBe(src);
    expect(fs.existsSync(path.join(inapp, CO, 'broken.webp.mail.jpg'))).toBe(false);
  });
  it('두 번째부터는 만든 사본을 그대로 쓴다(다시 변환하지 않는다) · 같은 사진이 여러 번 나와도 전부 바꾼다', async () => {
    clearEmailSafeImageCache();
    const src = `<img src="/api/cdp/inapp/image/${CO}/p1.webp"><img src="/api/cdp/inapp/image/${CO}/p1.webp">`;
    const first = await emailSafeImageHtml(src, opts());
    const copy = path.join(inapp, CO, 'p1.webp.mail.jpg');
    const mtime = fs.statSync(copy).mtimeMs;
    clearEmailSafeImageCache();   // 프로세스가 다시 떠도(기억 없음) 디스크의 사본을 다시 쓴다
    const second = await emailSafeImageHtml(src, opts());
    expect(second).toBe(first);
    expect((second.match(/p1\.webp\.mail\.jpg/g) || []).length).toBe(2);
    expect(fs.statSync(copy).mtimeMs).toBe(mtime);
  });
  it('사진이 없는 메일 · 빈 값은 그대로', async () => {
    expect(await emailSafeImageHtml('<p>안녕하세요</p>', opts())).toBe('<p>안녕하세요</p>');
    expect(await emailSafeImageHtml('', opts())).toBe('');
  });
});

describe('사본 정리 · 입구 배선', () => {
  it('원본 경로 → 지울 사본 경로(jpg·png 둘 다)', () => {
    expect(emailSafeCopyPaths('/x/co/a.webp')).toEqual(['/x/co/a.webp.mail.jpg', '/x/co/a.webp.mail.png']);
  });
  it('dropServeVariants(원본) = 메일 사본 · 사본의 서빙 변환본까지 실제로 지운다', async () => {
    const { dropServeVariants } = await import('../image-serve');
    const dir = path.join(root, 'drop');
    fs.mkdirSync(path.join(dir, '.opt', '1400'), { recursive: true });
    const orig = path.join(dir, 'z.webp');
    for (const f of [orig, `${orig}.mail.jpg`, path.join(dir, '.opt', '1400', 'z.webp.mail.jpg'), path.join(dir, '.opt', '1400', 'z.webp')]) fs.writeFileSync(f, 'x');
    fs.unlinkSync(orig);
    dropServeVariants(orig);
    expect(fs.readdirSync(dir).filter((f) => f !== '.opt')).toEqual([]);
    expect(fs.readdirSync(path.join(dir, '.opt', '1400'))).toEqual([]);
  });
  it('원본을 지우는 CT(dropServeVariants)가 메일 사본도 지운다 · AI 영업 파기도 그 CT 를 부른다', () => {
    const serve = fs.readFileSync(path.resolve(__dirname, '../image-serve.ts'), 'utf-8');
    const drop = serve.slice(serve.indexOf('export function dropServeVariants('), serve.indexOf('export function getServePath('));
    expect(drop).toContain('emailSafeCopyPaths(originalPath)');
    const purge = fs.readFileSync(path.resolve(__dirname, '../sales-outreach-purge.ts'), 'utf-8');
    const unlink = purge.slice(purge.indexOf('export function unlinkPublicImage('), purge.indexOf('export interface PurgeResult'));
    expect(unlink).toContain('dropServeVariants(filePath)');
  });
  it('메일이 나가는 입구 두 곳 모두 보내기 직전에 사진을 바꾼다', () => {
    const smtp = fs.readFileSync(path.resolve(__dirname, '../company-smtp-client.ts'), 'utf-8');
    const send = smtp.slice(smtp.indexOf('export async function sendEmail('));
    expect(send.indexOf('await emailSafeImageHtml(input.htmlBody)')).toBeGreaterThan(0);
    expect(send.indexOf('await emailSafeImageHtml(input.htmlBody)')).toBeLessThan(send.indexOf('transporter.sendMail('));
    const outreach = fs.readFileSync(path.resolve(__dirname, '../outreach-mailer.ts'), 'utf-8');
    const via = outreach.slice(outreach.indexOf('async function sendViaOutreachAccount('));
    expect(via.indexOf('await emailSafeImageHtml(input.html)')).toBeGreaterThan(0);
    expect(via.indexOf('await emailSafeImageHtml(input.html)')).toBeLessThan(via.indexOf('transporter.sendMail('));
  });
});
