import { nodeSuite } from '../lib/nodeSuite';
import { android } from '../lib/drivers/android';

// The android node in its own chat and embeddings pools (see nodeSuite).
nodeSuite('android', android);
