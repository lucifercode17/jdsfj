
"""Client for the official Elexon BMRS API."""

from datetime import date, datetime, time, timedelta, timezone

import httpx
import pandas as pd
BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
TIMEOUT = 60.0


def utc_range(start_date: date, end_date: date) -> tuple[str, str]:
    """Return a UTC range covering the requested UK calendar dates."""
    start = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end = datetime.combine(
        end_date + timedelta(days=1), time.min, tzinfo=timezone.utc
    )
    return (
        start.isoformat(timespec="seconds").replace("+00:00", "Z"),
        end.isoformat(timespec="seconds").replace("+00:00", "Z"),
    )



async def fetch_dataset(
    dataset: str,
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Fetch records published during the requested date window.

    Note: stream endpoints filter by publication time. Delivery-time
    filtering is applied separately after the response is received.
    """
    if end_date < start_date:
        raise ValueError("end_date must not precede start_date")

    start, end = utc_range(start_date, end_date)

    # Elexon stream datasets use publication-time filters.
    params = {
        "publishDateTimeFrom": start,
        "publishDateTimeTo": end,
    }
    url = f"{BASE_URL}/datasets/{dataset}/stream"

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(
            url,
            params=params,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()

    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
        records = payload["data"]
    else:
        raise ValueError(f"Unexpected response format from {dataset}")

    # Only retain delivery intervals in the requested calendar range.
    delivery_start = pd.Timestamp(start)
    delivery_end = pd.Timestamp(end)

    filtered = []
    for record in records:
        value = record.get("startTime")
        if not value:
            continue

        delivery_time = pd.to_datetime(value, utc=True)
        if delivery_start <= delivery_time < delivery_end:
            filtered.append(record)

    return filtered


async def fetch_actual_wind(
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Fetch national actual wind generation only."""
    records = await fetch_dataset("FUELHH", start_date, end_date)

    return [
        record
        for record in records
        if str(record.get("fuelType", "")).upper() == "WIND"
    ]


async def fetch_wind_forecasts(
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Fetch wind forecasts, retaining their publication timestamps."""
    return await fetch_dataset("WINDFOR", start_date, end_date)
