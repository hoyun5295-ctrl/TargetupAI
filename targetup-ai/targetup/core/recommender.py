"""
TargetUP AI - Message Recommender
페르소나 기반 문안 3안 + 자동 추천
"""
import re
from datetime import datetime, date
from typing import List, Tuple, Optional, Dict
from dataclasses import dataclass

from .models import FilterSpec, MessageVariant


@dataclass
class PromptContext:
    """프롬프트에서 추출한 컨텍스트"""
    product_name: str = ""
    discount_rate: Optional[int] = None
    is_one_plus_one: bool = False
    event_name: str = ""
    days_until_send: int = 0
    is_churn_target: bool = False  # 이탈군 여부
    target_age_group: str = ""  # 20대, 30대 등
    target_gender: str = ""  # F, M
    target_concerns: List[str] = None  # 피부고민 카테고리
    
    def __post_init__(self):
        if self.target_concerns is None:
            self.target_concerns = []


class MessageRecommender:
    """문안 추천 엔진"""
    
    # 수신거부 문구
    OPT_OUT_SMS = "무료수신거부 080-XXX-XXXX"
    OPT_OUT_LMS = "무료 수신거부: 080-XXX-XXXX"
    
    # SMS 최대 바이트 (euc-kr)
    SMS_MAX_BYTES = 90
    LMS_MAX_BYTES = 2000
    
    def __init__(self):
        pass
    
    def recommend(self, 
                  prompt: str, 
                  spec: FilterSpec,
                  send_at: datetime,
                  include_ad_marker: bool = True) -> List[MessageVariant]:
        """
        문안 3안 생성 + 자동 추천 점수 계산
        Returns: 점수 순으로 정렬된 MessageVariant 리스트
        """
        # 컨텍스트 추출
        context = self._extract_context(prompt, spec, send_at)
        
        # 3안 생성
        variants = [
            self._generate_variant_a(context, include_ad_marker),  # 혜택 직결
            self._generate_variant_b(context, include_ad_marker),  # 긴급/타이밍
            self._generate_variant_c(context, include_ad_marker),  # 웰컴백/개인화
        ]
        
        # 자동 추천 점수 계산
        self._calculate_scores(variants, context)
        
        # 점수 순 정렬 (내림차순)
        variants.sort(key=lambda v: v.score, reverse=True)
        
        return variants
    
    def _extract_context(self, prompt: str, spec: FilterSpec, send_at: datetime) -> PromptContext:
        """프롬프트에서 컨텍스트 추출"""
        context = PromptContext()
        
        # 제품명 추출 (간단한 패턴)
        product_match = re.search(r'([가-힣]+크림|[가-힣]+세럼|[가-힣]+에센스|[가-힣]+토너|[가-힣]+팩)', prompt)
        if product_match:
            context.product_name = product_match.group(1)
        else:
            # 카테고리에서 추정
            if spec.categories:
                context.product_name = spec.categories[0]
            else:
                context.product_name = "신제품"
        
        # 할인율 추출
        discount_match = re.search(r'(\d{1,2})\s*%\s*(할인|OFF|세일)', prompt)
        if discount_match:
            context.discount_rate = int(discount_match.group(1))
        
        # 1+1 추출
        if '1+1' in prompt or '원플원' in prompt or '1플1' in prompt:
            context.is_one_plus_one = True
        
        # 이벤트명 추출
        event_match = re.search(r'([가-힣]+\s*행사|[가-힣]+\s*이벤트|[가-힣]+\s*세일)', prompt)
        if event_match:
            context.event_name = event_match.group(1)
        else:
            context.event_name = "특별 혜택"
        
        # 발송까지 남은 일수
        today = datetime.now().date()
        context.days_until_send = (send_at.date() - today).days
        
        # 이탈군 여부 (최근 6개월 미구매 조건이 있으면)
        context.is_churn_target = spec.not_purchased_within_months is not None
        
        # 타겟 연령대
        if spec.age_min is not None:
            context.target_age_group = f"{spec.age_min}대"
        
        # 타겟 성별
        context.target_gender = spec.gender or ""
        
        # 피부고민 카테고리
        concern_cats = ['수분/보습', '미백/잡티', '트러블/진정', '주름/탄력', '모공/피지']
        context.target_concerns = [c for c in spec.categories if c in concern_cats]
        
        return context
    
    def _generate_variant_a(self, ctx: PromptContext, include_ad: bool) -> MessageVariant:
        """A안: 혜택 직결 (짧고 직관)"""
        ad_marker = "(광고)" if include_ad else ""
        
        # 할인/1+1 강조
        if ctx.discount_rate:
            benefit = f"{ctx.discount_rate}% 할인"
        elif ctx.is_one_plus_one:
            benefit = "1+1 특가"
        else:
            benefit = "특별 할인"
        
        sms_text = f"{ad_marker}[아이소이] {ctx.product_name} {benefit}! 지금 바로 확인▶ {self.OPT_OUT_SMS}"
        
        lms_text = f"""{ad_marker}
[아이소이] {ctx.event_name}

✨ {ctx.product_name} {benefit} ✨

피부 고민 해결의 시작!
지금 바로 확인하세요.

▶ 구매하기: isoi.co.kr

{self.OPT_OUT_LMS}"""
        
        return MessageVariant(
            variant_id='A',
            variant_name='혜택 직결',
            sms_text=sms_text.strip(),
            lms_text=lms_text.strip()
        )
    
    def _generate_variant_b(self, ctx: PromptContext, include_ad: bool) -> MessageVariant:
        """B안: 긴급/타이밍 (D-? / 오늘마감)"""
        ad_marker = "(광고)" if include_ad else ""
        
        # 타이밍 강조
        if ctx.days_until_send <= 0:
            timing = "⏰ 오늘 마감!"
            timing_short = "오늘마감"
        elif ctx.days_until_send <= 3:
            timing = f"⏰ D-{ctx.days_until_send} 마감 임박!"
            timing_short = f"D-{ctx.days_until_send}"
        else:
            timing = "🎁 한정 기간 특가!"
            timing_short = "한정특가"
        
        if ctx.discount_rate:
            benefit = f"{ctx.discount_rate}%"
        else:
            benefit = "특가"
        
        sms_text = f"{ad_marker}[아이소이] {timing_short}! {ctx.product_name} {benefit} 놓치지마세요▶ {self.OPT_OUT_SMS}"
        
        lms_text = f"""{ad_marker}
[아이소이] {timing}

{ctx.event_name} 마감이 다가옵니다!

🔥 {ctx.product_name}
{'💰 ' + str(ctx.discount_rate) + '% 할인' if ctx.discount_rate else '🎁 특별 혜택'}

서두르세요, 수량 한정!

▶ 지금 구매: isoi.co.kr

{self.OPT_OUT_LMS}"""
        
        return MessageVariant(
            variant_id='B',
            variant_name='긴급/타이밍',
            sms_text=sms_text.strip(),
            lms_text=lms_text.strip()
        )
    
    def _generate_variant_c(self, ctx: PromptContext, include_ad: bool) -> MessageVariant:
        """C안: 웰컴백/개인화 (이탈군 특화)"""
        ad_marker = "(광고)" if include_ad else ""
        
        # 개인화 메시지
        if ctx.is_churn_target:
            greeting = "오랜만이에요! 다시 만나 반가워요 💕"
            cta = "다시 만나는 기념, 특별한 혜택을 준비했어요."
        else:
            greeting = "소중한 고객님을 위한 특별 혜택 💝"
            cta = "고객님만을 위한 맞춤 혜택이에요."
        
        # 연령대/피부고민 맞춤
        personalized = ""
        if ctx.target_concerns:
            concern = ctx.target_concerns[0].split('/')[0]  # 첫 번째 고민
            personalized = f"{concern} 고민 해결에 딱!"
        elif ctx.target_age_group:
            personalized = f"{ctx.target_age_group} 피부 맞춤 케어"
        
        if ctx.discount_rate:
            benefit = f"{ctx.discount_rate}% 할인"
        else:
            benefit = "특별 혜택"
        
        sms_text = f"{ad_marker}[아이소이] {greeting[:10]}.. {ctx.product_name} {benefit} 준비했어요▶ {self.OPT_OUT_SMS}"
        
        lms_text = f"""{ad_marker}
[아이소이] {greeting}

{cta}

💜 {ctx.product_name} {benefit}
{personalized}

오직 고객님만을 위한 기회를 놓치지 마세요!

▶ 혜택 받기: isoi.co.kr

{self.OPT_OUT_LMS}"""
        
        return MessageVariant(
            variant_id='C',
            variant_name='웰컴백/개인화',
            sms_text=sms_text.strip(),
            lms_text=lms_text.strip()
        )
    
    def _calculate_scores(self, variants: List[MessageVariant], ctx: PromptContext):
        """자동 추천 점수 계산"""
        for v in variants:
            score = 50.0  # 기본 점수
            
            # A안 (혜택 직결) 가산점
            if v.variant_id == 'A':
                if ctx.discount_rate and ctx.discount_rate >= 30:
                    score += 20  # 할인율 30% 이상
                if ctx.is_one_plus_one:
                    score += 15  # 1+1
            
            # B안 (긴급/타이밍) 가산점
            elif v.variant_id == 'B':
                if ctx.days_until_send <= 3:
                    score += 25  # D-3 이하
                elif ctx.days_until_send <= 7:
                    score += 10  # D-7 이하
            
            # C안 (웰컴백) 가산점
            elif v.variant_id == 'C':
                if ctx.is_churn_target:
                    score += 30  # 이탈군 타겟
                if ctx.target_concerns:
                    score += 10  # 피부고민 매칭
            
            v.score = score
    
    def get_recommended_variant(self, variants: List[MessageVariant]) -> MessageVariant:
        """최고 점수 문안 반환"""
        return max(variants, key=lambda v: v.score)
    
    def format_byte_info(self, text: str) -> str:
        """바이트 정보 포맷팅"""
        byte_len = len(text.encode('euc-kr', errors='replace'))
        if byte_len <= self.SMS_MAX_BYTES:
            return f"SMS ({byte_len}/90 bytes)"
        else:
            return f"LMS ({byte_len} bytes)"


# 싱글톤 인스턴스
message_recommender = MessageRecommender()
