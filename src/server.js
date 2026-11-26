import "./env.js";

import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`MealMate running at http://${config.host}:${config.port}`);
  console.log(`Set MEALMATE_CONTACT_EMAIL to your own email before sharing publicly.`);
});

function shutdown(signal) {
  console.log(`\n${signal} received — closing MealMate.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
