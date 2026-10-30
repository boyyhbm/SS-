import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { ForgeSettings } from './settings';

export class ForgePostProcessing {
  readonly capabilities: { msaaSamples: number; ssao: boolean; bloom: boolean };
  readonly composer: EffectComposer;
  private ssao: SSAOPass;
  private bloom: UnrealBloomPass;
  private fxaa = new ShaderPass(FXAAShader);
  private output = new OutputPass();
  private renderPass: RenderPass;
  private width = 1;
  private height = 1;
  private ratio = 1;
  constructor(
    private renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.PerspectiveCamera,
  ) {
    const hdr = renderer.extensions.has('EXT_color_buffer_float');
    this.capabilities = {
      msaaSamples: Math.min(4, renderer.capabilities.maxSamples),
      ssao: hdr,
      bloom: hdr,
    };
    const target = new T.WebGLRenderTarget(1, 1, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.ssao = new SSAOPass(scene, camera, 1, 1, 16);
    this.ssao.kernelRadius = 5;
    this.ssao.minDistance = 0.003;
    this.ssao.maxDistance = 0.09;
    this.bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.12, 0.22, 1.15);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ssao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.output);
  }
  configure(s: ForgeSettings['graphics']) {
    const samples = s.aa === 'msaa' ? this.capabilities.msaaSamples : 0;
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2])
      if (target.samples !== samples) {
        target.samples = samples;
        target.dispose();
      }
    this.ssao.enabled = s.ao === 'ssao' && this.capabilities.ssao;
    this.bloom.enabled = s.bloom && this.capabilities.bloom;
    this.bloom.strength = s.bloomStrength;
    this.fxaa.enabled = s.aa === 'fxaa';
  }
  resize(width: number, height: number, ratio: number) {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.fxaa.uniforms.resolution.value.set(
      1 / Math.max(1, width * ratio),
      1 / Math.max(1, height * ratio),
    );
  }
  prewarm() {
    const flags = [this.ssao.enabled, this.bloom.enabled, this.fxaa.enabled];
    this.composer.setPixelRatio(1);
    this.composer.setSize(32, 32);
    this.ssao.enabled = this.capabilities.ssao;
    this.bloom.enabled = this.capabilities.bloom;
    this.fxaa.enabled = true;
    this.composer.render(0);
    [this.ssao.enabled, this.bloom.enabled, this.fxaa.enabled] = flags;
    this.resize(this.width, this.height, this.ratio);
  }
  render(dt: number) {
    this.composer.render(dt);
  }
  dispose() {
    this.ssao.dispose();
    this.bloom.dispose();
    this.fxaa.dispose();
    this.output.dispose();
    this.composer.dispose();
  }
}
