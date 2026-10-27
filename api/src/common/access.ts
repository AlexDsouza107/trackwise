import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from './types';

/** Regional officers only work with institutions of their own region; every other role is unrestricted here. */
export function assertRegionAccess(user: AuthUser, institutionRegion: string | null): void {
  if (user.role === 'regional' && user.region && institutionRegion !== user.region) {
    throw new ForbiddenException(`Outside your region (${user.region})`);
  }
}

/** The region filter to apply to list queries: regional officers are pinned to theirs, others may choose. */
export function effectiveRegion(user: AuthUser, requested?: string | null): string | null {
  if (user.role === 'regional' && user.region) return user.region;
  return requested || null;
}
