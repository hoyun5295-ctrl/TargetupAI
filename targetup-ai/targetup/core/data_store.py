"""
TargetUP AI - Data Store
고객 50만명 + 구매 200만건 데이터 생성 및 로드
"""
import os
import hashlib
from datetime import datetime, timedelta, date
from typing import Tuple, Optional, Set
import pandas as pd
import numpy as np
from pathlib import Path

from .models import CATEGORIES, REGIONS, SKIN_TYPES, GRADES, STAGES, CONCERNS

# 데이터 저장 경로
DATA_DIR = Path(__file__).parent.parent / "data"
CUSTOMERS_PATH = DATA_DIR / "customers.parquet"
PURCHASES_PATH = DATA_DIR / "purchases.parquet"
CUSTOMER_STATS_PATH = DATA_DIR / "customer_stats.parquet"
CUSTOMER_CATEGORIES_PATH = DATA_DIR / "customer_categories.parquet"


def ensure_data_dir():
    """데이터 디렉토리 생성"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def generate_customers(n: int = 500_000, seed: int = 42) -> pd.DataFrame:
    """고객 데이터 생성"""
    print(f"고객 {n:,}명 데이터 생성 중...")
    np.random.seed(seed)
    
    # 기준일
    today = datetime.now().date()
    
    # 고객 ID
    customer_ids = [f"C{str(i).zfill(7)}" for i in range(1, n + 1)]
    
    # 성별 (여성 70%, 남성 30% - 화장품 특성)
    genders = np.random.choice(['F', 'M'], n, p=[0.7, 0.3])
    
    # 출생연도 (1960~2006, 20대~60대 분포)
    birth_years = np.random.choice(
        range(1960, 2007),
        n,
        p=_age_distribution()
    )
    
    # 지역 (서울/경기 비중 높게)
    region_weights = [0.25, 0.25, 0.08, 0.08, 0.05, 0.04, 0.04, 0.03, 0.01,
                      0.03, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02]
    regions = np.random.choice(REGIONS, n, p=region_weights)
    
    # 피부타입
    skin_types = np.random.choice(SKIN_TYPES, n, p=[0.25, 0.25, 0.25, 0.15, 0.10])
    
    # 가입일 (최근 5년)
    joined_days_ago = np.random.randint(0, 365 * 5, n)
    joined_at = [today - timedelta(days=int(d)) for d in joined_days_ago]
    
    # 마지막 주문일 (가입일 이후, 일부는 None - 미구매)
    last_order_at = []
    for i in range(n):
        if np.random.random() < 0.05:  # 5%는 미구매
            last_order_at.append(None)
        else:
            max_days = joined_days_ago[i]
            if max_days > 0:
                days_ago = np.random.randint(0, max_days)
                last_order_at.append(today - timedelta(days=int(days_ago)))
            else:
                last_order_at.append(today)
    
    # 구매 빈도, 금액, 등급
    frequencies = np.random.poisson(5, n) + 1
    monetaries = np.random.lognormal(10, 1, n).astype(int)
    grades = np.random.choice(GRADES, n, p=[0.05, 0.15, 0.25, 0.30, 0.25])
    
    # 이름 생성 (간단한 해시 기반)
    names = [f"고객{hashlib.md5(cid.encode()).hexdigest()[:6]}" for cid in customer_ids]
    
    df = pd.DataFrame({
        'customer_id': customer_ids,
        'name': names,
        'gender': genders,
        'birth_year': birth_years,
        'region': regions,
        'skin_type': skin_types,
        'joined_at': joined_at,
        'last_order_at': last_order_at,
        'frequency': frequencies,
        'monetary': monetaries,
        'grade': grades
    })
    
    # 타입 변환
    df['joined_at'] = pd.to_datetime(df['joined_at'])
    df['last_order_at'] = pd.to_datetime(df['last_order_at'])
    
    print(f"고객 데이터 생성 완료: {len(df):,}명")
    return df


def _age_distribution() -> list:
    """연령 분포 (20대 > 30대 > 40대 > 기타)"""
    years = list(range(1960, 2007))
    weights = []
    for y in years:
        age = 2025 - y
        if 20 <= age < 30:
            weights.append(3.0)
        elif 30 <= age < 40:
            weights.append(2.5)
        elif 40 <= age < 50:
            weights.append(1.5)
        elif 50 <= age < 60:
            weights.append(1.0)
        else:
            weights.append(0.5)
    total = sum(weights)
    return [w / total for w in weights]


def generate_purchases(customers_df: pd.DataFrame, 
                       min_purchases: int = 2_000_000,
                       seed: int = 42) -> pd.DataFrame:
    """구매 데이터 생성"""
    print(f"구매 데이터 {min_purchases:,}건 이상 생성 중...")
    np.random.seed(seed)
    
    today = datetime.now().date()
    customer_ids = customers_df['customer_id'].values
    joined_dates = customers_df['joined_at'].values
    
    # 고객별 구매 횟수 (1~20회, 평균 4회)
    n_customers = len(customer_ids)
    purchases_per_customer = np.random.geometric(0.25, n_customers)
    purchases_per_customer = np.clip(purchases_per_customer, 1, 20)
    
    # 최소 구매 건수 보장
    total_purchases = purchases_per_customer.sum()
    if total_purchases < min_purchases:
        scale_factor = min_purchases / total_purchases
        purchases_per_customer = (purchases_per_customer * scale_factor).astype(int)
        purchases_per_customer = np.clip(purchases_per_customer, 1, 50)
    
    # 구매 데이터 생성
    records = []
    purchase_id = 1
    
    # 제품 목록 (카테고리별)
    products_by_category = _generate_products()
    
    for i, (cid, joined, n_purch) in enumerate(zip(customer_ids, joined_dates, purchases_per_customer)):
        if i % 100000 == 0:
            print(f"  {i:,}/{n_customers:,} 고객 처리 중...")
        
        # 가입일 이후 구매
        joined_date = pd.to_datetime(joined).date()
        days_since_joined = (today - joined_date).days
        
        if days_since_joined <= 0:
            days_since_joined = 1
        
        for _ in range(int(n_purch)):
            # 구매일
            days_ago = np.random.randint(0, days_since_joined + 1)
            purchased_at = today - timedelta(days=days_ago)
            
            # 카테고리 (STAGES 위주, CONCERNS도 가끔)
            if np.random.random() < 0.8:
                category = np.random.choice(STAGES)
            else:
                category = np.random.choice(CONCERNS)
            
            # 제품
            product = np.random.choice(products_by_category.get(category, ['기본제품']))
            
            # 금액
            amount = int(np.random.lognormal(9.5, 0.5))  # 평균 ~15,000원
            
            records.append({
                'purchase_id': f"P{str(purchase_id).zfill(9)}",
                'customer_id': cid,
                'purchased_at': purchased_at,
                'category': category,
                'product': product,
                'amount': amount
            })
            purchase_id += 1
    
    df = pd.DataFrame(records)
    df['purchased_at'] = pd.to_datetime(df['purchased_at'])
    
    print(f"구매 데이터 생성 완료: {len(df):,}건")
    return df


def _generate_products() -> dict:
    """카테고리별 제품 목록 생성"""
    products = {
        '클렌징': ['모공클렌저', '버블폼', '오일클렌저', '클렌징워터', '저자극폼'],
        '스킨': ['수분토너', '진정토너', '각질케어토너', '미스트토너', '에센스토너'],
        '에센스': ['비타민세럼', '히알루론에센스', '나이아신에센스', '펩타이드세럼', '레티놀에센스'],
        '로션/크림': ['수분크림', '영양크림', '장벽크림', '리페어크림', '산뜻크림'],
        '눈가케어': ['아이크림', '아이세럼', '아이패치', '아이롤러', '아이밤'],
        '집중케어': ['앰플', '부스터', '오일', '캡슐', '집중세럼'],
        '헤어/바디': ['바디로션', '핸드크림', '헤어에센스', '두피케어', '바디오일'],
        '메이크업': ['쿠션', 'BB크림', '프라이머', '파운데이션', '톤업크림'],
        '선케어': ['선크림', '선스틱', '선쿠션', '선스프레이', '선에센스'],
        '립케어': ['립밤', '립오일', '립마스크', '립세럼', '립트리트먼트'],
        '마스크팩': ['시트마스크', '클레이팩', '워시오프팩', '슬리핑팩', '앰플마스크'],
        '건강케어': ['이너뷰티', '콜라겐', '비타민', '프로바이오틱스', '오메가3'],
        '수분/보습': ['보습세럼', '수분앰플', '보습크림', '수분팩', '보습미스트'],
        '미백/잡티': ['미백세럼', '브라이트닝크림', '비타민C앰플', '톤업크림', '잡티세럼'],
        '트러블/진정': ['시카크림', '진정세럼', '트러블패치', '티트리젤', '진정토너'],
        '주름/탄력': ['주름세럼', '탄력크림', '콜라겐앰플', '리프팅크림', '펩타이드크림'],
        '모공/피지': ['모공세럼', '피지케어토너', 'BHA세럼', '모공패드', '피지조절크림'],
        '남성': ['남성올인원', '남성쉐이빙젤', '남성토너', '남성선크림', '남성클렌저'],
        '맘/임산부': ['임산부크림', '튼살크림', '저자극로션', '순한클렌저', '무향크림']
    }
    return products


def build_customer_stats(customers_df: pd.DataFrame, 
                         purchases_df: pd.DataFrame) -> pd.DataFrame:
    """고객별 구매 통계 마트 생성"""
    print("고객 통계 마트 생성 중...")
    
    # 마지막 주문 정보
    last_orders = purchases_df.groupby('customer_id').agg({
        'purchased_at': 'max',
        'amount': 'last'
    }).reset_index()
    last_orders.columns = ['customer_id', 'last_order_at', 'last_order_amount']
    
    # 전체 고객과 조인
    stats = customers_df[['customer_id']].merge(
        last_orders, on='customer_id', how='left'
    )
    
    print(f"고객 통계 마트 완료: {len(stats):,}건")
    return stats


def build_customer_categories(purchases_df: pd.DataFrame) -> pd.DataFrame:
    """고객별 구매 카테고리 이력 마트 생성 (중복 제거)"""
    print("고객 카테고리 이력 마트 생성 중...")
    
    cat_history = purchases_df[['customer_id', 'category']].drop_duplicates()
    
    print(f"고객 카테고리 마트 완료: {len(cat_history):,}건")
    return cat_history


def load_or_generate_data(force_regenerate: bool = False) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    데이터 로드 또는 생성
    Returns: (customers_df, purchases_df, customer_stats_df, customer_categories_df)
    """
    ensure_data_dir()
    
    # 모든 파일이 존재하고 재생성 플래그가 없으면 로드
    all_exists = all([
        CUSTOMERS_PATH.exists(),
        PURCHASES_PATH.exists(),
        CUSTOMER_STATS_PATH.exists(),
        CUSTOMER_CATEGORIES_PATH.exists()
    ])
    
    if all_exists and not force_regenerate:
        print("기존 데이터 로드 중...")
        customers_df = pd.read_parquet(CUSTOMERS_PATH)
        purchases_df = pd.read_parquet(PURCHASES_PATH)
        customer_stats_df = pd.read_parquet(CUSTOMER_STATS_PATH)
        customer_categories_df = pd.read_parquet(CUSTOMER_CATEGORIES_PATH)
        print(f"로드 완료: 고객 {len(customers_df):,}명, 구매 {len(purchases_df):,}건")
        return customers_df, purchases_df, customer_stats_df, customer_categories_df
    
    # 새로 생성
    print("="*50)
    print("데이터 생성을 시작합니다. 수 분 소요될 수 있습니다...")
    print("="*50)
    
    customers_df = generate_customers()
    purchases_df = generate_purchases(customers_df)
    customer_stats_df = build_customer_stats(customers_df, purchases_df)
    customer_categories_df = build_customer_categories(purchases_df)
    
    # 저장
    print("데이터 저장 중...")
    customers_df.to_parquet(CUSTOMERS_PATH, index=False)
    purchases_df.to_parquet(PURCHASES_PATH, index=False)
    customer_stats_df.to_parquet(CUSTOMER_STATS_PATH, index=False)
    customer_categories_df.to_parquet(CUSTOMER_CATEGORIES_PATH, index=False)
    
    print("="*50)
    print("데이터 생성 및 저장 완료!")
    print(f"  - 고객: {len(customers_df):,}명")
    print(f"  - 구매: {len(purchases_df):,}건")
    print("="*50)
    
    return customers_df, purchases_df, customer_stats_df, customer_categories_df


def get_category_customers(customer_categories_df: pd.DataFrame, 
                           category: str) -> Set[str]:
    """특정 카테고리 구매 이력이 있는 고객 ID 집합"""
    mask = customer_categories_df['category'] == category
    return set(customer_categories_df.loc[mask, 'customer_id'].values)


class DataCache:
    """싱글톤 데이터 캐시"""
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._loaded = False
        return cls._instance
    
    def load(self, force: bool = False):
        if not self._loaded or force:
            (self.customers, 
             self.purchases, 
             self.customer_stats, 
             self.customer_categories) = load_or_generate_data(force)
            
            # 카테고리별 고객 집합 캐시
            self._category_customers_cache = {}
            for cat in CATEGORIES:
                self._category_customers_cache[cat] = get_category_customers(
                    self.customer_categories, cat
                )
            
            self._loaded = True
    
    def get_category_customers(self, category: str) -> Set[str]:
        """캐시된 카테고리별 고객 집합 반환"""
        if not self._loaded:
            self.load()
        return self._category_customers_cache.get(category, set())
    
    @property
    def is_loaded(self):
        return self._loaded


# 전역 캐시 인스턴스
data_cache = DataCache()
