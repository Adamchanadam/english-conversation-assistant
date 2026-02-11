# ECA - English Conversation Assistant
# Cloud Run Deployment

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements first (for better caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the application
CMD ["sh", "-c", "uvicorn src.backend.main:app --host 0.0.0.0 --port $PORT"]
