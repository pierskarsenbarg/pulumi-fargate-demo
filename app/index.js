import express from "express";

const app = express();

app.get("/", (req, res) => {
  console.log("Request started");
  res.send(JSON.stringify({message: "Hello, World!!!"}))
});

app.get("/health", (req, res) => {
  res.send("Ok");
});

app.listen(3000, () => {
  console.log("Node server started");
});
