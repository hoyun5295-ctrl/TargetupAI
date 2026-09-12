/**
 * 대행발송 상세 "받는 사람별 발송 내용" 이미지 = 저장한 원본 파일명 + 눌러서 크게 보기
 * (★2026-09-10 임은지 접수 cmtuvoicy0crcjnot7ohbi79s)
 *
 * 기원
 *   세 입구(화면 접수·원스텝·메일)가 이미지 **경로만** 저장하고 원본 파일명을 버렸다.
 *   공용 표시 CT는 원본명이 없으면 저장 파일명(UUID)을 쓰므로 "a1ecb988-….jpg"로 보였다.
 *   발송 결과 창은 원본명을 보여 주고 눌러서 크게 볼 수 있다 — 같은 모습이 요구다.
 *
 * 구조
 *   원본명은 경로 배열과 **따로** `agency_send_requests.mms_image_names`(jsonb · 경로와 같은 순서)에 둔다.
 *   경로 배열(`mms_image_paths`)은 문자열 그대로라 발송 배관(담당자 테스트 문자 file_name1~3 · 접수 검증 ·
 *   예약 적재)은 한 줄도 안 바뀐다(불변 23 "코어에는 경로 문자열 배열로 넘긴다").
 *   컬럼은 존재 확인(`hasAgencyColumn` = information_schema) 뒤에만 싣는다 — DDL 전에 코드가 올라가도
 *   접수는 멈추지 않고 지금처럼 UUID로 보인다.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { alignMmsImageNames } from '../mms-image-util';
import { withMmsImageNames, getMmsImageDisplayName } from '../../../../frontend/src/utils/mmsImage';

const AUTH = { companyId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' };
const PRE = {
  registeredSet: new Set(['0500000000']),
  window: { startHour: 0, endHour: 24 } as { startHour: number | null; endHour: number | null },
};
const IMG_A = '/srv/uploads/mms/c1/aaaaaaaa-0000-4000-8000-000000000001.jpg';
const IMG_B = '/srv/uploads/mms/c1/bbbbbbbb-0000-4000-8000-000000000002.jpg';

/** 접수 코어가 외부 트랜잭션으로 부르는 연결을 흉내 낸다(쿼리 기록 · 컬럼 존재 여부 주입) */
function fakeClient(existingColumns: string[]) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return {
    calls,
    async query(sql: string, params: any[] = []) {
      calls.push({ sql, params });
      // ★2026-09-12 컬럼 탐지는 테이블까지 대조한다(`hasAgencyColumn`이 두 테이블을 본다).
      //   목록에 'x'만 적으면 `agency_send_requests.x`로 읽고, 다른 테이블은 'table.column'으로 적는다.
      if (sql.includes('information_schema.columns')) {
        const [table, column] = params;
        const known = existingColumns.includes(`${table}.${column}`)
          || (table === 'agency_send_requests' && existingColumns.includes(column));
        return { rows: known ? [{ ok: 1 }] : [] };
      }
      if (sql.includes('INSERT INTO agency_send_requests')) return { rows: [{ id: 'req-1' }] };
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ c: 1 }] };
      return { rows: [] };
    },
  };
}

function mmsInput(extra: Record<string, any> = {}) {
  return {
    messageType: 'MMS',
    subject: '가을 행사',
    content: '원본 파일명 계약 테스트 문안',
    callbackNumber: '0500000000',
    managerPhones: ['010-0000-1111'],
    requestedAt: new Date(Date.now() + 200 * 60000).toISOString(),
    mmsImagePaths: [IMG_A, IMG_B],
    recipients: [{ phone: '01000001111', vars: {} }],
    ...extra,
  };
}

/** hasAgencyColumn 캐시(모듈 전역)가 사례끼리 섞이지 않게 사례마다 코어를 새로 불러온다 */
async function freshCore() {
  vi.resetModules();
  return (await import('../agency-send-intake')).createRequestCore;
}
const insertOf = (c: ReturnType<typeof fakeClient>) => c.calls.find((q) => q.sql.includes('INSERT INTO agency_send_requests'))!;

describe('alignMmsImageNames: 원본명 배열을 경로 배열에 맞춘다', () => {
  it('길이를 경로 수에 맞추고(모자라면 빈칸 · 넘치면 자름) 앞뒤 공백을 걷는다', () => {
    expect(alignMmsImageNames(['  대표.jpg ', 'b.png', 'c.jpg'], 2)).toEqual(['대표.jpg', 'b.png']);
    expect(alignMmsImageNames(['a.jpg'], 3)).toEqual(['a.jpg', '', '']);
  });
  it('문자열이 아닌 값·배열이 아닌 입력은 빈칸으로 둔다', () => {
    expect(alignMmsImageNames([1, null, { x: 1 }], 3)).toEqual(['', '', '']);
    expect(alignMmsImageNames('a.jpg', 1)).toEqual(['']);
    expect(alignMmsImageNames(undefined, 0)).toEqual([]);
  });
  it('장당 200자까지만 둔다(표시용)', () => {
    expect(alignMmsImageNames(['가'.repeat(300)], 1)[0].length).toBe(200);
  });
  it('자를 때 이모지를 반쪽으로 남기지 않는다(짝 없는 서로게이트 = PG jsonb가 거절 = 접수 실패)', () => {
    const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const cut = alignMmsImageNames(['가'.repeat(199) + '\u{1F600}x'], 1)[0];
    expect(LONE.test(cut), '200번째 자리에서 이모지가 쪼개졌다').toBe(false);
    expect(cut.endsWith('\u{1F600}')).toBe(true);
    // 원래부터 깨진 이름(짝 없는 서로게이트)도 걸러서 싣는다
    expect(alignMmsImageNames(['ab\uD800cd.jpg'], 1)[0]).toBe('abcd.jpg');
  });
});

describe('접수 코어: 컬럼이 있을 때만 원본명을 싣는다 (행동)', () => {
  // 사례마다 모듈을 새로 부르므로 첫 로드(모듈 그래프 변환)를 미리 한 번 해 둔다.
  //   전체 스위트 병렬 실행에서 첫 동적 import가 기본 5초를 넘긴 실측이 있다(단독 2.3초)
  beforeAll(async () => { await import('../agency-send-intake'); }, 60_000);
  const T = 30_000;

  it('컬럼이 있으면 경로와 같은 순서의 원본명을 jsonb 문자열로 싣는다', async () => {
    const core = await freshCore();
    const c = fakeClient(['mms_image_names']);
    const r = await core(AUTH, mmsInput({ mmsImageNames: ['★9월-대표이미지.jpg', '포스터.png'] }), c, PRE);
    expect(r.ok).toBe(true);
    const ins = insertOf(c);
    expect(ins.sql).toContain('mms_image_names');
    expect(ins.params).toContain(JSON.stringify(['★9월-대표이미지.jpg', '포스터.png']));
    // 경로 배열은 문자열 그대로(발송 배관 계약)
    expect(ins.params).toContain(JSON.stringify([IMG_A, IMG_B]));
  }, T);

  it('컬럼이 없으면(DDL 전) 싣지 않고 접수는 그대로 된다', async () => {
    const core = await freshCore();
    const c = fakeClient([]);
    const r = await core(AUTH, mmsInput({ mmsImageNames: ['a.jpg', 'b.jpg'] }), c, PRE);
    expect(r.ok).toBe(true);
    expect(insertOf(c).sql).not.toContain('mms_image_names');
  }, T);

  it('이미지가 없는 접수는 원본명을 싣지 않는다', async () => {
    const core = await freshCore();
    const c = fakeClient(['mms_image_names']);
    const r = await core(AUTH, mmsInput({ messageType: 'LMS', mmsImagePaths: [], mmsImageNames: ['a.jpg'] }), c, PRE);
    expect(r.ok).toBe(true);
    expect(insertOf(c).sql).not.toContain('mms_image_names');
  }, T);

  it('원본명이 모자라면 빈칸으로 맞춰 싣는다(순서가 어긋나지 않게)', async () => {
    const core = await freshCore();
    const c = fakeClient(['mms_image_names']);
    await core(AUTH, mmsInput({ mmsImageNames: ['a.jpg'] }), c, PRE);
    expect(insertOf(c).params).toContain(JSON.stringify(['a.jpg', '']));
  }, T);
});

describe('withMmsImageNames(프론트 CT): 경로 + 원본명 → 공용 표시 CT가 원본명을 쓴다', () => {
  it('원본명이 있으면 그 이름으로 보인다', () => {
    const items = withMmsImageNames([IMG_A, IMG_B], ['★9월-대표이미지.jpg', '포스터.png']);
    expect(items.map((it) => getMmsImageDisplayName(it))).toEqual(['★9월-대표이미지.jpg', '포스터.png']);
  });
  it('원본명이 없는 칸·옛 접수(null)는 지금처럼 저장 파일명으로 보인다', () => {
    expect(getMmsImageDisplayName(withMmsImageNames([IMG_A, IMG_B], ['대표.jpg', ''])[1])).toBe('bbbbbbbb-0000-4000-8000-000000000002.jpg');
    expect(withMmsImageNames([IMG_A], null)).toEqual([IMG_A]);
    expect(withMmsImageNames([IMG_A], undefined)).toEqual([IMG_A]);
  });
});

describe('배선 계약: 세 입구가 원본명을 넘기고, 상세 두 화면이 원본명과 확대를 쓴다', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
  const FRONT = '../../../../frontend/src';

  it('접수 코어: 존재 확인 뒤에만 컬럼을 싣는다(DDL 후행 안전)', () => {
    const intake = read('../agency-send-intake.ts');
    expect(intake).toMatch(/images\.length > 0 && await hasAgencyColumn\(client, 'mms_image_names'\)/);
    expect(intake).toMatch(/JSON\.stringify\(alignMmsImageNames\(mmsImageNames, images\.length\)\)/);
  });

  it('화면 접수·원스텝은 업로드 응답의 원본명을 넘긴다', () => {
    const composer = read(`${FRONT}/components/agency/AgencySendComposer.tsx`);
    expect(composer).toMatch(/mmsImageNames: mms\.mmsUploadedImages\.map\(\(i\) => i\.originalName \|\| i\.filename\)/);
    const oneStep = read(`${FRONT}/components/agency/AgencyOneStepModal.tsx`);
    expect(oneStep).toMatch(/mmsImageNames: mms\.mmsUploadedImages\.map\(\(i\) => i\.originalName \|\| i\.filename\)/);
    const route = read('../../routes/agency-send.ts');
    expect(route).toMatch(/mmsImageNames: Array\.isArray\(overrides\.mmsImageNames\) \? overrides\.mmsImageNames : \[\]/);
  });

  it('메일 접수는 첨부 원본명을 넘긴다(다중이면 이미지가 없다)', () => {
    const worker = read('../agency-send-mail-worker.ts');
    expect(worker).toMatch(/mmsImageNames: multi \? \[\] : savedImageNames/);
  });

  it('상세 응답 두 곳이 원본명을 싣는다(고객 · 슈퍼관리자)', () => {
    expect(read('../../routes/agency-send.ts')).toMatch(/mmsImageNames: Array\.isArray\(row\.mms_image_names\) \? row\.mms_image_names : null/);
    const admin = read('../../routes/admin.ts');
    expect(admin).toMatch(/mmsImageNames: Array\.isArray\(row\.mms_image_names\) \? row\.mms_image_names : null/);
  });

  it('상세 두 화면이 원본명을 묶어 미리보기에 넘긴다', () => {
    for (const f of ['components/agency/AgencySendDetail.tsx', 'components/admin/AgencySendLedgerPanel.tsx']) {
      expect(read(`${FRONT}/${f}`), f).toMatch(/withMmsImageNames\(/);
    }
  });

  it('미리보기 모달: 이미지를 누르면 발송 결과 창과 같은 모습으로 크게 보인다', () => {
    const modal = read(`${FRONT}/components/agency/AgencyPreviewModal.tsx`);
    expect(modal).toMatch(/onImageClick=\{\(url, filename\) => setEnlarged\(\{ url, filename \}\)\}/);
    expect(modal).toMatch(/\{enlarged\.filename\}/);
    // 훅은 조기 return 위(2026-07-06 백지 크래시 교훈)
    expect(modal.indexOf('useState<{ url: string; filename: string } | null>')).toBeGreaterThan(0);
    expect(modal.indexOf('useState<{ url: string; filename: string } | null>')).toBeLessThan(modal.indexOf('if (!show) return null;'));
    // 중첩 오버레이는 body로 뺀다(부모 모달에 갇히지 않게)
    expect((modal.match(/createPortal\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
