/**
 * 소재 삭제 = 주소를 그대로 저장한 곳 전부에서 쓰이지 않을 때만 파일을 지운다 (★2026-09-26 한줄로 V2 R1-22)
 *
 * 옛: 인앱 메시지 참조만 보고 실물 파일을 지웠다. DM(pages·sections)·이메일 본문·카카오 브랜드 발송 첨부도
 *     고른 소재 주소를 그대로 들고 있어서, 발송된 DM·이메일 이미지가 깨지고 예약된 브랜드 발송은 발송 직전 이미지 올리기에서 실패했다.
 * 처방: 참조 판정 한 번의 조회로 네 저장처를 모두 본다(파일명 = uuid라 전역 유일 · 절대/상대 주소 모두 잡는다).
 *   MMS·SNS·이벤트 캠페인은 소재를 사본으로 옮겨 쓰므로 대상이 아니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a) }));
vi.mock('../plan-guard', () => ({ loadPlanContext: vi.fn(async () => null) }));

import { deleteAsset } from '../assets';

const CO = '00000000-0000-4000-8000-000000000001';
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const FILE = '3f2b6c1e-1111-4222-8333-444455556666.png';
const URL = `/api/cdp/inapp/image/${CO}/${FILE}`;

function refSql(): string {
  const c = queryMock.mock.calls.find((x) => String(x[0]).includes('FROM cdp_inapp_messages'));
  return c ? String(c[0]) : '';
}

describe('deleteAsset 참조 판정', () => {
  beforeEach(() => queryMock.mockReset());

  it('DM·이메일·브랜드 첨부·인앱 네 저장처를 한 번에 본다(파일명 기준)', async () => {
    queryMock.mockImplementation(async (q: any) => { const sql = String(q);
      if (sql.includes('SELECT url FROM cdp_assets')) return { rows: [{ url: URL }] };
      if (sql.includes('FROM cdp_inapp_messages')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    await deleteAsset(CO, ASSET);
    const sql = refSql();
    expect(sql).toContain('FROM dm_pages d');
    expect(sql).toContain('d.pages::text LIKE $3');
    expect(sql).toContain('d.sections::text LIKE $3');
    expect(sql).toContain('FROM email_campaigns e');
    expect(sql).toContain('e.html_body LIKE $3');
    // M-39 대조(SCHEMA.md) — 이메일 편집기는 섹션(jsonb)에도 소재 주소를 그대로 저장한다(html_body가 아직 없는 초안 포함)
    expect(sql).toContain('e.sections::text LIKE $3');
    expect(sql).toContain('FROM campaigns k');
    // M-39 실측: campaigns.status NULL 허용 → NULL 상태는 '끝나지 않은 발송'으로 본다(NOT IN에서 빠지면 사용 중인 파일을 지운다)
    expect(sql).toContain("COALESCE(k.status, '') NOT IN ('completed', 'cancelled', 'failed')");
    expect(sql).toContain('k.kakao_attachment_json::text LIKE $3');
    expect(sql).toContain('k.kakao_carousel_json::text LIKE $3');
    const call = queryMock.mock.calls.find((x) => String(x[0]).includes('FROM cdp_inapp_messages'))!;
    expect(call[1][2]).toBe(`%${FILE}%`);
  });

  it('DM이 쓰고 있으면 지우지 않는다(inUse)', async () => {
    queryMock.mockImplementation(async (q: any) => { const sql = String(q);
      if (sql.includes('SELECT url FROM cdp_assets')) return { rows: [{ url: URL }] };
      if (sql.includes('FROM cdp_inapp_messages')) return { rows: [{ in_use: true }] };
      return { rows: [], rowCount: 1 };
    });
    const r = await deleteAsset(CO, ASSET);
    expect(r).toEqual({ deleted: false, inUse: true });
    expect(queryMock.mock.calls.some((x) => String(x[0]).startsWith('DELETE FROM cdp_assets'))).toBe(false);
  });

  it('아무 데서도 안 쓰면 지운다', async () => {
    queryMock.mockImplementation(async (q: any) => { const sql = String(q);
      if (sql.includes('SELECT url FROM cdp_assets')) return { rows: [{ url: URL }] };
      if (sql.includes('FROM cdp_inapp_messages')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const r = await deleteAsset(CO, ASSET);
    expect(r).toEqual({ deleted: true, inUse: false });
  });

  it('LIKE 특수문자는 이스케이프한다', async () => {
    const odd = `/api/cdp/inapp/image/${CO}/a_b%c.png`;
    queryMock.mockImplementation(async (q: any) => { const sql = String(q);
      if (sql.includes('SELECT url FROM cdp_assets')) return { rows: [{ url: odd }] };
      if (sql.includes('FROM cdp_inapp_messages')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    await deleteAsset(CO, ASSET);
    const call = queryMock.mock.calls.find((x) => String(x[0]).includes('FROM cdp_inapp_messages'))!;
    expect(call[1][2]).toBe('%a\\_b\\%c.png%');
  });
});
