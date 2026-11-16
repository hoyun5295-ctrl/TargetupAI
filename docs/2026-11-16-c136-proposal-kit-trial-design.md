# C136 팀장급 제안 페이지 + 제작 대행 체험 · 소개 내용을 로그인 뒤로 설계서

> 2026-11-16 · Harold 지시(원문은 §0) · 순서 = 설계 → Harold 동의 → 목업 → 설계 Codex → 구현 → 구현 Codex → 배포 안내
> 상태 = **설계안 제시(동의 전 · 코드 0)**. 「미검증」이라 적은 줄은 코드를 읽지 않았거나 서버에서 재지 않은 것이다(§10 에서 구현 첫 단계에 확인).

## §0 접수 대조표(원문 → 축 · 빠진 축 0)

| # | Harold 원문(뜻 그대로) | 이 설계의 자리 |
|---|---|---|
| 1 | 대표 시연은 먹히는데 접점은 팀장급 · 팀장급에게 먹히는 체험과 영업 | 전체 |
| 2 | 메일로 보내는 제안 페이지 · 누가 보냈는지 `?src=` | §3 |
| 3 | 로그인 전 = 「로그인하시면 서비스 소개와 체험 신청이 가능합니다」 한 줄과 로그인 단추만 · 계정 없으면 「서비스 이용신청 문의」 | §3-1 |
| 4 | 로그인하면 제안 페이지가 바로 열림 | §3-2 |
| 5 | 사진 3 ~ 4장 + 무엇을 알릴지 한 줄(문자 · MMS 선택) | §4 |
| 6 | 우리가 완성본을 만든다(포스터 + 문안 + 통신사 스팸 검사 통과) · **대신 보내 주지 않는다** | §5 · §6 |
| 7 | 담당자에게 도착을 알리고 「명단만 올려 보내기」 = 평소 직접발송 화면이 채워진 채 열림 | §5-5 · §6 |
| 8 | 슈퍼관리자 현황 = 열람 → 로그인 → 신청 → 제작 → 전달 → 발송 | §7 |
| 9 | 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제 · 안내창도 마찬가지로 같이 진행」 | §2 |
| 10 | (1116 추가) 「모바일DM 까지 제작대행 체험 시켜준다고」 | §5-3 |
| 11 | (1116 추가) 「이메일이나 이런것들도 필요하면 가능하다고 해주자 · 거기까지 대행해주는게 300만원요금제 이상」 | §3-3 · §4 |

정한 값(Harold 가 반대하지 않은 추천안 셋 + 이 설계에서 정한 것):

- (가) 제작 = 기계가 만들고 우리 직원이 한 번 본 뒤 전달 (나) 무료 범위 = 회사당 1회 · 포스터 3장 + 문안 3개 + 모바일 DM 1개(#10) (다) 대상 = 계정이 있는 회사 전부(에이전트 전용 회사 제외 = 동종 업체에 소개를 보이지 않는다 · `App.tsx` `AGENT_ALLOWED_PATHS` 와 같은 이유).
- 도착 알림 = 문자(§5-5 · 후보와 이유).
- 로그인 화면의 V3 안내 창이 갈 자리 = 로그인 직후 창 + 제안 페이지 둘 다(§2-3 · 후보와 이유).
- 배포는 둘로 나눈다(§12): **배포 가 = 소개 내용을 로그인 뒤로**(다른 카드와 겹치는 파일 0) · **배포 나 = 제안 페이지 + 제작 대행 체험**(겹치는 파일 다섯 → C133 C + D · C134 커밋 뒤).

코드에서 확인한 사실(인계 글과 다른 것 하나): 로그인 뒤 가려던 화면으로 돌려보내는 길은 **이미 있다**(`packages/frontend/src/utils/login-return.ts` · 1004 · 허용 경로 목록 · `LoginPage.tsx:154` `takeLoginReturn()`). 새로 만들지 않고 허용 목록에 한 줄을 더한다.

## §1 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 자리 | 그 회사에서 | 근거 |
|---|---|---|
| 로그인 화면 안내 창 | 바뀜(모든 회사) = V3 안내 창 → 종전 인증 안내 창(`LoginPolicyNoticeModal` · C135 배포 전 a7426275 와 같은 줄) | §2-2 · Harold 지시 |
| 로그인 직후 창 | 무료체험 창(C135 · 미가입 + 미신청) = 그대로 · 그 밖의 회사가 보던 V3 소개 창 = 안쪽만 장면 창으로(노출 규칙 · 자리 그대로) | §2-3 |
| `/proposal` 을 열지 않은 회사 | 변화 0(화면 · 표 · 기록 0) | §3 |
| 열었지만 신청하지 않은 회사 | 열람 기록(audit_logs)만 · 발송 화면 무변경 | §3 · §7 |
| 직접발송 작성 화면 | 넘김 값이 없으면 종전 그대로(`?open=direct-send` 에서 한 번 꺼내 보고 없으면 아무 일도 안 한다 · C133 의 `takeAudience` 와 같은 꼴) | §6 |
| 발송 · 예약 · 수신거부 · 결과 · 선불 차감 · 정산 | 변화 0 · 파일 무수정(`routes/campaigns.ts` · `routes/spam-filter.ts` · `utils/messageUtils.ts` · `routes/results.ts` · `routes/billing.ts`) | §9 |
| 스팸 검사 | 신청한 회사만 · 기존 자동 검사 CT(`spam-test-queue.ts autoSpamTestWithRegenerate` = `skipPrepaid: true` · 청구 제외 표시값)를 부른다 = 선불 잔액 · 후불 청구 무접촉 · 검사 문자는 우리 검사 단말로만 간다(고객 수신자 발송 0) | §5-2 |
| AI 크레딧 원장 | 변화 0(제작은 크레딧 묶음 `runInCreditBundle` 안에서 돌고 차감 문장을 부르지 않는다 · 확인 = §10-3) | §5-2 |
| 새 표가 아직 없을 때(DDL 앞) | 변화 0(제안 페이지의 신청 · 상태 주소만 503 `DB_MIGRATION_PENDING`) | §8 |

## §2 소개 내용을 로그인 뒤로(배포 가)

### 2-1 원칙과 구조

화면에서만 가리면 번들 · `public/` 에 남는다 → **소개 글 · 예시 그림을 프론트 저장소 밖으로 옮기고, 로그인한 요청에만 서버가 준다.**

- 글(마크업 · CSS) = `packages/backend/src/content/gated/`(지금 `packages/frontend/src/components/v3/v3-popup-parts.ts` 의 문자열을 스크립트로 그대로 옮긴다 · 손으로 다시 치지 않는다).
- 그림 = `packages/backend/assets/gated/v3/`(지금 `packages/frontend/public/v3/` 12장을 그대로 옮긴다).
- 주소(로그인 필수 · 고객사 사용자 · 에이전트 전용 회사 = 403 · 응답 머리말은 글 · 그림 모두 `Cache-Control: private, no-store` = 브라우저 캐시에 남기지 않는다 · 지금 `routes/plans.ts:76` 과 같은 값):
  - **준비 주소** `GET /api/plans/v3-intro/peek` = 이 로그인에 띄울 판이 무엇인지와 그 판의 글 `{ introKey, variant, content: { css, html, sets } }` 을 **노출을 쓰지 않고** 준다(띄울 것이 없으면 `introKey: null`). 판정은 선점과 같은 함수(`decideIntro` · 읽기만).
  - 그림 = `GET /api/plans/gated/img/:name`(폴더에 있는 파일 이름과 정확히 같을 때만).
  - 선점 `POST /api/plans/v3-intro/claim { introKey }` = 화면이 준비한 판의 열쇠를 싣는다. 서버는 판정을 다시 해서 **그 열쇠와 같을 때만** 노출 한 번을 쓴다(다르면 쓰지 않고 `show: false`). 열쇠 없이 온 요청(배포 전에 받아 둔 옛 화면) = 선점하지 않고 `show: false`(옛 화면은 지워진 공개 그림 주소를 가리키므로 띄우지 않는다 · 노출 0). 응답에 실제로 잡은 `introKey` 를 언제나 싣는다.
- 화면 = `utils/gated-content.ts` 하나: 받은 글 안의 그림 자리(`gated:파일이름`)를 로그인 토큰으로 받아 온 그림(blob 주소)으로 바꾼다. 창이 닫히거나 화면을 떠나면(로그아웃 포함) blob 주소를 버린다(`URL.revokeObjectURL`) · 받은 글을 저장소(`localStorage` · `sessionStorage`)에 두지 않는다.
- **순서 = 준비 → 그림 전부 받기 → 선점 → 띄움**(Codex 설계 1R). 그림을 하나라도 못 받으면 선점하지 않는다(노출 소모 0 · 다음 로그인에 다시 본다). 준비와 선점 사이에 판이 바뀌었으면 서버가 선점하지 않으므로(위) 노출이 쓰이지 않고 화면은 띄우지 않는다.
- 움직임 코드(`v3-motion.ts`)는 번들에 남되 그 안의 내용(`SETS` = 업종 셋의 가게 이름 · MMS 문안)은 서버로 옮긴다(§10-1 · 응답의 `content.sets`). 번들에 남는 것 = 시간표 · 선택자 · 단계 이름표.

### 2-2 로그인 화면

- `pages/LoginPage.tsx` = `showPolicyNotice` 일 때 `LoginPolicyNoticeModal` 을 바로 그린다(C135 전 줄로).
- 지우는 것 = `components/v3/LoginNoticeSwitch.tsx` · `components/v3/V3LoginIntroModal.tsx` · 프론트 `utils/v3-login-intro.ts` · 백엔드 `utils/v3-login-intro.ts` · `routes/intro-public.ts` 의 `GET /v3-login` · `public/about-v3.html` · `public/v3/`.
- ENV `V3_LOGIN_INTRO` = 읽는 코드가 없어진다(지워도 되고 남겨도 무해 · 원장에 기록).
- 첫 그림과 함께 뜨는 창을 서버 답 뒤로 늦추지 않는다 = 종전 창은 답을 기다리지 않고 첫 그림에 뜬다(C135 §12-5 의 결함이 생길 자리가 없어진다).
- **지금 운영에서 바로 가리는 임시 길**(이 배포 전에도 쓸 수 있다) = `.env` 의 `V3_LOGIN_INTRO` 를 비우고 `pm2 restart targetup-backend --update-env`. 단 `about-v3.html` 과 `public/v3/` 그림은 이 배포 전까지 주소를 알면 열린다.

### 2-3 V3 안내 창이 갈 자리(후보 셋 · 추천 = C)

| 후보 | 내용 | 얻는 것 | 잃는 것 |
|---|---|---|---|
| A 로그인 직후 창만 | 지금의 V3 소개 창(`AiOperatorLoginPromo` 의 `v3-intro` 갈래) 안쪽을 장면 창으로 | 틀 · 노출 규칙 · 기록을 그대로 씀 | 「자세히 보기」가 갈 곳이 없다(공개 V3 페이지가 사라지므로) |
| B 제안 페이지 안에만 | 장면을 제안 페이지 머리에 | 창 하나 줄어듦 | 링크를 받지 않은 기존 고객은 V3 소개를 볼 자리가 없다 |
| **C 둘 다(추천)** | 로그인 직후 창 = 장면 넷 · 제안 페이지 = 읽는 소개(`about-v3.html` 내용) + 체험 신청 · 창의 「자세히 보기」 = 제안 페이지 | 창은 한 번 보고 닫는 것 · 페이지는 읽고 신청하는 것으로 역할이 갈림 · 원본은 서버 한 곳 | 배포 가에서는 제안 페이지가 아직 없다 → 그때 「자세히 보기」는 이미지 스튜디오로(지금 V3 소개 창의 주 단추와 같은 곳) · 배포 나에서 제안 페이지로 바꾼다 |

로그인 직후 장면 창의 규칙:

- 틀 = `AiOperatorLoginPromo` 그대로(탭 사이 잠금 · 서버 선점 · 계정당 최대 3번 · 한 로그인에 한 번 · 「이 소개 다시 보지 않기」 = 영구 · 다른 자동 안내 창과 안 겹침). 안쪽만 장면 창.
- 장면 = 넷(누끼 → 포스터 · 담아 두고 안 산 고객에게 · 환영 알림톡 → 여정 · 업종 평균). **다섯째(인증 안내 요약)는 뺀다**(로그인 뒤에는 뜻이 없다).
- 판 열쇠 = 새 값 `v3-scenes` 를 더한다(옛 `v3-intro` 는 닫힌 목록에 남긴다) = 옛 소개 창을 3번 다 본 계정 · 숨긴 계정에도 새 내용이 닿는다.
  - **옛 화면의 요청이 새 판을 숨기지 않는다**(Codex 설계 1R): 「다시 보지 않기」에 열쇠가 없거나 모르는 값이면 지금처럼 옛 판 `v3-intro` 에 적는다(기본값을 「지금 판」으로 바꾸지 않는다). 새 화면은 선점이 답한 `introKey` 를 언제나 실어 보낸다. 닫힌 목록 = `v3-intro` · `v3-scenes` · `studio-trial`.
  - 선점 SQL(`INTRO_CLAIM_SQL`) · 로그인 표식 문(한 로그인에 판을 통틀어 하나)은 글자 그대로다(판 열쇠만 인자로 바뀐다).
- 포스터 3장 조건 · 기능 칩은 걷는다(그림이 서버 보관분이라 조건이 없다). 장면 2 ~ 4 는 단계 개방 전 기능을 모든 회사에 보인다 = C135 에서 Harold 가 스위치를 켜 정한 상태를 그대로 따른다.
- 무료체험 창(`StudioTrialPromo`)도 같은 글 · 그림을 쓰므로 같은 길로 받는다(동작 · 노출 규칙 무변경).
- 창은 서버 답 뒤에 뜬다(지금도 그렇다 · 첫 그림과 함께 뜨던 창이 아니다). 그림을 못 받은 로그인은 노출을 쓰지 않는다(§2-1 순서) = 그림 장애가 무료체험 안내의 3번을 태우지 않는다.

## §3 제안 페이지 `/proposal`(배포 나)

### 3-1 로그인 전

- 화면 = 한줄로 로고 + 「로그인하시면 서비스 소개와 체험 신청이 가능합니다」 + **로그인** 단추 + 작은 글 「계정이 없으시면 서비스 이용신청 문의」(→ `/login?inquiry=1` = 로그인 화면의 지금 문의 창을 바로 연다). 소개 글 · 그림 0(코드에도 0).
- 기록 = `POST /api/public/intro/proposal-view { src }` → audit_logs `proposal_view`(지금 `/intro` 방문 기록과 같은 CT `recordAuditLog` · IP당 호출 상한 · 새 표 0).
- `src` = 영문 · 숫자 · `-` `_` `.` 40자(그 밖은 버린다). 운영 규칙 = **회사마다 다른 값**(예 `kim-acme`)으로 보내면 「열람만 하고 멈춘 회사」가 현황에 보인다(로그인 전에는 회사를 알 길이 `src` 뿐이다).

### 3-2 로그인 뒤 복귀

- 로그인 단추 = `rememberLoginReturn('/proposal?src=…')` → `/login`. `login-return.ts` 허용 목록에 `/^\/proposal(\?src=[A-Za-z0-9._-]{1,40})?$/` 한 줄.
- 로그인 성공 갈래(`LoginPage.tsx applyLoginSuccess`) = 슈퍼관리자 → `/admin` · 에이전트 전용 → `/kakao-rcs` · 카페24 복귀 값(`cafe24_return_mall_id`)이 있으면 카페24 · 그 밖 → `takeLoginReturn() || '/dashboard'`.
- **복귀 값이 둘일 때 = 가장 최근에 사람이 누른 쪽**(Codex 설계 1R): 제안 페이지의 로그인 단추는 누르는 순간 옛 카페24 복귀 값을 지우고 제안 복귀 값을 남긴다(`login-return.ts rememberExplicitLoginReturn`). 반대로 카페24 갈래가 이길 때는 남아 있던 복귀 경로를 함께 꺼내 버린다(`takeLoginReturn()` 한 번 = 다음 로그인에 낡은 값이 살아나지 않는다).

### 3-3 로그인 뒤 화면(상태 넷 · 주소 하나)

`GET /api/plans/proposal?src=` 한 번이 상태 · 소개 글 · 체험 행을 준다(열람 기록 `proposal_open` = 회사 · 사용자 · src).

| 상태 | 화면 |
|---|---|
| 신청 전 | 소개(서버가 준 글 · 그림 = `about-v3.html` 내용을 이 페이지에 맞게 줄인 것) + 「제작 대행 체험」 신청 폼(§4) |
| 제작 중 · 확인 대기 | 「완성본을 만들고 있습니다. 준비되면 문자로 알려 드립니다」 + 올린 사진 · 한 줄 |
| 전달됨 | 완성본(§6) |
| 에이전트 전용 회사 · 슈퍼관리자 | 403 → 대시보드 자리로(슈퍼관리자는 「제안 체험」 탭에서 본다) |

소개 문구 원칙:

- 체험의 뜻을 한 줄로 = 「비즈니스 요금제부터 포함되는 캠페인 대행 운영의 제작을, 한 번 그대로 해 드립니다」(근거 = `PricingPage.tsx:65` 「전용 등급(비즈니스 이상) = 캠페인 대행 운영 포함」 · `:69` 「제작, 발송, 여정 운영」). 금액은 요금제 표에서 읽어 넣고(글자로 박지 않는다) 못 읽으면 금액 없이 쓴다.
- 「이메일이나 다른 채널 소재도 필요하시면 함께 만들어 드립니다」(#11) + 폼의 「더 필요한 것」 칸.
- 약속 숫자 · 「업계 최고」 · 모델 이름 · 아직 열지 않은 기능 0. 줄표 0. 그림 = 서버 보관분(실제 이미지 스튜디오 산출물)만. 프리텐다드 · 흰 바탕 검정 주황 하나.

## §4 신청

폼(한 화면):

1. 사진 3 ~ 4장(JPG · PNG · WEBP · 장당 10MB) = 알릴 상품 · 매장 사진.
2. 무엇을 알릴지 한 줄(120자).
3. 보낼 방식 = LMS · MMS 둘 중 하나(화면 이름 = 채널 이름의 주인 표 `MSG_TYPE_LABEL` · §15-2 ⑧).
4. 더 필요한 것(선택 · 200자 · 「이메일도 필요해요」 같은 말) = 직원이 보고 연락한다(기계 제작 범위 밖 · #11).
5. 완성본 알림을 받을 휴대폰 번호(계정의 로그인 인증 번호 `users.mfa_phone` 으로 미리 채움 · 고칠 수 있다).

주소 `POST /api/plans/proposal/request`(multipart · 로그인 필수 · 고객사 사용자):

- **자리를 먼저 잡고 사진은 그 뒤에 쓴다**(Codex 설계 1R · 진 요청이 사진을 남기지 않게) = 한 트랜잭션: `INSERT … ON CONFLICT (company_id) DO NOTHING RETURNING` → 0행이면 ROLLBACK · 409 `PROPOSAL_ALREADY_REQUESTED`(사진을 쓰지 않았다 · 화면은 진행 상태로) → 1행이면 사진 저장 → 그 행에 주소 기록 → COMMIT. 저장이나 기록이 실패하면 ROLLBACK 하고 방금 쓴 파일을 지운다. 동시에 온 둘째 요청은 첫째가 끝날 때까지 INSERT 에서 기다렸다가 0행을 받는다.
- 주소의 순서 = 로그인 확인 → 호출 상한(계정당) → **이미 신청한 회사면 본문을 읽기 전에 409**(사진 40MB 를 메모리에 올리지 않는다) → 사진 받기 → 위 트랜잭션(`SET LOCAL lock_timeout = '3s'` = 같은 회사의 겹친 요청이 연결을 오래 쥐지 않는다).
- 사진 저장 = 기존 CT `campaign-quick.ts saveMaterialImages`(DM 이미지 저장소 `uploads/dm-images/{회사}` · 포스터 제작 CT 와 DM 조립 CT 가 이 주소를 그대로 읽는다).
- **CT 를 고친다**(Codex 설계 2R): 지금 `saveMaterialImages` 는 파일 이름을 안에서 짓고 다 쓴 뒤에만 주소를 돌려준다(`campaign-quick.ts:101-111`) → 둘째 장을 쓰다 실패하면 첫째 장의 이름을 부른 쪽이 모른다. 그 함수 안에서 **쓰려는 경로를 쓰기 전에 적어 두고, 실패하면 그 호출이 쓴 파일을 전부 지운 뒤 던지게** 한다. 호출부 2곳(`routes/event-campaigns.ts:177` · 이 카드) = 성공할 때의 반환은 글자 그대로 · 실패할 때 남던 파일만 없어진다(부른 쪽은 그 주소를 받은 적이 없다). 업로드는 메모리로 받는다(디스크에 임시 파일 0) · 3 ~ 4장이 아니거나 그림이 아닌 파일이 섞이면 자리를 잡기 전에 400.
- 남는 틈 하나 = 사진을 다 쓴 직후 COMMIT 전에 프로세스가 죽으면 행은 사라지고 파일(최대 4장)이 남는다(쓰다 실패한 것 · ROLLBACK 된 것은 위에서 지운다). 그 저장소는 원래 회수 회차가 없는 자리다(`campaign-quick.ts:5-6` · DM 편집기 업로드와 같은 수명) → 같은 수명으로 둔다.
- 넣은 뒤 제작을 시작하고(기다리지 않는다) 직원 채널에 알린다(`system-alert.ts sendSystemAlert`).
- 표 없음 = 503 `DB_MIGRATION_PENDING`.

## §5 제작 = CT `utils/proposal-trial.ts`(새 파일 · 부품은 전부 있는 것)

### 5-1 소유권

여러 단계가 저마다 밖에 흔적(그림 파일 · 자산 행 · DM 행 · 검사)을 남긴다. 그래서 **단계마다 기록하고, 기록된 단계는 다시 만들지 않고, 소유권을 잃은 실행은 다음 단계로 가지 않는다**(Codex 설계 1R · 같은 뿌리 셋 = 제작 · 전달 · 사진을 한 규약으로).

- 선점 = 한 문장(`status = 'producing'` · `produce_token` 새 uuid · `produce_beat_at = now()`). 시각을 소유권 조건으로 쓰지 않는다(대행발송 불변 5) = 소유권은 토큰 하나.
- **단계 기록** = 단계 하나가 끝날 때마다 그 산출물을 `kit` 에 적는다(`UPDATE … SET kit = …, revision = revision + 1, produce_beat_at = now() WHERE company_id = $1 AND produce_token = 내 것`). 순서 = 헤드라인 · 템플릿 → 포스터 1 → 2 → 3 → 문안 3 → 모바일 DM → 스팸 검사.
- 포스터 한 장 = 그림을 만들면 **주소부터 적고**(기록 1) 그다음 라이브러리 자산을 등재해 자산 번호를 적는다(기록 2). 주소만 적힌 포스터를 만나면(그 사이 끊김) 그림을 다시 만들지 않고 자산부터 잇는다: **그 주소의 자산 행이 이미 있으면 그 번호를 쓰고(`assets.ts getAssetByUrl`) 없을 때만 등재한다**(등재 직후 기록 2 전에 끊겨도 자산 행이 두 줄이 되지 않는다 · Codex 설계 2R 중간 판정). 남는 틈 = 그림 파일이 생긴 직후 기록 1 전에 프로세스가 죽는 경우(파일 한 장 · 사진과 같은 부류 = §4).
- **이어 하기** = 제작을 시작할 때 `kit` 에 이미 적힌 단계는 건너뛴다(끊긴 제작을 다시 눌러도 만든 포스터를 또 만들지 않는다).
- **소유권을 잃으면 멈춘다** = 단계 기록이 0행이면(다른 실행이 가져갔다) 방금 만든 것을 지우고(포스터 = 파일 + 자산 행 · DM = `deleteDm`) 끝낸다. 그래서 겹친 실행이 남길 수 있는 것은 단계 하나의 산출물뿐이고 그것도 스스로 거둔다.
- **가져가기 조건**(직원 「다시 제작」) = `producing` 인 행은 ① 이 프로세스에서 지금 돌고 있지 않고(프로세스 안 진행 목록 · 운영은 단일 fork = `ecosystem.config.js instances: 1`) ② `produce_beat_at` 이 30분 넘게 그대로일 때만. 돌고 있거나 30분 안이면 409 「제작 중입니다」. 재기동으로 끊긴 제작은 목록이 비어 있으므로 30분 뒤 가져간다.
- **회수 대기 목록**(Codex 설계 2R · 같은 부류가 두 라운드째 = 낱개로 막지 않고 규칙 하나로): 밖에 있는 것을 지우는 일은 언제나 **「지울 것을 행의 `garbage` 에 먼저 적고 → 지우고 → 지운 것만 목록에서 뺀다」** 순서다.
  - `kit` 에서 산출물 참조가 빠지는 모든 문장(전체 다시 = 비우기 · 포스터 한 장 · DM 교체)은 **같은 UPDATE 문장에서** 빠지는 참조를 `garbage` 에 더한다(참조가 어디에도 안 적힌 순간이 없다).
  - 회수(`collectGarbage`) = 목록의 항목마다 지우고 그 항목을 목록에서 뺀다. 지우다 죽으면 항목이 남아 다음 회수가 잇는다. 순서 = **DM 먼저 · 포스터 나중**(DM 이 포스터 그림을 싣고 있다). DM = `deleteDm`(이미 없으면 지운 것으로 친다) · 포스터 = 항목에 **자산 번호와 그림 주소를 함께** 적어 둔다. ① `assets.ts deleteAsset` → **다른 곳이 쓰는 중이면(`inUse`) 지우지 않고 목록에서만 뺀다**(그 그림은 쓰는 쪽의 것이다) · 던지면(조회 실패) 항목은 남는다 ② 그 밖(지웠다 · 자산 행이 이미 없다)이면 **그림 파일을 주소로 직접 한 번 더 지운다**(`deleteAsset` 은 행을 먼저 지우고 파일 삭제 실패를 기록만 한다 `assets.ts:290-301` → 행이 없다는 답만으로는 파일이 지워졌는지 모른다 · Codex 설계 3R) ③ **파일이 지워졌거나 원래 없을 때(ENOENT)만 항목을 목록에서 뺀다** · 그 밖의 삭제 오류는 항목을 남겨 다음 회수가 다시 한다. 그림 주소 → 디스크 경로 = 기존 CT 둘을 포스터 제작 CT 와 같은 순서로 쓴다(`line-headline-make.ts lineHeadlineImageSource` 와 같은 꼴): 먼저 `ai-auto-build-materials.ts isCompanyImageUrl` 로 그 회사의 그림 주소 꼴(파일 이름 문자 제한 포함)인지 확인하고, 통과한 주소만 `campaign-quick.ts buildImageDiskPath` 로 바꾼다. 꼴이 아닌 주소 = 지울 파일이 없는 것으로 보고 목록에서 뺀다(우리가 만든 포스터의 주소는 언제나 이 꼴이다).
  - 회수가 도는 때 = 직원의 모든 동작(제작 시작 · 다시 만들기 · 전달)의 맨 앞 + 제작이 끝난 직후. 그래서 끊긴 뒤의 다음 동작이 옛 포스터 · 자산 · DM 을 찾아 지운다.
- **다시 만들기**(전체 · 포스터 한 장 · DM) = 새 것을 만들어 기록하는 문장이 옛 참조를 `garbage` 로 옮긴다 → 회수. 기록이 0행이면(소유권을 잃음) 방금 만든 새 것을 지운다.
- 남는 틈(이 절 전체에서 하나) = **산출물이 밖에 생긴 직후, 그것을 행에 적는 문장 전에 프로세스가 죽는 경우**(그림 파일 한 장 · DM 한 행). 그 밖의 끊김은 행에 적힌 참조로 이어 하거나 회수한다.
- 주기 워커는 두지 않는다(회사당 한 번 · 하루 몇 건 · 직원이 화면을 본다).

### 5-2 부품

| 만들 것 | 쓰는 것(있는 CT) | 메모 |
|---|---|---|
| 포스터 안 헤드라인 + 템플릿 3 | `utils/line-headline.ts pickLineHeadlines`(업종 풀 · 세부 분류가 서로 다른 3안 · 한 줄에 없는 숫자 · 혜택 0) | AI 한 번 |
| 포스터 3장 | `utils/line-headline-make.ts makeLineHeadlineImage`(사진 → 누끼 → 생성 → 영구 저장 · 「돈 · 잠금은 호출부 몫」) → `utils/assets.ts registerAsset`(그 회사 라이브러리) | 포스터 n = 사진 n(앞 3장) |
| 문안 3개 | `services/ai.ts generateMessages`(개인화 변수 없이 · 혜택 근거 = 담당자의 한 줄만 `licenseText`) | `routes/ai.ts` 는 건드리지 않는다 |
| 통신사 스팸 검사 | `spam-test-queue.ts autoSpamTestWithRegenerate`(무료 자동 검사) + 막히면 `agency-send-refine.ts refineForSpam` | 발신번호 = 그 회사 등록 번호(직원 화면에서 고름) · 없으면 검사 못 함으로 표시 |
| 모바일 DM 1개 | `utils/campaign-engine.ts assembleDmCampaign` → `utils/dm/dm-builder.ts createDm`(초안) → 전달 때 `publishDm` | 재료 = 사진 3 ~ 4장 + 한 줄 + 만든 포스터 |

- 포스터 3 · 문안 3 은 필수다(하나라도 못 만들면 사유를 적고 `requested` 로 되돌린다 → 직원 「다시 제작」).
- 스팸 검사 · 모바일 DM 은 실패해도 완성본으로 넘기되 그 칸에 「검사 못 함」 · 「DM 없음」으로 적는다(직원이 전달 전에 다시 누른다).
- 문안은 본문만 저장한다. (광고) 표기 · 무료수신거부는 직접발송 화면의 지금 규칙이 붙인다(검사는 붙인 실물로).

### 5-3 모바일 DM(#10)

완성본에 모바일 DM 한 개를 넣는다. 전달 때 발행해 주소를 만들고, 완성본 화면에서 「모바일 DM 으로 보내기」 = 문안 + DM 주소가 채워진 직접발송 화면. 발행 CT · 뷰어에 요금제 판정이 없다(§10-4 확인) = 미가입 회사의 완성본 DM 도 열린다. DM 편집기(고쳐 쓰기)는 그 화면의 지금 요금제 문 그대로다(새로 열지 않는다).

### 5-4 직원 확인 · 전달(슈퍼관리자 「제안 체험」 탭 상세)

볼 것 = 사진 · 한 줄 · 더 필요한 것 · 포스터 3 · 문안 3 + 검사 결과 · DM 미리보기. 누를 것 = 전체 다시 제작 · 포스터 한 장 다시 · DM 다시 · 문안 고치기(고치면 검사 결과가 지워진다) · 검사 다시 · **전달**.

전달 = **밖에 남는 일을 먼저, 상태를 나중에**(Codex 설계 1R · 전달로 적힌 뒤 실패해 고칠 길이 막히지 않게):

1. 행을 읽는다(그때의 `revision` 과 DM 번호) → DM 발행(`publishDm` = 이미 발행된 DM 은 같은 주소를 돌려준다 · `dm-builder.ts:870`). 실패 = 아무것도 적지 않았다 → 다시 누른다.
2. **한 문장**으로 주소 기록과 상태 변경을 함께 한다: `UPDATE … SET kit = (DM 주소를 넣은 kit), status = 'delivered', delivered_at, delivered_by, revision = revision + 1 WHERE status = 'produced' AND revision = 읽은 값 RETURNING`. 한 요청만 행을 받고(둘이 눌러도 문자는 한 쪽만), 읽은 뒤에 누가 다시 만들기 · 문안 고치기를 했으면 0행 = 409 「그 사이 내용이 바뀌었습니다」(바뀐 완성본이 확인 없이 나가지 않는다).
3. 행을 받은 요청이 알림 문자를 보낸다(§5-5). 여기서 실패해도 완성본은 이미 담당자에게 열려 있다.

전달한 뒤에는 완성본을 고치지 않는다(알림만 다시 보낼 수 있다). 직원의 쓰기(다시 만들기 · 문안 고치기 · 검사 다시)는 모두 `status = 'produced'`(또는 가져가기 조건을 지난 `producing` · `requested`)일 때만 통하고 `revision` 을 올린다.

### 5-5 도착 알림(후보 셋 · 추천 = 문자)

| 후보 | 판단 |
|---|---|
| **문자(추천)** | 기존 안내 적재 CT(`insertNoticeSms` · 대행발송 담당자 안내와 같은 길) · 받을 번호를 폼에서 확인 · 팀장 휴대폰으로 바로 간다 |
| 알림톡 | 새 템플릿 등록 · 검수를 기다려야 한다 |
| 메일 | 받을 주소를 새로 물어야 하고(계정의 메일 칸은 비어 있을 수 있다 · 미검증) 늦게 본다 |

문장 = 「[한줄로] 신청하신 완성본이 준비됐습니다. 로그인 후 확인해 주세요. https://hanjul.ai/proposal」(신청 처리 결과 안내 = 광고 아님).

알림 문자는 MySQL 큐에 적재되고 상태는 PostgreSQL 에 있다(한 트랜잭션이 아니다). 그래서 **세 상태로 적는다**(Codex 설계 1R):

| `notify_tries` | `notified_at` | 뜻 | 직원 화면 |
|---|---|---|---|
| 0 | 없음 | 아직 보내지 않았다 | 「알림 보내기」 |
| 1 이상 | 없음 | 적재를 시작했고 끝을 모른다(적재 실패 · 그 사이 프로세스가 죽음) | 시도 뒤 2분 안 = 「보내는 중」 · 그 뒤 = 「보냈는지 확인되지 않았습니다」 + 「다시 보내기」(확인 창 = 두 번 갈 수 있다고 적는다) |
| 1 이상 | 있음 | 적재 확인 | 보낸 시각 |

순서 = 한 문장으로 시도 수를 올린다(`UPDATE … SET notify_tries = notify_tries + 1, notify_tried_at = now() WHERE status = 'delivered' AND notified_at IS NULL AND notify_tries = 화면이 본 값 AND (notify_tried_at IS NULL OR notify_tried_at < now() - interval '2 minutes') RETURNING` = 둘이 동시에 눌러도 한 요청만 통과 · **앞 시도가 아직 적재 중일 수 있는 2분 동안은 다시 보내기가 통하지 않는다**(Codex 설계 2R 중간 판정 · 적재 대기 상한은 60초 = `agency-send-worker withNotifyTimeout` 과 같은 값을 쓴다 · 시각은 DB 시계끼리의 경과 비교이고 같음 대조가 아니다) → 적재 → 적재 건수 1 이면 `notified_at`. 「다시 보내기」는 사람이 확인 창을 지난 뒤에만 같은 순서를 다시 돈다(기계가 스스로 다시 보내지 않는다).

## §6 완성본 화면 → 직접발송

- 포스터 3 · 문안 3(「통신사 스팸 검사 통과」 표시) · 모바일 DM 미리보기. 포스터 하나 · 문안 하나를 고른다.
- 「명단만 올려 보내기」 = **고른 번호만** 세션 저장소에 한 번 넘기고(`utils/proposal-kit.ts stash / take` · 값 = `{ userId, companyId, poster, copy, withDm, at }` · 문안 · 주소 같은 내용은 싣지 않는다) `/dashboard?open=direct-send` 로 간다.
- 대시보드는 지금 `open=direct-send` 갈래에서 한 번 꺼낸다(꺼내면 지운다). **지금 로그인한 계정 · 회사와 같고 10분 안일 때만** 쓴다(다르거나 낡았으면 버린다 = 계정을 바꿔 로그인해도 앞 회사의 문안이 들어가지 않는다 · Codex 설계 1R). 그다음 서버에 묻는다 `GET /api/plans/proposal/fill?poster=&copy=&dm=` = 서버가 지금 계정의 열람 권한(신청자 본인 · 회사 관리자)과 `delivered` 상태를 다시 보고 `{ message, subject, msgType, assetId }` 를 준다. 받은 값으로 `setDirectMessage` · `setDirectSubject` · `setDirectMsgType` 을 채우고, MMS 면 지금의 라이브러리 가져오기와 같은 함수(`useMmsUpload.handleMmsFromAsset(assetId)`)로 그림을 붙인다. 서버가 거절하면 아무것도 채우지 않는다(작성 화면은 평소처럼 빈 채로 열린다).
- 담당자가 이 단추를 눌렀을 때만 작성 칸에 들어간다. 명단 · 발신번호 · 예약 · 발송은 평소 화면 그대로다(발송 요청 · 과금 코드 무수정).
- 기록 = 처음 연 시각 `opened_at` · 처음 누른 시각 `used_at`.
- 보는 사람 = 신청자 본인 + 회사 관리자(§10-4 · 「관리자 전체 · 사용자 자기 것」). 같은 회사의 다른 일반 사용자 = 「이 회사는 이미 체험을 신청했습니다」만.

## §7 슈퍼관리자 현황 = 「제안 체험」 탭

- 링크별 = `src` 마다 열람 수 · 로그인한 회사 수(audit_logs `proposal_view` · `proposal_open`).
- 회사별 = 열람 → 로그인 → 신청 → 제작 → 전달 → 완성본 열람 → 보내기 누름 → 발송, 멈춘 자리와 시각.
- 「발송」 = `used_at` 뒤 그 회사가 만든 직접발송 수(`campaigns` 읽기만 · `send_type = 'direct'`) · 화면 글 = 「보내기 누름 뒤 직접발송 n건」. 「이 완성본으로 보냈다」의 정확한 대조는 하지 않는다(MMS 변환이 누를 때마다 새 파일을 만들어 대조할 값이 없다 · §10-5).
- 열람 · 조작 권한 = 「소개 방문 · 시연 요청」 탭과 같은 판정(`utils/audit-log.ts isIntroLeadsViewer` = 대표 · 지원팀장). 구현에서 바꾼 것 = 처음에는 「기능 관심 업체」 탭 판정(대표 전용)으로 적었으나, 직원이 확인하고 전달해야 하므로 같은 영업 자료(소개 방문 · 시연 요청)의 판정을 쓴다. 권한 분류표(`admin-role.ts`)에 새 줄을 만들지 않는다.

## §8 DDL(C136-DDL-1 · 배포 나 앞)

```sql
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS proposal_trials (
  company_id uuid PRIMARY KEY,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  src varchar(64) NULL,
  channel varchar(8) NOT NULL,
  brief text NOT NULL,
  extra text NULL,
  notify_phone varchar(20) NULL,
  photo_urls text[] NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'requested',
  produce_token uuid NULL,
  produce_beat_at timestamptz NULL,
  produce_error text NULL,
  kit jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0,
  garbage jsonb NOT NULL DEFAULT '[]',
  produced_at timestamptz NULL,
  delivered_at timestamptz NULL,
  delivered_by uuid NULL,
  notify_tries integer NOT NULL DEFAULT 0,
  notify_tried_at timestamptz NULL,
  notified_at timestamptz NULL,
  opened_at timestamptz NULL,
  used_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- `status` = `requested` · `producing` · `produced` · `delivered`. `garbage` = 회수 대기 목록 `[{ kind: 'poster', assetId, url } | { kind: 'dm', id }]`(§5-1 · 포스터는 자산 행이 없어져도 파일을 지울 수 있게 주소를 함께 적는다). `kit` = `{ title, callback, posters[3]{ assetId, url, templateId }, copies[3]{ subject, text, spam, testId }, dm{ id, url } | null }`.
- 표가 없으면 = 신청 · 상태 주소 503 · 탭은 표 없이 링크별 열람만. 되돌리기 = 남겨도 무해.
- 배포 가 = DDL 0.
- 코드를 쓰기 전에 읽는 칸의 `information_schema` 확인을 Harold 께 먼저 드린다(`campaigns` · `audit_logs` · `users.mfa_phone` · `cdp_assets` · 모바일 DM 표 = 이름은 `status/SCHEMA.md` 에서 먼저 확인).

## §9 영향표

배포 가(겹치는 미커밋 파일 0):

| 파일 | 바꾸는 것 | 소비처 · 영향 |
|---|---|---|
| `pages/LoginPage.tsx` | 안내 창 = 종전 창 바로 | 점검 창 우선 · 슈퍼관리자 제외 · 오늘 하루 숨김 그대로 · 고정 시험 `session-8h-login-notice-1002` 의 줄을 옛 뜻으로 |
| `components/v3/*` | 스위치 · 로그인 창 지움 · `V3ScenesPromo`(장면 넷 · 틀 안쪽) · `StudioTrialPromo` 가 받은 글을 그림 | 고정 시험 `c135-v3-popup-trial` 을 같은 뜻으로 옮김 |
| `components/AiOperatorLoginPromo.tsx` | 안쪽 갈래 둘 다 받은 글로 · 그림 받은 뒤 띄움 | 고정 시험 `feature-interest-1006` 의 줄 그대로 |
| `utils/gated-content.ts`(프론트 새 파일) | 그림 자리 바꾸기 | 창 둘 · 제안 페이지 |
| `utils/v3-intro.ts`(백엔드) · `routes/plans.ts` | 판 열쇠 더함 · 판정을 읽기 함수(`decideIntro`)로 떼어 준비(peek)와 선점(claim)이 함께 씀 · 준비 주소 · 그림 주소 | `routes/plans.ts` 한 곳 · 고정 시험 `c133-v3-intro` |
| `routes/intro-public.ts` · `utils/v3-login-intro.ts` | 스위치 주소 · 판정 지움 | 로그인 화면만 불렀다 |
| `content/gated/*` · `assets/gated/v3/*`(백엔드 새 자리) · `public/about-v3.html` · `public/v3/*`(지움) | 옮김 | `about-ai-operator.html` 등 다른 공개 파일 무변경 |

배포 나(다른 카드의 미커밋 변경과 겹치는 파일 넷 = `App.tsx` · `Dashboard.tsx` · `AdminDashboard.tsx` · `app.ts` · 같은 처지인 `routes/admin.ts` 는 건드리지 않는다 = 관리자 주소도 새 라우터 `routes/proposal.ts` 에 둔다):

| 파일 | 바꾸는 것 |
|---|---|
| `App.tsx` | `/proposal` 경로 한 줄(동적 import 는 여기만) |
| `pages/ProposalPage.tsx`(새) · `utils/proposal-kit.ts`(새) | 페이지 · 넘김 값 |
| `utils/login-return.ts` · `pages/LoginPage.tsx` | 허용 한 줄 · `?inquiry=1` 이면 문의 창 열기 |
| `pages/Dashboard.tsx` | `open=direct-send` 갈래에서 넘김 값 한 번 꺼내기 |
| `pages/AdminDashboard.tsx` · `components/admin/ProposalTrialTab.tsx`(새) | 탭 |
| `app.ts` · `routes/proposal.ts`(새) · `utils/proposal-trial.ts`(새) | 주소 · CT |
| `routes/intro-public.ts` | `POST /proposal-view` |

절대 보호 파일 다섯은 고치지 않는다. 발송 · 과금 SQL 0. `routes/ai.ts` 무수정.

## §10 확인 결과(1116 코드를 읽어 닫은 것 · 남은 것)

1. **`v3-motion.ts` 에 내용이 있다** = `SETS`(업종 셋의 가게 이름 · MMS 문안 · 그림 자리 값 · 54 ~ 60줄). → 서버 보관으로 옮기고 선점 응답의 `content.sets` 로 준다. `mountTrialStage(pop, sets)` · 장면 창의 움직임 함수가 인자로 받는다. 단계 이름표(「배경 지우는 중」 등)와 시간표는 번들에 남는다(화면 상태 글자).
2. `/api/plans` = 주소마다 `authenticate`(`routes/plans.ts:60` ~ · 요금제 목록 `GET /` 만 공개) → 새 주소마다 건다. 에이전트 전용 = `companies.usage_type = 'agent'`(`routes/auth.ts:274` · `:366` 이 읽는 칸) → 소개 내용을 주는 서버 자리(`claimIntro` · 그림 주소 · 제안 페이지 주소)가 이 칸을 읽어 막는다.
3. 크레딧 = `services/ai.ts` · `utils/campaign-engine.ts` · `utils/image-studio.ts` · `utils/line-headline.ts` · `utils/line-headline-make.ts` · `utils/dm/dm-builder.ts` · `utils/assets.ts` · `utils/agency-send-refine.ts` 에 차감 · 잔액 확인 문장 0(grep `deductCredit|checkCredit` 0건). AI 호출의 자체 금액은 묶음 안에서 0(`ai-credit-context.ts runInCreditBundle`). → 제작 전체를 묶음 안에서 돌린다(계약 시험으로 고정).
4. `publishDm`(`dm-builder.ts:863`) · `dm-viewer.ts` = 요금제 판정 0. `/api/image-studio/mms-from-asset`(`routes/image-studio.ts:821`) = 요금제 문 없음 · 자산 주소가 `/api/cdp/inapp/image/{회사}/…` 일 때만(= `makeLineHeadlineImage` 가 돌려주는 주소 꼴) · **자산 소유자 술어**(`resolveOwnerScope` = 일반 사용자는 자기 자산만). → 포스터 자산의 `created_by` = 신청자 · 완성본을 보는 사람 = **신청자 본인 + 회사 관리자**(그 밖의 사용자에게는 「이미 신청한 회사」만).
5. `mms-from-asset` 은 누를 때마다 새 파일(`newTempId().jpg`)을 만든다 → `campaigns.mms_image_paths` 와 대조할 값이 없다. → 「발송」 = 보내기 누름 뒤 직접발송 건수만(§7).
6. 등록 발신번호 = `utils/callback-filter.ts:250 getRegisteredCallbackSet` · 안내 문자 발신번호 = `SYSTEM_SMS_CALLBACK`(`sms-queue.ts:231` 의 함수 · MFA 와 같은 값) · 적재 = `utils/sms-notice.ts insertNoticeSms`.
7. 남은 미검증 = 프론트 빌드가 `public/` 에서 지운 파일을 운영 폴더에서도 없애는지(배포 뒤 `about-v3.html` · `/v3/poster-serum.jpg` 주소를 열어 확인 = 원장 항목 C136-H1).

## §11 시험(seam)

- 단위 = 닫힌 목록(그림 이름 · 판 열쇠 · `src` 꼴 · 허용 복귀 경로) · 프론트 번들 재료에 소개 글 · 그림 0(계약: `packages/frontend/src` · `public` 에 `v3-popup-parts` 문자열 · `/v3/` 그림 0) · 선점 응답 꼴 · 제작 상태 전이 · 넘김 값 한 번만.
- 실 PG = 한 회사 한 번(동시 신청 둘 → 하나 · 진 쪽은 파일 0) · 제작 소유권(토큰이 다른 단계 기록 = 0행 → 방금 만든 것을 지움) · 이어 하기(적힌 단계는 만들기 함수를 부르지 않는다) · 가져가기 조건(진행 목록 · 30분) · 전달은 `produced` 일 때만 한 요청 · 알림 세 상태 · 준비(peek)는 노출을 쓰지 않는다 · 옛 꼴 숨김 요청은 옛 판에 적힌다 · 채우기 주소는 권한 · 상태가 맞을 때만 · 표 없음 503.
- 화면 쪽 단위 = 넘김 값은 계정 · 회사가 같고 10분 안일 때만 · 한 번 꺼내면 없다 · 복귀 값 둘일 때 최근에 누른 쪽.
- 화면 = 실제 컴포넌트를 개발 서버에 띄워(창을 보이게 한 뒤) 로그인 전 화면 · 복귀 · 장면 창 · 완성본 → 직접발송 채워짐을 재고, 폭 320 ~ 1920 줄바꿈을 훑는다.
- 고정 시험 옮김 = `c135-v3-popup-trial`(관련 26곳) · `session-8h-login-notice-1002`(4곳).

## §12 배포 경계 · 커밋 순서

- **배포 가** = 프론트 + 백엔드(재시작 1회) · DDL 0 · ENV 0 · 겹치는 미커밋 파일 0 → 바로 커밋할 수 있다. 확인 = 로그인 화면이 종전 인증 안내 창 · 로그인 직후 장면 창 · `about-v3.html` 과 `/v3/` 그림 주소가 더는 열리지 않음.
- **배포 나** = DDL 1 → 프론트 + 백엔드. `App.tsx` · `Dashboard.tsx` · `AdminDashboard.tsx` · `app.ts` 에 다른 카드의 미커밋 변경이 함께 있어(1116 `git status` 실측 · 어느 카드의 것인지는 줄을 읽어 확인하지 않았다 = 인계 글 기준 C133 C + D · C134) 경로 커밋으로 가를 수 없다 → **그 두 카드의 커밋 뒤에** 커밋한다.
- 이미 이틀 공개됐던 내용(로그인 화면 창 · `about-v3.html`)은 되돌릴 수 없다.

## §13 범위 밖(기록만)

- 공개 소개 `/intro`(1007 · 릴스 영상 + 기능 이름 한 줄) · `about-ai-operator.html` 등 `public/` 의 다른 소개 파일 = 지금도 로그인 없이 열린다. 같은 기준으로 옮길지는 Harold 판단.
- 이메일 등 다른 채널의 기계 제작 = 이 카드는 요청 글만 받는다.
- 「이 완성본으로 보냈다」의 정확한 대조(§7).
- 장면 창의 주 단추를 제안 페이지로 바꾸기(배포 가가 커밋된 뒤 · 서버 보관 마크업의 단추 글 + `V3ScenesPromo.tsx` 의 이동 한 줄).
- 제작 주기 워커(끊긴 제작 자동 재시작).

## §14 Codex 기록(gpt-6-astra · 적대 리뷰)

- 설계 1R(1116) = 지적 8(높음 3 · 중간 5) 전부 수용. 같은 뿌리로 묶어 고침: ① 여러 단계가 밖에 흔적을 남기는 일(제작 · 전달 · 사진)의 다시 하기 규약 = §4 자리 먼저 · §5-1 단계 기록과 이어 하기 · §5-4 밖의 일 먼저 상태 나중 · §5-5 알림 세 상태 ② 넘김 값 = 번호만 · 계정 결박 · 서버가 다시 확인(§6) ③ 소개 창 = 준비 뒤 선점 · 옛 꼴 숨김 요청은 옛 판 · no-store(§2-1 · §2-3) ④ 복귀 값 둘 = 최근에 누른 쪽(§3-2).
- 설계 2R(1116 · 첫 실행은 결과 전에 멈춰 다시 띄움) = 지적 2(중간 2) 전부 수용 · 1R 의 산출물 회수와 같은 부류가 두 라운드째라 규칙으로 고침: 지울 것은 행의 `garbage` 에 먼저 적고 지운 뒤에 뺀다(§5-1) · 사진 저장 CT 가 부분 실패 때 자기가 쓴 파일을 거둔다(§4). 멈추기 전 중간 판정 둘(자산 행 중복 · 알림 다시 보내기의 진행 중 요청)도 반영(§5-1 · §5-5).
- 설계 3R(1116) = 지적 1(중간) 수용 · 회수 완료의 조건 = 파일이 지워졌거나 원래 없음(자산 행이 없다는 답만으로 목록에서 빼지 않는다 · 포스터 항목에 주소를 함께 적는다 · §5-1 · §8).
- 설계 4R(1116) = approve(지적 0 · 「차단할 결함 없음」).
- 목업(docs/mockups/2026-11-16-c136-proposal-mockup.html · 상태 다섯 = 로그인 전 · 신청 전 · 제작 중 · 완성본 · 슈퍼관리자 탭) = 1R 지적 5(중간) 가운데 4 수용(도착 알림 상태 자리 · 포스터 고르기 단추 이름 · 문안 칸 이름 · 보낼 방식 눌림 상태) · 1 불수용(「약 30초」 = 어제 승인 · 배포된 소개 구역의 문장 그대로) → 2R approve(1116). 폭 320 ~ 1920 열두 폭 x 다섯 상태에서 가로 넘침 0 · 제목 · 단추 줄 수 넘침 0.
- 구현 1R(1116 · 배포 가 + 나 전체) = 지적 3(높음 1 · 중간 2) 전부 수용 · 배포 가는 지적 0. ① COMMIT 의 답을 못 받았을 때 신청 사진을 지운다 ② 단계 기록의 DB 오류가 산출물을 추적 밖에 남긴다 = 설계 1R ~ 3R 과 같은 뿌리의 남은 갈래(결과를 모르는 기록) → 규칙으로(§5-1 규약 ⑥ · 아래 2R 에서 다시 고침) ③ 제작 중에 연 관리자 화면이 문안 없이 남은 채 전달이 눌린다 → 화면의 문안 = 서버의 문안(읽을 때마다 맞춘다 · 손댄 칸은 그 서버 값이 그대로일 때만 지킨다) · 저장하지 않은 문안이 있으면 전달 단추 잠금.
- 구현 2R(1116) = 지적 1(높음) 수용 · 1R 에서 넣은 「행을 다시 읽어 가른 뒤 지운다」가 아직 끝나지 않은 앞 쓰기를 앞질러 지울 수 있다 → 같은 부류가 다시 나와 규칙을 바꿈: **적지 못한 산출물은 그 자리에서 지우지 않는다**. 제작 = 소유권을 먼저 내려 앞 쓰기를 막고(같은 행의 쓰기라 앞 쓰기가 끝난 뒤에 선다 · 내려놓은 뒤에는 늦게 도착한 앞 쓰기가 적히지 못한다) 한 문장(`PROPOSAL_PARK_SQL`)으로 「행이 이미 가리키면 그대로 · 아니면 회수 목록에」 · 신청 = 적히지 않았다고 확정된 때(COMMIT 을 보내기 전 · ROLLBACK 이 통함)만 지우고, 그 밖은 같은 자리를 다시 잡아 보아 가른다(같은 열쇠의 INSERT 는 앞 트랜잭션이 끝날 때까지 기다린다) · 가르지 못하면 지우지 않고 알린다. 지우는 자리 = 회수 하나. 미완 판정이던 안내 문자 행 꼴 = 맞다고 확정.
- 구현 3R(1116) = approve(지적 0 · 「토큰 해제와 재INSERT 가 미확정 쓰기를 차단 · 대기하므로 2라운드 지적은 닫혔다」).
- 구현 4R(1116 · 3R 뒤 변이 확인에서 군더더기로 드러난 한 줄 = 신청 가르기의 이른 반환을 걷은 것만) = approve(지적 0).

## §15 구현 기록

### 15-1 배포 가(소개 내용을 로그인 뒤로) — 구현 · 확인(1116)

- 옮김(스크립트 · 값 그대로) = 프론트 `components/v3/v3-popup-parts.ts` 의 CSS · 장면 마크업 · 무료체험 마크업 + `v3-motion.ts` 의 업종 셋 → `packages/backend/src/content/gated/v3-popup.ts` · 그림 12장 `packages/frontend/public/v3/` → `packages/backend/assets/gated/v3/`. 장면 창 = 다섯째 장면 · 글 · 칸을 빼고 단추 줄을 「이미지 스튜디오 보기 · 다음에 볼게요 · 이 소개 다시 보지 않기」로.
- 백엔드 = `utils/gated-content.ts`(새 · 그림 문 · 받을 수 있는 계정) · `utils/v3-intro.ts`(판정 읽기 함수 `decideIntro` · 준비 `peekIntro` · 선점 `claimIntro(…, expectedKey)` · 옛 판의 포스터 · 칩 걷음) · `routes/plans.ts`(준비 주소 · 그림 주소 · 선점에 판 열쇠) · `routes/intro-public.ts`(스위치 주소 걷음) · `utils/v3-login-intro.ts` 삭제.
- 프론트 = `utils/gated-content.ts`(새) · `utils/v3-intro.ts` · `components/AiOperatorLoginPromo.tsx`(틀 = 준비 → 그림 → 선점 → 띄움) · `components/v3/V3ScenesPromo.tsx`(새) · `StudioTrialPromo.tsx` · `v3-motion.ts`(업종 셋을 인자로) · `pages/LoginPage.tsx`(종전 인증 안내 창) · 삭제 = `LoginNoticeSwitch.tsx` · `V3LoginIntroModal.tsx` · `v3-popup-parts.ts` · `use-dialog-trap.ts` · `utils/v3-login-intro.ts` · `public/about-v3.html` · `public/v3/`.
- 시험 = 새 단위 `c136-gated-content` 16 · 새 실 PG `c136-gated-intro.pg` 8 · 옮긴 고정 시험 넷(`c133-v3-intro` 22 · `c135-v3-popup-trial` 43 · `feature-interest-1006` · `session-8h-login-notice-1002`) · 실 PG 관련 3파일 32건 통과(덤프 대조 줄 = test:pg 보고) · tsc 프론트 0 · 백엔드 0.
- 칸 확인 = `companies.usage_type` 은 운영 로그인 문장(`routes/auth.ts:274`)이 읽는 칸이고 시험 DB(t_tpl_closed)에서 `COMPANY_USAGE_SQL` 이 실제로 돈다(실 PG 시험 통과).
- 화면(개발 서버 · 실제 컴포넌트 · 창이 보이는 상태 `document.hidden = false`) = 로그인 화면의 안내 창은 인증 안내 창 하나(V3 창 0) · 장면 창: 요청 순서 준비 → 그림 9장(로그인 토큰 실림) → 선점 → 기록 · 칸 4 · 장면 4 · 그림 = blob 주소 · 넘김 시각 5.0 · 10.5 · 16.5 · 21.8초(한 바퀴) · 「다시 보지 않기」 = 판 열쇠 `v3-scenes` 를 싣고 닫히며 그림 주소 9개를 버림 · 그림 하나가 실패하면 창이 안 뜨고 선점 요청 0 · 무료체험 판도 같은 길(선점 열쇠 `studio-trial` · 처음 포커스 = 신청 단추) · 폭 1440 · 390 · 320 에서 단추 줄이 창 밖으로 나가지 않음.
- 화면 확인에서 고친 것 = 그림 하나가 실패해 접은 뒤 늦게 끝난 요청이 그림 주소를 새로 만들 수 있었다 → 접은 뒤에는 만들지 않는다(`utils/gated-content.ts` · 시험 추가).

### 15-2 배포 나(제안 페이지 + 제작 대행 체험) — 구현(1116 · 시험 · 화면 확인 · 구현 Codex 는 아래에 이어 적는다)

- 백엔드 새 파일 = `utils/proposal-trial.ts`(CT · 신청 · 제작 · 회수 · 전달 · 알림 · 담당자 화면 · 채우기 · 현황) · `routes/proposal.ts`(마운트 `/api/plans/proposal` · 로그인 전 열람 기록 `POST /view` 도 여기) · `content/gated/proposal-page.ts`(목업에서 스크립트로 떼어 온 CSS · 소개 마크업).
- 백엔드 고친 파일 = `app.ts`(마운트 두 줄) · `utils/campaign-quick.ts saveMaterialImages`(부분 실패 때 자기가 쓴 파일을 거둔다).
- 프론트 새 파일 = `pages/ProposalPage.tsx` · `utils/proposal-kit.ts` · `utils/proposal-admin.ts` · `components/admin/ProposalTrialTab.tsx` · 고친 파일 = `App.tsx`(경로 한 줄) · `pages/Dashboard.tsx`(`open=direct-send` 갈래에서 넘김 값 한 번 꺼내기) · `pages/AdminDashboard.tsx`(탭).
- 배포 가에 함께 싣는 것(파일이 겹쳐 나눌 수 없고 먼저 나가도 무해) = `utils/login-return.ts`(허용 한 줄 · `rememberExplicitLoginReturn`) · `pages/LoginPage.tsx`(`?inquiry=1` 이면 문의 창 · 카페24 갈래가 이길 때 복귀 경로 버리기).
- 설계에서 바꾼 것(구현하며 정함): ① 모바일 DM 은 **만들 때 바로 발행**해 직원이 미리 본다(주소는 전달 전까지 담당자에게 가지 않는다) · 발행 = 발행 코어 `publishDmWithPrizes` 하나(채널 구조 ⑭ ⑰ 계약) · 그 앞에 첫 발행 잠금 `dmPublishBlockOf`(링크 결함 · 채울 자리 · 검수 치명) · 발행비는 걷지 않는다(체험 = 우리 부담 · 회사당 DM 한 개) · **발행하지 못한 DM 은 kit 에 두지 않는다**(같은 단계 기록에서 `garbage` 로 보내 지운다 · `kit.dm` = 칸 없음 · null · 주소가 있는 값 셋뿐) → §5-4 의 「전달 때 발행」은 걷었다(전달은 밖에 남는 일을 하지 않고 kit 도 고치지 않는다) ② 로그인 전 열람 기록 주소 = `POST /api/plans/proposal/view`(설계 §3-1 의 `/api/public/intro/proposal-view` 대신 · 배포 가의 파일과 겹치지 않게) ③ 장면 창의 주 단추는 배포 나 뒤에도 「이미지 스튜디오 보기」 그대로다(제안 페이지로 바꾸는 것은 배포 가가 커밋된 뒤의 한 줄 후속 = §13) ④ 모바일 DM 조립 = `campaign-quick.ts generateFromBuildMaterials` 에 크레딧을 묻지도 걷지도 않는 deps 를 준다(견적 0 으로 묶음) ⑤ 문안 = `generateMessages`(개인화 0 · 혜택 근거 = 한 줄) → 광고 표기를 걷은 본문만 저장(`stripAdParts`).
- 구현하며 더 바꾼 것(1116 · 저장소 공용 계약 시험에 맞춤 · 단위 전체에서 드러남): ⑥ **전달의 판 번호 = 직원 화면이 본 값**(`deliverProposalKit(…, seenRevision)` · 화면이 `revision` 을 싣는다 · 그 뒤에 문안 고치기 · 다시 만들기 · 발신번호 바꾸기가 끼었으면 409 = 직원이 보지 않은 완성본이 나가지 않는다 · 설계 §5-4 는 서버가 방금 읽은 값이었다) ⑦ 스팸 검사 상태 둘 추가 = `checking`(통신사 확인 중 · 검사 중 = 판정 CT 의 기다림 갈래 `isSpamHold` · 자동 행동 0 · 직원이 잠시 뒤 「검사 다시」) · `rejected`(보낼 수 없는 글자 · 문안을 고친다) — 뿌리 R36 ⑧ 채널 이름 = 주인 표 `MSG_TYPE_LABEL`(LMS · MMS) — 뿌리 R1(1101 Harold 「전체 SMS LMS MMS 로 통일」 · 목업의 「문자 · 사진 문자」는 쓰지 않는다) ⑨ 제작 단계 실패 = 오류 종류 `ProposalError(PRODUCE_STEP_FAILED)`(한국어 일반 Error 0 · 뿌리 R10 · 사유 글자는 직원 화면과 경보에만) ⑩ 안내 문자의 행 꼴 = 다른 안내와 같게(시각 칸 null · app_etc1 빈 글자) ⑪ 로그인 화면: `?inquiry=1` 로 온 방문은 첫 그림부터 문의 창(인증 안내 창을 띄웠다 내리지 않는다) ⑫ 대시보드의 직접발송 열기 줄은 글자 그대로 두고(C133 고정 시험) 채우기 호출을 그 앞 한 줄로.
- 공용 목록 · 계약 시험에 등재한 것(배포 나의 파일 · 다른 카드의 미커밋 변경이 함께 있는 파일 = 배포 나 커밋에 싣는다): `utils/__tests__/root-ledger.test.ts`(요금제 문 면제 네 줄 = `proposal.ts` 의 신청 · 직원 다시 만들기 · 전달 · 알림 · 이유 = 미가입 회사에 여는 체험 · 우리 부담 · 발송 0 / 라우터 분류 = 「공개 소개 · 진단 · 영업 표본」) · `utils/__tests__/admin-security-menu-1003.test.ts`(관리자 메뉴 38 → 39) · `content/feature-catalog.ts`(`NOT_DOCUMENTED_ROUTES` 에 `/proposal`).
- 구현 Codex 뒤 더 바꾼 것(§14 구현 1R ~ 3R): ⑬ 규약 ⑥ = 적지 못한 산출물은 그 자리에서 지우지 않는다(`parkUnrecorded` · `PROPOSAL_PARK_SQL` · `settleUncertainRequest`) · 지우는 자리 = 회수 하나(`removeArtifact` · 번호가 안 적힌 포스터의 자산은 주소로 찾는다 `assetIdOf`) · 어디에도 남기지 못한 산출물 = 운영 경보 orphan ⑭ 소유권이 없는 실행은 회수도 하지 않는다 ⑮ 관리자 탭의 편집 칸 = `mergeProposalDrafts`(화면의 문안 = 서버의 문안) · 저장하지 않은 문안이 있으면 전달 잠금 ⑯ 검사 판정 → 완성본 상태 = 순수 함수 `spamStateOf`.
- 확인(1116 · 최종 판): 백엔드 tsc 0 · 프론트 tsc 0 · 단위 전체 824파일 13,289건 통과 · 실 PG 전체 86파일 815건 통과(스탬프 기록) · C136 시험 = 단위 `c136-proposal-trial` 27건 · `c136-gated-content` 16건 · 실 PG `c136-proposal-trial.pg` 33건 · `c136-gated-intro.pg` 8건 · 변이 55건 전부 빨간불(단위 24 · 실 PG 31) · 프론트 프로덕션 빌드 통과(3,223 모듈 · 산출물에 공개 그림 폴더 v3 · about-v3.html 없음 · 번들 글자는 난독화되어 검색으로 판정하지 않음 = 소스 계약 시험이 근거).
- 화면(개발 서버 · 실제 컴포넌트 · `document.hidden = false` · 서버 응답은 가로채 대신 줌 · 화면 캡처는 창이 가려져 찍지 못함): 로그인 전 `/proposal?src=값` = 한 줄 · 로그인 단추 · 문의 링크뿐(그림 0 · 열람 기록 요청만) → 로그인 단추 = 복귀 경로를 남기고 옛 카페24 복귀 값을 지움 · `/login?inquiry=1` = 첫 그림부터 문의 창(인증 안내 창 0) · 로그인 뒤 신청 전 = 소개 + 폼(그림 10장을 로그인 토큰으로 받아 blob · 금액 문장 · LMS / MMS) · 폼 검사 다섯 갈래 · 신청 요청의 칸(photos 3 · brief · channel · extra · notifyPhone · src) → 제작 중 화면(그림 요청 0) · 다른 사람이 신청한 회사 · 불러오기 실패 → 다시 불러오기 · 403 = 대시보드 · 그림 실패 = 소개를 띄우지 않음 · 에이전트 전용 회사 = 그 화면으로 · 완성본 = 포스터 3 · 문안 3 · 미리보기 · 「명단만 올려 보내기」가 남기는 값 = 번호와 계정 · 회사 · 시각뿐 → 실제 대시보드가 채우기 주소를 한 번 부르고 문안 · 제목을 채움(다른 계정 값 · 10분 지난 값 · 값 없음 = 요청 0 · 빈 칸) · 폭 320 ~ 1920 열두 개 × 상태 넷 가로 넘침 0 · 관리자 탭 = 단계 · 도착 알림 열 · 문안 저장(판 번호 실림) · 전달 확인 창 → 전달(판 번호 실림) · 409 안내 · 알림 「확인되지 않음」 → 다시 보내기 확인 창 · 제작 중에 연 화면이 다음 읽기에서 문안 3개를 보임 · 손댄 칸이 있으면 전달 잠김 · 폭 1024 ~ 1920 넘침 0.
- 배포 가의 커밋 자족(1116 · 배포 가만 먼저 올려도 서버에서 빌드되는가) = 작업 트리 사본에서 배포 가 목록(scratch/c136/a-paths.txt)에 없는 수정 58파일을 되돌리고 새 파일 50개를 지워 「커밋 판 8e7ec2c6 + 배포 가」만 남긴 뒤: backend tsc 0 · frontend tsc 0 · 배포 가와 맞닿은 단위 7파일(c136-gated-content · c133-v3-intro · c135-v3-popup-trial · feature-interest-1006 · session-8h-login-notice-1002 · feature-catalog-invariants · admin-security-menu-1003) 통과. 배포 나는 C133 C + D · C134 커밋 뒤의 판에서 다시 본다(지금은 가를 수 없다).
- 미검증(실측 C136-S1 에서 본다): 실제 생성(포스터 · 문안 · 모바일 DM · 통신사 스팸 검사)과 안내 문자 도착은 개발 PC 에서 돌리지 않았다(가짜 부품으로 흐름만 시험) · 실제 조립된 모바일 DM 이 첫 발행 잠금을 지나는지 · 운영 PG 에는 표가 아직 없다(C136-DDL-1).

