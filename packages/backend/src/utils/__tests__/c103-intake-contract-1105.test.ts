/**
 * C103 · 1104 오류접수 처방 — 계약 시험(★ 2026-11-05 설계서 docs/2026-11-05-intake-1104-fix-design.md §5)
 *
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 = 이유 붙은 허용 목록만).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { FIELD_MAP, standardFieldColumn } from '../standard-field-map';
import { STEP_EDIT_KEYS, stepEditPolicy, blockedStepEditGroups } from '../journey-step-edit-policy';
import { findUnfilledAlimtalkVars } from '../alimtalk-vars';
import { unfilledAlimtalkVars, alimtalkStateOfStep, alimtalkStepSelectionIssue } from '../../../../frontend/src/lib/alimtalk-catalog';
import { spamTestRunElapsedMs } from '../spam-test-queue';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const read = (rel: string) => {
  const f = [...backend, ...frontend].find((x) => x.rel === rel);
  if (!f) throw new Error(`파일 없음 ${rel}`);
  return f.text;
};

/** 줄 번호 → 그 줄을 감싼 함수 · 주소 본문(가장 가까운 앞 함수 · router 머리 ~ 다음 머리) */
const enclosing = (text: string, idx: number): string => {
  const heads = [...text.matchAll(/^(?:export )?(?:async )?function \w+|^router\.\w+\(/gm)].map((m) => m.index!);
  const start = heads.filter((h) => h <= idx).pop() ?? 0;
  const end = heads.find((h) => h > idx) ?? text.length;
  return text.slice(start, end);
};

describe('F3 · SC-1 · 여정 회신번호를 쓰는 자리 = 등록 번호 판정 한 곳(journey-callback)', () => {
  it('journeys.callback_number 를 쓰는 SQL 자리(소스 추출)마다 감싼 함수가 assertJourneyCallbackRegistered 를 부른다(복제 = 같은 값 · 이유 붙은 허용)', () => {
    const ALLOW: Record<string, string> = {
      'backend/src/utils/journey-lineage.ts': '새 판 복제 = 원래 여정 행을 그대로 복사(새 번호를 받지 않는다)',
    };
    const sites: string[] = [];
    for (const f of backend) {
      for (const m of f.text.matchAll(/UPDATE journeys SET[^`;]*callback_number|add\('callback_number'|INSERT INTO journeys[\s(]/g)) {
        if (ALLOW[f.rel]) continue;
        const body = enclosing(f.text, m.index!);
        sites.push(`${f.rel}:${body.includes('assertJourneyCallbackRegistered') ? 'ok' : '판정 없음'}`);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(sites.filter((s) => !s.endsWith(':ok'))).toEqual([]);
  });
  it('만들기 두 길(문장 · 상품)은 고른 번호가 등록 번호가 아니면 말없이 기본 번호로 바꾸지 않는다', () => {
    for (const rel of ['backend/src/utils/journey-interview-ai.ts', 'backend/src/utils/journey-product-create.ts']) {
      const src = read(rel);
      expect([rel, src.includes('isRegisteredJourneyCallback(numbers')]).toEqual([rel, true]);
      expect([rel, /numbers\.some\(\(n\) => n\.phone ===/.test(src)]).toEqual([rel, false]);
    }
  });
  it('만들기 창은 등록 번호가 있으면 늘 「어느 번호로 보낼까요?」를 그리고 · [시작] 카드에 「보내는 번호」 칸이 있다', () => {
    const im = read('frontend/src/components/journey/map/InterviewModal.tsx');
    expect(im).not.toMatch(/needsCallbackChoice/);
    expect(im).toContain('어느 번호로 보낼까요?');
    const card = read('frontend/src/components/journey/workspace/JourneyStartCard.tsx');
    expect(card).toContain('data-fix-target="callback"');
    expect(card).toMatch(/setField\('callbackNumber'/);
    expect(card).toMatch(/setField\('callbackMode'/);
    expect(read('frontend/src/utils/journey-start-form.ts')).toMatch(/callbackNumber: String\(j\?\.callback_number/);
  });
});

describe('R56 · 서버 고치기 동작마다 작업 화면 처리가 있다(멈춤 안내 = journey-pause-reason PauseFixAction)', () => {
  it('PauseFixAction 값(소스 추출)마다 작업 화면 runFix 가 다룬다 · 회신번호 = 「보내는 번호」 칸으로', () => {
    const pr = read('backend/src/utils/journey-pause-reason.ts');
    const union = /export type PauseFixAction =([^;]+);/.exec(pr)![1];
    const actions = [...union.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThanOrEqual(7);
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    const runFix = ws.slice(ws.indexOf('const runFix = '), ws.indexOf('\n  };', ws.indexOf('const runFix = ')));
    expect(actions.filter((a) => !runFix.includes(`'${a}'`))).toEqual([]);
    expect(runFix).toMatch(/edit_callback[\s\S]*data-fix-target="callback"/);
    expect(runFix).toMatch(/fix\.stepOrder/);
  });
});

describe('F9 R56 · 여정 서버 문구 속 「…」 이름 = 화면에 실제로 있는 글자', () => {
  it('utils/journey-*.ts 따옴표 글 안 「…」 이름의 고정 조각(… · 숫자 · ${} 자리를 뺀 가장 긴 조각)이 화면 소스에 있다', () => {
    const fe = frontend.map((f) => f.text).join('\n');
    const files = backend.filter((f) => /^backend\/src\/utils\/journey-[^/]*\.ts$/.test(f.rel));
    expect(files.length).toBeGreaterThan(30);
    const missing: string[] = [];
    let names = 0;
    for (const f of files) {
      f.text.split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        for (const m of l.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)) {
          for (const n of (m[1] ?? m[2] ?? '').matchAll(/「([^」]{2,40})」/g)) {
            const parts = n[1].split(/…|\.\.\.|\$\{[^}]*\}|\d+|\bN\b/).map((x) => x.trim().replace(/^[ ·:,.]+|[ ·:,.]+$/g, '')).filter((x) => x.length >= 3);
            if (parts.length === 0) continue;
            names += 1;
            const frag = parts.reduce((a, b) => (b.length > a.length ? b : a));
            if (!fe.includes(frag)) missing.push(`${f.rel}:${i + 1} 「${n[1]}」`);
          }
        }
      });
    }
    expect(names).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('F7 · 고객 DB 엑셀 실패 안내(응답 원문 0 · 칸 없음 503)', () => {
  it('화면 파일 어디에도 응답 글자 원문(res.text())을 오류 문구로 쓰는 자리가 없다(문서 미리보기 HTML 은 이유 붙은 허용)', () => {
    const ALLOW: Record<string, string> = { 'frontend/src/pages/EmailCampaignsPage.tsx': '이메일 미리보기 HTML 본문(오류 문구 아님)' };
    const hits = frontend.filter((f) => /await\s+(res|r|resp|response)\.text\(\)/.test(f.text) && !ALLOW[f.rel]).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
  it('고객 목록 · 다운로드 · 필터 미리보기 catch = 칸 없음 503(db_alter_safety_net)', () => {
    const src = read('backend/src/routes/customers.ts');
    for (const head of ["router.get('/',", "router.get('/download',", "router.post('/filter',"]) {
      const i = src.indexOf(head);
      const body = src.slice(i, src.indexOf('\nrouter.', i + 5));
      expect([head, /catch \(error\) \{[\s\S]*?isMissingSchemaError\(error\)[\s\S]*?status\(503\)/.test(body)]).toEqual([head, true]);
    }
  });
});

describe('F6 R57 · 표준 필드 키 → 고객 칸 = CT 한 곳(standardFieldColumn)', () => {
  it('FIELD_MAP 직접 칸 키 전부가 자기 칸으로 풀린다(가입일 포함)', () => {
    for (const f of FIELD_MAP.filter((x) => x.storageType === 'column')) {
      expect([f.fieldKey, standardFieldColumn(f.fieldKey)]).toEqual([f.fieldKey, f.columnName]);
    }
    expect(standardFieldColumn('joined_at')).toBe('joined_at');
  });
  it('옛 표준 필드 키 별칭(age_group · last_purchase_date · opt_in_sms)은 그대로 · 모르는 키 = null(custom_fields)', () => {
    expect(standardFieldColumn('age_group')).toBe('age');
    expect(standardFieldColumn('last_purchase_date')).toBe('recent_purchase_date');
    expect(standardFieldColumn('opt_in_sms')).toBe('sms_opt_in');
    expect(standardFieldColumn('custom_3')).toBeNull();
    expect(standardFieldColumn('없는_키')).toBeNull();
  });
  it('슈퍼관리자 칸 데이터 유무는 손 매핑 없이 CT 를 부른다', () => {
    const admin = read('backend/src/routes/admin.ts');
    const i = admin.indexOf("'/companies/:id/field-data-check'");
    const body = admin.slice(i, admin.indexOf('router.', i + 10));
    expect(body).toContain('standardFieldColumn(key)');
    expect(body).not.toMatch(/FIELD_COLUMN_MAP/);
  });
});

/** 주소 머리(router.<method>('경로') 마다 본문 · 경로) — routes/ai.ts 전수 */
const routesOf = (text: string) => {
  const heads = [...text.matchAll(/^router\.(get|post|put|patch|delete)\('([^']+)'/gm)];
  return heads.map((m, i) => ({ method: m[1], path: m[2], body: text.slice(m.index!, heads[i + 1]?.index ?? text.length) }));
};

describe('F1 R1 · R5 · 여정 「지금 스팸 검사」 글 = 켜기 검사 글(서버가 저장된 칸으로 만든다)', () => {
  it('여정 화면(components/journey · pages/Journey*)에서 검사 창을 여는 자리마다 journeyStep 이 있다(화면이 글을 다시 만들지 않는다)', () => {
    const sites = frontend.filter((f) => /^frontend\/src\/(components\/journey\/|pages\/Journey)/.test(f.rel))
      .flatMap((f) => [...f.text.matchAll(/<SpamFilterTestModal\b[\s\S]*?\/>/g)].map((m) => ({ f: f.rel, ok: m[0].includes('journeyStep=') && !/messageContent(Sms|Lms)=/.test(m[0]) })));
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(sites.filter((x) => !x.ok)).toEqual([]);
  });
  it('여정 칸 검사 주소 = 입력 CT(journeyStepSpamParams) + 등록 · 보기 CT 만 · 검사 행 원본 응답 0', () => {
    const r = routesOf(read('backend/src/routes/ai.ts')).filter((x) => x.path === '/operator/journeys/:id/steps/:stepId/spam-check');
    expect(r.map((x) => x.method).sort()).toEqual(['get', 'post']);
    for (const x of r) {
      expect([x.method, x.body.includes('journeyStepSpamParams(gate.companyId, gate.userId, req.params.id, req.params.stepId, variantId)')]).toEqual([x.method, true]);
      expect([x.method, /enqueueSpamTest\(|spam_filter_tests|testId:/.test(x.body)]).toEqual([x.method, false]);
    }
    expect(r.find((x) => x.method === 'post')!.body).toContain('enqueueStepSpamCheck(params)');
    expect(r.find((x) => x.method === 'get')!.body).toContain('readStepSpamCheck(params)');
    const v = read('backend/src/utils/journey-pretest-validator.ts');
    const enq = v.slice(v.indexOf('export async function enqueueStepSpamCheck'), v.indexOf('export async function runStepSpamTest'));
    expect(enq).toMatch(/const input = await stepSpamInput\(params\);/);
    expect(enq).toMatch(/manualAdmission: \{ userId: params\.userId \}/);
  });
  it('보기 = 공용 CT 하나(AI 한줄로 칩과 같은 함수) · 옛 판정 원본이 ai-line-spam 에 남지 않는다', () => {
    expect(read('backend/src/services/ai-line-spam.ts')).toContain("import { spamCheckView as verdictOf } from '../utils/spam-test-view';");
    expect(read('backend/src/services/ai-line-spam.ts')).not.toMatch(/async function verdictOf\(/);
    expect(read('backend/src/utils/journey-pretest-validator.ts')).toMatch(/spamCheckView\(seen\.testId, seen\.status, seen\.createdAt/);
  });
});

describe('F2 · 확정 전 유료 스팸 검사 0(1104 접수 2 · 검사 = 누를 때 · 켤 때 · 보내기 전)', () => {
  it('routes/ai.ts 주소 본문(소스 추출) 중 유료 검사 함수를 부르는 주소 = 허용 목록만', () => {
    const PAID = /\b(enqueueStepSpamCheck|runStepSpamTest|enqueueSpamTest|startLineSpamTest|reshapeJourney)\(|validateJourneyForActivation\((?![^)]*spam: peekStepSpam)/;
    const ALLOW: Record<string, string> = {
      'post /operator/journeys/:id/steps/:stepId/spam-check': '「지금 스팸 검사」 누름',
      'post /operator/journeys/:id/pretest-validate': '켜기 확인 창 · 켜기 전 점검 [점검]',
      'post /operator/journeys/:id/reshape': '새 모양 저장 = 켜기',
    };
    const hits = routesOf(read('backend/src/routes/ai.ts')).filter((x) => PAID.test(x.body)).map((x) => `${x.method} ${x.path}`);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.filter((h) => !ALLOW[h])).toEqual([]);
    for (const f of backend) expect([f.rel, /\b(startJourneyStepSpamChecks|startStepSpamCheck)\(/.test(f.text)]).toEqual([f.rel, false]);
  });
  it('켜기 전 점검 창은 열기 · 고르기 · 첫 구매 빼기에서 검증하지 않는다(effect 안 검증 0 · [모두 켜기] · 줄 [점검]만)', () => {
    const b = read('frontend/src/components/journey/map/BatchActivateModal.tsx');
    for (const m of b.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)) expect(m[1]).not.toMatch(/validateOne|checkRow|pretest-validate/);
    expect(b).not.toMatch(/validateAll/);
    expect(b).toContain('켤 때 스팸 검사를 해요. 오늘 같은 글은 다시 검사하지 않아요.');
  });
});

describe('F5 R56 · 최대 인원 뜻 = 화면 문구 CT 한 곳(journey-cap-copy)', () => {
  it('세 화면이 journeyCapHelp 를 부르고 · 옛 문구 리터럴이 화면 어디에도 없다', () => {
    for (const rel of ['frontend/src/components/journey/workspace/JourneyStartCard.tsx', 'frontend/src/components/journey/JourneyActivationConfirmModal.tsx', 'frontend/src/components/journey/map/BatchActivateModal.tsx']) {
      expect([rel, read(rel).includes('journeyCapHelp(')]).toEqual([rel, true]);
    }
    const OLD = /정하지 않으면 제한 없이 보내요|회차마다 나눠|넘으면 나눠 보내/;
    expect(frontend.filter((f) => f.rel !== 'frontend/src/utils/journey-cap-copy.ts' && OLD.test(f.text)).map((f) => f.rel)).toEqual([]);
    const cap = read('frontend/src/utils/journey-cap-copy.ts');
    expect(cap).toContain('그 회차는 보내지 않고 여정이 멈춰요');
  });
});

describe('F10 R56 · 작업 화면 알림톡 칸 = 공용 알림톡 패널로 고친다(알림톡 키 = 문안 묶음)', () => {
  const AT = { alimtalkTemplateCode: 'T2' };
  it('서버 정책 시나리오 = 초안 · 멈춤(진행 0 · 진행 있음) · 켜짐(표식 있음) 모두 그 자리 · 켜짐 표식 없음 = 막힘', () => {
    expect(blockedStepEditGroups(stepEditPolicy('draft', 0), AT, 'draft')).toEqual([]);
    expect(blockedStepEditGroups(stepEditPolicy('paused', 0), AT, 'paused')).toEqual([]);
    expect(blockedStepEditGroups(stepEditPolicy('paused', 3), AT, 'paused')).toEqual([]);
    expect(blockedStepEditGroups(stepEditPolicy('active', 0, 'event'), { ...AT, allowActiveMessageEdit: true }, 'active')).toEqual([]);
    expect(blockedStepEditGroups(stepEditPolicy('active', 0, 'event'), AT, 'active')).toEqual(['copy']);
    expect(blockedStepEditGroups(stepEditPolicy('ended', 0), AT, 'ended')).toEqual(['copy']);
  });
  it('화면 문안 묶음 키(COPY_KEYS) = 서버 STEP_EDIT_KEYS.copy(짝) · 허가 표식 = 그 키가 하나라도 있을 때', () => {
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    const al = /const ALIMTALK_KEYS = \[([^\]]+)\]/.exec(ws)![1];
    const fe = ['messageTemplate', 'subject', ...[...al.matchAll(/'(\w+)'/g)].map((m) => m[1])];
    expect(fe.sort()).toEqual([...STEP_EDIT_KEYS.copy].sort());
    expect(ws).toMatch(/const COPY_KEYS: readonly string\[\] = \['messageTemplate', 'subject', \.\.\.ALIMTALK_KEYS\];/);
    expect(ws).toMatch(/isActive && Object\.keys\(p\)\.some\(\(k\) => COPY_KEYS\.includes\(k\)\) \? \{ \.\.\.p, allowActiveMessageEdit: true \}/);
    expect(STEP_EDIT_KEYS.structure).not.toContain('alimtalkTemplateCode');
  });
  it('알림톡 칸 = 편집기(data-fix-target="alimtalk") · 옛 「문안 수정 창에서 고쳐요」 0 · 재료 = 공용 CT 하나', () => {
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws).toMatch(/data-fix-target="alimtalk"[\s\S]{0,200}<JourneyKakaoStepEditor /);
    for (const f of frontend) expect([f.rel, f.text.includes('문안 수정 창에서 고쳐요')]).toEqual([f.rel, false]);
    expect(read('frontend/src/components/journey/workspace/JourneyKakaoStepEditor.tsx')).toMatch(/<AlimtalkChannelPanel\b/);
    const callers = frontend.filter((f) => /fetch\('\/api\/companies\/kakao-templates\?status=APPROVED'/.test(f.text)).map((f) => f.rel);
    expect(callers.filter((r) => r === 'frontend/src/pages/JourneysPage.tsx' || r.startsWith('frontend/src/components/journey/'))).toEqual([]);
    expect(read('frontend/src/pages/JourneysPage.tsx')).toContain('loadAlimtalkCatalog(t)');
  });
  it('저장 전 화면 검사 = 채널로 가른다(알림톡 = 템플릿 · 변수 연결 · 대체 발송 공용 검증 · 제목 요구 0)', () => {
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    const v = ws.slice(ws.indexOf('const validateCopy = '), ws.indexOf('const save = async'));
    expect(v).toMatch(/if \(s\.channel === 'kakao'\) \{[\s\S]*?alimtalkStepSelectionIssue\(s, alimtalkCatalog\)[\s\S]*?validateAlimtalkChannelState\([\s\S]*?\n      \}/);
  });
  it('변수 연결 판정 = 서버 findUnfilledAlimtalkVars 와 같은 답(짝)', () => {
    const cases: Array<[string | null, Record<string, string> | null]> = [
      ['#{이름}님 #{매장} 안내 #{이름}', { '#{이름}': '@@name@@' }],
      ['#{a} #{b}', { '#{a}': ' ', '#{b}': 'x' }],
      ['변수 없음', null],
      [null, { '#{a}': 'x' }],
      ['#{a}', {}],
    ];
    for (const [c, m] of cases) expect(unfilledAlimtalkVars(c, m)).toEqual(findUnfilledAlimtalkVars(c, m));
  });
});

describe('F11 R5 · 알림톡 칸 글 = 고른 템플릿 본문 한 곳', () => {
  it('서버 사람 고침 길이 알림톡 판정을 지나고 · 채우기 길은 판정 밖', () => {
    const b = read('backend/src/utils/journey-builder.ts');
    const upd = b.slice(b.indexOf('export async function updateJourneyStep'), b.indexOf('async function kakaoStepCopyIn'));
    expect(upd).toMatch(/const kakao = await kakaoStepCopyIn\(run, companyId, journeyId, stepId, patch\);/);
    const fill = b.slice(b.indexOf('export async function fillJourneyCopyFacts'), b.indexOf('const RENUMBER_OFFSET'));
    expect(fill).not.toMatch(/kakaoStepCopyIn/);
    expect(read('backend/src/utils/journey-kakao-step.ts')).toMatch(/export async function kakaoTemplateContent[\s\S]{0,400}company_id = \$2::uuid/);
  });
  it('문안 수정 창 = 알림톡 칸 읽기만 · 저장 대상에서 뺀다', () => {
    const m = read('frontend/src/components/journey/JourneyMessageEditModal.tsx');
    expect(m).toMatch(/const changed = steps\.filter\(\s*\(s\) => s\.channel !== 'kakao' &&/);
    expect(m).toMatch(/s\.channel === 'kakao' \? \(\s*<div[\s\S]{0,400}템플릿은 작업 화면 알림톡 칸에서 바꿔요/);
  });
});

describe('F8 R6 · 이의신청 = 나가는 쓰기가 있다 · 발송 길 = 토큰에 묶임', () => {
  it('컨펌 상태 값(목록 주소 ALLOWED)마다 나가는 쓰기가 있다 — objected = 해소 주소', () => {
    const b = read('backend/src/routes/billing.ts');
    const allowed = [...(/const ALLOWED = \[([^\]]+)\]/.exec(b)![1]).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(allowed).toContain('objected');
    const route = b.slice(b.indexOf("router.put('/confirmations/:id/objection-resolve'"), b.indexOf("router.put('/confirmations/:id/issue-date'"));
    expect(route).toMatch(/taxbill_status = 'objected'[\s\S]*superseded_at IS NULL[\s\S]*objection_resolved_at IS NULL/);
    expect(route).toMatch(/resendConfirmationForSheet\(billingId\)/);
  });
  it('2단계 발송 선점 = 1단계 토큰이 살아 있을 때만 · 전달 확정 = 그 토큰 행만(부르는 곳 전부 토큰을 넘긴다)', () => {
    const ic = read('backend/src/utils/invoice-confirm.ts');
    expect(ic).toMatch(/WHERE id = \$1::uuid AND emailed_at IS NULL\s+AND EXISTS \(SELECT 1 FROM invoice_confirmations ic WHERE ic\.billing_id = \$1::uuid AND ic\.token = \$3 AND ic\.superseded_at IS NULL\)/);
    const fn = ic.slice(ic.indexOf('export async function markConfirmationDelivered'), ic.indexOf('export interface ConfirmSendSummary'));
    expect(fn).toMatch(/WHERE billing_id = \$1::uuid AND token = \$4 AND superseded_at IS NULL/);
    const calls = backend.flatMap((f) => [...f.text.matchAll(/markConfirmationDelivered\((\w+), \{([\s\S]*?)\}\)/g)].map((m) => ({ f: f.rel, ok: /\btoken\b/.test(m[2]) })));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => !c.ok)).toEqual([]);
  });
});

describe('Codex 구현 1R 수용분', () => {
  it('① 이의 해소 가드 = 발행 실패(failed)도 막는다(운영 재발행 중복 검사와 같은 상태 집합)', () => {
    const b = read('backend/src/routes/billing.ts');
    const route = b.slice(b.indexOf("router.put('/confirmations/:id/objection-resolve'"), b.indexOf("router.put('/confirmations/:id/issue-date'"));
    expect(route).toMatch(/status IN \('ready', 'submitted', 'issued', 'failed'\)\s+OR \(status = 'cancelled' AND nts_confirm_num IS NOT NULL\)/);
  });
  it('② 검사가 돈 시간 = 공용 CT 한 곳 · 스팸 검사 주소에 등록 시각으로 재는 만료 0', () => {
    const r = read('backend/src/routes/spam-filter.ts');
    expect(r).not.toMatch(/Date\.now\(\) - new Date\([^)]*created_at\)/);
    expect((r.match(/spamTestRunElapsedMs\(/g) || []).length).toBe(4);   // 복원 · 상세 · 수동 주소 안전 타임아웃 · 최근 검사 판정
    const q = read('backend/src/utils/spam-test-queue.ts');
    const cleanup = q.slice(q.indexOf('export async function cleanupStaleActiveTests'), q.indexOf('\n}\n', q.indexOf('export async function cleanupStaleActiveTests')));
    expect(cleanup).toContain('spamTestRunElapsedMs(id, r.created_at, now)');
    const created = '2026-11-05T00:00:00.000Z';
    expect(spamTestRunElapsedMs('00000000-0000-0000-0000-000000000000', created, Date.parse(created) + 90_000)).toBe(90_000);   // 실행 기록 없음 = 등록 시각
  });
  it('③ 작업 화면 알림톡 편집기 = 공용 알림톡 패널 + 공용 변수 연결 부품(변수 입력 → 칸 초안 alimtalkVariableMap)', () => {
    const e = read('frontend/src/components/journey/workspace/JourneyKakaoStepEditor.tsx');
    expect(e).toMatch(/<AlimtalkVariableMappingPanel[\s\S]*?onVariableMapChange=\{\(next\) => onPatch\(\{ alimtalkVariableMap: next \}\)\}/);
  });
  it('④ · 2R 알림톡 고름 = 한 쌍(승인 프로필 · 그 프로필의 승인 템플릿) · 무효 쌍은 비워 다시 고르게 · 저장 전 검사가 같은 판정', () => {
    const senders: any[] = [
      { id: 'A', profile_key: 'a', profile_name: 'A', yellow_id: null, approval_status: 'REVOKED', status: 'x' },
      { id: 'B', profile_key: 'b', profile_name: 'B', yellow_id: null, approval_status: 'approved', status: 'x' },
    ];
    const templates: any[] = [
      { id: 'tA', template_code: 'TA', template_name: 'A', profile_id: 'A', content: 'A #{이름}', status: 'APPROVED' },
      { id: 'tB', template_code: 'TB', template_name: 'B', profile_id: 'B', content: 'B #{이름}', status: 'APPROVED' },
    ];
    const map = { '#{이름}': '@@name@@' };
    // 무효 프로필 A + A 템플릿 = 프로필 · 템플릿 · 변수 연결 모두 비움(패널이 B 를 골라도 A 템플릿이 남지 않는다)
    expect(alimtalkStateOfStep({ alimtalkProfileId: 'A', alimtalkTemplateCode: 'TA', alimtalkVariableMap: map }, templates, senders)).toMatchObject({ profileId: '', templateCode: '', templateId: '', variableMap: {} });
    // 승인 프로필 B + 다른 프로필 템플릿 TA = 템플릿만 비움
    expect(alimtalkStateOfStep({ alimtalkProfileId: 'B', alimtalkTemplateCode: 'TA', alimtalkVariableMap: map }, templates, senders)).toMatchObject({ profileId: 'B', templateCode: '', variableMap: {} });
    // 맞는 쌍 = 그대로
    expect(alimtalkStateOfStep({ alimtalkProfileId: 'B', alimtalkTemplateCode: 'TB', alimtalkVariableMap: map }, templates, senders)).toMatchObject({ profileId: 'B', templateCode: 'TB', templateId: 'tB', variableMap: map });
    // 옛 칸(프로필 빈 칸 + 승인 프로필의 템플릿) = 템플릿 소속 프로필로 채움(옛 패널 동작 = 템플릿 유지)
    expect(alimtalkStateOfStep({ alimtalkTemplateCode: 'TB' }, templates, senders)).toMatchObject({ profileId: 'B', templateCode: 'TB' });
    expect(alimtalkStateOfStep({ alimtalkTemplateCode: 'TA' }, templates, senders)).toMatchObject({ profileId: '', templateCode: '' });
    const cat = { templates, senders };
    expect(alimtalkStepSelectionIssue({ alimtalkProfileId: 'B', alimtalkTemplateCode: 'TA', alimtalkVariableMap: map }, cat)).toBe('승인된 발신프로필의 승인 템플릿을 다시 골라 주세요.');
    expect(alimtalkStepSelectionIssue({ alimtalkProfileId: 'A', alimtalkTemplateCode: 'TA', alimtalkVariableMap: map }, cat)).toBe('승인된 발신프로필의 승인 템플릿을 다시 골라 주세요.');
    expect(alimtalkStepSelectionIssue({ alimtalkProfileId: 'B', alimtalkTemplateCode: 'TB', alimtalkVariableMap: {} }, cat)).toBe('알림톡 템플릿의 #{이름} 에 넣을 값을 연결해 주세요.');
    expect(alimtalkStepSelectionIssue({ alimtalkProfileId: 'B', alimtalkTemplateCode: 'TB', alimtalkVariableMap: map }, cat)).toBeNull();
    expect(alimtalkStepSelectionIssue({ alimtalkProfileId: 'B' }, cat)).toBe('알림톡 템플릿을 골라 주세요.');
    const panel = read('frontend/src/components/alimtalk/AlimtalkChannelPanel.tsx');
    expect(panel).toContain('senders.filter((s) => isApprovedAlimtalkSender(s))');
    expect(panel).not.toMatch(/new Set\(\['APPROVED'\]\)/);
  });
});
