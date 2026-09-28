"""
Batch-generates XGBoost predictions for every race in a given season, for
backtest validation against the production Monte Carlo engine. Retrains
XGBoost fresh for each race (no lookahead -- trains only on data strictly
before that race), same as predict.py's single-race path, just looped.
Throwaway validation script, not part of the regular workflow.

Usage: python scripts/xgboost/batch_predict.py <year>
"""
import sys
import json
import numpy as np
import pandas as pd
from pathlib import Path
from xgboost import XGBRegressor, XGBClassifier

sys.path.insert(0, str(Path(__file__).parent))
from build_features import build_feature_table, FEATURES  # noqa: E402

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "historical"


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/xgboost/batch_predict.py <year>")
        sys.exit(1)
    target_year = int(sys.argv[1])

    df = build_feature_table()
    era_dummies = pd.get_dummies(df["era"], prefix="era")
    all_features = FEATURES + list(era_dummies.columns)
    df = pd.concat([df, era_dummies], axis=1)

    drivers = pd.read_csv(DATA_DIR / "drivers.csv")[["driverId", "driverRef"]]

    rounds = sorted(df[df["year"] == target_year]["round"].unique())
    print(f"Generating predictions for {len(rounds)} races in {target_year}...")

    predictions_dir = Path(__file__).parent.parent.parent / "data" / "xgboost-predictions"
    predictions_dir.mkdir(parents=True, exist_ok=True)

    for target_round in rounds:
        train_mask = (df["year"] < target_year) | ((df["year"] == target_year) & (df["round"] < target_round))
        target_mask = (df["year"] == target_year) & (df["round"] == target_round)

        train_df = df[train_mask].dropna(subset=all_features)
        target_df = df[target_mask].copy()
        if target_df.empty or len(train_df) < 100:
            print(f"  round {target_round}: skipped (insufficient data)")
            continue

        for col in all_features:
            target_df[col] = target_df[col].fillna(train_df[col].median())

        reg = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
        reg.fit(train_df[all_features], train_df["finishPosition"])
        clf = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=0)
        clf.fit(train_df[all_features], train_df["dnfOccurred"])

        target_df["predFinishPosition"] = reg.predict(target_df[all_features])
        target_df["predDnfProb"] = clf.predict_proba(target_df[all_features])[:, 1]
        target_df = target_df.merge(drivers, on="driverId", how="left")

        payload = {
            "year": int(target_year),
            "round": int(target_round),
            "trainedOnRows": len(train_df),
            "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
            "drivers": [
                {
                    "driverRef": row["driverRef"],
                    "predFinishPosition": round(float(row["predFinishPosition"]), 3),
                    "predDnfProb": round(float(row["predDnfProb"]), 4),
                }
                for _, row in target_df.iterrows()
            ],
        }
        out_path = predictions_dir / f"{target_year}-{target_round}.json"
        out_path.write_text(json.dumps(payload, indent=2))
        print(f"  round {target_round}: wrote {out_path.name} ({len(target_df)} drivers, trained on {len(train_df)} rows)")


if __name__ == "__main__":
    main()
