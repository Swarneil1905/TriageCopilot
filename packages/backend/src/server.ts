import "dotenv/config";
import { buildServer } from "./app.js";

async function main() {
  const fastify = await buildServer();
  const port = Number(process.env.PORT ?? 4000);
  await fastify.listen({ port, host: "0.0.0.0" });
  console.log(`TriageCopilot backend listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
