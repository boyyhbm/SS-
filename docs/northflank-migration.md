# Перенос NEXUS с Render: Developer Sandbox

Статус: подготовка и локальная проверка. Ресурсы Northflank ещё не созданы,
публичный сайт не переключён, актуальная production-копия Render не получена.
Согласие владельца привязать карту относится к проверке аккаунта. Платные
ресурсы этим согласием не разрешены.

## Что подходит и что ещё требует проверки

Официальная документация описывает бесплатный Developer Sandbox: два сервиса,
два задания и один addon. Это соответствует двум постоянно работающим Node
процессам NEXUS и PostgreSQL. HTTP/WebSockets поддерживаются. Статический хостинг
или serverless functions не заменяют сервер Colyseus.

Northflank прямо относит Sandbox к хобби/экспериментам и не рекомендует его для
production. Это вариант бесплатной тестовой площадки, а не обещание SLA или
достаточной мощности для публичных соревнований. Производительность именно
бесплатного аккаунта ещё не измерена. 60 Hz сервера и предельное число комнат
нужно проверить после развёртывания.

Квота количества сервисов не доказывает бесплатность любой конфигурации. Перед
созданием проверить в кабинете выбранный план, CPU/RAM, сборки, хранилище addon,
egress/трафик, резервные копии и суммарную цену. Нельзя автоматически выбирать
`nf-compute-20`: в примере общего API у него есть ненулевая месячная стоимость;
применение бесплатной квоты зависит от аккаунта. Нельзя переключаться на PAYG,
увеличивать диски или использовать BYOC. Billing alerts не являются жёстким
ограничением расходов. Если выбранная конфигурация имеет ненулевую цену, её
не создавать в рамках этого переноса.

## Конфигурация ресурсов

Один проект, один регион, без autoscaling. Использовать подключённый
`boyyhbm/SS-`, ветку `free-hosting-migration`, затем зафиксировать проверенный SHA.
Не включать автоматическое переключение production с `main` во время переноса.

| Ресурс              | Сборка / версия                                      | Сеть                                                    | Ограничения                                                             |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `nexus-web`         | `deploy/railway/Dockerfile.web`, context `/`         | HTTP 3000, public HTTPS                                 | 1 instance, без volume                                                  |
| `nexus-multiplayer` | `deploy/railway/Dockerfile.multiplayer`, context `/` | HTTP/WebSocket 2567, public HTTPS/WSS и project-private | 1 instance, без volume                                                  |
| `nexus-database`    | PostgreSQL 16 addon                                  | Только project-private                                  | 1 replica, только подтверждённая бесплатная квота, disk autoscaling off |

Существующие Dockerfiles пригодны для другого хостинга, несмотря на имя папки.
Не использовать импорт Docker Compose, создающий PostgreSQL третьим compute
service. Не добавлять Redis, GPU, load generator или дополнительный build service.
У combined services проверить стоимость build compute. Если сборки не входят в
нулевой бюджет, сначала подготовить отдельный вариант сборки вне Northflank,
не включать платные сборки автоматически.

Для PostgreSQL использовать прямое соединение, а не PgBouncer в transaction
pooling: singleton multiplayer использует session advisory lock. Скопировать
реальный project-private `POSTGRES_URI` через secret group как `DATABASE_URL`.
Не включать public database access ради переноса. Если у addon включён TLS,
передать его штатные параметры/CA; не отключать проверку сертификатов.

Для сервисов задать переменные из
[`deploy/northflank/.env.example`](../deploy/northflank/.env.example).
`NF_PROJECT_ID` и `NF_OBJECT_ID` предоставляет хост. Реальные публичные домены
копируются из Networking, не конструируются по шаблону. Приватный control
адрес использует документированный формат `nexus-multiplayer:2567`.

Web Docker build arguments: `NEXUS_DEPLOYMENT=northflank` и фактический
`NEXUS_MULTIPLAYER_ORIGIN=https://…`. Общая переменная runtime недостаточна:
адрес WSS встраивается в клиентский bundle. При смене MP домена пересобрать Web.
Начальные ресурсы можно зарезервировать paused и узнать назначенные домены,
после чего выполнить сборки с правильными адресами. Весь startup во время
импорта — только с `NEXUS_MIGRATION_HOLD=1`.

Health checks: Web `/api/health`, MP `/live`, на соответствующих HTTP портах.
Во время hold они отвечают 200 с `preparation:true`; это проверка доступности
контейнера, не доказательство доступности игры. Остальные пути, в том числе
регистрация и игровой control, отвечают 503. Миграции и seed не запускаются.
Полная Web сборка при этом создаётся, и не требует пересборки только ради
снятия hold. После снятия hold MP `/health` должен подтверждать активное
владение симуляцией; `/live` одного недостаточно.

Отдельно исправлено разрешение CSP для изолированного Underground: при bind на
`0.0.0.0` сервер мог вычислять другой разрешённый iframe host, чем браузер.
Теперь CSP использует канонический `NEXTAUTH_URL`, как авторизация и MP host.
Ограничение отдельного origin и запрет передачи auth cookies сохранены.

## Сохранение изображений без платного диска

Текущие admin uploads сохраняются как очищенные WebP. В режиме
`NEXUS_MEDIA_STORE=database` они хранятся в новой таблице `UploadedImage` в том
же PostgreSQL. Ссылки `/api/media/<uuid>.webp`, проверка администраторов и
валидация входящих картинок сохранены. Старый filesystem mode остаётся режимом
по умолчанию; Render Blueprint и его диск не менялись.

`NEXUS_MEDIA_LIMIT_BYTES` ограничивает суммарные bytes содержимого изображений.
Пример 50 MiB нужно сопоставить с фактической свободной квотой addon. Это не
лимит полного размера базы: индексы, TOAST, WAL, saves, результаты и прочие
таблицы занимают дополнительное место. При нехватке места приложение откажет
в новой загрузке, но не должно автоматически увеличивать платный диск.
Параллельные uploads сериализуют проверку квоты. URL неизменяемый: замена его
содержимого при импорте запрещена. Этот механизм не принимает оригинальные
NFS файлы, WASM или произвольные игровые ресурсы.

Проверка и импорт **свежей** копии uploads на приватном migration job/worker:

```sh
npm run production:import-media -- --directory /private/backup/uploads --manifest /private/media-manifest.json
npm run production:import-media -- --directory /private/backup/uploads --manifest /private/media-manifest.json --apply
```

Первая команда не пишет в БД. Вторая требует `NEXUS_MIGRATION_HOLD=1`,
database media mode, совпадение manifest, корректные WebP и соблюдение квоты.
Импорт атомарный и допускает безопасный повтор. Источник не изменяется.

## Порядок переключения с данными

1. Проверить нулевую цену конфигурации в аккаунте. Оставить Render нетронутым.
2. Получить актуальный managed PostgreSQL export Render и копию его uploads.
   Имеющиеся локальные архивы октября не считать production-копией. Команда
   `production:backup` работает с локальным Docker и не экспортирует Render.
3. Оставить оба новых сервиса на hold. Восстановить dump только в новую пустую
   БД, с `--no-owner --no-acl --single-transaction --exit-on-error`, без
   `--clean`/reset. Не публиковать signed backup URL или credentials.
4. Сравнить число записей и отпечатки содержимого всех старых таблиц, включая
   users/password hashes, библиотеки, друзей, saves, профили контроллеров и
   результаты. Проверить `_prisma_migrations`. Исходная БД не изменяется.
5. На отдельном одноразовом release job выполнить `node scripts/release.mjs`
   с `NEXUS_SERVICE=web` и hold=0 **только у job**. Оба сервиса остаются на
   hold=1. Это применяет additive migration и idempotent seed к восстановленной
   базе. Пользователи и существующие каталожные правки не сбрасываются.
6. Выполнить preflight/verified import uploads и проверить прежние media URLs.
   Если актуальная копия uploads отсутствует, не считать изображения перенесёнными.
7. Только после проверки данных снять hold у MP, затем Web. Проверить readiness,
   регистрацию/вход, личную библиотеку, saves, друзей, admin uploads, обе игры,
   реальный WSS матч двух клиентов и чистый перезапуск контейнеров.
8. Выполнить нагрузочную проверку на доступных CPU/RAM и убедиться, что расходы
   остаются нулевыми. При нехватке ресурсов зафиксировать ограничения бесплатного
   хоста, не оплачивать масштабирование без нового разрешения.
9. Дать новую ссылку владельцу. Не удалять старый Render как часть подготовки.

Пока старый сайт suspended, неизвестна причина приостановки и актуальный объём
данных. Через Dashboard владельца
нужно проверить причину suspension и возможность получить export. Включать новый
пустой аккаунтный сервис вместо утраченных данных нельзя.

Новый домен потребует входа заново. Браузерные OPFS данные Underground привязаны
к старому origin: PostgreSQL backup их не содержит. Если владелец ранее импортировал
свои NFS файлы/сохранения, перенести их через локальный export/import, без загрузки
защищённых игровых файлов на сервер NEXUS.

## Проверки и источники

Локальный отчёт: [`northflank-local-tests.json`](northflank-local-tests.json).
Эти проверки не подтверждают доступность публичного Northflank и его free quota.
Проверка локального backup/restore и владения сервером:
[`northflank-restore-tests.json`](northflank-restore-tests.json).

Официальные источники, проверены 31 октября 2026:

- [Pricing / Sandbox](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- [Private ports и WebSockets](https://northflank.com/docs/v1/application/network/configure-ports)
- [PostgreSQL](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-postgresql-on-northflank)
- [Переменные runtime](https://northflank.com/docs/v1/application/secure/inject-secrets)
- [Общий API планов: не доказательство бесплатности конкретного аккаунта](https://northflank.com/docs/v1/api/miscellaneous/miscellaneous/list-plans)

Из этой среды HTTPS Northflank/Render API недоступны (proxy 403). Документация
прочитана в официальном [northflank/skills](https://github.com/northflank/skills),
commit `870cf630fa0e5a8eeae9d19e6feea2357d81c54f`, `references/guides` и `references/api`.
Доступа к кабинету владельца и его billing plan в этой среде нет.
