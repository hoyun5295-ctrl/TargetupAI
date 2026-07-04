// copy-deidentify.ts — 타사 문안 탈색(시그니처 누출 0 1차 방어). 순수, 의존 0.
//   자동 탈색 = 명확한 식별자(대괄호 브랜드·전화·대표번호·URL·이메일) 제거. 본문 내 평문 회사명은
//   자동으로 못 잡으므로 하이브리드 큐레이션의 사람 검수가 최종 안전망(설계서 §4.2).

// 제거용(replace, /g). 탐지용(.test)은 lastIndex 버그 회피 위해 비-global 별도.
const BRACKET_G = /[[【][^\]】]*[\]】]/g;
const URL_G = /(https?:\/\/\S+)|((?:www\.)?[\w-]+\.(?:com|co\.kr|kr|net|shop|store|io|me)(?:\/\S*)?)/gi;
const EMAIL_G = /\S+@\S+\.\S+/g;
const PHONE_G = /(1[5-9]\d{2}[-.\s]?\d{4})|(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/g;

const BRACKET = /[[【][^\]】]*[\]】]/;
const URL = /(https?:\/\/\S+)|((?:www\.)?[\w-]+\.(?:com|co\.kr|kr|net|shop|store|io|me)(?:\/\S*)?)/i;
const EMAIL = /\S+@\S+\.\S+/;
const PHONE = /(1[5-9]\d{2}[-.\s]?\d{4})|(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/;

/** 명확한 식별자 제거 후 공백 정리. 구조·표현은 보존한다. */
export function deBrand(text: string): string {
  let t = String(text || '');
  // 순서 중요: EMAIL 먼저(도메인부가 URL로 먼저 지워지면 'abc@'가 orphan으로 남음) → URL → PHONE → BRACKET
  t = t.replace(EMAIL_G, ' ').replace(URL_G, ' ').replace(PHONE_G, ' ').replace(BRACKET_G, ' ');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** 잔존 식별자 탐지(테스트·서빙 전 게이트). true면 누출 위험 = 서빙 금지. */
export function hasIdentifierLeak(text: string): boolean {
  const t = String(text || '');
  return BRACKET.test(t) || URL.test(t) || EMAIL.test(t) || PHONE.test(t);
}
