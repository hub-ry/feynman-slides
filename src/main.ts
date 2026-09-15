import { serve } from "./server.ts";
import { HOME } from "./store.ts";

const port = await serve(Number(process.env.PORT) || 4317);
console.log(`\n  feynman-slides   http://127.0.0.1:${port}`);
console.log(`  decks            ${HOME}/decks\n`);
