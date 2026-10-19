FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 worker && mkdir -p /data/nifty-alerts && chown worker:worker /data/nifty-alerts && chmod 0700 /data/nifty-alerts
COPY cloud_alerts ./cloud_alerts
USER worker
ENV HOST=0.0.0.0 PORT=8080 STATE_DIR=/data/nifty-alerts ALERTS_ENABLED=false
# Health uses liveness (/healthz), NOT daily-token readiness (/readyz).
# An expired overnight token must not cause the container to restart-loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read()" || exit 1
EXPOSE 8080
# Fail before startup if the mounted volume/secrets are unsafe; no external requests.
CMD ["sh", "-c", "python -m cloud_alerts.preflight --json && exec uvicorn cloud_alerts.main:app --host 0.0.0.0 --port 8080 --workers 1 --no-access-log"]
