// replaces: none
/**
 * ★ 2026-11-25 대행 메일 접수 = 한 메일 · 한 파일 여러 건 · 이미지 이름 맞추기 — 실 PostgreSQL 판 처음부터 끝까지
 *   (설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6 · §7 · §8 · Harold 1125 「대행메일부터 제대로」).
 *
 * 메일 한 통(processMessage · 운영 문장 그대로) = 시세이도 꼴 엑셀(요청서 「정기문자(생일_X)」 + 「고객리스트N」 두 짝 · 테스트 명단 표 ·
 *   빈 발신번호 · [고객명] [소속매장명] [소속매장전화번호]) + 이미지 두 장(요청서 「이미지 파일명」 칸과 이름이 같음).
 *   ① 두 건 접수(건마다 그 시트 문안 · 그 명단 · 그 이미지 · 명단 매장 전화 열 = 고객별 발신번호 · 테스트 명단 = 담당자) · 회신 한 통
 *   ② 같은 메일 다시 = 이미 접수 = 새 접수 0
 *   ③ 명단 열 이름이 괄호와 다르면([소속매장명] ↔ 「소속 매장」) = 메일 반려 · 회신에 가까운 열 · 접수 0
 * 가짜 = 발신자 판정 · 요금제 관문 · 등록 발신번호 · 회신 메일 · 검사 깨우기 · 이미지 저장 위치(번호는 도달 불가 합성 값 · 문자 0).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';

const CO = randomUUID();
const OWNER = randomUUID();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-multisheet-'));
const replies: any[] = [];

vi.mock('../agency-send-email', async (orig) => ({
  ...(await orig<any>()),
  resolveEmailSender: vi.fn(async () => ({ outcome: 'ok', candidate: { senderId: 'sender-1', companyId: CO, userId: OWNER, label: null, loginId: 't-mail', userName: null } })),
}));
vi.mock('../plan-guard', async (orig) => ({ ...(await orig<any>()), loadPlanContext: vi.fn(async () => ({})), canUseAgencySend: vi.fn(() => true) }));
vi.mock('../callback-filter', async (orig) => ({
  ...(await orig<any>()),
  getRegisteredCallbackSet: vi.fn(async () => new Set(['0200000001', '0200000002', '0200000003', '0200000004'])),
  isCallbackRegistered: vi.fn(async () => true),
}));
vi.mock('../agency-mailer', async (orig) => ({ ...(await orig<any>()), sendAgencyReplyMail: vi.fn(async (m: any) => { replies.push(m); return { outcome: 'sent', detail: '' }; }) }));
vi.mock('../agency-send-intake', async (orig) => ({ ...(await orig<any>()), kickFirstTest: vi.fn() }));

import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { processMessage } from '../agency-send-mail-worker';
// 이미지 저장 = 운영 함수 그대로(접수 코어가 그 회사 저장소 경로만 받는다) · 시험 회사 폴더는 끝에 지운다
import { MMS_IMAGE_BASE } from '../mms-image-util';

/** 시세이도 꼴 요청서 시트(A열 비움 · B열 라벨 · 오른쪽 테스트 명단 표 · 발신번호 빈칸) */
function formSheet(grade: string, image: string): any[][] {
  const content = `(광고) [시세이도] HAPPY BIRTHDAY\n소중한 [고객명] 고객님 ${grade} 단독 혜택\n*장소: [소속매장명]\n*문의: [소속매장전화번호]\n*무료수신거부 : 080-000-0000`;
  return [
    [null, '구 분', '내 용'],
    [null, '브랜드명 (과금부서)', 'SHISEIDO', null, null, null, '테스트 명단'],
    [null, '문자타입', null, null, null, null, '고객명', '휴대폰번호', '소속매장명', '매장전화번호'],
    // 시험 실행기 = TZ Etc/UTC · 해석기 = 서버 현지 시각(운영 KST) → 두 시간대 모두 발송 허용 시간 안인 오전 10시(UTC 10시 = KST 19시)
    [null, '발송날짜 및 시간', '12월 1일 오전 10시', null, null, null, '가', '010-0000-0001', '강남', '02-0000-0000'],
    [null, '테스트번호\n(여러 개 가능)', '(오른쪽 테스트 명단 참고) →', null, null, null, '나', '010-0000-0002', '강남', '02-0000-0000'],
    [null, '메시지 제목\n(LMS,MMS만 해당)', '(광고) HAPPY BIRTHDAY'],
    [null, '메시지 내용', content],
    [],
    [null, '발신번호'],
    [null, '이미지 파일명\n(MMS만 해당)', image],
    [null, null, '②'],
  ];
}
/** 짝마다 다른 명단(번호 · 매장 · 매장 전화) = 건마다 제 명단이 붙었는지 가린다(Codex 구현 3R) */
const LISTS: Record<1 | 2, Array<[string, string, string, string]>> = {
  1: [['다', '010-0000-0101', '강남점', '02-0000-0001'], ['라', '010-0000-0102', '부산점', '02-0000-0002']],
  2: [['마', '010-0000-0201', '대구점', '02-0000-0003'], ['바', '010-0000-0202', '광주점', '02-0000-0004']],
};
const list = (storeHeader: string, n: 1 | 2): any[][] => [['고객명', '휴대폰번호', storeHeader, '소속매장전화번호'], ...LISTS[n]];
function workbook(storeHeader = '소속매장명'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formSheet('Platinum', '①PT')), '정기문자(생일_PT)');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(list(storeHeader, 1)), '고객리스트1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formSheet('Gold', '①GD')), '정기문자(생일_GOLD)');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(list(storeHeader, 2)), '고객리스트2');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
/** 규격 안 JPG 꼴(맞춤 없이 그대로 받는 크기 · 그림마다 바이트가 다르다) */
const jpg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, fill)]);

/** ★1125 실 접수 꼴 = 한 파일 24시트(요청서 · 명단 12짝) · 이미지 없음 · 짝마다 다른 문안 · 다른 명단 */
function workbook12(): Buffer {
  const wb = XLSX.utils.book_new();
  for (let i = 1; i <= 12; i++) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formSheet(`등급${i}`, '')), `정기문자(생일_G${i})`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['고객명', '휴대폰번호', '소속매장명', '소속매장전화번호'],
      ['다', `010-0001-${String(i * 10 + 1).padStart(4, '0')}`, '강남점', '02-0000-0001'],
      ['라', `010-0001-${String(i * 10 + 2).padStart(4, '0')}`, '부산점', '02-0000-0002'],
    ]), `고객리스트${i}`);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
function rawMailNoImage(messageId: string, xlsx: Buffer): Buffer {
  const b64 = (buf: Buffer) => buf.toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(
    `From: Kim <kim@example.invalid>\r\nTo: intake@example.invalid\r\nSubject: =?UTF-8?B?${Buffer.from('12등급 생일 문안').toString('base64')}?=\r\nMessage-ID: <${messageId}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n`
    + `--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nplease\r\n`
    + `--B\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="birthday12.xlsx"\r\nContent-Disposition: attachment; filename="birthday12.xlsx"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(xlsx)}\r\n`
    + `--B--\r\n`,
  );
}

function rawMail(messageId: string, xlsx: Buffer): Buffer {
  const b64 = (buf: Buffer) => buf.toString('base64').replace(/.{76}/g, '$&\r\n');
  const part = (type: string, name: string, buf: Buffer) =>
    `--B\r\nContent-Type: ${type}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(buf)}\r\n`;
  return Buffer.from(
    `From: Kim <kim@example.invalid>\r\nTo: intake@example.invalid\r\nSubject: =?UTF-8?B?${Buffer.from('11월 생일 문안').toString('base64')}?=\r\nMessage-ID: <${messageId}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n`
    + `--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nplease\r\n`
    + part('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'birthday.xlsx', xlsx)
    // 첨부 차례 = 시트 차례의 반대(GD 먼저) · 차례가 아니라 이름으로 맞춰야 건마다 제 그림이 붙는다(Codex 구현 3R)
    + part('image/jpeg', 'GD.jpg', jpg(2))
    + part('image/jpeg', 'PT.jpg', jpg(1))
    + `--B--\r\n`,
  );
}
async function deliver(mailbox: string, uidl: string, raw: Buffer): Promise<void> {
  const head = raw.subarray(0, raw.indexOf('\r\n\r\n') + 4);
  const client = { top: async () => head, retr: async () => raw } as any;
  await processMessage({ client, mailbox, octets: new Map([[1, raw.length]]), now: new Date() }, 1, uidl);
}
const intakeRow = async (mailbox: string, uidl: string) =>
  (await query(`SELECT status, reason, request_ids FROM agency_send_email_intake WHERE mailbox = $1 AND uidl = $2`, [mailbox, uidl])).rows[0];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, agency_send_enabled: true });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, status: 'active', phone: '010-0000-1111', login_id: `t-mail-${OWNER.slice(0, 8)}` });
});
afterAll(() => {
  for (const dir of [TMP, path.join(MMS_IMAGE_BASE, CO)]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ } }
});

describe('대행 메일 = 한 파일 여러 건 + 이미지 이름 맞추기(실 PG · processMessage 그대로)', () => {
  const MB = `intake-multi-${randomUUID().slice(0, 6)}@example.invalid`;

  it('① 두 건 접수 = 건마다 그 시트 문안 · 그 명단 · 그 이미지 · 매장 전화 열 발신번호 · 테스트 명단 담당자 · 회신 한 통', async () => {
    replies.length = 0;
    await deliver(MB, 'u1', rawMail(`m1-${randomUUID()}`, workbook()));
    const ir = await intakeRow(MB, 'u1');
    expect(ir.status).toBe('accepted');
    expect(ir.request_ids).toHaveLength(2);
    const reqs = (await query(
      `SELECT id, file_name, current_content, message_type, mms_image_names, mms_image_paths, manager_phones, callback_number FROM agency_send_requests WHERE id = ANY($1::uuid[]) ORDER BY file_name`,
      [ir.request_ids],
    )).rows;
    const byGrade = (g: string) => reqs.find((r: any) => String(r.file_name).endsWith(`/ 정기문자(생일_${g})`));
    const pt = byGrade('PT');
    const gd = byGrade('GOLD');
    expect(pt && gd).toBeTruthy();
    expect(pt.current_content).toContain('소중한 %고객명% 고객님 Platinum 단독 혜택');
    expect(gd.current_content).toContain('소중한 %고객명% 고객님 Gold 단독 혜택');
    for (const r of [pt, gd]) {
      expect(r.current_content).toContain('*장소: %소속매장명%');
      expect(r.current_content).toContain('*문의: %소속매장전화번호%');
      expect(r.current_content).toContain('[시세이도]');
      expect(r.message_type).toBe('MMS');
      expect(r.manager_phones).toEqual(['01000000001', '01000000002']);
    }
    expect(pt.mms_image_names).toEqual(['PT.jpg']);
    expect(gd.mms_image_names).toEqual(['GD.jpg']);
    // 저장된 그림 바이트 = 그 건의 그림(이름표만이 아니라 실제 파일)
    const savedBytes = (r: any) => {
      const paths = Array.isArray(r.mms_image_paths) ? r.mms_image_paths : JSON.parse(String(r.mms_image_paths || '[]'));
      expect(paths).toHaveLength(1);
      return fs.readFileSync(paths[0]);
    };
    expect(savedBytes(pt).equals(jpg(1))).toBe(true);
    expect(savedBytes(gd).equals(jpg(2))).toBe(true);
    const recOf = async (id: string) => (await query(`SELECT phone, callback, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no`, [id])).rows
      .map((x: any) => [x.phone, x.callback, x.vars['소속매장명'], x.vars['고객명']]);
    expect(await recOf(pt.id)).toEqual([['01000000101', '0200000001', '강남점', '다'], ['01000000102', '0200000002', '부산점', '라']]);
    expect(await recOf(gd.id)).toEqual([['01000000201', '0200000003', '대구점', '마'], ['01000000202', '0200000004', '광주점', '바']]);
    expect(replies).toHaveLength(1);
    const text = String(replies[0].text ?? replies[0].body ?? JSON.stringify(replies[0]));
    expect(text).toContain('[1/2]');
    expect(text).toContain('[2/2]');
    expect(text).toContain('「소속매장전화번호」 열 번호로 고객마다 보냅니다');
  });

  it('② 같은 메일을 다시 보내면 이미 접수 = 새 접수 0', async () => {
    const before = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    await deliver(MB, 'u2', rawMail(`m2-${randomUUID()}`, workbook()));
    const after = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    expect(after).toBe(before);
    expect((await intakeRow(MB, 'u2')).reason).toBe('duplicate_request');
  });

  it('③ 명단 열 이름이 괄호와 다르면([소속매장명] ↔ 「소속 매장」) 반려 · 회신에 가까운 열 · 접수 0', async () => {
    replies.length = 0;
    const before = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    await deliver(MB, 'u3', rawMail(`m3-${randomUUID()}`, workbook('소속 매장')));
    const ir = await intakeRow(MB, 'u3');
    expect(ir.status).toBe('rejected');
    expect(ir.reason).toBe('bracket_blank');
    const after = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    expect(after).toBe(before);
    const text = String(replies.at(-1)?.text ?? JSON.stringify(replies.at(-1)));
    expect(text).toContain('[소속매장명]');
    expect(text).toContain('가까운 열: 소속 매장');
  });

  it('④ 한 파일 24시트(12짝) 메일 = 12건 접수 · 건 수 상한 없음(★1125 Harold 「제한없어 이어붙어있으면」) · 처리 시간 기록', async () => {
    const before = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    const t0 = Date.now();
    await deliver(MB, 'u4', rawMailNoImage(`m4-${randomUUID()}`, workbook12()));
    const ms = Date.now() - t0;
    console.log(`[1125 12짝 메일] processMessage ${ms}ms`);
    const ir = await intakeRow(MB, 'u4');
    expect(ir.status, `${ir.reason} · ${String(replies.at(-1)?.text ?? '').split('\n').join(' | ').slice(0, 900)}`).toBe('accepted');
    expect(ir.request_ids).toHaveLength(12);
    const after = Number((await query(`SELECT COUNT(*)::int AS n FROM agency_send_requests WHERE company_id = $1::uuid`, [CO])).rows[0].n);
    expect(after - before).toBe(12);
    const names = (await query(`SELECT file_name FROM agency_send_requests WHERE id = ANY($1::uuid[])`, [ir.request_ids])).rows.map((r: any) => String(r.file_name));
    expect(names.filter((n) => /\/ 정기문자\(생일_G(1[0-2]|[1-9])\)$/.test(n))).toHaveLength(12);
  }, 180_000);

  it('⑤ 실 접수 꼴 = 명단 시트 이름 「…리스트」 · 열 이름 「이름」 + 문안 [고객명] → 접수 · 회신에 채우는 열(★1125(2) 접수 384 · 385 · Harold 「이름 고객명정도는」)', async () => {
    replies.length = 0;
    const wb = XLSX.utils.book_new();
    for (const [g, phone] of [['PT', '010-0002-0101'], ['GOLD', '010-0002-0201']] as Array<[string, string]>) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formSheet(g, '')), `정기문자(생일_${g})`);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['이름', '고객연락처 (수신번호)', '소속매장명', '소속매장전화번호'],
        [`고객${g}`, phone, '강남점', '02-0000-0001'],
      ]), `정기문자(생일_${g})리스트`);
    }
    await deliver(MB, 'u5', rawMailNoImage(`m5-${randomUUID()}`, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer));
    const ir = await intakeRow(MB, 'u5');
    expect(ir.status, `${ir.reason} · ${String(replies.at(-1)?.text ?? '').split('\n').join(' | ').slice(0, 600)}`).toBe('accepted');
    expect(ir.request_ids).toHaveLength(2);
    const text = String(replies.at(-1)?.text ?? '');
    expect(text).toContain('문안의 [고객명] 자리는 명단 「이름」 열 값으로 고객마다 채웁니다.');
    const reqs = (await query(`SELECT id, file_name, current_content FROM agency_send_requests WHERE id = ANY($1::uuid[]) ORDER BY file_name`, [ir.request_ids])).rows;
    const gold = reqs.find((r: any) => String(r.file_name).endsWith('/ 정기문자(생일_GOLD)'));
    expect(gold.current_content).toContain('소중한 %고객명% 고객님 GOLD 단독 혜택');
    const rec = (await query(`SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid`, [gold.id])).rows;
    expect(rec.map((x: any) => [x.phone, x.vars['고객명']])).toEqual([['01000020201', '고객GOLD']]);
  }, 120_000);
});
