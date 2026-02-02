"""거래비용 모델 — 수수료 + 슬리피지"""

def calc_trade_cost(amount: float, fee_bps: float, slippage_bps: float) -> float:
    """거래 비용 계산 (편도)"""
    return amount * (fee_bps + slippage_bps) / 10000

def calc_round_trip_cost(amount: float, fee_bps: float, slippage_bps: float) -> float:
    """왕복 비용 (매수+매도)"""
    return calc_trade_cost(amount, fee_bps, slippage_bps) * 2

def apply_cost_to_return(gross_return: float, turnover: float, fee_bps: float, slippage_bps: float) -> float:
    """총수익률에서 비용 차감.
    net_return = gross_return - turnover × round_trip_cost_rate
    """
    cost_rate = 2 * (fee_bps + slippage_bps) / 10000
    return gross_return - turnover * cost_rate

def check_liquidity(order_amount: float, daily_volume: float, price: float, max_pct: float = 0.1) -> bool:
    """유동성 체크: 일거래량의 max_pct 초과 주문 불가"""
    daily_value = daily_volume * price
    return order_amount <= daily_value * max_pct
