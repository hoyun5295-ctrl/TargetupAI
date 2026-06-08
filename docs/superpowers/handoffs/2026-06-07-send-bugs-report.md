# 발송 버그 3건 — 진행 상태 + 다음 세션 (2026-06-07 갱신)

> **2026-06-08 전부 배포완료** (버그1 강조 title 4경로 CT + 여정 senderkey 포함). 버그1·2·3 모두 종결.
> 검증 현황: backend tsc OK · frontend tsc OK · TDD(alimtalk-button 9, sms-channel-split 13).
> 진입 시 `status/lessons/LESSONS_BACKEND.md`(발송 5경로) + `Alimtalk/`(IMC API 명세) 정독. 추측 금지(raw/SQL/명세 확인 후 작성).

## 현 상태
- **버그2 (발송일 검색)** — 완료.
- **버그3 (대체발송 SMS/LMS)** — 완료.
- **버그1 (알림톡 버튼/강조)** — 완료. 강조 title 4경로 공통 CT 통일 + 채널추가형 buttons=0 = 버그 아님(확정). 미배포.

---

## 버그2 — 완료
- 검색 `COALESCE(sent_at, scheduled_at)`(created_at fallback 제거): `admin.ts` 797·802·1656·1661, `results.ts` 118·248·393.
- 표시: `AdminDashboard.tsx` 4078(`last_sent_at || sent_at || scheduled_at`), `results.ts` 466(`sent_at || scheduled_at`).
- sent_at은 `campaign-lifecycle.ts:321` 완료 시 `COALESCE(scheduled_at, NOW())`로 채워짐(즉시발송도).

## 버그3 — 완료
- `sms-result-map.ts`: `SmsChannel`에 `substitute_lms`/`substitute_sms`, `classifyMsgChannel`(S/L + k_oriseq>0 세분화), `tallySmsChannelCounts`, `getSendTypeLabel`("(LMS)"/"(SMS)").
- `admin.ts` 3312~3321 export: split.substitute_lms/sms → "알림톡대체발송(LMS)"/"(SMS)" 2행.
- `results.ts` 728·850·962: 대체 필터 `k_oriseq>0 AND msg_type IN ('L','S')`.
- TDD `sms-channel-split.verify.ts` 13.

## 버그1 — 부분 완료
### 완료
- **신규 CT `utils/alimtalk-button.ts`** `convertButtonsToQTmsg`: IMC 형식(name/linkType/linkMo/linkPc) + 프론트 형식(buttonName/buttonType/buttonUrlMobile/buttonUrlPc) 둘 다. TYPE_MAP(WL2/AL3/BK4/MD5/AC6/DS1). TDD `alimtalk-button.verify.ts` 9.
- **버튼 5경로** 검수 템플릿 buttons → k_button_json:
  - 직접발송 `campaigns.ts:1932` gateCheck SELECT `t.buttons`(+`t.emphasize_title`) → 2023 `convertButtonsToQTmsg(gate.tbuttons) || alimtalkButtonJson`.
  - staging commit `campaigns.ts:1351` gate SELECT `t.buttons,t.emphasize_title` → `alimtalkButtonJsonResolved` → `createDirectSendCampaign`(1386) → `direct-send-processor.ts:220` 자동.
  - 여정 `journey-executor.ts:696` 인라인 `convertButtonsToQTmsgInline` 제거 → CT 통일.
  - 자동 `auto-campaign-worker.ts:905` gate `t.buttons` + 924 alimRows `buttonJson`.
- **직접발송 강조 title 변수 치환**: `campaigns.ts` etcObj→`etcBase`(senderkey 공통) + alimtalkRows에서 row별 `rowEtc.title = replaceVariables(emphasize_title …) + 변수맵` → `rowEtcJson`. (강조 title `#{변수}` raw 발송 시 카카오 반려 차단.)
- frontend `AlimtalkChannelPanel.tsx` `convertButtonsToQTmsg`도 IMC 필드 보강(linkType/linkMo/linkPc).

### SQL 결과 (psy5868 = 인비토, 2026-06-07)
template_code · emphasize_type · btn_cnt:
- 79773 주문처리 NONE 1 / 79704 NONE 1 / 79955 NONE 1 / 79703 NONE 1 / 80286 NONE 1 / Tmowlq 테스트1 IMAGE 1 / Tmp0lbd 05110102 TEXT 1
- **79738 승인안내 TEXT 0** (강조표기·버튼없음 → 원인은 etcJson title, 완료)
- 문의접수 0 / 79965 교환안내 0 / **80149 채널추가형승인안내 NONE 0** / sdfsdf 0 / 26050816 0
- → **buttons 다수 존재(btn_cnt 1) = 버튼 발송 코드 작동**. B_IV 79738은 강조표기형이라 etcJson title이 원인이었음(완료).

### 완료 (2026-06-07 이어서 — 미배포)
1. **강조 title 공통 CT `utils/alimtalk-emphasize.ts` `buildAlimtalkEtcJson({senderKey, emphasizeTitle, substitute})`** — `{senderkey, title}`, title은 본문과 동일하게 #{변수} 치환(치환 함수 주입형, 경로별 replaceVariables/replaceAlimtalkVars 다름). 순수·DB import 0. TDD `alimtalk-emphasize.verify.ts` 7.
2. **4경로 적용 + 인라인 제거**: 직접(`campaigns.ts:2018`) · staging(commit `campaigns.ts:1361`이 senderkey+raw title carrier → `direct-send-processor.ts:190/232`가 row별 재치환) · 여정(`journey-executor.ts:712`, SELECT에 `emphasize_title` 추가) · 자동(`auto-campaign-worker.ts:966`). 옛 인라인 etcObjCommit/etcBase/autoEtcObj/rowEtc 전부 CT로 통일(잔존 0). `insertAlimtalkQueue` 호출 4곳 전수 확인.
3. **채널추가형 80149 btn_cnt 0 = 버그 아님(확정)**: SQL — 79773 `message_type=AD`(채널 추가형: 카카오가 "채널 추가하고…받기"를 자동 고정, buttonList 미포함 — POST 등록 매뉴얼) / 80149 `message_type=BA`(기본형, 이름만 채널추가형). `ButtonEditor`도 BA/EX에선 AC 미노출(`:47`), AD면 AC 자동 고정(`forceChannelAdd`). buttons 저장 형식 = 프론트 `{name,type,urlMobile,urlPc}` 그대로(`alimtalk.ts:775` body.buttonList), CT가 전부 읽음(URL 보존). 동기 저장 fix 불필요(buttons는 IMC GET이 아니라 등록/수정 body.buttonList로만 저장 — `alimtalk.ts:1008` 주석). 80149를 채널추가형으로 쓰려면 등록 메시지타입을 AD로(코드 아님·운영).
4. backend+frontend tsc 0 · TDD emphasize7/button9/channel-split13.

### 여정 senderkey 통일 + 알림톡 선택형 (2026-06-08)
- **senderkey 통일 완료**: `journey-executor.ts` 템플릿 SELECT에 `LEFT JOIN kakao_sender_profiles p ON p.id=t.profile_id`로 `p.profile_key` 추가(campaigns:1353·auto:906 검증 JOIN) → CT `senderKey` 전달. 직접/staging/여정/자동 4경로 모두 `{senderkey, title}` 동일. backend tsc 0 · emphasize test 7. LEFT JOIN이라 프로필 없으면 senderkey만 생략(무회귀).
- **알림톡 선택형 유지(Harold 선택 2026-06-08)**: 완전 자율(AI가 알림톡 문구 생성·자율발송) = 카카오 승인 템플릿 제약상 불가. 현재 이미 완비 — JourneysPage `channel='kakao'` + `AlimtalkChannelPanel`(승인 템플릿 선택 + 변수 매핑) + "AI 자동 매칭" 보조(승인 범위 내 추천) + 발신프로필/템플릿 승인 검증. 신규 코드 0.
- **배포**: backend + frontend. 배포 전 JOIN 컬럼 확인(information_schema, kakao_sender_profiles/kakao_templates) 1회.

---

## 변경 파일 (working tree, 미배포)
- backend: `utils/alimtalk-button.ts`(신규) + `__tests__/alimtalk-button.verify.ts`(신규) · `utils/alimtalk-emphasize.ts`(신규) + `__tests__/alimtalk-emphasize.verify.ts`(신규) · `utils/sms-result-map.ts` · `utils/__tests__/sms-channel-split.verify.ts` · `utils/predictive-suite.ts`(자율예측 별건) · `utils/journey-executor.ts` · `utils/auto-campaign-worker.ts` · `utils/direct-send-processor.ts` · `routes/campaigns.ts` · `routes/results.ts` · `routes/admin.ts`
- frontend: `pages/AdminDashboard.tsx` · `components/alimtalk/AlimtalkChannelPanel.tsx` · `pages/PredictiveDashboardPage.tsx`(자율예측 별건)
- ※ 자율예측(6종·VIP numeric·재계산·worker조건)도 미배포 — 별건. `memory/project_2026_0607_predictive_redesign_brainstorm.md`.

## 다음 세션 진입 명령어
```
발송 버그 이어서. docs/superpowers/handoffs/2026-06-07-send-bugs-report.md 정독 + status/lessons/LESSONS_BACKEND.md(발송 5경로) + Alimtalk/ IMC 명세 정독.
1. SQL: SELECT template_code, buttons FROM kakao_templates WHERE template_code IN ('B_IV_013_02_79773','B_XX_018_02_80149'); → buttons 실제 형식 + 채널추가형 btn_cnt 0 원인.
2. 강조 title 변수 치환 공통 CT(renderEmphasizeTitle)로 빼서 4경로(직접/staging-processor/여정/자동) 통일.
3. 채널추가형 buttons 누락이면 등록/IMC 동기(kakao-template-sync) 저장 fix.
4. 전체 tsc + TDD + 배포(backend+frontend). 추측 금지(raw/SQL/명세 확인 후).
```
