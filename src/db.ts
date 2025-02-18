// db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Create a new pool using the DATABASE_URL from your .env file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
