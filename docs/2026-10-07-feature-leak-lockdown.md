# 기능 유출 차단 · 공개 소개 · 지정 계정 감시 (2026-10-07)

> 이 문서가 이 트랙의 원장이다(경위 · 결정 · 코드 위치 · 운영 상태 · 남은 것). STATUS-FEED C20 · MEMORY Hot 은 포인터만 둔다.
> 호출어 = **기능 유출 차단 / 공개 소개 / 시연 요청 / 감시 알림 / 감시 기록**

## 1. 경위

- 상세 소개 페이지(`/about`, 옛 `about-ai-operator.html`)가 기능 설명 전체(쓰는 순서 · 직접 정할 것 · 지켜 주는 것 · 예시 영상)를 담고 바깥에 돌았다.
  nginx 기록(8/29~10/7) 실측: 카카오톡 미리보기 최소 8회 · Meta(페이스북 계열) 9/6~9/8 집중 · Microsoft 메일 검사 9/24~10/7 매일 → **링크가 메신저 · SNS · 메일로 퍼졌다(보낸 사람은 서버 기록에 남지 않는다).**
- 앱 안 기능 안내 원장(`plan-feature-intros`)과 예시 영상 12편이 **화면 코드 · 공개 폴더**에 있어 로그인 없이 받아 갈 수 있었다(Harold 실측 `hanjul.ai/videos/plan-feature/journeys.mp4` 열림).
- 하단 「기능 안내」(`/guide`)는 기능 전체를 한눈에 보여 줬다(내용은 서버가 유료 계정에만 주지만 입구가 모두에게 보였다).
- Harold: 「8달 동안 만든 걸 그대로 베끼게 둘 수 없다」 · 「구멍 자체를 만들지 마」.

## 2. 결정 (Harold 1007)

| # | 결정 |
|---|---|
| 1 | 상세 소개 `/about` = **hoyun 전용**(서버 판정 `ABOUT_PAGE_VIEWER_IDS` 기본 `hoyun`) · 대시보드 하단 「미팅 자료」 링크도 hoyun 에게만 · 미팅에서 대표가 직접 보여 준다 |
| 2 | 공개 소개 = `/intro` · 공개 릴스 영상(인스타 공개분) + 기능 12가지 **이름 · 한 줄만** + 시연 요청 창 · 영상은 정보 입력 없이 재생(Harold 「시청하려면 정보 넣으세요 하지 말라」) |
| 3 | 시연 뒤 **35만원 요금제 기능 7일 무료 체험** 문구 · 「뷰티 · 의류 · 요식업 · 커머스 브랜드를 위해 만들었습니다 · 현재 많은 업체들이 이용 중에 있습니다」 |
| 4 | 시연 요청 · 방문 기록 = 슈퍼관리자 「소개 방문 · 시연 요청」 **ceo · suran** 만 |
| 5 | 기능 안내 원장 · 예시 영상 = **로그인한 사람에게만 서버가 준다**(원장 = 서버 · 영상 = 12시간 서명 주소) |
| 6 | 워터마크 = **기능 설명 화면에만**(기능 안내 창 · 로그인 안내 창 · `/about`) · **미가입 · 무료 체험 회사만** · 정상 유료 고객사 = 없음 · 지정 계정(기본 psy5868)은 언제나 |
| 7 | 하단 「기능 안내」 링크 제거 · 주소 `/guide` → 비공개 주소 · 들어오는 길 = 도움말 봇 「자세히」뿐(유료 계정만 봇이 뜬다) |
| 8 | 지정 계정 감시 알림(psy5868) = **사무실 밖 IP 로그인 · 두 곳 동시 접속**만 · 받는 번호 = **대표 번호 하나뿐**(「서팀장까지 나가면 안 된다」) · 화면 = ceo 만 |
| 9 | 엑셀 내려받기 · 업무 시간 밖 · 직원별 소개 링크 = 하지 않음(가짜 DB · 슈퍼관리자 권한 없음 · 영업 1인) |

## 3. 코드 위치

| 무엇 | 위치 |
|---|---|
| 소개 페이지 문 | `backend/src/utils/about-page-access.ts` · `routes/ai.ts` `/about-page/access` · `frontend/src/components/AboutGate.tsx` |
| 공개 소개 | `frontend/src/pages/IntroPage.tsx` · 영상 = `public/intro-media/`(★ 폴더 이름이 화면 주소와 겹치면 nginx 가 403 · 1007 실측 → 테스트로 고정) |
| 방문 · 시연 요청 | `backend/src/utils/intro-leads.ts`(CT) · `routes/intro-public.ts`(무인증 · IP당 한도) · 원천 = `audit_logs` `intro_view` · `intro_demo_request` · 화면 `components/admin/IntroLeadsTab.tsx` · 권한 `INTRO_LEADS_VIEWER_IDS`(기본 `ceo,suran`) · 등급표 `introLeads` |
| 기능 안내 원장 · 영상 | 원장 `backend/src/content/plan-feature-intros.ts` · `/about` 구성 `content/about-page.ts` · 내려주기 `utils/plan-feature-intros-serve.ts` · `GET /api/plans/feature-intros`(로그인) · `GET /api/plans/feature-media?f=&u=&e=&s=`(서명 · 경로 끝에 확장자 없음 = nginx 정적 규칙 회피) · 영상 파일 `backend/assets/plan-feature/` · 화면 받기 `frontend/src/constants/plan-feature-intros.ts`(`usePlanFeatureIntros`) |
| 워터마크 | `frontend/src/components/FeatureWatermark.tsx` · 판정 = 서버 `shouldWatermarkFeatureIntro` · 지정 계정 `WATERMARK_LOGIN_IDS`(기본 `psy5868`) |
| 기능 안내 주소 | `frontend/src/constants/guide-path.ts` |
| 감시 알림 | `backend/src/utils/watch-alert.ts`(CT) · 호출 = `utils/login-issue.ts` 3곳(로그인 · 인계 · 충돌 · 기다리지 않음) · 밀려난 쪽 IP = `session-manager.ts` `liveIp` → 감사 기록 `takenOverIp` · `liveIp` · 문자 = `system-alert.ts` `phones` 지정(공용 번호로 넘어가지 않음) · 받는 번호 `WATCH_ALERT_PHONES`(기본 대표 번호) · 대상 `WATCH_LOGIN_IDS`(기본 `psy5868`) · 사무실 `WATCH_OFFICE_IPS`(기본 `180.226.236.94`) |
| 감시 기록 화면 | `components/admin/WatchLogTab.tsx` · `GET /api/admin/watch-log` · `/events` · 권한 `WATCH_VIEWER_IDS`(기본 `ceo`) · 등급표 `watchLog`(대표만) · IP 주인 = KISA 조회(`describeIpOwner` · 하루 기억) · 통신사 본사 주소는 「위치 모름」(`formatIpOwner`) |
| 테스트 | `utils/__tests__/intro-leads-1007.test.ts` · `plan-feature-serve-1007.test.ts` · `watch-alert-1007.test.ts` · 기존 계약 4개(원장 위치 이동 반영) |

## 4. 운영 상태 (1007 Harold 배포 · 실측)

- 전부 배포완료 · 백엔드 재시작 반영 · DDL 0(원천 = `audit_logs`).
- 바깥 실측(로그인 없이): `/intro` 200 · 옛 영상 주소 막힘 · 원장 · 권한 API 401 · 운영 화면 코드 236개 파일에 원장 문장 0.
- 화면 실측 = Harold 「이상 없다」(1007 밤).
- 서버 IP 주인 조회(KISA 43번) = 연결 성공 확인 · 감시 기록 「주인」 칸 회사 이름 표시 확인.

## 5. 조사 기록 (판단 근거 · 결론만)

- 소개 페이지를 연 사람(8/29~10/7) = 우리 · 고객사 5곳(태진 · 크로커다일 · 무주 · 베네통 · 콤비타) · 회사 확인 · 관계 미상 4곳(NHN Cloud = 우리 홈페이지 invitobiz.com 경유 · 한화63시티 · 마포 염리동 회사 · 안양 덕천로 37) · 나머지 = 개인 회선 · 휴대폰 · 로봇.
- **IP 주소 해석 주의**: KISA 주소가 통신사 본사(KT 불정로 90 · LG U+ 한강대로 32 · SKB 퇴계로 24 · SKT 을지로 65)면 위치 정보가 아니다(Harold 집 회선이 용산으로 나온 실측). 따로 신고된 주소만 근거가 된다(그래도 등록값이 낡았을 수 있음).
- 마포 염리동(222.99.201.4) = 시세이도 DM 8건 전부를 매번 발송 당일 1~12초씩 연 고정 회선 · 플랜티넷 필터 · 직원 · 테스트 번호와 겹침 0 → 시세이도 쪽 통로의 외부 회사로 보이며 우리 직원과 잇는 기록 없음.
- 영업팀장 관련: 우리 직원이 링크를 넘겼다는 기록은 서버에 없다(카카오톡 전송은 보낸 사람이 남지 않는다). 근태 · 업무일지 문제는 기록 조사가 아니라 본인 확인 · 노무 상담으로 다룬다(Harold 결정 영역).

## 6. 남은 것

- 감시 알림 첫 실발송 확인(psy5868 사무실 밖 로그인 시 · 대표 휴대폰).
- 무료 체험 일수 7일 = TRIAL 요금제 `trial_days` 값 확인 · 변경(아직 안 함 · 값 확인 SQL 먼저).
- `/about` 영상 파일 · 소개 문장은 이미 바깥에 받아 간 사본이 있을 수 있다(회수 불가).
