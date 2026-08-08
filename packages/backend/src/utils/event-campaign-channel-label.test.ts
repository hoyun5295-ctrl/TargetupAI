/**
 * 임시 보관한 행사 캠페인 — 채널 표시 축 (★ 2026-08-08 · 임은지 접수 "원클릭 캠페인 - 임시 보관한 행사 캠페인 화면").
 *
 * 접수 = 목록에서 DM모바일인지 이메일인지 구분이 안 돼 하나씩 눌러봐야 했다.
 * 결함이 아니라 **표시 축 미구현**이었다 — 데이터는 이미 왔다(`GET /drafts`가 `channels` jsonb를 그대로 싣는다).
 * 화면이 `CH_KEYS.filter(k => ch?.[k]?.payload).length`로 **어느 채널인지 알면서 개수로 접었다**(`N채널`).
 *
 * 라벨은 새로 만들지 않는다 — 같은 기능의 `EventCampaignModal.CHANNELS`(모바일 DM·이메일·인앱 메시지)를 쓴다.
 * 별도 라벨 표를 두면 그것이 또 하나의 죽은 사본이 된다(발송 사전 라벨 단일소스 규약과 같은 이유).
 * ⚠ 모듈을 실제 import해 값을 비교하지 않는 이유 = 그 파일이 React·lucide를 끌어와 이 러너에서 뜨지 않는다.
 *   그래서 문자열 계약으로 고정하고, 검출력은 회귀 주입으로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const front = (rel: string) => readFileSync(join(__dirname, '../../../frontend/src', rel), 'utf8');
/** 주석 제거 — 주석에 남은 라벨·옛 서술이 검사 결과를 바꾸면 검출기가 거짓말을 한다. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const modal = stripComments(front('components/EventCampaignModal.tsx'));
const bar = stripComments(front('components/EventCampaignResumeBar.tsx'));

describe('임시 보관 목록 — 어느 채널인지 목록에서 드러난다', () => {
  it('채널 라벨의 단일소스가 export돼 있다', () => {
    expect(modal, 'CHANNELS가 module-local이면 목록이 라벨을 복사하게 된다').toContain('export const CHANNELS');
  });

  it('임시 보관 바가 그 단일소스를 가져다 쓴다', () => {
    expect(bar, '라벨 출처가 CHANNELS가 아니다').toContain("import { CHANNELS } from './EventCampaignModal'");
    expect(bar, '채널 라벨을 실제로 그리지 않는다').toContain('{c.label}');
  });

  it('개수로 접지 않는다 — 이 접수의 결함 그 자체', () => {
    expect(bar, '옛 채널 키 배열이 되살아났다').not.toContain('CH_KEYS');
    expect(bar, '아직 개수(N채널)로 표시한다').not.toMatch(/\}채널/);
  });

  it('라벨 사본을 두지 않는다 — 두면 모달과 목록이 다른 말을 하게 된다', () => {
    for (const label of ['모바일 DM', '이메일', '인앱 메시지']) {
      expect(bar, `라벨 '${label}'을 목록이 자기 문자열로 들고 있다`).not.toContain(label);
    }
  });
});
