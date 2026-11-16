// Custom entry: the headless task must be registered before (and without) any screen, because after a boot the
// foreground service runs the node with no UI at all.
import './src/runtime/headless';
import 'expo-router/entry';
