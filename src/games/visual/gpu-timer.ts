// Non-blocking EXT_disjoint_timer_query_webgl2; unavailable is reported as null.
export class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get available() {
    return !!this.ext;
  }
  begin() {
    if (!this.ext || this.pending.length >= 4) return;
    this.active = this.gl.createQuery();
    if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }
  end() {
    if (this.active && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
  }
  poll() {
    if (!this.ext) return null;
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      this.clear();
      return null;
    }
    const q = this.pending[0];
    if (!q || !this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) return null;
    const ms = Number(this.gl.getQueryParameter(q, this.gl.QUERY_RESULT)) / 1e6;
    this.pending.shift();
    this.gl.deleteQuery(q);
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  private clear() {
    this.pending.forEach((q) => this.gl.deleteQuery(q));
    this.pending.length = 0;
  }
  reset() {
    this.clear();
  }
  dispose() {
    this.clear();
    if (this.active && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active);
      this.active = null;
    }
  }
}
