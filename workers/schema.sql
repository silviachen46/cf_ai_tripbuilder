CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  wake_start TEXT,
  wake_end TEXT,
  pace TEXT,
  budget TEXT,
  like_tags TEXT,
  avoid_tags TEXT
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  days INTEGER,
  nights INTEGER,
  companions TEXT,
  budget TEXT,
  style_tags TEXT,
  city TEXT,
  country TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS trip_days (
  id TEXT PRIMARY KEY,
  trip_id TEXT,
  day_index INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  trip_day_id TEXT,
  time TEXT,
  title TEXT,
  place_name TEXT,
  tags TEXT,
  est_duration INTEGER,
  llm_source TEXT
);

CREATE TABLE IF NOT EXISTS trip_diary (
  id TEXT PRIMARY KEY,
  trip_id TEXT,
  day_index INTEGER,      
  user_sentences TEXT,
  llm_journal TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  role TEXT, 
  content TEXT,
  created_at TEXT
);
