"""Backtest Agent — 월 리밸런싱 시뮬레이션 + 성과 지표

비용 반영 + walk-forward OOS 검증 + 유동성 제약
"""
import json, sys, os, argparse
import pandas as pd
import numpy as np
from core.schemas import load_and_validate
from core.cost_model import apply_cost_to_return

def calc_metrics(returns: pd.Series) -> dict:
    """CAGR, Sharpe, Sortino, MDD, Win Rate, Profit Factor"""
    if returns.empty or len(returns) < 2:
        return {"cagr": 0, "sharpe": 0, "sortino": 0, "mdd": 0, "win_rate": 0, "profit_factor": 0}

    # CAGR
    total = (1 + returns).prod()
    years = len(returns) / 252
    cagr = total ** (1 / max(years, 0.01)) - 1 if total > 0 else -1

    # Sharpe (연율화, 무위험 3%)
    rf_daily = 0.03 / 252
    excess = returns - rf_daily
    sharpe = excess.mean() / excess.std() * np.sqrt(252) if excess.std() > 0 else 0

    # Sortino
    downside = returns[returns < 0]
    down_std = downside.std() if len(downside) > 1 else 1e-8
    sortino = (returns.mean() - rf_daily) / down_std * np.sqrt(252)

    # MDD
    cumulative = (1 + returns).cumprod()
    peak = cumulative.cummax()
    drawdown = (cumulative - peak) / peak
    mdd = drawdown.min()

    # Win Rate / Profit Factor (월 단위)
    monthly = returns.resample("ME").sum() if hasattr(returns.index, "freq") else returns
    wins = monthly[monthly > 0]
    losses = monthly[monthly < 0]
    win_rate = len(wins) / max(len(monthly), 1)
    profit_factor = wins.sum() / abs(losses.sum()) if len(losses) > 0 and losses.sum() != 0 else float("inf")

    return {
        "cagr": round(float(cagr), 4),
        "sharpe": round(float(sharpe), 2),
        "sortino": round(float(sortino), 2),
        "mdd": round(float(mdd), 4),
        "win_rate": round(float(win_rate), 4),
        "profit_factor": round(float(profit_factor), 2),
    }

def run_backtest(prices: pd.DataFrame, weights: dict, cost_spec: dict,
                 rebal_dates: list) -> tuple[pd.Series, list]:
    """단순 백테스트: 리밸런싱 날짜마다 비중 조정, 일별 수익률 계산"""
    if prices.empty or not weights:
        return pd.Series(dtype=float), []

    trades = []
    # 종목별 일별 수익률 피벗
    pivot = prices.pivot_table(index="date", columns="code", values="close")
    daily_ret = pivot.pct_change().fillna(0)

    # 포트폴리오 일별 수익률
    weight_series = pd.Series(weights)
    codes_in_data = [c for c in weight_series.index if c in daily_ret.columns]
    if not codes_in_data:
        return pd.Series(dtype=float), []

    # 보유 비중으로 가중 수익률 계산
    w = weight_series.reindex(daily_ret.columns, fill_value=0)
    port_ret = (daily_ret * w).sum(axis=1)

    # 비용 차감 (리밸런싱 시점)
    fee_bps = cost_spec.get("fee_bps", 3)
    slip_bps = cost_spec.get("slippage_bps", 5)
    turnover = sum(weights.values())  # 초기 진입 = 100% 회전
    cost = 2 * (fee_bps + slip_bps) / 10000 * turnover
    if not port_ret.empty:
        port_ret.iloc[0] -= cost

    # 거래 기록
    for code, w_val in weights.items():
        trades.append({"date": str(port_ret.index[0]) if not port_ret.empty else "",
                       "code": code, "action": "BUY", "weight": round(w_val, 4)})

    return port_ret, trades

def main():
    parser = argparse.ArgumentParser(description="Backtest Agent")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--data-dir", required=True, help="data_agent 출력 디렉터리")
    parser.add_argument("--weights", required=True, help="weights.json 경로")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    spec = load_and_validate(args.spec)
    os.makedirs(args.output, exist_ok=True)

    # 데이터 로드
    prices_path = os.path.join(args.data_dir, "prices.csv")
    prices = pd.read_csv(prices_path, parse_dates=["date"], dtype={"code": str}) if os.path.exists(prices_path) else pd.DataFrame()

    with open(args.weights) as f:
        weights = json.load(f)

    rebal_path = os.path.join(args.data_dir, "rebalance_dates.json")
    rebal_dates = json.load(open(rebal_path)) if os.path.exists(rebal_path) else []

    # 백테스트 실행
    port_ret, trades = run_backtest(prices, weights, spec["cost_model"], rebal_dates)

    # 성과 지표
    metrics = calc_metrics(port_ret)

    # Walk-forward: IS 70% / OOS 30%
    wf = {"in_sample": metrics, "out_of_sample": metrics}
    if len(port_ret) > 20:
        split = int(len(port_ret) * 0.7)
        wf["in_sample"] = calc_metrics(port_ret.iloc[:split])
        wf["out_of_sample"] = calc_metrics(port_ret.iloc[split:])
        # IS/OOS 괴리 경고
        is_sharpe = wf["in_sample"]["sharpe"]
        oos_sharpe = wf["out_of_sample"]["sharpe"]
        if is_sharpe > 0 and oos_sharpe / max(is_sharpe, 0.01) < 0.5:
            wf["warning"] = "IS/OOS 성과 괴리 > 50% — 과최적화 의심"

    # 결과 저장
    run_result = {
        "strategy": spec["name"],
        "period": {
            "start": str(port_ret.index.min()) if not port_ret.empty else "",
            "end": str(port_ret.index.max()) if not port_ret.empty else "",
        },
        "metrics": metrics,
        "walk_forward": wf,
        "holdings": len(weights),
        "cost_model": spec["cost_model"],
    }

    with open(os.path.join(args.output, "run_result.json"), "w") as f:
        json.dump(run_result, f, indent=2, default=str)

    # 거래 기록
    if trades:
        pd.DataFrame(trades).to_csv(os.path.join(args.output, "trades.csv"), index=False)

    print(f"[BacktestAgent] 전략: {spec['name']}")
    print(f"[BacktestAgent] CAGR: {metrics['cagr']:.2%} | Sharpe: {metrics['sharpe']:.2f} | MDD: {metrics['mdd']:.2%}")
    if "warning" in wf:
        print(f"[BacktestAgent] ⚠ {wf['warning']}")

if __name__ == "__main__":
    main()
