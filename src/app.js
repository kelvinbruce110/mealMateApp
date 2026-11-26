import express from "express";
import path from "node:path";

import { ApiError, MealDbClient, OpenFoodFactsClient } from "./clients.js";
import { config as baseConfig } from "./config.js";
import { createApiRouter } from "./routes.js";
import { ValidationError } from "./validation.js";

export function createApp(options = {}) {
  const config = { ...baseConfig, ...(options.config || {}) };
  const mealDb = options.mealDb || new MealDbClient(config, options.fetchImpl);
  const off = options.off || new OpenFoodFactsClient(config, options.fetchImpl);

  const app = express();
  app.disable("x-powered-by");
  app.set("json escape", true);
  app.locals.config = config;
  app.locals.mealDb = mealDb;
  app.locals.off = off;

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
        "img-src 'self' data: https://www.themealdb.com https://images.openfoodfacts.org; " +
        "style-src 'self'; " +
        "script-src 'self'; " +
        "connect-src 'self'; " +
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com"
    );

    const origin = req.headers.origin;
    if (origin && config.corsOrigins?.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    next();
  });

  app.use(express.json({ limit: "10kb" }));

  app.use("/api", createApiRouter({ mealDb, off, config }));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(config.publicDir, "index.html"));
  });
  app.use(express.static(config.publicDir, { index: "index.html" }));

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({
        error: { code: "not_found", message: "Endpoint not found.", retryable: false },
      });
      return;
    }
    res.status(404).type("text").send("Not found");
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;

    if (error instanceof ValidationError) {
      res.status(400).json({
        error: { code: error.code, message: error.message, retryable: false },
      });
      return;
    }

    if (error instanceof ApiError) {
      const allowed = [400, 404, 429, 502, 503, 504];
      res.status(allowed.includes(error.status) ? error.status : 502).json(error.toJSON());
      return;
    }

    if (error?.type === "entity.parse.failed" || error instanceof SyntaxError) {
      res.status(400).json({
        error: { code: "invalid_input", message: "The request could not be understood.", retryable: false },
      });
      return;
    }

    console.error(error);
    res.status(500).json({
      error: {
        code: "internal_error",
        message: "Something went wrong on the server. Please try again.",
        retryable: true,
      },
    });
  });

  return app;
}
