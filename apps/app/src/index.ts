import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok", app: "tayori" }));

app.get("/", (c) => c.json({ name: "Tayori API", version: "0.1.0" }));

export default app;
