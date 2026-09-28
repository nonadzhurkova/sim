"""
XGBoost race predictor, trained on data/historical/*.csv (2014-2026,
tracinginsights/RaceData). Standalone from the production TypeScript
pipeline and NOT wired into the app or validated against its calibrated
Monte Carlo backtest -- see README's "What's been tried" section and
project memory (xgboost-poc-rejected.md, then the 2014-2026 retest that
un-rejected it once enough data was used).

Usage:
    python scripts/xgboost/predict.py <year> <round>

Trains on every race strictly before the given (year, round) -- no
lookahead -- then predicts a win-probability ranking for that race's field.
Requires: pip install -r scripts/xgboost/requirements.txt
"""
import json
import sys
import numpy as np
import pandas as pd
from pathlib import Path
from xgboost import XGBRegressor, XGBClassifier

# Windows consoles often default to a legacy codepage that can't encode
# driver names with accents (e.g. "Hülkenberg"); force UTF-8 for stdout.
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from build_features import build_feature_table, FEATURES  # noqa: E402

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "historical"


def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/xgboost/predict.py <year> <round>")
        sys.exit(1)
    target_year, target_round = int(sys.argv[1]), int(sys.argv[2])

    df = build_feature_table()
    era_dummies = pd.get_dummies(df["era"], prefix="era")
    all_features = FEATURES + list(era_dummies.columns)
    df = pd.concat([df, era_dummies], axis=1)

    train_mask = (df["year"] < target_year) | ((df["year"] == target_year) & (df["round"] < target_round))
    target_mask = (df["year"] == target_year) & (df["round"] == target_round)

    train_df = df[train_mask].dropna(subset=all_features)
    target_df = df[target_mask].copy()

    if target_df.empty:
        print(f"No entrants found for {target_year} round {target_round} in the historical data.")
        sys.exit(1)
    if len(train_df) < 100:
        print(f"Only {len(train_df)} training rows before {target_year} round {target_round} -- too little data to trust.")
        sys.exit(1)

    # Rows missing a feature (no rolling history yet, e.g. a driver's first
    # race) get the training set's median for that feature rather than
    # being dropped -- a target-race entrant can't simply be excluded.
    for col in all_features:
        target_df[col] = target_df[col].fillna(train_df[col].median())

    reg = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
    reg.fit(train_df[all_features], train_df["finishPosition"])

    clf = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
    clf.fit(train_df[all_features], train_df["dnfOccurred"])

    target_df["predFinishPosition"] = reg.predict(target_df[all_features])
    target_df["predDnfProb"] = clf.predict_proba(target_df[all_features])[:, 1]

    # Win probability via softmax over negative predicted finish position --
    # a proxy ranking, not a calibrated Monte Carlo probability like the
    # production model's. Treat as relative ordering + rough confidence,
    # not a validated percentage.
    strengths = np.exp(-target_df["predFinishPosition"].values)
    target_df["winProbability"] = strengths / strengths.sum()

    drivers = pd.read_csv(DATA_DIR / "drivers.csv")[["driverId", "driverRef", "forename", "surname"]]
    constructors = pd.read_csv(DATA_DIR / "constructors.csv")[["constructorId", "name"]]
    target_df = target_df.merge(drivers, on="driverId", how="left").merge(
        constructors, on="constructorId", how="left"
    )
    target_df["driverName"] = target_df["forename"] + " " + target_df["surname"]

    out = target_df.sort_values("winProbability", ascending=False)[
        ["driverName", "driverRef", "name", "grid", "predFinishPosition", "predDnfProb", "winProbability"]
    ].rename(columns={"name": "constructor"})

    print(f"\n=== XGBoost prediction: {target_year} round {target_round} ===")
    print(f"(trained on {len(train_df)} driver-races strictly before this one)\n")
    with pd.option_context("display.float_format", "{:.3f}".format):
        print(out.to_string(index=False))

    # Committed-file output for the app to read, keyed by driverRef -- the
    # Jolpica driver-slug (e.g. "hamilton", "max_verstappen") that this
    # dataset shares with the production DB's drivers.externalRef column,
    # a reliable join key across the two separate ID spaces. No live file
    # I/O at request time -- this JSON is generated locally and checked
    # into the repo, then read like any other static asset, so it works
    # unchanged on a read-only deployment filesystem (e.g. Vercel).
    predictions_dir = Path(__file__).parent.parent.parent / "data" / "xgboost-predictions"
    predictions_dir.mkdir(parents=True, exist_ok=True)
    out_path = predictions_dir / f"{target_year}-{target_round}.json"
    payload = {
        "year": target_year,
        "round": target_round,
        "trainedOnRows": len(train_df),
        "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "drivers": [
            {
                "driverRef": row["driverRef"],
                "driverName": row["driverName"],
                "predFinishPosition": round(float(row["predFinishPosition"]), 3),
                "predDnfProb": round(float(row["predDnfProb"]), 4),
            }
            for _, row in out.iterrows()
        ],
    }
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
