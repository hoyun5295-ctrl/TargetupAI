"""
TargetUP AI - AI Parser
Claude API 기반 자연어 → FilterSpec 변환
"""
import json
from datetime import datetime, date, timedelta
from typing import Tuple, Optional, Dict, Any

from .models import FilterSpec, CATEGORIES, REGIONS, SKIN_TYPES
from .llm_client import claude_client


# 파싱용 시스템 프롬프트
PARSER_SYSTEM_PROMPT = """당신은 마케팅 캠페인 타겟팅 전문가입니다.
사용자의 자연어 프롬프트를 분석하여 정확한 타겟팅 조건을 JSON으로 추출합니다.

## 추출해야 할 필드

1. **send_at**: 발송일시 (ISO 형식: "2026-02-10T10:00:00")
   - "2026-02-10 10시" → "2026-02-10T10:00:00"
   - "내일 오전 10시" → (내일 날짜)T10:00:00
   - 없으면 null

2. **gender**: 성별
   - "여성", "여자", "여" → "F"
   - "남성", "남자", "남" → "M"
   - 없으면 null

3. **age_min**, **age_max**: 연령 범위
   - "20대" → age_min: 20, age_max: 29
   - "30~40대" → age_min: 30, age_max: 49
   - 없으면 null

4. **regions**: 지역 목록
   - 가능한 값: 서울, 경기, 인천, 부산, 대구, 광주, 대전, 울산, 세종, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주
   - 없으면 빈 배열 []

5. **skin_types**: 피부타입 목록
   - 가능한 값: 건성, 지성, 복합성, 민감성, 중성
   - 없으면 빈 배열 []

6. **purchased_within_months**: 최근 N개월 구매 O
   - "최근 12개월 구매" → 12
   - "1년 내 구매" → 12
   - 없으면 null

7. **not_purchased_within_months**: 최근 N개월 미구매
   - "최근 6개월 미구매" → 6
   - "6개월간 구매 없는" → 6
   - 없으면 null

8. **categories**: 카테고리 목록
   - 가능한 값: 클렌징, 스킨, 에센스, 로션/크림, 눈가케어, 집중케어, 헤어/바디, 메이크업, 선케어, 립케어, 마스크팩, 건강케어, 수분/보습, 미백/잡티, 트러블/진정, 주름/탄력, 모공/피지, 남성, 맘/임산부
   - "아이크림" → "눈가케어"
   - "세럼" → "에센스"
   - 없으면 빈 배열 []

9. **category_mode**: 카테고리 조합 방식
   - "+", "그리고", "및", "모두", "교집합" → "ALL"
   - "또는", "OR", "하나라도", "합집합" → "ANY"
   - 기본값: "ALL" (2개 이상 카테고리시)

10. **product_name**: 제품명 (문안 생성용)
    - 언급된 제품명 추출
    - 없으면 카테고리에서 추정

11. **discount_rate**: 할인율 (숫자만)
    - "30% 할인" → 30
    - 없으면 null

12. **event_name**: 이벤트/행사명
    - "할인행사", "특별 세일" 등
    - 없으면 null

13. **is_one_plus_one**: 1+1 여부
    - "1+1", "원플원" → true
    - 없으면 false

## 응답 형식

반드시 아래 JSON 형식으로만 응답하세요:

```json
{
  "send_at": "2026-02-10T10:00:00",
  "gender": "F",
  "age_min": 20,
  "age_max": 29,
  "regions": ["서울"],
  "skin_types": [],
  "purchased_within_months": 12,
  "not_purchased_within_months": 6,
  "categories": ["눈가케어", "에센스"],
  "category_mode": "ALL",
  "product_name": "산뜻크림",
  "discount_rate": 30,
  "event_name": "할인행사",
  "is_one_plus_one": false
}
```

## 주의사항
- 확실하지 않은 필드는 null 또는 빈 배열로
- 날짜 파싱시 오늘 날짜 기준으로 계산
- 카테고리는 반드시 허용된 값 중에서만 선택
"""


class AIParser:
    """AI 기반 자연어 파서"""
    
    def __init__(self):
        self._today = None
    
    @property
    def today(self) -> date:
        """오늘 날짜 (테스트용 오버라이드 가능)"""
        if self._today:
            return self._today
        return datetime.now().date()
    
    def parse(self, prompt: str) -> Tuple[FilterSpec, datetime, Dict[str, Any]]:
        """
        자연어 프롬프트 파싱
        
        Args:
            prompt: 사용자 입력 프롬프트
            
        Returns:
            (FilterSpec, send_at datetime, extra_context dict)
        """
        if not claude_client.is_available:
            raise RuntimeError("Claude API를 사용할 수 없습니다.")
        
        # 오늘 날짜 컨텍스트 추가
        today_str = self.today.strftime("%Y-%m-%d")
        user_message = f"오늘 날짜: {today_str}\n\n프롬프트: {prompt}"
        
        # Claude API 호출
        result = claude_client.chat_json(
            messages=[{"role": "user", "content": user_message}],
            system=PARSER_SYSTEM_PROMPT,
            temperature=0.2  # 정확성을 위해 낮은 온도
        )
        
        if not result:
            raise ValueError("프롬프트 파싱 실패")
        
        # FilterSpec 생성
        spec = self._build_spec(result, prompt)
        
        # send_at 파싱
        send_at = self._parse_send_at(result.get('send_at'))
        
        # as_of_date 설정 (발송일 전일)
        spec.as_of_date = send_at.date() - timedelta(days=1)
        
        # 추가 컨텍스트 (문안 생성용)
        extra_context = {
            'product_name': result.get('product_name', ''),
            'discount_rate': result.get('discount_rate'),
            'event_name': result.get('event_name', ''),
            'is_one_plus_one': result.get('is_one_plus_one', False)
        }
        
        return spec, send_at, extra_context
    
    def _build_spec(self, result: Dict[str, Any], prompt: str) -> FilterSpec:
        """파싱 결과로 FilterSpec 생성"""
        # 카테고리 검증
        categories = result.get('categories', [])
        valid_categories = [c for c in categories if c in CATEGORIES]
        
        # 지역 검증
        regions = result.get('regions', [])
        valid_regions = [r for r in regions if r in REGIONS]
        
        # 피부타입 검증
        skin_types = result.get('skin_types', [])
        valid_skin_types = [s for s in skin_types if s in SKIN_TYPES]
        
        return FilterSpec(
            gender=result.get('gender'),
            age_min=result.get('age_min'),
            age_max=result.get('age_max'),
            regions=valid_regions,
            skin_types=valid_skin_types,
            purchased_within_months=result.get('purchased_within_months'),
            not_purchased_within_months=result.get('not_purchased_within_months'),
            categories=valid_categories,
            category_mode=result.get('category_mode', 'ALL'),
            raw_prompt=prompt
        )
    
    def _parse_send_at(self, send_at_str: Optional[str]) -> datetime:
        """발송일시 문자열 파싱"""
        if send_at_str:
            try:
                return datetime.fromisoformat(send_at_str)
            except ValueError:
                pass
        
        # 기본값: 내일 오전 10시
        tomorrow = self.today + timedelta(days=1)
        return datetime(tomorrow.year, tomorrow.month, tomorrow.day, 10, 0, 0)


# 싱글톤 인스턴스
ai_parser = AIParser()


def parse_with_ai(prompt: str) -> Tuple[FilterSpec, datetime, Dict[str, Any]]:
    """
    AI 파서 편의 함수
    
    Returns:
        (FilterSpec, send_at, extra_context)
    """
    return ai_parser.parse(prompt)
