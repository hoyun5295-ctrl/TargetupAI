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
import { readFileSync, existsSync } from 'node:fs';
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

describe('3단계 진행 패널 (Phase 3 · 설계서 §5-2)', () => {
  const step = () => read(path.join(FRONTEND_SRC, 'components/cdp/CdpIntegrationStepper.tsx'));

  it('단계 완료를 시스템이 판정한다 — 사용자가 "다음"으로 자기 진도를 신고하지 않는다(규칙 3)', () => {
    const src = step();
    expect(src).not.toMatch(/>\s*다음\s*</);
    expect(src).not.toMatch(/setStep\(|goNext|nextStep/);
    // 판정 근거는 실측값(connected · total)뿐이어야 한다
    expect(src).toMatch(/status\.connected/);
    expect(src).toMatch(/status\.total > 0/);
  });

  it('매핑 보류 몰은 거짓 진행바 대신 안내 한 장을 보여준다', () => {
    const src = step();
    expect(src).toMatch(/eventsUnavailable && status\.connected/);
    expect(src).toContain('데이터 연동을 준비 중이에요');
  });

  it('③이 기다림과 신호 4종을 보여준다 — 옛 검증 탭의 몫을 흡수한다(규칙 4)', () => {
    const src = step();
    expect(src).toContain('첫 데이터를 기다리는 중입니다');
    for (const s of ['pageview', 'identify', 'consent', 'click']) expect(src).toContain(s);
  });

  it('막힌 단계에 탈출구를 준다(규칙 5)', () => {
    const src = step();
    expect(src).toContain('데이터가 안 들어오나요?');
    expect(src).toMatch(/stalled/);
  });

  it('연결 후에도 몰별 폼에 다시 닿을 수 있다 — 접기만 하고 없애지 않는다(해제·재설정이 거기 있다)', () => {
    const src = step();
    // ① 완료 상태에서 펼치기 버튼이 있어야 한다
    expect(src).toMatch(/onToggleConnect/);
    expect(src).toContain('연결 정보 보기');
    // 펼쳤을 때 실제로 내용물을 그린다
    expect(src).toMatch(/steps\.s1 === 'done' && connectExpanded/);
  });

  it('몰별 폼은 스테퍼 ①의 내용물로 통제된다 — 연결 전에는 항상 보인다', () => {
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    // 연결됨 + 접힘일 때만 숨긴다. connected가 아니면 조건이 거짓이라 항상 보인다.
    expect(page).toMatch(/\?\.connected[\s\S]{0,60}!connectStepOpen \? 'hidden' : ''/);
    // 모달을 닫으면 펼침 상태도 초기화된다(다음에 열 때 접힌 상태로 시작)
    expect(page).toMatch(/closeModal[\s\S]{0,200}setConnectStepOpen\(false\)/);
  });

  it('검증 탭은 플래그 on일 때 화면에서 사라진다 — 스테퍼 ③이 대신한다', () => {
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    expect(page).toMatch(/CDP_DASHBOARD_V2[\s\S]{0,220}\['app', '앱'\]\] as const\)/);
  });
});

describe('개발자 전달 안내 (Phase 4 · 설계서 §5-3)', () => {
  const guide = () => read(path.join(FRONTEND_SRC, 'utils/cdp-install-guide.ts'));

  it('공개 링크를 만들지 않는다 — 토큰 CT도, 공개 엔드포인트도 없다', () => {
    // 0810 방향 정정: 링크는 시크릿을 못 담아 문제를 반만 풀면서 웹훅 규격만 새로 공개한다.
    expect(existsSync(path.join(BACKEND_SRC, 'utils/cdp-install-guide-token.ts'))).toBe(false);
    const cdpRoutes = read(path.join(BACKEND_SRC, 'routes/cdp.ts'));
    expect(cdpRoutes).not.toMatch(/install-guide/);
  });

  it('안내 본문에 시크릿 값을 담지 않는다 — 자리만 알리고 값은 담당자가 사적 경로로 전달한다', () => {
    const src = guide();
    // 시크릿을 인자로 받는 순간 담을 수 있게 된다 — 애초에 받지 않는다
    expect(src).not.toMatch(/webhookSecret|secretValue|issuedSecret/);
    expect(src).toContain('이 안내에 포함하지 않았습니다');
  });

  it('서버 IP를 담지 않는다 — 공개 시 전 고객사가 우리 IP를 알게 된다', () => {
    // 주석에는 이 규칙을 설명하는 문구가 있으므로 주석을 걷어내고 실제 출력만 본다
    // (선례 = journey-entry-invariants.test.ts — 주석이 검사 결과를 뒤집지 않게 한다)
    const code = guide().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(code).not.toMatch(/egress|serverIp|server_ip/i);
  });

  it('값이 없으면 가짜로 채우지 않는다 — SDK 키가 없으면 스크립트 절 자체를 넣지 않는다', () => {
    const src = guide();
    expect(src).toMatch(/if \(sdkKey\) \{/);
  });
});

describe('개발자 자료 3층 표시 (설계서 §5-0·§5-5)', () => {
  const doc = () => read(path.join(FRONTEND_SRC, 'components/cdp/CdpDeveloperDoc.tsx'));

  it('상세는 기본 접힘이다 — 개발자 계약 문서를 담당자 화면에 통째로 쏟지 않는다', () => {
    const src = doc();
    expect(src).toMatch(/useState<string \| null>\(null\)/);
    // 펼쳐진 상세는 하나뿐 — 아코디언이 단일 열림이어야 한다
    expect(src).toMatch(/setOpenKey\(open \? null : sec\.key\)/);
  });

  it('주 액션은 "읽기"가 아니라 "개발자에게 전달"이다', () => {
    expect(doc()).toContain('개발자에게 보낼 내용 복사');
  });

  it('앱 탭이 계약 문서를 펼친 채로 그리지 않는다 — 3층 컴포넌트에 위임한다', () => {
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    // 페이지가 계약 항목을 직접 순회해 그리면 옛 벽이 돌아온다
    expect(page).not.toMatch(/APP_INAPP_CONTRACT_SECTIONS\.map/);
    expect(page).toMatch(/<CdpDeveloperDoc/);
  });
});

describe('웹 탭 정리 (설계서 §5-4·§5-5)', () => {
  const page = () => read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));

  it('거의 같은 스크립트를 두 개 쌓지 않는다 — 토글 하나로 전환한다', () => {
    const src = page();
    expect(src).toMatch(/<CdpSnippetBox/);
    // 옛 방식: 웹/앱 스니펫을 각각 pre로 나란히 그리던 코드가 돌아오면 안 된다
    expect(src).not.toMatch(/앱 웹뷰\) — 앱 웹뷰 페이지에 붙여넣기/);
  });

  it('코드 블록 동시 노출은 1개다', () => {
    const box = read(path.join(FRONTEND_SRC, 'components/cdp/CdpSnippetBox.tsx'));
    // 활성 변형 하나만 그린다 — pre가 목록 순회 안에 있으면 여러 개가 동시에 뜬다
    expect(box).not.toMatch(/variants\.map[\s\S]{0,400}<pre/);
    expect(box).toMatch(/\{active\.code\}/);
  });

  it('설치 진단이 중복으로 남아 있지 않다 — 스테퍼 ③이 그 몫을 한다', () => {
    const src = page();
    expect(src).not.toMatch(/installStatus && customTab === 'web'/);
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
