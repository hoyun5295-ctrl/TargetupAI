/**
 * cdp-provider-keys.contract.test.ts — 자사몰 식별자 매핑 계약 고정 (★2026-08-10)
 *
 * 왜 backend 러너에 두는가 — 프론트에 vitest 러너가 없다. 선례 = sender-alert-axis.test.ts,
 * brand-axis-invariants.test.ts(프론트 소스를 backend 러너가 읽어 계약을 고정하는 방식).
 *
 * 이 테스트가 막는 것(설계서 §10 — 같은 표가 네 번 틀렸다):
 *   1. 화면 키와 DB provider 실값이 어긋나는 것(naver ↔ naver_smart_store)
 *   2. 자체 호스팅의 브라우저 SDK 출처('sdk') 누락 — 정상 몰이 "설치 대기"로 보인다
 *   3. 백엔드가 각 몰에 쓰는 source 실값이 바뀌었는데 프론트 매핑이 안 따라오는 것
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BACKEND_SRC = path.resolve(__dirname, '..');
const FRONTEND_SRC = path.resolve(BACKEND_SRC, '../../frontend/src');

const read = (p: string) => readFileSync(p, 'utf8');
const keysFile = () => read(path.join(FRONTEND_SRC, 'utils/cdp-provider-keys.ts'));

describe('자사몰 식별자 매핑 CT', () => {
  it('provider 6종을 전부 등재한다 — 하나라도 빠지면 그 몰은 현황판에서 사라진다', () => {
    const src = keysFile();
    for (const key of ['cafe24', 'naver', 'godo', 'imweb', 'makeshop', 'custom']) {
      expect(src).toContain(`key: '${key}'`);
    }
  });

  it('네이버의 DB provider 실값은 naver_smart_store다 — 화면 키를 그대로 쓰면 영원히 미연결로 보인다', () => {
    const src = keysFile();
    expect(src).toMatch(/key: 'naver',\s*dbProvider: 'naver_smart_store'/);
    // 백엔드 실값과 대조 — 어댑터가 바뀌면 이 테스트가 먼저 깨진다
    expect(read(path.join(BACKEND_SRC, 'utils/naver-commerce-client.ts'))).toContain("provider: 'naver_smart_store'");
  });

  it('자체 호스팅은 webhook(custom)과 브라우저 SDK(sdk) 두 출처를 모두 센다', () => {
    const src = keysFile();
    expect(src).toMatch(/key: 'custom',[\s\S]{0,120}eventSources: \['custom', 'sdk'\]/);
    // 브라우저 수집이 실제로 'sdk'로 적재되는지 백엔드에서 확인
    expect(read(path.join(BACKEND_SRC, 'utils/cdp-events.ts'))).toContain("source: 'sdk'");
  });

  it('백엔드가 쓰는 source 실값과 프론트 매핑이 일치한다', () => {
    const src = keysFile();
    expect(read(path.join(BACKEND_SRC, 'utils/cafe24-client.ts'))).toContain("source: 'cafe24'");
    expect(read(path.join(BACKEND_SRC, 'utils/imweb-client.ts'))).toContain("source: 'imweb'");
    expect(read(path.join(BACKEND_SRC, 'utils/godo-parse.ts'))).toContain("GODO_SOURCE = 'godo'");
    expect(read(path.join(BACKEND_SRC, 'utils/custom-self-hosted-adapter.ts'))).toContain("source: 'custom'");
    for (const s of ["'cafe24'", "'imweb'", "'godo'"]) {
      expect(src).toContain(s);
    }
  });

  it('매핑 보류 몰(네이버·메이크샵)은 pending_mapping으로 표시된다 — 이벤트 0을 설치 대기로 오판하지 않는다', () => {
    const src = keysFile();
    expect(src).toMatch(/key: 'naver',[\s\S]{0,160}ingest: 'pending_mapping'/);
    expect(src).toMatch(/key: 'makeshop',[\s\S]{0,160}ingest: 'pending_mapping'/);
  });
});

describe('연동 현황판 시인성 규격 (Phase 2 · 설계서 §5-1·§5-5)', () => {
  const dash = () => read(path.join(FRONTEND_SRC, 'components/cdp/CdpIntegrationDashboard.tsx'));

  it('배지 5종을 모두 그린다 — 하나라도 빠지면 그 상태가 화면에서 사라진다', () => {
    const src = dash();
    for (const b of ['receiving', 'awaiting', 'preparing', 'action', 'disconnected']) {
      expect(src).toContain(`${b}:`);
    }
  });

  it('1층에 코드 블록을 두지 않는다 — 스크립트·웹훅 규격은 3층 몫이다', () => {
    const src = dash();
    expect(src).not.toMatch(/<code[\s>]/);
    expect(src).not.toMatch(/<pre[\s>]/);
  });

  it('상태 판정을 화면에서 다시 계산하지 않는다 — 판정은 훅 하나가 소유한다', () => {
    const src = dash();
    // 카운트 비교로 배지를 정하는 코드가 화면에 있으면 훅과 두 벌이 된다(설계서 §5-1-1 위반)
    expect(src).not.toMatch(/count24h\s*[><=]/);
    expect(src).not.toMatch(/total\s*[><]\s*0/);
  });

  it('색만으로 상태를 구분하지 않는다 — 배지마다 아이콘과 문구를 함께 둔다(접근성)', () => {
    const src = dash();
    expect(src).toMatch(/BadgeIcon/);
    expect(src).toMatch(/\{st\.label\}/);
  });

  it('판정 축이 바뀌면 화면 문구도 함께 바뀌도록 훅이 문구를 소유한다', () => {
    const hook = read(path.join(FRONTEND_SRC, 'hooks/useCdpIntegrationStatus.ts'));
    expect(hook).toContain('데이터 수신 중');
    expect(hook).toContain('연결 완료 · 데이터 연동 준비 중');
    expect(hook).toContain('인증이 끊겼어요');
    // 매핑 보류 몰은 이벤트 0이어도 '설치 대기'가 아니라 '준비 중'이어야 한다
    expect(hook).toMatch(/eventsUnavailable[\s\S]{0,200}badge: 'preparing'/);
  });
});

describe('install-status source 분리 (Phase 0)', () => {
  it('회사 합계와 별개로 source별 집계를 함께 돌려준다 — 기존 응답 키는 유지', () => {
    const src = read(path.join(BACKEND_SRC, 'routes/cdp.ts'));
    expect(src).toMatch(/GROUP BY COALESCE\(source, 'unknown'\)/);
    expect(src).toContain('bySource');
    // 기존 소비처가 보던 키가 그대로 남아 있어야 한다(additive 보장)
    expect(src).toMatch(/firstEventAt: row\.first_event_at/);
    expect(src).toMatch(/count24h: parseInt\(row\.count_24h/);
  });
});
