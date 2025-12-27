import "./config.js"; // MUST be first so env is loaded before other imports

import express from "express";
import cors from "cors";
import routes from "./routes.js";

console.log("BASE_URL:", process.env.BASE_URL);
console.log("OPENAI key loaded?", process.env.OPENAI_API_KEY ? "YES" : "NO");

const app = express();
app.use(cors());
app.set("trust proxy", 1);


app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(routes);

app.get("/", (_, res) => res.send("AI Receptionist is running ✅"));

const port = process.env.PORT || 3000;
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).send("Server error");
});
app.listen(port, "0.0.0.0", () => console.log(`Server running on :${port}`));
