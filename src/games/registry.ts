import { multiplayerAdapters } from '../multiplayer/adapters';
import type { MultiplayerCapabilities } from '../multiplayer/contracts';
import { foldCapabilities } from './fold/config';
export type RuntimeType =
  'three' | 'react-canvas' | 'webgl' | 'wasm' | 'webgpu' | 'external-sandbox';
export interface GameManifest {
  id: string;
  slug: string;
  title: string;
  description: string;
  genre: string;
  cover: string;
  banner: string;
  screenshots: string[];
  multiplayer?: MultiplayerCapabilities;
  runtimeType: RuntimeType;
  entrypoint: string;
  supportedInputs: ('keyboard' | 'gamepad' | 'touch')[];
  supportedPlatforms: ('desktop' | 'mobile')[];
  version: string;
  status: 'available' | 'coming-soon';
}
export interface RuntimeEvents {
  onLap: (seconds: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
}
export interface FutureRuntimeAdapter {
  type: Exclude<RuntimeType, 'three'>;
  mount: (
    container: HTMLElement,
    manifest: GameManifest,
    events: RuntimeEvents,
  ) => Promise<{ dispose(): void }>;
}
// Only explicitly registered, reviewed internal modules can run. No dynamic user paths.
export const runtimeRegistry: Record<string, GameManifest> = {
  'nfs-underground': {
    id: 'nfs-underground',
    slug: 'need-for-speed-underground',
    title: 'Need for Speed: Underground',
    description:
      'Experimental 2003 PC port. Requires your own SPEED.EXE 1.4 and locally prepared Wasm/data. No game content is distributed.',
    genre: 'racing',
    cover: '/art/underground-local.svg',
    banner: '/art/underground-local.svg',
    screenshots: [],
    runtimeType: 'wasm',
    entrypoint: 'UndergroundLocalAdapter',
    supportedInputs: ['keyboard', 'gamepad'],
    supportedPlatforms: ['desktop'],
    version: '0.1.0-experimental',
    status: 'available',
  },
  'fold-zero': {
    id: 'fold-zero',
    slug: 'fold-zero',
    title: 'FOLD: ZERO',
    description: 'Playable development build: 1v1 duels in a transforming arena.',
    genre: 'shooter',
    cover: '/art/fold-foundry.webp',
    banner: '/art/fold-foundry.webp',
    screenshots: ['/art/fold-foundry.webp'],
    multiplayer: foldCapabilities,
    runtimeType: 'three',
    entrypoint: 'NexusForge',
    supportedInputs: ['keyboard', 'gamepad'],
    supportedPlatforms: ['desktop'],
    version: '0.1.0',
    status: 'available',
  },
  'midnight-outlaws': {
    id: 'midnight-outlaws',
    slug: 'midnight-outlaws',
    title: 'MIDNIGHT OUTLAWS',
    description: 'Original arcade racing prototype',
    genre: 'racing',
    cover: '/art/midnight-keyart.webp',
    banner: '/art/midnight-keyart.webp',
    screenshots: [],
    multiplayer: multiplayerAdapters['midnight-outlaws'].capabilities,
    runtimeType: 'three',
    entrypoint: 'MidnightOutlaws',
    supportedInputs: ['keyboard', 'gamepad', 'touch'],
    supportedPlatforms: ['desktop', 'mobile'],
    version: '0.1.0',
    status: 'available',
  },
};
export function isPlayable(game: {
  status: string;
  runtimeKey: string | null;
  published: boolean;
}) {
  return (
    game.published &&
    game.status === 'AVAILABLE' &&
    !!game.runtimeKey &&
    runtimeRegistry[game.runtimeKey]?.status === 'available'
  );
}
