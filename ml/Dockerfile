FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000
WORKDIR /app
RUN groupadd --gid 10001 boresakshi \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin boresakshi
COPY requirements.txt ./
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt
COPY --chown=boresakshi:boresakshi . .
USER boresakshi
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["python", "-c", "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/ml/health',timeout=4); sys.exit(0 if r.status==200 else 1)"]
CMD ["sh", "-c", "python production_preflight.py && exec python -m uvicorn service:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${ML_WORKERS:-1}"]
