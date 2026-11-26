# 스팸 확인 판 「바꾸기」 재설계 설계서 (2026-11-25 · 브레인스토밍 수렴안 · Harold 「이 안으로 진행」 · 「그렇게 고쳐」 · 구현 전)

- 기준 설계 = `docs/2026-11-23-spam-block-cause-hint-design.md`(배포 1 ~ 4 운영 중 · 이하 「앞 설계서」). 이 문서는 앞 설계서의 §6(B 확인 판 내용) · §7 4a · 4b · §8-1 D2 · §8-4 판 문구를 바꾼다.
- 그대로 쓰는 것 = A(앞 §5 의심 부분) · 발송 관문(앞 §6-2-1) · 진단 닫기(앞 §6-2-2) · 회사 스위치(`companies.spam_diag_enabled`) · 등록 잠금 · 상한 셈 자리 · 확인 문자 1분(배포 4) · 대행 진단 대기 틀(앞 §7).
- 회의 기록 = 공유 노트 `spam-diag-brainstorm-agenda.md` · `-round1.md` · `-converged.md`(§18).
- 판 1 → 판 2: Harold 「hlj.kr 로 어떻게 변환시켜 줄껀데? 그걸 니가 자동으로 해주겠다고? 그리고 고객사가 어쨌든 그걸 오케이 해야되는거잖아?」 → **주소 바꾸기는 고객이 누른 뒤에만 · 원래 주소를 그대로 감싼다(목적지 알아내기 0)** + Codex 설계 1R 지적 반영(§18).

---

## §0 확정 요약

- Harold 원문 「저 주소를 보내서 들어오게 하는게 핵심중에 하나인데 주소를 빼라고 하거나 혜택을 빼라고 하거나 이러면 문자 뭐하러 보내냐?」 → 확인 판 = 「뺀 글」이 아니라 **목적(주소 · 혜택)을 지킨 채 바꾼 글**. 고객이 받는 것 = **막힌 통신사 도착이 확인된 고친 글 + 1클릭 받기**.
- 판 = 글당 최대 3판 · 판 하나를 **막힌 통신사 전부에 함께** 보냄 · 전부 도착한 첫 판에서 멈춤(§5).
  - 자동 = AI 가 **표현만** 바꾼 판(검사 단말에만 · 고객 글 · 고객 계정 무변경).
  - **주소 바꾸기는 고객 OK 를 거친다.** 직접발송 = 표현 판이 막히고 글에 주소가 있으면 멈추고 묻는다 → 고객이 [주소도 바꿔서 확인]을 누를 때만 `hlj.kr` 짧은 주소(고객이 쓴 원래 주소를 그대로 가리킴)를 만들고 그 판을 보낸다. 대행 = 화면 앞에 고객이 없으므로 주소 판까지 자동으로 돌리고, **승인 문자(로그인 없는 1클릭)가 동의 자리**다 — 승인 전에는 바뀐 글이 받는 사람에게 한 통도 나가지 않는다(Harold 1125 「대행발송도 카바쳐줄 수 있어야」).
- 혜택은 기계로 지킨다 — 원문의 숫자(이번 달 표현 포함 · 같은 숫자 여러 번이면 각각) · 날짜 · 시각 · 전화 · 변수 · 주소가 사라지거나 새로 생기면 그 판은 버린다(§6).
- AI 에는 **고칠 줄만** 보낸다(첫 수신자 값이 든 줄 · 법정 줄은 서버에 남기고 복원 · §6-2).
- 진행 = 서버가 이어 돌린다(창 닫아도 계속 · §8). 판 행에 소유 · 닫힘 · 끝 사유를 남겨 잠금 아래에서 본다.
- 받기 = 직접발송 [이 글로 바꾸고 다시 검사] 1클릭(바꿈 목록을 줄 위치로 지금 작성 칸 글에 적용 → 3사 일반 검사) · 대행 = 판이 닿으면 그 글로 3사 검사 → 통과면 기존 승인 문자 + 바꾼 곳 줄(표현 · 주소 · 담당자 1클릭 = 동의 · 메일 접수 고객도 같은 문자 · §9).
- 4a(「주소를 바꿔 주세요」로 멈춤)는 없앤다.
- 실측(1125 Harold · KT · §3): 「혜택」 막힘 재현 · tinyurl 한 줄 막힘 · `hlj.kr` · `app.hanjul.ai/c` 통과 → 폴라초이스 글 = 「혜택」 + tinyurl 두 곳.
- 회사 스위치(기본 꺼짐) = 미가입 · 직접발송만 쓰는 회사 동작 변화 0(§13). 단 「사라진 숫자」 검사는 스위치와 무관한 대행 다듬기 결함 고침(§13 명시).

---

## §1 접수 대조표

| 접수(Harold 원문) | 맡는 축 | 없으면 |
|---|---|---|
| 「저 주소를 보내서 들어오게 하는게 핵심」 | 주소는 빼지 않는다 · 막히면 같은 곳으로 가는 짧은 주소로 바꾼 판(§7) | 지금 판 ① = 주소를 뺀 글 → 「주소를 바꿔 보세요」(고객 숙제) |
| 「혜택을 빼라고 하거나 이러면 문자 뭐하러 보내냐」 | 혜택 줄을 빼지 않는다 · 표현만 바꾼 판 + 숫자 · 날짜 · 주소 소실 검사(§6) | 지금 판 ② = 숫자 든 줄(혜택 줄)을 뺀 글(`spam-block-hint.ts:178-184`) |
| 「결국 답을 못찾네」 | 판이 쌓아서 바꾼다(주소 판 = 표현 판 본문 위에 주소) · 결과 = 보낼 수 있는 고친 글(§5) | 오늘 폴라초이스 = 두 곳이 막는데 한쪽만 빼는 판 둘이 다 막힘 |
| 「hlj.kr 로 어떻게 변환 · 자동으로? · 고객사가 오케이 해야」 | 짧은 주소는 기존 「내 단축 주소」 CT 로 원래 주소를 그대로 가리키게 만든다 · 직접발송 = **고객 클릭 뒤에만** 만든다 · 대행 = 바뀐 글은 **승인 문자 1클릭 뒤에만** 나간다(§7 · §8 · §9-2) | 고객 동의 전에 고객 글이 바뀌어 나간다 |
| 「대행발송도 카바쳐줄 수 있어야」 | 대행은 주소 판까지 자동 · 승인 문자(로그인 없음)가 동의 자리 · 메일 접수 고객도 같은 길(§5-1 · §9-2) | 대행은 표현 판만 자동이라 「혜택」 + tinyurl 같은 글이 안 풀리고 메일 접수 고객은 로그인 단추를 못 쓴다 |
| 「오늘 힘들게 업데이트한게 무쓸모」 | 배포 1 ~ 4 의 관문 · 닫기 · 상한 · 스위치 · 1분 확인 문자 · A 를 그대로 쓰고 판 내용 · 순서 · 받기만 바꾼다(§12) | — |
| 「브레인스토밍해서 제대로 해야지」 | 다섯 역할 회의 · 교차 · 회의론자 검증 · Codex 설계 리뷰(§18) | — |

빠진 축 0.

---

## §2 지금 구조 (바뀌는 자리 · 코드에서 읽은 사실)

| 무엇 | 지금 | 자리 |
|---|---|---|
| 판 만들기 | `makeDiagVariant(sentText, 1 \| 2)` = 빼기만 | `spam-block-hint.ts:144-199` |
| 판 순서 · 코드 | `diagNextVariant` 통신사마다 1 → 2 · 코드 = 통신사 머리 글자 + 번호 · 유일 = (diag_of, variant_id) | `spam-diag.ts:32-35` · `:124-130` |
| 등록 | `registerDiag` → `enqueueSpamTest` `diag{ carrier 하나 · guard }` · 부모 그 통신사 결과 행 FOR UPDATE → 진단 잠금 → guard → 고정 키 → 같은 판 → 상한 셈 → INSERT … ON CONFLICT | `spam-diag.ts:220-264` · `spam-test-queue.ts:819-880` |
| 판 읽기 | `readDiagChecks` · `diag_of` · `source` 만으로 읽고 `variant_id.endsWith('2')` 면 ② · 그 밖 ① | `spam-diag.ts:102-121` |
| 대행 소유 | `agencyOwnsDiag` = 사건 `spam_hint` 유무 · 대행은 **첫 판 등록 뒤에** 사건을 남긴다 | `spam-diag.ts:377-380` · `agency-spam-diag.ts:108-117` |
| 진단 닫기 | 이미 있는 판만 닫는다(닫힘 표시 0) | `spam-diag.ts:295-330` |
| 화면 입구 | `POST /api/spam-filter/tests/:id/diagnose { carrier, variant }` | `routes/spam-filter.ts:945-977` |
| 대행 | `startAgencyDiag` → `stepAgencyDiag` → `classifyDiag` · 그 밖 갈래 = `releaseAgencyDiag`(진단 대기 지우고 닫기 커밋) 뒤 `resume`(본문만) | `agency-spam-diag.ts:99-174` · `:232-252` · `agency-send-worker.ts:1086-1101` · `:440-450` |
| AI 다듬기 | `refineForSpam` = 원문 전체를 외부 모델 요청에 싣는다 · 검사 = 앵커 · 지어낸 혜택 · 새 숫자 · 효능 · 사라진 숫자는 안 본다 | `agency-send-refine.ts:47-93` · `:127-135` · `:165-179` |
| 새 숫자 판정 | `findNewNumbers(output, source)` = output 쪽의 이번 달 「N월」을 먼저 지운다 | `copy-benefit-detector.ts:601-612` |
| 짧은 주소 CT(hlj.kr) | `createCustomShortLink`(자기 `query` · 회사 하루 50 · 크레딧은 라우트가 따로) · `validateCustomShortLinkUrl` · `discardCustomShortLink`(행을 지움 = 상한 칸 돌려받음) | `utils/dm/dm-custom-short-link.ts:78-108` · `:239-241` · `dm-custom-short-link-core.ts:44-78` |
| 검사 글(직접발송) | 작성 칸 글 + (광고) · 080(`buildAdMessageFront`) → 첫 수신자 값 치환 | `DirectSendPanel.tsx:351-363` |
| 검사 창 띄우기 | Dashboard 가 `spamFilterData` 로 띄움 · 작성 칸에 넣는 콜백 없음 | `Dashboard.tsx:2336-2347` |
| 대행 문안 수정 | `editAgencyContentTx({ change: { kind: 'text', content, subject } })` | `agency-send-change.ts:86-94` |
| 대행 통과 문자 | `buildPassedNotify` | `agency-send-notify.ts:77-108` |
| 대행 결과 메일 | test_failed · 메일 접수만(통과 메일 없음) | `agency-send-mail-worker.ts:1391-1399` |
| 대행 화면 문구 | 「날짜와 번호, 링크는 그대로입니다」 · 막힘 상자 | `AgencySendDetail.tsx:302-323` · `:422` |

---

## §3 실측 근거 (Harold 실행 · 테스트계정 · 발신번호 1800-8125 · LMS · KT 판정은 확인 문자 확정)

| # | 본문(법정 줄 같음) | SKT | KT | LG U+ | 언제 |
|---|---|---|---|---|---|
| 1 | (광고) 폴라초이스 / 무료 수신거부 : 080-139-5626 (= 최소 글) | 통과 | 통과 | 통과 | 1125 새벽 |
| 2 | 최소 글 + 「[공식몰 단독 혜택]」 | 통과 | 막힘 | 통과 | 1125 새벽 |
| 3 | 최소 글 + 「[공식몰 혜택]」 | 통과 | 막힘 | 통과 | 1125 새벽 · 오전 재현 |
| 4 | 최소 글 + 「[공식몰 단독]」 | 통과 | 통과 | 통과 | 1125 새벽 · 오전 재현 |
| 5 | 최소 글 + 「[공식몰]」 | 통과 | 통과 | 통과 | 1125 새벽 |
| 6 | 최소 글 + `https://tinyurl.com/38jyr7s7` | 통과 | 막힘 | 통과 | 1125 오전 |
| 7 | 최소 글 + `https://hlj.kr/Ae1qew`(없는 코드) | 통과 | 통과 | 통과 | 1125 오전 |
| 8 | 최소 글 + `https://app.hanjul.ai/c/Ae1qewXy`(없는 해시) | 통과 | 통과 | 통과 | 1125 오전 |
| 9 | 원래 글(tinyurl 2 · 혜택 목록 · 영문 줄)에서 「혜택」 두 곳만 뺀 글 | 통과 | 막힘 | 통과 | 1125 새벽 |
| 10 | 확인 판 K1(주소만 뺌 · 「혜택」 남음) · K2 | — | 둘 다 막힘 | — | 1125 새벽 |

- 결론(기록으로 확인된 범위): 이 회사 · 번호 · KT 에서 「혜택」 낱말과 tinyurl 주소가 **각각** 막는다 · 같은 글 = 같은 결과(재현 2/2) · 한줄로 두 짧은 주소 도메인은 통과.
- 미검증: 7 · 8 은 열리지 않는 경로 · KT 가 주소를 열어 넘어가는 곳까지 보는지는 모른다 → hlj.kr → tinyurl 로 이어지는 실제 주소가 통과하는지는 운영 판이 잰다(§16).

---

## §4 흐름 표 — 이음매 · 판정 자리 · 값 범위 · 그리는 화면

| # | 이음매 | 판정 자리(새 · 바뀜) | 값 범위 | 그리는 화면 |
|---|---|---|---|---|
| F1 | 차단 확정 | `spam-probe.ts`(무변경) | 결과 행 result ∈ pass · unconfirmed · blocked · failed · timeout · error · NULL — 찾기는 `blocked` 통신사만 | — |
| F2 | 의심 부분(A) | `rankSuspects`(무변경) | 통신사마다 후보 0 ~ N | 카드 근거 줄 · avoid 씨앗 |
| F3 | 찾기 자격 | `diagEligibility`(바뀜: 막힌 통신사 집합 · 다음 판 종류 · 소유) | 가능 · off · diag_parent · not_blocked · not_sendable · no_editable(새) · no_variant · permission · cap · owned(새 · 다른 쪽 소유) · closed(새) | 카드 단추 · 사유 줄 |
| F4 | 고칠 줄 | 새 `editableLines(sentText, template)`(순수) | 줄마다 고칠 수 있음(원문 줄 위치 · 몇 번째 같은 줄) · 고정(법정 · 원문에 없는 줄 · 변수 칸 든 원문 줄 · 빈 줄) · 고칠 줄 0 | — |
| F5 | 판 상태 · 다음 | 새 `classifyRewrite(plates)`(순수) | wait · found(판) · next(종류) · ask_url(사람이 고름) · end(못 찾음 · 사유) · end_unknown(확인 못 함) · closed | 카드 진행 · 결과 · 단추 |
| F6 | 표현 판 글 | 새 `buildWordingPlate`(AI 호출 · 잠금 밖) + `refineForSpam`(새 인자 `editable` = 고칠 줄만 보냄 · 고정 줄 복원) + `checkRefined`(⑤ 사라진 숫자 `findLostNumbers` · ⑥ 고정 줄 보존) | 만듦 · 못 만듦(model-error · 검사 버림 · 바뀐 곳 0) → 다음 종류 또는 끝(판 행 `ended` 기록) | — |
| F7 | 주소 판 | 새 CT `utils/spam-link-swap.ts` · 직접발송 = **고객 클릭으로만** · 대행 = 자동(동의 = 승인 문자) · 등록 트랜잭션 안에서 링크 만들기 | 바꿈 · 못 바꿈(http(s) 아님 · 검증 실패 · 회사 하루 50) | 「주소는 바꾸지 못했어요」 |
| F8 | 등록 | `enqueueSpamTest` `diag{ carriers[] · prepare(run) }`(바뀜) · 판 행 `diag_plan`(새 칸) | 판 행 1 · 결과 행 = 대상 통신사 수 · 차감 0 · variant R1 ~ R3 · 대상 = 잠금 아래 부모가 아직 blocked · 0 = 등록 0 · 소유 · 닫힘 대조 | 대기열 앞사람 수(무변경) |
| F9 | 이어 돌리기 | 새 일꾼 `runSpamRewriteCycle`(직접발송 · 표현 판만) · `stepAgencyDiag`(대행 · 표현 판만) | next 일 때만 등록 · ask_url 은 등록 0 · 못 만들면 `ended` 기록 | — |
| F10 | 받기(직접발송) | 새 `POST /tests/:id/fix-apply` · `applySpamFixes(current, fixes)`(순수 · 서버 한 곳) | 적용 글 · 사유(위치 · 유일 일치 실패) · 화면이 SMS 바이트 재기 | 카드 단추 · 토스트 · 작성 칸 · 재검사 |
| F11 | 받기(대행 자동) | `decide` 새 갈래 found → 닫는 트랜잭션에서 `diagFix` 저장 → resume(본문) → 3사 일반 검사 | 통과 · 막힘 · 확인 중 · 장애 재시도(diagFix 로 이어받음) · 적용 실패 = 4c | 승인 문자 바꾼 곳 줄 · 진행 기록 `spam_fixed` |
| F12 | 문구 | 정본 문구 표 한 곳(`spam-diag.ts`) · 화면은 서버 문장만 | §10 | 전부 |

---

## §5 판 짜임

### 5-1 판 종류 · 순서

| 종류 | 본문 | 주소 | 제목 | 누가 시작 |
|---|---|---|---|---|
| w1 | AI 1회차(표현만 · 구성 유지) | 원래 | 원래 | 자동(직접발송 = 찾기 단추 · 대행 = 첫 막힘) |
| w1u | w1 본문 그대로 | 고칠 줄의 주소를 짧은 주소로 | 원래 | 직접발송 = **고객 클릭** · 대행 = 자동(동의 = 승인 문자) |
| w2 | AI 2회차(새로 씀) | 앞에서 바꾼 주소면 그 짧은 주소 · 아니면 원래 | 직접발송 = AI 가 바꿈(고칠 수 있는 제목일 때) · 대행 = 원래 | 자동 또는 고객 클릭(아래) |
| w2u | w2 본문 그대로 | 짧은 주소 | w2 그대로 | 직접발송 = **고객 클릭** · 대행 = 자동 |

- 순서(순수 `classifyRewrite`):
  - 글의 고칠 줄에 주소가 없음 → w1 → w2 자동.
  - 주소가 있음(직접발송) → w1 자동 → 막히면 **ask_url**: [주소도 바꿔서 확인](w1u) · [주소는 그대로 두고 글을 새로 써서 확인](w2) 둘 중 고객이 누름 → w1u 가 막히면 w2(짧은 주소 유지) 자동 · w2 가 막히고 주소가 원래면 다시 ask_url(w2u 만).
  - 주소가 있음(대행) → w1 → 막히면 w1u → 막히면 w2(짧은 주소 유지) 모두 자동 · 동의 = 찾은 글로 3사 검사를 통과한 뒤 나가는 승인 문자의 1클릭(§9-2 · Harold 1125 「대행발송도 카바」).
  - 못 만든 종류는 건너뛰고 다음 종류 · 판 행 = 실제 보낸 판만 R1 · R2 · R3(보낸 순).
- 원칙: 우리 짧은 주소는 **AI 가 고친 본문에만**(1122 bit.ly) · 바뀐 글은 **고객 OK 뒤에만 받는 사람에게**(직접발송 = 클릭 · 대행 = 승인 문자 · Harold 1125).

### 5-2 보내는 곳 · 멈춤

- 대상 = 등록 트랜잭션 잠금 아래 **부모 결과가 지금 blocked 인 통신사 전부**(늦은 보고로 통과가 된 통신사는 빠진다 · 0 이면 등록 0 = 진단 끝).
- 찾음 = 한 판이 그 대상 전부에서 pass 확정 → 그 판 = 고객이 받을 글 하나.
- 다음 = 그 판 결과가 전부 확정(pass · blocked)이고 blocked 가 하나 이상.
- 끝(확인 못 함) = 그 판 결과에 failed · timeout · error 가 하나라도 있음(판을 더 보내지 않는다).
- 끝(못 찾음) = 다음 종류를 못 만들었음 · 3판 소진. **다음 종류를 못 만들면 마지막 판 행 `diag_plan.ended = { reason, at }` 를 잠금 아래 기록**(Codex 1R · 다음 주기가 같은 AI 호출을 되풀이하지 않는다).
- 판이 하나도 안 만들어진 시작 실패(w1 못 만듦)는 응답으로만 알린다(판 행이 없다 · 다시 누르면 다시 시도 = 사람 클릭만큼).

### 5-3 상한 · 시간

- 부모마다 3판(R1 ~ R3 = 유일 인덱스 + 판 코드) · 발신번호 하루 10판 · 전체 하루 100판(셈 = 판 행 수 · `spam-test-queue.ts:839-848` 그대로).
- 시간 = 판마다 대기열 + 60초 창 + 1분 확인 문자 ≈ 2 ~ 3분(1125 운영 00:37 시작 → 00:39:32 확인 문자 도착) · 대행 = 주기 5분이라 판마다 다음 주기 · 진단 대기 30분 안.
- 판 대기 상한 = 관문 15분(`spam-diag-gate.ts:20`) 그대로.

---

## §6 고칠 줄 · 바꾼 글

### 6-1 고칠 수 있는 줄 (`editableLines` · 순수 · Codex 1R)

- 보낸 글(sentText) 줄 중 아래를 **모두** 만족하는 줄만 고친다(규칙 하나 · Codex 2R 뒤 줄임).
  1. 원문(template)에 같은 줄이 글자 그대로 있다(같은 줄이 여러 번이면 k번째 ↔ k번째 · 원문 줄 위치 `tplLine`).
  2. 그 원문 줄에 변수 칸(`%…%`)도 Liquid 식(`{{` · `{%`)도 없다(변수 칸이 든 줄은 보낸 글에서 값이 들어가 글자가 달라지므로 1 에서도 빠지지만 규칙으로 한 번 더 · Liquid 식 안의 글 · 주소는 AI 도 주소 바꾸기도 건드리지 않는다 · Codex 6R).
  3. 법정 줄(`tokenizeSpamText` legal)이 아니고 빈 줄이 아니다.
- 원문: 대행 = `hold.content`(서버가 가진 그 문안 버전 글 · 서버 근거). 직접발송 = 찾기 시작 요청이 싣는 지금 작성 칸 글 · 제목(변수 칸 그대로).
- **직접발송 신뢰 경계(Codex 1R · 2R 같은 부류 두 번 = 구조 답)**: 직접발송 사람 검사는 화면이 변수를 채운 글을 보내고 서버는 받은 글만 저장한다(`DirectSendPanel.tsx:351-363` 치환 · `routes/spam-filter.ts:266-270` INSERT 에 `first_recipient` · 원문 칸 없음) → 서버가 가진 치환 전 원문은 없다. 그것을 만들려면 미가입 · 직접발송 회사의 검사 생성 길(화면 치환 · 저장 · 최근 검사 해시)을 바꿔야 해 §13 의 동작 변화 0 을 깬다. 그래서 직접발송은 **로그인한 그 사용자의 작성 칸 글**을 원문으로 받고, AI 호출은 그 사용자가 [찾기]를 누른 뒤에만 한다. 정직한 화면에서 변수 값이 든 줄은 원문(변수 칸)과 글자가 달라 고정되고, 변수 칸 없는 줄에는 수신자 값이 들어갈 자리가 없다. 화면을 위조해 치환 글을 원문으로 보내는 경우는 그 고객 데이터의 주인 회사 사용자 본인이 일부러 보내는 경우뿐이다. 서버 표본(`first_recipient`) 대조는 직접발송 사람 검사에 그 값이 저장되지 않아 근거가 되지 못하므로 지운다.
- 고칠 줄 0 = 자격 no_editable.
- 원문 · 고칠 줄 위치는 판 행 `diag_plan` 에 저장(다음 판 · 받기가 같은 원문).

### 6-2 표현 판 (w1 · w2 본문 · w2 제목)

- **AI 에 보내는 글 = 고칠 줄만**(줄마다 번호 · 고정 줄은 보내지 않음 · 변수 값이 든 줄 · 법정 줄 외부 전송 0 · Codex 1R · 근거 = §6-1). 출력 = 같은 번호의 줄 → 서버가 보낸 글의 그 줄 자리에 넣어 판 글을 복원한다. 번호 · 줄 수가 어긋나면 버림.
- `refineForSpam` 새 인자 `editable: string[]`(있으면 그 줄들만 프롬프트 · 꼴 검사 · 결과 복원) · 없으면 지금 그대로(대행 다듬기 루프 무변경).
- 검사(`checkRefined` 공용 · 판 글 전체 기준 · 대행 다듬기에도 적용 · §13):
  1. 앵커 보존(지금) 2. 지어낸 혜택(지금) 3. 새 숫자(지금) 4. 효능(지금)
  5. **새 — 사라진 숫자** `findLostNumbers(original, refined)`(새 export · `copy-benefit-detector.ts`): 값 정규화는 `findNewNumbers` 와 같은 함수를 공유 · **이번 달 「N월」 예외 없음** · **여러 번 나온 숫자는 개수까지**(원문 3번 = 출력 3번 이상). 하나라도 줄면 버림(「35% OFF」 줄 삭제 · 「11월 회원 한정」→「회원 한정」 모두 버림).
  6. **새 — 고정 줄 보존**: 판 글의 고정 줄이 보낸 글과 글자 그대로(복원 방식이라 구조상 같음 · 검사로 한 번 더).
- avoid = A 의 의심 조각(대상 통신사 전부) 중 숫자 · 주소가 아닌 것(`spam-block-hint.ts:218-219` 와 같은 거르기) · 고칠 줄에 있는 것만.
- 제목(w2 · 직접발송만): 고칠 수 있는 제목(원문 제목이 보낸 제목에 글자 그대로 · 수신자 값 0)일 때만 같은 함수로 한 줄 · 검사 1 ~ 5 를 따로 · 실패면 제목 그대로. **대행은 제목을 바꾸지 않는다**(Codex 1R · 대행 다음 검사 · 승인이 본문만 잇는다).
- 고칠 줄에서 바뀐 곳 0 = 그 종류 못 만듦.
- 과금 = 0 · `ai_call_log` 원가 기록만(새 source `spam-diag-rewrite` · CREDIT_COST_MAP 미등록 = 0).

### 6-3 바꿈 목록 (fixes)

- `[{ field: 'body' | 'subject', tplLine, before, after, kind: 'text' | 'url' }]` · `tplLine` = 원문 줄 위치 · before = 그 위치의 원문 줄(= 보낸 글의 고칠 줄).
- 판 행 `diag_plan.fixes` 에 저장 · 카드 · 받기 · 대행 · 승인 문자가 이 목록 하나를 쓴다.

---

## §7 주소 바꾸기 (새 CT `utils/spam-link-swap.ts` · 고객 클릭으로만)

- 대상 = 고칠 줄 속 `http://` · `https://` 주소(스킴 없는 주소 · 한줄로 자기 주소는 대상 아님 · 못 바꿈).
- **목적지 알아내기 0** — 짧은 주소는 **고객이 쓴 원래 주소를 그대로** 가리킨다(누르면 hlj.kr → 원래 주소 → 그 뒤는 원래 주소가 하던 그대로). 그래서 「같은 곳으로 간다」는 구조로 성립하고 바깥 호출 0(Codex 1R high · HEAD 펼치기 삭제).
- 검사 = `validateCustomShortLinkUrl(원래 주소)` 통과만(인증 정보 · 자기 도메인 · 내부망 · IP · 점 없는 호스트 거부).
- 만들기 = 등록 트랜잭션 안(Codex 1R · 판을 못 만들면 링크도 없다): `enqueueSpamTest` 의 diag 갈래에 새 `prepare(run)` — 잠금 · 상한 · 소유 대조를 지난 뒤 INSERT 직전에 불러 `createCustomShortLink({ …, run })`(새 선택 인자 `run` · 기본 = 지금 `query` · DM 소비처 무변경)로 링크를 만들고 판 글 · `diag_plan.urls` 를 돌려준다 → INSERT 가 충돌 · 실패하면 같은 ROLLBACK 으로 링크도 사라진다(하루 50 칸 소모 0).
- **링크 만들기의 모든 문장 = 같은 `run`**(Codex 2R · 잠금을 쥔 채 풀에서 새 연결을 기다리지 않는다): `issueUniqueCode` 의 세 테이블 중복 조회도 `run` 으로(새 선택 인자 · 기본 `query`). 코드 충돌(23505 · `dm_custom_short_links_code_key`)은 그 등록 트랜잭션을 되돌려 판 없음으로 끝낸다(난수 코드라 드묾 · 화면 「주소는 바꾸지 못했어요」). 세 테이블에 걸친 코드 유일성은 지금 규칙(발급 때 세 테이블 미사용 확인 + 커스텀 표 UNIQUE) 그대로.
- 한 부모에서 같은 원래 주소는 한 번만: 앞 판 `diag_plan.urls` 에 그 주소가 있으면 그 짧은 주소를 다시 쓴다(새로 만들지 않는다).
- 링크 title = 「스팸 검사에서 바꾼 주소」 · 라우트를 거치지 않아 크레딧 0 · 회사 「내 단축 주소」 목록에 남아 고객이 보고 끌 수 있다.
- **도메인 = hlj.kr(추천)** · 근거: 둘 다 KT 통과(§3 7 · 8) · hlj.kr 이 ① 짧다(`https://hlj.kr/` + 코드 · `https://app.hanjul.ai/c/` + 해시 8자 = 32자 · SMS 90바이트) ② 입구 검증 · 하루 상한이 그 CT 에 있다 ③ 고객이 목록에서 보고 끌 수 있다.
- 받은 뒤 클릭 수는 원래 주소가 아니라 hlj.kr 쪽에 먼저 잡힌다(원래 주소가 단축 서비스면 그쪽에도 그대로 잡힌다 · 거쳐 가므로) → 받기 화면 한 줄.

---

## §8 진행 · 소유 · 닫힘 (서버가 이어 돌린다)

- **소유 · 닫힘 = 판 행에 영속**(Codex 1R high · 새 표 0): 모든 판 행 `diag_plan.owner` ∈ `screen` · `agency`. 등록 트랜잭션은 부모 진단 잠금 아래에서 ① 그 부모의 기존 판 중 다른 소유가 있으면 거부(owned) ② `diag_plan.closed = true` 인 판이 있으면 거부(closed) ③ 화면 소유 등록은 지금처럼 `agencyOwnsDiag` 도 함께 본다(`guard`). `closeDiagnosis` 는 같은 잠금 아래 그 부모 판 전부에 `closed = true` 를 쓴다(지금 결과 · 확인 문자 닫기와 같은 문장 묶음). 대행은 첫 판 행에 `owner = agency` 를 같은 트랜잭션으로 남겨 소유가 사건보다 먼저 행에 선다.
- 직접발송 시작 = 카드 [주소와 혜택은 그대로 두고 닿는 글 찾기] → 새 `POST /api/spam-filter/tests/:id/rewrite { body, subject }`(`authenticate` · `demoBlock` · 사용자 범위 = 지금 `/diagnose` 와 같은 판정) → 자격 → w1(AI · 잠금 밖) → 등록. 옛 `POST /diagnose` 는 지운다.
- 고객 클릭 = 새 `POST /tests/:id/rewrite/next { choice: 'url' | 'rewrite' }` → 자격 + `classifyRewrite` = ask_url 일 때만 → w1u(또는 w2u) · w2 등록.
- 이어 돌리기 일꾼(새 `runSpamRewriteCycle` · 30초 · 단일 실행 가드 · `app.ts` 일꾼 줄): 화면 소유 · 닫히지 않음 · 스위치 켜짐 · `classifyRewrite` = next(**표현 판만** · 주소 판은 사람 클릭만) → 판 만들기(AI · 잠금 밖) → 등록(잠금 아래 소유 · 닫힘 · 직전 판 상태를 다시 대조 · ON CONFLICT) · 못 만들면 `ended` 기록.
- 대행 = `startAgencyDiag` 가 w1 등록 · `stepAgencyDiag` 의 register_v2 자리를 「다음 표현 판」으로 일반화 · 30분 넘으면 4c 그대로.
- **대행 진단 대기 되찾기(Codex 2R · 첫 판 등록과 대기 저장 사이 장애)**: 대행 판 행 `diag_plan` 에 `{ requestId, version, rounds, content }` 를 싣는다. 워커가 접수를 집을 때 `diagHoldOf(row)` 가 없으면 `recoverAgencyHold(row)` = 그 접수 · 지금 버전의 대행 소유 R 판이 있고 닫히지 않았으면 그 판들로 대기를 되살린다(행 잠금 없는 읽기 · 대기 글 = 첫 판 `diag_plan.template.body` · 시작 시각 = 첫 판 `created_at` · 30분 상한이 그대로 걸린다 · 저장은 지금 토큰 기반 `settleDiagHold` 길). 같은 트랜잭션에 묶지 않는 이유 = 잠금 순서(접수 행 → T 결과 행 → 진단 잠금)를 등록 트랜잭션(부모 결과 행 → 진단 잠금 → 고정 키)이 거꾸로 잡게 된다 · 상태에서 다시 찾아내는 패스는 지금 결과 메일 재시도와 같은 꼴.

---

## §9 받기 · 확정

### 9-1 직접발송

- 찾음 → 카드 = 바꿈 목록(원래 → 바꾼) + [이 글로 바꾸고 다시 검사].
- 누름 → `POST /tests/:id/fix-apply { body, subject }`(지금 작성 칸) → 서버 `applySpamFixes(current, template, fixes)`(Codex 1R · 2R · 위치 대조):
  - 지금 글 = 저장한 원문(`diag_plan.template`)과 글자 그대로 같으면 = `tplLine` 위치로 바꾼다.
  - 다르면 = 바꿈마다 before 와 같은 줄이 **원문에도 딱 하나 · 지금 글에도 딱 하나**일 때만 그 줄을(줄이 옮겨 가도 같은 줄로 확정됨) · 하나라도 아니면 사유 「글이 바뀌어 넣을 수 없어요」.
- 화면 = SMS 바이트 재기(`measureSmsBytes`) · 넘으면 사유 → 작성 칸 · 제목 교체 → 토스트 → 검사 창이 그 글로 일반 검사 시작(지금 [다시 검사] 와 같은 길 · 요금 같음 · 잰 글 = 나갈 글).
- 단추는 검사 창을 여는 곳이 `onApplyFix` 를 넘길 때만(직접발송 · 타겟 발송 = Dashboard `spamFilterData`) · 그 밖(자동 발송 · DM · 여정)은 지금 A 카드만.

### 9-2 대행 (화면 접수 · 메일 접수)

- 자동(판 w1 · w1u · w2 · 주소 판 포함 · Harold 1125 「대행발송도 카바」): `decide` 새 갈래 found → **진단을 닫는 같은 트랜잭션에서** `last_test_result.diagFix = { version, content: applySpamFixes(hold.content), plateTestId, rounds }` 저장(Codex 1R high · 바꿈 목록은 싣지 않는다 = 7R) → `runSpamRound` 가 3사 일반 검사.
  - 재개 입력을 정하는 자리 = 워커의 진단 대기 처리 직후 · `runSpamRound` 직전 한 곳(`agency-send-worker.ts:1086-1101` 사이 · Codex 2R): 같은 주기에는 방금 커밋한 `diagFix` 를 그대로 넘기고, 재선점 · 검사 장애로 `received` 에 돌아간 뒤에는 `diagFix` 의 버전이 지금 버전이면 그 글로 이어받는다(장애 갈래는 `diagFix` 를 지우지 않는다).
  - 재개 우선순위(Codex 7R): ① 같은 버전의 보류 후보 `heldCandidate`(글 · 회차 · `agency-send-worker.ts:433` · 762-766) ② 같은 버전의 `diagFix` ③ 지금 글. `diagFix` 는 그 버전 첫 일반 검사의 시작 글로만 쓰이고, 그 뒤 다듬기 후보가 보류되면 그 후보가 이어진다(막힌 `diagFix` 로 되돌아가 다시 다듬는 반복 0).
  - 찾은 판의 도착은 T 의 통과가 아니다 → `resume.passed` 짧은 길(`agency-send-worker.ts:443-445`)에 넣지 않고 반드시 3사 일반 검사를 거친다.
  - `diagFix` 는 버전에 묶인다 — 읽는 자리는 「그 접수가 검사 단계로 집혔고 `diagFix.version` = 지금 버전」일 때뿐이라, 취소 · 만료 · 문안 수정(버전 증가) 뒤 남은 `diagFix` 는 아무 길에서도 쓰이지 않는다(지우는 일을 따로 두지 않는다 · 4R).
  - 통과 = 지금 통과 갈래(승인 문자 + `buildPassedNotify` 새 `fixLines` · 진행 기록 `spam_fixed`) · 막힘 = 지금 다듬기 루프 · 통과 · 막힘 · 반려로 갈래가 끝나면 `diagFix` 지움 · 적용 실패 = 4c.
  - 지우는 자리(Codex 10R): 통과 · 최종 막힘은 결과 칸을 통째로 바꾸는 저장(`agency-send-worker.ts:989-1001`)에서 빠진다. 결과 칸을 안 쓰는 두 반려 `settleSmsBytesOver`(663) · `settleSpamRejected`(679)는 토큰 조건 `test_failed` UPDATE 에서 `diagFix` 를 지운다. 대입은 한 번만: 두 반려만 `setStatus` 에 지우기 옵션을 넘겨, 결과 값을 안 받을 때 이미 붙는 지금 줄(`agency-send-worker.ts:189` · `last_test_result - 'spamOverridable'`)을 `last_test_result - 'spamOverridable' - 'diagFix'` 로 바꾼다(같은 칸 두 번 대입 = UPDATE 거절 · Codex 11R). 장애 갈래(598 · 601)는 지우지 않는다(이어받기).
  - `fixLines` 는 **고객이 낸 글(`original_content` · 문안 수정이 같은 UPDATE 로 함께 바꾼다 = `agency-send-change.ts:191` · 다른 쓰기 0 = grep)과 통과해 저장한 글(`finalContent`)의 줄 대조**로 만든다(Codex 7R). `diagFix` 를 거친 주기에만 싣는다(다듬기만 거친 지금 통과 문자는 그대로). 뒤 후보가 통과해도 줄 = 실제 승인 대상.
  - 승인 링크 서명 버전 = `savedVersion`(Codex 7R · 8R 에서 구조로 바꿈): 승인 문자의 링크는 테스트 문자 · 바꾼 곳 줄이 보여 준 글의 버전(`savedVersion`)으로 서명한다. 보내는 곳 · 시각은 지금처럼 `freshLinkFields` 에서 읽되 버전 칸만 `savedVersion` 으로 둔다(`agency-send-worker.ts:1193` · `{ ...linkRow, content_version: savedVersion }`). 확인 뒤 보내기(check-then-act) 줄은 두지 않는다. 그 사이 문안이 바뀌어 옛 승인 문자가 나가도 그 링크는 승인 라우트의 잠금 아래 버전 대조(`agency-send-approve.ts:145-158`)가 거절하고, 고친 글은 문안 수정이 `received` 로 되돌려(`agency-send-change.ts:191-192`) 자기 주기에서 새 승인 문자를 받는다. 지금 다듬기 통과에 있던 「옛 글 문자 + 새 버전 링크」 틈도 함께 닫힌다(대행만 · §13).
  - 보류 저장이 `diagFix` 를 지우지 않게(Codex 8R): 보류 저장은 행 스냅샷 `row.last_test_result` 를 펼쳐 `heldCandidate` 만 바꾼다(`heldResultJson` · `agency-send-worker.ts:762-766` · 소유권 토큰 조건 `setStatus` 709). 그래서 `diagFix` 를 커밋한 같은 주기는 **복사본이 아니라 그 `row` 자체**를 고친다: 진단 대기를 지우는 지금 줄(`agency-send-worker.ts:1098` · `row.last_test_result = { ...row.last_test_result, diagHold: undefined }`)에 found 일 때 `diagFix` 를 함께 얹는다. 그 같은 `row` 를 `runSpamRound`(1101)와 보류 저장 `settleSpamHold`(1108)가 함께 받으므로, 첫 보류 저장 뒤 결과 칸 = `diagFix` + `heldCandidate` · `diagHold` 없음(Codex 9R). 재선점 주기는 DB 에서 읽은 행이라 이미 들어 있다. 문안 수정은 토큰을 지우고 버전을 올려(`agency-send-change.ts:191-195`) 이쪽 토큰 조건 쓰기가 0행이 된다.
- **동의 자리 = 승인 문자**(Harold 1125 「고객사가 오케이 해야」 + 「대행발송도 카바」): 찾은 글이 3사 검사를 통과하면 지금 승인 문자(로그인 없는 1클릭 링크)에 바꾼 곳 줄(표현 「원래 → 바꾼」 · 주소를 바꿨으면 「같은 곳으로 가는 한줄로 짧은 주소로 바꿨습니다」)을 싣는다. 승인 전에는 받는 사람에게 한 통도 나가지 않는다 · 메일 접수 고객도 같은 문자.
- 주소 판의 짧은 주소는 판 등록 때(§7 `prepare` · 등록 트랜잭션 안) 생긴다 → 승인하지 않은 접수의 짧은 주소는 쓰이지 않은 채 회사 「내 단축 주소」 목록에 남는다(원래 주소로 넘기기만 · 고객이 목록에서 끌 수 있다).
- 3판 안에 못 찾으면 지금 4c(다듬기 루프) · 끝내 사람에게 넘어가면 지금 test_failed 담당자 문자 · 결과 메일(「해 본 것」 줄).
- 대행 화면 단추 · `POST /api/agency-send/:id/spam-fix` 는 두지 않는다(옛 판 2 · Codex 2R ~ 6R 이 짚은 링크 · 문안 공동 저장 길이 통째로 빠진다).
- 통과 회신 메일은 지금 없다(`agency-send-mail-worker.ts:1391-1399`) → 신설은 범위 밖(§17).
- 4a 없앰(새 4a 0). 메일 워커의 4a 근거 CASE 는 **이미 확정된 4a 사건의 회신(24시간 창)이 끝날 때까지 남긴다**(호환 · 다음 정리 때 지움 · Codex 1R). 「그대로 보내기」 표식은 일반 test_failed 길(`agency-send-worker.ts:1120-1121`)에 있어 그대로.
- `AgencySendDetail.tsx:422` = 원문 · 지금 글의 주소가 같으면 「링크는 그대로입니다」 · 다르면 「링크는 같은 곳으로 가는 한줄로 짧은 주소로 바꿨습니다」.

---

## §10 보이는 곳 · 문구

### 10-1 직접발송 검사 창 카드 (재작성 · `SpamBlockHintCard.tsx`)

- 한 카드(통신사마다 카드 0) · 흰 바탕 · 검정 · 주황 하나(도착에도 초록 0).
- 찾기 전: A 근거 줄(지금 그대로) + 찾기 단추 + 설명.
- 진행: 판마다 세로 한 줄(최대 3) = 판 이름 · 바꾼 곳 한 줄 · 상태.
- 주소 물음(ask_url): 물음 문장 + 단추 둘.
- 찾음: 제목 + 바꿈 목록 + 보존 줄 + 주소 줄(주소를 바꿨을 때만) + 받기 단추.
- 못 찾음 · 확인 못 함: 정직한 끝 + 해 본 것(취소선 목록).

### 10-2 정본 문구 (조사까지 완성 · 자리 채움 = 통신사 · 원래 · 바꾼 말 · 주소뿐)

| 상태 | 문구 |
|---|---|
| 찾기 단추 | 주소와 혜택은 그대로 두고 {통신사}에 닿는 글 찾기 |
| 찾기 설명 | 표현을 바꾼 글을 {통신사}로만 보내 닿는지 확인해요. 요금은 없어요. 창을 닫아도 계속 찾아요. |
| 판 이름 w1 · w1u · w2 · w2u | 표현을 바꾼 글 · 주소도 바꾼 글 · 글을 새로 쓴 글 · 새로 쓴 글에 주소도 바꾼 글 |
| 판 상태 | 확인하고 있어요 · {통신사}에 닿았어요 · {통신사}에서 막혔어요 · 확인을 마치지 못했어요 |
| 주소 물음 | 표현을 바꿔도 {통신사}에서 막혔어요. 글 속 주소({주소})가 막는 것일 수 있어요. 같은 곳으로 가는 한줄로 짧은 주소로 바꿔서 확인해 볼까요? |
| 주소 물음 단추 | 주소도 바꿔서 확인 · 주소는 그대로 두고 글을 새로 써서 확인 |
| 주소 물음 덧말 | 바꾸면 내 단축 주소 목록에 주소가 하나 생겨요. 보낼 글은 받기를 눌러야 바뀌어요. |
| 찾음 제목 | {통신사}에 닿는 글을 찾았어요 |
| 찾음 덧말 | 한 통을 보내 확인한 결과예요. 보내는 양과 시점에 따라 달라질 수 있어요. |
| 보존 줄 | 숫자, 날짜, 주소는 그대로예요. (주소를 바꿨으면) 숫자와 날짜는 그대로예요. |
| 주소 줄 | 글 속 주소를 한줄로 짧은 주소로 바꿨어요. 누르면 지금 주소로 넘어가요. 클릭 수는 이 주소에도 잡혀요. |
| 받기 단추 | 이 글로 바꾸고 다시 검사 |
| 받기 실패(글 바뀜) | 글이 바뀌어 넣을 수 없어요. 지금 글로 다시 검사해 주세요. |
| 받기 실패(SMS 길이) | 바꾼 글이 SMS 길이를 넘어 넣을 수 없어요. |
| 주소 못 바꿈 | 주소는 바꾸지 못했어요. |
| 못 찾음 | {통신사}에 닿는 글을 찾지 못했어요. 막힌 표현을 바꾼 뒤 다시 검사해 주세요. |
| 자격 no_editable | 이 글은 바꿔 볼 줄이 없어요. |
| 자격 owned · closed | 지금은 다시 확인할 수 없어요. |
| 자격(그 밖) | 앞 설계서 §8-4 그대로 |
| 승인 문자 바꾼 곳 | 스팸 검사에 걸려 아래처럼 바꿨습니다. 승인하시면 바꾼 글로 보냅니다. / {원래} → {바꾼} |
| 승인 문자 주소 줄 | 글 속 주소는 같은 곳으로 가는 한줄로 짧은 주소로 바꿨습니다. |

- 원칙 = 앞 설계서 §8-3 그대로(추정과 확인을 섞지 않음 · 우리 쪽 원인 단정 0 · 검사 방식 낱말 0 · 모델명 0 · 「고치면 통과」 약속 0) + 「혜택」 보존 단정 0(숫자 없는 혜택은 기계가 못 본다).
- 고객 문구에 줄표 · 가운뎃점 0(위 표의 「·」 「/」는 문서 구분자).

---

## §11 저장 · DDL

- 판 행 = `spam_filter_tests`(출처 spam_diag · diag_of · variant_id `R1` ~ `R3`) · 결과 행 = 대상 통신사마다.
- **새 칸 `diag_plan jsonb NULL`**(판 행만 씀 · 일반 검사 문장 무변경):
  `{ v: 1, owner, kind, template: { body, subject }, editable: [{ sentLine, tplLine }], targets, fixes, urls: [{ from, to, linkId }], closed?, ended?: { reason, at }, agency?: { requestId, version, rounds } }`(대행 판만 `agency` · 대기 되찾기 §8)
- 대행 진단 이어받기 = `agency_send_requests.last_test_result.diagFix`(지금 `diagHold` 와 같은 칸 · 새 칸 0).
- DDL-5(구현 전 information_schema 확인 · Harold 실행):
  ```bash
  docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "ALTER TABLE spam_filter_tests ADD COLUMN IF NOT EXISTS diag_plan jsonb;"
  ```
- 칸 없음 안전망 = 새 라우트 catch 에서 42703 → 503 `DB_MIGRATION_PENDING` · 일꾼 · 대행 = 판 없음으로 접기(fail-open).
- 옛 판(K1 · L2 …)은 새 읽기가 무시(`variant_id ~ '^R[1-3]$'` 만) · 새 판은 옛 읽기가 무시(§15 배포 A).

---

## §12 영향표 (바뀌는 것 → 소비처 전수 · grep 1125)

| 바뀌는 것 | 소비처 | 처리 |
|---|---|---|
| `makeDiagVariant`(빼기) | `spam-diag.ts:125` · `:128` · `:183` · `:193` · `:237` · 시험 | 지움 · 새 `buildWordingPlate` · 주소 판 = `spam-link-swap` |
| `diagNextVariant` · `diagVariantCode` | `spam-diag.ts:192` · `:228` · `:238` | 새 `classifyRewrite` · 코드 `R`+순번 |
| `readDiagChecks` · `CarrierChecks`(v1 · v2) | `spam-diag.ts:177` · `agency-spam-diag.ts:136` · `SpamBlockHintCard.tsx:20` · `:32-34` · `:100` | 판 목록 `plates[]` |
| `classifyDiag` | `agency-spam-diag.ts:137` | 새 `classifyRewrite` |
| `diagStateSentence` · `spamHintLine` · `isAddressCause` · `lastSettled` | `agency-spam-diag.ts:90` · `:143-150` · D3 경고 · 담당자 문자 · 회신 메일 | 새 문장(§10) · `isAddressCause` 지움 |
| 4a(`settleAgencyDiag4a` · 워커 `settleDiag4a`) | `agency-send-worker.ts:1091` | 지움 · 메일 워커 4a CASE 는 호환 기간 남김(§9-2) |
| `closeDiagnosis` | 대행 갈래 · `editAgencyContentTx` · 되돌리기 | `closed = true` 쓰기 추가(같은 잠금 · 같은 판 행) |
| `POST /diagnose` | `SpamBlockHintCard.tsx:119` | 지움 · 새 `/rewrite` · `/rewrite/next` · `/fix-apply` |
| `enqueueSpamTest diag{carrier}` | `spam-diag.ts:241-247` 하나 | `carriers[]` · `prepare(run)` · 잠금 = 대상 통신사 결과 행 모두 FOR UPDATE(id 순) → 진단 잠금 → guard(소유 · 닫힘) → 고정 키(순서 그대로 · 통신사 하나일 때와 같은 차례) · 단말 = 통신사마다 한 대 |
| `createCustomShortLink` · `issueUniqueCode` | DM 라우트(지금) · 새 `spam-link-swap` | 선택 인자 `run`(둘 다 · 기본 지금 `query` · DM 무변경) |
| 대행 워커 접수 집기 | `agency-send-worker.ts:1087` | `diagHoldOf(row) ?? recoverAgencyHold(row)` |
| `refineForSpam` · `checkRefined` | `agency-send-worker.ts:527`(대행 다듬기 루프) · 새 표현 판 | 새 인자 `editable`(없으면 무변경) · ⑤ `findLostNumbers` · ⑥ · 대행 루프는 혜택 숫자를 지운 다듬기를 이제 버린다(그 회차 refine_failed → 지금 갈래 그대로 · §13) |
| `copy-benefit-detector.ts` | 새 export `findLostNumbers` · 값 정규화 공유 | `findNewNumbers` 동작 무변경 |
| `buildPassedNotify` | 대행 통과 갈래 | 선택 인자 `fixLines`(표현 · 주소 줄) |
| 대행 워커 재선점 · 장애 재시도 | `agency-send-worker.ts:1086-1104` · `:438-450` | `diagFix` 이어받기 |
| 검사 창 | `Dashboard.tsx:2337-2346` · `DirectSendPanel.tsx` · `TargetSendModal.tsx`(setSpamFilterData) | `spamFilterData.onApplyFix` · 원문 전달 |
| 대행 상세 | `AgencySendDetail.tsx:422` | 문구 둘(링크 그대로 · 같은 곳으로 가는 짧은 주소) |
| 계약 시험 | `spam-diag-1124.test.ts` INTERNAL_READS · `spam-diag-deploy2-1124` · `spam-block-hint-1124` · `spam-diag-register-1124.pg` · 대행 진단 시험 | 새 판 계약으로 고침(면제 목록 늘리기 0) |

- 다른 세션 미커밋과 겹침: C161(1124 오류접수 · 「대행 그대로 보내기」)이 `agency-spam-diag.ts` · `agency-send-worker.ts` · `AgencySendDetail.tsx` 쪽에 미커밋 덩어리를 갖고 있다 → **C161 커밋 · 배포 뒤 착수**(한 push 금지).

---

## §13 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 길 | 스위치 꺼진 회사(기본) |
|---|---|
| 직접발송 막힘 카드 | 찾기 단추 숨김(자격 off · 지금 `reason 'off'` 숨김 자리) · A 근거 줄은 지금과 같다 |
| `/rewrite` · `/rewrite/next` · `/fix-apply` | 자격 off · 판 0 · 링크 0 |
| 이어 돌리기 일꾼 | 그 회사 판 행 0 → 할 일 0 |
| 대행 진단 | 자격 off → 판 0 · 링크 0 → 지금처럼 다듬기 |
| `checkRefined` ⑤ ⑥ · `refineForSpam` editable | ⑥ · editable = 새 판에서만 · ⑤ = **대행 다듬기(대행 쓰는 회사)에 스위치와 무관하게 적용** — 미가입 · 직접발송만 쓰는 회사는 대행 0 이라 변화 0. 대행 회사에는 「혜택 숫자 · 이번 달 조건을 지운 다듬기 안을 버림」이 동작 변화(의도 · 결함 고침) |
| `createCustomShortLink` run 인자 | DM 라우트 = 기본값 = 무변경 |

---

## §14 계약 시험 · 검증

- 순수(기계 추출 · 독립 기대값): `editableLines`(변수 값 줄 · 변수 칸 든 원문 줄 · (광고) 줄 · 080 줄 고정 · 같은 줄 k번째 대응) · `classifyRewrite`(대상 전부 도착만 found · 일부 = next · failed/timeout/error = end_unknown · 주소 있음 = ask_url · 대행 = ask_url 없음 · ended · closed) · `applySpamFixes`(지금 글 = 원문이면 위치 · 아니면 원문 · 지금 글 둘 다 유일할 때만 · 옮겨 온 중복 줄 = 사유) · `findLostNumbers`(「35% OFF」 줄 삭제 · 「11월」 삭제 · 같은 숫자 두 번 → 한 번 = 버림 · 「35%」→「35퍼센트」 = 통과) · 표현 판 복원(번호 어긋남 = 버림 · 고정 줄 외부 요청 0 = 모델 호출 인자 검사) · `validateCustomShortLinkUrl` 연결 · 문구 금지 낱말 0(R11) · 모델명 0.
- 실 PG(세션 사이 순서 맞춤): `carriers[]` 등록(통신사 둘) · 늦은 보고로 대상 줄어듦 · `prepare` 안 링크 + INSERT 충돌 = 링크 0 · 같은 원래 주소 두 번 = 링크 하나 · 소유 다름 = owned · `closeDiagnosis` 뒤 등록 = closed · 일꾼 두 번 = 판 하나 · `ended` 뒤 일꾼 호출 0 · `diag_plan` 칸 없음 = 503 · 대행 found → diagFix → 장애 재시도 이어받기 → 통과(resume.passed 짧은 길 0) · 대행 첫 판 등록 뒤 대기 저장 전 죽음 → 집을 때 대기 되찾기 → 30분 상한 · 대행 주소 판 자동 → 찾음 → 3사 통과 → 승인 문자에 바꾼 곳 · 주소 줄 · 승인 전 실발송 0 · 링크 코드 충돌 = 등록 되돌림 · 버전 조회 뒤 문안 수정 커밋 → 옛 승인 문자의 링크로 승인 = 거절 · 새 버전 승인 문자는 따로 도착(7R · 8R) · diagFix 막힘 → 다듬기 후보 보류 → 첫 보류 저장 직후 결과 칸 = diagFix + heldCandidate · diagHold 없음(9R) → 재선점 = 보류 후보로 이어감 → 통과 → 승인 문자 바꾼 곳 줄 = 원문 ↔ 저장 글 대조(7R · 8R) · 반려(SMS 길이 · 접수 거절) 커밋 직후 상태 test_failed · 결과 칸에 diagFix · spamOverridable 없음 · 나머지 키 보존 · 장애 재시도 때는 diagFix 남음(10R · 11R).
- 기계 추출: `spam_filter_tests` 읽는 SQL 전수 허용 목록 갱신 · 옛 `/diagnose` · `makeDiagVariant` 참조 0 · 외부 모델 호출 인자에 고정 줄 0.
- 직원 지시문 S1(구현 전 작성 1126 · 동작 · 볼 결과만 · 테스트계정 · 발신번호 1800-8125 · LMS · 배포 B 뒤 스위치 켠 다음):
  1. 직접발송 작성 칸에 1125 에 검사한 폴라초이스 원래 글(「혜택」 낱말 + tinyurl 주소 둘이 든 글)을 그대로 넣고 [스팸 검사]를 누른다.
  2. 결과 창에서 KT 가 「막힘」으로 나오는지 적는다. 막힘 아래 카드에 「주소와 혜택은 그대로 두고 KT에 닿는 글 찾기」 단추가 보이는지 적는다.
  3. 그 단추를 누른다. 「표현을 바꾼 글」 줄이 생기고 「확인하고 있어요」로 바뀌는지 적는다. 창을 닫았다가 같은 검사를 다시 열어도 그 줄이 그대로 있는지 적는다.
  4. 3분쯤 뒤 줄의 상태 글(「KT에 닿았어요」 · 「KT에서 막혔어요」 · 「확인을 마치지 못했어요」 중 무엇인지)을 적는다.
  5. 주소 물음(「같은 곳으로 가는 한줄로 짧은 주소로 바꿔서 확인해 볼까요?」)과 단추 둘이 나오면 [주소도 바꿔서 확인]을 누르고, 새 줄 「주소도 바꾼 글」의 마지막 상태 글을 적는다.
  6. 「KT에 닿는 글을 찾았어요」가 나오면 그 아래 바꿈 목록(원래 → 바꾼)을 화면 그대로 찍어 둔다. 숫자 · 날짜가 원래 글과 같은지 눈으로 대조해 다른 곳이 있으면 적는다.
  7. [이 글로 바꾸고 다시 검사]를 누른다. 작성 칸 글이 바꾼 글로 바뀌었는지, 이어서 3사 검사가 시작되는지, 3사 결과가 각각 무엇인지 적는다.
  8. 본인 휴대폰으로 바꾼 글을 한 통 보내 글 속 짧은 주소를 눌러 원래 주소의 페이지가 열리는지 적는다.
  9. 「내 단축 주소」 목록에 「스팸 검사에서 바꾼 주소」가 몇 개 생겼는지 적는다.
  - 못 찾았다고 나오면(「KT에 닿는 글을 찾지 못했어요」) 그 화면과 줄마다의 상태 글을 그대로 찍어 보낸다(그것도 정상 결과다).
- 발송 · 돈 실측 1건(6원칙 ⑤): S1 의 판 행 · 차감 0 · hlj.kr 링크 1개 · 크레딧 0 확인 SQL(구현 때 information_schema 확인 뒤 작성).

---

## §15 구현 · 배포 순서 · 되돌리기 (Codex 1R · 두 방향 호환)

0. 0단계(Harold 서버 SQL · 읽기만): ① `spam_filter_tests` information_schema(diag_plan 없음 확인) ② 열린 판 0 · 열린 대행 진단 대기 0.
1. C161 커밋 · 배포 확인 뒤 착수(§12).
2. **배포 A(읽기 울타리 · 작게 먼저)**: 지금 코드의 판 읽기 · 등록이 `variant_id ~ '^[SKL][12]$'` 만 판으로 본다(새 R 판을 옛 코드가 ① 로 읽어 4a 로 확정하는 길을 막는다). 이것만 먼저 배포 · 확인 → 이 판이 되돌리기 하한.
3. 구현(본 AI 단독 · 순차 · tdd) → 단위 · 실 PG · 프론트 tsc → Codex 구현 리뷰(approve 까지).
4. 배포 B 절차: 테스트계정 스위치 끔(슈퍼관리자) → DDL-5 → 배포(백 + 프론트 한 번 · 런북 §2-2) → 배포 뒤 확인(online · dist · 에러 새 종류 0) → 스위치 켬 → S1. 앞 방향도 되돌리기와 같은 원리라 「진행 중 0」 조건을 두지 않는다 — B 는 옛 K · L · S 판을 판으로 보지 않으므로(`variant_id ~ '^R[1-3]$'`) 옛 판을 가리키는 대행 진단 대기는 판 결과가 빈 채 `classifyRewrite` = 끝(못 찾음) → 4c · 옛 판 문자는 검사 단말 무료 한 통 · 잘못 나가는 글 0.
- 되돌리기(B → A) = **스위치 끔 → 배포 A. 언제 해도 안전하다(「진행 중 0」 조건을 두지 않는다).**
  - 왜 조건을 지웠나(2R · 3R · 4R 같은 부류 세 번 = 구조): 「진행 중인 상태가 전부 0 일 때만 되돌림」으로 두니 대행 접수가 지나는 상태(선점 중 · 장애 재시도 · 취소)를 모두 세야 했고 라운드마다 하나씩 빠졌다. 되돌린 뒤 A 가 남은 R 상태를 만나면 어떻게 되는지를 코드로 보면 셀 필요가 없다:
    - A 는 R 판을 판으로 보지 않는다(배포 A 울타리) → R 부모를 가리키는 대행 진단 대기는 판 결과가 빈 채로 `classifyDiag` 에 들어가 **4c**(`spam-block-hint.ts:212-224` · 대기 · 4a · 4b · register_v2 의 조건이 모두 판 상태를 요구) → 진단 닫고 지금 다듬기 루프.
    - A 는 `diagFix` 를 읽지 않는다 → 그 접수는 지금 글로 지금 루프.
    - 열린 R 판 · 확인 문자는 A 의 대기열 · 확인 문자 일꾼이 지금 관문대로 처리해도 검사 단말에만 가는 무료 한 통이고, 결과는 아무 판정에도 쓰이지 않는다.
    - 결과 = **잘못 나가는 글 0 · 수정안 · 진단 진행만 잃는다.**
  - 수정안을 살리고 싶으면 스위치를 끈 뒤 잠시 기다렸다 되돌린다(B 는 스위치와 무관하게 열린 대행 진단 · `diagFix` 를 끝까지 처리 · 관문 15분 · 대행 30분) — 선택 · 되돌리기 보고에 「잃은 진단 수」를 적는다(확인 SQL 은 구현 때 information_schema 확인 뒤).
- `diag_plan` 칸 · 만든 hlj.kr 링크는 남겨도 무해(일반 검사 문장이 안 읽는다 · 링크는 원래 주소로 넘김).

---

## §16 미검증 · 위험

- KT 가 짧은 주소를 열어 넘어가는 곳(원래 tinyurl)까지 보는지 모른다(§3 7 · 8 = 없는 경로) → hlj.kr → tinyurl 판이 막히면 「주소도 바꾼 글」도 막힘으로 정직하게 보인다(약속 0).
- 원래 주소가 나중에 다른 곳을 가리키게 바뀌면 짧은 주소도 따라간다(원래 주소를 그대로 가리키므로 · 고객 링크의 성질 그대로).
- 같은 발신번호로 막힌 글을 반복해 보내는 평판 영향 → 글당 3판 · 발신번호 하루 10판.
- 한 통 도착 ≠ 대량 도착 → 덧말 · 마지막 3사 일반 검사.
- 숫자 없는 혜택(사은품 낱말) 삭제는 기계가 못 본다 → 보존 줄은 숫자 · 날짜 · 주소만 말한다.
- 우리 hlj.kr 평판 → 고친 본문에만 · 고객 클릭 뒤에만 · 스위치 · 상한(0 은 아님).
- 직접발송 원문은 화면이 보낸다(§6-1 신뢰 경계) — 1125 코드 확인: 사람 검사 INSERT 에 `first_recipient` · 원문 칸 없음(`routes/spam-filter.ts:266-270`). 서버 보관 원문이 필요해지면 검사 생성 길을 바꾸는 별건(미가입 회사 동작 변화 검토 필요).

---

## §17 범위 밖 (추가 과제 · 기록만)

- 점검 칸 [보기]가 막혔던 검사가 아니라 빈 「검사 시작」 화면을 여는 것으로 보임(`DirectCheckTiles.tsx:37-39` · 실화면 미검증).
- 받기 길이 없는 곳: 여정 칸 모드(`JourneyWorkspace.tsx:1396`) · 자동 발송 · DM 검사 창.
- 대행 통과 회신 메일 신설(지금 없음).
- 대시보드 검사 창 `onEdit` 미연결(앞 설계서 D5).
- 판이 만든 짧은 주소는 캠페인 클릭 합계에 안 잡힘.
- 1125 실측 화면: 광고 표기 켜짐 + 글에 「(광고)」를 직접 입력해 (광고) · 080 줄이 두 번.
- 메일 워커 4a 근거 CASE 정리(호환 기간 뒤).
- 승인 뒤 고객이 「내 단축 주소」에서 링크를 끄면 같은 버전 그대로 나가고 받는 사람은 서비스 홈으로 간다(`dm-custom-short-link.ts:243-255` 토글이 문안 버전을 안 바꿈 · 고객이 만든 링크도 지금 같은 틈 · Codex 7R medium · 고객 본인 조작이라 이번 범위 밖).
- ★ 1126 구현 중 발견(기록만 · BUGS B-1126-1): 「내 단축 주소」 회사 하루 상한 식(`dm-custom-short-link.ts:99` · `(NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul'`)이 UTC 세션에서 `timestamp without time zone` 을 내 그날 KST 18시를 하루 시작으로 잡는다(로컬 PG 15 · TimeZone Etc/UTC 실행 = 지금 시각이 「오늘」로 안 세어짐 · 운영 덤프 머리도 Etc/UTC) → KST 0 ~ 18시에 만든 링크는 하루 50 에 안 잡힌다. 고침 = `KST_TODAY_START_SQL` 로 바꾸는 한 줄이지만 DM 고객의 상한 동작이 바뀌므로 Harold 결정. 이 설계의 판이 만드는 링크 수는 판 상한(발신번호 하루 10판 · 전체 100판)이 따로 묶는다.
- 짧은 주소 글자를 만드는 식(`DM_SHORT_LINK_BASE` + 코드)이 `routes/dm.ts` 여섯 곳에 인라인 · 이번에 CT `customShortLinkUrl` 을 두었으나 그 여섯 곳은 안 건드림(DM 라우트 정리 별건).
- 다른 `freshLinkFields` 호출(`agency-send-worker.ts:1360` · 1699 · 2075 · 2694)도 링크를 지금 버전으로 서명한다 · 보여 준 글과 버전이 갈릴 수 있는지는 이 설계가 안 건드려 미검증(Codex 8R 계기 · 같은 패턴 grep).

---

## §18 기록

### 18-1 브레인스토밍 (1125 · 다섯 역할 · Explore 읽기 전용)

- 합의: 고친 글 · 바꿈 목록 받기 · 3사 확정 · 「사라진 숫자」 검사 · 주소는 코드 단계 · 서버 이어 돌리기 · 대기열 순서 무변경 · 대행 승인 문자 = 동의 · 주황 하나.
- 갈렸다가 수렴: 판 순서(본문 먼저 · 우리 주소는 고친 본문에만 = 백엔드 채택) · 반으로 나누기 · 뼈대 판 접음 · 판 수 = 글당 3 · 판 하나 = 막힌 통신사 전부(회의론자 최종 검증).

### 18-2 Harold 1125 정정

- 「hlj.kr 로 어떻게 변환시켜 줄껀데? 그걸 니가 자동으로 해주겠다고? 그리고 고객사가 어쨌든 그걸 오케이 해야되는거잖아?」 → 주소 판 자동 0 · 고객 클릭 = 동의 뒤에만 링크 · 원래 주소를 그대로 감쌈(HEAD 펼치기 삭제).
- 「대행발송도 근데 카바쳐줄 수 있어야하는데 말야..」 → 대행은 주소 판까지 자동 · 동의 = 승인 문자 1클릭(로그인 없음 · 메일 접수 고객 포함) · 대행 화면 단추 · `/spam-fix` 없앰(Codex 2R ~ 6R 의 그 길 지적은 길째 사라짐).

### 18-3 Codex 설계 리뷰 (gpt-6.2-sol · high · 하위 0 · 로그 대조 끝)

| R | 지적 | 판정 · 처리 |
|---|---|---|
| 1 | [high] 대행이 닫은 진단에 직접발송 일꾼이 다음 판 등록 | 수용 · 소유 · 닫힘을 판 행에 영속 · 등록 잠금 아래 대조(§8) |
| 1 | [high] 고정 줄의 첫 수신자 값이 외부 AI 요청에 | 수용 · AI 에 고칠 줄만 · 수신자 값 든 줄 고정(서버 표본 기준) · 서버 복원(§6) |
| 1 | [high] 첫 일치 규칙이 다른 줄을 바꿈 | 수용 · 원문 줄 위치 저장 · 위치 → 유일 일치 → 사유(§9-1) |
| 1 | [high] 대행 수정안의 제목 · 근거가 일반 검사로 안 이어짐 · 재시작에 잃음 | 수용 · 대행은 제목 안 바꿈 · 닫는 트랜잭션에서 diagFix 저장 · 이어받기(§9-2) |
| 1 | [high] 되돌린 옛 워커가 새 판을 옛 판으로 해석 | 수용 · 배포 A 읽기 울타리 · 스위치 끄고 전환 · 되돌리기 절차(§15) |
| 1 | [high] HEAD Location 으로 같은 목적지 보장 못 함 | 수용 · Harold 정정과 같은 처방 = 원래 주소 그대로 감쌈 · 바깥 호출 0(§7) |
| 1 | [medium] 다음 판을 못 만들면 종료가 사라짐 · failed 빠짐 | 수용 · `ended` 기록 · failed 포함 분류(§5-2) |
| 1 | [medium] 판 등록 실패에도 링크 · 하루 한도 소모 | 수용 · 등록 트랜잭션 안 `prepare` 로 링크 · 한 부모 같은 주소 재사용(§7) |
| 1 | [medium] 숫자 검사 뒤집기가 이번 달 조건 삭제를 놓침 | 수용 · `findLostNumbers` 별도 · 이번 달 예외 0 · 개수 비교(§6-2) |
| 2 | [high] 원문 일치만으로 수신자 값의 AI 전송을 못 막음(1R 과 같은 부류 두 번째) | 구조 답 · 불수용 근거: 직접발송은 서버가 치환 전 원문을 처음부터 갖지 않는다(`routes/spam-filter.ts:266-270`) · 만들려면 미가입 회사 검사 생성 길 변경 · 정직한 화면에서 변수 값 줄은 고정 · 위조는 데이터 주인 사용자 본인뿐 · 서버 표본 대조는 근거 없어 지움 · 규칙 하나로(§6-1) |
| 2 | [high] 첫 대행 판 등록과 대기 저장 사이 장애로 진단 고립 | 수용 · 대행 판 행에 접수 · 버전 · 회차 · 집을 때 판으로 대기 되찾기(§8) |
| 2 | [high] 열린 R 판 0 이어도 되돌리면 diagFix 잃음 | 수용 · 되돌리기 조건에 R 대기 · diagFix 0 추가 · 급한 경우 결과 명시(§15) |
| 2 | [high] 링크 코드 조회가 잠금을 쥔 채 풀 연결을 기다림 | 수용 · `issueUniqueCode` 도 같은 `run` · 충돌 = 그 등록 되돌림(§7) |
| 2 | [high] 대행 클릭 경로에 링크 · 문안 공동 커밋 계약 없음 | 수용 · `editAgencyContentTx` 의 `beforeSave(run)` 로 한 트랜잭션(§9-2) |
| 2 | [medium] 위치가 같아도 옮겨 온 중복 줄을 바꿀 수 있음 | 수용 · 위치 적용은 지금 글 = 저장 원문일 때만 · 아니면 원문 · 지금 글 모두 유일할 때만(§9-1) |
| 3 | (판정) 직접발송 신뢰 경계 | Codex 「정상 화면이 수신자 치환값을 AI 입력으로 넘기는 반례를 확인하지 못함」 · 닫힘 |
| 3 | [high] 되돌리기 조건이 결과 확정 · 미복구 R 판을 놓침(2R 과 같은 부류 두 번째) | 구조 · 손 목록 대신 불변식(대행 R 진단은 끝날 때 늘 closed) 하나로 「끝나지 않은 R 진단」 정의(§15) |
| 3 | [high] beforeSave 최종 글이 저장 검증을 건너뜀 | 수용 · (4R 에 다시 바꿈) |
| 4 | [high] SMS 검증을 잠금 아래로 옮기면 전역 조회가 풀을 기다림 | 수용 · 구조 = 검증은 지금처럼 잠금 밖에서 같은 길이 자리표 글에 · 잠금 안은 링크 한 줄과 자리표 8자 바꾸기만 · 검증 코드 무변경(§9-2) |
| 5 | (판정) A 의 4c · pass 떨어짐 · 취소 접수 같은 버전 재진입 길 없음 · 자리표 길이 | Codex 확인 · 닫힘 |
| 5 | [high] beforeSave 가 정리 전 후보 글을 다시 저장할 수 있음 | 수용 · (6R 에 다시 바꿈) |
| 6 | [high] 자리표 → 코드 바꿈이 Liquid 분기 · 변수 인식을 바꿔 90바이트를 넘길 수 있음 | 수용 · 자리표 없앰 = 코드를 잠금 밖에서 미리 발급 → 그 코드의 최종 글을 지금 검증 → 검증한 글을 그대로 저장 · 잠금 안은 그 코드로 링크 INSERT 만 · 충돌 = 처음부터 한 번 다시 · Liquid 식 줄은 고칠 줄에서 뺌(§6-1 · §9-2 · §12) |
| 4 | [high] 취소된 접수의 diagFix 가 되돌리기를 막음 · [medium] 선점 중 진단이 ⓐ 에서 빠짐(되돌리기 부류 세 번째) | 구조 · 「진행 중 0」 조건 자체를 지움 = A 는 R 상태를 4c · 지금 루프로 떨어뜨려 잘못 나가는 글 0(`spam-block-hint.ts:212-224`) · diagFix 는 버전에 묶여 남아도 안 쓰임(§9-2 · §15) |
| 7 | [high] 통지 직전 문안이 바뀌면 옛 글의 승인 문자에 새 버전 링크 | 수용 · 통지 직전 버전 ≠ savedVersion 이면 승인 문자 0 · 새 버전은 자기 주기(§9-2) |
| 7 | [high] 담당자 번호가 명단에도 있으면 승인 전 바뀐 글 도착 | 불수용 · 담당자 = 고객사 승인권자 · 테스트 문자는 지금도 다듬은 글을 승인 전에 같은 길로 보냄(`agency-send-worker.ts:1173-1182`) · 받는 사람 발송이 아님 |
| 7 | [high] diagFix 우선 재개가 뒤 보류 후보를 덮음 · 바꾼 곳 줄이 승인 대상과 갈림 | 수용 · 재개 우선순위 보류 후보 > diagFix > 지금 글 · 바꾼 곳 줄 = 원문 ↔ 저장 글 대조 · diagFix 의 fixes 칸 없앰(§9-2) |
| 7 | [medium] 승인 뒤 링크를 끄면 목적지 잃음 | 범위 밖 · 고객이 만든 링크도 같은 틈 · 고객 본인 조작(§17) |
| 8 | [medium] 버전 비교 뒤 적재 전에 문안이 바뀌면 옛 승인 문자 적재(7R 첫 지적과 같은 부류 두 번째) | 구조 · 확인 뒤 보내기 줄을 지우고 링크를 `savedVersion` 으로 서명 · 옛 문자 링크는 승인 라우트 잠금 대조가 거절 · 정합성은 승인 라우트 한 곳(§9-2) |
| 8 | [medium] 첫 일반 검사에서 보류되면 diagFix 를 잃음 | 수용 · diagFix 를 커밋한 같은 주기는 그 값을 넣은 행 스냅샷으로 runSpamRound · `heldResultJson` 의 펼치기가 보존(§9-2) |
| 9 | (판정) savedVersion 서명 · 옛 링크 거절 | Codex 「타당 · 잠근 행의 담당자 번호와 버전을 대조해 옛 링크로 새 문안 승인 불가」 · 닫힘 |
| 9 | [medium] 복사본을 넘기면 보류 저장은 바깥 row 를 써서 diagFix 를 지움(8R 표현 잘못) | 수용 · 복사본 0 · 1098 의 같은 `row` 줄에 diagFix 를 얹어 runSpamRound · settleSpamHold 가 같은 row(§9-2) |
| 10 | (판정) 첫 보류 저장 · 장애 재시도가 diagFix 보존 | Codex 확인 · 닫힘 |
| 10 | [medium] 두 반려 길이 결과 칸을 안 써 diagFix 가 남음 | 수용 · 두 반려의 토큰 조건 test_failed UPDATE 에 diagFix 지우기(§9-2) |
| 11 | [medium] setStatus 189 줄과 같은 칸을 두 번 대입 = UPDATE 거절 | 수용 · 지우기 옵션으로 189 줄 한 대입에 `- 'diagFix'` 를 붙임(§9-2) |
| 12 | approve(지적 0) | 설계 리뷰 닫힘 · 1125 10:33 · 다음 = Harold 설계서 확인 → C161 커밋 · 배포 뒤 구현(§15) |

### 18-4 구현 기록 (1126 ~)

- 0단계(1126 Harold 서버 출력): `diag_plan` 칸 0 · 확인 판 3 · 열린 판 0 · 여섯 이름표(S1 · S2 · K1 · K2 · L1 · L2) 밖 판 0 · 대행 진단 대기 0 · 스위치 켠 회사 = 테스트계정.
- 배포 A(읽기 울타리 · 1126): `spam-diag.ts` `readDiagChecks` WHERE 에 `t.variant_id ~ '^[SKL][12]$'` 한 줄. 느슨한 읽기는 그 한 곳뿐(등록 · 같은 판 찾기 = 정확한 이름표 · 닫기 · 잠금 = 부모의 판 전부 = R 판도 닫음). 시험 = `spam-diag-register-1124.pg.test.ts` 「★ 1126 읽기 울타리」(고치기 전 빨간불 = 도착한 R1 이 판 ① 도착으로 읽힘). 운영에서 읽기가 달라지는 행 0(0단계). Codex 구현 1R approve(gpt-6.2-sol · high · 하위 0 · 로그 대조).
- 배포 A 운영 반영(1126 08:03 · e6c10867 · Harold 서버 출력): pull Fast-forward 3 파일 · 백엔드 build:safe 통과(.js 927 · 두 판 3,708 일치) · 적재 0건 한 줄 → pm2 reload · online · dist `spam-diag.js` 「SKL」 1 · 08:03:19 이메일 접수 워커 시작 · 재시작 뒤 에러 로그 새 종류 0 · 적재 중 0건. 트랙 번호 = C164(STATUS-FEED 카드 · 원장 C164-H1 · H2 · S1).
- 본 구현(1126 · 배포 B 대상) 구조:
  - 순수(`spam-block-hint.ts`): `editableLines` · `plateFixes` · `classifyRewrite` · `applySpamFixes` 새로 · 옛 `makeDiagVariant` · `classifyDiag` · `CarrierChecks` · 「빼도 막힘」 표시(`confirmedNotSole`) 삭제.
  - 사라진 숫자 `findLostNumbers`(`copy-benefit-detector.ts` · 값 읽기 = `findNewNumbers` 와 같은 꼴) → `checkRefined` ⑤(대행 다듬기 루프에도 적용 = §13 의 의도한 변화).
  - 표현 판 = `refineForSpam` 새 인자 `editable`(고칠 줄의 줄 위치) · 번호 붙인 줄만 요청 · 같은 번호 · 같은 줄 수일 때만 제자리에 넣음 · 원가 기록 이름 `spam-diag-rewrite`.
  - 주소 바꾸기 CT `utils/spam-link-swap.ts`(`swappableUrls` · `swapUrlsInPlate`) · `createCustomShortLink` · `issueUniqueCode` 선택 인자 `run` · 짧은 주소 글자 `customShortLinkUrl`.
  - 등록 `enqueueSpamTest diag{ carriers[] · plan · guard · prepare }` · 판 글이 등록 안에서 바뀌면 지문(message_hash)도 그 글로 · 결과 행 = 대상 통신사마다 단말 한 대 · 대기열 실행은 한 행이 관문에서 멈춰도 나머지 행을 이어 본다.
  - 판 CT `spam-diag.ts` 다시 씀: `readPlates` · `rewriteStepOf` · `rewriteEligibility` · `registerPlate` · `advanceRewrite`(자격 = 이 한 곳) · `markPlateEnded` · `startScreenRewrite` · `nextScreenRewrite` · `applyScreenFix` · `runSpamRewriteCycle`(30초) · `closeDiagnosis` 닫힘 표시 · 정본 문구(카드 `RewriteCard` · 판 이름 · 상태 · 해 본 것 한 줄).
  - 라우트: `POST /tests/:id/rewrite` · `/rewrite/next` · `/fix-apply` 새로 · `/diagnose` 삭제 · 소유 확인 `ownManualSpamTestId`(CT).
  - 대행 `agency-spam-diag.ts`: 4a 삭제 · `DiagStep` = wait · pass · found · 4c · `recoverAgencyHold` · `diagFixOf` · `agencyFixLines` · 워커 = 찾은 글부터 3사 검사 · 두 반려만 `dropDiagFix` · 승인 링크 서명 = `savedVersion` · `buildPassedNotify fixLines` · `buildTestFailedNotify` 의 `addressCause` 삭제.
  - 화면: `SpamBlockHintCard.tsx` 다시 씀(서버 문장 그대로 · 한 카드) · 검사 창이 원문(`template`)과 받기(`onApplyFix`)를 받는다 · 공용 점검 훅(`useSendPrecheck`)이 넘김 = 직접발송 · 타겟 발송 · 대행 상세 문구 둘 · 진행 기록 `spam_fixed`.
- 설계서와 다르게 정한 것(이유):
  - `refineForSpam.editable` = 글자 목록이 아니라 줄 위치(같은 줄이 두 번 나와도 자리가 분명하다).
  - 찾음 = 마지막 판이 아니라 「대상 전부 도착한 첫 판」(막힘 결과가 늦은 보고 10분 창 안에 도착으로 바뀔 수 있다 · 앞 판이 바꾼 곳이 적다).
  - 화면에서 누른 길(시작 · 주소 물음 답)은 못 만들어도 끝 사유를 적지 않는다(사람 클릭만큼만 다시 시도 · 자동으로 이어 돌리는 길만 적는다).
  - 닫힌 진단(대행이 끝낸 것)을 화면에서 보면 의심 부분만 보인다(판 줄 · 단추 0).
  - 승인 문자의 바꾼 곳 줄 = 줄마다 다섯까지 · 한쪽 40자까지(그 밖은 수만) · 줄 수가 달라진 글은 머리 줄만.
  - 주소 끝에 붙은 문장 부호(마침표 · 닫는 괄호)는 원래 주소에서 뗀다(휴대폰은 그 부호를 주소로 보지 않는다 · 그대로 저장하면 짧은 주소가 다른 곳을 가리킨다).
  - 응답의 통신사 줄에 옛 칸(checks · next 등)을 빈 값으로 함께 싣는다(배포 때 열려 있던 옛 화면이 깨지지 않게 · 다음 정리 때 지움).
  - 대행 제목 원문 = 부모 검사의 제목(대행은 제목을 바꾸지 않는다).
- 시험(1126 · 구현 리뷰 전 · 최종 수는 아래): 순수 `spam-rewrite-pure-1126.test.ts` 26 · 표현 판 · 주소 대상 `spam-rewrite-wording-1126.test.ts` 9 · 실 PG `spam-rewrite-1126.pg.test.ts` 4(주소 바꾸기 · 되돌림 · 재사용 · 상한) · `spam-diag-register-1124.pg.test.ts` 20(등록 · 대상 줄어듦 · 같은 판 · 소유 · 닫힘 · 상한 · 주소 판 · 일꾼 · 끝 사유 · 관문 · 교착 · 대행 판 · 되찾기 · 찾은 글 저장 · 30분) · 옛 계약 시험 넷을 새 계약으로 고침(면제 목록 늘리기 0).
- 구현 리뷰(§18-5) 뒤의 구조(1126 · 리뷰 전 구조에서 바뀐 곳):
  - 판과 받기의 짝 = 줄 자리로 고른 뒤(`editableLines` · 원문 k번째 줄 = 검사 글 k번째 줄) **발송 조립기로 확인**한다. 관문 ① = 원문을 조립하면 검사한 글이 글자 그대로(`advanceRewrite` · 아니면 고칠 줄 없음 · AI 0). 관문 ② = 바꿈을 넣은 원문을 조립하면 판 글이 글자 그대로 + 판 글이 검사한 글의 법정 표기를 글 전체로 지킴(`registerPlate` 의 `rendersTo` · `keepsLegalMarks` · 주소 판은 등록 트랜잭션 안에서 같은 대조).
  - 화면 조립 = `screenRenderer`: 재료는 그 검사 행의 first_recipient 뿐(화면은 원문 · 제목만 보낸다). 광고 표기 켬 · 끔 × 조립 꼴 둘(명단 칸 · 고객 표본 행) 중 원문을 검사 글로 조립하는 조합 전부가 같은 글을 낼 때만 그 글. 대행 = `sampleRendererOf`(그 접수 첫 수신자의 실물 조립).
  - 법정 줄 = 발송 조립기에 묻는다(`assemblerLegalLine` = 수신거부 꼬리말은 조립기의 그 식 · 광고 머리말은 조립기가 머리말을 더 붙이지 않는가). 줄 판정은 AI 로 보낼 줄을 고르는 데 · 등록은 글 전체 대조.
  - 표현 판의 주소 = 주소 꼴 덩어리를 자리표시(`<<URLn>>`)로 가려 보내고, 같은 줄 · 같은 순서일 때만 원래 글자를 되돌린다. 되돌린 뒤 줄마다 주소 꼴 목록이 원래 줄과 같아야 한다. 꺾쇠 쌍(`<<` · `>>`)이 든 줄은 보내지 않고 그대로 두고, 되돌린 줄에 꺾쇠 쌍이 남으면 버린다. 피할 표현의 주소 꼴은 싣지 않는다.
  - C160 계약 표(치환 호출이 든 발송 파일)에 `utils/spam-diag.ts` = 조립 대조 · 발송 아님.
- 설계서와 다르게 정한 것(구현 리뷰 뒤 추가):
  - 꺾쇠 쌍이 든 줄(「<<특가>>」 · 「바로 가기 >>」)은 표현을 바꾸지 않는다(자리표시와 같은 글자라 남은 자리표시를 가려낼 수 없다).
  - 회사 메모리에 적힌 주소가 AI 시스템 프롬프트에 실리는 것은 막지 않는다(주소를 가리는 목적 = AI 가 주소를 바꾸지 못하게 · 직접 쓴 주소는 대조가 버린다 · §18-5 4R 불수용).
  - **미검증**: 타겟 발송에서 변수가 든 글은 서버 조립이 화면 조립과 같은지 확인하지 못했다. 다르면 관문 ① 이 「고칠 줄 없음」으로 닫는다(판 0 · 틀린 판은 나오지 않는다). 직접발송의 변수 든 글은 화면이 검사 글을 만드는 두 함수로 실 PG 시험에 고정했다.
- 시험(1126 · 최종): 순수 `spam-rewrite-pure-1126` 25 · 표현 판 `spam-rewrite-wording-1126` 16 · 계약 · 문구 `spam-diag-deploy2-1124` 31 · 실 PG `spam-diag-register-1124.pg` 30 · `spam-rewrite-1126.pg` 5 · 변이 = 3R 5개 · 4R 4개 · 5R 4개 · 6R 3개 전부 빨간불 뒤 원복 · 실 PG 전체 121파일 1,108(스탬프 기록) · 단위 전체 864파일 14,291 중 C160 계약 표 1건 빨간불 → 표 한 줄 뒤 그 파일 + 스탬프 시험 219 통과 · tsc 백엔드 · 프론트 0.


### 18-5 Codex 구현 리뷰 (gpt-6.2-sol · high · 하위 0 · 라운드마다 로그 대조)

| R | 지적 | 판정 · 처리 |
|---|---|---|
| 1 | [high] 같은 판 번호가 이미 있으면 소유 · 닫힘 · 부르는 쪽 조건을 건너뛰어, 화면과 대행이 첫 판을 함께 걸 때 늦은 쪽이 남의 판을 자기 것으로 받고 그 진단을 닫을 수 있음 | 수용 · 등록 잠금 아래 닫힘 → 소유(대행 = 같은 접수 · 같은 문안 버전) → 부르는 쪽 조건을 먼저 · 같은 번호 판은 종류까지 같을 때만(`samePlateOwner`) |
| 1 | [high] 주소의 대소문자만 바뀐 글이 통과 · 그 뒤 자동 판이 클릭 없이 새 링크를 만들 수 있음 | 수용 · 고칠 줄만 바꾼 글은 주소가 글자 그대로(개수까지)여야 함(`url-changed`) · 새 링크는 주소 판(w1u · w2u)에서만(`swapUrlsInPlate create`) |
| 1 | [high] 수신자 값이 우연히 원문의 다른 줄과 같으면 그 줄과 짝지어 값 줄이 AI 로 가고 판과 받기가 다른 줄을 고침 | 수용 · 같은 글자의 줄 수가 보낸 글과 원문에서 다르면 그 글자의 줄은 전부 고정(`editableLines`) |
| 1 | [high] 받기 응답이 늦으면 닫힌 검사 창이 그 사이 고친 작성 칸 글을 덮어씀 | 수용 · 카드가 사라진 뒤 온 응답은 버림 · 검사 창은 그 검사를 아직 보고 있을 때만 작성 칸에 넣음 |
| 1 | [medium] 되찾은 대행 대기(결과 칸에 대기 없음)의 첫 판이 이미 막혔으면 다음 판 등록이 거부됨 | 수용 · 등록 조건 = 결과 칸의 대기가 그 T 이거나 없을 때(닫힌 진단은 판 행의 닫힘 표시가 막는다) |
| 1 | [medium] 통신사 둘 판에서 한 행이 관문에서 거부되면 판이 닫혀 나머지 결과가 빈 채 남음 | 수용 · 거부로 판을 닫는 것은 열린 행이 더 없을 때만 |
| 1 | [medium] 스위치를 끈 뒤에도 이미 찾은 글은 받기가 됨 | 수용 · 받기도 회사 스위치를 봄 · 카드의 받기 단추도 자격이 될 때만 |
| 1 | [medium] 칸이 없을 때 「다음 판」 · 「받기」가 409 | 수용 · 화면 입구 셋 · 판 만들기가 칸 준비를 맨 먼저 봄(없으면 503) |
| 2 | (판정) 1R 의 소유 순서 · 대기 없는 복구 · 거부 뒤 판 유지 · 스위치 꺼진 받기 · 늦은 받기 · 칸 없음 503 | Codex 「지정 경로에서 추가 차단 결함을 확인하지 못함」 · 닫힘 |
| 2 | [high] 광고 표기가 첫 줄에 붙으면 줄 수 대조를 지나 수신자 값 줄이 원문 첫 줄과 짝지어짐(1R 「값 줄을 다른 원문 줄과 짝지음」과 같은 부류 두 번째) | 구조 · 글자가 같은 줄을 찾지 않고 **줄 자리**로 짝지음(검사 글은 원문 줄 순서 그대로 · 원문 줄 수 뒤에 빈 줄 · 수신거부 줄 말고 다른 줄이 남으면 고칠 줄 0) · 1R 에 덧댄 줄 수 대조 삭제 |
| 2 | [high] 스킴 없는 주소의 www 빠짐 · 두 주소의 줄 사이 맞바꿈이 주소 대조를 통과(1R 「주소 대소문자 변경 통과」와 같은 부류 두 번째) | 구조 · 주소를 뽑아 견주지 않고 고칠 줄의 주소 꼴을 자리표시(<<URLn>>)로 가려 보냄 · 받은 줄마다 같은 자리표시가 같은 순서일 때만 원래 글자를 되돌림 · 1R 에 덧댄 주소 철자 대조 삭제 |
| 3 | [high] 원문에 수신거부 줄이 있으면 수신자 값의 줄바꿈으로 밀린 줄이 수신거부 줄에 가려져, 값 줄이 AI 로 가고 판과 받기가 다른 줄을 바꿈(1R · 2R 「줄 출처」와 같은 부류 세 번째) | 구조 · 줄 짝을 글자 · 자리로 **추정**하는 데서 끝내지 않고 발송 조립기로 **확인**한다. 관문 ① = 원문을 조립하면 검사한 글이 글자 그대로 나와야 판을 만든다(아니면 고칠 줄 없음 · AI 0). 관문 ② = 바꿈을 넣은 원문을 조립한 글이 판 글과 글자 그대로 같아야 등록(아니면 판 0 · 주소 판은 등록 트랜잭션 안에서 같은 대조). 화면 = 재료를 화면에서 받지 않는다 · 그 검사 행이 저장한 첫 수신자 값(first_recipient)으로 광고 표기 켬 · 끔 × 발송 조립기의 두 꼴(명단 칸 · 고객 표본 행)을 대 보고 검사 글을 다시 만드는 조합만 씀(`screenRenderer` · 뒤 판 · 일꾼도 같은 함수) · 대행 = 그 접수의 실물 조립기(`sampleRendererOf`) |
| 3 | [high] 자리표시가 다 있어도 되돌린 주소가 달라짐(조사가 붙어 경로가 바뀜 · 새 주소를 덧붙임 · 덜 된 자리표시가 남음 · 1R · 2R 「주소 온전함」과 같은 부류 세 번째) | 구조 · 자리표시의 수 · 순서 대조에 더해, 되돌린 뒤 줄마다 주소 꼴 덩어리 목록이 원래 줄과 글자 그대로 같아야 통과 · `<<URL` 이 남은 줄은 버림(`url-moved`) |
| 3 | [high] 발송 조립기가 인정하는 법정 표기(「( 광고 )」 · 「무료 수신 거부」 · 「무료거부」)가 고칠 줄에 들어가 AI 가 지울 수 있음 | 수용 · 고칠 줄의 법정 줄 판정을 발송 조립기에 묻는다(`assemblerLegalLine` = 꼬리말은 조립기의 그 식 · 머리말은 그 줄에 조립기가 머리말을 더 붙이지 않는가 · 식을 따로 두지 않음) · 광고 발송이면 관문 ② 도 표기가 사라진 판을 버림 |
| 3 | [medium] 피할 표현 목록으로 가린 주소(도메인 · 메일 주소)가 AI 요청에 실림 | 수용 · 본문을 가리는 그 판정으로 피할 표현도 거름(주소 꼴이 든 항목은 싣지 않음) |
| 3 | (시험) 관문 ① · ② · 법정 줄 판정 · 되돌린 뒤 주소 대조 · 피할 표현 거르기를 하나씩 뺀 변이 5개 | 전부 빨간불 · 원본 되돌림 · 화면이 검사 글을 만드는 두 함수(`buildAdMessageFront` → `replaceDirectVars`)를 독립 출처로 「서버 조립 = 화면 조립」을 실 PG 시험에 고정 · 타겟 발송의 변수 든 글은 서버 조립이 화면 조립과 같은지 미검증(다르면 관문 ① 이 「고칠 줄 없음」으로 닫는다 · 판 0) |
| 4 | [high] 줄을 넘는 광고 머리말(「(광고」 줄바꿈 「)」) · 꼬리말은 줄마다 보는 판정에서 빠지고, 광고 켬 · 끔이 둘 다 원문을 다시 만들 때 첫 조합(끔)만 써서 표기가 깨진 판이 관문을 지남(3R 「법정 표기 판정」과 같은 부류 두 번째) | 구조 · 법정 표기를 줄이 아니라 **글 전체**로 조립기에 묻는다(`keepsLegalMarks` = 판 글의 머리말 인정 · 꼬리말 인정이 검사한 글과 같아야 등록 · 관문 ② 안 · 화면 · 대행 공통). 맞는 조립이 여럿이면 **전부가 같은 글을 낼 때만** 그 글(`screenRenderer`). 줄 판정(`assemblerLegalLine`)은 AI 로 보낼 줄을 고르는 데만 남는다 |
| 4 | [medium] 본문에서 가린 주소가 회사 메모리를 거쳐 시스템 프롬프트에 실릴 수 있음 | 불수용 · 주소를 가리는 목적은 감추기가 아니라 AI 가 주소를 바꾸지 못하게 하는 것이다(온전함). AI 가 주소를 직접 쓰면 자리표시 대조 · 되돌린 뒤 주소 대조가 그 답을 버린다(틀린 판 0). 회사 메모리는 그 회사가 AI 에 주려고 적은 글이고 대행 다듬기가 지금도 그대로 싣는다(이 변경이 새로 내보내는 값 0) |
| 4 | [medium] 소문자로 남은 자리표시(「<<url>>」)가 판 글에 들어감(3R 「덜 된 자리표시」와 같은 부류 두 번째) | 구조 · 남은 자리표시를 철자로 찾지 않는다 · 되돌린 줄의 「<<」 가 원래 줄보다 늘었으면 버린다(원래 글의 꺾쇠 꾸밈은 그대로 통과) → 5R 에서 구조를 바꿈(아래) |
| 4 | (시험 공백) 주소 판의 관문 ② 호출을 빼도 시험이 못 잡음(되돌림 시험이 대역 prepare 로 null 을 돌려줌) | 수용 · 실제 등록 트랜잭션을 지나는 시험(짧은 주소가 든 글만 조립이 어긋남 → 판 0 · 링크 수 그대로 · 맞으면 주소 판) · 변이 4개(글 전체 표기 대조 제거 · 첫 조합만 · 주소 판 관문 ② 제거 · 늘어난 꺾쇠 대조 제거) 전부 빨간불 |
| 5 | [medium] 원래 글의 꺾쇠 꾸밈(「<<특가>>」)을 AI 가 풀어 쓰면서 「<<url>>」을 남기면 꺾쇠 개수가 같아 통과(3R · 4R 「남은 자리표시」와 같은 부류 세 번째) | 구조 · 되풀이된 까닭 = 자리표시의 꺾쇠 쌍이 고객 글에도 있을 수 있는데 한 줄에 섞인 채 꼴 · 개수로 가려내려 했다. 섞이지 않게 한다: 꺾쇠 쌍(<< · >>)이 든 줄은 AI 로 보내지 않고 그대로 둔다 → 되돌린 줄에 꺾쇠 쌍이 남았으면 전부 못 되돌린 자리표시라 버린다(철자 · 개수 대조는 지움) |
| 5 | [low] 글 전체 표기 대조에서 꼬리말 쪽만 빼면 시험이 못 잡음 | 수용 · 광고를 끈 글의 줄을 넘는 수신거부 꼬리말을 깨뜨리는 실 PG 시험 · 변이 4개(되돌린 줄의 꺾쇠 쌍 대조 제거 · 꺾쇠 쌍이 든 줄도 보냄 · 꼬리말 인정 대조 제거 · 머리말 인정 대조 제거) 전부 빨간불 |
| 6 | (소스 결함 0) [low] 보내지 않는 줄이 보낸 줄보다 앞 · 사이에 있을 때 답이 제자리에 들어가는지를 시험이 고정하지 못함 · 「<<」 만 · 「>>」 만 든 줄을 따로 보지 않음 | 수용 · 시험을 그 배치로 바꿈(「<<」 만 든 줄이 맨 앞 · 「>>」 만 든 줄이 보낸 두 줄 사이 · 요청의 [1] [2] 와 결과의 줄 자리 · 빠진 줄 글자 그대로) · 변이 3개(답을 원래 고칠 줄 자리에 넣음 · 「<<」 만 든 줄은 보냄 · 「>>」 만 든 줄은 보냄) 전부 빨간불 |
| 7 | (6R 시험 고침만) | **approve** · 지적 0 · 「복원에 원래 고칠 줄 자리를 쓰면 본문 비교가 실패 · 필터에서 꺾쇠 한쪽을 빼면 줄 수가 어긋나 첫 단언이 실패」 확인 |
| 8 | (7R 뒤 단위 전체에서 C160 계약 표 1건 빨간불 → 표에 `utils/spam-diag.ts` = 조립 대조 · 발송 아님 한 줄) | **approve** · 지적 0 · 「조립한 글은 글자 대조에만 쓰이고 검사 큐가 저장 · 보내는 글은 판 글(rendered)」 확인 |
