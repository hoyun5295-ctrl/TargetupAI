# AI 영업 아웃리치 가다듬기 설계서 v4.1 (2026-09-05)

> **위치**: [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md)가 현재 모습을 소유하고, 이 문서는 **v4 가다듬기의 근거·범위·계약**을 소유한다(승인 뒤 FEATURE 문서 머리 표에 한 행으로 등재).
> **읽는 순서**: §0 요약 → §2 범위 → §3 불변 → §4~§7 축별 설계 → §8 데이터·API 총괄 → §12 착수 순서 → §14 결재 항목.
> **판본**: v4(초안) → 읽기 전용 적대 검토(6축 검토 37 에이전트 · 지적 105건 · 반박 재검증 30건 · 뒤집힘 3건) → **v4.1**(구조 6개로 재편 · §18 검토 이력). 근거는 전부 코드다. 문서와 코드가 어긋난 자리는 §1-3에 따로 적었다.

---

## 0. 한 줄 요약

배관(등록 → 크롤 → 인용 재대조 → 사람 확정 → 문안·포스터·DM·메일 제작 → 자사 수신함 발송 → 수신확인·전달)은 전 구간 실물이다. 가다듬을 것은 **재료가 DM 한 곳에만 흐르고 메일 본문이 문자열 리터럴로 채워지는 구조**(품질), **재생성·재조립·잠금 표시가 없어 운영자가 되돌릴 수 없는 조작 축**(운영), **실패 사유·감사·파기·noindex가 비어 있는 안전 축**(위생), **문자열 스캔뿐인 테스트**(검증) 네 가지다. DDL은 컬럼 1개(`fail_detail` · **배포보다 먼저 실행**)뿐이고 나머지는 전부 코드·jsonb 안에서 끝난다.

v4.1이 v4와 다른 점 = 항목마다 장치를 덧대지 않고 **소유 함수 6개**로 접었다: `countBenefitPlaceholders`(placeholder 원천) · `buildProposalEmailSections` / `generateSubjectIntro`(조립·생성 분리) · `resetJobTo`(되돌리기) · `markFailed`(실패 종결 단일화) · 공개 뷰어 라우트 헤더 1줄(noindex) · `materialText`(재료 예산).

---

## 1. 근거: 0905 코드 조사 결과

### 1-1. 규모와 방법
- 대상 = `packages/backend/src/utils/sales-outreach-{jobs,produce,style,extract,bulk,sweeper,skeleton-seed}.ts` · `outreach-mailer.ts` · `routes/sales-outreach.ts` · `routes/outreach-public.ts` · `SalesOutreachModal.tsx` (약 3,100줄) + 테스트 3파일 19건.
- 방법 = 영역 10개를 읽기 전용 에이전트가 각각 정독 → "없다·반쪽이다" 주장 40건을 반박 전용 에이전트가 재검증(뒤집힘 1건) → 누락 비평 1회. 설계서 v4에 같은 절차를 한 번 더 돌렸다(§18).

### 1-2. 핵심 발견 (설계의 출발점)

| # | 발견 | 증거 |
|---|---|---|
| F1 | 크롤 재료 `eventTextFull`(최대 6000자)이 **DM 단계에만** 흐른다. 문안·메일 서두는 인용 한 줄, 포스터는 업체명만 본다 | `sales-outreach-jobs.ts` producing_copy(416~434) · producing_dm(459~477) · `sales-outreach-produce.ts` 제목·서두 프롬프트(446~458) |
| F2 | 스타일 가이드 v0가 지배하는 곳은 문안 프롬프트와 메일 제목·서두 2곳뿐. **메일 본문 7블록·문구 19곳은 `produce.ts`에 문자열 리터럴** | `sales-outreach-produce.ts:442, 475, 490~539` vs `sales-outreach-style.ts:32~59` |
| F3 | 업종 → 포스터 템플릿 매핑이 15종 중 3종(fashion·beauty·food). 나머지 12종은 '세일·이벤트'로 수렴. 폴백은 kind(product/event)는 유지하되 **업종만 조용히 버린다** | `sales-outreach-produce.ts:161~174` · `image-studio-templates.ts` 분포(제품 7카테고리 = product 169종 · 행사 6카테고리 = event 133종 · 총 302) |
| F4 | 포스터 3:4 세로를 메일 히어로 `height:480px` 고정 박스에 `object-fit:cover`로 넣어 상하 절단 | `produce.ts:498`(height 'lg') · `email-section-renderer.ts` HERO_HEIGHT_PX.lg=480 · 기본 구도 `<img height="480" object-fit:cover>` |
| F5 | 브랜드 정체성 0: 메일에 brandKit·palette 미전달, DM brandKit은 생성기의 `tone` 한 필드. 홈페이지 메타 파서는 이미 있으나(`dm-brand-extractor.ts` extractBrandFromUrl) 무가드 + 별도 fetch라 이 축에서 못 쓴다 | `produce.ts:541~547, 318` · `dm-brand-extractor.ts:180~278` |
| F6 | 표면 결함: 헤드라인 `${업체명}를 위한`(받침 업체명 비문) · 업체명 2회(포스터 + 밴드) · 날짜 `toISOString()`(UTC) · 제목 프롬프트 40자 지시 vs 서버 60자 절단 · **제목의 placeholder는 발송 게이트가 보지 않는다**(html만 검사) | `produce.ts:496, 532, 451, 466` · `jobs.ts:584~586, 609` |
| F7 | 아웃리치 AI 호출 4곳이 공용 문안 품질 장치를 안 탄다. 다만 그 장치(`copy-domain-rules` CTA 강제 · `copy-spam-risk` 문자 스팸 어휘)는 B2B 제안 문안과 맞지 않는다(§16) | `jobs.ts:258, 423` · `produce.ts:146, 461` · `copy-domain-rules.ts:18` · `copy-spam-risk.ts:3~10` |
| F8 | 자동 발행되는 DM 카피에는 혜택 수치 기계 차단이 없다(프롬프트 금지문 1줄). 문안·메일에는 `stripUnauthorizedBenefits`가 걸려 있어 비대칭 | `produce.ts:310~315` · `jobs.ts:435~437` |
| F9 | 발송 3중 잠금이 서버에만 있다. 버튼은 `stage==='ready'`면 항상 눌리고 클릭 후 배너로 통지. `rebuild-email` 라우트는 완성인데 화면 호출자 0. 산출물별 재생성 없음. 편집 가능 필드 = 문안 textarea 1개 | `SalesOutreachModal.tsx:814~819` · `routes/sales-outreach.ts:224`(프론트 grep 0) · 엔드포인트 14개 전수 |
| F10 | 실패 사유가 DB에 안 남는다. 제작 catch·크롤·분석·발송 4곳 전부 `err.message`를 console에만 쓰고 DB에는 고정 문구. 빈 문안('')은 throw가 아니라 producing_copy 'ok' 스탬프 뒤 producing_email에서 엉뚱한 단계로 실패한다 | `jobs.ts:194~196, 282~287, 523~532, 437~444, 488~490` · `outreach-mailer.ts:92~95` |
| F11 | 좀비 판정(15분 · `COALESCE(lock_at, created_at)`)이 `queued`를 포함해, 20행 일괄의 뒤쪽 건이 차례 전에 "처리 시간 초과"로 죽는다. 체인은 CAS 0행이라 로그도 없다 | `sales-outreach-sweeper.ts:33~34` · `jobs.ts:857~868, 184` |
| F12 | 중복 등록 방어 0(재등록 = 포스터 1장·공개 DM 1건 새로 발행) · 취소·삭제·숨김 라우트 없음 · 크롤 실패 시 주소 고쳐 다시 읽는 경로 없음 · 재시도·재크롤로 DM이 다시 발행돼도 옛 DM은 중지되지 않는다 | `jobs.ts:112~118, 844~849, 459~482, 761~772` · `routes/sales-outreach.ts` 전수 |
| F13 | 발송 경로: SMTP 타임아웃·`transporter.close()` 0(같은 리포 `agency-mailer.ts:46~49, 62~65, 77~78`에 선례) · accepted/rejected 대조가 `includes` · 부분 거부가 DB에 안 남음. `sendOutreachProposalMail`은 throw하지 않고 unknown을 반환하므로 SMTP 실패는 이미 즉시 기록된다(원복이 필요한 경로는 DB 예외·프로세스 사망뿐) | `outreach-mailer.ts:61~95` · `jobs.ts:623~634` |
| F14 | 발행된 DM 공개 페이지에 noindex 없음(공개 샘플 페이지에만 있음). 만료 파기는 `studio_image` 파일만 지우고 DM·타사 이미지 hotlink는 남는다 | `routes/outreach-public.ts:17` · `routes/dm.ts:206~258, 2359~2414`(X-Robots 0) · `sales-outreach-sweeper.ts:65~80` |
| F15 | 무인증 `/api/outreach/v`에 IP 리미터 없음 · 감사 로그 0 · `getOutreachJob`이 `SELECT *`(lock_token 응답 노출) · bulk EP가 권한 검사보다 파싱을 먼저 | `app.ts:274~307` · `jobs.ts:777, 783` · `routes/sales-outreach.ts:93~109` |
| F16 | 테스트 19건 중 불변식 9건은 소스 문자열 스캔. 발송 CAS·소유권 CAS·인용 재대조·면허 판정·3값·엑셀 파서는 행동 테스트 0. 핵심 순수 함수가 미export | `__tests__/sales-outreach-invariants.test.ts` · `vitest.config.ts` |
| F17 | `status/SCHEMA.md`에 두 테이블 절·요약 표 행이 없다(outreach 0건). 설계서 §15-7 `mail_result` 목록에 `'sending'` 누락 | `SCHEMA.md:8~30` · 설계서 §15-7 vs `OPS.md:360` |
| **F18** | **가드 크롤이 Node 20에서 전 사이트 실패한다(0905 로컬 실측 · 운영 미검증).** `requestPinned`의 커스텀 `lookup` 콜백이 옛 형태 `cb(err, address, family)`인데, Node 20은 `autoSelectFamily` 기본 on이라 `lookup(host, { all: true })`로 부르고 **배열**을 기대한다 → `ERR_INVALID_IP_ADDRESS` → `fetchHtmlGuarded`가 null. 소비처 = 아웃리치 크롤(`jobs.ts:193`) · DM 편집기 URL 불러오기(`routes/dm.ts:1001`) · 상품 og 이미지(`dm-ai.ts:956` · `email-ai.ts:426` · `inapp-ai-generator.ts:339`). 로컬 Node 20.19.4에서 12사이트 0/12 · 콜백을 배열형으로 바꾼 실험은 12사이트 9/12 성공. 운영은 Node 20.20.0(SERVERS.md) | `dm-brand-extractor.ts:385~387` · 실험 = `scratch/proto/debug-pinned.ts` |

### 1-3. 문서가 코드와 어긋난 자리 (이 설계에서 사실로 맞춘다)
| 문서 | 코드 현실 | 처리 |
|---|---|---|
| FEATURE 불변 3 "발송 버튼이 열리지 않는다" | 버튼은 항상 열리고 서버가 거절 | B-1로 코드를 문서에 맞춘다 |
| FEATURE 불변 10 "단계 결과는 3값" | analyzing만 3값, 제작 4단계는 성공 'ok' 1값 | B-4로 제작 단계에 `unavailable` 기록 |
| FEATURE 불변 11 · 화면 문구 "인물 사진은 자동 제외됩니다" | 판정은 선택 후 제작 시점, 사유는 4단계 근거 패널만 | 화면 문구를 사실로 정정(후보 단계 사전 판정은 비용상 미도입 · §16) |
| 설계서 §15-3 "가드 크롤 최대 5페이지" | 홈 1장 1회 | A-11(1홉 · 결재) |
| 설계서 §15-7 `mail_result` 3값 | DDL·코드는 `sending` 포함 4값 | D-5 문서 정정 |
| `sales-outreach-sweeper.ts` 머리 "하는 일은 둘뿐" | 3기능(좀비·끊긴 발송·파기) | D-5 주석 정정 |
| 설계서 §15-6 "selectedBy·confirmedAt 필수 인자" | `produceOutreachImage` 입력 4개뿐 · 선택 사실은 `event_quote.confirmedBy/confirmedAt`이 소유 | D-5 문서 정정 |
| `produce.ts:493` 주석 "이미지 차단 클라이언트에서도 어두운 색면+흰 헤드라인이 남는다" | 이미지 없음 경로(`posterUrl:null`)는 classic 무이미지 분기라 흰 글씨가 흰 셸에 찍힌다 | A-5·A-6이 색 prop 제거로 함께 닫는다 |

---

## 2. 목표와 범위

### 2-1. 목표 (이 축이 끝나면 참이 되는 문장)
1. 메일·문안·DM 세 산출물이 **같은 재료(홈페이지 전문 + 확인된 인용)**를 본다. 재료 예산은 함수 하나(`materialText`)가 소유한다.
2. 문구 규칙과 문구 자체가 **한 파일(`sales-outreach-style.ts`)**에 있고, 조립 함수는 한글 리터럴을 갖지 않는다.
3. 업종 15종 전부가 제 카테고리의 포스터를 받고, 메일 히어로가 포스터를 자르지 않는다.
4. 운영자가 **산출물 하나만 다시 만들고**, **왜 못 보내는지 클릭 전에** 보고, **실패 원인**을 화면에서 읽는다. 사람이 고친 제목은 재조립이 지우지 않는다.
5. 자동 발행 DM에도 혜택 수치 기계 차단·noindex(기존 발행분 포함 소급)·파기 시 중지가 걸린다.
6. 발송 CAS·재대조·면허 판정·엑셀 파서가 **행동 테스트**로 고정된다.

### 2-2. 범위 밖 (이 축에 넣지 않는다 · 별건 기록 = §16)
| 항목 | 이유 |
|---|---|
| 스마트스토어 재료 축(설계서 §16) | G4 실패로 보류 확정(코드 0건이 정합) |
| 업체 직송·승인 큐(v3) · (광고) 표기·List-Unsubscribe·법정 수신거부 링크 | 수신처가 자사 수신함 ENV 고정인 동안 의미 없음. 직송 결재(§14 #7) 뒤 별도 설계 |
| 인앱 산출물 · 데모 문자 발송 | 0731 문서에만 있고 v2 범위 밖 |
| 스타일 가이드 DB 테이블·편집 UI | 승격 조건 미충족 · `style.ts` 헤더 규약 유지 |
| SSRF 사설 IP 판정기 3벌 통합 · `extractBrandFromUrl` 가드화 · `isRecipientRejected` includes 대조 | 공용 CT 수정 = 별도 과제([B-0824-2]·[B-0824-3] · 정산 발송 3곳) |
| DM 본문 편집 UI · DM 인라인 미리보기 | 편집기는 회사 소속 계정 전용 · 인라인은 sys.hanjullo.com ↔ hanjul.ai 교차 origin(SAMEORIGIN) 미검증 |
| 이미지 후보 단계 사전 인물 판정 | 후보 12장 × vision 호출 = 비용 12배 |
| 문안 품질 루프(`generateWithQualityLoop`) · 제목 스팸 게이트(`scoreSpamRisk`) | 채점 규칙이 문자 광고용(CTA 동사 강제 · 문자 스팸 어휘)이라 B2B 제안 문안에는 상시 실패 또는 무동작. 아웃리치 채점 규칙 신설이 선행 |
| 이미지 축 락을 `tryAcquireGenerateLock`으로 교체 | 그 락은 회사 키(`Set<companyId>`)라 아웃리치(`OUTREACH_COMPANY_ID` 한 값)에는 현행 불리언과 동치이고, rembg 직렬화는 python 단일 워커(`threaded=False`)가 이미 담당. 교체하면 내부 계정 스튜디오 사용자에게 원인 없는 409만 생긴다 |
| `migrations/` .sql 파일 승격 | Harold 규약 = DDL은 OPS 런북 원문을 서버 psql로 직접(파일 자동 생성 금지) |

---

## 3. 불변 원칙

FEATURE §2의 20개는 전부 유지한다. 이 축이 **개정**하는 것 3개와 **신설**하는 것 3개:

| 번호 | 내용 | 성격 |
|---|---|---|
| 3 개정 | "발송 버튼이 열리지 않는다"를 코드가 집행한다: **ENV·산출물 기반 잠금 5종**(발신 계정 · 수신거부 문구 · 조립본 부재 · placeholder 잔존 · 문구 미반영)은 순수 함수 `computeSendLock` 하나가 소유하고, 발송 함수(효과)와 조회 응답(표시)이 같은 함수를 부른다. stage·in-flight·CAS 판정은 효과 함수의 DB 축에 그대로 남는다 | 코드를 문서에 맞춤 |
| 10 개정 | 3값은 제작 4단계에도 적용된다: 제작 실패 = `stage_results[failStage] = 'unavailable'` + `stage='failed'`. 이 스탬프는 `markFailed` 한 함수만 쓴다(sweeper 포함). 재료 부재로 산출물을 줄인 것(이미지 skip·섹션 prune·문장 제거)은 `ok` + payload 감산 기록 | 확대 |
| 18 개정 | "같은 URL을 두 번 긁지 않는다"는 유지. **같은 호스트의 다른 URL 1홉(행사 상세 링크 1개)**은 별 소스로 허용하되 실패를 격리하고(홈 결과에 영향 0 · 3값 별도 기록) 다른 호스트로 리다이렉트되면 버린다. §14 #2 결재 뒤 적용 | 결재 필요 |
| 21 신설 | ⛔ **실패 사유는 DB에 남긴다.** catch가 원문을 console에만 두고 고정 문구를 넣는 형태 금지. `fail_detail`(제작 실패 · `markFailed`) · `stage_results.crawling_detail / analyzing_detail`(수집·분석은 실패 종결이 아니라 unavailable 전진) · `stage_results.mail_last`(발송)에 정제본을 쓴다 | 신설 |
| 22 신설 | ⛔ **자동 발행 DM의 카피도 혜택 기계 차단을 거친다.** 면허(재대조 통과 + 미래 종료일) 인용 밖의 혜택 수치는 문장째(짧은 prop은 prop째) 제거한다. placeholder를 공개 산출물에 남기지 않는다 | 신설 |
| 23 신설 | ⛔ **아웃리치 DM은 noindex이고 파기 시 중지된다.** noindex는 공개 뷰어 라우트가 요청 시각에 회사 id로 판정한다(저장값 아님 · 기존 발행분 소급). 중지된 DM은 404로 나간다(색인 제거 신호) | 신설 |

---

## 4. 축 A. 산출물 품질

### A-1. 재료를 문안·메일 서두까지 흘린다 (F1)
- **현물**: producing_copy 프롬프트 = 인용 한 줄(`jobs.ts:418~430`) · 메일 서두 프롬프트 = 인용 한 줄(`produce.ts:453~458`). DM만 `eventTextFull`을 본다(`jobs.ts:462~466`). 소비처마다 앞자르기 상한이 다르다(DM 경로: `event-brief.ts:16` 8000 · `dm-ai.ts:409` 6000 · `:777` 4000).
- **변경**:
  - `jobs.ts`에 순수 함수 `materialText(eventTextFull: string | null, excerpt: string | null, budget: number): string` export. 앞자르기의 유일한 소유자. 세 호출부(copy 3000 · email 2000 · dm 무절단 = 6000)가 이것만 부른다(지금은 producing_dm 안에 인라인).
  - **프롬프트 재료는 면허 밖 혜택 자리를 지운 뒤 넣는다**: `promptMaterial = stripUnauthorizedBenefits(material, licensedQuote).split(BENEFIT_PLACEHOLDER).join('')`. 모델이 면허 밖 수치를 애초에 보지 않으므로 placeholder 발생률 상승을 원천에서 줄인다. DM 경로는 브리프가 원문 실존을 검증하므로 원문 그대로(현행).
  - producing_copy userMessage에 `[홈페이지에서 읽은 내용]\n${promptMaterial}` 블록. `generateSubjectIntro`(A-2) userMessage에 같은 블록(2000자).
- **영향표**: 소비처 3곳(같은 파일) · 프롬프트 +3000자(문안) · +2000자(제목·서두). **미면허 잡의 발송 잠금(PLACEHOLDER_REMAINS) 빈도는 재료 유입으로 오를 수 있다**(사전 제거로 완화 · 잔존분은 사람이 문안을 고쳐 재조립 = B-1 바로가기). §14 #14 결재.
- **계약 테스트**: `materialText` 행동 테스트(eventTextFull 우선 · excerpt 폴백 · budget 절단) · 프롬프트 조립 순수 함수(`buildCopyPrompt`)에 재료 블록 실재 · 면허 밖 수치가 프롬프트에 없음(픽스처).

### A-2. 조립 함수 분할 + 문구 19곳 이관 (F2 · F6)
- **현물**: `buildProposalEmail`(110줄)이 AI 호출(제목·서두)·strip·기본값·섹션 조립·렌더를 한 함수에 담고, 문구 19곳(제목 기본값 · 서두 기본값 · 히어로 2 · 리드 4 · 문안 카드 2 · 버튼 2 · 서비스 소개 2 · 푸터 4 · 프리헤더)과 발신 브랜드명 `'한줄로'`(492) · catch 로그(472) · 프롬프트 블록(446~458)이 함께 있다.
- **변경**:
  1. `produce.ts`를 둘로 가른다.
     - `generateSubjectIntro(guide, input: { companyName; industry; selectedEvent; promptMaterial }): Promise<{ subject; intro; subjectPlaceholders: number; introPlaceholders: number }>` = AI 호출 · strip · **40자 규칙(strip 뒤 검사 · placeholder 포함 또는 40자 초과면 기본 제목 · 절단 금지)** · catch 기본값. 프롬프트 조립은 순수 `buildEmailIntroPrompt(guide, input)`로 분리(export · 테스트 대상).
     - `buildProposalEmailSections(input: ProposalEmailInput & { subject; intro; brandColor? }): Section[]` = **순수** 섹션 조립. 한글 리터럴 0(전부 `guide.emailCopy`). 렌더(`renderEmailSections`)는 호출부(`assembleProposalEmail`)가 한다.
     - `assembleProposalEmail(input)` = 위 둘 + 렌더 + `text` 평문(C-1) + placeholder 합산 → `{ subject, intro, html, text, placeholderCount }`. `producing_email`이 부르는 유일한 진입점.
  2. `sales-outreach-style.ts`에 `emailCopy` 층 신설. 업체명이 들어가는 문구는 함수(업체명 뒤에 조사를 붙이지 않는다 · `marketing-diagnosis-copy.ts:11` 선례).
     ```ts
     emailCopy: {
       senderBrandName: '한줄로',
       subjectDefault: (c) => `${c} 맞춤 마케팅 시안이 도착했습니다`,
       preheader: (c) => `${c} 맞춤 시안 · 한줄로AI 제작 예시`,
       introDefault: (c) => `${c} 홈페이지를 살펴보고, 한줄로AI로 귀사 브랜드에 맞춘 마케팅 예시를 만들어 보았습니다. 아래에서 실물 그대로 확인하실 수 있습니다.`,
       hero: { headline: '귀사 브랜드로 만든 마케팅 시안', headlineNoImage: (c) => `${c} 맞춤 마케팅 시안`, subCopy: '한줄로AI가 만든 예시(시안)입니다' },
       lead: { tag: '귀사 홈페이지에서 확인했습니다', headlineWithEvent: '지금 진행 중인 소식에 맞춰 만들었습니다', headlineNoEvent: '귀사 브랜드에 맞춰 만들었습니다', quoteLabel: '홈페이지에서 본 내용' },
       showcase: { tag: 'AI 문안 예시', headline: '이런 문안으로 보낼 수 있습니다' },
       cta: { primary: '산출물 보기', secondary: 'DM 열어보기' },
       service: { headline: '한줄로는 이렇게 도와드립니다', body: '…' },
       footer: { notes: ['본 안내의 모든 산출물은 …', '귀사에 맞춤형 제안을 …'], basisLine: (kstDate) => `본 안내는 ${kstDate} 기준 홈페이지 내용을 참고했습니다.`, legal: '(주)인비토 · 한줄로(hanjul.ai)' },
     }
     ```
     - 히어로 헤드라인에서 업체명을 뺀다(포스터가 업체명을 그린다 · 이미지 없음 경로는 `headlineNoImage(c)`로 업체명 1회 보장 · 포스터의 한글 렌더 신뢰도는 §17 미검증).
     - "이 문안이 그대로 발송됩니다" → "이런 문안으로 보낼 수 있습니다"(문자 발송 경로가 없는 사실에 맞춘다). "본 메일의" → "본 안내의"(공개 샘플 페이지가 같은 HTML을 낸다).
- **영향표**: `producing_email` 호출부 1곳(`assembleProposalEmail`) · `rebuildOutreachEmail`은 그 단계를 재실행하므로 무변경 · `getActiveStyleGuide()` 소비처 2곳 무변경.
- **계약 테스트**: `buildProposalEmailSections` 함수 본문(readCode 후 함수 경계 추출)에 **한글 문자열 리터럴 0**(로그·프롬프트는 다른 함수에 있으므로 대상 밖이 자동 성립) · `emailCopy` 함수형 문구 전부에 "업체명 직후 조사(을·를·이·가·은·는·과·와) 없음"(픽스처 '한줄로'·'인비토') · `generateSubjectIntro` 40자 규칙(41자 → 기본 제목 · placeholder → 기본 제목).

### A-3. 브랜드 색 재료 (F5)
- **현물**: 메일은 기본 브랜드색, DM brandKit은 `tone`뿐. 로고 픽셀은 불변 11로 금지(이 축에서도 로고는 쓰지 않는다). `brand_profile.siteTitle`(`<title>`)이 이미 있으므로 사이트명은 새로 저장하지 않는다.
- **변경**:
  1. `dm/dm-brand-extractor.ts`에 6줄짜리 순수 함수 `parseThemeColorFromHtml(html): string | null` export(같은 파일의 private `parseMetaTags`·`isValidHexColor` 재사용 · `extractBrandFromUrl` 무수정). **6자리 hex로 정규화해 반환**(3자리 `#abc` → `#aabbcc` · 그 외 null). 하류 4곳(`email-tokens.ts` shift/withAlpha · `dm-tokens.ts` getContrastRatio · `dm-validate.ts`)이 전부 6자리 전용이라 경계 1곳에서 정규화한다.
  2. `jobs.ts` 크롤: `brandProfile.brand = { primaryColor }`(정규화 통과값 · 없으면 null).
  3. 메일: `assembleProposalEmail` 입력 `brandColor?: string | null` → `isBrandKitPrimaryAccessible({ primary_color })` 통과 시에만 `design.palette.primary`(흰 배경 대비 4.5 미만이면 기본색 유지).
  4. DM: `createDm(... brand_kit: { ...gen.brandKit, ...(accessible ? { primary_color } : {}) })`.
  5. 포스터(선택 · 미검증): `buildPosterPrompt.userHint = 'brand accent color ' + hex`. 실측 1건 뒤 유지 여부 결정.
- **영향표**: 공용 파일 1곳 신규 export(호출부 = jobs 1) · `renderEmailSections` 인자 확장 없음(design.palette 기존 경로) · `createDm` brand_kit jsonb 기존 컬럼.
- **계약 테스트**: `parseThemeColorFromHtml` 픽스처 `#ffffff`·`#fff`·`#FFF`·`#1a2b3c`·`red`(null) · 흰색 3종 전부 메일 palette 미전달 · `#111`은 접근성 통과·6자리 `#111111`로 전달.

### A-4. 업종 15종 매핑 완성 (F3)
- **현물**: `INDUSTRY_TO_CATEGORY` 3종 · `pickTemplate`는 kind를 유지한 채 업종만 버리고 전체 kind 풀로 폴백(`produce.ts:165~174`) · seed = jobId(재생성마다 같은 템플릿) · 선택 템플릿이 payload에 남지 않는다.
- **변경**: 업종마다 **제품 카테고리 배열과 행사 카테고리 배열**을 둔다(값 타입 `{ product: TemplateCategory[]; event: TemplateCategory[] }` · 초안은 1개씩 · 확장 여지).

  | 업종 | product(누끼 있음) | event(누끼 없음) |
  |---|---|---|
  | fashion | 패션 | 시즌·명절 행사 |
  | beauty | 뷰티 | 멤버십·고객감사 |
  | food | 카페·음료 · 신메뉴·팝 | 팝업·페스티벌 |
  | health | 미니멀 | 멤버십·고객감사 |
  | home | 미니멀 | 시즌·명절 행사 |
  | digital | 세일·이벤트 | 오픈·기념일 |
  | baby | 시즌 | 데이·기념일 |
  | pet | 세일·이벤트 | 데이·기념일 |
  | edu | 미니멀 | 클래스·체험 |
  | travel | 시즌 | 시즌·명절 행사 |
  | sports | 세일·이벤트 | 팝업·페스티벌 |
  | culture | 미니멀 | 클래스·체험 |
  | finance | 미니멀 | 멤버십·고객감사 |
  | service | 세일·이벤트 | 오픈·기념일 |
  | etc · null | 세일·이벤트 | 팝업·페스티벌 |

  표는 **초안**이다(시장 판단 = Harold · §14 #1). 카테고리 이름 12개는 `TemplateCategory` 유니온과 글자 단위로 일치하고 30개 풀은 전부 ≥ 11종(0905 실측).
  - 모듈 로드 시 `TEMPLATE_POOLS: Record<IndustryCode, { product: StudioTemplate[]; event: StudioTemplate[] }>`를 한 번 파생하고 `pickTemplate`는 인덱싱만 한다. 빈 풀 판정은 **계약 테스트가 소유**한다(import 시점 throw 금지 · `app.ts → jobs.ts → produce.ts` 체인이라 부팅 전체를 막는다).
  - seed = `${jobId}:${regenSeq}`(B-3의 `stage_results.regen_seq.image` · 최초 0). 같은 (jobId, seq) = 같은 결과(결정성) · 다시 만들면 다른 템플릿.
  - `studio_image` payload에 `templateId · category · kind` 기록(근거 패널 표시 · §13 실측 수단).
  - `textPosition`은 미전달 유지(A-5가 `contain`이라 절단 자체가 없다).
- **영향표**: `pickTemplate` 호출부 1곳(produceOutreachImage). 고객 스튜디오 라우트 무관.
- **계약 테스트**: 15 업종 × {product, event} 풀 길이 ≥ 1(`STUDIO_TEMPLATES` 대상) · `pickTemplate('food','job:0',true)` 결정성 · seq 변경 시 결과 변경 가능(같은 풀 안).

### A-5. 메일 히어로 구도 (F4)
- **추천 = 분할 구도(`treatment: 'split'`) + `image_fit: 'contain'`**. 렌더러가 지원한다(`email-blocks.ts:48` · `renderHero` split 분기). 이미지 셀 300×480 · `contain`이라 어느 폭에서도 자르지 않는다(스택 실패 클라이언트에서 셀이 187px로 좁아져도 절단 0 · 여백만 생긴다). 생성 비용 0.
  - 대안 = `email-hero` 프리셋(16:9) 2차 생성: 건당 +1 이미지 호출(§14 #3).
- **변경**: hero 섹션 `{ treatment: 'split' }` + props `image_fit: 'contain'` + **`headline_color · sub_copy_color · overlay_gradient` 세 줄 삭제**(split은 다크 밴드가 없어 흰 글씨가 흰 셸에 찍힌다 · 미지정 = `b.text`/`b.textMuted`). 이미지 없음 경로는 렌더러가 classic 무이미지 분기로 폴백하고 같은 삭제로 글자색이 성립한다. `produce.ts:493` 주석 폐기.
- **미검증(§13 실측 기준)**: 지메일 모바일·아웃룩 데스크탑에서 (a) 세로 스택 여부 (b) 이미지 셀 실측 폭 (c) `object-fit` 미지원 클라이언트의 왜곡 정도. (c)가 심하면 classic + `contain`으로 되돌린다(판단 기준 = 포스터 문구 판독 가능 여부).

### A-6. 표면 결함 (F6)
- 날짜 = `kstDateTag(new Date())`('YYYYMMDD' · 기존 CT)를 `YYYY-MM-DD`로 표기(소비처 1곳 · 공용 파일 변경 0). `produce.ts:532` 교체.
- 제목 규칙은 A-2 `generateSubjectIntro`가 소유(strip → placeholder·40자 검사 → 기본 제목).
- 갤러리 alt = `${companyName} 이미지`: `fillOutreachDmMedia(sections, media, companyName)` 서명 확장(호출부 1곳).
- 업체명 2회·조사는 A-2가 흡수.

### A-7. 문안 생성의 정직성 (F7 · F10)
- 품질 루프·스팸 게이트는 **도입하지 않는다**(§2-2). 대신:
  - producing_copy 성공 분기 앞에 `if (!body.trim()) throw new Error('AI가 빈 문안을 반환했습니다')` 1줄(현행 결함: 빈 문안이 'ok'로 스탬프되고 producing_email에서 엉뚱한 단계로 실패 · 재시도가 같은 빈 문안을 읽어 영구 실패 루프).
  - 프롬프트 조립을 순수 함수 `buildCopyPrompt(guide, job, promptMaterial)`로 분리(export · 테스트 대상).
  - `stripUnauthorizedBenefits` 결과의 placeholder 개수를 `countBenefitPlaceholders(text)`(`copy-benefit-detector.ts` 옆 아웃리치 파일에 순수 함수 · 서버 상수 `BENEFIT_PLACEHOLDER` 소유)로 세어 copy payload에 `placeholders: n` 기록. **placeholder를 세는 곳은 이 함수 하나**(문안 · 제목·서두 · DM prop · 사람 편집 저장)이고 게이트·화면은 그 숫자를 읽는다(§5 B-1 · B-14).

### A-8. DM 카피 혜택 기계 차단 (F8 · 불변 22)
- **주 대상 경로**: 미면허면 골격 감산이 coupon·countdown·promo_code·instant_coupon·limited_quantity를 생성 전에 이미 뺀다(`produce.ts:396~401` · `dm-structure-resolve.ts:74, 238`). 따라서 이 함수가 실제로 만나는 것은 hero·text_card·header·product_carousel/gallery.title·footer.notes와, `structureRef === null`(골격 해석 실패 = 구조 미전달) 경로에서 나오는 전 섹션이다.
- **변경**: `produce.ts`에 순수 함수 `sanitizeDmCopyBenefits(sections, licensedQuote, companyName): { sections; stripped: number; removed: SectionType[] }`.
  - 대상 prop = `dm-ai.ts` `extractEditableFields`의 `keysByType`를 **`DM_EDITABLE_TEXT_KEYS`로 export**해 그대로 쓴다(손목록 금지 · header.event_title/discount_label · hero.headline/sub_copy · text_card.tag/headline/body · cta.buttons[].label · coupon.discount_label/usage_condition · countdown.urgency_text · promo_code.description/instructions/cta_label · product_carousel/gallery.title · instant_coupon.coupon_label/discount_description/conditions/usage_instructions · footer.notes · tab_cards.tabs[].content). 상품 가격 필드는 대상 밖(브리프가 원문 실존을 검증한 값).
  - 규칙 2단: **긴 prop**(body·description·instructions·conditions·usage_instructions·notes·content) = `stripUnauthorizedBenefits` 뒤 placeholder가 든 문장 제거(문장 경계 = `다.` `요.` `습니다.` `.` `!` `?` `\n` · 경계가 없으면 전체를 한 문장으로) / **짧은 prop**(headline·tag·label·title·urgency_text·discount_label·cta_label·event_title·coupon_label) = placeholder가 생기면 prop을 비운다(문장 분리 무의미).
  - 후처리: hero.headline이 비면 `companyName` · text_card의 tag·headline·body가 전부 비면 **이 함수가 그 섹션을 제거**(`pruneEmptyDmSections`는 ALWAYS_KEEP이라 못 지운다) · 그 밖 데이터 prop이 비면 prune이 지운다(coupon.discount_label 등).
  - 호출 순서 = `fillOutreachDmMedia` → **sanitize** → `pruneEmptyDmSections` → `rebuildDmPages`. `structureRef.pruned`에 sanitize가 뺀 섹션도 합류.
  - `produceOutreachDm` 입력에 `licensedQuote: string`(면허 있을 때 `selected.quote` · 없으면 `''`) 추가. **`eventText` 전문을 면허로 넘기지 않는다**(홈페이지 전체 수치가 면허가 되어 불변 5가 무너진다). 반환에 `benefitStripped` 추가 → jobs.ts dm payload 4키 `{ dmId, dmUrl, structureRef, benefitStripped }`.
- **영향표**: `dm-ai.ts` 상수 export 1건(동작 무변경) · `jobs.ts` producing_dm 호출부 인자 1개 · payload 키 1개.
- **계약 테스트**(픽스처): 미면허 + 본문 "가을 신상 30% 할인. 9월 한정." → "9월 한정." · 미면허 헤드라인 "가을 할인 소식" → 비움 → companyName · 면허 인용 "30% 할인" 포함 → 유지 · 가격 필드 무변경 · text_card 전부 공백 → 섹션 제거 + removed 기록 · 종결부호 없는 긴 body 1문장 → 전체 제거.

### A-9. 직접 입력 인용의 종료 표현 경고
- `hasDisqualifyingMarker(text): boolean`을 `jobs.ts` export(현행 인라인 판정 `quote.toLowerCase().includes(k.toLowerCase())`를 그대로 옮긴다 · 자동 후보 루프와 confirm이 **같은 함수**를 쓴다).
- `confirmOutreachSelection` 반환을 `Promise<{ warnings: string[] }>`로, 라우트 202 본문에 `warnings` 동봉. 거절하지 않는다(사실 확인 책임은 사람).

### A-10. 이미지 후보 수집 확장
- `fetchHtmlGuarded` 반환에 `finalUrl`(최종 홉의 전체 URL) 추가(공용 CT 추가 필드 · 기존 호출부 무영향 · §8-5). `extractImageCandidates`의 절대화 base를 `finalUrl`로(현행 `baseUrl`은 origin뿐이라 경로 상대 `img/a.jpg`가 깨진다).
- 스캔 대상 = `og:image` · `og:image:secure_url` · `<img src|data-src|data-original|data-lazy>` · `srcset`(w/x 디스크립터 **최대값** · 없으면 마지막 URL) · `<source srcset>`. 상한(스캔 60 · 결과 12)·로고 키워드 배제 유지.
- 확장자 필터는 **완화**: 확장자 없는 URL도 후보로 넣는다(CDN 리사이저 URL). 최종 판정은 `fetchImageGuarded`의 `content-type: image/*`(이미 강제).
- **계약 테스트**(픽스처 = 경로 상대 URL · srcset 3단): 후보 ≥ 1 · 최대 해상도 URL 선택 · 로고 배제 · 상한 12 · 확장자 없는 URL 포함.
- **★0905 프로토 실측으로 확정된 추가 규칙(A-10b · 이미지 실측·격상·사본)**: Harold 첫 육안 판정 = "이미지 로딩 실패·흐림부터 부족". 원인 3개 = ① 속성값의 HTML 엔티티(`&amp;`) 미디코딩 → 404(29CM 전 이미지) ② 저해상 썸네일·지연 로딩 자리표시자 선택 ③ CDN 핫링크 차단·과대 폭(`width=3840`) 용량. 처방 = 후보를 **서버가 직접 받아** 헤더로 폭·높이를 읽고(갤러리 ≥600 · 상품 ≥400 미만 탈락) · 상품은 목록 썸네일 대신 **상세 페이지 og:image로 격상**(`fetchProductPage` 1홉 · A-11과 같은 가드) · 통과분을 **우리 저장소에 사본으로 저장**해 산출물이 그 URL을 쓴다(핫링크 0 · 파기 시 함께 삭제 = C-3 hotlink 잔존 해소 · 불변 11의 "인물 없이·고지"는 유지). 결과 = 3업체 갤러리 4~6장·상품 4~6개 전부 1000px 이상. 운영 구현 = `fetchImageGuarded` 재사용 + `writeTempBuffer`/`moveTempToPermanent`(이미 있는 저장 경로) · DDL 0.

### A-11. 행사 상세 1홉 (불변 18 개정 · §14 #2 결재)
- 홈 HTML에서 `href`·텍스트가 `/event|promotion|sale|이벤트|기획전|행사|프로모션/i`에 걸리는 같은 호스트 `<a>` **첫 1개**를 `fetchHtmlGuarded`로 1회 더 받는다. 반환 `finalUrl`의 호스트가 홈과 다르면 버린다(`crawling_sub='unavailable'` · 가드 함수 무수정).
- 3값: `stage_results.crawling_sub = 'ok' | 'no_content'(링크 없음 또는 본문 0자) | 'unavailable'`.
- **재료 합류 = 앞에 싣고 총량 6000 유지**: `eventTextFull = '[행사 페이지 ' + subUrl + ']\n' + sub(≤2000) + '\n' + home(남은 예산)`. `jobs.ts:206` 절단값·공용 상한(`event-brief.ts` 8000 · `dm-ai.ts` 6000/4000) 무수정. `brand_profile.subPageUrl` 기록.
- **재대조는 원문별**: `normHome.includes(quote) ? homepage_url : normSub.includes(quote) ? subPageUrl : 폐기`. 합본은 AI 프롬프트에만 쓴다. `sourceUrl`이 실제 출처를 가리킨다.
- 미결재 시 이 항목 전체 미착수(다른 항목과 독립).

### A-12. 추출기 중복 제거 · 구 데이터 표시
- `buildOutreachEventText`: 구조화 **블록 단위**로 base 텍스트에서 첫 1회 제거(절단된 블록은 제외) 뒤 남은 예산으로 절단. 0건이면 base 무변경(무후퇴 계약 · 기존 테스트 7건 그대로 통과).
- 추출기 반환 확장: 신규 export `buildOutreachEventMaterial(html): { text: string | null; structuredBlocks: number }` · 기존 `buildOutreachEventText`는 이것의 `.text` 래퍼(테스트·계약 유지).
- 화면(확인 단계): "읽은 내용 전체 보기" 접기 패널(eventTextFull 전문 · 6000자) · eventTextFull 없는 구 데이터 = "600자 발췌 기반" 회색 표기.

### A-13. 추출 계측
- `stage_results.analyzing_meta = { rawCandidates, matched, shortDropped, mismatched, markerDropped, structuredBlocks, materialChars }`(jsonb 키 · DDL 0). 근거 패널: "후보 3건 중 2건이 원문과 일치했습니다". 설계서 §17-5의 실측 조정이 가능해진다.

---

## 5. 축 B. 운영 조작

### B-1. 발송 잠금 사전 노출 (F9 · 불변 3 개정)
- 순수 함수 `computeSendLock(env: { mailerReady: boolean; unsub: string }, emailAsset: { html?: string; subject?: string; placeholderCount?: number } | null): { locked: boolean; reasons: SendLockReason[] }` · `SendLockReason = 'SENDER_NOT_CONFIGURED' | 'UNSUB_NOTICE_MISSING' | 'NO_EMAIL' | 'PLACEHOLDER_REMAINS' | 'UNSUB_NOT_APPLIED'` · **소유 파일 = `jobs.ts`**(소비처 = `sendOutreachMailForJob` · `getOutreachJob`).
  - `PLACEHOLDER_REMAINS` 판정 = `emailAsset.placeholderCount > 0`(A-7 원천 숫자 · **제목 포함**). 구 asset(필드 없음)은 `html + subject` 문자열 스캔 폴백.
- `sendOutreachMailForJob`: 첫머리 ENV·산출물 if 5개를 이 함수 결과로 대체. reason → 코드 매핑: `NO_EMAIL` = CONFLICT(현행 409 유지) · 나머지 = NOT_READY(503). stage·행 부재·in-flight·CAS 판정은 그대로.
- `OutreachError(code, message, details?: Record<string, unknown>)` 3인자 · `respondError`가 `{ error, code, ...details }`를 내린다(B-6 `existingJobId`도 이 통로).
- `GET /access` = `{ allowed, ...(allowed ? { mailTo, ready: !!getOutreachContext(), send: { senderReady, unsubReady } } : {}) }`(비허용 계정에 ENV 상태 비노출 · AdminDashboard는 `allowed`만 읽어 무영향).
- `GET /jobs/:id` 응답에 `sendLock` 동봉.
- 화면: [자사 메일로 보내기] = `sendLock.locked`면 disabled + 사유 문구(코드 → 한글은 프론트 상수) + `UNSUB_NOT_APPLIED`면 [메일 재조립] · `PLACEHOLDER_REMAINS`면 [문안 수정]·[제목 편집] 바로가기.

### B-2. [메일 재조립] 버튼
- 검토 우측 패널(ready) · `POST /jobs/:id/rebuild-email`(기존 라우트) 호출 · 확인 모달 불필요.
- **재조립은 제목·서두를 다시 생성하지 않는다**: `producing_email`은 최신 `email_html` payload가 있으면 그 `subject`·`intro`를 재사용하고 `generateSubjectIntro`를 건너뛴다(AI 0회 · 사람 편집분 보존 · B-9). 제목·서두를 새로 뽑는 경로는 B-3 `kind: 'email'` 하나뿐. 부수로 문안 저장(`editOutreachCopy`) 뒤 자동 재조립도 제목·서두를 지우지 않게 된다.

### B-3. 산출물별 재생성
- 신규 `POST /jobs/:id/regenerate { kind: 'copy' | 'image' | 'dm' | 'email' }` → `regenerateOutreachAsset`.
  - 전제(CAS) = `stage='ready' AND mail_result IS DISTINCT FROM 'sending' AND purged_at IS NULL`.
  - 상한 = 잡당 kind별 5회(§14 #10). 카운터는 **요청 시점**에 `stage_results.regen_seq[kind]`를 +1(실패한 재생성도 비용을 태우므로 요청 기준). `regen_count`(asset) = 그 시점의 seq 값을 `insertAssetOwned(…, { regenCount })`로 기록(죽은 컬럼이 카운터가 된다).
  - 전이 = `resetJobTo(jobId, { to: 'producing_' + kind, set: { regen: { from: kind, at } } })`(§B-7의 단일 함수).
  - 의존 순서 = copy → email / image → dm → email / dm → email / email 단독. `runProduction`의 SELECT에 `stage_results` 추가 · producing_copy 뒤 다음 단계 = `regen.from === 'copy' ? 'producing_email' : 'producing_image'`. 나머지 체인 현행.
  - `advanceStage`는 `to='ready'`일 때만 `stage_results = (COALESCE(stage_results,'{}'::jsonb) || $4::jsonb) - 'regen'` · `lock_token = NULL`을 함께 쓴다(그 외 전이는 현행 SQL 유지).
  - **옛 DM 중지 = `producing_email` 성공 분기(새 `email_html` INSERT 성공 직후) 1곳이 소유**: 이 잡의 `kind='dm'` 자산 중 최신 1건을 제외한 전부를 `stopDm(dmId, ctx.companyId)`(`not_published`는 멱등 성공 · 그 외 실패는 로그 + 계속). 재생성·재크롤·재시도 어느 경로로 DM이 다시 발행돼도 **새 것이 선 뒤에 옛 것을 내린다**(옛 dmUrl은 새 email_html이 들어오기 전까지 최신 메일·공개 샘플에 살아 있으므로 발행 직후 중지는 이르다).
- 화면: 각 탭에 [다시 만들기](문안 탭 = [AI로 다시 생성] + 기존 [문안 수정] · 메일 탭 = [제목·서두 다시 생성]). DM·이미지는 ConfirmModal("기존 모바일 DM 링크는 새 메일이 조립된 뒤 닫힙니다"). 근거 패널에 "이 산출물 n번째 재생성".

### B-4. 실패 사유 저장 · 제작 단계 3값 · 실패 종결 단일 함수 (F10 · 불변 10·21)
- **DDL 1**: `ALTER TABLE sales_outreach_jobs ADD COLUMN IF NOT EXISTS fail_detail text;` · **배포보다 먼저 실행**(nullable 로그성 · 구코드 무해 · §8-1). 42703 폴백은 두지 않는다(조회 경로가 `isOutreachMigrationPending`에 걸려 503이 되는 창을 만들지 않는다).
- `markFailed(jobId, failStage, reason, opts: { lockToken?: string; detail?: string; allowStages?: string[] })`가 **실패 종결의 유일한 소유자**: SET = `stage='failed', fail_stage, fail_reason, fail_detail, stage_results = stage_results || jsonb_build_object(failStage, 'unavailable'), lock_token = NULL`. WHERE = lockToken이면 `lock_token = $ AND stage NOT IN ('ready','sent','failed')` · allowStages면 `stage = ANY($)` · 둘 다 없으면 현행(`stage='queued' AND lock_token IS NULL`).
  - `detail` 정제 = `String(err?.message || '').replace(/\s+/g, ' ').slice(0, 300)`.
  - **sweeper도 raw UPDATE 대신 이 함수를 부른다**(SELECT 후보 → 건별 `markFailed(id, row.stage, 문구, { allowStages: [row.stage], detail })`). 좀비·대기 초과(B-5) 둘 다.
- 크롤·분석 실패는 실패 종결이 아니라 `unavailable` 전진(현행)이므로 `stage_results.crawling_detail / analyzing_detail`에 정제본.
- 발송: `stage_results.mail_last = { outcome, detail, rejected: string[], at }`(B-11).
- 화면: 실패 배너 아래 `fail_detail`을 작은 회색 글씨로(ceo 전용). 메일·공개 페이지에는 절대 싣지 않는다.
- `GET /jobs/:id`는 `SELECT *`라 컬럼이 자동으로 실린다(C-5). 목록에는 싣지 않는다.

### B-5. 좀비 판정과 순차 체인 (F11)
- `sweepZombies`의 stage 목록에서 `queued` 제외.
- 신설 `sweepStaleQueued`: `stage='queued' AND lock_token IS NULL AND COALESCE(lock_at, created_at) < NOW() - interval '2 hours'` → `markFailed(id, 'queued', '시작되지 못했습니다(서버 재시작 등). 재시도 버튼으로 다시 시작할 수 있습니다.', { allowStages: ['queued'] })`. `retryOutreachJob`은 fail_stage `'queued'`도 크롤부터 재시작(현행 분기 그대로). `resetJobTo`가 되돌릴 때 `lock_at = NOW()`를 찍으므로 방금 재시도한 건이 즉시 stale로 오판되지 않는다.
- 체인 진척: `enqueueOutreachJobsBulk` INSERT 시 `stage_results = '{"chain": {"batch": "<uuid>", "index": i, "total": n}}'` · `listOutreachJobs` SELECT에 `stage_results` 추가 → 목록 "대기 3/20" · 근거 패널 "일괄 등록 20건 중 3번째".

### B-6. 중복 등록 (F12 · §14 #4)
- 정규화 키 = 호스트(소문자 · `www.` 제거) + 첫 경로 세그먼트(플랫폼 입점형 URL 구분 · 자체 도메인은 첫 세그먼트가 비어 호스트만). `enqueueOutreachJob`: 같은 키의 미파기 잡이 있으면 `OutreachError('CONFLICT', '이미 등록된 업체입니다', { reason: 'DUPLICATE', existingJobId })` → 409. 요청 `force: true`면 통과.
- 화면: 409 수신 시 [기존 건 열기](existingJobId) · [그래도 새로 만들기](force). 일괄: 중복은 `rejected`("이미 등록된 업체")로 건너뛴다.

### B-7. 되돌리기 단일 함수 + 주소 수정·재분석
- `resetJobTo(jobId, opts: { expect: string[]; to: string; set?: { regen?, homepageUrl? }; clear: string[] })` 신설: 조건부 UPDATE 1문(`WHERE id AND stage = ANY(expect) AND purged_at IS NULL [AND mail_result IS DISTINCT FROM 'sending']`) + `stage_results - '키'` 연쇄(`clear` = 기본 `['regen','crawling','analyzing','crawling_sub','analyzing_meta']` 중 경로별) + `lock_token`(새 uuid 또는 NULL) + `lock_at = NOW()` + `fail_stage/fail_reason/fail_detail = NULL`. **retry(크롤·제작) · recrawl · regenerate · rebuild 다섯 진입점이 전부 이 함수를 쓴다**(각자 CAS·키 초기화·락 규율을 복제하지 않는다).
- 신규 `POST /jobs/:id/recrawl { homepageUrl?: string }` → `resetJobTo(jobId, { expect: ['awaiting_confirm','failed'], to: 'queued', set: { homepageUrl }, clear: 전부 })` + `event_quote = NULL, brand_profile = NULL` → `runOutreachJob`.
- 화면: 확인 단계 unavailable 배너에 주소 입력칸 + [다시 읽기]. analyzing unavailable(AI 장애)에도 같은 버튼.

### B-8. 진행 목록 검색·필터·더 보기
- `GET /jobs?q=&group=&limit=50&before=<ISO>`: `company_name ILIKE` · `homepage_url ILIKE` · `group` = `active`(queued~producing_email 7값) | `awaiting_confirm` | `ready` | `sent` | `failed` · `created_at < before` 커서 · LIMIT 상한 100.
- 화면: 검색 + 상태 칩 5 + [더 보기]. **폴링은 첫 페이지만 · id 기준 upsert**(앞부분만 갱신 · 뒤쪽 누적분 유지).

### B-9. 메일 제목 편집
- 신규 `POST /jobs/:id/subject { subject }`(1~40자 · `stage='ready' AND mail_result IS DISTINCT FROM 'sending' AND purged_at IS NULL`) → 최신 `email_html` payload를 복사해 `subject`·`subjectEditedAt/By`만 바꾼 새 asset INSERT. **낙관 잠금**: 읽은 최신 asset id를 `WHERE (SELECT id … ORDER BY created_at DESC LIMIT 1) = $readId`로 결속(읽기와 INSERT 사이에 재조립이 끼어들면 0행 → CONFLICT). 사람 편집 제목의 placeholder는 `countBenefitPlaceholders`로 세어 `placeholderCount` 갱신.
- 보존 = B-2 규칙(재조립·문안 저장이 제목·서두를 재생성하지 않는다).
- 화면: 메일 탭 iframe 위에 제목 한 줄 + 연필.

### B-10. 프론트 폴링·알림 정합
- 요청 순번 ref(`reqSeq`) · 늦은 응답 폐기 · 언마운트 AbortController · 목록 폴링은 `setJobsList` 업데이터 안 fetch를 없애고 `activeRef`로 판정 · `jobRef` 죽은 코드 제거.
- `copyEditing`은 state + ref를 함께 바꾸는 함수 하나(`setEditing(v)`)로 · `saveCopy`는 ref를 먼저 false로 내린 뒤 `loadJob`.
- 성공 통지 = `useToast().success` · 오류·경고는 notice 배너 유지.
- 반응형: 검토 grid에 `md:` 분기 · iframe 높이 `h-[60vh] min-h-[420px]`.

### B-11. 발송 경로 보강 (F13 · Codex 대상)
- `outreach-mailer.ts`:
  - `createTransport`에 `connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000` + `Promise.race` 총 상한 30초 + **`finally { transporter.close() }`**(`agency-mailer.ts:46~49, 62~65, 77~78` 선례 세 가지 전부).
  - 순수 함수 `matchAddress(list, addr)`(꺾쇠 `<a@b>` 정규화 · 소문자 정확 일치) · `decideMailOutcome(info, to): { outcome; accepted[]; rejected[] }` 신설. `isRecipientRejected`(공용 · includes)는 아웃리치에서 쓰지 않는다.
  - `sendOutreachProposalMail({ subject, html, text })` · 반환에 `rejected[]` 추가.
- `jobs.ts sendOutreachMailForJob`:
  - **선점 CAS는 원복 try 밖(위)에 둔다.** 선점 성공 이후 구간만 안쪽 try/catch로 감싸고, 거기서만 `UPDATE … SET mail_result='unknown' WHERE id=$1 AND mail_result='sending'` 원복 후 재throw(선점 0행 CONFLICT가 남의 sending을 덮는 경로 차단). 원복이 실제로 필요한 경로는 DB 예외·프로세스 사망뿐이다(SMTP 실패는 unknown 반환으로 이미 즉시 기록).
  - rejected·unknown 기록 UPDATE도 `RETURNING id` 0행이면 console.error.
  - 결과와 무관하게 `stage_results.mail_last = { outcome, detail, rejected, at }` 기록.
  - `text`는 `emailAsset.text`(A-2 조립이 payload에 저장 · 구 asset은 생략).
- **계약 테스트**: `matchAddress`·`decideMailOutcome`(포함 관계 주소 `a@b.co`/`xa@b.co`) + SQL 계약(공백 정규화 후 인접 문자열 정확히 1회: 선점 `SET mail_result = 'sending', lock_at = NOW() WHERE id = $1 AND stage = 'ready' AND mail_sent_at IS NULL` · 원복 UPDATE가 선점 뒤 try 안에만 존재).

### B-12. 감사 로그
- `routes/sales-outreach.ts` 성공 분기에서 `recordAuditLog({ actorUserId: req.user.userId, action: 'sales_outreach.<confirm|send|mail_confirmed|forwarded|copy_edit|subject_edit|rebuild_email|regenerate|recrawl|retry|dismiss>', targetType: 'sales_outreach_job', targetId, details, req })`.
- `packages/frontend/src/constants/audit-action-labels.ts`에 11종 한글 라벨 등록(파일 규약).
- `audit_logs.user_id` FK 실재 여부는 §8-1 확인 SQL로(문서 DDL은 `REFERENCES users(id)` · 값은 `super_admins.id` · FK가 살아 있으면 23503으로 조용히 0행).

### B-13. 메뉴 뱃지 + 실패 건 숨기기
- 신규 `GET /api/sales-outreach/badge` → 비허용 계정 404 · `{ success: true, count }` = `failed AND stage_results->>'dismissed_at' IS NULL` + (`sent` AND `mail_confirmed_at IS NULL`).
- 신규 `POST /jobs/:id/dismiss`(failed 전용) → `stage_results = stage_results || {"dismissed_at": …}`(DDL 0 · 영구 실패 건이 뱃지를 영구 점등하지 않게). 목록에는 회색으로 남는다.
- `AdminDashboard.tsx`: `outreachBadge` state · mount와 모달 닫힘 시 갱신 · 메뉴 항목 `badge`.

### B-15. 검수 테스트 발송 + 입력 확장 (★0905 Harold 접수)
- **요구**: 업체 하나를 등록할 때 홈페이지 외 정보도 넣을 수 있고, 제작이 끝나면 **우리 담당자 메일주소를 직접 입력해** 그 사람에게 먼저 보내 검수받을 수 있어야 한다.
- **현물**: 수신처는 `OUTREACH_MAIL_TO` ENV 고정이고 입력칸이 없다(FEATURE §2 "수신처는 인자로 받지 않는다" · 오발송 구조적 0). 입력은 업체명·업종·홈페이지 3필드.
- **변경**:
  - 신규 `POST /jobs/:id/test-send { to: string }` → `sendOutreachTestMail(jobId, to, operator)`: 수신 주소는 **허용 도메인 목록**(`OUTREACH_TEST_MAIL_DOMAINS` · 기본 `invitocorp.com` · 쉼표 목록)에 속할 때만 통과(그 밖 = VALIDATION 거절). 제목 앞에 `[검수] ` 접두 · 본문은 발송본과 같은 조립 결과(불변 16) · `stage`·`mail_result`는 건드리지 않는다(검수는 발송이 아니다) · 발송 잠금 5종 중 `SENDER_NOT_CONFIGURED`·`NO_EMAIL`만 적용(수신거부 문구·placeholder는 검수 단계에서 보려는 것이므로 허용).
  - 이력 = `stage_results.test_sends[]`에 `{ to, outcome, at, by }` 최대 20건(jsonb · DDL 0). 감사 로그 `sales_outreach.test_send`.
  - 입력 확장: 등록 폼에 "추가 정보(선택)" 텍스트(≤2000자 · 담당자 이름·요청 사항·행사 메모)를 받아 `brand_profile.extraNotes`에 저장하고 A-1 `materialText` 뒤에 `[담당자 추가 정보]` 블록으로 붙인다(사람이 쓴 사실 = 인용 면허 없음 · 혜택 수치는 A-1 규칙 그대로).
  - 화면: ④ 검토 우측 패널에 "검수 메일 보내기" 입력칸(이메일) + [보내기](ConfirmModal 불필요 · 내부 도메인만) + 테스트 발송 이력 3줄. ① 입력 단계에 "추가 정보" 접기 입력.
- **불변 정합**: FEATURE §2 발송 원칙 1(사람 클릭 1경로)은 유지 · "수신처는 인자로 받지 않는다"는 **허용 도메인 안에서만 인자를 받는다**로 개정(§3에 추가 · 외부 주소는 구조적으로 막힌다).
- **계약 테스트**: `isAllowedTestRecipient(to, domains)` 순수 함수(대소문자·서브도메인 불허·목록 밖 거절) · 소스 불변식 "테스트 발송 함수가 `stage`·`mail_result`를 UPDATE하지 않는다".

### B-14. 검토 화면 보강
- 메일 탭 위: `sendLock`·`placeholderCount`(서버 숫자 · 프론트에 `BENEFIT_PLACEHOLDER` 문자열 복제 0)로 amber 줄("직접 채울 자리 2곳") · `dm.benefitStripped`·`copy.stripped`로 emerald 줄(기계가 걷어낸 수).
- 미리보기 폭 토글 600 / 375.
- 근거 패널: A-13 계측 · `structureRef.pruned` · `studio_image.templateId/category` · 재생성 순번 · `chain`.
- 문구 정정: "고른 사진에 인물이 있으면 제작 단계에서 제외되고 사유가 표시됩니다".

---

## 6. 축 C. 안전·위생

### C-1. 평문 대체본
- 아웃리치 전용 조립(공용 `extractEmailText`는 cta·footer를 못 읽는다): `subject + intro + 문안 + '산출물 보기: ' + previewUrl + 'DM: ' + dmUrl + 수신거부 문구` → `assembleProposalEmail` 반환 `text` → `email_html` payload → 발송(B-11).

### C-2. DM noindex (F14 · 불변 23)
- **저장값을 만들지 않는다.** `routes/dm.ts` 공개 뷰어 2곳(`/:code` · `/ab/:code`)에서 `getDmByCode` 성공 직후 `if (dm.company_id === getOutreachContext()?.companyId) res.setHeader('X-Robots-Tag', 'noindex, nofollow')` 1줄. 이미 발행된 아웃리치 DM에도 즉시 적용 · 타 고객사 DM 무영향 · 공용 타입·뷰어 템플릿·프론트 미러 변경 0. 중지·파기된 DM은 404로 나가므로 그 시점의 색인은 문제가 없다.
- **묶음 1에서 착수**(첫 실측 DM부터 불변 23이 참이 되도록).
- **계약 테스트**: 라우트 소스 불변식(두 핸들러에 헤더 1줄 실재) + 공개 뷰어 응답 헤더 단위 테스트(회사 id 일치/불일치).

### C-3. 파기 범위 확장 (불변 23 · §14 #5)
- `sweepExpired`: **후보 질의 전에** `getOutreachContext()`를 1회 판정해 null이면 회차 전체를 스탬프 없이 건너뛴다(스탬프 뒤 건너뛰기 = 영구 누락). 후보마다 `kind='dm'` 자산의 `payload.dmId`를 `stopDm(dmId, ctx.companyId)`: `not_published` = 멱등 성공 · `not_found`·`race`·`ab_running` = 실패(파일 삭제 실패와 같은 롤백 · purged_at NULL · 다음 회차).
- 이미지 파일 캐시(`Cache-Control: public, max-age=86400`)는 최대 1일 잔존 가능(문서 기록 · 코드 변경 없음).

### C-4. 공개 경로 리미터 (F15)
- `app.ts` 리미터 블록(274~307) 안, mount(405)보다 앞에 `app.use('/api/outreach/v', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: <404 안내와 같은 형식의 HTML 문자열> }))` 별도 인스턴스(사람이 브라우저로 여는 경로라 응답은 HTML).

### C-5. 응답 범위
- `getOutreachJob`: `SELECT *` 유지 + 반환 직전 `const { lock_token, ...rest } = job.rows[0]`(컬럼 목록 고정 금지 · ALTER와 배포 순서를 결합시키지 않는다). 프론트 타입 = 최상위 `fail_detail` · `brand_profile` 하위 `eventTextFull · crawledAt · brand · subPageUrl` · `stage_results`를 `Record<string, unknown>`으로.

### C-6. 일괄 업로드 EP
- 순서 = `isSalesOutreachOperator` 검사 → multer → 파싱 → enqueue(양식 EP와 같은 형태).
- multer `fileFilter` = 확장자 `.xlsx|.xls` **그리고** mimetype(`spreadsheetml`·`ms-excel`·`octet-stream`) 둘 다 통과. 거절 문구 2종 분리(확장자 · 용량 `LIMIT_FILE_SIZE`).
- `parseOutreachBulkXlsx`: 거절 목록 상한 50건 + `rejectedOverflow: n`.

### C-7. 이미지 임시 저장 용량 게이트
- 제작 전 `companyTempUsageBytes(ctx.companyId) > STUDIO_TEMP_CAP_BYTES`면 throw('임시 저장 용량 초과 · 잠시 후 재시도'). 락 교체는 하지 않는다(§2-2).

### C-8. ENV 문서화
- `.env.example`에 `# AI 영업 아웃리치` 절: `SALES_OUTREACH_ALLOWED_USERS` · `OUTREACH_COMPANY_ID` · `OUTREACH_USER_ID` · `OUTREACH_SMTP_USER` · `OUTREACH_SMTP_PASS` · `OUTREACH_MAIL_TO` · `OUTREACH_UNSUB_NOTICE` · `PUBLIC_BASE_URL` · `DM_SHORT_LINK_BASE` · **`SMTP_HOST` · `SMTP_PORT`(정산 발송과 공유 · 계정만 분리)** · **`INAPP_IMAGE_PATH`(파기가 지우는 경로)**. 값은 예시·빈칸.

---

## 7. 축 D. 테스트·스키마·문서

### D-1. 행동 테스트 (순수 함수 export)
| 파일 | export | 테스트 |
|---|---|---|
| `sales-outreach-jobs.ts` | `normalizeQuoteText`(현 `norm`) · `isFutureDate` · `hasDisqualifyingMarker` · `filterQuoteCandidates(parsed, texts: { home; sub? }, urls)` · `extractImageCandidates(html, finalUrl)` · `materialText` · `buildCopyPrompt` · `computeSendLock` · `countBenefitPlaceholders` | 재대조 통과/실패·출처 판정 · 8자 미만 폐기 · 종료 표현(대소문자) · 미래 종료일 면허 · 경로 상대 URL 후보 · 재료 예산 · 잠금 5사유 · 구 asset 스캔 폴백 |
| `sales-outreach-produce.ts` | `pickTemplate` · `TEMPLATE_POOLS` · `sanitizeDmCopyBenefits` · `buildProposalEmailSections` · `buildEmailIntroPrompt` · `fillOutreachDmMedia` | A-4 · A-8 · A-2 케이스 |
| `outreach-mailer.ts` | `matchAddress` · `decideMailOutcome` | B-11 케이스 · `outreachMailToList()` ENV 주입 1회 |
| `sales-outreach-bulk.ts` | (이미 export) | `xlsx` 메모리 워크북 → 거절 사유 7종 · 20행 상한 · 빈 행 헤더 · 라벨 역매핑 |
| `sales-outreach-extract.ts` | `buildOutreachEventMaterial` | null 계약 · STRUCTURED_MAX 절단 · 블록 중복 제거 · 0건 동일성(기존 7건 유지) |
| `dm/dm-brand-extractor.ts` | `parseThemeColorFromHtml` | A-3 픽스처 |
- SQL 계약(하네스가 DB를 못 만지는 동안의 대체 · `readCode` 후 공백 정규화 · 인접 문자열 **정확히 1회**): (a) 발송 선점 (b) 원복 UPDATE가 선점 뒤 try 안에만 (c) `insertAssetOwned`의 `WHERE EXISTS … stage = $4 AND lock_token = $5` (d) `advanceStage`의 `- 'regen'`이 ready 분기에만.

### D-2. 불변식 테스트 보강
- 파일 목록 = `readdirSync` glob(`utils/*outreach*.ts` + `routes/*outreach*.ts`) + 프론트 `SalesOutreachModal.tsx`는 패키지 밖 절대 경로 1건으로 따로.
- err 원문 규칙 = "`respondError` 함수 본문(주석 제거 후 함수 경계 추출) 안에서만 `err.message` 허용 · 그 밖 routes/*outreach*.ts 어느 줄(응답·대입 포함)에서도 `(err|error|e)\??\.message`·`String\((err|error|e)\)` 금지"(현행 강도 유지).
- 게이트 전수 = `jobs.ts`를 `export async function` 단위 조각으로 잘라 각 조각에서 `await assertOperator(`의 위치가 첫 `await query(`·`process.env`보다 앞(파싱 0). 허용 목록 = `runOutreachJob` · `runProduction` 계열 내부 함수 · `getPublicOutreachHtml`.
- jsonb 규율 = `query(` 부터 다음 `);`까지 소스 슬라이스 단위로 `::jsonb` 개수 = `JSON.stringify(` 개수(SQL 리터럴 jsonb(`'{"chain":…}'`)는 `::jsonb` 캐스트 없이 쓰므로 대상 밖).
- sweeper 등재 검사를 `readCode`로 · sweeper에 raw `stage = 'failed'` UPDATE 0(전부 `markFailed`).
- 신설: `buildProposalEmailSections` 본문 한글 리터럴 0(A-2) · 15×2 풀(A-4) · 공개 뷰어 헤더 1줄(C-2) · `resetJobTo` 밖에 `stage_results -` 연산 0(B-7).

### D-3. SCHEMA.md
- 요약 표에 2행(선례 `14-A` 하위번호 형식) + 상세 절 2개: `sales_outreach_jobs`(21컬럼 · CHECK 값 전수 · `mail_result`에 `sending` 포함 · `created_by` FK 없음 사유) · `sales_outreach_assets`(6컬럼 · `regen_count` 의미 = B-3). `stage_results` jsonb 키 사전(§8-2)은 그 절이 소유.

### D-4. OPS.md
- §2-2-E **⑦** 절(⑥은 '긴급 정지'가 사용 중): v4 ALTER + 반영 확인. ③ 원문 DDL에 `fail_detail text` 한 줄 추가 · ④ 기대 컬럼 수 20 → 21. 배포 순서 = **ALTER → 코드**.

### D-5. 문서 정정
- FEATURE-SALES-OUTREACH.md: 머리 표에 이 문서 행 · §2 불변 3·10·18 개정 + 21~23 신설 · §3 파일표(`parseThemeColorFromHtml` · `DM_EDITABLE_TEXT_KEYS` · `fetchHtmlGuarded.finalUrl` 재사용 명시) · §4 ENV 표(신규 키 0 · `.env.example` 등재) · §5 이력 행.
- 설계서 `2026-07-31` §15-7 `mail_result` 4값 · §15-6 "selectedBy·confirmedAt" → `event_quote.confirmedBy/confirmedAt`가 소유.
- `sales-outreach-sweeper.ts` 머리 주석 4기능(좀비 · 대기 초과 · 끊긴 발송 · 파기) · `sales-outreach-style.ts` 헤더 "가이드 미학습 표시" 문장을 화면 실태에 맞춤 · `produce.ts:493` 주석 폐기.

---

## 8. 데이터·API 변경 총괄

### 8-1. DDL (1건 · **배포 전 실행**) · 확인 SQL
코드 작성 **직전** 확인(0행이어야 한다):
```sql
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_outreach_jobs' AND column_name='fail_detail';
```
감사 로그 FK 확인(B-12 · FK가 있으면 super_admins.id INSERT가 23503으로 조용히 0행이 된다):
```sql
SELECT conname FROM pg_constraint WHERE conrelid='audit_logs'::regclass AND contype='f';
```
배포 **전** 실행(OPS §2-2-E ⑦):
```sql
ALTER TABLE sales_outreach_jobs ADD COLUMN IF NOT EXISTS fail_detail text;
```
반영 확인(기대 21):
```sql
SELECT COUNT(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_outreach_jobs';
```
`ADD COLUMN IF NOT EXISTS`는 PG 9.6+ 문법(로컬 compose = 15 · 운영 버전은 미확인 → ⑦ 절에 버전 확인 1줄 동봉).

### 8-2. `stage_results` jsonb 키 사전 (DDL 0)
| 키 | 값 | 쓰는 곳 | 읽는 곳 |
|---|---|---|---|
| `crawling` · `analyzing` | 3값 | 현행 | 확인 단계 배너(현행) |
| `producing_copy/image/dm/email` · `queued` | `'ok'` · `'unavailable'`(신설) | advanceStage · **markFailed(단일)** | 4단계 실패 배너(신설 표시) |
| `crawling_sub` | `'ok' \| 'no_content' \| 'unavailable'` | A-11 | 근거 패널 |
| `crawling_detail` · `analyzing_detail` | 정제 문자열 ≤300 | B-4 | 확인 단계 unavailable 배너 |
| `analyzing_meta` | `{ rawCandidates, matched, shortDropped, mismatched, markerDropped, structuredBlocks, materialChars }` | A-13 | 근거 패널 |
| `chain` | `{ batch, index, total }` | B-5 | 목록 · 근거 패널 |
| `regen` | `{ from, at }` (advanceStage ready 분기가 제거) | B-3 · resetJobTo | runProduction |
| `regen_seq` | `{ copy, image, dm, email }` 요청 횟수 | B-3 | 상한 판정 · 근거 패널 · pickTemplate seed |
| `mail_last` | `{ outcome, detail, rejected[], at }` | B-11 | 발송 패널 |
| `dismissed_at` | ISO | B-13 | 뱃지 · 목록 |
프론트 타입 `stage_results: Record<string, unknown> | null`(현행 `Record<string,string>` 확장 · 3값 키는 문자열로 읽는다).

### 8-3. 엔드포인트
| 메서드·경로 | 변경 | 소유 함수 |
|---|---|---|
| `GET /access` | 응답 확장(allowed일 때만 `ready`·`send`) | 라우트 |
| `GET /jobs` | `q·group·limit·before` · `stage_results` 동봉 | `listOutreachJobs` |
| `GET /jobs/:id` | `lock_token` 제외 · `sendLock` 동봉 | `getOutreachJob` · `computeSendLock` |
| `POST /jobs` | `force` · 409 `{ code:'CONFLICT', reason:'DUPLICATE', existingJobId }` | `enqueueOutreachJob` |
| `POST /jobs/:id/confirm` | 202 `{ ok, warnings }` | `confirmOutreachSelection` |
| `POST /jobs/:id/regenerate` | **신규** `{ kind }` | `regenerateOutreachAsset` |
| `POST /jobs/:id/recrawl` | **신규** `{ homepageUrl? }` | `recrawlOutreachJob` |
| `POST /jobs/:id/subject` | **신규** `{ subject }` | `editOutreachSubject` |
| `POST /jobs/:id/dismiss` | **신규** | `dismissOutreachJob` |
| `GET /badge` | **신규** | `countOutreachBadge` |
| `POST /jobs/:id/test-send` | **신규** `{ to }`(허용 도메인만) | `sendOutreachTestMail` |
| `POST /jobs` | `extraNotes` 입력 추가 | `enqueueOutreachJob` |
| 나머지 9개 | 무변경(감사 로그만 추가) | |

### 8-4. ENV
신규 키 0. `.env.example` 등재만(C-8).

### 8-5. 공용 파일 변경(아웃리치 밖 · 7-1 절차 대상)
| 파일 | 변경 | 회귀 고정 |
|---|---|---|
| `dm/dm-brand-extractor.ts` | `parseThemeColorFromHtml` 신규 export(6줄 · private 헬퍼 재사용) · `fetchHtmlGuarded` 반환에 `finalUrl` 추가 | 기존 호출부(`dm-brand-kit.ts` · `routes/dm.ts`)는 새 필드를 읽지 않음 · 픽스처 테스트 |
| `dm/dm-ai.ts` | `keysByType` → `DM_EDITABLE_TEXT_KEYS` export(값 무변경) | 소스 불변식(동일 객체) |
| `routes/dm.ts` | 공개 뷰어 2곳 헤더 1줄(회사 id 조건) | 헤더 단위 테스트(일치/불일치) |
| `app.ts` | 리미터 1줄(리미터 블록 안) | 소스 불변식 |
| `AdminDashboard.tsx` | 뱃지 state·조회 | 화면 육안 |
| `constants/audit-action-labels.ts` | 라벨 11종 | 파일 규약 |

---

## 9. 화면 변경 총괄 (`SalesOutreachModal.tsx`)

| 단계 | 변경 |
|---|---|
| ① 입력 | 409 DUPLICATE 처리([기존 건 열기]·[그래도 새로 만들기]) |
| ③ 확인 | 재료 전문 접기 패널 · 구 데이터 표기 · unavailable 배너에 주소 입력 + [다시 읽기] · `crawling_detail` 표시 · manual 종료 표현 경고(warnings) · 인물 판정 문구 사실화 |
| ④ 검토 | 제목 편집 · placeholder amber/emerald 2줄(서버 숫자) · 폭 토글 600/375 · 탭별 [다시 만들기](4종) · [메일 재조립] · 발송 버튼 잠금 + 사유 + 바로가기 · 실패 배너 `fail_detail` + 제작 단계 3값 표시 · [숨기기](failed) · 근거 패널 계측·pruned·템플릿·재생성 순번·`mail_last` 부분 거부 · 대기 순번 |
| 목록 | 검색·상태 칩·[더 보기](id upsert) · "대기 n/N" · 숨긴 건 회색 |
| 공통 | 폴링 직렬화 · toast · 반응형 분기 |

디자인 하한 점검: 부모(AdminDashboard)가 라이트라 이 모달은 라이트 유지 + 미리보기 다크 액자(FEATURE §5 뒤집힌 판단 그대로) · ConfirmModal·useToast(native 0) · 모델명 0 · 1클릭(재생성·재조립·다시 읽기·숨기기 전부 버튼 1회 · 확인 모달은 DM·이미지 재생성에만).

---

## 10. 영향표 총괄 (파일별)

| 파일 | 변경 항목 | 소비처 영향 |
|---|---|---|
| `sales-outreach-jobs.ts` | A-1 · A-3(2) · A-7 · A-8(호출부) · A-9 · A-10 · A-11 · A-13 · B-1 · B-3 · B-4 · B-5 · B-6 · B-7 · B-8 · B-9 · B-11 · B-13 · C-5 · D-1 export | 라우트 1파일 · 프론트 1파일(응답 키 추가 · 기존 키 유지) |
| `sales-outreach-produce.ts` | A-1 · A-2(분할) · A-3(3,4,5) · A-4 · A-5 · A-6 · A-8 · C-1 · C-7 · D-1 export | jobs 1파일 |
| `sales-outreach-style.ts` | A-2 `emailCopy` | produce 1파일 |
| `sales-outreach-extract.ts` | A-12 · A-13(`buildOutreachEventMaterial`) | jobs 1파일 · 기존 테스트 7건 유지 |
| `sales-outreach-sweeper.ts` | B-4(markFailed 호출) · B-5 · C-3 | 부팅 등재 무변경 |
| `sales-outreach-bulk.ts` | B-5(chain) · B-6 · C-6 | 라우트 1파일 |
| `outreach-mailer.ts` | B-11 · C-1 | jobs 1파일 |
| `routes/sales-outreach.ts` | 8-3 표 · B-12 · C-6 | 프론트 |
| `SalesOutreachModal.tsx` · `AdminDashboard.tsx` · `audit-action-labels.ts` | §9 · B-12 | 없음 |
| 공용 4파일 | 8-5 표 | 표의 회귀 고정 |
| 테스트 | D-1 · D-2 신규 `sales-outreach-behavior.test.ts` + 기존 3파일 보강 | 패키지 전체 실행 |

---

## 11. 계약 테스트 총괄

신규 행동 테스트 약 45건(D-1) + 불변식 보강 9건(D-2) + 공용 회귀 4건(8-5). 회귀 주입 검증(각 묶음 착수 전 1회): 발송 선점 SQL의 `mail_sent_at IS NULL` 제거 → SQL 계약(정확히 1회) 실패 · A-4 매핑 표에서 키 1개 삭제 → tsc 실패 + 카탈로그에서 event 템플릿 1종 임시 제거 후 `pickTemplate` throw 확인 · 공개 뷰어 헤더 조건 제거 → 헤더 단위 테스트 실패 · `resetJobTo` 밖에 `stage_results -` 1줄 삽입 → 불변식 실패.

---

## 12. 착수 순서 · 배포 묶음 (묶음 = 배포 단위 · 각각 되돌릴 수 있다)

| 묶음 | 항목 | DDL | Codex | 되돌리기 |
|---|---|---|---|---|
| **1 품질 코어 + noindex** | A-1 · A-2 · A-4 · A-5 · A-6 · A-7 · A-8 · A-10 · A-12 · A-13 · **C-2** · D-1(해당분) | 0 | 면제(금액을 움직이는 쓰기 경로·DDL 0 · CLAUDE.md 범위 규정) | revert |
| **2 브랜드·1홉** | A-3 · A-9 · A-11(결재 시) | 0 | 면제(동일 근거) | revert |
| **3 운영 조작** | B-1 ~ B-10 · B-13 · B-14 · C-5 · C-6 · D-1(해당분) | **1(선행 ALTER)** | `/codex:review`(DDL은 면제 조항 해당(발송·돈 무관 로그성 nullable) · B-3의 `stopDm` 최초 도입 = 외부 효과라 review) | revert · 컬럼은 남겨도 무해 |
| **4 발송·안전** | B-11 · B-12 · C-1 · C-3 · C-4 · C-7 | 0 | `/codex:review`(발송 경로 · stopDm 파기 경로) | revert |
| **5 검증·문서** | D-2 · D-3 · D-4 · D-5 · C-8 | 0 | 면제 | 문서 |

`/codex:adversarial-review` 대상은 없다(DB 마이그레이션은 nullable 로그성 면제 조항 · 돈·환불·balance 경로 0).
각 묶음 공통 게이트: tsc 0(양쪽) · vitest 패키지 전체 · 회귀 주입 1회 · 자가 grep(모델명·native dialog·줄표) · `bash scripts/harness-check.sh`(status 문서 건드린 묶음) · `build:safe` 뒤 §13 실측.
**순서 = 1 → 3 → 4 → 2 → 5**(품질이 먼저 보이고, 운영 조작이 붙어야 실측이 편해지며, 발송 보강은 Codex 라운드가 있어 뒤에 둔다). 묶음 안 순서 = A-2 분할(조립 함수) → A-1·A-7(재료·프롬프트) → 나머지(다른 항목이 분할된 함수에 얹힌다).

---

## 13. 실측 시나리오 (배포 뒤 · 묶음마다 1건)

- **묶음 0(선행 · F18 확인)**: 운영 pm2 로그에서 크롤 예외·unavailable 빈도 확인 → `grep -a "sales-outreach\] 크롤 예외\|\[DM\] URL" ~/.pm2/logs/targetup-backend-out*.log | tail -20` · DM 편집기에서 아무 공식몰 URL "불러오기" 1회 → 결과가 비면 F18이 운영에서도 참.

- **묶음 1**: 업체 1곳 등록(실재 공식몰) → 확정 → ready. 확인: (a) 메일 서두가 홈페이지 내용을 언급 (b) 히어로 분할 구도 · 포스터 절단 0 · 헤드라인 글자 판독(지메일 모바일·아웃룩 데스크탑 · 이미지 셀 실측 폭) (c) 근거 패널의 `templateId/category`가 업종 매핑과 일치 (d) 미면허 건의 DM에 혜택 수치 0 · 면허 건은 인용 수치 유지 · `benefitStripped` 표시 (e) 푸터 날짜 = KST 오늘 (f) `curl -I` 발행 DM URL에 `X-Robots-Tag`(기존 발행분 포함) (g) 근거 패널 계측 문장.
- **묶음 3**: [이미지 다시 만들기] → 새 메일 조립 뒤 옛 DM 링크 "종료" · 근거 패널 "2번째 재생성" · 다른 템플릿 / [메일 재조립] 뒤 제목·서두 불변 / 제목 편집 뒤 문안 저장 → 제목 유지 / 발송 버튼 잠금 사유 표시(UNSUB 미설정 환경) / 같은 업체 재등록 → 409 → [기존 건 열기] / 잘못된 주소 등록 → unavailable + `crawling_detail` → 주소 수정 [다시 읽기] / 이미지 서비스 off → `fail_detail` + 4단계 배너 'unavailable' / failed 건 [숨기기] → 뱃지 감소.
- **묶음 4**: 발송 1건(수신함 2명) → `mail_last` 기록 · `audit_logs` 행 1(FK 확인 뒤) · 공개 샘플 URL 61회 연타 → 429 HTML · SMTP 포트를 응답 없는 값으로 오설정 → 30초 race 상한 → unknown 즉시(타임아웃 3종 검증). 선점 원복 경로(DB 예외)는 실측 불가 → 단위·SQL 계약 테스트로 닫는다. 파기 stopDm은 운영 DB를 손대지 않고는 당일 실측 불가 → 단위 테스트 + 다음 자연 만료 건에서 확인.
- **묶음 2**: theme-color가 있는 사이트 1곳 → 메일 버튼색·DM 강조색 반영 · `#fff` 사이트 → 기본색 유지 · (A-11) 행사 상세 링크가 있는 사이트 → `crawling_sub = ok` + 후보 `sourceUrl`이 상세 페이지.

---

## 14. Harold 결재 항목

1. A-4 매핑 표 15종(시장 판단 · 표 그대로 착수 가능 여부).
2. A-11 행사 상세 1홉 허용(불변 18 개정 · 같은 호스트 한정 · 앞에 싣고 총량 6000). 추천 = 허용.
3. A-5 히어로 = 분할 구도 + contain(추천 · 비용 0) vs 16:9 2차 생성(+1 호출/건).
4. B-6 중복 정책 = 409 + [기존 건 열기]·[그래도 새로](추천) vs 완전 차단. 키 = 호스트 + 첫 경로 세그먼트.
5. C-3 파기 시 DM 중지(stopDm) 허용. 추천 = 허용.
6. B-5 대기(queued) 초과 임계 2시간.
7. 업체 직송 계획 여부(있으면 광고 표기·수신거부 헤더·footer가 다음 축의 선행 조건).
8. `OUTREACH_UNSUB_NOTICE` 확정 문구(발송 개통 조건 · 이번 축 코드와 무관).
9. 미면허 인용의 메일 "홈페이지에서 본 내용" 블록 유지(추천 = 유지).
10. B-3 재생성 상한 잡당 kind별 5회(요청 기준).
11. A-8 DM 혜택 차단 방식 = 긴 prop 문장 제거 · 짧은 prop 비움(추천) vs 재생성 1회 후 미발행.
12. B-4 `fail_detail` ALTER를 **코드 배포보다 먼저** 실행(nullable 로그성 · 구코드 무해).
13. 코드로 확인 불가 항목: 운영 ENV 11키 실재 · DDL 적용 · `PUBLIC_BASE_URL` 값 · hlj.kr rewrite · SPF/DKIM/DMARC · 운영 PG 버전 · `audit_logs` FK.
14. A-1로 미면허 잡의 placeholder 발생률이 오를 수 있음(재료 사전 제거로 완화 · 잔존분은 사람이 문안을 고쳐야 발송). 수용 여부.
15. A-6 제목 40자 초과 = 기본 제목 대체(추천 · 절단 금지) vs 40자 절단.
16. B-13 실패 건 [숨기기](jsonb `dismissed_at` · 삭제 아님) 신설.
17. B-15 검수 테스트 발송의 허용 도메인 기본값(`invitocorp.com`) · 추가 도메인 여부.
18. **F18 크롤 결함 즉시 확인**: 운영에서 아웃리치 크롤·DM 편집기 URL 불러오기가 실제로 실패하는지(§13-0 검증 명령). 사실이면 이 축과 별개로 **1줄 수정을 먼저 배포**한다(`dm-brand-extractor.ts:386` lookup 콜백을 `opts.all ? cb(null, [{address, family}]) : cb(null, address, family)` 형태로 · 계약 테스트 1건 동반).

v4에서 결재로 올렸다가 v4.1이 코드 근거로 **결정한 것**(재결재 불필요 · 이의 있으면 §14에 추가): 사람이 고친 제목·서두는 재조립·문안 저장이 지우지 않는다(B-2·B-9) · 재크롤·재시도로 DM이 다시 발행돼도 옛 DM은 새 메일 조립 뒤 중지된다(B-3 일반화) · 1홉이 다른 호스트로 리다이렉트되면 버린다(A-11) · 이미지 락 교체는 하지 않는다(C-7) · SMTP 호스트·포트 공유 사실을 ENV 문서에 명시한다(C-8).

---

## 15. Codex 검증 범위

- 묶음 3 = `/codex:review`: `resetJobTo` · `regenerateOutreachAsset` · `runProduction` 다음 단계 결정 + 옛 DM 중지 분기 · `markFailed` 단일화(sweeper 포함) · `editOutreachSubject` 낙관 잠금 · `computeSendLock` 배선.
- 묶음 4 = `/codex:review`: `outreach-mailer.ts` 전량 · `sendOutreachMailForJob`(선점 밖 try 구조) · `sweepExpired`(ctx 판정 · stopDm 롤백) · `app.ts` 리미터.
- 종료 조건 = critical·high 0 · 라운드 최대 2. 묶음 1·2·5 = 면제(금액·DDL 경로 0 · 공용 파일 변경은 회귀 테스트가 대신한다).

---

## 16. 별건 기록 (이 축에서 착수하지 않는다)

| 항목 | 한 줄 |
|---|---|
| `billing-recipients.isRecipientRejected` includes 대조 | 포함 관계 주소에서 판정 뒤집힘 · 정산 발송 3곳 소비 |
| SSRF 판정기 3벌 통합 · `extractBrandFromUrl` 가드화 | [B-0824-2]·[B-0824-3] |
| 아웃리치 문안 채점 규칙(품질 루프·스팸 게이트 전제) | 공용 규칙은 문자 광고용(CTA 강제·스팸 어휘)이라 B2B 제안에 부적합 |
| rembg 전역 락(Node 측) | 직렬화는 python 단일 워커가 담당 · 고객 `/remove-bg`도 락 없음 |
| `fetchHtmlGuarded` 호스트 고정 옵션(리다이렉트 이탈 차단) | 이 축은 호출부에서 `finalUrl` 호스트 대조로 막는다 |
| 공용 `extractEmailText`의 cta·footer 확장 | 이 축은 전용 평문 조립 |
| DM 편집기에서 아웃리치 DM 열기 · 인라인 미리보기 | 계정 소속·교차 origin 미검증 |
| 이미지 후보 사전 인물 판정 | 비용 12배 |
| 스타일 가이드 DB·편집 UI | 승격 조건 미충족 |
| 이미지 생성 크레딧 source(무과금 집계) | `ai-credit-calc.ts` CREDIT_COST_MAP 확장 = 공용 |
| `OUTREACH_COMPANY_ID`의 공용 AI 레이트리밋·캐시 공유 | 내부 회사 계정 운용 방침 뒤 |
| `dm-section-prune` 소비처 확장(플래너·원스텝) | 공용 오염 정리 |
| 공개 페이지 자기 참조 CTA | 문구만 A-2로 · 버튼 제거는 조립 함수 2벌 금지(불변 16)와 충돌 |
| DM 발행물 자체의 만료(뷰어 나이 판정) | 이 축은 파기 시 stopDm으로 닫는다 |
| 광고 메일 위생 3종 | §2-2 |

---

## 17. 검증 상태 선언

- **코드로 확인한 것**: §1 전부(파일:라인 · 검토 표본 6건 재대조 일치) · CT 서명(`buildPosterPrompt` · `renderEmailSections`/`EmailDesign.palette` · `renderHero` split 분기 · `stopDm` 반환·block 값 · `companyTempUsageBytes` · `recordAuditLog` · `kstDateTag` · `isBrandKitPrimaryAccessible`(6자리 전용) · `CHANNEL_PRESETS.email-hero` · `extractEditableFields.keysByType` · `getDmByCode`(published만) · `isOutreachMigrationPending`(메시지 정규식) · `query`(pool 직결 · 42703 노출) · jsonb `-` 연쇄 유효 · `parseBrandKit` 통과형 · sweeper → produce import 기존).
- **미검증(실측으로 닫는다)**: A-5 클라이언트별 분할 구도·`object-fit` · A-3(5) 포스터 색 힌트 · 포스터의 한글 업체명 렌더 신뢰도 · A-1 placeholder 발생률 변화 · B-5 2시간 임계 · C-3 stopDm 뒤 뷰어 문구 · 운영 ENV·DDL·PG 버전·`audit_logs` FK(§14 #13) · 운영 nginx의 404 처리(`proxy_intercept_errors`).
- **테스트가 못 잡는 것**: DB CAS 자체(하네스 제약 · SQL 문자열 계약으로 대체) · SMTP 실제 거동(실측 1건).

---

## 18. 검토 이력 (v4 → v4.1)

- 방법 = 6축 검토(A 품질 · A 이미지 · B 운영 · B 발송·API·화면 · C·D · 총괄) 37 에이전트 · 지적 105건(high 14 · medium 52 · low 39) · 반박 재검증 30건 · 누락 비평(미검토 11 · 모순 8 · 단순화 6 · 질문 8).
- **뒤집힌 지적 3건**: A-7 "빈 문안이 ready에 도달"(producing_email이 차단 · 진짜 결함은 엉뚱한 단계 기록 → A-7 throw 1줄) · B-1 "computeSendLock 서명 부족"(stage 판정은 설계가 대상으로 삼지 않았다 → 불변 3 문구만 좁힘) · C-2 "파기 직후 색인 가능"(404로 나간다 · 진짜 결함은 소급 부재 → 라우트 헤더 1줄로 소급).
- **구조로 접은 것 6개**: placeholder 원천(`countBenefitPlaceholders` → A-1·A-6·A-8·B-1·B-14 통일) · 조립 함수 분할(`buildProposalEmailSections`/`generateSubjectIntro` → A-2 계약이 자동 성립 · A-7 선행 관계 소멸) · 되돌리기 단일 함수(`resetJobTo` → B-3 regen 키 누락·B-7 삭제 목록·retry lock_at이 한 자리) · 실패 종결 단일 함수(`markFailed` → sweeper 포함 · 불변 10·21이 한 함수에서 성립) · noindex 라우트 1줄(공용 타입·뷰어 0 · 소급 O) · 재료 예산 단일 소유(`materialText` → A-11 재료가 문안·메일에 도달).
- **삭제한 항목**: A-7 품질 루프·스팸 게이트(부적합·무동작) · C-7 락 교체(동치·부작용) · A-3 큰 리팩터(6줄 함수로 축소) · `kstDateIso` 공용 추가(소비처 1곳 표기) · B-14 DM 인라인.
- **v4 착수 전 고쳐야 했던 high 14건 전부 반영**: A-5 흰 글씨 · A-3 3자리 hex · A-2 리터럴 3종 · A-1 잠금 영향 · A-8 prop 4개 부재·licensedQuote 인자·ALWAYS_KEEP · A-11 재료 도달 · B-3 regen 삭제·SELECT·중지 시점 · B-4 42703 창·sweeper · B-6 details 통로 · B-11 선점 밖 try·text 경로 · B-2 내부 효과 · C-5 명시 컬럼 · C-2 소급 · C-7 · D-2 err 규칙.

## 19. 구현 이력 (v4.1 → 코드 · 2026-09-05)

- **프로토타입으로 먼저 증명**(Harold "샘플을 학습해서 제대로 만들 수 있냐가 핵심"): `scratch/proto`(폐기 전제) · 직원 실물 DM 10·이메일 9 마스킹 few-shot + 재료(상품 상세 1홉 · 이미지 실측·격상 · 딥링크 · 법정 표기) + 후처리(묶음별 재료 커서 · 혜택 차단 · placeholder 문장 제거) · 3업체(이니스프리·29CM·커버낫) 2회전 심사. 1회전 결함(갤러리·상품 중복 · 법정 표기 누락 · CTA 홈 · 상품명 잡음 · 조건 결합)을 규칙·후처리로 닫고 2회전 산출물을 Harold가 검수 → 운영 이식 착수.
- **묶음 1·3·4·2·5 전량 한 번에 구현**(Harold "전체 다 완벽하게 진행"). 설계 대비 달라진 것: ① DM 생성은 공용 `oneShotGenerate` 대신 **아웃리치 전용 few-shot 생성**(`produceOutreachDm` · 참조 골격은 구성 힌트로만) ② 제안 메일 안에 **브랜드 이메일 시안 블록**이 쇼케이스로 실린다(`produceOutreachBrandEmail` · 공개 페이지 = 발송본 그대로 · 불변 16 유지) ③ A-10b 재료 사본은 `brand_profile.media`에 두고(assets kind CHECK 4값 유지 · DDL 0) 제작 image 단계가 수집한다(실패는 격리) ④ 추가 정보(`extraNotes`)는 등록 폼에서 받아 재크롤에도 보존 ⑤ 불변 25(샘플 학습 층) 신설.
- **미착수·별건**: A-3(5) 포스터 색 힌트는 넣었으되 미검증 · B-10 반응형은 `md:` 분기만 · DB 서빙 예시(best_copy_assets kind='style_example')는 후속 · §16 별건 전부 그대로.
- **검증**: 백엔드 tsc 0 · 프론트 tsc 0 · vitest 신규 8파일(재료 CT · seed 위생 · 제작 순수 · 잡 순수 · 발신 판정 · 추출 중복 제거 · lookup 계약 · 불변식 13) · 자가 grep(모델명·native dialog·줄표 0). 실측·Codex = STATUS 잔여.

## 20. 실물 예시 DB 학습 (B안 · 2026-09-05(2) · Harold 접수 "애들이 만든 29건 + 이메일을 쿼리로 넣어 학습 추가")

- **접수 대조**: 신규업체 10건 = 어제 seed 10건과 9건이 같은 DM(단축코드 일치) · 새 것은 탑텐 1건(0903 "미완성 2섹션" 제외분 · 지금 10섹션). 기존 인비토 업체 19건 = 전부 새 것 · **전부 내부 전용 회사(c7c97996…) 발행 코드**(수신자 토큰 아님 · Harold SQL 실측). 이메일 = 같은 회사 60일 13건(seed 9 + 탑텐·아디제로 협업·마리오아울렛 푸드·신규 환영). DM↔이메일 참조 컬럼은 없다(회사·작성자·이름뿐) → 사람이 후보에서 고른다.
- **후보**: A 정적 seed 재생성(서버 SQL 덤프 → 파일 전달 → seed → 배포 · 매번 반복) / **B 화면에서 단축코드 붙여넣기 → DB 학습(채택)**.
- **구조(B)**: ① 마스킹 CT `sales-outreach-exemplar-mask.ts`(순수) — 별칭 자동 추출(제목·상호·header brand_name·법정 표기 법인명·회사명 · 직원 표기 "(임은지2)" 제외) · **상품명을 본문 어디서든 치환**(seed 실측 누수 "붉은팥·PDRN·모공탄력" 정정 · 일반어는 유지) · 링크→이메일→연락처→고객명→상품→별칭→혜택→날짜 순 · 위생 검사(잔존 = 거부). ② DB 층 `sales-outreach-examples.ts` — 코드 정규화(URL·`dm-` 접두 제거 · 대소문자 보존) · 해석(`dm_pages.short_code` + `dm_recipient_tokens.short_code` · 회사 고정) · 이메일 후보(120일 · 브랜드명 제안 매칭) · 승격(게이트 = 회사·미완성 3섹션·파이프라인 접두·중복 출처·위생 → `best_copy_assets` append) · 생성 원천 로드(DB 5분 캐시 앞 + seed 뒤 · 같은 본문 1번). ③ `best-copy-assets.ts` — kind **`outreach_example`**(style_example과 분리: 갤러리 노출·재증류 DELETE 회피 · CHECK 없음 = DDL 0) 읽기·append·삭제·캐시. ④ 라우트 `/api/admin/best-layout/examples`(목록·resolve·promote·삭제 · ceo 게이트 상속 · 감사 로그 2종). ⑤ 화면 = 베스트 구성 페이지 패널 + 모달(서버 마스킹본만 표시 · 페이지 계약 개정). ⑥ 생성 = `produceOutreachDm`·`produceOutreachBrandEmail`이 async에서 원천을 읽어 순수 빌더에 주입(빌더 서명 = 선택 인자 1개).
- **seed**: 같은 마스커로 재생성(폴백 품질 동일). 재생성 스크립트 = `scratch/proto/rebuild-seed.ts`(폐기 전제).
- **테스트**: 마스커 픽스처(별칭·상품 토큰·표식·형식·위생) · 예시 CT 순수(코드 정규화·목록 파싱·제안 매칭·원천 변환·병합) · 불변식(kind 분리 · 갤러리 경로 무변경 · 마스커 DB 0 · 쓰기는 소유 CT만 · 게이트 순서).
- **적대 리뷰(5축 53에이전트 · 2렌즈 재검증)로 확정된 13건을 뿌리 4개로 정정**: ① 마스킹이 "차단 목록 + 같은 정규식으로 검사"라 fail-open(8건: footer.notes 법정 표기 · 구분자 없는 전화·유니코드 이메일·무스킴 도메인 · caption 상품명 · 붙여쓴 상품명 · 표식 안쪽 재치환 · 날짜 표기 · 일반 명사 별칭) → 법정 영역 통째 제외 · name+caption 전량 〔상품〕 + 띄어쓰기 무시 치환 · 표식 보호(중첩 id) · 경계 규칙 · **위생 검사는 마스킹과 다른 더 넓은 탐지기**(7자리 숫자열·@·도메인 꼬리·신고번호·주소·대표자·변수·모델명) ② 근거 건수 = 원천 전량이 아니라 **실린 수**(`exemplars.picked` · `exemplarTotal` 별도) ③ 삭제 실패를 404로 접던 것 → 3값(not_found·table_missing·db_error) ④ 화면 toast 의존 재요청 루프 → ref 고정 · 같은 DM 코드 중복은 서버가 1행으로 합침 · 삭제 무장 5초 자동 해제. 부수 = 실물 예시 라우트 회사 ENV 고정(요청 companyId 무시) · 중복 판정 실패 시 저장 안 함(fail-closed) · meta.source.id = 행 id 소문자.
- **미검증**: 운영에서 29건 코드 붙여넣기 실측(제외 사유 0인지 · 별칭 자동 추출이 각 브랜드에서 충분한지 = 마스킹본 육안) · 예시 40건 이상일 때 프롬프트 예산 9000자 안에서 어떤 5건이 뽑히는지(같은 업종군 우선 · 최신 DB 우선).
