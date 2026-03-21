export type { TrackerClient } from './client';
export { LinearClient, TrackerError } from './linear';
export type { TrackerErrorCode } from './linear';

import { TrackerClient } from './client';
import { LinearClient, TrackerError } from './linear';
import { ServiceConfig } from './types';

/**
 * Factory: create a TrackerClient from the service configuration.
 *
 * Currently only the "linear" tracker kind is supported. If the config
 * specifies an unknown kind the factory throws with the
 * `unsupported_tracker_kind` error code.
 */
export function createTrackerClient(config: ServiceConfig): TrackerClient {
  const { tracker } = config;

  switch (tracker.kind) {
    case 'linear':
      return new LinearClient(tracker);
    default:
      throw new TrackerError(
        'unsupported_tracker_kind',
        `Unsupported tracker kind: "${(tracker as { kind: string }).kind}". Only "linear" is supported.`,
      );
  }
}
