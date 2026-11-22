# C160 가 묶음 ② — 문안의 `%변수%` 가 발송까지 가는 흐름 표 + 결함 장부

> 접수 = 2026-11-22 Harold 「다음 과제들은 안할건가?」 → 「추천대로 시작」(설계서들의 「범위 밖 · 기록만」에 적어 둔 결함 후보 열 가지 = 가 묶음).
> 순서 = `status/DEFECT-PLAYBOOK.md` §1 · 이 문서 = 1단계 흐름 표 + 2단계 결함 장부 · **Harold 확인 전 설계 · 코드 0**.
> 대조 판 = 서버 배포본 c265eea3(1122 16:23 배포 · 이 문서가 읽은 파일은 그 뒤 바뀌지 않았다 = 작업 트리 = 배포본).

## §0 가 묶음 열 가지 판정(서버 실측 + 소스 · 1122)

| # | 후보(적혀 있던 곳) | 판정 | 근거 |
|---|---|---|---|
| ① | 손 등록 고객 번호를 숫자만으로 바꾸지 않음(C157 §8-6 ②) | 지금 피해 0 · 구멍만 | 서버 전수 `phone ~ '[^0-9]'` = 0행 · 화면 호출 0(`api/client.ts` 78 · 79 정의만) · `routes/customers.ts` 571 · 674 가 번호를 그대로 CT 에 넘김 |
| ② | 변수 매핑을 확정과 일꾼이 각각 다시 읽음(C157 §8-6 ③) | **결함(발송)** · 이 문서 | 아래 §1 ~ §3 |
| ③ | AI 한줄로 나눠 보내기 적재 관문(C157 §8-6 ①) | 결함 아님 | `AiLinePage.tsx` 에 split 글자 0곳 = 그 화면에 나눠 보내기 값이 없다 |
| ④ | 기존 퍼널 화면의 구매 수(C152 §8-6) | 결함(값 불일치) | `routes/cdp.ts` 2329 `buildCdpFunnel(companyId, days)` = 구매 · 주문 사건 전부 · `services/ask-answer.ts` 203 = `netPurchase: true` |
| ⑤ | 「보고 안 산 고객」 번호 접기(C152 §8-7) | 지금 일어날 길 없음 | 전제 = 같은 번호의 고객 행 여럿 · 유니크 키 `customers_company_id_phone_key`(SCHEMA 544) + ① 실측 0행 · 국가번호 꼴(82…)은 안 봄 |
| ⑥ | 유입 경로 첫 줄 고르기(C156 §8-6) | 잠재(미실측) | `utils/inflow-channel.ts` 73 `array_agg(… ORDER BY p.occurred_at)` = 같은 시각이면 순서 미정 |
| ⑦ | 문안 탓이 아닌 접수 거절 안내(C159 §7) | 고객 글은 맞음 | `sms-result-map.ts` 233 사유 표에 9401 · 9402 · 9407 만 = 나머지는 문안 탓이 아님 · 운영자에게 코드가 보이는지는 미확인 |
| ⑧ | 여정 칸 검사 창 「검사 전」(C159 §7) | 결함(화면) | C159 설계서 §7 |
| ⑨ | 제안 체험 반려 사유(C159 §7) | 결함 아님(직원 화면 기능 추가) | C159 설계서 §7 |
| ⑩ | 발신 인증 창 초점 가두기(C153 §8-9) | 결함(공용 부품) | `components/SenderAuthModal.tsx` 에 초점 가두기 · inert · aria-modal 0곳 |

순서 = ② → ④ → ⑧ → ⑩ → ① · ⑥ · ⑦ = 실측 · 확인 뒤 판정 · ③ · ⑤ · ⑨ = 뺌.

## §1 ② 흐름 표 — 문안의 `%변수%` 가 받는 분께 가기까지

뿌리(대장 R50) = **없는 변수가 발송 때 조용히 빈칸이 된다.** 11-02 여정에서 닫았고(`journeyCopyIssue`) 다른 발송 길에는 퍼지지 않았다.

| 단계 | 하는 일 | 쓰는 쪽 | 읽는 쪽 · 판정 자리 | 지금 판정 |
|---|---|---|---|---|
| F1 문안 쓰기 | 담당자가 `%이름%` 꼴을 적거나 칼럼 단추로 넣는다 · AI 가 만든다 | 화면(직접발송 · AI 한줄로 · 한 줄로 묻기 · 캠페인 · 자동발송 · 여정 · 대행) | AI 출구 `utils/copy-exit-guards.ts` 203 ~ 216(AI 가 만든 없는 변수는 지움) | 사람이 손으로 적은 이름은 어디서도 대조하지 않는다 |
| F2 미리보기 | 화면이 표본 고객 값으로 채워 보여 준다 | - | 프론트 미러 `utils/formatDate.ts` 13 `cleanLeftoverVars`(472 · 661 · 788) | 없는 변수 = 미리보기에서도 빈칸 · **안내 0** |
| F3 확정 · 저장 길목 | 문안을 발송 · 예약 · 저장으로 넘긴다 | 아래 일곱 길 | `findUneditedSendPlaceholder`(링크 · 혜택 자리만) | **변수 이름 판정 없음**(여정만 있음) |
| F3-a | 캠페인 생성 | `routes/campaigns.ts` 627 | 위와 같음 | 판정 없음 |
| F3-b | 직접발송 확정(옛 동기 길 = AI 한줄로 승인 발송) | `routes/campaigns.ts` 2433 | 위와 같음 | 판정 없음 |
| F3-c | 예약 문안 수정 | `routes/campaigns.ts` 4102 | 위와 같음 | 판정 없음 |
| F3-d | 브랜드메시지 | `routes/campaigns.ts` 4512 | 위와 같음 | 판정 없음 |
| F3-e | 공용 발송 길(직접 · 자동마케팅 · DM 알림 · 대행) | `utils/direct-send-core.ts` 301 | 위와 같음 | 판정 없음 |
| F3-f | 자동발송 | 저장 `routes/auto-campaigns.ts`(판정 0곳) · 실행 `utils/auto-campaign-worker.ts` 897 | 위와 같음(실행 때만) | 판정 없음 |
| F3-g | AI 한줄로 카드 | `routes/ai-line.ts` 411(`hole`) | 위와 같음 | 판정 없음 |
| F3-h | 한 줄로 묻기 적재 | `routes/ai-line.ts` 447 `sendBodyVars(…).needsCustomer` | 채울 고객 행이 없는 분을 뺀다(D12) | 이름이 매핑에 없는 변수는 보지 않는다 |
| F3-i | 여정(켜기 · 칸 저장 · 보내기 전 검사 · 실행기) | `utils/send-placeholder-gate.ts` 69 `journeyCopyIssue` | 104 `unknownVarNames` → `UNKNOWN_VARIABLE` | **판정 있음**(보류 + 담당자 안내) |
| F3-j | 대행발송 | `utils/agency-send-vars.ts` 35 · 106 | 변수를 명단 열에 배정 · 못 맞춘 값 = `badOverrides` | 자기 판정 있음(명단 열 기준 · 이 표의 매핑과 다른 체계) |
| F4 칼럼 정의가 바뀜 | 그 회사의 칼럼 이름 목록이 달라진다 | CT-07 `utils/standard-field-map.ts` 334 `upsertCustomFieldDefinitions`(`ON CONFLICT … field_label = EXCLUDED.field_label`) ← `routes/upload.ts` 896(업로드 확정 · 덮어쓰기 선택) · `routes/sync.ts` 991 · 1623(싱크 정의) · 지움 = `routes/customers.ts` 1566 · 1568(고객 전체 삭제 = 정의 삭제 + 회사 설정 초기화) · `routes/companies.ts` 2409(설정 갱신) | F5 가 발송 순간에 다시 읽는다 | 예약 · 저장된 문안에 옛 이름이 있어도 **알림 · 막음 0** · `is_hidden` 을 참으로 쓰는 코드는 없다 |
| F5 발송 시점 치환 | 매핑을 그 순간 읽어 채운다 | `utils/messageUtils.ts` 682 `prepareFieldMappings`(회사 설정 + 정의) | `replaceVariables` 201 ~ 327: 0단계 주소록 칸(234 ~ 255) → Liquid → 2단계 매핑 이름마다(301 ~ 322) → 3단계 `cleanLeftoverVars`(325 · 161) | 매핑에 없는 조각 = **빈 글자로 지움** · 기록 0 |
| F5 호출 자리 | 치환 함수를 부르는 곳(기계 추출 34곳 · §4 패턴) | `routes/campaigns.ts` 409 · 465 · 1202 · 2973 · 3037 · 3295 · 3306 · 3329 · 4225 · `routes/spam-filter.ts` 142 · 188 · `services/ai-line-spam.ts` 107 · `utils/agency-send-preview.ts` 53 · 111 · `utils/auto-campaign-worker.ts` 1101 · 1123 · 1152 · 1178 · `utils/copy-exit-guards.ts` 198 · 215 · `utils/direct-send-processor.ts` 154 · 196 · 297 · 310 · 342 · `utils/dm/dm-alert-msg-type.ts` 8 · 37 · `utils/dm/dm-variable-resolver.ts` 110 · 149 · `utils/journey-executor.ts` 15 · `utils/journey-message-render.ts` 150 · `utils/spam-test-queue.ts` 638 · 714 · 1152 | 전부 같은 3단계를 지난다 | 같음 |
| F6 조각 판정 | 무엇을 변수 조각으로 보나 | - | `utils/var-tokens.ts` 29 `/%([가-힣A-Za-z_][^%\s]{0,19})%/g` · 숫자 바로 뒤 % 는 퍼센트(34) · 프론트 미러 `utils/formatDate.ts` 34 | §2 값 범위 표 |
| F7 받는 분 | 문자를 받는다 | 큐 적재(`bulkInsertSmsQueue`) | - | 빈칸 · 깨진 링크가 그대로 간다 |

## §2 판정 자리의 두 축

### (가) 값 범위 — F5 · F6 에 들어올 수 있는 글자마다

| 본문에 든 것 | 지금 나가는 글 | 판정 |
|---|---|---|
| 주소록 칸 이름(`%기타1%` ~ `%기타3%` · `%회신번호%` · `%이름%` · `%고객명%` · `%성함%`) | 올린 줄의 값 | 정상 |
| 매핑에 있는 이름(기본 칼럼 표시 이름 · 별칭 · 그 회사 커스텀 칼럼 이름) + 고객 행 있음 | 그 고객의 값 | 정상 |
| 매핑에 있는 이름 + 고객 행 없음(직접 넣은 번호) | 빈 글자 | 정한 동작(직접발송 = 고객 원장에 없는 번호 허용) · 한 줄로 묻기만 D12 로 뺀다 |
| **매핑에 없는 한글 · 영문 이름**(오타 · 지어낸 이름 · 뒤에 이름이 바뀐 칼럼) | **빈 글자** | **결함 D1** — 서버 실례 = 캠페인 a409c2d4(1102 17:58 · 직접발송 · 1,002통) 「보유 마일리지 %금액%원」 · 「금액」 = 기본 칼럼 · 회사 설정 · 지금 커스텀 칼럼 어디에도 없음(그때 있었는지 = 미검증 · 실제 나간 글 = MySQL 이력 표) |
| **주소 안의 인코딩 글자**(`…/%EC%9D%B4%EB%A6%84-15g…`) | **조각이 지워져 깨진 주소**(`…/9DEB84-15g…`) | **결함 D2** — 로컬 실행 확인(1122 · `findVarTokens` = EC · B4 · A6) · 서버 흔적 = 지난 30일 2개 회사 · 1통짜리 발송들(EC · EB · BD · `B1-15g-x-30` 등) |
| 숫자 바로 뒤 %(`30%+5%` · `~44%↓`) | 원문 그대로 | 정상(R269) |
| 공백이 든 이름(`%고객 이름%`) | 원문 글자 그대로 | 조각이 아니다 = 고객이 `%고객 이름%` 글자를 받는다 · 매핑 이름에 공백이 있으면 2단계가 채운다(글자 대조) |
| Liquid(`{{ … }}`) | 렌더 · 남은 태그는 지움 | 이 표 밖(자기 판정) |
| 매핑에 있는 이름 + 값이 빈 고객 | 빈 글자(대체값이 있으면 그 값) | 정한 동작 |

### (나) 그 값을 그리는 화면

| 화면 | 없는 변수가 든 문안에서 보이는 것 | 판정 |
|---|---|---|
| 직접발송 · AI 한줄로 · 캠페인 미리보기 | 빈칸(프론트 `cleanLeftoverVars`) · 안내 글 0 | 미리보기 = 발송은 맞다 · 담당자가 「비었다」를 알 길이 미리보기를 눈으로 보는 것뿐 |
| 여정 칸 · 켜기 | 「고객 정보에 없는 변수(%…%)는 보낼 때 빈칸이 돼요. 있는 항목으로 바꾸거나 지워 주세요.」 | 정상(R50 의 문장) |
| 예약 내역의 문안 | 저장된 원문(조각 그대로) | 칼럼 이름이 바뀐 뒤에도 원문만 보인다 |
| 발송 결과 화면 | 저장된 원문 | 실제 나간 글(빈칸)과 다르다 |

## §3 결함 장부

| # | 결함 | 사슬 | 고객이 겪는 일 |
|---|---|---|---|
| D1 | 없는 변수를 확정 · 저장 길목이 판정하지 않는다(여정 제외 여덟 길 = F3-a ~ F3-h) | F1 손으로 적은 이름 → F3 판정 없음 → F5 3단계가 지움 | 받는 분 문자에 값 자리가 빈 채로 나간다(「보유 마일리지 원」) · 담당자는 모른다 |
| D2 | 조각 판정이 주소 안의 인코딩 글자를 변수로 읽는다 | F6 식이 `%EC%` 를 조각으로 봄 → F5 3단계가 지움 | 본문에 붙인 한글 주소 링크가 깨져 나간다 |
| D3 | 칼럼 이름이 바뀌어도 그 이름을 쓰는 예약 · 저장 문안을 알리지 않는다 | F4 덮어쓰기 · 싱크 정의 · 전체 삭제 → F5 가 발송 순간의 목록으로 읽음 | 예약해 둔 문자 · 자동발송 · 저장 문안이 그 뒤부터 빈칸으로 나간다 |

실측(1122 · 서버): 지난 30일 발송 5,184건 중 칼럼 조각이 든 것 398건 · 한글 조각은 「금액」 1건을 빼고 전부 주소록 칸 · 기본 칼럼 이름 · 지금 예약 31건에 조각이 든 것 0건.

## §4 뽑은 패턴(다시 뽑을 때 그대로)

- 치환 호출 자리: `grep -rnE "\b(replaceVariables|prepareSendMessage|bulkReplaceVariables|cleanLeftoverVars)\(" packages/backend/src --include=*.ts`(시험 · messageUtils 제외) = 34곳
- 길목 판정: `grep -rnE "journeyCopyIssue\(|unknownVarNames\(|findUneditedSendPlaceholder\(" packages/backend/src`
- 매핑 읽기: `grep -rn "prepareFieldMappings(" packages/backend/src` = 20곳
- 정의 쓰기: `grep -rnE "upsertCustomFieldDefinitions\(|customer_field_definitions" packages/backend/src` · 회사 설정 쓰기 `grep -rnE "SET[^;]*customer_schema" packages/backend/src`
- 화면 미러: `grep -rnE "findVarTokens|cleanLeftoverVars" packages/frontend/src`
- 서버 실측 문장 넷 = 1122 대화(고객 번호 꼴 · 예약분 조각 · 거르는 식 확인 · 지난 30일 조각 · 「금액」 한 건)

## §5 Harold 확인(이 칸이 차기 전 설계 0)

- [x] 흐름 표(F1 ~ F7)에 빠진 길이 없다 · 날짜: 2026-11-22(Harold 「빠진 길 없음」)
