/** Identifies the newest request in a stream without coupling it to a URL key. */
export class LatestRequest {
  private currentId = 0;

  begin(): number {
    this.currentId += 1;
    return this.currentId;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.currentId;
  }
}
