# 한줄로 V2 차수 4 — 발송 구조 설계 과제 3건 (m122 · R112 · R118)

작성 2026-09-28 · 상태 = **m122·R118 = 측정 뒤 처방 불필요로 종결 · R112 = 목업 승인(0929) · 구현 설계 승인(0929) · 구현 완료·미커밋·미배포(§2-2) · Codex 적대 5R high 0 종결** · 장부 = `docs/2026-09-25-hanjul-source-audit.md` §2-11 차수 4
**R112 다음 한 수 = 커밋·배포(백엔드 먼저 · 업무시간 밖) → 실측 1건(§2-1 E · B-0929-3)**

> **0928 측정(Harold 실행)** — 대량발송(3) 라인 즉시 발송의 MySQL 적재 구간(첫 행~끝 행 sendreq_time): 122,994건 7초 · 187,261건 12초(초당 약 1.5만~1.8만 건 · 50만 건이면 계산상 약 30초 · 앞의 정제 단계 시간은 이 값에 없다).
> 라인 현황 = 비토게이트웨이_1·2·3에 74곳 · 대량발송(2)·(3) 각 1곳 · 사용자 단위 라인 0 · 큰 적재는 전부 대량발송 라인.
> **Harold 결정(0928): 지금 속도면 문제없다. 느려 보여도 적재 정합성을 절대 어기지 않는 방법이 우선** → 적재 워커 구조(한 줄 · 캠페인 끝까지)는 바꾸지 않는다. m122·R118 종결(R118은 DM 타겟 발송도 준비 테이블 → 같은 워커로 적재하므로 m122와 같은 판정).
세 건 모두 발송·차감 경로를 바꾼다. 착수하면 건마다 테스트 → Codex 적대 검토(high 0까지) → 실측 1건 시나리오를 거친다.

---

## 1. m122 — 대량 적재가 다른 회사 발송을 막는다

**지금(코드 근거)**
- `utils/direct-send-worker.ts runDirectSendOnce`(5초 주기)가 `send_phase='queued'` 캠페인을 오래된 순으로 5개 집어 **하나씩 끝까지** 적재한다(`processCampaign` · 청크 1만 · 청크마다 이벤트 루프 양보).
- 50만 건 캠페인 하나가 적재되는 동안 뒤에 온 다른 회사의 즉시 발송·대행 발송은 그 캠페인이 끝날 때까지 적재되지 않는다(수 분).
- 재시작 복구 규칙(C-11): `processing`이 10분 넘게 멈추면 **이어서 적재하지 않고** MySQL 실측 적재 수로 종결한다. 마지막 청크 적재와 `processed_count` 기록 사이에 죽었으면 그 청크가 두 번 나가기 때문이다.

**설계안(추천 = A)**

| 안 | 방식 | 장점 | 위험 |
|---|---|---|---|
| **A 차례 돌리기** | 캠페인당 한 번에 K청크(예 5 = 5만 건)만 적재하고, 다른 queued 가 있으면 `send_phase='queued'`로 되돌려 줄 뒤로 보낸다(`processed_count` 기록 뒤라 이어 적재가 안전). 선택 순서 = `ORDER BY updated_at` | 동시 쓰기 없음 · DB 부하 그대로 · 작은 발송이 수 초 안에 적재 | 준비 단계(적재 테이블·필드 매핑·브랜드 이미지 AI 판정·정제)가 차례마다 다시 돈다 → 준비 결과를 `send_config`에 저장해 재사용해야 한다 |
| B 병렬 | 회사별 동시 2~3개 | 구현 단순 | MySQL 동시 적재 · 라운드로빈 테이블 경합 · 취소 잠금과 겹침 |

**A의 필수 조건**
1. 스스로 넘긴 것과 죽은 것을 구분: 넘길 때 `send_config.loadYield = { at, processed }`를 남기고 `queued`로 되돌린다 → 복구 규칙(C-11)은 `processing`만 보므로 영향 없음.
2. 준비 결과 저장: 적재 테이블·브랜드 이미지 판정 결과를 첫 차례에 `send_config`에 기록, 이후 차례는 읽기만(AI 재호출 0 · 크레딧 재차감 0).
3. 분할 발송 시각 = 전역 순번 기준(`processed_count + i`) — 지금도 OFFSET 기준인지 확인 후 유지.
4. 취소: 차례 사이 `queued` 상태에서 취소되면 기존 C-10 경로(적재 전 취소 종결)가 이미 처리한 분만 정산하도록 `processed_count` 반영 확인.

**검증**: 두 회사 동시 발송 테스트(큰 것 1 + 작은 것 1 · 작은 것이 큰 것 도중에 적재) · 차례 넘김 중 재시작 · 넘김 중 취소 · 분할 시각 연속성.

---

## 2. R112 — 직접 타겟 추출이 고객 전체를 브라우저로 보낸다

**지금**
- `POST /api/customers/extract`(routes/customers.ts)가 조건에 맞는 고객 **전체**를 LIMIT 없이 JSON으로 돌려준다(B-D75-04 결정 · 개인정보 칸 포함).
- 화면(`DirectTargetFilterModal` · `BrandSendModal`)은 받은 목록을 직접발송 수신자 목록으로 쓰고, 발송 때 다시 서버로 올린다.
- 큰 회사(10만+)면 응답·브라우저 메모리가 커지고, 개인정보가 전량 브라우저를 오간다.

**설계안(추천 = 추출 보관본)**
- 추출하면 서버가 결과를 **보관본**(기존 `campaign_send_staging` 형식 · 회사·사용자·만료 24시간)으로 저장하고, 화면에는 `extractionId · 건수 · 표본 20명`만 준다.
- 직접발송 화면은 보관본 모드일 때 수신자 표를 표본으로 보여 주고(「외 N명」), 발송 요청은 `extractionId`를 싣는다. 서버는 보관본에서 바로 정제·적재한다(브라우저 왕복 0).
- 수신자 한 명씩 고치기(삭제·편집)는 보관본 모드에서 막고, 필요하면 「목록으로 내려받아 편집」(엑셀) 안내.
- 신규 DDL 가능성: 보관본 표 재사용이면 0 — 착수 전 `information_schema`로 staging 칸 확인.

**영향**: 직접발송 화면 흐름(수신자 표·미리보기·개별 회신번호 검사)이 두 모드가 된다 → 화면 개편 절차(목업 먼저).

### 2-1. 구현 설계 (0929 · 목업 승인 · 착수 = Harold 승인 뒤)

**0929 Harold 결정** — 목업 「좋아 이대로」(핀 A~I) · 점검 줄 = 직접발송처럼 스팸 검사·맞춤법 검사 · 발송 바 = 직접발송처럼 · 담당자테스트 = 뺀다 · 메시지 칸 = 직접발송처럼 크게.
**승인안(위 설계안)과 달라진 것 2가지** — ① 한 명씩 빼기를 막지 않는다: 엑셀 안내 대신 **번호로 전체에서 찾아 빼기**(지금 선택삭제가 그대로 산다) ② 표본 = 20명 → **15명**(지금 한 쪽 15줄과 같은 밀도).
**보관본은 모든 추출에 쓴다**(크기로 두 길을 나누지 않는다 · 작은 추출도 같은 길 = 진실 하나).

**A. 화면 — 직접 타겟 발송 창(`TargetSendModal.tsx`)**

| 핀 | 자리 | 무엇 |
|---|---|---|
| I | 창 틀 · 본문 칸 | 왼쪽 열 440 → **560**(직접발송 왼쪽 열과 같음 · `SendWorkspaceShell asideWidth`) · 본문 칸이 남는 높이를 채우고 넘치면 칸 안 스크롤 ~~+ 「미리보기로 한 번에 보기」~~(★1008 제거 · 편집 도구 줄 미리보기와 이중) · 직접 타겟 「~까지 발송 가능」 마감 줄도 ★1008 제거(만료됐을 때만 「만료됨」) |
| G | 도구 줄 | 특수문자·보관함·문자 저장 + 오른쪽 초록 「미리보기」(직접발송 자리) · 윗줄 AI 추천·AI 꾸미기·byte는 그대로 · 자동입력 변수 칩·브랜드 링크 그대로 |
| F | 점검 두 칸 | `DirectCheckTiles` 그대로(스팸 검사 · 맞춤법 검사 NEW) · 판정(검사 원장)·맞춤법 결과 창·발송 전 경고 창·요금제 안내 창 = 직접발송과 같은 코드 · **담당자테스트 제거** |
| H | 발송 바 | 창 맨 아래 · 왼쪽 = 예약·분할·광고 표기 3칸(1.3 : .85 : 1 · 0929 예약 시각 잘림 수정 비율) · 오른쪽 = 발신번호(작성 카드에서 옮김 · 수신자별 칸 포함 · 한 곳만) + 전송(인디고 = 이 창 색) |
| A | 수신자 목록 머리 | 「내일 오전 11:40까지 발송 가능」(= 보관본 가장 오래된 행 + 23시간 · 기존 `STAGING_COMMIT_MAX_AGE_HOURS`) |
| B | 번호 검색 | 받은 표본 안이 아니라 **보관본 전체**에서 찾는다(서버) |
| C | 표 | 앞 15명 + 마지막 줄 「외 N명도 함께 발송됩니다」 · 쪽 넘김 없음 |
| D | 표 아래 | 선택삭제 = 서버 보관본에서 뺀다 · 전체삭제 제거(= 타겟 재설정) · 타겟 재설정 그대로 |
| E | 만료 | 23시간 지나면 안내 띠 + [같은 조건으로 다시 추출](1클릭 · 쓴 문자 유지) · 전송 잠금 |
| — | 머리 카드(알림톡·브랜드메시지) | 모양 그대로 · 누르면 보관본 전체 행을 받아 지금처럼 넘긴다(두 창 보관본화 = 범위 밖) |

**B. 서버**

| 입구 | 무엇 |
|---|---|
| `POST /api/customers/extract` + `keep: true` | 조건·SELECT·평면화는 지금 그대로 → 결과를 `campaign_send_staging`에 적재(UNNEST · 5만 행씩 · phone·name · callback NULL) → 응답 `{ extractionId, count, sample(앞 15행 · 지금 응답과 같은 평면 행), longest{칸: 가장 긴 값}, expiresAt }`. **`keep` 없으면 지금과 한 글자도 같다**(브랜드메시지 창 AI 타겟추출이 쓴다). 개인정보 조회 기록(`logPrivacyView`)은 지금 그대로 |
| `POST /api/customers/extractions/:id/search` | `{ q, phoneField }` · 숫자만 · 3자리 이상 · 보관본 번호에서 찾기 · 최대 50행 · 표시 칸은 추출과 같은 조립 · **요청 사용자 매장 범위(store-scope CT)를 다시 건다** |
| `POST /api/customers/extractions/:id/remove` | `{ phones }` · 준비분 잠금(`withStagingLock`) 안에서 커밋 여부 확인(커밋됐으면 409 · stage 입구와 같은 규칙) → 회사 조건 DELETE → 남은 건수 |
| `POST /api/customers/extractions/:id/rows` | 보관본 전체 행(추출 응답과 같은 칸) — 알림톡·브랜드메시지 머리 카드 전용 |
| `POST /api/customers/extractions/:id/callback` | `{ column, phoneField }` · 발송 바에서 수신자별 칸을 고를 때 · `staging.callback` = 그 칸 값(customers 조인 · 추출과 **같은 번호 식(phoneExpr)**으로 맞춘다 · customers는 (company_id, phone) 유일) → 빈 값 인원 반환(지금 전송 전 토스트와 같은 규칙) |
| `POST /api/campaigns/direct-send/count` | **응답 칸 더하기만**: `nameEmptyCount`(이름 빈 행) · `useIndividualCallback`이면 회신번호 제외 판정(`callback-filter` CT · 지금 동기 경로의 확인 창과 같은 값: 없음·미등록 인원·상세) · 직접발송은 이 칸을 읽지 않는다 |
| `POST /api/campaigns/direct-send/commit` | **무변경** · `stagingId = extractionId`로 부른다 |

- 새 CT `utils/extraction-keep.ts` — (a) 지금 `/extract` 안의 번호 식·칸 조립·평면화 코드를 **원본 그대로 옮기고** `/extract`도 이것을 부른다(옮기기 전 응답 캡처 테스트 먼저) (b) 보관 적재 (c) 가장 긴 값 (d) 보관본 × customers 조회 SQL.
- 만료 = 기존 CT 하나(`resolveStagingCommitState` · 23시간) · 만료면 search·remove·rows·callback 모두 410 `EXTRACTION_EXPIRED` · 정리 = 기존 `staging-sweeper`(24시간 · 통째로).
- 소유 = 준비분과 같은 회사 기준 + 개인정보를 돌려주는 입구(search·rows)는 사용자 매장 범위를 다시 건다.
- **DDL 0**(보관본 표 재사용) · 확인 SQL = 아래 G.

**C. 화면 코드**

| 파일 | 바뀌는 것 |
|---|---|
| `DirectTargetFilterModal.tsx` | 추출 2곳(조건 추출 · 자연어 추출) `keep: true` · `onExtracted` 인자 = `{ extractionId, count, sample, longest, expiresAt, fieldsMeta, phoneFields, filterBody }`(filterBody = 다시 추출용) |
| `Dashboard.tsx` | ① 추출 받기: `targetRecipients` = 표본 15행(미리보기 창·AI 결과 팝업은 앞 몇 명만 읽어 그대로 동작) + `targetExtraction` 상태 · `sampleCustomerRaw` = 표본 첫 행(지금과 같은 행) ② 발송: `/direct-send`(명단 본문) → `/direct-send/count` → 회신번호 제외가 있으면 기존 확인 창 → 발송 확인 창 → `/direct-send/commit` · 이름 빈 경고 = count의 `nameEmptyCount` ③ 바이트: `getMaxByteMessage(…, [longest행], …)`(1221줄 · `LmsConvertModal` · 맞춤법 단문 잠금) = 지금 전체 명단 계산과 같은 값 ④ 머리 카드: rows 입구 → 지금 경로 ⑤ `handleTargetTestSend` 연결 제거(타겟 전용) ⑥ 다시 추출 = filterBody로 keep 재호출 |
| `TargetSendModal.tsx` | 목업대로 재구성 · 수신자 props = 보관본(표본·건수·만료·검색·빼기) |
| `DirectSendPanel.tsx` | 점검 판정·세 창 · 본문 칸 채우기 · 발송 바를 공용으로 **옮긴다**(원본 복사 · 동작 불변) → `direct-send/useSendPrecheck.ts` · `direct-send/useEditorFill.ts` · `direct-send/SendBar.tsx`. 변수 치환(스팸 검사 문안)·최장 바이트 계산은 호출부가 함수로 넘긴다(직접발송 = `replaceDirectVars` · 타겟 = `replaceVarsByFieldMeta`) |

**D. 영향표(소비처 전수 · 0929 grep)**

| 대상 | 소비처 | 처리 |
|---|---|---|
| `/api/customers/extract` | `DirectTargetFilterModal` 2곳 · `BrandSendModal` 1곳(AI 타겟추출 → 직접입력 목록) | 앞 2곳 keep · 브랜드는 무변경(keep 없는 응답 캡처 테스트로 고정) |
| Dashboard `targetRecipients` | 752 이름 빈 경고 · 766 발송 본문 · 1221 바이트 · `TargetSendModal` · `AiCampaignResultPopup`(목록 보기) · `LmsConvertModal`(바이트) · `DirectPreviewModal`(첫 행·앞 10명) · 3486 알림톡 · 3492 브랜드 | 752 → count · 766 → commit · 바이트 2곳 → longest 행 · 미리보기·팝업 → 표본 · 알림톡·브랜드 → rows |
| `/direct-send/count` 응답 | `DirectSendPanel` 1곳 | 칸 더하기만 · 기존 칸 무변경 |
| `DirectSendPanel` 점검·발송 바·본문 칸 | 직접발송 창 | 옮기기만 · 직접발송 회귀 테스트(점검 칸 상태·경고 창·발송 바) |
| `handleTargetTestSend` · 담당자테스트 | 타겟 창 1곳 | 제거 · `testSending` 등 공용 상태는 AI 발송 창이 쓰므로 유지 |
| 발송 경로 | 타겟 발송 = 동기 `/direct-send` → 적재·확정 `/direct-send/commit`(직접발송과 같은 길) | **착수 첫 단계 = 두 입구 검사 항목 전수 대조표**(지금까지 확인된 차이 = 수신자별 회신번호 채우기 · 미등록 회신번호 확인 창 · 이름 빈 경고 → 위 B·C로 메움) · 변수 치환은 두 길 모두 customers를 번호로 읽는다(동기 2583줄 · 워커 `direct-send-processor` 129줄) |

**E. 검증**
- 백엔드 계약 테스트: keep 응답(건수 = 적재 행 · 표본 15 · 가장 긴 값) · keep 없는 응답 불변 · 검색(숫자만·3자리·50행·회사·매장 범위) · 빼기(커밋 뒤 409) · 만료 410 · callback 채우기(같은 번호 식 · 빈 값 인원) · count 추가 칸.
- 프론트: tsc 0 · vitest 패키지 전체 · 직접발송 화면 회귀 · 레이아웃은 여러 폭에서 그려 잰다(560 · 모바일).
- 돈 경로(타겟 발송이 차감 입구를 바꾼다) → Codex 적대 검토 high 0까지.
- **실측 1건 시나리오(Harold)**: 작은 추출(테스트 번호 2~3명) → 한 명 검색·빼기 → 발송 → 결과·차감 = 남은 인원 · 큰 추출(10만+) 응답 크기·시간 전후 비교.

**F. 미검증**
1. 보관본 검색 속도(10만+ 행 번호 LIKE · `idx_css_staging (staging_id, id)` 범위 안) — 측정 전.
2. count의 회신번호 제외 판정을 명단 전체에 거는 시간 — 측정 전.
3. 타겟 창의 알림톡 채널 분기(`targetSendChannel === 'kakao_alimtalk'`)는 진입이 없다(D162-4 'sms' 고정) → 건드리지 않고 범위 밖 기록.

**G. 착수 전 확인(Harold · .62 · 읽기 전용)** → **0929 실행 완료 = 승인**: id bigint · staging_id uuid · company_id uuid · **phone varchar(20) NOT NULL** · name text · extra1~3 text · **callback varchar(20)** · created_at. 새 칸 0 = **DDL 0 확정**. 폭 20 → 번호가 비었거나 20자 넘는 행은 보관하지 않고 따로 센다(skippedNoPhone) · 회신번호는 20자 넘으면 숫자만 · 그래도 넘으면 비움.
```sql
SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name = 'campaign_send_staging' ORDER BY ordinal_position;
```

### 2-2. 구현 기록 (0929 · 미커밋 · 미배포)

| 층 | 파일 | 무엇 |
|---|---|---|
| 서버 CT | `utils/extraction-keep.ts`(신규) | 추출 SELECT 조립·평면화(옛 `/extract` 코드 원본 이동) · 보관 적재(한 트랜잭션 · 5만 행 UNNEST) · 상태(만료·커밋) · 검색 · 빼기 · 전체 행 · 회신번호 채우기 · 사용자 매장 범위 |
| 서버 입구 | `routes/customers.ts` | `/extract` keep 분기(없으면 옛 응답 그대로) + `/extractions/:id/{search,remove,rows,callback}` |
| 서버 집계 | `utils/direct-send-core.ts countStagingChecks` · `routes/campaigns.ts /direct-send/count` | 요청할 때만 이름 빈 행 · 수신자별 회신번호 제외(callback-filter CT · 동기 경로와 같은 응답 모양) · 제외 뒤 실제 발송 인원(수신거부까지 뺌). 직접발송 = 요청 안 함(무변경) · commit 무변경 |
| 화면 CT | `utils/target-extraction.ts`(신규) | 보관본 요청 모양·만료 판정 한 곳 |
| 공용으로 옮김 | `direct-send/useSendPrecheck.tsx` · `useEditorFill.ts` · `SendBar.tsx`(신규) | 직접발송 창 코드를 스크립트로 원본 그대로 옮김(경계·치환 검사) · **직접발송 창 옛/새 서버 렌더 HTML 4상태 전부 같음(0929 실측)** |
| 화면 | `TargetSendModal.tsx`(재구성) · `DirectTargetFilterModal.tsx` · `Dashboard.tsx` · `shared/SendWorkspaceShell.tsx`(`footer` 선택 칸 · 넘길 때만 휴대폰 폭 창 전체 스크롤) | 목업 A~I · 담당자테스트 제거 · 발송 = 집계 → (회신번호 제외 확인) → 발송 확인 → 확정 |

**검증**: backend tsc 0 · frontend tsc 0 · vitest 503파일 6,849건(신규 = extraction-keep 22 · staging-checks 6 · target-send-keep-screen 14 · 옮긴 코드를 원문에서 찾던 계약 2건은 새 파일을 보게 갱신) · 폭별 실측 = 서버 렌더 + 헤드리스 브라우저(Pretendard 적재 확인) 7상태 × 8폭(390~1920) 56건 예상 밖 결함 0 · 휴대폰 폭 발송 바가 수신자 목록을 덮던 결함 1건은 실측으로 찾아 고침.
**옛 동기 경로 ↔ 확정 경로 대조(착수 첫 단계)**: 발송 전 검사(라인그룹 · 채널 · 유형 · 링크 결함 · 발신 인증 · MMS · 예약 · 야간 광고 · 분할 끝나는 날 · 카카오 게이트 · 알림톡 승인) = 확정 경로에도 있음. 피로도 차단 = 옛 경로도 고객 id 있는 행만 막았고 추출 SELECT에 id가 없다(FIELD_MAP 칸 21개 실측) → 두 경로 모두 걸리지 않음(같음). 회신번호 제외 = 옛 경로는 차감 전에 뺐고 확정 경로는 워커가 빼고 미적재(total − sent)로 환불(직접발송과 같음). `campaign_runs` 행 = 옛 동기 경로만 즉시 발송 때 남겼다 · 정산은 캠페인 id 로도 집계(selectBillingSendIds UNION)라 직접발송과 같다.
**0929 추가(Harold)**: 자동입력 변수 칩 · 브랜드 링크 칸 → 도구 줄 펼침 버튼(「변수 ▾」 직접발송 모양 · 「브랜드 링크 ▾」 위로 펼침) · 미리보기 = byte 옆(직접발송 자리). 메시지 칸 실측 1440×900 168 → **347px** · 1366×768 120 → 271 · 1920×1080 334 → 513(직접발송 486 · 666).
**Codex 적대 1R(high 2 · 전부 수용)**: ①수신자별 회신번호 제외를 차감 뒤 워커가 빼던 것 → 확정 입구가 차감 전에 확정(직접발송도 같은 결함 · [BUGS B-0929-3](../status/BUGS.md)) · **2R(high 2 · 같은 뿌리 = 공유 준비분을 확정 전에 지움)** → 사본 확정 · **3R(high 1 · 2R 과 같은 부류 = 사본이 캠페인 id 와 409 판정 id 를 갈랐다)** → 사본을 없애고 식별자 = 원본 하나 · 뺄 행은 원본에서 정해지는 보관 칸으로 옮겼다 되돌린다(마무리 = 되돌리기 → 남은 칸 지우기) · 이미 접수된 준비분 재확정 = 409 ②보관 행 ↔ 고객을 phone 이 아닌 번호 칸으로 이으면 같은 값의 남의 고객이 붙는다 → 보관 추출·입구 넷 = phone 전용(`buildKeptSelect` · 회사 안 유일).
**Codex 적대 4R(high 1 · medium 1 · 수용)**: 보관 칸 id 가 누구나 계산하는 해시라 발송 준비 입구(호출자가 id 를 정할 수 있음)로 그 칸에 다른 명단을 넣어 둘 수 있었다 → 칸 id = 서버 비밀키 HMAC(`staging-park:` + JWT_SECRET · 응답·로그에 싣지 않음) · 입력 = 잠금 키와 같은 uuid 정규화(표기가 달라도 같은 칸). **Codex 5R = critical·high 0 → 종결**(Harold 0929 「닫힐 때까지」 · 5라운드).
**medium 등재(종결 조건 밖 · 착수 안 함)**: 보관 칸으로 옮긴 직후 프로세스가 끊기고 **그사이 JWT_SECRET 을 교체**한 뒤 설정을 바꿔 재시도하면 옛 칸의 행이 되돌려지지 않는다(옛 칸 = 캠페인이 가리키지 않아 24시간 정리 대상 · 원본의 남은 행만 접수된다). 두 사건이 겹쳐야 생긴다. 키 교체 절차를 만들 때 「교체 전 23시간 안 준비분은 옛 키 칸도 되돌린다」를 함께 넣는다.
**검증(최종)**: backend tsc 0 · frontend tsc 0 · vitest 503파일 6,858건 · 직접발송 창 옛/새 서버 렌더 HTML 4상태 동일 · 타겟 창 7상태 × 8폭 예상 밖 결함 0 · 모델명·native dialog 0.
**범위 밖 기록(착수 안 함)**: ⑤(Codex 2R) 워커의 회신번호 배정 판정은 DB user_type 을 읽는데 users 에 없는 super_admin 은 JWT 경로와 판정이 갈린다(direct-send-worker.ts 461) ①공용 발송 바 「광고 표기」 칸 글자·분할 칸 「N건 · M분마다」가 560 열에서 말줄임 — **운영 중인 직접발송 창과 같은 동작**(같은 CSS · 실측 동일) ②820~1099 폭에서 오른쪽 수신자 칸이 좁다(직접발송도 같음) ③알림톡·브랜드메시지 창 보관본화(지금은 넘길 때 전체 행을 받는다) ④타겟 창 알림톡 채널 분기는 진입 없음(D162-4) — 손대지 않음.

---

## 3. R118 — DM 타겟 발송을 요청 안에서 한 번에 처리한다

**지금**
- `POST /api/dm/:id/send-to-target`(routes/dm.ts)가 대상 고객 전체를 Node로 가져와 수신자 토큰을 만들고 한 문장 UNNEST로 적재한 뒤 응답한다(요청 동기).
- 대상이 크면 요청이 길어지고(타임아웃·재시도 = 중복 위험), 그동안 같은 프로세스의 다른 요청이 느려진다.

**설계안(추천 = 직접발송과 같은 백그라운드 적재)**
- 요청은 검증·차감·캠페인 생성까지만 하고 `send_phase='queued'`로 둔다. 토큰 발급·적재는 적재 워커가 청크 단위로 한다(m122 A안의 차례 돌리기에 그대로 올라탄다).
- 화면은 직접발송과 같은 진행률 표시(적재 N/M)를 쓴다.
- 토큰 발급 멱등(청크 재실행 시 같은 고객 토큰 중복 0) · 차감·환불은 기존 staging 경로의 적재 수 정산을 그대로 쓴다.

**순서 제안**: m122(A) → R118(그 워커 재사용) → R112(화면 개편 · 목업 먼저).
