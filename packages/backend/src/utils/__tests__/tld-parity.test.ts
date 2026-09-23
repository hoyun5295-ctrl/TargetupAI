/**
 * TLD 원장·링크 사유 문구 파리티 (★2026-09-22 신설)
 *
 * 왜 있나 — 링크 판정은 화면과 서버 **양쪽**에 있어야 한다. 화면은 입력 중에 막아 줘야 해서 서버 응답을
 * 기다릴 수 없고, 서버는 화면을 안 지나는 경로(API 직호출·AI 자동 생성·저장 캠페인 재실행)를 막아야 한다.
 * 그래서 사본이 생기고, **사본은 갈라진다.** 갈라지면 화면이 통과시킨 주소를 서버가 막거나(고객은 이유를
 * 모른 채 발송이 안 됨) 그 반대가 된다(오타가 그대로 나가 차감만 남는다 = 0922 접수).
 *
 * 못 박는 것
 *   1. TLD 목록이 양쪽에서 같다(버전·개수·내용).
 *   2. 사유 문구가 양쪽에서 같다 — 서버가 실제로 낸 문장의 고정 부분이 화면 소스에 그대로 있다.
 *
 * 고치는 법 — 백엔드를 고치고 프론트 사본을 다시 뽑는다. 프론트만 고치면 이 계약이 깨진다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { KNOWN_TLDS, TLD_LIST_VERSION } from '../tld-list';
import { webLinkReason } from '../normalize';

const FRONT_LIST = path.resolve(__dirname, '../../../../frontend/src/constants/tld-list.ts');
const FRONT_CHECK = path.resolve(__dirname, '../../../../frontend/src/utils/link-check.ts');

function readFrontList(): { version: string; tlds: Set<string> } {
  const src = fs.readFileSync(FRONT_LIST, 'utf8');
  const v = /TLD_LIST_VERSION = '([^']+)'/.exec(src);
  const raw = /const RAW = `([\s\S]*?)`/.exec(src);
  if (!v || !raw) throw new Error('프론트 TLD 원장 모양이 바뀌었다 — 이 계약도 함께 고친다');
  return { version: v[1], tlds: new Set(raw[1].trim().split(/\s+/)) };
}

describe('TLD 원장 파리티 — 백엔드 ↔ 프론트', () => {
  const front = readFrontList();

  it('원장 버전이 같다', () => {
    expect(front.version).toBe(TLD_LIST_VERSION);
  });

  it('목록이 정확히 같다', () => {
    expect(front.tlds.size).toBe(KNOWN_TLDS.size);
    const onlyBack = [...KNOWN_TLDS].filter((t) => !front.tlds.has(t));
    const onlyFront = [...front.tlds].filter((t) => !KNOWN_TLDS.has(t));
    expect(onlyBack, '백엔드에만 있는 TLD').toEqual([]);
    expect(onlyFront, '프론트에만 있는 TLD').toEqual([]);
  });

  it('추출 자체가 비면 이 계약이 죽은 것이다', () => {
    expect(front.tlds.size).toBeGreaterThan(1000);
  });
});

describe('링크 사유 문구 파리티 — 서버가 낸 문장이 화면 소스에 있다', () => {
  const src = fs.readFileSync(FRONT_CHECK, 'utf8');

  it('스킴 사유가 같다', () => {
    const r = webLinkReason('www.naver.com', '링크는');
    const fixed = r.replace(/^링크는 /, '');
    expect(src).toContain(fixed);
  });

  it('모르는 TLD 사유(제안 있음)가 같다', () => {
    const r = webLinkReason('https://invitocorp.cpm', '링크는');
    // 자리 이름·TLD·제안값은 실행 시 채워지므로, 사이에 낀 **고정 문구**만 비교한다
    expect(r).toContain("인데 그런 도메인은 없습니다. 혹시 '.");
    expect(src).toContain("인데 그런 도메인은 없습니다. 혹시 '.");
    expect(src).toContain('주소 끝이');
  });

  it('모르는 TLD 사유(제안 없음)가 같다', () => {
    const r = webLinkReason('https://example.zzzzzzzzzz', '링크는');
    expect(r).toContain('주소를 다시 확인해 주세요');
    expect(src).toContain('인데 그런 도메인은 없습니다. 주소를 다시 확인해 주세요');
  });

  it('화면 사본이 백엔드와 같은 판정 함수를 갖는다', () => {
    for (const fn of ['unknownTldOf', 'suggestTld', 'withinOneEdit']) {
      expect(src, `${fn}이 화면 사본에 없다`).toContain(`function ${fn}`);
    }
    // 화면 진입점은 화살표 함수다(브랜드 화면이 예전부터 이 이름으로 부르고 있었다)
    expect(src, 'linkReason이 화면 사본에 없다').toContain('export const linkReason');
  });
});
