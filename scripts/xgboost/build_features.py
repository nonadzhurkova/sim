"""
Builds a no-lookahead feature table from data/historical/*.csv (2014-2026,
source: tracinginsights/RaceData on Hugging Face) for the XGBoost
predictor. Every rolling feature for a race uses only that driver's/
constructor's races strictly before it. Regulation era is included as an
explicit feature since this span crosses three car-regulation eras.
"""
import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "historical"

FEATURES = [
    "grid",
    "qualiGapToPole",
    "driverFormFinish",
    "driverDnfRate",
    "constructorFormFinish",
    "constructorDnfRate",
]


def parse_quali_time(t):
    if pd.isna(t) or t == r"\N":
        return np.nan
    try:
        m, s = t.split(":")
        return int(m) * 60 + float(s)
    except (ValueError, AttributeError):
        return np.nan


def build_feature_table(min_year: int = 2014, max_year: int = 2026) -> pd.DataFrame:
    races = pd.read_csv(DATA_DIR / "races.csv")[["raceId", "year", "round", "circuitId"]]
    results = pd.read_csv(DATA_DIR / "results.csv")
    qualifying = pd.read_csv(DATA_DIR / "qualifying.csv")
    status = pd.read_csv(DATA_DIR / "status.csv")

    finished_status_ids = set(
        status[status["status"].str.match(r"^(Finished|\+\d+ Laps?)$")]["statusId"]
    )

    races = races.copy()
    races["era"] = pd.cut(
        races["year"],
        bins=[min_year - 1, 2016, 2021, max_year],
        labels=["hybrid_narrow_2014_2016", "hybrid_wide_2017_2021", "ground_effect_2022_2026"],
    )

    df = results.merge(races, on="raceId", how="inner")
    df = df[(df["year"] >= min_year) & (df["year"] <= max_year)].copy()
    # Ergast's \N null marker appears for a handful of pit-lane-start /
    # withdrawn entries with no recorded grid slot.
    df["grid"] = pd.to_numeric(df["grid"], errors="coerce")
    df["dnfOccurred"] = (~df["statusId"].isin(finished_status_ids)).astype(int)
    df["finishPosition"] = df["positionOrder"]  # already DNF-last ordered

    qualifying = qualifying.copy()
    for col in ["q1", "q2", "q3"]:
        qualifying[col + "_s"] = qualifying[col].apply(parse_quali_time)
    qualifying["bestQualiTime"] = qualifying[["q1_s", "q2_s", "q3_s"]].min(axis=1)
    pole_time = qualifying.groupby("raceId")["bestQualiTime"].min().rename("poleTime")
    qualifying = qualifying.merge(pole_time, on="raceId", how="left")
    qualifying["qualiGapToPole"] = qualifying["bestQualiTime"] - qualifying["poleTime"]

    df = df.merge(
        qualifying[["raceId", "driverId", "qualiGapToPole"]],
        on=["raceId", "driverId"],
        how="left",
    )

    df = df.sort_values(["year", "round", "raceId"]).reset_index(drop=True)

    def rolling_no_lookahead(group_col, value_col, window=5):
        return (
            df.groupby(group_col)[value_col]
            .apply(lambda s: s.shift(1).rolling(window, min_periods=1).mean())
            .reset_index(level=0, drop=True)
        )

    df["driverFormFinish"] = rolling_no_lookahead("driverId", "finishPosition")
    df["driverDnfRate"] = rolling_no_lookahead("driverId", "dnfOccurred")
    df["constructorFormFinish"] = rolling_no_lookahead("constructorId", "finishPosition")
    df["constructorDnfRate"] = rolling_no_lookahead("constructorId", "dnfOccurred")

    return df[
        ["raceId", "year", "round", "driverId", "constructorId", "era", *FEATURES, "finishPosition", "dnfOccurred"]
    ]


if __name__ == "__main__":
    out = build_feature_table()
    out_path = DATA_DIR.parent.parent / "scripts" / "xgboost" / "feature_table.csv"
    out.to_csv(out_path, index=False)
    print(f"Wrote {len(out)} rows to {out_path}")
