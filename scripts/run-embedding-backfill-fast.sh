#!/bin/bash

# Fast embedding backfill script using batched OpenAI calls
# Run with: ./scripts/run-embedding-backfill-fast.sh

PROJECT_URL="https://xhyttombqrhqvnycyzlj.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoeXR0b21icXJocXZueWN5emxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwMTgyOTcsImV4cCI6MjA2NzU5NDI5N30.rLEh8IT6oPMQ7Nwe4quWHtNAJbfzqtVrAD03wsi60SY"

# Process a batch of 200 records (batched OpenAI call)
process_batch() {
  curl -s -X POST "$PROJECT_URL/functions/v1/process-embedding-queue" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"batch_size": 1}'
}

# Queue more records
queue_records() {
  local offset=$1
  curl -s -X POST "$PROJECT_URL/functions/v1/backfill-embeddings" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"table_name\": \"clinic_leads\", \"batch_size\": 2000, \"offset\": $offset}"
}

echo "Starting FAST embedding backfill (batched mode with auto-queue)..."
echo "Press Ctrl+C to stop"

TOTAL_PROCESSED=0
QUEUE_OFFSET=0

while true; do
  # Process 30 single records in parallel
  for i in {1..30}; do
    process_batch &
  done
  wait

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + 30))
  echo "$(date '+%H:%M:%S') - Processed batch - Total this session: ~$TOTAL_PROCESSED"

  # Every 100 rounds (~3000 records), queue more
  if [ $((TOTAL_PROCESSED % 3000)) -eq 0 ] && [ $TOTAL_PROCESSED -gt 0 ]; then
    echo "Queueing more records at offset $QUEUE_OFFSET..."
    for i in {0..4}; do
      queue_records $((QUEUE_OFFSET + i * 2000)) &
    done
    wait
    QUEUE_OFFSET=$((QUEUE_OFFSET + 10000))
    # Reset offset if it gets too high
    if [ $QUEUE_OFFSET -gt 100000 ]; then
      QUEUE_OFFSET=0
    fi
  fi

  sleep 0.3
done
