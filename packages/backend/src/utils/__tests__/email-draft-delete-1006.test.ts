/**
 * 이메일 마케팅 목록에서 초안을 지울 수 없다 (★2026-10-06 남지현 재오픈 `cmuq8tru60amqjnn4kcrcbu4f`)
 *
 * 1003 에 모바일 DM 초안 카드(DmChip)에 삭제 버튼을 붙였는데, 같은 구조인 이메일 초안 카드(EmailChip)는 남았다.
 * 초안 카드는 누르면 편집기로 바로 가고 삭제 버튼은 상세 창에만 있는데 상세 창은 초안에서 열리지 않는다.
 * 처방(서버 변경 0): DmChip 과 같은 초안 전용 삭제 버튼 · 기존 삭제 함수(확인 창 · 토스트 · 목록 갱신)를 그대로 쓴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');

describe('EmailChip 초안 삭제 버튼', () => {
  const src = front('components/make/HomeParts.tsx');
  const chip = src.slice(src.indexOf('export function EmailChip('), src.indexOf('export function Meter('));

  it('선택 prop onDelete 를 받고 초안일 때만 버튼을 그린다', () => {
    expect(chip).toContain('onDelete?: () => void');
    expect(chip).toContain("status === 'draft' && onDelete");
    expect(chip).toContain('aria-label="초안 삭제"');
  });

  it('삭제 버튼은 카드 버튼 안에 넣지 않는다(형제 버튼)', () => {
    const mainClose = chip.indexOf('</button>');
    expect(mainClose).toBeGreaterThan(0);
    expect(chip.indexOf('aria-label="초안 삭제"')).toBeGreaterThan(mainClose);
  });

  it('카드가 위치 기준이고 모바일에서는 늘 보인다', () => {
    expect(chip).toMatch(/className="group relative rounded-2xl/);
    expect(chip).toContain('md:opacity-0 md:group-hover:opacity-100');
  });
});

describe('이메일 목록 연결', () => {
  it('초안 카드에만 기존 삭제 함수를 연결한다', () => {
    const page = front('pages/EmailCampaignsPage.tsx');
    expect(page).toContain("onDelete={st === 'draft' ? () => handleDeleteCampaign(c) : undefined}");
  });
});
