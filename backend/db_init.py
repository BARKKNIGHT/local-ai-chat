import sqlite3
from datetime import datetime

DB = 'app.db'

def init_db():
    conn = sqlite3.connect(DB)
    c = conn.cursor()

    # users table
    c.execute('''
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # completions: track which course a user finished
    c.execute('''
    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_id TEXT NOT NULL,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, course_id)
    )
    ''')

    # ratings
    c.execute('''
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, course_id)
    )
    ''')

    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print('Initialized DB:', DB)
