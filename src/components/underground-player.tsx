'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, ShieldCheck } from 'lucide-react';
import type { GameRuntimeContext } from '@/games/players';
import { accountNamespace, bridgeSchema, UPSTREAM_REVISION } from '@/games/underground/contracts';
import { undergroundOrigin } from '@/games/underground/origin';
import { nexusInput } from '@/input/manager';
import { loadControllers } from '@/input/store';
import { InputNavigation } from './input-navigation';
import './underground-player.css';

export function UndergroundPlayer({ accountId }: GameRuntimeContext) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState(''),
    [notice, setNotice] = useState('Соединяем локальный runtime с библиотекой…');
  const [isolated, setIsolated] = useState(true);
  const [directSource, setDirectSource] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!window.crossOriginIsolated) {
      setIsolated(false);
      setNotice('Для изолированного запуска нужно открыть страницу заново.');
      return;
    }
    const nonce = crypto.randomUUID();
    let origin = '';
    try {
      origin = undergroundOrigin(location.origin);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Не настроен origin runtime.');
      return;
    }
    const namespace = accountNamespace(location.origin, accountId);
    // A full document launch starts with an empty in-memory profile store.
    const controlsReady = loadControllers(true).catch(() => {});
    const receive = async (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const parsed = bridgeSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== nonce) return;
      const message = parsed.data;
      if (message.type === 'ready') {
        if (
          !message.payload ||
          typeof message.payload !== 'object' ||
          !('upstreamRevision' in message.payload) ||
          message.payload.upstreamRevision !== UPSTREAM_REVISION
        ) {
          setNotice('Версия браузерного слоя не совпадает с адаптером.');
          return;
        }
        const [owner] = await Promise.all([namespace, controlsReady]);
        if (cancelled) return;
        const init = {
          protocol: 'nexus-nfsu',
          version: 1,
          nonce,
          type: 'init',
          payload: { namespace: owner, controls: nexusInput.getSnapshot().config },
        };
        setDirectSource(origin + '/nfsu/#launch=' + encodeURIComponent(JSON.stringify(init)));
        frame.current?.contentWindow?.postMessage(init, origin);
        setNotice('Локальный запуск · игровые файлы и сохранения не отправляются на сервер');
      } else if (message.type === 'exit') {
        // Leave the isolated document and restore normal NEXUS navigation headers.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        location.assign('/library');
      } else if (
        message.type === 'state' &&
        message.payload &&
        typeof message.payload === 'object' &&
        'storageBlocked' in message.payload &&
        message.payload.storageBlocked === true
      )
        setNotice('Браузер блокирует OPFS во вложенном окне. Нажмите «Открыть отдельный запуск».');
      else if (
        message.type === 'error' &&
        message.payload &&
        typeof message.payload === 'object' &&
        'message' in message.payload &&
        typeof message.payload.message === 'string'
      )
        setNotice(message.payload.message.slice(0, 1000));
    };
    window.addEventListener('message', receive);
    setSource(origin + '/nfsu/#' + nonce);
    return () => {
      cancelled = true;
      window.removeEventListener('message', receive);
    };
  }, [accountId]);
  return (
    <main className="underground-launcher" data-testid="underground-launcher">
      <InputNavigation suspended />
      <header>
        <a href="/library">
          <ArrowLeft size={17} /> NEXUS
        </a>
        <span>UNDERGROUND / EXPERIMENTAL</span>
        <button
          aria-label="Полный экран Underground"
          onClick={() => {
            if (frame.current?.requestFullscreen)
              void frame.current
                .requestFullscreen()
                .catch(() => setNotice('Полный экран недоступен в этом браузере.'));
            else setNotice('Полный экран недоступен в этом браузере.');
          }}
        >
          <Maximize2 size={18} />
        </button>
      </header>
      <div className="underground-status" role="status">
        <ShieldCheck size={15} />
        {notice}
      </div>
      {!isolated && (
        <button className="button primary" onClick={() => location.replace(location.href)}>
          Открыть изолированный запуск
        </button>
      )}
      {directSource && (
        <button className="underground-direct" onClick={() => location.assign(directSource)}>
          Открыть отдельный запуск
        </button>
      )}
      {source && (
        <iframe
          ref={frame}
          src={source}
          title="Локальный runtime Need for Speed Underground"
          allow="cross-origin-isolated; fullscreen; gamepad"
          sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
          referrerPolicy="no-referrer"
        />
      )}
    </main>
  );
}
