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

## §9-1 발송 실패 — 우리 쪽 변수 전량 제거, 중계서버 축만 남음 (2026-07-31)

> ⛔ **"원인 = Agent 버전 미달"은 틀렸다.** 요구 버전 미달은 사실이었고 교체도 했지만,
> **교체 후에도 같은 `7421`이 재현**됐다. 정황(요구 버전 미달 + 매뉴얼에 브랜드 규격 없음)을
> 원인으로 확정한 판정이 성급했다 — 정황은 원인이 아니다.

**교체 후 대조군(2026-07-31 21:31~21:34, agent1 단일 라인 · 같은 발신·수신번호 · 3분 이내)**

| seqno | msg_type | 결과 |
|---|---|---|
| 772168 | `F` 브랜드 | `Carr[0] Rcd[7421] RcdS[카톡:타임아웃]` |
| 772169 | `S` 문자 | `Carr[19] Rcd[6] 전송성공` |
| 772170 | `K` 알림톡 | `Carr[0] Rcd[1800] 카톡(알림톡)성공` |

**이 한 표가 제거한 변수** — Agent 버전(3.0.8.2) · 라인/테이블 · 발신번호 · 수신번호 · 시간대 ·
네트워크 · 중계서버 생존 · 카카오 경로 생존. **오직 `msg_type='F'`만 실패한다.**
새 버전은 형식 오류(`E_K_FORMAT`)·프로필 문제(`E_K_NOT_FOUND_PROFILE`)를 구분해 돌려주는데도
여전히 `7421`이라, 중계서버가 **전문을 해석하기 전 단계**에서 막고 있다.

### 배제 목록 — 2026-07-31 야간 전수 실험 (같은 CP `targetai_m` · agent1 · 같은 수신번호)

| # | 가설 | 시험 | 결과 |
|---|---|---|---|
| 1 | 한글 인코딩 손상 | 저장 바이트 HEX 확인 | **배제** — UTF-8 정상, 화면 `???`는 mysql 클라이언트 표시 |
| 2 | Agent 버전 미달 | 전 라인 3.0.7.4 → 3.0.8.2 교체 | **배제** — 교체 후에도 동일 `7421` |
| 3 | 대체발송 미설정 | `k_next_type` `N`/`A` | **배제** — 회수 문제일 뿐 실패 원인 아님 |
| 4 | 중계서버·계정 장애 | 같은 분에 `K`·`S` 발송 | **배제** — `K` 1800 성공, `S` 6 성공 |
| 5 | senderkey 불일치·미등록 | 3키(인비토·팝폰·마코골프) 각각 발송 | **배제** — 3키 전부 `7421` |
| 6 | 채널 친구 자격(`TARGETING I`) | 친구·비친구 각각 발송 | **배제** — 둘 다 `7421` |
| 7 | 브랜드 JSON 전문 형식 | **평문 친구톡**(`F` + plain text)으로 발송 | **배제** — 평문도 `7421`. 전문 축 종결 |
| 8 | 유형 코드가 `G`여야 함 | `G` + 브랜드 JSON | **배제** — `G`도 `7421` |
| 9 | 중계서버 주소 차이(`.57` vs `.58`) | conf 60항목 전수 대조 | **배제** — `.57`은 `testsms_m`·`mmsr3`와 한 세트인 공급사 테스트 블록 |
| 10 | 프로필의 브랜드 사용 플래그 | IMC `GET /sender/{key}` | **배제** — 인비토 `brandMessage:true`인데 실패. 게다가 세 프로필 전부 `alimtalk:false`인데 알림톡은 성공 = **이 플래그는 실제 발송 가능 여부를 반영하지 않는다** |

| 11 | conf `CODE_MAPPING`이 옛 120개라 새 코드 오해석 | 신규 374개 블록으로 교체 후 재기동·재발송 | **배제** — 여전히 `7421`(seqno 772182). 라인 설정 구간은 무접촉, 백업 `qtmsg.xml.bak-20260731-cm` |

| 12 | `bill_id` 미기재로 중계서버가 과금 주체를 못 찾음 | `.58` 등록표의 `Bill_ID=R0046`을 넣어 발송 | **배제** — 여전히 `7421`(seqno 772183) |

| 13 | `call_back`이 채널 발신번호여야 함(매뉴얼 예시는 전부 `18008125`, 우리는 휴대폰번호) | `18008125`로 발송 | **배제** — `7421`(seqno 772185) |

| 14 | `TARGETING` 값(`I`가 교집합이라 대상 0) | `M`·`F`·`N` 각각 발송 | **배제** — 네 값 전부 `7421`(772186·772187·772188) |
| 15 | 라인별 중계서버 계정 차이 | `SMSQ_SEND_2`·`_3`(`targetai2_m`·`targetai3_m`)로 발송 | **배제** — 두 라인 다 `7421`(L2 680179→771838 · L3 771710) |

> ★ **15번까지로 전문·계정 축이 완전히 소진됐다.** 바꿔볼 수 있는 값은 전부 바꿨다 —
> `msg_type`(F 평문·F JSON·G) · `TYPE_DEF`(FREE) · `TARGETING`(I·M·F·N 전부) ·
> senderkey 3종 · `call_back`(휴대폰·1800) · `bill_id`(빈값·R0046) · `k_next_type`(N) ·
> CP 계정 3개(`targetai_m`·`targetai2_m`·`targetai3_m`) · Agent 버전 · conf `CODE_MAPPING`.
> **서로 다른 CP 계정 3개가 똑같이 거부한다** — 계정별 개통 차이도 아니라는 뜻이다.

> ★ **13번으로 결론이 고정됐다 — 매뉴얼 예시와 글자 단위로 동일한 전문이 실패한다.**
> seqno 772185 = `call_back '18008125'` · `msg_type 'F'` · `k_next_type 'N'` ·
> `k_etc_json {"senderkey":"5dc4…32ce"}` · `msg_contents {"TYPE_DEF":"FREE","TARGETING":"I","CHAT_BUBBLE_TYPE":"TEXT","MESSAGE":…}`
> — 공급사 브랜드 매뉴얼 slide4 예시와 **수신번호를 제외한 모든 값이 동일**하다. 그런데 `7421`.
> 같은 분 같은 라인의 문자(seqno 772184)는 `6` 성공. **우리 쪽 전문으로 할 수 있는 것은 끝났다.**

> `.58` 발신프로필 등록표 실측(Harold 화면) — 인비토 `Bill_ID=R0046`, SenderKey `5dc4…32ce`(우리 값과 동일),
> 6행 전부 `B_IV_013_02_*` **템플릿코드에 묶인 매핑**이다. 매뉴얼 278~292행의 "템플릿 코드 매핑 = 알림톡만 해당"이
> 이 표다. 템플릿 없는 자유형 `F`가 이 표를 어떻게 타는지가 확인 안 된 유일한 지점.

⛔ **정황을 원인으로 단정하지 마라.** 위 10개 중 2·5·10은 "정황이 맞아떨어진다"는 이유로 원인이라고
보고했다가 전부 뒤집혔다. 특히 ②는 버전을 실제로 교체하고서야 아니라는 게 드러났다.

**남은 것 하나** — 중계서버(`58.227.193.58`)가 `E_OK` 접수 후 4~5초 만에 `7421`을 낸 **실제 사유**.
Agent 로그는 회신값만 남기므로 그 이유는 중계서버 쪽 로그에만 있다. 우리 DB·Agent·전문으로는 더 좁힐 수 없다.
**`.58`은 사내 서버다**(서수란 접근 가능 — 공급사 문의 대상이 아니다).

**다음 세션 시작점 두 줄** — ①`.58`에서 `targetai_m` 계정 `2026-07-31 22:06:29~36` **seqno 772179**(평문
친구톡·브랜드 JSON 아님)의 거부 사유 ②`.58`을 통과해 **성공한 `F` 한 건**의 로그. 12번 헛돈 근본 이유가
**성공 사례를 한 번도 못 본 것**이라, ②를 우리 실패 건과 나란히 놓으면 컬럼 대조로 끝난다.

**서버 상태(2026-07-31 종료 시점)** — Agent 11개 전 라인 `3.0.8.2`. **agent1만** conf `CODE_MAPPING`이
신규 374개(백업 `conf/qtmsg.xml.bak-20260731-cm`), 나머지 10개는 기존 120개 — **불일치 상태로 남아 있다.**
agent1은 conf 교체 후 문자 실발송 정상 확인함. 브랜드 실패분은 미적재·실패 환불로 상쇄돼 돈은 새지 않는다.

**참고(대조군 원문)** — 성공한 알림톡은 `k_etc_json`에 senderkey가 없고 `k_template_code`로만 나간다.
매뉴얼 278~292행상 `K`는 중계사 서버가 템플릿코드로 senderkey를 매핑하고(우선순위 최상위),
`F`·`G`는 우리가 준 senderkey를 중계서버가 조회한다.

**Agent 교체 자체는 완료(2026-07-31 21:29 KST)** — `qtmsg-v3.0.8.2-rcs-brand`의 `lib/qtmsg.jar`
하나만 agent1~11에 복사(`conf`·`bin` 무접촉). 11개 전 라인 `QtMsg 3.0.8.2` + 프로세스 11개 생존 실측.
`file_name6` 내부 요구는 없었다(기동 오류 0). 라인당 정지 6~8초. 롤백 = `qtmsg.jar.bak-3.0.7.4` 11개 보존.
**버전은 요구 사양을 맞춘 것이고 발송 실패와는 별개 사안으로 종결한다.**

### (아래는 교체 전 조사 기록 — 보존)

**`QtMsg 3.0.7.4`.** §1 요구는 **3.0.8.2 이상**이었다.

> **교체 완료(2026-07-31 21:29 KST)** — `qtmsg-v3.0.8.2-rcs-brand` zip의 `lib/qtmsg.jar` 하나만
> agent1~11에 복사(`conf`·`bin` 무접촉). agent1 선행 기동 확인 후 나머지 10개 일괄.
> 실측 = 11개 전 라인 `QtMsg 3.0.8.2 version service` + 프로세스 11개 생존(`/proc/PID/cwd` 대조).
> 우려했던 `file_name6` 내부 요구는 없었다(기동 오류 0). 라인당 정지 6~8초.
> 롤백 = `qtmsg.jar.bak-3.0.7.4`(11개 보존) 복사 후 재기동.

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

**교체 범위 = `lib/qtmsg.jar` 파일 하나**(2026-07-31 사전 대조 실측). `conf/`·`bin/`은 손대지 않는다.
- `bin/qtmsg.sh`에 **JDK 경로가 하드코딩**돼 있다(`/home/jdk1.8.0_65/bin/java`) — `bin/`을 덮으면 기동이 깨질 수 있다.
- 신규 `conf/`는 공급사 **테스트 템플릿**이다(`id[test11]`·`58.227.193.57`·`testsms_m`). 덮으면 라인 설정이 날아간다.
- classpath 3종 중 `mysql_jdbc510.jar`·`json_simple-1.1.jar`는 운영과 크기 동일, 바뀐 건 `qtmsg.jar`뿐
  (209,890 → 232,129 / md5 `811bdbedd41403c4ce8d1bd92417e33a`).

**xml 무수정 확정** — 운영 conf와 신규 템플릿을 같은 방법으로 뽑아 차집합을 냈다(태그명만, 값 미출력):
| 섹션 | 운영 | 신규 | 차이 |
|---|---|---|---|
| `CODE_MAPPING` | 120 | 374 | **RCS 254개뿐**(우리는 RCS 미사용). 카카오 25종 양쪽 완전 동일 |
| `FIELD_MAPPING` | 23 | 24 | `file_name6` 하나. `select_sql`이 conf의 `&(필드)` 치환으로 조립되므로 미정의=미참조 |

> ⚠ 앞서 `grep -c "<키>"`로 7개만 센 것은 **주석 안인지 활성인지 구분하지 못하는 검사**였다.
> 섹션 범위를 잘라 활성 태그만 뽑아 비교해야 결론이 선다(Harold 지적 — "xml 미리 체크해야 하지 않냐").
> **남은 미검증 1건** = 신규 jar가 conf에 없는 `file_name6`을 내부적으로 요구하는지. 기동 로그로만 확인된다.

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
