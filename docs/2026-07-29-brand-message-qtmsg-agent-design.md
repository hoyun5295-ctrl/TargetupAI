# 브랜드메시지 발송 경로 재구축 — QTmsg Agent 방식 (2026-07-29 설계 → **2026-07-31 배포완료**)

> **호출어: "브랜드메시지 발송경로 재구축"**
> SoT. 현재 상태·잔여는 STATUS §2 카드가 소유한다. 기억 = `memory/project_2026_0729_brand_message_billing.md`
> **구현 결과·수용/불수용·실측 시나리오 = §8**(아래 §0~§7은 착수 전 조사·설계 기록이며 그대로 보존한다).
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
   **알림톡과 같은 라인·같은 `SMSQ_SEND` 테이블 축에 `msg_type='F'`만 다르게** 넣는다. ~~버전 확인 불요.~~
   ⛔ **2026-07-31 뒤집힘 — 라인 축은 맞았고 "버전 확인 불요"가 틀렸다.** 실측 `QtMsg 3.0.7.4`(§1 요구 3.0.8.2 미만).
   이것이 실측 1건이 실패한 진짜 원인이다(§9-1). **확인 비용은 명령 한 줄이었다.**
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

## §8 구현 결과 (2026-07-31 **배포완료** `4864d5d9` — Codex 적대검증 11라운드 SHIP)

§7 1~5 전부 구현. backend tsc 0 · frontend tsc 0 · vitest **1,617/1,617**(불변식·CT-12 계약 테스트 신설 포함).

**구현 축** — ①적재: CT-04 `insertBrandQueue`(SMSQ `msg_type='F'`·5000 배치·부분커밋 계약), 유령 테이블
적재 2함수·전용 조회 헬퍼 7종 삭제 ②조립: CT-12 `buildBrandMsgContents`(대문자 3키·fail-closed)·
`resolveBrandFallback`(NO/SM/LM→N/A/B·MM 거부·대체문안 미입력=원문) ③호출부 5곳 배치 전환
④조회·취소·집계·엑셀 SMSQ 합류(라벨 `'F'→브랜드메시지`·본문은 JSON에서 MESSAGE만 표시)
⑤정산 `BRAND.smsqCode='F'` + IMC arm 3곳 삭제.

**적대검증이 키운 범위**(수용 16건 — 상세는 라운드 기록):
- **차감 축 CT 통일**(`resolveRefundAxes`) — 대량 직접발송(`direct-send-core`)이 브랜드를 알림톡 단가로
  차감·both 브랜드 무료이던 결함, 테스트 발송 축 오류까지 동근원 수정. 환불(취소·sync·cleanup·sweeper)도
  같은 축으로 분리(both=문자·브랜드 두 원장 각자 수렴).
- **정산 ID 이중 축**(`selectBillingSendIds`) — 큐 `app_etc1`은 campaigns.id인데 청구 대상은 run id라
  브랜드·AI 발송이 통째 미청구이던 갭. 이벤트 축(무기간)+캠페인 축(기간 한정)으로 분리해
  재발송 이중 청구까지 차단. 미리보기 매장 상세 BRAND 합류.
- **`send_phase='preparing'` 게이트** — 차감 완료 전 캠페인을 워커가 못 집는 상태로 만들어
  차감-발송 원자성 부재를 구조로 봉인. 활성화 실패는 phase 재확인 3분기(커밋됨/실패/미확정),
  잔존은 개수 기반 단일 경보(행 단위 마커 구조는 3라운드 연속 누수로 폐기).
- 원장 키 'BRAND' 정규화 · 환불 ok 확인+durable 의무 · `/brand-send` created_by 기록.

**불수용 3건**(근거 기록): 소문자 'brand' 원장 호환(배포 전·과거분 상쇄 종결·미매칭=무동작 안전) /
취소 DELETE 원자 재설계(기존 구조 동일·미악화 — 9999 무조건 마킹으로 창만 축소) /
MySQL 드라이버 취소 배관·경보 쿨다운 개편(전 소비처 영향 별도 과제 — 미종료 1개 상한으로 대체).

**실측 1건 시나리오(배포 후·6원칙 ⑤)** — hoyun 계정, 직접발송 브랜드 모달 자유형 TEXT·수신 1건(도달
가능 실번호 1건만), 발신프로필 선택 → 발송 → ①SMSQ 라인 테이블에 `msg_type='F'`·`k_etc_json` senderkey
행 확인 ②실수신 확인 ③발송결과 화면 카운트·상세(브랜드메시지 라벨·본문) ④`balance_transactions`
BRAND 차감 1건 ⑤발송통계/청구 미리보기 BRAND 1건.

**DDL 불요**(기존 컬럼·값만 사용. `send_phase` CHECK 없음 실측 — 2026-07-31 pg_constraint).
신규 파일 = `utils/brand-message.test.ts`(커밋 시 git add 대상).

## §9-1 발송 실패 원인 확정 — Agent 버전 미달 (2026-07-31 실측)

**`QtMsg 3.0.7.4`.** §1 요구는 **3.0.8.2 이상**이다. 코드가 아니라 게이트웨이가 못 받는 상태였다.

증거 사슬(전부 실측):
| 지점 | 값 | 뜻 |
|---|---|---|
| Agent deliver 로그 | `Seqno[761729] ... MsgType[F] BillId[]` → `Deliver ack 성공 : E_OK` | **우리 전문은 중계서버까지 정상 접수** |
| Agent report 로그 | 5초 뒤 `Carr[0] Rcd[7421] RcdS[카톡:타임아웃]` | 거절 주체 = 중계서버 |
| `bin/qtmsg.out` | `QtMsg 3.0.7.4` — **agent1~11 전 라인 동일**(실측) | 어느 라인으로 보내도 안 나간다 |
| `qtmsg-manual.txt`(4.0) | `TYPE_DEF`·`CHAT_BUBBLE_TYPE`·`TARGETING` grep **0건**. `F`=친구톡(평문+`file_name1`) | 이 Agent 문서에 브랜드 규격이 없다 |
| 같은 매뉴얼 257행 | "카카오톡 발송 실패는 **3초 이내에** 결과를 수신하여 status_code 세팅" | **3초는 정상 거절 응답 시간** — 대기 타임아웃이 아니다 |

> ⚠ `7421`의 라벨 '타임아웃'은 코드표 이름(`E_K_SEND_TIMEOUT`)일 뿐이다. **라벨만 보고 "우리 문제 아님"으로
> 판정하면 안 된다** — 실제로는 즉시 거절이었고, 원인은 우리 쪽 전제(버전 미확인)였다.
> `k_etc_json`에 `senderkey`를 넣는 방식 자체는 이 매뉴얼 234~239행에 있고 우리 방식과 같다.
> 성공한 알림톡은 `senderkey` 없이 `k_template_code`로만 나간다(대조군 실측).
> `mob_company=0`은 성공한 알림톡도 같으므로 단서가 아니다.

**조치** = Agent를 3.0.8.2 이상으로 교체(공급사 zip). 발송 입구 차단은 **넣지 않는다**(2026-07-31 Harold —
"어차피 보낼 사람 없다").

⛔ **교체는 운영 전 라인을 건드리는 작업이다.** 11개 Agent가 지금 문자·알림톡을 정상 발송 중이고
브랜드 하나 때문에 그 전부를 올리는 것이다. **한 라인만 먼저 올려 문자·알림톡 회귀 없음 + 브랜드 성공을
확인한 뒤 나머지로 확대**한다(교체 중 그 라인 발송은 멈춘다).
⛔ **`conf/` 보존** — 라인마다 agent id·DB·`update_report`가 다르다(agent1 = `targetai_m`,
`conf/` 최종 수정 2026-06-10 ≠ 설치일 2026-02-10 = 커스터마이즈됨). zip을 통째로 덮으면 날아간다.
실제 스크립트는 매뉴얼의 `start.sh`/`stop.sh`가 아니라 `bin/startup.sh`·`bin/shutdown.sh`(안 되면 `fkill.sh`).

전 라인 버전 확인:
`for d in /home/administrator/agent*/; do printf "%-36s %s\n" "$d" "$(grep -ho 'QtMsg [0-9.]* version' $d/bin/qtmsg.out 2>/dev/null | tail -1)"; done`

## §9 실측 1건 결과 → 표시 축 재구축 (2026-07-31 — Codex 적대검증 6R approve)

§8 실측을 돌리자 발송은 나갔는데(큐 적재·전문 형식 정상, 한글 정상 — HEX 실측) 화면이 셋 다 틀렸다.
**결과코드 7421 카카오 타임아웃**은 우리 전문 문제가 아니고, 대체발송이 사용자 설정대로 `NO`라
`7830/7831`(카카오실패→문자성공)로 회수될 여지가 없었던 것이다(원인 미규명 — 대체발송 `SM`으로 재측정 대상).

**뿌리 둘**
1. **`/brand-send`만 campaigns 축약 INSERT**(9컬럼). 나머지는 컬럼 DEFAULT가 채웠다 —
   `send_type='ai'`(유형 **AI**), `callback_number` 빈값(회신번호 `-`), 그리고 사용자가 고르지도 않은
   `kakao_targeting='I'`·`kakao_resend_type='SM'`이 저장됐다(**거짓 데이터**).
2. **채널·유형 판정이 화면에 리터럴로 흩어짐.** `send_channel === 'kakao'` 한 줄만 비교해
   전용 발송값 `kakao_brand`가 어디에도 안 걸리고 `message_type='LMS'`로 흘러내렸다.
   유형도 `send_type === 'direct' ? 수동 : AI` 이분법이라 자동발송·여정이 전부 AI로 뭉개졌다.

**수정** — `/brand-send` INSERT 18컬럼(`send_type='direct'`·`callback_number`·`kakao_*` 4종·`is_ad`·
`target_count`·`scheduled_at`) / 여정 `send_type='journey'`(campaigns CHECK는 `message_type`·`status`
2건뿐 — pg_constraint 실측) / **CT 2개 신설**(`frontend/utils/campaign-axis.ts` 표시, `utils/send-type-axis.ts`
값·라벨) / 판정 인라인 20곳 치환 / 유형 필터 5분기(서버·화면 같은 값 집합) / 브랜드 단가 축
(`getCompanyCosts().brand`·요약 `perBrand` — 화면이 알림톡 단가로 계산하던 것) / 단가 폴백 `||`→`??`
(0원 계약 보존) / `channelPlainLabel`도 같은 결함이라 CT 기반으로(엑셀 채널 컬럼) / 채널 성과 집계가
`message_type AS channel`로 세 채널을 LMS 한 줄로 합치던 것을 두 컬럼 GROUP BY + `mergeByChannelLabel`로.

**동반 발견** — `admin.ts`가 `c.send_type as campaign_type` 별칭을 써서 축 grep이 그 화면을 놓쳤다.
별칭 제거 + **축 별칭 금지 불변식**. 목록·통계상세 응답에 `send_channel` 누락도 같은 부류였다
(표시만 고치고 데이터를 안 실으면 그 화면은 안 닫힌다 — 2R·4R에서 연속 적발).

**회귀 차단** — `brand-axis-invariants.test.ts` +11건. 프론트 CT를 **실제 import해 값 비교**(문자열
매칭은 주석만으로 통과한다), 원값 렌더 검출기를 순수 함수로 분리해 **fixture로 커버리지 고정**
(그 fixture가 검출기 자체 버그를 잡았다), 축 별칭 금지, 채널 라벨 CT 계약, 채널 출처 상수.
회귀 주입 음성 검증 완료. backend tsc 0 · frontend tsc 0 · vitest **1,633/1,633**.

**미종결 1건**(별건) — `utils/mysql-refund-sweeper.ts:601` `channel: row.message_type`도 같은 오명명이지만
그 값이 회사 메모리의 `memoryKey`·`channel_*` **저장 키**가 된다. 고치면 기존 누적 학습과 키가 갈리므로
키 이관(또는 dual-read)을 함께 정해야 한다.

**재측정 시나리오** — 직접발송 헤더 브랜드메시지, 자유형 TEXT, **대체발송 `SMS 대체`+대체문안 입력**,
수신 1건. ①campaigns에 `send_type='direct'`·`callback_number`·`kakao_bubble_type='TEXT'`·`kakao_resend_type='SM'`
②큐 `k_next_type='A'`·`k_next_contents` 채워짐 ③발송결과 유형=`직접발송`·채널=`브랜드메시지`
④여정 캠페인이 `여정`으로 표시 ⑤7421 재발 시 `7830/7831` 회수 여부.
신규 파일 2개 = `utils/send-type-axis.ts` · `frontend/src/utils/campaign-axis.ts`(git add 대상).
**프론트 변경 포함 — 배포에 빌드 필요.**
