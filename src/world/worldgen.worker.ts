/// <reference lib="webworker" />
import { buildWorldData, transferList } from './worlddata';

try {
  const data = buildWorldData();
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(data, transferList(data));
} catch (err) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: String(err) });
}
