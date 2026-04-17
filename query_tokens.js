const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:secret@localhost:5432/db_laundry' });
pool.query('SELECT user_id, token, platform FROM device_tokens;').then(res => console.log('TOKENS:', res.rows)).then(() => pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5;')).then(res => console.log('NOTIFICATIONS:', res.rows)).finally(() => pool.end());
