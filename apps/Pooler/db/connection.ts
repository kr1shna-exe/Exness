import { Client } from "pg";

const client = new Client({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433"),
  database: process.env.DB_NAME || "pooler",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

export async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to TimescaleDB");
    return client;
  } catch (err) {
    console.error("Database connection failed:", err);
    throw err;
  }
}

export { client };
