export const QUEUE_NAMES = {
  save: 'save',
  cleanupCache: 'cleanup-cache',
  cleanupStorage: 'cleanup-storage',
  metadataRefresh: 'metadata-refresh',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
