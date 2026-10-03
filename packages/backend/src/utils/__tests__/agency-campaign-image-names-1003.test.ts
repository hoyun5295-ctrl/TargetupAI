/**
 * 대행발송 MMS 이미지 이름이 발송 결과 창에서만 UUID 로 보인다 (★2026-10-03 임은지 접수 `cmuq9mfkq0ap1jnn4n8edjbww` · 한국시세이도)
 *
 * 옛: 접수 원장(agency_send_requests)은 원본 파일명을 mms_image_names 에 따로 두지만(0910 · B-0910-9),
 *   워커가 발송 캠페인을 만들 때 경로 배열만 넘겨 campaigns.mms_image_paths 에는 저장 파일명(UUID)만 남았다.
 *   발송 결과 · 예약대기 · 캘린더 창은 캠페인 칸을 읽으므로 UUID 가 보였다(BUGS B-0910-10 2번이 예고한 자리).
 * 처방: 워커가 원장 두 칸을 묶어 {path, originalName} 으로 넘긴다(직접발송 · AI 발송이 이미 저장하는 모양).
 *   발송 배관은 normalizeMmsImagePaths 로 경로만 읽으므로 무변경이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withMmsImageNames, normalizeMmsImagePaths, getMmsImageDisplayName } from '../mms-image-util';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const P1 = '/srv/mms/c1/d5aeb931-8bd2-4802-b070-6aee2c57304a.jpg';
const P2 = '/srv/mms/c1/11111111-2222-4333-8444-555555555555.jpg';

describe('withMmsImageNames (백엔드 · 프론트 utils/mmsImage 와 같은 규칙)', () => {
  it('이름이 있는 칸만 {path, originalName} 이 되고 빈칸은 원래 항목 그대로다', () => {
    expect(withMmsImageNames([P1, P2], ['정기 프로모션 1.jpg', ''])).toEqual([
      { path: P1, originalName: '정기 프로모션 1.jpg' },
      P2,
    ]);
  });

  it('이름 칸이 없으면(옛 접수 · DDL 전) 경로 배열 그대로다', () => {
    expect(withMmsImageNames([P1], null)).toEqual([P1]);
    expect(withMmsImageNames([P1], undefined)).toEqual([P1]);
  });

  it('이름이 모자라거나 넘치면 경로 수에 맞춘다 · 앞뒤 공백은 지운다', () => {
    expect(withMmsImageNames([P1, P2], ['  a.jpg  '])).toEqual([{ path: P1, originalName: 'a.jpg' }, P2]);
    expect(withMmsImageNames([P1], ['a.jpg', 'b.jpg'])).toEqual([{ path: P1, originalName: 'a.jpg' }]);
  });

  it('묶은 뒤에도 발송 배관이 읽는 경로는 같고 표시 이름은 원본이다', () => {
    const items = withMmsImageNames([P1, P2], ['정기 프로모션 1.jpg', '']);
    expect(normalizeMmsImagePaths(items)).toEqual([P1, P2]);
    expect(getMmsImageDisplayName(items[0])).toBe('정기 프로모션 1.jpg');
    expect(getMmsImageDisplayName(items[1])).toBe('11111111-2222-4333-8444-555555555555.jpg');
  });
});

describe('대행발송 워커 → 발송 캠페인', () => {
  it('원장의 원본 파일명을 묶어 캠페인에 넘긴다', () => {
    const w = src('utils/agency-send-worker.ts');
    expect(w).toContain('mmsImagePaths: images.length > 0 ? withMmsImageNames(images, row.mms_image_names) : null,');
  });

  it('캠페인 spec 은 객체 항목을 받는 형이다(직접발송 commit 이 이미 객체를 넘긴다)', () => {
    expect(src('utils/direct-send-spec.ts')).toContain('mmsImagePaths?: MmsImageItem[] | null;');
  });
});
