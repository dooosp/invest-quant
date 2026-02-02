"""Factor Agent — 팩터 계산/시그널 생성

각 팩터별 cross-sectional 백분위 랭킹 → 복합 스코어 → 종목 랭킹
"""
import json, sys, os, argparse
import pandas as pd
import numpy as np
from core.schemas import load_and_validate

def winsorize(series: pd.Series, lower: float = 0.01, upper: float = 0.99) -> pd.Series:
    """극단값 제거"""
    lo, hi = series.quantile(lower), series.quantile(upper)
    return series.clip(lo, hi)

def zscore(series: pd.Series) -> pd.Series:
    """표준화"""
    std = series.std()
    if std == 0:
        return series * 0
    return (series - series.mean()) / std

def percentile_rank(series: pd.Series) -> pd.Series:
    """백분위 랭킹 (0~100)"""
    return series.rank(pct=True) * 100

def calc_momentum(prices: pd.DataFrame, code: str, lookback: int, skip: int = 0) -> float:
    """가격 모멘텀: lookback일 수익률 (최근 skip일 제외)"""
    stock = prices[prices["code"] == code].sort_values("date")
    if len(stock) < lookback + skip:
        return np.nan
    if skip > 0:
        end_price = stock["close"].iloc[-(skip + 1)]
    else:
        end_price = stock["close"].iloc[-1]
    start_price = stock["close"].iloc[-(lookback + skip)]
    if start_price == 0:
        return np.nan
    return (end_price - start_price) / start_price * 100

def compute_factor(factor_spec: dict, prices: pd.DataFrame, fundamentals: pd.DataFrame, codes: list) -> pd.Series:
    """팩터 정의에 따라 종목별 팩터 값 계산"""
    ftype = factor_spec["type"]
    fid = factor_spec["id"]

    if ftype == "ratio":
        formula = factor_spec.get("formula", fid)
        col_map = {"1/PER": ("per", True), "PER": ("per", False),
                   "1/PBR": ("pbr", True), "PBR": ("pbr", False),
                   "ROE": ("roe", False), "roe": ("roe", False)}
        if formula in col_map:
            col, invert = col_map[formula]
            if col not in fundamentals.columns:
                return pd.Series(np.nan, index=codes, name=fid)
            vals = fundamentals.set_index("code").reindex(codes)[col]
            if invert:
                vals = vals.replace(0, np.nan)
                vals = 1.0 / vals
            return vals.rename(fid)
        return pd.Series(np.nan, index=codes, name=fid)

    elif ftype == "price_momentum":
        lookback = factor_spec.get("lookback", 60)
        skip = factor_spec.get("skip", 0)
        vals = pd.Series({c: calc_momentum(prices, c, lookback, skip) for c in codes}, name=fid)
        return vals

    return pd.Series(np.nan, index=codes, name=fid)

def main():
    parser = argparse.ArgumentParser(description="Factor Agent")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--input", required=True, help="data_agent 출력 디렉터리")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    spec = load_and_validate(args.spec)
    os.makedirs(args.output, exist_ok=True)

    prices = pd.read_csv(os.path.join(args.input, "prices.csv"), parse_dates=["date"], dtype={"code": str}) \
        if os.path.exists(os.path.join(args.input, "prices.csv")) else pd.DataFrame()
    fundamentals = pd.read_csv(os.path.join(args.input, "fundamentals.csv"), dtype={"code": str}) \
        if os.path.exists(os.path.join(args.input, "fundamentals.csv")) else pd.DataFrame()

    # 유니버스: 가격+재무 모두 있는 종목
    codes = sorted(set(prices["code"].unique()) | set(fundamentals["code"].unique())) if not prices.empty or not fundamentals.empty else []

    if len(codes) < 2:
        print("[FactorAgent] 종목 수 부족 — 최소 2개 필요", file=sys.stderr)
        pd.DataFrame(columns=["code", "composite_score", "rank"]).to_csv(
            os.path.join(args.output, "signals.csv"), index=False)
        json.dump({"status": "insufficient_data", "stocks": len(codes)},
                  open(os.path.join(args.output, "factor_summary.json"), "w"), indent=2)
        return

    # 팩터 계산
    factor_df = pd.DataFrame(index=codes)
    for fspec in spec["factors"]:
        raw = compute_factor(fspec, prices, fundamentals, codes)
        # winsorize
        if "winsorize" in fspec:
            lo, hi = fspec["winsorize"]
            raw = winsorize(raw, lo, hi)
        # zscore
        if fspec.get("zscore"):
            raw = zscore(raw)
        # 백분위 랭킹
        factor_df[fspec["id"]] = percentile_rank(raw)

    # NaN을 50(중립)으로 채움 (해당 팩터 데이터 없는 종목)
    factor_df = factor_df.fillna(50.0)

    # 복합 스코어
    weights = spec["signal"]["weights"]
    factor_df["composite_score"] = sum(
        factor_df[fid] * w for fid, w in weights.items() if fid in factor_df.columns
    )
    factor_df["rank"] = factor_df["composite_score"].rank(ascending=False).fillna(len(factor_df)).astype(int)
    factor_df = factor_df.sort_values("rank")
    factor_df.index.name = "code"

    # 출력
    factor_df.to_csv(os.path.join(args.output, "signals.csv"))
    print(f"[FactorAgent] {len(factor_df)} 종목 스코어링 완료")
    print(f"[FactorAgent] 상위 5:")
    for _, row in factor_df.head(5).iterrows():
        print(f"  {row.name}: score={row['composite_score']:.1f} rank={int(row['rank'])}")

    # 요약
    result = {"status": "ok", "stocks": len(factor_df),
              "top5": factor_df.head(5).reset_index()[["code", "composite_score", "rank"]].to_dict("records")}
    with open(os.path.join(args.output, "factor_summary.json"), "w") as f:
        json.dump(result, f, indent=2, default=str)

if __name__ == "__main__":
    main()
