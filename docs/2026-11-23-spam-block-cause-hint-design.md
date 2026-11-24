# 스팸 검사 「막힌 부분 짚어 보기」 확정 설계서 (2026-11-23 · C안 확정 · 구현 전)

> **상태 = C안 확정**(Harold 1123 「C 안으로 확정하고 설계안을 써」) · **Codex 설계 리뷰 9라운드 approve(1123 17:24 · §15)**. 구현 · DDL · 배포는 별도 단계(Harold 착수 지시 뒤 · 구현 Codex 포함).
> 접수 = Harold 「번외 아이디어 — 스팸필터 테스트를 보게 하고, 걸리는 문안이 있으면 어떤 부분이 걸리는 것 같은지 체킹하는 기능이 개발 가능할까?」 · 「메일 대행발송에 어떻게 녹이면 좋을까랑, 직접발송에 있는 스팸필터테스트에 어떻게 녹여줄까」(2026-11-23).
> 계기 = 폴라초이스 대행발송(요청 a7456c31 · MMS 12,892명 · 11-24 11:00 예약) — 검사 6판 모두 KT 에서만 막힘(LG U+ · SKT 도착) · AI 다듬기가 돌았는데도 계속 막힘 · 담당자에게 「문안이 세 차례 스팸 검사에 걸렸습니다」 문자 두 번(§3).
> **범위 = 직접발송 스팸 검사 창 + 대행발송(화면 접수 · 메일 접수).** 자동발송 · 자동마케팅 · 플래너 · 여정 · AI 한줄로 칩은 §14(같은 CT 를 부르기만 하면 되게 만든다).

---

## §0 확정 요약

- **통신사는 막은 이유를 주지 않는다.** 그래서 두 단계로 좁힌다. **A** = 기록으로 의심 부분 고르기(보내기 0 · 돈 0 · 읽을 때 계산 · 저장 0). **B** = 의심 부분을 뺀 글(「확인 판」)을 **막힌 통신사 단말에만** 보내 본다(통신사마다 최대 2판 · 고객 무료).
- **확인 판은 고객 발신번호로 나가는 발송이다**(★Codex 설계 1R 뿌리). 그래서 발송 경로의 장치를 다 갖는다 — 막힌 일반 검사만 부모 · 상한(등록을 직렬화해 센다) · 운영 스위치(기본 꺼짐) · 되돌리기 하한(§12) · 그리고 **확인 판 문자를 실제로 적재하는 가장 낮은 두 함수(`executeSpamTest` 적재 · `sendProbe`) 안에 발송 관문 하나**(스위치 · 진단이 열려 있음 · 엄격한 발신번호 권한 · ★3R 구조) + 진단을 끝낼 때 판의 상태를 닫는 CT 하나(`closeDiagnosis`).
- **A**(§5): 후보 = 고객이 쓴 원문에 있는 조각만(변수 값 · 개인정보는 후보 · 표시 0). 순서 = 닮은 지난 통과 글에 없던 조각 → 글 속 주소 → 우리 차단정보 규칙. 같은 글의 고친 판이 막혔던 조각은 **뒤로 미룬다**(지우지 않는다). 「빼도 막힘」은 **이 검사의 확인 판으로 확인된 것만**.
- **B**(§6): 통신사마다 판 ① = **글 속 주소만** 뺀 글 → 그 통신사에서 「빼도 막힘」이 확정되면 판 ② = 표시한 줄(후보가 든 줄)을 뺀 글. 법정 표기는 안 뺀다. 판정 = 그 통신사의 확정 결과만.
- **대행 루프**(§7): 루프 안에서 기다리지 않는다. 문안 버전의 첫 막힘(그 글 = T)에 판을 걸고 **기존 보류와 같은 꼴로 접수를 되돌려 둔다**(다듬지 않음). 다음 주기에 **T 의 판 결과로 T 에 대해** 정한다(★2R 구조 = 증거와 판정은 같은 글) — 막힌 통신사 전부 판 ① 도착 = **4a** 남은 회차 없이 사람에게 「주소를 바꿔 주세요」 · 판 ② 도착 = **4b** AI 에게 그 줄의 표현을 바꾸라고 알려 다듬기 · 그 밖 = **4c** 지금 그대로. 발송 시각까지 2시간 안 남았으면 판 없이 A 만.
- **보이는 곳**(§8): 직접발송 = 검사 창 카드 · [빼고 다시 확인] 단추 · [전송하기] 직전 경고 · 지난 검사 줄. 대행 = 진행 기록 · 담당자 문자 · **메일 접수 건은 보낸 주소로 검사 결과 회신 메일**(상태에서 다시 찾아내는 재시도 패스).
- **저장**(§9): 확인 판 = 기존 검사 표 행(새 출처 값 `spam_diag`) + 새 칸 `diag_of` + 유일 부분 인덱스. 수신 보고 귀속 · 확인 문자 · 늦은 보고 규칙은 그대로 탄다.
- **미가입 · 직접발송만 쓰는 회사 = 동작 변화 0**(§10-2).

---

## §1 접수 대조표 (이 축이 없으면 접수가 닫히는가)

| 접수 항목(원문) | 맡는 축 | 없으면 |
|---|---|---|
| 「스팸필터 테스트를 보게 하고」 | 통신사별 결과를 화면 · 진행 기록 · 담당자 문자 · 회신 메일에(§8) | 대행발송은 지금 「스팸 검사에 걸렸습니다」만 보인다(`AgencyEventLog.tsx:20` · 통신사는 사건 payload 에만 `agency-send-worker.ts:469`) |
| 「걸리는 문안이 있으면 어떤 부분이 걸리는 것 같은지」 | A(§5) + B(§6) | 안 닫힘 |
| 「메일 대행발송에 어떻게 녹이면」 | §7 루프 + §8-2 M1 ~ M4 | 메일 고객은 화면을 안 쓰는데 안내가 「로그인하여 고쳐 주세요」뿐 |
| 「직접발송에 있는 스팸필터테스트에 어떻게 녹여줄까」 | §8-1 D1 ~ D5 | 막혀도 창 닫기뿐(`pages/Dashboard.tsx:2337-2346` 에 `onEdit` 없음) |
| 「개발 가능할까?」 | 한계를 고객 문구에 정직하게(§8-3) | 「통신사 이유를 안다」로 읽히면 거짓 문구 |

빠진 축 0.

---

## §2 지금 구조 (코드에서 읽은 사실)

| 무엇 | 사실 | 자리 |
|---|---|---|
| 검사 방식 | 통신사별 시험 단말 3대로 실제 발송 · 앱 수신 보고로 판정 | `docs/FEATURE-SPAM-CHECK.md` §0 |
| 차단 확정 | 「통신사 전달 성공 + 보고 없음」= 확인 중 → **같은 발신번호**로 무해한 확인 문자(SMS) → 그것이 도착하면 원래 행 `blocked` · 확인 문자 = 닫힌 뒤 일정 시간(자동 1분 · 사람 10분) 뒤 · 응답 5분 | `spam-probe.ts:21-26` · `:41` · `:99` · `:137-140` |
| 따라서 | 차단 확정 = 같은 번호의 무해한 SMS 는 그 단말에 도착한다는 뜻(번호 통째 차단 아님 · LMS 도 그런지는 미검증) · **막힘은 늘 몇 분 뒤에 확정된다** | 위와 같음 |
| 대기열 | 전체에서 동시에 1건(`status = 'active'` 하나) · 회사 돌아가며 | `spam-test-queue.ts:1056-1075` |
| 결과 행 = 보낼 단말 | 등록 때 활성 단말마다 결과 행을 만들고(`:694-695` · `:798-807`) 워커는 결과 행마다 보낸다(`:1140-1147`) → **단말을 고르면 그 통신사로만 나간다** | `spam-test-queue.ts` |
| 치환 | 렌더 안 된 검사는 원문 + 표본 고객을 저장하고 **보낼 때** 회사 매핑을 다시 읽어 치환한다(`:783-794` · `:1118-1138`) · 렌더 끝난 검사(대행 · 여정)는 저장 글 그대로 | `spam-test-queue.ts` |
| 사람 검사 발신번호 권한 | `manualAdmission` 이 있을 때만 `isManualSpamCallbackAllowed` 확인 | `spam-test-queue.ts:688-690` |
| 출처 값 | `manual` · `trial` · `auto_ai` · `auto_ai_free` · 청구 제외 = `trial` · `auto_ai_free` · 자동 목록 = `auto_ai` · `auto_ai_free`(함수판 · SQL판이 같은 목록) | `spam-trial.ts:20-55` |
| 같은 검사 이어 보기 | 같은 회사 · 번호 · 해시 · 제목 · 종류 · 같은 한국 날짜면 그 검사를 돌려준다 | `spam-test-queue.ts:520` `spamCheckFor` |
| MMS | MMS 접수도 LMS 로 검사 · 그림은 검사에 안 들어간다 | `spam-test-queue.ts:620` · `:643` · `:703` |
| 접수 거절 | 9401 · 9402 · 9407 은 이미 「검사 문자를 보내지 못했어요: 사유」(C158 · C159) | `spam-test-queue.ts:920` |
| 우리 차단정보 규칙 | 순수 판정 `evaluateContent`(규칙의 요소가 **전부** 맞아야 걸림) | `spam-block.ts:211` |
| 대행 루프 | 막힘 → AI 다듬기 → 다시 검사(최대 3회) · AI 입력 = 회사 · 원문 · 회차뿐 · 확인 중이면 보류(다음 주기에 이어 봄) · 워커 A 는 접수를 차례로 처리 | `agency-send-worker.ts:431-496` · `:939-945` · `agency-send-state.ts:526` · `agency-send-refine.ts:152` |
| AI 다듬기가 못 바꾸는 것 | 날짜 · 시각 · 금액 · 전화번호 · 주소 · 매장 이름(프롬프트) · 주소 · 번호 · 날짜 · 시각 · 변수를 잃으면 버림(`extractAnchors`) | `agency-send-refine.ts:47` · `:68-78` · `:101` |
| 막힘 안내 | 담당자 번호로 문자만(「세 차례 … 로그인하여 문안을 고쳐 주세요」) · 메일 워커에는 검사 결과 회신 없음 | `agency-send-worker.ts:959-966` · `agency-send-notify.ts:196-202` |
| 메일 접수 | `agency_send_requests.source = 'email'` · 원장 `agency_send_email_intake`(`from_email` · `request_ids` · `message_id`) · 회신 = `sendAgencyReplyMail` + 상한 게이트 `replyAllowed` · **재시도 = 상태에서 다시 찾아내는 패스**(`retryPendingReplies` · 24시간 창 · 시도 상한) | `agency-send-mail-worker.ts:620` · `:1298-1310` · SCHEMA 3513 |
| 담당자 링크 토큰 | 승인 한 가지 전용 | `agency-send-link.ts` 머리 |
| 직접발송 | 작성 화면 훅이 검사 창을 열고(`direct-send/useSendPrecheck.tsx:330`) 대시보드가 그린다 · [전송하기] 직전 경고가 `recent-check` 판정(`blockedCarriers`)을 읽는다(`useSendPrecheck.tsx:283-290` · `utils/send-checks.ts:155-174`) | |

---

## §3 실측 근거 (Harold 실행 · 1123)

| SQL | 결과 | 설계에 정한 것 |
|---|---|---|
| 1 기간 · 통신사 × 판정 | 11-01 뒤 확정 차단 KT 7(회사 2) · LG U+ 30(회사 4) · SKT 4(회사 1) / 통과 통신사마다 약 500(회사 18) · 11-01 전 차단(KT 204 등)은 옛 45초 판정 | 통계 낱말 뺌 · 11-01 전 차단은 재료로 안 씀 · B 비용 작음 |
| 3 견줄 지난 글 | 차단 41행 전부 본문 보존 · 39행에 같은 회사 · 번호 · 통신사의 90일 안 통과 글 | A ① 의 재료는 거의 늘 있다 |
| 5 폴라초이스 7개 글 | 6판 모두 `KT=blocked LGU=pass SKT=pass` · 발신번호 16616656 · 6판 동안 바뀐 것 = 첫 줄 문장 · 「기다림 끝, …」 줄 · 소제목 · 「SIZE UP」→「사이즈업」 · 그대로 = 주소 2개(tinyurl) · ■ 혜택 줄 5개 · 「블랙 프라이데이」 · (광고) · 080 · 지난 KT 통과 글(11-16)은 광고 아닌 감사 인사 | 고친 판이 막힌 조각은 뒤로 · A ① 은 닮은 글일 때만 · 판 ① = 주소 · 이 건 원인 = 미검증 |

---

## §4 흐름 표 — 이음매 · 판정 자리 · 값 범위 · 그리는 화면

| # | 이음매 | 판정 자리(새 · 바뀜) | 값 범위 | 그리는 화면 |
|---|---|---|---|---|
| F1 | 차단 확정 | `spam-probe.ts`(무변경) | 결과 행 `result` ∈ pass · unconfirmed · blocked · failed · timeout · error · NULL — **힌트는 `blocked` 인 통신사만** | — |
| F2 | 의심 부분 계산(A) | 새 CT `utils/spam-block-hint.ts` `buildSpamBlockHints(testId)` → 순수 핵심 `rankSuspects()` | 막힌 통신사 1 ~ 3 · 통신사마다 후보 0 ~ N · 뒤로 민 조각 0 ~ N · 지난 글 = 닮음 · 안 닮음 · 없음 | F8 |
| F3 | 확인 판 자격 | 같은 CT `diagEligibility()` | 가능 · 불가 사유(스위치 꺼짐 · 부모가 확인 판 · 그 통신사가 지금 blocked 아님 · 보낸 글 복원 불가 · 권한 없음 · 상한) | D2 단추 숨김 · 사유 |
| F4 | 확인 판 만들기 | 같은 CT `makeDiagVariant(sentText, variant, suspects)`(순수) | 판 ① = 주소 조각만 뺌 · 판 ② = 표시한 줄을 뺌 · 없음(뺄 것 0 · 남는 것이 법정 줄뿐) | — |
| F5 | 확인 판 보내기 | `enqueueSpamTest` 새 인자 `carriers` · `diagOf` · 출처 `spam_diag` | 통신사 하나 · 차감 0 · `(diag_of, variant_id)` 하나 · `variant_id` = 통신사 머리 글자 + 판 번호(`K1` · `K2` · `L1` · `L2` · `S1` · `S2`) | 대기열 앞사람 수(`spam-test-view.ts:37` 그대로) |
| F6 | 확인 판 판정 | 지금 판정 그대로(보고 귀속 · 확인 문자 · 늦은 보고) + 적재하는 두 함수 안의 발송 관문 `diagSendGate`(§6-2-1) + 진단 닫기 `closeDiagnosis`(§6-2-2) | 판 상태 = 대기 · 도착(pass) · 빼도 막힘(blocked) · 확인 중(NULL · unconfirmed) · 확인 못 함(failed · timeout · error · 만료) — **조치는 확정 상태(도착 · 빼도 막힘)만 쓴다** | F8 |
| F7 | 대행 갈래 | `runSpamRound` 새 갈래 `classifyDiag()`(순수) + 진단 대기 보류(`last_test_result.diagHold`) | 대기 · 4a · 4b · 4c(§7) · 증거 = 그 글 T 의 판만 | 진행 기록 · 담당자 문자 · 회신 메일 |
| F8 | 읽기 · 요청 API | `GET /api/spam-filter/tests/:id` 응답에 `hints` · 새 `POST /api/spam-filter/tests/:id/diagnose` · `POST /recent-check` 응답에 `hintLine` | 회사 격리 · 사용자 범위 = 기존 `/tests/:id` 와 같은 판정 + 발송 권한은 §6-2 에서 따로 | D1 ~ D4 |
| F9 | 결과 메일 | 메일 워커 새 패스 `sendPendingSpamResultMails` | 보낼 것 = 상태에서 찾음 · 기록 = 성공 · 반려 · 불명 · 상한이면 기록 없이 다음 틱 | M3 |
| F10 | 문구 | 정본 문구 표 한 곳(`spam-block-hint.ts`) · 담당자 문자 = `agency-send-notify.ts` · 회신 메일 = 새 문구 함수 | §8-4 | 전부 |

---

## §5 A — 의심 부분 고르기 (보내기 0 · 저장 0)

### 5-1. 언제 · 무엇을

- 그 검사의 결과 행 중 `blocked` 인 통신사마다 따로 계산한다. 다른 판정에는 계산하지 않는다(확인 중 · 장애 · 접수 거절 · 글자 반려는 이미 자기 문장이 있다). 부모가 확인 판이면 계산하지 않는다.
- **보낸 글** = 그 검사가 실제로 보낸 글 — 렌더 끝난 검사(대행 · 여정)는 저장 글 · 렌더 안 된 검사는 저장 원문에 변수 칸(`%…%`)이 없을 때만 저장 원문(치환해도 같은 글) · 변수 칸이 있으면 「보낸 글 복원 불가」(A 는 원문으로만 · B 없음).
- **원문** = 고객이 쓴 글 — 직접발송 = 저장 원문 · 대행 = 그 문안 버전의 `current_content`. **후보 조각 = 보낸 글의 조각 중 원문에도 있는 조각만**(표본 고객의 이름 · 번호 같은 변수 값은 후보 · 표시에 안 나온다). 화면 · 문자 · 메일에 보이는 글 = 원문.
- **조각** = 주소(URL 정규식 · 통째) · 나머지는 공백으로 나눈 낱말(앞뒤 기호 `■ > [ ] ( ) , .` 등을 떼고 영문은 소문자). **법정 조각은 후보에서 뺀다** — `(광고)` · 「수신거부」가 든 줄의 조각 · 080 번호.
- ponytail: 낱말 단위라 「두 낱말이 함께 있어야 막힘」 같은 조합 차단은 A 가 못 가른다(B 가 「빼도 막힘」으로 받친다 · 4c).

### 5-2. 순서

| 단계 | 근거 | 재료(읽기) | 결과 |
|---|---|---|---|
| 확인됨 | 이 검사의 확인 판(`diag_of` = 이 검사 · 같은 통신사)이 **빼도 막힘으로 확정** | 확인 판 행 | 그 판이 뺀 조각 = 「빼도 막혔어요」 표시 · 다음 판 고르기에서 뺀다(사실로 확인됨) |
| ① 닮은 지난 통과 글 | 같은 번호 · 같은 통신사로 도착한 닮은 글에 없던 조각 | 같은 회사 · 번호 · 통신사 · **같은 종류 · 같은 제목**의 90일 안 `pass` 일반 검사(확인 판 제외) 중 광고 표기 유무가 같고 조각 겹침(자카드)이 가장 큰 글 하나 · 문턱 미만이면 「견줄 만한 지난 글이 없어요」 | 그 글에 없던 조각 = 앞으로 · 있던 조각 = 뒤로 |
| 주소 | 고객이 바꿀 수 있고 AI 는 못 바꾸는 조각 | 보낸 글 | 남은 후보 중 주소 조각은 늘 맨 앞 |
| 우리 규칙 | 등록된 차단정보와 같은 조각 | `loadActiveRules()`(탐지 · 차단 전부) · `evaluateContent` 로 **규칙 전체가 맞은** 규칙만 · 그 규칙의 요소 조각 | 「등록된 차단정보와 같은 부분이에요」 |
| 고친 판 | 같은 글의 고친 판이 그 조각 없이도 막혔다 | 같은 회사 · 번호 · 통신사 · 같은 종류 · 같은 제목 · 같은 한국 날짜의 다른 `blocked` 일반 검사 중 겹침 문턱 이상 | **지우지 않고 뒤로 민다**(고친 판이 새로 넣은 다른 조각 때문에 막혔을 수 있다) · 「바꿔 봤는데도 막혔던 부분」 표시 |

- 문턱 = 구현 0단계에서 실제 차단 41행과 그 앞선 통과 글을 **한 번 뽑아 로컬에서** 맞춘다(시작값 0.5 · 서버 왕복 반복 금지).
- 화면에 보이는 것 = 후보 상위 3묶음(주소 · 지난 글에 없던 조각 · 규칙) + 뒤로 민 조각 한 줄 + 「그 밖 N곳」 수.

### 5-3. 출력(`hints` · 통신사마다)

```text
{ carrier, suspects: [{ token, kind: url | new_vs_passed | rule | other, line, demoted }], baseline: { at, similar } | null, diag: { eligible, reason, checks: [{ variant, removed, state }] } }
```

- 계산 = 검사 결과를 읽을 때마다(저장 0). 읽기 문장 3 ~ 4개 · `idx_spam_filter_tests_company (company_id, created_at DESC)` 범위 · 막힌 검사에서만 돈다.

---

## §6 B — 확인 판 (= 고객 발신번호로 나가는 발송)

### 6-1. 판 만들기(순수 · `makeDiagVariant` · 통신사마다)

| 판 | 무엇을 빼나 | 언제 | 없을 때 |
|---|---|---|---|
| ① | **보낸 글의 주소 조각만**(주소를 빼고 남는 줄이 기호뿐이면 그 줄째) | 그 통신사가 처음 막혔을 때 | 주소 0 → 판 ① 없음(② 가 첫 판) |
| ② | **표시한 줄** = 그 통신사 후보 중 「지난 글에 없던 조각」(없으면 「규칙」) 이 든 줄 · 둘 다 없으면 숫자가 든 줄(혜택 · 가격) · 주소 · 뒤로 민 조각만 든 줄 · 법정 줄 제외 | 그 통신사에서 판 ① 이 **빼도 막힘으로 확정**됐거나 **판 ① 이 없을 때(주소 0 = ② 가 첫 판)** — 이 규칙은 자격 함수 하나(`diagEligibility`)가 정하고 D2 단추 · 대행 등록이 같이 쓴다(★2R) | 고를 줄 0 → 판 ② 없음 |

- **법정 줄은 어느 판에서도 빼지 않는다** — 첫 줄의 `(광고)` 와 그 줄 · 「수신거부」가 든 줄. 남는 줄이 법정 줄뿐이면 판 없음.
- 판마다 **실제로 뺀 조각 · 줄과 대상 통신사 하나**를 고정한다(`variant_id` · 판 본문이 그 기록).

### 6-2. 등록 자격(`diagEligibility` · 하나라도 아니면 판 없음 · 사유 표시)

1. 운영 스위치 `SPAM_DIAG_SENDS=on`(프로세스 ENV · 기본 꺼짐 · 켜고 끄기 = 백엔드 재시작 · §6-2-1).
2. 부모 = 같은 회사의 **일반 검사**(`source <> 'spam_diag'` · `diag_of IS NULL`) · 닫힌 검사 · 그 통신사 결과 행이 **지금** `blocked`. 확인 판을 부모로 받지 않는다(재귀 0).
3. 보낸 글 복원 가능(§5-1).
4. 판 순서(§6-1) — 판 ① 은 주소가 있을 때 · 판 ② 는 판 ① 이 빼도 막힘 확정이거나 판 ① 이 없을 때.
5. **지금 발신번호 권한(엄격)** = `getRegisteredCallbackSet(회사, 등록 계정, { strict: true }).has(부모 발신번호)`(`utils/callback-filter.ts:250` · 사람 검사 입구 `isManualSpamCallbackAllowed`(`spam-test-queue.ts:479-481`)와 같은 함수). **새 인자 `strict`** = 배정 칸 확인 쿼리가 실패하면 회사 전체 목록으로 내려가지 않고 던진다(지금 `:261-276` 은 그 예외를 삼키고 배정 조건 없는 목록을 쓴다 · ★Codex 3R) · 기본값 = 지금 그대로(다른 호출처 무변경) · 던지면 판 0. **등록 계정** = 판 행의 `user_id` 로 고정 — 직접발송 = 단추를 누른 사용자 · 대행 = 접수 계정(`created_by`).
6. 상한(§6-3 에서 직렬화해 센다) — 부모 · 통신사마다 2판(유일 인덱스) · 발신번호(숫자만)마다 한국 날짜 하루 10판 · 전체 하루 100판(넘으면 그날 판 0 + 운영 경보 1회).

### 6-2-1. 발송 관문(`diagSendGate` · ★Codex 3R 구조)

> ★1124 구현 이름: 판정 · 스위치 · 잠금 키 · 엄격 권한 CT = `utils/spam-diag-gate.ts`(`judgeDiagTestSend` · `judgeDiagProbeSend` · `diagSendsOn` · `diagLockKey` · `DIAG_LOCK_SQL` · `diagCallbackAllowed` · `isDiagTest`) · 잠금 트랜잭션은 적재하는 쪽 파일에 = `spam-test-queue.ts sendDiagTestRow`(executeSpamTest 가 확인 판이면 부름) · `spam-probe.ts sendDiagProbe`(sendProbe 가 출처를 스스로 읽고 부름). 순환 import 0(관문 CT 는 두 파일을 import 하지 않는다).

- **왜 함수 안인가** — 1R · 2R · 3R 에 같은 부류(「관문이 빠진 발송 자리」)가 세 번 나왔다. 부르는 자리를 세어 관문을 붙이면 자리가 더 나온다(대기열 집기 · 확인 문자 첫 선점 · 다시 보내기). **확인 판의 문자는 두 함수로만 적재된다** — 검사 문자 = `executeSpamTest` 의 적재(`spam-test-queue.ts:1154` · 확인 판은 대기열 검사만 · 사람 검사 라우트의 직접 적재 `routes/spam-filter.ts:319` 를 타지 않는다) · 확인 문자 = `sendProbe`(`spam-probe.ts:98` · 첫 선점 `:193` · 다시 보내기 `:140` 모두 이 함수). 관문은 이 두 함수 안, 적재 직전에 둔다(2R 의 「집는 자리 · 선점 자리」 관문 둘은 지운다).
- **확인과 「보내기로 정함」을 한 잠금 아래에서**(★Codex 설계 4R 구조 — 확인한 뒤 행동까지의 틈에 진단이 닫히면 닫힌 뒤에 나간다): 두 함수는 확인 판일 때 PG 트랜잭션을 열고 **부모 진단 잠금** `pg_advisory_xact_lock(hashtext('spam_diag:' || 부모 id))` 을 잡은 뒤 → 영속 상태를 다시 읽어 관문을 보고 → 통과면 「보내기로 정함」을 확정(확인 문자 = `sent` · 기한 / 검사 문자 = 판 active · 결과 NULL 그대로 · 한 판의 실행기는 하나) → 커밋.
- ★1124 구현 정정(Codex 구현 2R 구조 · 1R H1 과 같은 부류 두 번째 = PG 잠금을 쥔 채 바깥 시스템을 기다림) — **MySQL 적재는 커밋 뒤 잠금 밖**에서 한다(옛 판 = 잠금을 쥔 채 적재 → MySQL 이 늦으면 행 잠금이 사람 검사의 멈춘 검사 정리까지 막았다). 불변을 이렇게 정확히 적는다: **닫기 뒤에 새로 관문을 통과하는 적재 = 0**(닫기와 같은 잠금) · 닫기 앞에 통과로 정해진 한 통은 닫기 뒤에 나갈 수 있다(그 결과는 판정에 쓰지 않는다 · §6-2-2). 적재가 실패하면 = 검사 문자는 판 active · 결과 NULL → 멈춘 검사 정리가 timeout · 확인 문자는 `sent` 인 채 기한이 지나 expired · 결과 error(둘 다 다시 보내지 않는다). ponytail: 부모마다 잠금 = 확인 판 문자에만 · 일반 검사 적재는 잠금 0.
- ★1124 구현 정정(Codex 구현 3R ~ 8R · 두 뿌리 · 덧대기를 멈추고 줄임):
  - **확인 문자 기한 = 관문 표시 한 번** — 관문 시각(gateAt) + 적재 상한 60초(`DIAG_PROBE_LOAD_WAIT_MS`) + 5분. 적재 = 공용 적재 CT(`insertTestSmsQueue`)에 **MySQL 절대 기한 gateAt + 60초**(`mysqlDeadline`)를 넘긴다 → 준비(PG 조회 · 판정)는 연결 밖 · INSERT 문장만 상한 있는 연결(`withBoundedMysql` · 같은 절대 기한으로 ① 들어올 때 ② 연결 받은 직후 ③ 문장 내기 직전 판정 · 지났으면 문장 0 + 깨끗한 연결은 돌려줌 · 낸 뒤 넘긴 문장만 그 연결 destroy). 그래서 멈춘 적재가 공용 발송 풀을 쌓아 막지 않고(9R ~ 15R) 다음 확인 문자는 새 연결로 시작한다. 늦게 끝난 적재 문자의 보고도 기한 안이면 받는다(단말이 이 번호의 문자를 받는다는 사실은 적재 시각과 무관) · 창이 줄어든 최악 = 기한 처리가 error(확인 못 함 · 오판 0). 기한을 두 번 쓰던 판(기한 빈 「적재 중」 · 적재 뒤 갱신 · 그 정리 · 상한 넘김 닫기 · 적재 수 셈)은 경계를 만들어 지웠다.
  - 구현 Codex(배포 1) = 1R ~ 16R · 16R approve(설계서 §15 표 밖 · 로그 = scratchpad codex-impl1-r*.txt · 지적 뿌리 = 잠금 아래 바깥 대기(1R · 2R) · 보고 귀속(3R ~ 8R → 되돌림) · 기한(4R ~ 8R → 한 번) · MySQL 상한 자리(9R ~ 15R → 공용 CT 제출 직전)).
  - **보고 귀속 = 종전 공용 규칙 그대로**(`resolveSpamReportTest` 무변경). 3R ~ 7R 에 「확인 판 ↔ 고객 검사 같은 글 겹침」을 귀속에서 가르려 했으나 보고에 발송 표지가 없어 시간 규칙은 재전송마다 틈이 남았고, 줄을 닫는 쪽은 공용 판정 상태(발송 실패 환불 · 확인 문자 확정)에 새 틈을 냈다(8R). 같은 글 · 같은 단말 겹침은 고객 검사끼리에도 있는 문서화된 규칙(`spam-test-queue.ts` 「가를 수 없는 경우 — 규칙으로 정해 둔다」)이고, 진행 중 같은 글 검사는 수동 입구의 중복 막기가 확인 판까지 센다(출처 무관). 남는 것 = 확인 판이 닫힌 뒤 늦게 닿은 그 문자가 같은 글의 새 고객 검사로 가는 경우(고객끼리와 같은 위험) → **추가 과제: 보고 귀속에 발송 표지(같은 글 겹침 전반)**.
- 관문(잠금 아래 · 확인 판 행 · 확인 판 결과 행일 때만) = **스위치 켜짐** · **진단이 열려 있음 = 영속 상태**(검사 문자 = 그 판이 `active` · 그 결과 행이 아직 `NULL` · 만든 지 15분 안 / 확인 문자 = 그 확인 문자 행이 아직 `claimed` · 결과 행이 아직 `unconfirmed` · 판을 만든 지 30분 안) · **엄격한 발신번호 권한**(§6-2 5 · 판 행 회사 · `user_id` · 발신번호).
- 순서(함수 안) = BEGIN → 부모 진단 잠금 → 그 판 결과 행(확인 문자면 확인 문자 행도) `FOR UPDATE` → **저장점** → 관문 → 적재 → 커밋.
- **관문 결과는 셋**(★Codex 6R): ⓐ **내 것이 아님** — 검사 문자 = 그 판이 이미 `active` 가 아니거나 결과 행이 이미 `NULL` 이 아님 · 확인 문자 = 그 확인 문자 행이 이미 `claimed` 가 아님(다른 호출이 먼저 보내고 `sent` 로 적었거나 닫혔다) → **아무것도 쓰지 않고 끝**(먼저 보낸 확인 문자의 기다림을 깨지 않는다) ⓑ **통과** → 적재 ⓒ **거부**(스위치 꺼짐 · 시간 상한 지남 · 권한 없음 · 확인 문자인데 결과가 이미 `unconfirmed` 가 아님 · 조회 실패 · 던짐) → 아래 닫기.
- 거부 닫기 = 같은 잠금 아래 · **아직 열린 값만**(★Codex 5R): 결과 행이 아직 `NULL`(검사 문자) · `unconfirmed`(확인 문자)일 때만 `error` · 이미 `pass` · `blocked` 로 정해졌으면 그 값을 둔다(도착 증거를 지우지 않는다) · 검사 문자면 검사 `completed` · 확인 문자면 그 확인 문자 행 `expired`. 화면 = 「확인을 마치지 못했어요」.
- 관문 조회가 SQL 오류를 내면 그 트랜잭션은 실패 상태라 → **저장점으로 되돌린 뒤** 닫기를 쓰고 커밋한다(★Codex 6R). 연결이 끊기면 닫기 없이 끝나고 지금의 길대로 간다(★Codex 7R · 두 길이 다르다): **검사 문자** = 판이 `active` 로 남았다가 멈춘 검사 정리(`cleanupStaleActiveTests` · `spam-test-queue.ts:973-997`)가 `NULL` 결과를 `timeout` 으로 쓰고 닫는다 → **다시 보내지 않는다** · 판 결과 = 「확인을 마치지 못했어요」(받아들인 결과 · 진단만 빠진다) / **확인 문자** = `claimed` 로 남아, **시도 여유가 있으면**(`attempts < PROBE_MAX_ATTEMPTS = 2`) 2분 뒤 다시 보내기(`spam-probe.ts:131-141` · 시도 수를 먼저 올린다)가 `sendProbe` 를 다시 불러 같은 관문을 다시 지난다 · **상한에 닿았으면** 지금 규칙대로 적재 없이 확인 문자 `expired` + 결과 `error` 로 닫힌다(`:143-146` · 지금 발송 상한 그대로 · ★Codex 8R).
- 검사의 결과 판정 쓰기(`SPAM_RESULT_DECIDE_SQL` = `… WHERE id = $2 AND received = false AND result IS NULL` · `sms-result-map.ts:644`)는 `NULL` 행만 쓰므로 닫힌(`error`) 행을 덮지 않는다. 15초 확인 고리 · 시간 제한은 적재 잠금 밖에서 그대로 돈다.
- 첫 선점 INSERT(`spam-probe.ts:182-188`)는 그대로 둔다 — 후보를 읽은 뒤 진단이 닫혀 `claimed` 가 늦게 생겨도, 그 확인 문자는 `sendProbe` 의 잠금 아래 관문에서 「결과가 이미 `unconfirmed` 가 아님」으로 거부 · `expired` 된다(적재 0). (5R 에 덧댔던 「조건부 첫 선점」은 6R 에 지웠다 — 되돌리기를 앱 정지 상태로만 하므로 필요 없어졌다 · §12 · §15.)
- 스위치 = 프로세스 ENV 라 **끄려면 백엔드 재시작이 필요하다**(★Codex 7R). 대기열 일꾼 · 확인 문자 일꾼은 백엔드 한 프로세스 안에서 돈다(`app.ts:653-654` · `ecosystem.config.js:26` · `:45-46` `instances: 1` · `fork`) → 재시작으로 옛 프로세스가 끝나면 그 안의 진행 중 적재도 끝나고, 새 프로세스부터 관문이 모든 확인 판 문자(대기 · 첫 선점 · 다시 보내기)를 막는다. 끄기 직전에 관문을 이미 지난 적재는 나갈 수 있다(진행 중이던 몇 통).
- 관문은 그 검사의 출처가 `spam_diag` 일 때만 열리고 그때만 `diag_of` 를 읽는다 — 배포 1(DDL 앞)에서도 일반 검사가 지나는 문장에 새 칸 0.
- 일반 검사(부모 · 사람 검사 · 자동 검사)는 이 관문을 지나지 않는다(무변경).

### 6-2-2. 진단 닫기(`closeDiagnosis(parentTestId)` · 같은 CT)

- **부모 진단 잠금(§6-2-1)을 잡고** 그 부모의 열린 판을 닫는다(부르는 쪽 트랜잭션 안에서 · `run` 을 받는다) — 판의 `NULL` · `unconfirmed` 결과 행 = `error`(`queued` · `active` 모두 · `active` 인데 이미 적재가 끝난 판은 결과만 닫혀 쓰이지 않는다) / `queued` 판 = 검사 `completed` / 그 판들의 확인 문자(`claimed` · `sent`) = `expired`. 닫힌 상태는 행에 남으므로(영속) 그 뒤 두 함수의 관문이 잠금 아래에서 읽고 적재 0.
- 닫힌 판에 늦은 보고가 닿으면 그 행은 통과로 바뀔 수 있다(보고 갱신은 `failed` 만 지킨다 `routes/spam-filter.ts:589-597` · 실제로 나간 판의 도착 = 사실). 그래도 **새 적재는 0**(관문은 결과 `NULL` · 확인 문자 `claimed` 를 본다) · **이미 내린 판정도 그대로**(대행 판정은 진단 대기 안에서 읽은 값으로만 한다 · 닫힌 뒤의 값은 화면 표시에만 쓴다).
- 부르는 곳 = 대행이 진단 대기를 끝낼 때(4a · 4b · 4c · 통과 회복 · 30분 · 버전 바뀜 · §7 · 그 갈래의 상태 저장과 같은 트랜잭션) · **담당자 문안 수정 = `editAgencyContentTx` 의 같은 트랜잭션 안**(`agency-send-change.ts:81` · 접수 행 `FOR UPDATE` 뒤 · 결과 칸을 지우기 전에 읽은 `diagHold.parentTestId` 로 · ★Codex 4R — 커밋 뒤 따로 닫으면 그 사이 종료에 참조를 잃는다) · 되돌리기(§12).
- **잠금 순서 하나** = 접수 행 → T 결과 행 → 부모 진단 잠금 → 판 결과 행 · 판 검사 행 · 확인 문자 행. 두 적재 함수 · `closeDiagnosis` 는 진단 잠금 → 판 행 순서만 쓰고 접수 행 · T 결과 행을 잡지 않는다 · 늦은 보고는 자기가 고치는 결과 행 하나만 잡는다(진단 잠금 0) → 교착 0.
- **판정에 쓰는 행은 전부 잠금 아래에서 다시 읽는다**(★Codex 4R · 5R 같은 부류의 원칙 하나 — T 결과 행만이 아니라 판 결과 행도).

### 6-3. 보내기(`enqueueSpamTest` 새 인자)

- `carriers` = 그 통신사 하나(단말 조회 · 결과 행 · 차감 건수 · 발송 건수가 모두 같은 단말 목록에서 나온다 · `spam-test-queue.ts:694-707` · `:798-807`).
- `diagOf` = 부모 검사 id · `variantId` = `K1` 등 · 출처 = `spam_diag` · `skipPrepaid = true`(차감 0) · `reuseSameDay = false`.
- 본문 = **§5-1 의 보낸 글에서 §6-1 대로 뺀 글을 렌더 끝난 글로**(`rendered = true` · 큐가 다시 치환하지 않는다) · 제목 · 종류 = 부모 그대로.
- 등록 = `enqueueSpamTest` 의 한 트랜잭션 안에서 **① 고정 키 트랜잭션 잠금**(`pg_advisory_xact_lock(hashtext('spam_diag_cap'))` · 확인 판 등록 전부가 줄 선다 · ponytail: 전역 잠금 = 하루 몇 통이라 충분 · 늘면 발신번호 키로) → **② 상한 셈**(발신번호 · 전체 · 한국 날짜) → **③ `INSERT … ON CONFLICT (diag_of, variant_id) WHERE diag_of IS NOT NULL DO NOTHING RETURNING id`** → 행이 안 돌아오면(이미 있음) 결과 행을 만들지 않고 되돌린 뒤 있는 판 id 를 돌려준다(상한 소모 0) → ④ 결과 행(그 통신사 하나) → 커밋. 인덱스가 무효면 ③ 이 충돌 판정 자리를 못 찾아 오류 = 판 없음(중복 0).
- 글자 · 길이 판정 = 등록 입구가 그대로 본다.
- **대기 15분 만료 · 판단 끝난 뒤 늦은 문자 0** = §6-2-1 관문(진단이 열려 있음) + §6-2-2 진단 닫기가 맡는다.

### 6-4. 판정 · 비용

- 판 상태는 §4 F6 · 확인 문자 · 늦은 보고 규칙 그대로(`spam_diag` 를 자동 목록에 넣어 자동 시간 값 = 닫힌 뒤 1분 확인 문자).
- **조치 · 다음 판 · 고객 안내의 근거는 확정 상태(도착 · 빼도 막힘)뿐이다.** 확인 중 · 대기는 「확인하고 있어요」로만 보인다.
- 통신사마다 따로 판정한다 — KT 판 도착 · LG U+ 판 막힘이면 KT 는 「주소를 빼니 도착」 · LG U+ 는 「주소를 빼도 막힘」(KT 결과로 LG U+ 원인을 말하지 않는다).
- 비용 = 고객 무료(우리 원가) · 11-01 ~ 11-23 확정 차단 41행 × 최대 2판 ≈ 하루 4통 안팎.

---

## §7 대행발송 루프 (화면 접수 · 메일 접수 공통 · 루프 안에서 기다리지 않는다)

- **자리** = `runSpamRound` 의 `blocked` 갈래 · `logEvent('spam_blocked')` 뒤 · `refineForSpam` 앞(`agency-send-worker.ts:469-472`). 첫 검사 단계(워커 A · `:945`)만 · 당일 재검사(워커 B · `:1139`)는 A 만(판 0).
- **증거와 판정은 같은 글에만**(★Codex 2R 구조 — 같은 문안 버전 안에서도 다듬은 글은 다른 글이다 `:431-454` · `:487-495`). 그래서 다듬기 전에 그 글의 판 결과를 받는다. 기다림은 루프 안이 아니라 **기존 보류와 같은 꼴**(접수를 받기 전 상태로 되돌리고 `last_test_result` 에 표시 · `:639-667` `settleSpamHold` · `heldResultJson` 과 같은 칸)이다 — 워커 A 순차 처리 지연 0.
- **조건** = 이 문안 버전에서 **처음 막힌 글 하나**(= T) · 발송 시각까지 2시간 이상(당일 재검사 창 밖) · 자격(§6-2). 아니면 판 없이 A 만 → 4c.
- **절차**
  1. T 막힘 → `buildSpamBlockHints`(A) → 막힌 통신사마다 첫 판 등록(판 ① · 주소 0 이면 판 ②) → 다듬지 않고 **진단 대기 보류**: `last_test_result.diagHold = { parentTestId: T, version, content: T 의 원문 기준 글, rounds }` · 사건 `spam_hint`(버전 · T · 통신사별 후보 · 판 id) · 장애 셈 0.
  2. 다음 주기에 다시 집혀 `diagHold` 의 버전이 지금 버전이면 **먼저 T 를 지금 결과로 다시 읽는다**(`readSpamTestOutcome` · ★Codex 3R — 진단 대기 사이에 늦은 보고로 T 가 통과로 바뀔 수 있다 `spam-probe.ts:153-154`). T 가 통과면 진단을 닫고(§6-2-2) 지금 루프의 같은 검사 이어 보기(`preferTestId` · C125)로 T 를 다시 보아 **통과 갈래**로 간다. 아직 막혔으면 **지금 `blocked` 인 통신사만**을 「막힌 통신사」로 두고 T 의 판만 읽어 `classifyDiag`(순수 · 확정 결과만):

| 갈래 | 조건 | 하는 일 |
|---|---|---|
| 대기 | T 의 판 중 대기 · 확인 중이 남음(만료 전) · 또는 판 ① 이 빼도 막힘 확정인 통신사에 판 ② 자격이 있어 방금 등록함 | 다시 진단 대기 보류 |
| 4a | **T 의 막힌 통신사 전부**에서 판 ①(주소만 뺀 T)이 도착 | 남은 회차 0 → `test_failed` · 담당자 문자 · (메일 접수면) 회신 메일 = 「글 속 주소를 빼니 {통신사}에 도착했습니다. 주소를 바꿔 주세요.」 T 는 주소만 빼면 도착하고, 다듬기는 주소를 바꿀 수 없다(§2) |
| 4b | T 의 막힌 통신사 중 하나 이상에서 판 ②(표시한 줄을 뺀 T)가 도착 | T 를 `refineForSpam` 으로 다듬되 `avoid`(그 판이 뺀 줄의 후보 조각 중 `extractAnchors` · 숫자가 아닌 것 = 바꿀 수 있는 표현) · `carrier` 를 넘긴다(보존 값은 지금 규칙 그대로) → 다음 회차 |
| 4c | 그 밖(판 없음 · 빼도 막힘 · 확인 못 함) · 또는 진단 대기 30분 넘음 | T 를 지금처럼 다듬기 → 다음 회차 |

  3. 대기를 뺀 모든 갈래(4a · 4b · 4c · 통과 회복 · 30분 · 버전 바뀜)는 **한 트랜잭션으로 확정한다**(★Codex 4R — T 를 읽은 뒤 확정까지의 틈에 늦은 보고가 T 를 통과로 바꿀 수 있다): 접수 행 `FOR UPDATE`(선점 토큰 · 버전 확인) → T 결과 행 `FOR UPDATE`(늦은 보고 갱신과 직렬화) → 부모 진단 잠금 → T 의 판 결과 행 `FOR UPDATE`(★Codex 5R — 판의 늦은 보고와도 직렬화) → **잠근 값으로 막힌 통신사 집합 · 판 결과를 다시 읽어 판정에 쓴 값과 같을 때만** 상태 저장(4a = `test_failed` · 그 밖 = 다음 회차로) + `closeDiagnosis(T)`(같은 트랜잭션 · §6-2-2 · 4c 뒤 판 ② 0 · ★Codex 3R) → 커밋 → 그 뒤 담당자 문자 · 회신 메일. 다르면 되돌리고 절차 2 부터 다시(T 가 통과면 통과 갈래). 4a 커밋 뒤에 닿은 늦은 보고는 접수를 되살리지 않는다(지금 C125 의 「사람 판단으로 넘긴 뒤」 경계와 같다).
  4. 같은 버전의 그 뒤 막힘(다듬은 글)에는 판을 걸지 않는다(문안 버전당 진단 한 번 · 사건 `spam_hint` 로 판정). 고객이 문안을 고치면 새 버전 = 새 진단 한 번(옛 진단은 수정 CT 가 닫는다).
- `diagHold` 는 C150 보류 묶음(`heldSpamBatch` · 사건 `spam_held`)과 다른 표시라 그 판정에 섞이지 않는다 · 담당자가 문안을 고치면 결과 칸째 지워진다(`heldCandidate` 와 같은 규칙).
- 회차 상한 `MAX_TEST_ROUNDS = 3` 그대로 · 확인 판 · 진단 대기는 회차에 세지 않는다.
- **진단은 부가 동작이다(fail-open)** — 힌트 계산 · 판 읽기 · 판 등록이 던지면 4c 와 같다. 일반 검사의 판정 · 장애 셈 · 보류는 손대지 않는다(진단 실패가 `error` 판정이 되지도, 장애 셈을 건너뛰게 하지도 않는다). 칸이 없으면(42703) 판 없이 A 만 + 경고 로그.

---

## §8 보이는 곳 · 문구

### 8-1. 직접발송 스팸 검사 (D1 ~ D5)

| 자리 | 넣는 것 | 서버 |
|---|---|---|
| D1 검사 창 막힘 카드 아래(`SpamFilterTestModal.tsx` 막힘 카드 `:562-569`) | 「막혔을 수 있는 부분」 카드 — 원문에서 후보 조각 표시 · 근거 한 줄 · 뒤로 민 조각 한 줄 · MMS 면 그림 안내 | `GET /tests/:id` 의 `hints` |
| D2 통신사별 단추 | [주소 빼고 {통신사}로 다시 확인](판 ①) → 확정이 「빼도 막힘」이면 [표시한 줄 빼고 {통신사}로 다시 확인](판 ②) · 주소가 없는 글은 처음부터 판 ② 단추(자격 함수 하나) · 자격이 안 되면 단추 대신 사유 · 판이 확정될 때까지 창이 다시 읽는다 | `POST /tests/:id/diagnose { carrier, variant }` — `authenticate` · `demoBlock`(사람 검사 입구와 같은 미들웨어) · 사용자 범위 = `/tests/:id` · 자격 §6-2 |
| D3 [전송하기] 직전 경고(`useSendPrecheck.tsx:283-290`) | 막혔던 글 경고에 한 줄(후보 · 확정된 판 결과) — 창을 닫은 뒤 확정된 막힘을 사람이 보는 자리 | `recent-check` 응답 `hintLine` |
| D4 검사 창 「지난 검사」 줄 | 「KT 막힘 · 의심: 글 속 주소」 | `GET /tests` 줄 요약(확인 판 행은 목록에서 뺀다 · §10) |
| D5 [글 고치러 가기] | 대시보드가 `onEdit` 를 넘긴다(창을 닫고 작성 화면으로) | — |

- B 는 **단추**(사람이 화면 앞에서 글을 고치는 중이라 자동으로 보내면 바뀌기 전 글을 확인하게 된다).
- 체험 검사(차감 0)도 막히면 D1 은 보인다 · D2 는 같은 자격 · 상한(판은 고객 무료).

### 8-2. 대행발송 (M1 ~ M4)

| 자리 | 넣는 것 |
|---|---|
| M1 검사 루프 | §7 |
| M2 담당자 문자(`buildTestFailedNotify`) | 막힌 통신사 · 도착한 통신사 · 확정된 판 결과(없으면 후보) 한 줄 · 접수 화면 주소 `hanjul.ai/agency-send`(로그인 · 승인 토큰 없음) · 「세 차례」 낱말은 뺀다(4a 는 한 차례에서 멈춘다) |
| M3 **검사 결과 회신 메일**(`source = 'email'` 접수만) | 아래 |
| M4 진행 기록(`AgencyEventLog.tsx`) | `spam_blocked` 줄에 통신사(payload `carriers` 이미 있음) · 새 사건 `spam_hint` · `spam_result_mail` 라벨(SCHEMA 3499 · `EVENT_LABEL` 같은 커밋) |

**M3 — 상태에서 다시 찾아내는 패스(기존 `retryPendingReplies` 와 같은 꼴 · 새 칸 · 표 0)**
- 자리 = 메일 워커 틱(1분 · 단일 실행 가드 그대로)의 새 패스 `sendPendingSpamResultMails(mailbox)`.
- 보낼 것 = **접수 행만으로 판정**(★Codex 2R — 상태 저장과 사건 기록 사이에 죽어도 찾아낸다 `agency-send-worker.ts:954-962`): `status = 'test_failed'` · `source = 'email'` · `updated_at` 24시간 안 · 지금 `content_version` 에 `spam_result_mail` 사건 중 결과 `sent` · `rejected` 가 없음 · 결과 `unknown` 사건 수 < `REPLY_MAX_ATTEMPTS`(3 · `agency-send-mail-worker.ts:82`).
- 받는 곳 = `request_ids` 에 그 접수 id 가 들고 **`company_id` 가 그 접수와 같은** `agency_send_email_intake` 행(`status = 'accepted'`)의 `from_email` · 답장 이음 = 그 행 `message_id`.
- 보내기 = `replyAllowed` 게이트 → 막히면 기록 없이 다음 틱(24시간 창 안) · 통과하면 `sendAgencyReplyMail` → 결과(`sent` · `rejected` · `unknown`)를 사건 `spam_result_mail`(버전 · 결과)로 기록.
- 보낸 뒤 기록 전에 프로세스가 죽으면 다음 틱이 한 번 더 보낸다(최소 한 번 · 기존 회신과 같은 선택 · 누락보다 중복이 낫다). 문안을 고쳐 다시 막히면 새 버전 = 새 1통.
- 본문(평문): 막힌 통신사 · 도착한 통신사 · 원문(후보 줄 앞 「▶」) · 확정된 판 결과 · 고치는 길 = 「로그인하여 고치기」. 「고친 요청서를 다시 보내면 새 접수로 받는다」는 중복 판정(`EMAIL_DUP_BLOCKING_SQL`)이 막힌 접수를 어떻게 세는지 구현 0단계에서 확인한 뒤에만 넣는다(미검증).

### 8-3. 고객 문구 원칙

1. 추정과 확인을 섞지 않는다 — A = 「막혔을 수 있는 부분」 · 판 도착 = 「빼니 도착했어요」 · 판 막힘 = 「빼도 막혔어요」. 「이것 때문에 막혔다」 단정 금지. 카드 첫 줄 = 「통신사는 막은 이유를 알려 주지 않아요. 한줄로가 기록으로 좁힌 부분이에요.」
2. 우리 쪽 원인 단정 금지(「장비 문제」 0) · 못 마친 확인 = 「확인을 마치지 못했어요」.
3. 접수 거절 · 글자 반려 문장(C159 · C109)은 그대로 · 이 기능이 덮지 않는다.
4. 검사 방식 낱말 금지(시험 폰 · 테스트폰 · 실제 휴대폰 · 기기 대수 · `root-ledger.test.ts` R11).
5. 모델명 0.
6. 「고치면 통과합니다」 약속 금지.
7. MMS 접수에는 「그림은 검사에 들어가지 않았어요」 한 줄.
8. 보이는 글 = 원문(변수 값 · 개인정보 0 · §5-1).

### 8-4. 정본 문구 (조사까지 완성된 문장 · 자리 채움은 통신사 · 날짜 · 건 이름뿐)

| 상태 | 문구 |
|---|---|
| 카드 제목 | 막혔을 수 있는 부분 |
| 주소 후보 | 글 속 주소예요 |
| 지난 글 대비 | 지난 M월 D일 {통신사}에 도착한 글에는 없던 부분이에요 |
| 규칙 | 등록된 차단정보와 같은 부분이에요 |
| 뒤로 민 조각 | 바꿔 봤는데도 막혔던 부분이에요 |
| 지난 글 없음 | 견줄 만한 지난 글이 없어요 |
| 판 대기 · 확인 중 | {통신사}로 보내 확인하고 있어요 |
| 판 ① 도착 | 글 속 주소를 빼니 {통신사}에 도착했어요. 주소를 바꿔 보세요. |
| 판 ① 막힘 | 글 속 주소를 빼도 {통신사}에서 막혔어요. 주소만의 문제는 아니에요. |
| 판 ② 도착 | 표시한 줄을 빼니 {통신사}에 도착했어요. 그 줄의 표현을 바꿔 보세요. |
| 판 ② 막힘 | 표시한 줄을 빼도 {통신사}에서 막혔어요. |
| 판 확인 못 함 | 확인을 마치지 못했어요. |
| 자격 사유(스위치 꺼짐 · 보낸 글 복원 불가) | 지금은 다시 확인할 수 없어요. |
| 자격 사유(권한) | 이 발신번호로는 다시 확인할 수 없어요. |
| 자격 사유(상한) | 오늘은 더 확인할 수 없어요. 내일 다시 해 주세요. |
| 담당자 문자 4a | [대행발송] 문안이 {통신사} 스팸 검사에 걸렸습니다. / 건: {건} / 글 속 주소를 빼니 {통신사}에 도착했습니다. 주소를 바꿔 주세요. / 로그인: hanjul.ai/agency-send |
| 담당자 문자 그 밖 | [대행발송] 문안이 스팸 검사에 걸렸습니다({통신사}). / 건: {건} / {확정된 판 결과 문장 · 없으면 「막혔을 수 있는 부분: 글 속 주소」 꼴} / 로그인하여 문안을 고쳐 주세요: hanjul.ai/agency-send |

---

## §9 저장 · DDL · 스위치

- A = 저장 0.
- B = `spam_filter_tests` 행(출처 `spam_diag` · varchar(20) 안) + 새 칸 `diag_of uuid NULL`(부모 검사 · FK 없음 = 체험 실패 정리가 부모를 지워도 연쇄 0 · 막힌 부모만 판을 가지므로 체험 실패 정리와 겹치지 않는다) + 유일 부분 인덱스.
- 실행 위치 = 운영 PG · 서버 셸 한 줄씩 · 순서 = §12.

```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name = 'spam_filter_tests' AND column_name IN ('diag_of','variant_id','source') ORDER BY 1;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'spam_filter_tests'::regclass AND contype = 'c';"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SET lock_timeout = '3s'; ALTER TABLE spam_filter_tests ADD COLUMN IF NOT EXISTS diag_of uuid NULL;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_spam_filter_tests_diag ON spam_filter_tests (diag_of, variant_id) WHERE diag_of IS NOT NULL;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT c.relname, i.indisvalid, i.indisunique, pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'uq_spam_filter_tests_diag';"
```

- DDL-0 기대: `diag_of` 없음 · `variant_id` varchar(2) · `source` varchar(20) · CHECK 0(있으면 `spam_diag` 를 넣는 CHECK 교체가 DDL 에 더해진다).
- ★1124 DDL-0 실측(Harold 실행): `diag_of` 없음 · `variant_id` **varchar(10)**(옛 SCHEMA 의 varchar(2) 는 틀렸음 · `K1` 등 들어감) · `source` varchar(20) · `user_id` uuid NOT NULL · `callback_number` varchar(20) NOT NULL · **CHECK 0** · `uq_spam_filter_tests_diag` 없음 · `spam_test_probes` 의 status · attempts · claimed_at · decided_at 있음 → DDL-1 · DDL-2 그대로.
- DDL-3 기대: 1행 · `indisvalid = t` · `indisunique = t` · 정의 = `(diag_of, variant_id) WHERE (diag_of IS NOT NULL)`. **무효(f)면** `DROP INDEX CONCURRENTLY uq_spam_filter_tests_diag;` 뒤 DDL-2 를 다시 · 유효를 볼 때까지 스위치를 켜지 않는다.
- 안전망(`db_alter_safety_net`): `POST /tests/:id/diagnose` 의 catch 에서 `column` · `does not exist` → 503 `DB_MIGRATION_PENDING` 「DB 마이그레이션 필요 — spam_filter_tests ALTER 실행 요청」. `GET /tests/:id` 의 판 읽기가 42703 이면 `diag.checks` 빈 배열(A 만 · 화면 깨짐 0). 대행 = §7 fail-open.
- 스위치 = `SPAM_DIAG_SENDS`(기본 꺼짐) — 꺼져 있으면 판 등록 0 · A 와 이미 있는 판 읽기는 그대로.

---

## §10 영향표

### 10-1. `spam_filter_tests` 를 읽는 자리(grep 1123 · 16파일) — **배포 1(제외 처리)에 전부 들어간다**

| 자리 | 지금 | 바뀜 | 이유 |
|---|---|---|---|
| `utils/spam-trial.ts` 청구 제외 목록 · `isAutoSpamSource` · `notAutoSpamSourceSql` | trial · auto_ai_free / auto 두 값 | 셋 모두에 `spam_diag` 추가(두 자동 목록은 같은 목록 유지) + 새 조각 `spamCustomerTestSql(alias)` = 확인 판 제외 | 청구 0 · 자동 시간 값 · 수동 창 복원 제외를 한 곳에서 |
| `routes/spam-filter.ts` `GET /tests` 목록 · 개수(`:771`) | 회사 · 사용자 검사 전부 | 확인 판 제외 + 막힌 줄 요약 | 사람이 안 건 검사가 목록에 뜨면 안 됨 |
| 같은 파일 `GET /active-test`(`:651`) | 자동 출처 제외 | 무변경(자동 목록에 들어가 저절로 제외) | — |
| 같은 파일 `POST /recent-check`(`:713`) | 24시간 안 같은 글 검사 | 확인 판 제외 + `hintLine` | 판은 한 통신사 결과만이라 「검사함」으로 읽으면 안 됨 |
| 같은 파일 `GET /tests/:id`(`:829`) | 결과 | + `hints` | D1 · D2 |
| 같은 파일 새 `POST /tests/:id/diagnose` | — | 자격 §6-2 · `authenticate` · `demoBlock` | D2 |
| `utils/spam-test-queue.ts` `spamCheckFor`(`:520`) | 같은 키 같은 날 이어 보기 | 확인 판 제외 | 고객이 주소 뺀 같은 글을 검사하면 한 통신사짜리 판을 이어 보게 된다 |
| 같은 파일 `enqueueSpamTest` | 활성 단말 전부 | `carriers` · `diagOf` · 출처 `spam_diag` · 등록 충돌 처리 | §6-3 |
| 같은 파일 `executeSpamTest` 적재(`:1154` 앞) | 결과 행마다 적재 | 확인 판이면 적재 직전 발송 관문(§6-2-1) · 못 지나면 적재 0 · 닫기 · 일반 검사 무변경 | 모든 검사 문자가 지나는 한 곳 |
| 같은 파일 `processSpamTestQueue` · `resolveSpamReportTest` · 늦은 보고 시간 값 | — | 무변경(판도 같은 길 · 관문은 위 함수 안) | 보고 귀속 · 판정이 그대로 돌아야 한다 |
| `utils/spam-probe.ts` `sendProbe`(`:98` · 부르는 곳 `:140` 다시 보내기 · `:193` 첫 선점) | 확인 문자 적재 | 확인 판 결과 행이면 적재 직전 발송 관문 · 못 지나면 적재 0 · 확인 문자 `expired` · 결과 `error` · 일반 검사 행 무변경 | 모든 확인 문자가 지나는 한 곳 |
| `utils/callback-filter.ts` `getRegisteredCallbackSet`(`:250` · CT) | 배정 칸 확인 실패 = 회사 전체 목록 | 새 인자 `{ strict }` — 참이면 그 실패를 던짐 · 기본값 무변경 | 확인 판 권한만 엄격 · 지금 호출 14곳(8파일 · grep 1123: `routes/agency-send.ts` · `services/ai-line-spam.ts` · `utils/agency-send-intake.ts` · `agency-send-mail-worker.ts` · `callback-filter.ts` · `continuous-operator.ts` · `proposal-trial.ts` · `spam-test-queue.ts`)은 인자를 안 넘겨 동작 0 변화 |
| `utils/agency-send-change.ts` `editAgencyContentTx`(`:81`) | 문안 수정 · 결과 칸 지움(`:185`) | 같은 트랜잭션 안(접수 행 `FOR UPDATE` 뒤)에서 지우기 전에 읽은 `diagHold.parentTestId` 로 `closeDiagnosis` | 옛 문안 진단의 남은 판 0 · 커밋 사이 종료에도 참조를 잃지 않음 |
| `utils/agency-send-worker.ts` 진단 대기 갈래 확정 | — | 접수 행 → T 결과 행 → 진단 잠금 순으로 잡는 한 트랜잭션(§7 절차 3) · `setStatus` 를 그 트랜잭션의 `run` 으로 부를 수 있게 | 4a 와 늦은 보고의 직렬화 |
| 같은 파일 하루 측정(R36 · `:224`) | 처음 확인 중이던 행 | 확인 판 제외 | 일부러 막힐 만한 글이라 오탐률을 흐린다 |
| `services/ai-line-spam.ts:139-143` 사용자 자동 검사 점유 | 자동 출처 진행 중이면 busy | 확인 판 제외 | 우리 판 때문에 AI 한줄로 칩이 기다리면 안 됨 |
| 같은 파일 `reusableLineSpamTest` | `spamCheckFor` 경유 | 위에서 함께 | — |
| `utils/precheck-usage.ts:87` | 사전 점검 이용 목록 | 확인 판 제외 | 고객 이용 내역 |
| `routes/campaigns.ts:1744` · `:1767` | 검사 건수 · 청구 건수 | 확인 판 제외 | 고객 화면 건수 |
| `routes/manage-stats.ts:212` · `:325` | 사용량 | 확인 판 제외 | 고객 화면 건수 |
| `routes/admin.ts:3460` · `:5870` · `:5882` | 관리 화면 사용량 | 확인 판 제외 | 고객사 관리 메뉴 건수 |
| `utils/send-usage-aggregation.ts:865` · `:1951` | 정산 · 계정별 | 확인 판 제외(청구는 출처 목록으로도 0) | 건수 표시 |
| `utils/performance-benchmark.ts:62` | 통신사별 결과 지표 | 확인 판 제외 | 지표 흐림 |
| `utils/monthly-usage.ts:127` | 차감 거래 기준 | 무변경 | 판은 차감 0 |
| `utils/spam-test-view.ts:37` | 대기열 앞사람 수 | 무변경 | 판도 실제로 줄을 선다 |
| `utils/agency-send-worker.ts:714` · `:775` · `:802` · `:833` | 묶음(batch) 기준 | 무변경 | 판은 묶음 id 가 없다 |
| `routes/ai.ts:334` · `utils/ai-sms-layout.ts:4` | 주석 | 무변경 | — |

### 10-2. 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 그 회사가 하는 일 | 바뀌는가 |
|---|---|
| 직접발송(검사 안 씀) | 0 — 발송 길 무변경 · 이 기능은 검사 결과가 `blocked` 일 때만 돈다 |
| 체험 검사(회사당 3회 · 차감 0) 후 막힘 | 화면에 카드 · 단추만 늘어남 · 판 = 차감 0 · 체험 횟수 셈 무변경(`spam-trial.ts:112` 가 `t.source = 'trial'` 행만 센다) |
| 금칙어 차단(차감 앞) | 0 — `checkSpamBlockBeforeCharge` 무변경 |

---

## §11 계약 시험 · 검증

| 시험 | 무엇이 실패해야 하나 |
|---|---|
| `rankSuspects` | 폴라초이스 꼴 **합성** 고정값(실제 글이 아닌 같은 구조) 6판: 뒤로 민 조각 = 바뀐 첫 줄 낱말 · 「size」 · 「up」 · 「사이즈업」(지우지 않음) / 남는 후보 맨 앞 = 주소 2 / 닮은 글 없음 · 법정 조각 후보 0 · 변수 값 조각 후보 0 |
| `makeDiagVariant` | 판 ① = 주소 조각만 빠짐(나머지 글자 그대로) · 판 ② = 표시한 줄 · 법정 줄 보존 · 주소 0 이면 판 ① 없음 · 남는 줄이 법정 줄뿐이면 판 없음 |
| `diagEligibility` | 스위치 꺼짐 · 부모가 확인 판 · 통신사가 지금 blocked 아님 · 변수 칸 있는 렌더 안 된 부모 · 발신번호 권한 회수 · 상한 초과 → 각각 판 0 + 사유 |
| `classifyDiag` | 4a(막힌 통신사 전부 판 ① 도착) · 두 통신사 결과가 갈리면 4a 아님 · 4b(판 ② 도착 · 보존 값은 `avoid` 에 안 들어감) · 4c(확인 중 · 만료 · 빼도 막힘) |
| 발송 관문 | 15분 지난 판 · 스위치 꺼짐 · **대기 중 발신번호 권한 회수 · 권한 조회 실패 · 배정 칸 확인 쿼리만 실패(strict)** → 검사 문자 적재 0 · 결과 `error` / 첫 발송 뒤 권한 회수 · 스위치 꺼짐 → **첫 선점 · 다시 보내기 둘 다** 확인 문자 적재 0 · 확인 문자 `expired` / 일반 검사는 관문을 안 지난다 / 기계 추출: 확인 판 문자를 적재하는 길이 두 함수 밖에 생기면 실패 |
| 진단 닫기 | 4c 로 넘어간 뒤 · 담당자 문안 수정 뒤 남은 판 ② · 확인 문자 → 적재 0 / **판이 `active` 가 된 직후 닫힘 · 관문 확인 직후 닫힘(두 트랜잭션을 번갈아 멈춰 재현)** → 잠금 아래 다시 읽어 적재 0 또는 닫기가 적재 뒤로 줄 섬 / **문안 수정 커밋 직후 종료** → 진단이 이미 같은 트랜잭션에서 닫힘 / 닫힌 판에 늦은 보고 → 표시만 통과 · 새 적재 0 · 내린 판정 그대로 |
| 통과 회복 | **진단 대기 중 T 가 늦은 보고로 통과** → 4a 안 함 · 통과 갈래 / 한 통신사만 회복 → 남은 막힌 통신사 기준으로 판정 / **T 를 읽은 뒤 4a 확정 직전 통과** → 잠금 아래 다시 읽어 확정 안 함 · 다시 판정 |
| 되돌리기 | 앱 정지 상태에서 ② 뒤 ③ 세 수 0 · ② 두 번 돌려도 같은 판을 찾음(`diag_of`) · 옛 판 기동 뒤 확인 판 적재 0 |
| 정해진 값 보존 | 관문이 거부할 때 결과가 이미 `pass` → 그대로 둠(확인 문자 행만 `expired`) / 닫힌 행을 결과 판정 쓰기(`result IS NULL`)가 덮지 않음 |
| 확인 문자 소유 | **첫 선점이 늦어져 다시 보내기와 같은 `claimed` 를 둘이 잡음** → 잠금 아래 먼저 온 쪽만 보내고 `sent` · 뒤에 온 쪽은 `claimed` 가 아니라 아무것도 안 씀(그 `sent` 행 · `unconfirmed` 결과 그대로) |
| 관문 SQL 오류 | 잠금을 잡은 뒤 권한 조회가 SQL 오류 → 저장점으로 되돌리고 닫기 커밋(열린 채 남지 않음) / 연결 끊김 — **검사 문자** = 멈춘 검사 정리가 `timeout` 으로 닫고 다시 안 보냄 · 늦게 도착한 실행기는 「내 것 아님」(`NULL` 아님)으로 적재 0 / **확인 문자** = 시도 여유가 있으면 다시 보내기가 관문을 다시 지남 · **마지막 시도의 관문 조회 중 끊김** → 상한 규칙대로 적재 없이 `expired` + 결과 `error` |
| 스위치 끔 | ENV 끔 + 재시작 뒤 대기 · 첫 선점 · 다시 보내기 적재 0 · 재시작 전 프로세스는 끝나 있음 · 다른 앱(`outreach-render` = `src/workers/outreach-render-worker.ts`)은 검사 · 확인 문자를 적재하지 않음(grep 1123 = 검사 대기열 · 확인 문자 · `insertTestSmsQueue` 참조 0) |
| 배포 1 · DDL 앞 | 일반 검사 문장에 `diag_of` 0(칸 없어도 검사 · 확인 문자 정상) |
| 대행 확정 vs 판의 늦은 보고 | 확정 트랜잭션이 판 결과 행을 잠근 뒤 다시 읽음 → 늦은 보고가 먼저면 바뀐 값으로 다시 판정 · 확정이 먼저면 늦은 보고는 표시만 바꿈 |
| 상한 직렬화 | **서로 다른 부모 둘이 동시에 마지막 한 자리를 노림** → 하나만 등록 / 같은 판 두 번 → 결과 행 · 상한 소모 0 |
| 진단 대기(대행) | **같은 버전의 다듬은 글이 막혀도 앞 글 T 의 판으로 4a 안 함**(판정은 T 에 대해서만 · 그 뒤 막힘엔 판 0) / 진단 대기 30분 넘음 → 4c / 발송 2시간 안 → 판 0 / 진단 대기 중 담당자가 문안 수정 → 표시 지워짐 |
| 첫 판 | **주소 없는 글 = 판 ② 가 첫 판**(D2 단추 · 대행 등록 같은 결과) |
| 결과 메일 | 상한 게이트 = 기록 0 · 다음 틱 재시도 / `unknown` 은 3까지 재시도 / 다른 회사 접수 원장 행으로 안 보냄 / 같은 버전 두 번 안 보냄 / 기록 전 종료 = 다음 틱 재전송 / **상태 저장 직후 사건 기록 전 종료 → 다음 틱이 찾아 보냄** |
| 되돌리기 | **대기 · 확인 중 판이 남은 채 하한 아래로 내리는 절차**(§12 SQL) 뒤 옛 판 워커가 판을 보내지 않음 · 확인 문자 선점 0 |
| 기계 추출 계약(뿌리 장부 꼴) | 소스에서 `spam_filter_tests` 를 읽는 SQL 을 전부 뽑아 §10-1 「확인 판 제외」 자리에 `spamCustomerTestSql` 이 있고, 표에 없는 새 자리가 생기면 실패 |
| 출처 목록 | 자동 함수판 · SQL판이 같은 목록(기존 계약) · 청구 제외에 `spam_diag` |
| 문구 | R11 검사 방식 낱말 0 · 모델명 0 · 「장비 문제」 0 · 정본 문구 표의 조사 |
| 변이 | 파일 복사로 위 판정 자리마다 |
| 실 PG | 새 SQL(A 읽기 · 유일 인덱스 충돌 · 무효 인덱스에서 등록 실패 · 단말 좁히기 · 만료 닫기)을 일회용 PG 16 에서 |
| 실측 S1(발송 · 6원칙 5) | 스위치를 켠 뒤 첫 자연 발생 막힘: 판 행 출처 `spam_diag` · 결과 행 = 그 통신사 하나 · 차감 거래 0 · 고객 목록 · 건수에 안 보임 · 화면 · 문자 · 메일 문구 |

- 직원 지시문(동작 · 볼 결과만) = 구현 뒤 묶음 끝에 한 번.

---

## §12 구현 · 배포 순서 · 되돌리기

0. 실제 차단 41행 + 앞선 통과 글을 한 번 뽑아 로컬에서 문턱 맞춤 · 메일 재접수 중복 판정 확인(§8-2).
1. **배포 1 = 제외 처리 + 발송 관문만**(§10-1 표 전부 · 판을 만드는 코드 0) · 구현 Codex 닫힘 → 배포. **이 판이 되돌리기 하한이다** — 판 행이 하나라도 생긴 뒤에는 배포 1 아래로 되돌리지 않는다(옛 판은 `spam_diag` 를 청구 · 목록에 넣고 관문 없이 보낸다). 부득이 아래로 되돌려야 하면 **앱을 멈춘 상태에서만** 한다(★Codex 6R 구조 — 4R · 5R · 6R 세 번 「일꾼이 도는 채로 정리하면 정리 사이에 끼어드는 선점」이 나왔다 · 일꾼이 없으면 끼어들 것이 없다 · Codex 5R 권고와 같다): ① 앱 정지(런북의 정지 절차 · 적재 0 · 업무 시간 밖 · Harold) ② 한 트랜잭션으로 남은 판을 닫고 출처를 바꿈(아래 첫 SQL · 확인 판의 확인 문자 `claimed` · `sent` → `expired` · 대기 · 확인 중 결과 `error` → 검사 `completed` → 출처 `auto_ai_free` · 닫힌 판은 옛 판의 첫 선점(`unconfirmed`)에도 다시 보내기(`claimed`)에도 안 걸린다) ③ 잔존 0 확인(아래 둘째 SQL 의 세 수가 모두 0) ④ 옛 판 기동(옛 판은 확인 판을 만들지 않으니 그 뒤 새 확인 판 행 0).

```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "BEGIN; UPDATE spam_test_probes SET status = 'expired', decided_at = NOW() WHERE status IN ('claimed','sent') AND result_id IN (SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id WHERE t.diag_of IS NOT NULL); UPDATE spam_filter_test_results SET result = 'error' WHERE (result IS NULL OR result = 'unconfirmed') AND test_id IN (SELECT id FROM spam_filter_tests WHERE diag_of IS NOT NULL); UPDATE spam_filter_tests SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE diag_of IS NOT NULL AND status <> 'completed'; UPDATE spam_filter_tests SET source = 'auto_ai_free' WHERE diag_of IS NOT NULL AND source = 'spam_diag'; COMMIT;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT (SELECT COUNT(*) FROM spam_test_probes p JOIN spam_filter_test_results r ON r.id = p.result_id JOIN spam_filter_tests t ON t.id = r.test_id WHERE t.diag_of IS NOT NULL AND p.status IN ('claimed','sent')) AS open_probes, (SELECT COUNT(*) FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id WHERE t.diag_of IS NOT NULL AND (r.result IS NULL OR r.result = 'unconfirmed')) AS open_results, (SELECT COUNT(*) FROM spam_filter_tests WHERE diag_of IS NOT NULL AND status <> 'completed') AS open_tests;"
```
- ② · ③ 은 출처가 아니라 `diag_of IS NOT NULL` 로 찾는다(② 를 다시 돌려도 이미 출처가 바뀐 판을 찾는다).
2. DDL-0 → DDL-1 → DDL-2 → DDL-3(유효 확인).
3. **배포 2 = 판 등록 · A · 화면 · 대행 · 메일**(스위치 기본 꺼짐) · 구현 Codex 닫힘 → 배포. A · 화면 · 문구는 스위치와 무관하게 이때부터 보인다(판 단추는 자격 사유 「지금은 다시 확인할 수 없어요」로 숨김).
4. DDL-3 유효를 본 뒤 `SPAM_DIAG_SENDS=on` → S1.

되돌리기 = 스위치 끔(ENV 끔 + 백엔드 재시작 · 재시작 뒤부터 두 함수 관문이 대기 · 확인 문자 · 다시 보내기를 막는다 · 옛 프로세스의 진행 중 적재는 프로세스와 함께 끝난다 · §6-2-1) → 필요하면 배포 2 되돌림(배포 1 은 남긴다 · 이 되돌림 자체가 재시작이다 · 남은 판은 배포 1 의 관문이 막는다) · 칸 · 인덱스는 남아도 무해. 스위치를 켜는 것도 같은 재시작이다(§12 4번).

---

## §13 미검증 · 위험

- 통신사가 무엇으로 막는지 = 알 수 없음. 판 결과는 그 시각의 사실만.
- 막힐 만한 글을 같은 단말에 연달아 보내는 것이 통신사 판정이나 발신번호 평판에 주는 영향 = 미검증(통신사마다 2판 · 발신번호 하루 10판 · 전체 하루 100판 · 스위치가 노출을 묶는다).
- 조합 차단은 A 가 못 가른다(4c 로 흘러 지금보다 나빠지지 않음).
- 같은 번호의 LMS 무해 글도 도착하는지 = 미검증(확인 문자는 SMS).
- MMS 그림 원인 차단 = 이 기능이 못 찾는다.
- 제목(LMS 제목)이 원인인 경우 = 판이 제목을 바꾸지 않아 못 가른다.
- 문안이 같은 검사가 없는 보고는 진행 중인 검사로 가는 종전 규칙(`FEATURE-SPAM-CHECK.md` §1-1 ②)이 판에도 적용된다(종전 한계 그대로).
- 결과 메일은 최소 한 번(기록 전 종료 = 한 번 더) · 기존 회신과 같은 선택.
- 확인 판 문자도 최소 한 번 — MySQL 적재가 끝난 뒤 PG 커밋 전에 연결이 끊기면 확인 문자는 2분 뒤 다시 보내기로 한 번 더 나갈 수 있다(많아야 1통 · `PROBE_MAX_ATTEMPTS = 2` · 우리 단말로 가는 무해한 글). 지금 확인 문자 길(`spam-probe.ts:98-104` = 적재 뒤 `sent` 를 따로 적음)과 같은 성질이고, 막으려면 모든 발송이 쓰는 적재 CT(`insertTestSmsQueue`)를 멱등으로 바꿔야 해 이번 범위 밖(Codex 5R M3 불수용 근거 · §15).
- 진단 대기(최대 30분) 동안 워커 A 가 5분마다 접수를 다시 집어 `revision` 이 오른다(`agency-send-worker.ts:923-935`) — 그 사이 담당자 화면의 수정 · 승인이 「다른 변경이 있었다」로 한 번 더 읽기를 요구받을 수 있다(기존 보류와 같은 길이지만 대기 시간만큼 횟수가 는다 · Codex 3R 참고 · 미검증 = 실제 빈도).
- 폴라초이스 건 원인 = 미검증.

## §14 범위 밖 (추가 과제 · 기록만)

- 자동발송 · 자동마케팅 · 플래너 · 여정 · AI 한줄로 칩의 결과에도 같은 카드(같은 CT 호출).
- MMS 그림까지 검사.
- 직접발송 작성 칸 안에서 후보 조각 표시 · 선택.
- `runSpamRound` 머리 주석의 「통과 판정이 느슨하다」(`agency-send-worker.ts:365-370`).
- 대행 담당자 안내 문자(`notifyManager`)가 상태를 바꾼 뒤 적재 전에 프로세스가 죽으면 빠지는 것(이 기능 전부터 있던 꼴 · 결과 메일만 이번에 재시도 패스로 만든다).
- 이 트랙의 C 번호 · STATUS-FEED 카드 등재(다른 세션 소유 문서 · 이 세션은 건드리지 않음).

---

## §15 Codex 설계 리뷰 기록

| 라운드 | 판정 | 지적 | 처리 |
|---|---|---|---|
| 1R(1123 16:40 · gpt-6.2-sol · high · 하위 에이전트 0 로그 대조) | needs-attention | H1 코드 되돌리면 판이 청구로 · H2 지난 검사 조회 권한으로 지금 발신번호 권한을 건너뜀 · 판 재귀 · H3 루프 90초 대기가 끝나도 판이 늦게 나감 · 워커 A 지연 · H4 렌더 안 된 부모의 보낸 글 복원 불가 · H5 회신 전 기록 = 장애 한 번에 누락 · M1 통신사 한 곳 도착이 다른 통신사 확인을 덮음 · M2 닮은 차단 글 하나가 원인 후보를 지움 · M3 숫자와 표현이 한 줄이면 4a 가 너무 넓음 · M4 무효 인덱스 재실행 | **9건 전부 수용.** 뿌리 = 「확인 판 = 고객 발신번호 발송」 축 미적용(H1 · H2 · H3 · M1) → §6-2 자격 · §12 배포 1 하한 · §7 무대기 · §6-4 통신사별 판정 / 보낸 글 불변(H4) → §5-1 / 확정 사실만 조치(M2 · M3) → §5-2 뒤로 밀기 · 판 ① = 주소만 · 4a = 판 ① 도착만 / 회신 = 상태에서 다시 찾는 패스(H5) → §8-2 M3 / DDL-3 유효 확인(M4) → §9. 같은 라운드 자체 보강 = 문구 조사 완성 · `diagnose` 미들웨어 · 판 ② 줄 고르기 · 문안 버전당 판 한 번 |
| 2R(1123 16:50 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | H1 대기 중 권한 회수 · 확인 문자 · H2 유일 인덱스로는 발신번호 · 전체 상한을 못 막음 · H3 되돌리기 SQL 이 대기 판을 살려 둠 · H4 상태 저장과 사건 기록 사이 종료 = 메일 누락 · H5 같은 버전 앞 글의 판으로 지금 글을 조기 종료 · M1 주소 없는 글에서 판 ② 진입 불가 | **6건 전부 수용.** 같은 부류 반복 판정 — H1 = 1R H2 와 같은 부류(등록 때만 장치 → 실제 발송은 뒤에 일어남) → **구조: 판이 나가는 두 자리에 발송 관문 하나**(§6-2-1) · H5 = 1R M2 · M3 와 같은 부류(증거를 문안 버전에 묶었는데 버전 안에서 글이 바뀜) → **구조: 증거와 판정을 같은 글 T 에 묶고 기존 보류 꼴로 T 의 판을 기다림**(§7). 새 부류 = H2 → §6-3 고정 키 잠금 아래 셈 · H3 → §12 절차 · H4 → §8-2 M3 접수 행만으로 판정 · M1 → §6-1 · §6-2 자격 함수 하나 |
| 3R(1123 16:57 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | H1 다시 보내기(`spam-probe.ts:131-142`)가 관문 · 되돌리기 정리를 빠져나감 · H2 `getRegisteredCallbackSet` 이 배정 칸 확인 실패를 삼켜 회사 전체 목록으로 내려감(`callback-filter.ts:261-276`) · H3 진단 대기 중 T 가 늦은 보고로 통과해도 4a 반려 · M1 대행이 4c 로 간 뒤 판 ② 가 나감 | **4건 전부 수용.** H1 = 「관문이 빠진 발송 자리」 부류 **세 번째** → 멈추고 왜 반복되나: 부르는 자리를 세어 관문을 붙였기 때문(자리는 읽을수록 더 나온다) → **구조: 확인 판 문자를 적재하는 두 함수(`executeSpamTest` 적재 · `sendProbe`) 안에 관문 하나 + 상태를 닫는 `closeDiagnosis`** · 2R 의 「집는 자리 · 선점 자리」 관문 둘은 지움(덧댄 장치가 사라짐) · 기계 추출 계약 추가. H2 → `strict` 인자(기본값 무변경 · 호출 14곳 0 변화). H3 → 재개 때 T 를 지금 결과로 다시 읽음 · 통과면 통과 갈래 · 막힌 통신사 = 지금 blocked 만. M1 → 대기 아닌 모든 갈래가 나가기 전에 `closeDiagnosis` · 수정 CT 도 닫음. 참고 셋(revision 빈도 · updated_at 창 · 잠금 순서 교착 없음) = §13 에 revision 한 줄 |
| 4R(1123 17:03 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | H1 관문 통과와 적재 사이 · 확인 문자 읽기와 적재 사이에 진단이 닫히면 닫힌 뒤 적재 · H2 되돌리기 ③ 뒤에 넣어진 `claimed` 를 옛 판이 다시 보냄 · M1 문안 수정 커밋 뒤 따로 닫으면 종료 때 참조를 잃음 · M2 T 를 읽은 뒤 4a 확정 사이 통과 회복을 놓침 · (`strict` 판단은 맞다고 확인) | **4건 전부 수용.** H1 · M2 = 「확인과 행동 사이의 틈」 한 부류 → **구조: 같은 잠금 아래에서 영속 상태를 다시 읽고 행동** — 부모 진단 잠금을 닫기와 두 적재 함수가 같이 잡고 MySQL 적재까지 쥔다(§6-2-1) · 닫힘 = 행 상태(영속 · §6-2-2) · 대행 확정 = 접수 행 → T 결과 행 → 진단 잠금 한 트랜잭션(§7 절차 3) · 잠금 순서 하나. M1 → 수정 트랜잭션 안에서 닫기. H2 → §12 ④ 잔존 0 확인 · ③ · ④ 를 `diag_of` 로 찾음. 자체 정정 = 「늦은 보고는 error 행을 안 고친다」는 틀린 주장이라 지움(보고 갱신은 failed 만 지킨다 `routes/spam-filter.ts:589-597`) → 「표시만 통과 · 새 적재 0 · 판정 그대로」 |
| 5R(1123 17:09 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | H1 ④ 확인 뒤 재개된 첫 선점이 `claimed` 를 넣으면 옛 판이 다시 보냄 · M1 대행 확정이 판의 늦은 보고와 직렬화 안 됨 · M2 관문 거부가 이미 통과한 결과를 error 로 덮음 · M3 MySQL 적재 뒤 PG 커밋 전 끊기면 확인 문자 중복 | **H1 · M1 · M2 수용 · M3 불수용.** H1 = 되돌리기 부류 두 번째 → 구조: 절차 순서에 기대지 않고 **늦게 쓰는 문장이 스스로 상태를 본다**(첫 선점 INSERT 조건부 · 일반 검사도 같은 조건). M1 = 4R 「확인과 행동 사이」 부류 두 번째 → 원칙 하나로 못 박음: **판정에 쓰는 행은 전부 잠금 아래 다시 읽는다**(판 결과 행까지 · 잠금 순서 접수 → T → 진단 잠금 → 판 행). M2 → 닫기는 아직 열린 값(`NULL` · `unconfirmed`)만. M3 불수용 근거 = 지금 확인 문자 길과 같은 최소 한 번 성질(`spam-probe.ts:98-104`) · 중복 많아야 1통 · 우리 단말 · 막으려면 공용 적재 CT 를 바꿔야 함 → §13 한계로 기록 |
| 6R(1123 17:14 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | H1 ④ 확인 뒤에 첫 선점이 커밋될 수 있음(READ COMMITTED) · M1 늦게 온 재시도가 먼저 보낸 확인 문자를 만료시킴 · M2 관문 SQL 오류 뒤 같은 트랜잭션에서 닫기 불가 · (5R M3 불수용은 다시 지적 없음 · 늦은 보고와 확정 사이 교착 없음 · `result IS NULL` 이 error 를 지킨다고 확인) | **3건 수용.** H1 = 되돌리기 부류 **세 번째**(4R H2 · 5R H1 · 6R H1) → 멈추고 왜: 일꾼이 도는 채로 정리를 안전하게 하려 했기 때문(잠금 · 조건을 붙일 때마다 새 경쟁) → **더 단순한 길 = 하한 아래 되돌리기는 앱 정지 상태에서만**(5R Codex 권고) → 5R 에 덧댄 조건부 첫 선점은 **지움**(일반 검사 경로 변경도 함께 사라짐 · 정상 운영은 잠금 아래 관문이 같은 일을 한다). M1 → 관문 결과 셋(내 것 아님 = 아무것도 안 씀 · 통과 · 거부). M2 → 관문 조회 앞 저장점 · 연결 끊김은 지금의 정리 · 다시 보내기 길이 다시 데려옴. 자체 보강 = 배포 1 에서 일반 검사 문장에 `diag_of` 0 |
| 7R(1123 17:18 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | M1 스위치(ENV)를 꺼도 실행 중 프로세스는 계속 적재 · M2 연결이 끊긴 검사 문자는 멈춘 검사 정리가 시간 초과로 닫을 뿐 관문 재시도가 없음(설계서 서술이 실제와 다름) | **2건 수용**(둘 다 내 서술이 실제 동작과 어긋남 · 새 장치 0). M1 → 스위치 = ENV + 백엔드 재시작 · 일꾼 둘이 한 프로세스(`app.ts:653-654` · `instances: 1`)라 재시작으로 진행 중 적재가 끝남을 명시. M2 → 검사 문자는 `timeout` 으로 닫히고 다시 안 보냄(진단만 빠짐 · 받아들임) · 확인 문자만 다시 보내기로 관문 재진입 — 두 길을 따로 적음 |
| 8R(1123 17:22 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0) | needs-attention | M1 마지막 시도에서 끊기면 확인 문자는 관문에 다시 안 들어오고 상한 규칙으로 닫힘(서술이 「무조건 재진입」으로 읽힘) · (단일 프로세스 · timeout 이 4a · 4b 근거에서 빠짐은 확인) | **수용**(7R M2 와 같은 「서술 ≠ 실제 동작」 부류 · 새 장치 0) → 시도 여유 있으면 재진입 · 상한이면 지금 규칙대로 `expired` + `error` 로 적고 §11 에 마지막 시도 끊김 줄. Codex 가 범위 밖이라 못 본 다른 앱은 직접 grep(`outreach-render-worker.ts` 적재 참조 0)해 §11 에 적음 |
| **9R(1123 17:24 · 같은 설정 · 로그 대조 = gpt-6.2-sol · high · 하위 0)** | **approve** | 지적 0(「No material findings」) · 확인 문자 재시도 · 상한 서술과 `outreach-render` 적재 참조 0 을 소스와 대조해 맞다고 확인 | **설계 리뷰 닫힘.** 9라운드 지적 합계 33건(수용 32 · 불수용 1 = 5R M3 확인 문자 중복 · 근거 §13 · 다시 지적 없음) · 같은 부류 반복에서 구조로 바꾼 것 넷 = 발송 관문을 적재하는 두 함수 안으로(3R) · 같은 잠금 아래 다시 읽고 행동(4R · 5R) · 증거와 판정을 같은 글에(2R) · 하한 아래 되돌리기는 앱 정지 상태에서만(6R · 덧댄 조건부 첫 선점 지움) |

---

## 부록 A. 후보 비교 (확정 전 · 요약)

| | A 추정 | B 확인 시험 | **C 합침(확정)** |
|---|---|---|---|
| 추가 문자 | 0 | 후보 수만큼 | 통신사마다 최대 2 |
| 말할 수 있는 것 | 「의심」 | 「빼니 도착」 | 둘 다 · 구분 |
| 약점 | 통신사 기준이 아님 · 회사 쏠림 | 무엇을 뺄지 모르면 통수 큼 | 조합 차단은 4c |

## 부록 B. 데이터 확인 SQL (읽기만 · 실행 = §3)

```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT CASE WHEN t.created_at >= '2026-11-01' THEN 'after_1101' ELSE 'before_1101' END AS era, r.carrier, COALESCE(r.result,'none') AS result, COUNT(*) AS n_rows, COUNT(DISTINCT t.company_id) AS companies, MIN(t.created_at)::date AS first_day, MAX(t.created_at)::date AS last_day FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id GROUP BY 1,2,3 ORDER BY 1,2,3;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT r.carrier, COUNT(*) AS blocked_rows, COUNT(*) FILTER (WHERE COALESCE(t.message_content_lms, t.message_content_sms, '') <> '') AS blocked_with_text, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM spam_filter_test_results r2 JOIN spam_filter_tests t2 ON t2.id = r2.test_id WHERE t2.company_id = t.company_id AND t2.callback_number = t.callback_number AND r2.carrier = r.carrier AND r2.result = 'pass' AND COALESCE(t2.message_content_lms, t2.message_content_sms, '') <> '' AND t2.created_at < t.created_at AND t2.created_at > t.created_at - interval '90 days')) AS has_prior_pass FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id WHERE r.result = 'blocked' AND t.created_at >= '2026-11-01' GROUP BY 1 ORDER BY 1;"
```
```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "(SELECT t.created_at, t.callback_number, string_agg(r.carrier || '=' || COALESCE(r.result,'none'), ' ' ORDER BY r.carrier) AS carriers, COALESCE(t.message_content_lms, t.message_content_sms) AS body FROM spam_filter_tests t JOIN spam_filter_test_results r ON r.test_id = t.id WHERE t.company_id = (SELECT company_id FROM agency_send_requests WHERE id::text LIKE 'a7456c31%') AND t.created_at >= '2026-11-22' GROUP BY t.id) UNION ALL (SELECT t.created_at, t.callback_number, 'KT=pass prior' AS carriers, COALESCE(t.message_content_lms, t.message_content_sms) AS body FROM spam_filter_tests t JOIN spam_filter_test_results r ON r.test_id = t.id WHERE t.company_id = (SELECT company_id FROM agency_send_requests WHERE id::text LIKE 'a7456c31%') AND r.carrier = 'KT' AND r.result = 'pass' AND t.created_at < '2026-11-22' ORDER BY t.created_at DESC LIMIT 1) ORDER BY 1;"
```
