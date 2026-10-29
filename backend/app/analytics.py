
"""Forecast evaluation for national wind generation."""

import math

import pandas as pd


def prepare_actuals(records: list[dict]) -> pd.DataFrame:
    """Normalize actual wind generation records."""
    df = pd.DataFrame(records)

    if df.empty:
        return pd.DataFrame(columns=["startTime", "actual_mw"])

    required = {"startTime", "generation"}
    if not required.issubset(df.columns):
        raise ValueError(f"Actual data must contain {required}")

    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["actual_mw"] = pd.to_numeric(df["generation"], errors="coerce")

    df = df.dropna(subset=["startTime", "actual_mw"])

    # There should be one national actual value per delivery interval.
    return (
        df.groupby("startTime", as_index=False)["actual_mw"]
        .mean()
        .sort_values("startTime")
    )


def prepare_forecasts(records: list[dict]) -> pd.DataFrame:
    """Normalize forecast records and retain publication timestamps."""
    df = pd.DataFrame(records)

    if df.empty:
        return pd.DataFrame(
            columns=["startTime", "publishTime", "forecast_mw"]
        )

    required = {"startTime", "publishTime", "generation"}
    if not required.issubset(df.columns):
        raise ValueError(f"Forecast data must contain {required}")

    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df["forecast_mw"] = pd.to_numeric(df["generation"], errors="coerce")

    return df.dropna(
        subset=["startTime", "publishTime", "forecast_mw"]
    )



def match_day_ahead_forecasts(
    actuals: pd.DataFrame,
    forecasts: pd.DataFrame,
) -> pd.DataFrame:
    """Compare hourly forecasts with hourly average actual generation."""

    if actuals.empty or forecasts.empty:
        return pd.DataFrame()

    actuals = actuals.copy()
    forecasts = forecasts.copy()

    # Aggregate half-hourly actual MW readings to hourly average MW.
    actuals["hour"] = actuals["startTime"].dt.floor("h")
    hourly_actuals = (
        actuals.groupby("hour", as_index=False)["actual_mw"]
        .mean()
        .rename(columns={"hour": "startTime"})
    )

    # Keep forecasts published before the start of their delivery day.
    forecasts["delivery_day_start"] = forecasts["startTime"].dt.floor("D")

    eligible = forecasts[
        forecasts["publishTime"] < forecasts["delivery_day_start"]
    ].copy()

    if eligible.empty:
        return pd.DataFrame()

    # Retain the most recent eligible publication per delivery hour.
    eligible = eligible.sort_values("publishTime")
    selected = eligible.drop_duplicates(
        subset=["startTime"], keep="last"
    )

    matched = hourly_actuals.merge(
        selected[["startTime", "publishTime", "forecast_mw"]],
        on="startTime",
        how="inner",
        validate="one_to_one",
    )

    if matched.empty:
        return matched

    matched["error_mw"] = matched["forecast_mw"] - matched["actual_mw"]
    matched["absolute_error_mw"] = matched["error_mw"].abs()
    matched["squared_error"] = matched["error_mw"] ** 2

    matched["absolute_percentage_error"] = (
        matched["absolute_error_mw"]
        / matched["actual_mw"].abs().replace(0, float("nan"))
        * 100
    )

    return matched.sort_values("startTime")



def calculate_metrics(matched: pd.DataFrame) -> dict:
    """Calculate aggregate forecast accuracy metrics."""
    if matched.empty:
        return {
            "intervals_evaluated": 0,
            "mae_mw": None,
            "rmse_mw": None,
            "bias_mw": None,
            "mape_percent": None,
        }

    errors = matched["error_mw"]

    mape_values = matched["absolute_percentage_error"].dropna()

    return {
        "intervals_evaluated": int(len(matched)),
        "mae_mw": round(float(matched["absolute_error_mw"].mean()), 2),
        "rmse_mw": round(math.sqrt(float(matched["squared_error"].mean())), 2),
        "bias_mw": round(float(errors.mean()), 2),
        "mape_percent": (
            round(float(mape_values.mean()), 2)
            if not mape_values.empty
            else None
        ),
    }
