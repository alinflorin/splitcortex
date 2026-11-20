import { nodeSuite } from '../lib/nodeSuite';
import { cliNode } from '../lib/drivers/cli';

// The cli node in its own chat and embeddings pools (see nodeSuite).
nodeSuite('cli', cliNode);
