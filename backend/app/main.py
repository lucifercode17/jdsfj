
from datetime import date
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import time
from datetime import date, timedelta

from app.exelon import fetch_actual_wind, fetch_wind_forecasts
from app.analytics import (
    prepare_actuals,
    prepare_forecasts,
    match_day_ahead_forecasts,
    calculate_metrics,
)

app = FastAPI(
    title="UK Wind Forecast Dashboard API",
    description="Actual and forecast wind generation for January 2026.",
    version="0.1.0",
)

frontend_origins = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
)

allowed_origins = [
    origin.strip().rstrip("/")
    for origin in frontend_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# In-memory cache for forecast accuracy results
CACHE_TTL_SECONDS = 60 * 30# 30 mins 

accuracy_cache = {}
accuracy_cache_lock = asyncio.Lock()


@app.get("/")
async def root():
    return {
        "name": "UK Wind Forecast Dashboard API",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/wind/actual")
async def actual_wind(
    start: date = Query(default=date(2026, 1, 1)),
    end: date = Query(default=date(2026, 1, 31)),
):
    try:
        records = await fetch_actual_wind(start, end)
        return {
            "dataset": "FUELHH",
            "start": start,
            "end": end,
            "count": len(records),
            "data": records,
        }
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve actual generation: {exc}",
        ) from exc


@app.get("/api/wind/forecasts")
async def wind_forecasts(
    start: date = Query(default=date(2026, 1, 1)),
    end: date = Query(default=date(2026, 1, 31)),
):
    try:
        records = await fetch_wind_forecasts(start, end)
        return {
            "dataset": "WINDFOR",
            "start": start,
            "end": end,
            "count": len(records),
            "data": records,
        }
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve wind forecasts: {exc}",
        ) from exc



@app.get("/api/wind/accuracy")
async def wind_accuracy(
    start: date = Query(default=date(2026, 1, 1)),
    end: date = Query(default=date(2026, 1, 31)),
):
    if end < start:
        raise HTTPException(
            status_code=400,
            detail="end must be on or after start",
        )

    cache_key = (start, end)
    now = time.monotonic()

    # Return cached data when it is still valid.
    cached = accuracy_cache.get(cache_key)
    if cached and now < cached["expires_at"]:
        return cached["data"]

    # Prevent simultaneous requests from fetching the same data repeatedly.
    async with accuracy_cache_lock:
        now = time.monotonic()
        cached = accuracy_cache.get(cache_key)

        if cached and now < cached["expires_at"]:
            return cached["data"]

        try:
            actual_records = await fetch_actual_wind(start, end)

            forecast_records = await fetch_wind_forecasts(
                start - timedelta(days=1), end
            )

            actuals = prepare_actuals(actual_records)
            forecasts = prepare_forecasts(forecast_records)

            matched = match_day_ahead_forecasts(actuals, forecasts)
            metrics = calculate_metrics(matched)

            result = {
                "period": {
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                },
                "forecast_selection": (
                    "Latest forecast published before delivery day starts"
                ),
                "metrics": metrics,
                "data": [
                    {
                        "startTime": row.startTime.isoformat(),
                        "publishTime": row.publishTime.isoformat(),
                        "actual_mw": round(float(row.actual_mw), 2),
                        "forecast_mw": round(float(row.forecast_mw), 2),
                        "error_mw": round(float(row.error_mw), 2),
                    }
                    for row in matched.itertuples(index=False)
                ],
            }

            accuracy_cache[cache_key] = {
                "expires_at": time.monotonic() + CACHE_TTL_SECONDS,
                "data": result,
            }

            return result

        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not calculate forecast accuracy: {exc}",
            ) from exc

@app.get("/api/debug/wind")
async def debug_wind_data():
    from datetime import timedelta

    start = date(2026, 1, 1)
    end = date(2026, 1, 31)

    try:
        actual_records = await fetch_actual_wind(start, end)
        forecast_records = await fetch_wind_forecasts(
            start - timedelta(days=1), end
        )

        actuals = prepare_actuals(actual_records)
        forecasts = prepare_forecasts(forecast_records)

        eligible_count = 0
        if not forecasts.empty:
            delivery_day = forecasts["startTime"].dt.floor("D")
            eligible_count = int(
                (forecasts["publishTime"] < delivery_day).sum()
            )

        return {
            "actual_count": len(actual_records),
            "forecast_count": len(forecast_records),
            "actual_columns": list(actual_records[0].keys())
            if actual_records else [],
            "forecast_columns": list(forecast_records[0].keys())
            if forecast_records else [],
            "actual_sample": actual_records[:2],
            "forecast_sample": forecast_records[:3],
            "normalized_actual_count": len(actuals),
            "normalized_forecast_count": len(forecasts),
            "eligible_forecast_count": eligible_count,
            "actual_time_range": {
                "first": str(actuals["startTime"].min()),
                "last": str(actuals["startTime"].max()),
            } if not actuals.empty else None,
            "forecast_time_range": {
                "first_delivery": str(forecasts["startTime"].min()),
                "last_delivery": str(forecasts["startTime"].max()),
                "first_publication": str(forecasts["publishTime"].min()),
                "last_publication": str(forecasts["publishTime"].max()),
            } if not forecasts.empty else None,
        }

    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
