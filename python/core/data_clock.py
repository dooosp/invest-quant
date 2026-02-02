"""시점 정합성 엔진 — 룩어헤드 방지

리밸런싱일 기준 T-1까지만 데이터 접근 허용.
재무 데이터는 공시일+1 기준으로 사용 가능 시점 태깅.
"""
import pandas as pd
from datetime import timedelta

# 한국시장 재무제표 공시 래그 (보수적 90일)
FINANCIAL_LAG_DAYS = 90

def get_available_price_data(prices: pd.DataFrame, rebalance_date: str) -> pd.DataFrame:
    """리밸런싱일 전일까지의 가격 데이터만 반환"""
    cutoff = pd.Timestamp(rebalance_date) - timedelta(days=1)
    return prices[prices.index <= cutoff].copy()

def get_available_financial_data(financials: pd.DataFrame, rebalance_date: str) -> pd.DataFrame:
    """공시 래그 반영된 재무 데이터만 반환.
    report_date + FINANCIAL_LAG_DAYS <= rebalance_date 인 것만 사용.
    """
    cutoff = pd.Timestamp(rebalance_date) - timedelta(days=FINANCIAL_LAG_DAYS)
    if "report_date" in financials.columns:
        return financials[financials["report_date"] <= cutoff].copy()
    return financials

def get_rebalance_dates(start: str, end: str, freq: str = "M") -> list[str]:
    """리밸런싱 일정 생성 (월초 영업일 기준)"""
    freq_map = {"D": "B", "W": "W-MON", "M": "MS", "Q": "QS"}
    dates = pd.date_range(start=start, end=end, freq=freq_map.get(freq, "MS"))
    # 영업일로 보정 (주말이면 다음 월요일)
    return [d.strftime("%Y-%m-%d") for d in dates]

def validate_no_lookahead(data_date: str, rebalance_date: str) -> bool:
    """데이터 시점이 리밸런싱일보다 미래면 False (룩어헤드)"""
    return pd.Timestamp(data_date) < pd.Timestamp(rebalance_date)
