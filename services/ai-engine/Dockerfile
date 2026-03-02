FROM python:3.12-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY services/ai-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS runner
ENV PYTHONUNBUFFERED=1
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY services/ai-engine/src ./src
EXPOSE 5001
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5001"]
