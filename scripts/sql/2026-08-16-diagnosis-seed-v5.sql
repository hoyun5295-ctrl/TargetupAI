-- 마케팅 진단 seed v5 (2026-08-16 · 설문 전수점검 보강 — 플랫폼 종속·전문 툴 사용자·상담 툴. Harold 지시)
-- 실행: docker exec -i targetup-postgres psql -U targetup targetup < ~/targetup-app/scripts/sql/2026-08-16-diagnosis-seed-v5.sql
-- 멱등: 기존 v5 행을 지우고 다시 넣는다. v4 대비 = 문항 수 동일(30) · 보기 3개 확장(touchpoint.platform ·
--       locked_tool.platform · unified_tool.chat_tool). 리포트 반응은 코드(copy CT)가 함께 배선됐다.
BEGIN;
DELETE FROM diagnosis_question_sets WHERE version = 'v5';
UPDATE diagnosis_question_sets SET is_active = false WHERE is_active;
INSERT INTO diagnosis_question_sets (version, definition, is_active) VALUES ('v5', $$
{
 "version": "v5",
 "rule_version": "r5",
 "meta": {
  "est_label": "약 3분 · 답변에 따라 문항이 달라져요",
  "sections": [
   {
    "key": "s1",
    "label": "기본 정보",
    "intro": "먼저 어떤 곳인지 여쭤볼게요."
   },
   {
    "key": "s2",
    "label": "고객 명단",
    "intro": "고객 명단부터 여쭤볼게요."
   },
   {
    "key": "s3",
    "label": "보내는 방식",
    "intro": "이제 실제로 어떻게 보내고 계신지 여쭤볼게요."
   },
   {
    "key": "s4",
    "label": "제작과 성과",
    "intro": "만드는 과정과 결과 확인을 여쭤볼게요."
   },
   {
    "key": "s5",
    "label": "규모 확인",
    "intro": "진단 문항은 여기까지예요. 요금 견적을 위한 마지막 3개만 확인할게요."
   }
  ]
 },
 "questions": [
  {
   "key": "industry",
   "text": "어떤 분야이신가요?",
   "type": "industry_grid",
   "section": "s1",
   "tags": [
    "example_filter"
   ],
   "options": [
    {
     "key": "fashion",
     "label": "의류/패션"
    },
    {
     "key": "beauty",
     "label": "뷰티/화장품"
    },
    {
     "key": "fnb",
     "label": "식음료/카페"
    },
    {
     "key": "ecommerce",
     "label": "쇼핑몰/이커머스"
    },
    {
     "key": "medical",
     "label": "병원/의료"
    },
    {
     "key": "education",
     "label": "학원/교육"
    },
    {
     "key": "travel",
     "label": "여행/레저"
    },
    {
     "key": "fitness",
     "label": "피트니스"
    },
    {
     "key": "etc",
     "label": "그 외 분야"
    }
   ]
  },
  {
   "key": "touchpoint",
   "text": "고객을 주로 어디에서 만나시나요?",
   "type": "single",
   "section": "s1",
   "options": [
    {
     "key": "online",
     "label": "온라인 몰에서만 만나요",
     "hint": "쇼핑몰, 스마트스토어 등"
    },
    {
     "key": "offline",
     "label": "매장이나 현장에서 만나요"
    },
    {
     "key": "both",
     "label": "온라인과 매장 둘 다예요"
    },
    {
     "key": "booking",
     "label": "예약이나 상담을 받아서 만나요",
     "hint": "병원, 학원, 피트니스, 여행 등"
    },
    {
     "key": "platform",
     "label": "배달앱이나 예약 플랫폼 중심이에요",
     "hint": "배민, 네이버 예약, 야놀자 등"
    }
   ]
  },
  {
   "key": "owner",
   "text": "마케팅은 지금 누가 하고 계신가요?",
   "type": "single",
   "section": "s1",
   "options": [
    {
     "key": "self",
     "label": "대표가 직접 해요",
     "hint": "가장 흔한 형태예요"
    },
    {
     "key": "staff",
     "label": "직원이 다른 일과 함께 해요"
    },
    {
     "key": "dedicated",
     "label": "전담 담당자가 있어요"
    },
    {
     "key": "agency",
     "label": "외부 대행사에 맡겨요"
    }
   ]
  },
  {
   "key": "agency_scope",
   "text": "대행사는 어디까지 해주나요?",
   "type": "single",
   "section": "s1",
   "show_when": {
    "q": "owner",
    "in": [
     "agency"
    ]
   },
   "options": [
    {
     "key": "make",
     "label": "문구와 이미지 제작까지요"
    },
    {
     "key": "send",
     "label": "발송까지 대신해요"
    },
    {
     "key": "report",
     "label": "성과 보고까지 해줘요"
    },
    {
     "key": "unsure",
     "label": "계약 범위를 정확히는 몰라요",
     "unknown": true,
     "hint": "흔한 일이에요"
    }
   ]
  },
  {
   "key": "list",
   "text": "고객 연락처는 지금 어디에 있나요?",
   "type": "single",
   "section": "s2",
   "axis": "list",
   "options": [
    {
     "key": "none",
     "label": "따로 모으고 있지 않아요",
     "level": 0,
     "hint": "이 단계에서 시작하는 곳이 많아요"
    },
    {
     "key": "scattered",
     "label": "엑셀이나 장부 여기저기에 있어요",
     "level": 1
    },
    {
     "key": "locked",
     "label": "포스기나 쇼핑몰, ERP 안에만 있어요",
     "level": 1,
     "hint": "그 밖으로 꺼내기 어려운 상태"
    },
    {
     "key": "unified",
     "label": "한곳에 모아 관리하고 있어요",
     "level": 3
    }
   ]
  },
  {
   "key": "locked_tool",
   "text": "어떤 시스템 안에 있나요?",
   "type": "single",
   "section": "s2",
   "show_when": {
    "q": "list",
    "in": [
     "locked"
    ]
   },
   "options": [
    {
     "key": "pos",
     "label": "포스기예요"
    },
    {
     "key": "mall",
     "label": "쇼핑몰이나 스마트스토어예요"
    },
    {
     "key": "erp",
     "label": "ERP나 자체 회원 시스템이에요"
    },
    {
     "key": "booking_sys",
     "label": "예약 관리 프로그램이에요"
    },
    {
     "key": "platform",
     "label": "배달앱이나 예약 플랫폼 안에요",
     "hint": "연락처는 플랫폼이 갖고 있어요"
    }
   ]
  },
  {
   "key": "unified_tool",
   "text": "어디에 모아 두셨나요?",
   "type": "single",
   "section": "s2",
   "show_when": {
    "q": "list",
    "in": [
     "unified"
    ]
   },
   "options": [
    {
     "key": "excel",
     "label": "엑셀이나 스프레드시트 하나로요"
    },
    {
     "key": "crm",
     "label": "CRM이나 회원 관리 프로그램이에요"
    },
    {
     "key": "marketing_tool",
     "label": "다른 마케팅 툴이에요"
    },
    {
     "key": "erp",
     "label": "ERP나 자체 시스템이에요"
    },
    {
     "key": "chat_tool",
     "label": "채널톡 같은 상담 툴이에요"
    }
   ]
  },
  {
   "key": "list_fields",
   "text": "그 명단에는 연락처 말고 무엇이 더 있나요?",
   "type": "single",
   "section": "s2",
   "show_when": {
    "q": "list",
    "in": [
     "unified"
    ]
   },
   "options": [
    {
     "key": "contact_only",
     "label": "연락처와 이름 정도예요"
    },
    {
     "key": "visits",
     "label": "최근 방문이나 구매 날짜까지 있어요"
    },
    {
     "key": "purchase",
     "label": "구매 금액과 횟수까지 있어요"
    },
    {
     "key": "interest",
     "label": "산 상품이나 관심사까지 있어요"
    }
   ]
  },
  {
   "key": "inflow_capture",
   "text": "광고나 검색을 보고 온 고객의 연락처가 남나요?",
   "type": "single",
   "section": "s2",
   "show_when": {
    "q": "list",
    "in": [
     "none",
     "scattered",
     "locked"
    ]
   },
   "options": [
    {
     "key": "no_capture",
     "label": "남지 않아요"
    },
    {
     "key": "event_only",
     "label": "이벤트 때만 남아요"
    },
    {
     "key": "mostly",
     "label": "대부분 남아요"
    },
    {
     "key": "unknown",
     "label": "확인해 본 적 없어요",
     "unknown": true
    }
   ]
  },
  {
   "key": "targeting",
   "text": "가장 최근 발송은 누구에게 보내셨나요?",
   "type": "single",
   "section": "s3",
   "axis": "targeting",
   "options": [
    {
     "key": "never",
     "label": "아직 보낸 적이 없어요",
     "level": 0
    },
    {
     "key": "all",
     "label": "명단 전체에게 보냈어요",
     "level": 0,
     "hint": "가장 흔한 방식이에요"
    },
    {
     "key": "demo",
     "label": "성별이나 나이로 나눠 보냈어요",
     "level": 1
    },
    {
     "key": "behavior",
     "label": "최근 방문이나 구매 여부로 골랐어요",
     "level": 2
    },
    {
     "key": "interest",
     "label": "산 상품이나 관심사까지 보고 골랐어요",
     "level": 3
    }
   ]
  },
  {
   "key": "optout_check",
   "text": "그 발송 뒤에 수신거부를 확인해 보셨나요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "targeting",
    "in": [
     "all"
    ]
   },
   "options": [
    {
     "key": "not_checked",
     "label": "확인해 보지 않았어요",
     "hint": "대부분 그래요"
    },
    {
     "key": "few",
     "label": "몇 명 있었어요"
    },
    {
     "key": "many",
     "label": "평소보다 많았어요"
    },
    {
     "key": "unknown_where",
     "label": "어디에 쌓이는지 몰라요",
     "unknown": true
    }
   ]
  },
  {
   "key": "segment_reuse",
   "text": "고르는 조건은 어떻게 관리하세요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "targeting",
    "in": [
     "interest"
    ]
   },
   "options": [
    {
     "key": "fresh",
     "label": "매번 새로 만들어요"
    },
    {
     "key": "saved",
     "label": "몇 개 저장해 두고 써요"
    },
    {
     "key": "auto",
     "label": "조건이 자동으로 갱신돼요"
    }
   ]
  },
  {
   "key": "sending",
   "text": "지난 한 달 동안 고객에게 몇 번 보내셨나요?",
   "type": "single",
   "section": "s3",
   "axis": "sending",
   "options": [
    {
     "key": "zero",
     "label": "한 번도 안 보냈어요",
     "level": 0
    },
    {
     "key": "s1_2",
     "label": "1번에서 2번이요",
     "level": 1
    },
    {
     "key": "s3_5",
     "label": "3번에서 5번이요",
     "level": 2
    },
    {
     "key": "s6p",
     "label": "6번 이상이요",
     "level": 3
    }
   ]
  },
  {
   "key": "no_send_reason",
   "text": "보내지 않은 이유에 가까운 것은요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "sending",
    "in": [
     "zero"
    ]
   },
   "options": [
    {
     "key": "no_list",
     "label": "보낼 명단이 없어서요"
    },
    {
     "key": "no_copy",
     "label": "무엇을 써야 할지 몰라서요"
    },
    {
     "key": "no_time",
     "label": "시간이 나지 않아서요"
    },
    {
     "key": "no_effect",
     "label": "효과가 없다고 느껴서요"
    }
   ]
  },
  {
   "key": "manual_ratio",
   "text": "그중 직접 명단을 골라 보낸 건 몇 번인가요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "sending",
    "in": [
     "s3_5",
     "s6p"
    ]
   },
   "options": [
    {
     "key": "all_manual",
     "label": "전부 직접 골랐어요"
    },
    {
     "key": "half",
     "label": "절반쯤이요"
    },
    {
     "key": "few",
     "label": "한두 번이요"
    },
    {
     "key": "mostly_auto",
     "label": "대부분 예약이나 자동이에요"
    }
   ]
  },
  {
   "key": "send_tool",
   "text": "보낼 때는 주로 무엇을 쓰세요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "sending",
    "in": [
     "s1_2",
     "s3_5",
     "s6p"
    ]
   },
   "options": [
    {
     "key": "sms_site",
     "label": "문자 발송 사이트요"
    },
    {
     "key": "builtin",
     "label": "포스기나 쇼핑몰에 딸린 발송 기능이요"
    },
    {
     "key": "kakao_agency",
     "label": "카카오 채널이나 대행사요"
    },
    {
     "key": "email_tool",
     "label": "이메일 마케팅 툴이요"
    },
    {
     "key": "mixed",
     "label": "여러 개를 섞어 써요"
    }
   ]
  },
  {
   "key": "repeat",
   "text": "생일 축하나 재방문 안내처럼 반복해서 나가는 메시지가 있나요?",
   "type": "single",
   "section": "s3",
   "axis": "repeat",
   "options": [
    {
     "key": "none",
     "label": "아직 없어요",
     "level": 0,
     "hint": "여기서 시작하는 곳이 많아요"
    },
    {
     "key": "manual",
     "label": "생각날 때 직접 보내요",
     "level": 1
    },
    {
     "key": "scheduled",
     "label": "날짜를 정해 예약 발송해요",
     "level": 2
    },
    {
     "key": "auto",
     "label": "조건이 맞으면 자동으로 나가요",
     "level": 3
    }
   ]
  },
  {
   "key": "manual_count",
   "text": "지난 한 달에 손으로 챙긴 발송이 몇 번쯤인가요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "repeat",
    "in": [
     "manual",
     "scheduled"
    ]
   },
   "options": [
    {
     "key": "c1_2",
     "label": "1번에서 2번이요"
    },
    {
     "key": "c3_5",
     "label": "3번에서 5번이요"
    },
    {
     "key": "c6_10",
     "label": "6번에서 10번이요"
    },
    {
     "key": "c10p",
     "label": "10번 넘게요"
    }
   ]
  },
  {
   "key": "auto_count",
   "text": "지금 몇 종류가 자동으로 돌고 있나요?",
   "type": "single",
   "section": "s3",
   "show_when": {
    "q": "repeat",
    "in": [
     "auto"
    ]
   },
   "options": [
    {
     "key": "a1_2",
     "label": "1개에서 2개요"
    },
    {
     "key": "a3_5",
     "label": "3개에서 5개요"
    },
    {
     "key": "a6p",
     "label": "6개 이상이요"
    },
    {
     "key": "a_unknown",
     "label": "세어 보지 않았어요",
     "unknown": true
    }
   ]
  },
  {
   "key": "production",
   "text": "고객에게 나가는 이미지나 안내 화면은 누가 만드나요?",
   "type": "single",
   "section": "s4",
   "axis": "production",
   "options": [
    {
     "key": "none",
     "label": "따로 만들지 않아요",
     "level": 0,
     "hint": "문자만 보내도 괜찮아요"
    },
    {
     "key": "self",
     "label": "담당자가 직접 만들어요",
     "level": 2
    },
    {
     "key": "outsource",
     "label": "외부에 맡겨요",
     "level": 2
    },
    {
     "key": "inhouse",
     "label": "사내 디자이너가 만들어요",
     "level": 3
    }
   ]
  },
  {
   "key": "prod_time",
   "text": "한 건 만드는 데 보통 얼마나 걸리나요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "production",
    "in": [
     "self"
    ]
   },
   "options": [
    {
     "key": "fast",
     "label": "30분 안쪽이요"
    },
    {
     "key": "halfday",
     "label": "반나절쯤 걸려요"
    },
    {
     "key": "fullday",
     "label": "하루 이상 걸려요"
    },
    {
     "key": "gaveup",
     "label": "만들다 그만둔 적도 있어요",
     "hint": "흔한 일이에요"
    }
   ]
  },
  {
   "key": "prod_refit",
   "text": "만든 이미지를 채널마다 다시 맞추는 일이 있나요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "production",
    "in": [
     "self"
    ]
   },
   "options": [
    {
     "key": "yes",
     "label": "있어요, 채널마다 다시 만들어요"
    },
    {
     "key": "rare",
     "label": "크기만 살짝 고치는 정도예요"
    },
    {
     "key": "no",
     "label": "한 번 만들면 그대로 써요"
    }
   ]
  },
  {
   "key": "prod_leadtime",
   "text": "요청하고 받기까지 며칠 걸리나요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "production",
    "in": [
     "outsource"
    ]
   },
   "options": [
    {
     "key": "sameday",
     "label": "당일에 받아요"
    },
    {
     "key": "d2_3",
     "label": "2일에서 3일이요"
    },
    {
     "key": "week",
     "label": "일주일 넘게 걸려요"
    },
    {
     "key": "varies",
     "label": "그때그때 달라요"
    }
   ]
  },
  {
   "key": "copy_how",
   "text": "그럼 문구는 어떻게 준비하세요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "production",
    "in": [
     "none"
    ]
   },
   "options": [
    {
     "key": "reuse",
     "label": "예전에 보낸 것을 고쳐 써요"
    },
    {
     "key": "new",
     "label": "매번 새로 써요"
    },
    {
     "key": "given",
     "label": "본사나 거래처가 준 것을 써요"
    },
    {
     "key": "no_copy",
     "label": "문구 없이 보낼 때도 있어요"
    }
   ]
  },
  {
   "key": "measure",
   "text": "가장 최근 발송의 결과를 어디까지 보셨나요?",
   "type": "single",
   "section": "s4",
   "axis": "measure",
   "options": [
    {
     "key": "none",
     "label": "결과를 보지 않았어요",
     "level": 0,
     "hint": "확인 방법을 모르셔도 괜찮아요"
    },
    {
     "key": "counts",
     "label": "보낸 건수와 실패 건수요",
     "level": 1
    },
    {
     "key": "clicks",
     "label": "링크를 누른 사람까지요",
     "level": 2
    },
    {
     "key": "revenue",
     "label": "실제 구매나 방문까지요",
     "level": 3
    }
   ]
  },
  {
   "key": "measure_reason",
   "text": "결과를 더 보지 않는 이유에 가까운 것은요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "measure",
    "in": [
     "none",
     "counts"
    ]
   },
   "options": [
    {
     "key": "dont_know",
     "label": "어디서 보는지 몰라서요"
    },
    {
     "key": "no_time",
     "label": "볼 시간이 없어서요"
    },
    {
     "key": "what_next",
     "label": "봐도 무엇을 바꿀지 몰라서요"
    },
    {
     "key": "no_need",
     "label": "지금은 굳이 필요 없어서요"
    }
   ]
  },
  {
   "key": "measure_compare",
   "text": "지난달과 이번 달을 무엇으로 비교하세요?",
   "type": "single",
   "section": "s4",
   "show_when": {
    "q": "measure",
    "in": [
     "revenue"
    ]
   },
   "options": [
    {
     "key": "none",
     "label": "따로 비교하지 않아요"
    },
    {
     "key": "feel",
     "label": "대략 느낌으로요"
    },
    {
     "key": "notes",
     "label": "숫자를 적어 두고 봐요"
    },
    {
     "key": "report",
     "label": "보고서로 정리해요"
    }
   ]
  },
  {
   "key": "scale_customers",
   "text": "관리할 고객 수는 어느 정도인가요?",
   "type": "single",
   "section": "s5",
   "tags": [
    "recommend"
   ],
   "options": [
    {
     "key": "none",
     "label": "아직 없어요"
    },
    {
     "key": "u100k",
     "label": "10만 명 미만",
     "requires": [
      {
       "column": "max_customers",
       "op": "gte_or_null",
       "value": 100000
      }
     ]
    },
    {
     "key": "k100_300k",
     "label": "10만에서 30만 명",
     "requires": [
      {
       "column": "max_customers",
       "op": "gte_or_null",
       "value": 300000
      }
     ]
    },
    {
     "key": "k300_1m",
     "label": "30만에서 100만 명",
     "requires": [
      {
       "column": "max_customers",
       "op": "gte_or_null",
       "value": 1000000
      }
     ]
    },
    {
     "key": "o1m",
     "label": "100만 명 이상",
     "requires": [
      {
       "column": "max_customers",
       "op": "gte_or_null",
       "value": 3000000
      }
     ]
    }
   ]
  },
  {
   "key": "scale_send",
   "text": "한 달 발송량은 어느 정도가 될까요?",
   "type": "single",
   "section": "s5",
   "options": [
    {
     "key": "u10k",
     "label": "1만 건 미만"
    },
    {
     "key": "k10_100k",
     "label": "1만에서 10만 건"
    },
    {
     "key": "k100_500k",
     "label": "10만에서 50만 건"
    },
    {
     "key": "o500k",
     "label": "50만 건 이상"
    }
   ]
  },
  {
   "key": "scale_ai",
   "text": "AI로 문구나 이미지를 만든다면 한 달에 몇 번쯤 쓰실까요?",
   "type": "single",
   "section": "s5",
   "tags": [
    "recommend"
   ],
   "options": [
    {
     "key": "none",
     "label": "안 쓸 것 같아요"
    },
    {
     "key": "u10",
     "label": "월 10회 이하",
     "requires": [
      {
       "column": "ai_credits_per_month",
       "op": "gte",
       "value": 50
      }
     ]
    },
    {
     "key": "m10_50",
     "label": "월 10회에서 50회",
     "requires": [
      {
       "column": "ai_credits_per_month",
       "op": "gte",
       "value": 250
      }
     ]
    },
    {
     "key": "o50",
     "label": "월 50회에서 100회",
     "requires": [
      {
       "column": "ai_credits_per_month",
       "op": "gte",
       "value": 500
      }
     ]
    }
   ]
  }
 ]
}
$$::jsonb, true);
COMMIT;
