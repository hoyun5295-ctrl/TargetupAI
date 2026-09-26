/**
 * AI 자동마케팅 수정 — 혜택·리마인더 문안을 비우면 정말 비워진다 (★2026-09-26 한줄로 V2 R1-25 · 같은 문장의 같은 모양 2칸)
 *
 * 수정에서 혜택 칸을 비우면 ''→null→COALESCE(null, 기존값)이라 옛 혜택이 남아 계속 발송됐다(고객에게 끝난 혜택 안내).
 * 리마인더 문안도 같은 모양. 같은 UPDATE의 copy_style이 이미 쓰는 "유지 표식('__keep__') · 빈 값 = 해제"로 맞춘다.
 * 비었을 때 발송 쪽은 안전하다: 혜택 = [혜택…] 자리가 남아 발송 출구 가드가 막는다 · 리마인더 = 예약하지 않고 관리자 알림.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'continuous-operator.ts'), 'utf8');
const upd = src.slice(src.indexOf('const runUpdate = (withSegment: boolean) => query('), src.indexOf('RETURNING *`,', src.indexOf('const runUpdate = (withSegment: boolean) => query(')) + 40);
const params = src.slice(src.indexOf('RETURNING *`,', src.indexOf('const runUpdate')), src.indexOf('...(withSegment ? [segFinalKey'));

describe('혜택·리마인더 비우기', () => {
  it('SQL = 유지 표식이면 그대로 · 아니면 빈 값은 NULL', () => {
    expect(upd).toContain("benefit_content = CASE WHEN $19::text = '__keep__' THEN benefit_content ELSE NULLIF($19::text, '') END");
    expect(upd).toContain("sequence_reminder_content = CASE WHEN $22::text = '__keep__' THEN sequence_reminder_content ELSE NULLIF($22::text, '') END");
    expect(upd).not.toContain('benefit_content = COALESCE($19, benefit_content)');
    expect(upd).not.toContain('sequence_reminder_content = COALESCE($22, sequence_reminder_content)');
  });

  it('인자 = 안 보냄(undefined)만 유지 · 빈 문자열·null은 해제', () => {
    expect(params).toContain("patch.benefitContent === undefined ? '__keep__' : (typeof patch.benefitContent === 'string' ? patch.benefitContent.trim() : '')");
    expect(params).toMatch(/patch\.sequenceReminderContent === undefined \? '__keep__'/);
  });
});
