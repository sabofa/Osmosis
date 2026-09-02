ALTER TABLE attempt ADD COLUMN delivery_mode TEXT CHECK (delivery_mode IN ('app_live', 'chat_quick_check') OR delivery_mode IS NULL);
