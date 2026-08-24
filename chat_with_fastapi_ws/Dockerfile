FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 8001 by convention: the HTTP API owns 8000, this service owns 8001, so both
# can run on one host without a port map translating between them.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
