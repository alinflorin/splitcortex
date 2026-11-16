import '../polyfills';
import { AppRegistry } from 'react-native';
import { nodeService } from '../native/nodeService';
import { runtime } from './index';
import { loadSettings } from './settings';

/** Must match `NodeService.TASK` in modules/splitcortex-node-service. */
export const TASK = 'SplitCortexNode';

/**
 * The headless task the Android foreground service runs (at boot, or when the app starts it): starts the node runtime
 * without any UI and stays pending while it runs, so the service lives exactly as long as the node is serving. Registered
 * from the app's entry file (`index.ts`), because at boot no screen is ever rendered.
 */
export async function runHeadless() {
  const settings = await loadSettings();
  if (!settings.connectOnStart) {
    await nodeService.stop();
    return;
  }
  await runtime.start();
  if (runtime.getSnapshot().blocked) {
    // Not enrolled, or not approved yet: nothing to serve, do not keep a notification up.
    await nodeService.stop();
    return;
  }
  await new Promise<void>((resolve) => {
    const unsubscribe = runtime.subscribe(() => {
      if (!runtime.getSnapshot().running) {
        unsubscribe();
        resolve();
      }
    });
  });
}

AppRegistry.registerHeadlessTask(TASK, () => runHeadless);
