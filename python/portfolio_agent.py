"""Portfolio Agent — 시그널 → 목표 비중 (제약 조건 반영)

MVP: top_n_equal (상위 N개 동일 비중) + 섹터/비중/회전율 제약
"""
import json, sys, os, argparse
import pandas as pd
import numpy as np
from core.schemas import load_and_validate

# 간이 섹터 매핑 (코스피200 주요 50종목)
SECTOR_MAP = {
    "005930": "반도체", "000660": "반도체", "042700": "반도체", "009150": "반도체",
    "005380": "자동차", "000270": "자동차", "012330": "자동차",
    "035420": "IT", "035720": "IT", "036570": "IT", "018260": "IT",
    "068270": "바이오", "207940": "바이오", "000100": "바이오",
    "006400": "2차전지", "373220": "2차전지", "247540": "2차전지",
    "003550": "지주", "034730": "지주", "267250": "지주", "078930": "지주",
    "051910": "화학", "011170": "화학", "096770": "화학", "010950": "화학",
    "055550": "금융", "105560": "금융", "086790": "금융", "032830": "금융",
    "316140": "금융", "138040": "금융", "024110": "금융", "000810": "금융", "006800": "금융",
    "015760": "유틸리티", "017670": "통신", "030200": "통신",
    "005490": "철강", "004020": "철강", "010130": "철강",
    "028260": "건설", "047050": "무역",
    "066570": "전자", "003490": "항공", "011200": "해운",
    "009540": "조선", "042660": "조선", "010140": "조선", "329180": "조선",
    "352820": "엔터",
}

def get_sector(code: str) -> str:
    return SECTOR_MAP.get(code, "기타")

def build_weights(signals: pd.DataFrame, spec: dict, prev_weights: dict = None) -> dict:
    """상위 N개 동일 비중 + 제약 조건"""
    pconf = spec["portfolio"]
    n = pconf["n"]
    max_weight = pconf.get("max_weight", 1.0)
    sector_cap = pconf.get("sector_cap", 1.0)
    max_turnover = spec["risk_limits"].get("max_turnover", 1.0)

    # 상위 N개 선별
    top_n = signals.head(n)
    codes = top_n.index.tolist() if "code" not in top_n.columns else top_n["code"].tolist()

    if not codes:
        return {}

    # 동일 비중
    raw_weight = 1.0 / len(codes)
    weights = {c: min(raw_weight, max_weight) for c in codes}

    # 섹터 캡 적용
    sector_weights = {}
    for c, w in weights.items():
        s = get_sector(c)
        sector_weights.setdefault(s, []).append(c)

    for sector, sector_codes in sector_weights.items():
        total = sum(weights[c] for c in sector_codes)
        if total > sector_cap:
            scale = sector_cap / total
            for c in sector_codes:
                weights[c] *= scale

    # 정규화 (합계 = 1.0)
    total = sum(weights.values())
    if total > 0:
        weights = {c: w / total for c, w in weights.items()}

    # 회전율 제약
    if prev_weights:
        turnover = sum(abs(weights.get(c, 0) - prev_weights.get(c, 0))
                       for c in set(list(weights.keys()) + list(prev_weights.keys())))
        if turnover > max_turnover:
            scale = max_turnover / turnover
            # 변화분만 스케일링
            for c in weights:
                prev = prev_weights.get(c, 0)
                weights[c] = prev + (weights[c] - prev) * scale
            # 빠진 종목 복원
            for c in prev_weights:
                if c not in weights:
                    weights[c] = prev_weights[c] * (1 - scale)
            # 재정규화
            total = sum(weights.values())
            if total > 0:
                weights = {c: w / total for c, w in weights.items()}

    # 0 이하 제거
    weights = {c: round(w, 6) for c, w in weights.items() if w > 0.001}
    return weights

def main():
    parser = argparse.ArgumentParser(description="Portfolio Agent")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--input", required=True, help="factor_agent 출력 디렉터리")
    parser.add_argument("--output", required=True)
    parser.add_argument("--prev-weights", default=None, help="이전 비중 JSON")
    args = parser.parse_args()

    spec = load_and_validate(args.spec)
    os.makedirs(args.output, exist_ok=True)

    signals_path = os.path.join(args.input, "signals.csv")
    if not os.path.exists(signals_path):
        print("[PortfolioAgent] signals.csv 없음", file=sys.stderr)
        sys.exit(1)

    signals = pd.read_csv(signals_path, dtype={"code": str}, index_col="code")

    prev = {}
    if args.prev_weights and os.path.exists(args.prev_weights):
        with open(args.prev_weights) as f:
            prev = json.load(f)

    weights = build_weights(signals, spec, prev)

    # 출력
    out_path = os.path.join(args.output, "weights.json")
    with open(out_path, "w") as f:
        json.dump(weights, f, indent=2)

    print(f"[PortfolioAgent] {len(weights)} 종목 비중 설정")
    for c, w in sorted(weights.items(), key=lambda x: -x[1])[:5]:
        print(f"  {c} ({get_sector(c)}): {w:.2%}")

    # 요약
    result = {"status": "ok", "holdings": len(weights),
              "weights": weights, "sectors": {}}
    for c, w in weights.items():
        s = get_sector(c)
        result["sectors"][s] = result["sectors"].get(s, 0) + w
    with open(os.path.join(args.output, "portfolio_summary.json"), "w") as f:
        json.dump(result, f, indent=2)

if __name__ == "__main__":
    main()
