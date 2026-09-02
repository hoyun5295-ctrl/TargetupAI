/**
 * 브랜드 자유형 이미지의 카카오 콘텐츠 서버 확정 계약 (★2026-09-02)
 *
 * 왜 있나
 *   `img_url`에 우리 서버 URL을 실으면 **큐에는 들어가고 발송만 죽는다**(2026-09-01 실측 =
 *   IMAGE 2건 `status_code 9999`, 같은 구조의 TEXT 건은 1800 성공). 화면에도 오류가 안 뜨므로
 *   이 치환이 살아 있는지는 테스트가 지켜야 한다.
 *
 * 못 박는 것
 *   ①우리 서빙 URL은 업로드를 거쳐 카카오 URL로 바뀐다 ②이미 올린 것은 다시 올리지 않는다
 *   ③남의 회사 자산·경로 조작은 거절한다 ④창구를 모르는 유형·외부 URL은 손대지 않는다
 *   ⑤업로드 실패·응답 이상은 **발송을 세운다**(조용히 옛 URL로 나가지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 저장 경로는 모듈 로드 시점에 env로 굳는다 — import보다 먼저 정해야 한다.
const IMG_DIR = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs');
  const nodeOs = require('os') as typeof import('os');
  const nodePath = require('path') as typeof import('path');
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'brand-img-'));
  process.env.INAPP_IMAGE_PATH = dir;
  return dir;
});

vi.mock('../config/database', () => ({ query: vi.fn() }));
// 업로드 두 창구만 대역으로 바꾼다 — 응답 해석(extractImageFromAnyShape)은 실물을 쓴다.
// (대역이 실물보다 관대하면 래핑 변종을 못 잡는 코드를 통과시킨다)
vi.mock('./alimtalk-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./alimtalk-api')>();
  return { ...actual, uploadBrandDefaultImage: vi.fn(), uploadBrandWideImage: vi.fn() };
});

import { query } from '../config/database';
import * as imc from './alimtalk-api';
import { resolveBrandSendImage, resolveBrandSendAttachmentJson, BrandImageResolveError } from './brand-image-resolver';

const queryMock = vi.mocked(query);
const uploadDefault = vi.mocked(imc.uploadBrandDefaultImage);
const uploadWide = vi.mocked(imc.uploadBrandWideImage);

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const FILE = 'c81c3ea7-d179-47fa-b6ca-023fd785fdc0.jpg';
const OWN_REL = `/api/cdp/inapp/image/${COMPANY}/${FILE}`;
const OWN_ABS = `https://hanjul.ai${OWN_REL}`;
const KAKAO = 'https://mud-kage.kakao.com/dn/abc/img_l.jpg';

/** SELECT(캐시 조회)는 빈 결과, INSERT(기록)는 무응답으로 둔다 */
function noCache() {
  queryMock.mockImplementation(async (sql: any) => {
    if (String(sql).includes('SELECT')) return { rows: [] } as any;
    return { rows: [] } as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const dir = path.join(IMG_DIR, COMPANY);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), Buffer.from('fake-image-bytes'));
  noCache();
  uploadDefault.mockResolvedValue({ code: '0000', message: 'OK', data: { imageUrl: KAKAO, imageName: 'img_l.jpg' } } as any);
  uploadWide.mockResolvedValue({ code: '0000', message: 'OK', data: { imageUrl: KAKAO, imageName: 'img_l.jpg' } } as any);
});

describe('우리 서빙 URL → 카카오 URL 치환', () => {
  it('상대 경로를 업로드해 카카오 URL로 바꾼다', async () => {
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    expect(out?.img_url).toBe(KAKAO);
    expect(uploadDefault).toHaveBeenCalledTimes(1);
    // 파일 내용이 그대로 올라간다(경로 조립이 맞다는 증거)
    expect(uploadDefault.mock.calls[0][0].toString()).toBe('fake-image-bytes');
  });

  it('절대 URL(우리 호스트)도 같은 결과다', async () => {
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_ABS } });
    expect(out?.img_url).toBe(KAKAO);
  });

  it('WIDE는 와이드 창구로 올린다 — 창구가 섞이면 규격이 어긋난다', async () => {
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'WIDE', image: { img_url: OWN_REL } });
    expect(out?.img_url).toBe(KAKAO);
    expect(uploadWide).toHaveBeenCalledTimes(1);
    expect(uploadDefault).not.toHaveBeenCalled();
  });

  it('img_link·asset_id는 보존한다(판정·클릭 링크가 사라지면 안 된다)', async () => {
    const out = await resolveBrandSendImage({
      companyId: COMPANY, bubbleType: 'IMAGE',
      image: { img_url: OWN_REL, img_link: 'https://shop.example.com', asset_id: 'a-1' },
    });
    expect(out).toEqual({ img_url: KAKAO, img_link: 'https://shop.example.com', asset_id: 'a-1' });
  });

  it('입력 객체를 그 자리에서 바꾸지 않는다 — 호출부가 원본 URL로 이미 판정을 끝냈다', async () => {
    const input = { img_url: OWN_REL };
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: input });
    expect(input.img_url).toBe(OWN_REL);
  });

  it('IMC 응답이 문자열 image 키 변종이어도 URL을 뽑는다(D146 래핑)', async () => {
    uploadDefault.mockResolvedValue({ code: '0000', data: { image: KAKAO } } as any);
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    expect(out?.img_url).toBe(KAKAO);
  });
});

describe('캐시하지 않는다 — 카카오 URL의 수명을 우리가 모른다 (Codex 1R high3)', () => {
  it('같은 이미지를 두 번 발송하면 두 번 올린다', async () => {
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    expect(uploadDefault).toHaveBeenCalledTimes(2);
  });

  it('업로드 이력은 남긴다 — 재사용이 아니라 다음 발송의 허용 목록 근거다', async () => {
    await resolveBrandSendImage({ companyId: COMPANY, userId: 'u-1', bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO kakao_image_uploads'));
    expect(insert?.[1]).toEqual([COMPANY, 'u-1', 'brand_send_default', 'img_l.jpg', KAKAO, FILE, 16]);
  });

  it('기록이 실패해도 그 발송은 계속된다', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT')) throw new Error('insert failed');
      return { rows: [] };
    });
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    expect(out?.img_url).toBe(KAKAO);
  });

  it('만료 컬럼을 조회 조건으로 쓰지 않는다 — 캐시를 걷어냈으므로 볼 이유가 없다', async () => {
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } });
    for (const c of queryMock.mock.calls) expect(String(c[0])).not.toContain('expired_at');
  });
});

describe('손대지 않는 것', () => {
  it('우리가 올린 URL이면 그대로 둔다(재발송·예약 건)', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM kakao_image_uploads')) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    });
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: KAKAO } });
    expect(out?.img_url).toBe(KAKAO);
    expect(uploadDefault).not.toHaveBeenCalled();
  });

  it('창구를 모르는 유형은 통과시킨다 — 창구를 추측하면 규격이 어긋난다', async () => {
    const out = await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'COMMERCE', image: { img_url: OWN_REL } });
    expect(out?.img_url).toBe(OWN_REL);
    expect(uploadDefault).not.toHaveBeenCalled();
  });

  it('이미지가 없으면 아무 일도 하지 않는다', async () => {
    expect(await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE' })).toBeUndefined();
    expect(await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: '  ' } }))
      .toEqual({ img_url: '  ' });
    expect(uploadDefault).not.toHaveBeenCalled();
  });
});

describe('거절해야 하는 것', () => {
  it('다른 회사 자산 경로는 거절한다', async () => {
    await expect(resolveBrandSendImage({
      companyId: COMPANY, bubbleType: 'IMAGE',
      image: { img_url: `/api/cdp/inapp/image/${OTHER}/${FILE}` },
    })).rejects.toBeInstanceOf(BrandImageResolveError);
    expect(uploadDefault).not.toHaveBeenCalled();
  });

  it('파일이 없으면 거절한다 — 옛 URL로 조용히 나가지 않는다', async () => {
    await expect(resolveBrandSendImage({
      companyId: COMPANY, bubbleType: 'IMAGE',
      image: { img_url: `/api/cdp/inapp/image/${COMPANY}/없는파일.jpg` },
    })).rejects.toBeInstanceOf(BrandImageResolveError);
  });

  it('카카오가 거절하면(code != 0000) 발송을 세운다', async () => {
    uploadDefault.mockResolvedValue({ code: '9001', message: '이미지 규격 오류' } as any);
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } }))
      .rejects.toThrow(/이미지/);
  });

  it('업로드가 던지면 발송을 세운다', async () => {
    uploadDefault.mockRejectedValue(new Error('network down'));
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } }))
      .rejects.toBeInstanceOf(BrandImageResolveError);
  });

  it('응답에 URL이 없으면 발송을 세운다', async () => {
    uploadDefault.mockResolvedValue({ code: '0000', data: {} } as any);
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } }))
      .rejects.toBeInstanceOf(BrandImageResolveError);
  });

  it('IMC 오류 원문을 사용자 문구에 그대로 싣지 않는다', async () => {
    uploadDefault.mockRejectedValue(new Error('POST /kakao-management/api/v1/attach/brand-message/default 500'));
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: OWN_REL } }))
      .rejects.toThrow(/^이미지를 카카오에 등록하지 못했습니다/);
  });
});

describe('발송 경로 순서 계약 — 판정이 먼저, 치환이 나중', () => {
  it('sendBrandMessage에서 AI 판정이 이미지 치환보다 앞선다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './brand-message.ts'), 'utf8');
    const send = src.slice(src.indexOf('export async function sendBrandMessage'));
    const judge = send.indexOf('isBrandImageAiGenerated');
    const resolveCall = send.indexOf('resolveBrandSendImage');
    const build = send.indexOf('buildAttachmentJson');
    expect(judge).toBeGreaterThan(-1);
    expect(resolveCall).toBeGreaterThan(-1);
    // 판정 → 치환 → 조립. 치환이 앞서면 판정 근거(우리 서빙 URL)가 사라져 안내 문구가 조용히 빠진다.
    expect(judge).toBeLessThan(resolveCall);
    expect(resolveCall).toBeLessThan(build);
  });

  it('조립기에는 원본이 아니라 치환된 이미지가 들어간다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './brand-message.ts'), 'utf8');
    const send = src.slice(src.indexOf('export async function sendBrandMessage'));
    const attach = send.slice(send.indexOf('buildAttachmentJson'), send.indexOf('carouselJson'));
    expect(attach).toContain('image: sendImage');
    expect(attach).not.toContain('image: params.image');
  });
});

describe('문자열 attachmentJson 경로 — AI 캠페인·직접발송·워커가 쓰는 입구', () => {
  it('JSON 안의 img_url을 치환해 돌려준다', async () => {
    const raw = JSON.stringify({ image: { img_url: OWN_REL, img_link: 'https://shop' }, button: [{ name: '보기', type: 'WL' }] });
    const out = await resolveBrandSendAttachmentJson({ companyId: COMPANY, bubbleType: 'IMAGE', attachmentJson: raw });
    const parsed = JSON.parse(String(out));
    expect(parsed.image.img_url).toBe(KAKAO);
    // 나머지 키는 손대지 않는다 — 버튼·링크가 사라지면 발송물이 달라진다
    expect(parsed.image.img_link).toBe('https://shop');
    expect(parsed.button).toEqual([{ name: '보기', type: 'WL' }]);
  });

  it('빈 값·이미지 없는 첨부는 그대로 둔다', async () => {
    expect(await resolveBrandSendAttachmentJson({ companyId: COMPANY, bubbleType: 'IMAGE', attachmentJson: null })).toBeNull();
    const noImg = JSON.stringify({ button: [{ name: '보기', type: 'WL' }] });
    expect(await resolveBrandSendAttachmentJson({ companyId: COMPANY, bubbleType: 'TEXT', attachmentJson: noImg })).toBe(noImg);
    expect(uploadDefault).not.toHaveBeenCalled();
  });

  it('깨진 JSON은 삼키지 않고 그대로 넘긴다 — 사유는 조립기가 만든다', async () => {
    const bad = '{not json';
    expect(await resolveBrandSendAttachmentJson({ companyId: COMPANY, bubbleType: 'IMAGE', attachmentJson: bad })).toBe(bad);
  });

  it('우리가 올린 URL이면 문자열을 그대로 돌려준다(재직렬화도 하지 않는다)', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM kakao_image_uploads')) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    });
    const raw = JSON.stringify({ image: { img_url: KAKAO } });
    expect(await resolveBrandSendAttachmentJson({ companyId: COMPANY, bubbleType: 'IMAGE', attachmentJson: raw })).toBe(raw);
  });

  it('업로드 실패는 여기서도 발송을 세운다', async () => {
    uploadDefault.mockResolvedValue({ code: '9001', message: '규격 오류' } as any);
    await expect(resolveBrandSendAttachmentJson({
      companyId: COMPANY, bubbleType: 'IMAGE',
      attachmentJson: JSON.stringify({ image: { img_url: OWN_REL } }),
    })).rejects.toThrow(/이미지/);
  });
});

/**
 * 조립기를 부르는 경로는 넷이다. 하나라도 치환을 빠뜨리면 그 경로만 조용히 죽는다
 * (조립기 게이트가 잡아 주지만, 잡히면 그 경로는 발송 자체가 멈춘다).
 * 소스를 텍스트로 읽어 대조한다 — 선례 = brand-image-endpoint-parity.test.ts.
 */
describe('조립기 호출 경로 4곳이 모두 치환을 거친다', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('sendBrandMessage — 객체 경로', () => {
    const src = read('./brand-message.ts');
    expect(src).toContain("from './brand-image-resolver'");
    expect(src.slice(src.indexOf('export async function sendBrandMessage'))).toContain('resolveBrandSendImage');
  });

  it('AI 캠페인 — preflight 결과를 조립기에 넘긴다', () => {
    const src = read('../routes/campaigns.ts');
    expect(src).toContain('prepareBrandAttachmentForSend');
    const decl = src.slice(src.indexOf('const brandPreflight ='), src.indexOf('const kakaoCarouselJson ='));
    expect(decl).toContain('prepareBrandAttachmentForSend');
    expect(decl).toContain('const kakaoAttachmentJson = brandPreflight.attachmentJson');
  });

  it('직접발송 — 조립 인자가 치환된 변수다', () => {
    const src = read('../routes/campaigns.ts');
    const call = src.slice(src.indexOf('const directBrandPayload = buildBrandQueuePayload('));
    const args = call.slice(0, call.indexOf('});'));
    expect(args).toContain('attachmentJson: directKakaoAttachmentJson');
    expect(args).not.toContain('attachmentJson: kakaoAttachmentJson');
  });

  /**
   * ★Codex 2R high3 — 예약·대량 경로는 **청크마다** processSendChunk를 부른다.
   * 그래서 preflight는 그 안이 아니라 **워커의 청크 루프 밖**에 있어야 한다.
   * 캐시를 없앤 뒤로 이 자리가 틀리면 같은 이미지를 청크 수만큼 올린다.
   */
  it('워커 — 청크 루프 밖에서 캠페인당 한 번만 preflight를 돌린다', () => {
    const src = read('./direct-send-worker.ts');
    const iPre = src.indexOf('prepareBrandAttachmentForSend({');
    const iLoop = src.indexOf('while (processed < total)');
    expect(iPre).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(-1);
    expect(iPre).toBeLessThan(iLoop);
    // 청크에 확정된 값과 판정 결과를 함께 넘긴다
    const call = src.slice(src.indexOf('const result = await processSendChunk({'));
    const args = call.slice(0, call.indexOf('});'));
    expect(args).toContain('kakaoImageAiGenerated: brandPreflight.aiGenerated');
    expect(args).toContain('kakaoAttachmentJson: brandPreflight.attachmentJson');
  });

  it('청크 처리기는 preflight를 부르지 않는다 — 청크 수만큼 반복되는 자리다', () => {
    const src = read('./direct-send-processor.ts');
    expect(src).not.toContain('prepareBrandAttachmentForSend');
    const call = src.slice(src.indexOf('const brandPayload = buildBrandQueuePayload('));
    expect(call.slice(0, call.indexOf('});'))).toContain('attachmentJson: resolvedAttachmentJson');
  });

  it('문자열 경로 3곳 전부 AI 안내를 붙일 수 있다 — 판정 결과를 실제로 쓴다', () => {
    const camp = read('../routes/campaigns.ts');
    const proc = read('./direct-send-processor.ts');
    expect(camp).toContain('brandPreflight.aiGenerated');
    expect(camp).toContain('directBrandPreflight.aiGenerated');
    // 워커가 판정해 넘긴 값을 청크 처리기가 소비한다
    expect(proc).toContain('p.kakaoImageAiGenerated');
    // 부착은 CT를 쓴다(문구를 인라인으로 다시 만들지 않는다)
    expect(camp).toContain('appendAiImageNotice');
    expect(proc).toContain('appendAiImageNotice');
  });
});

describe('허용 목록 — 우리가 올린 것만 통과한다 (Codex 1R high1)', () => {
  it('이력에 없는 외부 URL은 거절한다 — API 직접 호출로 화면 제거를 우회할 수 없다', async () => {
    await expect(resolveBrandSendImage({
      companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: 'https://evil.example.com/x.jpg' },
    })).rejects.toBeInstanceOf(BrandImageResolveError);
  });

  it('이력에 없는 카카오 도메인 URL도 거절한다 — 타사 소재 재사용 통로가 된다', async () => {
    await expect(resolveBrandSendImage({
      companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: KAKAO },
    })).rejects.toBeInstanceOf(BrandImageResolveError);
  });

  it('판정은 회사 경계로 한다 — 조회에 그 회사 id가 실린다', async () => {
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: KAKAO } })
      .catch(() => undefined);
    const sel = queryMock.mock.calls.find((c) => String(c[0]).includes('FROM kakao_image_uploads'));
    expect(sel?.[1]?.[0]).toBe(COMPANY);
  });

  it('문자열 경로도 같은 판정을 받는다', async () => {
    await expect(resolveBrandSendAttachmentJson({
      companyId: COMPANY, bubbleType: 'IMAGE',
      attachmentJson: JSON.stringify({ image: { img_url: 'https://evil.example.com/x.jpg' } }),
    })).rejects.toBeInstanceOf(BrandImageResolveError);
  });
});

describe('허용 목록은 업로드 유형까지 본다 (Codex 2R high1)', () => {
  it('조회 조건에 회사·URL·업로드 유형 셋이 실린다', async () => {
    await resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'WIDE', image: { img_url: KAKAO } })
      .catch(() => undefined);
    const sel = queryMock.mock.calls.find((c) => String(c[0]).includes('FROM kakao_image_uploads'));
    expect(sel?.[1]).toEqual([COMPANY, KAKAO, 'brand_send_wide']);
  });

  it('IMAGE로 올린 URL을 WIDE 발송에 실으면 거절한다 — 규격이 다르면 같은 9999가 난다', async () => {
    queryMock.mockImplementation(async (sql, params) => {
      const p = params as any[];
      if (String(sql).includes('FROM kakao_image_uploads')) {
        return { rows: p?.[2] === 'brand_send_default' ? [{ ok: 1 }] : [] };
      }
      return { rows: [] };
    });
    // 같은 URL이 IMAGE로는 통과하고
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'IMAGE', image: { img_url: KAKAO } }))
      .resolves.toEqual({ img_url: KAKAO });
    // WIDE로는 거절된다
    await expect(resolveBrandSendImage({ companyId: COMPANY, bubbleType: 'WIDE', image: { img_url: KAKAO } }))
      .rejects.toBeInstanceOf(BrandImageResolveError);
  });
});
