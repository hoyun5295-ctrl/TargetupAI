/**
 * ★ CT: 대행 요청서·명단 엑셀을 별도 프로세스에서 읽기 (★2026-09-26 한줄로 V2 S1-H03 · Harold 결정 「별도 프로세스에서 읽기」)
 *
 * 왜: 운영은 API·발송 잠금·환불 sweeper가 한 프로세스다. 업로드 엑셀을 여기서 동기 파싱하면 큰 명단
 *   (0913 실측 20만 행 4초) 동안 전부 멈춘다. 파싱만 자식 프로세스로 옮긴다. 결과 값은 종전 파서 그대로다.
 * 작업 스레드가 아니라 프로세스인 이유: 운영이 ts-node라 스레드에도 컴파일러가 올라가 1.7GB 재시작 한도에 합산된다.
 *
 * 규칙
 *   - 자식을 띄울 수 없으면(ts-node 등록 모듈 없음 · 준비 신호 전에 종료·오류) 종전처럼 이 프로세스에서 읽는다(via 'inline' · 로그).
 *   - 준비 뒤 자식이 죽거나 시간을 넘기면 **읽지 못함**으로 돌려준다(같은 파일을 이 프로세스에서 다시 읽어 멈추게 하지 않는다).
 *     요청서 = unreadableAgencyForm() · 명단 = null → 호출부가 종전 문구로 반려한다.
 *   - 명단 파서가 던지면 list = null(종전 catch와 같은 판정).
 */
import { fork } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import {
  parseAgencyRequestForm, parseAgencyRecipientList, unreadableAgencyForm, readAgencyWorkbook, type ParsedAgencyForm,
} from './agency-send-form';
import { planAgencyWorkbook, type AgencyWorkbookPlan } from './agency-send-workbook';

export type ParsedAgencyList = ReturnType<typeof parseAgencyRecipientList>;

export interface IsolatedAgencyParse {
  form: ParsedAgencyForm | null;
  list: ParsedAgencyList | null;
  via: 'child' | 'inline';
}

/** 자식 한 번의 상한(기동 포함). 20만 행 4초 실측 대비 넉넉히 */
const AGENCY_PARSE_TIMEOUT_MS = 120_000;
/** 자식 힙 상한 = 운영 본 프로세스와 같은 값(큰 명단을 읽을 수 있어야 한다) */
const AGENCY_PARSE_CHILD_HEAP_MB = 2048;

/** ★ 2026-11-25 한 파일 여러 건의 짝 시트 이름(planAgencyWorkbook · 생략 = 종전 고르기 규칙) */
export interface AgencySheetPick { formSheet?: string | null; listSheet?: string | null }

function inlineParse(formBuf: Buffer | null, listBuf: Buffer | null, sheets: AgencySheetPick = {}): IsolatedAgencyParse {
  const form = formBuf ? parseAgencyRequestForm(formBuf, { formSheet: sheets.formSheet }) : null;
  let list: ParsedAgencyList | null = null;
  if (listBuf) {
    try { list = parseAgencyRecipientList(listBuf, { listSheet: sheets.listSheet }); } catch { list = null; }
  }
  return { form, list, via: 'inline' };
}

/** 자식 진입 파일과 실행 인자. 소스(.ts)로 돌면 ts-node 등록 모듈이 있어야 한다 — 없으면 null */
function childLaunch(): { script: string; execArgv: string[] } | null {
  const ext = path.extname(__filename);
  const script = path.join(__dirname, '..', 'workers', `agency-parse-child${ext}`);
  const execArgv = [`--max-old-space-size=${AGENCY_PARSE_CHILD_HEAP_MB}`];
  if (ext !== '.ts') return { script, execArgv };
  try {
    return { script, execArgv: [...execArgv, '-r', createRequire(__filename).resolve('ts-node/register/transpile-only')] };
  } catch {
    return null;
  }
}

/**
 * 자식 프로세스 한 번(기동 → ready → payload → result → 종료). 띄울 수 없으면 inline(이 프로세스) · 준비 뒤 죽음 · 시간 초과 = failValue.
 * ★ 2026-11-25 요청서 · 명단 해석과 한 파일 여러 건 판정이 같은 길을 쓴다(판정도 큰 파일을 이 프로세스에서 읽지 않게 · Codex 설계 6R).
 */
function runInChild<T>(
  payload: Record<string, unknown>,
  inline: () => T,
  failValue: T,
  fromMessage: (msg: any) => T,
  timeoutMs: number,
): Promise<T> {
  const launch = childLaunch();
  if (!launch) {
    console.warn('[agency-parse] 자식 프로세스 실행 모듈이 없어 이 프로세스에서 읽음');
    return Promise.resolve(inline());
  }
  return new Promise<T>((resolve) => {
    let settled = false;
    let ready = false;
    let child: ReturnType<typeof fork>;
    const finish = (r: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => {
      console.warn(`[agency-parse] 자식 프로세스 시간 초과(${timeoutMs}ms) — 읽지 못함으로 반려`);
      finish(failValue);
    }, timeoutMs);
    const startFailed = (why: string) => {
      console.warn(`[agency-parse] 자식 프로세스를 띄우지 못해 이 프로세스에서 읽음: ${why}`);
      finish(inline());
    };
    try {
      child = fork(launch.script, [], { execArgv: launch.execArgv, serialization: 'advanced' });
    } catch (e: any) {
      startFailed(e?.message || String(e));
      return;
    }
    child.on('message', (msg: any) => {
      if (msg?.type === 'ready' && !ready) {
        ready = true;
        child.send(payload);
        return;
      }
      if (msg?.type === 'result') finish(fromMessage(msg));
    });
    child.on('error', (e: any) => {
      if (!ready) startFailed(e?.message || String(e));
      else {
        console.warn('[agency-parse] 자식 프로세스 오류 — 읽지 못함으로 반려:', e?.message || e);
        finish(failValue);
      }
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (!ready) startFailed(`준비 전 종료 code=${code} signal=${signal}`);
      else {
        console.warn(`[agency-parse] 자식 프로세스가 결과 없이 종료 code=${code} signal=${signal} — 읽지 못함으로 반려`);
        finish(failValue);
      }
    });
  });
}

export async function parseAgencyFilesIsolated(
  formBuf: Buffer | null,
  listBuf: Buffer | null,
  opts: { timeoutMs?: number } & AgencySheetPick = {},
): Promise<IsolatedAgencyParse> {
  if (!formBuf && !listBuf) return { form: null, list: null, via: 'inline' };
  return runInChild<IsolatedAgencyParse>(
    { formBuf, listBuf, formSheet: opts.formSheet ?? null, listSheet: opts.listSheet ?? null },
    () => inlineParse(formBuf, listBuf, opts),
    { form: formBuf ? unreadableAgencyForm() : null, list: null, via: 'child' },
    (msg) => ({ form: msg.form ?? null, list: msg.list ?? null, via: 'child' }),
    opts.timeoutMs ?? AGENCY_PARSE_TIMEOUT_MS,
  );
}

/** ★ 2026-11-25 한 파일 여러 건 판정 + 건마다 이미지 파일명 이름표(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6 · §7) */
export interface IsolatedWorkbookPlan {
  plan: AgencyWorkbookPlan;
  /** pairs = 짝마다 · single = [오늘 고르기 규칙의 요청서 시트 이름표] · invalid = [] */
  imageNames: string[][];
  /**
   * ★ 2026-11-25(2) pairs 일 때 짝마다 **이미 해석한** 요청서 · 명단 — 통합 문서를 한 번만 읽은 판에서 뽑는다.
   *   짝마다 파일을 다시 읽으면 공유 문자열 xlsx · xls 는 읽을 때마다 문자열 표 · 파일 전체를 다시 푼다
   *   (12짝 × 5,000명 실측: 판정 3.9초 + 짝 읽기 9.0초 · xls 11.2초 + 24.5초 ↔ 한 번 읽기 1.2초 · 0.9초 · Codex 상한 1R · 짝 1R).
   *   onlyPair 를 준 호출(원스텝 = 고른 건 하나)은 그 짝만 명단을 싣는다(나머지 = null).
   */
  parsed?: Array<{ form: ParsedAgencyForm; list: ParsedAgencyList | null } | null>;
}

/** 판정 실패(자식 죽음 · 시간 초과 · 판정 없는 답) = 접수를 멈춘다 */
const PLAN_FAILED: IsolatedWorkbookPlan = {
  plan: { kind: 'invalid', reasons: ['요청서 파일을 끝까지 확인하지 못했습니다. 잠시 뒤 다시 올려 주세요.'] },
  imageNames: [],
};

/** 판정 + 이름표(자식 · 같은 프로세스 대체 경로가 같은 함수) */
export function computeWorkbookPlan(buf: Buffer, onlyPair?: number | null): IsolatedWorkbookPlan {
  const plan = planAgencyWorkbook(buf);
  if (plan.kind !== 'pairs') {
    return { plan, imageNames: plan.kind === 'single' ? [parseAgencyRequestForm(buf).imageFileNames] : [] };
  }
  // 짝 파일 = 통합 문서를 한 번만 읽고 그 판에서 짝마다 해석(요청서는 전부 = 이름표 · 명단은 필요한 짝만)
  let wb: ReturnType<typeof readAgencyWorkbook> | null = null;
  try { wb = readAgencyWorkbook(buf); } catch { wb = null; }
  if (!wb) return { plan, imageNames: plan.pairs.map((pr) => parseAgencyRequestForm(buf, { formSheet: pr.formSheet }).imageFileNames) };
  const forms = plan.pairs.map((pr) => parseAgencyRequestForm(buf, { formSheet: pr.formSheet, workbook: wb }));
  const parsed = plan.pairs.map((pr, k) => {
    if (onlyPair != null && onlyPair !== k) return null;
    let list: ParsedAgencyList | null = null;
    try { list = parseAgencyRecipientList(buf, { listSheet: pr.listSheet, workbook: wb }); } catch { list = null; }
    return { form: forms[k], list };
  });
  return { plan, imageNames: forms.map((f) => f.imageFileNames), parsed };
}

/**
 * ★ 2026-11-25 한 파일 여러 건 판정을 자식 프로세스에서(Codex 설계 6R · 큰 파일의 압축 풀기 · 공유 문자열 표를 이 프로세스에서 읽지 않는다).
 *   자식이 죽거나 · 시간을 넘기거나 · 판정 없이 답하면 = 판정 실패(invalid · 접수를 멈춘다). single 로 떨어뜨리면 여러 건 중 표준 한 짝만
 *   접수되고 나머지가 조용히 빠진다(Codex 설계 7R). single 은 판정이 성공했을 때만이다.
 */
export async function planAgencyWorkbookIsolated(buf: Buffer, opts: { timeoutMs?: number; onlyPair?: number | null } = {}): Promise<IsolatedWorkbookPlan> {
  const onlyPair = Number.isInteger(opts.onlyPair) ? (opts.onlyPair as number) : null;
  return runInChild<IsolatedWorkbookPlan>(
    { kind: 'plan', formBuf: buf, onlyPair },
    () => computeWorkbookPlan(buf, onlyPair),
    PLAN_FAILED,
    (msg) => (msg.plan
      ? { plan: msg.plan, imageNames: Array.isArray(msg.imageNames) ? msg.imageNames : [], ...(Array.isArray(msg.parsed) ? { parsed: msg.parsed } : {}) }
      : PLAN_FAILED),
    opts.timeoutMs ?? AGENCY_PARSE_TIMEOUT_MS,
  );
}
