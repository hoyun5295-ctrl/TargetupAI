/**
 * identity-provider-kmc.ts — 한국모바일인증(KMC) 본인확인 인증기관 구현 (★2026-10-06 · 전송자격인증 2.1 ①-1 · 3.4 ② · ③)
 *
 * `identity-verify.ts` 의 인증기관 자리(`IdentityProvider` · buildStart · verify)를 KMC 규격(범용 개발가이드 v2.0 · NodeJS 예제)으로 채운다.
 *   1. buildStart = tr_cert(고객사 ID / URL 코드 / 요청번호 / 요청시각 / M / 빈칸 6 / 추가정보 / 확장변수) → 암호화 → 위변조 검사값 →
 *      2차 암호화 → 팝업 폼(`kmcisReq.jsp` · tr_cert · tr_url · tr_ver V2 · tr_add N)
 *   2. 인증이 끝나면 KMC 가 tr_url(= 우리 복귀 통로 `/api/auth/identity/return`)로 apiToken · certNum 을 POST → 화면이 그대로 넘긴다
 *   3. verify = apiToken 복호화 → 서버끼리 토큰 확인(`kmcisToken_api.jsp` · APR01) → 결과 복호화 → 위변조 검사값 대조 → 2차 복호화 → 18칸
 *
 * ⛔ 남의 인증 결과를 끼워 넣지 못하게 — 요청번호(certNum)를 **이 인증 건 번호(verificationId)** 로 쓰고,
 *    돌아온 값의 세 자리(복귀 certNum · 토큰 확인 응답 apiCertNum · 결과 안 kCertNum)가 모두 그 번호여야 받는다.
 *    인증 건은 계정에 묶여 있고(`identity_verifications.user_id`) 확정은 그 계정 · 대기 · 미만료 조건의 한 문장이다.
 * ⛔ 저장하는 것은 이름 · 휴대폰 · 중복가입 확인값(DI → 해시)뿐이다. CI(연계정보)는 풀지도 저장하지도 않는다.
 * ⛔ 설정(ENV)이 다 있고 실행 파일이 실제로 있을 때만 인증기관이 된다 — 하나라도 없으면 null(아무도 본인인증을 요구받지 않는다).
 *    `KMC_CP_ID`(고객사 ID = KMC 관리 화면 로그인 ID) · `KMC_URL_CODE`(관리 화면에서 등록한 URL 의 6자리 코드) · `KMC_CRYPTO_PATH`(실행 파일).
 */
import fs from 'fs';
import type { IdentityProvider, VerifiedIdentity } from './identity-verify';
import { buildPopupFormStart, IDENTITY_RETURN_PATH } from './identity-return';
import { isKmcToken, kmcCrypto, type KmcMode } from './kmc-crypto';

export const KMC_PROVIDER_NAME = 'kmc';
export const KMC_REQUEST_URL = 'https://www.kmcert.com/kmcis/web/kmcisReq.jsp';
export const KMC_TOKEN_API_URL = 'https://www.kmcert.com/kmcis/api/kmcisToken_api.jsp';
/** 확장변수 — 규격 고정값 */
const KMC_EXTEND_VAR = '0000000000000000';
/** 서버끼리 토큰 확인 대기(예제 20초) */
const TOKEN_API_TIMEOUT_MS = 20_000;
/** 결과 18칸의 자리(개발가이드 3-3 표 순번 - 1) */
const F = { certNum: 0, phone: 3, name: 8, result: 9, di: 17 } as const;

export interface KmcConfig { cpId: string; urlCode: string; cryptoPath: string; returnUrl: string }

/** 설정이 다 있고 실행 파일이 실행 가능할 때만 값을 준다(호출 때마다 본다 — ENV 를 바꾸고 재시작하면 바로 반영) */
export function kmcConfig(): KmcConfig | null {
  const cpId = String(process.env.KMC_CP_ID || '').trim();
  const urlCode = String(process.env.KMC_URL_CODE || '').trim();
  const cryptoPath = String(process.env.KMC_CRYPTO_PATH || '').trim();
  if (!/^[A-Za-z0-9]{1,20}$/.test(cpId) || !/^\d{6}$/.test(urlCode) || !cryptoPath) return null;
  // 실행 가능한 **일반 파일**이어야 한다(★Codex 1R) — 리눅스는 폴더에도 X_OK 가 통해, 압축을 푼 폴더를 넣으면
  // 「준비됨」으로 판정돼 본인인증을 요구하는데 실행은 실패해 로그인이 막힌다.
  try {
    if (!fs.statSync(cryptoPath).isFile()) return null;
    fs.accessSync(cryptoPath, fs.constants.X_OK);
  } catch {
    return null;
  }
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return { cpId, urlCode, cryptoPath, returnUrl: `${base}${IDENTITY_RETURN_PATH}` };
}

/** 한국 현재 시각 yyyyMMddHHmmss — 규격이 요청시각 · 토큰 확인 시각 둘 다 한국 시각을 요구한다(30분 넘게 어긋나면 거절) */
export function kstStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${v('year')}${v('month')}${v('day')}${v('hour')}${v('minute')}${v('second')}`;
}

/** 요청번호 = 인증 건 번호에서 하이픈을 뺀 32자(규격 16~40자 · 겹치지 않음) */
export function kmcCertNumOf(verificationId: string): string {
  const certNum = String(verificationId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(certNum)) throw new Error('KMC_BAD_VERIFICATION_ID');
  return certNum;
}

/** tr_cert 평문 — 구분자 `/` 12개 · 칸 순서 고정(cpId/urlCode/certNum/date/certMet///////plusInfo/extendVar) */
export function kmcTrCertPlain(cfg: Pick<KmcConfig, 'cpId' | 'urlCode'>, certNum: string, date: string): string {
  const plusInfo = '';
  return [cfg.cpId, cfg.urlCode, certNum, date, 'M', '', '', '', '', '', '', plusInfo, KMC_EXTEND_VAR].join('/');
}

/**
 * KMC 결과 글자 풀기 — ★2026-10-06 실측: 이름이 URL 인코딩(UTF-8 · `%EC%9C%A0…`)으로 와서 그대로 계정 이름에 저장됐다.
 *   규격서 · 예제 어디에도 없던 모양이라 예제처럼 그대로 썼다(지어낸 응답으로 시험해 못 잡음 = LESSONS_BACKEND 「외부 API 응답의 테스트 대역은 원문으로」).
 *   `%` · `+` 가 있으면 푼다(자바 URL 인코딩은 공백을 `+` 로 쓴다). 못 풀면 저장하지 않고 거절한다.
 */
export function kmcText(raw: string | undefined): string {
  const v = String(raw ?? '');
  if (!/[%+]/.test(v)) return v;
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    throw new Error('KMC_RESULT_SHAPE');
  }
}

function requireConfig(): KmcConfig {
  const cfg = kmcConfig();
  if (!cfg) throw new Error('KMC_NOT_CONFIGURED');
  return cfg;
}

async function run(cfg: KmcConfig, mode: KmcMode, input: string, what: string): Promise<string> {
  const out = await kmcCrypto({ file: cfg.cryptoPath }, mode, input);
  if (!out) throw new Error(`KMC_CRYPTO_EMPTY_${what}`);
  return out;
}

export const kmcProvider: IdentityProvider = {
  name: KMC_PROVIDER_NAME,

  async buildStart({ verificationId }) {
    const cfg = requireConfig();
    const enc1 = await run(cfg, 'enc', kmcTrCertPlain(cfg, kmcCertNumOf(verificationId), kstStamp()), 'ENC1');
    const mac = await run(cfg, 'msg', enc1, 'MSG');
    const trCert = await run(cfg, 'enc', `${enc1}/${mac}/${KMC_EXTEND_VAR}`, 'ENC2');
    return buildPopupFormStart(KMC_REQUEST_URL, { tr_cert: trCert, tr_url: cfg.returnUrl, tr_ver: 'V2', tr_add: 'N' }) as unknown as Record<string, any>;
  },

  async verify(payload, { verificationId }): Promise<VerifiedIdentity> {
    const cfg = requireConfig();
    const expected = kmcCertNumOf(verificationId);
    const apiToken = payload?.apiToken;
    const certNumEnc = payload?.certNum;
    if (!isKmcToken(apiToken) || !isKmcToken(certNumEnc)) throw new Error('KMC_RESULT_MISSING');

    const tokenPlain = await run(cfg, 'dec', apiToken, 'TOKEN');
    const returnedCertNum = await run(cfg, 'dec', certNumEnc, 'CERTNUM');
    if (returnedCertNum !== expected) throw new Error('KMC_CERTNUM_MISMATCH_RETURN');

    const res = await fetch(KMC_TOKEN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ apiToken: tokenPlain, apiDate: kstStamp() }),
      signal: AbortSignal.timeout(TOKEN_API_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`KMC_TOKEN_API_HTTP_${res.status}`);
    const body: any = await res.json().catch(() => null);
    // APR02 만료(30분) · APR03 없음 · APR04/05 길이 · APR06 재요청 3회 초과 — 어느 것이든 거절(원문은 기록만)
    if (body?.result_cd !== 'APR01') throw new Error(`KMC_TOKEN_${String(body?.result_cd || 'NONE').replace(/[^A-Z0-9]/g, '').slice(0, 8)}`);
    if (String(body.apiCertNum || '') !== expected) throw new Error('KMC_CERTNUM_MISMATCH_API');
    if (!isKmcToken(body.apiRecCert)) throw new Error('KMC_RESULT_SHAPE');

    // 1차 복호화 = 「결과 암호문/위변조 검사값」 → 결과 암호문으로 검사값을 다시 만들어 대조한다
    const [inner, mac] = (await run(cfg, 'dec', body.apiRecCert, 'REC1')).split('/');
    if (!isKmcToken(inner) || !mac) throw new Error('KMC_RESULT_SHAPE');
    if ((await run(cfg, 'msg', inner, 'REC_MSG')) !== mac) throw new Error('KMC_TAMPERED');

    const fields = (await run(cfg, 'dec', inner, 'REC2')).split('/');
    if (fields.length < 18) throw new Error('KMC_RESULT_SHAPE');
    if (fields[F.certNum] !== expected) throw new Error('KMC_CERTNUM_MISMATCH_RESULT');
    if (fields[F.result] !== 'Y') throw new Error('KMC_NOT_VERIFIED');

    const diEnc = fields[F.di];
    const dupKey = isKmcToken(diEnc) ? await kmcCrypto({ file: cfg.cryptoPath }, 'dec', diEnc) : '';
    return { name: kmcText(fields[F.name]), phone: kmcText(fields[F.phone]), dupKey: dupKey || null, providerTxId: expected };
  },
};
