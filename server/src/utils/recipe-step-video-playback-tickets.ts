import { createHash, randomBytes } from 'node:crypto';

export const RECIPE_STEP_VIDEO_PLAYBACK_TTL_MS = 3 * 60 * 1000;
export const MAX_ACTIVE_RECIPE_STEP_VIDEO_PLAYBACKS = 512;
export const MAX_RECIPE_STEP_VIDEO_PLAYBACKS_PER_USER = 12;
export const MAX_RECIPE_STEP_VIDEO_PLAYBACK_RANGES = 256;
export const MAX_RECIPE_STEP_VIDEO_PLAYBACK_BYTES = 96 * 1024 * 1024;

export interface RecipeStepVideoPlaybackScope {
  userId: string;
  recipeId: string;
  videoId: string;
}

export interface RecipeStepVideoPlaybackGrant extends RecipeStepVideoPlaybackScope {
  expiresAt: number;
}

interface PlaybackTicket extends RecipeStepVideoPlaybackGrant {
  remainingRanges: number;
  remainingBytes: number;
}

export interface RecipeStepVideoPlaybackTicketOptions {
  ttlMs?: number;
  maxActive?: number;
  maxPerUser?: number;
  maxRangeRequests?: number;
  maxBytesPerTicket?: number;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validScope(scope: RecipeStepVideoPlaybackScope): boolean {
  return Boolean(
    scope.userId &&
    scope.userId.length <= 200 &&
    scope.recipeId &&
    scope.recipeId.length <= 200 &&
    /^[a-f0-9]{24}$/.test(scope.videoId)
  );
}

/**
 * Process-local capability store: entries contain only opaque-token hashes and a
 * user/recipe/video binding. Restart invalidates all tickets. Expiry, per-user,
 * global, range-count and byte ceilings keep memory and proxy work bounded.
 */
export class RecipeStepVideoPlaybackTickets {
  private readonly tickets = new Map<string, PlaybackTicket>();
  private readonly ttlMs: number;
  private readonly maxActive: number;
  private readonly maxPerUser: number;
  private readonly maxRangeRequests: number;
  private readonly maxBytesPerTicket: number;

  constructor(options: RecipeStepVideoPlaybackTicketOptions = {}) {
    this.ttlMs = options.ttlMs ?? RECIPE_STEP_VIDEO_PLAYBACK_TTL_MS;
    this.maxActive = options.maxActive ?? MAX_ACTIVE_RECIPE_STEP_VIDEO_PLAYBACKS;
    this.maxPerUser = options.maxPerUser ?? MAX_RECIPE_STEP_VIDEO_PLAYBACKS_PER_USER;
    this.maxRangeRequests = options.maxRangeRequests ?? MAX_RECIPE_STEP_VIDEO_PLAYBACK_RANGES;
    this.maxBytesPerTicket = options.maxBytesPerTicket ?? MAX_RECIPE_STEP_VIDEO_PLAYBACK_BYTES;
  }

  get size(): number {
    return this.tickets.size;
  }

  issue(scope: RecipeStepVideoPlaybackScope, now = Date.now()): string | null {
    this.removeExpired(now);
    if (
      !validScope(scope) ||
      this.ttlMs <= 0 ||
      this.maxActive <= 0 ||
      this.maxPerUser <= 0 ||
      this.maxRangeRequests <= 0 ||
      this.maxBytesPerTicket <= 0
    ) {
      return null;
    }

    // Reissuing a path capability revokes its predecessor immediately.
    for (const [hash, ticket] of this.tickets) {
      if (
        ticket.userId === scope.userId &&
        ticket.recipeId === scope.recipeId &&
        ticket.videoId === scope.videoId
      ) {
        this.tickets.delete(hash);
      }
    }

    const activeForUser = [...this.tickets.values()].filter(
      (ticket) => ticket.userId === scope.userId
    ).length;
    if (this.tickets.size >= this.maxActive || activeForUser >= this.maxPerUser) return null;

    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    this.tickets.set(hash, {
      ...scope,
      expiresAt: now + this.ttlMs,
      remainingRanges: this.maxRangeRequests,
      remainingBytes: this.maxBytesPerTicket
    });
    return token;
  }

  peek(
    token: string | null,
    scope: RecipeStepVideoPlaybackScope,
    now = Date.now()
  ): RecipeStepVideoPlaybackGrant | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !validScope(scope)) return null;
    this.removeExpired(now);
    const ticket = this.tickets.get(tokenHash(token));
    if (
      !ticket ||
      ticket.expiresAt <= now ||
      ticket.userId !== scope.userId ||
      ticket.recipeId !== scope.recipeId ||
      ticket.videoId !== scope.videoId
    ) {
      return null;
    }
    return {
      userId: ticket.userId,
      recipeId: ticket.recipeId,
      videoId: ticket.videoId,
      expiresAt: ticket.expiresAt
    };
  }

  lookup(
    token: string | null,
    recipeId: string,
    videoId: string,
    now = Date.now()
  ): RecipeStepVideoPlaybackGrant | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    this.removeExpired(now);
    const ticket = this.tickets.get(tokenHash(token));
    if (
      !ticket ||
      ticket.expiresAt <= now ||
      ticket.recipeId !== recipeId ||
      ticket.videoId !== videoId
    ) {
      return null;
    }
    return {
      userId: ticket.userId,
      recipeId: ticket.recipeId,
      videoId: ticket.videoId,
      expiresAt: ticket.expiresAt
    };
  }

  consume(
    token: string | null,
    scope: RecipeStepVideoPlaybackScope,
    byteCount: number,
    now = Date.now()
  ): RecipeStepVideoPlaybackGrant | null {
    const grant = this.peek(token, scope, now);
    if (!grant || !token || !Number.isSafeInteger(byteCount) || byteCount <= 0) return null;

    const hash = tokenHash(token);
    const ticket = this.tickets.get(hash);
    if (!ticket) return null;
    if (ticket.remainingRanges <= 0 || byteCount > ticket.remainingBytes) {
      this.tickets.delete(hash);
      return null;
    }

    ticket.remainingRanges -= 1;
    ticket.remainingBytes -= byteCount;
    return grant;
  }

  revoke(token: string | null): void {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    this.tickets.delete(tokenHash(token));
  }

  private removeExpired(now: number): void {
    for (const [hash, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(hash);
    }
  }
}

export const recipeStepVideoPlaybackTickets = new RecipeStepVideoPlaybackTickets();
