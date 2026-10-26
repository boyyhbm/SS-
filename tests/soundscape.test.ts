import { expect,it } from 'vitest';
import { fillSoundscape } from '../src/games/audio/soundscape';
it('produces bounded distinct original ambience with quiet loop seams',()=>{
  const buffers=(['city','industrial','mountain','circuit','coast'] as const).map(environment=>{
    const data=new Float32Array(22050*18);fillSoundscape(data,22050,environment);
    let peak=0,energy=0,finite=true;for(const sample of data){finite&&=Number.isFinite(sample);peak=Math.max(peak,Math.abs(sample));energy+=sample*sample}expect(finite).toBe(true);
    expect(peak).toBeLessThan(.7);expect(energy/data.length).toBeGreaterThan(.00001);
    expect(Math.abs(data[0]-data.at(-1)!)).toBeLessThan(.0001);
    return energy;
  });
  expect(new Set(buffers).size).toBe(5);
});
