#!/bin/bash

# Trap signals to ensure background processes are killed on exit
cleanup() {
    echo "Shutting down background processes..."
    # Kill all background jobs started by this script
    kill $(jobs -p) || true
    echo "Background processes terminated."
}

trap cleanup EXIT

# Start Django backend
cd backend
python manage.py runserver 0.0.0.0:8009 &
cd ..

# Start React frontend
cd frontend
PORT=3009 npm start &

echo "Backend and Frontend services started."

# Wait for all processes to finish
wait 