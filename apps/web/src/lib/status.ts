import type { TrackStatus } from '@af/shared';

export const STATUS_DOT: Record<TrackStatus, string> = {
  none: 'bg-transparent',
  saved: 'bg-st-saved',
  applied: 'bg-st-applied',
  interview: 'bg-st-interview',
  offer: 'bg-st-offer',
  rejected: 'bg-st-rejected',
};
