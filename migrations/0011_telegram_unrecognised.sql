-- Text the Telegram bot didn't recognise (worker/pamBot/, docs/telegram-bot.md, Stage 5): every
-- message from a linked chat that got the hint, kept so the user can see what they tried to ask.
-- Only linked chats are stored, since the bot ignores the rest. Rows are kept until the account is
-- deleted, unlinking included.
CREATE TABLE telegram_unrecognised (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- orders messages sent at the same moment
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL, -- the chat it came from
  text TEXT NOT NULL, -- as sent, at most 4,096 characters (Telegram's limit)
  at TEXT NOT NULL -- UTC timestamp
);

CREATE INDEX telegram_unrecognised_user ON telegram_unrecognised (user_id, at);
