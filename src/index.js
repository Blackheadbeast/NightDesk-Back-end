import express from "express";

const app = express();

app.get("/", (_req, res) => {
  res.send("OK");
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log("Listening on", port);
});
