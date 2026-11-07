# The Dev Daily — Linux container image.
# Build:  docker build -t devdaily .
# Run:    docker run -d --name devdaily -p 8787:8787 -v ./editions:/data/editions:ro devdaily
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEVDAILY_EDITIONS=/data/editions \
    DEVDAILY_HOST=0.0.0.0 \
    DEVDAILY_PORT=8787

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY devdaily ./devdaily
COPY run.py .

# Run as an unprivileged user; the content volume is read-only anyway.
RUN useradd --system --create-home --uid 10001 paper
USER paper

VOLUME ["/data/editions"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/healthz', timeout=3)"

CMD ["python", "run.py"]
