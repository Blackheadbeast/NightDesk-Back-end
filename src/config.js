import dotenv from "dotenv";

// Force-load the .env from project root (works in ESM)
dotenv.config({ path: new URL("../.env", import.meta.url) });
