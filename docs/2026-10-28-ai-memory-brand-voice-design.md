# AI 메모리 · 브랜드 보이스 · 목소리 복제 설계서 (2026-10-28)

> 호출어 **"AI 메모리 설계 / 브랜드 보이스 설계 / 목소리 복제"**. 이 문서가 불변 원칙 · 결정(K1~K15) · DDL · 데이터 · 영향표 · 묶음 순서 · 시험 · 리허설 · 진행표를 소유한다.
> 출발 = 구조체크 원장 [2026-10-28-ai-memory-brand-voice-structure-check.md](2026-10-28-ai-memory-brand-voice-structure-check.md)(결함 V1~V26 · 덮음표 · 실측 S1~S3 · 회의 §8 · 최종 검증 F1~F17) · 뿌리 = [ROOT-LEDGER.md](ROOT-LEDGER.md).
> 닫는 순서(Harold 1028) = 설계서 → Codex 적대 리뷰 approve → 설계서 구조체크 결함 0 → **구현까지 끝냄** → 구현 Codex 리뷰 approve(「설계서 구조체크 닫히고 나면 아예 구현까지 끝내고 구현된 내용도 코덱스리뷰 닫힐 때까지」). 커밋 · 배포 · DDL · DML 실행 = Harold.
> 상태 = **설계 닫힘(1028 · Codex 적대 12R approve · 구조체크 5회차 결함 0)** · 구현 진행(Harold 1028 「구조체크 닫히고 나면 아예 구현까지 끝내고」).

## §0 원래 안건 · 범위 · Harold 결정

- **원래 안건(첫 줄 고정)**: 고객사가 넣은 문안을 성격 · 종류(행사 · 기능 설명 · 신제품 …)로 나눠 받아들이고, 말투 · 줄띄움 · 간격 · 특수문자까지 그 회사 목소리를 복제해, 담당자가 행사 · 제품만 넣어도 여정 · 자동마케팅을 포함한 모든 자동 생성이 원래 보내던 말투로 나온다. 쓸수록 습관을 배워 조언한다. 회사마다 격리된다. + 디벨롭.
- **Harold 결정(1028)**: ① 학습은 유료 = 버튼 하나 [저장하고 배우기 · 6크레딧](추출 1 + 견본 생성 5 · 지금 단가표 합) ② 권한 = 담당자도 올리기 · 고치기 · 배우기 · 초기화 · 삭제는 관리자 ③ 설계서가 닫히면 구현까지 끝낸다.
- **범위** = 원장 V1~V26 · F1~F17 전부(V13 = 원장 §2-4 결함 아님으로 옮김 · 이 설계 대상 아님). 대상 = 목소리 CT · 문자 생성(`services/ai.ts`) · AI 메모리 라우트 · 학습 원장 · 고객 글 생산자 43(원장 §3) · AI 메모리 화면 · AI 한줄로 확인 판.
- **범위 밖** = §10.

## §1 불변 원칙

| # | 불변 | 닫는 결함 |
|---|---|---|
| I1 | 우선순위 = **법 > 발송 > 그 자리에서 사람이 고른 것 > 배운 목소리 > 스타일 기본값.** 법(광고 표기 · 080 · 전송자 명칭 · 바이트 · 글자표 · 없는 혜택 · 없는 날짜 · 효능 단정)은 출구 코드가 지킨다. 발송(여정 상시 발송 원칙 · 스팸 낱말 · 채널 길이 한도)은 목소리 증거로 끄지 않는다 | V1 · V2 · V16 · V17 · F3 · F4 |
| I2 | 회사 목소리 재료는 목소리 CT(`utils/brand-voice-prompt.ts`) 한 곳이 조립한다. 고객 글 생산자는 전부 그 CT 를 지난다(R24 계약 시험 · 소스에서 기계로 뽑는다) | V5 · V10 · F7 |
| I3 | 「목소리 있음」 = `voiceLearned(companyId)` 한 함수 = **주입할 목소리가 있다**(확인된 묶음(상태 행 `reviewed` · K5-4)에 지금 있는 문안 · 글 해시가 맞는 뼈대 1건 이상 또는 사람 행 칸 1개 이상 · 구조체크 2 · 3회차). 확인 전 · 학습 전 회사 = 목소리 없는 회사로 돈다(I15 · 칩 「배운 내용 확인 대기」 · 「다시 배우기」). 두뇌 · AI 한줄로 확인 판 · 화면 · 3안 · C안 시험 제외 · 스타일 스위치가 이것만 읽는다 | F7 · F14 |
| I4 | 성격(마케팅 · 안부/알림)은 **종류에서만 파생**. 생성 때 순서 = 입력 종류 > 생산자 목적 코드 > 광고 여부(마지막 수단 · 저장 안 함). 광고 여부는 법 축 · 바이트 · 광고 문장만 정한다 | V3 · V4 · F1 · F2 |
| I5 | 종류 5 = 상수 하나(`COPY_CONTENT_TYPES`). 판정 = 한 CT. 모르면 null(저장을 막지 않는다 · 「종류 미정」) | V3 · F1 |
| I6 | 목소리 예시 = **대표 문안 풀만**(사람이 올린 것 + 담당자가 확인한 「사람이 보낸 발송」). 목소리 회사의 성과 예시 원문 = 0(구조 통계만) · 업종 시드 · 공식 = 0 | V11 · F7 |
| I7 | 「사람이 보낸 발송」 = 한 CT: 직접 발송 − 허브 3안 그대로 · 작성자 / 매장 범위 · 여정 · 알림톡은 캠페인 본문(고객 렌더본) 대신 단계 템플릿 | V18 · F9 · F15 |
| I8 | 모양 = 정규화 함수 하나 + 한 편 실측 `measureText` · 회사 기준값 `buildCompanyShape`(측정 · 검증 · 화면 칩 · 고친 차이 학습 공용). 회사 기준값의 표본 3건 미만인 칸 = 미측정 | V8 · V9 · F6 |
| I9 | 스타일 규칙 끄기 = **사람 표본에 반대 증거 1건이면 그 칸 끔 · 같은 성격 표본 3건 이상에서 잰 값이면 그 값이 규칙** | V1 · F4 |
| I10 | 학습 = [저장하고 배우기] 한 버튼 · 표시 6크레딧 · 저장까지 끝난 학습만 걷는다 · 같은 세대 재시도 = 다시 걷지 않음 · 실패 = 0 · **사람 클릭 없는 과금 0** | V6 · F8 · Harold 결정 ① |
| I11 | 세대값: 대표 문안 묶음이 바뀔 때마다 오른다. 추출 · 견본은 시작 때 세대와 쓸 때 세대가 같을 때만 쓴다 | V20 |
| I12 | 사람 원문을 고치는 생산자(고치기 모드) = 예시 0 · 원문 모양 보존 | F12 · V22 |
| I13 | 회사 격리: 목소리 읽기 · 쓰기 · 캐시 = 회사 조건 · 학습 원장 해시 키 = env 필수(기본값 삭제 · 재해시 이관과 한 묶음) | V19 · F16 |
| I14 | 재생성 예산 = 회차 컨텍스트 하나 · 비교 순서 = 법 > 스팸 > 목소리 · 실행 순서 = 모양 변환 → 바이트 · 전송자 검사 | V25 · F13 |
| I15 | 목소리가 없는 회사의 지시문 · 출력 = 묶음 0 의 법 변경을 뺀 나머지는 지금 글자 그대로(스냅숏 시험) | F17 · 회의론자 D16 |
| I16 | **목소리 회사의 생성 프롬프트에 들어가는 AI 추출 회사 문안 글자(예시 · 가이드라인 문구 칸) = 사람이 화면에서 확인한 묶음(상태 행 `reviewed`)의 뼈대 · 문구뿐**(확인 = 화면이 본 추출 세대만 · 새 추출본은 확인 전까지 대기 · 사람이 직접 적은 칸은 그대로)(사실 자리 = 발송 차단 규격 칸 · 원문 0 · 최근 발송 문안 · 성과 예시 원문도 0 = K2-3 · K6-3). 목소리 없는 회사 = I15(지금 그대로 · §10). 적용 범위 = `composeVoicePrompt` 로 이관된 생산자(묶음 A = 문자 경로 · 묶음 B 끝 = 전부) · 이관 전 생산자는 옛 껍데기(K6-1 · 지금 동작)라 묶음 B 끝에 닫힌다(화면 「적용 범위」 칸 · K15-4). 자동 학습은 글자를 싣지 않는 형식 값(줄 수 · 기호 집합 · 어체)만 · 새 글귀 · 지운 표현은 사람이 받아들인 것만(K14-1) | Codex 1R · 2R · 3R(예시 사실 누출 · 같은 부류 세 번) |

## §2 결정

### K1 법 출구 (묶음 0 · V16 · V17 · F3)

1. **전송자 명칭**: 새 CT `ensureSenderName(text, ctx)`(`utils/messageUtils.ts` · `buildAdMessage` 옆). 광고 문자만. 통과 = LMS · MMS 제목 또는 본문 첫 비어 있지 않은 줄에 이름 집합(`companies.brand_name` · `company_name` · 묶음 A 부터 K5 `shape` 의 머리 꼴) 중 하나가 있다(묶음 0 = 앞의 둘만). 없으면 본문 맨 앞에 `[브랜드명]` 한 줄(LMS · MMS) 또는 `[브랜드명] `(SMS)을 코드가 붙인다. 근거 = 우리 지시문 `services/ai.ts` 748(「전송자 명칭은 광고 본문보다 앞」) · 2차 자료(솔라피 광고 문자 안내: 「(광고) 표기 및 발송 주체 · 연락처」 = 시작 부분 · 수신거부 = 끝) · **시행령 별표6 원문 = 미확인(§8 Q1)**.
   - 적용 자리 = 출구 CT `applyCopyExitGuards`(K12-1 · `generateMessages` · 견본) + 여정 생산자 출구(여정 문자 = 늘 광고 · `journey-ad-policy.ts` 13~17). 사람이 직접 쓴 발송 본문은 바꾸지 않는다(고객 문안 불변).
2. **집 규칙 정정**: `BRAND_SYSTEM_PROMPT` 798~802 「[브랜드명]이 본문의 마지막 줄」 · 예시를 「첫 줄 또는 제목」으로 바꾼다(748 과 모순 해소). 이 변경은 목소리 없는 회사에도 적용(I15 의 예외 = 법).
3. **단문 바이트**: `getAvailableSmsBytes(isAd, rejectNumber, senderBytes?)` 에 전송자 명칭 바이트 인자. 1의 앞붙임이 일어날 수 있는 광고 SMS 는 브랜드 몫을 미리 뺀다(495~505).
4. **없는 날짜 · 기간**: 출구에서 `findNewNumbers`(이미 있는 CT)를 날짜 꼴(M/D · N일 · ~까지 · D-n · N시)에만 적용한다. 근거 글의 상대 날짜(오늘 · 내일 · 이번 주말)는 **발송일 달력**으로 풀어 비교한다. `generateMessages` 에 `baseDate`(기본 = 지금 · 자동마케팅 = 회차 발송일) 인자를 두고 `getKoreanToday` · 달력 블록도 같은 날로 그린다. 걸리면 그 날짜를 혜택 자리표시와 같은 방식(`[날짜: 직접 입력해주세요]` · `AI_FILL_DIRECT_PATTERN` 꼴 · Codex 5R)으로 바꾸고 재생성 1회(K12 예산 안).
5. **법 칸 제거**: 가이드라인의 `ad_prefix_position` · `reject_position` 을 추출 지시(`routes/ai-memory.ts` 683 · 687) · 추출 정제(745 · 751) · 직접 정정(979 · 985 근처) · 목소리 지시(`brand-voice-prompt.ts` 306~307 · 356~359) · 검증기(`brand-voice-validator.ts` 83~92) · 변경 문장(`ai-memory-text.ts` 146~152) · 화면 편집기(`BrandVoiceCard.tsx` 515~520)에서 지운다. 저장된 옛 값은 남아도 아무도 읽지 않는다(데이터 옮김 0). 화면 = 잠긴 한 줄 「법이 정한 것: (광고) 맨 앞 · 080 맨 끝 · 바이트 한도 · 이모지 불가」.
6. **SMS 압축 문단**: `brand-voice-prompt.ts` 360~369 의 바이트 문장을 성격이 아니라 광고 여부 + `getAvailableSmsBytes` 한 출처로 만든다(F1 ④ · 안부 말투 + 광고 = 66바이트 문장).
7. **여정 계절 낱말 출구 검사(발송 규칙)**: 새 CT `findSeasonWords(text, ground)`(낱말 목록 = `journey-ai-generator.ts` 324~325 의 금지 목록을 상수로 옮김 · 근거 글(여정 목표)에 있으면 통과). 여정 생산자 출구에서 걸린 문장은 빼고 재생성 1회(효능 거름과 같은 꼴).

### K2 규칙 세 벌 (묶음 A = 문자 경로 · 묶음 B = 그 밖 · V1 · V2 · V22 · F4)

1. 새 CT `utils/copy-house-rules.ts`: 규칙을 **법 · 발송 · 스타일** 세 벌의 구조 목록으로 둔다. 스타일 규칙 하나 = `{ id, text, shapeField | guidelineField | null }`.
   - 문자 스타일 규칙(지금 `BRAND_SYSTEM_PROMPT` · 사용자 메시지에서 옮김): 한 줄 17자(751 · 935 · 줄 길이) · LMS 600~1200바이트 · 300 미만 금지(752 · 길이 범위) · 5~6문단 구성(927~935 · 문단 수) · 구분선 금지(790~791 · 구분선) · 빈 줄 규칙(794~802 · 최대 연속 빈 줄) · 뻔한 표현 금지 목록(854~862 · 인사 · 빈출 표현) · 느낌표 2~3(849 · 기호 빈도) · 감각 언어 필수 · 사용 시나리오 필수 · 계절감 적극 · 업종 킬 포인트(869~975 · 대응 칸 없음 = 목소리 회사에서 끔) · 사용자 메시지의 「[브랜드명] 형태」 · 「도입부 공감 → 전개 → CTA 충분한 길이」 · 「이모지 금지」 중 스타일 부분(1259 · 1268).
   - 발송 규칙: 여정 상시 발송(계절 금지 · `journey-ai-generator.ts` 321~327) · 스팸 낱말 · 채널 길이 한도 · 카카오 시간.
   - 법 규칙: K1 + 광고 표기 금지(766~771) · 정보 날조 금지(773~777) · 날짜 규칙(779~781) · 효능(783~784) · 글자표(787~788 의 「이모지 금지 · 허용 특수문자」 = 법).
2. 조립 = `buildHouseRules({ channel, producer, voice })`. 스타일 규칙마다(I9): 사람 표본(대표 문안 풀)에 그 칸의 반대 증거가 1건이라도 있으면 그 규칙을 뺀다 · 같은 성격 표본 3건 이상에서 잰 값이 있으면 그 값의 규칙으로 바꾼다 · 그 밖은 지금 문장. 대응 칸이 없는 규칙(감각 언어 · 시나리오 · 계절감 · 킬 포인트)은 `voiceLearned` 면 뺀다. 목소리 없는 회사 = 지금 문장 그대로(I15 · 스냅숏).
3. 코드 후처리도 같은 판정: 구분선 삭제(1376)는 구분선 규칙이 살아 있을 때만 · 빈 줄 줄이기(1380)는 회사 최대 연속 빈 줄(없으면 지금 2) 기준 · `brandTone || '친근함'`(1148) · 톤 줄(1240 · 1262) · 최근 발송 문안 블록(1245~1249)은 목소리 회사에서 뺀다(진실 하나 · I6).
4. **스팸 자기 검사 기호 가산**: `scoreSpamRisk(text, { allowedSymbolRate })` · 그 회사 사람 표본의 K5 기호 빈도 이하는 가산 0(`copy-spam-risk.ts` 21~23). 재생성 힌트만 바뀐다 · 실제 스팸 검사 · 통신사 결과 판정은 그대로.
5. 다듬기 지시문(`services/ai.ts` 2898~2905) · 여정(371~420 · 「좋은 메시지 예시」 블록 489~590 = 집 예시 = 스타일 · 목소리 회사에서 뺀다) · 인앱(481~483) · DM · 한 줄 · SNS 지시문의 스타일 줄도 같은 CT 로 옮긴다(묶음 B). 인앱 「소중한 고객님 권장」 · 문자 「금지」 = 둘 다 스타일 → 목소리 판정으로 하나가 된다.

### K3 3안 (묶음 A · V1 · V4 · F5)

1. 키(A/B/C · `emo` · `benefit` · `mz`) · 안마다 과금 · 원장 `hubVariants.names` 칸 = 그대로.
2. `voiceLearned` 회사만 전략 블록을 바꾼다: **A = 평소 우리 문자처럼**(같은 종류 대표 문안의 짜임 · 가장 회사다운 안) · **B = 혜택 먼저**(혜택이 없으면 핵심 먼저) · **C = 짧게**(LMS 도 4줄 안 · SMS = 압축). 세 안 모두 같은 목소리 · 다른 점 = 후크 · 혜택 위치 · 길이. 이름은 서버 함수 `variantNamesFor(voiceMode, cVariant)` 가 정해 응답에 싣고, 화면(`frontend/src/utils/ai-line.ts` 16~21 · `LineIntakeModal.tsx` 719~720 · 819)은 서버 이름을 그린다.
3. 자동마케팅 · 여정 · 플래너가 쓰는 첫 안 = A(가장 회사다운 안).
4. C안 교체 시험(`routes/ai.ts` 1075~1107 `pickCopyCVariant`)은 목소리 회사를 대상에서 뺀다 · 원장 `hubVariants` 에 `voiceMode` 를 함께 적는다(`training-logger.ts` 105~113 · 286~292).
5. 검증기는 안별로 잰다 · C 는 길이 검사 제외(`brand-voice-validator.ts` 133~145).
6. AI 한줄로 추천 안(`recommended_style` · `services/ai.ts` 2064 · 2128 → `services/ai-line.ts` 418 `styleToType`)은 이름 글자가 아니라 키(`emo` · `benefit` · `mz`)로 받는다(지시문이 키를 내게 · 옛 이름 글자도 `styleToType` 이 계속 읽음) · 화면 이름은 `variantNamesFor` 가 붙인다.

### K4 분류 = 법 축 · 말투 축 (묶음 A · V3 · V4 · F1 · F2)

1. `COPY_CONTENT_TYPES` = `promo`(행사 · 할인) · `launch`(신제품 · 입고) · `howto`(기능 · 사용법 설명) · `greeting`(안부 · 감사) · `notice`(공지 · 안내). `kindOfContentType` = greeting · notice → `notice` · 나머지 → `marketing`. 상수 · 라벨 · 판정 지시문 = `utils/copy-content-type.ts` 한 파일(화면은 서버가 내린 라벨을 그린다).
2. 대표 문안 JSON(`memory_value`)에 `content_type` · `content_type_source`(`admin` | `ai`). 성격 `kind` = 종류가 있으면 종류에서 파생 · 옛 행(종류 없음)은 지금 `kind` 그대로 읽는다. DDL 0.
3. **올릴 때**: 추출 호출 한 번이 문안마다 종류 · 뼈대(`skeleton` · K5-4)를 판정한다(추출 지시 647~651 의 「(광고)가 있으면 marketing」 삭제 · 「성격 판정」 → 「종류 판정」). 사람이 고른 종류는 덮지 않는다. 종류 null 인 문안 = 저장 · 예시 「전체」 묶음에는 남고 성격별 가이드라인 표본에서는 빠진다(`planBrandVoiceRows` 의 미분류 거절을 「분류된 문안이 1건 이상」으로 바꾼다 · 0건이면 지금처럼 쓰기 0).
4. **생성 때** `resolveCopyIntent({ inputType, purposeCode, isAd, text, companyId })` 순서:
   - 입력 종류(화면 칩 · AI 한줄로 사실 읽기가 판정한 칸).
   - 목적 코드: 여정 `journeys.template_code`(onboarding · birthday → greeting · reservation → notice · repeat · dormant · cart → promo · custom → 없음 · 여정은 단계별 성격이 먼저 = K11-4) · 자동마케팅 운영자 `target_hint`(birthday · new_customers → greeting · dormant · vip · recent_buyers → promo · all → 없음).
   - AI 판정: AI 한줄로 = 이미 도는 사실 읽기 호출(`recommendTarget` · `services/ai-line.ts` 392 근처)의 JSON 에 `content_type` 한 칸(추가 호출 0). 직접 생성(`/generate-message`) · 옛 자동발송(`auto_campaigns` · 목적 칸 없음) = 생성 앞 짧은 판정 호출 1회(`classifyCopyIntent` · 생성의 크레딧 묶음 안 · 같은 회사 + 같은 글 해시는 프로세스 캐시 24시간).
   - 광고 여부(마지막 수단 · 성격만 · 저장 안 함).
5. 바이트 · 광고 문장 = 광고 여부로만(종류 · 성격이 바꾸지 못함). 화면의 종류 칩은 광고 칩을 바꾸지 않는다.

### K5 모양 (묶음 A · V8 · V9 · F6)

1. 새 CT `utils/copy-shape.ts`:
   - `normalizeForShape(text)` = (광고) 머리 · 080 · 무료수신거부 줄 · [Web발신] 을 뗀다. **전송자 머리(첫 줄 [브랜드])는 남긴다.**
   - **두 함수로 가른다(Codex 1R)**: `measureText(text)` = 문안 한 편의 실측(줄 수 · 문단 수 · 최대 연속 빈 줄 · 줄 길이 최대 · 구분선 실물(줄 전체가 같은 기호 3개 이상) · 쓴 KS X 1001 기호 집합과 빈도 · 첫 줄 꼴(머리 기호 · 이름 · 인사) · 끝 줄 꼴(맺음 · 서명)) · 늘 값을 낸다. `buildCompanyShape(texts)` = 여러 편의 `measureText` 를 모아 회사 기준값(줄 길이 p50/p90 · 최대 연속 빈 줄 범위 · 구분선 · 기호 집합 · 머리 · 맺음 꼴 · 표본 수 n) · **칸마다 n<3 = 미측정**(표본 하한은 회사 기준값을 학습 · 채택할 때만). 생성문 검사 · 고치기 모드 대조는 `measureText(출력)` 대 회사 기준값(또는 고치기 원문의 `measureText`). AI 0.
2. 추출 때 성격별 표본에 `buildCompanyShape` 를 돌려 가이드라인 JSON `shape` 에 저장(길이 범위 · 링크 습관을 코드가 재는 자리 · `routes/ai-memory.ts` 759~762). `symbol_style`(AI 서술)은 화면에서 내리고 지시에서도 `shape` 가 있으면 뺀다. **가이드라인 직접 정정**(`routes/ai-memory.ts` 971~1008)은 코드가 잰 칸(`shape` · `length_range` · `link_habit`)을 입력에서 받지 않고 이전 행 값을 보존한다(지금은 입력으로 통째 다시 써 지워질 수 있다).
3. 지시 문장 389 「본문 내용을 복사하지 말고 톤만 학습」 → 「모양(줄바꿈 · 빈 줄 · 기호 · 머리 · 맺음)은 예시를 따르고, 내용(상품 · 행사 · 혜택 · 날짜)은 복사하지 않는다」. `shape` 의 측정 칸은 「형태 준수 규칙」 절에 값으로 싣는다.
4. **예시 = 사람이 본 뼈대만 · 원문은 프롬프트에 넣지 않는다(Codex 1R · 2R · 3R 같은 부류 세 번 → 구조 반전)**. 왜 되풀이됐나 = 원문을 프롬프트에 넣고 「사실을 찾아 지우는」 차단 목록(1R 반복 횟수 · 2R 줄 위치 · 3R AI 표시 조각)에 기댔다. 차단 목록은 놓친 조각이 그대로 새고, 같은 목록을 쓰는 출구 검사도 함께 놓친다. 처방 = 허용 목록으로 뒤집는다(**I16**).
   - **뼈대 만들기**: 추출 호출(이미 도는 한 번 · 추가 AI 0)이 문안마다 그 문안에만 해당하는 사실 조각(상품명 · 행사명 · 매장 · 기간 표현 · 혜택 표현)과 종류를 원문 글자 그대로 돌려준다(응답이 문안 전문을 다시 쓰지 않아 길이가 문안 수에 비례하지 않는다). **서버가** 원문에 실제로 있는 조각만 받아 그 자리를 발송 차단 규격 칸(`[상품명: 직접 입력해주세요]` · `[행사명: 직접 입력해주세요]` · `[기간: 직접 입력해주세요]` · 혜택 = 지금 `BENEFIT_PLACEHOLDER`)으로 바꾼 `skeleton` 을 만든다 · 코드 판정 사실(숫자 · 날짜 · 혜택 값 · 휴대폰 · URL)도 칸으로 바꾼다(뼈대 = 원문 글자 + 칸뿐 · AI 가 새 글을 만들 자리 없음).
   - **가이드라인 문구 칸도 같은 문(Codex 4R)**: AI 가 원문에서 뽑는 문구 칸(`frequent_expressions` · `cta_patterns` · `signature` · `greeting_pattern` · `sentence_ending_examples`)도 같은 사실 조각 · 코드 판정으로 칸을 친 뒤 뼈대와 함께 확인받는다. 관리자가 직접 적은 키트 칸(`signature_locked` · `slogans` · `required_words` · `banned_words` · 직접 정정한 칸)은 사람 글이라 그대로 쓴다. 문구가 아닌 칸(톤 · 어체 · 호칭 · 모양 · 길이 · 링크 습관)은 확인과 무관하게 쓴다.
   - **사람 확인 = 주입 자격(Codex 4R · 5R)**: 확인 대상 = **AI 추출본**(그 추출 세대의 뼈대 · AI 문구 칸). 확인 기록 = 상태 행 `reviewed`(K7-1).
     - 학습 화면이 그 추출 세대의 뼈대 · AI 문구 칸을 보여 준다(칸 = 색 칩 · 「AI 가 이 자리를 가렸어요」). 사람은 빠진 사실을 눌러 칸으로 바꾸거나 칸을 되돌리고 [확인]을 누른다(1클릭 · 다시 걷지 않음 · 고친 뼈대 = `skeleton_source = admin`).
     - **확인 요청은 화면이 본 추출 세대 `seenExtractGen` 을 싣는다.** 상태 행 잠금 안에서 **유효한 대기 추출본이 있고**(`extract` 가 비어 있지 않음 · 초기화가 비운다 · Codex 10R) `extract.gen = seenExtractGen` 일 때만 `reviewed` 를 그 추출본으로 갈아 끼운다(+ 사람이 고친 뼈대) · 아니면 409 + 지금 상태(A 가 보는 동안 B 가 새 추출을 끝냈거나 초기화한 경우 · 복원 0).
     - **같은 세대의 추출 결과는 바뀌지 않는다**: 추출은 세대마다 한 번(`extract.gen = gen` 이면 다시 돌리지 않고 저장된 결과 · 0) · [다시 배우기] = 같은 트랜잭션에서 `gen + 1` 뒤 추출.
     - **사람 글과 AI 글은 다른 자리(Codex 5R · 6R · 7R)**: 직접 정정한 칸은 가이드라인 행에 섞지 않고 **성격별 사람 행** `memory_type = 'brand_voice_admin'` · `memory_key = 'marketing' | 'notice'`(값 = `{ 칸: { value, at, by } }` · DDL 0)에 둔다. 읽을 때(`composeVoicePrompt` · 화면) 해석된 성격의 AI 가이드라인 위에 그 성격의 사람 행을 덮는다 = 사람 칸은 확인 없이 쓰이고 · 고치지 않은 AI 문구 칸과 뼈대는 확인된 묶음에 있는 것만 쓰인다(직접 정정이 미확인 추출본을 승인하지 않는다).
     - **추출은 사람 행을 건드리지 않는다**: 추출 저장(K7-4)은 지금처럼 AI 가이드라인 행만 쓴다(행 배치 = `planBrandVoiceRows` 그대로 · 키트 칸 보존 = `routes/ai-memory.ts` 786~797 그대로). 사람 행은 성격으로 고정돼 있어 안부만 → 두 성격 전환 · 행 재배치 · 표본이 사라진 성격에도 그대로 남는다(그 성격 표본이 다시 생기면 다시 덮인다). 병합 규칙 0. 사람 칸을 AI 에 다시 맡기기 = 그 칸을 사람 행에서 지움(칸별 [AI 에게 다시 맡기기] · 세대 + 1 · `guidelineGen` 승계는 직접 정정과 같은 조건) · [초기화](관리자) = AI 가이드라인 · 사람 행 · 문안 행의 뼈대 · `extract`(대기 추출본) · `reviewed`(확인된 묶음) 전부 비움(대표 문안은 남는다 · 학습 미완 · 열려 있던 확인 화면의 요청 = 409).
     - 뼈대마다 그 문안 글의 해시를 함께 둔다 · 문안이 고쳐졌으면 그 뼈대는 쓰지 않는다(다음 학습까지).
     - **확인된 묶음과 확인 대기 묶음(구조체크 3회차 DC14)**: 확인은 그 추출본의 뼈대 · AI 문구 칸을 **확인된 묶음** = 상태 행 `reviewed`(`{ extractGen, at, by, skeletons: { 문안 id: { hash, text } }, phrases: { marketing: {…}, notice: {…} } }`)로 옮겨 적는다(같은 잠금 · 같은 트랜잭션). 새 추출본은 확인 전까지 **확인 대기**(가이드라인 행 · 문안 행의 뼈대) · 생성에는 쓰이지 않고, 생성은 **마지막 확인된 묶음**을 계속 쓴다 = 다시 배우기 · 문안 추가 · 월 1회 다시 배우기에도 목소리가 끊기지 않는다(확인하는 순간 갈아 끼움).
     - **`composeVoicePrompt` 주입 = 사람 글(키트 · 성격별 사람 행 칸 · 받아들인 글귀) + 확인된 묶음(지금 있는 문안이고 글 해시가 맞는 뼈대 · 그 성격의 문구 칸) + 지금 가이드라인 행의 문구 아닌 칸 · 모양**. 확인된 묶음이 없으면 = 문구 아닌 칸 · 모양만 + 생성 화면 칩 「배운 내용 확인 대기」. **생성 프롬프트에 들어가는 AI 추출 회사 문안 글자 = 확인된 묶음뿐**(원문 0 · 확인 대기 0).
   - **출구**: 칸 글자가 출력에 남으면 지금 발송 길목(`AI_FILL_DIRECT_PATTERN` · `copy-benefit-detector.ts` 56)이 막는다(새 차단 규칙 0). 지시 = 「칸은 뼈대 표시일 뿐 · 이번 근거 글의 사실로 채우고 · 근거에 없으면 그 칸이 든 문장을 쓰지 않는다」.
   - **이행**: 옛 대표 문안(뼈대 없음) · 옛 가이드라인(미확인 문구 칸 · 옛 `admin_edited` 표시는 칸별 출처가 없어 사람 행으로 옮기지 않는다) = 예시 · 문구 칸을 싣지 않는다(문구 아닌 칸 · 모양만) · 「다시 배우기 · 6」 칩(K7-5 의 학습 미완으로 센다). 문장 베끼기 판정 · 예외 목록 · 사실 조각 대조는 두지 않는다(덧댄 장치 0).
5. 검증기: 「(광고) 위치」 검사 삭제(K1-5) · 빈출 표현 필수 → 경고 · 모양 검사 = 출력 `measureText` 와 회사 `shape` 의 측정 칸(줄 길이 p90 · 최대 연속 빈 줄 · 구분선 · 기호 집합)만 · SMS 는 줄 · 문단 검사 제외(지금 관례).

### K6 목소리 CT 하나 (묶음 A 핵심 · B 배선 · G1 · V5 · V10 · V15 · F7)

1. `brand-voice-prompt.ts` 에 둔다:
   - `voiceLearned(companyId)` = I3 정의(캐시 공유 · 상태 행 · 사람 행과 같은 읽기). 화면용 상태(`voiceStatus` = 없음 · 학습 미완 · 확인 대기 · 있음 · 견본 미완)는 같은 읽기에서 함께 낸다.
   - `composeVoicePrompt({ companyId, producer, mode, kind, contentType, channel, rules, outputFormat })` → `{ system, guideline, shape, voiceLearned, appliedStyle }`. `mode` = `write` | `rewrite`. `kind` 는 필수 인자(`BrandVoiceKind | typeof VOICE_KIND_UNMIGRATED`) · tsc 가 소비처를 세운다. `outputFormat` 줄은 생산자가 넘긴다(지금 398~401 의 「반드시 JSON」 고정 줄 삭제).
   - `buildSystemPromptWithBrandVoice` = 묶음 B 전까지 옛 이름의 얇은 껍데기(미이관 상수로 부른다 · **옛 판정 그대로** = 가이드라인이 없으면 기본 프롬프트 그대로 · 예시 주입 · 스타일 스위치 꺼짐 · 출력 글자 그대로). K6-2 · K2 는 `composeVoicePrompt` 를 직접 부르는 이관된 생산자에만 걸린다(F17).
2. 예시 고르기: 같은 종류 → 같은 성격 → 전체 순 · 상위 5(보관 30 · 주입 5 · V14 「5건」 문구 = 실제 건수). 싣는 글 = **확인된 묶음의 뼈대만**(K5-4 · I16). 확인된 묶음이 있으면 그 문구 칸과 함께 싣는다(301~303 조건 = 「싣을 가이드라인 칸도 확인된 뼈대도 0」). 확인된 뼈대가 없는 회사(수스_대행 · 옛 학습 회사 · 확인 대기) = 칩(다시 배우기 · 확인 대기).
3. `composeCopyBrain`(`copy-prompt-composer.ts`): 목소리 판정을 `voiceLearned` 로 바꾸고, 목소리 회사 = 회사 성과 예시 원문 블록 0(구조 통계만) · 업종 시드 · 공식 0(75~78 · 139~151 · 185~194). 학습 메모리는 호출자가 이미 넣었으면 건너뛴다(`opts.memoryIncluded` · AI 한줄로 565 와 두 번 주입 V15).
4. `getBrandVoiceFit` · AI 한줄로 확인 판 · 화면 판정 = `voiceLearned` + 성격별 학습 여부.
5. 검증기(`services/ai.ts` 1506)는 해석된 성격의 가이드라인으로 잰다.

### K7 학습 입구 · 세대값 · 과금 (묶음 A · V6 · V7 · V20 · V21 · F8 · Harold 결정 ①②)

1. **세대값 · 단계 상태(Codex 1R · 2R)**: `ai_company_memory` 행 `memory_type = 'brand_voice_state'` · `memory_key = 'main'` · 값 JSON `{ gen, guidelineGen, extract: { gen, at, error } | null, reviewed: { extractGen, at, by, skeletons, phrases } | null, sample: { gen, at, error, result } }`(구조체크 4회차 덜어내기 = 확인 기록 · 확인된 묶음을 상태 행 한 칸으로 · 따로 두던 행 · `review` 칸 삭제)(DDL 0 · §3 Q-D1 확인). `guidelineGen` = 지금 가이드라인이 유효한 세대(추출 정산 이력 `extract` 와 분리). **`gen + 1` 자리 = 대표 문안 추가 · 고침 · 삭제 · 가이드라인 초기화 · 가이드라인 직접 정정**(진행 중 학습을 무효화하는 모든 쓰기). 전이: 추출 성공 = `guidelineGen = extract.gen = g` · **직접 정정 = 같은 트랜잭션에서 그 성격의 사람 행(`brand_voice_admin`)에 고친 칸을 쓰고 `gen + 1` · `guidelineGen` 은 정정 직전 `guidelineGen = gen`(학습 완료)이었을 때만 새 gen 으로 이어받는다 · 이미 학습 미완(`guidelineGen < gen` · 예: 대표 문안을 지운 뒤)이면 옛 `guidelineGen` 을 그대로 둬 「다시 배우기」 상태를 지킨다(Codex 8R)(사람이 고친 결과 · 추출 비용 0 · 견본만 무효 · `reviewed` 는 건드리지 않는다 = 미확인 추출본은 여전히 미확인 · Codex 5R · 7R). 직접 정정은 성격을 골라 한다(지금은 main 한 행만 고칠 수 있다 · `routes/ai-memory.ts` 1014~1028)** · 초기화 = `gen + 1` · AI 가이드라인 · 사람 행 · 뼈대 삭제 · `extract = null` · `reviewed = null`(`guidelineGen` 은 옛 값 → 학습 미완 · K5-4) · 대표 문안 쓰기 = `gen + 1`(옛 가이드라인은 다음 학습 전까지 그대로 쓰인다 · 학습 미완 칩). 이 쓰기들과 추출 · 견본의 저장은 모두 **같은 상태 행을 `SELECT … FOR UPDATE` 로 잠그는 트랜잭션** 안에서 한다(R12 · 판정과 쓰기 같은 잠금). 상태 행이 없는 회사 = 첫 쓰기에서 `INSERT … ON CONFLICT DO NOTHING` 뒤 잠근다.
2. **한 건씩**: 대표 문안 저장 = 전부 지우고 다시 넣기(549~567)를 버리고 한 건 추가 · 고침 · 삭제 주소로(덮어쓰기 차단 · 고침은 `updated_at` 대조 · 다르면 409). 행 `metadata` 에 `created_by` · `updated_by` · 출처(`admin_input` | `sent_history`).
3. **권한(Harold ②)**: 추가 · 고침 · 배우기 = 회사 관리자 + 담당자 · 대표 문안 삭제 · 가이드라인 초기화 = 회사 관리자. 화면은 입력 전에 권한 상태를 보인다(`AiMemoryPage.tsx` 235 의 `isAdmin` 을 카드에 넘김).
4. **[저장하고 배우기 · 6]**: 한 요청 = 문안 저장 COMMIT(세대 `g`) → 추출 AI 호출(잠금 밖) → 추출 저장 트랜잭션이 상태 행을 잠그고 `gen = g` 일 때만 AI 가이드라인 행(사람 행은 건드리지 않음 · K5-4) · 종류 · 뼈대 · `extract = { gen: g }` · `guidelineGen = g` 를 쓴다(다르면 쓰지 않고 「새 문안이 있어 다시 배워요」 응답 · 걷지 않음). 차감 = 지금처럼 저장 트랜잭션 안 · 멱등 키 `brand-voice-extract:{회사}:{g}`(지금 randomUUID 852 를 바꿈) · 단가 1(`brand-voice-extract`). 견본 = K9(5 · 별도 정산). 화면 버튼 표시 = 6(단가표 두 키의 합 · 새 상수 0). 20 미만이라 확인 창 없음. 화면 단가표(`constants/credit.ts`)에 두 키 등록(지금 0 으로 표시).
5. **실패 · 잔액 부족 · 부분 완료(Codex 1R)**: 문안은 남는다. 단계마다 `error`(credit · ai · parse · stale) 를 적는다. 미완료 판정 = `guidelineGen < gen` 또는 뼈대 없는 대표 문안 1건 이상(학습 미완 · 상태 행이 없는 옛 회사 = `gen = 0 · guidelineGen = 0` 으로 읽고 뼈대로 판정) · `sample.gen < gen`(견본 미완) · 재시도는 **미완료 단계만 · 사람 클릭으로만**(자동 재시도 워커 없음 · I10). 칩 금액 = 아직 걷지 않은 단계의 합(학습 미완 = [다시 배우기 · 6] · 학습 완료 · 확인 전 = [배운 내용 확인하기](0 · 확인 화면을 연다) · 확인 완료 · 견본 미완 = [견본 다시 만들기 · 5]). 완료된 단계 결과는 재사용한다(같은 세대 견본 = 저장된 `sample.result` 를 다시 보여 줌 · 다시 걷지 않음). 잔액이 추출분만 되면 추출은 끝나고 견본 단계에 「크레딧이 부족해 견본을 못 만들었어요 · 충전」. `error` 는 그 단계가 다음에 성공하거나 세대가 바뀌면 지운다(R6 · 닫는 자리). 칩 자리 = AI 메모리 · AI 한줄로 확인 판 · 문자 생성.
6. **단문 칸**: 채널 `SMS` 허용 · 강제 변환 두 줄(`routes/ai-memory.ts` 508 · `brand-voice-prompt.ts` 144) 수정 · 타입(66 · 화면 28) · 모양 · 길이 = 채널별.
7. **학습 중 잠금**: 서버 세대값이 진실 · 화면 = 브랜드 보이스 탭 잠금 + `JourneyModalShell` `disableDismiss`(37~41) 보조.

### K8 「사람이 보낸 발송」 CT · 첫 학습 (묶음 A · D10 · V18 · F9)

1. 새 CT `utils/human-sent-messages.ts` `listHumanSentCandidates(companyId, viewer, { days: 180 })`:
   - `campaigns` · `company_id` · `send_type = 'direct'` · 채널 SMS/LMS/MMS · 완료 상태(값 = §3 Q-D3 실측) · `sent_count >= 10` · 본문 30자 이상.
   - 허브 3안을 그대로 보낸 것 제외 = `ai_training_logs.source_ref = getSourceRef(campaign.id)` 행의 `final_source = 'selected_as_is'` 이고 `model_params.hubVariants` 가 있는 것(앱에서 해시 · `routes/campaigns.ts` 3188~3201 이 남긴 행).
   - 범위 = 회사 관리자 전체 · 담당자 = 자기 `created_by` · 매장 범위(`users.store_codes` 가 있는 사용자 = 그 매장 사용자들이 만든 발송).
   - 정규화(K5) · 휴대폰 꼴 · 쿠폰 코드 꼴(영숫자 8자 이상 연속) 든 글 제외 · 같은 글 하나로.
   - 여정 · 알림톡 = 캠페인 본문 대신 `journey_steps.message_template`(Liquid 평문화 `flattenLiquidToPlainText`) · 알림톡 템플릿 원문 · 미리 체크 안 함.
2. 화면: 공용 「보낸 문자 고르기」 창 하나 · 세 입구(대시보드 넛지 · AI 메모리 · AI 한줄로 확인 판의 「학습본 없음」). 직접 발송 후보 = 최근 · 채널이 겹치지 않게 최대 10 미리 체크(코드) · 카드 = 휴대폰 모양 원문(`whitespace-pre-wrap`) · 날짜 · 채널 · 광고 여부 칩. [이 N건으로 배우기 · 6] = 대표 문안 추가(출처 `sent_history`) + K7 학습 한 요청. AI 한줄로 확인 판 안에서 배우면 그대로 이어서 만든다(시도 키에 세대값 · `utils/ai-line.ts` 535~545 · 다시 입력 0).
3. **K8-1 다시 배우기 제안**: 마지막 학습 30일 경과 + 새 후보 1건 이상 → AI 메모리 · 생성 화면 칩 「새로 보낸 문자 N건으로 다시 배울까요? · 6」(클릭할 때 걷는다).
4. 생성 프롬프트의 「최근 발송 문안」 조회 두 벌(`routes/ai.ts` 317~328 · 709~724) = 묶음 0 에서 `send_type = 'direct'` 거름만(F16) · 묶음 A 에서 이 CT 하나로 합친다(목소리 회사는 K2-3 대로 빠짐).
5. 지표 = `voiceLearned` 회사 수 ÷ 90일 「사람이 보낸 발송」이 있는 회사 수(시연 회사 제외 · `isDemoCompany`). 지금 = 2 / 46(원장 S1 · S3 · 분모는 표식 기준이라 구현 뒤 다시 잰다).

### K9 견본 (묶음 A · D13 · F10)

1. 흐름 = [저장하고 배우기 · 6](추출 1 · 표시 = 견본 5 포함) → 학습 화면이 뼈대 · 문구 칸을 보여 줌 → [확인하고 견본 보기](확인 기록 · 값은 첫 버튼에 이미 표시 · 견본 5 는 이때 걷는다) → `POST /api/ai-memory/brand-voice/sample`(세대 `g` · K9-3 조건). 확인 전에는 견본을 만들지 않는다(I16 · Codex 4R). 확인하지 않고 닫으면 추출 1 만 걷힌 상태 · 칩 「배운 내용 확인 대기」. 한 응답에 묶지 않는다(60초 한도).
2. 생성 = 공용 출구 CT(K12-1 `applyCopyExitGuards`)를 지나는 한 경로 · `composeVoicePrompt`(write) · 고정 근거 글 두 줄(행사 줄 「이번 주 신상품 안내」 · 안부 줄 「고객님께 감사 인사」 · 혜택 · 계절 · 날짜 없음) · 한 호출로 두 문안 JSON. 칸 잔존 · 법 출구(K12-3)를 그대로 지난다.
3. 정산 = 성공 뒤 5(`generate-messages` 단가) · 멱등 키 `brand-voice-sample:{회사}:{g}` · 실패 0 · 견본 저장 트랜잭션도 상태 행을 잠그고 `gen = g` · `guidelineGen = g` · `reviewed.extractGen = extract.gen` 일 때만(추출이든 직접 정정이든 이 세대의 유효 가이드라인 + 지금 추출본 사람 확인) `sample = { gen: g, result }` 를 쓰고 걷는다(세대가 바뀌었으면 결과를 버리고 걷지 않는다 · 같은 세대 재요청 = 저장된 결과 · 0).
4. 화면 = 휴대폰 모양 두 장 + 코드가 잰 모양 칩 · (광고) · 080 은 회색으로 「발송 때 자동으로 붙어요」.

### K10 학습 원장 출처 · 개인정보 (묶음 0 · A · V11 · V18 · F11)

1. **묶음 0 · 원천**: `journey-executor.ts` 1126~1133 의 학습 적재 본문 = 단계 템플릿(Liquid 평문화) · 고객 렌더본 금지. `sms-queue.ts` 1436~1444 알림톡 = 같은 회사 · `template_code` 의 `kakao_templates` 템플릿 원문(칼럼 = §3 Q-D4) · 못 읽으면 그 회차 적재 0(첫 수신자 렌더본 금지).
2. **출처 표식**: DDL 없이 `model_params.authorship` = `hub_as_is` · `hub_edited` · `path_ai`(여정 · 플래너 · 운영자 · AI 캠페인) · `path_manual`(그 밖) 을 적는다. `routes/campaigns.ts` 1369 의 「템플릿 = 본문 → selected_as_is」 판정은 칸 값으로는 남기되(값 집합 · 옛 행과 같은 뜻 · 랭커 3 에서 낮은 쪽) 사람 판정 근거로 쓰지 않는다(템플릿과 본문은 늘 같다 · 686) · 그 행 `authorship = path_ai`. `final_source` 값 집합(CHECK)은 바꾸지 않는다(§3 Q-D2 로 실측만).
3. **소비처**: 성과 예시 검색(`copy-rag-retriever.ts` 193~201)은 `authorship` 이 있는 행에서 `hub_as_is` · `path_ai` 를 뺀다(옛 행 = 표식 없음 = 지금처럼). 랭커(`copy-best-ranker.ts` 22~26) = `selected_as_is` 0.15 · `edited` · `manual` 0.3(두 값의 자리만 바꿈).
4. **이미 쌓인 렌더본 행**: 운영 스크립트 `scripts/purge-rendered-training-rows.ts`(읽기 전용 기본 · `--apply` 때만 지움). 식별 = 내용이 아니라 출처: `campaigns.send_type = 'journey'` 와 알림톡 캠페인 id 를 앱에서 해시해 `source_ref` 로 맞춘다. 건수 먼저 출력 → Harold 확인 → `--apply`.
5. 회사 예시 검색에 `hasIdentifierLeak` 는 걸지 않는다(대괄호 꼴을 누출로 봐 회사 예시가 0 · `copy-deidentify.ts` 30).

### K11 그 밖의 생산자 (묶음 B · V5 · F12)

1. 생산자마다 `composeVoicePrompt` 를 지난다(R24). 모드:
   - **쓰기**: 여정 4(`journey-ai-generator.ts` 269 · 857 · 995 · 1166 의 재작성은 고치기) · 여정 맞춤 생성(`journey-builder.ts` 559) · 다음 단계 추천(`journey-step-diagnosis.ts` 273) · 이메일 생성(`email-ai.ts` 277) · 인앱 생성(`inapp-ai-generator.ts` 697) · DM 알림(`dm-alert-copy.ts` 26) · DM 생성(`dm/dm-ai.ts` 478) · 한 줄 제작(`one-line-ct/ai.ts` 158 · `line-template-copy.ts` 64 · `line-headline.ts` 128) · SNS 캡션(`sns-caption-ai.ts` 409) · 변형 3안(`variant-generator.ts` 56).
   - **고치기**(예시 0 · 원문 `measureText` 를 출구에서 대조): 문자 다듬기(`services/ai.ts` 3005) · 이메일 다듬기 2(`email-ai.ts` 373 · 438) · 대행 스팸 회피(`agency-send-refine.ts` 149 · 평문 출력) · 꾸미기(`operator-message-decorator.ts` 44) · DM 개선 · 빠른 고치기(`dm/dm-ai.ts` 582 · `dm/dm-quick-action.ts` 162) · 인앱 빠른 고치기(`inapp-quick-action.ts` 59) · 여정 편집(`journey-ai-editor.ts` 128) · 여정 스팸 재작성(`journey-ai-generator.ts` 1166).
2. HTML · SNS 생산자(이메일 · DM · 인앱 · SNS)는 어미 · 호칭 · 맺음만 물려받는다(모양 · 이모지 = 그 채널 규칙).
3. 한 줄 제작의 다른 브랜드 영업 예시(`line-template-run.ts` 142~149)는 목소리 회사에서 빼고 자기 대표 문안을 싣는다. 목소리 없는 회사 = 지금 그대로(I15).
4. **여정은 단계마다 성격(Codex 1R)**: 여정 패키지 생성은 한 호출이 여러 단계를 만들고 자유 목표 여정은 `template_code` 도 응답 뒤에 정해진다(`journey-ai-generator.ts` 595~610 · 663~676 · 738). 그래서 `composeVoicePrompt` 의 여정 모드 = 마케팅 · 안부 **성격별 블록**(가이드라인 · 규칙 · 종류 꼬리표를 단 예시)을 나눠 한 프롬프트에 싣고, 출력의 단계마다 `content_type` 칸을 받는다. 단계별 출구 검사 · 모양 검사는 그 단계 성격의 기준으로(`content_type` 이 없거나 허용값 밖이면 그 단계 = 목적 코드 → 광고 여부 순). 단계 다듬기 · 스팸 재작성(단계 하나)은 그 단계의 원문 성격(생성 때 정한 값을 결과에 남겨 넘긴다 · 없으면 같은 순서)으로. 목적 코드(`template_code`)는 패키지 전체의 기본값일 뿐 단계 성격을 정하지 않는다.
5. 톤 칸(`companies.brand_tone`)만 쓰던 생산자(변형 · 여정 맞춤 · 다음 단계 추천)는 목소리 회사에서 톤 칸 대신 가이드라인 톤 · 예시.

### K12 출구 한 벌 · 재생성 예산 (묶음 A · V25 · F13)

1. `generateMessages` 의 출구 고리(1364~1488)를 CT `applyCopyExitGuards(text, ctx)`(`utils/copy-exit-guards.ts`)로 옮긴다: 순서 = (광고) · 080 제거 → 스타일 후처리(K2-3) · 모양 변환(빈 줄 = 회사 최대 연속 빈 줄) → 금지어 → 혜택 · 효능 · 날짜(K1-4) → 직접 채울 칸 잔존 판정(K12-3) → 변수 검증 → 링크 → 전송자 명칭(K1-1) → 바이트. 견본(K9)이 같은 함수를 쓴다.
2. 예산 = 회차 컨텍스트 하나(`ai-credit-context.ts` 의 `runInCreditBundle` 과 같은 AsyncLocalStorage 꼴). 한 회차의 생성 호출 상한 = 3(첫 생성 1 + 지금 자동마케팅 스팸 재생성 상한 2 · `auto-campaign-worker.ts` 322~349). 지금은 안쪽 품질 재생성이 바깥 재생성마다 곱해져 최대 6 · 안쪽 재생성도 이 예산 하나를 쓴다. 예산 밖 컨텍스트(직접 생성 화면 등)는 첫 생성 + 안쪽 1(지금과 같음).
3. **재생성을 시작하는 조건** = 법 문제(근거 없는 혜택 · 효능 · 날짜 · 출력에 남은 직접 채울 칸(`hasAiFillPlaceholder` · 뼈대 칸 포함) · 템플릿 문법) · 스팸 위험 · 목소리 문제 중 하나라도(예산 안에서 1회). 재생성 결과는 다시 재고 나은 쪽을 남긴다. 비교 = 법 문제 수(자리표시 · 전송자 · 날짜) → 스팸 점수 → 목소리 문제 수. 남은 자리표시 = 발송 길목이 막는다(Codex 4R).

### K13 화면 (묶음 A · V21 · V23 · V24 · V26 · F14)

1. AI 메모리 맨 위 「우리 목소리」 칸표: 종류 5 × ○ / ✕(같은 측정 · 표본 수) · 빈 칸 → 보낸 문자 고르기 창.
2. `/ai-memory?learn=voice` 바로 열기(브랜드 학습 창 · 브랜드 보이스 탭 · 펼침 · 읽은 뒤 주소에서 지움 · 같은 경로 안 이동 금지). 목소리 없는 회사는 창 기본 탭 = 브랜드 보이스.
3. 「학습됨」 판정(`BrandLearningCard.tsx` 31)에 `voiceLearned` 포함 · 넛지(`BrandVoiceNudgeCard.tsx` 87 · 101 · 107) 문구 = 「최근 90일 보낸 문자 N건이 있어요 → [이 문자로 목소리 배우기]」 · 과장 문구 · 「1~5건」 삭제.
4. 대표 문안 칸: 성격 · 종류 두 칩(AI = 점선 + 「AI」 · 사람 = 실선) · 편집기 종류 한 줄 · 출처 칩 둘(직접 올림 · 보낸 문자) · [빼기] · **뼈대 보기**(칸 = 색 칩 · 글자를 눌러 칸으로 · 칸을 눌러 되돌림 · K5-4) · 「쓸수록 배운 것」 후보 칩(K14-1 · 받아들이기 · 지우기). 가이드라인 창 = 법 칸 잠긴 한 줄 · 모양 칩(「N건 중 M건」 · 공백 · 줄바꿈 = ↵ ␣ 표시만).
5. 창 하한: 편집 · 가이드라인 창 = 공용 `JourneyModalShell`(Esc · 포털 · z 층) · 「/」 로 나누는 칸 = 초안 state(`BrandVoiceCard.tsx` 796) · 안 쓰는 `BrandStudioCard.tsx` 삭제 · 내부 말 「시스템 프롬프트」(`AiMemoryPage.tsx` 1049~1050) · 출처 도넛 내부 키(956) 제거.
6. 브랜드킷 톤 칩(`BrandKitTab.tsx` 46 · 85 · 148~155): 빈 값을 friendly 로 채워 저장하지 않는다 · 목소리 회사에서 읽기 전용 = 묶음 B 끝(톤 칸 소비 0 확인 뒤 · F14).
7. AI 한줄로 확인 판: 성격 아래 종류 칩 한 줄(AI 판정 · 1클릭 바꾸기 · 광고 칩과 독립) · 「학습본 없음」 공용 조각 = 그 자리 보낸 문자 고르기 · [다시 배우기 · 6] 칩(K7-5).
8. 모델명 0 · native dialog 0 · 출처 줄 0 · 모바일 375 · 5초 넘는 작업 로딩 차단.

### K14 쓸수록 (묶음 C · V12 · F15 · 디벨롭)

1. **고친 차이(Codex 3R · I16 과 같은 허용 목록)**: 재료 = 허브 기록 행(후보 원문 · 최종 본문 · K5 정규화 뒤). **자동으로 배우는 것 = 모양 · 형식만**: 줄바꿈 · 빈 줄 · 기호 · 종결어미 바꿈(같은 문장의 끝 음절만 바뀐 것) · 글자를 싣지 않는 값(줄 수 · 기호 집합 · 어체)으로만 쌓는다. **담당자가 새로 넣은 글귀(인사 · 맺음말 포함)와 지운 표현(AI 가 쓴 것을 담당자가 지움)은 자동으로 배우지 않는다**(구조체크 4회차 · 지운 문장에 사실이 섞이면 그 글자가 프롬프트에 든다 = I16): 서로 다른 발송 3건 이상 반복되면 AI 메모리에 「이 문구를 우리 말투로 쓸까요?」 후보 칩으로만 올리고 사람이 1클릭으로 받아들인 것만 「쓸 것」이 된다(사실인지 목소리인지는 사람이 정한다 · 근거에 없는 새 사실이 반복 맺음말로 학습되는 길 차단). 지운 표현도 같은 후보 칩(「이 표현은 앞으로 쓰지 말까요?」). 받아들인 글귀 = `voice_edit` 행(`memory_type = 'voice_edit'` · DDL 0)의 `accepted_use` · `accepted_avoid`(누가 · 언제) = 사람이 확인한 글이라 I16 허용 목록에 든다 · `composeVoicePrompt` 가 「쓸 것 · 피할 것」 절로 싣는다 · 자동 학습분(형식 값)은 같은 행 `form` 칸 · 지운 칩은 다시 후보로 올리지 않는다 · 화면 칸에서 지운다. 재료 0 = 「아직 배울 재료 없음」(「습관 없음」과 구분).
2. **습관 프로필**: 「사람이 보낸 발송」 CT 로만 · 회사 조건 SQL 하루 1회(20시간 멱등 관례) · 요일 · 시각(KST) · 발송 간격 중앙값 · 채널 · 광고 비율 · 혜택 종류(`detectBenefits` 코드) · 완료 10건 미만 = 없음 · 못 읽음 ≠ 0 · `memory_type = 'habit_profile'`. 문안 프롬프트에는 싣지 않는다 · 시각 · 주기 조언에만 · 발송 창 · 피로도 CT 를 그대로 지난다.
3. 조언 문장 = 숫자로 만든 코드 문장(AI 0 · 「보내시는 시각은 주로 화 · 목 오전 10시예요」) · 화면 = `ZoneStatStrip` 숫자 띠 + 조언 한 장 · 페이지 열 때 AI 호출 0 · 「5 학습 타입」 도넛 · Top 10 · 출처 도넛 = 「자세히」 창으로.
4. `cleanupDeprecatedMemories`(`company-memory.ts` 434~450 · 부르는 곳 = `routes/ai.ts` 2811 · `ai-memory-accumulator-worker.ts` 251)에 「학습 5종만」 조건(새 타입 = `brand_voice_state` · `brand_voice_admin` · `voice_edit` · `habit_profile` 이 지워지지 않게) · **묶음 A 에서 한다**(상태 · 사람 행이 묶음 A 에 생긴다) · 새 행 중요도 10.
5. 행사 달력(해마다 반복) = 보류(§10).

### K15 시험 · 묶음 경계 (D15 · D16 · F17)

1. 첫 커밋 = 목소리 없는 회사 지시문 스냅숏(문자 · 다듬기 · 여정 · 인앱 · 이메일 · system + user · 묶음 0 법 변경 반영 뒤) + 조건을 뒤집어 깨지는지 확인.
2. R24 「고객 글 생산자 = 목소리 CT 도달」 = R13 단위 뽑기 재사용(판정 이름 목록만 `composeVoicePrompt` · `buildSystemPromptWithBrandVoice`). 파일 = 새 시험 `utils/__tests__/brand-voice-producers-1028.test.ts` + 단위 뽑기를 옮긴 공용 도우미 `utils/__tests__/helpers/producer-scan.ts`(`root-ledger.test.ts` 는 지금 다른 트랙의 미커밋 변경이 있어 이번에 손대지 않는다 · 그 트랙 커밋 뒤 R13 도 도우미를 부르게 옮긴다 = §10 기록) · 면제 = R13 「고객 글 아님」 + 한줄로 자기 목소리(AI 영업 · 이유 필수 · 낡은 면제 실패) · **미이관 래칫** = `VOICE_KIND_UNMIGRATED` 를 넘기는 생산자 수가 표의 수를 넘으면 실패 · 리터럴 `'marketing'` 넘김 금지. 뿌리 대장(`docs/ROOT-LEDGER.md`)에 R24 줄(뿌리 · 판정 기준 · 시험 범위)을 올린다(다른 트랙이 같은 파일을 고치는 중이라 줄 하나 더하기로만).
3. CF 3사 시험(결온 · 오후담 · 소요웨어 · 도달 불가 값): 같은 한 줄 → 프롬프트에 자기 예시만 · 법 블록 늘 · 반대 증거 칸의 스타일 규칙 없음 · 안부 줄 = 안부 예시 · 여정 생일 = 안부 · 출구 검사 단정.
4. 묶음 경계 장치: 예시 주입 · 스타일 스위치 = 생산자 옵션(묶음 A 생산자만 켬) · 화면 「적용 범위」 칸 = 이관된 생산자 목록(서버 상수 · R24 와 같은 출처).

## §3 DDL · 데이터 · ENV (전부 Harold 실행 · 위치 = 서버 운영 PostgreSQL psql · 하나씩)

- **DDL = 0**(새 칸 · 새 테이블 없음 · 새 `memory_type` 은 `varchar(50)` 값). 아래 확인으로 확정한다.
- Q-D1(K7 · K14) `ai_company_memory` 제약 = `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'ai_company_memory'::regclass;` → `memory_type` CHECK 없음이어야 DDL 0.
- Q-D2(K10) `ai_training_logs` 제약 = 같은 꼴(`final_source` CHECK 값 집합 확인 · 바꾸지 않는다).
- Q-D3(K8) 직접 발송 상태 값 = `SELECT status, COUNT(*) FROM campaigns WHERE send_type = 'direct' AND created_at >= NOW() - INTERVAL '180 days' GROUP BY 1 ORDER BY 2 DESC;`
- Q-D4(K8) 칼럼 실존 = `SELECT column_name FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name IN ('send_type','created_by','message_content','message_type','is_ad','sent_count','status','created_at');` + `journey_steps.message_template` · `journeys.template_code` · `users.store_codes`.
- ENV-1(K15 · V19) 학습 원장 해시 키 = 서버 백엔드 프로세스 env 에 `TRAINING_HMAC_SECRET` 이 있는가(값은 찍지 않는다 · 개수만 · 명령 = 구현 끝에 실행 위치와 함께 한 줄로 드린다 · env 파일 위치 = 미확인). 1 이면 코드 기본값 줄만 지운다(키 없으면 시작 거부). 0 이면 키 교체 = 재해시 이관 스크립트(옛 키로 회사별 옛 ref → 새 ref UPDATE → 회사별 행 수 전후 같음)와 한 묶음.
- DML-1(K10-4) 렌더본 행 정리 = 스크립트 건수 출력 → Harold 확인 → `--apply`.

## §4 영향표 (바뀌는 자리 → 소비처 · 확인 방법)

| 바뀌는 자리 | 소비처 | 확인 |
|---|---|---|
| `buildSystemPromptWithBrandVoice` → `composeVoicePrompt` | `services/ai.ts` 1288 · 3015 · `email-ai.ts` 297 · 380 · 447 · `dm-alert-copy.ts` 92 · `inapp-ai-generator.ts` 688 · `journey-ai-generator.ts` 663 · 936 · 1038 · 1189(11) | tsc(kind 필수) · R24 · 스냅숏 |
| `composeCopyBrain` 판정 · 블록 | `services/ai.ts` 1297 · `email-ai.ts` 298 · `dm/dm-ai.ts` 330 | 목소리 회사 시험 · 없는 회사 스냅숏 |
| `getBrandGuideline` · `getBrandVoiceFit` | `copy-prompt-composer.ts` 141 · `services/ai.ts` 1506 · `design-core/brand-profile.ts` 38 · `services/ai-line.ts` 378 | 시험 |
| `BRAND_SYSTEM_PROMPT` 분해 | `generateMessages` · `brandSystemPromptForTest` · `applyCopyCVariant`(세 자리 문자열 · 1041~1045) · C안 계약 시험 | C안 계약 시험 갱신 · 스냅숏 |
| `generateMessages` 인자(`baseDate` · 종류 · 예산) | `routes/ai.ts` 349 · `ai-orchestrator.ts` 564 · 897 · `ai-line.ts` 567 · `auto-campaign-worker.ts` 296 · 339 · 1448 · `continuous-operator.ts` 1657 · `planner-copy.ts` 232 | tsc · 시험 |
| 출구 CT 이전 | `generateMessages` 만(+ 견본) | 기존 출구 시험 전부 통과 |
| 대표 문안 주소(한 건씩 · 권한) | `BrandVoiceCard.tsx` · 새 고르기 창 | 라우트 시험 · 화면 |
| 가이드라인 법 칸 제거 | 추출 · 정정 · 지시 · 검증기 · `ai-memory-text.ts` · 화면 | grep 잔존 0 |
| 학습 원장 적재 · 표식 | `journey-executor.ts` 1126 · `sms-queue.ts` 1436 · `routes/campaigns.ts` 1369 · `copy-rag-retriever.ts` · `copy-best-ranker.ts` · `best-copy-miner.ts`(final_source 읽기 여부 확인) | 시험 |
| 최근 발송 문안 조회 | `routes/ai.ts` 317 · 711 · `ai-orchestrator.ts` 259 | 시험 |
| 여정 계절 검사 · 날짜 검사 | 여정 생산자 출구 · `generateMessages` 출구 | 시험 |
| `cleanupDeprecatedMemories`(학습 5종만) | `routes/ai.ts` 2811 · `ai-memory-accumulator-worker.ts` 251 | 시험(새 타입 잔존) |
| 화면 단가 키 | `constants/credit.ts` | 화면 라벨 · 단가 대조 시험 |
| `scoreSpamRisk` 선택 인자(기호 허용 빈도) | `services/ai.ts` 1517 · `best-copy-miner.ts` 127 · `copy-quality-score.ts` 16 · `copy-seed-curator.ts` 30(인자 없음 = 지금 그대로) | `copy-spam-risk.test.ts` |
| `BRAND_SYSTEM_PROMPT` 798~802 글자(브랜드 끝 줄 → 첫 줄) | 지시문 글자를 고정한 시험 `automarketing-oneline-1024` · `hanjul-signature-1005` · `operator-subject-1015` · C안 계약 | 시험 갱신(뜻 = 법 정정) |
| 추천 안 이름(`recommended_style`) | `services/ai-line.ts` 418 `styleToType` | 시험 |
| 대표 문안 저장 주소 교체(전부 지우고 다시 넣기 → 한 건씩) · 직접 정정(성격별 사람 행) | `BrandVoiceCard.tsx` saveMessages · saveGuideline | 라우트 · 화면 |
| `planBrandVoiceRows`(분류된 문안 1건 이상) | `routes/ai-memory.ts` 추출 하나 | 순수 시험 |
| 새 `memory_type`(`brand_voice_state` · `brand_voice_admin` · `voice_edit` · `habit_profile`) | 타입 없이 읽는 곳 = `listMemories` 기본(호출 3곳 모두 학습 5종 지정 · grep 확인) · `brand-voice-prompt.ts` 읽기(타입 지정) · 넘친 메모리 정리(`TYPE_CAPS` 목록 타입만) | grep · 시험 |

## §5 묶음 · 배포 순서 · 되돌리기

| 묶음 | 내용 | 되돌리기 |
|---|---|---|
| 0 | K1(법 출구 · 법 칸 제거 · 브랜드 끝 줄 → 첫 줄 · 바이트 · 날짜 기준일 · 여정 계절 검사) · K10-1 · 2(원천 · 표식) · K8-4 앞 절반(조회 두 벌 direct 거름) · ENV-1 확인 · 스냅숏 시험 | 코드 되돌림(DDL 0) |
| A | 문자 세 경로(직접 생성 · AI 한줄로 · 자동마케팅 · 운영자 · 플래너 = `generateMessages` 길) + K2 · K3 · K4 · K5 · K6 · K7 · K8 · K9 · K12 · K13(K13-6 제외) · K14-4(정리 함수 · 새 타입 보호) · R24(미이관 래칫) · 뿌리 대장 R24 줄 | 코드 되돌림 · 세대 상태 행은 남아도 무해 |
| B | K11 그 밖 생산자 이관 · K13-6 톤 칩 | 코드 되돌림 |
| C | K14(K14-4 제외) · DML-1 · 재해시(ENV-1 이 0 일 때) | 코드 되돌림 · 학습 행 지움 |

## §6 시험

- 순수: `measureText` · `buildCompanyShape`(n<3 미측정) · `normalizeForShape`(전송자 머리 남김) · `resolveCopyIntent` 순서(여정 단계 성격 포함) · `buildHouseRules`(반대 증거 1 · 3건 · 목소리 없는 회사 = 지금 글자) · `ensureSenderName` · 날짜 검사(상대 날짜 · 기준일 · 칸 규격) · 계절 검사 · 뼈대 만들기(원문에 있는 조각만 · 코드 판정 사실도 칸 · 칸이 `AI_FILL_DIRECT_PATTERN` 에 걸림) · 주입 판정(사람 행 덮기 · 확인된 묶음 · 확인 대기 묶음은 안 씀 · 지운 · 고친 문안 뼈대 제외(글 해시)) · 세대 전이 표(추출 · 직접 정정 학습 완료 / 미완 · 초기화 · 문안 쓰기 · AI 에게 다시 맡기기 · 확인 409 · **초기화 → 열려 있던 화면의 확인 요청 = 409 · 뼈대 · 확인된 묶음 복원 0**) · `variantNamesFor` · `kindOfContentType` · `planBrandVoiceRows`(종류 null) · 멱등 키(추출 · 견본).
- 계약: R24(소스 뽑기 · 미이관 래칫) · 스냅숏(목소리 없는 회사) · CF 3사 · 화면 단가 · 라벨 대조 · 법 칸 grep 잔존 0.
- 라우트: 대표 문안 한 건씩(권한 · 409) · 저장하고 배우기(세대 경합 · 멱등 · 잔액 부족 · 같은 세대 다시 = 0) · 확인(본 세대만 · 409) · 견본(확인 전 거절 · 정산 · 같은 세대 재사용) · 직접 정정(성격별 사람 행 · 측정 칸 보존) · 초기화(뼈대 · 대기 추출본 · 확인된 묶음 비움).
- 실 PG(test:pg): 「사람이 보낸 발송」 CT SQL · 세대 잠금.

## §7 리허설 (Harold 실측 · 운영 · 배포 뒤)

| # | 행동 | 기대 | 판정 |
|---|---|---|---|
| R1 | 테스트계정 · 보낸 문자 고르기 → 배우기 → 뼈대 확인 | 6 표시 · 배우기 때 1 · 확인 뒤 견본 5 · 견본 두 장 | 원장 차감 행 2 · 화면 |
| R2 | 같은 한 줄 「이번 주 가을 신상 20% 할인」 AI 한줄로 | 세 안 모두 그 회사 머리 · 줄띄움 · 기호 | 눈 · `measureText` 대 회사 기준값 |
| R3 | 「생일 축하」 한 줄 | 안부 말투 · 광고면 (광고) · 080 · 브랜드 첫 줄 | 미리보기 |
| R4 | 여정 생일 단계 생성 | 안부 말투 · 계절 낱말 0 | 미리보기 |
| R5 | 잔액 0 회사 배우기 | 문안 저장 · 「크레딧이 부족해 아직 못 배웠어요」 칩 · 차감 0 | 화면 · 원장 |

## §8 실측 · 확인 (구현 전 · 하나씩)

- Q1 시행령 별표6 원문(전송자 명칭 위치) = 국가법령정보센터 원문 인용으로 K1-1 확정(지금 = 2차 자료 + 우리 지시문 748).
- Q-D1~Q-D4 · ENV-1 = §3.

## §9 화면 문구 (고객 노출 · 모델명 0 · 줄표 0)

- 버튼 「저장하고 배우기 · 6크레딧」 · 「이 N건으로 배우기 · 6크레딧」 · 「다시 배우기 · 6크레딧」.
- 칩 「아직 못 배웠어요」 · 「크레딧이 부족해 아직 못 배웠어요」 · 「크레딧이 부족해 견본을 못 만들었어요」 · 「배운 내용 확인 대기」 · 「종류 미정」 · 「새로 보낸 문자 N건으로 다시 배울까요?」 · 「이 문구를 우리 말투로 쓸까요?」.
- 버튼 「확인하고 견본 보기」 · 「배운 내용 확인하기」 · 「견본 다시 만들기 · 5크레딧」 · 「AI 에게 다시 맡기기」.
- 뼈대 칸 칩 「AI 가 이 자리를 가렸어요」.
- 잠긴 줄 「법이 정한 것: (광고) 맨 앞 · 080 맨 끝 · 바이트 한도 · 이모지 불가」.

## §10 알고 둔 한계 · 범위 밖

- 매장 · 브랜드별 목소리(한 회사 안 여러 목소리) = 범위 밖(묶음 A 는 고르기 범위만 막음 · 대상 회사 수 실측 뒤 별도).
- 행사 달력(해마다 반복 행사) 학습 = 보류.
- 목소리 없는 회사의 한 줄 제작 예시 출처(다른 브랜드 영업 예시) = 지금 그대로(I15 · 별도 과제).
- 목소리 없는 회사의 생성 프롬프트에 실리는 최근 발송 문안 · 성과 예시 원문(옛 사실 누출 가능 · 지금 동작) = I15 로 그대로 · 별도 과제(목소리 회사는 I16 으로 원문 0). 첫 학습(K8)으로 목소리 회사가 되면 닫힌다.
- 광고 문자의 연락처 표기(시행령) = 이 설계 밖(K1 은 전송자 명칭만).
- 생성 품질 자체(말투가 얼마나 닮았나)는 단위 시험으로 못 잰다 = §7 리허설.

## §11 회의 기록 요지

원장 §8(1028 · 기획 · 백엔드 · 프론트엔드 · 회의론자 · 1차 → 교차 토론 → 수렴 K1~K15 → 최종 검증 F1~F17 전부 수용).

## §12 진행표

| 순서 | 대상 | 상태 |
|---|---|---|
| 1 | 설계서 초안 | 1028 |
| 2 | Codex 적대 리뷰 approve | 1R needs-attention 5(high 2 · 단계 상태 · 초기화 무효화 / medium 3 · 여정 단계 성격 · 측정 함수 분리 · 베끼기 예외) 전부 수용 · K5-1 · K5-4 · K7-1 · K7-4 · K7-5 · K9-3 · K11-4 정정 + 자가 발견 1(직접 정정이 측정 칸 보존 · K5-2) → 2R needs-attention 2(medium · 직접 정정 승계 = `guidelineGen` 분리 / 반복 줄 예외가 상품 사실 통과 = 1R 과 같은 부류 두 번째 → 사실 조각 표시 · 가림 · 출구 대조) → 3R needs-attention 3(medium · 조각 누락이 가림 · 출구를 함께 무력화 / 새 칸이 발송 차단에 안 걸림 / 고친 차이로 새 사실이 학습 = 같은 부류 세 번째 → **허용 목록으로 반전 = I16**: 프롬프트에는 사람이 본 뼈대만 · 칸 = 발송 차단 규격 · 자동 학습 = 모양 · 형식 · 지운 표현 · 새 글귀는 사람이 받아들인 것만) → 4R needs-attention 2(medium · 가이드라인 문구 칸 우회 = 같은 문으로 / 뼈대 존재 ≠ 확인 = `review.gen` 주입 자격 · 견본도 확인 뒤) + 칸 잔존 = 재생성 조건 명시(K12-3) → 5R needs-attention 2(medium · 직접 정정이 미확인 추출본 승인 = 확인 대상을 추출본으로 분리 · `phrase_source` / 다른 세대 승인 = 화면이 본 세대만 · 409 · 같은 세대 추출 불변) + [범위 밖이었으나 이 설계서] 날짜 칸 규격 정정 → 6R needs-attention 1(medium · 재추출이 사람이 고친 문구를 덮음 = 칸별 병합) → 7R needs-attention 1(medium · 행 재배치 때 사람 문구 승계 = 5R~7R 같은 뿌리(사람 글과 AI 글이 한 행) → 구조 처방: 사람 글은 성격별 사람 행 · 읽을 때 덮음 · 추출은 사람 행 무관 · 병합 규칙 삭제) + [범위 밖이었으나 이 설계서] K6-2 옛 조건식 정정 → 8R needs-attention 1(medium · 학습 미완 뒤 직접 정정이 미완을 지움 = `guidelineGen` 은 학습 완료였을 때만 승계) → **9R approve(1028)** |
| 3 | 설계서 구조체크 결함 0 | Codex 11R approve + [범위 밖이었으나 이 설계서] 시험 절 옛 이름 정정 → 4회차 2(DC15 K14-1 끝 문장이 「반복 3건 = 쓸 것 자동」으로 읽힘(앞 문장과 모순) · DC16 자동 학습 「지운 표현」에 사실 문장이 섞여 프롬프트에 듦 = I16 위반 → 지운 표현도 후보 칩 · 자동 = 형식 값만) · 원장 결함 덮음 대조 V1~V26(V13 = 결함 아님) · F1~F17 전부 덮음(기계 대조) → Codex 12R approve + [범위 밖이었으나 이 설계서] I16 끝 문장 옛 문구 정정(DC17) → **5회차 결함 0**(옛 이름 · 지운 개념 · 옛 문구 전수 grep 잔존 0 · 원장 덮음 대조 V1~V26 · F1~F17 · Harold 5축 대조 · 대장 점검표 R1 · R6 · R8 · R12) · Codex 10R needs-attention 1(medium · 초기화 뒤 옛 확인 요청이 목소리 복원 = 초기화가 대기 추출본 비움 · 확인은 유효한 대기 추출본에만 · 시험 추가) + 4회차 덜어내기(확인 기록 · 확인된 묶음 = 상태 행 한 칸 `reviewed` · 따로 두던 행 · `review` 칸 · 메모리 타입 하나 삭제) · Codex 11R 진행 · 3회차 1(DC14 다시 배우기 · 문안 추가마다 확인 전까지 목소리가 빠짐(자동마케팅 회차 = 목소리 0) = 확인된 묶음 · 확인 대기 묶음 분리 · 생성은 마지막 확인된 묶음) · R1 · R6 · R8 · R12 점검표 대조(같은 판정 두 벌 0 · 대기 상태 = 사람 판정 예외 · 자동 재시도 0 · 모든 쓰기 = 상태 행 잠금) · `design-core/brand-profile.ts` = 문구 아닌 칸만 읽음(무관 확인) · Codex 10R 진행 · 2회차 2(DC12 「목소리 있음」이 확인 전 회사를 목소리 회사로 돌려 집 규칙도 예시도 없는 중간 상태 = I3 를 「주입할 목소리가 있다」로 · DC13 I16 적용 범위(이관 전 생산자는 옛 동작) 명시) 정정 · 3회차 진행 · 1회차 11(DC1 옛 이름 measureShape · DC2 지운 베끼기 검사 잔존 · DC3 phrase_source 잔존 · DC4 초기화 범위 · DC5 묶음 0 이 묶음 A 칸에 기댐 · DC6 새 행이 정리 워커에 지워짐 · DC7 추천 안 이름 키 · DC8 알림톡 원문 출처 모호 · DC9 영향표 소비처 7 줄 · DC10 시험 절 · DC11 대장 R24 줄) 정정 · 2회차 진행 |
| 4 | 구현 묶음 0 → A → B → C | 1028 · backend tsc 0 · frontend tsc 0 · vitest 716파일 10,525건 · 새 SQL 시험 DB EXPLAIN 0 오류 · 설계와 다르게 둔 것: 견본 = 성격마다 한 호출 병렬(합친 한 호출 아님) · 기호 개수 옵션 이름 `allowedSymbolCount` · 추출 실패 = 상태 행 맨 위 `extractError` · 학습 주소 = 옛 `extract-guideline` 유지(R13 면제 경로) · HTML · SNS 생산자 = `scope: 'tone'` · DM · 인앱 · 이메일 다듬기 = 광고 여부 모름 → `isAd: true` · 완료 상태 값 = `completed` 가정(Q-D3 실측 대기) · 재해시 스크립트 = ENV-1 결과 뒤 |
| 5 | 구현 Codex 리뷰 approve | 1R needs-attention 5(high 2 · 같은 세대 뒤엣 추출이 앞 결과를 덮어 화면이 본 적 없는 결과가 확인됨 = 같은 세대 추출 불변 · 시작 · 저장 판정 한 함수 `extractDoneFor` / 키트 한 칸 고침이 금지어 · 넣을 말 · 슬로건을 비움 = 요청에 든 칸만 병합 · medium 3 · 빈 견본에 이름만 붙어 5 걷힘 = 뿌리 `ensureSenderName` 빈 본문 그대로 + 견본 쓸 글 판정 / 할인율 숫자가 날짜 근거 = 단위별 키 대조 / 학습 실패 뒤 재시도가 문안 중복 추가 = 같은 글 한 행(추출 · 한 건 추가 둘 다)) 전부 수용 · 덧 = 바깥 catch 크레딧 표식 세대 · 라우트 손잡이 시험 5(변이로 3 실패 확인) · vitest 717파일 10,532건 · tsc 0 → 2R needs-attention 2(medium · 이름과 칸이 같은 줄이면 무내용 견본 과금 / 「10.5 %」 · 「1.5~2배」 · 「3주년」 숫자가 날짜 근거 = 1R 과 같은 부류 두 번째 → 이유 = 빼기 · 제외 목록 꼴 처방 → 구조 처방: 날짜 근거 = 쌍 키(월 · 일 한 덩이 · 쌍으로만) + 단위 키(단위 뒤 경계) 두 갈래 · 제외 목록 0 / 견본 = 칸 · 이름을 다 지우고 남는 글자로 판정) · 변이로 2 실패 확인 · vitest 717파일 10,534건 → 3R(1차 = 모델 용량 초과로 멈춤 · 같은 요청 재실행) needs-attention 4(medium · 포함관계 이름 · 「LED-3」 의 D-3 · 「11/5」 근거의 「11월 5일까지」 안 「5일」 재검사 · 「오후 3시쯤」 = 같은 두 자리 세 번째 → 이유 = 출력 · 근거를 다른 문법으로 읽음(같은 판정 두 벌 R1) · 빼는 순서 → 구조 처방: 날짜 = 문법 하나(출력 꼴을 근거에도 그대로 · 사람 말투만 더함) · 위치 토큰 겹침 없음 · 바꾸기도 위치 · D-n 왼쪽 경계 / 견본 = 덮는 구간 표시 뒤 덮이지 않은 글자) · 변이로 3 실패 확인 · vitest 717파일 10,535건 → 4R needs-attention 1(medium · 공유 시각 꼴이 「오후 3시간」 을 시각으로 읽음 = 「시」 뒤 (?!간)) · 변이로 1 실패 확인 → **5R approve(1028)** · 사람 글의 점 날짜(11.5) · 범위 꼬리는 쌍 키만 낸다 = AI 가 「5일까지」 처럼 꼴을 바꾸면 직접 채울 칸(안전한 쪽 실패 · 그대로 옮긴 「11.5」 는 출력 꼴이 아니라 그대로 둔다) |
| 6 | 커밋 · 배포 · Q · ENV · DML(Harold) | 대기 |
