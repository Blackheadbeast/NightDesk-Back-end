import dotenv from "dotenv";

// Load .env ONLY if it exists (safe for Railway)
dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is not set");
}

if (!process.env.BASE_URL) {
  console.warn("⚠️ BASE_URL is not set");
}
