import "./config.js";
import express from "express";
import cors from "cors";
import retellRoutes from "./retellRoutes.js";

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

console.log("🔥 mounting retell routes");
app.use("/api", retellRoutes);

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log("Listening on", port);
});
