import { db } from './db';
import { currentUser } from './auth';
import { gameArtwork } from './artwork';
import { CITY_ROUTE_IDS } from '@/games/road-network';
export async function consoleData() {
  const user = await currentUser();
  const [games, library, aggregate, recent, saves] = await Promise.all([
    db.game.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    }),
    user ? db.userLibrary.findMany({ where: { userId: user.id }, include: { game: true } }) : [],
    user
      ? db.gameSession.aggregate({ where: { userId: user.id }, _sum: { durationSeconds: true } })
      : null,
    user
      ? db.gameSession.findFirst({
          where: { userId: user.id },
          orderBy: { startedAt: 'desc' },
          include: { game: { select: { title: true, slug: true } } },
        })
      : null,
    user
      ? db.gameSave.findMany({
          where: {
            userId: user.id,
            saveKey: { in: ['best-lap', ...CITY_ROUTE_IDS.map((id) => `best-lap:${id}`)] },
          },
          select: { gameId: true, saveKey: true, saveData: true },
          orderBy: { saveKey: 'asc' },
        })
      : [],
  ]);
  return JSON.parse(
    JSON.stringify({
      games: games.map(gameArtwork),
      library: library.map((e) => ({ ...e, game: gameArtwork(e.game) })),
      saves,
      user: user
        ? {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            createdAt: user.createdAt,
            settings: user.settings,
            totalSeconds: aggregate?._sum.durationSeconds ?? 0,
            lastGame: recent?.game ?? null,
          }
        : null,
    }),
  ) as ConsoleData;
}
export interface GameDTO {
  id: string;
  slug: string;
  title: string;
  description: string;
  descriptionEn: string;
  genre: string;
  cover: string;
  banner: string;
  screenshots: string[];
  status: 'DRAFT' | 'COMING_SOON' | 'AVAILABLE';
  runtimeKey: string | null;
  sortOrder: number;
  published: boolean;
  version: string;
  createdAt: string;
}
export interface LibraryDTO {
  id: string;
  gameId: string;
  addedAt: string;
  isFavorite: boolean;
  lastPlayedAt: string | null;
  game: GameDTO;
}
export interface SettingsDTO {
  language: 'ru' | 'en';
  uiSoundEnabled: boolean;
  reducedMotion: boolean;
  backgroundEffectsEnabled: boolean;
  profilePrivate: boolean;
}
export interface UserDTO {
  id: string;
  username: string;
  email: string;
  avatar: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  settings: SettingsDTO | null;
  totalSeconds: number;
  lastGame: { title: string; slug: string } | null;
}
export interface ConsoleData {
  games: GameDTO[];
  library: LibraryDTO[];
  user: UserDTO | null;
  saves: { gameId: string; saveKey: string; saveData: { seconds: number } }[];
}
