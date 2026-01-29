"""
TargetUP AI - Query Engine
자연어 → FilterSpec → 타겟 필터링
"""
import re
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
from typing import Tuple, List, Optional, Set, Dict, Any
import pandas as pd
import numpy as np

from .models import FilterSpec, CATEGORIES, REGIONS, SKIN_TYPES, STAGES, CONCERNS
from .data_store import data_cache


class QueryParser:
    """자연어 프롬프트 파서"""
    
    def __init__(self):
        # 정규식 패턴들
        self._compile_patterns()
    
    def _compile_patterns(self):
        """정규식 패턴 컴파일"""
        
        # 발송일시 패턴
        self.datetime_patterns = [
            # 2026-02-10 10시
            r'(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2})시',
            # 2026.02.10 오전 10시
            r'(\d{4})\.(\d{1,2})\.(\d{1,2})\s*(오전|오후)?\s*(\d{1,2})시',
            # 2월 10일 10시
            r'(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시',
            # 내일 10시, 모레 14시
            r'(내일|모레|오늘)\s*(\d{1,2})시',
        ]
        
        # 성별 패턴
        self.gender_patterns = {
            'F': r'(여성|여자|여|woman|female)',
            'M': r'(남성|남자|남|man|male)'
        }
        
        # 연령대 패턴
        self.age_patterns = [
            # 20대, 30대
            r'(\d{1,2})대',
            # 20~30대
            r'(\d{1,2})~(\d{1,2})대',
            # 25세~35세
            r'(\d{1,2})세~(\d{1,2})세',
            # 25-35세
            r'(\d{1,2})-(\d{1,2})세',
        ]
        
        # 기간 조건 패턴
        self.period_patterns = {
            # 최근 N개월 구매 O (구매했고, 구매한, 구매이력)
            'purchased_within': r'최근\s*(\d{1,2})\s*개월\s*(구매|주문)\s*(했|한|이력|O)',
            # 최근 N개월 미구매, 구매 X
            'not_purchased_within': r'최근\s*(\d{1,2})\s*개월\s*(미구매|구매\s*X|구매\s*안|주문\s*X)',
        }
        
        # 카테고리 모드 패턴
        self.category_mode_patterns = {
            'ALL': r'(교집합|AND|모두\s*구매|둘\s*다|전부)',
            'ANY': r'(합집합|OR|하나라도|또는)'
        }
    
    def parse(self, prompt: str, base_date: Optional[date] = None) -> Tuple[FilterSpec, datetime]:
        """
        프롬프트 파싱
        Returns: (FilterSpec, send_at datetime)
        """
        if base_date is None:
            base_date = datetime.now().date()
        
        spec = FilterSpec(raw_prompt=prompt)
        
        # 1. 발송일시 파싱
        send_at = self._parse_datetime(prompt, base_date)
        
        # 2. as_of_date 계산 (발송일 전일)
        spec.as_of_date = send_at.date() - timedelta(days=1)
        
        # 3. 성별 파싱
        spec.gender = self._parse_gender(prompt)
        
        # 4. 연령대 파싱
        spec.age_min, spec.age_max = self._parse_age(prompt)
        
        # 5. 지역 파싱
        spec.regions = self._parse_regions(prompt)
        
        # 6. 피부타입 파싱
        spec.skin_types = self._parse_skin_types(prompt)
        
        # 7. 기간 조건 파싱
        spec.purchased_within_months = self._parse_period(prompt, 'purchased_within')
        spec.not_purchased_within_months = self._parse_period(prompt, 'not_purchased_within')
        
        # 8. 카테고리 파싱
        spec.categories = self._parse_categories(prompt)
        
        # 9. 카테고리 모드 파싱 (기본 ANY)
        spec.category_mode = self._parse_category_mode(prompt)
        
        return spec, send_at
    
    def _parse_datetime(self, prompt: str, base_date: date) -> datetime:
        """발송일시 파싱"""
        now = datetime.now()
        
        # 패턴 1: 2026-02-10 10시
        match = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2})시', prompt)
        if match:
            y, m, d, h = map(int, match.groups())
            return datetime(y, m, d, h, 0, 0)
        
        # 패턴 2: 2026.02.10 (오전/오후) 10시
        match = re.search(r'(\d{4})\.(\d{1,2})\.(\d{1,2})\s*(오전|오후)?\s*(\d{1,2})시', prompt)
        if match:
            y, m, d = int(match.group(1)), int(match.group(2)), int(match.group(3))
            ampm = match.group(4)
            h = int(match.group(5))
            if ampm == '오후' and h < 12:
                h += 12
            return datetime(y, m, d, h, 0, 0)
        
        # 패턴 3: 2월 10일 10시 (올해 기준)
        match = re.search(r'(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시', prompt)
        if match:
            m, d, h = map(int, match.groups())
            y = base_date.year
            # 이미 지난 날짜면 내년
            target = date(y, m, d)
            if target < base_date:
                y += 1
            return datetime(y, m, d, h, 0, 0)
        
        # 패턴 4: 내일/모레/오늘 10시
        match = re.search(r'(내일|모레|오늘)\s*(\d{1,2})시', prompt)
        if match:
            day_str, h = match.group(1), int(match.group(2))
            if day_str == '오늘':
                target = base_date
            elif day_str == '내일':
                target = base_date + timedelta(days=1)
            else:  # 모레
                target = base_date + timedelta(days=2)
            return datetime(target.year, target.month, target.day, h, 0, 0)
        
        # 기본값: 내일 오전 10시
        tomorrow = base_date + timedelta(days=1)
        return datetime(tomorrow.year, tomorrow.month, tomorrow.day, 10, 0, 0)
    
    def _parse_gender(self, prompt: str) -> Optional[str]:
        """성별 파싱"""
        prompt_lower = prompt.lower()
        for gender, pattern in self.gender_patterns.items():
            if re.search(pattern, prompt_lower):
                return gender
        return None
    
    def _parse_age(self, prompt: str) -> Tuple[Optional[int], Optional[int]]:
        """연령대 파싱"""
        # 범위 패턴: 20~30대, 20-30대
        match = re.search(r'(\d{1,2})[~\-](\d{1,2})대', prompt)
        if match:
            min_age = int(match.group(1))
            max_age = int(match.group(2)) + 9
            return min_age, max_age
        
        # 세 범위: 25세~35세, 25-35세
        match = re.search(r'(\d{1,2})세[~\-](\d{1,2})세', prompt)
        if match:
            return int(match.group(1)), int(match.group(2))
        
        # 단일 연령대: 20대
        match = re.search(r'(\d{1,2})대', prompt)
        if match:
            age_base = int(match.group(1))
            return age_base, age_base + 9
        
        return None, None
    
    def _parse_regions(self, prompt: str) -> List[str]:
        """지역 파싱"""
        found = []
        for region in REGIONS:
            if region in prompt:
                found.append(region)
        return found
    
    def _parse_skin_types(self, prompt: str) -> List[str]:
        """피부타입 파싱"""
        found = []
        for skin_type in SKIN_TYPES:
            if skin_type in prompt:
                found.append(skin_type)
        return found
    
    def _parse_period(self, prompt: str, period_type: str) -> Optional[int]:
        """기간 조건 파싱"""
        pattern = self.period_patterns.get(period_type)
        if pattern:
            match = re.search(pattern, prompt)
            if match:
                return int(match.group(1))
        return None
    
    def _parse_categories(self, prompt: str) -> List[str]:
        """카테고리 파싱"""
        found = []
        for cat in CATEGORIES:
            # 카테고리명 또는 관련 키워드 검색
            if cat in prompt:
                found.append(cat)
            # 슬래시 포함 카테고리 처리
            elif '/' in cat:
                parts = cat.split('/')
                if any(p in prompt for p in parts):
                    found.append(cat)
        return found
    
    def _parse_category_mode(self, prompt: str) -> str:
        """카테고리 조합 모드 파싱 (기본 ALL for 구매이력 조건)"""
        # 명시적 합집합 키워드
        if re.search(self.category_mode_patterns['ANY'], prompt):
            return 'ANY'
        # 명시적 교집합 키워드
        if re.search(self.category_mode_patterns['ALL'], prompt):
            return 'ALL'
        # "이며", "이고", "+", "AND" 등이 있으면 교집합
        if re.search(r'(이며|이고|\+|&|함께|모두)', prompt):
            return 'ALL'
        # 기본값: 카테고리가 2개 이상이면 ALL (교집합이 더 정밀 타겟팅)
        return 'ALL'


class QueryEngine:
    """타겟 필터링 엔진"""
    
    def __init__(self):
        self.parser = QueryParser()
    
    def execute(self, prompt: str, 
                base_date: Optional[date] = None) -> Tuple[FilterSpec, datetime, int, pd.DataFrame, List[str]]:
        """
        쿼리 실행
        Returns: (spec, send_at, total_count, sample_df, all_customer_ids)
        """
        # 데이터 로드 확인
        if not data_cache.is_loaded:
            data_cache.load()
        
        # 파싱
        spec, send_at = self.parser.parse(prompt, base_date)
        
        # 필터링
        customer_ids = self._filter_customers(spec)
        total_count = len(customer_ids)
        
        # 샘플 추출 (최대 50명)
        sample_ids = list(customer_ids)[:50]
        sample_df = data_cache.customers[
            data_cache.customers['customer_id'].isin(sample_ids)
        ].copy()
        
        # 나이 컬럼 추가
        current_year = datetime.now().year
        sample_df['age'] = current_year - sample_df['birth_year']
        
        return spec, send_at, total_count, sample_df, list(customer_ids)
    
    def _filter_customers(self, spec: FilterSpec) -> Set[str]:
        """고객 필터링 (불리언 마스크 사용)"""
        df = data_cache.customers
        
        # 기본 마스크 (전체 True)
        mask = pd.Series([True] * len(df), index=df.index)
        
        # 1. 성별 필터
        if spec.gender:
            mask = mask & (df['gender'] == spec.gender)
        
        # 2. 연령대 필터
        current_year = datetime.now().year
        if spec.age_min is not None:
            max_birth_year = current_year - spec.age_min
            mask = mask & (df['birth_year'] <= max_birth_year)
        if spec.age_max is not None:
            min_birth_year = current_year - spec.age_max
            mask = mask & (df['birth_year'] >= min_birth_year)
        
        # 3. 지역 필터
        if spec.regions:
            mask = mask & (df['region'].isin(spec.regions))
        
        # 4. 피부타입 필터
        if spec.skin_types:
            mask = mask & (df['skin_type'].isin(spec.skin_types))
        
        # 5. 기간 조건 필터
        as_of = spec.as_of_date or datetime.now().date()
        
        # 최근 N개월 구매 O
        if spec.purchased_within_months:
            cutoff_date = as_of - relativedelta(months=spec.purchased_within_months)
            cutoff_dt = pd.Timestamp(cutoff_date)
            mask = mask & (df['last_order_at'] >= cutoff_dt)
        
        # 최근 N개월 미구매
        if spec.not_purchased_within_months:
            cutoff_date = as_of - relativedelta(months=spec.not_purchased_within_months)
            cutoff_dt = pd.Timestamp(cutoff_date)
            # NULL이거나 cutoff 이전
            no_purchase = df['last_order_at'].isna() | (df['last_order_at'] < cutoff_dt)
            mask = mask & no_purchase
        
        # 기본 필터 적용된 고객 집합
        filtered_ids = set(df.loc[mask, 'customer_id'].values)
        
        # 6. 카테고리 필터
        if spec.categories:
            category_ids = self._filter_by_categories(spec.categories, spec.category_mode)
            filtered_ids = filtered_ids & category_ids
        
        return filtered_ids
    
    def _filter_by_categories(self, categories: List[str], mode: str) -> Set[str]:
        """카테고리 조건으로 고객 필터링"""
        if not categories:
            return set(data_cache.customers['customer_id'].values)
        
        # 각 카테고리별 고객 집합 가져오기
        category_sets = [data_cache.get_category_customers(cat) for cat in categories]
        
        if mode == 'ALL':  # 교집합: 모든 카테고리 구매 이력
            result = category_sets[0]
            for s in category_sets[1:]:
                result = result & s
        else:  # ANY: 합집합: 하나라도 구매 이력
            result = set()
            for s in category_sets:
                result = result | s
        
        return result
    
    def get_spec_tags(self, spec: FilterSpec) -> List[Dict[str, str]]:
        """인식된 조건을 태그 형태로 반환"""
        tags = []
        
        if spec.gender:
            tags.append({'type': '성별', 'value': '여성' if spec.gender == 'F' else '남성'})
        
        if spec.age_min is not None or spec.age_max is not None:
            if spec.age_min == spec.age_max - 9:  # 단일 연령대
                tags.append({'type': '연령', 'value': f"{spec.age_min}대"})
            else:
                age_str = f"{spec.age_min or '?'}~{spec.age_max or '?'}세"
                tags.append({'type': '연령', 'value': age_str})
        
        for region in spec.regions:
            tags.append({'type': '지역', 'value': region})
        
        for skin in spec.skin_types:
            tags.append({'type': '피부타입', 'value': skin})
        
        if spec.purchased_within_months:
            tags.append({'type': '구매조건', 'value': f"최근 {spec.purchased_within_months}개월 구매 O"})
        
        if spec.not_purchased_within_months:
            tags.append({'type': '이탈조건', 'value': f"최근 {spec.not_purchased_within_months}개월 미구매"})
        
        for cat in spec.categories:
            tags.append({'type': '카테고리', 'value': cat})
        
        if len(spec.categories) > 1:
            mode_str = '교집합(ALL)' if spec.category_mode == 'ALL' else '합집합(ANY)'
            tags.append({'type': '조합방식', 'value': mode_str})
        
        if spec.as_of_date:
            tags.append({'type': '기준일', 'value': spec.as_of_date.strftime('%Y-%m-%d')})
        
        return tags


# 싱글톤 인스턴스
query_engine = QueryEngine()
