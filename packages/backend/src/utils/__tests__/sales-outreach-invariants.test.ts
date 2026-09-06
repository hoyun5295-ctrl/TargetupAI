/**
 * AI 영업 아웃리치 불변식 (2026-08-24 신설 — docs/2026-07-31-ai-sales-outreach-design.md §15-6, 회의 H11·H17·H18 · ★2026-09-05 D-2 보강)
 *
 * 잠그는 것
 *  1. 모델명 0 — 아웃리치 축 파일 전체(주석 포함)에 모델명 문자열이 없다. 이 축은 메일·공개 페이지로
 *     외부에 나가는 문자열을 만드는 곳이라 파일 지정 전수 0을 계약으로 건다(D190→D214+ 재발 이력).
 *  2. 라우트 err 원문 미노출 — err?.message(원문)는 console 줄에서만 쓴다. 응답은 분류 오류의 안전 문구만.
 *  3. sweeper 부팅 등재 — app.ts에 startSalesOutreachSweeper() 호출이 실재한다(선언은 의도, 워커가 사실).
 *  4. 발송 경로 — 제안 발송 1곳(사람 클릭) + 검수 발송 1곳(사람 클릭 · 허용 도메인). sweeper는 발송 능력이 없다.
 *  5. 내부 URL 미주입 — 메일 조립 파일은 내부 API 경로(/api/sales-outreach)를 모른다(H2 — 손에 없으면 샐 수 없다).
 *  6. 게이트 fail-closed — 아웃리치 축에 super_admin 무조건 통과 분기가 없다. 효과 함수는 첫 await가 assertOperator다.
 *  7. 실패 종결 단일 함수(markFailed) — sweeper·잡 CT에 raw `stage = 'failed'` UPDATE가 markFailed 밖에 없다(불변 10·21).
 *  8. 되돌리기 단일 함수(resetJobTo) — stage_results 키 삭제(`- '`)는 resetJobTo·advanceStage(ready) 안에만.
 *  9. SQL 계약 — 발송 선점·자산 결속·regen 삭제 문자열이 정확히 1회.
 * 10. noindex 소급 — DM 공개 뷰어 2곳에 아웃리치 회사 판정 헤더 1줄 · 공개 샘플 경로 리미터가 mount보다 앞.
 * 11. 검수 발송은 stage·mail_result를 바꾸지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** 주석 제거 후 검사 — 이력을 적은 주석이 "호출이 남았다"로 오판되지 않게(LESSONS_BACKEND 2026-07-31) */
const readCode = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\/\/[^\n'"`]*$/gm, ' ');
const count = (s: string, needle: string) => s.split(needle).length - 1;
const normWs = (s: string) => s.replace(/\s+/g, ' ');

const OUTREACH_FILES = [
  'utils/sales-outreach-jobs.ts',
  'utils/sales-outreach-extract.ts',
  'utils/sales-outreach-produce.ts',
  'utils/sales-outreach-style.ts',
  'utils/sales-outreach-sweeper.ts',
  // ★ 2026-09-06 S4 파기 공용(sweeper·사람 삭제가 같은 본문)
  'utils/sales-outreach-purge.ts',
  // ★ 2026-09-06 S5 조립 엔진(결정 구간 공용) + 고객 재료 입구 — 같은 축, 같은 스캔(모델명 0 · 줄표 0)
  'utils/campaign-engine.ts',
  'utils/campaign-quick.ts',
  'utils/sales-outreach-media.ts',
  'utils/sales-outreach-exemplars.ts',
  'utils/sales-outreach-exemplar-seed.ts',
  'utils/sales-outreach-exemplar-mask.ts',
  'utils/sales-outreach-examples.ts',
  'utils/sales-outreach-look.ts',
  'utils/sales-outreach-review.ts',
  'utils/sales-outreach-bulk.ts',
  // ★ 2026-09-06 S1 렌더 크롤(가드 판정 · 클라이언트 · 워커) — 같은 축, 같은 스캔
  'utils/sales-outreach-render-guard.ts',
  'utils/sales-outreach-render.ts',
  'workers/outreach-render-worker.ts',
  'utils/outreach-mailer.ts',
  'routes/sales-outreach.ts',
  'routes/outreach-public.ts',
];

/** `export async function NAME(` 부터 다음 최상위 `export`/`async function`/`function` 선언 직전까지 */
function fnBody(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start < 0) return '';
  const rest = src.slice(start + header.length);
  const m = rest.search(/\n(?:export |async function |function |const |\/\*\*)/);
  return src.slice(start, m < 0 ? undefined : start + header.length + m);
}

describe('sales-outreach invariants', () => {
  it('모델명 0 — 축 전체 파일(주석 포함)', () => {
    for (const f of OUTREACH_FILES) {
      const src = read(f);
      expect(src, `${f}에 모델명 문자열`).not.toMatch(/sonnet|opus|haiku|claude|anthropic|gpt-/i);
    }
  });

  it('라우트 err 원문 미노출 — err?.message는 console 줄에서만', () => {
    // 공허 통과 방지 — 관리 라우트에는 분류 오류 처리(OutreachError)가 실재해야 한다(공개 라우트는 고정 문구만이라 대상 아님)
    expect(read('routes/sales-outreach.ts')).toContain('OutreachError');
    for (const f of ['routes/sales-outreach.ts', 'routes/outreach-public.ts']) {
      const src = read(f);
      for (const line of src.split('\n')) {
        if (/\b(err|error|e)\??\.message\b|String\((err|error|e)\)/.test(line) && !line.includes('console.')) {
          if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
          // respondError 안의 분류 오류(OutreachError)의 message는 서버가 만든 안전 문구다
          if (line.includes('err.message') && line.includes('err instanceof OutreachError')) continue;
          if (line.includes('error: err.message')) continue;
          throw new Error(`${f}: err 원문이 console 밖에서 쓰였다 — ${line.trim()}`);
        }
      }
    }
    // 위 allow 줄은 respondError 함수 안에만 존재한다
    const routes = readCode('routes/sales-outreach.ts');
    const body = fnBody(routes, 'function respondError(');
    expect(body).toContain('err instanceof OutreachError');
    const outside = routes.replace(body, '');
    expect(outside).not.toMatch(/error:\s*err\.message/);
  });

  it('sweeper 부팅 등재 — app.ts 실배선', () => {
    const app = read('app.ts');
    expect(app.indexOf('startSalesOutreachSweeper()')).toBeGreaterThan(-1);
  });

  it('발송 경로 — 제안 1곳 + 검수 1곳(둘 다 사람 클릭 함수) · sweeper는 발송 능력 0', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    expect((jobs.match(/sendOutreachProposalMail\(/g) || []).length, '제안 발송 호출부는 sendOutreachMailForJob 1곳').toBe(1);
    expect((jobs.match(/mailerSendTest\(/g) || []).length, '검수 발송 호출부는 sendOutreachTestMail 1곳').toBe(1);
    const testBody = fnBody(jobs, 'export async function sendOutreachTestMail(');
    expect(testBody).toContain('mailerSendTest(');
    expect(testBody).toContain('isAllowedTestRecipient(');
    const sweeper = read('utils/sales-outreach-sweeper.ts');
    expect(sweeper).not.toMatch(/sendOutreachProposalMail|sendOutreachTestMail|sendMail|runOutreachJob|runProduction/);
  });

  it('메일 조립 파일은 내부 API 경로를 모른다(H2)', () => {
    const produce = read('utils/sales-outreach-produce.ts');
    expect(produce).toContain('assembleProposalEmail'); // 공허 통과 방지
    expect(produce).not.toContain('/api/sales-outreach');
  });

  it('게이트 fail-closed — super_admin 무조건 통과 분기 없음 · 효과 함수 전수의 첫 await = assertOperator', () => {
    for (const f of ['utils/sales-outreach-jobs.ts', 'routes/sales-outreach.ts']) {
      const src = read(f);
      expect(src, `${f}에 super_admin 우회 분기`).not.toMatch(/userType\s*===\s*'super_admin'\s*\)\s*return\s+true/);
    }
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    expect(jobs).toContain('isSalesOutreachOperator');
    // recordOutreachPreviewView = 공개 페이지 열람 계수(getPublicOutreachHtml 과 같은 무인증 축 · preview_code 가 게이트 · 쓰는 것은 stage_results.views_preview 뿐)
    const ALLOW = new Set(['runOutreachJob', 'markFailed', 'getPublicOutreachHtml', 'recordOutreachPreviewView']);
    const re = /export async function (\w+)\(/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = re.exec(jobs)) !== null) {
      const name = m[1];
      if (ALLOW.has(name)) continue;
      const body = fnBody(jobs, `export async function ${name}(`);
      const gate = body.indexOf('await assertOperator(');
      expect(gate, `${name}: assertOperator 부재`).toBeGreaterThan(-1);
      const firstQuery = body.indexOf('await query(');
      const firstEnv = body.indexOf('process.env');
      if (firstQuery > -1) expect(gate, `${name}: query가 게이트보다 앞`).toBeLessThan(firstQuery);
      if (firstEnv > -1) expect(gate, `${name}: env 읽기가 게이트보다 앞`).toBeLessThan(firstEnv);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it('크롤 소스 — 잡 CT는 같은 URL을 두 번 긁지 않는다 · 추출기는 네트워크 0 · HTML 수집은 전부 아웃리치 상한(800KB)으로', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    expect(jobs).toContain('buildOutreachEventMaterial(');
    expect(jobs).not.toContain('fetchEventTextFromUrl');
    // 공용 기본 200KB 절단이 상품·갤러리를 잘라 빈 껍데기 DM을 냈다(0905 이니스프리 실측) — 옵션 없는 호출 0
    const calls = jobs.match(/fetchHtmlGuarded\([^)]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c, c).toContain('OUTREACH_FETCH_OPTS');
    const mediaSrc = readCode('utils/sales-outreach-media.ts');
    for (const c of mediaSrc.match(/fetchHtmlGuarded\([^)]*\)/g) || []) expect(c, c).toContain('OUTREACH_FETCH_OPTS');
    expect(mediaSrc).toMatch(/OUTREACH_FETCH_OPTS = \{ maxBytes: [3-9]\d{2}_000/);
    const dm = read('routes/dm.ts');
    expect(dm, 'DM 축은 이 함수를 계속 쓴다(공허 통과 방지)').toContain('fetchEventTextFromUrl(');
    const ex = readCode('utils/sales-outreach-extract.ts');
    expect(ex).toContain('extractEventTextFromHtml');
    expect(ex).not.toMatch(/fetchHtmlGuarded\(|fetchEventTextFromUrl\(|https?\.request\(|[^a-zA-Z.]fetch\(/);
    const media = readCode('utils/sales-outreach-media.ts');
    expect(media, '재료 CT의 HTML fetch는 가드 경로뿐').not.toMatch(/https?\.request\(|[^a-zA-Z.]fetch\(/);
  });

  it('실패 종결 단일 함수 — raw stage=failed UPDATE는 markFailed 안에만', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    const markBody = fnBody(jobs, 'export async function markFailed(');
    expect(markBody).toContain("SET stage = 'failed'");
    expect(count(jobs, "SET stage = 'failed'"), 'failed로 쓰는 UPDATE는 markFailed 1곳').toBe(1);
    const sweeper = readCode('utils/sales-outreach-sweeper.ts');
    expect(sweeper).not.toContain("SET stage = 'failed'");
    expect(sweeper).not.toMatch(/fail_stage\s*=/);
    expect((sweeper.match(/markFailed\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('되돌리기 단일 함수 — stage_results 키 삭제는 resetJobTo·advanceStage(ready) 안에만', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    const reset = fnBody(jobs, 'async function resetJobTo(');
    const advance = fnBody(jobs, 'async function advanceStage(');
    expect(reset).toContain("` - '${k}'`");
    expect(count(advance, "- 'regen'")).toBe(1);
    const rest = jobs.replace(reset, '').replace(advance, '');
    expect(rest).not.toMatch(/stage_results[^\n;]*\)\s*-\s*'/);
    expect(rest).not.toContain("- 'regen'");
    for (const fn of ['retryOutreachJob', 'recrawlOutreachJob', 'regenerateOutreachAsset', 'rebuildOutreachEmail']) {
      expect(fnBody(jobs, `export async function ${fn}(`), `${fn}는 resetJobTo를 쓴다`).toContain('resetJobTo(');
    }
  });

  it('SQL 계약 — 발송 선점 1회 · 원복은 선점 뒤 try 안 · 자산 결속 1회 · jsonb는 JSON.stringify', () => {
    const jobs = normWs(readCode('utils/sales-outreach-jobs.ts'));
    expect(count(jobs, "SET mail_result = 'sending', lock_at = NOW() WHERE id = $1 AND stage = 'ready' AND mail_sent_at IS NULL")).toBe(1);
    const sendBody = normWs(fnBody(readCode('utils/sales-outreach-jobs.ts'), 'export async function sendOutreachMailForJob('));
    const claimIdx = sendBody.indexOf("SET mail_result = 'sending'");
    const revertIdx = sendBody.indexOf("SET mail_result = 'unknown' WHERE id = $1 AND mail_result = 'sending'");
    expect(revertIdx).toBeGreaterThan(claimIdx);
    expect(sendBody.slice(claimIdx, revertIdx)).toContain('try {');
    expect(count(jobs, 'WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = $4 AND lock_token = $5)')).toBe(1);
    // jsonb 규율 — ::jsonb를 쓰는 query 조각은 JSON.stringify를 함께 쓰거나 params 배열을 넘긴다
    const raw = readCode('utils/sales-outreach-jobs.ts');
    const re = /await query\(([\s\S]*?)\);/g;
    let m: RegExpExecArray | null;
    let jsonbCalls = 0;
    while ((m = re.exec(raw)) !== null) {
      if (!m[1].includes('::jsonb')) continue;
      jsonbCalls++;
      expect(/JSON\.stringify\(|,\s*params,?\s*$/.test(m[1]), `jsonb 파라미터 직렬화 누락: ${m[1].slice(0, 80)}`).toBe(true);
    }
    expect(jsonbCalls).toBeGreaterThanOrEqual(8);
  });

  it('noindex 소급 — DM 공개 뷰어 2곳 · 공개 샘플 리미터가 mount보다 앞', () => {
    const dm = readCode('routes/dm.ts');
    const lines = dm.split('\n').filter((l) => l.includes("X-Robots-Tag") && l.includes('getOutreachContext()?.companyId'));
    expect(lines).toHaveLength(2);
    const app = read('app.ts');
    const limiter = app.indexOf("app.use('/api/outreach/v', outreachPublicLimiter)");
    const mount = app.indexOf("app.use('/api/outreach/v', outreachPublicRoutes)");
    expect(limiter).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(limiter);
  });

  it('검수 발송은 stage·mail_result를 바꾸지 않는다', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    const body = fnBody(jobs, 'export async function sendOutreachTestMail(');
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/SET\s+stage\s*=/);
    expect(body).not.toMatch(/mail_result\s*=/);
    expect(body).not.toMatch(/mail_sent_at\s*=/);
    expect(body).toContain('test_sends');
  });

  it('실물 예시 kind 분리 — 직원 갤러리·재증류 경로는 outreach_example을 모른다 · 마스킹 CT는 DB 0 · 승격은 best-copy CT만 쓴다', () => {
    const assets = readCode('utils/best-copy-assets.ts');
    expect(assets).toContain("OUTREACH_EXAMPLE_KIND = 'outreach_example'");
    expect(readCode('utils/best-copy-assets.ts').match(/kind = 'style_example' AND industry_code = \$1\s+ORDER BY created_at ASC LIMIT 6/)).toBeTruthy(); // 갤러리 조회 무변경
    for (const f of ['routes/ai.ts', 'utils/industry-formula.ts']) expect(read(f)).not.toContain('outreach_example');
    const mask = readCode('utils/sales-outreach-exemplar-mask.ts');
    expect(mask).not.toMatch(/config\/database|pool\.query|await query\(|https?\.request\(|[^a-zA-Z.]fetch\(/);
    const ex = readCode('utils/sales-outreach-examples.ts');
    expect(ex).not.toMatch(/INSERT INTO best_copy_assets|DELETE FROM best_copy_assets/); // 쓰기는 소유 CT(best-copy-assets)만
    expect(ex).toContain('checkExemplarHygiene(');
    expect(ex).toContain('findOutreachExampleBySource(');
    const admin = read('routes/admin.ts');
    expect(admin).toContain("router.post('/best-layout/examples/promote'");
    expect(admin.indexOf("router.use('/best-layout', authenticate, requireSuperAdmin, requireBestLayoutViewer)")).toBeLessThan(admin.indexOf("router.post('/best-layout/examples/promote'"));
    // 실물 예시 라우트의 회사 = ENV뿐(요청 companyId 무시) — resolve·promote 본문에 resolveSkeletonCompanyId가 없다
    const exBlock = admin.slice(admin.indexOf("router.get('/best-layout/examples'"), admin.indexOf("router.post('/best-layout/skeleton/serving'"));
    expect(exBlock.length).toBeGreaterThan(500);
    expect(exBlock).not.toContain('resolveSkeletonCompanyId(');
    expect((exBlock.match(/outreachExampleCompanyId\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    // 생성 경로가 DB+seed 원천을 순수 빌더에 주입한다(seed-only 회귀 차단)
    const produce = readCode('utils/sales-outreach-produce.ts');
    expect(produce).toContain('buildDmSectionsPrompt(genInput, exemplarSource)');
    expect(produce).toContain('buildEmailSectionsPrompt(genInput, exemplarSource)');
    expect((produce.match(/await loadOutreachExemplarSource\(\)/g) || []).length).toBe(2);
    expect(produce).toContain('exemplars = dmPrompt.exemplars;');
    // ★ v3 조립/발행 분리 — 근거 수치는 조립 결과(AssembledDm.exemplars)에서 옛 결과 모양으로 옮긴다
    expect(produce).toContain('exemplarCount: a.exemplars.picked');
    // ★ 2026-09-06 S5 생성기는 엔진 deps 안(outreachEngineDeps) · 엔진 파일은 아웃리치 파일을 모른다(순환 0)
    expect(produce).toContain('export function outreachEngineDeps()');
    expect(readCode('utils/campaign-engine.ts')).not.toMatch(/sales-outreach-/);
  });

  it('★0905(3) 룩·검수 축 — 구도는 섹션 최상위(props 아님) · brand_kit 키 화이트리스트 · logo_url 0 · 후보 24 · 재료·섹션 라우트 · 재생성 축 분리', () => {
    const look = readCode('utils/sales-outreach-look.ts');
    // 값은 허용표 import — 문자열 표를 새로 만들지 않는다
    expect(look).toContain("import { TREATMENTS } from './dm/dm-art-direction'");
    expect(look).toContain("import { EMAIL_TREATMENTS, EMAIL_BACKGROUNDS } from './email/email-blocks'");
    expect(look).not.toContain('logo_url');
    expect(look).toContain("OUTREACH_BRAND_KIT_KEYS: readonly string[] = ['primary_color', 'art_direction']");
    // 구도·배경면은 섹션 최상위에 쓴다(props 안에 treatment/background 0)
    expect(look).toContain('{ ...s, ...(treatment ? { treatment } : {}), ...(background ? { background } : {}) }');
    expect(look).not.toMatch(/props:\s*\{[^}]*(treatment|background)/);
    // 두 채널이 함께 허용하는 배경면만 · DM 렌더러 허용표에 그 둘이 있다
    expect(look).toContain("OUTREACH_BACKGROUNDS: readonly string[] = ['soft', 'tint']");
    expect(read('utils/dm/dm-section-renderer.ts')).toContain("const BGX_KEYS = ['soft', 'tint', 'dark', 'gradient', 'glass']");
    for (const f of ['utils/sales-outreach-look.ts', 'utils/sales-outreach-review.ts']) {
      expect(readCode(f), `${f} = 순수(DB·AI·네트워크 0)`).not.toMatch(/config\/database|await query\(|callAIWithFallback|https?\.request\(|[^a-zA-Z.]fetch\(/);
    }
    const produce = readCode('utils/sales-outreach-produce.ts');
    // 룩 배정은 prune 뒤 · DM brand_kit은 항상 buildOutreachBrandKit(색은 접근성 통과 시에만) · 제안 메일 아트디렉션 하드코딩 0
    // ★ S5 이관 — 룩 배정은 엔진(campaign-engine.ts)이 정리 뒤 순서에 입힌다 · produce 는 deps 로 applyOutreachLook 을 넘긴다
    const engine = readCode('utils/campaign-engine.ts');
    expect(engine).toContain('deps.applyLook(ordered, opts.channel, dims)');
    expect(produce).toContain('applyLook: (sections, channel, dims) => applyOutreachLook(sections, channel, dims)');
    expect(produce).toContain("applyOutreachLook(pruned.sections, 'EMAIL', dims)");
    // ★ v3 brand_kit 은 조립 결과(brandKit)가 들고 발행이 그대로 싣는다(색 = 접근성 보정본 · logo_url 0)
    expect(produce).toContain('brandKit: buildOutreachBrandKit(primary, input.industry)');
    expect(produce).toContain('brand_kit: a.brandKit,');
    expect(produce).not.toMatch(/brand_kit: accessible \? \{ primary_color/);
    expect(produce).not.toMatch(/art_direction: \{ typeScale: 'bold', spacingDensity: 'airy'/);
    expect(produce).toContain('art_direction: outreachArtDirection(input.industry)');
    // 섹션 override는 DM(발행 직전)·이메일(조립 직전) 둘 다 같은 함수로 재적용
    expect(engine).toContain('deps.applyOverride(sectionsBase, (opts.sectionOverride as TOverride | null) || null)');
    expect(produce).toContain('sectionOverride: input.sectionOverride || null,');
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    expect(jobs).toContain("applySectionOverrides(brandSectionsBase, (sr.section_overrides?.email as SectionOverride | undefined) || null)");
    // 후보 24(핫픽스 기본값과 운영 호출부 일치) · 갤러리 예산 동반
    // ★ 2026-09-06 S1 — 후보 24 계약은 그대로, 호출 형태만 배너 상세(alt 동반)의 두 소스 합집합으로 옮겼다(렌더 앞 · 정적 뒤)
    expect(jobs).toContain('bannersOf(rendered.html, finalUrl, 24)');
    expect(jobs).toContain('bannersOf(page.html, staticUrl, 24)');
    // ★ v3 카드 배너 원 URL 을 후보 합집합 뒤에(홈 첫 배너 우선 · 상한 30) — 제작이 사본을 만들고 조립은 srcUrl 로 되찾는다
    expect(jobs).toContain('const imageCandidates = unionStrings(banners.map((b) => b.url), unionStrings(cardBannerUrls, cardBanners.map((b) => b.url), 12), 30);');
    expect(produce).toContain('deadlineMs: OUTREACH_GALLERY_DEADLINE_MS');
    // 재생성 축 분리 — 제목·서두는 email만 · 브랜드 시안은 email+materials
    expect(jobs).toContain("const regenIntro = regenFrom === 'email' || !prevEmail;");
    expect(jobs).toContain("const regenBrand = regenFrom === 'email' || regenFrom === 'materials' || !prevEmail;");
    // 재수집이면 옛 재료 선택은 지운다
    expect(jobs).toContain('mergeBrandProfileOwned(jobId, lockToken, { media, mediaSelection: null })');
    // dm asset이 뷰어 URL·섹션·룩을 싣는다(검토 화면 iframe·숨김·품질 경고의 원천)
    expect(jobs).toContain('viewerUrl: dm.viewerUrl');
    expect(jobs).toContain('sections: dm.sections, sectionsBase: dm.sectionsBase, look: dm.look');
    expect(produce).toContain('viewerUrl: `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}`');
    // 라우트 2개 존재 · 품질 경고는 잠금과 별도 키
    const routes = read('routes/sales-outreach.ts');
    expect(routes).toContain("router.post('/jobs/:id/materials'");
    expect(routes).toContain("router.post('/jobs/:id/sections'");
    expect(jobs).toContain('sendLock: computeSendLock(sendLockEnv(), emailAsset, sendLockMaterialOf(rest.stage_results))');
    const lockBody = fnBody(jobs, 'export function computeSendLock(');
    expect(lockBody, '품질 경고가 잠금 5종에 섞이지 않는다(불변 3)').not.toMatch(/quality|NO_PRODUCTS|FEW_/);
    // 적대 리뷰(0905(3)) 정정 고정 — SQL 자리표시자 `$` 누락 0(재료 재선택·재분석 500) · 아웃리치 DM = scroll · 이미지 재생성이 숨김을 지운다 · 숨김 상한 · preset 근거 승계
    expect(jobs, 'params.length 자리표시자는 반드시 $ 접두').not.toMatch(/[^$]\$\{params\.length\}/);
    expect(jobs).not.toMatch(/= \d+::jsonb/);
    expect(engine).toContain('deps.splitPages(rebuilt.sections, opts.layoutMode)');
    expect(produce).toContain('layoutMode: OUTREACH_DM_LAYOUT_MODE,');
    expect(produce).toContain('layout_mode: OUTREACH_DM_LAYOUT_MODE');
    expect(look).toContain("OUTREACH_DM_LAYOUT_MODE: 'scroll' = 'scroll'");
    // ★ v3 dm·image 재생성은 auto_seq(자동 재조립 카운터)도 지운다
    expect(jobs).toContain("clear: k === 'image' ? ['regen', 'section_overrides', 'auto_seq'] : k === 'dm' ? ['regen', 'auto_seq'] : ['regen']");
    expect(jobs).toContain("regenSeqOf(sr, 'sections') + 1");
    expect(jobs).toContain('const carry = presetSections && prevDm ? prevDm : null;');
    expect(jobs).toContain('hiddenSkipped: dm.hiddenSkipped');
    expect(engine).toContain('const look = deps.lookStats(rebuilt.sections);');
    // ★0905(4) 전문가 느낌 — 브랜드 색은 접근성 보정본 · 크롤이 아이콘 PNG 지배색까지 본다 · 갤러리 배너 통째 · 캐러셀 6개 · CTA 2개 보장
    expect(produce).toContain('accessiblePrimaryOf(input.brandColor)');
    expect(produce).not.toContain('isBrandKitPrimaryAccessible(');
    expect(jobs).toContain('resolveBrandColorGuarded(colorHtml, finalUrl');
    expect(produce).toContain("p.layout = 'list_1xN';");
    expect(produce).toContain('const perCarousel = 6;');
    expect(produce).toContain('if (ctaCount < 2) {');
    // ★0905(5) Harold 결재 — 로고는 **헤더 섹션 prop**으로만(brand_kit 키 화이트리스트는 그대로 2개) · 크롤이 후보를 뽑고 제작이 실물 게이트를 지난 사본만 싣는다
    expect(look).not.toContain('logo_url');
    expect(produce).toContain('if (media.logoUrl) { p.logo_url = media.logoUrl;');
    expect(produce).toContain('pngLooksWhite(img.buffer)');
    expect(jobs).toContain('logoCandidates: unionStrings(rendered ? extractLogoCandidates(rendered.html, finalUrl) : [], page ? extractLogoCandidates(page.html, staticUrl) : [], 4)');
    expect(jobs).toContain('logoCandidates: Array.isArray(bp.logoCandidates) ? bp.logoCandidates : []');
    // 히어로 = 홈 첫 배너(문서 순서) · 포스터는 두 번째 비주얼 · 갤러리 수집은 면적 정렬 0 (고객 입구 채우기 · 옛 문자열 유지)
    expect(produce).toContain("const heroImage = galleryAll[0]?.url || media.posterUrl || media.products[0]?.image_url || '';");
    // ★ v3 아웃리치 채우기 — 히어로 = 카드1 배너(비율 통과) → 홈 첫 배너 → 포스터 → 상품 · gallery 0
    expect(produce).toContain("const heroImage = card1Hero ? String(card1!.bannerUrl) : (galleryAll.find((g) => !cardBannerSet.has(g.url))?.url || media.posterUrl || media.products[0]?.image_url || '');");
    // 카드 배너 사본은 전용 예산 · 카드 배너는 사람 재료 선택을 거친다 · 재료 게이트는 카드 상세 배너까지 같은 합집합
    expect(produce).toContain('cardBannerUrls?: string[];');
    expect(jobs).toContain('eventCardsOf(selectedList, applyOutreachMediaSelection(bp.media || null, bp.mediaSelection || null))');
    expect(jobs).toContain('banners: allBanners.length, events: candidates.length');
    expect(readCode('utils/sales-outreach-media.ts')).not.toContain('b.width * b.height - a.width * a.height');
  });

  it('★ v3 — 입구 분기 1곳 · 계약 2벌 · 조립/발행 분리 · 자동 재조립 1회 · AI 호출은 계수기 진입점만 · 새 stage_results 키는 RESETTABLE_KEYS 등재 · 전사문 가드', () => {
    const produce = readCode('utils/sales-outreach-produce.ts');
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    const exemplars = readCode('utils/sales-outreach-exemplars.ts');
    // 계약·허용 타입은 함수 1곳에서 갈린다(두 입구 공용 상수 1벌 회귀 차단)
    expect(exemplars).toContain('export function dmSectionContract(');
    expect(exemplars).toContain('export function dmAllowedTypes(');
    expect(produce).toContain('dmSectionContract(i.entry)');
    expect(produce).toContain('generateSections(dmPrompt, dmAllowedTypes(engineInput.entry)');
    // 채우기 4번째 인자(기본 customer) · 아웃리치는 v3 채우기
    expect(produce).toContain("entry: EngineEntry = 'customer',");
    expect(produce).toContain("if (entry === 'outreach') return fillOutreachDmMediaV3(sections, media, channel);");
    // 조립/발행 분리 · 자동 재조립은 같은 dmId 갱신(createDm·publishDm 재호출 0)
    expect(produce).toContain('export async function assembleOutreachDm(');
    expect(produce).toContain('export async function publishOutreachDm(');
    expect(produce).toContain('export async function updateOutreachDm(');
    expect(count(produce, 'await createDm(')).toBe(1);
    expect(count(produce, 'await publishDm(')).toBe(1);
    expect(jobs).toContain('await updateOutreachDm(pub.dmId, second, dmInput)');
    expect(jobs).toContain('autoSeqDm < 1 && Date.now() - dmT0 < 60_000');
    expect(jobs).not.toContain('await produceOutreachDm(');
    // AI 호출은 계수기 진입점만(아웃리치 두 파일에 공용 호출기 직접 호출 0)
    expect(jobs).not.toContain('callAIWithFallback(');
    expect(count(produce, 'await callAIWithFallback(')).toBe(1); // callOutreachAi 안 1곳
    expect(jobs).toContain('withOutreachAiMeter(meter,');
    // 새 stage_results 키 전부 등재
    const keysLine = jobs.slice(jobs.indexOf('const RESETTABLE_KEYS = ['), jobs.indexOf('] as const;', jobs.indexOf('const RESETTABLE_KEYS = [')));
    for (const k of ['event_list', 'crawling_cards', 'palette_render', 'auto_seq', 'ai_cost', 'edits', 'reply_line']) expect(keysLine, k).toContain(`'${k}'`);
    // 배너 전사문은 면허 인용에 못 들어간다(가드가 조립 앞에 선다)
    // 출처 가드(리뷰 R1) — 근거(quoteBasis)에 섞인 전사 수치의 출처는 선택 후보 인용문·사실 수치뿐 · 조립 앞에 선다
    expect(jobs).toContain('assertLicensedQuoteSources(quoteBasis, bannerLines, [...selectedList.map((c) => c.quote), factQuote]);');
    expect(jobs.indexOf('assertLicensedQuoteSources(quoteBasis, bannerLines,')).toBeLessThan(jobs.indexOf('await assembleOutreachDm(dmInput)'));
    // 팔레트 렌더는 별 변수(rendered 에 대입 0)
    expect(jobs).toContain('let paletteShot: RenderResult | null = null;');
    expect(jobs).not.toMatch(/rendered\s*=\s*ps\.result/);
    // 사람 수정 원장(edits)은 append CT 1곳만 쓴다(얕은 병합으로 배열을 통째 덮는 자리 0) · 기록 호출부 ≥ 5(숨김 · 재선택 · 문안 · 제목 · 회신)
    const appendBody = fnBody(jobs, 'async function appendStageResultArray(');
    expect(appendBody).toContain('jsonb_set(');
    expect(count(jobs, "'edits'")).toBeLessThanOrEqual(3); // RESETTABLE_KEYS 등재 + recordOutreachEdit 안 + (설명 문자열 0)
    expect(jobs.replace(appendBody, '')).not.toMatch(/stage_results->'edits'|\{\s*edits\s*:/);
    expect((jobs.match(/await recordOutreachEdit\(/g) || []).length).toBeGreaterThanOrEqual(5);
    // 레시피 승격은 best-copy CT 의 insert 만(jobs 에 INSERT INTO best_copy_assets 0)
    expect(jobs).not.toContain('INSERT INTO best_copy_assets');
    expect(jobs).toContain('await insertOutreachRecipe({');
  });

  it('제작 실패 4단계 3값 — markFailed가 stage_results[failStage]=unavailable을 찍는다', () => {
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    const body = fnBody(jobs, 'export async function markFailed(');
    expect(body).toContain("[failStage]: 'unavailable'");
    expect(body).toContain('fail_detail = $4');
  });
});
