# 마케팅플래너 v2 설계서 (2026-10-18)

> 결정 경로 = 비토 구조체크(후보 5) → 「발동」 5역할 회의 세 번(① v2 완성본 · 디자인 · 입력 / ② 입력 축 한 줄 / ③ 담당자 원클릭 링크 · 각 1차 → 교차 1라운드 → 회의론자 최종 검증) → Harold 1018 「추천하는 방식으로 전부 마무리 · 승인 클릭 = 확인 모달 · 모바일 취소 · 미루기 · Codex 닫힐 때까지 · 배포 명령」.
> 상설 = [FEATURE-MARKETING-PLANNER.md](FEATURE-MARKETING-PLANNER.md)(불변 원칙 · 상태 기계 · 소유표). 이 문서는 이번 개편의 근거 · 순서 · 묶음별 설계다.
> 선행 설계 = [1004 재료 · 행사별 승인](2026-10-04-planner-material-approval-design.md) · [1017 템플릿 캠페인](2026-10-17-line-template-campaign-design.md) · [1017 한 줄 단계](2026-10-17-oneline-steps-modal-design.md) · [1016 대행 모바일](2026-10-16-agency-send-mobile-control-design.md).

## 0. Harold님 의견 3가지 반영 확인

| # | Harold님 문장 | 반영 | 자리 |
|---|---|---|---|
| ① | 「승인도 클릭하면 모달로 다시 확인 띄우는거고」 | 승인 버튼은 모두 **확인 창 → (링크면) 인증번호 → 실행**. 확인 창 = 받는 사람 수 · 나갈 문안 · 비용 · 되돌릴 수 있는지 한 줄 | 플래너 링크 [새 문안으로 보내기] · [고친 문안으로 보내기] · PC 할 일 같은 버튼 · 대행 링크 [승인하기](지금은 바로 실행 · 정정) · PC 행사 승인은 이미 확인 창(ApproveBody) |
| ② | 「취소도 되게해야지 … 모바일로 취소도 되어야하는거아니냐」 | 플래너 링크 [행사 취소] = 확인 창 + 인증번호 + 「낸 발행비·완성비는 돌려드리지 않아요」 · 대행 링크 [이 발송 취소] = 확인 창 + 담당자 전원 통보(1016 설계 축 2 그대로) | §3-2-6 · §3-7 |
| ③ | 「미루기를 하면 어떻게해」 | 지금 넣는다. 조건 = 행사 기간 안 · 그날 그 회사의 다른 문자가 없는 날 · 새 날짜 문안을 다시 만들고 다시 확인(승인)받는다 | §3-2-5 |

- 인증번호 차이의 근거: 플래너 [행사 취소]는 그 행사의 **남은 모든 날**을 멈추고 되돌릴 수 없어(전달받은 링크 한 번이 한 달치를 멈춘다) 인증번호를 건다. 대행 [이 발송 취소]는 **그 한 건**이고 1016 승인 설계가 「멈추는 쪽 = 인증번호 없이 · 전원 통보」로 정했다. [오늘만 건너뛰기]도 그 하루 한 쌍이라 인증번호 없이.
- 나머지 결정은 전부 추천대로: H1 승인 버튼 앰버 · H2 시나리오 묶음 기본값 · H3 인앱 게시비 = 켤 때(v2-2) · H4 생성비 DM 5 + 메일 3 유지 · H5 1년 캘린더 v2 밖 · I1 달 넘기기 버튼 = 달력 카드 머리 · I2 새 ENV `PLANNER_LINE_COMPANY_IDS` · I3 플래너 메일 매장 범위 적용 · I4 「1+1」 추천 규칙 별건 · J1 링크에서 직접 고치기 허용(인증번호 뒤) · J2 여정 자동보정 유지 + 보정하면 알림 설정과 무관하게 통지 · J3 자동마케팅 정지 유지 · J4는 Harold님 ②③으로 바뀜.

## 1. 접수 축 대조표

| 접수 항목 | 닫는 묶음 | 이 묶음 없이 닫히나 |
|---|---|---|
| 1017 템플릿 품질을 플래너 완성본에 | T · M | 아니오 |
| 디자인 개선 | M(행사 담기 창 · 캘린더 · 할 일 · 확인 화면) | 아니오 |
| 입력 개선(두 판) | M | 아니오 |
| 한 줄 입력 → 기간 · 혜택 · 타겟 읽기 → 빠진 것만 되묻기 | I | 아니오 |
| 타겟 = 상품 구매자 | I | 아니오 |
| 발송 당일 스팸 실패 → 담당자 원클릭 처리(수정본 보내기 · 고치기 · 미루기 · 건너뛰기 · 취소) | R · L | 아니오 |
| 휴대폰 승인 = 인증번호 | R · L | 아니오 |
| 대행 · 자동마케팅 · 여정 담당자 링크 | J · A · O | 아니오 |
| 승인 클릭 = 확인 모달(Harold ①) | L · A | 아니오 |
| 모바일 취소(Harold ②) | R · L · A | 아니오 |
| 미루기(Harold ③) | R · L | 아니오 |
| 플래너 승인이 막힐 수 있는 선행 결함 F0 | P0 | 아니오(승인 자체가 막힌다) |

빠진 축 0.

## 2. 묶음 순서

| 순서 | 묶음 | 돈·발송 | Codex |
|---|---|---|---|
| P0 | F0 플래너 대상 축(`segmentKey 'all'`) | 발송 | 적대 |
| J | 여정 정지 링크 결함 5 + 버튼 2 | 발송(정지) | 적대 |
| R | 플래너 당일 재확인 서버(쌍 단위) | 발송 | 적대 |
| L | 링크 화면 공통 틀 · 확인 창 · PC 할 일 카드 | — | (L 서버 경로는 R과 한 묶음) |
| T | v2-1 템플릿 완성본 서버 | 돈(생성비) | 적대 |
| M | v2-1 행사 담기 창 · 캘린더 · 확인 화면 디자인 | — | 제외(UI) |
| I | 입력 축(한 줄 · 상품 구매자 · 메일 같은 대상 · D3 개정) | 발송 대상 | 적대 |
| A | 대행 축 1~4(DDL 1) + 링크 승인 확인 창 | 발송 | 적대 |
| O | 자동마케팅 예고 문자 멈춤 링크 | 발송(정지) | 적대 |

**이번에 하지 않는 것(추천 순서 그대로)**: v2-2 인앱 기간 노출(「v1 실측 먼저」 · 켤 때 워커) · 알림톡 검수 패스와 참여 체인 삭제(별도) · 입력 축 2차(VIP · 휴면 · 칸 조건 · 자사몰+원장 합치기 · 시점 말 · 1+1 추천) · 여정 2차(스팸 정지 · 자동보정 링크) · 자동마케팅 링크 [승인](인증번호).

## 3. 묶음별 설계

### 3-0. P0 · F0 플래너 대상 축
- 결함(코드 확정 · 운영 미검증): `planner-audience.ts:53-56` 이 축 없이 `compileOperatorAudience` 를 부른다 → `operator-audience.ts:303-305` 빈 조건 = `AudienceEmptyError`(1005 「빈 조건 = 전체 금지」). 승인(`countEventSmsAudience` → error → 503) · 발송(`resolvePlannerAudience` throw → 실행 오류 → 10분마다 재시도)이 같이 막힌다. 운영 로그(.62 error 로그) 0줄 = 보존 기간 안 플래너 실행 0(운영 미검증).
- 처방 = `segmentKey: 'all'`(자동마케팅 전체 고객 계약 · `automarketing-segment.ts` `all` · 조건 빈 문자열 = 명시 전체).
- 영향: `resolvePlannerAudience` 소비처 = 실행부(발송) · `countPlannerAudience`(확인 화면 · 승인) 둘. 참여자 축은 그 뒤 술어를 붙이는 그대로.

### 3-1. J · 여정 정지 링크
결함(코드 확정):
1. **대표 1건만 정지** — 묶음(여정 · 단계 · 날짜)의 대표 실행 하나만 토큰에 실리고(`journey-pretest-scan.ts:72-77`) 정지도 그 하나만(`journey-pause-handler.ts:82-91`).
2. **서명 키 기본값** `'d218_pause_default_secret'`(`:26`) — 저장소 문자열로 위조 가능.
3. **토큰이 주소 경로에** — `/journey-pause/<token>` 이 접근 로그 · Referer 로 샌다. 같은 경로가 화면 라우트(`App.tsx:794`)와 공개 API(`app.ts:427` 루트 마운트)에 겹친다: nginx 가 `/api/` 만 백엔드로 넘기므로(OPS §) 화면의 `fetch('/journey-pause/…')` 는 화면 HTML 을 받을 수 있다(운영 미검증).
4. **링크 주소 바탕이 단축 주소 변수** `SHORT_URL_BASE`(기본 `https://app.hanjul.ai/c`) — 운영 값이면 `/c/journey-pause/…` 가 된다(운영 ENV 미검증). 대행 · 플래너는 `HANJUL_BASE_URL`.
5. **번호를 담당자가 직접 입력**(`JourneyPausePage` `paused_phone`) · **못 멈춰도 「정지 성공」**(B9 · 실행부 `sending` 표식 INSERT 에 상태 조건이 없다 `journey-executor.ts:1127-1134`).

처방:
- 토큰 = 같은 HMAC 형식 + 받은 번호(`p`) · 키 미설정이면 발급 throw · 검증 null(기본값 삭제) · 비교 = `timingSafeEqual`.
- 주소 = `${HANJUL_BASE_URL}/journey-pause#t=<token>` · API = `/api/journey-pause/{info,pause,pause-journey}` 토큰 헤더 `X-Journey-Pause-Token` · 옛 화면 경로 `/journey-pause/:token` 은 화면이 주소의 토큰을 읽어 같은 API 를 부른다(이미 나간 24시간 링크).
- 키가 없으면 안내 문자는 링크 줄만 빼고 보낸다(B10 · pretest_paused 는 여정이 이미 멈췄다).
- [이 발송 정지] = 누르는 순간 **그 여정 · 그 단계 · 그날(KST) · active** 실행을 다시 조회해 한 트랜잭션에서 `FOR UPDATE` → paused(M4) · 그 뒤 들어온 실행은 이 정지로 못 막는다(결과 문장에 적고 [여정 전체 일시정지] 안내) · 정지 직후 그 단계 · 그날 이미 `sending`/`sent` 표식 수를 세어 사실대로 답한다(「N건은 이미 보내는 중이라 멈추지 못했습니다」 · B9).
- [여정 전체 일시정지] = 기존 `pauseJourney` CT(같은 토큰 · 확인 창).
- 정지 기록의 번호 = 토큰에 실린 받은 번호(입력 칸 삭제).
- J2: 자동보정(`pretest_autofixed`)은 단계 알림 설정과 상관없이 늘 통지.
- 화면 = 링크 공통 틀(§3-3) 밝은 판.

### 3-2. R · 플래너 당일 재확인 (쌍 단위)

**뿌리**: 발송 당일 스팸 실패 한 번이 행사 전체 승인을 푼다(`planner-executor.ts:361-364` → `backToReview` → `revertEventToReview` = 행사 draft · 남은 접점 전부 planned · 문안 삭제 · 리비전 + 1 · `planner-review.ts:104-128`). 다른 날 발송까지 「승인되지 않아」로 빠진다.

#### 3-2-1. 상태
- 재확인 = **그 쌍(캐리어 문자 + 같은 날 DM)만** `planned` + `exec_meta.recheck` · 행사는 승인 상태(approved · scheduled · producing) 그대로 · 다른 접점의 승인 각인 그대로.
- `exec_meta.recheck` = `{ round, date, origin: 'send_day'|'post_approval', reason, at, proposal?, proposalTried?, notifiedUserId?, notifiedAt?, tokenHash?, tokenExpiresAt?, remindedAt?, deferredFrom? }` · 쌍의 두 행에 같은 값(한 문장).
- 사람 고친 글 보존: `copy` 를 지우지 않는다. 새 문안은 `recheck.proposal`(실주소 DM 링크를 붙여 검사 통과한 것만).
- 들어오는 곳 = 실행부 ④(당일 스팸 · 판정 blocked) · 승인 직후 실주소 스팸 패스(판정 blocked). 그 밖의 되돌림(지문 어긋남 · DM 닫힘 · 문안 없음)은 행사 단위 그대로(내용이 바뀐 일이다).
- 판정 3분할(B6) = `pass`(판정 통과 + 통신사 결과 1개 이상 + 시간 초과·실패 0 · 시연 회사는 검사 0건 통과) · `blocked`(차단) · `error`(그 밖) — 플래너 감싸는 함수 하나 · 다른 호출처 무변경.
- 검사 장애(`error`) ≠ 차단: 실행부는 선점을 놓고 다음 주기에 다시 본다 · 같은 날 2번째 장애면 캐리어와 DM 을 한 문장으로 잠그고 통지(B11 · [다시 시작]).
- 마감 = 그 날 20시(KST · `PLANNER_APPROVAL_DEADLINE_HOUR`). 마감 뒤 실패(20~21시) = 쌍 생략 + 링크 없는 통지 1통 「오늘 발송은 보내지 않습니다 · 다음 발송 M/D 그대로」(M2).

#### 3-2-2. CT (새 파일 `utils/planner-recheck.ts` · 잠금 순서 = 월 원장 → 행사 → 접점)
| 함수 | 하는 일 | 조건 |
|---|---|---|
| `enterPairRecheck` | 쌍 → planned + recheck(round + 1) · `approved` · `post_approval_spam` 제거 | 실행부 = producing + 선점 토큰 · 승인 직후 패스 = ready · 행사 live · 마감 뒤면 생략 + M2 |
| `approvePlannerPairTx` | 고른 문안(proposal / 지금 copy) → copy · 쌍 지문 재계산 → 각인 · ready · recheck 제거 | 행사 live · 쌍 planned · 같은 round · 마감 전 · 고른 문안 검사 통과 · 화면이 본 지문(seenHash) 일치 |
| `skipPlannerPairTx` | 쌍 → skipped(사유 「담당자가 오늘 발송을 건너뛰었습니다」) · 행사 마감 판정 | **승인 CT 와 같은 조건**(B2) |
| `editPlannerPairCopyTx` | copy = 고친 글(spam pending · edited) · 행사 리비전 그대로 · 행사 상태 그대로(B3) | 같은 조건 |
| `deferPlannerPairTx` | 쌍 timing_rule 에 `on: 새 날짜` · recheck(round + 1 · date 새 날짜 · proposal 비움 · deferredFrom) | 같은 조건 + 새 날짜 = 오늘 뒤 ~ 종료일 · 그날 그 회사의 다른 살아 있는 문자 접점 0 |
| `cancelPlannerEvent`(기존) | 행사 취소 | 링크 = 인증번호 뒤 · recheck 표식도 지운다(B4) |

- `TimingRule.on`(선택 · 'YYYY-MM-DD') — `computeTouchpointDate` 가 맨 앞에서 그 날짜를 돌려준다(예정일 계산 한 곳 · 저장 축 새로 없음 · 소비처 5곳이 같은 함수). 입력 검증(`parsePlannerEventInput`)은 받지 않는다(서버만 쓴다). `describeTiming` 은 「행사 기간 중 M/D」.
- B4: 행사 단위 전이 4곳(승인 풀기 `planner-approve.ts:301` · 행사 되돌림 `planner-review.ts:109` · 취소 `:349` · 행사 승인 각인 `:210`)이 같은 문장에서 `recheck` 도 지운다. 토큰 해석 · 그물 · 쌍 CT 셋 다 「행사 live + 쌍 planned + 같은 round」를 다시 본다.
- M1: 행사 승인 때 승인 직후 검사 표식은 **오늘 뒤** 캐리어에만(오늘 것은 실행부 당일 검사가 본다 · `planner-approve.ts:207`).
- M3: 다음 날 놓친 실행 정리(`planner-reconcile.ts:74`)는 recheck 가 남은 쌍에 「다시 확인되지 않아 보내지 않았습니다 · 이 발송에는 크레딧이 빠지지 않았습니다」.
- B1: 쌍 승인 직후 즉시 실행은 `isSendableHourKst` 안에서만 · 밖이면 08시 첫 주기 · 결과 문장도 같은 판정.

#### 3-2-3. 재확인 패스(`runPlannerRecheckPass` · 실행 패스 맨 앞 · 시간대 판정 앞 · 10분 주기 · B7)
1. 수정본 준비 — proposal 없고 오늘 시도 전(하루 1회)이면 AI 1회(크레딧 묶음 · 원가 회사 부담 · cost 0) + 실주소 DM 링크 + 검사(재생성 2회까지) · 혜택이 빠졌거나 원문 · 혜택 · 행사명 · 날짜에 없던 숫자가 생기면 버린다(직접 고치기만 남김).
2. 고친 글 검사 — copy.spam pending 이면 실주소 링크로 검사(재생성 0) · 검사한 글이 그대로일 때만 결과를 쓴다(CAS).
3. 통지 — 통지 전이면 링크 1통(수신 = `pickPlannerNoticeContact` 하나가 `{userId, phone}` · 발송과 `notifiedUserId` 가 같은 값 · B8) · 17시 리마인드 1회(새 토큰 · 이미 처리했으면 없음).
4. 마감 — 그날 20시가 지난 recheck 쌍 = 생략 + 통지(M2 문장).

문자(1통): 「'{행사}' 오늘 문자가 스팸 검사에 막혀 아직 나가지 않았습니다. 새로 쓴 문안은 검사를 통과했습니다. 오늘 20시까지 정하시면 오늘 보냅니다. 정하지 않으시면 오늘 발송만 건너뛰고 다른 날은 그대로 갑니다. {링크}」(수정본이 없으면 둘째 문장 = 「새 문안을 만들지 못했어요. 직접 고쳐 보내실 수 있어요.」)

#### 3-2-4. 링크 · 인증
- 토큰 = 32바이트 · sha256 만 `recheck.tokenHash` · 만료 = 그 날 20시 · 주소 `${HANJUL_BASE_URL}/planner-recheck#t=` · API 운반 = 헤더 `X-Planner-Recheck-Token` · 무효는 같은 410.
- 공개 API(`/api/planner-recheck/*` · 요청 제한): `view` · `auth/start` · `auth/verify` · `approve` · `edit` · `skip` · `defer` · `cancel`.
- **링크 인증 = 기기에 묶인 세션**(B5): `findVerifiedSession` + `evaluateSenderAuthSession`(같은 계정 · 8시간 · 같은 IP 대역 · 같은 브라우저). 통과로 접는 앞단(시행 스위치 · 시범 명단 · 오류)은 쓰지 않는다 — MFA 번호 없음 · 조회 오류 = 막음(fail-closed). 새 CT `checkStrictSenderAuth`(sender-auth.ts).
- 인증이 필요한 행동 = 보내기(승인) · 직접 고치기 · 행사 취소. 필요 없는 행동 = 오늘만 건너뛰기 · 미루기(새 날짜도 다시 승인을 지난다) — 확인 창 + 담당자 전원 통보 + 기록.
- 보내기 · 고치기 · 취소 버튼은 **통지 계정의 users.phone = mfa_phone** · 활성 · 회사 스위치 `PLANNER_LINK_APPROVE_COMPANY_IDS` 안일 때만 보인다(열기 · 실행마다 다시 확인). 아니면 「보내기 · 고치기 · 취소는 PC 한줄로 캘린더 '할 일'에서」.
- 회사 스위치 = 빈 값으로 배포(협회 질의 답 뒤 Harold님이 사내부터 켬). 꺼져 있어도 링크는 보기 + 건너뛰기 + 미루기 · PC 할 일은 전부 된다.
- PC 할 일 = 로그인 경로 `/api/marketing-planner/touchpoints/:id/recheck*` · 같은 화면 본문 함수 · 같은 CT · 인증번호 없음(로그인 MFA 세션 안 · M5).

#### 3-2-5. 미루기 (Harold ③)
- 고를 수 있는 날 = 내일 ~ 행사 종료일 중 그 회사의 다른 살아 있는 문자 · DM 접점이 없는 날(서버가 목록을 준다).
- 확인 창 → `deferPlannerPairTx` → 재확인 패스가 새 날짜 문안을 만들고 검사 → 「새 날짜 문안이 준비됐어요」 링크 통지 → [보내기](확인 창 + 인증번호) → 새 날짜에 발송. 승인하지 않으면 새 날짜 20시에 생략(M2).
- 대행료 · 발행비 변화 없음 · 문안비 10은 보낸 뒤 1회.

#### 3-2-6. 행사 취소 (Harold ②)
- 확인 창: 「남은 발송 N건(날짜 목록)을 모두 보내지 않습니다 · 이미 낸 모바일 DM 발행비 · 메일 완성비는 돌려드리지 않습니다 · 되돌릴 수 없습니다」 → 인증번호 → 기존 `cancelPlannerEvent`(행위자 = 통지 계정 · 범위 = 관리자면 회사 · 아니면 자기 행사).

#### 3-2-7. 구현 기록(1018)
- 진입 = `planner-review.enterPairRecheck`(되돌림 CT 옆 · 순환 import 방지) · 그 뒤 전부 = `utils/planner-recheck.ts`(쌍 CT 4 · 재확인 패스 · 토큰 · 링크 권한 · 화면 본문 `buildRecheckView`).
- 판정 3분할 = `planner-copy.plannerSpamVerdict` · 검사 실행 한 벌 `runPlannerSpamTest`(옛 `spamCheckPlannerCopy` 는 같은 실행의 관대한 해석 · 사전 준비 패스 무변경).
- 검사 장애 = 실행부 `spamCheckDown`(선점 놓기 · `exec_meta.spam_error {date, count}` · 상한 `PLANNER_SPAM_ERROR_LIMIT` 2 = 쌍 함께 잠금 · [다시 시작]이 횟수를 비운다).
- 토큰 = `캐리어id.무작위48` · sha256 만 `recheck.tokenHash` · 정한 뒤 다시 열면 `recheck_closed` 로 결과를 보인다 · 17시 리마인드는 새 링크 없이(열린 화면을 죽이지 않게).
- 링크 권한 = `resolveRecheckLinkActor`(통지 받은 계정 · 회사 스위치 `PLANNER_LINK_APPROVE_COMPANY_IDS` · 활성 · 같은 회사 · users.phone = mfa_phone · 관리자 또는 만든 계정) · 인증 = `sender-auth.checkStrictSenderAuth`(통과로 접는 앞단 없음).
- 받는 사람 하나 = `continuous-operator.pickOperatorFallbackContact`(번호 없는 통지와 같은 함수 · 동작 그대로 꺼냄).
- 즉시 실행 = `planner-executor.kickPlannerTouchpointNow`(발송 시간대 안에서만 · 라우트가 부른다).
- 캘린더 = 재확인 쌍이 있는 승인 행사 = 「보류」(할 일) · 접점 `recheck {round, date}`.
- API = 공개 `/api/planner-recheck/*`(요청 제한 버킷 따로) · 로그인 `/api/marketing-planner/touchpoints/:id/recheck*`.
- 시험 = `planner-recheck-1018.test.ts` 31 · `planner-recheck-pair-1018.test.ts` 8(회차 검사 · 잠금 아래 재확인을 빼면 실패 확인).

### 3-3. L · 링크 화면 공통 틀 · 확인 창 · PC 할 일
- `components/link/LinkShell`(밝은 판 · 회사 이름 · 상황 카드 · 버튼 2~5 · 결과 · 바닥글 「인증번호는 이 화면에만 입력합니다. 전화나 메시지로 묻지 않습니다」) · `LinkConfirmSheet`(확인 창 하나 · 위험 동작 자동 포커스 끔 · S3).
- 쓰는 화면 = `PlannerRecheckPage`(새) · `AgencyApprovePage`(승인 확인 창 · 축 2 버튼) · `JourneyPausePage`(밝은 판 · 버튼 2).
- 인증 = 기존 `useSenderAuth`(확인 요청만 토큰 경로로 바꿔 끼운다 · 대행 선례).
- PC 캘린더 할 일 = 재확인 카드(같은 버튼 · 같은 확인 창 · 인증번호 없음).

### 3-4. T · v2-1 템플릿 완성본 서버 (착수 직전 코드 대조로 정밀화)
- `planner-build.ts` 안 템플릿 분기(템플릿을 고른 행사만 · 없으면 옛 엔진 그대로) · 조립 = 1017 함수 그대로 · 저장 · 차감 · 회수 = 엔진 부품 그대로 · 견적 함수 하나(버튼 금액 · 저장 뒤 견적 · 생성).
- 문구 = AI 1회 · 크레딧 묶음 안 · DM 과 메일이 같은 문구 한 벌 · AI 문구에 숫자 · 혜택 금지 · 혜택 원문 · 마감 날짜 · 행사명 = 코드가 놓는다(메일 제목 · DM 표지).
- 필수 재료 = 버튼 주소(없으면 차감 전 0원으로 막음) · 표지 사진 1장.
- 돈 = 기존 키(quick: DM 5 · 메일 3) · 한 줄 완성 10 없음 · 새 키 0.
- 회의론자 9건: 생성비 이중 차감(묶음 안 · 원장 1행 시험) · 앞 채널 기록 삭제(`planner-event.ts:215` 채널 단위 기록) · 크레딧제 미적용 회사(1017 판정 재사용) · 행사명 · 광고 고정(시험) · 예시 = 결과(같은 저장 함수 · 바이트 비교 시험) · 긴 혜택(30자 넘으면 표지 = 행사명 · 혜택 = 띠) · 추천 입력 위치(판1) · 금액 표시(플래너 견적 하나) · 인앱 멈춤(v2-2).
- 스위치 = 기존 템플릿 · 한 줄 단계 · 자동제작 스위치 · 밖이면 400(옛 엔진으로 몰래 바꾸지 않음).

### 3-5. M · 행사 담기 창 · 캘린더 · 확인 화면 (착수 직전 정밀화)
- 창 하나 판 둘: 판1 행사 이름 · 기간 · 페이지 주소 + 템플릿 4종(서버 예시) · 「템플릿 없이 담기」 / 판2 혜택 + 빠진 재료만(최대 3단계 · `LineStepsModal` 표시 부품만 추출 · 동작 변화 0 단독 변경) + 보내는 순서 + 돈 3줄.
- 손그림 미리보기 삭제 · 공용 창 틀 · PC 2열 1200px 이상 · 375 한 열.
- 캘린더: 시작 카드 4장 상시(1440×800 실측 불합격이면 할 일과 번갈아) · 행사 목록에 템플릿 이름 · 「N번 발송」 · 375 칩 = 점 · 할 일 · 이달 결과 = 외곽선 버튼 · 여러 열 카드.
- 확인 화면: 미리보기 = `PreviewFrame`(스크립트 허용 · 외부 연결 차단 · 열람 수 0) · 요약 「빅세일 · 3번 발송」 · 휴대폰 번호 띠 · 승인 버튼 앰버(H1).
- 구현 기록(1018):
  - 창 = `PlannerEventModal` 다시 씀 · 틀 = `JourneyModalShell`(포커스 가둠 · Esc = 닫기 확인 · 위에 뜬 창이 있으면 그 창 먼저) · 1200px 이상 = 두 판 나란히 · 그 밖 = 판1 [다음] → 판2.
  - 판1 = 이름 · 기간 · 행사 페이지 주소(템플릿일 때 · 꼭) · 템플릿 카드 4 + 「템플릿 없이 담기」 · 예시 = `LineTemplateExampleView`(1017 서버 예시 그대로 · [모바일 DM | 메일] · 크게 보기) · DM 배치(슬라이드형/한 페이지형) · 필요한 재료 칩 · 「이렇게 보내요」 순서 미리.
  - 판2 = 혜택(꼭/있으면) · 템플릿 재료 = 표지 사진 1장(템플릿이 묻는 경우) + 상품(꼭 N개 이상/있으면 · 최대 = 고른 채널 최대의 작은 값) · 템플릿 없이 = 옛 사진·글 판 · 보내는 순서(채널 켜기 스위치 · 잠긴 사유 · 순서 번호 · 같은 고객에게 N번 · 확인 요청일 · 승인 마감 20시) · 바닥 돈 3줄(지금 · 승인할 때 · 발송일마다).
  - 프리셋 = `components/planner/planner-preset.ts`(순수 · 시험 `planner-preset-1018` 6) · 손대기 전까지 템플릿 · 기간 · 채널 상태를 따라 다시 채움 · 고치기 창은 처음부터 손댄 것으로 본다.
  - 관문 = 서버 견적 gate(빠진 재료) · 막히면 버튼 잠금 + 한 줄 · 템플릿 재료 = 글 칸 보내지 않음 · 사진 1장만.
  - 캘린더 = 시작 카드 4(PC만 · 회사 스위치 밖 = 없음 · 누르면 그 템플릿이 골라진 판1) · 행사 목록 「템플릿 이름 · N번 발송」 · 375 달력 발송 = 점 · 할 일 버튼 = 외곽선 · 이달 결과 = 발송마다 카드(여러 열).
  - 확인 화면 = 공용 `PreviewFrame`(DM 추적 호출은 sendBeacon · fetch 뿐이라 connect-src 'none' 에 막힌다 · `dm-viewer.ts:251-255 · 595-599 · 742`) · 요약 「템플릿 · N번 발송」(서버 `view.event.template`) · 휴대폰 발송 번호 띠(머리 아래 고정 · 누르면 그 발송 · 주소 # 은 토큰 자리라 안 씀 · `scroll-mt-28`) · 승인 버튼 4곳 앰버.
  - 설계와 다르게 한 것: ① 판2 재료 부품은 `LineStepsModal` 추출 대신 `make/MakeInputs` 그대로(1017 세 화면 회귀 위험 0 · 플래너가 원래 쓰던 부품) ② 빠진 재료는 한 단계씩이 아니라 한 판에 차례로(누름 수 줄임) ③ 입력 임시 저장(sessionStorage) · 시작 카드 「이 시기 추천」 배지 = 안 함 ④ 시작 카드 1440×800 합격선 = 미실측(배포 뒤 화면 확인 항목).

### 3-6. I · 입력 축 (착수 직전 정밀화)
- D3 개정(한 줄 입력 = 자동화 7메뉴 + 플래너 · 시험 함께) · 읽기 AI 0 · 0크레딧 · 새 순수 파일 · 타겟 구획 먼저 자름 · 기간 범위 새 함수(지난 기간 = 칩 0 · 연말 규칙 같은 출구) · 판1 「이렇게 알아들었어요」 줄마다 확인 탭 → 받는 사람 종류 → 채널 → 템플릿 / 판2 대상 상품 + 「언제 산」 필수 칩 → 혜택 → 재료.
- 대상 = 전체 + 상품 구매자(`planner_events.meta.audience` · 실행부가 행사 meta 를 직접 읽음 · 결제된 주문만 · 들어오는 곳 하나 · 키 ≤ 30 · 저장 때 서버 재검증) · 메일도 같은 대상(플래너 전용 새 함수 · 매장 범위 · 막힘 ≠ 0명) · 전체 대상 지문 바이트 그대로 · 새 ENV `PLANNER_LINE_COMPANY_IDS`.
- 배포 = 프론트 먼저(백엔드를 먼저 내면 대상 칸 필수 400 이 열린 화면을 막는다).
- 구현 기록(1018):
  - 읽기 = `utils/planner-line-read.ts`(순수 · AI 0 · DB 0 · 시험 `planner-line-read-1018` 11) · 받는 사람 구획 먼저 자름(표지 허용 목록 · 「…에게」는 앞말이 고객 · 회원 · 분일 때만) · 셋 갈래(전체 = `isPlainAllCustomersRequest` 만 · 상품 구매자 = 구매 낱말 + 부정 0 · 그 밖 = 사람이 고름) · 기간 = `linePeriodRange`(범위 하나 · 숫자만 쓴 꼴 거절 · 범위 바로 뒤 기한 낱말 거절 · 지난 기간 = 칩 0 + 사유 · 12→1월 끝만 다음 해 · 연말에 적은 1~3월 = 내년) · 혜택 = 기간과 대상 표지를 지운 한 줄 전체로 `lineBenefitPrefill` · 행사명 = 첫 구획 끝 말투 뗌 · 채널 말 = 문자 · DM · 메일만(알림톡 · 인앱 = 「아직 못 보내요」).
  - 받는 사람 = `planner_events.meta.audience`(`PlannerAudience` · `planner-event.ts` 정규화 · 없음 = 전체) · 저장 본문 필수(400 `AUDIENCE_REQUIRED`) · 저장 전 `verifyPlannerAudience`(스위치 · 지금 문 · 관측 목록 키 · 이름 = 서버 목록 이름) · 바뀌면 리비전 +1.
  - 대상 문 = `resolvePlannerAudience` 가 행사 meta 를 직접 읽는다(실행 · 승인 · 확인 화면 · 재확인 = 소비처 4곳이 같은 함수) · 상품 구매자 술어 `buildBuyerPredicate`(자사몰 = 결제된 purchase 이벤트만 · CT-86 `REVENUE_STATUSES` · 원장 = purchases · 키 규칙 = journey-product 한 벌 · since = KST 날짜 0시) · 깨진 값 · 행사 없음 · 스위치 밖 · 문 바뀜 = 막음 + 사유(`PLANNER_REASON.audienceInvalid` · `purchaseDoorChanged` · 전체로 넓히지 않음).
  - 메일 = 같은 문(`countPlannerEmailRecipients` · `resolvePlannerEmailRecipients` · 행사를 만든 계정의 매장 범위 = 문자와 같은 `resolveOperatorStoreScope` · 막힘 ≠ 0명 · 실행부는 잠금 + 사유) · `email-channel.ts` 에 범위 조각 받는 새 함수 2개(기존 함수 그대로).
  - 지문 = 행사 지문(`eventFingerprint`)에 상품 구매자일 때만 `u` 칸(전체 = 바이트 그대로 · 시험) · 접점 지문은 그대로(승인 뒤 고치기 = NOT_EDITABLE 이라 대상이 바뀌는 길이 없다).
  - 라우트 = `POST /line-read` · `GET /audience/products` · `POST /audience/count`(새 행사 = 요청 계정 · 기존 행사 = 만든 계정 범위) · 캘린더 응답 `lineEnabled` · 확인 화면 `event.audience`(「크림 · 토너 외 1개 산 고객 · 2026-07-20 이후」 + 기준 줄).
  - 화면 = 플래너 한 줄형 명령 카드(스위치 열린 회사만 · 빈 줄 = 빈 판1) · 달 넘기기 = 달력 카드 머리(375 = 행사 목록 머리 · I1) · 판1 「이렇게 알아들었어요」(줄마다 [맞아요]/[고치기] · 다 누르기 전 [다음] 잠김) · 받는 사람 [상품을 산 고객][전체 고객](미리 고르지 않음) · 판2 `PlannerAudiencePicker`(관측 상품 · 낱말 든 상품 위로 · 미리 체크 0 · 30개 상한 · 「언제 산」 4칩 필수 · 기본값 없음 · 「모두」 = [기록 전체]에 표시만 · 인원 = 서버 실조회 · 고치기 창은 저장한 기간 그대로).
  - D3 개정 = `ai-operator-modules.ts` 플래너 oneLine · 불변 시험 7 → 8.
  - 설계와 다르게 한 것: ① 읽기 입구 = `/one-line/gaps` 갈래 대신 플래너 라우트 `/line-read`(7메뉴 공용 판정 입구를 건드리지 않음) ② 「기록 전체」 옆 그 문의 첫 기록일 표시 = 안 함 ③ 승인 수 각인 + 발송 날 넓어짐 보류 장치(J10) = 안 함(수렴안 §3 에 없음).

### 3-7. A · 대행 축 1~4 (1016 설계 그대로 · 착수 직전 정밀화)
- 축 1 접수 조작 CT(`editAgencyContentTx` · `rescheduleAgencyRequestTx` · 취소 CT 행위자 null 허용 · revision 409 + 현재 재료 · 전이표 정정 3)
- 축 2 조작 주체 · 정책(`agencyActions(actor, row, now)` · 링크 = 승인 · 취소 · 시각 변경 · 맞춤법 제안 적용 · 새 링크 API `/api/agency-approve/{cancel, reschedule, spell-fix}`)
- 축 3 모바일 고치기(저장된 제안 id 적용)
- 축 4 승인 대기 24시간(DDL `agency_send_requests.approval_requested_at timestamptz NULL` · 배포 뒤 · 컬럼 탐지 · 없으면 24h 규칙만 쉼 · catch 503)
- Harold ①: 링크 [승인하기] = 확인 창 → 인증번호 → 승인.
- 구현 기록(1018):
  - 축 1 = `utils/agency-send-change.ts`(`editAgencyContentTx` · `rescheduleAgencyRequestTx` · 옛 라우트 본문 원본 복사 이동 · 판정 순서 · 응답 계약 그대로 · 계약 시험 4파일을 CT 기준으로 옮김) · 취소 CT `cancelledBy` null + `cancelledByType 'agency_link'` + 화면이 본 `revision`(어긋나면 409 + 지금 행 · 운영 취소 = 생략) · 전이표 정정 3(시험 `agency-mobile-control-1018`).
  - 축 2 = `utils/agency-send-actions.ts` `agencyActions(actor, row, now)`(approve · cancel · reschedule · resume · spellFix · editText · approveBy) · 링크 info 의 actions 와 링크 POST 가드가 같은 함수 · 새 링크 API `/api/agency-approve/{cancel, reschedule, spell-fix}`(토큰 헤더 · 효과 = 로그인과 같은 CT · `afterLinkAction` = 이력 link_<op>(번호 · ip · ua) + 감사 원장 agency_link_<op> + 담당자 전원 통보 · 화면 이력 문장 · 감사 라벨 같은 커밋).
  - 축 3 = `applyAgencySpellFixes`(id · 다른 버전 · 잠김 · 겹침 · 원문 불일치 거절 · 역순 치환) → 문안 수정과 같은 CT(처음부터 다시 검사 · 옛 링크 닫힘) · 남은 시간 40분 미만 거절.
  - 축 4 = 승인 마감 `approvalDeadline` · `isApprovalTimedOut`(24시간) 을 `checkApproval` · `isApprovalExpired` · 화면(PC 목록 「승인 마감」 · 링크 「승인 마감」)이 같이 씀 · `approval_requested_at` 찍기 = 워커 승인 대기 · 재승인 대기 2곳 · 시각 변경 NOW · 문안 수정 NULL · 컬럼 탐지 `hasApprovalRequestedColumn`(접수 코어 · 없으면 SQL 조각 0 = 오늘 동작) · 만료 후보 SQL 에 24시간 OR · 24시간 만료 = 이력 reason approval_timeout + 링크 받는 번호에 다시 진행 주소 · 시각 변경으로 승인 대기에 돌아가면 `sendAgencyApprovalRequest`(승인 요청 + 촉박 분기만) · 만료 건 다시 진행 = 같은 문안 · 같은 명단 진행 중 접수 확인(`findBlockingTwinRequest` · 409 DUPLICATE_IN_PROGRESS).
  - 화면 = 휴대폰 `AgencyApprovePage`(actions 만 · 승인 = 확인 창 → 인증번호 · 취소 · 보낼 시각 바꾸기(native 시각 칸) · 이 시각으로 다시 진행 · 맞춤법 골라 고치기 = 주 버튼 교체 · 고치면 「새 문자 대기」) · PC 목록 [승인하기] 옆 [취소] + 확인 창 · 상세 취소 확인 창(결함 정정) · 목록 「승인 마감」 보조 줄.
  - DDL 1 = `ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz NULL;`(배포 뒤 · 그 전에는 24시간 규칙만 쉰다).

### 3-8. O · 자동마케팅 예고 문자 멈춤 링크
- 예고 문자(`autosend-policy.ts:480` 「접속해서 [정지]」)에 링크 · 버튼 = [이번 회차 건너뛰기] · [자동마케팅 일시정지](확인 창 · 인증번호 없음 · 전원 통보 · 기록) · 토큰 = 같은 형식(헤더 운반 · fragment) · 착수 직전 정밀화.
- 구현 기록(1018): `utils/autosend-stop-link.ts`(JWT · `autosend-stop:${JWT_SECRET}` 도메인 분리 키 · 새 ENV 0 · 범위 autosend_stop · 만료 = 예정 시각 + 1시간(최소 1시간) · 단축 주소 · 서명 실패 = 옛 문장) · `routes/autosend-stop-public.ts`(`/api/autosend-stop/{view, skip, pause}` · 헤더 토큰 · 요청 제한 · 건너뛰기 = `adminStopProposal`(no_send) · 일시정지 = `updateOperator({status:'paused'})` = 예약 발송 동반 취소 · 전원 통보 · 감사 autosend_link_skip/pause) · 화면 `AutosendStopPage`(`/autosend-stop` · LinkShell · 확인 창) · 시험 `autosend-stop-link-1018` 6. 설계와 다른 점: 토큰을 번호마다 따로 서명하지 않았다(예고 문자가 담당자 전원에게 같은 본문으로 가는 경로 · 이력에 누른 번호 대신 ip · ua).

## 4. 영향표
(묶음별로 구현 직전에 채운다 · grep 증거 첨부)

## 5. DB
- DDL 1 = 묶음 A 의 `agency_send_requests.approval_requested_at`(배포 뒤 · `information_schema` 확인 뒤 코드). 그 밖 DDL 0(planner `exec_meta` · `meta` jsonb · `timing_rule` jsonb 안).

## 6. 시험
(묶음별 · 행동 시험 + 옛 결함 주입으로 깨지는 것 확인)

## 7. 배포 · 실측
(전 묶음 Codex approve 뒤 · 백엔드 먼저 · 프론트 build:safe · 입력 축은 프론트 먼저 규칙 · 실측 1건 시나리오)

## 8. 범위 밖(기록만)
- 직접 기입 지난 날짜 막는 검사 없음(v1) · 숫자 검사 「지금 달」 예외(1017) · 1017 템플릿 DM 빈 버튼 주소 · 긴 혜택(미검증) · 인앱 게시 단가 주석 15 ≠ 100 · 1년 캘린더와 자동마케팅 중복 발송 · 여정 상품 목록 결제 전 · 취소 주문 포함 · 1017 DM 한 줄 타겟 문장이 상품 후보로 뜸 · 원장(purchases) 반품 기록 미확인.
- (Codex 라운드에서 나온 것) `planner-approve.ts` 행사 취소 커밋 뒤 DM 발행 정지용 `loadEventTouchpoints` 가 실패하면 끝난 취소가 500 으로 답할 수 있다(A 3R) · 대행 안내 문자 전체가 한 번 시도 계약(재시도 · 발송함 · 큐 적재 멱등 없음 · D 4R~5R · 설계 초안 = [전달 보장](2026-10-18-agency-notify-delivery-design.md) · 착수 = 실측 뒤 Harold님 판단) · 옛 자동제작 엔진 `generateFromBuildMaterials` 도 차감 뒤 저장 실패 시 같은 시도 복구가 잔액 검사에 막힐 수 있다(B 1R 과 같은 꼴 · 미검증).

## 9. Codex 적대 리뷰 기록(1018)

| 리뷰 | 라운드 | 지적 → 처리 |
|---|---|---|
| A 재확인(쌍) · 대상 축 F0 | 1R 6 · 2R 4 · **3R approve** | 1R = 기기 증명(인증 행 id · 확인 시각 HMAC · 헤더) · 토큰 회차를 요청에서 · 미루기 날짜 advisory 잠금 · 재확인 패스를 발송 패스 가드 앞으로 · 마감은 잠금 뒤 · 다음 날 만료 문장. 2R = 다시 읽은 쌍도 요청 토큰 해시 · 링크 취소 = 취소 트랜잭션 안 토큰 대조(소비 · 되돌리기 장치 제거) · 날짜 재확인 같은 연결 · 날짜 잠금 맨 앞 |
| B 템플릿 생성 · 한 줄 읽기 | 1R 3 · 2R 1 · 3R 2 · 4R 2 · 5R 1 · **6R approve** | 1R = 낸 생성비는 잔액 재검사 안 함 · 품절 뒤 상품 수 재검증 · 부정 대상. 2R~5R = 같은 부류(제외 · 미구매를 구매자로 제안)가 다섯 번 → 차단 목록 → 허용 문형 → 관측 상품명 대조(대상 CT · 2.5초 상한) → 상품 칸 낱말 하나 → 경계 필수로 좁힘. 받는 사람 값은 제안 · 줄마다 사람 확인 · 상품 미리 체크 없음. 6R 남은 사례(관측 상품명에 붙은 조각이 실제로 있을 때만) = 저장 대상을 바꾸지 않는 제안 품질 한계로 판정 |
| C 여정 자동 보정 · 링크 정지 · 자동마케팅 멈춤 | 1R 2 · 2R 1 · **3R approve** | 먼저 알리고 바꾼다(실패 = 바꾸지 않고 여정 정지) · 알림 성공 = 큐 적재 1건 · 정지 커밋 뒤 부가 조회 실패는 실패로 답하지 않음 |
| D 대행 모바일 제어 축 1~4 | 1R 5 · 2R 3 · 3R 1 · 4R 1(불수용) · **5R approve** | 만료 재진행 = (회사 · 원문) 잠금 한 트랜잭션 · 명단 비교 뒤 LIMIT · 막는 집합 = 메일 중복 집합 − sent · 24시간 만료 후보 따로 · 링크 취소 처리 중 문장 + 확정 뒤 결과 문자 = cancel_reason 표지(`linkCancelReason`) · 확정 CAS 이긴 쪽만 통보 · 트랜잭션 안 같은 연결. 불수용 = 새 접수 경로 쌍둥이 잠금(근거 = 그 경로 계약) · 정확히 1회 통보(근거 = 대행 안내 전체가 한 번 시도 계약 · 5R 에서 타당 판정) |

검증(마지막 정정 뒤) = BE · FE tsc 0 · backend vitest 628파일 9,149건 · 새 시험 `codex-1r-fixes-1018`(라운드별 회귀) 외 1018 시험 10개 파일.

## 10. 배포 · 실측 시나리오
- 순서 = push → 서버 pull → **프론트 build:safe 먼저**(저장 API 가 `audience` 를 요구 · 옛 화면은 저장 400) → pm2 재시작 → DDL(`agency_send_requests.approval_requested_at` · information_schema 확인 뒤 · lock_timeout 3s) → ENV 확인(`JOURNEY_PAUSE_TOKEN_SECRET` · `JWT_SECRET` 존재 여부만 · 값 출력 금지).
- 스위치 = `PLANNER_LINE_COMPANY_IDS`(한 줄 · 상품 구매자) · `PLANNER_LINK_APPROVE_COMPANY_IDS`(휴대폰 보내기 · 고치기 · 취소) 둘 다 빈 값 배포(닫힘) → 사내 회사로 켠다.
- 실측 1건씩(발송 · 돈): ① F0 = 사내 회사 플래너 행사 1건 확인 화면 받는 사람 수가 숫자 ② J = 여정 2시간 전 안내 문자 링크 [이 발송 정지] → 그날 그 단계 실행 paused 수 ③ A = 사내 대행 접수 1건 승인 링크 [이 발송 취소] → 큐 잔존 0 · 담당자 문자 1통 ④ A = 승인 대기 24시간 만료(DDL 뒤 · 다음 날 확인) ⑤ O = 자동마케팅 예고 문자 링크 [이번 회차 건너뛰기] → 그 제안 no_send ⑥ I = 한 줄 「11월 1일~7일 크림 1+1 행사 타겟은 크림 산 고객 모두」 → 판1 읽은 줄 · 판2 상품 고르기 · 인원 수 · 저장.
