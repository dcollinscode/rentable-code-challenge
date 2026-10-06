#!/bin/bash

# Install backend dependencies
pip3 install --user -r backend/requirements.txt

# Ensure a clean database and apply migrations
cd backend && rm -f db.sqlite3 && python manage.py migrate && cd ..

# Seed data
cd backend && python manage.py seed_data && cd ..

# Install frontend dependencies
cd frontend && npm install && cd .. 