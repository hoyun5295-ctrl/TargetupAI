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
    expect(hook).toContain('연동이 끊겼어요');
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

describe('수집 방식 축 (★2026-08-10 — 화면 문구가 몰 유형과 어긋나던 뿌리)', () => {
  const keys = () => keysFile();

  it('자체 호스팅만 개발자 설치다 — 백엔드 어댑터가 webhook으로 선언한 몰과 1:1', () => {
    expect(keys()).toMatch(/key: 'custom',[\s\S]{0,200}collect: 'developer'/);
    expect(read(path.join(BACKEND_SRC, 'utils/custom-self-hosted-adapter.ts'))).toContain("connectMethod: 'webhook'");
  });

  it('카페24·아임웹은 자동 수집이다 — 웹훅을 우리가 받는다', () => {
    const src = keys();
    expect(src).toMatch(/key: 'cafe24',[\s\S]{0,200}collect: 'auto'/);
    expect(src).toMatch(/key: 'imweb',[\s\S]{0,200}collect: 'auto'/);
    expect(read(path.join(BACKEND_SRC, 'utils/cafe24-client.ts'))).toContain("connectMethod: 'oauth'");
    expect(read(path.join(BACKEND_SRC, 'utils/imweb-client.ts'))).toContain("connectMethod: 'oauth'");
  });

  it('매핑 보류 몰은 수집 경로가 없다 — 이 축으로 문구를 만들지 않는다(배지가 준비 중)', () => {
    const src = keys();
    expect(src).toMatch(/key: 'naver',[\s\S]{0,200}collect: null/);
    expect(src).toMatch(/key: 'makeshop',[\s\S]{0,200}collect: null/);
  });

  it('훅이 연결 후 0건을 두 갈래로 가른다 — 설치 대기와 첫 주문 대기는 다른 상태다', () => {
    const hook = read(path.join(FRONTEND_SRC, 'hooks/useCdpIntegrationStatus.ts'));
    expect(hook).toMatch(/collect === 'developer'[\s\S]{0,200}'설치만 남았어요'/);
    expect(hook).toContain('연결됨 · 첫 주문을 기다리는 중');
  });

  it('화면이 버튼 문구 표를 다시 만들지 않는다 — 배지로 접으면 두 상태가 한 문구로 덮인다', () => {
    const dash = read(path.join(FRONTEND_SRC, 'components/cdp/CdpIntegrationDashboard.tsx'));
    expect(dash).not.toMatch(/ACTION_LABEL/);
    expect(dash).toMatch(/\{st\.actionLabel\}/);
  });

  it('스테퍼가 설치 안내와 탈출구를 몰 유형으로 가른다 — 설치가 없는 몰에 개발자 버튼을 두지 않는다', () => {
    const step = read(path.join(FRONTEND_SRC, 'components/cdp/CdpIntegrationStepper.tsx'));
    expect(step).toMatch(/const needsInstall = status\.collect === 'developer'/);
    expect(step).toMatch(/needsInstall && onDeveloperSend/);
    expect(step).toContain('따로 설치할 것은 없습니다');
    expect(step).toContain('설치 코드를 고객사 개발자에게 전달해야');
  });
});

describe('고도몰 주기 수집 (★2026-08-10 — collect:auto 선언의 근거)', () => {
  it('주기 수집 워커가 실존하고 부팅에 등록돼 있다 — 없으면 "자동 수집"이 거짓말이 된다', () => {
    const worker = path.join(BACKEND_SRC, 'utils/godo-sync-worker.ts');
    expect(existsSync(worker)).toBe(true);
    const app = read(path.join(BACKEND_SRC, 'app.ts'));
    expect(app).toContain('startGodoSyncWorker');
  });

  it('수집 로직을 다시 쓰지 않고 기존 백필 CT를 부른다 — 창 분할·커서·멱등이 한 곳이어야 한다', () => {
    const src = read(path.join(BACKEND_SRC, 'utils/godo-sync-worker.ts'));
    expect(src).toContain('backfillGodoOrders');
    // 워커가 직접 API를 때리거나 주문을 적재하기 시작하면 멱등·커서 규약이 두 벌이 된다
    expect(src).not.toMatch(/fetchGodoOrderPage|syncOrder\(/);
  });

  it('수집 실패로 연동 상태를 끊지 않는다 — 화면이 그 몰을 "연결 안 됨"으로 뒤집는다', () => {
    const src = read(path.join(BACKEND_SRC, 'utils/godo-sync-worker.ts'));
    expect(src).not.toMatch(/status\s*=\s*'(error|revoked|token_expired)'/);
    expect(src).toMatch(/godo_sync_error/);
  });

  it('한 회차 상한이 연결 시 백필과 같은 깊이다 — 얕으면 공백이 조용히 잊힌다', () => {
    const worker = read(path.join(BACKEND_SRC, 'utils/godo-sync-worker.ts'));
    const client = read(path.join(BACKEND_SRC, 'utils/godo-client.ts'));
    const workerCap = worker.match(/const MAX_WINDOW_DAYS = (\d+)/)?.[1];
    const connectDepth = client.match(/const DEFAULT_BACKFILL_DAYS = (\d+)/)?.[1];
    // 둘 다 못 찾으면 undefined === undefined로 조용히 통과한다 — 그 길을 먼저 막는다
    expect(workerCap, '워커 상한 상수를 못 찾았다').toBeDefined();
    expect(connectDepth, '연결 백필 깊이 상수를 못 찾았다').toBeDefined();
    expect(
      workerCap,
      '워커 상한이 연결 백필보다 얕으면 그 차이만큼이 영영 안 들어온다 — 성공 시 last_synced_at이 갱신돼 경고까지 사라진다',
    ).toBe(connectDepth);
  });

  it('실패한 회차는 커서를 전진시키지 않는다 — 올리면 그 구간이 창 밖으로 밀려 영영 안 들어온다', () => {
    const src = read(path.join(BACKEND_SRC, 'utils/godo-sync-worker.ts'));
    // last_synced_at 갱신은 성공 경로 하나뿐
    const advances = src.match(/last_synced_at = NOW\(\)/g) || [];
    expect(advances.length).toBe(1);
  });
});

describe('조치 필요 배지 (★2026-08-10 — 근거 확정)', () => {
  it('판정 문자열의 근거는 어댑터가 실제로 쓰는 값이다 — refresh 실패 시 4종이 token_expired를 기록한다', () => {
    for (const f of ['cafe24-client.ts', 'imweb-client.ts', 'makeshop-client.ts', 'naver-commerce-client.ts']) {
      expect(read(path.join(BACKEND_SRC, 'utils', f)), `${f}가 token_expired를 기록하지 않는다`).toContain("status = 'token_expired'");
    }
    const hook = read(path.join(FRONTEND_SRC, 'hooks/useCdpIntegrationStatus.ts'));
    expect(hook).toMatch(/isIntegrationAuthBroken[\s\S]{0,400}'token_expired'/);
    // 사용자가 스스로 끊은 것(revoked)은 조치 대상이 아니다 — 연결 안 됨이 맞다
    expect(hook).not.toMatch(/status === 'revoked'/);
  });

  it('카페24가 만료 사유를 응답에 싣는다 — 옛 응답은 미연결과 구분이 안 됐다', () => {
    const src = read(path.join(BACKEND_SRC, 'routes/cafe24.ts'));
    expect(src).toMatch(/connected: false, status: integration\?\.status/);
  });

  it('고도몰은 토큰이 없으므로 수집 실패 사유가 그 신호다', () => {
    expect(read(path.join(BACKEND_SRC, 'utils/godo-client.ts'))).toMatch(/syncError/);
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    expect(page).toMatch(/godo: !!godoStatus\?\.syncError/);
  });

  it('조치 필요가 미연결보다 앞선다 — 끊긴 연동을 "아직 연결 전"으로 보여주면 재연결이 필요한 줄 모른다', () => {
    const hook = read(path.join(FRONTEND_SRC, 'hooks/useCdpIntegrationStatus.ts'));
    const actionAt = hook.indexOf("badge: 'action'");
    const disconnectedAt = hook.indexOf("badge: 'disconnected'");
    expect(actionAt).toBeGreaterThan(-1);
    expect(disconnectedAt).toBeGreaterThan(-1);
    expect(actionAt, '조치 필요 분기가 미연결 분기보다 먼저 와야 한다').toBeLessThan(disconnectedAt);
  });

  it('화면이 그 축을 실제로 훅에 넘긴다 — 안 넘기면 배지가 영원히 안 켜진다', () => {
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    expect(page).toMatch(/needsAction: dashboardNeedsAction/);
  });
});

describe('접근 권한 격리 (★2026-08-10 — 화면이 담당자에게 열려 있다)', () => {
  const PROVIDER_ROUTES = ['cafe24.ts', 'naver-commerce.ts', 'godo.ts', 'imweb.ts', 'makeshop.ts'];

  it('연동 화면은 담당자에게 열려 있다 — 그래서 아래 격리가 성립해야 한다', () => {
    const app = read(path.join(FRONTEND_SRC, 'App.tsx'));
    expect(app).toMatch(/allowedTypes=\{\['company_admin', 'company_user'\]\}[\s\S]{0,80}<CdpSettingsPage/);
  });

  it('활성 고객 목록은 관리자 전용이다 — 이름·전화가 담긴 회사 전체 응답이다', () => {
    const src = read(path.join(BACKEND_SRC, 'routes/cdp.ts'));
    expect(src).toMatch(/active-customers'[\s\S]{0,600}userType !== 'company_admin'/);
    // 화면도 같은 기준 — 진입점과 로드 호출 둘 다
    const page = read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));
    expect(page).toMatch(/isAdmin \? fetch\('\/api\/cdp\/active-customers/);
    expect(page).toMatch(/isAdmin && \([\s\S]{0,200}setActiveModal\('customers'\)/);
  });

  it('연결·해제·자격 저장은 provider 5종 전부 관리자 전용이다', () => {
    for (const f of PROVIDER_ROUTES) {
      expect(read(path.join(BACKEND_SRC, 'routes', f)), `${f}에 관리자 게이트가 없다`).toContain('company_admin');
    }
  });

  it('회사 식별자를 클라이언트 입력에서 받지 않는다 — 받는 순간 회사 간 열람이 열린다', () => {
    const files = ['routes/cdp.ts', ...PROVIDER_ROUTES.map((f) => `routes/${f}`)];
    for (const f of files) {
      const code = read(path.join(BACKEND_SRC, f)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${f}가 body·query·params의 companyId를 읽는다`).not.toMatch(/req\.(body|query|params)\??\.\.?(companyId|company_id)/);
    }
  });
});

describe('페이지 분해 (Phase 5 · ★2026-08-10)', () => {
  const page = () => read(path.join(FRONTEND_SRC, 'pages/CdpSettingsPage.tsx'));

  it('새 동적 import를 만들지 않는다 — 0718 사고 축은 라우트 동적 import 경로였다', () => {
    // 이 페이지 자체가 이미 lazy 대상이라, 안에서 또 가르면 난독화가 깨뜨릴 경로 문자열이 늘어난다.
    expect(page()).not.toMatch(/\bimport\s*\(/);
  });

  it('분리한 표시 블록을 정적으로 가져온다', () => {
    const src = page();
    expect(src).toMatch(/^import CdpAnalyticsPanels from/m);
    expect(src).toMatch(/^import CdpActiveCustomersTable from/m);
  });

  it('차트 라이브러리가 페이지로 돌아오지 않는다 — 돌아오면 분리가 무의미해진다', () => {
    expect(page()).not.toMatch(/from 'recharts'/);
  });

  it('라벨·포맷 표가 두 벌이 되지 않는다 — 한쪽만 고쳐지는 죽은 사본을 막는다', () => {
    const src = page();
    for (const table of ['SOURCE_LABEL', 'CHANNEL_LABEL', 'CHANNEL_COLOR']) {
      expect(src, `${table}이 페이지에 다시 선언됐다`).not.toMatch(new RegExp(`const ${table}\\s*:`));
    }
    expect(src).not.toMatch(/const formatPct =/);
    expect(src).not.toMatch(/const formatWon =/);
  });

  it('분리한 컴포넌트는 상태를 갖지 않는다 — 조회·권한 판정은 페이지 몫이다', () => {
    for (const f of ['components/cdp/CdpAnalyticsPanels.tsx', 'components/cdp/CdpActiveCustomersTable.tsx']) {
      const src = read(path.join(FRONTEND_SRC, f));
      expect(src, `${f}가 상태를 들고 있다`).not.toMatch(/useState[<(]/);
      expect(src, `${f}가 직접 조회한다`).not.toMatch(/fetch\(/);
    }
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
