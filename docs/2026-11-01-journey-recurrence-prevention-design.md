# 여정 · 문안 생산자 재발 방지 설계서 (2026-11-01)

> 접수 = Harold 1101 「여정이라는 기능 자체를 완벽하게 구조체크 · 다신 반복되지 않게」 · 브레인스토밍(5역할 · 교차 1R · 회의론자 최종 검증) 수렴 · Harold 「추천하는 방식으로 진행 · 설계안 Codex 닫힐 때까지 · 구현 · 구현 Codex 닫힐 때까지」.
> 사실 장부 = `docs/2026-11-01-journey-full-structure-check.md`(결함 J1~J14 · 놓친 이유 M1~M7 · 제품 전체 뿌리 X1~X4). 이 문서는 처방만 쓴다.
> 결함 기록 = `status/BUGS.md` B-1101-2(여정 혜택 · 화면) · B-1101-3(스팸 오탐).

## §0 Harold 결정 (1101 · 「추천하는 방식으로」)

| # | 결정 | 내용 |
|---|---|---|
| D1 | 검사 안 한 문안 | AI 문안은 **즉시 검사**(금지어 · 혜택 · 링크 · 080 · 바이트 · 로컬 스팸 점수 · 무료 0초)를 통과해야 화면에 나온다. 통신사 검사는 저장된 판에 자동으로 돌고, 끝날 때까지 「확인 중 · n분째」 + 켜기 잠금. 즉시 검사는 「통과」라 부르지 않는다. |
| D2 | 자동 통신사 검사 돈 | 지금 단가표대로 차감 · 생성 전 안내에 합쳐 보인다. 같은 글은 다시 차감하지 않는다(§3 C7 재사용). |
| D3 | 여정 AI 와 혜택 | AI 는 **사람이 준 혜택만** 문안에 쓸 수 있다(옛 결정 「여정 · 다듬기에서 AI 는 혜택을 쓰지 않는다」 = `copy-benefit-detector.ts` 245~252 주석을 뒤집는다). 지어낸 혜택은 여전히 자리표시. |
| D4 | 배포 | 두 번. 배포 1 = 지금 운영에서 돈 · 문안이 잘못 움직이는 것과 이번 증상. 배포 2 = 출구 표식 · 메모리 · 점검 응답 · 3단 화면. |
| D5 | 채널 이름 | 제품 전체 SMS · LMS · MMS(1026 결정 「여정 화면 = ~ 문자」를 뒤집는다 · R1 시험 뒤집기). |

## §1 보장 (유료 고객에게 · 이것이 시험의 기준)

- G1 사람이 준 값(질문표 혜택 · 링크 · 칸에 사람이 직접 친 혜택)은 어느 AI 단계에서도 지워지거나 자리표시로 바뀌지 않는다.
- G2 화면의 문안에는 늘 검사 상태가 붙는다(5어 = 검사 전 · 검사 중 · 확인 중 · 통과 · 고칠 것).
- G3 「확인 중」 판정은 자동 행동(재작성 · 정지 · 차감)을 일으키지 않는다.
- G4 채널 이름은 SMS · LMS · MMS 하나.
- G5 모든 고객 문안 생산자는 AI 메모리 + 브랜드 보이스를 같은 자리에서 받는다.

## §2 배포 1

### B1-1 혜택 판정 한 벌 (J1 · X2 · D3)

- **판정** = 값 비교 하나(`copy-benefit-detector.ts` `replaceInventedBenefits` / `findInventedBenefits`). 공용 탐지기에서 `stripUnauthorizedBenefits` 를 **지운다**.
- **원자 짝**(값 비교의 교차 약점 · 1018 실사고 · 같은 파일 252 주석 · Codex 설계 1R #3): 숫자 혜택은 「숫자 하나 + 그 숫자에 딸린 혜택 낱말」 짝으로 본다.
  - 짝 만들기(근거 · 출력 같은 함수): 한 절(효능 판정의 절 경계 재사용 · 마침표 · 줄바꿈 · 「·」 · 「/」) 안에서
    1. **숫자열** = 숫자 혜택 사이가 쉼표 · 「와 · 과 · 및 · 또는 · 이나」 · 공백뿐인 연속(「10%, 5%」 · 「10%와 5%」). 숫자열 바로 뒤(또는 바로 앞)의 혜택 낱말은 숫자열의 **모든 숫자**에 붙는다(Codex 설계 2R #5 · 「10%, 5% 할인」 = (10%:{할인}) · (5%:{할인})).
    0. **범위**(「10~20% 할인」 · 「10-20%」 · 「1만~3만원」)는 숫자 둘이 아니라 **범위 원자 하나**(아래끝 · 위끝 · 단위 · 종류)다. 사는 조건 = 근거에 같은 아래끝 · 위끝 · 단위의 범위 원자가 있고 종류 ⊆. 범위를 읽지 못하는 꼴(단위가 한쪽만 · 숫자 셋 이상)은 덩어리 통째 죽음(fail-closed). `~` · `-` 를 숫자열 구분자로 쓰지 않는다(Codex 설계 3R #5). 근거 「10% 적립 · 20% 할인」 → 출력 「10~20% 할인」 죽는다.
    2. 그 밖의 혜택 낱말(할인 · 세일 · 적립 · 쿠폰 · 증정 · 사은품 · 페이백 · 캐시백 · 포인트 · 무료배송 · 반값) 하나하나는 **가장 가까운 숫자(열) 하나**에 붙인다(같은 거리면 앞 · 「10% 할인」 꼴). `findBenefitSpans` 의 덩어리 합치기(146~158)와 상관없이 숫자마다 따로 짝이 된다 → 「10% 할인 5% 적립」 = (10%:{할인}) · (5%:{적립}).
  - 사는 조건 = 출력 짝 (v, K) 마다 근거에 값 v 인 짝 (v, G) 가 있고 **K ⊆ G**. 일반 낱말 예외 없음(「할인」도 근거 짝에 있어야 한다). K 가 빈 집합(종류 없는 숫자)은 **그 절에 숫자가 하나뿐**이고 v 가 근거 값일 때만 산다 · 숫자가 둘 이상인 절에서 종류 없는 숫자 = 모호 = 죽는다(자리표시 · fail-closed). 숫자 없는 구체 낱말(쿠폰 · 사은품 · 무료 …)은 지금처럼 근거 글에 있어야 산다.
  - 예: 근거 「첫 구매 10% 할인쿠폰」(10%:{할인, 쿠폰}) → 「10% 할인 쿠폰」 · 「10% 할인」 · 「10% 쿠폰」 · 「10%할인쿠폰」 · 「할인 10%」 · 「최대 10%까지 할인」 · 「10%나 할인」 산다 / 「20% 할인쿠폰」 · 「10% 적립」 · 「무료배송」 · 「사은품 증정」 죽는다. 근거 「10% 할인 · 5% 적립」 또는 「10% 할인 5% 적립」 → 「5% 할인」 · 「10% 적립」 죽는다(구분점 유무 둘 다). 근거 「10% 적립 · 5% 할인」 → 출력 「10%, 5% 할인」 죽는다(10% 할인이 됨). 근거 「10%, 5% 할인」 → 「10% 할인」 · 「5% 할인」 산다.
- **AI 영업**: 영업 모듈은 「허가 인용문에 글자 그대로 있는 덩어리만」을 일부러 쓴다(LESSONS 1018 R1). 함수 몸통을 `sales-outreach-copy-guard.ts`(신설) `stripUnlicensedQuoteBenefits` 로 **옮기고**(원본 복사 · 동작 같음) 영업 파일만 부른다. 호출 자리 전수(소스 추출 · 1101 grep): `sales-outreach-produce.ts` 2099 · 2373 · 2712 · 2721 · 2753 · 3489 · 3561 · 3567 · `sales-outreach-jobs.ts` 363 · 1666 · `sales-outreach-exemplar-mask.ts` 268.
- **바꿀 생산자**(옛 판정 → 값 비교): `journey-ai-generator.ts` 767~768 · 1026 · 1128~1129 · 1282 · `journey-ai-editor.ts` 251~252 · `journey-builder.ts` 653 · `journey-step-diagnosis.ts` 400~401 · `agency-send-refine.ts` 81 · `inapp-quick-action.ts` 161 · `sns-caption-ai.ts` 520 · (구현 때 R33 래칫이 더 찾음) `sns-caption-ai.ts` 사진 초안 문장 거름 `keepPhotoSafeSentences` 211~223(면허 = 사진 속 글 · 글자 대조였음). 「바뀌었으면 버림」꼴(agency · inapp quick · 여정 1282)은 `findInventedBenefits(...).length > 0`.
- **근거**(B1-3 규칙): 쓰기 모드 = 사람 값 · 고치기 모드(다듬기 · 편집 · 재작성) = 사람 값 ∪ 지금 본문.
- **시험**(R13 갱신 · 신규 뿌리 R33 = 판정 한 벌 + 양방향):
  - 변환 규칙 표(손 예시 아님): 근거 혜택마다 공백 넣기 · 빼기 · 붙여 쓰기 · 「쿠폰」 생략 · 「할인」 생략 · 숫자만 · 어순 바꿈 · 사이 말 끼움 → 산다. 값 바꿈 · 종류 바꿈 · 교차 짝(구분점 유무) · 지어낸 낱말 → 죽는다. 1101 로컬 재현 다섯 꼴 고정 행.
  - 혜택 **판정** 함수(혜택 덩어리 파서를 부르는 export) = 하나(래칫) · `stripUnauthorizedBenefits` 이름 저장소 0 · 영업 전용 함수는 영업 파일 밖 호출 0.
  - `producer-scan.ts` 30 `BENEFIT_CT` 에서 옛 이름 삭제 · 영업 전용 이름은 R13 면제(이유 줄).

#### B1-1a 짝 판정 구조 교체 (★ 1101 구현 6R 뒤 · Harold 「구조안으로 진행」)

- **사실**(1101 실행 출력):
  - 구현 1R~6R 동안 Codex 반례마다 붙음 규칙을 덧댔다. 표지 승부 · 조건 금액 빼기 · 제공 묶음 · 양쪽 표지 충돌이 그렇게 붙었다.
  - 6R에도 같은 부류 2건이 나왔다. 하나는 근거 「5천원 쿠폰 증정은 10% 적립과 중복 적용됩니다.」가 「10% 쿠폰」을 허가하는 것이다. 다른 하나는 「이용권」을 조건 「이용」으로 읽어 「적립률 10% 쿠폰: 5천원 이용권」이 「10% 쿠폰」을 허가하는 것이다.
  - 흔한 사람 혜택 문장과 지어낸 짝 47개 표에서 14개가 틀렸다.
    - 근거와 같은 글이 죽는 꼴 6개: 「3만원 이상 구매 시 5천원 할인」 · 「2만원 이상 구매 시 3천원 쿠폰」 · 「10% 포인트 적립」 · 「10%씩 적립」 · 「가입 쿠폰: 5천원 이용권을 드립니다.」 · 위 6R 문장.
    - 바꿔 쓴 글이 죽는 꼴 6개.
    - 거짓 허가 2개.
- **왜 반복되는가**:
  - 근거와 출력을 같은 문법으로 읽되 모를 때의 처리가 갈린다. 근거는 허가 0, 출력은 가까운 숫자에 붙인다.
  - 그래서 문법이 모르는 꼴은 같은 글도 죽는다.
  - 승부 규칙(표지 · 조건 금액 빼기)이 틀리면 짝이 다른 숫자로 옮겨 가 거짓 허가가 된다.
  - 한국어 꼴은 끝이 없어 규칙을 덧대는 것으로는 닫히지 않는다(LESSONS_BACKEND 1018 「같은 부류 세 번 = 차단 목록의 한계」와 같은 꼴).
- **원칙 둘**:
  - (P1) 글자 그대로는 산다.
  - (P2) 짝은 확실할 때만 허가하고, 모르면 허가 0이다(근거). 출력 쪽은 모르면 더 엄하게 본다.
  - 남는 틀림은 「바꿔 쓴 글이 자리표시가 됨」(안전 쪽 · 사람이 채움) 하나뿐이다.
- **① 글자 그대로 허가**(`inventedSpans` · 설계 1R #1 · #2 · P1 주석 반영):
  - 절은 `ATOM_CLAUSE_BREAK_RE`로 자른 구간이다(소수점 예외). 판정 원자와 같은 자르기를 함수 하나로 쓴다.
  - 혜택 자리(`findBenefitSpans`) 하나마다 그 자리를 덮는 **절 묶음**(첫 절 ~ 끝 절 · 사이 끊김 글자 포함)을 본다.
  - 이 묶음이 근거의 **연속 절 묶음**과 같으면 그 자리는 대조하지 않고 바꾸지도 않는다. 같다는 조건은 절 글이 모두 같고 사이 끊김 글자도 같은 것이다.
  - 비교는 정규화 전 글로 한다(반각 · 공백 연속은 한 칸 · 앞뒤 공백 제거). **공백은 지우지 않는다.** 그래야 「쿠폰1 5%」와 「쿠폰 15%」가 같아지지 않는다.
  - 줄을 넘는 자리(「무료\n배송」 · 「16\n프로」 · 줄바꿈 덩어리 합치기)도 묶음 전체가 근거와 같을 때만 산다. 같지 않으면 지금처럼 자리 전체를 대조하고 바꾼다. 잘라 내지 않는다.
- **② 짝 고르기**(`benefitAtoms` · 근거 · 출력 같은 함수 · 다른 것은 「후보 둘」의 처리뿐):
  - **묶음 = 허용 합성 표의 이웃만**(설계 2R #2):
    - 붙여 쓰거나 공백만 사이에 둔 두 낱말이 표에 있는 차례일 때만 한 묶음이다. 표 = 할인→쿠폰 · 쿠폰→할인 · 적립→쿠폰 · 적립→포인트 · 포인트→적립 · 쿠폰→증정 · 포인트→증정 · 사은품→증정(같은 뜻 세일 · OFF · DC = 할인).
    - 이어지는 연쇄는 이웃마다 표에 있을 때만 이어진다(「할인 쿠폰 증정」 = 한 묶음).
    - 「할인 사은품 증정」 · 「할인 쿠폰 적립」은 끊긴다. 할인이 사은품 값을, 쿠폰이 적립 값을 함께 갖는다는 증거가 없기 때문이다. 나르는 낱말이 있다는 것만으로 묶지 않는다.
    - **값 종류는 묶음에 하나**(설계 3R #2): 한 묶음에 값 종류(할인 · 적립 · 페이백 · 캐시백)가 둘 이상이면 그 묶음은 근거 허가 0이다. 「10% 적립 쿠폰 할인율은 미정」에서 적립 → 쿠폰 → 할인 연쇄가 적립률을 할인율로 옮기는 길이 여기서 닫힌다. 이웃 간선만으로 연쇄 전체가 같은 값을 갖는다고 보지 않는다.
  - **후보**: 묶음의 **바로 앞 · 바로 뒤 숫자열**만 본다. 사이에 다른 묶음이나 숫자가 없어야 한다. 다음 경우 그 쪽은 후보가 아니다.
    - 그 숫자가 조건 금액이다(③).
    - 사이에 **구분**이 있다: 쉼표 · `+` · `&`, 묶음 바로 뒤 「와 · 과 · 및 · 그리고 · 에」, 사이의 「및 · 그리고」. 구분은 목록의 경계다. 「·」 · 줄바꿈이 절을 끊는 것과 같은 자리다.
  - **근거**(허가):
    - 후보가 하나이고 그 쪽으로 붙음(`ATOM_POST_GAP_RE` · `ATOM_PRE_GAP_RE` · 「씩」 추가)이면 그 숫자에 붙는다.
    - 후보가 하나인데 붙음이 아니면 허가 0이다(문법이 못 읽은 사이 = 모름).
    - **후보가 둘이면 허가 0**이다. 이웃 숫자가 다른 낱말을 가졌는지 · 표지 · 꼴 방향으로 고르지 않는다.
    - **방향 섞임 = 허가 0**(설계 2R #1 · 3R #1): 숫자의 **바로 앞과 바로 뒤에 둘 다 묶음이 있으면**(구분 없이 · 사이 글이 붙음이든 아니든 · 그 묶음이 배정됐든 보류됐든) 그 숫자의 짝은 모두 허가 0이다.
      - 실제 배정 결과로 세지 않는다. 후보가 둘이라 보류된 앞쪽 관계(「기존 5%에서 적립률 10% 쿠폰」)나 붙음으로 못 읽은 앞쪽 관계(「적립 비율 10% 쿠폰」)도 섞임으로 센다.
      - 「적립률 10% 쿠폰: 5천원 이상 구매 시 증정」의 쿠폰이 10%로 가는 길이 여기서 닫힌다.
      - **주는 동작(증정)도 예외 없음**(구현 4R · 승인 설계 복귀): 구현 1R~3R에 「숫자 뒤 증정만 묶음은 섞임에 세지 않음」 예외를 넣었다가 라운드마다 빈틈이 나왔다(숫자 앞 증정 · 다른 대상 증정 · 숫자열 · 따로 선 증정 항목 「할인: 5천원 증정: 키링」). 예외를 지웠다. 비용은 아래 「받아들인 비용」에 적는다.
        - 반복 경위: 1R에서 필요한 것(숫자 앞은 센다) 하나만 고쳐야 했는데, 붙음 · 대조 제외까지 넓혀 2R에서 연결이 끊겼다. 2R에서 승인 설계와 다른 점을 이 하나로 줄였다(덧댄 코드 삭제).
  - **출력**(검사): 후보가 하나면 붙음과 상관없이 그 숫자, 둘이면 둘 다, 없으면 붙지 않는다.
  - **지우는 것**: 표지 승부(`ATOM_POST_MARK_RE` · `ATOM_PRE_MARK_RE`) · 이웃 판정(`fwdHasPost` · `backHasPre`) · 조건 금액 빼기(`target`) · 제공 묶음(`ATOM_PROVIDE_WORDS` · `ATOM_PROVIDED_WORDS`) · 붙지 않은 낱말의 거리 짝.
- **③ 조건 금액**(설계 1R #3 · #4):
  - 판정: 숫자 뒤 `(이상|이하|초과|미만)?` + `(구매|결제|주문|이용)` + **조건 어미**(시 · 시에 · 하면 · 하시면 · 할 때 · 하실 때 · 하는 경우) + **낱말 끝**(어미 뒤 한글 없음 · Codex 구현 1R #2). 그래서 「결제 할인」 · 「이용권」 · 「구매 고객」 · 「결제 시점」 · 「구매하면서」는 조건이 아니다.
  - 조건 금액은 낱말을 받지 못하고, 그 쪽은 후보가 아니다. 숫자를 빼서 짝을 다른 숫자로 옮기지 않는다. 그 너머 숫자는 바로 옆이 아니라 후보가 될 수 없다.
  - 조건 쪽을 후보로 세지 않는 이유(설계 2R #1 처방 불수용):
    - 조건 어미가 붙은 문턱 값은 혜택 값이 될 수 없다. 반대쪽 「숫자 + 낱말」의 붙음과 경쟁하는 값 읽기가 아니다.
    - 반례의 거짓 짝은 방향 섞임(②)으로 닫힌다.
    - 조건 쪽을 후보로 세면 「10% 할인 (5만원 이상 구매 시)」 · 「10% 할인 혜택은 5만원 결제 시 제공」처럼 가장 흔한 조건부 혜택이 바꿔 쓰는 순간 모두 자리표시가 된다(사본 측정).
- **④ 조건 역할 일치가 먼저**(설계 1R #4 · 2R #3):
  - 원자의 짝 찾기는 **같은 값 · 같은 역할(조건 금액 여부)** 의 근거 원자에서만 한다. 다른 모든 규칙보다 먼저다.
  - 출력 조건 금액 = 근거에 같은 값의 조건 금액이 있으면 산다(「3만원 이상 구매 시」).
  - 출력 혜택 값(종류 붙음 · 조건 아닌 종류 없는 숫자) = 근거의 같은 값 혜택 원자에서만 찾는다. 종류 없는 숫자는 지금 규칙(절에 숫자 하나)을 그 안에서 적용한다.
  - 그래서 근거 「3만원 이상 구매 시 5천원 할인」에서 「할인 5천원에서 3만원」 · 「혜택은 3만원입니다」는 죽는다.
- **받아들인 비용**(안전 쪽 · 자리표시가 되고 사람이 채운다):
  - 구분 없이 이어 쓴 목록(근거 「10% 할인 5% 적립」 · 「할인 10% 적립 5%」)은 숫자 사이 낱말이 후보 둘이고, 가운데 숫자는 앞 · 뒤 묶음을 다 가져 방향 섞임이다. 그래서 짝 허가가 없다. 그대로 쓰면 ①로 살고, 하나만 뽑아 쓴 글(「10% 할인」 · 「5% 적립」 · 「적립 5%」)은 죽는다. 쉼표 · 「·」 · 「와」 · 「에」 · 줄바꿈 · 「+」로 나눈 목록은 산다.
  - 문법이 못 읽는 사이(「10%를 포인트로 적립」 · 「적립 비율 10%」)는 바꿔 쓰면 죽는다.
  - 숫자 앞뒤에 다 낱말이 붙은 꼴(「적립금 5천원 증정」 · 「쿠폰 5천원 증정」)은 방향 섞임이라 짝 허가가 없다. 그대로 쓰면 ①로 살고, 바꿔 쓴 글(「적립금 5천원을 드려요」 · 「5천원 쿠폰」)은 죽는다. 한쪽에만 붙은 꼴(「신규 가입 시 5천원 쿠폰 증정」)은 바꿔 써도 산다.
- **측정**(버리는 사본 v4 = 이 절 그대로 · 1101 실행 출력):
  - 흔한 꼴 · 지어낸 짝 · 1R~6R 반례 · 설계 1R~3R 반례 66개에서 지금 판정은 17개 틀림(그중 거짓 허가 9) + 근거와 같은 글 28개 죽음이다.
  - 사본 v6(이 절 그대로)은 4개 틀림(위 비용 꼴 · 전부 안전 쪽) · 근거와 같은 글 0개 죽음 · 거짓 허가 0이다.
  - 기존 반례 시험 32건 중 3건이 위 비용 꼴(구분 없는 목록에서 하나 뽑기 = 산다)을 기대한다. 이 3건(안의 기대 6줄)은 P2 결정으로 뒤집는다(§5에 적는다).
- **시험**(R33 넓힘 · 손 고른 통과 예시가 아니라 규칙을 기계로 돌린다):
  - (T1) 글자 그대로: R33 표 · 혜택 판정 시험 파일의 `dead(출력, 근거)` 근거 · 흔한 꼴 표의 **모든 근거 글**을 소스에서 뽑는다. 출력 = 근거면 지어낸 것 0이고 바꾼 글은 원문이다. 줄을 넘는 근거(「아이폰 16\n프로 10% 할인」)를 포함한다.
  - (T2) 흔한 꼴 표(살 것 · 죽을 것 · 받아들인 비용 = 죽음): 위 62개를 R33에 고정한다. 설계 2R 반례(「적립률 10% 쿠폰: 5천원 이상 구매 시 증정」→「10% 쿠폰」 · 「가입 혜택: 5천원 할인 사은품 증정」→「5천원 사은품 증정」 · 「10% 할인 쿠폰 적립」→「10% 적립」 · 「3만원 이상 구매 시 5천원 할인」→「혜택은 3만원입니다」)와 조건 역할 표(근거 조건 × 출력 비조건 · 종류 있음 / 없음 · 절에 숫자 하나 / 둘), 설계 3R 반례(「기존 5%에서 적립률 10% 쿠폰: 5천원 이상 구매 시 증정」 · 「적립 비율 10% 쿠폰: 5천원 이상 구매 시 증정」→「10% 쿠폰」 · 「10% 적립 쿠폰 할인율은 미정」→「10% 할인」 · 역방향 「10% 할인 쿠폰 적립률은 미정」→「10% 적립」)를 포함한다. 설계 1R 반례(「쿠폰1 5% 할인」→「쿠폰 15% 할인」 · 「쿠폰 5천원 포인트 적립 비율 10%」→「5천원 포인트 적립」 · 「적립률 10% 쿠폰: 5천원 결제 할인」 · 「적립 비율 10% 쿠폰 5% 할인」→「10% 쿠폰」 · 「3만원 이상 구매 시 5천원 할인」→「할인 5천원에서 3만원」)를 포함한다.
  - (T3) 줄을 넘는 자리: 근거 「무료\n체험」 → 「무료\n배송」은 죽는다. 근거 「10% 할인」 → 「10% 할인\n20% 적립」은 20%가 죽는다.
  - (T4) 지금의 R33 양방향 표는 그대로 통과한다. 반례 시험은 위 3건만 뒤집는다.
- **영향**(판정 함수 하나 · 소비처 = `findInventedBenefits` · `replaceInventedBenefits` · `replaceInventedBenefitsInHtml` · `replaceInventedBenefitsDeep` 쓰는 전 생산자 · 1101 grep = 본체 포함 13파일 · `services/ai.ts`는 import만 · 시그니처 · 반환 꼴 불변):
  - 사는 쪽으로 바뀜: 근거와 같은 글(줄 넘음 포함) · 조건 금액이 낀 흔한 꼴 · 나르는 낱말 묶음 · 「씩」.
  - 죽는 쪽으로 바뀜: 구분 없는 목록에서 하나 뽑기 · 후보가 둘인 낱말 · 문법이 못 읽는 사이를 근거가 더는 허가하지 않는다.
  - `BenefitAtom`에 `cond`가 더해진다. `benefitAtoms`는 이 파일 밖 호출 0이다(1101 grep).
- **범위 밖(기록만)**: 줄 단위 표 꼴(근거 「적립\n10%\n할인\n5%」에서 출력 「할인\n10%」)은 절마다 숫자 하나라 지금 판정에서도 산다. 이번 교체와 무관하다.

### B1-2 혜택 · 링크 입력칸 살리기 (J12)

- 사실: `onFillBenefit` · `onFillUrl` 를 넘기는 화면이 제품에 0(`JourneyStepStudio.tsx` 66 · 68 정의만 · grep 1101) → 「입력하면 모든 스텝에 한 번에 채워 드려요」 줄이 어디에도 안 뜬다.
- 처방: `JourneyWorkspace.tsx` 의 `<JourneyStepStudio>`(910~933)에 두 함수를 넘긴다. 동작 = 서버 `POST /operator/journeys/:id/copy-facts`(B1-3) — 사람 값을 저장하고 그 여정의 **모든 문자 칸** 자리표시(`[혜택 안내: 직접 수정해주세요]` · 링크 자리 `LINK_SPOTS`)를 값으로 바꾼다. 화면은 응답의 칸 글로 바꾼다.
- **활성 판 계약 재사용**(Codex 설계 1R #5): 칸마다 기존 칸 갱신 길(`journey-builder.ts` 1365~1425 = 칸 UPDATE + 켜진 여정이면 `createStepSnapshot` + `journey_pretest_schedules` 삭제)을 **그대로** 부른다 · 여정 잠금 하나 · 한 트랜잭션(원장 · 칸 글 · 새 미검사 판 · 검사 기록 무효화가 한 번에) · `assertStepEditAllowed` 그대로(못 고치는 상태면 기존 오류 · 원장도 안 씀).

### B1-3 사람 값 원장 (J2 · J6 · C4)

- **DDL-A**: `journeys.copy_facts jsonb NULL`. 혜택과 링크는 **따로** 정한다(Codex 설계 1R #6):
  - 모양 `{ benefits: null | [] | [{ text, by: 'question' | 'fill' | 'approve', at }], link: null | { url, by, at } | { omit: true, by, at } }`.
  - benefits: null = 아직 안 정함(옛 근거) · [] = 사람이 「혜택 없음」으로 정함 · 1개 이상 = 정함. link 도 null · 정함 · 뺌 셋. 열 자체가 NULL 이면 둘 다 null.
  - benefits 최대 5 · text 200자 · url = `voice-form-slots` `cleanFormLink` 통과값.
- **읽는 함수 하나** `journeyCopyFacts(row)` → `{ benefit: { state: 'unset' | 'none' | 'set', ground }, link: { state: 'unset' | 'omit' | 'set', url } }`.
- **쓰는 길 셋**(전부 CT `writeJourneyCopyFacts` · 혜택 · 링크 각각 따로 덮는다 · 한쪽만 쓰면 다른 쪽은 그대로):
  1. 생성: `generateJourneyPackage` 입력 `benefitText`(질문표 · null = 「없음」 · 빈칸이 아니라 질문표가 「혜택 없음」을 고른 경우) · `voiceForm.link` → 여정 INSERT(`journey-builder.ts` 421) 때 · by=question.
  2. 채우기(B1-2): by=fill.
  3. 승인(배포 2 점검 판): 본문에 있는데 원장에 없는 혜택 덩어리를 「혜택 줄에 넣기」 한 번 누름 · by=approve.
  - **본문에서 저절로 뽑지 않는다**(Codex 설계 1R #4): 칸 저장 요청의 어떤 표시도 사람 작성의 증거가 아니다 → 저장된 칸 글은 원장에 들어가지 않는다. 사람이 칸에 직접 친 혜택은 그 칸을 다시 고칠 때(고치기 모드 근거 = 지금 본문) 살아 있고, 다른 칸 · 새 칸으로 퍼뜨리려면 3번 승인을 거친다.
- **근거 규칙**(여정 생산자 전부 · 배포 1 은 생산자마다 이 함수 하나를 부르고, 배포 2 `finishCopy` 가 같은 함수를 부른다 — 규칙 두 벌 없음):
  - `journeyCopyGround(facts, mode, current)`: 쓰기 모드(생성 · 칸 넣기 · 다음 칸 · 날짜 칸) = benefit.set → 원장 글 · none → '' · unset → 옛 근거(생성 = 목표문 · 다음 칸 = 있는 칸 글 · 날짜 칸 = 목표문 · 칸 넣기 생성 모드 = 앞 칸 글) / 고치기 모드(다듬기 · 편집 · 재작성) = 위 + 지금 본문.
  - unset 여정은 가운데 판 「혜택 · 링크」 줄을 늘 보인다.
- **링크**: link.set 이면 생성 · 다듬기 · 칸 생성 · 다음 칸 · 날짜 칸 · 재작성 결과마다 `ensureOnceLink` · 다듬기 · 편집 · 재작성은 `rewriteDropsLinks(결과, 원문)` 이면 그 후보를 버린다(J6 · R32 넓힘). omit 이면 링크 자리 · 링크 줄을 지운다(`linkOmit` 기존 꼴).
- **J3 생성 지시문**: benefit.set 이면 자리표시 예시 문단을 넣지 않는다(`journey-ai-generator.ts` 395 · 403 · 411 · 443 · 484 · 513~617 블록을 「혜택 있음 / 없음」 두 판으로). 결과에 자리표시가 남으면 원장 혜택 첫째로 채운다(채운 칸은 플래그).
- **복제**: `journey-lineage.ts` 263(`jsonb_populate_record`)은 열을 통째로 옮긴다 — 계약 시험: journeys INSERT 문장 전수(소스 추출)가 copy_facts 를 옮기거나 통째 복제다.
- **DDL 안전망**: 쓰는 라우트 catch = `column` + `does not exist` → 503 `DB_MIGRATION_PENDING`(CLAUDE.md `db_alter_safety_net`) · 읽기는 열 확인(`information_schema` · 참 기억 · 거짓 5분 · `lineageColumnsReady` 꼴) · 없으면 unset.

### B1-4 스팸 판정 4값 + 같은 검사 이어 보기 (J8 · J9 · J15 · X4 · B-1101-3)

- **값**: `SpamVerdict = 'pass' | 'unconfirmed' | 'blocked' | 'error'`(`spam-test-queue.ts` 970) · 기다림(아직 진행 중)은 판정이 아니라 `pending` 상태로 따로 돌려준다(장애와 섞지 않는다 · Codex 설계 1R #1).
- **결과 행**: 「통신사 전달 성공 + 앱 보고 없음」으로 끝나는 **모든** 자리를 공용 판정 하나(`deliveredUnreportedResult()` = `unconfirmed`)로 바꾼다 — 45초 확정(`spam-test-queue.ts` 759 큐 · `routes/spam-filter.ts` 416 수동)과 시간 초과 분기 둘(`spam-test-queue.ts` 799~806 · `routes/spam-filter.ts` 465~478 · 지금 「성공을 봤으면 blocked」 · Codex 설계 2R #4). `blocked` 를 쓰는 길 = 확인 문자 수신(아래) 하나 + 통신사 결과 코드가 스팸 거절을 직접 말하는 경우(있으면 `sms-result-map.ts` 기존 표 그대로) · 계약 시험 = 결과 행에 `blocked` 를 쓰는 SQL 자리는 이 둘뿐(소스 추출). DDL-B: `spam_filter_test_results.first_result varchar(20) NULL` · `decided_at timestamptz NULL`(처음 쓴 판정 · 최종 확정 시각 · 늦은 보고가 덮어써도 남는 오탐 증거).
- **늦은 보고**: 기존 고침 길(`resolveSpamReportTest` · 10분 창)이 `unconfirmed` 행을 pass 로 고친다(blocked 를 고치던 것에 unconfirmed 를 더함) · decided_at 기록.
- **확인 문자**(창 닫힘 · Codex 설계 1R #2): DDL-C 표 `spam_test_probes`(§4 · result_id UNIQUE · phone · carrier · nonce · message_hash UNIQUE · claimed/sent/received/expired).
  - 검사가 닫힌 지 10분이 지나도 `unconfirmed` 인 행마다 큐 워커가 한 문장으로 **claim**(INSERT … ON CONFLICT (result_id) DO NOTHING · status=claimed) → 그 단말로 고정 무해 글 + nonce(「[한줄로 검사 확인] 7F3A2C」) 1통(같은 발신번호 · `insertTestSmsQueue`) → status=sent · deadline_at = sent_at + 5분.
  - 보고 짝짓기: 앱 보고의 문안 해시가 `spam_test_probes.message_hash` 와 같으면 **그 확인 문자 하나**에만 붙는다(nonce 로 해시가 유일) · 확인 문자 해시는 일반 검사 짝짓기(본문 일치 · 「진행 중 검사 하나」 대체 · `spam-test-queue.ts` 283~298)에서 **빠진다**(확인 문자 보고가 다른 검사를 통과시키지 않는다).
  - **본문 없는 보고**(Codex 설계 2R #3 · 3R #3 · `routes/spam-filter.ts` 523~524 본문 선택 · 559 빈 문자열): **확인 문자를 쓰는 단말**(`spam_test_probes` 에 그 번호 + 통신사로 보낸 기록이 한 번이라도 있는 단말 · 표에 phone · carrier 칸)은 본문 없는 보고를 **어떤 검사에도 붙이지 않는다**(열림 · 만료 상관없이 · 무시 + 로그). 확인 문자는 **본문 있는 보고를 보내는 단말에만** 보낸다 — 판정 자료 = DDL-E `spam_filter_devices.last_body_report_at timestamptz NULL`(Codex 설계 4R #2): 보고 라우트가 단말 확인(`routes/spam-filter.ts` 527~533 `UPDATE spam_filter_devices SET last_seen_at`) **같은 문장에서** 본문이 비지 않았으면 `last_body_report_at = NOW()` 도 쓴다(짝짓기 전 · 못 짝지은 보고도 반영). 확인 문자 자격 = last_body_report_at 이 최근 7일 안. NULL · 7일 넘음 = 확인 문자 없이 창 닫힘 = error(단말 확인 불가 · 경보). 열이 없으면(DDL 전) 확인 문자 0 · 같은 처리 · 보고 라우트는 열 확인 뒤에만 쓴다(없으면 last_seen_at 만 · 503 없음 = 보고 경로를 막지 않는다). 그 밖 단말(본문 없는 옛 앱 · 확인 문자 0)은 지금 규칙(진행 중 검사 하나 대체) 그대로.
  - 확인 문자가 deadline 안에 오면 원 행 = `blocked` 확정 · 안 오면 = `error`(단말 장애) + R14 경보 · 정지 사유로 쓰지 않는다(발송은 미룸 · 장애 상한은 기존 규칙).
  - 멱등 · 상한(R8): claim 뒤 발송 전 죽으면 claimed 가 2분 넘은 행만 한 번 다시 claim(attempts ≤ 2) · 그 뒤는 expired → 원 행 error. 결과 행 확정은 `WHERE result = 'unconfirmed'` 조건부 UPDATE(늦은 보고와 경합해도 한쪽만).
  - 앱이 10분 넘은 보고를 버리므로(`spam-test-queue.ts` 182) 그보다 늦은 꼬리는 「확정 뒤 수신」 집계로 따로 센다.
- **같은 검사 이어 보기**(J15 · Codex 설계 1R #1): 새 CT `spamCheckFor(key)` — 키 = 발송 꼴 글(광고 표기 · 080 · 표본 치환 적용 · `renderJourneySmsMessage` / `messageUtils` 같은 렌더) 해시 + 채널 + 제목 + 회신번호 + 회사 · 같은 한국 날짜.
  - 같은 키의 오늘 검사가 진행 중 · unconfirmed · 확인 문자 중이면 **새로 걸지 않고** `pending` 을 돌려준다(차감 0) · pass 로 끝났으면 pass(재사용) · blocked 확정이면 blocked · error 면 새 검사(장애 재시도 = 기존 상한 `SPAM_ERROR_RETRY_MAX`).
  - 부르는 곳 = 검사를 거는 자리 전부: `journey-pretest-validator.ts` 307~323(30초 기다림 → `spamCheckFor` 로 바꾸고 기다림 만료 = pending) · `spam-test-queue.ts` `autoSpamTestWithRegenerate` 1141(대행 · 자동발송 · 상시 운영 · 플래너가 여기로 온다) · `services/ai-line-spam.ts` 165. 수동 검사(사람이 누른 것)는 늘 새 검사.
- **소비처 8**(`agency-send-worker.ts` 413 · `auto-campaign-worker.ts` 1506 · `continuous-operator.ts` 1708 · 2338 · `planner-copy.ts` 262 · 여정 `journey-pretest-notifier.ts` 224 · **켜기 검증** `journey-pretest-validator.ts` `validateJourneyForActivation` 159~188 · 묶음 판정 · Codex 설계 2R #2): `switch` + `never` 로 4값 + pending 을 받는다. pending · unconfirmed = 자동 행동 0(재작성 · 정지 · 차감 · 발송 없음) · 다음 회차에 같은 키로 다시 묻는다(장애 횟수에 세지 않음). 확정 blocked 만 재작성 · 정지. **켜기 검증 · 묶음 판정 = 전부 pass 일 때만 통과** · pending · unconfirmed 는 「검사 중 · 확인 중」 + canActivate false(C5 점검 응답도 같은 함수).
- **재작성 후보 저장**(Codex 설계 2R #1): DDL-D `journey_pretest_candidates`(§4 · PK = snapshot_id · status generating · testing · passed · blocked · failed · claim_token).
  - 확정 blocked 를 본 회차: **claim 트랜잭션** = 사람 편집과 같은 `journeys` 행 잠금(`withJourneyValidationReset` 이 쓰는 잠금) 아래에서 그 칸의 **최신** snapshot 이 검사한 snapshot 과 같은지 확인 → 같을 때만 후보 행 INSERT(status=generating · claimed_at · claim_token · ON CONFLICT DO NOTHING) · 다르면(사람이 새 판을 커밋) AI 호출 전에 끝(차감 0 · Codex 설계 3R #1). 행을 얻은 손만 AI 호출 1회 · 차감 → 저장 = `UPDATE … SET body, subject, check_key, status='testing' WHERE snapshot_id = $1 AND status = 'generating' AND claim_token = $2`(늦게 돌아온 옛 손의 저장은 0행) → `spamCheckFor(후보 키)`.
  - **만드는 중 만료**(R6 · Codex 설계 3R #1): generating 이 10분을 넘으면 큐 워커가 `failed` 로 닫는다(새 유료 재작성 없음) → 그 판은 여정 정지 + 담당자 안내(「자동으로 고친 문안을 만들지 못했어요」 · 기존 재작성 실패 경로와 같은 사유) · 차감이 끝난 채 죽은 경우 = **크레딧 원장 환불**(Codex 설계 4R #1): 재작성 차감은 `runChargedAi` → `ai_credit_transactions`(선불 `balance_transactions` 아님) · 차감 멱등 키를 `journey-pretest-regen:${companyId}:${snapshotId}` 로 **고정**(지금 무작위 UUID · `ai-credit.ts` 438~442 · `runChargedAi` 의 `idempotencyKey` 인자 · 235 · 266) → 만료 때 `chargedAmountByKey`(144)로 실제 차감액을 읽고 `refundCredit`(462) 에 환불 키 `refund:journey-pretest-regen:${companyId}:${snapshotId}` + `originalIdempotencyKey` = 차감 키 · 금액 = 원 차감 실제 금액(차감 0 이면 환불 0).
    - **늦은 차감**(Codex 설계 5R): ① 정산 직전 확인 = `runChargedAi` 의 `accept` 에서 후보 행이 아직 `generating` 이고 claim_token 이 내 것인지 읽는다(아니면 쓸 결과 아님 = 차감 0). ② 그래도 확인과 만료가 엇갈려 차감된 경우를 위해 큐 워커가 `failed` 후보를 **만료 뒤 7일까지 매 주기 대조**한다 — 차감 키 실제 차감액 > 0 이면 `refundCredit`(같은 환불 키 · 멱등 · 이미 환불이면 0) · 7일이 지나면 대조를 멈추고 남은 건은 R14 경보(사람 확인).
  - 다음 회차: 후보 행이 testing 이면 **원문을 다시 보지 않고** 후보 검사를 이어 본다(pending = 보류 · pass = 안내 뒤 반영 · blocked = 여정 정지 · 재작성 없음 · regen_count 상한 1).
  - 판이 바뀌면(사람이 고침 · 새 snapshot) 옛 판의 후보는 그 판에 묶여 쓰이지 않는다(PK = snapshot_id · 새 판은 새 흐름).
  - pending 은 B1-4 닫힘 보장(약 17분 안 최종)으로 끝나고, 그동안 실행기는 판이 「검사 전」이라 발송을 미룬다(기존 관문).
- **닫히는 상태(R6)**: unconfirmed 는 10분 + 확인 문자 5분 + 재claim 2분 안에 pass · blocked · error 중 하나로 반드시 닫힌다(큐 워커 한 문장 · 시험 = 시계 앞당겨 전수 닫힘).
- **화면**: 수동 검사 창(`SpamFilterTestModal.tsx`)과 여정 · 한 줄 결과의 통신사 칩 = 4값 이름표(`Record<값, 낱말>` · 「확인 중 · n분째」). 화면은 서버가 그 검사를 **최종**(모든 행 pass · blocked · error)으로 돌려줄 때까지 15초 간격으로 읽는다 · 서버 응답의 `finalBy`(확인 문자 deadline + 2분)를 넘기면 「결과를 받지 못했어요」 최종 표시로 멈춘다(Codex 설계 1R #7).
- **측정 · 경보**: 하루 한 번 통신사 · 단말별 `first_result='unconfirmed'` 중 최종 pass 비율(오탐률) · 확정 뒤 수신 건수 → 1건 이상이면 R14 공용 경보 입구.
- **뒤집을 시험**: `spam-block-decide-1002.test.ts` 28 · 79 · 81~82(45초 = 차단 · 60초 화면 고정).

### B1-5 채널 이름 (J11 · X3 · D5)

- **주인 표** = `frontend/src/utils/campaign-axis.ts` `MSG_TYPE_LABEL`(이미 SMS · LMS · MMS) — 소문자 키(sms · lms · mms · kakao · email) 를 더해 유일한 주인. `journey-labels.ts` `STEP_CHANNEL_LABEL`(54~62)은 주인을 부르는 얇은 함수만 남기고(`stepChannelLabel` 이름 유지) 표 삭제 · `cdp-display.ts` 28~31 채널 표 삭제(「단문 SMS」 · 「장문 SMS」 넷째 이름).
- **화면 문장**: 「단문 · 장문 · 사진 문자」를 **채널 이름으로** 쓴 화면 · 서버 사용자 노출 문장을 SMS · LMS · MMS 로(프론트 28파일 중 채널 뜻 · 서버 `journey-builder.ts` 1545 · `journey-pause-reason.ts` 30).
- **면제**(채널 이름이 아닌 것 · 이유 줄): 약관(`pages/TermsPage.tsx` · 법률 문서는 Harold 결정 없이 바꾸지 않는다) · 「사진」이 이미지 뜻(`BuildCardsInput.tsx` · `sns-view.ts`) · **길이 구간**(`message-analysis.ts` 68~82 = 90바이트 이하 · 91~2,000 · 2,000 초과 분포 · Codex 설계 1R #8) — 길이 구간은 「90바이트 이하 / 91~2,000바이트 / 2,000바이트 초과」로 표기를 바꾸고 채널 시험 대상에서 뺀다.
- **시험 뒤집기**(R1 1026 → 1101): `root-ledger.test.ts` 2589~2611 을 「제품 전체 · 주인 파일 밖 채널 뜻 `단문|장문|사진 문자` 0(면제 이유 줄) · 이름 표 꼴 `(sms|lms|mms)\s*:\s*'` 주인 밖 0 · 살아 있음 = 주인 표 출력이 정확히 SMS · LMS · MMS 이고 여정 네 화면이 `stepChannelLabel` 을 부른다」로. 서버 오류 영문 금지(같은 파일 1158 · 2609)도 뒤집는다.

### 배포 1 남는 증상 (배포 2 전까지 · 보고에 적는다)

- 출구 표식(C2)이 없어 새 생산자가 생기면 B1-1 · B1-3 규칙을 손으로 붙여야 한다 — 그 사이는 R33 · 수명 시험(배포 2) 전이다.
- 메모리: 여정 편집 · 다음 칸 추천 · 스팸 재작성 · 그 밖 9곳은 아직 메모리 0(배포 2 C1).
- 3단 화면 · 점검 판 · 자동 통신사 검사 표시는 배포 2.

## §3 배포 2

### C1 메모리 한 곳 (J4 · X1 · G5)

- `brand-voice-prompt.ts` `composeVoicePrompt`(586~) 안에서 `buildMemoryPromptContext(companyId, 6)`(1,200자 상한)을 **이른 반환 셋(588 · 594 · 608) 앞에서** 합친다 — 목소리 없는 회사도 메모리가 들어간다.
- 따로 부르던 메모리 지움: `journey-ai-generator.ts` 314 · 921 · 1066 · `journey-builder.ts` 566 · `inapp-ai-generator.ts` 445 · `copy-prompt-composer.ts` 204(메모리 블록 · `memoryIncluded` 옵션 정리).
- 시험: R24(`brand-voice-producers-1028.test.ts`)가 생산자 도달을 기계로 본다 + 「composeCopyBrain 을 부르는 단위는 composeVoicePrompt 에도 닿는다」 계약 + `buildMemoryPromptContext` 를 부르는 곳 = brand-voice-prompt 하나(래칫) · 뒤집을 시험 = `no-voice-prompt-snapshot-1028`(목소리 없음 = 지시문 그대로 → 「목소리 없음 + 메모리 있음 = 메모리 들어감」).
- 사용 횟수(`company-memory.ts` 178~184 usage_count)가 모든 생산자 호출로 늘어난다 — 「AI 참고 횟수」 뜻 = 「문안에 넣은 횟수」로 같다(화면 문구 확인).

### C2 출구 한 곳 + 검사된 글 표식 (J5 · C2)

- `copy-finish.ts`(신설) `finishCopy(input)` → `CheckedCopy`(브랜드 표식 타입 · `{ readonly __checked: unique symbol }`).
  - 입력 `{ companyId, producer, mode: 'write' | 'rewrite', text, subject, channel, isAd, journeyId?, before? }`.
  - 함수가 스스로 읽는다: 사람 값 근거(`journeyCopyGround` · B1-3 같은 함수) · 브랜드 키트 금지어 · 브랜드 링크 · 전송자 이름 → `applyCopyExitGuards` · rewrite 면 `rewriteAddsFacts` · `rewriteDropsLinks` · `rewriteShapeDrift` 걸리면 `{ ok: false, reason }`.
  - 즉시 검사(D1): 금지어 · 남은 자리표시 · 080 · 바이트 · `copy-spam-risk.ts` 점수 → 결과 `check: { quick: 'ok' | 'fix', items[] }`.
- 서버가 AI 결과를 **저장**하는 자리(여정 생성 칸 INSERT · 칸 넣기 생성 · 보내기 전 재작성 반영 `recordIfCurrent newBody` · 변이 자동 생성 저장)와 AI 결과를 **응답**하는 자리(여정 생성 · 다듬기 · 편집 · 다음 칸 · 변이 생성 응답)는 `CheckedCopy` 만 받는다.
- 사람 저장 라우트(`PATCH` · `POST .../steps` · 변이 저장)는 요청 글을 `HumanText`(그 라우트 파일에서만 만든다)로 저장한다 — 사람이 보낸 글은 사람 책임이고, **원장(B1-3)에는 들어가지 않는다**(세탁 길 0 · Codex 설계 1R #4).
- **우회 막기**(회의론자 최종 검증): tsc 만으로는 any(`extractJsonFromAiText<T = any>` · req.body 구조 분해) · `as CheckedCopy` · SQL 바인드 배열이 샌다 →
  - 계약 시험이 TypeScript 타입 검사기(`ts.createProgram`)로 저장 · 응답 함수를 부르는 자리마다 인자 타입이 정확히 `CheckedCopy` / `HumanText` 인지 본다(any · 단언 = 실패).
  - `as CheckedCopy` = `copy-finish.ts` 밖 0 · `as HumanText` = 사람 저장 라우트 밖 0.
  - journey_steps · 변이 표의 글 칸(message_template · subject)을 쓰는 SQL = 저장 함수 파일 하나(R30 꼴 · 소스 추출).
- 생산자 단위 계약(AI 호출에서 출발 · `producer-scan.ts` `unclassifiedAiUnits(..., ['finishCopy'])`): 고객 문안 AI 단위는 finishCopy 에 닿는다 · 면제 = 이유 줄 + 수 래칫.

### C3 수명 시험 하나 (M3 · C5)

- 사람 혜택 「첫 구매 10% 할인쿠폰」 + 링크 1개로 여정 생성 → 칸 넣기(생성 모드) → 다듬기 → 다음 칸 추천 → AI 수정 요청 → 보내기 전 재작성. 가짜 AI 는 B1-1 변환 규칙 꼴 · 링크 뺀 꼴 · 지어낸 20% 꼴을 섞어 돌려준다.
- 끝: 모든 칸에 사람 혜택(값 · 종류 짝) 살아 있음 · 링크 1개 · 자리표시 0 · 지어낸 20% 0.
- 여정 생산자 목록은 소스에서 추출(AI 단위 · `journey-*` · variant-generator) · 시험에 고정 답이 없는 새 생산자 = 실패.

### C4 자리표시 판정 한 벌 (J13)

- `send-placeholder-gate.ts` 를 주인으로 · `journey-builder.ts` 167 · `autosend-policy.ts` 419 는 그것을 부른다(넓은 「[혜택…]」 판정의 쓰임은 영향표로 확인 뒤 같은 판정에 흡수 · 사람이 쓴 「[혜택 안내]」 류 오탐은 기존 판정 기준 유지).

### C5 점검 응답 서버 한 벌 + 통신사 검사 자동 (C7 · D1 · D2)

- `GET /operator/journeys/:id/check` → `{ verdict: { canActivate, sentence }, steps: { [stepId]: items[] }, journey: items[] }` · item = `{ key, level: 'before' | 'running' | 'confirming' | 'pass' | 'fix', title, detail, fixTarget }`(5어 = 검사 전 · 검사 중 · 확인 중 · 통과 · 고칠 것). 켜기 관문(`validateJourneyForActivation`)과 같은 판정 함수를 칸별로 펼친다(판정 두 벌 금지).
- 통신사 검사 자동(D1): 칸 저장 뒤 서버가 그 칸 판에 `spamCheckFor`(B1-4 · 같은 키 · 같은 날 재사용)를 건다(source = `journey_auto` · 큐 우선순위 = 보내기 전 검사 먼저 · 단가표 차감 D2).
- 보내는 날 검사(R30)는 **그날의** 같은 키 pass 만 재사용(날짜가 다르면 다시 검사 · 켤 때 통과가 보내는 날 검사를 대신하지 않는다).
- 「혜택 줄에 넣기」 승인(B1-3 쓰는 길 3) = 본문 혜택 덩어리 중 원장에 없는 것을 item(level=fix · fixTarget=approve)으로.
- 화면 셋(오른쪽 점검 판 · 레일 점 · 켜기 칩/확인 창)은 응답 타입 props 로만 그린다(판정 유틸 import 0 = 타입으로).

### C6 3단 화면 (J10 · Harold 3단 목업)

- 폭 1440px 이상 = 3단(왼쪽 휴대폰 · 가운데 설정 한 판 · 오른쪽 점검 판) · 그보다 좁으면 「휴대폰 | 설정」 2단 + 점검 판 아래 + 머리 「켜기」 옆 판정 칩.
- 왼쪽 `PhoneComposer` 폭 320px · 글 PC 13~14px · 휴대폰 16px(iOS 입력 확대 방지) · textarea 유지(contenteditable 금지 · 한글 조합) · 「쓰기 / 받는 모습」 전환 · 볼륨 · 전원 버튼 오른쪽 · 높이 = 내용(안쪽 스크롤 0).
- 가운데 「이름 | 고르기」 줄: 채널 · AI(다듬기 · 꾸미기 · AI 전으로) · 혜택 · 링크(B1-2) · 넣을 데이터 · 보내는 때(+ 밤 안내) · 담당자 알림 · MMS 사진. 판 머리 오른쪽 = A/B(자기 창 `JourneyModalShell`) · 칸 빼기.
- 오른쪽 점검 판 = C5 응답 · 맨 위 판정 문장(「켤 수 있어요」 / 「아직 못 켜요 · 고칠 것 n · 확인 중 n」).
- 레일 점 = 점검 판정만(빨강 = 고칠 것 · 노랑 = 검사 전 · 검사 중 · 확인 중) · 이탈 진단은 카드 둘째 줄 글자.
- 옮기기 = 원본 복사 · 스크립트 재조립 + 보존 단언(LESSONS_FRONTEND 41) · `JourneyStepStudio` 의 쓰는 곳 없는 가지(232~262 · 615~643 · stacked) 정리.
- 3단 화면 안 낱말 = 칸 · 바로 · 스팸 검사 · 사진(「스텝」 · 「즉시」 · 「스팸필터 테스트」 0 · 제품 전체는 다음 묶음).
- 폭 실측 = 1440 · 1280 · 390 렌더 검사(LESSONS_FRONTEND 324).

### C7 AI 문안 화면 입구 하나 (C8 · F3)

- 프론트: AI 응답을 칸에 넣는 입구 = 하나(`JourneyWorkspace` `applyAiBody` 꼴 공용) · `JourneysPage` 932 · 1064 · 1200 · 1218 · `JourneyVariantsEditor` 240 이 그것을 부른다 · 입구는 응답 `check.quick` 이 없으면 넣지 않고 「검사 중」(서버가 CheckedCopy 만 응답하므로 없으면 서버 계약 위반 = 오류 표시).

## §4 DDL (배포 뒤 실행 · 코드는 없으면 unset · 503)

```sql
-- DDL-A 사람 값 원장
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS copy_facts jsonb NULL;
-- DDL-B 스팸 첫 판정 · 확정 시각
ALTER TABLE spam_filter_test_results ADD COLUMN IF NOT EXISTS first_result varchar(20) NULL;
ALTER TABLE spam_filter_test_results ADD COLUMN IF NOT EXISTS decided_at timestamptz NULL;
ALTER TABLE spam_filter_test_results ADD COLUMN IF NOT EXISTS late_report_at timestamptz NULL;   -- 구현 1101 더함: 「확정 뒤 수신」 하루 측정(R36) 근거
-- DDL-C 확인 문자
CREATE TABLE IF NOT EXISTS spam_test_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL UNIQUE REFERENCES spam_filter_test_results(id) ON DELETE CASCADE,
  phone varchar(20) NOT NULL,
  carrier varchar(20) NOT NULL,
  nonce varchar(12) NOT NULL,
  message_hash varchar(64) NOT NULL UNIQUE,
  status varchar(12) NOT NULL CHECK (status IN ('claimed', 'sent', 'received', 'expired')),
  attempts smallint NOT NULL DEFAULT 1,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  deadline_at timestamptz NULL,
  decided_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_spam_test_probes_open ON spam_test_probes (status, deadline_at) WHERE status IN ('claimed', 'sent');
CREATE INDEX IF NOT EXISTS idx_spam_test_probes_device ON spam_test_probes (phone, carrier);
-- DDL-E 본문 보고 단말
ALTER TABLE spam_filter_devices ADD COLUMN IF NOT EXISTS last_body_report_at timestamptz NULL;
-- DDL-D 보내기 전 재작성 후보
CREATE TABLE IF NOT EXISTS journey_pretest_candidates (
  snapshot_id uuid PRIMARY KEY REFERENCES journey_step_snapshots(id) ON DELETE CASCADE,
  step_id uuid NOT NULL,
  body text NULL,
  subject text NULL,
  check_key varchar(64) NULL,
  status varchar(12) NOT NULL CHECK (status IN ('generating', 'testing', 'passed', 'blocked', 'failed')),
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  regen_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
- `lock_timeout` = 3s · 실행 전 존재 확인(`information_schema` · Harold · 1101 요청함) · result 칸 CHECK 제약 여부 확인(`pg_get_constraintdef` · 있으면 unconfirmed 를 더하는 CHECK 교체를 같은 DDL 에).
- 코드는 다섯 DDL 이 없으면(본문 보고 열 없음 = 확인 문자 0 · 창 닫힘 error · 경보)(후보 표 없음 = 확정 blocked 에서 재작성 없이 여정 정지 · 차감 0 · 지금보다 보수적): copy_facts = unset · first_result/decided_at 쓰기 생략(열 확인) · probes 표 없음 = 확인 문자 대신 창 닫힘에 error(단말 확인 불가)로 닫고 경보(멈춤 0).

## §5 뒤집을 시험 목록 (결정이 바뀌어 옛 결정을 지키던 시험)

| 시험 | 옛 결정 | 바꿀 것 |
|---|---|---|
| `root-ledger.test.ts` 2589~2611 · 1158 | 1026 여정 화면 = 「~ 문자」 · 영문 금지 | 제품 전체 SMS · LMS · MMS(B1-5) |
| `spam-block-decide-1002.test.ts` 28 · 79 · 81~82 | 45초 = 차단 · 화면 60초 | 45초 = 확인 중 · 창 닫힘 확인 문자(B1-4) |
| `copy-benefit-detector.test.ts` strip 시험 21곳 · `journey-anchor-benefit-guard-0926.test.ts` · `prompt-upgrade-0930.test.ts` · `journey-refine-benefit-guard-0926.test.ts` · `journey-benefit-input.test.ts` | 여정 · 다듬기 = 글자 비교 · AI 혜택 0 | 값 · 종류 짝(B1-1 · D3) |
| `__tests__/helpers/producer-scan.ts` 30 `BENEFIT_CT` | 옛 판정 = 거름 | 값 비교만 · 영업 전용 면제(B1-1) |
| `copy-benefit-detector.test.ts` 구현 2R · 3R 반례의 「구분 없는 목록에서 하나 뽑기 = 산다」 4줄 · 3R 「적립금 5천원 증정 → 적립금 5천원 = 산다」 · 「숫자 뒤에 붙이는 꼴 · 앞에 붙이는 꼴」 시험 | 구분 없는 목록(「10% 할인 5% 적립」)도 짝을 허가 | 짝 허가 0(P2) · 그대로 쓰면 산다 · 구분으로 나누면 하나씩 산다(B1-1a) |
| `root-ledger.test.ts` 3745~3750 R32 | 파일 단위 글자 검사 | AI 단위 + 수명 시험(B1-3 · C3) |
| `no-voice-prompt-snapshot-1028` | 목소리 없음 = 지시문 그대로 | 메모리 들어감(C1) |
| 여정 보내기 전 검사 시험(`journey-pretest-*` · 30초 기다림 · 묶음마다 새 검사) | 30초 = 장애 · 회차마다 새 검사 | 같은 키 이어 보기 · 기다림 = pending(B1-4) |
| `message-analysis` 길이 구간 이름 시험(있으면) | 단문 · 장문 | 바이트 구간 이름(B1-5) |

## §6 뿌리 대장 새 줄 (기계로 바꾼 것만 · 손 점검표는 2줄)

- R33 판정 한 벌 + 양방향 표(B1-1) · R34 사람 값 수명(B1-3 · C3) · R35 출구 표식 타입(C2) · R36 판정 정확도 측정(B1-4) · R1 넓힘 = 채널 이름 살아 있음(B1-5) · R32 넓힘 = AI 단위.
- 손 점검표(구조체크 · Codex 요청문 ④): ① 증상 모양으로 좁혀 닫지 않는다(M5) ② 결정이 바뀌면 그 결정을 지키던 시험부터 찾는다(§5 칸을 설계서마다).

## §7 영향표 (소비처)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `stripUnauthorizedBenefits` 삭제 | 여정 7 · 대행 다듬기 · 인앱 빠른 작업 · SNS · AI 영업 11곳 | 영업 = 전용 이름(동작 같음) · 나머지 = 값 비교(사람 혜택을 다르게 쓴 자리가 산다 · 지어낸 것은 그대로 죽음) |
| `spamVerdictOf` 4값 + pending | 대행 워커 · 자동발송 워커 · 상시 운영 2 · 플래너 · 여정 보내기 전 | unconfirmed · pending = 보류(자동 행동 0 · 장애 횟수에 안 셈) · tsc switch/never |
| `spamCheckFor` 같은 키 이어 보기 | `journey-pretest-validator` · `autoSpamTestWithRegenerate`(대행 · 자동발송 · 상시 운영 · 플래너) · `ai-line-spam` | 같은 날 같은 글 = 새 검사 · 차감 0 · 수동 검사는 그대로 새 검사 |
| 확인 문자(`spam_test_probes`) | 앱 보고 짝짓기(`resolveSpamReportTest`) · 큐 워커 | 확인 문자 해시는 일반 짝짓기 제외 · 본문 없는 보고는 열린 확인 문자가 있으면 무시 · 큐 워커에 닫기 문장 하나 |
| 「전달 성공 + 보고 없음」 공용 판정 | 큐 45초 · 큐 시간 초과 · 수동 45초 · 수동 시간 초과 | 전부 unconfirmed · blocked = 확인 문자 수신 · 통신사 거절 코드뿐 |
| 재작성 후보(`journey_pretest_candidates`) | 여정 보내기 전 검사 | 후보가 있으면 원문 대신 후보를 이어 봄 · 재작성 1회 상한 |
| 켜기 검증 · 묶음 판정 | 켜기 · 점검 응답 | 전부 pass 만 통과 |
| 결과 행 45초 판정 | 수동 검사 화면 · 한 줄 결과 칩 · 큐 | 차단 대신 확인 중 · 화면 읽기 10분 |
| `journeys.copy_facts` | 여정 생성 · 칸 저장 · 채우기 · 여정 문안 생산자 전부 · 복제 | NULL = 옛 동작 |
| 채널 이름 | 프론트 28 · 서버 4 | 표기만 |
| `composeVoicePrompt` 메모리 | 생산자 18(R24 목록) | 프롬프트 1,200자 이내 늘어남 · 목소리 없는 회사도 메모리 |
| `finishCopy` · 표식 타입 | 여정 저장 · 응답 함수 · 프론트 입구 | 검사 안 된 글 저장 · 응답 불가 |

## §8 돈

- 여정 보내기 전 재작성(1크레딧)은 확정 blocked 에서만(오탐 재작성 0).
- 확인 문자 1통 = 검사 단말 발송(검사 비용과 같은 장부 · 고객 차감 0 · 우리 원가).
- 자동 통신사 검사(D2) = 단가표 차감 · 같은 날 같은 키 재사용 = 0원.

## §9 배포 뒤 실측 시나리오 (원장 카드)

- 배포 1 회귀: copy_facts NULL 인 옛 여정에서 링크만 채운 뒤 다음 칸 추천 → 앞 칸의 「10% 할인」이 그대로 근거(자리표시 0 · Codex 설계 1R #6) / 같은 문안 보내기 전 검사가 늦은 보고로 「확인 중」이 된 회차 다음 회차 = 새 검사 0 · 차감 0.
- 배포 1: 테스트계정 여정 하나를 질문표 혜택 「첫 구매 10% 할인쿠폰」 + 링크로 만들고 칸 넣기 · 다듬기 · 다음 칸 추천 → 칸마다 혜택 · 링크 · 자리표시 0 / 혜택 · 링크 줄 = 기존 자리표시 여정에서 입력 한 번에 전 칸 채움 / 수동 스팸 검사 = 늦은 통신사 「확인 중 · n분째」 → 통과로 바뀜 / 화면 채널 = SMS · LMS · MMS.
- 배포 2: 3단 화면 1440 · 1280 · 390 / 점검 판 판정 문장 = 켜기 칩 = 레일 점 / 메모리 = 목소리 없는 회사 생성 프롬프트에 메모리 블록(로그 길이만 · 원문 출력 금지).

## §10 범위 밖 (기록만)

- 「즉시 / 바로 · 스텝 / 칸 · 스팸필터 테스트 / 스팸 검사」 제품 전체 통일(3단 화면 안만 이번 배포 2).
- 기존 582종 이미지 스튜디오 무문자 문장 · 기존 행사 템플릿 업종 섞임(FEATURE-IMAGE-STUDIO §8).
- 약관 속 「단문 · 장문」 표기(법률 문서 · Harold 결정).

## §11 Codex 설계 리뷰 기록

| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | high 6 · medium 2 = ① 확인 중 검사를 이어 볼 식별자 없음(여정 30초 기다림 · 회차마다 새 유료 검사 · J15) ② 확인 문자 보고가 다른 검사를 통과시킬 수 있음 ③ 짝 규칙이 「5% 할인」을 허용 · 덩어리 합치기로 「10% 적립」도 허용 ④ bodyOrigin 은 사람 작성 증거가 아님(세탁) ⑤ 일괄 채우기가 활성 판 계약을 안 지남 ⑥ 링크만 저장해도 혜택 옛 근거가 사라짐 ⑦ 화면 조회가 최종 판정 전에 멈춤 ⑧ 길이 분포를 채널 이름으로 바꾸면 뜻이 깨짐 | 전부 수용 · ① `spamCheckFor` 같은 키 이어 보기 + pending 분리 ② `spam_test_probes` 표 · nonce 해시 · 확인 문자 해시는 일반 짝짓기에서 제외 · claim 멱등 · 상한 ③ 숫자마다 원자 짝 · 일반 낱말 예외 삭제 ④ 본문 자동 추출 삭제 · 원장 = 질문표 · 채우기 · 명시 승인만 · 사람 저장 = HumanText(원장 무관) ⑤ 칸 갱신 길 그대로 · 한 트랜잭션 ⑥ 혜택 · 링크 상태 따로 ⑦ 서버 최종 · finalBy 까지 ⑧ 바이트 구간 이름 · 채널 시험 제외 |
| 2R | ④~⑧ 닫힘 · high 5 = 재작성 후보 미보존(pending 마다 재차감) · 켜기 검증이 pending 을 통과로 셈 · 본문 없는 보고 오짝짓기 · 시간 초과 분기가 확인 문자 우회 · 숫자열 공통 수식 반례 | 전부 수용 · 후보 표 DDL-D(판 PK · claim 뒤 1회 재작성 · 후보 이어 보기) · 켜기 검증 · 묶음 판정 = 전부 pass · 열린 확인 문자 있으면 본문 없는 보고 무시 · 「전달 성공 + 보고 없음」 공용 판정 · blocked 쓰는 SQL 자리 계약 · 숫자열 공통 수식 · 다중 숫자 절의 종류 없는 숫자 = 죽음 |
| 3R | #2 · #4 닫힘(통신사 거절 코드 표 `sms-result-map.ts` 43 · 49 실재 · 문장 유지) · high 4 = 옛 판으로 claim · 차감 · generating 영구 · 만료된 확인 문자의 본문 없는 늦은 보고 · 범위 표기 | 전부 수용 · claim = journeys 행 잠금 아래 최신 판 확인 · 저장 = claim_token 조건부 · generating 10분 = failed + 정지 · 안내 · 차감 환불(멱등) · 확인 문자 쓰는 단말 = 본문 없는 보고 대체 금지 · 본문 보고 단말에만 확인 문자 · 범위 원자(fail-closed) |
| 4R | #1-a · #5 닫힘 · #3 부분 닫힘 · high 1 = 재작성 환불이 선불 원장을 가리킴(차감은 크레딧 원장 · 무작위 키) · medium 1 = 본문 보고 단말 판정 자료 없음 | 전부 수용 · 차감 키 고정 + `refundCredit`(원 차감 키 · 실제 금액) · DDL-E `spam_filter_devices.last_body_report_at`(보고 라우트 단말 확인 문장에서 · 7일 · NULL = 확인 문자 0) |
| 5R | 4R #2 닫힘 · #1 부분 닫힘 · high 1 = 실패로 닫은 뒤 돌아온 손의 늦은 차감이 환불에서 빠짐 | 수용 · 정산 직전 accept 에서 후보 상태 · claim_token 확인 + failed 후보 차감 키 7일 지속 대조 · 멱등 환불 · 7일 뒤 경보 |
| 6R | 5R 닫힘 · 지적 0 | **approve** (설계 종결) |
| B1-1a 구현 4R | high 1 = 값 하나 뒤 증정 예외가 따로 선 증정 항목을 앞 금액의 증정으로 허가(「할인: 5천원 증정: 키링」→「5천원 증정」) | 수용 · 3R 에 정한 대로 증정 예외 삭제 · 승인 설계 복귀 · 비용(숫자 앞뒤에 다 붙은 꼴을 바꿔 쓰면 자리표시)을 받아들인 비용에 적음 · Harold님 보고 |
| B1-1a 구현 3R | high 1 = 증정 예외가 값이 여럿인 숫자열에도 걸려 「할인 10%, 5천원 증정」→「5천원 할인」 허가 | 수용 · 증정 부류 세 번째 = 예외를 묶음 단위로 정해 숫자열의 나눠 주기를 못 봄 · 예외 = 값 하나 바로 뒤로 좁힘 · 4R 에도 빈틈이면 예외 삭제(승인 설계 복귀) |
| B1-1a 구현 2R | high 1 = 증정을 종류 대조에서 빼 무엇을 주는가의 연결이 사라짐(「5천원 쿠폰 사용 시 사은품 증정」→「5천원 쿠폰 증정」 · 「상품가 5천원, 사은품 증정」→「5천원 증정」) | 수용 · 같은 부류 두 번째 = 1R 처방이 넓었음 · 증정은 붙음 · 대조 모두 보통 낱말로 되돌리고 예외는 「숫자 뒤 증정만 묶음은 섞임에 세지 않음」 하나로 줄임 · 반례 둘 시험 고정 |
| B1-1a 구현 1R | high 2 = ① 구현 중 더한 「증정 묶음은 섞임에 세지 않음」이 「증정 금액 5천원 할인 금액은 미정」→「5천원 할인」을 허가 ② 조건 어미가 「결제 시점」의 「시」를 조건으로 읽어 「상품가 10만원 쿠폰 5천원 결제 시점에 적용」→「10만원 쿠폰」 허가 · 시험 보강 3(T1 근거 수집 범위 · 역할 반대 방향 · T3 끊김 글자) | 전부 수용 · ① 증정 = 값의 종류 아님(붙지 않음 · ⊆ 대조 제외 · 숫자 앞일 때만 섞임에 셈) ② 어미 뒤 낱말 끝 · 시험 셋 반영 |
| B1-1a 3R | high 2 = ① 방향 섞임을 배정 결과로 세 보류된 앞쪽 관계가 빠짐(「기존 5%에서 적립률 10% 쿠폰: …」) ② 허용 이웃 연쇄 적립 → 쿠폰 → 할인이 적립률을 할인율로 옮김 · (3) 조건 후보 제외가 만드는 반례 = ①과 같은 것 | 전부 수용 · ① 섞임 = 바로 앞 · 뒤 묶음 유무(배정 · 붙음 무관) — 조건 쪽을 후보로 세지 않고도 닫힘(조건이 빠진 쪽 = 숫자 없는 기본 경우와 같음) ② 값 종류 둘인 묶음 = 허가 0 |
| B1-1a 2R | high 2 · medium 1 = ① 조건 쪽을 후보에서 빼 남은 쪽을 허가(「적립률 10% 쿠폰: 5천원 이상 구매 시 증정」→「10% 쿠폰」) ② 나르는 낱말 연쇄가 할인액을 사은품 값으로 복제 ③ 조건 역할 일치를 단독 숫자에서 시험이 강제하지 않음 | ② ③ 수용 · ① 반례는 수용(방향 섞임 = 허가 0으로 닫음) · 처방(조건 쪽을 후보로 셈)은 불수용 — 조건 어미 붙은 문턱 값은 값 후보가 아님 · 세면 가장 흔한 조건부 혜택이 바꿔 쓰면 모두 자리표시(측정) · ② 허용 합성 표 · ③ 역할 일치를 맨 먼저 · 역할 표를 T2에 |
| B1-1a 1R | high 4 = ① 같은 절 잘라 내기가 줄을 넘는 혜택(「무료
배송」) 검사를 없앰 ② 공백 제거 비교가 「쿠폰1 5%」 = 「쿠폰 15%」 ③ 한쪽 문법 실패 · 이웃 판정 · 조건 판정을 확실의 증거로 씀(P2 위반) ④ 근거의 조건 금액이 출력의 혜택 값을 허가 | 전부 수용 · ① 덮는 절 묶음 전체가 근거 연속 절 묶음과 같을 때만 · 잘라 내지 않음 ② 공백 한 칸으로 줄일 뿐 지우지 않음 ③ 후보 = 바로 옆 숫자 · 둘이면 허가 0 · 하나라도 붙음 아니면 허가 0 · 이웃 판정 · 표지 승부 삭제 · 조건 = 조건 어미 ④ 조건 역할 일치만 |
