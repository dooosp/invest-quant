"""strategy_spec.json 검증"""
import json, sys

REQUIRED_KEYS = ["name", "universe", "rebalance", "factors", "signal", "portfolio", "cost_model", "risk_limits"]
VALID_METHODS = ["rank_sum", "rank_product"]
VALID_PORTFOLIO = ["top_n_equal", "risk_parity"]
VALID_FREQ = ["D", "W", "M", "Q"]

def validate(spec: dict) -> list[str]:
    errors = []
    for k in REQUIRED_KEYS:
        if k not in spec:
            errors.append(f"missing required key: {k}")
    if errors:
        return errors

    # universe
    u = spec["universe"]
    if "market" not in u:
        errors.append("universe.market required")

    # factors
    for i, f in enumerate(spec["factors"]):
        if "id" not in f or "type" not in f:
            errors.append(f"factors[{i}]: id and type required")

    # signal
    s = spec["signal"]
    if s.get("method") not in VALID_METHODS:
        errors.append(f"signal.method must be one of {VALID_METHODS}")
    weights = s.get("weights", {})
    factor_ids = {f["id"] for f in spec["factors"]}
    for wk in weights:
        if wk not in factor_ids:
            errors.append(f"signal.weights[{wk}] not in factors")

    # portfolio
    p = spec["portfolio"]
    if p.get("method") not in VALID_PORTFOLIO:
        errors.append(f"portfolio.method must be one of {VALID_PORTFOLIO}")
    if p.get("n", 0) < 1:
        errors.append("portfolio.n must be >= 1")

    # cost_model
    c = spec["cost_model"]
    if c.get("fee_bps", -1) < 0 or c.get("slippage_bps", -1) < 0:
        errors.append("cost_model: fee_bps and slippage_bps must be >= 0")

    # rebalance
    if spec["rebalance"].get("freq") not in VALID_FREQ:
        errors.append(f"rebalance.freq must be one of {VALID_FREQ}")

    return errors

def load_and_validate(path: str) -> dict:
    with open(path) as f:
        spec = json.load(f)
    errors = validate(spec)
    if errors:
        print(f"Validation errors in {path}:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    return spec
