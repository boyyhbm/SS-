// Optional user-selected presentation cap. Input and server/fixed simulation
// never consult this clock. A small boundary tolerance avoids halving 59.94 Hz.
export class ForgeRenderPacer {
  private next = 0;
  private limit = 0;
  ready(now: number, limit: number) {
    if (limit !== this.limit) {
      this.limit = limit;
      this.next = 0;
    }
    if (!limit) return true;
    if (this.next && now + 0.6 < this.next) return false;
    const interval = 1000 / limit;
    this.next = this.next && now - this.next < interval * 2 ? this.next + interval : now + interval;
    return true;
  }
}
