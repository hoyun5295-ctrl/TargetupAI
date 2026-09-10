/**
 * 대행발송 MMS 이미지 자동 맞춤 (★2026-09-10 임은지 접수 cmttqx2gy0c8sjnotlvs441r1 · Harold 확정 "변환은 문제가 아니다")
 *
 * 기원
 *   양식 안내는 "화면 접수는 큰 사진도 자동 변환"이라고 적었지만, 화면·메일 둘 다 JPG·300KB가 아니면 막혔다.
 *   직원이 대행하던 시절에는 직원이 규격에 맞게 줄여 줬다 — 기계로 옮겼으면 기계가 그 일을 해야 한다.
 *
 * 못 박는 것
 *   1. 이미 규격인 JPG는 원본 바이트 그대로다(다시 인코딩하지 않는다).
 *   2. 규격 밖은 JPG · 300KB 이하 · 긴 변 1080 이하로 맞춘다. 회전 정보 반영 · 투명 배경은 흰색.
 *   3. 못 읽는 파일은 던지지 않고 사유를 돌려준다(호출부가 파일별로 반려한다).
 *   4. 메일 접수·화면 접수가 같은 함수를 지난다(배선 계약).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { LIMITS } from '../../config/defaults';
import { isJpegBuffer } from '../mms-image-util';
import {
  fitMmsImage, describeMmsFitFailure, describeMmsFitNote,
  MMS_FIT_MAX_EDGE, MMS_FIT_MAX_UPLOAD_BYTES, restoreUploadFileName,
} from '../mms-image-fit';
import {
  MMS_AUTOFIT_MAX_UPLOAD_BYTES, precheckMmsAutoFitFile,
} from '../../../../frontend/src/utils/mmsImage';

/** 압축이 안 되는 결정적 잡음(용량 큰 사진 대역) */
function noise(width: number, height: number, channels = 3): Buffer {
  const buf = Buffer.alloc(width * height * channels);
  let s = 12345;
  for (let i = 0; i < buf.length; i++) { s = (s * 1103515245 + 12345) >>> 0; buf[i] = s >>> 24; }
  return buf;
}
const bigJpeg = (w = 1600, h = 1200) =>
  sharp(noise(w, h), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();

describe('fitMmsImage: 규격 안은 그대로, 규격 밖은 맞춘다', () => {
  it('이미 규격인 JPG(300KB 이하)는 원본 바이트 그대로 돌려준다', async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#336699' } }).jpeg({ quality: 80 }).toBuffer();
    expect(small.length).toBeLessThan(LIMITS.mmsImageSize);
    const r = await fitMmsImage(small);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.converted).toBe(false);
    expect(r.buffer.equals(small), '규격 안 사진을 다시 인코딩했다(고객 원본 훼손)').toBe(true);
  });

  it('300KB 넘는 JPG는 300KB 이하 · 긴 변 1080 이하 · 순차(baseline) JPG로 줄인다', async () => {
    const big = await bigJpeg();
    expect(big.length).toBeGreaterThan(LIMITS.mmsImageSize);
    const r = await fitMmsImage(big);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.converted).toBe(true);
    expect(r.fromBytes).toBe(big.length);
    expect(r.toBytes).toBe(r.buffer.length);
    expect(isJpegBuffer(r.buffer)).toBe(true);
    expect(r.buffer.length).toBeLessThanOrEqual(LIMITS.mmsImageSize);
    const m = await sharp(r.buffer).metadata();
    expect(m.format).toBe('jpeg');
    expect(Math.max(m.width || 0, m.height || 0)).toBeLessThanOrEqual(MMS_FIT_MAX_EDGE);
    expect(m.isProgressive, '점진(progressive) JPG는 통신사 호환이 불확실하다').toBe(false);
  });

  it('PNG는 JPG로 바꾸고 투명 배경은 흰색으로 채운다', async () => {
    const png = await sharp({ create: { width: 1400, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await fitMmsImage(png);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.converted).toBe(true);
    expect(isJpegBuffer(r.buffer)).toBe(true);
    const { data } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0], '투명 부분이 검게 나왔다').toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(240);
    expect(data[2]).toBeGreaterThan(240);
  });

  it('16비트 PNG · 흑백 PNG · CMYK JPG도 규격 JPG로 맞춘다(색 공간·비트 깊이가 달라도)', async () => {
    const w = 1500;
    const h = 1000;
    const base = () => sharp(noise(w, h), { raw: { width: w, height: h, channels: 3 } });
    const inputs = {
      png16: await base().toColourspace('rgb16').png().toBuffer(),
      gray: await base().greyscale().png().toBuffer(),
      cmyk: await base().toColourspace('cmyk').jpeg({ quality: 95 }).toBuffer(),
    };
    expect((await sharp(inputs.png16).metadata()).depth).toBe('ushort');
    for (const [name, buf] of Object.entries(inputs)) {
      const r = await fitMmsImage(buf);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(isJpegBuffer(r.buffer), name).toBe(true);
      expect(r.buffer.length, name).toBeLessThanOrEqual(LIMITS.mmsImageSize);
      const m = await sharp(r.buffer).metadata();
      expect(m.depth, name).toBe('uchar');
      expect(['srgb', 'b-w'], `${name} ${m.space}`).toContain(m.space);
    }
  }, 60_000);

  it('휴대폰 사진의 회전 정보(EXIF)를 반영해 바로 세운다', async () => {
    // 가로로 저장된 픽셀 + "90도 돌려 보라"는 표식(6) = 세로 사진
    const rotated = await sharp(noise(1200, 600), { raw: { width: 1200, height: 600, channels: 3 } })
      .jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    expect(rotated.length).toBeGreaterThan(LIMITS.mmsImageSize);
    const r = await fitMmsImage(rotated);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.buffer).metadata();
    expect(m.height || 0, '누운 채로 나간다').toBeGreaterThan(m.width || 0);
  });
});

describe('fitMmsImage: 못 읽는 파일은 사유를 돌려준다(던지지 않는다)', () => {
  it('SVG는 사진이 아니라 받지 않는다(허용 목록 밖)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const r = await fitMmsImage(svg);
    expect(r).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('이미지가 아닌 바이트는 unreadable', async () => {
    const r = await fitMmsImage(Buffer.from('이건 사진이 아닙니다'.repeat(20)));
    expect(r).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('아이폰 고효율 사진(HEIC)을 못 읽으면 heic 사유로 따로 알린다', async () => {
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write('ftyp', 4, 'ascii');
    ftyp.write('heic', 8, 'ascii');
    ftyp.write('mif1', 16, 'ascii');
    ftyp.write('heic', 20, 'ascii');
    const r = await fitMmsImage(Buffer.concat([ftyp, Buffer.alloc(200, 7)]));
    expect(r).toEqual({ ok: false, reason: 'heic' });
  });

  it('화소 수가 상한을 넘으면 too_many_pixels(디코드 폭탄 방어)', async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const r = await fitMmsImage(png, { maxPixels: 5000 });
    expect(r).toEqual({ ok: false, reason: 'too_many_pixels' });
  });

  it('끝까지 줄여도 상한을 못 맞추면 cannot_fit', async () => {
    const r = await fitMmsImage(await bigJpeg(), { maxBytes: 200 });
    expect(r).toEqual({ ok: false, reason: 'cannot_fit' });
  });
});

describe('사유·안내 문구 (사용자 노출 · 줄표 0)', () => {
  it('실패 사유는 파일명을 담고, 무엇을 하면 되는지 말한다', () => {
    for (const reason of ['heic', 'unsupported', 'too_many_pixels', 'unreadable', 'cannot_fit'] as const) {
      const msg = describeMmsFitFailure('포스터.png', reason);
      expect(msg.startsWith('포스터.png: '), reason).toBe(true);
      expect(msg, reason).not.toMatch(/[—–]/);
      expect(msg.length, reason).toBeGreaterThan(15);
    }
    expect(describeMmsFitFailure('사진.heic', 'heic')).toContain('HEIC');
  });

  it('줄인 사진 안내는 원래 크기와 줄인 크기를 함께 적는다', () => {
    const note = describeMmsFitNote('포스터.png', 2_400_000, 280_000);
    expect(note).toContain('포스터.png');
    expect(note).toContain('2.3MB');
    expect(note).toContain('273KB');
    expect(note).not.toMatch(/[—–]/);
  });

  it('multer가 latin1로 준 한글 파일명을 되돌린다(이미 한글이면 그대로)', () => {
    const latin1 = Buffer.from('★9월-대표이미지.jpg', 'utf8').toString('latin1');
    expect(restoreUploadFileName(latin1)).toBe('★9월-대표이미지.jpg');
    expect(restoreUploadFileName('대표.jpg')).toBe('대표.jpg');
    expect(restoreUploadFileName('')).toBe('');
  });
});

describe('화면 접수 사전 검사 = 서버 상한과 같은 값', () => {
  it('프론트 원본 상한과 서버 업로드 상한이 같다(갈리면 한쪽이 거짓 안내)', () => {
    expect(MMS_AUTOFIT_MAX_UPLOAD_BYTES).toBe(MMS_FIT_MAX_UPLOAD_BYTES);
  });

  it('자동 맞춤 화면은 PNG·큰 JPG를 받고, 사진이 아닌 파일과 상한 초과만 막는다', () => {
    expect(precheckMmsAutoFitFile({ name: '포스터.png', size: 2_000_000, type: 'image/png' })).toBeNull();
    expect(precheckMmsAutoFitFile({ name: '큰사진.jpg', size: 5_000_000, type: 'image/jpeg' })).toBeNull();
    expect(precheckMmsAutoFitFile({ name: '사진.heic', size: 1_000_000, type: '' })).toBeNull();
    expect(precheckMmsAutoFitFile({ name: '문서.pdf', size: 1000, type: 'application/pdf' })).toMatch(/사진 파일만/);
    expect(precheckMmsAutoFitFile({ name: '거대.jpg', size: MMS_AUTOFIT_MAX_UPLOAD_BYTES + 1, type: 'image/jpeg' })).toMatch(/20MB/);
  });
});

describe('배선 계약: 두 입구가 같은 함수를 지나고, 다른 발송 화면은 그대로다', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
  const FRONT = '../../../../frontend/src';

  it('메일 접수: 규격 검사 대신 맞춤 준비를 거치고, 저장은 맞춘 바이트다', () => {
    const worker = read('../agency-send-mail-worker.ts');
    expect(worker).toMatch(/await prepareMailMmsImages\(imageAtts\)/);
    expect(worker).toMatch(/saveMmsImageBuffer\(unitAcct\.companyId, preparedImages\[i\]\.buffer\)/);
    expect(worker, '원본 첨부를 그대로 저장하면 줄인 결과가 버려진다').not.toMatch(/saveMmsImageBuffer\(unitAcct\.companyId, imageAtts\[i\]\.content/);
    expect(worker, '옛 규격 반려 함수가 되살아났다').not.toMatch(/validateMailMmsImages/);
    const email = read('../agency-send-email.ts');
    expect(email).toMatch(/await fitMmsImage\(/);
  });

  it('메일 회신은 줄인 사진을 알린다(조용히 바꾸지 않는다)', () => {
    const worker = read('../agency-send-mail-worker.ts');
    expect(worker).toMatch(/imageFitNotes: multi \? \[\] : savedImageFitNotes/);
    expect(worker).toMatch(/규격에 맞게 바꿔 붙인 이미지/);
  });

  it('회신 재시도(첫 회신 도달 실패)에도 이미지 맞춤 규칙을 알린다 · 새 컬럼은 읽지 않는다(Codex 1R medium)', () => {
    const worker = read('../agency-send-mail-worker.ts');
    const retry = worker.slice(worker.indexOf('async function retryPendingReplies'), worker.indexOf('// ────────────── tick'));
    expect(retry.length).toBeGreaterThan(100);
    expect(retry).toMatch(/recipient_count, file_name, mms_image_paths\s/);
    expect(retry).toMatch(/const hasImages = req\.rows\.some\(\(r: any\) => Array\.isArray\(r\.mms_image_paths\) && r\.mms_image_paths\.length > 0\)/);
    expect(retry).toMatch(/\.\.\.\(hasImages \? \['첨부 이미지는 규격/);
    // DDL 전에 이 SELECT가 통째로 실패하면 재시도 패스가 멈춘다(requested_at_original과 같은 이유) — 주석이 아니라 SQL만 본다
    const select = retry.slice(retry.indexOf('`SELECT id, subject'), retry.indexOf('FROM agency_send_requests WHERE id = ANY'));
    expect(select.length).toBeGreaterThan(20);
    expect(select, '재시도 SELECT가 새 컬럼을 읽는다').not.toMatch(/mms_image_names/);
  });

  it('화면 접수: 대행발송 전용 업로드 라우트가 자격 확인 뒤 같은 함수로 맞춰 저장한다', () => {
    const route = read('../../routes/agency-send.ts');
    expect(route).toMatch(/router\.post\('\/mms-image', requireAgencySendMw, mmsImageUpload,/);
    const seg = route.slice(route.indexOf("router.post('/mms-image'"));
    expect(seg.indexOf('await fitMmsImage(')).toBeGreaterThan(0);
    expect(seg.indexOf('saveMmsImageBuffer(')).toBeGreaterThan(seg.indexOf('await fitMmsImage('));
  });

  it('대행발송 두 화면만 자동 맞춤 업로드를 켠다', () => {
    for (const f of ['components/agency/AgencySendComposer.tsx', 'components/agency/AgencyOneStepModal.tsx']) {
      const src = read(`${FRONT}/${f}`);
      // 서버가 사진을 바꾸면 안내를 띄운다(조용히 바꾸지 않는다)
      expect(src, f).toMatch(/useMmsUpload\(\(m\) => toast\.error\(m\), \{ \.\.\.AGENCY_MMS_UPLOAD, onNotice: \(m\) => toast\.info\(m\) \}\)/);
      expect(src, f).toMatch(/<MmsUploadModal\s+autoFit/);
    }
    const api = read(`${FRONT}/components/agency/agency-send-api.ts`);
    expect(api).toMatch(/uploadUrl: '\/api\/agency-send\/mms-image'/);
    expect(api).toMatch(/autoFit: true/);
  });

  it('직접발송·AI Operator는 옵션을 안 넘긴다(기존 규격 업로드 그대로)', () => {
    for (const f of ['pages/Dashboard.tsx', 'pages/AiOperatorPage.tsx']) {
      const src = read(`${FRONT}/${f}`);
      expect(src, f).toMatch(/useMmsUpload\(\(msg\) =>/);
      expect(src, f).not.toMatch(/autoFit/);
    }
    const hook = read(`${FRONT}/hooks/useMmsUpload.ts`);
    expect(hook, '기본 업로드 경로가 바뀌었다').toMatch(/opts\?\.uploadUrl \|\| '\/api\/mms-images\/upload'/);
  });
});
