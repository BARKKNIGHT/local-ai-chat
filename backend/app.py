import os
import sqlite3
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import jwt
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

DB = os.environ.get('SQLITE_DB', 'app.db')
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me')
JWT_ALGO = 'HS256'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB)
        db.row_factory = sqlite3.Row
    return db

def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=()):
    cur = get_db().execute(query, args)
    get_db().commit()
    lastrowid = cur.lastrowid
    cur.close()
    return lastrowid

app = Flask(__name__)
CORS(app)

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def make_token(user_id, expires_minutes=60*24*7):
    exp = datetime.utcnow() + timedelta(minutes=expires_minutes)
    # JWT spec expects subject/sub to be a string. Store as string to keep PyJWT happy.
    payload = { 'sub': str(user_id), 'exp': exp }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def verify_token(token):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        sub = payload.get('sub')
        # convert to integer id when possible
        try:
            return int(sub)
        except Exception:
            return None
    except Exception:
        return None

def auth_required(fn):
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth.split(' ', 1)[1]
            user_id = verify_token(token)
            if user_id:
                # load user
                user = query_db('SELECT id, username, email, points FROM users WHERE id = ?', (user_id,), one=True)
                if user:
                    g.current_user = user
                    return fn(*args, **kwargs)
        return jsonify({'error': 'Unauthorized'}), 401
    return wrapper

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not username or not email or not password or len(password) < 6:
        return jsonify({'error': 'Invalid input, provide username, email and password (min 6 chars)'}), 400

    # check exists
    existing = query_db('SELECT id FROM users WHERE email = ? OR username = ?', (email, username), one=True)
    if existing:
        return jsonify({'error': 'User with that email or username already exists'}), 400

    password_hash = generate_password_hash(password)
    user_id = execute_db('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', (username, email, password_hash))

    token = make_token(user_id)
    user = query_db('SELECT id, username, email, points FROM users WHERE id = ?', (user_id,), one=True)
    return jsonify({'token': token, 'user': dict(user)})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'error': 'Missing email/password'}), 400

    user = query_db('SELECT id, username, email, password_hash, points FROM users WHERE email = ?', (email,), one=True)
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401

    if not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid credentials'}), 401

    token = make_token(user['id'])
    return jsonify({'token': token, 'user': dict({k: user[k] for k in user.keys() if k != 'password_hash'})})

@app.route('/api/me', methods=['GET'])
@auth_required
def me():
    user = g.current_user
    # fetch completed courses and ratings
    completions = query_db('SELECT course_id, completed_at FROM completions WHERE user_id = ?', (user['id'],))
    ratings = query_db('SELECT course_id, rating FROM ratings WHERE user_id = ?', (user['id'],))
    return jsonify({'user': dict(user), 'completions': [dict(r) for r in completions], 'ratings': [dict(r) for r in ratings]})

@app.route('/api/complete_course', methods=['POST'])
@auth_required
def complete_course():
    data = request.json or {}
    course_id = data.get('course_id')
    if not course_id:
        return jsonify({'error': 'Missing course_id'}), 400

    user = g.current_user
    # check existing completion
    existing = query_db('SELECT id FROM completions WHERE user_id = ? AND course_id = ?', (user['id'], course_id), one=True)
    if existing:
        return jsonify({'message': 'Already completed', 'user': dict(user)}), 200

    execute_db('INSERT INTO completions (user_id, course_id) VALUES (?, ?)', (user['id'], course_id))
    # award points per course, configurable: 100 points per course
    points_awarded = 100
    execute_db('UPDATE users SET points = points + ? WHERE id = ?', (points_awarded, user['id']))
    # return updated user
    updated = query_db('SELECT id, username, email, points FROM users WHERE id = ?', (user['id'],), one=True)
    return jsonify({'message': 'Course completed', 'points_awarded': points_awarded, 'user': dict(updated)})

@app.route('/api/rate_course', methods=['POST'])
@auth_required
def rate_course():
    data = request.json or {}
    course_id = data.get('course_id')
    rating = int(data.get('rating') or 0)
    if not course_id or rating < 1 or rating > 5:
        return jsonify({'error': 'Invalid course_id or rating (1-5 required)'}), 400

    user = g.current_user
    # upsert rating
    existing = query_db('SELECT id FROM ratings WHERE user_id = ? AND course_id = ?', (user['id'], course_id), one=True)
    if existing:
        execute_db('UPDATE ratings SET rating = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?', (rating, existing['id']))
    else:
        execute_db('INSERT INTO ratings (user_id, course_id, rating) VALUES (?, ?, ?)', (user['id'], course_id, rating))

    # compute new average & count
    avg = query_db('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM ratings WHERE course_id = ?', (course_id,), one=True)
    return jsonify({'message': 'Rating saved', 'average': avg['avg_rating'], 'count': avg['count']})

@app.route('/api/courses', methods=['GET'])
def courses():
    # return courses.json merged with average rating, and optionally user completion if authorized
    import json
    path = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'courses.json')
    try:
        with open(path, 'r') as f:
            courses = json.load(f)
    except Exception:
        courses = []

    # compute avg ratings for all courses
    out = []
    for c in courses:
        r = query_db('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM ratings WHERE course_id = ?', (c['id'],), one=True)
        c_copy = c.copy()
        c_copy['avg_rating'] = float(r['avg_rating']) if r and r['avg_rating'] is not None else None
        c_copy['rating_count'] = int(r['count']) if r else 0
        out.append(c_copy)

    # if authorization header exists and valid, add completion flags
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth.split(' ', 1)[1]
        uid = verify_token(token)
        if uid:
            user_comps = query_db('SELECT course_id FROM completions WHERE user_id = ?', (uid,))
            completed_set = {r['course_id'] for r in user_comps}
            for c in out:
                c['completed'] = c['id'] in completed_set

    return jsonify(out)

if __name__ == '__main__':
    # ensure db exists
    if not os.path.exists(DB):
        print('DB missing, initializing...')
        from db_init import init_db
        init_db()

    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
