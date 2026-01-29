"""
TargetUP AI - Main Application (AI-Powered Version)
Claude API 연동 AI 마케팅 자동화 솔루션 MVP v2.0
"""
import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
import os
import sys

# 경로 설정
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import (
    data_cache, unified_engine, campaign_db, scheduler, 
    CATEGORIES, check_api_status, rag_store, add_campaign_to_rag,
    FilterSpec
)

# 페이지 설정
st.set_page_config(
    page_title="TargetUP AI",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 커스텀 CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2rem;
        font-weight: bold;
        color: #2E8B57;
        margin-bottom: 0.5rem;
    }
    .sub-header {
        font-size: 1rem;
        color: #666;
        margin-bottom: 1.5rem;
    }
    .tag-container {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 1rem 0;
    }
    .tag {
        background-color: #E8F5E9;
        color: #2E8B57;
        padding: 0.3rem 0.8rem;
        border-radius: 1rem;
        font-size: 0.85rem;
        border: 1px solid #2E8B57;
    }
    .ai-tag {
        background-color: #E3F2FD;
        color: #1976D2;
        border-color: #1976D2;
    }
    .metric-card {
        background-color: #f8f9fa;
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
    }
    .metric-value {
        font-size: 2rem;
        font-weight: bold;
        color: #2E8B57;
    }
    .metric-label {
        font-size: 0.9rem;
        color: #666;
    }
    .variant-card {
        border: 2px solid #E0E0E0;
        border-radius: 0.5rem;
        padding: 1rem;
        margin: 0.5rem 0;
        transition: border-color 0.2s;
    }
    .variant-card:hover {
        border-color: #2E8B57;
    }
    .recommend-badge {
        background-color: #2E8B57;
        color: white;
        padding: 0.2rem 0.5rem;
        border-radius: 0.3rem;
        font-size: 0.75rem;
    }
    .ai-badge {
        background-color: #1976D2;
        color: white;
        padding: 0.2rem 0.5rem;
        border-radius: 0.3rem;
        font-size: 0.75rem;
    }
    .status-scheduled { color: #FF9800; }
    .status-sent { color: #4CAF50; }
    .status-canceled { color: #F44336; }
    .mode-indicator {
        display: inline-block;
        padding: 0.2rem 0.6rem;
        border-radius: 0.3rem;
        font-size: 0.8rem;
        font-weight: bold;
    }
    .mode-ai {
        background-color: #E3F2FD;
        color: #1976D2;
    }
    .mode-rule {
        background-color: #FFF3E0;
        color: #F57C00;
    }
</style>
""", unsafe_allow_html=True)


def init_session_state():
    """세션 상태 초기화"""
    if 'query_result' not in st.session_state:
        st.session_state.query_result = None
    if 'variants' not in st.session_state:
        st.session_state.variants = None
    if 'selected_variant' not in st.session_state:
        st.session_state.selected_variant = None
    if 'data_loaded' not in st.session_state:
        st.session_state.data_loaded = False
    if 'use_ai' not in st.session_state:
        st.session_state.use_ai = True  # 기본: AI 모드


def load_data():
    """데이터 로드"""
    if not st.session_state.data_loaded:
        with st.spinner("데이터 로드 중... (첫 실행 시 수 분 소요)"):
            data_cache.load()
            st.session_state.data_loaded = True


def render_sidebar():
    """사이드바 렌더링"""
    with st.sidebar:
        st.markdown("## ⚙️ 설정")
        
        # AI 모드 상태
        api_status = check_api_status()
        
        st.markdown("### 🤖 AI 모드")
        
        if api_status['ready']:
            st.success("✅ Claude API 연결됨")
            st.session_state.use_ai = st.toggle(
                "AI 모드 사용",
                value=st.session_state.use_ai,
                help="AI 모드: Claude API로 자연어 파싱 및 문안 생성\n규칙 모드: Regex 기반 파싱"
            )
        else:
            st.warning(f"⚠️ {api_status['message']}")
            st.session_state.use_ai = False
            st.info("규칙 기반 모드로 동작합니다.")
        
        # RAG 상태
        st.markdown("### 📚 RAG 학습")
        rag_stats = rag_store.get_stats()
        
        if rag_stats.get('available'):
            st.info(f"저장된 캠페인: {rag_stats.get('total_campaigns', 0)}개")
        else:
            st.warning("ChromaDB 미설치 (pip install chromadb)")
        
        # 통계
        st.markdown("### 📊 캠페인 통계")
        stats = campaign_db.get_campaign_stats()
        col1, col2 = st.columns(2)
        with col1:
            st.metric("대기", stats['scheduled'])
        with col2:
            st.metric("발송완료", stats['sent'])
        
        # API 키 설정 안내
        with st.expander("🔑 API 키 설정"):
            st.markdown("""
            1. [console.anthropic.com](https://console.anthropic.com) 접속
            2. API Keys → Create Key
            3. `.env` 파일 생성:
            ```
            ANTHROPIC_API_KEY=sk-ant-api03-...
            ```
            4. 앱 재시작
            """)


def render_header():
    """헤더 렌더링"""
    col1, col2 = st.columns([4, 1])
    with col1:
        st.markdown('<div class="main-header">🎯 TargetUP AI</div>', unsafe_allow_html=True)
        
        # 모드 표시
        mode = unified_engine.get_mode() if st.session_state.use_ai else "RULE"
        mode_class = "mode-ai" if mode == "AI" else "mode-rule"
        mode_text = "🤖 AI 모드" if mode == "AI" else "📋 규칙 모드"
        st.markdown(f'<span class="mode-indicator {mode_class}">{mode_text}</span>', unsafe_allow_html=True)
    
    with col2:
        stats = campaign_db.get_campaign_stats()
        st.metric("예약 대기", f"{stats['scheduled']}건")


def render_prompt_input():
    """프롬프트 입력 영역"""
    st.markdown("### 📝 타겟팅 프롬프트")
    
    example_prompt = "2026-02-10 10시 산뜻크림 30% 할인행사. 서울 20대 여성 중 최근 12개월 구매했고 최근 6개월 미구매이며, 눈가케어+에센스 구매이력 고객에게 발송 예약."
    
    prompt = st.text_area(
        "한 줄 프롬프트를 입력하세요",
        placeholder=example_prompt,
        height=100,
        key="prompt_input"
    )
    
    col1, col2, col3 = st.columns([1, 1, 4])
    with col1:
        preview_clicked = st.button("🔍 미리보기", use_container_width=True, type="primary")
    with col2:
        save_clicked = st.button("💾 예약 저장", use_container_width=True)
    
    return prompt, preview_clicked, save_clicked


def render_condition_tags(tags, mode: str = "RULE"):
    """인식된 조건 태그 렌더링"""
    if not tags:
        return
    
    st.markdown("### 🏷️ 인식된 조건")
    
    tag_class = "tag ai-tag" if mode == "AI" else "tag"
    tag_html = '<div class="tag-container">'
    for tag in tags:
        tag_html += f'<span class="{tag_class}">{tag["type"]}: {tag["value"]}</span>'
    tag_html += '</div>'
    
    st.markdown(tag_html, unsafe_allow_html=True)


def render_results(spec, send_at, total_count, sample_df):
    """결과 렌더링"""
    st.markdown("### 📊 타겟 분석 결과")
    
    # 메트릭
    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-value">{total_count:,}</div>
            <div class="metric-label">타겟 모수</div>
        </div>
        """, unsafe_allow_html=True)
    with col2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-value">{send_at.strftime('%m/%d %H시')}</div>
            <div class="metric-label">발송 예정</div>
        </div>
        """, unsafe_allow_html=True)
    with col3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-value">{spec.as_of_date.strftime('%m/%d')}</div>
            <div class="metric-label">기준일(as-of)</div>
        </div>
        """, unsafe_allow_html=True)
    
    # 샘플 테이블
    st.markdown("#### 📋 샘플 고객 (50명)")
    display_cols = ['customer_id', 'name', 'gender', 'age', 'region', 'skin_type', 'grade', 'last_order_at']
    available_cols = [c for c in display_cols if c in sample_df.columns]
    display_df = sample_df[available_cols].copy()
    if 'last_order_at' in display_df.columns:
        display_df['last_order_at'] = pd.to_datetime(display_df['last_order_at']).dt.strftime('%Y-%m-%d')
    st.dataframe(display_df, use_container_width=True, height=300)


def render_category_chart(sample_df):
    """카테고리 분포 차트"""
    if len(sample_df) > 0:
        with st.expander("📈 타겟 분포 차트"):
            col1, col2 = st.columns(2)
            with col1:
                if 'region' in sample_df.columns:
                    region_counts = sample_df['region'].value_counts().head(10)
                    fig = px.bar(
                        x=region_counts.index,
                        y=region_counts.values,
                        title="지역 분포 (샘플)",
                        labels={'x': '지역', 'y': '고객 수'}
                    )
                    fig.update_traces(marker_color='#2E8B57')
                    fig.update_layout(height=300)
                    st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                if 'age' in sample_df.columns:
                    age_counts = sample_df['age'].apply(lambda x: f"{(x//10)*10}대").value_counts().sort_index()
                    fig = px.bar(
                        x=age_counts.index,
                        y=age_counts.values,
                        title="연령대 분포 (샘플)",
                        labels={'x': '연령대', 'y': '고객 수'}
                    )
                    fig.update_traces(marker_color='#2E8B57')
                    fig.update_layout(height=300)
                    st.plotly_chart(fig, use_container_width=True)


def render_variants(variants, mode: str = "RULE"):
    """문안 추천 카드 렌더링"""
    st.markdown("### 💬 추천 문안")
    
    if mode == "AI":
        st.markdown('<span class="ai-badge">🤖 AI 생성</span>', unsafe_allow_html=True)
    
    recommended_id = variants[0].variant_id  # 최고 점수
    
    selected = st.radio(
        "문안 선택",
        options=[v.variant_id for v in variants],
        format_func=lambda x: {v.variant_id: f"{v.variant_id}안 - {v.variant_name}" for v in variants}[x],
        horizontal=True,
        key="variant_selector"
    )
    
    for variant in variants:
        is_selected = (variant.variant_id == selected)
        is_recommended = (variant.variant_id == recommended_id)
        
        with st.container():
            col1, col2 = st.columns([1, 5])
            with col1:
                st.markdown(f"**{variant.variant_id}안**")
                st.markdown(f"*{variant.variant_name}*")
                if is_recommended:
                    st.markdown('<span class="recommend-badge">🌟 자동추천</span>', unsafe_allow_html=True)
                st.markdown(f"점수: {variant.score:.0f}")
            
            with col2:
                tab1, tab2 = st.tabs(["SMS", "LMS"])
                with tab1:
                    st.text_area(
                        f"SMS ({variant.sms_bytes} bytes)",
                        variant.sms_text,
                        height=100,
                        key=f"sms_{variant.variant_id}",
                        disabled=True
                    )
                with tab2:
                    st.text_area(
                        f"LMS ({variant.lms_bytes} bytes)",
                        variant.lms_text,
                        height=200,
                        key=f"lms_{variant.variant_id}",
                        disabled=True
                    )
            
            st.markdown("---")
    
    return selected


def render_campaign_list():
    """예약 목록 렌더링"""
    st.markdown("### 📅 예약 목록")
    
    campaigns = campaign_db.get_all_campaigns(limit=20)
    
    if not campaigns:
        st.info("예약된 캠페인이 없습니다.")
        return
    
    # 상태별 필터
    status_filter = st.selectbox(
        "상태 필터",
        ["전체", "scheduled", "sent", "canceled"],
        key="status_filter"
    )
    
    if status_filter != "전체":
        campaigns = [c for c in campaigns if c.status == status_filter]
    
    for campaign in campaigns:
        status_text = {"scheduled": "⏰ 대기", "sent": "✅ 발송완료", "canceled": "❌ 취소"}[campaign.status]
        
        with st.expander(f"#{campaign.id} | {campaign.send_at.strftime('%Y-%m-%d %H:%M') if campaign.send_at else '-'} | {campaign.total_count:,}명 | {status_text}"):
            col1, col2 = st.columns([3, 1])
            
            with col1:
                st.markdown(f"**프롬프트:** {campaign.user_prompt[:100]}...")
                st.markdown(f"**선택 문안:** {campaign.selected_variant_id}안")
                st.markdown(f"**생성일:** {campaign.created_at.strftime('%Y-%m-%d %H:%M') if campaign.created_at else '-'}")
                
                if campaign.sms_text:
                    st.text_area("SMS 문안", campaign.sms_text, height=80, disabled=True, key=f"camp_sms_{campaign.id}")
            
            with col2:
                if campaign.status == 'scheduled':
                    if st.button("❌ 취소", key=f"cancel_{campaign.id}"):
                        if campaign_db.cancel_campaign(campaign.id):
                            st.success("취소되었습니다.")
                            st.rerun()
                    
                    if st.button("🚀 지금 발송", key=f"send_{campaign.id}"):
                        if campaign_db.send_now(campaign.id):
                            st.success("발송 완료!")
                            st.rerun()
                
                if campaign.targets_csv_path and os.path.exists(campaign.targets_csv_path):
                    with open(campaign.targets_csv_path, 'r') as f:
                        csv_data = f.read()
                    st.download_button(
                        "📥 타겟 CSV",
                        csv_data,
                        f"targets_{campaign.id}.csv",
                        "text/csv",
                        key=f"download_{campaign.id}"
                    )


def render_debug_section(spec, prompt, extra_context=None, mode="RULE"):
    """디버그 섹션 (고급 설정)"""
    with st.expander("🔧 고급 설정 / 디버그"):
        st.markdown(f"**모드:** {mode}")
        
        st.markdown("**파싱된 스펙 (JSON)**")
        st.json(spec.to_json())
        
        if extra_context:
            st.markdown("**추가 컨텍스트 (AI)**")
            st.json(extra_context)
        
        st.markdown("**원본 프롬프트**")
        st.code(prompt)


def save_campaign(prompt, spec, send_at, total_count, customer_ids, selected_variant, variants):
    """캠페인 저장"""
    selected_v = next((v for v in variants if v.variant_id == selected_variant), variants[0])
    
    campaign_id = campaign_db.save_campaign(
        user_prompt=prompt,
        send_at=send_at,
        spec=spec,
        total_count=total_count,
        customer_ids=customer_ids,
        selected_variant_id=selected_v.variant_id,
        sms_text=selected_v.sms_text,
        lms_text=selected_v.lms_text
    )
    
    # RAG에 저장 (학습용)
    try:
        from core.models import Campaign
        campaign = Campaign(
            id=campaign_id,
            user_prompt=prompt,
            sms_text=selected_v.sms_text,
            lms_text=selected_v.lms_text,
            total_count=total_count
        )
        add_campaign_to_rag(campaign, spec)
    except Exception as e:
        print(f"RAG 저장 실패 (무시): {e}")
    
    return campaign_id


def main():
    """메인 함수"""
    init_session_state()
    
    # 사이드바
    render_sidebar()
    
    # 데이터 로드
    load_data()
    
    # 헤더
    render_header()
    st.markdown("---")
    
    # 프롬프트 입력
    prompt, preview_clicked, save_clicked = render_prompt_input()
    
    # 현재 모드
    use_ai = st.session_state.use_ai and unified_engine.ai_available
    mode = "AI" if use_ai else "RULE"
    
    # 미리보기 실행
    if preview_clicked and prompt:
        with st.spinner(f"타겟 분석 중... ({mode} 모드)"):
            try:
                spec, send_at, total_count, sample_df, customer_ids, extra_context = unified_engine.execute(prompt, use_ai=use_ai)
                
                variants = unified_engine.recommend_messages(
                    prompt, spec, send_at, 
                    extra_context=extra_context,
                    use_ai=use_ai
                )
                
                st.session_state.query_result = {
                    'spec': spec,
                    'send_at': send_at,
                    'total_count': total_count,
                    'sample_df': sample_df,
                    'customer_ids': customer_ids,
                    'prompt': prompt,
                    'extra_context': extra_context,
                    'mode': mode
                }
                st.session_state.variants = variants
                
            except Exception as e:
                st.error(f"오류 발생: {e}")
                import traceback
                with st.expander("오류 상세"):
                    st.code(traceback.format_exc())
    
    # 결과 표시
    if st.session_state.query_result:
        result = st.session_state.query_result
        variants = st.session_state.variants
        result_mode = result.get('mode', 'RULE')
        
        # 조건 태그
        tags = unified_engine.get_spec_tags(result['spec'])
        render_condition_tags(tags, result_mode)
        
        st.markdown("---")
        
        # 결과
        render_results(result['spec'], result['send_at'], result['total_count'], result['sample_df'])
        
        # 차트
        render_category_chart(result['sample_df'])
        
        st.markdown("---")
        
        # 문안 추천
        selected_variant = render_variants(variants, result_mode)
        st.session_state.selected_variant = selected_variant
        
        # 디버그
        render_debug_section(
            result['spec'], 
            result['prompt'], 
            result.get('extra_context'),
            result_mode
        )
    
    # 예약 저장
    if save_clicked and st.session_state.query_result and st.session_state.variants:
        result = st.session_state.query_result
        variants = st.session_state.variants
        selected = st.session_state.selected_variant or variants[0].variant_id
        
        campaign_id = save_campaign(
            result['prompt'],
            result['spec'],
            result['send_at'],
            result['total_count'],
            result['customer_ids'],
            selected,
            variants
        )
        
        st.success(f"✅ 캠페인 #{campaign_id} 예약 저장 완료!")
        
        # 상태 초기화
        st.session_state.query_result = None
        st.session_state.variants = None
        st.rerun()
    
    st.markdown("---")
    
    # 예약 목록
    render_campaign_list()
    
    # 예정 캠페인 자동 처리 (idempotent)
    scheduler.process_due_campaigns()


if __name__ == "__main__":
    main()
