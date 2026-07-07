# [요청] 비토 Gateway — 알림톡 버튼형 3027(템플릿 버튼 매칭 실패) 원인 확인

> 수신: 게이트웨이 담당(자비스) / 발신: 한줄로
> 근거 데이터: bito_gateway.message_request id 18~34 (2026-07-07 18:23~19:48, hanjul01)

## 확정 사실 (한줄로 측 검증 완료)

1. **버튼 없는 템플릿은 완주** — id 22(79738, 강조표기+대표링크+SENDER_KEY) = report_code **0000 성공**. SENDER_KEY 주입·attachment_link→link 변환 모두 정상 = 기존 7300 건 종결.
2. **실패는 전부 버튼형 템플릿** — 79955·81708~81711(웹링크 WL)·79773(채널추가 AC) = **3027**. 3027 = 카카오 결과코드 "**메시지 버튼이 템플릿 등록값과 불일치**"(한줄로 운영 결과코드 맵 기준. 19:23 배치의 8006은 카카오 3xxx 코드표에 없는 코드 — IMC/게이트웨이측 코드로 보이니 소속 확인 부탁).
3. **한줄로가 보낸 버튼값은 등록 템플릿 그대로** — k_button_json은 카카오 검수 승인된 kakao_templates.buttons 등록값에서 기계 변환(name/type/urlMobile/urlPc 원본 유지, url{i}_2는 등록 PC URL이 있을 때만 채움). 같은 형식이 레거시 중계서버 경유로는 1800 성공 실증(5월 79955 발송 이력 + 6월 채널추가 실측). **입력 무결 — 불일치는 Gateway의 QTmsg→IMC 변환 단계에서 발생.**

## 한줄로 → Gateway로 가는 버튼 형식 (QTmsg 매뉴얼 4.0)

```json
{"name1":"홈페이지","type1":"2","url1_1":"https://invitocorp.com","url1_2":"https://invitocorp.com"}
{"name1":"채널 추가","type1":"6","url1_1":"","url1_2":""}
```
- `type{i}` = 숫자 코드: 1=배송조회(DS) 2=웹링크(WL) 3=앱링크(AL) 4=봇키워드(BK) 5=메시지전달(MD) 6=채널추가(AC)
- `url{i}_1` = 모바일 URL / `url{i}_2` = PC URL (없으면 빈 문자열)

## IMC 스펙 (연동규약서 v20251031 §3.1 ATTACHMENT-알림톡, p57~59)

```json
{"attachment":{"button":[{"name":"...","type":"WL","url_mobile":"...","url_pc":"..."}]}}
```
- `type` = **2글자 코드**(WL/AL/DS/BK/MD/BC/BT/AC/P1/P2). "버튼 타입별 필수 파라미터를 모두 입력해야 발송 가능"
- 키는 **snake_case**(`url_mobile`/`url_pc`) — 대표링크 link의 camelCase(urlMobile/urlPc)와 표기가 다름에 주의
- **WL**: `url_mobile` 필수(Y), `url_pc` 선택(N)
- **AC(채널추가)**: 속성 없음 — `name`("채널 추가")+`type`("AC")만. URL 키 자체를 넣지 않아야 함
- name text(14), 버튼 개수·순서·명칭 = 템플릿 등록값과 완전 일치

## 확인 요청 (이것만 주시면 즉시 판정됩니다)

| # | 요청 | 회신 |
|---|------|------|
| 1 | trace_id `dc8fae9f-…`(id 34) 또는 `1a6292c6-…`(id 24, 채널추가) 건의 **IMC로 실제 송신된 ATTACHMENT JSON 원문** 로그 | |
| 2 | Gateway 버튼 변환에서 ①숫자 type→2글자 코드(2→WL, 6→AC) 매핑 여부 ②button 키가 snake_case(url_mobile)인지(v155 normalize가 camel로 통일했다면 그게 원인) ③빈 문자열 url을 키 생략 처리하는지(AC의 url1_1="" → url_mobile:"" 전송 시 불일치) | |
| 3 | 19:23 배치의 8006 코드 소속(IMC 자체/게이트웨이)과 의미 | |

참고: 성공 사례(id 22)는 버튼이 없어서 이 변환을 안 탔습니다. 위 ①~③ 중 하나가 원인일 확률이 높고, 원문 로그(요청 1)면 한 번에 갈립니다. 블로커 SoT = 한줄로 status/BUGS.md §2.
