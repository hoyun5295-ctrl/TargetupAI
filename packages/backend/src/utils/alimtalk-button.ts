/**
 * alimtalk-button.ts — 알림톡 버튼(kakao_templates.buttons JSONB) → QTmsg k_button_json 변환 (CT)
 *
 * QTmsg 매뉴얼 4.0: 버튼당 name{i}/type{i}/url{i}_1/url{i}_2, 최대 5개.
 *   예) {"name1":"주문정보 확인하기","type1":"2","url1_1":"http://...","url1_2":""}
 *   type 코드 — 1=배송조회 2=웹링크(url 필수) 3=앱링크 4=봇키워드 5=메시지전달 6=채널추가.
 *
 * 용도: 발송 핸들러(campaigns.ts)가 검수 승인 템플릿의 buttons로 k_button_json을 직접 생성한다.
 *   프론트 전송값(alimtalkButtonJson)이 비어도 버튼이 빠지지 않게(버그1 fix — btnJson[] 방지).
 *   frontend AlimtalkChannelPanel.convertButtonsToQTmsg와 동일 규칙(패키지 분리로 별도 정의).
 *
 * DB import 0 (순수 — 입력 buttons 배열만 받아 변환).
 */

export function convertButtonsToQTmsg(buttons: any[] | null | undefined): string | null {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const TYPE_MAP: Record<string, string> = {
    DS: '1',  // 배송조회
    WL: '2',  // 웹링크
    AL: '3',  // 앱링크
    BK: '4',  // 봇키워드
    MD: '5',  // 메시지전달
    AC: '6',  // 채널추가
    BC: '4',  // 봇전환 → 봇키워드로 매핑
    BF: '4',
    PD: '2',
  };
  const out: Record<string, string> = {};
  buttons.slice(0, 5).forEach((b, i) => {
    const n = i + 1;
    // 필드명: 프론트 폼(buttonName/buttonType/buttonUrlMobile) + IMC 응답(name/linkType/linkMo/linkPc) 양쪽 호환
    out[`name${n}`] = b.name || b.buttonName || b.label || `버튼${n}`;
    out[`type${n}`] = TYPE_MAP[b.type || b.buttonType || b.linkType] || '2';
    out[`url${n}_1`] = b.url1 || b.urlMobile || b.buttonUrlMobile || b.linkMo || b.url || '';
    out[`url${n}_2`] = b.url2 || b.urlPc || b.buttonUrlPc || b.linkPc || '';
  });
  return JSON.stringify(out);
}
