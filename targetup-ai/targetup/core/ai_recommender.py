"""
TargetUP AI - AI Message Recommender
Claude API 기반 브랜드 맞춤 문안 생성
"""
import os
from datetime import datetime
from typing import List, Optional, Dict, Any

from .models import FilterSpec, MessageVariant
from .llm_client import claude_client


# 브랜드 컨텍스트 시스템 프롬프트
BRAND_SYSTEM_PROMPT = """당신은 {brand_name}의 수석 마케팅 카피라이터입니다.

## 브랜드 정체성
- 브랜드: {brand_name}
- 톤앤매너: {brand_tone}
- 핵심 가치: 자연주의 화장품, 피부 과학, 진정성

## 문안 작성 규칙

### SMS (90바이트 이하, EUC-KR 기준)
- 짧고 임팩트 있게
- 핵심 혜택 + CTA
- 형식: (광고)[{brand_name}] 메시지 ▶ 무료수신거부 080-XXX-XXXX

### LMS (2000바이트 이하)
- 감성적 인사 + 혜택 상세 + CTA
- 이모지 적절히 활용
- 형식: 
(광고)
[{brand_name}] 제목

본문 내용

▶ 링크: isoi.co.kr

무료 수신거부: 080-XXX-XXXX

## 타겟 페르소나별 톤 가이드

### 20대
- 트렌디, 캐주얼, 이모지 활용
- "겟잇뷰티", "꿀피부", "데일리템"

### 30대
- 워라밸, 효율, 실용적 혜택 강조
- "시간 절약", "올인원", "간편 케어"

### 40대 이상
- 진중함, 효능/성분 강조
- "탄력", "주름 개선", "프리미엄 케어"

### 이탈 고객 (6개월+ 미구매)
- 웰컴백 톤, 그리움, 특별 혜택
- "오랜만이에요", "다시 만나서 반가워요"

## 출력 형식

반드시 아래 JSON 형식으로 3가지 문안을 생성하세요:

```json
{{
  "variants": [
    {{
      "variant_id": "A",
      "variant_name": "혜택 직결",
      "concept": "핵심 혜택을 짧고 강하게",
      "sms_text": "(광고)[{brand_name}] ...",
      "lms_text": "(광고)\\n[{brand_name}] ...\\n\\n...\\n\\n▶ 구매하기: isoi.co.kr\\n\\n무료 수신거부: 080-XXX-XXXX",
      "score": 70
    }},
    {{
      "variant_id": "B",
      "variant_name": "긴급/타이밍",
      "concept": "마감 임박, 한정 수량",
      "sms_text": "...",
      "lms_text": "...",
      "score": 60
    }},
    {{
      "variant_id": "C",
      "variant_name": "웰컴백/개인화",
      "concept": "이탈 고객 특화, 개인 맞춤",
      "sms_text": "...",
      "lms_text": "...",
      "score": 80
    }}
  ],
  "recommendation": "C",
  "recommendation_reason": "이탈 고객 타겟이므로 웰컴백 톤이 효과적"
}}
```

## 점수 산정 기준
- 할인율 30% 이상 또는 1+1: A안 +20점
- 이탈 고객 타겟: C안 +30점
- 발송일 D-3 이하: B안 +25점
- 기본 점수: 50점
"""


class AIMessageRecommender:
    """AI 기반 문안 추천"""
    
    # 수신거부 문구
    OPT_OUT_SMS = "무료수신거부 080-XXX-XXXX"
    OPT_OUT_LMS = "무료 수신거부: 080-XXX-XXXX"
    
    def __init__(self):
        self.brand_name = os.getenv('BRAND_NAME', '아이소이')
        self.brand_tone = os.getenv('BRAND_TONE', '자연주의, 따뜻함, 신뢰, 전문성')
    
    def recommend(self,
                  prompt: str,
                  spec: FilterSpec,
                  send_at: datetime,
                  extra_context: Optional[Dict[str, Any]] = None,
                  past_campaigns: Optional[List[Dict]] = None) -> List[MessageVariant]:
        """
        AI 기반 문안 3안 생성
        
        Args:
            prompt: 원본 프롬프트
            spec: 타겟팅 조건
            send_at: 발송일시
            extra_context: 추가 컨텍스트 (제품명, 할인율 등)
            past_campaigns: 참조할 과거 캠페인 (RAG)
            
        Returns:
            점수순 정렬된 MessageVariant 리스트
        """
        if not claude_client.is_available:
            raise RuntimeError("Claude API를 사용할 수 없습니다.")
        
        extra_context = extra_context or {}
        
        # 시스템 프롬프트 구성
        system_prompt = BRAND_SYSTEM_PROMPT.format(
            brand_name=self.brand_name,
            brand_tone=self.brand_tone
        )
        
        # 사용자 메시지 구성
        user_message = self._build_user_message(
            prompt, spec, send_at, extra_context, past_campaigns
        )
        
        # Claude API 호출
        result = claude_client.chat_json(
            messages=[{"role": "user", "content": user_message}],
            system=system_prompt,
            temperature=0.7  # 창의성을 위해 약간 높은 온도
        )
        
        if not result or 'variants' not in result:
            # 폴백: 기본 템플릿 사용
            return self._fallback_variants(extra_context)
        
        # MessageVariant 객체로 변환
        variants = []
        for v in result['variants']:
            variant = MessageVariant(
                variant_id=v.get('variant_id', 'A'),
                variant_name=v.get('variant_name', ''),
                sms_text=v.get('sms_text', ''),
                lms_text=v.get('lms_text', ''),
                score=float(v.get('score', 50))
            )
            variants.append(variant)
        
        # 점수순 정렬
        variants.sort(key=lambda x: x.score, reverse=True)
        
        return variants
    
    def _build_user_message(self,
                            prompt: str,
                            spec: FilterSpec,
                            send_at: datetime,
                            extra_context: Dict[str, Any],
                            past_campaigns: Optional[List[Dict]]) -> str:
        """사용자 메시지 구성"""
        
        # 기본 정보
        message = f"""## 캠페인 정보
- 원본 프롬프트: {prompt}
- 발송일시: {send_at.strftime('%Y-%m-%d %H:%M')}
- 발송까지 D-{(send_at.date() - datetime.now().date()).days}

## 타겟 조건
"""
        
        # 타겟 조건 추가
        if spec.gender:
            message += f"- 성별: {'여성' if spec.gender == 'F' else '남성'}\n"
        
        if spec.age_min is not None:
            if spec.age_min == spec.age_max - 9:
                message += f"- 연령대: {spec.age_min}대\n"
            else:
                message += f"- 연령대: {spec.age_min}~{spec.age_max}세\n"
        
        if spec.regions:
            message += f"- 지역: {', '.join(spec.regions)}\n"
        
        if spec.skin_types:
            message += f"- 피부타입: {', '.join(spec.skin_types)}\n"
        
        if spec.purchased_within_months:
            message += f"- 최근 {spec.purchased_within_months}개월 구매 고객\n"
        
        if spec.not_purchased_within_months:
            message += f"- 최근 {spec.not_purchased_within_months}개월 미구매 (이탈 위험군)\n"
        
        if spec.categories:
            mode = '교집합(모두 구매)' if spec.category_mode == 'ALL' else '합집합(하나라도)'
            message += f"- 카테고리: {', '.join(spec.categories)} ({mode})\n"
        
        # 이벤트/제품 정보
        message += "\n## 이벤트 정보\n"
        
        if extra_context.get('product_name'):
            message += f"- 제품: {extra_context['product_name']}\n"
        
        if extra_context.get('discount_rate'):
            message += f"- 할인율: {extra_context['discount_rate']}%\n"
        
        if extra_context.get('event_name'):
            message += f"- 이벤트: {extra_context['event_name']}\n"
        
        if extra_context.get('is_one_plus_one'):
            message += "- 1+1 행사\n"
        
        # 과거 캠페인 참조 (RAG)
        if past_campaigns:
            message += "\n## 참고: 과거 성공 캠페인\n"
            for i, camp in enumerate(past_campaigns[:3], 1):
                message += f"\n### 캠페인 {i}\n"
                message += f"- 타겟: {camp.get('target_desc', 'N/A')}\n"
                message += f"- 문안: {camp.get('sms_text', 'N/A')[:50]}...\n"
                if camp.get('ctr'):
                    message += f"- 성과(CTR): {camp['ctr']}%\n"
        
        message += "\n위 조건을 바탕으로 3가지 문안(A/B/C)을 생성해주세요."
        
        return message
    
    def _fallback_variants(self, extra_context: Dict[str, Any]) -> List[MessageVariant]:
        """폴백: 기본 템플릿 문안"""
        product = extra_context.get('product_name', '신제품')
        discount = extra_context.get('discount_rate', '')
        benefit = f"{discount}% 할인" if discount else "특별 혜택"
        
        return [
            MessageVariant(
                variant_id='A',
                variant_name='혜택 직결',
                sms_text=f"(광고)[{self.brand_name}] {product} {benefit}! 지금 확인▶ {self.OPT_OUT_SMS}",
                lms_text=f"(광고)\n[{self.brand_name}] {product} {benefit}\n\n지금 바로 확인하세요!\n\n▶ isoi.co.kr\n\n{self.OPT_OUT_LMS}",
                score=70
            ),
            MessageVariant(
                variant_id='B',
                variant_name='긴급/타이밍',
                sms_text=f"(광고)[{self.brand_name}] 마감임박! {product} {benefit}▶ {self.OPT_OUT_SMS}",
                lms_text=f"(광고)\n[{self.brand_name}] ⏰ 마감 임박!\n\n{product} {benefit}\n\n서두르세요!\n\n▶ isoi.co.kr\n\n{self.OPT_OUT_LMS}",
                score=60
            ),
            MessageVariant(
                variant_id='C',
                variant_name='웰컴백',
                sms_text=f"(광고)[{self.brand_name}] 오랜만이에요💕 {product} {benefit}▶ {self.OPT_OUT_SMS}",
                lms_text=f"(광고)\n[{self.brand_name}] 오랜만이에요 💕\n\n다시 만나 반가워요!\n{product} {benefit}\n\n▶ isoi.co.kr\n\n{self.OPT_OUT_LMS}",
                score=50
            )
        ]


# 싱글톤 인스턴스
ai_recommender = AIMessageRecommender()


def generate_messages_with_ai(prompt: str,
                               spec: FilterSpec,
                               send_at: datetime,
                               extra_context: Optional[Dict[str, Any]] = None,
                               past_campaigns: Optional[List[Dict]] = None) -> List[MessageVariant]:
    """
    AI 문안 생성 편의 함수
    """
    return ai_recommender.recommend(prompt, spec, send_at, extra_context, past_campaigns)
