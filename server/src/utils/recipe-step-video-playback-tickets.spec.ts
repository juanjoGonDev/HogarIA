import { describe, expect, it } from 'vitest';
import {
  RecipeStepVideoPlaybackTickets,
  type RecipeStepVideoPlaybackScope
} from './recipe-step-video-playback-tickets.js';

const scope: RecipeStepVideoPlaybackScope = {
  userId: 'user-one',
  recipeId: 'recipe-one',
  videoId: 'a'.repeat(24)
};

describe('recipe step video playback capabilities', () => {
  it('binds an opaque capability to exactly one user, recipe, and video', () => {
    const tickets = new RecipeStepVideoPlaybackTickets();
    const token = tickets.issue(scope, 1_000);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tickets.peek(token!, scope, 1_001)).toMatchObject(scope);
    expect(tickets.peek(token!, { ...scope, recipeId: 'recipe-two' }, 1_001)).toBeNull();
    expect(tickets.peek(token!, { ...scope, videoId: 'b'.repeat(24) }, 1_001)).toBeNull();
    expect(tickets.peek(token!, { ...scope, userId: 'user-two' }, 1_001)).toBeNull();
  });

  it('expires exactly at the deadline and revokes the expired entry', () => {
    const tickets = new RecipeStepVideoPlaybackTickets({ ttlMs: 2_000 });
    const token = tickets.issue(scope, 1_000)!;
    expect(tickets.peek(token, scope, 2_999)).not.toBeNull();
    expect(tickets.peek(token, scope, 3_000)).toBeNull();
    expect(tickets.size).toBe(0);
  });

  it('revokes the prior capability when a new one is issued for the same scope', () => {
    const tickets = new RecipeStepVideoPlaybackTickets();
    const first = tickets.issue(scope, 1_000)!;
    const second = tickets.issue(scope, 1_001)!;
    expect(first).not.toBe(second);
    expect(tickets.peek(first, scope, 1_002)).toBeNull();
    expect(tickets.peek(second, scope, 1_002)).not.toBeNull();
    expect(tickets.size).toBe(1);
  });

  it('revokes a capability after its range-count or byte budget is exceeded', () => {
    const tickets = new RecipeStepVideoPlaybackTickets({
      maxRangeRequests: 2,
      maxBytesPerTicket: 8
    });
    const token = tickets.issue(scope, 1_000)!;
    expect(tickets.consume(token, scope, 4, 1_001)).not.toBeNull();
    expect(tickets.consume(token, scope, 4, 1_002)).not.toBeNull();
    expect(tickets.consume(token, scope, 1, 1_003)).toBeNull();
    expect(tickets.peek(token, scope, 1_004)).toBeNull();

    const byteLimited = tickets.issue({ ...scope, videoId: 'b'.repeat(24) }, 2_000)!;
    expect(
      tickets.consume(byteLimited, { ...scope, videoId: 'b'.repeat(24) }, 9, 2_001)
    ).toBeNull();
    expect(tickets.peek(byteLimited, { ...scope, videoId: 'b'.repeat(24) }, 2_002)).toBeNull();
  });

  it('keeps active capability storage bounded without evicting another user', () => {
    const tickets = new RecipeStepVideoPlaybackTickets({ maxActive: 2, maxPerUser: 1 });
    const first = tickets.issue(scope, 1_000)!;
    expect(tickets.issue({ ...scope, recipeId: 'recipe-two' }, 1_001)).toBeNull();
    const secondScope = { ...scope, userId: 'user-two', recipeId: 'recipe-two' };
    const second = tickets.issue(secondScope, 1_002)!;
    expect(tickets.size).toBe(2);
    expect(tickets.issue({ ...secondScope, recipeId: 'recipe-three' }, 1_003)).toBeNull();
    expect(tickets.peek(first, scope, 1_004)).not.toBeNull();
    expect(tickets.peek(second, secondScope, 1_004)).not.toBeNull();
  });
});
