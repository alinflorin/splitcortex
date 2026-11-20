import { nodeSuite } from '../lib/nodeSuite';
import { android } from '../lib/drivers/android';
import { cliNode } from '../lib/drivers/cli';
import { webNode } from '../lib/drivers/web';

// Every node type, one after the other, in the chat pool and then in the embedding pool.
const drivers = [webNode, cliNode, android];
nodeSuite('chat', drivers);
nodeSuite('embeddings', drivers);
