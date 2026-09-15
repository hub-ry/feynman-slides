import { serve, PortTaken } from "./server.ts";
import { HOME } from "./store.ts";

const port = Number(process.env.PORT) || 4317;

try {
  const on = await serve(port);
  console.log(`\n  feynman-slides   http://127.0.0.1:${on}`);
  console.log(`  decks            ${HOME}/decks\n`);
} catch (err) {
  if (!(err instanceof PortTaken)) throw err;
  // Almost always a copy you forgot about rather than a conflict, so point at
  // it instead of failing. PORT= is the escape hatch if it really is something
  // else on that port.
  console.error(`\n  Port ${err.port} is already in use.`);
  console.error(`  feynman-slides may already be running: http://127.0.0.1:${err.port}`);
  console.error(`  Otherwise: PORT=4318 feynman-slides\n`);
  process.exit(1);
}
