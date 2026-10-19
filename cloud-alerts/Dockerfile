FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 worker && mkdir -p /data/nifty-alerts && chown worker:worker /data/nifty-alerts
COPY cloud_alerts ./cloud_alerts
USER worker
ENV HOST=0.0.0.0 PORT=8080 STATE_DIR=/data/nifty-alerts ALERTS_ENABLED=false
EXPOSE 8080
CMD ["uvicorn", "cloud_alerts.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
