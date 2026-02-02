"""Data Agent — 가격+재무 데이터 → 시점 정합성 패널 CSV

MVP: auto-trader 거래 데이터 + invest-quant 캐시에서 패널 구성.
Node 브릿지가 KIS/DART 데이터를 JSON으로 전달하면 이를 정제.
"""
import json, sys, os, argparse
import pandas as pd
import numpy as np
from core.schemas import load_and_validate
from core.data_clock import get_available_price_data, get_rebalance_dates

def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)

def build_price_panel(data_dir: str) -> pd.DataFrame:
    """Node 브릿지가 생성한 가격 캐시 → DataFrame.
    캐시 없으면 auto-trader trades/portfolio에서 최소 패널 구성.
    """
    hist_dir = os.path.join(data_dir, "historical")
    rows = []

    # 캐시된 일봉 데이터가 있으면 사용
    if os.path.isdir(hist_dir):
        for fname in os.listdir(hist_dir):
            if not fname.endswith(".json") or fname.startswith("_"):
                continue
            # {code}.json (배열) 만 사용, {code}_100d.json (캐시 래핑) 스킵
            if "_" in fname.replace(".json", ""):
                continue
            code = fname.replace(".json", "")
            raw = load_json(os.path.join(hist_dir, fname))
            if not raw:
                continue
            # 배열이면 직접, dict면 candles 키
            candles = raw if isinstance(raw, list) else raw.get("candles", [])
            for c in candles:
                if not isinstance(c, dict):
                    continue
                date_str = c.get("date", c.get("stck_bsop_date", ""))
                # YYYYMMDD → YYYY-MM-DD 변환
                if len(date_str) == 8 and date_str.isdigit():
                    date_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                rows.append({
                    "date": date_str,
                    "code": code,
                    "close": float(c.get("close", c.get("stck_clpr", 0))),
                    "volume": float(c.get("volume", c.get("acml_vol", 0))),
                    "open": float(c.get("open", c.get("stck_oprc", 0))),
                    "high": float(c.get("high", c.get("stck_hgpr", 0))),
                    "low": float(c.get("low", c.get("stck_lwpr", 0))),
                })

    if not rows:
        print("[DataAgent] 가격 캐시 없음 — 빈 패널 반환", file=sys.stderr)
        return pd.DataFrame(columns=["date", "code", "close", "volume", "open", "high", "low"])

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["code"] = df["code"].astype(str).str.zfill(6)  # 앞자리 0 보존
    df = df.sort_values(["code", "date"]).reset_index(drop=True)
    return df

def build_fundamental_panel(data_dir: str) -> pd.DataFrame:
    """캐시된 재무 데이터 → DataFrame"""
    fund_dir = os.path.join(data_dir, "fundamentals")
    rows = []

    if os.path.isdir(fund_dir):
        for fname in os.listdir(fund_dir):
            if not fname.endswith(".json") or fname.startswith("corp_code"):
                continue
            # DART 캐시 파일 (005930_2024_11011.json) 스킵 — 순수 종목 파일만 사용
            code = fname.replace(".json", "")
            if "_" in code:
                continue
            data = load_json(os.path.join(fund_dir, fname))
            if not data:
                continue
            ratios = data.get("ratios", data)
            rows.append({
                "code": code,
                "per": float(ratios.get("per", 0)),
                "pbr": float(ratios.get("pbr", 0)),
                "roe": float(ratios.get("roe", 0)),
                "debt_ratio": float(ratios.get("debtRatio", ratios.get("debt_ratio", 0))),
                "op_margin": float(ratios.get("operatingMargin", ratios.get("op_margin", 0))),
                "report_date": ratios.get("reportDate", ratios.get("report_date", "2025-01-01")),
            })

    if not rows:
        print("[DataAgent] 재무 캐시 없음 — 빈 패널 반환", file=sys.stderr)
        return pd.DataFrame(columns=["code", "per", "pbr", "roe", "debt_ratio", "op_margin", "report_date"])

    df = pd.DataFrame(rows)
    df["report_date"] = pd.to_datetime(df["report_date"])
    return df

def main():
    parser = argparse.ArgumentParser(description="Data Agent")
    parser.add_argument("--spec", required=True, help="strategy_spec.json 경로")
    parser.add_argument("--data-dir", default="/home/taeho/invest-quant/data", help="데이터 디렉터리")
    parser.add_argument("--output", required=True, help="출력 디렉터리")
    args = parser.parse_args()

    spec = load_and_validate(args.spec)
    os.makedirs(args.output, exist_ok=True)

    # 가격 패널
    prices = build_price_panel(args.data_dir)
    prices.to_csv(os.path.join(args.output, "prices.csv"), index=False)
    print(f"[DataAgent] 가격 패널: {len(prices)} rows, {prices['code'].nunique()} stocks")

    # 재무 패널
    fundamentals = build_fundamental_panel(args.data_dir)
    fundamentals.to_csv(os.path.join(args.output, "fundamentals.csv"), index=False)
    print(f"[DataAgent] 재무 패널: {len(fundamentals)} rows")

    # 리밸런싱 일정
    if not prices.empty:
        start = prices["date"].min().strftime("%Y-%m-%d")
        end = prices["date"].max().strftime("%Y-%m-%d")
    else:
        start, end = "2026-01-01", "2026-12-31"
    rebal_dates = get_rebalance_dates(start, end, spec["rebalance"]["freq"])
    with open(os.path.join(args.output, "rebalance_dates.json"), "w") as f:
        json.dump(rebal_dates, f, indent=2)
    print(f"[DataAgent] 리밸런싱 일정: {len(rebal_dates)} dates")

    # 결과 요약
    result = {
        "status": "ok",
        "price_rows": len(prices),
        "stocks": int(prices["code"].nunique()) if not prices.empty else 0,
        "fundamental_rows": len(fundamentals),
        "rebalance_dates": len(rebal_dates),
    }
    with open(os.path.join(args.output, "data_summary.json"), "w") as f:
        json.dump(result, f, indent=2)

if __name__ == "__main__":
    main()
