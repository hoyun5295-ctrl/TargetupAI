# 카카오 알림톡 / 브랜드메시지 IMC API 통합 레퍼런스

**출처:** humuson IMC Developer Portal (`http://121.189.17.229:3100/docs/`)  
**추출일:** 2026-05-09  
**총 API 개수:** 59  
**한줄로 매핑 대상 파일:** `packages/backend/src/utils/alimtalk-api.ts`, `brand-message.ts`  

## 목차

- [알림톡 템플릿 관리 API](#알림톡-템플릿-관리-API) — 23 개
- [발신프로필 관리 API](#발신프로필-관리-API) — 11 개
- [이미지 업로드 API](#이미지-업로드-API) — 9 개
- [브랜드메시지 템플릿 관리 API](#브랜드메시지-템플릿-관리-API) — 9 개
- [알림톡 템플릿 검수 알림 수신자 관리 API](#알림톡-템플릿-검수-알림-수신자-관리-API) — 5 개
- [템플릿 카테고리 조회 API](#템플릿-카테고리-조회-API) — 2 개

---

# 알림톡 템플릿 관리 API

총 **23개** API

## [POST] 배송조회(DS) 버튼 사용 가능 여부 검증

post
배송조회(DS) 버튼 사용 가능 여부 검증

/kakao-management/api/v1/alimtalk/template/delivery-courier/validate

알림톡 템플릿 본문(content)을 입력 받아 DS(배송조회) 버튼을 사용할 수 있는지 검증합니다.

[판정 기준]
- 본문에서 지원 택배사명(별칭 포함)이 최소 1개 인식되어야 합니다.
- 인식된 택배사의 송장번호 패턴이 본문에서 최소 1개 매칭되어야 합니다.
- 두 조건을 모두 만족하면 매칭된 택배사 정보를 반환합니다.

[다중 매칭 정책]
- 본문에 여러 택배사가 등장하면 위치 순(앞→뒤)으로 후보를 검사합니다.
- 첫 후보의 송장번호 패턴이 본문에 없으면 다음 후보로 fallback 진행합니다.
- 송장번호 패턴까지 매칭되는 첫 후보를 단일 결과로 반환합니다.
- 같은 위치에서 여러 별칭이 매칭되면 더 긴 별칭이 우선합니다.

[실패 응답 (resultCode)]
-
4111 NOT_FOUND_AT_DELIVERY_COURIER_NAME
: 본문에서 지원 택배사명 미발견
-
4112 NOT_FOUND_AT_DELIVERY_TRACKING_NUMBER
: 택배사명은 인식했으나 송장번호 패턴 미발견

요청 속성

Attributes

contentstringrequired길이:0~1000

검증 대상 알림톡 템플릿 본문

예시

안녕하세요. 우체국택배 1234567890123 발송되었습니다.

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

배송조회(DS) 버튼 사용 가능 여부 검증 성공 응답. 본문에서 매칭된 택배사 정보를 반환한다.

codestring

택배사 식별 코드

예시

EPOST

displayNamestring

택배사 대표 표기명

예시

우체국택배

matchedAliasstring

본문에서 인식된 별칭

예시

우체국택배

matchedTrackingNumberstring

본문에서 패턴 매칭된 송장번호 (가장 먼저 등장한 1건)

예시

1234567890123

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/delivery-courier/validate" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"content": "안녕하세요. 우체국택배 1234567890123 발송되었습니다."
}'

JSON
{
"content": "안녕하세요. 우체국택배 1234567890123 발송되었습니다."
}

---

## [POST] 알림톡 템플릿 검수요청 (첨부파일 포함)

post
알림톡 템플릿 검수요청 (첨부파일 포함)

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/comment/file

알림톡 템플릿을 첨부파일과 함께 검수 요청합니다. (templateKey 기준)검수 요청은 템플릿 상태가 대기(R)이고, 검수상태가 등록(REG), 휴머스온 반려(HREJ), 카카오 반려(KREJ) 상태에서만 가능합니다.검수 요청시 의견 또는 문의를 선택적으로 입력할 수 있습니다.

[첨부파일 제한]
- 허용 확장자: png, jpg, jpeg, gif, pdf, hwp, doc, docx
- 최대 파일 크기: 10MB

요청 속성

Attributes

commentstring길이:0~500

검수 코멘트 (의견 또는 문의사항, 선택)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

attachmentstring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//comment/file" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

---

## [POST] 알림톡 템플릿 검수요청

post
알림톡 템플릿 검수요청

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/comment

알림톡 템플릿을 검수 요청합니다. (templateKey 기준)
검수요청은 검수상태가 등록(REG), 휴머스온 반려(HREJ), 카카오 반려(KREJ) 상태에서만 가능합니다.

요청 속성

Attributes

commentstring길이:0~500

검수 코멘트 (의견 또는 문의사항, 선택)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//comment" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"comment": "해당 템플릿은 이럴 때 사용하는 템플릿입니다."
}'

JSON
{
"comment": "해당 템플릿은 이럴 때 사용하는 템플릿입니다."
}

---

## [POST] 알림톡 템플릿 등록

post
알림톡 템플릿 등록

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template

알림톡 메시지에 사용하는 템플릿을 신규 등록합니다.사전에 발신프로필이 등록 되어있어야 합니다.등록한 템플릿은 검수요청 후 담당자의 승인을 받아야 발송이 가능합니다.

[공통 필수 값]
manageName, templateMessageType ,templateEmphasizeType, templateContent , categoryCode
[공통 선택 값]
templateKey (미입력시 서버가 자동발급) , customTemplateCode , serviceMode , securityFlag , buttonList , quickReplyList , templatePreviewMessage, templateRepresentLink, alarmPhoneNumber

[템플릿 메시지 타입별 필수 파라미터]
EX/MI : templateExtra 필수
[템플릿 메시지 강조타입 필수 파라미터]
TEXT : templateTitle, templateSubtitle 필수
ITEM_LIST: templateItem.list, templateImageName , templateImageUrl , templateHeader, templateItemHighlight 필드 중 1개 이상 필수
templateItem.summary 필드는 templateItem.list 사용시에만 사용 가능
IMAGE: templateImageName, templateImageUrl 필드 필수
템플릿 메시지 타입이 채널 추가형(AD), 복합형(MI)인 경우, 기존의 광고 문구 영역이 "채널 추가하고 이 채널의 광고와 마케팅 메시지를 카카오톡으로 받기" 고정되며 수정 불가합니다.

[문자 제한]
템플릿 본문·미리보기·부가정보·강조 문구·헤더·대표링크(URL·scheme)·버튼명·버튼 링크(URL·scheme)·바로연결명·바로연결 링크(URL·scheme, supplement 퀵리플라이)·아이템 문구 등 입력 텍스트에는 NBSP(U+00A0)를 사용할 수 없습니다.

요청 속성

Attributes

templateKeystring길이:0~20

템플릿 고유 키 (선택, 미입력시 서버가 자동발급)

예시

TEST_AT_RG1_001

manageNamestringrequired길이:0~30

관리용 이름

예시

회원가입 발송 템플릿_v1

customTemplateCodestring길이:0~30

고객사 관리 코드

예시

CUST_JOIN_001

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

templateMessageTypestringrequiredenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형
- MI: 복합형(templateExtra 필수

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringrequiredenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstringrequired길이:0~1300

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring길이:0~40

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring길이:0~500

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateImageNamestring길이:0~50

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring길이:0~100정규식

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring길이:0~50

템플릿 강조 표기 타이틀

예시

회원가입 완료

templateSubtitlestring길이:0~50

강조 표기 보조 문구

예시

감사합니다

templateHeaderstring길이:0~16

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

templateItemobject

알림톡 템플릿 아이템

templateRepresentLinkobject

대표링크

categoryCodestringrequired길이:0~6숫자만

템플릿 카테고리 코드 (숫자만, 최대 6자)

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

buttonListarray<object>개수:0~5

버튼 정보 (최대 5개, 바로연결과 함께 사용 시 최대 2개)

quickReplyListarray<object>개수:0~10

바로연결 정보

alarmPhoneNumberstring길이:0~300

템플릿 검수 알림 수신자 전화번호 (번호만 입력, 콤마로 구분, 최대 10개)

예시

01012345678,01087654321

commentstring길이:0~500

검수 코멘트 (의견 또는 문의사항, 최대 500자)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"categoryCode": "001001",
"manageName": "회원가입 발송 템플릿_v1",
"templateContent": "#{name}님 회원가입을 축하합니다.",
"templateEmphasizeType": "NONE",
"templateKey": "KEY_JOIN_001",
"templateMessageType": "BA",
"customTemplateCode": "CUST_JOIN_001",
"serviceMode": "PRD",
"templateExtra": "자세한 내용은 홈페이지를 확인해 주세요.",
"templateImageName": "welcome.png",
"templateImageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg",
"templateTitle": "회원가입 완료",
"templateSubtitle": "감사합니다",
"templateHeader": "안내",
"templateItemHighlight": {
"description": "#{웨이팅 번호 설명}",
"title": "#{웨이팅 번호}",
"imageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg"
},
"templateItem": {
"list": [
{
"description": "#{6월 10일 12:10}",
"title": "등록일시"
}
],
"summary": {
"description": "#{28,000원}",
"title": "결제금액"
}
},
"securityFlag": false,
"buttonList": [
{
"name": "예약 확인하기",
"type": "AL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com"
}
],
"quickReplyList": [
{
"name": "문의하기",
"type": "WL",
"url_mobile": "https://imc.humuson.com/mobile",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com",
"biz_form_id": 1
}
]
}'

JSON
{
"categoryCode": "001001",
"manageName": "회원가입 발송 템플릿_v1",
"templateContent": "#{name}님 회원가입을 축하합니다.",
"templateEmphasizeType": "NONE",
"templateKey": "KEY_JOIN_001",
"templateMessageType": "BA",
"customTemplateCode": "CUST_JOIN_001",
"serviceMode": "PRD",
"templateExtra": "자세한 내용은 홈페이지를 확인해 주세요.",
"templateImageName": "welcome.png",
"templateImageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg",
"templateTitle": "회원가입 완료",
"templateSubtitle": "감사합니다",
"templateHeader": "안내",
"templateItemHighlight": {
"description": "#{웨이팅 번호 설명}",
"title": "#{웨이팅 번호}",
"imageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg"
},
"templateItem": {
"list": [
{
"description": "#{6월 10일 12:10}",
"title": "등록일시"
}
],
"summary": {
"description": "#{28,000원}",
"title": "결제금액"
}
},
"securityFlag": false,
"buttonList": [
{
"name": "예약 확인하기",
"type": "AL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com"
}
],
"quickReplyList": [
{
"name": "문의하기",
"type": "WL",
"url_mobile": "https://imc.humuson.com/mobile",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com",
"biz_form_id": 1
}
]
}

---

## [POST] 알림톡 템플릿 엑셀 다운로드

post
알림톡 템플릿 엑셀 다운로드

/kakao-management/api/v1/alimtalk/template/excel

알림톡 템플릿 목록을 엑셀 파일(.xlsx)로 다운로드합니다.

[동작 방식]
- 요청 바디에
templateKeys
가 존재하면 해당 templateKey 목록에 한해 다운로드 합니다.
-
templateKeys
가 없으면 상위 필터(목록 조회와 동일한 필터 조건)에 해당하는 전체 템플릿을 다운로드합니다.
- 두 경우 모두 페이징 없이 조건에 맞는 전체를 출력하며 등록일(createAt) 내림차순으로 정렬됩니다.

[검색 조건 요약] (목록 조회와 동일,
templateKeys
미지정 시 적용)
- 식별자:
templateCode
,
customTemplateCode
,
senderKey

- 템플릿 정보(LIKE):
manageName
,
templateName
,
templateContent

- 상태:
inspectionStatus[]
,
templateStatus[]
,
useYn
,
showUnusedTemplate
,
showHideTemplate
,
dormant
,
block

- 분류:
templateMessageType[]
,
templateEmphasizeType[]
,
serviceMode
,
categoryCode
,
securityFlag

- 구성요소 유무/유형:
hasPreviewMessage
,
hasButton
+
buttonTypes[]
,
hasQuickReply
+
quickReplyTypes[]
,
hasRepresentLink

- 키워드 검색:
searchType
(검색 대상 필드) +
searchKeyword
(LIKE)
- 기간:
dateType
(CREATE_AT/MODIFIED_AT/INSPECTION_STATUS_UPDATE, 미지정 시 CREATE_AT) +
startDate
/
endDate
(YYYY-MM-DD)

[파일]
- 파일명:
템플릿 요청 목록 {yyyyMMddHHmmss}.xlsx

- 최대 버튼 5개, 바로연결 10개, 아이템리스트 10개 컬럼까지 고정 노출됩니다.

요청 속성

Attributes

templateCodestring

템플릿 코드

예시

A_AA_001_01_00001

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

검색할 템플릿명

manageNamestring

템플릿 관리명

예시

검색할 템플릿 관리명

templateContentstring

템플릿 내용

예시

검색할 템플릿 내용

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

inspectionStatusarray<string>

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

itemsstringenum

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

dateTypestringenum

기간 조회 대상 (CREATE_AT: 등록일, MODIFIED_AT: 수정일, INSPECTION_STATUS_UPDATE: 검수상태 변경일). 미지정 시 CREATE_AT.

예시

CREATE_AT

가능한 enum 값

1
CREATE_AT

2
MODIFIED_AT

3
INSPECTION_STATUS_UPDATE

startDatestring

조회 시작일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-01-01

endDatestring

조회 종료일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-12-31

showHideTemplateboolean

숨김 템플릿 포함 여부 (true: 숨김 포함, false: 숨김 제외)

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부 (Y/N) — 명시 시 정확히 매치되며 showUnusedTemplate보다 우선 적용

예시

Y

가능한 enum 값

1
Y

2
N

showUnusedTemplateboolean

미사용 템플릿만 조회 여부 (true: 미사용(useYn=N)만, false: 사용중(useYn=Y)만). useYn이 명시되면 무시됨.

예시

false

dormantboolean

휴면 여부

예시

false

blockboolean

차단 여부

예시

false

hasPreviewMessageboolean

미리보기 메시지 여부 (true: 있음, false: 없음)

예시

true

templateMessageTypearray<string>

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

itemsstringenum

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypearray<string>

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

itemsstringenum

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

categoryCodestring

카테고리 코드

예시

001002

securityFlagboolean

보안 템플릿 여부 (true: 보안템플릿, false: 일반템플릿)

예시

true

templateStatusarray<string>

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

itemsstringenum

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

가능한 enum 값

1
S

2
A

3
R

searchTypestringenum

키워드 검색 대상 (MANAGE_NAME: 템플릿관리명, TEMPLATE_CODE: 템플릿코드, CUSTOM_TEMPLATE_CODE: 고객사관리코드, TEMPLATE_NAME: 템플릿명, TEMPLATE_CONTENT: 템플릿내용, PREVIEW_MESSAGE: 미리보기메시지내용)

예시

MANAGE_NAME

가능한 enum 값

1
MANAGE_NAME

2
TEMPLATE_CODE

3
CUSTOM_TEMPLATE_CODE

4
TEMPLATE_NAME

5
TEMPLATE_CONTENT

6
PREVIEW_MESSAGE

7
TEMPLATE_EXTRA

8
TEMPLATE_AD

9
TEMPLATE_TITLE

10
TEMPLATE_SUBTITLE

11
TEMPLATE_HEADER

12
TEMPLATE_IMAGE_NAME

13
ITEM_HIGHLIGHT

14
ITEM_LIST

15
BUTTON_NAME

16
BUTTON_LINK

17
QUICK_REPLY_NAME

18
QUICK_REPLY_LINK

19
REPRESENT_LINK

20
COMMENT

21
COMMENT_FILE_NAME

22
REJECT_REASON

searchKeywordstring

키워드 검색어 (searchType 지정 시 해당 필드에 LIKE 검색)

예시

가입 안내

hasButtonboolean

버튼 여부 (true: 있음, false: 없음)

예시

true

buttonTypesarray<string>

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

itemsstringenum

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

hasQuickReplyboolean

바로연결 여부 (true: 있음, false: 없음)

예시

true

quickReplyTypesarray<string>

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

itemsstringenum

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

hasRepresentLinkboolean

대표링크 여부 (true: 있음, false: 없음)

예시

true

templateKeysarray<string>

다운로드 대상 templateKey 목록. 값이 있으면 필터 조건은 무시되고 해당 키 목록에 대해서만 출력합니다. 미지정 시 상위 필터(AtTemplateBaseFilter) 조건으로 전체 목록을 다운로드합니다.

예시

[
"KEY_JOIN_001",
"KEY_JOIN_002"
]

itemsstring

다운로드 대상 templateKey 목록. 값이 있으면 필터 조건은 무시되고 해당 키 목록에 대해서만 출력합니다. 미지정 시 상위 필터(AtTemplateBaseFilter) 조건으로 전체 목록을 다운로드합니다.

예시

["KEY_JOIN_001","KEY_JOIN_002"]

응답 속성

200

OK

Attributes

bodystring(binary)binary

-

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/excel" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"templateCode": "A_AA_001_01_00001",
"customTemplateCode": "CUST_JOIN_001",
"templateName": "검색할 템플릿명",
"manageName": "검색할 템플릿 관리명",
"templateContent": "검색할 템플릿 내용",
"senderKey": "db105ef3ebe9917ae0f9dcef4c94a6adb74d125f",
"inspectionStatus": "REG,REQ,HREJ,KREQ,KREJ,APR",
"dateType": "CREATE_AT",
"startDate": "2026-01-01",
"endDate": "2026-12-31",
"showHideTemplate": false,
"serviceMode": "PRD",
"useYn": "Y",
"showUnusedTemplate": false,
"dormant": false,
"block": false,
"hasPreviewMessage": true,
"templateMessageType": "BA",
"templateEmphasizeType": "NONE",
"categoryCode": "001002",
"securityFlag": true,
"templateStatus": "R,A",
"searchType": "MANAGE_NAME",
"searchKeyword": "가입 안내",
"hasButton": true,
"buttonTypes": "AC,WL",
"hasQuickReply": true,
"quickReplyTypes": "WL,BK",
"hasRepresentLink": true,
"templateKeys": [
"KEY_JOIN_001",
"KEY_JOIN_002"
]
}'

JSON
{
"templateCode": "A_AA_001_01_00001",
"customTemplateCode": "CUST_JOIN_001",
"templateName": "검색할 템플릿명",
"manageName": "검색할 템플릿 관리명",
"templateContent": "검색할 템플릿 내용",
"senderKey": "db105ef3ebe9917ae0f9dcef4c94a6adb74d125f",
"inspectionStatus": "REG,REQ,HREJ,KREQ,KREJ,APR",
"dateType": "CREATE_AT",
"startDate": "2026-01-01",
"endDate": "2026-12-31",
"showHideTemplate": false,
"serviceMode": "PRD",
"useYn": "Y",
"showUnusedTemplate": false,
"dormant": false,
"block": false,
"hasPreviewMessage": true,
"templateMessageType": "BA",
"templateEmphasizeType": "NONE",
"categoryCode": "001002",
"securityFlag": true,
"templateStatus": "R,A",
"searchType": "MANAGE_NAME",
"searchKeyword": "가입 안내",
"hasButton": true,
"buttonTypes": "AC,WL",
"hasQuickReply": true,
"quickReplyTypes": "WL,BK",
"hasRepresentLink": true,
"templateKeys": [
"KEY_JOIN_001",
"KEY_JOIN_002"
]
}

---

## [POST] 알림톡 템플릿 엑셀 업로드

post
알림톡 템플릿 엑셀 업로드

/kakao-management/api/v1/alimtalk/template/excel/upload

알림톡 템플릿 업로드 양식(.xlsx)에 데이터를 채워 업로드하여 템플릿을 일괄 등록합니다.

[옵션 파라미터]
-
dryRun
(boolean, default false): true 이면 검증만 수행하고 서버에 저장하지 않습니다 (미리보기).
-
strategy
(enum, default CONTINUE_ON_ERROR):
·
CONTINUE_ON_ERROR
: 실패 행은 건너뛰고 정상 행만 저장
·
STOP_ON_ERROR
: 한 건이라도 실패 시 전체 저장 skip (응답의
aborted
=true)

[처리 방식]
- 모든 행을 검증하여 행별 성공/실패 결과와 실패 사유를 응답에 포함합니다.
- 응답의
savedCount
로 실제 DB 저장 건수를 확인할 수 있습니다.

[제한]
- 파일 확장자: .xlsx 만 허용
- 최대 행 수: 1,000
- 파일 크기: spring.servlet.multipart.max-file-size (10MB)

[저장]
- 업로드된 원본 파일은 감사용으로 서버에 보관됩니다.
- 실패 행이 있는 경우 응답의
errorReportKey
로 실패 리포트(.xlsx)를 다운로드할 수 있습니다.

요청 속성

Attributes

filestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 엑셀 업로드 결과

totalRowsinteger(int32)int32

총 데이터 행 수 (빈 행 제외)

예시

50

successCountinteger(int32)int32

검증 통과 행 수

예시

47

failureCountinteger(int32)int32

검증 실패 행 수

예시

3

savedCountinteger(int32)int32

실제 서버에 저장된 행 수. dryRun=true 또는 STOP_ON_ERROR 로 인해 저장이 skip 되면 0

예시

47

dryRunboolean

미리보기(검증만) 모드 여부. true 이면 DB 저장 없이 검증 결과만 반환

예시

false

strategystringenum

알림톡 템플릿 엑셀 업로드 처리 전략
- CONTINUE_ON_ERROR (기본값): 실패 행은 건너뛰고 정상 행만 저장
- STOP_ON_ERROR : 한 건이라도 실패 시 전체 저장 skip

예시

CONTINUE_ON_ERROR

가능한 enum 값

1
CONTINUE_ON_ERROR

2
STOP_ON_ERROR

abortedboolean

STOP_ON_ERROR 전략으로 인해 저장이 중단되었는지 여부. true 이면 검증 실패가 1건 이상 있어 정상 행도 저장되지 않음

예시

false

resultsarray<object>

행별 처리 결과 (성공·실패 모두 포함)

itemsobject

엑셀 업로드 한 행의 처리 결과

rowNumberinteger(int32)int32

엑셀 행 번호 (1-based)

예시

5

statusstringenum

처리 상태

예시

SUCCESS

가능한 enum 값

1
SUCCESS

2
FAILED

templateKeystring

templateKey (성공 시 서버 자동발급된 키)

예시

AT240429120000ABCD

errorsarray<object>nullable

오류 목록 (실패 시)

itemsobjectnullable

오류 목록 (실패 시)

columnstring

엑셀 컬럼 (A, B, ... AB ...)

예시

E

fieldstring

필드명 (논리)

예시

categoryCode

codestring

오류 코드

예시

NOT_FOUND_AT_TEMPLATE_CATEGORY

messagestring

오류 메시지(한국어)

예시

카테고리가 존재하지 않습니다: 999

errorReportKeystring

실패 리포트 엑셀 다운로드 키. failureCount > 0 일 때만 부여

예시

8a7b9d3e-1c2f-4a5b-9d3e-1c2f4a5b9d3e

fileNamestring

사용자가 업로드한 원본 파일명 (서버 저장 경로는 노출하지 않음)

예시

template.xlsx

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/excel/upload" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

---

## [POST] 알림톡 템플릿 키 자동발급

post
알림톡 템플릿 키 자동발급

/kakao-management/api/v1/alimtalk/template/key

알림톡 템플릿 등록 전에 사용할 templateKey를 선발급합니다.
등록 API 호출 시 templateKey 필드를 비워두면 서버가 자동 발급해주므로 이 API는 선택 사용입니다.
발급 포맷: AT + yyMMddHHmmss + 랜덤 4자 (최대 20자).

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 키 자동발급 응답

templateKeystring

자동발급된 템플릿 키

예시

AT260423153045A1B2

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/key" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [GET] 알림톡 최근변경 템플릿 조회

get
알림톡 최근변경 템플릿 조회

/kakao-management/api/v1/alimtalk/template/last-modified

변경사항이 생긴 템플릿 리스트를 조회합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

countinteger(int32)int32범위:1~

페이지당 조회할 건수

예시

1000

pageinteger(int32)int32범위:0~

페이지 번호

예시

0

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

sincestring

조회 시작 시간

예시

20221201130000

inspectionStatusListarray<string>

검수상태(등록,검수요청,승인,반려 등)

예시

REG,REQ,KREQ,APR,HREJ,KREJ

itemsstringenum

검수상태(등록,검수요청,승인,반려 등)

예시

REG,REQ,KREQ,APR,HREJ,KREJ

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

최근변경 템플릿 응답 정보

hasNextboolean

다음페이지 존재 여부

예시

true

totalinteger(int64)int64

총 갯수

예시

1700

modifiedTemplateListarray<object>

변경된 템플릿 정보

itemsobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/last-modified" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 개수 조회

get
알림톡 템플릿 개수 조회

/kakao-management/api/v1/alimtalk/template/count

검색 조건으로 알림톡 템플릿 개수를 조회합니다.목록 조회 API와 동일한 필터를 지원합니다.

[검색 조건 요약] (목록 조회와 동일)
- 식별자:
templateCode
,
customTemplateCode
,
senderKey

- 템플릿 정보(LIKE):
manageName
,
templateName
,
templateContent

- 상태:
inspectionStatus[]
,
templateStatus[]
,
useYn
,
showUnusedTemplate
,
showHideTemplate
,
dormant
,
block

- 분류:
templateMessageType[]
,
templateEmphasizeType[]
,
serviceMode
,
categoryCode
,
securityFlag

- 구성요소 유무/유형:
hasPreviewMessage
,
hasButton
+
buttonTypes[]
,
hasQuickReply
+
quickReplyTypes[]
,
hasRepresentLink

- 키워드 검색:
searchType
(검색 대상 필드) +
searchKeyword
(LIKE)
- 기간:
dateType
(CREATE_AT/MODIFIED_AT/INSPECTION_STATUS_UPDATE, 미지정 시 CREATE_AT) +
startDate
/
endDate
(YYYY-MM-DD)
[groupBy 미지정]
- total(전체 개수)만 반환합니다.

[groupBy 지정]
- total과 함께 해당 항목별 개수(counts)를 반환합니다.
- counts의 키는 각 항목의 값(문자열)이며, 해당 값이 null인 레코드는 제외됩니다.
- 예) INSPECTION_STATUS → {"APR": 1200, "REG": 300, "REQ": 150, ...}
- 예) DORMANT → {"true": 80, "false": 1620}
- 예) CATEGORY_CODE → {"001001": 500, "001002": 320, ...}

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

templateCodestring

템플릿 코드

예시

A_AA_001_01_00001

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

검색할 템플릿명

manageNamestring

템플릿 관리명

예시

검색할 템플릿 관리명

templateContentstring

템플릿 내용

예시

검색할 템플릿 내용

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

inspectionStatusarray<string>

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

itemsstringenum

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

dateTypestringenum

기간 조회 대상 (CREATE_AT: 등록일, MODIFIED_AT: 수정일, INSPECTION_STATUS_UPDATE: 검수상태 변경일). 미지정 시 CREATE_AT.

예시

CREATE_AT

가능한 enum 값

1
CREATE_AT

2
MODIFIED_AT

3
INSPECTION_STATUS_UPDATE

startDatestring

조회 시작일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-01-01

endDatestring

조회 종료일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-12-31

showHideTemplateboolean

숨김 템플릿 포함 여부 (true: 숨김 포함, false: 숨김 제외)

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부 (Y/N) — 명시 시 정확히 매치되며 showUnusedTemplate보다 우선 적용

예시

Y

가능한 enum 값

1
Y

2
N

showUnusedTemplateboolean

미사용 템플릿만 조회 여부 (true: 미사용(useYn=N)만, false: 사용중(useYn=Y)만). useYn이 명시되면 무시됨.

예시

false

dormantboolean

휴면 여부

예시

false

blockboolean

차단 여부

예시

false

hasPreviewMessageboolean

미리보기 메시지 여부 (true: 있음, false: 없음)

예시

true

templateMessageTypearray<string>

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

itemsstringenum

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypearray<string>

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

itemsstringenum

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

categoryCodestring

카테고리 코드

예시

001002

securityFlagboolean

보안 템플릿 여부 (true: 보안템플릿, false: 일반템플릿)

예시

true

templateStatusarray<string>

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

itemsstringenum

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

가능한 enum 값

1
S

2
A

3
R

searchTypestringenum

키워드 검색 대상 (MANAGE_NAME: 템플릿관리명, TEMPLATE_CODE: 템플릿코드, CUSTOM_TEMPLATE_CODE: 고객사관리코드, TEMPLATE_NAME: 템플릿명, TEMPLATE_CONTENT: 템플릿내용, PREVIEW_MESSAGE: 미리보기메시지내용)

예시

MANAGE_NAME

가능한 enum 값

1
MANAGE_NAME

2
TEMPLATE_CODE

3
CUSTOM_TEMPLATE_CODE

4
TEMPLATE_NAME

5
TEMPLATE_CONTENT

6
PREVIEW_MESSAGE

7
TEMPLATE_EXTRA

8
TEMPLATE_AD

9
TEMPLATE_TITLE

10
TEMPLATE_SUBTITLE

11
TEMPLATE_HEADER

12
TEMPLATE_IMAGE_NAME

13
ITEM_HIGHLIGHT

14
ITEM_LIST

15
BUTTON_NAME

16
BUTTON_LINK

17
QUICK_REPLY_NAME

18
QUICK_REPLY_LINK

19
REPRESENT_LINK

20
COMMENT

21
COMMENT_FILE_NAME

22
REJECT_REASON

searchKeywordstring

키워드 검색어 (searchType 지정 시 해당 필드에 LIKE 검색)

예시

가입 안내

hasButtonboolean

버튼 여부 (true: 있음, false: 없음)

예시

true

buttonTypesarray<string>

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

itemsstringenum

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

hasQuickReplyboolean

바로연결 여부 (true: 있음, false: 없음)

예시

true

quickReplyTypesarray<string>

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

itemsstringenum

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

hasRepresentLinkboolean

대표링크 여부 (true: 있음, false: 없음)

예시

true

groupBystringenum

그룹 기준 (미지정 시 전체 개수만 반환, 지정 시 그룹별 개수 추가 반환)

가능한 enum 값

1
INSPECTION_STATUS

2
TEMPLATE_STATUS

3
TEMPLATE_MESSAGE_TYPE

4
TEMPLATE_EMPHASIZE_TYPE

5
SERVICE_MODE

6
USE_YN

7
SHOW_YN

8
DORMANT

9
BLOCK

10
SECURITY_FLAG

11
CATEGORY_CODE

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 개수 조회 응답

totalinteger(int64)int64

전체 개수

예시

1700

countsmap<string, integer(int64)>

그룹별 개수 (groupBy 미지정 시 null)

예시

{
"APR": 1200,
"REG": 300
}

valueinteger(int64)int64

그룹별 개수 (groupBy 미지정 시 null)

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/count" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 목록 조회

get
알림톡 템플릿 목록 조회

/kakao-management/api/v1/alimtalk/template/list

검색 조건으로 알림톡 템플릿 목록을 조회합니다. (페이징: page, count)

[검색 조건 요약]
- 식별자:
templateCode
,
customTemplateCode
,
senderKey

- 템플릿 정보(LIKE):
manageName
,
templateName
,
templateContent

- 상태:
inspectionStatus[]
,
templateStatus[]
,
useYn
,
showUnusedTemplate
,
showHideTemplate
,
dormant
,
block

- 분류:
templateMessageType[]
,
templateEmphasizeType[]
,
serviceMode
,
categoryCode
,
securityFlag

- 구성요소 유무/유형:
hasPreviewMessage
,
hasButton
+
buttonTypes[]
,
hasQuickReply
+
quickReplyTypes[]
,
hasRepresentLink

- 키워드 검색:
searchType
(검색 대상 필드) +
searchKeyword
(LIKE)
- 기간:
dateType
(CREATE_AT/MODIFIED_AT/INSPECTION_STATUS_UPDATE, 미지정 시 CREATE_AT) +
startDate
/
endDate
(YYYY-MM-DD)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

templateCodestring

템플릿 코드

예시

A_AA_001_01_00001

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

검색할 템플릿명

manageNamestring

템플릿 관리명

예시

검색할 템플릿 관리명

templateContentstring

템플릿 내용

예시

검색할 템플릿 내용

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

inspectionStatusarray<string>

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

itemsstringenum

검수상태(등록,검수요청,휴머스온 반려,카카오 검수요청,카카오 반려,승인완료)

예시

REG,REQ,HREJ,KREQ,KREJ,APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

dateTypestringenum

기간 조회 대상 (CREATE_AT: 등록일, MODIFIED_AT: 수정일, INSPECTION_STATUS_UPDATE: 검수상태 변경일). 미지정 시 CREATE_AT.

예시

CREATE_AT

가능한 enum 값

1
CREATE_AT

2
MODIFIED_AT

3
INSPECTION_STATUS_UPDATE

startDatestring

조회 시작일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-01-01

endDatestring

조회 종료일(YYYY-MM-DD) — dateType이 가리키는 날짜 컬럼 기준

예시

2026-12-31

showHideTemplateboolean

숨김 템플릿 포함 여부 (true: 숨김 포함, false: 숨김 제외)

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부 (Y/N) — 명시 시 정확히 매치되며 showUnusedTemplate보다 우선 적용

예시

Y

가능한 enum 값

1
Y

2
N

showUnusedTemplateboolean

미사용 템플릿만 조회 여부 (true: 미사용(useYn=N)만, false: 사용중(useYn=Y)만). useYn이 명시되면 무시됨.

예시

false

dormantboolean

휴면 여부

예시

false

blockboolean

차단 여부

예시

false

hasPreviewMessageboolean

미리보기 메시지 여부 (true: 있음, false: 없음)

예시

true

templateMessageTypearray<string>

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

itemsstringenum

템플릿 메시지 유형 (BA: 기본형, EX: 부가정보형, AD: 채널추가형, MI: 복합형)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypearray<string>

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

itemsstringenum

템플릿 강조 유형 (NONE: 사용안함, TEXT: 강조표기형, IMAGE: 이미지형, ITEM_LIST: 아이템리스트형)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

categoryCodestring

카테고리 코드

예시

001002

securityFlagboolean

보안 템플릿 여부 (true: 보안템플릿, false: 일반템플릿)

예시

true

templateStatusarray<string>

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

itemsstringenum

템플릿 상태 (R: 대기, A: 정상, S: 중지)

예시

R,A

가능한 enum 값

1
S

2
A

3
R

searchTypestringenum

키워드 검색 대상 (MANAGE_NAME: 템플릿관리명, TEMPLATE_CODE: 템플릿코드, CUSTOM_TEMPLATE_CODE: 고객사관리코드, TEMPLATE_NAME: 템플릿명, TEMPLATE_CONTENT: 템플릿내용, PREVIEW_MESSAGE: 미리보기메시지내용)

예시

MANAGE_NAME

가능한 enum 값

1
MANAGE_NAME

2
TEMPLATE_CODE

3
CUSTOM_TEMPLATE_CODE

4
TEMPLATE_NAME

5
TEMPLATE_CONTENT

6
PREVIEW_MESSAGE

7
TEMPLATE_EXTRA

8
TEMPLATE_AD

9
TEMPLATE_TITLE

10
TEMPLATE_SUBTITLE

11
TEMPLATE_HEADER

12
TEMPLATE_IMAGE_NAME

13
ITEM_HIGHLIGHT

14
ITEM_LIST

15
BUTTON_NAME

16
BUTTON_LINK

17
QUICK_REPLY_NAME

18
QUICK_REPLY_LINK

19
REPRESENT_LINK

20
COMMENT

21
COMMENT_FILE_NAME

22
REJECT_REASON

searchKeywordstring

키워드 검색어 (searchType 지정 시 해당 필드에 LIKE 검색)

예시

가입 안내

hasButtonboolean

버튼 여부 (true: 있음, false: 없음)

예시

true

buttonTypesarray<string>

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

itemsstringenum

버튼 유형 (AC: 채널추가, WL: 웹링크, AL: 앱링크, BK: 봇키워드, MD: 메시지전달, BC: 상담톡전환, BT: 봇전환, DS: 배송조회, P1: 이미지보안플러그인, P2: 개인정보이용플러그인, P3: 원클릭결제플러그인, BF: 비즈니스폼, TN: 전화앱실행, MP: 지도보기)

예시

AC,WL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

hasQuickReplyboolean

바로연결 여부 (true: 있음, false: 없음)

예시

true

quickReplyTypesarray<string>

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

itemsstringenum

바로연결 유형 (WL: 웹링크, AL: 앱링크, BK: 봇키워드, BC: 상담톡전환, BT: 봇전환, BF: 비즈니스폼)

예시

WL,BK

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

hasRepresentLinkboolean

대표링크 여부 (true: 있음, false: 없음)

예시

true

pageinteger(int32)int32범위:0~

페이지 번호

예시

0

countinteger(int32)int32범위:1~

페이지당 조회할 건수

예시

20

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 목록 조회 응답

hasNextboolean

다음페이지 존재 여부

예시

true

totalinteger(int64)int64

총 갯수

예시

1700

templateListarray<object>

템플릿 리스트

itemsobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/list" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 엑셀 업로드 실패 리포트 다운로드

get
알림톡 템플릿 엑셀 업로드 실패 리포트 다운로드

/kakao-management/api/v1/alimtalk/template/excel/upload/report/{key}

엑셀 업로드 응답으로 받은
errorReportKey
로 실패 행만 담긴 엑셀(.xlsx) 리포트를 다운로드합니다.
- 만료 시간: 발급 후 1시간

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

bodystring(binary)binary

-

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/excel/upload/report/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 엑셀 업로드 양식 다운로드

get
알림톡 템플릿 엑셀 업로드 양식 다운로드

/kakao-management/api/v1/alimtalk/template/excel/form

알림톡 템플릿 일괄 등록에 사용하는 엑셀 업로드 양식(.xlsx)을 다운로드합니다.

[파일]
- 파일명:
알림톡 템플릿 업로드 양식.xlsx

- 양식 컬럼: 발신프로필명, 발신프로필 UUID, 템플릿관리명, 카테고리, 템플릿내용, 템플릿유형, 부가정보, 강조표기 타이틀/보조문구, 보안템플릿, 버튼1~5(타입/이름/android/ios/모바일/PC), 코멘트, 고객사관리코드, 서비스 유형, 템플릿 알람 수신자 목록

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

bodystring(binary)binary

-

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/excel/form" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 이력 목록 조회

get
알림톡 템플릿 이력 목록 조회

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/history

특정 알림톡 템플릿의 변경 이력 목록을 조회합니다. (templateKey 기준, 최신순)
[동작 방식]
- 템플릿이 생성/수정되거나 상태가 변경될 때마다 변경 직전 스냅샷이 이력 테이블(tb_template_request_hist)에 적재됩니다.
- 삭제의 경우, 삭제 플래그(del_yn)를 'Y'로 업데이트한 스냅샷이 먼저 이력에 적재된 후 원본 템플릿이 삭제됩니다.
- 본 API는 이력 각 시점에 대해 "직전 이력 대비 어떤 필드가 바뀌었는지"를 요약해 반환합니다.

[changeType 대표 유형] (우선순위 높은 것 우선)
- CREATE: 최초 등록 (직전 이력 없음)
- DELETE: 삭제 스냅샷 (del_yn = 'Y')
- INSPECTION: 검수 상태(inspectionStatus) 전환 (예: REG → REQ → APR)
- STATUS: 템플릿 상태(templateStatus) 전환 (A/R/S)
- UPDATE: 그 외 일반 필드 변경

[변경 필드 표현 방식]
- 단순 필드: before/after 값을 그대로 노출
- 긴 텍스트(templateContent, comment, rejectReason): 40자 초과 시 말줄임(…) 처리, truncated=true
- 복잡 JSON(attachment, supplement, templateItem 등): "버튼 2개", "바로연결 1개" 같은 개수 요약, complex=true

[주의]
- 페이징 없음 (한 템플릿당 이력은 일반적으로 10건 이하).
- 상세 스냅샷은 별도 상세 조회 API(/history/{histId})로 확인합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 이력 목록 응답.
한 템플릿의 전체 이력을 최신순으로 반환한다. (페이징 없음)

templateKeystring

조회 대상 템플릿 키

예시

KEY_JOIN_001

totalCountinteger(int32)int32

이력 총 개수

예시

5

historiesarray<object>

이력 요약 목록 (최신순)

itemsobject

알림톡 템플릿 이력 요약 항목.
한 행은 하나의 변경 시점을 나타내며, 그 시점의 상태와 직전 대비 변경된 필드 요약을 포함한다.
전체 스냅샷이 필요하면 histId로 이력 상세 조회 API를 호출한다.

histIdinteger(int64)int64

이력 고유 ID (상세 조회 API 호출에 사용)

예시

1024

changeTypestringenum

알림톡 템플릿 이력 변경 유형
- CREATE: 최초 등록
- DELETE: 삭제 처리 (삭제 직전의 스냅샷)
- INSPECTION: 검수 상태(inspectionStatus) 전환
- STATUS: 템플릿 상태(templateStatus) 전환 (A/R/S)
- UPDATE: 템플릿 내용 등 일반 필드 변경

예시

UPDATE

가능한 enum 값

1
CREATE

2
DELETE

3
INSPECTION

4
STATUS

5
UPDATE

inspectionStatusstringenum

이력 시점의 검수 상태

예시

REQ

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

templateStatusstringenum

이력 시점의 템플릿 상태

예시

R

가능한 enum 값

1
S

2
A

3
R

modifiedAtstring

이력 기록 시점 (yyyy-MM-dd HH:mm:ss)

예시

2026-04-17 10:30:00

modifiedBystring

변경자 ID (사용자명 노출은 추후 확장 예정)

예시

admin01

changedCountinteger(int32)int32

직전 이력 대비 변경된 필드 수

예시

3

changesarray<object>

직전 이력 대비 변경된 필드 목록

itemsobject

알림톡 템플릿 이력의 필드 단위 변경 내역.
단순/텍스트/복잡 JSON 필드인지에 따라 표현 방식이 달라진다.

fieldstring

엔티티 필드명 (카멜케이스)

예시

templateContent

labelstring

화면 표기용 한글 라벨

예시

템플릿 내용

beforestring

변경 전 값 (null 가능). 복잡 JSON 필드는 JSON 문자열.

예시

대기(R)

afterstring

변경 후 값 (null 가능). 포맷 규칙은 before와 동일.

예시

정상(A)

truncatedboolean

축약 여부. 항상 false (원문 그대로 반환).

예시

false

complexboolean

복잡 JSON 필드 여부. true면 before/after는 직렬화된 JSON 문자열.

예시

false

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//history" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 이력 상세 조회

get
알림톡 템플릿 이력 상세 조회

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/history/{histId}

특정 이력 시점의 템플릿 전체 스냅샷을 조회합니다. (histId 기준)
[응답 구조]
- 해당 시점의 템플릿 전체 필드(= 일반 템플릿 상세 조회 AtTemplateResponse와 동일한 스키마)가 그대로 포함됩니다.
- 추가로 직전 이력 대비 변경된 필드 요약(changes)과 대표 변경 유형(changeType)을 함께 반환합니다.

[활용 예시]
- 이력 목록(/history)에서 특정 행을 선택했을 때, 그 시점의 템플릿이 어떤 모습이었는지 전체 조회할 때 사용합니다.
- 목록 API의 changes와 동일 포맷의 변경 내역도 함께 제공되므로, 상세 화면에서도 "이 시점에 무엇이 바뀌었는지" 노출이 가능합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 이력 상세 응답.
해당 시점의 템플릿 전체 스냅샷(AtTemplateResponse와 동일 스키마)과 직전 이력 대비 변경 요약을 함께 반환한다.

histIdinteger(int64)int64

이력 고유 ID

예시

1024

changeTypestringenum

알림톡 템플릿 이력 변경 유형
- CREATE: 최초 등록
- DELETE: 삭제 처리 (삭제 직전의 스냅샷)
- INSPECTION: 검수 상태(inspectionStatus) 전환
- STATUS: 템플릿 상태(templateStatus) 전환 (A/R/S)
- UPDATE: 템플릿 내용 등 일반 필드 변경

예시

INSPECTION

가능한 enum 값

1
CREATE

2
DELETE

3
INSPECTION

4
STATUS

5
UPDATE

changesarray<object>

직전 이력 대비 변경된 필드 목록

itemsobject

알림톡 템플릿 이력의 필드 단위 변경 내역.
단순/텍스트/복잡 JSON 필드인지에 따라 표현 방식이 달라진다.

fieldstring

엔티티 필드명 (카멜케이스)

예시

templateContent

labelstring

화면 표기용 한글 라벨

예시

템플릿 내용

beforestring

변경 전 값 (null 가능). 복잡 JSON 필드는 JSON 문자열.

예시

대기(R)

afterstring

변경 후 값 (null 가능). 포맷 규칙은 before와 동일.

예시

정상(A)

truncatedboolean

축약 여부. 항상 false (원문 그대로 반환).

예시

false

complexboolean

복잡 JSON 필드 여부. true면 before/after는 직렬화된 JSON 문자열.

예시

false

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

modifiedBystring

변경자 ID (사용자명 노출은 추후 확장 예정)

예시

admin01

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//history/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 조회

get
알림톡 템플릿 조회

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}

알림톡 템플릿을 조회합니다. (templateKey 기준)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 알림톡 템플릿 코멘트 파일 다운로드

get
알림톡 템플릿 코멘트 파일 다운로드

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/comment/file

검수요청 시 첨부한 코멘트 파일을 다운로드합니다. (templateKey 기준)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

bodystring(binary)binary

-

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//comment/file" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [PUT] 알림톡 템플릿 검수요청 취소

put
알림톡 템플릿 검수요청 취소

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/comment/cancel

검수 요청된 알림톡 템플릿을 검수요청 취소합니다. (휴머스온 검수요청(REQ) 상태에서만 가능)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//comment/cancel" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [PUT] 알림톡 템플릿 수정

put
알림톡 템플릿 수정

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}

알림톡 템플릿을 수정합니다. (templateKey 기준)
수정은 템플릿 상태가 대기(R)이고 , 검수상태가 등록(REG), 휴머스온 반려(HREJ), 카카오 반려(KREJ) 상태에서만 가능합니다.

[문자 제한]
템플릿 본문·미리보기·부가정보·강조 문구·헤더·대표링크(URL·scheme)·버튼명·버튼 링크(URL·scheme)·바로연결명·바로연결 링크(URL·scheme, supplement 퀵리플라이)·아이템 문구 등 입력 텍스트에는 NBSP(U+00A0)를 사용할 수 없습니다.

요청 속성

Attributes

manageNamestringrequired길이:0~30

관리용 이름

예시

회원가입 발송 템플릿_v1

customTemplateCodestring길이:0~30

고객사 관리 코드

예시

CUST_JOIN_001

templateMessageTypestringrequiredenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringrequiredenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstringrequired길이:0~1300

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring길이:0~40

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring길이:0~500

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateImageNamestring길이:0~50

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring길이:0~100정규식

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring길이:0~50

템플릿 강조 표기 타이틀

예시

회원가입 완료

templateSubtitlestring길이:0~50

강조 표기 보조 문구

예시

감사합니다

templateHeaderstring길이:0~16

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

categoryCodestringrequired길이:0~6숫자만

템플릿 카테고리 코드 (숫자만, 최대 6자)

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

buttonListarray<object>개수:0~5

버튼 정보 (최대 5개, 바로연결과 함께 사용 시 최대 2개)

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>개수:0~10

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring길이:0~300

템플릿 검수 알림 수신자 전화번호 (번호만 입력, 콤마로 구분, 최대 10개)

예시

01012345678,01087654321

commentstring길이:0~500

검수 코멘트 (의견 또는 문의사항, 최대 500자)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"categoryCode": "001001",
"manageName": "회원가입 발송 템플릿_v1",
"templateContent": "#{name}님 회원가입을 축하합니다.",
"templateEmphasizeType": "NONE",
"templateMessageType": "BA",
"customTemplateCode": "CUST_JOIN_001",
"templateExtra": "자세한 내용은 홈페이지를 확인해 주세요.",
"templateImageName": "welcome.png",
"templateImageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg",
"templateTitle": "회원가입 완료",
"templateSubtitle": "감사합니다",
"templateHeader": "안내",
"templateItemHighlight": {
"description": "#{웨이팅 번호 설명}",
"title": "#{웨이팅 번호}",
"imageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg"
},
"templateItem": {
"list": [
{
"description": "#{6월 10일 12:10}",
"title": "등록일시"
}
],
"summary": {
"description": "#{28,000원}",
"title": "결제금액"
}
},
"securityFlag": false,
"buttonList": [
{
"name": "예약 확인하기",
"type": "AL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com"
}
],
"quickReplyList": [
{
"name": "문의하기",
"type": "WL",
"url_mobile": "https://imc.humuson.com/mobile",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com",
"biz_form_id": 1
}
]
}'

JSON
{
"categoryCode": "001001",
"manageName": "회원가입 발송 템플릿_v1",
"templateContent": "#{name}님 회원가입을 축하합니다.",
"templateEmphasizeType": "NONE",
"templateMessageType": "BA",
"customTemplateCode": "CUST_JOIN_001",
"templateExtra": "자세한 내용은 홈페이지를 확인해 주세요.",
"templateImageName": "welcome.png",
"templateImageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg",
"templateTitle": "회원가입 완료",
"templateSubtitle": "감사합니다",
"templateHeader": "안내",
"templateItemHighlight": {
"description": "#{웨이팅 번호 설명}",
"title": "#{웨이팅 번호}",
"imageUrl": "https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg"
},
"templateItem": {
"list": [
{
"description": "#{6월 10일 12:10}",
"title": "등록일시"
}
],
"summary": {
"description": "#{28,000원}",
"title": "결제금액"
}
},
"securityFlag": false,
"buttonList": [
{
"name": "예약 확인하기",
"type": "AL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com"
}
],
"quickReplyList": [
{
"name": "문의하기",
"type": "WL",
"url_mobile": "https://imc.humuson.com/mobile",
"url_pc": "https://imc.humuson.com",
"scheme_android": "https://imc.humuson.com",
"scheme_ios": "https://imc.humuson.com",
"biz_form_id": 1
}
]
}

---

## [PUT] 알림톡 템플릿 휴면 해제

put
알림톡 템플릿 휴면 해제

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/release

장기 미사용으로 휴면처리된 템플릿을 휴면해제 할 수 있습니다.

1) 상태 변경 기준

- 템플릿 등록 후 1년동안 상태 변경이 되지 않은 경우 '휴면' 상태로 전환

ㄴ 템플릿 등록 후 1년동안 대기 상태(검수요청완료/반려/승인)인 경우

ㄴ 템플릿 정상 상태이나 1년동안 추가 발송이 없는 경우

ㄴ 템플릿이 1년동안 중지 상태인 경우

- 휴면 상태 해제 후 30일간 알림톡 발송 없을 경우 재 휴면 처리

2) 삭제 처리 기준

- '휴면' 상태로 1년 경과 시 템플릿 삭제 처리

- '삭제'된 템플릿은 확인 불가 및 복구 불가 (동일 템플릿코드로 신규 등록 가능)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//release" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [PATCH] 알림톡 템플릿 고객사 관리코드 수정

patch
알림톡 템플릿 고객사 관리코드 수정

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/custom-code

알림톡 템플릿의 고객사 관리코드만 수정합니다. (templateKey 기준)
동일 프로필·서비스모드에서 이미 사용 중인 고객사 관리코드면 중복으로 실패합니다.

요청 속성

Attributes

customTemplateCodestringrequired길이:0~30

고객사 관리 코드

예시

CUST_JOIN_001

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X PATCH "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//custom-code" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"customTemplateCode": "CUST_JOIN_001"
}'

JSON
{
"customTemplateCode": "CUST_JOIN_001"
}

---

## [PATCH] 알림톡 템플릿 노출 여부 수정

patch
알림톡 템플릿 노출 여부 수정

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/show-yn

알림톡 템플릿에 대해 노출 여부를 변경합니다. (Y: 보이기, N: 숨김)

요청 속성

Attributes

showYnstringrequiredenum

노출 여부 (Y: 보이기, N: 숨김)

예시

Y

가능한 enum 값

1
Y

2
N

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X PATCH "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//show-yn" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"showYn": "Y"
}'

JSON
{
"showYn": "Y"
}

---

## [PATCH] 알림톡 템플릿 서비스 유형 수정

patch
알림톡 템플릿 서비스 유형 수정

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}/service-mode

템플릿의 서비스 유형을 수정합니다.
- 서비스 유형이 변경된 템플릿은 자동으로 '사용' 상태로 변경됩니다.
- 변경하려는 템플릿의 서비스 유형이 이미 사용중인 상태인 경우 기존 템플릿은 '미사용' 상태로 변경됩니다.
- 수정 완료 후 발송 서버에 정상적으로 반영되기까지 약 1분의 시간이 소요됩니다.

요청 속성

Attributes

serviceModestringrequiredenum

변경할 서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 응답

templateKeystring

템플릿 고유 키

예시

KEY_JOIN_001

manageNamestring

관리용 이름

예시

회원가입 발송 템플릿_v1

senderKeystring

발신프로필 키

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

A_HM_013_02_02280

customTemplateCodestring

고객사 관리 코드

예시

CUST_JOIN_001

templateNamestring

템플릿명

예시

humuson_2351

templateMessageTypestringenum

템플릿 메시지 유형
- BA: 기본형
- EX: 부가 정보형(templateExtra 필수)
- AD: 채널 추가형(그룹템플릿 사용 불가)
- MI: 복합형(templateExtra 필수, 그룹템플릿 사용 불가)

예시

BA

가능한 enum 값

1
BA

2
EX

3
AD

4
MI

templateEmphasizeTypestringenum

템플릿 강조 유형
- NONE: 사용 안함
- TEXT: 강조 표기형(templateTitle, templateSubtitle 필수)
- IMAGE: 이미지형(templateImageName, templateImageUrl 필수)
- ITEM_LIST: 아이템 리스트형(templateItem.list 또는 templateImage/Header/ItemHighlight 중 1개 이상 필수)

예시

NONE

가능한 enum 값

1
NONE

2
TEXT

3
IMAGE

4
ITEM_LIST

templateContentstring

템플릿 내용

예시

#{name}님 회원가입을 축하합니다.

templatePreviewMessagestring

템플릿 미리보기 메시지

예시

미리보기용 메시지 내용

templateExtrastring

부가 정보

예시

자세한 내용은 홈페이지를 확인해 주세요.

templateAdstring

광고성 메시지

예시

채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기

templateImageNamestring

템플릿 이미지 파일명

예시

welcome.png

templateImageUrlstring

템플릿 이미지 링크

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateTitlestring

템플릿 내용 중 강조 표기할 핵심 정보

예시

회원가입 완료

templateSubtitlestring

템플릿 강조 표기 보조 문구

예시

감사합니다

templateHeaderstring

헤더

예시

안내

templateItemHighlightobject

알림톡 템플릿 아이템 하이라이트

titlestringrequired길이:0~30

타이틀(썸네일 추가 시 21자까지 입력 가능)

예시

아이템 하이라이트 타이틀

descriptionstringrequired길이:0~19

디스크립션 (썸네일 추가 시 13자까지 입력 가능)

예시

아이템 하이라이트 설명

imageUrlstring길이:0~100정규식

썸네일 이미지 주소

예시

https://mud-kage.kakao.com/dn/samplePath/sampleFile/img_l.jpg

templateItemobject

알림톡 템플릿 아이템

listarray<object>required개수:2~10

아이템 리스트

itemsobject

아이템 리스트

titlestringrequired길이:0~6

아이템명

예시

등록일시

descriptionstringrequired길이:0~23

아이템 내용

예시

6월 10일 12:10

summaryobject

아이템 요약 정보

titlestringrequired길이:0~6

요약 타이틀

예시

결제금액

descriptionstringrequired길이:0~14

요약 내용 (화폐단위, 숫자, 쉼표, 마침표, 변수만 사용 가능)

예시

28,000원

templateRepresentLinkobject

대표링크

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

inspectionStatusstringenum

검수 상태
- REG: 요청등록
- REQ: 검수요청
- HREJ: 휴머스온 반려
- KREQ: 카카오 검수요청
- KREJ: 카카오 반려
- APR: 승인완료

예시

APR

가능한 enum 값

1
REG

2
REQ

3
HREJ

4
KREQ

5
KREJ

6
APR

inspectionStatusUpdatestring

검수 상태 변경 일시

예시

2025-02-23 10:00:00

commentstring

검수 코멘트 (의견 또는 문의사항)

예시

해당 템플릿은 이럴 때 사용하는 템플릿입니다.

commentFileNamestring

검수 코멘트 증빙자료 파일명

예시

comment_attach.pdf

rejectReasonstring

반려 사유

예시

템플릿 내용 수정이 필요합니다.

createdAtstring

최초 등록일

예시

2025-02-23 10:00:00

modifiedAtstring

최종 수정일

예시

2025-02-23 10:00:00

statusstringenum

템플릿 상태
- S: 중지
- A: 정상
- R: 대기(발송전)

예시

A

가능한 enum 값

1
S

2
A

3
R

blockboolean

템플릿 차단 여부

예시

false

dormantboolean

템플릿 휴면 여부

예시

false

categoryCodestring

템플릿 카테고리 코드

예시

001001

securityFlagboolean

보안 템플릿 여부

예시

false

serviceModestringenum

서비스 모드 (PRD: 운영, STG: 검수)

예시

PRD

가능한 enum 값

1
PRD

2
STG

useYnstringenum

사용 여부

예시

Y

가능한 enum 값

1
Y

2
N

showYnstringenum

노출 여부

예시

Y

가능한 enum 값

1
Y

2
N

buttonListarray<object>

버튼 정보

itemsobject

알림톡 버튼 정보

namestringrequired길이:0~14

버튼이름

예시

예약 확인하기

typestringrequiredenum

버튼 타입

예시

AL

가능한 enum 값

1
AC

2
WL

3
AL

4
BK

5
MD

6
BC

7
BT

8
DS

9
P1

10
P2

11
P3

12
BF

13
TN

14
MP

url_mobilestring길이:0~500정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com

url_pcstring길이:0~500정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~500

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

plugin_idstring길이:0~24

비즈플러그인 ID

예시

plugin-abc123

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

12345

tel_numberstring길이:0~14

전화번호 (변수 및 숫자, 하이픈 사용 가능. 최대 14자)

예시

1234-5678

quickReplyListarray<object>

바로연결 정보

itemsobject

알림톡 바로연결 정보

namestringrequired길이:0~14

바로연결 명

예시

문의하기

typestringrequiredenum

바로연결 타입
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- BC: 상담톡 전환
- BT: 봇 전환
- BF: 비즈니스 폼 ID

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
BC

5
BT

6
BF

url_mobilestring길이:0~300정규식

mobile 환경에서 이동할 url

예시

https://imc.humuson.com/mobile

url_pcstring길이:0~300정규식

pc 환경에서 이동할 url

예시

https://imc.humuson.com

scheme_androidstring길이:0~300

android 환경에서 실행할 scheme

예시

https://imc.humuson.com

scheme_iosstring길이:0~300

ios 환경에서 실행할 scheme

예시

https://imc.humuson.com

biz_form_idinteger(int32)int32

비즈니스폼 ID

예시

1

alarmPhoneNumberstring

템플릿 검수 알림 수신자 전화번호 (콤마 구분)

예시

01012345678,01087654321

cURL

curl -X PATCH "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template//service-mode" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"serviceMode": "PRD"
}'

JSON
{
"serviceMode": "PRD"
}

---

## [DELETE] 알림톡 템플릿 삭제

delete
알림톡 템플릿 삭제

/kakao-management/api/v1/sender/{senderKey}/alimtalk/template/{templateKey}

알림톡 템플릿을 삭제합니다. (templateKey 기준, DB 삭제)

삭제는 템플릿 상태가 대기(R)이고 검수상태가 등록(REG) 상태에서만 가능합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X DELETE "http://10.147.1.109:28000/kakao-management/api/v1/sender//alimtalk/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

# 발신프로필 관리 API

총 **11개** API

## [POST] 발신프로필 등록

post
발신프로필 등록

/kakao-management/api/v1/sender

발신프로필을 등록합니다.

발신프로필 등록 요청 전에 발신프로필 토큰 요청을 하여 인증번호를 받아야합니다.

요청 속성

Attributes

tokenstringrequired

카카오로부터 수신한 인증번호

예시

797800

phoneNumberstringrequired

카카오 채널 관리자에 등록된 전화번호

예시

01000000000

yellowIdstringrequired

@가 들어간 채널 이름

예시

@휴머스온

categoryCodestringrequired

프로필 카테고리 코드

예시

00100010001

topSenderKeyYnstringenum

대표 발신 프로필 설정 여부

예시

N

가능한 enum 값

1
Y

2
N

customSenderKeystring길이:0~40정규식

고객사 발신프로필 키 (영문 대소문자, 숫자, 특수문자 -, _ 허용 / 공백 불가 / 최대 40자)

예시

CUSTOM_SENDER_KEY_01

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

발신프로필 응답 정보

senderKeystring

발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

uuidstring

@가 들어간 채널 이름

예시

@humuson

namestring

카카오톡 채널 프로필명

예시

주식회사 휴머스온

statusstringenum

발신프로필 상태

예시

A

가능한 enum 값

1
A

2
S

3
D

blockboolean

발신프로필 차단 여부

예시

false

dormantboolean

발신프로필 휴면 여부

예시

false

profileStatusstringenum

카카오톡 채널 상태 (A:activated, C:deactivated, B:block, E:deleting, D:deleted)

예시

A

가능한 enum 값

1
A

2
C

3
B

4
E

5
D

createdAtstring

등록일

예시

2022-12-21 13:00:00

modifiedAtstring

수정일

예시

2022-12-21 13:00:00

categorystring

업종 구분을 위한 대분류 카테고리 코드 (3자리)

예시

001

categoryCodestring

전체 카테고리 코드 (9자리)

예시

001001001

alimtalkboolean

알림톡 사용 여부

예시

true

bizchatboolean

상담톡 사용 여부

예시

true

brandtalkboolean

브랜드톡 사용 여부

예시

false

commitalCompanyNamestring

위탁사 이름 (상담톡 관련)

예시

주식회사 휴머스온

channelKeystring

메시지 전송 결과 수신 채널 키

예시

base

businessProfileboolean

카카오톡 채널 비즈니스 인증 여부

예시

true

businessTypestring

카카오톡 채널 비즈니스 인증 타입

예시

BUSINESS

topSenderKeystring

대표 발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

topSenderKeyYnstringenum

대표 발신프로필 키 설정 여부

예시

N

가능한 enum 값

1
Y

2
N

customSenderKeystring

고객사 발신프로필 키

예시

CUSTOM_SENDER_KEY_01

unsubscribePhoneNumberstring

무료수신거부 전화번호

예시

08085558000

unsubscribeAuthNumberstring

무료수신거부 인증번호

예시

1234567890

brandMessageboolean

브랜드 메시지 타겟팅 M, N 사용 여부

예시

false

marketingAgreeFileUrlstring

광고성 정보 수신 동의 증적자료 파일 링크

예시

https://mud-kage.kakao.com/dn/kb9WQ/dJMb9PM2aJO/1MYKpOdwxeJjKyDLRC1sVK/afile.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"categoryCode": "00100010001",
"phoneNumber": "01000000000",
"token": "797800",
"yellowId": "@휴머스온"
}'

JSON
{
"categoryCode": "00100010001",
"phoneNumber": "01000000000",
"token": "797800",
"yellowId": "@휴머스온"
}

---

## [POST] 발신프로필 브랜드 메시지 타겟팅 M, N 사용 신청

post
발신프로필 브랜드 메시지 타겟팅 M, N 사용 신청

/kakao-management/api/v1/sender/{senderKey}/brand-message

브랜드 메시지 타겟팅 M, N 사용을 신청합니다.

브랜드 메시지 타겟팅 M, N 사용 가능한 조건

- 비즈니스 인증받은 채널

- 등록된 채널 전화번호 존재 (카카오톡 채널 > 프로필 > 채널홈 설정 > 기본 정보 내 대표 전화번호 or 고객센터 전화번호 입력 필요)

- 채널 친구수 5만 이상

- 업로드 된 광고성 정보 수신동의 증적파일 존재

- 3개월 이내 알림톡 발송이력 존재

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [POST] 발신프로필 토큰 요청

post
발신프로필 토큰 요청

/kakao-management/api/v1/sender/token

발신프로필 등록을 위한 인증번호 요청을 합니다.

인증번호는 카카오톡으로 전달됩니다.

phoneNumber는 비즈니스 채널 관리자센터(https://center-pf.kakao.com/) 에 등록된 번호여야 합니다.

요청 속성

Attributes

yellowIdstringrequired

@가 들어간 카카오톡 채널

예시

@humuson

phoneNumberstringrequired

카카오톡 채널 알림받는 관리자 핸드폰 번호

예시

01000000000

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender/token" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"phoneNumber": "01000000000",
"yellowId": "@humuson"
}'

JSON
{
"phoneNumber": "01000000000",
"yellowId": "@humuson"
}

---

## [GET] 발신프로필 목록 조회

get
발신프로필 목록 조회

/kakao-management/api/v1/sender

검색 조건에 따른 발신프로필 목록을 조회합니다.

검색 조건(프로필명, 플러스친구 상태, 발신프로필키, 프로필 상태, uuid, 고객사발신프로필키, 차단/휴면/알림톡/브랜드메시지 사용여부, 업종 구분 코드)은 모두 선택이며, page/size로 페이지네이션합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

namestring길이:0~128

프로필명

예시

주식회사 휴머스온

profileStatusstringenum

플러스친구 상태 (A:activated, C:deactivated, B:block, E:deleting, D:deleted)

예시

A

가능한 enum 값

1
A

2
C

3
B

4
E

5
D

senderKeystring길이:0~40

발신프로필키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

statusstringenum

프로필 상태 (A:정상, S, D:삭제)

예시

A

가능한 enum 값

1
A

2
S

3
D

uuidstring길이:0~40

플러스친구아이디 (uuid)

예시

@humuson

customSenderKeystring길이:0~40

고객사발신프로필키

예시

CUSTOM_SENDER_KEY_01

blockboolean

차단여부

예시

false

dormantboolean

휴면여부

예시

false

alimtalkboolean

알림톡 사용여부

예시

true

brandMessageboolean

브랜드메시지 사용여부

예시

false

categorystring길이:0~9

업종 구분 코드

예시

001

categoryCodestring길이:0~11

카테고리 코드

예시

00100010001

pageinteger(int32)int32범위:0~

페이지 번호 (0부터)

예시

0

sizeinteger(int32)int32범위:1~100

페이지 크기

예시

20

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

발신프로필 목록 조회 응답

totalinteger(int64)int64

전체 개수

예시

100

hasNextboolean

다음 페이지 존재 여부

예시

true

listarray<object>

발신프로필 목록

itemsobject

발신프로필 응답 정보

senderKeystring

발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

uuidstring

@가 들어간 채널 이름

예시

@humuson

namestring

카카오톡 채널 프로필명

예시

주식회사 휴머스온

statusstringenum

발신프로필 상태

예시

A

가능한 enum 값

1
A

2
S

3
D

blockboolean

발신프로필 차단 여부

예시

false

dormantboolean

발신프로필 휴면 여부

예시

false

profileStatusstringenum

카카오톡 채널 상태 (A:activated, C:deactivated, B:block, E:deleting, D:deleted)

예시

A

가능한 enum 값

1
A

2
C

3
B

4
E

5
D

createdAtstring

등록일

예시

2022-12-21 13:00:00

modifiedAtstring

수정일

예시

2022-12-21 13:00:00

categorystring

업종 구분을 위한 대분류 카테고리 코드 (3자리)

예시

001

categoryCodestring

전체 카테고리 코드 (9자리)

예시

001001001

alimtalkboolean

알림톡 사용 여부

예시

true

bizchatboolean

상담톡 사용 여부

예시

true

brandtalkboolean

브랜드톡 사용 여부

예시

false

commitalCompanyNamestring

위탁사 이름 (상담톡 관련)

예시

주식회사 휴머스온

channelKeystring

메시지 전송 결과 수신 채널 키

예시

base

businessProfileboolean

카카오톡 채널 비즈니스 인증 여부

예시

true

businessTypestring

카카오톡 채널 비즈니스 인증 타입

예시

BUSINESS

topSenderKeystring

대표 발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

topSenderKeyYnstringenum

대표 발신프로필 키 설정 여부

예시

N

가능한 enum 값

1
Y

2
N

customSenderKeystring

고객사 발신프로필 키

예시

CUSTOM_SENDER_KEY_01

unsubscribePhoneNumberstring

무료수신거부 전화번호

예시

08085558000

unsubscribeAuthNumberstring

무료수신거부 인증번호

예시

1234567890

brandMessageboolean

브랜드 메시지 타겟팅 M, N 사용 여부

예시

false

marketingAgreeFileUrlstring

광고성 정보 수신 동의 증적자료 파일 링크

예시

https://mud-kage.kakao.com/dn/kb9WQ/dJMb9PM2aJO/1MYKpOdwxeJjKyDLRC1sVK/afile.jpg

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 발신프로필 브랜드 메시지 타겟팅 M, N 사용 가능 여부 확인

get
발신프로필 브랜드 메시지 타겟팅 M, N 사용 가능 여부 확인

/kakao-management/api/v1/sender/{senderKey}/brand-message/check

브랜드 메시지 타겟팅 M, N 사용 신청 전 발신프로필이 조건을 만족하는지 확인합니다.

브랜드 메시지 타겟팅 M, N 사용 가능한 조건

- 비즈니스 인증받은 채널

- 등록된 채널 전화번호 존재 (카카오톡 채널 > 프로필 > 채널홈 설정 > 기본 정보 내 대표 전화번호 or 고객센터 전화번호 입력 필요)

- 채널 친구수 5만 이상

- 업로드 된 광고성 정보 수신동의 증적파일 존재

- 3개월 이내 알림톡 발송이력 존재

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/check" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 발신프로필 조회

get
발신프로필 조회

/kakao-management/api/v1/sender/{senderKey}

발신프로필 등록시 응답으로 받은 발신프로필 키(senderKey)로 등록된 발신프로필을 조회합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

발신프로필 응답 정보

senderKeystring

발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

uuidstring

@가 들어간 채널 이름

예시

@humuson

namestring

카카오톡 채널 프로필명

예시

주식회사 휴머스온

statusstringenum

발신프로필 상태

예시

A

가능한 enum 값

1
A

2
S

3
D

blockboolean

발신프로필 차단 여부

예시

false

dormantboolean

발신프로필 휴면 여부

예시

false

profileStatusstringenum

카카오톡 채널 상태 (A:activated, C:deactivated, B:block, E:deleting, D:deleted)

예시

A

가능한 enum 값

1
A

2
C

3
B

4
E

5
D

createdAtstring

등록일

예시

2022-12-21 13:00:00

modifiedAtstring

수정일

예시

2022-12-21 13:00:00

categorystring

업종 구분을 위한 대분류 카테고리 코드 (3자리)

예시

001

categoryCodestring

전체 카테고리 코드 (9자리)

예시

001001001

alimtalkboolean

알림톡 사용 여부

예시

true

bizchatboolean

상담톡 사용 여부

예시

true

brandtalkboolean

브랜드톡 사용 여부

예시

false

commitalCompanyNamestring

위탁사 이름 (상담톡 관련)

예시

주식회사 휴머스온

channelKeystring

메시지 전송 결과 수신 채널 키

예시

base

businessProfileboolean

카카오톡 채널 비즈니스 인증 여부

예시

true

businessTypestring

카카오톡 채널 비즈니스 인증 타입

예시

BUSINESS

topSenderKeystring

대표 발신프로필 키

예시

53667f0fd914f1c31f4d2569aa631413a5ae9e21

topSenderKeyYnstringenum

대표 발신프로필 키 설정 여부

예시

N

가능한 enum 값

1
Y

2
N

customSenderKeystring

고객사 발신프로필 키

예시

CUSTOM_SENDER_KEY_01

unsubscribePhoneNumberstring

무료수신거부 전화번호

예시

08085558000

unsubscribeAuthNumberstring

무료수신거부 인증번호

예시

1234567890

brandMessageboolean

브랜드 메시지 타겟팅 M, N 사용 여부

예시

false

marketingAgreeFileUrlstring

광고성 정보 수신 동의 증적자료 파일 링크

예시

https://mud-kage.kakao.com/dn/kb9WQ/dJMb9PM2aJO/1MYKpOdwxeJjKyDLRC1sVK/afile.jpg

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 발신프로필 카테고리 전체 조회

get
발신프로필 카테고리 전체 조회

/kakao-management/api/v1/sender/category

발신프로필 등록에 필요한 카테고리를 전체 조회합니다.

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

카카오 센터 발신프로필 카테고리 전체 응답

codeinteger(int32)int32

카카오 센터 응답 코드

예시

200

messagestring

카카오 센터 응답 메시지

예시

요청 처리에 성공하였습니다.

dataarray<object>

전체 카테고리 flat 목록

itemsobject

프로필 카테고리 정보

codestring

프로필 카테고리 코드

예시

0010010001

namestring

프로필 카테고리 이름

예시

건강,병원,종합병원

mainarray<object>

대분류-중분류-소분류 트리 구조

itemsobject

발신프로필 카테고리 대분류 정보

codestring

대분류 코드

예시

001

namestring

대분류명

예시

건강

middlearray<object>

중분류 목록

itemsobject

발신프로필 카테고리 중분류 정보

codestring

중분류 코드

예시

0001

namestring

중분류명

예시

병원

smallarray<object>

소분류 목록

itemsobject

발신프로필 카테고리 소분류 정보

codestring

소분류 코드

예시

00100010001

namestring

소분류명

예시

종합병원

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender/category" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 발신프로필 카테고리 조회

get
발신프로필 카테고리 조회

/kakao-management/api/v1/sender/category/{categoryCode}

발신프로필 등록에 필요한 카테고리를 조회합니다.

categoryCode는 11자리 카테고리 코드입니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

카카오 센터 발신프로필 카테고리 전체 응답

codeinteger(int32)int32

카카오 센터 응답 코드

예시

200

messagestring

카카오 센터 응답 메시지

예시

요청 처리에 성공하였습니다.

dataarray<object>

전체 카테고리 flat 목록

itemsobject

프로필 카테고리 정보

codestring

프로필 카테고리 코드

예시

0010010001

namestring

프로필 카테고리 이름

예시

건강,병원,종합병원

mainarray<object>

대분류-중분류-소분류 트리 구조

itemsobject

발신프로필 카테고리 대분류 정보

codestring

대분류 코드

예시

001

namestring

대분류명

예시

건강

middlearray<object>

중분류 목록

itemsobject

발신프로필 카테고리 중분류 정보

codestring

중분류 코드

예시

0001

namestring

중분류명

예시

병원

smallarray<object>

소분류 목록

itemsobject

발신프로필 카테고리 소분류 정보

codestring

소분류 코드

예시

00100010001

namestring

소분류명

예시

종합병원

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender/category/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [PUT] 고객사 발신프로필 키 수정

put
고객사 발신프로필 키 수정

/kakao-management/api/v1/sender/{senderKey}/custom-sender-key

발신프로필의 고객사 발신프로필 키(customSenderKey)를 수정합니다.

[입력 규칙]

- 영문 대소문자, 숫자, 특수문자( - _ )만 허용됩니다.

- 공백은 허용되지 않습니다.

- 최대 40자까지 입력 가능합니다.

[중복 제한]

- 동일 고객사(userId) 내에서 customSenderKey는 중복될 수 없습니다.

- 다른 고객사와는 동일한 값을 사용할 수 있습니다.

요청 속성

Attributes

customSenderKeystringrequired길이:0~40정규식

고객사 발신프로필 키 (영문 대소문자, 숫자, 특수문자 -, _ 허용 / 공백 불가 / 최대 40자)

예시

CUSTOM_SENDER_KEY_01

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//custom-sender-key" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"customSenderKey": "CUSTOM_SENDER_KEY_01"
}'

JSON
{
"customSenderKey": "CUSTOM_SENDER_KEY_01"
}

---

## [PUT] 발신프로필 무료수신거부 정보 입력

put
발신프로필 무료수신거부 정보 입력

/kakao-management/api/v1/sender/{senderKey}/unsubscribe

브랜드 메시지 발송시 사용되는 080 무료수신거부 정보를 입력 및 수정합니다.

무료수신거부 정보는 톡채널 단위로 저장되므로 변경시 동일 톡채널의 타딜러사의 발신프로필에 일괄 적용됩니다.

요청 속성

Attributes

unsubscribePhoneNumberstringrequired길이:0~13

080 무료수신거부 전화번호

예시

080-1234-1234

unsubscribeAuthNumberstringrequired길이:0~10

080 무료수신거부 인증번호

예시

1234

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//unsubscribe" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"unsubscribeAuthNumber": "1234",
"unsubscribePhoneNumber": "080-1234-1234"
}'

JSON
{
"unsubscribeAuthNumber": "1234",
"unsubscribePhoneNumber": "080-1234-1234"
}

---

## [PUT] 발신프로필 휴면 해제

put
발신프로필 휴면 해제

/kakao-management/api/v1/sender/{senderKey}/release

장기 미사용으로 휴면처리된 발신프로필을 휴면해제 합니다.

1) 휴면 상태 변경 기준

- 발신 프로필에서 1년 간 알림톡 발송이 없을 경우 '휴면' 상태로 전환

- 휴면 상태 해제 후 30일간 알림톡 발송 이력이 없을 경우 재 휴면 처리

2) 삭제 처리 기준

- '휴면' 상태로 1년 경과 시 발신프로필키 삭제 처리

- '삭제'된 기존 발신프로필키는 확인 불가 및 복구 불가 (신규 등록은 가능)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//release" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

# 이미지 업로드 API

총 **9개** API

## [POST] 브랜드 메시지 광고성 정보 수신동의 증적자료 파일 업로드

post
브랜드 메시지 광고성 정보 수신동의 증적자료 파일 업로드

/kakao-management/api/v1/attach/marketing-agree/{senderKey}

브랜드 메시지 사용 신청을 위한 광고성 정보 수신동의 증적자료 파일을 업로드합니다.
- 광고성 정보 수신동의 증적자료 파일은 톡채널 단위로 저장되므로 변경시 동일 톡채널의 타딜러사의 발신프로필에 일괄 적용됩니다.
- 타딜러사에서 업로드한 파일이 이미 존재하는 경우 파일 업로드 과정을 생략하고 브랜드 메시지 사용 신청이 가능합니다.

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/marketing-agree/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

---

## [POST] 브랜드 메시지 템플릿 기본 이미지 업로드

post
브랜드 메시지 템플릿 기본 이미지 업로드

/kakao-management/api/v1/attach/brand-message/default

메시지 타입이 이미지, 커머스, 프리미엄 동영상인 브랜드 메시지에서 사용하는 이미지를 업로드 합니다.
- 권장 사이즈: 800 X 400px (가로 500px 이상)
- 이미지 비율: 0.5 ≤ 세로 ÷ 가로 ≤ 1.333
- 파일 형식 및 용량 제한: jpg, png / 최대 5MB

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/default" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

image필수

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 브랜드 메시지 템플릿 와이드 리스트 이미지 업로드

post
브랜드 메시지 템플릿 와이드 리스트 이미지 업로드

/kakao-management/api/v1/attach/brand-message/wide-list

메시지 타입이 와이드 리스트인 브랜드 메시지에서 사용하는 2~4번째 리스트 이미지를 업로드 합니다.
아이템 리스트 갯수에 맞춰 최소 1개 ~ 최대 3개 까지 업로드 합니다.
- 제한 사이즈: 가로 500px 이상
- 이미지 비율: 세로 ÷ 가로 = 1
- 파일형식 및 크기 : jpg, png / 각 파일 최대 5MB

요청 속성

Attributes

imagesarray<string(binary)>required개수:0~11

업로드 이미지 binary 목록
- 와이드 리스트: 최대 3개 업로드 가능
- 캐러셀 피드: 최대 10개 업로드 가능
- 캐러셀 커머스: 최대 11개 업로드 가능

itemsstring(binary)binary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

overallStatusstringenum

-

가능한 enum 값

1
SUCCESS

2
PARTIAL_SUCCESS

3
FAILURE

codestring

-

messagestring

-

successarray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

imageUrlstring

-

failurearray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

errorCodestring

-

errorMessagestring

-

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/wide-list" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

images필수multiple

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 브랜드 메시지 템플릿 와이드 리스트 첫번째 이미지 업로드

post
브랜드 메시지 템플릿 와이드 리스트 첫번째 이미지 업로드

/kakao-management/api/v1/attach/brand-message/wide-list/first

메시지 타입이 와이드 리스트인 브랜드 메시지에서 사용하는 1번째 리스트 이미지를 업로드 합니다.
- 제한 사이즈: 가로 500px 이상
- 이미지 비율: 세로 ÷ 가로 = 0.5
- 파일 형식 및 용량 제한: jpg, png / 최대 5MB

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/wide-list/first" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

image필수

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 브랜드 메시지 템플릿 와이드 이미지 업로드

post
브랜드 메시지 템플릿 와이드 이미지 업로드

/kakao-management/api/v1/attach/brand-message/wide

메시지 타입이 와이드 이미지인 브랜드 메시지에서 사용하는 이미지를 업로드 합니다.
- 권장 사이즈: 800 X 600px (가로 500px 이상)
- 이미지 비율: 0.5 ≤ 세로 ÷ 가로 ≤ 1
- 파일 형식 및 용량 제한: jpg, png / 최대 5MB

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/wide" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

image필수

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 브랜드 메시지 템플릿 캐러셀 커머스 이미지 업로드

post
브랜드 메시지 템플릿 캐러셀 커머스 이미지 업로드

/kakao-management/api/v1/attach/brand-message/carousel-commerce

메시지 타입이 캐러셀 커머스인 브랜드 메시지에서 사용하는 이미지를 업로드 합니다.
캐러셀 인트로 + 캐러셀 리스트 갯수에 맞춰 최소 1개 ~ 최대 11개 까지 업로드 합니다.
- 권장 사이즈: 800 X 600px 또는 800 X 400px (가로 500px 이상)
- 이미지 비율: 0.5 ≤ 세로 ÷ 가로 ≤ 1.333 (전체 이미지 비율이 동일)
- 파일 형식 및 용량 제한: jpg, png / 최대 5MB

요청 속성

Attributes

imagesarray<string(binary)>required개수:0~11

업로드 이미지 binary 목록
- 와이드 리스트: 최대 3개 업로드 가능
- 캐러셀 피드: 최대 10개 업로드 가능
- 캐러셀 커머스: 최대 11개 업로드 가능

itemsstring(binary)binary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

overallStatusstringenum

-

가능한 enum 값

1
SUCCESS

2
PARTIAL_SUCCESS

3
FAILURE

codestring

-

messagestring

-

successarray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

imageUrlstring

-

failurearray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

errorCodestring

-

errorMessagestring

-

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/carousel-commerce" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

images필수multiple

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 브랜드 메시지 템플릿 캐러셀 피드 이미지 업로드

post
브랜드 메시지 템플릿 캐러셀 피드 이미지 업로드

/kakao-management/api/v1/attach/brand-message/carousel-feed

메시지 타입이 캐러셀 피드인 브랜드 메시지에서 사용하는 이미지를 업로드 합니다.
캐러셀 리스트 갯수에 맞춰 최소 1개 ~ 최대 10개 까지 업로드 합니다.
- 권장 사이즈: 800 X 600px 또는 800 X 400px (가로 500px 이상)
- 이미지 비율: 0.5 ≤ 세로 ÷ 가로 ≤ 1.333
- 파일 형식 및 용량 제한: jpg, png / 최대 5MB

요청 속성

Attributes

imagesarray<string(binary)>required개수:0~11

업로드 이미지 binary 목록
- 와이드 리스트: 최대 3개 업로드 가능
- 캐러셀 피드: 최대 10개 업로드 가능
- 캐러셀 커머스: 최대 11개 업로드 가능

itemsstring(binary)binary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

overallStatusstringenum

-

가능한 enum 값

1
SUCCESS

2
PARTIAL_SUCCESS

3
FAILURE

codestring

-

messagestring

-

successarray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

imageUrlstring

-

failurearray<object>

-

itemsobject

-

indexinteger(int32)int32

-

formFieldstring

-

errorCodestring

-

errorMessagestring

-

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/brand-message/carousel-feed" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

images필수multiple

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 알림톡 템플릿 등록용 이미지 업로드

post
알림톡 템플릿 등록용 이미지 업로드

/kakao-management/api/v1/attach/alimtalk/template

강조 타입이 이미지형 또는 아이템리스트형인 알림톡 템플릿 등록 시 사용하는 이미지를 업로드 합니다.
권장 사이즈: 800 X 400px (가로 500px 이상)
이미지 비율: 세로 ÷ 가로 = 0.5
파일 형식 및 용량 제한: jpg, png / 최대 500KB

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/alimtalk/template" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

image필수

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

## [POST] 알림톡 템플릿 하이라이트 이미지 업로드

post
알림톡 템플릿 하이라이트 이미지 업로드

/kakao-management/api/v1/attach/alimtalk/item-highlight

강조 타입이 이미지형 또는 아이템리스트형인 알림톡 템플릿 등록 시 사용하는 아이템 하이라이트 이미지를 업로드 합니다.
제한 사이즈: 108 X 108px 이상
이미지 비율: 세로 ÷ 가로 = 1
파일 형식 및 용량 제한: jpg, png / 최대 500KB

요청 속성

Attributes

imagestring(binary)requiredbinary

-

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

이미지 업로드 응답 정보

imagestring

업로드된 이미지 URL

예시

https://mud-kage.kakao.com/dn/cnFH42/btqYhcvS9FC/72B9eTd861GJs4mILx98b0/img_l.jpg

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/attach/alimtalk/item-highlight" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: multipart/form-data" \

multipart/form-data

image필수

⭳
Drag files to upload

또는 클릭해서 파일 선택

업로드 목록

선택된 파일이 없습니다.

---

# 브랜드메시지 템플릿 관리 API

총 **9개** API

## [POST] 브랜드메시지 템플릿 등록

post
브랜드메시지 템플릿 등록

/kakao-management/api/v1/sender/{senderKey}/brand-message/template

브랜드메시지 기본형에 사용하는 템플릿을 신규 등록합니다.사전에 발신프로필이 등록 되어있어야 합니다.등록한 템플릿은 검수 프로세스 없이 등록 후 바로 사용 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다.(단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
최대 20개의 변수명 입력 가능합니다. (중복 제외)

[공통 필수 값]
chatBubbleType , manageName
[공통 사용 가능 값]
templateKey (미입력시 서버가 자동발급) , adult, buttons, coupon , customTemplateCode

[chatBubbleType별 사용 가능 파라미터]
TEXT
[필수 파라미터]
content

IMAGE
[사용 가능 파라미터]
attachment.image.imgLink , attachment.image.imgUrl , content
[필수 파라미터]
content, attachment.image.imgUrl

WIDE
[사용 가능 파라미터]
content, attachment.image.imgLink , attachment.image.imgUrl
[필수 파라미터]
content, attachment.image.imgUrl

WIDE_ITEM_LIST
[필수 파라미터]
header, attachment.item.list

CAROUSEL_FEED
[사용 가능 파라미터]
carousel.list, carousel.tail
[필수 파라미터]
carousel.list

PREMIUM_VIDEO
[사용 가능 파라미터]
header, content, attachment.video
[필수 파라미터]
attachment.video

COMMERCE
[사용 가능 파라미터]
additionalContent, attachment.image.imgLink , attachment.image.imgUrl, attachment.commerce
[필수 파라미터]
attachment.image.imgUrl, attachment.commerce

CAROUSEL_COMMERCE
[사용 가능 파라미터]
carousel.head, carousel.list, carousel.tail
[필수 파라미터]
carousel.list

요청 속성

Attributes

templateKeystring길이:0~20

템플릿 요청 고유 Key (선택, 미입력시 서버가 자동발급)

예시

TEMPLATE_KEY_001

customTemplateCodestring길이:0~30

고객사 템플릿 관리코드

예시

CUSTOM_CODE_0001

manageNamestringrequired길이:0~30

고객사 템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringrequiredenum

브랜드 메시지 타입
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인용 메시지 여부
- Y: 성인용 메시지
- N: 모든 연령 메시지 (기본값)

예시

N

headerstring길이:0~20

템플릿 헤더
header 필드 필수
- 와이드 리스트형: 최대 20자 (줄바꿈: 불가)

header 필드 선택
- 프리미엄 동영상형: 최대 20자 (줄바꿈: 불가)

예시

와이드 리스트형 헤더

contentstring길이:0~1300

템플릿 내용
content 필드 필수
- 텍스트형: 최대 1,300자 (줄바꿈: 최대 99개, URL 형식 입력 가능)
- 이미지형: 최대 400자 (줄바꿈: 최대 29개, URL 형식 입력 가능)
- 와이드형: 최대 76자 (줄바꿈: 최대 1개)

content 필드 선택
- 프리미엄 동영상형: 최대 76자 (줄바꿈: 최대 1개)

content 필드 사용안함
- 와이드 리스트형
- 캐러셀 피드형
- 커머스형
- 캐러셀 커머스형

예시

홍길동님 회원가입을 축하합니다.

additionalContentstring길이:0~34

템플릿 부가정보
- 커머스형: 최대 34자 (줄바꿈: 최대 1개)- 그 외 사용 안함

예시

커머스형 부가정보

attachmentobject

메시지에 첨부할 내용

buttonarray<object>

버튼 정보 리스트
TEXT, IMAGE - Coupon을 적용할 경우 최대 4개, 그 외 최대 5개
WIDE, WIDE_ITEM_LIST - 최대 2개
PREMIUM_VIDEO - 최대 1개
COMMERCE - 최소 1개, 최대 2개

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

itemobject

브랜드메시지 와이드 리스트 아이템 정보 (최소 3개 , 최대 4개까지 가능)

listarray<object>

브랜드메시지 와이드리스트 요소 정보

itemsobject

브랜드메시지 와이드리스트 요소 정보

titlestring

아이템 제목
mainWideItem - 최대 25자 (줄바꿈: 최대 1개)
subWideItemList - 최대 30자 (줄바꿈: 최대 1개)

예시

와이드리스트 아이템 제목

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

videoobject

브랜드메시지 동영상 요소

video_urlstring길이:0~500

카카오TV 동영상 URL

예시

https://tv.kakao.com/channel/1506/cliplink/461781816

thumbnail_urlstring길이:0~500

브랜드메시지 이미지 업로드 API 로 등록한 동영상 썸네일용 이미지 URL
(기본값 : 동영상 기본 썸네일 이미지)

예시

https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

headobject

캐러셀 인트로
CAROUSEL_COMMERCE인 경우 사용

headerstring길이:0~20

케러셀 인트로 헤더 (최대 20자 (줄바꿈:불가))

예시

케러셀 인트로 헤더

contentstring길이:0~50

캐러셀 인트로 내용 (최대 50자 (줄바꿈: 최대 2개))

예시

캐러셀 인트로 본문 내용입니다.

image_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 캐러셀 인트로 이미지 URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 캐러셀 인트로 클릭 시 이동할 URL
urlMobile 필수 : 링크를 하나라도 입력하는 경우

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 캐러셀 인트로 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

listarray<object>

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

itemsobject

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

headerstring길이:0~20

캐러셀 리스트 헤더 (최대 20자 (줄바꿈: 불가))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 헤더

attachmentobject

캐러셀 리스트 이미지,커머스, 버튼, 쿠폰 요소 정보

buttonarray<object>

캐러셀 리스트 버튼 정보 (캐러셀당 최소 1개, 최대 2개)

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

contentstring길이:0~180

캐러셀 리스트 내용 (최대 180자 (줄바꿈: 최대 10개))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 내용

additional_contentstring길이:0~340

캐러셀 리스트 부가 정보 (최대 34자 (줄바꿈: 최대 1개))
CAROUSEL_COMMERCE인 경우 사용

예시

캐러셀 리스트 부가 정보

tailobject

더보기 버튼

url_mobilestring길이:0~500

MOBILE 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE iOS 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

scheme_iosstring길이:0~500

MOBILE Android 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 응답

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateKeystring

템플릿 고유 요청 키

예시

KEY_JOIN_001

templateCodestring

템플릿 코드

예시

6a2710675148b8be2cd25b2935gcf01783cfb169

customTemplateCodestring

고객사 템플릿 코드

예시

CUST_JOIN_001

templateNamestring

템플릿 이름

예시

humuson_2351

manageNamestring

템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringenum

브랜드메시지 ChatBubbleType

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인 여부

예시

Y

headerstring

헤더

예시

헤더내용

contentstring

템플릿 내용

예시

#{name}님 안녕하세요. 휴머스온입니다.

additionalContentstring

부가 정보

attachmentobject

메시지에 첨부할 내용

buttonarray<object>

버튼 정보 리스트
TEXT, IMAGE - Coupon을 적용할 경우 최대 4개, 그 외 최대 5개
WIDE, WIDE_ITEM_LIST - 최대 2개
PREMIUM_VIDEO - 최대 1개
COMMERCE - 최소 1개, 최대 2개

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

itemobject

브랜드메시지 와이드 리스트 아이템 정보 (최소 3개 , 최대 4개까지 가능)

listarray<object>

브랜드메시지 와이드리스트 요소 정보

itemsobject

브랜드메시지 와이드리스트 요소 정보

titlestring

아이템 제목
mainWideItem - 최대 25자 (줄바꿈: 최대 1개)
subWideItemList - 최대 30자 (줄바꿈: 최대 1개)

예시

와이드리스트 아이템 제목

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

videoobject

브랜드메시지 동영상 요소

video_urlstring길이:0~500

카카오TV 동영상 URL

예시

https://tv.kakao.com/channel/1506/cliplink/461781816

thumbnail_urlstring길이:0~500

브랜드메시지 이미지 업로드 API 로 등록한 동영상 썸네일용 이미지 URL
(기본값 : 동영상 기본 썸네일 이미지)

예시

https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

headobject

캐러셀 인트로
CAROUSEL_COMMERCE인 경우 사용

headerstring길이:0~20

케러셀 인트로 헤더 (최대 20자 (줄바꿈:불가))

예시

케러셀 인트로 헤더

contentstring길이:0~50

캐러셀 인트로 내용 (최대 50자 (줄바꿈: 최대 2개))

예시

캐러셀 인트로 본문 내용입니다.

image_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 캐러셀 인트로 이미지 URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 캐러셀 인트로 클릭 시 이동할 URL
urlMobile 필수 : 링크를 하나라도 입력하는 경우

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 캐러셀 인트로 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

listarray<object>

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

itemsobject

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

headerstring길이:0~20

캐러셀 리스트 헤더 (최대 20자 (줄바꿈: 불가))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 헤더

attachmentobject

캐러셀 리스트 이미지,커머스, 버튼, 쿠폰 요소 정보

buttonarray<object>

캐러셀 리스트 버튼 정보 (캐러셀당 최소 1개, 최대 2개)

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

contentstring길이:0~180

캐러셀 리스트 내용 (최대 180자 (줄바꿈: 최대 10개))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 내용

additional_contentstring길이:0~340

캐러셀 리스트 부가 정보 (최대 34자 (줄바꿈: 최대 1개))
CAROUSEL_COMMERCE인 경우 사용

예시

캐러셀 리스트 부가 정보

tailobject

더보기 버튼

url_mobilestring길이:0~500

MOBILE 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE iOS 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

scheme_iosstring길이:0~500

MOBILE Android 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

statusstringenum

템플릿 상태

가능한 enum 값

1
S

2
A

createdAtstring

등록일

modifiedAtstring

수정일

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"chatBubbleType": "TEXT",
"manageName": "회원가입 발송 템플릿_v1",
"templateKey": "TEMPLATE_KEY_001",
"customTemplateCode": "CUSTOM_CODE_0001",
"adult": "N",
"header": "와이드 리스트형 헤더",
"content": "홍길동님 회원가입을 축하합니다.",
"additionalContent": "커머스형 부가정보",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"item": {
"list": [
{
"title": "와이드리스트 아이템 제목",
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
]
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
},
"video": {
"video_url": "https://tv.kakao.com/channel/1506/cliplink/461781816",
"thumbnail_url": "https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg"
}
},
"carousel": {
"head": {
"header": "케러셀 인트로 헤더",
"content": "캐러셀 인트로 본문 내용입니다.",
"image_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"list": [
{
"header": "캐러셀 리스트 헤더",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
}
},
"content": "캐러셀 리스트 내용",
"additional_content": "캐러셀 리스트 부가 정보"
}
],
"tail": {
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com\"",
"scheme_ios": "scheme://humuson.com\""
}
}
}'

JSON
{
"chatBubbleType": "TEXT",
"manageName": "회원가입 발송 템플릿_v1",
"templateKey": "TEMPLATE_KEY_001",
"customTemplateCode": "CUSTOM_CODE_0001",
"adult": "N",
"header": "와이드 리스트형 헤더",
"content": "홍길동님 회원가입을 축하합니다.",
"additionalContent": "커머스형 부가정보",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"item": {
"list": [
{
"title": "와이드리스트 아이템 제목",
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
]
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
},
"video": {
"video_url": "https://tv.kakao.com/channel/1506/cliplink/461781816",
"thumbnail_url": "https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg"
}
},
"carousel": {
"head": {
"header": "케러셀 인트로 헤더",
"content": "캐러셀 인트로 본문 내용입니다.",
"image_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"list": [
{
"header": "캐러셀 리스트 헤더",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
}
},
"content": "캐러셀 리스트 내용",
"additional_content": "캐러셀 리스트 부가 정보"
}
],
"tail": {
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com\"",
"scheme_ios": "scheme://humuson.com\""
}
}
}

---

## [POST] 브랜드메시지 템플릿 키 자동발급

post
브랜드메시지 템플릿 키 자동발급

/kakao-management/api/v1/brand-message/template/key

브랜드메시지 템플릿 등록 전에 사용할 templateKey를 선발급합니다.
등록 API 호출 시 templateKey 필드를 비워두면 서버가 자동 발급해주므로 이 API는 선택 사용입니다.
발급 포맷: BT + yyMMddHHmmss + 랜덤 4자 (최대 20자).

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 키 자동발급 응답

templateKeystring

자동발급된 템플릿 키

예시

BT260423153045A1B2

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/brand-message/template/key" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [GET] 브랜드메시지 템플릿 개수 조회

get
브랜드메시지 템플릿 개수 조회

/kakao-management/api/v1/brand-message/template/count

검색 조건으로 브랜드메시지 템플릿 개수를 조회합니다.목록 조회 API와 동일한 필터를 지원합니다.

[검색 조건 요약] (목록 조회와 동일)
- 식별자:
senderKey
,
templateCode
,
customTemplateCode

- 템플릿 정보(LIKE):
manageName
,
templateName
,
templateContent

- 분류/상태:
chatBubbleType[]
,
status[]
,
adult

- 기간:
dateType
(CREATE_AT/MODIFIED_AT) +
startDate
/
endDate
(YYYY-MM-DD)
- 구성요소 유무:
hasButton
,
hasCarousel
,
hasCarouselHead
,
hasCarouselTail
,
hasImage
,
hasItem
,
hasCoupon
,
hasCommerce
,
hasVideo
,
hasHeader
,
hasAdditionalContent

- 버튼 타입:
buttonTypes[]
,
carouselButtonTypes[]

- 키워드 검색:
searchType
+
searchKeyword

[groupBy 미지정]
- total(전체 개수)만 반환합니다.

[groupBy 지정]
- total과 함께 해당 항목별 개수(counts)를 반환합니다.
- counts의 키는 각 항목의 값(문자열)이며, 해당 값이 null인 레코드는 제외됩니다.
- 예) CHAT_BUBBLE_TYPE → {"TEXT": 800, "IMAGE": 300, "CAROUSEL_FEED": 200, ...}
- 예) STATUS → {"A": 1480, "S": 20}
- 예) ADULT → {"Y": 50, "N": 1450}

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

1234567890abcdef1234567890abcdef12345678

customTemplateCodestring

고객사 템플릿 관리코드

예시

CUSTOM_CODE_0001

templateNamestring

템플릿명 (LIKE)

예시

검색할 템플릿명

manageNamestring

고객사 템플릿 관리명 (LIKE)

예시

검색할 템플릿 관리명

templateContentstring

템플릿 내용 (LIKE)

예시

검색할 템플릿 내용

chatBubbleTypearray<string>

브랜드 메시지 타입 (다중 선택)
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT,IMAGE

itemsstringenum

브랜드 메시지 타입 (다중 선택)
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT,IMAGE

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

statusarray<string>

템플릿 상태 (A: 정상, S: 차단). 다중 선택

예시

A

itemsstringenum

템플릿 상태 (A: 정상, S: 차단). 다중 선택

예시

A

가능한 enum 값

1
S

2
A

adultstring

성인용 메시지 여부 (Y/N)

예시

N

dateTypestringenum

기간 조회 대상
- CREATE_AT: 등록일(created_date)
- MODIFIED_AT: 수정일(last_modified_date)

예시

CREATE_AT

가능한 enum 값

1
CREATE_AT

2
MODIFIED_AT

startDatestring

조회 시작일(YYYY-MM-DD) — dateType이 가리키는 컬럼 기준

예시

2026-01-01

endDatestring

조회 종료일(YYYY-MM-DD) — dateType이 가리키는 컬럼 기준

예시

2026-12-31

hasButtonboolean

본문 버튼 보유 여부 (true: 있음, false: 없음). attachment.button[*]

예시

true

hasCarouselboolean

캐러셀 보유 여부. carousel.list[*]

예시

true

hasCarouselHeadboolean

캐러셀 인트로 보유 여부. carousel.head

예시

true

hasCarouselTailboolean

캐러셀 더보기 보유 여부. carousel.tail

예시

true

hasImageboolean

본문 이미지 보유 여부. attachment.image

예시

true

hasItemboolean

와이드리스트 아이템 보유 여부. attachment.item.list[*]

예시

true

hasCouponboolean

쿠폰 보유 여부. attachment.coupon

예시

true

hasCommerceboolean

커머스 보유 여부. attachment.commerce

예시

true

hasVideoboolean

동영상 보유 여부. attachment.video

예시

true

hasHeaderboolean

헤더(header) 컬럼 보유 여부

예시

true

hasAdditionalContentboolean

부가정보(additional_content) 컬럼 보유 여부

예시

true

buttonTypesarray<string>

본문 버튼 타입 (다중 선택). attachment.button[*].type
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- MD: 메시지전달
- AC: 채널추가
- BF: 비즈니스폼

예시

WL,AL

itemsstringenum

본문 버튼 타입 (다중 선택). attachment.button[*].type
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- MD: 메시지전달
- AC: 채널추가
- BF: 비즈니스폼

예시

WL,AL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

carouselButtonTypesarray<string>

캐러셀 버튼 타입 (다중 선택). carousel.list[*].attachment.button[*].type

예시

WL

itemsstringenum

캐러셀 버튼 타입 (다중 선택). carousel.list[*].attachment.button[*].type

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

searchTypestringenum

브랜드메시지 템플릿 키워드 검색 대상 (LIKE)

[단순 컬럼]
- MANAGE_NAME: 템플릿 관리명
- TEMPLATE_NAME: 템플릿명
- TEMPLATE_CODE: 템플릿 코드
- CUSTOM_TEMPLATE_CODE: 고객사 관리코드
- TEMPLATE_CONTENT: 템플릿 내용
- HEADER: 헤더
- ADDITIONAL_CONTENT: 부가정보

[attachment_json]
- ATTACHMENT_IMAGE_URL / ATTACHMENT_IMAGE_LINK: 이미지
- BUTTON_NAME / BUTTON_LINK: 버튼
- ATTACHMENT_ITEM_TITLE / ATTACHMENT_ITEM_IMAGE_URL / ATTACHMENT_ITEM_LINK: 와이드리스트 아이템
- ATTACHMENT_COUPON_TITLE / ATTACHMENT_COUPON_DESCRIPTION / ATTACHMENT_COUPON_LINK: 쿠폰
- ATTACHMENT_COMMERCE_TITLE: 커머스 상품 제목
- ATTACHMENT_VIDEO_URL / ATTACHMENT_VIDEO_THUMBNAIL_URL: 동영상

[carousel_json]
- CAROUSEL_HEAD_HEADER / CAROUSEL_HEAD_CONTENT / CAROUSEL_HEAD_IMAGE_URL / CAROUSEL_HEAD_LINK: 캐러셀 인트로
- CAROUSEL_ITEM_HEADER / CAROUSEL_ITEM_CONTENT / CAROUSEL_ITEM_ADDITIONAL_CONTENT: 캐러셀 리스트 텍스트
- CAROUSEL_ITEM_IMAGE_URL / CAROUSEL_ITEM_IMAGE_LINK: 캐러셀 리스트 이미지
- CAROUSEL_BUTTON_NAME / CAROUSEL_BUTTON_LINK: 캐러셀 버튼
- CAROUSEL_COUPON_TITLE / CAROUSEL_COUPON_DESCRIPTION / CAROUSEL_COUPON_LINK: 캐러셀 쿠폰
- CAROUSEL_COMMERCE_TITLE: 캐러셀 커머스 상품 제목
- CAROUSEL_TAIL_LINK: 캐러셀 더보기 버튼

가능한 enum 값

1
MANAGE_NAME

2
TEMPLATE_NAME

3
TEMPLATE_CODE

4
CUSTOM_TEMPLATE_CODE

5
TEMPLATE_CONTENT

6
HEADER

7
ADDITIONAL_CONTENT

8
ATTACHMENT_IMAGE_URL

9
ATTACHMENT_IMAGE_LINK

10
BUTTON_NAME

11
BUTTON_LINK

12
ATTACHMENT_ITEM_TITLE

13
ATTACHMENT_ITEM_IMAGE_URL

14
ATTACHMENT_ITEM_LINK

15
ATTACHMENT_COUPON_TITLE

16
ATTACHMENT_COUPON_DESCRIPTION

17
ATTACHMENT_COUPON_LINK

18
ATTACHMENT_COMMERCE_TITLE

19
ATTACHMENT_VIDEO_URL

20
ATTACHMENT_VIDEO_THUMBNAIL_URL

21
CAROUSEL_HEAD_HEADER

22
CAROUSEL_HEAD_CONTENT

23
CAROUSEL_HEAD_IMAGE_URL

24
CAROUSEL_HEAD_LINK

25
CAROUSEL_ITEM_HEADER

26
CAROUSEL_ITEM_CONTENT

27
CAROUSEL_ITEM_ADDITIONAL_CONTENT

28
CAROUSEL_ITEM_IMAGE_URL

29
CAROUSEL_ITEM_IMAGE_LINK

30
CAROUSEL_BUTTON_NAME

31
CAROUSEL_BUTTON_LINK

32
CAROUSEL_COUPON_TITLE

33
CAROUSEL_COUPON_DESCRIPTION

34
CAROUSEL_COUPON_LINK

35
CAROUSEL_COMMERCE_TITLE

36
CAROUSEL_TAIL_LINK

searchKeywordstring

키워드 검색어 (LIKE). searchType 지정 시 해당 필드/JSON 경로에 적용

예시

회원가입

groupBystringenum

브랜드메시지 템플릿 개수 조회 그룹화 기준
- CHAT_BUBBLE_TYPE: 메시지 타입별 (TEXT/IMAGE/WIDE/...)
- STATUS: 템플릿 상태별 (A/S)
- ADULT: 성인용 메시지 여부별 (Y/N)

가능한 enum 값

1
CHAT_BUBBLE_TYPE

2
STATUS

3
ADULT

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 개수 조회 응답

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/brand-message/template/count" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 브랜드메시지 템플릿 목록 조회

get
브랜드메시지 템플릿 목록 조회

/kakao-management/api/v1/brand-message/template/list

검색 조건으로 브랜드메시지 템플릿 목록을 조회합니다. (페이징: page, count)

[검색 조건 요약]
- 식별자:
senderKey
,
templateCode
,
customTemplateCode

- 템플릿 정보(LIKE):
manageName
,
templateName
,
templateContent

- 분류/상태:
chatBubbleType[]
,
status[]
,
adult

- 기간:
dateType
(CREATE_AT/MODIFIED_AT, 미지정 시 CREATE_AT) +
startDate
/
endDate
(YYYY-MM-DD)
- 구성요소 유무:
hasButton
,
hasCarousel
,
hasCarouselHead
,
hasCarouselTail
,
hasImage
,
hasItem
,
hasCoupon
,
hasCommerce
,
hasVideo
,
hasHeader
,
hasAdditionalContent

- 버튼 타입:
buttonTypes[]
(본문 버튼),
carouselButtonTypes[]
(캐러셀 버튼). 값: WL/AL/BK/MD/AC/BF
- 키워드 검색:
searchType
(검색 대상 필드/JSON 경로) +
searchKeyword
(LIKE)

[searchType 검색 대상]
- 단순 컬럼: MANAGE_NAME, TEMPLATE_NAME, TEMPLATE_CODE, CUSTOM_TEMPLATE_CODE, TEMPLATE_CONTENT, HEADER, ADDITIONAL_CONTENT
- attachment_json: ATTACHMENT_IMAGE_URL/LINK, BUTTON_NAME/LINK, ATTACHMENT_ITEM_TITLE/IMAGE_URL/LINK, ATTACHMENT_COUPON_TITLE/DESCRIPTION/LINK, ATTACHMENT_COMMERCE_TITLE, ATTACHMENT_VIDEO_URL/THUMBNAIL_URL
- carousel_json: CAROUSEL_HEAD_HEADER/CONTENT/IMAGE_URL/LINK, CAROUSEL_ITEM_HEADER/CONTENT/ADDITIONAL_CONTENT, CAROUSEL_ITEM_IMAGE_URL/LINK, CAROUSEL_BUTTON_NAME/LINK, CAROUSEL_COUPON_TITLE/DESCRIPTION/LINK, CAROUSEL_COMMERCE_TITLE, CAROUSEL_TAIL_LINK

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateCodestring

템플릿 코드

예시

1234567890abcdef1234567890abcdef12345678

customTemplateCodestring

고객사 템플릿 관리코드

예시

CUSTOM_CODE_0001

templateNamestring

템플릿명 (LIKE)

예시

검색할 템플릿명

manageNamestring

고객사 템플릿 관리명 (LIKE)

예시

검색할 템플릿 관리명

templateContentstring

템플릿 내용 (LIKE)

예시

검색할 템플릿 내용

chatBubbleTypearray<string>

브랜드 메시지 타입 (다중 선택)
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT,IMAGE

itemsstringenum

브랜드 메시지 타입 (다중 선택)
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT,IMAGE

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

statusarray<string>

템플릿 상태 (A: 정상, S: 차단). 다중 선택

예시

A

itemsstringenum

템플릿 상태 (A: 정상, S: 차단). 다중 선택

예시

A

가능한 enum 값

1
S

2
A

adultstring

성인용 메시지 여부 (Y/N)

예시

N

dateTypestringenum

기간 조회 대상
- CREATE_AT: 등록일(created_date)
- MODIFIED_AT: 수정일(last_modified_date)

예시

CREATE_AT

가능한 enum 값

1
CREATE_AT

2
MODIFIED_AT

startDatestring

조회 시작일(YYYY-MM-DD) — dateType이 가리키는 컬럼 기준

예시

2026-01-01

endDatestring

조회 종료일(YYYY-MM-DD) — dateType이 가리키는 컬럼 기준

예시

2026-12-31

hasButtonboolean

본문 버튼 보유 여부 (true: 있음, false: 없음). attachment.button[*]

예시

true

hasCarouselboolean

캐러셀 보유 여부. carousel.list[*]

예시

true

hasCarouselHeadboolean

캐러셀 인트로 보유 여부. carousel.head

예시

true

hasCarouselTailboolean

캐러셀 더보기 보유 여부. carousel.tail

예시

true

hasImageboolean

본문 이미지 보유 여부. attachment.image

예시

true

hasItemboolean

와이드리스트 아이템 보유 여부. attachment.item.list[*]

예시

true

hasCouponboolean

쿠폰 보유 여부. attachment.coupon

예시

true

hasCommerceboolean

커머스 보유 여부. attachment.commerce

예시

true

hasVideoboolean

동영상 보유 여부. attachment.video

예시

true

hasHeaderboolean

헤더(header) 컬럼 보유 여부

예시

true

hasAdditionalContentboolean

부가정보(additional_content) 컬럼 보유 여부

예시

true

buttonTypesarray<string>

본문 버튼 타입 (다중 선택). attachment.button[*].type
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- MD: 메시지전달
- AC: 채널추가
- BF: 비즈니스폼

예시

WL,AL

itemsstringenum

본문 버튼 타입 (다중 선택). attachment.button[*].type
- WL: 웹링크
- AL: 앱링크
- BK: 봇키워드
- MD: 메시지전달
- AC: 채널추가
- BF: 비즈니스폼

예시

WL,AL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

carouselButtonTypesarray<string>

캐러셀 버튼 타입 (다중 선택). carousel.list[*].attachment.button[*].type

예시

WL

itemsstringenum

캐러셀 버튼 타입 (다중 선택). carousel.list[*].attachment.button[*].type

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

searchTypestringenum

브랜드메시지 템플릿 키워드 검색 대상 (LIKE)

[단순 컬럼]
- MANAGE_NAME: 템플릿 관리명
- TEMPLATE_NAME: 템플릿명
- TEMPLATE_CODE: 템플릿 코드
- CUSTOM_TEMPLATE_CODE: 고객사 관리코드
- TEMPLATE_CONTENT: 템플릿 내용
- HEADER: 헤더
- ADDITIONAL_CONTENT: 부가정보

[attachment_json]
- ATTACHMENT_IMAGE_URL / ATTACHMENT_IMAGE_LINK: 이미지
- BUTTON_NAME / BUTTON_LINK: 버튼
- ATTACHMENT_ITEM_TITLE / ATTACHMENT_ITEM_IMAGE_URL / ATTACHMENT_ITEM_LINK: 와이드리스트 아이템
- ATTACHMENT_COUPON_TITLE / ATTACHMENT_COUPON_DESCRIPTION / ATTACHMENT_COUPON_LINK: 쿠폰
- ATTACHMENT_COMMERCE_TITLE: 커머스 상품 제목
- ATTACHMENT_VIDEO_URL / ATTACHMENT_VIDEO_THUMBNAIL_URL: 동영상

[carousel_json]
- CAROUSEL_HEAD_HEADER / CAROUSEL_HEAD_CONTENT / CAROUSEL_HEAD_IMAGE_URL / CAROUSEL_HEAD_LINK: 캐러셀 인트로
- CAROUSEL_ITEM_HEADER / CAROUSEL_ITEM_CONTENT / CAROUSEL_ITEM_ADDITIONAL_CONTENT: 캐러셀 리스트 텍스트
- CAROUSEL_ITEM_IMAGE_URL / CAROUSEL_ITEM_IMAGE_LINK: 캐러셀 리스트 이미지
- CAROUSEL_BUTTON_NAME / CAROUSEL_BUTTON_LINK: 캐러셀 버튼
- CAROUSEL_COUPON_TITLE / CAROUSEL_COUPON_DESCRIPTION / CAROUSEL_COUPON_LINK: 캐러셀 쿠폰
- CAROUSEL_COMMERCE_TITLE: 캐러셀 커머스 상품 제목
- CAROUSEL_TAIL_LINK: 캐러셀 더보기 버튼

가능한 enum 값

1
MANAGE_NAME

2
TEMPLATE_NAME

3
TEMPLATE_CODE

4
CUSTOM_TEMPLATE_CODE

5
TEMPLATE_CONTENT

6
HEADER

7
ADDITIONAL_CONTENT

8
ATTACHMENT_IMAGE_URL

9
ATTACHMENT_IMAGE_LINK

10
BUTTON_NAME

11
BUTTON_LINK

12
ATTACHMENT_ITEM_TITLE

13
ATTACHMENT_ITEM_IMAGE_URL

14
ATTACHMENT_ITEM_LINK

15
ATTACHMENT_COUPON_TITLE

16
ATTACHMENT_COUPON_DESCRIPTION

17
ATTACHMENT_COUPON_LINK

18
ATTACHMENT_COMMERCE_TITLE

19
ATTACHMENT_VIDEO_URL

20
ATTACHMENT_VIDEO_THUMBNAIL_URL

21
CAROUSEL_HEAD_HEADER

22
CAROUSEL_HEAD_CONTENT

23
CAROUSEL_HEAD_IMAGE_URL

24
CAROUSEL_HEAD_LINK

25
CAROUSEL_ITEM_HEADER

26
CAROUSEL_ITEM_CONTENT

27
CAROUSEL_ITEM_ADDITIONAL_CONTENT

28
CAROUSEL_ITEM_IMAGE_URL

29
CAROUSEL_ITEM_IMAGE_LINK

30
CAROUSEL_BUTTON_NAME

31
CAROUSEL_BUTTON_LINK

32
CAROUSEL_COUPON_TITLE

33
CAROUSEL_COUPON_DESCRIPTION

34
CAROUSEL_COUPON_LINK

35
CAROUSEL_COMMERCE_TITLE

36
CAROUSEL_TAIL_LINK

searchKeywordstring

키워드 검색어 (LIKE). searchType 지정 시 해당 필드/JSON 경로에 적용

예시

회원가입

pageinteger(int32)int32범위:0~

가져오고자 하는 페이지의 번호

예시

0

countinteger(int32)int32범위:1~

페이지당 조회할 건수

예시

20

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 목록 조회 응답

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/brand-message/template/list" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 브랜드메시지 템플릿 이력 목록 조회

get
브랜드메시지 템플릿 이력 목록 조회

/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}/history

특정 브랜드메시지 템플릿의 변경 이력 목록을 조회합니다. (templateKey 기준, 최신순)
[동작 방식]
- 템플릿이 생성/수정/삭제될 때마다 변경 후 스냅샷이 이력 테이블(tb_bm_template_code_hist)에 적재됩니다.
- 본 API는 이력 각 시점에 대해 "직전 이력 대비 어떤 필드가 바뀌었는지"를 요약해 반환합니다.
- 삭제된 템플릿(본 행 delYn=Y)은 조회 대상에서 제외됩니다.

[changeType 대표 유형] (우선순위 높은 것 우선)
- CREATE: 최초 등록 (직전 이력 없음)
- DELETE: 삭제 스냅샷 (del_yn = 'Y')
- STATUS: 템플릿 상태(status) 전환 (A/S)
- UPDATE: 그 외 일반 필드 변경

[변경 필드 표현 방식]
- 단순 필드: before/after 값을 그대로 노출
- 긴 텍스트(templateContent): 원문 그대로 노출
- 복잡 JSON(attachmentJson, carouselJson): 저장된 JSON 문자열 그대로 노출, complex=true

[주의]
- 페이징 없음 (한 템플릿당 이력은 일반적으로 수십 건 이하).
- 상세 스냅샷은 별도 상세 조회 API(/history/{histId})로 확인합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 이력 목록 응답.
한 템플릿의 전체 이력을 최신순으로 반환한다. (페이징 없음)

templateKeystring

조회 대상 템플릿 키

예시

KEY_JOIN_001

totalCountinteger(int32)int32

이력 총 개수

예시

5

historiesarray<object>

이력 요약 목록 (최신순)

itemsobject

브랜드메시지 템플릿 이력 요약 항목.
한 행은 하나의 변경 시점을 나타내며, 그 시점의 상태와 직전 대비 변경된 필드 요약을 포함한다.
전체 스냅샷이 필요하면 histId로 이력 상세 조회 API를 호출한다.

histIdinteger(int64)int64

이력 고유 ID (상세 조회 API 호출에 사용)

예시

1024

changeTypestringenum

브랜드메시지 템플릿 이력 변경 유형
- CREATE: 최초 등록
- DELETE: 삭제 처리 (delYn=Y 스냅샷)
- STATUS: 템플릿 상태(status) 전환 (A/S)
- UPDATE: 템플릿 내용 등 일반 필드 변경

예시

UPDATE

가능한 enum 값

1
CREATE

2
DELETE

3
STATUS

4
UPDATE

statusstringenum

이력 시점의 템플릿 상태

예시

A

가능한 enum 값

1
S

2
A

modifiedAtstring

이력 기록 시점 (yyyy-MM-dd HH:mm:ss)

예시

2026-04-17 10:30:00

modifiedBystring

변경자 ID

예시

admin01

changedCountinteger(int32)int32

직전 이력 대비 변경된 필드 수

예시

3

changesarray<object>

직전 이력 대비 변경된 필드 목록

itemsobject

브랜드메시지 템플릿 이력의 필드 단위 변경 내역.
단순/텍스트/복잡 JSON 필드인지에 따라 표현 방식이 달라진다.

fieldstring

엔티티 필드명 (카멜케이스)

예시

templateContent

labelstring

화면 표기용 한글 라벨

예시

템플릿 내용

beforestring

변경 전 값 (null 가능). 복잡 JSON 필드는 JSON 문자열.

예시

정상(A)

afterstring

변경 후 값 (null 가능). 포맷 규칙은 before와 동일.

예시

차단(S)

truncatedboolean

축약 여부. 항상 false (원문 그대로 반환).

예시

false

complexboolean

복잡 JSON 필드 여부. true면 before/after는 JSON 문자열.

예시

false

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template//history" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 브랜드메시지 템플릿 이력 상세 조회

get
브랜드메시지 템플릿 이력 상세 조회

/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}/history/{histId}

특정 이력 시점의 템플릿 전체 스냅샷을 조회합니다. (histId 기준)
[응답 구조]
- 해당 시점의 템플릿 전체 필드(= 일반 템플릿 상세 조회 BmTemplateResponse와 동일한 스키마)가 그대로 포함됩니다.
- 추가로 직전 이력 대비 변경된 필드 요약(changes)과 대표 변경 유형(changeType)을 함께 반환합니다.
- 삭제된 템플릿(본 행 delYn=Y)은 조회 대상에서 제외됩니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 이력 상세 응답.
해당 시점의 템플릿 전체 스냅샷(BmTemplateResponse와 동일 스키마)과 직전 이력 대비 변경 요약을 함께 반환한다.

histIdinteger(int64)int64

이력 고유 ID

예시

1024

changeTypestringenum

브랜드메시지 템플릿 이력 변경 유형
- CREATE: 최초 등록
- DELETE: 삭제 처리 (delYn=Y 스냅샷)
- STATUS: 템플릿 상태(status) 전환 (A/S)
- UPDATE: 템플릿 내용 등 일반 필드 변경

예시

UPDATE

가능한 enum 값

1
CREATE

2
DELETE

3
STATUS

4
UPDATE

changesarray<object>

직전 이력 대비 변경된 필드 목록

itemsobject

브랜드메시지 템플릿 이력의 필드 단위 변경 내역.
단순/텍스트/복잡 JSON 필드인지에 따라 표현 방식이 달라진다.

fieldstring

엔티티 필드명 (카멜케이스)

예시

templateContent

labelstring

화면 표기용 한글 라벨

예시

템플릿 내용

beforestring

변경 전 값 (null 가능). 복잡 JSON 필드는 JSON 문자열.

예시

정상(A)

afterstring

변경 후 값 (null 가능). 포맷 규칙은 before와 동일.

예시

차단(S)

truncatedboolean

축약 여부. 항상 false (원문 그대로 반환).

예시

false

complexboolean

복잡 JSON 필드 여부. true면 before/after는 JSON 문자열.

예시

false

modifiedAtstring

수정일

modifiedBystring

변경자 ID

예시

admin01

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateKeystring

템플릿 고유 요청 키

예시

KEY_JOIN_001

templateCodestring

템플릿 코드

예시

6a2710675148b8be2cd25b2935gcf01783cfb169

customTemplateCodestring

고객사 템플릿 코드

예시

CUST_JOIN_001

templateNamestring

템플릿 이름

예시

humuson_2351

manageNamestring

템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringenum

브랜드메시지 ChatBubbleType

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인 여부

예시

Y

headerstring

헤더

예시

헤더내용

contentstring

템플릿 내용

예시

#{name}님 안녕하세요. 휴머스온입니다.

additionalContentstring

부가 정보

attachmentobject

메시지에 첨부할 내용

buttonarray<object>

버튼 정보 리스트
TEXT, IMAGE - Coupon을 적용할 경우 최대 4개, 그 외 최대 5개
WIDE, WIDE_ITEM_LIST - 최대 2개
PREMIUM_VIDEO - 최대 1개
COMMERCE - 최소 1개, 최대 2개

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

itemobject

브랜드메시지 와이드 리스트 아이템 정보 (최소 3개 , 최대 4개까지 가능)

listarray<object>

브랜드메시지 와이드리스트 요소 정보

itemsobject

브랜드메시지 와이드리스트 요소 정보

titlestring

아이템 제목
mainWideItem - 최대 25자 (줄바꿈: 최대 1개)
subWideItemList - 최대 30자 (줄바꿈: 최대 1개)

예시

와이드리스트 아이템 제목

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

videoobject

브랜드메시지 동영상 요소

video_urlstring길이:0~500

카카오TV 동영상 URL

예시

https://tv.kakao.com/channel/1506/cliplink/461781816

thumbnail_urlstring길이:0~500

브랜드메시지 이미지 업로드 API 로 등록한 동영상 썸네일용 이미지 URL
(기본값 : 동영상 기본 썸네일 이미지)

예시

https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

headobject

캐러셀 인트로
CAROUSEL_COMMERCE인 경우 사용

headerstring길이:0~20

케러셀 인트로 헤더 (최대 20자 (줄바꿈:불가))

예시

케러셀 인트로 헤더

contentstring길이:0~50

캐러셀 인트로 내용 (최대 50자 (줄바꿈: 최대 2개))

예시

캐러셀 인트로 본문 내용입니다.

image_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 캐러셀 인트로 이미지 URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 캐러셀 인트로 클릭 시 이동할 URL
urlMobile 필수 : 링크를 하나라도 입력하는 경우

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 캐러셀 인트로 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

listarray<object>

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

itemsobject

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

headerstring길이:0~20

캐러셀 리스트 헤더 (최대 20자 (줄바꿈: 불가))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 헤더

attachmentobject

캐러셀 리스트 이미지,커머스, 버튼, 쿠폰 요소 정보

buttonarray<object>

캐러셀 리스트 버튼 정보 (캐러셀당 최소 1개, 최대 2개)

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

contentstring길이:0~180

캐러셀 리스트 내용 (최대 180자 (줄바꿈: 최대 10개))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 내용

additional_contentstring길이:0~340

캐러셀 리스트 부가 정보 (최대 34자 (줄바꿈: 최대 1개))
CAROUSEL_COMMERCE인 경우 사용

예시

캐러셀 리스트 부가 정보

tailobject

더보기 버튼

url_mobilestring길이:0~500

MOBILE 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE iOS 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

scheme_iosstring길이:0~500

MOBILE Android 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

statusstringenum

템플릿 상태

가능한 enum 값

1
S

2
A

createdAtstring

등록일

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template//history/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 브랜드메시지 템플릿 조회

get
브랜드메시지 템플릿 조회

/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}

템플릿 요청 고유 키(templateKey)를 이용하여 템플릿을 조회합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 응답

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateKeystring

템플릿 고유 요청 키

예시

KEY_JOIN_001

templateCodestring

템플릿 코드

예시

6a2710675148b8be2cd25b2935gcf01783cfb169

customTemplateCodestring

고객사 템플릿 코드

예시

CUST_JOIN_001

templateNamestring

템플릿 이름

예시

humuson_2351

manageNamestring

템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringenum

브랜드메시지 ChatBubbleType

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인 여부

예시

Y

headerstring

헤더

예시

헤더내용

contentstring

템플릿 내용

예시

#{name}님 안녕하세요. 휴머스온입니다.

additionalContentstring

부가 정보

attachmentobject

메시지에 첨부할 내용

buttonarray<object>

버튼 정보 리스트
TEXT, IMAGE - Coupon을 적용할 경우 최대 4개, 그 외 최대 5개
WIDE, WIDE_ITEM_LIST - 최대 2개
PREMIUM_VIDEO - 최대 1개
COMMERCE - 최소 1개, 최대 2개

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

itemobject

브랜드메시지 와이드 리스트 아이템 정보 (최소 3개 , 최대 4개까지 가능)

listarray<object>

브랜드메시지 와이드리스트 요소 정보

itemsobject

브랜드메시지 와이드리스트 요소 정보

titlestring

아이템 제목
mainWideItem - 최대 25자 (줄바꿈: 최대 1개)
subWideItemList - 최대 30자 (줄바꿈: 최대 1개)

예시

와이드리스트 아이템 제목

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

videoobject

브랜드메시지 동영상 요소

video_urlstring길이:0~500

카카오TV 동영상 URL

예시

https://tv.kakao.com/channel/1506/cliplink/461781816

thumbnail_urlstring길이:0~500

브랜드메시지 이미지 업로드 API 로 등록한 동영상 썸네일용 이미지 URL
(기본값 : 동영상 기본 썸네일 이미지)

예시

https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

headobject

캐러셀 인트로
CAROUSEL_COMMERCE인 경우 사용

headerstring길이:0~20

케러셀 인트로 헤더 (최대 20자 (줄바꿈:불가))

예시

케러셀 인트로 헤더

contentstring길이:0~50

캐러셀 인트로 내용 (최대 50자 (줄바꿈: 최대 2개))

예시

캐러셀 인트로 본문 내용입니다.

image_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 캐러셀 인트로 이미지 URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 캐러셀 인트로 클릭 시 이동할 URL
urlMobile 필수 : 링크를 하나라도 입력하는 경우

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 캐러셀 인트로 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

listarray<object>

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

itemsobject

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

headerstring길이:0~20

캐러셀 리스트 헤더 (최대 20자 (줄바꿈: 불가))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 헤더

attachmentobject

캐러셀 리스트 이미지,커머스, 버튼, 쿠폰 요소 정보

buttonarray<object>

캐러셀 리스트 버튼 정보 (캐러셀당 최소 1개, 최대 2개)

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

contentstring길이:0~180

캐러셀 리스트 내용 (최대 180자 (줄바꿈: 최대 10개))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 내용

additional_contentstring길이:0~340

캐러셀 리스트 부가 정보 (최대 34자 (줄바꿈: 최대 1개))
CAROUSEL_COMMERCE인 경우 사용

예시

캐러셀 리스트 부가 정보

tailobject

더보기 버튼

url_mobilestring길이:0~500

MOBILE 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE iOS 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

scheme_iosstring길이:0~500

MOBILE Android 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

statusstringenum

템플릿 상태

가능한 enum 값

1
S

2
A

createdAtstring

등록일

modifiedAtstring

수정일

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [PUT] 브랜드메시지 템플릿 수정

put
브랜드메시지 템플릿 수정

/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}

템플릿을 수정합니다. (templateKey 기준)

요청 속성

Attributes

customTemplateCodestring길이:0~30

고객사 템플릿 관리코드

예시

CUSTOM_CODE_0001

manageNamestringrequired길이:0~30

고객사 템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringrequiredenum

브랜드 메시지 타입
- TEXT: 텍스트
- IMAGE: 이미지
- WIDE: 와이드 이미지
- WIDE_ITEM_LIST: 와이드 리스트
- CAROUSEL_FEED: 캐러셀 피드
- PREMIUM_VIDEO: 프리미엄 동영상
- COMMERCE: 커머스
- CAROUSEL_COMMERCE: 캐러셀 커머스

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인용 메시지 여부
- Y: 성인용 메시지
- N: 모든 연령 메시지 (기본값)

예시

N

headerstring길이:0~20

템플릿 헤더
header 필드 필수
- 와이드 리스트형: 최대 20자 (줄바꿈: 불가)

header 필드 선택
- 프리미엄 동영상형: 최대 20자 (줄바꿈: 불가)

예시

와이드 리스트형 헤더

contentstring길이:0~1300

템플릿 내용
content 필드 필수
- 텍스트형: 최대 1,300자 (줄바꿈: 최대 99개, URL 형식 입력 가능)
- 이미지형: 최대 400자 (줄바꿈: 최대 29개, URL 형식 입력 가능)
- 와이드형: 최대 76자 (줄바꿈: 최대 1개)

content 필드 선택
- 프리미엄 동영상형: 최대 76자 (줄바꿈: 최대 1개)

content 필드 사용안함
- 와이드 리스트형
- 캐러셀 피드형
- 커머스형
- 캐러셀 커머스형

예시

홍길동님 회원가입을 축하합니다.

additionalContentstring길이:0~34

템플릿 부가정보
- 커머스형: 최대 34자 (줄바꿈: 최대 1개)- 그 외 사용 안함

예시

커머스형 부가정보

attachmentobject

메시지에 첨부할 내용

buttonarray<object>

버튼 정보 리스트
TEXT, IMAGE - Coupon을 적용할 경우 최대 4개, 그 외 최대 5개
WIDE, WIDE_ITEM_LIST - 최대 2개
PREMIUM_VIDEO - 최대 1개
COMMERCE - 최소 1개, 최대 2개

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

itemobject

브랜드메시지 와이드 리스트 아이템 정보 (최소 3개 , 최대 4개까지 가능)

listarray<object>

브랜드메시지 와이드리스트 요소 정보

itemsobject

브랜드메시지 와이드리스트 요소 정보

titlestring

아이템 제목
mainWideItem - 최대 25자 (줄바꿈: 최대 1개)
subWideItemList - 최대 30자 (줄바꿈: 최대 1개)

예시

와이드리스트 아이템 제목

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 아이템 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 아이템 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

videoobject

브랜드메시지 동영상 요소

video_urlstring길이:0~500

카카오TV 동영상 URL

예시

https://tv.kakao.com/channel/1506/cliplink/461781816

thumbnail_urlstring길이:0~500

브랜드메시지 이미지 업로드 API 로 등록한 동영상 썸네일용 이미지 URL
(기본값 : 동영상 기본 썸네일 이미지)

예시

https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

headobject

캐러셀 인트로
CAROUSEL_COMMERCE인 경우 사용

headerstring길이:0~20

케러셀 인트로 헤더 (최대 20자 (줄바꿈:불가))

예시

케러셀 인트로 헤더

contentstring길이:0~50

캐러셀 인트로 내용 (최대 50자 (줄바꿈: 최대 2개))

예시

캐러셀 인트로 본문 내용입니다.

image_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 캐러셀 인트로 이미지 URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

url_mobilestring길이:0~500

MOBILE 환경에서 캐러셀 인트로 클릭 시 이동할 URL
urlMobile 필수 : 링크를 하나라도 입력하는 경우

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 캐러셀 인트로 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 캐러셀 인트로 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

listarray<object>

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

itemsobject

캐러셀 리스트
캐러셀 인트로(head) 사용시 - 1~5개
그 외 - 2~6개

headerstring길이:0~20

캐러셀 리스트 헤더 (최대 20자 (줄바꿈: 불가))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 헤더

attachmentobject

캐러셀 리스트 이미지,커머스, 버튼, 쿠폰 요소 정보

buttonarray<object>

캐러셀 리스트 버튼 정보 (캐러셀당 최소 1개, 최대 2개)

itemsobject

버튼 요소에는 전체 버튼을 통틀어 최대 20개(중복 제외)의 변수 사용이 가능합니다.
변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
AC 버튼을 사용할 경우, TEXT, IMAGE 는 첫번째 버튼으로, 그 외 메시지 타입의 경우 마지막 버튼으로 등록해주셔야 합니다.

namestringrequired길이:0~14

버튼 제목
TEXT, IMAGE - 최대 14자
그 외 - 최대 8자

예시

버튼 제목

typestringenum

버튼 타입
버튼 타입별 필수 파라미터를 모두 입력해야 메시지 발송 가능

예시

WL

가능한 enum 값

1
WL

2
AL

3
BK

4
MD

5
AC

6
BF

url_mobilestring길이:0~500

MOBILE 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE Android 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 버튼 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

bizFormIdinteger(int64)int64

비즈니스폼 ID

imageobject

캐러셀 리스트 이미지 정보 (캐러셀 커머스는 전체 이미지 비율이 동일해야 함)

img_urlstring길이:0~500

브랜드메시지 이미지 업로드 API로 등록한 이미지URL

예시

https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg

img_linkstring길이:0~500

이미지 클릭시 이동할 URL

예시

https://imc.humuson.com/

couponobject

캐러셀 리스트 쿠폰 정보 (캐러셀 리스트 최하단 노출)

titlestring길이:0~30

쿠폰 제목

변수 사용을 원할 경우 고정 변수명 사용
#{할인금액}원 할인 쿠폰 (#{할인금액} 범위는 1 ~ 99,999,999)
#{할인율}% 할인 쿠폰 (#{할인율} 범위는 1 ~ 100)
배송비 할인 쿠폰
#{상품명} 무료 쿠폰 (#{상품명}은 최대 7자)
#{상품명} UP 쿠폰 (#{상품명}은 최대 7자)

고정 값 사용을 원할 경우 변수 자리에 숫자 입력
쿠폰 요소 사용시 title 필수

예시

배송비 할인 쿠폰

descriptionstring길이:0~18

쿠폰 설명
WIDE, WIDE_ITEM_LIST, PREMIUM_VIDE - 최대 18자 (줄바꿈: 불가)
그 외 - 최대 12자 (줄바꿈: 불가)

예시

프로모션 기간에만 사용가능

url_mobilestring길이:0~500

MOBILE 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

url_pcstring길이:0~500

PC 환경에서 쿠폰 클릭 시 이동할 URL

예시

https://imc.humuson.com/

scheme_androidstring길이:0~500

MOBILE Android 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

scheme_iosstring길이:0~500

MOBILE iOS 환경에서 쿠폰 클릭 시 실행할
application custom scheme

예시

scheme://humuson.com

commerceobject

메시지 표기 방식에 따라 regularPrice, discountPrice, discountRate, discountFixed은 다음과 같이 사용할 수 있습니다.
정상 가격으로 표기 : regularPrice
정상 가격 + 할인 후 가격(할인율 포함)으로 표기 : regularPrice, discountPrice, discountRate
정상 가격 + 할인 후 가격(정액 할인 가격 포함)으로 표기 : regularPrice, discountPrice, discountFixed
regularPrice, discountPrice, discountRate, discountFixed 값을 입력하지 않을 경우 고정 변수명으로 저장됩니다.
고정 변수명을 사용하면 메시지 발송 시 금액을 변경하여 메시지를 발송 할 수 있습니다.

titlestring길이:0~30

상품 제목 (줄바꿈 문자 입력 불가. 변수 가능)

예시

상품 제목

regular_priceinteger(int64)int64

정상 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{정상가격})로 저장

예시

20000

discount_priceinteger(int64)int64

할인 후 가격 (0 ~ 99,999,999)
값이 없을 경우 고정 변수(변수명: #{할인가격})로 저장

예시

10000

discount_rateinteger(int64)int64

할인율 (0 ~ 100)
값이 없을 경우 고정 변수(변수명: #{할인율})로 저장

예시

50

discount_fixedinteger(int64)int64

정액 할인 가격 (0 ~ 999,999)
값이 없을 경우 고정 변수(변수명: #{정액할인가격})로 저장

예시

10000

contentstring길이:0~180

캐러셀 리스트 내용 (최대 180자 (줄바꿈: 최대 10개))
CAROUSEL_FEED인 경우 사용

예시

캐러셀 리스트 내용

additional_contentstring길이:0~340

캐러셀 리스트 부가 정보 (최대 34자 (줄바꿈: 최대 1개))
CAROUSEL_COMMERCE인 경우 사용

예시

캐러셀 리스트 부가 정보

tailobject

더보기 버튼

url_mobilestring길이:0~500

MOBILE 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

url_pcstring길이:0~500

PC 환경에서 더보기 버튼 클릭 시 이동할 URL

예시

https://imc.humuson.com

scheme_androidstring길이:0~500

MOBILE iOS 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

scheme_iosstring길이:0~500

MOBILE Android 환경에서 더보기 버튼 클릭 시 실행할 application custom scheme

예시

scheme://humuson.com"

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

브랜드메시지 템플릿 응답

senderKeystring

발신프로필 senderKey

예시

db105ef3ebe9917ae0f9dcef4c94a6adb74d125f

templateKeystring

템플릿 고유 요청 키

예시

KEY_JOIN_001

templateCodestring

템플릿 코드

예시

6a2710675148b8be2cd25b2935gcf01783cfb169

customTemplateCodestring

고객사 템플릿 코드

예시

CUST_JOIN_001

templateNamestring

템플릿 이름

예시

humuson_2351

manageNamestring

템플릿 관리명

예시

회원가입 발송 템플릿_v1

chatBubbleTypestringenum

브랜드메시지 ChatBubbleType

예시

TEXT

가능한 enum 값

1
TEXT

2
IMAGE

3
WIDE

4
WIDE_ITEM_LIST

5
CAROUSEL_FEED

6
PREMIUM_VIDEO

7
COMMERCE

8
CAROUSEL_COMMERCE

adultstring

성인 여부

예시

Y

headerstring

헤더

예시

헤더내용

contentstring

템플릿 내용

예시

#{name}님 안녕하세요. 휴머스온입니다.

additionalContentstring

부가 정보

attachmentobject

메시지에 첨부할 내용

carouselobject

변수명은 최대 20자 이내 한/영/숫자/허용된 특수기호('-', '_')로만 입력 가능합니다. (단, 변수 선언 후 필드 별 최대 글자수는 초과할 수 없습니다.)
head에 최대 20개의 변수명 입력 가능합니다. (중복 제외)
list의 아이템 1개당 최대 20개의 변수명 입력 가능합니다. (중복 제외)
tail에 변수 사용 불가능합니다.

statusstringenum

템플릿 상태

가능한 enum 값

1
S

2
A

createdAtstring

등록일

modifiedAtstring

수정일

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"chatBubbleType": "TEXT",
"manageName": "회원가입 발송 템플릿_v1",
"customTemplateCode": "CUSTOM_CODE_0001",
"adult": "N",
"header": "와이드 리스트형 헤더",
"content": "홍길동님 회원가입을 축하합니다.",
"additionalContent": "커머스형 부가정보",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"item": {
"list": [
{
"title": "와이드리스트 아이템 제목",
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
]
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
},
"video": {
"video_url": "https://tv.kakao.com/channel/1506/cliplink/461781816",
"thumbnail_url": "https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg"
}
},
"carousel": {
"head": {
"header": "케러셀 인트로 헤더",
"content": "캐러셀 인트로 본문 내용입니다.",
"image_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"list": [
{
"header": "캐러셀 리스트 헤더",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
}
},
"content": "캐러셀 리스트 내용",
"additional_content": "캐러셀 리스트 부가 정보"
}
],
"tail": {
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com\"",
"scheme_ios": "scheme://humuson.com\""
}
}
}'

JSON
{
"chatBubbleType": "TEXT",
"manageName": "회원가입 발송 템플릿_v1",
"customTemplateCode": "CUSTOM_CODE_0001",
"adult": "N",
"header": "와이드 리스트형 헤더",
"content": "홍길동님 회원가입을 축하합니다.",
"additionalContent": "커머스형 부가정보",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"item": {
"list": [
{
"title": "와이드리스트 아이템 제목",
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
]
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
},
"video": {
"video_url": "https://tv.kakao.com/channel/1506/cliplink/461781816",
"thumbnail_url": "https://mud-kage.kakao.com/dn/bH9XtV/dJMcaaEwIcr/hQhj2Cz1ABZMpef1jhLbPk/img_l.jpg"
}
},
"carousel": {
"head": {
"header": "케러셀 인트로 헤더",
"content": "캐러셀 인트로 본문 내용입니다.",
"image_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"list": [
{
"header": "캐러셀 리스트 헤더",
"attachment": {
"button": [
{
"name": "버튼 제목",
"type": "WL",
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
}
],
"image": {
"img_url": "https://mud-kage.kakao.com/dn/7QCVo/dJMcagEKgBA/qy7TYNl9Yn2fcIGFrsuwik/img_l.jpg",
"img_link": "https://imc.humuson.com/"
},
"coupon": {
"title": "배송비 할인 쿠폰",
"description": "프로모션 기간에만 사용가능",
"url_mobile": "https://imc.humuson.com/",
"url_pc": "https://imc.humuson.com/",
"scheme_android": "scheme://humuson.com",
"scheme_ios": "scheme://humuson.com"
},
"commerce": {
"title": "상품 제목",
"regular_price": 20000,
"discount_price": 10000,
"discount_rate": 50,
"discount_fixed": 10000
}
},
"content": "캐러셀 리스트 내용",
"additional_content": "캐러셀 리스트 부가 정보"
}
],
"tail": {
"url_mobile": "https://imc.humuson.com",
"url_pc": "https://imc.humuson.com",
"scheme_android": "scheme://humuson.com\"",
"scheme_ios": "scheme://humuson.com\""
}
}
}

---

## [DELETE] 브랜드메시지 템플릿 삭제

delete
브랜드메시지 템플릿 삭제

/kakao-management/api/v1/sender/{senderKey}/brand-message/template/{templateKey}

템플릿을 삭제합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X DELETE "http://10.147.1.109:28000/kakao-management/api/v1/sender//brand-message/template/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

# 알림톡 템플릿 검수 알림 수신자 관리 API

총 **5개** API

## [POST] 알림톡 검수 알림 수신자 등록

post
알림톡 검수 알림 수신자 등록

/kakao-management/api/v1/alimtalk/template/alarm-users

알림톡 템플릿 검수 알림 수신자를 등록합니다.

요청 속성

Attributes

alarmUserKeystring

알림 수신자 키 (선택, 미입력시 서버가 자동발급)

예시

ALARM_USER_001

namestringrequired

수신자 이름

예시

홍길동

phoneNumberstringrequired숫자만

수신자 전화번호(숫자만)

예시

01012345678

activeYnstringrequiredenum

활성화 상태 (Y/N)

예시

Y

가능한 enum 값

1
Y

2
N

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 검수 알림 수신자 응답

alarmUserKeystring

알림 수신자 키(식별용 고유 키/고객사 발번)

예시

ALARM_USER_001

namestring

수신자 이름

예시

홍길동

phoneNumberstring

수신자 전화번호

예시

01012345678

activeYnstringenum

활성화 상태 (Y/N)

예시

Y

가능한 enum 값

1
Y

2
N

createAtstring

생성 일시 (yyyy-MM-dd HH:mm:ss)

예시

2026-03-03 10:00:00

modifiedAtstring

수정 일시 (yyyy-MM-dd HH:mm:ss)

예시

2026-03-03 10:00:00

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/alarm-users" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"activeYn": "Y",
"name": "홍길동",
"phoneNumber": "01012345678",
"alarmUserKey": "ALARM_USER_001"
}'

JSON
{
"activeYn": "Y",
"name": "홍길동",
"phoneNumber": "01012345678",
"alarmUserKey": "ALARM_USER_001"
}

---

## [POST] 알림톡 검수 알림 수신자 키 자동발급

post
알림톡 검수 알림 수신자 키 자동발급

/kakao-management/api/v1/alimtalk/template/alarm-users/key

알림 수신자 등록 전에 사용할 alarmUserKey를 선발급합니다.
등록 API 호출 시 alarmUserKey 필드를 비워두면 서버가 자동 발급해주므로 이 API는 선택 사용입니다.
발급 포맷: AU + yyMMddHHmmss + 랜덤 4자 (최대 20자).

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 검수 알림 수신자 키 자동발급 응답

alarmUserKeystring

자동발급된 알림 수신자 키

예시

AU260423153045A1B2

cURL

curl -X POST "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/alarm-users/key" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-d '{}'

---

## [GET] 알림톡 검수 알림 수신자 목록 조회

get
알림톡 검수 알림 수신자 목록 조회

/kakao-management/api/v1/alimtalk/template/alarm-users

검색 조건으로 알림톡 템플릿 검수 알림 수신자 목록을 조회합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

Attributes

namestring

수신자 이름(부분 일치 검색)

예시

길동

phoneNumberstring

수신자 전화번호(부분 일치 검색)

예시

010

activeYnstringenum

활성화 상태 (Y/N)

예시

Y

가능한 enum 값

1
Y

2
N

pageinteger(int32)int32범위:0~

페이지 번호

예시

0

countinteger(int32)int32범위:1~

페이지당 조회 건수

예시

20

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 검수 알림 수신자 목록 조회 응답

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/alarm-users" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [PUT] 알림톡 검수 알림 수신자 수정

put
알림톡 검수 알림 수신자 수정

/kakao-management/api/v1/alimtalk/template/alarm-users/{alarmUserKey}

알림 수신자 키(alarmUserKey)로 대상을 지정하여 수정합니다.

요청 속성

Attributes

namestringrequired

수신자 이름

예시

홍길동

phoneNumberstringrequired숫자만

수신자 전화번호(숫자만)

예시

01012345678

activeYnstringrequiredenum

활성화 상태 (Y/N)

예시

Y

가능한 enum 값

1
Y

2
N

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

알림톡 템플릿 검수 알림 수신자 응답

alarmUserKeystring

알림 수신자 키(식별용 고유 키/고객사 발번)

예시

ALARM_USER_001

namestring

수신자 이름

예시

홍길동

phoneNumberstring

수신자 전화번호

예시

01012345678

activeYnstringenum

활성화 상태 (Y/N)

예시

Y

가능한 enum 값

1
Y

2
N

createAtstring

생성 일시 (yyyy-MM-dd HH:mm:ss)

예시

2026-03-03 10:00:00

modifiedAtstring

수정 일시 (yyyy-MM-dd HH:mm:ss)

예시

2026-03-03 10:00:00

cURL

curl -X PUT "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/alarm-users/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \
-H "Content-Type: application/json" \
-d '{
"activeYn": "Y",
"name": "홍길동",
"phoneNumber": "01012345678"
}'

JSON
{
"activeYn": "Y",
"name": "홍길동",
"phoneNumber": "01012345678"
}

---

## [DELETE] 알림톡 검수 알림 수신자 삭제

delete
알림톡 검수 알림 수신자 삭제

/kakao-management/api/v1/alimtalk/template/alarm-users/{alarmUserKey}

알림 수신자 키(alarmUserKey)로 대상을 지정하여 삭제합니다. (하드 딜리트)

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

cURL

curl -X DELETE "http://10.147.1.109:28000/kakao-management/api/v1/alimtalk/template/alarm-users/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

# 템플릿 카테고리 조회 API

총 **2개** API

## [GET] 템플릿 카테고리 단건 조회

get
템플릿 카테고리 단건 조회

/kakao-management/api/v1/template/category/{categoryCode}

템플릿 등록에 필요한 카테고리를 조회합니다.

요청 속성

요청 파라미터 기반 스키마를 표시합니다.

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataobject

템플릿 카테고리 정보

codestring

카테고리 코드

예시

001001

namestring

카테고리 이름

예시

회원가입

groupNamestring

카테고리 그룹 이름

예시

회원

inclusionstring

카테고리 적용 대상 템플릿 설명

예시

회원가입 완료 내용의 템플릿이 대상입니다. 가입에 따른 축하적립금/쿠폰을 포함합니다.

exclusionstring

카테고리 제외 대상 템플릿 설명

예시

상품/서비스가입은 구매 > 상품가입 (002002)로 분류합니다.

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/template/category/" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

## [GET] 템플릿 카테고리 전체 조회

get
템플릿 카테고리 전체 조회

/kakao-management/api/v1/template/category

템플릿 등록에 필요한 카테고리를 전체 조회합니다.

요청 속성

스키마 정보 없음

응답 속성

200

OK

Attributes

codestring

응답 코드

예시

0000

messagestring

응답 메시지

예시

SUCCESS

dataarray<object>

응답 데이터 (성공 시 Success*Data, 실패 시 FailureResponseData 스키마 참조)

itemsobject

템플릿 카테고리 정보

codestring

카테고리 코드

예시

001001

namestring

카테고리 이름

예시

회원가입

groupNamestring

카테고리 그룹 이름

예시

회원

inclusionstring

카테고리 적용 대상 템플릿 설명

예시

회원가입 완료 내용의 템플릿이 대상입니다. 가입에 따른 축하적립금/쿠폰을 포함합니다.

exclusionstring

카테고리 제외 대상 템플릿 설명

예시

상품/서비스가입은 구매 > 상품가입 (002002)로 분류합니다.

cURL

curl -X GET "http://10.147.1.109:28000/kakao-management/api/v1/template/category" \
-H "x-imc-api-key: APIKEY-HUMUSON-0001" \

---

