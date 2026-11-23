-- Pick date (README, "Telegram bot"): the bot's Pick date button under a carried-over errand asks
-- for a date, and the chat's next message is read as it. This is the errand that date is for, until
-- the date comes, another command is sent, or the chat picks a date for another errand. Not a
-- foreign key, like last_added_task_id: the errand can be deleted meanwhile, and the bot then says so.
ALTER TABLE telegram_links ADD COLUMN picking_task_id TEXT;
