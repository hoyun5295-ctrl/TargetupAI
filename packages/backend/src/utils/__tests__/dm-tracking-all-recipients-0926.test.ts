/**
 * DM 발송 추적 = 1천 명을 넘어도 전체 수신자 기준 (★2026-09-26 한줄로 V2 R1-18)
 *
 * 옛: 추적 CT가 `LIMIT 1000`(고객 id 순)이라 1천 명 넘게 보낸 DM은
 *     깔때기 수치 · 미열람/무반응/클릭/응모 재발송 대상 · CSV · AI 학습 워커가 전부 임의 1천 명 기준이었다(DM 발송은 대상 상한이 없다).
 * 처방: CT는 전체 수신자(상한 없음 · 선택 상한 인자) → 요약·세그먼트 수는 서버가 전체로 계산.
 *   화면 목록만 1천 명으로 자르고(응답·렌더 크기 종전과 같음) 전체 수와 잘림 여부를 함께 준다 · CSV는 full=1로 전체.
 *   재발송은 화면이 id를 싣지 않고 **세그먼트 키**를 보낸다 → 서버가 발송 시점에 같은 판정 CT로 전체에서 다시 뽑는다.
 *   판정 = 한 벌(classifyDmRecipientSegments) — 화면 버튼 수와 실제 발송 대상이 같은 함수에서 나온다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyDmRecipientSegments, DM_RESEND_SEGMENTS } from '../dm/dm-tracking';

describe('classifyDmRecipientSegments', () => {
  const clicks = (n: number) => ({ s1: { views: 1, clicks: n } });
  const rows = [
    { customer_id: 'a', viewed_at: null, section_interactions: null, responded: false },
    { customer_id: 'b', viewed_at: '2026-09-01', section_interactions: clicks(0), responded: false },
    { customer_id: 'c', viewed_at: '2026-09-01', section_interactions: clicks(2), responded: false },
    { customer_id: 'd', viewed_at: '2026-09-01', section_interactions: clicks(0), responded: true },
  ];
  it('미열람 · 열람·무반응 · 클릭 · 응모를 화면과 같은 정의로 가른다', () => {
    const s = classifyDmRecipientSegments(rows);
    expect(s.unviewed).toEqual(['a']);
    expect(s.viewed_no_action).toEqual(['b']);
    expect(s.clicked).toEqual(['c']);
    expect(s.responded).toEqual(['d']);
  });
  it('세그먼트 키 목록', () => {
    expect([...DM_RESEND_SEGMENTS]).toEqual(['unviewed', 'viewed_no_action', 'clicked', 'responded']);
  });
});

describe('배선', () => {
  const builder = readFileSync(join(__dirname, '..', 'dm', 'dm-builder.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '..', '..', 'routes', 'dm.ts'), 'utf8');
  it('추적 CT에 고정 1천 상한이 없다(선택 상한만)', () => {
    const fn = builder.slice(builder.indexOf('export async function getDmRecipientEngagementRows('), builder.indexOf('export async function trackDmView('));
    expect(fn).not.toContain('LIMIT 1000');
    expect(fn).toContain('opts?.limit');
  });
  it('추적 라우트: 요약·세그먼트는 전체 · 목록만 상한(full=1이면 전체)', () => {
    const r = route.slice(route.indexOf("dmRouter.get('/:id/recipients-tracking'"), route.indexOf("dmRouter.get('/:id/recipient-detail'"));
    expect(r).toContain('const segmentIds = classifyDmRecipientSegments(rows);');
    expect(r).toContain("const wantFull = String(req.query.full || '') === '1';");
    expect(r).toContain('recipientsTotal: recipients.length');
    expect(r).toContain('listTruncated');
  });
  it('재발송: 세그먼트 키면 서버가 발송 시점에 전체에서 다시 뽑는다', () => {
    const s = route.slice(route.indexOf("dmRouter.post('/:id/send-to-target'"));
    expect(s).toContain('resendSegment');
    expect(s).toContain('classifyDmRecipientSegments(await getDmRecipientEngagementRows(');
  });
  it('화면: 세그먼트 키로 보내고 CSV는 잘렸을 때 전체를 받는다', () => {
    const fe = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'DmSendAndTrackModal.tsx'), 'utf8');
    expect(fe).toContain('resendSegment: resend.segment');
    expect(fe).not.toContain('resendCustomerIds: resendIds');
    expect(fe).toContain('recipients-tracking?full=1');
  });
});
