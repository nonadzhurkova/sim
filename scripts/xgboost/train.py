"""
One-time training step: fits the finish-position regressor and DNF
classifier on the full 2014-2026 historical CSVs (data/historical/,
source: tracinginsights/RaceData), then fits a Platt-scaling calibration
for the resulting win probabilities.

Run this once (or whenever data/historical/ is refreshed with a newer
snapshot) -- NOT per prediction. Saves the trained artifacts to
scripts/xgboost/model/ for score.py to load and reuse without retraining.

Usage: python scripts/xgboost/train.py
"""
import json
import sys
import numpy as np
import pandas as pd
from pathlib import Path
from xgboost import XGBRegressor, XGBClassifier

sys.path.insert(0, str(Path(__file__).parent))
from build_features import build_feature_table, FEATURES  # noqa: E402

MODEL_DIR = Path(__file__).parent / "model"


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def logit(p, eps=1e-4):
    c = np.clip(p, eps, 1 - eps)
    return np.log(c / (1 - c))


def fit_platt_scaling(probs, won, iterations=5000, lr=0.05):
    """Same algorithm as src/sim/calibration.ts's fitPlattScaling, ported to
    Python so both pipelines' calibration are fit the same way."""
    x = logit(np.asarray(probs))
    y = np.asarray(won, dtype=float)
    a, b = 1.0, 0.0
    n = len(x)
    for _ in range(iterations):
        pred = sigmoid(a * x + b)
        err = pred - y
        grad_a = np.dot(err, x) / n
        grad_b = err.sum() / n
        a -= lr * grad_a
        b -= lr * grad_b
    return a, b


def export_trees(booster):
    """Exports a fitted booster as plain nested dicts (feature name, split
    threshold, yes/no/missing child node ids, leaf value) via XGBoost's own
    get_dump(dump_format='json') -- deliberately NOT the raw native model
    file format, which encodes extra internal bookkeeping (categorical split
    flags, per-tree stats) a hand-written reader would have to get exactly
    right to avoid silently wrong predictions. This dump format is already
    the minimal shape a tree-walk needs: {nodeid, split, split_condition,
    yes, no, missing, children} or {nodeid, leaf}."""
    import json as _json

    return [_json.loads(t) for t in booster.get_dump(dump_format="json")]


def base_score_of(model) -> float:
    config = json.loads(model.get_booster().save_config())
    raw = config["learner"]["learner_model_param"]["base_score"]
    # XGBoost serializes this as a bracketed string like "[1.0626621E1]"
    # rather than a plain number.
    return float(raw.strip("[]"))


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    print("Building feature table from data/historical/ (2014-2026)...")
    df = build_feature_table()
    era_dummies = pd.get_dummies(df["era"], prefix="era")
    all_features = FEATURES + list(era_dummies.columns)
    df = pd.concat([df, era_dummies], axis=1)
    df = df.dropna(subset=all_features).reset_index(drop=True)
    print(f"Training rows: {len(df)}")

    reg = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
    reg.fit(df[all_features], df["finishPosition"])
    clf = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
    clf.fit(df[all_features], df["dnfOccurred"])

    # Training medians, so a live feature that's null (a driver/team with no
    # rolling history yet) can be filled the same way this training pass
    # would have -- dropna() above means the trained model never saw a null,
    # so an unfilled null at inference time would be out of distribution.
    medians = {col: float(df[col].median()) for col in FEATURES}

    # Fit Platt calibration on the model's own in-sample win probabilities.
    # This is looser than the held-out validation done during the POC (fit
    # on 2025+2026, checked cold on 2024) -- this is the FINAL production
    # fit, using all data, after that validation already passed. See
    # project memory: xgboost-poc-rejected.md's 2014-2026 retest.
    df["predFinishPosition"] = reg.predict(df[all_features])
    win_probs = []
    won = []
    for race_id, g in df.groupby("raceId"):
        strengths = np.exp(-g["predFinishPosition"].values)
        probs = strengths / strengths.sum()
        actual_winner_idx = g["finishPosition"].values.argmin()
        for i, p in enumerate(probs):
            win_probs.append(p)
            won.append(1 if i == actual_winner_idx else 0)

    a, b = fit_platt_scaling(win_probs, won)
    print(f"Fitted calibration: a={a:.4f} b={b:.4f}")

    # Single combined, TS-readable model file -- deliberately not XGBoost's
    # native save_model() format (see export_trees' docstring for why).
    # src/sim/xgboost-model.ts reads exactly this shape to walk the trees
    # itself, so predictions can run inside the Next.js process with no
    # Python at request time.
    model_payload = {
        "features": all_features,
        "featureMedians": medians,
        "calibration": {"a": a, "b": b},
        "finishPositionRegressor": {
            "baseScore": base_score_of(reg),
            "trees": export_trees(reg.get_booster()),
        },
        "dnfClassifier": {
            "baseScore": base_score_of(clf),
            "trees": export_trees(clf.get_booster()),
        },
    }
    (MODEL_DIR / "model.json").write_text(json.dumps(model_payload))
    print(f"\nSaved trained model + calibration to {MODEL_DIR / 'model.json'}")


if __name__ == "__main__":
    main()
