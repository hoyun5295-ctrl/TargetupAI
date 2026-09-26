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
  parseAgencyRequestForm, parseAgencyRecipientList, unreadableAgencyForm, type ParsedAgencyForm,
} from './agency-send-form';

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

function inlineParse(formBuf: Buffer | null, listBuf: Buffer | null): IsolatedAgencyParse {
  const form = formBuf ? parseAgencyRequestForm(formBuf) : null;
  let list: ParsedAgencyList | null = null;
  if (listBuf) {
    try { list = parseAgencyRecipientList(listBuf); } catch { list = null; }
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

export async function parseAgencyFilesIsolated(
  formBuf: Buffer | null,
  listBuf: Buffer | null,
  opts: { timeoutMs?: number } = {},
): Promise<IsolatedAgencyParse> {
  if (!formBuf && !listBuf) return { form: null, list: null, via: 'inline' };
  const launch = childLaunch();
  if (!launch) {
    console.warn('[agency-parse] 자식 프로세스 실행 모듈이 없어 이 프로세스에서 읽음');
    return inlineParse(formBuf, listBuf);
  }

  return new Promise<IsolatedAgencyParse>((resolve) => {
    let settled = false;
    let ready = false;
    const unreadable: IsolatedAgencyParse = { form: formBuf ? unreadableAgencyForm() : null, list: null, via: 'child' };
    let child: ReturnType<typeof fork>;
    const finish = (r: IsolatedAgencyParse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => {
      console.warn(`[agency-parse] 자식 프로세스 시간 초과(${opts.timeoutMs ?? AGENCY_PARSE_TIMEOUT_MS}ms) — 읽지 못함으로 반려`);
      finish(unreadable);
    }, opts.timeoutMs ?? AGENCY_PARSE_TIMEOUT_MS);
    const startFailed = (why: string) => {
      console.warn(`[agency-parse] 자식 프로세스를 띄우지 못해 이 프로세스에서 읽음: ${why}`);
      finish(inlineParse(formBuf, listBuf));
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
        child.send({ formBuf, listBuf });
        return;
      }
      if (msg?.type === 'result') {
        finish({ form: msg.form ?? null, list: msg.list ?? null, via: 'child' });
      }
    });
    child.on('error', (e: any) => {
      if (!ready) startFailed(e?.message || String(e));
      else {
        console.warn('[agency-parse] 자식 프로세스 오류 — 읽지 못함으로 반려:', e?.message || e);
        finish(unreadable);
      }
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (!ready) startFailed(`준비 전 종료 code=${code} signal=${signal}`);
      else {
        console.warn(`[agency-parse] 자식 프로세스가 결과 없이 종료 code=${code} signal=${signal} — 읽지 못함으로 반려`);
        finish(unreadable);
      }
    });
  });
}
