# LESSONS — Backend / API / Query / 발송 / AI 사고

> **참조**: Backend route / utils / 발송 / AI 호출 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 Backend 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **★ 차감이 끝나기 전에는 발송 가능 상태를 만들지 마라 — 상태 게이트가 원자성 부재를 구조로 막는다 (2026-07-31 브랜드 재구축 Codex 3R)** — 직접발송 캠페인이 `send_phase='queued'`로 먼저 생성되고 차감이 뒤따랐다. 차감·보상 도중 어떤 실패가 나든 워커(5초 주기)가 그 사이 캠페인을 집으면 미차감 발송이다. 보상 실패 처리를 아무리 정교하게 덧대도(중화 UPDATE·의무 기록·rowCount 확인) 두 쓰기 사이가 유실 창으로 남았다. **처방 = 초기 상태를 워커가 안 집는 `preparing`으로 만들고, 전 축 차감 성공 후에만 `queued`로 전환.** 전환 실패는 phase 재확인 3분기(커밋됨=계속/preparing=중화+의무/미확정=경보만 — 커밋됐는데 클라이언트만 오류받은 경우 무조건 중화하면 발송+전액환불 이중 이득). 일반화: 돈과 실행이 두 시스템에 갈릴 때는 "실행 불가 상태"를 기본값으로 두고 돈이 끝난 뒤 열어라.
- **★ 큐 매칭 ID가 "재사용되는 축"이면 기간 조건 없는 매칭은 이중 청구다 (2026-07-31 브랜드 재구축 Codex 2R critical)** — 정산 대상 선정이 campaign_runs.id를 모으는데 큐 `app_etc1`에는 campaigns.id가 적혀 브랜드·AI 발송분이 통째 미청구였다(발송이 실제로 나가기 시작하며 드러남). campaigns.id를 그냥 IN에 추가하면 반대로 터진다 — **같은 캠페인이 run_number를 늘리며 여러 달 재발송되므로, 무기간 매칭은 인접 월 발송분을 양쪽 달에 다 계상한다.** 처방 = ID를 두 집합으로: 이벤트 축(run·direct 캠페인 = 1 ID 1 발송, 무기간 유지)과 재사용 축(campaigns.id = 반드시 `sendreq_time` 청구 기간 조건 동반), 서로소 보장(`selectBillingSendIds`). 일반화: "이 ID 하나 = 발송 이벤트 하나"가 성립하지 않는 축을 기간 없이 집계에 넣는 순간 월 경계가 깨진다.
- **★ best-effort 경보 인프라 위에 행 단위 "정확한 1회 전달" 보장을 쌓지 마라 (2026-07-31, 감시 마커 3라운드 연속 누수)** — 잔존 감시에 행별 durable 마커·성공 판정·메모리 Set를 쌓을수록(기아→미전달 마킹→적재실패 오인·hang 잠김·복구 폭주) 같은 부류가 계속 샜다. 경보 함수는 쿨다운·미설정·적재실패를 전부 0으로 합쳐 돌려주는 best-effort다. **처방 = 감시는 "발견"만: 개수 COUNT + 단일 dedupKey 경보(쿨다운이 중복 억제, 잔존이 남는 한 다음 창 재경보 = 수렴) + 미종료 작업 1개 상한(in-flight, settle 해제) + 시도 간격.** 행 목록은 경보 받은 사람이 SQL로 뽑는다(안내 SQL은 감시와 같은 조건으로 — 넓히면 정상 진행분에 수동 조치가 들어간다).

- **★ 외부에서 데이터를 끌어오기(pull) 전에 그 데이터를 밖으로 밀어내는(push) 자동 경로를 먼저 끈다 (2026-07-30, 다우→휴머스온 이관분 pull)** — 게이트웨이 적재 워커 `runScanPass`의 대상 조건은 `status='APPROVED'` + 코드 비어있지 않음 **둘뿐이고 `B_` 접두 필터가 없다**(pull 대상 판정만 `B_`다). 그래서 `bizp_` 템플릿 26건을 pull하면 `auto_push_enabled=true`인 bill에서 **5분 안에 운영 게이트웨이로 자동 upsert가 나간다** — 승인 없이 외부 시스템에 쓰기가 발생한다. 더 나쁜 쪽은 그 반대다: 이미 매핑에 있는 코드는 `ON CONFLICT (bill_id,tmplcd) DO NOTHING`이라 **죽은 옛 senderkey를 그대로 유지**하고, 대조 패스도 게이트웨이 실값 채택 방향이라 고치지 않는다 → 조용히 발송 불가 경로가 남는다. **처방 = ①pull 대상 bill의 `auto_push`를 끄고 pull·대조한 뒤 다시 켠다(끈 채 방치하면 그 회사의 신규 승인분 자동 등록이 조용히 멈춘다 — 0720 교훈) ②"우리가 읽어오는 축"과 "우리가 내보내는 축"의 필터 조건이 같은지 착수 전에 소스로 확인한다. 이번엔 달랐다.** 상세=[[project_2026_0705_legacy_template_migration]] 0730(2) 절.
- **★ 외부 계정으로의 자산 이관은 식별자를 새로 발급한다 — 옛 식별자 조회로 이관 여부를 판정하지 마라 (2026-07-30)** — 카카오 채널 딜러 이관(다우→휴머스온) 후 옛 senderKey 4개 전부 `getSender` → `4011 찾을 수 없음`인데 이관은 실제로 완료돼 있었다. 새 senderKey로 우리 계정에 들어와 있었고, 판정 수단은 **계정 목록을 채널명으로 검색하는 것**이었다(`listSenders` CT는 있었지만 소비처가 0이라 볼 방법이 없었다 → 디버그 endpoint 신설). **"없다"는 응답은 '이관 안 됨'이 아니라 '그 키로는 없음'까지만 증명한다** — 부재 증명에 옛 키를 쓰면 결론이 반대로 나온다. 반대로 템플릿 **코드**는 유지될 수 있으니(`bizp_` 그대로·`templateKey`만 신규) 갱신 범위를 코드까지 넓히기 전에 실측한다.
- **★ AI 판독값으로 돈을 움직일 때는 "검산"과 "반영"을 서버가 결속해야 한다 — 검산 통과 화면은 결속이 아니다 (2026-07-30, KT 명세서 080 청구·Codex 3R)** — `/parse`가 vision 판독 + 검산을 하고 `/apply`가 그 결과를 다시 받는 구조였는데, 반영은 **요청 본문에 담겨 온 금액**을 그대로 믿었다. 검산은 "전문 안에서의 일관성"만 보므로 **일관되게 조작한 전문**은 통과한다(화면 비활성화는 우회된다). 처방 = 세션 저장 없이 결속하는 최소 수단 — **정규형(정렬·정수 고정)에 만료형 HMAC 서명**을 발급하고 반영은 서명 검증 후 **검산을 서버에서 재실행**. 서명은 **검산을 통과한 결과에만** 준다. 세 함정이 같이 있었다: ①`NaN → JSON null → Number(null)=0`으로 "판독 불가"가 **0원으로 살아난다**(정규화는 숫자 타입 안전 정수만 인정하고 반올림도 하지 않는다 — 671.6을 672로 살리면 손상 전문이 서명을 유지한다) ②합계·건수를 "안 보이면 0"으로 두면 **그 대조가 통째로 fail-open**된다(0 = 판독 실패 = 불합격이어야 한다) ③검산 항목이 서로 종속이면 **오분류를 못 잡는다**(call+svc+vat=subtotal은 call↔svc 스왑에 불변 — VAT 비율·최빈값 같은 **독립 축**을 하나 더 둔다. 통계 축은 표본이 3행 미만이면 성립하지 않으므로 그때는 자동 반영을 막는다).
- **DB CHECK 제약을 어긴 INSERT는 그 기능을 통째로 죽인다 — 그리고 "왜 안 나가는지"가 데이터에 안 남으면 아무도 모른다** (2026-07-27, 여정 알림톡 6건 전건 미발송) — 여정 실행기가 알림톡 step에서 `campaigns.message_type='KAKAO'`를 넣었는데 `campaigns_message_type_check` 허용값은 `SMS·LMS·MMS·KMS·FMS·GMS`뿐이라 INSERT가 깨졌다. 진입·안전필터·시각 계산은 전부 정상이었고(6건 진입, `next_run_at` 즉시), 발송 **직전 한 줄**에서 막혀 5분마다 재시도만 반복했다. **이 시스템은 카카오를 `message_type`이 아니라 `send_channel`로 구분한다** — 운영 실측으로 알림톡 102건이 전부 `LMS`+`alimtalk`, 브랜드메시지는 `LMS`+`kakao_brand`인데 여정만 다른 축을 썼다. **채널을 새로 붙일 때는 그 채널을 기존 경로가 어느 컬럼으로 구분하는지 실데이터 분포(`GROUP BY message_type, send_channel`)로 먼저 확인**하고, 저장값 정규화는 CT 안에서 닫는다(`journey-step-campaign.ts toCampaignMessageType`). 부수 결함이 더 나빴다 — 실패가 PM2 로그에만 찍히고 `journey_executions.error_count`는 0, `error_log`는 `[]`였다. 화면상으로는 "이유 없이 안 나가는" 상태다. **워커의 바깥 catch는 반드시 실행행에도 사유를 기록**한다(기록 실패가 루프를 멈추지 않게 이중 try). 진단 순서는 진입행 유무 → `next_run_at` → step_logs → PM2 로그 넷으로 갈리며, 이번엔 "진입은 됐는데 로그가 0건"이 곧 발송 직전 실패라는 신호였다.

- **고정 좌표로 그리는 PDF 블록은 값이 길어지는 순간 겹친다 — 실제 높이를 재서 다음 위치를 잡는다** (2026-07-26, 금강제화 정산서 실측) — 공급받는자 대표가 **두 명**인 회사(각자대표)에서 대표 줄이 칸 폭(195pt)을 넘어 두 줄로 흐르는데, 다음 줄 y를 `+= 14`로 고정해 사업자번호 줄과 겹쳐 인쇄됐다. 아래 구분선·항목표 시작도 고정 좌표라 함께 침범당한다. `lineBreak: false`는 **한 줄로 잘라내는** 것이라 정보가 사라지는 자리(대표자·상호)엔 답이 아니고, 숫자 칸(금액·단가)처럼 잘려도 되는 자리에만 쓴다. **처방 = `heightOfString(text, {width})`로 줄마다 실제 높이를 재서 내리고, 블록이 끝난 y를 돌려받아 그다음 요소를 거기서 잡는다**(`utils/pdf-party-block.ts` CT). 같은 블록을 두 문서(정산서·거래내역서)가 그리면 반드시 CT로 — 한쪽만 고치면 다른 문서에서 그대로 재발한다. **일반화: 사람 이름·상호·주소처럼 "보통 짧지만 가끔 긴" 값은 고정 높이 레이아웃의 시한폭탄이다.**
- **소수 단가가 있는 청구 금액은 행 단위에서 원 미만을 절사한다** (2026-07-26 Harold 지시) — 단가가 소수 둘째 자리(22.80·7.20)라 `수량 × 단가`가 소수로 떨어져 `₩13,397,454.84`가 세금계산서·PDF에 그대로 나갔다. **총액에서 한 번만 절사하면 안 된다** — 청구서 1페이지 항목표와 2페이지 일자별 상세에 각각 금액 열과 합계 행이 있어, 고객이 어느 쪽을 세로로 더해도 공급가액과 맞아야 한다. 행 단위로 절사해야 그 위 모든 합(유형줄·채널·장·공급가액·부가세)이 정수 덧셈이 된다. 반올림이 아니라 **절사**인 이유는 고객에게 불리한 방향으로 1원도 넘기지 않기 위해서다(우리 손실은 행당 1원 미만). **`Math.floor` 직접 호출 금지** — `720 × 7`이 부동소수점 오차로 `5039.9999…`가 되어 1원이 깎인다. 소수 둘째 자리 반올림으로 오차를 걷어낸 뒤 버린다(`utils/money.ts floorWon`). **헤더와 상세를 서로 다른 코드로 계산해 대조하는 교차검증이 있으면 대조는 절사 전 값으로** — 둘 다 절사하면 헤더를 상세에서 파생시킨 셈이라 검사가 사라진다.
- **기능/라우트를 새 역할에 개방 = 그 기능의 전 엔드포인트 전수 격리·게이트** (2026-07-21) — 핵심 CRUD만 격리하면 보조 경로가 IDOR. 0721 인앱/이메일 담당자 개방 때 Codex 적대검증이 aux 엔드포인트 IDOR을 라운드마다 적발: 조회통계(viewers=고객 이름·전화)·발송이력(events/non-openers=수신자 이메일)·AI 분석(precheck/insight=body의 campaign_id)·표시가능성(display-eligibility)·초안 API(event_campaign_drafts). **개방 기능은 라우터 전 엔드포인트 grep해 per-record=owner(created_by) 격리 / 회사 전체 집계(analytics·stats·overview·top-messages)=관리자 전용.** 격리 CT=`utils/owner-scope.ts`(`resolveOwnerScope`: admin/super→null=회사전체, 담당자→userId, 비관리자 userId 누락 시 fail-closed nil-uuid) + `created_by` optional 파라미터(미지정=무필터 하위호환). 개방/차단류 = Codex `/codex:review` 필수(사람은 aux 경로 누락).
- **이관(외부 pull)은 외부에 없는 로컬 관리명을 유실 — 로컬 라벨은 로컬 복원 (2026-07-22)** — 0720 카카오 템플릿 IMC pull 이관이 `template_name`을 IMC 체계형 자동명(`아난티_81880`)으로 채워, 고객사 원본 관리명(레거시 event_admin `kakao_alim_talk_template.title`)이 유실. 복원 = 레거시 title을 `template_code` 매칭 로컬 UPDATE(3,242건·remainDiff 0). **핵심: `template_name`은 로컬 라벨(IMC 등록 payload 아님·리스트 검색 파라미터일 뿐·kakao-template-sync가 code/status만 갱신·template_name 미접촉)이라 IMC/재승인/발송 무접촉 안전 복원.** 단 custom_template_code 수정은 IMC 호출(순수 로컬 아님) — **필드마다 로컬/원격 여부 확인 후 경로 선택.** 복원 엔드포인트 = super_admin·dryRun·멱등(IS DISTINCT FROM)·remainDiff 효과검증(6원칙 ②).
- **발송 5경로 전수 점검** — `messageUtils.ts replaceVariables()` 공통 (D32~D33)
- **컨트롤타워 단일 진입점** — `utils/` CT에만 로직 / 라우트 인라인 정의 금지
- **모델 분리 룰** — Opus 4.7 (AI Operator) / Sonnet 4.6 (기존 한줄로AI) 흐름 영향 0건
- **AI 임의 혜택 생성 X** — 구체 혜택(%/원/쿠폰/무료) 절대 미생성 / `[직접 작성해주세요]` placeholder
- **0건 타겟 자동완화 X** (D171) — 마케팅 의도 파괴 + 정보통신망법 위험
- **EUC-KR 호환 화이트리스트** — SMS/LMS 발송 시 unicode 이모지 사고 차단
- **캐시 무효화 길목 배선 + TTL 상한** (2026-06-25) — 카운트/집계 캐시(예 company-data-profile 1h)는 `clear*Cache` 함수만 만들고 호출 안 하면 stale. 데이터 수 바뀌는 길목(업로드 save·전체삭제·업로더삭제) 전수에 무효화 호출 + 다중 pm2(메모리 캐시 비전파) 대비 TTL 상한(예 5분). "정의했으니 됐다" X — 호출부 grep으로 0건 확인.
- **여정 문안 = 상시발송 evergreen, 계절 박제 금지** (2026-07-05) — 여정은 한 번 만들면 연중 자동발송이라 생성 시점 계절이 문안에 박히면 이후 달에 어긋난 문자(7월 생성→8월 "장마"). AI 문안 생성기에 `getSeasonContext`(현재 월/키워드)를 주입하는 경로가 **즉시발송(캠페인·자동마케팅·DM·인앱)엔 정상이지만 여정엔 독**. 여정 생성·refine·날짜축·대화형수정 전 경로에서 시즌 주입 제거 + few-shot 예시까지 evergreen으로(예시가 계절 재학습시킴). 목표문에 계절·명절 명시 시만 예외. → "상시 반복 발송 문안엔 시점 종속 표현(계절·월·날씨·명절) 금지" 일반 원칙.
- **발송 피로도 = 전역 게이트(회사 opt-in) + 광고성만** (2026-07-05) — 한 고객이 여러 경로(캠페인·여정·자동마케팅·직접발송)에 동시 노출되는 과다발송은 각 경로가 몰라서 막히지 않는다. `fatigue-guard` CT로 "최근 N일 광고 M건" 전역 게이트를 **5경로 전부 차감/발송 이전**에 배선(환불 배관 불필요). 원칙: ①발송 대상 건드리는 규칙은 회사 명시 opt-in만(임의 기본값=조용한 대량 제외=클레임) ②기록은 항상·판정은 opt-in(나중에 켜면 즉시 정확) ③광고성(is_ad)만·정보성/수동입력/시스템알림 제외 ④예측 분모 카운터(customer_send_stats, 타겟선정 금지 계약)와 별개 테이블. 순수 SQL절 빌더(`fatigue-guard-core`)는 DB import 0으로 분리해 operator-recipients 순수성 유지.
- **개인화 변수 라벨 = FIELD_MAP displayName 단일소스** (2026-07-09) — 활용가능컬럼(company-data-profile ANALYZED_FIELDS)·미리보기 키(ai.ts mapSampleCustomerRow)·인앱 %변수% 맵(inapp LEGACY_VARIABLE_MAP)이 FIELD_MAP과 별개 하드코딩 라벨 테이블을 두면 발송 사전(extractVarCatalog=displayName)과 어긋나 미리보기만 매칭·발송 빈칸. AI 프롬프트·버튼·미리보기·발송·인앱 전부 FIELD_MAP displayName 파생으로 통일. customer_schema가 다른 라벨을 쓰는 회사 대비 `applyFieldDisplayNames`로 displayName을 항상 유효 토큰화(스키마라벨/alias 유지=하위호환). alias 땜질(0708 '등급'/'포인트' 2개)은 근본 아님 — 별도 라벨 테이블 자체를 제거해야 함. FIELD_MAP 밖 필드(avg_order_value·ltv_score·wedding_anniversary)는 발송 사전에 없어 %변수%가 항상 빈칸 → 활용 목록에서 제외.
- **고객 대상 xlsx = exceljs, SheetJS(xlsx) 무료판은 서식 미지원** (2026-07-09) — `XLSX.utils.aoa_to_sheet`+`XLSX.write`는 셀 색·테두리·병합·폰트를 못 넣어 맨 텍스트 덤프로 나간다(캠페인대행요청서 "디자인 개똥" 지적). 고객사·외부 배포 문서는 `exceljs`(배너·섹션·병합·테두리)로 생성. 단 **양식 라벨·표 구조는 업로드 파서(SheetJS `sheet_to_json`)와 단일 진실 공유** — 생성(exceljs)↔파싱(SheetJS) 왕복 테스트로 고정해야 재디자인 시 파싱이 안 깨진다. 파서 표 종료 규칙(빈 행=끝)으로 양식 푸터/여백의 데이터 오인 차단.
- **완성 이미지 "비율/크기 조정"에 생성 모델(image-to-image) 쓰지 말 것 — 원본 파괴** (2026-07-21, Harold 실측) — 이미지 스튜디오 채널 변환(DM 1:1→인앱 3:4)을 `editOrUpscale`(Gemini image-to-image)로 했더니 **상품 색·디테일을 다시 그려버림**(검정 스커트→흰색). 생성 모델은 "비슷하게 다시 그림"이라 원본 픽셀 보존이 원리적으로 안 됨. **비율/크기 조정 = 순수 이미지 처리(PIL 크롭/패딩/배경연장)로**. studio-py `/refit` = 원본을 대상 비율 캔버스에 contain(잘림 0) + 여백은 원본 cover+GaussianBlur 배경(레터박스 X) = 원본 픽셀 100% 보존. **원칙: 상품/완성물의 색·형태가 바뀌면 안 되는 변환은 AI 금지, 픽셀 처리만.** (AI는 배경 생성·outpaint처럼 "새로 그려도 되는" 영역에만.) 크레딧은 정책상 유지 가능(Harold: AI 안 써도 1 소모). **★단 배경연장(블러 여백)도 완성 포스터엔 부자연(Harold 실측 재불만) — 원본(선명)+블러 경계가 액자 테두리처럼 뜸. 완결 구도(배경+텍스트+상품) 이미지의 비율 변환은 미해결. 재설계 방향 = ①AI 아웃페인팅(원본 마스크 보존+늘어난 배경만 이어그림·색 파괴 X) ②상품 누끼 재추출(rembg)→대상 비율 배경 재합성(스튜디오 본래 파이프라인). 내일(0722) 재작업 예정.**
- **크레딧 차감(돈) = 효과·저장 성공 후 마지막 + lock으로 동시요청 차단** (2026-07-21, 6원칙 ②⑤) — 이미지 스튜디오 채널 변환(`/convert-channel` 1크레딧) 패턴: checkCredit(사전 402) → tryAcquireGenerateLock(회사당 동시 1개·두번째 409=이중차감 원천차단) → editOrUpscale 재생성 → 저장(moveTempToPermanent+registerAsset) 성공 → **그 후에야 deductCreditSafe(멱등키 `source:{uuid}`)** → finally releaseGenerateLock. 실패 경로(용량초과 409·저장 실패 502·AI throw)는 deduct 도달 전=미차감(사용자 이득 방향). deductCreditSafe는 InsufficientCreditError를 정상차단(throw 안 함)이라 자산 등재 후 동시소진 시 미차감 가능=`[CREDIT][MISS]` 로그로 수동 재차감. **크레딧 ≠ balance(원 발송잔액)** — 차감 대상은 `companies.ai_credits_base_remaining`+`ai_credits_purchased`(2버킷·base→purchased), 이력은 `ai_credit_transactions`(type/amount/bucket/source). 실측 SQL은 balance 아닌 credits_total 봐야.
- **문서에 제어문자를 예시로 적을 때는 이스케이프 표기로만 쓴다 — 안 그러면 그 문서가 통째로 검색 불능이 된다** (2026-07-27) — 바로 아래 2026-07-21 교훈이 그 사고를 냈다. 예시를 `\x00`가 아니라 **실제 NUL 바이트 1개**로 적어 둔 탓에 ripgrep이 이 파일(94KB)을 바이너리로 판정하고 내용 검색을 통째로 건너뛰었다. CLAUDE.md `read_lessons_first`가 백엔드 작업 전 정독을 의무화한 파일인데 `grep`이 조용히 0건을 냈고, 그 상태가 6일간 유지됐다. **조용한 0건이 가장 위험한 실패다** — 파일이 없어서 0건인지, 검색기가 건너뛰어서 0건인지 구분되지 않는다. 점검 = 파일 바이트에 0x00 개수 0.
- **regex 문자클래스에 raw 제어바이트(0x00-0x1f)가 들어가면 tsc 통과해도 도구 오작동** (2026-07-21) — 파일명 안전화 헬퍼에서 `\x00-` 범위를 소스에 raw 바이트(NUL 등)로 넣으면 tsc는 통과하나 일부 도구(grep -P·포매터)가 오작동. 헤드라인 등 텍스트 입력엔 제어문자가 낄 일 없으니 금지문자만 명시(`[\\/:*?"<>|]`)하고 raw 제어바이트는 제거. **파일명 = DB 표시명(cdp_assets.filename "헤드라인_채널.ext")과 실제 파일(url의 tempId.ext)을 분리** — 표시명만 의미있게 바꾸고 URL은 안정 유지.
- **요금제 기능 게이트 신설 = plan_code + 구독상태(isSubscriptionBlocked) 한 세트** (2026-07-09) — 신규 게이트를 `isBetaAccessAllowed`(plan_code만)로 짜면 만료·정지 구독 업체가 통과(캠페인대행 Codex 적대 리뷰 지적). 이미 있는 "만료/정지=전 기능 차단" 기준(`canUseFeature`·`ACTIVE_PAID_PLAN_WHERE`)을 공유해야(플랜코드 AND `!isSubscriptionBlocked`). 무과금 서비스라도 만료 고객이 직원 노동+AI 비용 무상 유발=실손실. 자격 검증은 목록 SQL·접수·**실행 시점** 전부 단일 헬퍼 통일(실행 재검증 누락=다운그레이드 우회). 기능 게이팅 진실 원천=plans 플래그(코드 아님) — 유료 간 차이는 UPDATE로 해소.
- **jsonb 안 공유 배열(명령 큐 등) = read-modify-write 금지, 쓰기 축 분리** (2026-07-10) — sync_agents.config.commands를 heartbeat(제거·스탬프)와 admin(추가)이 각자 읽고 통째 덮어쓰면 사이에 낀 쓰기가 유실(Codex FAIL 실측). 해법 = 추가 쪽은 단일 UPDATE 원자 append(`jsonb_set(..., COALESCE(config->'commands','[]') || $1)`), 갱신 쪽은 그 키 동등 조건부 UPDATE(`WHERE config->'commands' = $orig`)+충돌 시 재조회 재계산. 일일 상한류 선-카운트 후-INSERT도 같은 TOCTOU — 상한 판정을 INSERT 단문 서브쿼리로 결합.
- **외부 연동 서버의 "동일 사양으로 구축 완료" 통지 = 우리 쪽 실호출 전까지 개통이 아니다** (2026-07-20) — 강문희 "54서버 포팅·기동 완료, 58과 동일 사양" 통지 후 호출했으나 `EHOSTUNREACH`. 원인 = **58은 ufw, 54는 firewalld**로 방화벽 계열 자체가 달랐고 25230이 미개방(상대는 `127.0.0.1`로만 내부 테스트). "동일 사양"은 데몬·설정 파일 기준이지 OS 방화벽까지 포함하지 않는다. 교훈 ①외부 연동 개통은 **우리 환경에서 실제 호출**로만 확인 ②문의는 **원인 단정 대신 관측값+확인 요청**으로 — "ufw에 우리 IP 추가해달라"고 단정해 보냈다면 전제(ufw 아님)가 틀린 메일이 됐다. 확인 요청 형태라 상대가 실제 구성을 알려주며 한 번에 풀렸다 ③진단 근거는 **대조군으로 검증한 것만** 쓴다 — "즉시 실패라 방화벽 REJECT"·"22번도 막혔으니 호스트 차단"·`curl: (7)` 문구는 모두 정상 서버의 닫힌 포트에서도 동일하게 나와 근거가 못 됐고, 유효한 건 애플리케이션이 받은 `EHOSTUNREACH`(포트 미기동이면 `ECONNREFUSED`) 하나뿐이었다.
- **이관(import)의 "완료"는 자기 카운트가 아니라 외부 기준 차집합으로만 증명된다** (2026-07-20) — 0715 아난티 템플릿 pull이 `failed 0 / 중복 0 / 재카운트 일치`로 종결 보고됐는데, 게이트웨이가 실제 라우팅하는 B_ 코드 62개가 한줄로에 없었다(5일간 무증상). 근본 = 그 회사 senderKey 2개 중 1개만 연결돼 **그 키의 템플릿이 pull 대상 자체에 안 들어옴** → 대상에 없으니 실패도 안 나고 카운트도 맞는다. 교훈 ①이관 검증은 "내가 만든 수"가 아니라 **원천(게이트웨이·외부 시스템)이 아는 키 집합 − 내가 가진 키 집합 = 공집합**으로 판정 ②차집합이 0이 아니면 반드시 **사유 분류**(대상 키 미연결 / 원천에만 존재 / 귀속 불일치 / INSERT 실패) — 뭉뚱그린 "N건 누락"은 조치로 안 이어진다 ③1:N 축(회사:senderKey, 회사:bill)에서 N을 하나만 처리하는 코드는 무증상 누락을 만든다. **합집합으로 묶어 전량 처리**가 기본. ④건수 비교는 등호가 아니라 포함 관계(외부가 더 많을 수 있음) + distinct 키 기준(같은 키가 서버 2곳에 등록되면 행수가 2배).
- **대량 import는 후속 워커의 조회 조건에 들어가는지 먼저 본다** (2026-07-20) — 위 import가 `alarm_notified_status`를 안 채워, 이관된 과거 확정 템플릿 847건이 5분 폴링 job의 `status IN (종결) AND alarm_notified_status IS NULL` 조건에 영구 잔존(수신자 0명이면 상태 표시 없이 재시도하는 분기라 자가 해소 안 됨). 실제 검수 중인 고객사 템플릿의 순번을 밀어내고, 수신자가 등록된 회사면 과거 승인 건이 알림 SMS로 실발송된다. **과거분 대량 적재 시 "이 행이 어느 워커의 WHERE에 걸리는가"를 전수 확인하고, 알림·재시도 대상에서 빼는 컬럼을 INSERT에서 함께 채운다.**
- **외부 URL을 우리 도메인으로 감싸는 기능 = 오픈 리다이렉터 검증 의무 + 파서 정규화 신뢰** (2026-07-10) — hlj.kr 단축(고객사 임의 URL)은 악성 URL 세탁 시 도메인 평판이 오염돼 기존 발송 링크 전체 도달률이 죽는다. 검증은 `new URL()` 파싱 **후** hostname 기준(스킴/자기도메인/IP·내부망/userinfo 차단) — 숫자형·8진·16진 IP(`2130706433`→127.0.0.1)와 인코딩(`hlj%2Ekr`→hlj.kr)은 파서가 정규화해주므로 원문 문자열 검사 금지·파싱 후 검사(공격면은 실측 후 테스트로 고정). deductCreditSafe 영구 실패=[CREDIT][MISS]+수동 재차감이 전사 정책 — 효과물(링크·발행물) 회수 보상 금지.

---

## 발송결과 집계 — LIVE/LOG 게이트웨이 (2026-07-04 추가)

### 요약 성공 0인데 상세는 성공 = LIVE 대기전용 집계 + LOG 미생성 게이트웨이
- **현상**: 비토 자체 게이트웨이(라인13, SMSQ_SEND_13) 직접발송이 발송결과 **요약**은 성공/실패/대기 전부 0, **상세내역**은 status_code 6/1000 성공 정상. 07.02 표준라인 발송은 6/6 정상.
- **근본**: `smsCampaignCountsSafe`(요약 실시간·6h 확정워커·정산환불·라이프사이클 5소비처 공용 유일 진입점) 산식 = **성공/실패는 LOG(_YYYYMM)에서만, 대기는 LIVE 큐의 status_code IN(100,104)에서만**(2026-06-11 큐→이력 이동 중 이중카운트 차단). 전제 = 표준 QTmsg는 결과 확정 시 행이 LOG로 이동. **라인13은 status를 제자리(100→1000) 갱신만 하고 LOG를 안 만듦** → LIVE 대기필터에 성공행(6/1000) 걸러지고 LOG엔 행 없음 → 전부 0. `result_final=false`(실시간)라 요약이 실시간 집계 경로.
- **확정**: 실데이터로 검증(no_guess) — PG `campaigns.result_final=f·success_count=0·send_config.sentTables=["SMSQ_SEND_13"]` + MySQL SMSQ_SEND_13 status 6/1000 존재 + SMSQ_SEND_13_202607 테이블 부재.
- **fix**: `classifyResultTables`(sms-table-split CT 단일 진실) — LIVE를 "LOG 짝 있음(대기전용 유지)/없음(결과까지 집계)"으로 분리. LOG 짝 없는 LIVE 행은 다른 테이블에 중복 불가 → 결과까지 세도 이중카운트 구조적 불가. 언더스코어 경계(`${t}_`)로 `_1` vs `_13` 오매칭 차단. smsCampaignCountsSafe + 엑셀 채널분리 집계(stats-aggregation) 통일. 표준 라인 산식 불변(회귀 0, 유닛 테스트로 고정).
- **교훈**: LIVE/LOG 이중 저장소 집계는 "결과=LOG only" 전제가 깔려 있다. LOG를 안 만드는 새 게이트웨이/라인은 그 전제를 깨서 성공이 통째로 누락된다. 새 발송 라인 추가 시 "결과 행이 LOG로 이동하는가"를 반드시 확인. 요약(캐시/집계) ≠ 상세(raw) 불일치는 집계 산식의 저장소 전제부터 의심.

## 자사몰 연동 API 실측 (카페24·고도몰) — 2026-07-03 추가

### 외부 몰 Open API 연동 = raw 에러가 스펙이다
- **파트너키+상점키 이중 구조 + 상점 동의 필수**: 카페24 OAuth(앱 승인) / 고도몰 partner_key(env, 전사)+key(몰별). 데이터 주인(몰)이 승인해야 함 — "우리만으로 처리"는 불가. 몰별 key는 실제 개설된 몰이 있어야 발급된다.
- **API 버전은 앱 등록 버전에 맞춘다**: 카페24 `X-Cafe24-Api-Version`이 앱 버전과 다르면 400("version not available. default 2026-03-01"). raw 응답이 정답 버전을 알려줌 — 추측 말고 실측(feedback_external_api_response_verification).
- **scripttag src는 CORS `Access-Control-Allow-Origin:*` 필수**(422). nginx 정적 파일엔 CORS 헤더가 없어, backend가 `/api/...` 경로로 파일을 읽어 CORS+CORP(helmet 기본 same-origin 덮기) 헤더와 함께 서빙하고 그 URL을 src로 등록. `.js` 경로가 nginx 정적에 가로채이지 않는지 curl로 본문·헤더 확인.
- **스크립트 자동삽입 API 유무가 turnkey를 가른다**: 카페24=scripttags API로 자동삽입 / 고도몰=삽입 API 없음 → 고객사가 스킨에 수동 삽입(치환코드 `{=gSess.memNo}` 등). 화면에 복붙 블록 제공이 최선.
- **브라우저 SDK page_view는 몰 도메인이 cdp_allowed_origins에 있어야**(requireCdpBrowserOrigin 403). 연동 시 자동 등록 안 하면 SDK 깔아도 수집 0.

### 연동 상태는 실제 검증 후에만 connected (6원칙②)
- `getXxxIntegration`이 status 무필터로 행을 반환하면 revoked·pending도 "연동됨"으로 오보고(카페24 revoked·고도몰 저장만 한 가짜 active 실측). 상태 판정 = `status='active'` + 검증 신호(connected_at) 존재.
- 자격 **저장** 시점에 status='active' 금지 → 저장=`pending`, 실제 연결 확인(verify) 성공 시에만 `active`+connected_at. 저장만으론 "연동됨" 절대 표시 X.

## 자동마케팅 완성 세션 (2026-07-02 추가)

### 스케줄 컬럼 의미 전환 = 기존 행 마이그레이션 + 재계산 루프 점검
- `continuous_operators.next_run_at`을 "발송 시각"→"생성 시각(발송 희망−lead)"으로 전환하면서 기존 행 −lead UPDATE 미동반 시 weekly/monthly가 한 주기 밀림. 또 생성 직후 next 재계산이 같은 주기의 T−lead(=지금)를 다시 잡으면 1분 워커가 무한 재생성 — 순수 함수(computeNextGenerationRun)가 생성 시각이 지났으면 한 주기 뒤로 밀도록 테스트로 고정.
- **교훈**: 시각 컬럼의 "의미"를 바꾸면 ①쓰기 3경로(생성/수정/실행 후) 전수 ②기존 행 마이그레이션 ③재계산이 같은 주기를 재선정하지 않는지, 셋을 한 세트로.

### 빈 객체 폴백 인자 = 조용한 전 회사 기본값
- `getCompanyCosts({})`처럼 "회사 row를 받아 폴백하는 헬퍼"에 빈 객체를 넘기면 모든 회사가 기본 단가로 계산된다(예상 비용·예산 가드 전부). 전수 grep으로 빈 객체 전달 1곳 확인 후 실컬럼(cost_per_*) 조회로 교정.
- **교훈**: `헬퍼(row)` 시그니처에 `{}`/`|| {}`를 넘기는 호출부는 의도된 기본값인지 전수 확인.

### 유료 AI 기능 신설 = 크레딧 3점 세트 (Harold 확정 기준)
- `callAIWithFallback`은 creditCost 미지정 시 source 맵(getCreditCost)으로 사전 확인+성공 후 차감까지 자체 처리(묶음 안은 0). 신규 유료 기능은 backend CREDIT_COST_MAP + frontend CONFIRM_CREDIT_COSTS/라벨 + 트리거 지점 CreditConfirmModal을 한 세트로. **기준: 버튼 트리거 20크레딧 이상 = 사전 모달 의무. 모달 표시 금액 = 실차감** — 백엔드가 조건 분기 차감(인터랙션 DM 발행 120)이면 프론트도 같은 기준으로 source 분기(2026-07-02 표시 100≠차감 120 결함 수정).

### 신규 컬럼/테이블 + 배포 1회 원칙 양립 패턴
- 검증 SELECT(0 rows 확인)→ALTER/CREATE를 배포 블록에 묶고, 코드는 `does not exist` catch로 해당 기능만 조용히 skip(워커) 또는 503 DB_MIGRATION_PENDING(라우트). 실측 사례: recap_notified_at은 사전 SELECT에서 1 row(이미 존재)로 확인돼 ALTER 생략 — 사전 확인이 이중 ALTER를 차단. prep_reminder_sent_for는 0 rows로 실행 대상 확정.

---

## 라우팅 / 미들웨어 순서 사고

### 2026-07-02(5) — 공개 라우터를 전역 express.json() 앞에 마운트 → POST req.body 유실 (DM 개인별 열람 0 진짜 원인) ★ 신규
- **현상**: 모바일DM 개인별 열람이 배포·재기동을 반복해도 계속 0. 총 열람 집계(30일 열람 26)는 되는데 수신자별은 전원 미열람. dm_views 행은 쌓이나 recipient_token/phone/anonymous_id/max_scroll_pct/duration이 전부 NULL/0.
- **오진 3회**: ①배포 안 됨(재기동 필요) → 하드 restart(mem 새 부팅)에도 동일 ②src에 낡은 .js가 .ts를 shadow? → `find src -name '*.js'`=0 ③최종 = `app.ts` 마운트 순서 실측.
- **결정타**: 서버 로컬 curl로 유효 토큰+anon+scroll+duration을 `/track`에 직접 전송 → 응답 {"ok":true}인데 저장 행 전부 NULL. "코드가 아니라 본문 자체가 안 들어온다"를 증명(브라우저·문자·모바일 변수 전부 제거한 순수 서버 검증).
- **근본**: `app.ts`에서 `app.use('/api/dm/v', dmPublicRouter)`를 뷰어 인라인 스크립트 CSP 때문에 helmet·전역 `express.json()` **앞**에 마운트. 그 라우터의 POST(`/track`·`/event-response`·`/ab/track`)는 전역 파서를 못 거쳐 `req.body`가 빈 채로 도착 → 비콘 데이터 전부 유실. 지난 세션(0702-3)이 서버측 GET 열람 기록을 없애고 이 POST 비콘 하나에 전부 의존하게 만들며 잠복 결함이 드러남.
- **수정**: `dmPublicRouter.use(json({ limit: '1mb' }))` (라우터 자체 파서). GET 뷰어·이미지는 본문 없어 영향 0. 같은 원인으로 죽어 있던 `/event-response`(응모·투표·쿠폰·설문 = 응모·액션 늘 0의 원인)·`/ab/track`도 동반 복구. 서버 curl로 recipient_token·phone·scroll·duration 실적재 확인 + 실사용 화면 100%/95% 완독 확인.
- **교훈**:
  1. **공개(비인증) 라우터를 전역 body 파서 앞에 마운트하면 그 라우터의 POST는 req.body가 빈다.** helmet/CSP 때문에 앞에 둘 땐 그 라우터에 자체 body 파서를 붙일 것. 새 공개 POST endpoint 추가 시 필수 점검.
  2. **"배포했는데 옛 동작"은 서버 로컬 curl로 순수 검증하라** — 브라우저/문자/모바일 변수를 다 제거하면 "코드 vs 본문 vs 프로세스" 어느 층 문제인지 한 방에 갈린다. ts-node라도 소스만 보고 "배포 안 됨" 단정 금지.
  3. **집계는 되는데 개별이 0** = 행은 쌓이나 식별자(join 키)가 안 들어오는 구조 의심. 집계 카운트와 join 매칭을 분리해 볼 것.

## 발송 시스템 사고

### 발송 5경로 부분 패치 (반복 패턴)
- **사례**: AI 캠페인 / 직접발송 / 타겟 / 스케줄 / 테스트 5경로 중 1곳만 수정 → 동일 버그 재발.
- **대책**: `messageUtils.ts replaceVariables()` 공통 함수 사용. 발송 관련 수정 시 5경로 전수 점검.

### D188-Phase2B (Journey 통합 진화 + 자동발송 영구 폐기 + 위반 단어 117건)
- **Phase 2-B-4 자동발송 영구 폐기**: 사용 고객사 0 + 여정이 진짜 업그레이드 → DashboardHeader 메뉴 제거 + AutoSendPage 안내 페이지 + routes/auto-campaigns POST 410 Gone + 운영 데이터 보존
- **Phase 2-B-1 Wait + Condition step 신규**: journey-builder activateJourney step_type별 검증 + journey-executor evaluateCondition 함수 (customer_field 9 operator + custom_fields JSONB fallback)
- **Phase 2-B-2 MMS + KAKAO 채널 확장**: DB ALTER journey_steps 7 컬럼 + processExecution channel 분기 (kakao_templates 조회 + insertAlimtalkQueue)
- **Phase 2-B-3 A/B + Bandit 통합**: DB CREATE journey_step_variants + bandit-optimizer 7 함수 + Thompson Sampling 자동 선택 + reward 누적
- **위반 단어 영구 룰 전수 정정**: 117건 (Phase 1 PDF 캡처 31건 + Phase 2 frontend 21 파일 57건 + Phase 3 backend 응답 메시지 21건 + 활용형 변형 8건). 자가 grep 패턴 = 활용형 (박히지/박혔/박힐/박았 등) 전수 의무.

### D188 (영업팀장 알림톡 14건 — 9 파일 통합 fix)
- **대책 9 파일**:
  1. AlimtalkPreview select-none → select-text
  2. AlimtalkTemplateFormV2 wrapper textarea pointer-events-none 제거 + readOnly attribute + 반려사유 박스 max-h+scroll
  3. AlimtalkManagementSection 템플릿코드 컬럼 + 검색 UI(4 영역)
  4. AlimtalkChannelPanel rows={6} + LMS 대체 subject + 본문 변수 자동 동기화
  5. AlimtalkSendModal handleClose 안전망 + nextSubject 검증
  6. Dashboard alimtalkNextSubject state + 3 모달 props
  7. alimtalk-jobs callback fallback (admin_phone_number 빈 영역 → sender_registrations fallback)

### D152 (AI 다듬기 4 사고 — 창작/보수성/EUC-KR/백틱)

#### 4-1. In-Context Learning 창작 사고
- **사례**: AI 메시지 다듬기 시스템 프롬프트에 "매장에서 만나뵐게요"/"단 3일 한정" 같은 원본에 없는 표현 → AI 그대로 학습 → 모든 회사 다듬기에 임의 창작 확산 = 사고.
- **대책**:
  1. 시스템 프롬프트 §1 최상위 "원본에 없는 정보 절대 추가 금지"
  2. In-Context 4개 모두 원본 정보만 사용한 진짜 다듬기 예시
  3. negative example 1개 명시
  4. 후처리 `removeAddedVariables` — 원본에 없는 변수 + 후속 조사 자동 제거
  5. `appendMissingVariables` — 원본 변수 보존

#### 4-2. 보수성 ↔ 풍성성 균형 사고
- **사례**: 창작 사고 차단을 위해 시스템 프롬프트 §1을 너무 보수적으로 → AI가 안전한 단어 정리 수준만 → 사용자 "API로 다듬은 거 맞아?" 의문.
- **대책**: "보존 영역(상품/할인율/일시/숫자/매장/연락처/이벤트명)" vs "자유 영역(수식어/감성/계절 묘사/감사 인사/CTA)" **명확히 분리** + 길이 80~150% 허용. `getSeasonContext()` helper (현재 월 기반 자동 시즌 키워드). 다듬기 = "사실 변경 X" + "표현 풍성 O" 양방향 균형.

#### 4-3. SMS EUC-KR 인코딩 이모지 발송 깨짐
- **사례**: 시스템 프롬프트 "이모지 1~2개 적절 추가" + In-Context 예시(😊⚡✨🤝) → AI 학습 → 다듬기에 유니코드 픽토그램 → SMS/LMS EUC-KR 발송 시 깨지거나 `?` 변환 = 사고.
- **대책**:
  1. 시스템 프롬프트 §3 "유니코드 이모지 절대 금지 + SMS 호환 특수문자만"
  2. `SMS_SAFE_SPECIAL_CHARS` 47개 (EUC-KR 호환 검증된 ★/☆/♥/♡/◆/■/▶/●/○/♨/※/☞/☎/①~⑧/㈜ 등)
  3. `stripIncompatibleEmojis` 후처리 — 화이트리스트 외 비-ASCII 비-한글 자동 제거 + variation selector + ZWJ 제거

#### 4-4. template literal raw 백틱 tsc 사고
- **사례**: 시스템 프롬프트 텍스트에 "?로 변환됨" 표현을 위해 raw 백틱 박음 → outer template literal 종료 → TypeScript parser 에러.
- **대책**: template literal 내부에 raw 백틱 절대 박지 말 것. 큰따옴표/작은따옴표 + 다른 표현. 시스템 프롬프트 작성 후 tsc 사전 검증 필수.

### D152-1 (form-data v4 multipart 한글 파일명 — RFC 5987)
- **사례**: 5/11 한글 파일명 (`11비율.jpg`) → IMC 미리보기 깨짐. `form-data` lib는 RFC 5987 자동 처리 X → IMC Java/Spring latin1 해석 → octet-stream 인식.
- **대책**: `toAsciiSafeFilename(filename)` 헬퍼 신설 — ASCII 영문/숫자/`.-_`만 통과, 한글/특수 포함 시 `evidence_${Date.now()}.${ext}` 변환. 원본 파일명은 PG `inspection_evidence_filename` 보존, IMC 전송 시점만 변환.
- **교훈**: 외부 라이브러리 동작은 영문/ASCII 케이스만 검증하면 한글 케이스 회귀 위험 — 검증 시 한글 파일명 케이스 필수 커버.

### D150-5 (UX 3건 — SearchableSelect 컨트롤타워)
- **대책**: D144 P11+P13 SearchableSelect 컨트롤타워 확장 적용. 드롭다운 검색 패턴 통합.

### D150-3 (직접발송 0 NULL — cellToString)
- **사례**: 엑셀 D2/E2/F2 = 0 값이 `row[col] || ''` falsy 처리로 빈 문자열 변환 → NULL 발송. 벤제프 113건 잘못 발송.
- **대책**: `cellToString` 컨트롤타워 신설. `|| ''` 패턴 25곳+ 일괄 교체. 인라인 `safeStr` 정의 금지.

### D150-4 (발송결과 ORDER BY tie)
- 발송결과 `dest_no ASC` tie-breaker 추가 (3곳). LIMIT/OFFSET 청크 = unique tie-breaker 필수.

### D151-2 (환불 워커 부재)
- `campaign-sync-worker.ts` 5분 cron 신설. fire-and-forget sync 한계 영구 차단.

### D110 (하드코딩 테이블명)
- `getCampaignSmsTables` 등 CT-04 함수 사용. 라우팅 단일 진입점.

### D106 (LEFT JOIN 모호성)
- JOIN 추가 시 모든 컬럼에 alias (`c.`, `u.`) 명시 필수.

### D98 (MMS 절대경로)
- `mmsServerPathToUrl` 컨트롤타워 활용.

### D76 (AI 요일 연산 오류)
- 날짜/요일 관여 프롬프트에 반드시 시스템 생성 달력 (`getKoreanCalendar`) 제공.

---

## AI 호출 매트릭스 (D170+ ~ D214+)

### 크레딧 created_by = 요청 컨텍스트 자동 (2026-06-02)
- callAIWithFallback createdBy = `params.userId || currentUserId() || null`. currentUserId = AsyncLocalStorage(`utils/request-context.ts`), authenticate가 `enterWith`로 요청 사용자 전파.
- 새 AI 작업(callAIWithFallback 경유)은 호출부 무수정으로 자동 created_by 기록. orchestrate도 동일 fallback.
- cron/worker(예측·operator)는 요청 컨텍스트 없음 → 호출측 명시(예측=회사 대표 admin / operator=operator.createdBy). 월 리셋=created_by 없음='자동'.
- 이력은 정산·감사 근거 = 모르는 과거 건에 부정확 ID 소급 X(created_by null='자동' 정직). enterWith 전파는 환경따라 불안정 가능 — 런타임 확인 후 미작동 시 명시 전달 fallback.

### 모델 분리 룰 (`feedback_ai_operator_model_isolation`)
- **AI Operator** = Opus 4.7 (callAIWithFallback `model: 'opus'`)
- **기존 한줄로AI** = Sonnet 4.6 (절대 건드리지 말 것 — 6,000사+ 운영 영향)
- gpt vs gptOperator 분리

### AI 임의 혜택 금지 (`feedback_ai_no_arbitrary_benefit`)
- AI는 메시지 흐름/구조/인사 텍스트만 제안
- 구체 혜택 (%/원/무료/쿠폰/사은품/적립/무료배송/할인) 절대 임의 생성 X
- `[직접 작성해주세요]` placeholder + activateJourney 활성화 시 `hasUneditedPlaceholder` 차단

### 0건 타겟 자동완화 X (D171 + `feedback_no_target_auto_relax`)
- `relaxFilters/auto_relax/autoRelax/Zero-Count Auto-Relax` 어디에도 박지 X (D171 전수 제거)
- `saved_segments.auto_relax` DB 컬럼 보존 + 항상 false
- 0건이면 "조건을 조정해주세요" 안내만 + AI 재추천 X

---

## 외부 API 응답 검증 사고 (D217+ 추가)

### D217+ (2026-05-26) — 카카오 알림톡 templateCode 18일 누락 사고

**Critical 사고**: 옛 D147(2026-05-08) 코드 안 IMC list 응답 구조 추정 사고. 운영 환경 8건 (검수 통과) 100% 자체 코드(`Tmp_xxx`)로 18일 유지. 진정 카카오 templateCode(`B_XX_xxx_xx_xxxxx`) 동기화 누락.

**Root cause**:
- 옛 D147 코드: `(lst.data as any)?.list || (lst.data as any)?.data?.list || []`
- 본 코드 = 4014 fallback 전용 진입 경로라 일반 운영에서 검증 X = 잠재 사고
- 실제 IMC 응답 키 = `[hasNext, total, templateList]` — 옛 fallback 매트릭스 어디에도 없음
- D217+ sync worker 신설 시 옛 코드 그대로 차용 = 첫 사이클 `matched=0/failed=8` 사고

**진정 정정** (`utils/kakao-template-sync.ts` + `routes/alimtalk.ts:706`):
```typescript
const items: any[] =
  (r.data as any)?.templateList ||   // 진정 IMC 필드명
  (r.data as any)?.list ||
  (r.data as any)?.data?.list ||
  [];
```

**4 Phase 동시 정합** (영구 안전망):
1. `POST /api/alimtalk/jobs/sync-template-codes` 백필 endpoint (1회성)
2. `getAlimtalkTemplate` 사용자 조회 시점 자동 동기화
3. `kakao-template-sync-worker.ts` 30분 cron worker
4. 옛 D135+ B3 fallback 동시 정정

**진단 흐름 (영구 사례)**:
- 1차 진단: `matched=0/failed=8` 결과만 보고 stderr 추정 사고 가설
- 2차 진단: 디버그 로그 추가 (응답 키 / 첫 item / raw 500자)
- 3차 진단: Harold raw 정독 = `templateList` 필드명 영구 발견
- 4차 정정: 진정 root cause fix = 8건 모두 정정 완료

**교훈**:
- **외부 API 응답 구조는 추측 또는 옛 코드 차용 X — 실제 raw 직접 확인 의무** (영구 룰 `feedback_external_api_response_verification` 신설)
- 옛 fallback 매트릭스가 있다면 = 옛 코드가 실제로 진입한 경로인지 git log + PM2 로그 검증 의무
- `console.error` / `console.warn` 진단 의존 X (stderr 분기 진입 차단) — `console.log` (stdout) 의무
- 페이지네이션 (`hasNext`) 처리 — 첫 페이지만 break X

---

## 여정 검증/테스트 경로 본문 불일치 사고 (D230+ 추가)

### D230+ (2026-06-03) — 여정 스팸테스트 본문 ≠ 실제 발송 본문 (광고 표기·무료거부·제목 누락)

**사고**: 여정 스팸필터 테스트(활성화 검증 시 테스트폰 3대 발송)에 (광고) 표기·무료수신거부·LMS 제목이 모두 누락. 광고성 메시지인데 정보통신망법 표기 누락 = 큰일 직전. (실고객 발송이 아니라 테스트폰이었으나, 같은 누락이면 실발송도 위험했음.)

**Root cause**:
- 실고객 발송(`journey-executor` 484-508)은 `prepareSendMessage`로 (광고)+080+제목을 합성 → **정상**.
- 스팸테스트(`journey-pretest-validator` 145)는 원본 `msg.body`/`step.subject`를 `enqueueSpamTest`에 그대로 전달 → `buildAdMessage`/`buildAdSubject` 미적용 → (광고)/무료거부 없음.
- `spam_filter_tests`에 `subject` 컬럼 부재(information_schema 0 rows) → 제목이 저장조차 안 됨 → `executeSpamTest` 339 `test.subject`=null → 제목 빈칸.

**정정**:
1. pretest-validator에서 `getOpt080Number`로 080 조회 → `buildAdMessage`(본문)·`buildAdSubject`(제목) 합성 후 enqueue.
2. `enqueueSpamTest` INSERT에 `subject` 추가.
3. `ALTER TABLE spam_filter_tests ADD COLUMN subject text` (executeSpamTest는 `t.*` 조회라 자동 반영).

**교훈**: **검증/테스트 경로가 실제 발송 경로와 다른 본문을 쓰면 사고.** 스팸 판정이 부정확해지고 테스트폰에도 비정상 본문이 나간다. 광고 합성·무료거부·제목 등 발송 가공은 **실발송/검증/미리보기 전 경로가 동일 CT(`prepareSendMessage`·`buildAdMessage`·`buildAdSubject`)를 거치게** 정합. 발송 5경로 전수 점검에 **검증·테스트 경로 포함**.

---

## 직접발송 대량 504 사고 (D231+ 추가)

### D231+ (2026-06-04) — 톤28 8~30만 발송 504 + 중복 발송 (응답 전 동기 정제 self-join 폭발)

**사고**: 톤28(toun28) 8~30만 직접발송 시 빨간 알럿(504) 반복 → 오류로 알고 재시도 → 중복 64만건 처리(취소·예약도 send_phase='sent'로 게이트웨이 송출).

**Root cause**: commit endpoint가 정제(수신거부 DELETE + **중복제거 self-join** `a.phone=b.phone AND a.id>b.id`)를 **응답 전 동기로** 수행. `(staging_id,phone)` 인덱스가 있어도 **같은 테이블 자기조인**이라 10만에 59초(\timing 실측 239,674ms) → commit 60초 초과 → **nginx 504(upstream timeout)**. 백엔드는 완주 → 발송 + status='scheduled' 잔존 → 재시도 중복.
- 진단: 백엔드 out.log 완료만, error.log에 commit 에러 0 → **백엔드 안 죽음, nginx가 응답 못 받아 504**. nginx access.log `POST /direct-send/commit 504`, error.log `upstream timed out`.

**정정** (`routes/campaigns.ts` + `utils/direct-send-worker.ts` + `DirectSendPanel.tsx`/`Dashboard.tsx`):
1. commit 정제 제거 → 발송 건수만 COUNT(헬퍼 `countStagingFiltered`) → 즉시 202.
2. 정제(중복 ctid+ROW_NUMBER O(N log N) + 수신거부 인덱스 JOIN)를 worker 발송 직전(processed===0)으로 이동.
3. 모달 카운트도 phones 통째 POST·프론트 계산 폐기 → stage 적재 후 count endpoint(같은 헬퍼). count=commit=worker 동일 기준이라 모달=차감=발송 일치.

**교훈**:
- **응답 전 동기로 대량 정제(DELETE/JOIN) 금지** — 타임아웃은 백엔드 에러 안 남고 nginx 504. commit/모달은 즉시 응답, 무거운 작업은 worker 청크.
- **self-join(자기조인 `a.id>b.id`)은 인덱스로도 폭발** — 중복제거는 ctid+ROW_NUMBER 한 패스(O(N log N)).
- **진단은 백엔드 error.log + nginx access/error 둘 다** — 백엔드 완주 시 백엔드 로그엔 안 남는다.
- 대량 정제 카운트(모달)는 프론트 메모리/phones 통째 POST 금지 → staging 서버 COUNT.

---

## 여정 엔진 전면 결함 (D232+ 추가)

### D232+ (2026-06-04) — 여정 타겟 추출·발송·시점 전반 결함 (자유여정 진입 부재 포함)

**배경**: 신규가입 여정 시연 중 신규가입자 0(목업 고객DB 재업로드)인데 500건 발송. 추적 결과 여정 엔진 전반 결함. 핸드오프 `docs/superpowers/handoffs/2026-06-04-journey-engine-redesign-handoff.md`.

**결함(라인 근거)**:
1. **자유여정(custom) 진입 부재** [CRITICAL] — `journey-builder.ts:685` activateJourney가 status active+snapshot+알림스케줄만, journey_executions INSERT 0. `journey-trigger-watcher.ts:71` custom 제외 + `journey-target-extractor.ts:135` default 빈배열. → 자유여정 활성화해도 발송 0(사용자 최다 사용 타입).
2. **신규가입 created_at 재업로드 취약** [CRITICAL] — `journey-target-extractor.ts:41` `created_at >= NOW()-N시간`. 고객DB 전체 재업로드 시 created_at 갱신 → 전원 신규 오인(실측 2만명 일괄→전체→LIMIT 500 발송).
3. **cdp trigger opt-out/is_active 필터 누락** [CRITICAL] — `extractor.ts:97`(cart)·`152`(purchase/reservation): customer_conditions 없으면 customers JOIN 스킵 → sms_opt_in/is_active 미적용 → 수신거부 발송.
4. **조건평가 default pass** [HIGH] — `journey-executor.ts:1014/1029/1039/1043/1078` null·DB오류·미지원 전부 return true → 조건 무시 발송. (활성화 형식검증은 있으나 런타임 DB오류 못 막음.)
5. **고객당 개별 campaign** [CRITICAL] — `executor.ts:630` 고객 1명당 campaigns INSERT(target=1)+차감(587 ref=journey_id)+큐(702). 500명=500 campaign+500 차감+발송결과 500행 폭주. **여정도 직접발송처럼 staging 묶음+청크+%고객명% 필요.**
6. **LIMIT 500** [HIGH] — `trigger-watcher.ts:113`. 조건 10만이면 500만. 제거 필요(묶음 동반).
7. **step 시점 = now+delay** [HIGH] — `trigger-watcher.ts:145`. 전일 대상 묶어 다음날 지정 시각이어야(step1=충족 후 N일+시각, step2=step1+72h 등).
8. **is_invalid(무효번호) 전 trigger 누락** [HIGH].
9. **미리보기(LIMIT 30) vs 실발송(LIMIT 500) 규모 불일치** [MEDIUM].

**긍정(이미 있음)**: 발송 2h 전 담당자 알림 스케줄 `journey-builder.ts:679 scheduleNotificationsForActivation`(스팸필터 2h 전 토대).

**교훈**:
- **trigger 추출은 "레코드 생성 시각(created_at)"이 아닌 "안정 기준(가입일·이벤트 occurred_at)"으로** — 재업로드/갱신에 무너지면 전체 오발송.
- **공통 안전 필터(sms_opt_in·is_active·is_invalid·is_opt_out)는 모든 trigger·customer_conditions 유무 무관 적용** — JOIN 조건부면 누락.
- **조건평가 DB 실패 = default pass(발송) 금지 → 안전 분기(미충족 취급)**.
- **여정 발송도 직접발송 staging 묶음 구조 재사용** — 고객당 개별 campaign = 500명 500건 폭주.
- **자유여정도 진입 worker 필수** — trigger 제외 + extractor case 부재면 발송 0.
- **점검 보조 도구(서브에이전트)가 구버전 schema.sql을 보면 오진**(region·birth_month_day "없음" 보고했으나 실 customers엔 존재) — 실DB 컬럼 기준 의무.

**★ 2026-06-04 세션2 — Phase 1~5 fixed (배포)**:
- 결함 **#1·#2·#3·#5·#6(cdp)·#8 수정**. 남은 #4(조건평가 default pass)=Phase 7 · #7(step 시점)=Phase 6 · #9(미리보기)=Phase 9.
- **여정 SMS 큐 app_etc1/app_etc2 뒤바뀜 발견·정정** — `bulkInsertSmsQueue`는 app_etc1=row[6]·app_etc2=row[7](`sms-queue.ts:942·944`)인데, 여정 SMS가 row[6]=company_id·row[7]=`journey:...`로 뒤바뀌어 여정 SMS 수신자 상세(`results.ts` WHERE app_etc1=campaignId)가 안 잡혔음. Phase 5에서 row[6]=campaignId로 정정.
- **여정 과금 = prepaidDeduct(발송 시, `executor:587`), campaign_runs 월정산 밖**(여정은 campaign_runs 미생성) → app_etc1 변경이 billing에 영향 0. billing은 `campaign_runs.id`(run_id) GROUP BY app_etc1로 집계.
- **진입 원장 키 = 시스템 upsert 식별자(회사+매장코드+전화번호)** — created_at 의존 0. 업로드=`customer-upsert` upsert(키 동일)라 created_at·id 보존, 전체삭제(`customers.ts:1533`)·업로더별삭제(`admin.ts:231`)만 리셋(드묾).
- **묶음 발송 = (journey,step,KST날짜)당 campaign 1건 공유**(journey_step_campaigns find-or-create) — staging/사전렌더 불요(executor 5분 소량 처리 → OOM 위험 0, 톤28 무관). 직접발송 파이프라인 격리.

**★ 2026-06-04 세션3 — Phase 6·7·8 fixed (배포 408f6e9)**:
- **#4 조건평가 안전분기** = Phase 7: `evaluateCondition` boolean→`met`/`not_met`/`error` 3분기. DB오류=`error`→발송 보류+재시도(`handleConditionEvalError`, 발송실패 재시도 패턴 재사용, 발송 X). null·미지원 type·미지원 operator·빈 field·빈 event_name=`not_met`. customer_field 순수 평가 `journey-condition.ts`(신규 CT) 분리. 활성화 형식검증 유지.
- **#7 step 시점** = Phase 6A: `calculateNextRunAt`를 `send-time-util.ts` CT로 이동(now 인자→순수 테스트). trigger-watcher 두 enqueue가 step1 SELECT에 delay_mode·target_hour_kst 추가 후 calculateNextRunAt 사용 → step1도 specific_hour(다음날 지정 시각)·next_business_day 적용.
- **발송 2시간 전 스팸테스트** = Phase 6B: 깨진 `predictNextSendTimes`(journey_executions에 없는 scheduled_at·step_id 조회 → 활성화 catch가 삼켜 2h 알림 0건) 폐기 → `scanAndPretest`(active execution 중 next_run_at 2시간 안 + 다음 step이 message인 것을 (journey,step,KST날짜)당 1회, journey_pretest_schedules dedup). 통과면 담당자 LMS, enqueue 실패(잔액)면 다음 주기 재시도, 걸리면 `regenerateStepAvoidingSpam`(source `journey-ai-refine`=1크레딧 자동, callAIWithFallback)+재테스트→통과면 최신 snapshot UPDATE(executor가 최신 snapshot 본문 발송 238~252행)+안내, 또 걸리면 `pauseJourney`(공용 CT 추가). `runStepSpamTest` 공용 추출(활성화 검증+스캐너 공유). 순수 코어 `journey-pretest-scan.ts`(신규). **걸렸을 때만 1크레딧 — 통과는 무료(Harold 정책).**
- **trigger 확장** = Phase 8: `customer.points_expiring` — points 임계 + (미사용 recent_purchase_date 오래됨 / 연 소멸일 MM-DD D-N). extractor case + watcher 자동(active 전수) + JOURNEY_TEMPLATE + union. `resolvePointsExpiringConfig` 순수(미설정 vs 0 구분 — `Number(x) || def` falsy 함정 clampInt로 교체). **포인트 소멸일은 고객 필드가 아니라 여정 정책(회사 1개 날짜).**
- **남은 #9 미리보기** = Phase 9: simulator matchTriggerCustomers 폐기 → selectJourneyTargetCustomerIds 단일 진입점 통일 + 임의 상수 교체 + UI. 핸드오프 `docs/superpowers/handoffs/2026-06-04-journey-phase9-handoff.md`.
- **교훈**: tsc는 SQL 컬럼 검증 못 함 → information_schema 순수 덤프로 실컬럼 확인 후 작성(scheduled_at·step_id 부재 확정). DB-의존 wrapper(AI 호출·스팸 enqueue)는 순수 테스트 불가 → 순수 코어(조건·dedup·config)만 분리 TDD, 통합은 tsc+검증된 패턴 재사용.

**★ 2026-06-05 Phase 9 + 배포후 map 누락 fix (운영 실측)**:
- Phase 9 완료(미리보기=실발송 통일·실데이터 예측·시점 N일+시각 relative_at_hour·여정 옵션 PATCH·타임라인). 상세 = `memory/project_2026_0605_journey_phase9_done.md`.
- **배포후 버그**: 발송 시각(relative_at_hour) 저장 안 됨. 근본 = `journey-builder.ts:246` `createJourneyFromTemplate`의 `input.steps.map`이 step 재생성 시 신규 필드(`delayMode`·`targetHourKst`·알림톡 6·`mmsImagePaths`)를 **객체에 안 담음** → 프론트 전송·백엔드 수신(console.log 입증)에도 INSERT 직전 누락 → relative/null. **검토 캔버스(input.steps)로 만든 모든 여정이 이전부터 발송시각·알림톡·MMS를 잃던 잠재 버그**(옵셔널 필드라 무증상). fix=9필드 보존 + 720h→8760h.
- **교훈 1**: 신규 step 필드 추가 시 `createJourneyFromTemplate`·`generateCustomStepsWithAI`·`tmpl.steps` 등 **모든 transform/map 경로를 grep**해 보존 확인. 한 곳이라도 map이 새 필드를 안 따라가면 받아도 누락. (full_pattern_grep_required = falsy뿐 아니라 "필드 보존"에도 적용.)
- **교훈 2**: 옵셔널 신규 필드는 tsc 통과 + 순수 테스트 미적용으로 **자동 검증 못 잡음** → 생성→DB 왕복 1건 실측이 유일한 안전망. "완료" 보고 전 운영 흐름 1건 실측 의무.
- **교훈 3**: 디버깅 시 "배포 안 됐을 것" 추측 금지 → `console.log`(stdout)+PM2 로그로 **수신값 실측**부터. (배포상태 추측으로 헤매다 Harold 격분 — no_guess 위반.) 백엔드는 ts-node(소스 직접 실행)라 dist 빌드 무관, pull+pm2 restart면 반영.

**★ 2026-06-05 세션6 발송결과 markFinalized 미완성 확정 (목록↔상세 불일치)**:
- **현상**: 운영 고객사 발송결과 목록(성공 2,304)과 상세 모달(성공 2,685)이 다름. 직원 "대기 0→478 변동" 신고.
- **근본**: `markFinalizedCampaigns`(campaign-sync-worker.ts)가 확정 조건으로 `(success+fail)>0`만 검사 → 5/30 result_final 일괄 마킹 때 LIVE→LOG 이동이 덜 끝난 4건이 success+fail(2,362)<sent(2,840)인 **미완성 상태로 확정**. 이후 LOG로 더 들어온 결과가 영구 미반영(24h sync 윈도우 밖이라 PG success_count 안 갱신). 목록=PG캐시(과소)·상세=MySQL실시간(정확) 두 소스라 어긋남.
- **fix**: 확정 조건에 `sent_count>0 AND (success+fail)>=sent_count` 추가(완전 집계분만 캐시 확정). 굳은 4건은 `result_final=false`로 되돌려 실시간(LIVE+LOG) 복귀. 라인그룹 캐시(`LINE_GROUP_CACHE_TTL`)라 두 번 조회 시 LOG 갱신되어 값 바뀜.
- **교훈 1**: 캐시 확정(result_final) = "완전 집계(success+fail=sent) 검증" 의무. 단순 `>0`은 진행 중을 확정시킴.
- **교훈 2**: 정산(billing.ts /generate·admin 요금정산)은 D144 이후 **MySQL 직접 집계**라 PG 캐시 과소와 무관 — 발송결과 화면(result_final 캐시 분기)만 영향. 돈 영향 판단 시 정산 산출 소스부터 확인.
- **교훈 3 (메타)**: `LEFT JOIN bt ON bt.reference_id=c.id`가 0건일 때 "차감 없음"으로 단정 = 추측. reference_id가 campaign.id가 아닐 수 있음(여정 발송은 제3 id) — `(matched, status)` 교차 집계로 reference 정체부터 확정해야. no_guess 위반 반복 사례.

**★ 2026-06-05 세션5 발송통계 hpio 0 + hoyun 폭발 + result_final 캐시**:
- **hpio 0**: 발송 데이터가 회사 라인 `{SMSQ_SEND_7,8,9}`인데 집계는 created_by의 user 라인 `{1,2,3}` 우선 조회 → 매칭 0. user 개별 라인그룹이 발송(5/30) 후 부여돼 발송/집계 라인이 어긋남. fix = `getCompanySmsTablesWithLogs`(집계 전용)를 `mergeLineTables`로 user+company **합집합**. 발송 경로(`getCompanySmsTables` user 우선)는 불변.
- **교훈**: 집계가 라인그룹 한정 조회라 발송 후 라인그룹이 바뀌면 과거 발송 집계가 깨진다. 집계는 합집합으로 내성 확보. (발송내역 상세 `getCampaignSmsTables`도 같은 잠재 — 추후 동일 적용 검토.)

---

## 알림톡 강조표기형 7300 — QTmsg 발송 에이전트 select_sql (D234+ 추가)

### D234+ (2026-06-09) — 강조표기형 전부 7300, 근본은 한줄로 밖(에이전트 qtmsg.xml)

**현상**: 알림톡 강조표기형(emphasize_type=TEXT)만 전부 7300(카카오 기타에러) → LMS 대체로만 도달. 기본형·채널추가형 정상. 직원 deliver 로그에 `etcJson[]` 빔.

**2시간 헛다리(전부 정상이었음)**: 한줄로 코드(buildAlimtalkEtcJson CT·insertAlimtalkQueue)·send_config·kakao_templates(emphasize_title 존재)·카카오 검수 승인(강조 변수형)·senderkey 제거(매뉴얼 {title}만) — 다 맞는데도 7300.

**근본(확정)**: 발송 에이전트 QTmsg(java 11개, `/home/administrator/agent1~11/bin`, **PM2 아님** — `ps aux | grep qtmsg`)의 `conf/qtmsg.xml` `<select_sql>`이 발송 직전 k_etc_json을 변형:
```sql
else concat(concat(concat('{"sendercode":"',sender_code),'",'), replace(k_etc_json,'{',''))
```
`sender_code`(=인비토 특수유형 부가통신사업자 식별코드)가 NULL(한줄로 INSERT가 안 채움) → **MySQL concat은 인자 하나만 NULL이어도 전체 NULL** → k_etc_json 통째 NULL → 강조 title 소실 → 7300. 채널추가형·기본형은 etcJson 불요라 무증상.

**증거**: `SMSQ_SEND_1_202606`(월별 이력) — 강조형 행 k_etc_json `{"title":"…"}` 정상 저장 + sender_code NULL + status_code 7300. 채널추가형 1800 정상. 한줄로 진단로그 OUT.etc 정상.

**미해결**: 인비토=특수유형 부가통신사업자(식별코드 의무). 문자 SMS/LMS는 잘 나감=중계사 자동 삽입 추정 / 카카오는 식별코드 불필요 추정 → **서팀장→IMC 메일 확인 대기**. 답변 후 fix = `docs/superpowers/handoffs/2026-06-09-alimtalk-emphasize-7300-imc-handoff.md` 분기 참조. 진단로그 `[ALIMTALK-DEBUG2]`(direct-send-processor) 원인 확정 후 제거 의무.

**교훈**:
- **발송이 안 되는데 한줄로 코드·DB·send_config 전부 정상이면 → QTmsg 에이전트 `conf/qtmsg.xml` select_sql부터 의심.** 에이전트가 발송 직전 발송 큐 컬럼(k_etc_json 등)을 SQL 수준에서 변형/덮어쓴다.
- **발송 큐(SMSQ_SEND_X)는 발송 즉시 비워진다** — 사후 SQL 0건은 "값이 없었다"가 아니다. 발송분 실값은 월별 이력 `SMSQ_SEND_X_YYYYMM`에서 조회.
- **MySQL `concat`은 NULL 하나로 전체 NULL** — 에이전트/SQL 합성 경로에 NULL 가능 컬럼이 끼면 전체 소실.
- 발송 에이전트는 PM2 목록에 없다(별도 java 실행파일) — 프로세스 추적은 `ps aux`.
- **hoyun 폭발**: 여정 500 campaign `status='sending'`+`result_final=false`. `syncCampaignResults`(campaign-lifecycle:238 직접발송 섹션)가 `app_etc1=campaignId`로 결과 0집계 → status 전환 조건(433) 미충족 → sending 영영 방치 → 캐시 없음 → 발송결과 조회마다 500 생집계 폭발. 인덱스 OK(`idx_app_etc1_status`, PG 6.7ms)라 인덱스 문제 아님.
- **fix(②)**: 발송통계 5곳을 `getCampaignResultCounts`(result_final이면 PG 캐시 MySQL skip)로 전환. ★ **복제(read replica)는 부하분리지 속도 아님**(같은 GROUP BY) — 속도는 pre-aggregation(캐시).
- **교훈**: D144가 PG 캐시 뺀 건 속도가 아니라 정확성(`billing.ts` 미러). D228+ `result_final`(6h 확정)이 그 정확성 문제를 해결 — 발송통계만 캐시 미적용이라 느렸음.
- **프론트 순수 TDD**: `type:module`(ESM)라 ts-node 순수 함수 TDD가 `ERR_UNKNOWN_FILE_EXTENSION`로 막힘 → 순수 로직을 backend로 옮겨 TDD(`campaign-list-csv.ts`).

---

## 자동마케팅 자율 발송 (D233+ / 2026-06-05 세션8)

### 자동실행이 크레딧만 차감하고 실발송 코드 전무 (CRITICAL) — 해소

**사고 구조**: 자동마케팅(Continuous Operator) 자동실행이 status='auto_executed' INSERT + 문안 크레딧 차감까지만 하고 **실제 발송 코드가 없었다**(markProposalExecuted 호출 0, 발송 워커·엔드포인트 0). ENT가 켜면 크레딧만 빠지고 고객은 메시지를 못 받음.

**해소(세션8)**: prep('scheduled'+scheduled_send_at) → 발송 패스(runAutoSendPass: 타겟 재추출·staging·createDirectSendCampaign·크레딧 멱등·통지). 직접발송 파이프라인을 createDirectSendCampaign으로 추출해 공유.

**교훈**:
- **자동실행/자율발송류 = "실발송 코드가 끝까지 있는지 + 차감↔발송 원자성"을 꼭 확인.** 차감만·미발송이 가장 큰 사고. 크레딧은 **발송 성공 시점에만 멱등 1회**(키=proposalId). 생성/승인 시점 차감 금지.
- **발송 코어 공유(dispatchProposalSend)** — 자동·수동이 같은 발송 경로를 타게 해야 본문·안전필터·(광고)/080·크레딧이 일관(D230+ 검증=발송 본문 일치 정신). 수동 승인도 백엔드에서 즉시 발송 = 원자성.
- **상태 값 전환 시 집계 SQL 전수 갱신** — auto_executed→'sent'로 바꾸면서 예산 sub-query `status IN ('approved','auto_executed')`에 'sent'를 안 더하면 예산 집계가 누락. 상태 추가/변경 시 그 상태를 읽는 모든 WHERE/집계 grep 전수.
- **claim 패턴(scheduled→sending UPDATE RETURNING)** = 동시 발송/중복 차단. 단 claim 후 예외로 throw하면 'sending'에 stuck될 수 있음 → 복구(타임아웃) 고려.

### 순수 테스트 DB-free 분리 — config/database import 시 process.exit(1)

`config/database.ts`는 import 시점에 `pool.query("SELECT 1")` + MYSQL_PASSWORD 미설정 시 `process.exit(1)`. 따라서 그 모듈을(또는 transitive로 끌어오는 customer-filter 등을) import한 모듈은 `.verify.ts` 순수 테스트가 즉시 종료된다.

**대책**: 순수 함수는 **DB import가 없는 파일**로 분리. SQL 빌더는 filterWhere를 **주입**받게 설계(operator-recipients.buildSendableRecipientsSql처럼) → journey-safety-filter 같은 순수 CT만 import → DB-free 테스트 가능. buildFilterWhereClauseCompat 호출은 DB-쓰는 호출부가 담당.

### updated_at 없는 컬럼을 UPDATE에 박아 조용히 실패

`operator_proposals`에는 `updated_at` 컬럼이 없는데 스팸 결과 UPDATE에 `updated_at = NOW()`를 박아 → catch에 삼켜져 spam_test_* 저장이 매번 조용히 실패하던 잠재 버그. **information_schema로 컬럼 실재 확인 후 UPDATE 작성**(db_column_verify_before_code). tsc는 SQL 문자열 컬럼을 검증 못 함.

### 직접발송 함수 추출(createDirectSendCampaign) — 동작 보존

/direct-send/commit 본문(라인그룹·검증 후 staging COUNT·campaign INSERT·prepaidDeduct·trigger)을 함수로 추출해 HTTP 엔드포인트와 자율 발송 워커가 공유. **INSERT 18 컬럼 파라미터를 순수 빌더(buildDirectSendCampaignParams)로 빼 테스트로 고정** → 톤28 504 정정(즉시 202+COUNT-only) 동작을 회귀 없이 보존.

---

## 자동마케팅·여정 점검 정정 (2026-06-06 / 배포)

### 차감↔발송 원자성 — 건당 발송은 "발송 성공 시점 차감"이 환불보다 깨끗 (여정 J1)
- **사고 구조**: journey-executor가 prepaidDeduct를 큐 INSERT 앞·비멱등(reference=journey_id)으로 호출 → 큐 실패 시 환불 없이 재시도가 재차감(중복 차감), 큐 성공인데 step_log 실패 시 재발송. 직접발송 워커는 실패분 환불하나 여정은 안 했음.
- **교정**: 큐 앞 = read-only 잔액 사전 확인만. 큐 성공 직후 = 멱등 마커(step_log 'sent') 먼저 기록 → 실제 차감. 큐 실패·발신번호 무효 = 차감 0·비용 0(advance 0). 재시도는 마커(alreadySent 가드)로 중복 차단.
- **원리**: 배치(직접발송)는 차감-후-환불(idempotent prepaidRefund, reference=campaignId 누적). 건당(여정)은 발송 성공 시점 차감 + 멱등 마커가 더 단순·안전(환불·reference 변경 불필요). **prepaidDeduct는 멱등 아님 — 같은 reference 매 호출 차감.**

### 월 예산은 누적 컬럼이 아니라 당월 로그 SUM (여정 J2)
- budget_monthly 검사가 journeys.stats_total_cost(전기간 누적)를 updated_at 당월 필터로 SUM = 단일 행이라 사실상 전기간 한도(월 리셋 없음). → 이번 달 journey_step_logs.cost(status='sent', sent_at >= date_trunc('month', NOW())) 합으로 교정.

### 같은 테이블 두 컬럼 세트 공존 = 쓰기/읽기 불일치 stale (여정 J3)
- journey_step_variants에 arm_alpha/arm_beta/variant_label(과거 503 "없는 컬럼" 정정 때 추가만)과 bandit_alpha/bandit_beta/variant_id(쓰기·선택 경로)가 공존. journey-stats는 arm_*/variant_label을 읽는데 그 컬럼은 한 번도 갱신 안 돼 변이 사후확률이 0.5 고정. → 쓰기 경로 컬럼(bandit_*/variant_id)을 출력 별칭으로 읽게 교정(map 무변).
- **교훈**: "없는 컬럼" 503을 컬럼 추가로만 막으면 데이터는 안 흐른다 — 쓰기 경로가 쓰는 컬럼으로 읽기를 통일. 두 세트 의심 시 information_schema 덤프로 실재 확정(0번 원칙). (operator_proposal_variants의 arm_*는 그 테이블 정상 컬럼 — 혼동 주의.)

### 자동마케팅 자율발송 'sending' 정지 복구 + 광고 080 가드
- claim(scheduled/pending→sending) 후 발송 커밋 전 예외면 'sending'에 영구 정지(runAutoSendPass는 scheduled만 조회). → dispatchProposalSend 커밋 전 try/catch가 admin_review로 내림 + createDirectSendCampaign 직후 campaign_id 마커 + 매 패스 reconcileStuckSending(campaign_id 있으면 sent 마감 / 없고 노후면 admin_review, 자동 재발송 X). 순수 decideStuckSendingRecovery + verify.
- 광고(isAd)인데 무료거부 번호(080·reject 폴백) 없으면 "(광고)…무료거부"가 번호 없이 발송(정보통신망법) → 자동·수동 공유 dispatchProposalSend에 가드(없으면 admin_review).

---

## 발송 시각 기준 통일 (D233+ 추가)

### D233+ (2026-06-09) — 발송통계 성공→실패 오분류 + 미도래 예약 대기집계 (등록시각 vs 발송시각)

**사고**: shiseido4·라프레리 발송통계에서 정상 성공 건이 실패로 집계(목록=실패/상세=성공), 미발송 예약이 '대기'로 집계. P1 돈/정산.

**Root cause**: **모든 시각 체크가 "발송시각"이 아니라 "등록/요청 시각" 기준**. 예약발송은 `campaigns.sent_at`이 **생성 시점**에 찍히고 실제 통신사 송출은 `scheduled_at`에 일어남.
- `campaign-lifecycle.ts` 120분 타임아웃이 `sent_at || scheduled_at`(등록 우선) → 예약은 scheduled_at에 발송되는 순간 이미 "120분 초과" → 통신사 결과 몇 초만 늦어도 `pending→실패`로 굳음. 굳으면 `success+fail=target`이라 재sync(`target > success+fail`)에서 **영구 제외**(session6 markFinalized와 같은 뿌리). 상세=MySQL 실시간(성공)·목록·통계=PG 캐시(실패) 불일치.
- 발송통계가 STAT_DATE_EXPR로 묶기만 하고 "발송 시작됨" 가드가 없어 미도래 예약도 집계.

**정정** (backend ~25곳):
- 발송시각 = `COALESCE(scheduled_at, sent_at)`로 타임아웃·markFinalized·sync 윈도우·성과집계 전수 통일(`campaign-lifecycle`·`campaign-sync-worker`·`mysql-refund-sweeper`·`stats-aggregation`). AI/직접 sync에 예약 발송전 제외 가드(`scheduled_at <= NOW`).
- `STAT_STARTED_GUARD = NOT (c.status='scheduled' AND COALESCE(c.scheduled_at,c.sent_at) > NOW())` CT 신설 + STAT_DATE_EXPR 소비처 전수 동반(발송통계·상세·캠페인관리·발송결과·export·results 요약/목록).
- 후불은 `prepaidRefund` no-op(prepaid.ts:68)이라 돈 영향 0(표시 전용). 굳은 65건 `result_final=false`+counts0 UPDATE로 실시간 복귀+재집계.

**교훈**:
- **발송 관련 시각 체크는 전부 발송시각(scheduled 우선). 예약 `sent_at`은 등록 때 찍히는 함정** — 타임아웃/통계/sync/확정/윈도우에 sent_at-first면 예약 오작동.
- **타임아웃류는 값을 굳히면(예: success+fail=target) 재처리에서 빠지는지 확인** — 굳히기 전 발송시각 기준 충분한 유예.
- **통계 = 발송 시작된 것만**. 미도래 예약은 별개(취소 가능). STAT_DATE_EXPR 소비처엔 STAT_STARTED_GUARD 동반.

---

## 예약취소 미삭제 실발송 — 라인 불일치 + 무검증 성공 표시 (2026-06-11 추가)

### 2026-06-11 — 에이치피오 예약취소 87,014건 실발송 (손해 250만원, CLAUDE.md 최상단 6원칙의 기원)

**사고**: 06-10 17:50 취소(화면·PG 모두 취소 표시)한 87,014건 LMS가 06-11 10:00 실발송. 예약 직접발송 = 등록 직후 MySQL 큐 선적재(sendreq_time=예약시각)라 취소의 실체는 큐 DELETE인데, 적재는 사용자 라인(`getCompanySmsTables(companyId, userId)`)·취소는 회사 라인만(`getCompanySmsTables(companyId)` — userId 누락) 조회해 DELETE 0건 → 검증 없이 PG만 cancelled → 발송. 전날(0610) 같은 라인 불일치를 집계(읽기)에서 고치고 취소(쓰기) 경로 전수 grep을 빠뜨린 대가.

**근본수정 5겹**: ① 적재 워커가 실제 INSERT 테이블을 `send_config.sentTables`에 기록 ② `getCampaignQueueTables` CT(기록 1순위+회사·사용자·전 사용자 라인 합집합) — 큐를 만지는 6곳(취소/수신자조회/수신자삭제/시간변경/문안수정/안전망) 단일 헬퍼 ③ 취소 = DELETE 후 잔존 0 재카운트 검증 후에만 성공 응답(잔존>0이면 success:false — 환불·PG 변경 전이라 무변경) ④ direct-send-worker 취소 가드 3곳(queued 조회·claim에 status!='cancelled' + 청크마다 감지 시 적재분 삭제 중단 + 완료 UPDATE 가드) ⑤ cancelled-queue-sweeper 1분 안전망(취소됐는데 큐에 남은 행 자동 삭제, SMS+카카오).

**교훈**:
- **큐를 변경하는 모든 경로(취소/삭제/시간변경/문안수정)는 발송 적재와 같은 테이블 집합을 보고, 변경 후 실제 효과(잔존 0)를 검증한 뒤에만 성공 표시.** DELETE 0건인데 성공 응답 = 시스템이 거짓말 — 예약시간 변경·문안 수정도 같은 결함이라 화면만 바뀌고 옛 시각·옛 문안으로 발송되던 잠재 사고였다.
- **같은 원인 fix 시 읽기(집계)뿐 아니라 쓰기(DELETE/UPDATE) 경로까지 전수 grep** — 하루 차이로 같은 뿌리 재발.
- **예약 발송 구조 = 큐 선적재라 PG 상태는 발송을 막지 못한다.** PG 상태 ↔ MySQL 큐처럼 진실이 두 곳이면 자동 대조 안전망 워커 동반 의무.
- 사후 추적 = nginx access log(시각·IP·UA) + audit_logs login(계정) + MySQL 월별 이력(라인 전환점) 3종 대조로 본문 로그 없이도 행위를 데이터로 닫을 수 있다. 이후는 audit-log CT가 변경 전후를 직접 기록.
- 상세 = CLAUDE.md `dev_process_six_rules` + `memory/project_2026_0611_cancel_line_mismatch_incident.md`.

---

### 2026-06-11 — 알림톡 강조형 7300 최종 근본 = 대표링크 미동봉 (이틀 추적 종결 — 가설 2개 폐기)

**사고/추적**: 79738 강조표기형만 전 건 7300. 가설 1(sender_code concat NULL — 부차, 가드 수정으로 종결)·가설 2(imc_template_status R 차단 — 폐기) 거쳐, 휴머스온 답변+실측으로 최종 확정: **템플릿에 등록된 대표링크(ATTACHMENT.link)를 발송 요청에 미동봉 → 카카오 등록값 불일치 거부**. 한줄로는 `kakao_templates.represent_link`를 저장만 하고 발송 경로 소비 0건이었다.

**교훈**:
- **카카오 알림톡의 템플릿 부속 데이터(버튼·대표링크)는 "등록값 = 발송 요청 동봉값" 일치 의무.** 저장 컬럼이 있다고 끝이 아니라 발송 적재까지 이어져야 한다. 신규 템플릿 요소 추가 시 = 등록 → 저장 → 발송 동봉 → 게이트웨이 변환 → IMC 4구간 전부 점검.
- **IMC 템플릿 status 정의(휴머스온 공식): S=중지 / A=정상 / R=대기(발송 전 — 첫 발송 시 자동 A).** R은 차단 사유가 아니다. "발송해야 A가 되는데 발송을 막는" 차단 로직은 신규 템플릿 첫 발송을 영구 차단하는 역효과 — 상태값 의미는 공급사 공식 정의로만 확정하고 추정 차단 금지.
- **다구간 체인(한줄로→에이전트→게이트웨이→IMC→카카오) 디버깅 = 구간별 운반 실측으로 막힌 지점을 좁힌다.** 형식 추측 반복(LINKTEST 5회) 대신 각 구간 로그(SMSQ 적재값 → 게이트웨이 deliver 전문 → IMC 접수 데이터)를 먼저 대조했으면 1회에 끝났다. "다른 업체는 된다" = 그 업체 발송의 실제 전문을 보는 게 최단 경로(타업체는 전부 대표링크 없는 템플릿이었음).
- **차이 변수 확정은 대조군 SQL 1방** — 정상 5개 vs 실패 1개 템플릿의 represent_link/buttons 한 줄 비교로 원인 변수가 즉시 드러났다.
- 게이트웨이(인비토 자체, mmsr3/ngen) deliver 전문 필드 = title/btnJson/etcJson뿐. btnJson=버튼 전용, etcJson=평면 변수 봉투(title/senderkey/sendercode).
- ★ 2026-06-16 해결 — 대표링크 변수명은 `attachment_link`(link 아님). `k_etc_json`에 `{"attachment_link":{"url_mobile","url_pc","scheme_ios","scheme_android"}}`(snake, 값 있는 키만) 넣으면 게이트웨이가 IMC ATTACHMENT.link로 변환 → 카카오 1800. **6/11 `link` 키 5회 7300의 원인 = 변수명 불일치**(형식 camel/snake도, 엔진 매핑 부재도, 서팀장 작업도 아니었음). 한줄로 단독 가능: `buildAlimtalkEtcJson`에 representLink 인자 + 발송 5경로(commit/즉시·auto·staging·journey)가 `kakao_templates.represent_link`(camelCase 저장값) 조회 → camel→snake 변환해 동봉. sender_code NULL이라 select_sql `&(k_etc_json)` 원본 통과(replace 함정 회피). 실측 79738→01052958517 status_code 1800 확정. 교훈 = "다른 업체는 되고 우리만 안 됨" = 우리 전문의 변수명/키 차이부터 게이트웨이(공급사)에 정확 스펙 요청(IMC 공식문서의 ATTACHMENT.link는 IMC 직접용 명칭, QTmsg 경유 시 커스텀 키 attachment_link).
- 상세 = `memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md` + STATUS.md 2026-06-11 항목.

---

## AI 학습 적재 누락 — 발송 경로 재작성이 fire-and-forget 부수효과를 떨굼 (2026-06-13 추가)

### 2026-06-13 — ai_training_logs 적재 급감 (logTrainingData 커버리지 구멍) + cdp_events 0건 정직성

**현상**: 인비토AI 파인튜닝 데이터(`training-logger.ts` → `ai_training_logs`) 적재가 최근 7일 30건으로 급감. 5,158건/54사는 쌓였으나 사실상 멈춤.

**근본**: `logTrainingData` 호출이 `campaigns.ts` 2곳(AI 발송·옛 동기 직접발송)뿐. D231(대량발송 worker화)·D233(자율발송 `createDirectSendCampaign` 공유)·여정 재설계 후 실제 발송이 비동기 `createDirectSendCampaign`→`direct-send-worker`·`journey-executor`로 옮겨갔는데 그 경로에 적재가 안 따라감. 알림톡(KAKAO)은 한 번도 안 잡힘(`message_type` KAKAO 0건이 증거).

**보강**: 공통 헬퍼 `logCampaignTraining`(training-logger) 신설 → 공통 길목 `createDirectSendCampaign` 1곳(직접+자율 동시)+`journey-executor` 발송 지점에 fire-and-forget 연결. source_ref(campaignId) 멱등이라 중복 0, try-catch 격리라 발송·돈 영향 0. operator 제안 선호는 operator_proposals에 이미 있어 export에서 추출(새 적재 0).

**교훈**:
- **발송 로직을 새 길목(worker·공유 함수)으로 옮길 때, 그 경로에 붙어 있던 fire-and-forget 부수효과(학습 적재·통계 등)도 같이 옮겨야 한다.** await 안 하는 부수효과는 tsc·테스트가 못 잡아 조용히 멈춘다 — 옛 동기 경로만 남아 소량 적재가 이어지면 "0이 아니라서" 발견이 더 늦다.
- 적재 의심 시 **데이터로 확정**(최근 7일 건수·채널 분포). 특정 채널(KAKAO 등)이 통째 0이면 그 경로 미연결의 증거.
- 학습·집계가 cdp_events 같은 외부 적재원에 의존하면 **빈 테이블 가능성부터 실측**(cdp_events 전체 0건 → 가짜 0% 메모리 양산). 빈 테이블에 properties 키를 추측해 SQL 짜지 말 것(0번 원칙).

---

## AI 응답 JSON raw 제어문자 파싱 사고 (2026-06-30 추가)

### 2026-06-30 — AI Operator 문안 fallback 회귀 (응답 JSON raw 줄바꿈)

**현상**: AI Operator 메인 propose에서 혜택(20%·쿠폰명)·개인화(고객명) 무시 + `[혜택 내용을 입력해주세요]` 골격 노출. 같은 프롬프트도 될 때/안 될 때 갈림(비결정).

**근본**: 문안 풍성화 후 AI가 여러 줄 LMS 본문을 응답 JSON에 escape 안 된 raw 줄바꿈(0x0A)으로 담음 → `extractJsonFromAiText`의 `JSON.parse`가 "Bad control character in string literal"로 throw → catch → `getFallbackVariants` 비상 골격. AI가 줄바꿈을 escape로 낼지 raw로 낼지 비결정이라 간헐. 브랜드보이스 few-shot(회사 실제 여러 줄 문안 예시)이 다줄 출력을 유도해 등록 회사일수록 더 자주 터짐.

**진단**: 같은 propose의 타겟·컴플라이언스 sub-agent는 정상, 메시지 sub-agent만 fallback → generateMessages 전용 요소가 범인. 운영 PM2 로그 `SyntaxError: Bad control character ... position ~220` 확정(추측 0). 로컬 verify로 동일 에러 재현(RED→GREEN).

**보강**: `ai-json.ts`(컨트롤타워) `escapeControlCharsInJsonStrings`(문자열 경계 추적, 내부 0x00~0x1F만 escape, 구조부 공백 보존) + `JSON.parse` 실패 시 1회 재파싱. 모든 AI 호출부(문안·여정·이메일·인앱) 동시 수혜. 별건 `copy-rag-retriever` createdAt(PG Date인데 `.localeCompare` 호출 → RAG 전체 degrade) ISO 문자열 강제.

**교훈**:
- **AI 응답 JSON엔 escape 안 된 raw 제어문자(줄바꿈·탭)가 섞이는 게 상수다.** `JSON.parse` 직호출 금지 — `extractJsonFromAiText`가 문자열 내부 제어문자를 escape 후 파싱하게(컨트롤타워 1곳).
- **PG timestamptz는 런타임 Date 객체**(TS 타입이 string이어도). 문자열 메서드(`.localeCompare` 등) 호출 전 변환 필수.
- **공유 흐름에서 한 sub-agent만 실패하면 그 sub-agent 전용 요소가 범인** — 전역(키·모델·잔액) 배제 후 좁힌다.
- 간헐 버그도 운영 로그(`console.error`)로 정확 예외 1줄을 확보한 뒤 고친다(추측 fix 금지). 증상이 비슷해도 별개 신고(예: 브랜드보이스)를 같은 원인이라 단정 X — 회사·증상 확인 후 판단.

---

## 자사몰 연동 = 공식 문서 정독 → 서버 실측 → 코드 (네이버 커머스·메이크샵, 2026-07-06 추가)

### 2026-07-06 — 네이버 커머스·메이크샵 커머스 API 연동 (실측 우선으로 한 번에 완성)

**패턴**: 외부 커머스 API 연동은 ①공식 인증 문서 정독으로 스펙 확정(추측 0) → ②서버에서 실제 토큰 발급 실측(자격·IP·서명 확정) → ③실측 성공 후에만 코드 작성. 이 순서를 지키면 재작업 0.

**두 API의 인증이 서로 달랐다 (문서/실측으로 확정 — 옛 코드/메모리 추측은 전부 틀림)**:
- 네이버 커머스: `client_credentials` + **bcrypt 전자서명** `Base64(bcrypt(client_id+"_"+ts, client_secret))`, POST `/external/v1/oauth2/token`, 토큰 3시간, IP 화이트리스트 필수. (옛 코드는 authorization_code OAuth였음 — 완전히 틀림)
- 메이크샵(커넥트웨이브): `client_credentials` + **Basic 헤더** `Basic base64(id:secret)` + `shop_uid`, POST `connect.makeshop.co.kr/oauth/token`, 토큰 **5분**, IP 화이트리스트 아님(실측). (레거시 openapi.makeshop.co.kr의 Shopkey/Licensekey 방식과 별개 — 신규 파트너센터 방식이 정답)

**교훈**:
- **인증 방식은 "OAuth 표준이겠지" 추측 절대 금지 — 공식 문서로 확정.** 같은 client_credentials여도 서명 방식(bcrypt vs Basic)·토큰 수명(3h vs 5분)·IP 정책이 provider마다 다르다. 옛 코드가 authorization_code로 짜여 있어도 그게 맞다는 보장 0(네이버 실측 전엔 authorize/callback 흐름이었음).
- **연동은 "토큰 발급 실검증 성공 후에만 active 저장"**(6원칙 ② — 고도몰 verify-then-active 선례). 자격 저장만 하고 성공 표시 금지.
- **토큰 수명이 짧으면(메이크샵 5분) 재발급 마진을 그만큼 짧게**(1분). client_credentials는 refresh_token이 없어 만료 임박 시 저장 자격으로 재발급하는 구조 — 자격을 meta에 저장해야 자동 갱신 가능.
- **응답 스키마는 실데이터로 최종 검증** — 테스트몰이 비어 있으면(회원 0건) list 내부 필드를 못 본다. raw 반환 preview 라우트를 두고 실고객사 데이터로 매핑 확정(스키마 추측 금지 룰).
- **화면에 토큰 만료 시각 노출 금지** — 자동 갱신되는 값이라 "곧 끊기나?" 불안만 유발. "연동 유지 중·자동 갱신"으로.
- 구현 = provider-registry IProviderAdapter 미러(webhook 없는 polling은 verify/process no-op) + register-providers 등록 + routes(connect·status·preview·disconnect) + 프론트 자격 입력 카드. 전자서명 같은 순수 로직은 별도 CT로 빼 vitest 검증.

---

## 대기→실패 변환 + 굳힘 최적화 사각 = 성공 건 영구 실패 표시 재발 (2026-07-06 추가)

### 2026-07-06 — 베네통·아이디룩 LMS 성공 건이 목록에서 실패 1로 영구 표시 (D233+ 동일 증상 재발)

**현상**: 직접발송 LMS 1건이 상세=성공(MySQL 1000)인데 목록·통계=실패 1(PG 캐시). 두 건 모두 발송 +6h 1~2분에 success 0/fail 1로 굳음(result_final=true).

**근본 (4겹 체인 — 실측 확정)**: 통신사 리포트가 120분보다 늦은 정상 건(실측 +2h58m/+10h25m, 단말 꺼짐 재시도는 최대 48h).
1. campaign-lifecycle 120분 타임아웃이 pending을 fail로 기록 (AI run + 직접발송 2곳)
2. fail 기록 즉시 sync 후보 조건(`target > success+fail`)에서 이탈 — 늦게 도착한 성공을 반영할 경로 상실
3. +6h markFinalized가 `성공+실패 ≥ target` 충족으로 result_final=true 굳힘
4. 재대조(reconcile) 필터가 `성공+실패 < 적재`만 대상(6/17 부하 최적화) — 변환 건은 합=적재라 "정합"으로 보여 영구 제외. 선불은 sweeper(14일)가 자가 치유하나 후불은 치유 경로 0

**정정**: 120분 대기→실패 변환 삭제(campaign-lifecycle 2곳). pending은 pending 그대로 — 마감은 기존 3겹(48h expired-pending-sweeper=유실 MySQL 4000 확정 / 6h 확정 게이트=합≥target만 / 72h 탈출구=실측 굳힘)이 담당. 환불도 실패 확정분만(sweeper refund-calc 산식과 단일 기준). 과거 오염분(6/1 이후 897건)은 result_final=false 되돌림 → 72h 탈출구가 실측 재확정.

**교훈**:
- **결과 미수신(pending)은 실패가 아니다 — 집계·표시·환불 어디에서도 대기를 실패로 변환 금지.** 실패는 확정 신호(실패 코드 도착, 48h 유실 4000 마킹)로만. "타임아웃=실패 간주"는 지연 리포트(99%ile 밖 1%)를 구조적으로 오기록하고, 선환불→reverse 회수라는 돈 왕복 왜곡까지 만든다.
- **굳힘(캐시 확정) 로직에 부하 최적화 필터를 걸 때는 "굳힌 값이 틀렸을 클래스"를 먼저 나열하고 각 클래스가 필터에 잡히는지 확인.** 6/17 `합<적재` 필터는 "부족하게 굳음"만 잡고 "틀리게 채워 굳음"(대기→실패 변환)은 놓쳤다 — 치유 경로를 닫는 최적화가 이 재발의 마지막 겹.
- **같은 증상 재발 시 "지난번 수정이 왜 이 가지를 못 막았나"부터** — D182(임계 연장)·D233+(시각 기준)·6/22(확정 게이트)는 각각 가지만 고치고 변환 자체(뿌리)를 남겼다. 증상의 뿌리 연산(여기선 "대기를 실패로 바꾸는 쓰기")을 전수 grep해 제거해야 반복이 끝난다.
- 판별 실측 루틴: PG 굳힘 시각(result_synced_at) vs MySQL 결과 수신 시각(repmsg_recvtm) 선후 대조 1방이면 "굳힘이 빨랐나 / sync가 못 봤나"가 갈린다.

---

## 080 콜백 매칭 — LIMIT 1이 조건 불충족 행을 집으면 충족 행까지 가림 (2026-07-06 추가)

### 2026-07-06 — psy5868 080 수신거부 자동 등록 실패 (직원 신고)

**현상**: 0807196700 전화 시 수신거부 자동 등록 안 됨. PM2 로그 = 콜백 도달 + "매칭 실패"(다른 회사 080 유입은 정상 2,770건 — 인프라 아님).

**근본 2겹 (실측)**: ① user 오버라이드가 콜백 번호와 한 자리 다름(0807198700 vs 6700) → 1순위 미스 ② 같은 080번호를 가진 회사가 2곳인데 fallback이 `LIMIT 1`(정렬 없음)로 한 행만 집고 그 행의 auto_sync=false면 나머지 회사를 안 보고 포기 — false 행이 true 행을 가림.

**정정**: ① 매칭 = user 매칭 + company 매칭 **합집합** (Harold 명시 룰 2026-07-06: 같은 080번호는 계정 간 공유 가능 — 매칭 전원 등록. 옛 "1순위 잡히면 2순위 skip" 조기 return은 공유 상대 누락이라 폐기) ② company 매칭은 auto_sync=true를 WHERE로 + LIMIT 1 제거(매칭 회사 전부 broadcast) ③ 매칭 0건 시 "번호 일치·조건 제외 후보" 진단 로그 + 실패 로그에 발신자 번호 동봉(유실 건 사후 수동 등록 가능). 삭제는 쓰기 경로가 본인 회사·본인 user 행만 만짐(공유 상대 격리 — 설정 저장·슈퍼관리자 수정 전수 확인).

**교훈**:
- **"후보 SELECT → 첫 행만 조건 검사" 패턴 금지 — 걸러낼 조건은 WHERE에 넣어라.** LIMIT 1(정렬 없음)이 조건 불충족 행을 집으면 충족 행이 있어도 전체 실패가 되고, 어느 행을 집을지는 플랜에 따라 바뀌어 "되다 안 되다"로 보인다.
- **외부 콜백 매칭 실패 로그에는 (a) 원인 후보(조건에서 제외된 근접 행)와 (b) 유실 데이터 복구에 필요한 원본 값(발신자)을 남겨라.** 콜백은 재발송이 없어 로그가 유일한 복구 소스다.
- user 오버라이드(사용자별 080)와 회사 값의 이원 구조에서는 **오버라이드가 stale하면 콜백이 조용히 죽는다** — 번호 변경 시 어느 행이 갱신되는지(현재 로그인 user만) 인지하고, 진단은 "번호를 가진 모든 행" 덤프 1방으로.

---

## 문안 생성에 존재하지 않는 값/문법 노출 — 프롬프트 결선 오류 + 출구 가드 부재 (2026-07-06 추가)

### 2026-07-06 — 오퍼레이터 메인 생성 문안에 `{% if customer.churn_risk > 0.7 %}` 노출 (psy5868 시연)

**현상**: 오퍼레이터 메인(한 줄 명령)에서 생성한 문안에 Liquid 조건 분기와 존재하지 않는 필드(churn_risk)가 원문으로 노출. 시연 업체를 바꾸면 "가끔" 발생.

**추적 (기각 가설 3개 — 전부 실측 0건)**: 브랜드보이스 대표 문안 오염 X / ai_training_logs RAG 오염 X / campaigns.message_content 오염 X (여정 저장분은 고객별 렌더 후 저장이라 청정).

**근본 (코드 확정)**: CT-58(company-data-profile) `formatProfileForAiPrompt`의 "분기 변수(30~70% 채워짐) = Liquid 패턴 **의무**" 지시가 Liquid 렌더 세계(여정·인앱)와 %변수% 세계(generateMessages — 캠페인·오퍼레이터) **3곳에 동일 주입**되던 결선 오류. "가끔" = 회사마다 필드 채워짐 비율이 달라 분기 변수 유무가 바뀌기 때문. churn_risk는 모델이 "휴면/이탈" 요청 문맥에서 지어낸 매트릭스 밖 필드 — 출구 검증 부재로 통과.

**정정 (4겹 — 지시가 아니라 코드가 보장)**:
1. 포맷터 `variableStyle: 'liquid'|'percent'` 분리 — 기본값 liquid(여정·인앱 무변), generateMessages만 percent(Liquid 지시·예시 전면 제거)
2. generateMessages 출구 가드 — 본문·제목 `detectLiquidSyntax` 검출 시 결정적 평문화(`flattenLiquidToPlainText` = 중립 렌더→else 분기 채택→잔존 태그 제거) + 재생성 1회 트리거. 기존 %변수% 화이트리스트 검증(validatePersonalizationVars)과 함께 "없는 값" 클래스 전체 봉쇄
3. 발송 최후 방어 — messageUtils 렌더 후 잔존 태그 검출 시 `stripLiquidLeftovers` (파서 오류 "원본 반환" 엣지에도 고객 노출 0)
4. 데이터 정화 불필요 (전 저장소 실측 0건 — 발송 없이 생성만 반복한 시연이라 오염 미전파)

**교훈**:
- **같은 프롬프트 블록을 여러 생성기에 꽂을 때는 "결과물이 사는 세계(렌더 여부·변수 문법)"별로 지시를 분리하라.** 세계가 다른데 지시가 같으면, 한쪽에선 기능이고 다른 쪽에선 오염이다.
- **AI 지시(화이트리스트·금지)는 확률적으로 뚫린다 — 보장은 출구에서 코드가 한다.** 목록 기반 생성(입력) + 목록 기반 기계 검증(출구) 2단이 한 세트 (Harold 명시 원칙 2026-07-06).
- **금지 문구에 금지 대상 문법 리터럴을 쓰지 마라** — `{{ }}` 예시가 프롬프트에 있으면 그 자체가 프라이밍. 서술형("중괄호 표기")으로. (vitest가 잡아낸 실결함)
- 증상 재현이 "가끔·업체 바뀌면"이면 회사별 동적 주입물(데이터 프로필·few-shot·통계)이 프롬프트를 바꾸는 지점부터 의심 — 저장 오염 가설은 SQL 1방(POSITION('{%'...))으로 먼저 기각/확정.

---

## AI 매핑 빈손 — 전수 정정 sweep이 "패턴"으로 grep해 raw fetch 1곳 누락 (2026-07-06 추가)

### 2026-07-06 — 고객 DB 업로드 AI 매핑 전 필드 미배정 (박성용 18:01, "호출 성공" 로그와 함께 빈손)

**현상**: 엑셀 업로드 AI 매핑이 전 컬럼 미배정. PM2에는 "[AI 매핑] Claude 호출 성공"만 찍힘(실패·파싱 로그 0).

**근본**: 7/1 Sonnet 5 전환 커밋(a2f7ff60)이 "직접호출 7곳"에 isAdaptiveOnlyModel 게이팅(thinking disabled)을 정정했지만, **upload.ts /mapping은 SDK가 아니라 raw fetch라 sweep(패턴 grep)에서 누락**. Sonnet 5는 thinking 생략 시 적응형 사고 자동 ON → 첫 블록이 사고 블록인 요청에서 `content[0].text`=undefined → `'{}'` → 빈 매핑 + 성공 로그. 적응형이라 요청마다 발동이 달라 7/1 이후 "가끔"만 터짐. 부차 결함: GPT 폴백 응답 오류 무검사(실패도 "성공" 로그) + 빈 매핑을 "AI 매핑 완료"로 응답(위장 성공 — 6원칙 ②).

**정정**: ① upload.ts raw fetch → SDK + 게이팅(analysis.ts 정답 패턴 미러) + text 블록 탐색 ② GPT 폴백 오류·빈 응답 검사(실패는 실패로) ③ 빈 매핑 시 "수동 매핑 안내" 정직 응답(모달은 열려야 하므로 200 유지) ④ ai-mapping.ts(싱크에이전트)도 동일 게이팅+탐색 예방 + 1차 모델 Sonnet 5 통일(Harold 지시 — defaults.ts 단일 진실) ⑤ analysis.ts 첫 블록 가정도 탐색으로 통일.

**★ 기계 재발 차단 — `utils/__tests__/ai-call-invariants.test.ts` (소스 전수 스캔, npm test마다 강제)**:
- 불변식 1: `api.anthropic.com/v1/messages` raw fetch 금지 (SDK/callAIWithFallback만)
- 불변식 2: `anthropic.messages.create` 직접 호출 파일 = isAdaptiveOnlyModel 게이팅 동반 의무
- 불변식 3: Claude 응답 첫 블록 가정(`content[0].text/type`) 금지 — text 타입 블록 탐색 의무

**교훈**:
- **전수 정정 sweep은 호출 "패턴"이 아니라 "도착지"로 grep** — SDK 호출만 찾으면 raw fetch·다른 클라이언트 변형이 빠진다. 도착지(api.anthropic.com / anthropic. / OpenAI 등) 기준이 전수다. (0611 "쓰기 경로 누락"과 같은 뿌리 — sweep의 축이 좁으면 반복된다)
- **모델 세대 전환(응답 구조 변화)은 "호출부 정정"이 아니라 "불변식 테스트"로 닫아라** — 사람이 7곳을 고쳐도 8번째가 재유입된다. 소스 스캔 테스트 1개가 영구 차단.
- **폴백 체인의 각 단계는 응답 검증 후에만 성공 로그** — 오류 객체를 빈 문자열로 삼켜 "성공"이라 적으면 시스템이 거짓말한다.

---

## 타겟 건수 "조회 vs 추출" 불일치 = 데이터 불일치부터 의심 (2026-07-09 추가)

### 2026-07-09 — AI 오퍼레이터 추출 건수 < 고객DB 조회 (인비토 가상데이터 sync 수신거부 잔존, 코드 오판 철회)

**신고**: 인비토(테스트 계정) 고객DB 조회 "수신 동의" 664 vs AI 추출 660 (VVIP+포인트 134 vs 133 등 1~5건 상시 차이). 기대 = 조회 = 추출.

**★ 오판(성급히 한 것) 및 철회**: "조회는 수신거부 user_id 기준, 발송은 회사+전화 기준이라 불일치"로 단정 → `customers.ts` 수신거부 9곳을 `u.user_id`→`u.company_id`로 뒤집음(B17-01 역행). **Harold 지적("동의만 체크했는데 왜 수신거부가 껴있냐 / 가상데이터라 080 수신거부 자체가 안 되는 DB다")으로 실데이터 확인 → 전량 철회(user_id 원복).**

**진짜 근본 (실데이터 확정)**: 차이 4~5명은 `customers.sms_opt_in=true`(동의)인데 `unsubscribes.source='sync'`가 **잔존**한 고객. `source='sync'`는 080/수동 거부가 아니라 **sms_opt_in 파생**이다 — `sync.ts reconcileSyncUnsubscribes`: sms_opt_in=false→sync 등록 / sms_opt_in=true 전환→sync 해제(DELETE, 288-301행 2026-06-15 fix). 인비토는 가상데이터라 sms_opt_in을 sync 밖에서 true로 바꿔 reconcile이 안 돌아 해제 누락 5명. **전 회사 스캔 = 인비토만 5명, 운영 회사 전원 0 = 코드·발송 로직 정상.** 발송(회사+전화 수신거부 제외)이 이 잔존 5명을 빼 660, 조회(user_id)는 664. 즉 **조회 664(동의)가 맞고, 발송이 "해제됐어야 할 sync 수신거부"로 동의 고객을 잘못 제외** — 단 인비토 데이터 한정. 진짜 해결 = 인비토 재sync로 reconcile 자동 해제(둘 다 664).

**교훈**:
- **"조회 A건 vs 추출 B건 상이" 신고 = 필터 기준(코드)보다 데이터 불일치부터 실측.** sms_opt_in(컬럼) ↔ unsubscribes(목록)는 별개 저장소라 "동의인데 수신거부 목록에 있음"이 생긴다. 조회 기준을 코드로 뒤집기 전에 `JOIN unsubscribes ON source='sync' WHERE sms_opt_in=true` 잔존 + **전 회사 규모(운영 0인지)** 부터 스캔.
- **증상(A≠B)을 코드로 "일치"시키면 틀린 값끼리 맞추는 함정** — 여기선 조회를 660(동의 5명 잘못 제외한 값)에 맞출 뻔했다. 근본은 데이터(sync 잔존) 정리.
- **source='sync'는 sms_opt_in 파생이라 sync 시점에만 재조정.** sms_opt_in을 sync 밖 경로(가상데이터 생성·수동 UPDATE)로 바꾸면 unsubscribes(source='sync')가 잔존 → 동의 고객 미발송. 데이터 직접 조작 시 reconcile 동반 필요.
- **광범위 기준 변경(B17-01 역행 등) 전 = "실제 원인이 이 코드가 맞나"를 데이터로 확정.** 사용자("왜 수정하려 했냐")의 의심이 오판을 차단 — 추측 단정 금지(no_guess) 재확인.

---

## 안내(단방향) 문자 발신번호 = 플랫폼 대표번호, 수신자 번호 금지 (2026-07-09 추가)

### 2026-07-09 — 자동마케팅 담당자 사전알림이 담당자 본인 번호로 발신 → 번호도용차단 미수신
- **현상**: 발송 2h 전 담당자에게 가는 사전 알림 문자의 발신번호가 대표번호(1800-8125)가 아니라 담당자 본인 번호(수신자와 동일). 번호도용차단서비스 가입 담당자는 자기→자기 발송으로 인식돼 아예 미수신(임은지 실측).
- **근본**: `notifyOperatorAdmins`(continuous-operator.ts)가 SMS 큐 row의 call_back을 dest_no와 같은 수신자 phone으로 넣음. 안내는 단방향(회신 불필요)인데 발신=수신이 되어 도용/스팸 차단에 걸림. 동일 패턴이 `journey-pretest-notifier`(여정 2h전)에도 있었음.
- **fix**: `getPlatformNoticeCallback()`(sms-queue CT 신설, `SYSTEM_SMS_CALLBACK||18008125` = internal-alert와 동일 소스) → operator·journey 안내 call_back을 플랫폼 대표번호로. 인비토=특수유형 부가통신사업자라 대표번호는 회신번호 등록 없이 발신 가능. system-alert(슈퍼관리자=우리 내부, "회신 안전" 의도)은 별개로 유지.
- **교훈**: **시스템이 사용자/담당자에게 보내는 단방향 안내 문자의 call_back은 플랫폼 대표번호를 쓴다 — 수신자 번호를 넣으면 발신=수신이 되어 번호도용차단 가입자에게 통째 미수신.** 새 안내/알림 발송 코드 = call_back 소스부터 확인, `getPlatformNoticeCallback` 재사용.

## 자가 검증 매트릭스 (Backend 작업 시)

- [ ] 발송 5경로 전수 점검 (AI/직접/타겟/스케줄/테스트)
- [ ] 컨트롤타워 (`utils/`) 존재 확인 + 인라인 정의 금지
- [ ] AI 호출 = 모델 분리 룰 정합 (Opus 4.7 / Sonnet 4.6)
- [ ] 사용자 노출 영역 (alert/toast/error response/message/throw) 박-단어 grep = 0건
- [ ] AI 시스템 프롬프트 안 구체 혜택 (%/원/쿠폰) 박지 X 명시
- [ ] 0건 타겟 = 발송 차단 (자동완화 X)
- [ ] SMS/LMS 발송 영역 = EUC-KR 화이트리스트 + stripIncompatibleEmojis
- [ ] 외부 라이브러리 활용 시 한글 케이스 검증 필수
- [ ] template literal raw 백틱 X
- [ ] **외부 API 응답 구조 = 옛 코드 차용 X = 실제 raw 디버그 로그로 직접 확인 의무 (D217+ 영구 룰 `feedback_external_api_response_verification`)**
- [ ] **`console.error` / `console.warn` 진단 의존 X = `console.log` (stdout) 의무 (grep 누락 차단)**
- [ ] **list API 페이지네이션 `hasNext` 처리 — 첫 페이지만 break X**
