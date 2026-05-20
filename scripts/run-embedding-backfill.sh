#!/bin/bash

# Embedding backfill script for clinic_leads
# Run with: ./scripts/run-embedding-backfill.sh

PROJECT_URL="https://xhyttombqrhqvnycyzlj.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoeXR0b21icXJocXZueWN5emxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwMTgyOTcsImV4cCI6MjA2NzU5NDI5N30.rLEh8IT6oPMQ7Nwe4quWHtNAJbfzqtVrAD03wsi60SY"

# Function to process a batch
process_batch() {
  curl -s -X POST "$PROJECT_URL/functions/v1/process-embedding-queue" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"batch_size": 50}'
}

# Function to queue more records
queue_records() {
  local offset=$1
  curl -s -X POST "$PROJECT_URL/functions/v1/backfill-embeddings" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"table_name\": \"clinic_leads\", \"batch_size\": 2000, \"offset\": $offset}"
}

echo "Starting embedding backfill..."
echo "Press Ctrl+C to stop"

OFFSET=5500
TOTAL_PROCESSED=0

while true; do
  # Process 6 batches in parallel (300 records)
  for i in {1..6}; do
    process_batch &
  done
  wait

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + 300))
  echo "Processed batch - Total processed this session: ~$TOTAL_PROCESSED"

  # Every 10 rounds, queue more and check status
  if [ $((TOTAL_PROCESSED % 3000)) -eq 0 ]; then
    echo "Queueing more records at offset $OFFSET..."
    queue_records $OFFSET
    OFFSET=$((OFFSET + 2000))
    sleep 1
  fi

  sleep 0.5
done
