# 브랜드메시지 발송 경로 재구축 — QTmsg Agent 방식 (2026-07-29 설계, 착수 대기)

> **호출어: "브랜드메시지 발송경로 재구축"**
> SoT. 현재 상태·잔여는 STATUS §2 카드가 소유한다. 기억 = `memory/project_2026_0729_brand_message_billing.md`
> 원본 = `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\카카오-브랜드메시지-발송매뉴얼.pptx`(강문희, 2026.01.16, 11슬라이드)

## §0 왜 이 문서가 생겼나

직원이 직접발송에서 브랜드메시지를 보냈는데 안 나갔다. 파고들어 보니 **네 겹**으로 막혀 있었다.

| 층 | 증상 | 상태 |
|---|---|---|
| 1 | `campaigns` INSERT가 없는 컬럼 `name` 사용 (42703) | **고침** (실제 `campaign_name`) |
| 2 | `campaigns.send_channel` varchar(10)에 `'kakao_brand'` 11자 (22001) | **고침** (ALTER varchar(20)) |
| 3 | `campaign_runs` INSERT가 없는 컬럼 3개(`company_id`·`total_sent`·`total_success`) | **고침** (다른 INSERT 3곳과 동일 컬럼으로) |
| 4 | **적재 테이블 `IMC_BM_FREE_BIZ_MSG`가 존재하지 않음** (1146) | **미해결 — 이 문서의 주제** |

즉 **이 기능은 한 번도 동작한 적이 없다.** 진입점이 브랜드 탭 안에 묻혀 있어 아무도 밟지 않았고,
0729에 직접발송 헤더로 버튼을 내놓자 즉시 드러났다.

> ⚠ 앞서 "웹 브랜드 발송 0건 = 미오픈"으로 읽었던 것은 **틀렸다.** 0건의 진짜 이유는 "보낼 수가 없어서"다.

## §1 실제 스펙 (매뉴얼 확정)

우리 코드는 IMC(휴머스온) **REST API 스펙**을 보고 만들어졌지만, 운영 실체는 **QTmsg Agent 방식**이다.
레포의 `Alimtalk/` API 문서 묶음에도 발송 API는 없다 — 템플릿·프로필 관리 전용이다. 발송은 전부 DB 적재다.

**핵심: 알림톡과 같은 `SMSQ_SEND` 테이블에 넣고 `msg_type`만 다르다.**

| 필드 | 값 | 비고 |
|---|---|---|
| `msg_type` | **`'F'` 고정** | 알림톡은 `'K'` |
| `dest_no` | 수신번호 | |
| `call_back` | 발신 콜백번호 | |
| `sendreq_time` | 발송 시각 | 현재 이전이면 즉시 |
| `k_etc_json` | `{"senderkey":"..."}` | 발신프로필 키 |
| `k_template_code` | 템플릿 코드 | 기본형만 |
| `msg_contents` | **JSON 문자열** | 아래 §2 |
| `k_next_type` | `'A'`·`'B'`만 | `'S'`·`'L'` 불가 — **오류 로그도 없이 버려진다** |
| `k_next_contents` | 대체 문구 | 전환 재발송 시 **필수** |

- 요구 버전: **qtmsg 3.0.8.2 이상**
- 결과 조회: `SMSQ_SEND_YYYYMM` — **알림톡과 완전히 동일**

## §2 `msg_contents` JSON

필수 3키는 **전부 대문자**. 형식이 어긋나면 **조용히 실패 처리**된다(실패코드는 qtmsg 매뉴얼).

```
TYPE_DEF          : FREE | BASIC_TCD | BASIC_VAR
TARGETING         : M | N | I | F
CHAT_BUBBLE_TYPE  : TEXT | IMAGE | WIDE | ...
MESSAGE           : 문자내용 (FREE만 — BASIC_xxx에는 없다)
```

**TYPE_DEF**
- `FREE` — 자유형. 템플릿 없이 `MESSAGE`로 내용을 직접 싣는다.
- `BASIC_TCD` — 기본형. 사전 등록한 템플릿 코드만 넣는다(`k_template_code`).
- `BASIC_VAR` — 기본형 변수세팅. 템플릿에 `#{변수명}`으로 등록해 두고 발송 시 치환한다.
  `MESSAGE_VARIABLE`·`COUPON_VARIABLE`로 값을 준다. `#{할인율}`이 100을 넘으면 오류.

**TARGETING** (마수동 = 마케팅수신동의)
- `M` 광고주 마수동 유저 / `N` 마수동 ∩ 채널친구 / `I` 발송요청 대상 ∩ 채널친구 / `F` 전체 채널친구
- ⚠ 코드별 **자격 조건이 다르다 — 운영실 문의 대상**. 현재 코드에 이 축이 없다.
- 매뉴얼 예시는 전부 `I`(기존 친구톡과 동등 수준).

**예시 — 자유형 TEXT + 버튼**
```
msg_type = 'F', k_next_type = 'N'
k_etc_json  = {"senderkey":"5dc4...32ce"}
msg_contents = {
  "TYPE_DEF": "FREE", "TARGETING": "I", "CHAT_BUBBLE_TYPE": "TEXT",
  "HEADER": "헤더내용", "MESSAGE": "문자내용",
  "ATTACHMENT": { "button": [ {"name":"...","type":"WL","url_pc":"...","url_mobile":"..."} ] }
}
```

**예시 — 기본형 변수세팅**
```
k_template_code = 'b570...c503'
msg_contents = {
  "TYPE_DEF": "BASIC_VAR", "TARGETING": "I", "CHAT_BUBBLE_TYPE": "TEXT",
  "MESSAGE_VARIABLE": { "변수명": "따스함" }
}
```

## §3 지원 범위 — TEXT·IMAGE·WIDE만

매뉴얼이 SQL 예시로 준 유형은 **TEXT·IMAGE·WIDE** 셋뿐이다.
나머지(`WIDE_ITEM_LIST`·`CAROUSEL_FEED`·`PREMIUM_VIDEO`·`COMMERCE`·`CAROUSEL_COMMERCE`)와
`ATTACHMENT` 세부 사용법은 **`attachment_method.pdf` 별도 문서**를 참조하라고만 되어 있다 — **미확보**.

⛔ **추측으로 만들지 않는다.** 형식이 틀리면 큐에는 들어가고 발송만 조용히 실패한다 =
차감은 되고 메시지는 안 가는 상태. 지금은 실패가 드러나 환불로 상쇄되니 오히려 안전하다.
지원하지 않는 유형은 **입구에서 막고** 사용자에게 알린다.

## §4 고쳐야 할 범위 — 발송만이 아니다

`IMC_BM_FREE_BIZ_MSG`는 **7개 파일**에 퍼져 있다. 발송만 바꾸면
"보내지긴 하는데 결과가 안 보이고 취소도 안 되는" 반쪽이 된다. **한 번에 옮긴다.**

| 축 | 위치 |
|---|---|
| 발송 | `sms-queue.ts` `insertKakaoQueue`(자유형)·`insertKakaoBasicQueue`(기본형) |
| 조회·취소 | `sms-queue.ts` `kakaoAgg`·`kakaoCountPending`·`kakaoCancelPending`·`kakaoCountWhere`·`kakaoSelectWhere`·`kakaoBatchAggByGroup`·`kakaoGroupBy` |
| 발송결과 | `routes/results.ts` 817·818·1043 |
| 엑셀 | `utils/campaign-sms-export.ts` 89 |
| 정산 집계 | `utils/send-usage-aggregation.ts` 638·681·1399 (일자축 2 + 상세축 1) |
| 통계 | `utils/stats-aggregation.ts` · `utils/campaign-sync-worker.ts` |
| 관리자 | `routes/admin.ts` 2299 |
| 호출부 | `campaigns.ts` 387·948·2047 · `brand-message.ts` 457·532 · `direct-send-processor.ts` 150 |

**결과 조회는 알림톡 경로와 합쳐진다** — 같은 `SMSQ_SEND_YYYYMM`이므로 `msg_type='F'` 필터만 다르다.
지금 알림톡 조회 코드를 재사용하는 것이 정답이고, 브랜드 전용 조회 헬퍼 7개는 **사라져야 정상**이다.

## §5 착수 전 확정해야 할 것

1. **테이블 선택 축** — 알림톡은 호출부가 라인그룹별 테이블 목록을 넘겨 첫 번째를 쓴다
   (`insertAlimtalkQueue(tables, ...)`). 브랜드도 같은 라인을 타는지, 별도 라인인지 확인 필요.
   이걸 정해야 호출부 6곳의 시그니처가 정해진다.
   → **확정(2026-07-30 Harold)**: 지금 설치된 QTmsg가 브랜드메시지를 처리한다 — 별도 라인 없음.
   **알림톡과 같은 라인·같은 `SMSQ_SEND` 테이블 축에 `msg_type='F'`만 다르게** 넣는다. 버전 확인 불요.
2. **`TARGETING` 기본값** — 현재 코드에 이 축이 없다. 매뉴얼 예시는 `I`지만 자격 조건이 코드마다 달라
   운영실 확인 대상. 화면에서 고르게 할지 `I` 고정으로 갈지 결정 필요.
3. **`attachment_method.pdf` 확보 여부** — 있으면 8종 전체, 없으면 3종으로 확정.
   → **확보(2026-07-30)**: `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\attachment_method.pdf`(23p).
   내용 = ATTACHMENT(버튼 WL·AL·BK·MD·BC·BT·AC·BF 등 + image·item·coupon·commerce·video 필드 구조,
   브랜드 기본형 §3.3·자유형 §3.4) + SUPPLEMENT(quick_reply) + CAROUSEL(§5.2·§5.3 브랜드 기본형·자유형 —
   CAROUSEL_FEED·CAROUSEL_COMMERCE 시 필수, list 2~6·인트로 시 1~5).
   **단 이 문서도 `msg_contents` 상위 조립 예시(캐러셀·커머스·비디오의 최상위 키명·대소문자)는 없다** —
   SQL 조립 실예시가 있는 것은 여전히 본 매뉴얼의 TEXT·IMAGE·WIDE 셋뿐.
4. **`campaign_runs.success_count` 실존** — 0729에 SCHEMA.md만 보고 넣지 않았다(같은 날
   `send_channel` 길이가 오기로 드러나 문서를 근거로 컬럼을 쓰지 않기로 했다). `information_schema` 확인 후 판단.
   → **확정(2026-07-30 실측)**: `success_count` integer 실존. `sent_count`·`fail_count`·`target_count`도 실존 —
   16컬럼 전체가 SCHEMA.md와 일치. 이 항목 종결, 코드에서 사용 가능.

## §6 이미 배포된 선행 수정 (이 트랙의 전제)

`campaign_name`·`send_channel` ALTER·`campaign_runs` 컬럼 — 어느 방식이든 필요한 수정이라 먼저 배포했다.
다만 그것만으로는 발송이 나가지 않는다. 적재 테이블이 없으니 지금도 실패하고, `brand-message.ts`가
미적재분을 `prepaidRefund`로 환불해 **차감은 상쇄된다**(돈은 새지 않는다).

## §7 착수 순서 (제안)

1. §5의 4가지 확정
2. `sms-queue.ts` 발송 2함수를 `SMSQ_SEND`·`msg_type='F'`·JSON `msg_contents`로 재작성 + 지원 유형 게이트
3. 조회·취소·집계·엑셀을 알림톡 경로에 합류(브랜드 전용 헬퍼 제거 — 코드가 줄어야 정상)
4. 정산 집계 3곳을 `msg_type='F'` 기준으로 (유형키 `BRAND`는 이미 배선돼 있다)
5. 소스 스캔 불변식에 "유령 테이블 참조 0건" 추가
6. Codex 적대검증 → 실측 1건(자유형 TEXT) → 배포
