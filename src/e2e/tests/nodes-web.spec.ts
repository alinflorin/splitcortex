import { nodeSuite } from '../lib/nodeSuite';
import { webNode } from '../lib/drivers/web';

// The web node in its own chat and embeddings pools (see nodeSuite).
nodeSuite('web', webNode);
