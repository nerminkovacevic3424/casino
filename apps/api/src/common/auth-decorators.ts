import {
  ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums';

/** Identity carried by a verified access token. */
export interface AuthUser {
  readonly id: string;
  readonly role: Role;
}

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
  requestId?: string;
};

export const IS_PUBLIC = 'isPublic';
/** Opts a route out of the global access-token guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user)
      throw new Error('CurrentUser used on a route without authentication');
    return user;
  },
);
