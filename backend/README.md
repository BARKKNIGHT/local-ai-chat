# local-ai-chat — Backend (Flask)

This directory contains a small Flask API used for authentication, tracking course completion, awarding points, and collecting course ratings.

Quick start (recommended to use a Python venv):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Initialize the sqlite db (creates app.db in backend/)
python db_init.py
# Run the dev server
FLASK_APP=app.py FLASK_ENV=1 python app.py
```

Defaults:
- SQLite DB: `backend/app.db`
- JWT secret: `JWT_SECRET` environment variable (defaults to `dev-secret-change-me` — change for production)

API endpoints (JSON):
- POST /api/register {username, email, password} -> { token, user }
- POST /api/login {email, password} -> { token, user }
- GET /api/me (Authorization: Bearer <token>) -> { user, completions, ratings }
- POST /api/complete_course { course_id } (auth required) -> awards points
- POST /api/rate_course { course_id, rating } (auth required) -> returns avg/count
- GET /api/courses -> returns courses merged with avg_rating, count, and completed for authed user
