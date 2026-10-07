/**
 * 요금제 공통 안내 창 계약 (★ 2026-09-15 Harold 지시 · 목업 승인)
 *
 * 경위: AI Operator 메뉴가 미가입 회사에 잠겨 있었고, 잠긴 기능을 누르면 뜨는 옛 안내 창은 기능 7개만 설명해
 *   목록에 없는 기능(예: AI Operator)을 누르면 다른 기능("AI 문구 추천") 설명이 나왔다.
 *
 * 못 박는 것:
 *   1. 창에 나오는 크레딧 숫자 = 백엔드 CREDIT_COST_MAP. 손으로 적은 숫자가 단가표와 갈리면 실패한다.
 *   2. AI Operator 허브 카드마다 안내 항목이 있다(카드를 추가하고 설명을 빠뜨리면 실패).
 *   3. 화면이 여는 기능 id는 전부 원장에 있다(없는 id = 빈 창).
 *   4. 문안 금칙어 0 — 모델명·이모지·줄표·"Modal"·내부 코드명·문장 속 크레딧 숫자.
 *   5. 대시보드는 AI Operator를 요금제와 상관없이 연다(진입 확인·진단 분기·안내 모달 분기 0). 옛 안내 창·베타 창 파일은 없다.
 *   6. AI Operator 허브는 서버 판정으로 카드 이동과 [생성]을 막고 공통 안내 창을 연다.
 *   7. ★0915(2) 기능 화면 주소로 직접 들어와도 같은 안내가 된다 — 허브 카드 경로마다 입구(PlanGate)가 그 기능 id로 걸려 있다.
 *   8. ★0915(2) 허브 첫 진입 안내에 옛 "PRO 요금제 특별 혜택" 문구가 없다 · 도움말 카탈로그가 AI 자동제작을 옛 화면으로 설명하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CREDIT_COST_MAP } from '../ai-credit-calc';
import { findJob } from '../../content/feature-catalog';

const FRONT = join(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(join(FRONT, p), 'utf8');
// ★ 2026-10-07 원장 · 영상은 화면 코드 · 공개 폴더 밖(서버)으로 옮겼다(Harold 「구멍 자체를 만들지 마」)
const readLedger = () => readFileSync(join(__dirname, '../../content/plan-feature-intros.ts'), 'utf8');
const MEDIA = join(__dirname, '../../../assets/plan-feature');
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

const INTROS = stripComments(readLedger());
const MODULES = read('constants/ai-operator-modules.ts');
const DASH = stripComments(read('pages/Dashboard.tsx'));
const HUB = stripComments(read('pages/AiOperatorPage.tsx'));
const DIRECT = stripComments(read('components/DirectSendPanel.tsx'));
const BRAND = stripComments(read('components/BrandSendModal.tsx'));
const MODAL = stripComments(read('components/PlanFeatureModal.tsx'));
const HEADER = stripComments(read('components/DashboardHeader.tsx'));
const APP = read('App.tsx');
const GATE = stripComments(read('components/PlanGate.tsx'));
const ACCESS = stripComments(read('utils/ai-operator-access.ts'));
// 화면에 나오는 글자만 본다(경위를 적은 주석은 대상이 아니다)
const WALK = stripComments(read('components/AiOperatorWalkthroughModal.tsx'));

const introIds = new Set([...INTROS.matchAll(/\bid:\s*'([a-z-]+)'/g)].map((m) => m[1]));
const introByPath = new Map([...INTROS.matchAll(/\bid:\s*'([a-z-]+)',\s*path:\s*'([^']+)'/g)].map((m) => [m[2], m[1]]));
const cardPaths = [...MODULES.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);

describe('요금제 공통 안내 창 — 원장', () => {
  it('크레딧 칩 숫자는 백엔드 단가표와 같다', () => {
    const costs = [...INTROS.matchAll(/source:\s*'([^']+)',\s*credits:\s*(\d+)/g)].map((m) => ({ source: m[1], credits: Number(m[2]) }));
    expect(costs.length, '크레딧 칩 추출이 0이면 이 게이트가 죽은 것이다').toBeGreaterThanOrEqual(20);
    const bad = costs.filter((c) => CREDIT_COST_MAP[c.source] !== c.credits).map((c) => `${c.source}: 화면 ${c.credits} · 단가표 ${CREDIT_COST_MAP[c.source]}`);
    expect(bad).toEqual([]);
  });

  it('AI Operator 허브 카드마다 안내 항목이 있다', () => {
    expect(cardPaths.length).toBeGreaterThanOrEqual(10);
    expect(cardPaths.filter((p) => !introByPath.has(p))).toEqual([]);
  });

  it('화면이 여는 기능 id는 전부 원장에 있다', () => {
    const used = [
      ...[...DASH.matchAll(/openPlanFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...HUB.matchAll(/setPlanFeatureId\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...DIRECT.matchAll(/onLockedFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...BRAND.matchAll(/onLockedFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...APP.matchAll(/<PlanGate featureId="([a-z-]+)">/g)].map((m) => m[1]),
    ];
    expect(used.length).toBeGreaterThanOrEqual(20);
    expect(used.filter((id) => !introIds.has(id))).toEqual([]);
    // 옛 형태(기능명 문자열 + 요금제 문자열 두 값)가 남아 있으면 창과 다시 어긋난다
    expect(DIRECT).not.toMatch(/onLockedFeature\('[^']*',\s*'/);
    expect(BRAND).not.toMatch(/onLockedFeature\('[^']*',\s*'/);
  });

  it('문안 금칙어 0 — 모델명·이모지·줄표·Modal·내부 코드명·문장 속 크레딧 숫자', () => {
    const strings = [...INTROS.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).join('\n');
    const rules: [string, RegExp][] = [
      ['모델명', /opus|sonnet|haiku|gpt|claude|anthropic/i],
      ['이모지', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
      ['줄표', /—/],
      ['Modal', /Modal/],
      ['내부 코드명', /\bD\d{2,3}\b|CT-\d+/],
      ['문장 속 크레딧 숫자', /\d+\s*크레딧/],
      ['효과 수치', /\d+\s*%\s*(상승|증가|향상)/],
    ];
    const hits = rules.flatMap(([name, re]) => (re.test(strings) ? [`${name}: ${strings.match(re)?.[0]}`] : []));
    expect(hits).toEqual([]);
    expect(MODAL).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(MODAL).not.toMatch(/opus|sonnet|haiku|gpt|claude|anthropic/i);
  });
});

describe('대시보드 — AI Operator는 요금제와 상관없이 연다', () => {
  it('진입 확인·진단 분기·안내 모달 분기가 없고 바로 이동한다', () => {
    expect(DASH).not.toMatch(/\/api\/ai\/operator\/access/);
    expect(DASH).not.toMatch(/AiOperatorWalkthroughModal/);
    expect(DASH).not.toMatch(/setPlanUpgradeFeature\('AI Operator'\)/);
    expect(DASH).toMatch(/navigate\('\/ai-operator'\)/);
  });

  it('옛 안내 창·베타 창은 파일째 없고, 헤더의 죽은 콜백도 없다', () => {
    expect(existsSync(join(FRONT, 'components/PlanUpgradeModal.tsx'))).toBe(false);
    expect(existsSync(join(FRONT, 'components/BetaFeatureModal.tsx'))).toBe(false);
    expect(DASH).not.toMatch(/PlanUpgradeModal|setShowPlanUpgradeModal|planUpgradeRequired|onAiOperatorClick/);
    expect(HEADER).not.toMatch(/onFeatureLocked|onAiOperatorClick/);
    expect(DASH).toMatch(/<PlanFeatureModal featureId=\{planFeatureId\}/);
  });
});

describe('AI Operator 허브 — 서버 판정으로 막고 공통 안내 창을 연다', () => {
  it('판정은 CT 한 곳(서버 값)에서 온다', () => {
    expect(ACCESS).toMatch(/fetch\('\/api\/ai\/operator\/access'/);
    expect(HUB).not.toMatch(/fetch\('\/api\/ai\/operator\/access'/);
    expect(HUB).toMatch(/fetchAiOperatorAccess\(\)/);
    expect(HUB).toMatch(/const locked = allowed === false;/);
  });

  it('카드는 잠겨 있으면 이동하지 않고 그 기능의 안내를 연다', () => {
    const start = HUB.indexOf('{SUB_MODULE_CARDS');
    expect(start, '허브 카드 렌더 자리를 못 찾으면 이 게이트가 죽은 것이다').toBeGreaterThan(-1);
    const tiles = HUB.slice(start, start + 4000);
    // ★ 2026-09-20 조각 단정으로 바꿈 — 순차 개방 플래그 분기가 같은 자리에 하나 더 들어갔다(아래 테스트가 그것을 본다).
    //   의도는 그대로다: 잠긴 카드는 **이동하지 않고** 그 기능의 안내를 연다.
    expect(tiles).toMatch(/const featureId = intros\?\.idForPath\(card\.path\) \?\? null;/);
    expect(tiles).toMatch(/if \(planLocked && featureId\) \{ setPlanFeatureId\(featureId\); return; \}/);
    expect(tiles).toMatch(/navigate\(card\.path\);/);
    // 안내를 여는 분기가 navigate 보다 **앞**에 있어야 한다(뒤에 있으면 이미 이동한 뒤다)
    expect(tiles.indexOf('setPlanFeatureId(featureId); return;')).toBeLessThan(tiles.indexOf('navigate(card.path);'));
  });

  it('순차 개방 중인 기능은 카드를 숨기지 않고 같은 안내로 보낸다(★2026-09-20)', () => {
    const start = HUB.indexOf('{SUB_MODULE_CARDS');
    const tiles = HUB.slice(start, start + 4000);
    expect(tiles).toMatch(/if \(!isCardOpen\(card, featureFlags\) && featureId\) \{ setPlanFeatureId\(featureId\); return; \}/);
    // ⛔ 카드 목록에서 걸러내면 안 된다 — 없는 메뉴는 물어볼 수도 없다.
    expect(tiles).not.toMatch(/\.filter\(\(card\) => isCardOpen\(/);
  });

  it('[생성]은 잠겨 있으면 제안 요청을 보내지 않는다', () => {
    const submit = HUB.slice(HUB.indexOf('const handleSubmit'), HUB.indexOf("fetch('/api/ai/operator/propose'"));
    expect(submit).toMatch(/if \(planLocked\) \{ setPlanFeatureId\('ai-operator'\); return; \}/);
    expect(HUB).toMatch(/<PlanFeatureModal featureId=\{planFeatureId\}/);
  });

  it('기능 화면 입구에서 돌아오면(intro) 그 기능의 안내를 연다', () => {
    expect(HUB).toMatch(/searchParams\.get\('intro'\)/);
    expect(HUB).toContain('if (locked) void loadPlanFeatureIntros().then((d) => { if (alive && d?.find(intro)) setPlanFeatureId(intro); });'); // ★ 2026-10-07 원장 = 서버
  });
});

describe('기능 화면 입구 — 주소로 직접 들어와도 같은 안내', () => {
  it('허브 카드 경로마다 그 기능 id로 입구가 걸려 있다', () => {
    const bad: string[] = [];
    for (const p of cardPaths) {
      const m = APP.match(new RegExp(`path="${p.replace(/[/-]/g, '\\$&')}"\\s*element=\\{\\s*<PrivateRoute[^>]*>\\s*<PlanGate featureId="([a-z-]+)">`));
      if (!m) bad.push(`${p}: 입구 없음`);
      else if (m[1] !== introByPath.get(p)) bad.push(`${p}: 입구 ${m[1]} · 원장 ${introByPath.get(p)}`);
    }
    expect(bad).toEqual([]);
  });

  it('입구는 잠김일 때만 허브 안내로 보내고, 모름은 막지 않는다', () => {
    expect(GATE).toMatch(/allowed === false \? 'locked' : 'open'/);
    expect(GATE).toMatch(/<Navigate to=\{`\/ai-operator\?intro=\$\{encodeURIComponent\(featureId\)\}`\} replace \/>/);
  });
});

describe('남은 옛 문구', () => {
  it('허브 첫 진입 안내에 옛 요금제 혜택 문구가 없다', () => {
    expect(WALK).not.toMatch(/PRO 요금제|특별 혜택|운영팀에 문의/);
  });

  // ★ 2026-09-27 만들기 개편 — 입구 이름이 "만들기"로 바뀌었다(설계서 docs/2026-09-27-make-redesign-design.md §4 입구 이름 소비처)
  it('도움말 카탈로그가 만들기를 옛 원클릭 캠페인 화면으로 설명하지 않는다', () => {
    const job = findJob('quick-campaign');
    expect(job?.title).toBe('재료로 완성본 만들기');
    expect(job?.entry.via).toContain('"만들기"');
    expect([...(job?.steps || []), job?.goal || ''].join('\n')).not.toMatch(/원클릭 캠페인|인앱/);
  });
});

/**
 * ★ 2026-10-06 예시 영상 + 상세 설명(설계서 docs/2026-10-06-plan-feature-video-modal-design.md · Harold 목업 승인)
 *   영상이 있는 기능은 두 단 창(왼쪽 영상 · 오른쪽 이렇게 씁니다 · 직접 정할 수 있는 것 · 알아서 지켜 주는 것 · 드는 크레딧).
 *   영상은 예시라 오른쪽 설명이 기능을 제대로 말해야 한다(「원하는 시간 · 예산 등 자유롭게 설정」) → 설정 · 안전장치 칸이 함께 있어야 한다.
 */
describe('예시 영상 + 상세 설명', () => {
  // ★ 2026-10-06 허브 카드 12개 전부(Harold 10-06 영상 12편 완성 · 끝 장면 잘라 720p 무음)
  const VIDEO_IDS = ['auto-marketing', 'journeys', 'marketing-planner', 'image-studio',
    'mobile-dm', 'email-campaign', 'inapp-message', 'quick-campaign', 'sns', 'connect-shop', 'performance', 'ai-memory'];
  // 항목 = 「\n  {\n」으로 시작하는 덩어리 하나(id 앞에 주석 줄이 있어도 같은 덩어리 · 주석은 빈 줄로 지워져 있다)
  const ENTRIES = INTROS.split('\n  {\n').map((chunk) => ({ id: chunk.match(/\bid: '([a-z-]+)'/)?.[1] || null, chunk }));
  const block = (id: string) => ENTRIES.find((e) => e.id === id)?.chunk || '';
  const PUBLIC = join(FRONT, '..', 'public');

  it('영상 기능은 영상 · 포스터 파일이 실제로 있고 설정 · 안전장치 칸을 함께 갖는다', () => {
    for (const id of VIDEO_IDS) {
      const b = block(id);
      expect(b, id).toContain(`video: { src: '/videos/plan-feature/${id}.mp4', poster: '/videos/plan-feature/${id}.jpg' }`);
      expect(existsSync(join(MEDIA, `${id}.mp4`)), `${id}.mp4`).toBe(true);
      expect(existsSync(join(PUBLIC, 'videos', 'plan-feature', `${id}.mp4`)), `공개 폴더에 ${id}.mp4`).toBe(false);
      expect(existsSync(join(MEDIA, `${id}.jpg`)), `${id}.jpg`).toBe(true);
      expect(b, `${id} options`).toMatch(/options: \[\s*\{/);
      expect(b, `${id} safeguards`).toMatch(/safeguards: \[\s*\{/);
    }
  });

  it('원장에서 영상을 가진 기능은 정확히 허브 카드 12개다(파일 없는 영상 주소 0)', () => {
    const withVideo = ENTRIES.filter((e) => e.id && e.chunk.includes('video: {')).map((e) => e.id as string);
    expect(withVideo.sort()).toEqual([...VIDEO_IDS].sort());
    // 허브 카드 12개와 같은 집합이다
    expect([...VIDEO_IDS].sort()).toEqual(cardPaths.map((p) => introByPath.get(p)).sort());
  });

  it('창: 영상이 있을 때만 두 단 · 무음 · 반복 · 화면 안 재생 · 움직임 줄이기면 자동재생 대신 재생 버튼', () => {
    expect(MODAL).toContain('if (intro.video) return renderVideoLayout();');
    expect(MODAL).toMatch(/<video[\s\S]*?muted[\s\S]*?loop[\s\S]*?playsInline[\s\S]*?preload="metadata"[\s\S]*?autoPlay=\{!reduceMotion\}[\s\S]*?controls=\{reduceMotion\}/);
    expect(MODAL).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(MODAL).toContain('v.muted = true;');
    // 영상 없는 기능은 옛 한 단 창 그대로(넓이 520)
    expect(MODAL).toContain('sm:max-w-[520px]');
  });

  it('옛 원장 오류: 이미지 스튜디오 생성은 포스터 한 장이다(「후보 2장」 아님) · 자동 마케팅은 매일 제안이 아니라 기간 승인', () => {
    expect(block('image-studio')).not.toContain('후보 2장');
    expect(block('image-studio')).toContain("label: '포스터 만들기(한 장)', source: 'image-studio-generate'");
    expect(block('auto-marketing')).not.toContain('매일 제안');
    expect(block('auto-marketing')).toContain('7일 동안');
  });
});

/**
 * ★ 2026-10-06 Codex 1R(medium 5) — 오른쪽 문장은 고객에게 약속하는 문장이다. 적용 조건이 있는 장치는 조건까지 적는다.
 *   ① 플래너 환불 = 발송 처리 시작 전 취소만(producing·scheduled·발송 시작도 실적) ② 직접 쓴 자동 마케팅 문안 = 같은 문안 통과 결과 재사용
 *   ③ 여정 통과 알림 = 단계별 설정(기본 첫·마지막) · 검사 자체는 모든 단계 ④ 스튜디오 문구 위치 = 행사 포스터만 ⑤ 짧은 휴대폰 화면에서 설명이 사라짐
 */
describe('Codex 1R — 적용 조건까지 적는다 · 짧은 화면', () => {
  const INTROS_RAW = readLedger();
  it('적용 조건 문장', () => {
    expect(INTROS_RAW).toContain('그 달 발송 처리가 시작되기 전에 취소하면');
    expect(INTROS_RAW).not.toContain('아무것도 나가지 않은 채 취소하면');
    expect(INTROS_RAW).toContain('직접 쓴 문안은 같은 문안이 한 번 통과했으면 그 결과를 쓰고');
    expect(INTROS_RAW).toContain('통과 알림은 단계별로 켜고 끌 수 있습니다(기본은 첫 단계와 마지막 단계)');
    expect(INTROS_RAW).toContain('행사 포스터는 문구 위치도 고릅니다');
    expect(INTROS_RAW).not.toContain('문구는 적은 그대로 넣고 위치를 고릅니다');
  });

  it('휴대폰 = 영상 · 머리 · 설명이 함께 스크롤되고 버튼만 고정 · PC = 오른쪽 칸 세 줄(설명만 스크롤)', () => {
    expect(MODAL).toContain('className="flex-1 min-h-0 overflow-y-auto overscroll-contain sm:contents"');
    expect(MODAL).toContain('sm:grid-rows-[auto_minmax(0,1fr)_auto]');
    expect(MODAL).toContain('sm:col-start-2 sm:row-start-2 sm:min-h-0 sm:overflow-y-auto');
    expect(MODAL).toMatch(/shrink-0 border-t px-5 sm:px-6 pt-3 pb-4 sm:col-start-2 sm:row-start-3/);
  });
});

/**
 * ★ 2026-10-06 허브 카드 12개 전부 상세 설명(Harold: 「영상 오늘 다 만들 테니 공간만 비워 두고 전체 다 만들어 놓으면 된다 · 영상 오면 매칭해 한 번에 배포」).
 *   영상은 따로 붙는다(영상 칸 = 파일이 생긴 기능만 · 위 「정확히 이 기능들」 테스트가 그 목록을 소유).
 */
describe('허브 카드 12개 — 상세 설명이 모두 있다', () => {
  const blockByPath = (path: string) => {
    const at = INTROS.indexOf(`path: '${path}'`);
    const next = INTROS.indexOf('\n  {\n', at + 1);
    return INTROS.slice(at, next === -1 ? undefined : next);
  };

  it('허브 카드마다 직접 정할 수 있는 것 · 알아서 지켜 주는 것이 있다', () => {
    const missing = cardPaths.filter((p) => {
      const b = blockByPath(p);
      return !/options: \[\s*\{/.test(b) || !/safeguards: \[\s*\{/.test(b);
    });
    expect(missing).toEqual([]);
  });

  it('바로잡은 옛 문구: 자사몰 연동 매일 분석은 연동 탓이 아니다 · 이메일 제목은 허브 카드와 같다', () => {
    const raw = readLedger();
    expect(raw).not.toContain('연동하면 고객 수에 맞춰 매일 분석 크레딧이 듭니다');
    expect(raw).toContain("costNote: '연동 자체에는 크레딧이 들지 않습니다'");
    expect(raw).toContain("id: 'email-campaign', path: '/email-campaigns', title: '이메일 마케팅'");
  });
});
