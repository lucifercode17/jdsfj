# WindSight --- Wind Generation Forecast Analytics

WindSight is a web dashboard for exploring UK national wind generation
and evaluating day-ahead wind generation forecasts against actual
generation for January 2026. It is designed to help an energy
procurement team understand forecast error when making day-ahead
electricity purchasing decisions.

## Features

-   Loads actual wind generation and wind forecasts from the Elexon BMRS
    API through a Python backend.
-   Compares actual generation with the selected day-ahead forecast.
-   Reports forecast accuracy metrics:
    -   **MAE** --- mean absolute error in MW.
    -   **RMSE** --- root mean squared error in MW.
    -   **Bias** --- mean signed error in MW; positive values indicate
        over-forecasting when error is calculated as forecast minus
        actual.
    -   **MAPE** --- mean absolute percentage error, calculated for
        records where actual generation is non-negligible.
-   Visualizes actual versus forecast generation and daily error
    patterns.
-   Supports filtering records by date and exporting the displayed
    records as CSV.
-   Includes bundled sample data as a fallback when the API is
    unavailable.

## Technology stack

-   **Frontend:** React, Vite, Recharts, Lucide React
-   **Backend:** Python, FastAPI, HTTPX, Pandas
-   **Data source:** Elexon BMRS datasets `FUELHH` (actual generation;
    filtered to `fuelType = WIND`) and `WINDFOR` (wind forecasts)
-   **Containerization:** Docker and Docker Compose

## Project structure

The following describes the intended repository layout. Adjust names if
your local folders differ.

``` text
WindSight/
├── frontend/
│   ├── public/
│   │   └── data/
│   │       └── accuracy.json      # Bundled sample/fallback data
│   ├── src/
│   │   └── App.jsx                # Dashboard UI, charts, filters and CSV export
│   ├── package.json               # Frontend dependencies and scripts
│   ├── Dockerfile                 # Frontend container
│   └── .dockerignore
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI application and API routes
│   │   ├── exelon.py              # Elexon data retrieval
│   │   └── analytics.py           # Data preparation, forecast matching and metrics
│   ├── test/                      # Backend tests, if present
│   ├── requirements.txt           # Python dependencies
│   ├── Dockerfile                 # Backend container
│   └── .dockerignore
├── docker-compose.yml              # Runs frontend and backend together
└── README.md
```

## Data and methodology

### Data sources

-   **Actual generation:** Elexon BMRS `FUELHH` stream. Wind records are
    selected using `fuelType = WIND`; `startTime` represents the
    delivery interval and `generation` is the actual generation in MW.
-   **Forecast generation:** Elexon BMRS `WINDFOR` stream. `startTime`
    identifies the target delivery time, `publishTime` identifies when
    the forecast was published, and `generation` is the forecast
    generation in MW.

Documentation: - [Elexon FUELHH
dataset](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) -
[Elexon WINDFOR
dataset](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream)

### Forecast selection

For each delivery day, the backend selects the latest forecast published
before that delivery day starts, then matches it to actual generation.
The evaluation period is **1--31 January 2026**. The source actuals are
at 30-minute resolution; the current dashboard accuracy result
aggregates/matches the records to hourly intervals.

### Metrics

Let `error = forecast_mw - actual_mw`.

-   `MAE = mean(abs(error))`
-   `RMSE = sqrt(mean(error²))`
-   `Bias = mean(error)`
-   `MAPE = mean(abs(error / actual) × 100)` for records where actual
    generation is sufficiently far from zero.

Positive bias means the forecast is higher than actual generation on
average; negative bias means it is lower.

## Requirements

To run the containerized app, install: - Docker - Docker Compose (Docker
Compose v2 or newer)

For local non-Docker development, also install Python 3.12+ and Node.js
22+.

## Run with Docker Compose

Run these commands from the repository root (the directory containing
`docker-compose.yml`):

``` bash
docker compose config
docker compose up --build -d
docker compose ps
```

Open: - **Frontend dashboard:** http://localhost:5173 - **Backend health
check:** http://localhost:8000/api/health - **Interactive API
documentation:** http://localhost:8000/docs - **Accuracy endpoint:**
http://localhost:8000/api/wind/accuracy

Check logs if a service does not start:

``` bash
docker compose logs --tail=100 frontend
docker compose logs --tail=100 backend
```

Stop the application:

``` bash
docker compose down
```

If port `8000` or `5173` is already occupied, stop the process/container
using that port or change the host-side port mapping in
`docker-compose.yml`.

### Frontend API configuration

The Vite frontend reads `VITE_API_BASE_URL`. For the local Docker
Compose setup described here, set it to:

``` text
http://localhost:8000
```

The browser calls the backend through the host-mapped port. If you
change the host port or deploy the backend elsewhere, update
`VITE_API_BASE_URL` accordingly and rebuild/restart the frontend. The
backend CORS allow-list must include the frontend origin.

### Backend endpoints

  -----------------------------------------------------------------------
  Method                  Endpoint                Purpose
  ----------------------- ----------------------- -----------------------
  GET                     `/`                     API root / service
                                                  information

  GET                     `/api/health`           Health check

  GET                     `/api/wind/actual`      Actual wind generation
                                                  for a date range

  GET                     `/api/wind/forecasts`   Wind forecasts for a
                                                  date range

  GET                     `/api/wind/accuracy`    Matched actuals and
                                                  forecasts with accuracy
                                                  metrics

  GET                     `/api/debug/wind`       Diagnostic counts and
                                                  data-shape information,
                                                  if enabled
  -----------------------------------------------------------------------

The wind endpoints accept `start` and `end` date query parameters where
supported. For example:

``` bash
curl "http://localhost:8000/api/wind/accuracy?start=2026-01-01&end=2026-01-31"
```

## Local development without Docker

### Backend

From the backend directory:

``` bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

From the frontend directory:

``` bash
npm install
```

Create a frontend `.env` file containing:

``` dotenv
VITE_API_BASE_URL=http://localhost:8000
```

Then start Vite:

``` bash
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173.

## Deployment

**Live application:** `ADD_YOUR_DEPLOYED_APP_URL_HERE`

Replace the placeholder above with the public Vercel/Heroku frontend URL
before submitting. Deploy the FastAPI backend to a publicly reachable
service as well, then set `VITE_API_BASE_URL` to its HTTPS URL and
configure backend CORS to allow the deployed frontend origin. Verify the
deployed frontend and API in a private/incognito browser window.

## Development practices

-   Keep secrets and local environment files out of version control; do
    not commit API keys or `.env` files.
-   Use Docker Compose to run both services consistently.
-   Verify `/api/health` and `/api/wind/accuracy` after starting the
    services.
-   Confirm the dashboard is connected to the API rather than showing
    the bundled sample data.
-   For reproducibility, document any changes to the forecast-selection
    rule or aggregation method.

## AI tool disclosure

AI tools were used to assist with implementation guidance, debugging,
and documentation. The project logic and output should be reviewed and
validated by the developer before submission.

