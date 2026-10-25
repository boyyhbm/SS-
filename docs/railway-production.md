# Публичный NEXUS на Railway

## Текущий статус

**Публичное развёртывание пока не выполнено. Фактического HTTPS URL нет.** В рабочей среде не настроена авторизация Railway; обращения к `backboard.railway.com` блокируются сетевым proxy с CONNECT 403. Платные сервисы не создавались. [Машиночитаемый статус](production-status.json).

Подготовлены исходники, Docker-образы Web/Multiplayer, текущий Railway IaC, CI, безопасный release, постоянное хранилище загрузок и тесты. [Локальная репетиция](railway-local-tests.json) проверяет резервную копию и переключение игрового процесса. [Отдельная HTTPS/WSS-проверка](railway-local-https-tests.json) прошла с двумя аккаунтами и настоящим перезапуском обоих процессов; она использует локальный TLS и **не является проверкой публичного Railway**.

## Что размещается

| Сервис            | Конфигурация                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------- |
| NEXUS Web         | Next.js production, 1 replica, порт 3000, HTTPS-домен Railway, `/api/health`, volume `/data` |
| NEXUS Multiplayer | Отдельный Node/Colyseus, 1 replica, порт 2567, WSS-домен Railway, `/live` и `/health`        |
| NEXUS Database    | PostgreSQL 16, только private networking, без публичного TCP proxy; volume PostgreSQL        |

Регион — Europe (`europe-west4-drams3a`). Оба volume первоначально по 1 GiB; runtime каждого сервиса ограничен 1 vCPU / 1 GiB RAM. Автосон отключён, restart policy — Always. Это постоянные **платные** ресурсы; тариф, лимит расходов и стоимость резервных копий владелец должен одобрить перед `apply`. Фактическая цена определяется тарифом и потреблением в Railway. Redis и объектное хранилище в первом релизе не создаются.

## Минимальные действия владельца

1. Разрешить этой среде соединения с Railway и предоставить доступ через защищённую авторизацию CLI / защищённые переменные хостинга. **Не отправлять токены или пароли в чат.** Нужны `backboard.railway.com`, `railway.com`; для установки CLI — GitHub release assets. Для публичных проверок дополнительно нужны именно выданные Web и Multiplayer hostnames.

   Для агента в этой среде сохранён черновик с доменами `backboard.railway.com`, `railway.com`, `docs.railway.com` и защищённым требованием `RAILWAY_API_TOKEN`; прежние разрешения сохранены. Владелец вводит значение только в защищённых настройках, сохраняет и публикует конфигурацию среды, чтобы применить доступ. Это не создаёт Railway-сервисы и не публикует NEXUS. Можно вместо этого авторизовать Railway CLI в другой доверенной машине и выполнить следующие шаги там.

2. В Railway выбрать тариф и создать отдельный проект NEXUS, установить Railway GitHub App с доступом к `boyyhbm/SS-`. Авторизовать CLI >=5.42.1 (`railway login`, затем `railway link`). Инфраструктура описана в [`.railway/railway.ts`](../.railway/railway.ts), SDK закреплён на 3.16.0. Для существующего проекта сначала импортировать конфигурацию и сверить plan, чтобы сохранить его ресурсы.
3. Создать защищённую shared variable `NEXUS_DATABASE_PASSWORD`: случайный URI-safe пароль (например 48 случайных байт в hex). Выполнить bootstrap plan, проверить **3 сервиса / 2 volume / отсутствие удалений**, затем применить только после одобрения расходов:

   ```bash
   NEXUS_RAILWAY_BOOTSTRAP=1 railway config plan
   NEXUS_RAILWAY_BOOTSTRAP=1 railway config apply
   ```

   Bootstrap создаёт PostgreSQL и пустые Web/Multiplayer; код приложения ещё не запускается. В Networking Web нажать Generate Domain с target port 3000, Multiplayer — с target port 2567. Сохранить **реальные** выданные домены. PostgreSQL должен остаться без публичного домена и без TCP proxy.

4. Перенести существующую базу и загрузки по следующему разделу. Создать shared variables `NEXTAUTH_SECRET` и `MULTIPLAYER_SECRET` (каждая — отдельные 48 случайных байт в hex), `NEXUS_WEB_ORIGIN` (реальный `https://…` origin Web), `NEXUS_MULTIPLAYER_ORIGIN` (реальный `wss://…` origin Multiplayer). Значения находятся только в Railway Variables. Повторить `railway config plan` **без bootstrap**, затем `railway config apply`. Этот шаг подключает GitHub/main и запускает release/deploy.
5. В Backups обоих volume включить Daily и Weekly, сделать первую резервную копию и проверить пробное восстановление. Затем передать агенту фактический HTTPS URL для проверок либо запустить подготовленный `test:production` в авторизованной среде. После создания доменов агент может продолжить оставшееся развёртывание и тесты.

CLI доступен как `@railway/cli`; при уже установленном Node можно использовать `npx --yes --package=@railway/cli@5.71.0 railway …`. Node/Docker нужны разработчику для сопровождения; посетитель использует только браузер и публичную ссылку.

## Перенос текущих данных

В этой сессии создана приватная резервная копия **вне Git**: PostgreSQL custom archive, архив uploads, manifest с SHA-256. Проверено восстановление всех 23 таблиц с совпадением числа строк и отпечатков содержимого. Резервная копия содержит приватные данные; не загружать её в GitHub или публичный artifact.

Перед фактическим переключением ограничить запись в старую систему и сделать свежую копию:

```bash
npm run production:backup -- /absolute/private/backup-directory
```

Импортировать **до первого запуска Web/Multiplayer**, когда новая PostgreSQL ещё пуста. Через Railway CLI volume files загрузить `database.dump` на volume NEXUS Database под временным именем `/nexus-transfer.dump`; исходный PGDATA уже инициализирован работающим PostgreSQL:

```bash
railway volume files upload /private/backup/database.dump /nexus-transfer.dump --service "NEXUS Database"
railway ssh --service "NEXUS Database" -- pg_restore --username=nexus --dbname=nexus --no-owner --no-acl --single-transaction --exit-on-error /var/lib/postgresql/data/nexus-transfer.dump
```

Перед импортом проверить, что в целевой базе нет таблиц приложения. **Не использовать `--clean`, reset или импорт поверх пользовательской production-базы.** Существующие ID, password hashes, библиотеки, saves, настройки, друзья и история переносятся вместе с `_prisma_migrations`. Пароли пользователей не пересоздаются. После проверки удалить только временный файл переноса с volume; приватную исходную копию сохранить.

На volume Web загрузить `uploads.tar.gz`. После первого успешного старта Web через Railway SSH распаковать его в `/data/uploads`:

```bash
railway volume files upload /private/backup/uploads.tar.gz /nexus-uploads.tar.gz --service "NEXUS Web"
railway ssh --service "NEXUS Web" -- tar -xzf /data/nexus-uploads.tar.gz -C /data/uploads
```

Проверить старые URL `/api/media/<имя>.webp` и удалить только временный архив переноса. Публичный запуск объявлять после завершения переноса и проверок. Если CLI volume file transfer недоступен на выбранном тарифе, выполнить перенос через предоставленный Railway SSH, сохранив private networking базы; не открывать PostgreSQL всему интернету.

## Конфигурация и сохранность

IaC задаёт reference variables между сервисами; секретные значения в исходниках отсутствуют. `DATABASE_URL` использует `*.railway.internal`, межсервисный HTTP проходит по зашифрованной WireGuard-сети Railway. Web общается с `/control` Multiplayer по private URL; браузер использует только публичный WSS. Сертификаты HTTPS/WSS выпускает Railway.

Стартовые скрипты проверяют HTTPS/WSS, длину ключей, private DB и подключённый volume. `RAILWAY_VOLUME_MOUNT_PATH` предоставляется Railway, подставлять его вручную нельзя. Загрузки пишутся в `/data/uploads`; без volume Web отказывается стартовать. Учётные записи, библиотеки, контроллеры, друзья, сохранения и результаты находятся в PostgreSQL. GLB, текстуры и шрифты входят в образ как неизменяемые ресурсы.

Перед стартом обоих сервисов `scripts/release.mjs` сериализует миграции PostgreSQL advisory lock, выполняет `prisma migrate deploy`; Web дополнительно запускает идемпотентный seed. Ошибка останавливает deployment. Сброса базы и изменения существующих записей seed не делает. Новые миграции должны быть совместимы с предыдущей работающей версией; destructive schema changes требуют отдельного плана.

Auth.js использует Secure HTTP-only cookie на HTTPS. Сервер проверяет Origin, права и роли. CSP разрешает только заданный публичный multiplayer origin. Colyseus ограничивает CORS и WS Origin каноническим Web origin. `TRUST_PROXY=false` сохраняет защиту без доверия произвольному X-Forwarded-For; начальный общий лимит регистрации — 30 попыток за 15 минут. Изменять доверие к IP-заголовкам можно после проверки поведения реального edge.

## Обновления и перезапуски

[GitHub Actions](../.github/workflows/ci.yml) проверяет lint, TypeScript, unit, production build, восстановление backup, singleton handover и browser E2E на отдельной CI-базе. Привязка к main и `checkSuites: true` включают Wait for CI в Railway. Это требует разрешений Railway GitHub App. До фактической проверки в аккаунте нельзя считать интеграцию включённой. IaC не применяется автоматически на каждый commit: обычные изменения кода публикуются через GitHub autodeploy, инфраструктура — отдельным просмотренным plan/apply.

Game server использует session advisory lock отдельного PostgreSQL-соединения. При rolling deploy новый процесс отвечает `/live` и ждёт передачи lock; `/health` остаётся 503. Railway переключает deployment и завершает старый, после чего новый восстанавливает матчи и становится ready. `overlapSeconds=0`, graceful drain — 10 секунд. Только владелец lock может восстановить незавершённые матчи и принимать ввод. Потеря lock-соединения немедленно завершает процесс. Требуется прямое PostgreSQL-соединение, без transaction-pooling proxy.

При первом обновлении со старой версии без ownership lock сначала остановить старый игровой процесс: он ещё не участвует в этом протоколе. После перехода новые версии используют обычный handover.

`/api/health` Web проверяет доступность и мигрированную схему базы; `/health` Multiplayer — готовность симуляции и БД. `/live` предназначен для Railway handover, это **не подтверждение готовности гонки**. Railway проверяет health только при deployment; постоянный внешний monitoring нужно подключить отдельно. Приёмочные тесты ждут именно `/health`.

Текущая игра хранит активную симуляцию в памяти. Перезапуск Multiplayer прерывает текущую гонку: незавершённый match становится ABORTED без выдуманного победителя. Аккаунты, сохранения и завершённые результаты сохраняются. Живого переноса комнаты между процессами нет. Web с volume также может кратко прерывать обслуживание при обновлении.

## Проверки публичного адреса

После реального deploy выполнить:

```bash
NEXUS_PUBLIC_URL=<фактический-HTTPS-origin> npm run test:production -- before
```

Скрипт использует два независимых браузерных контекста и только публичные API/UI; private DB credentials ему не нужны. Создаёт два собственных `release_<hex>` аккаунта, проверяет регистрацию, secure cookie, добавление/избранное, повторный вход, профиль контроллера, настоящий одиночный круг и save, дружбу/приглашение, приватную WSS-гонку, движение соперников, два серверных финиша, историю и возврат в лобби. Credentials и snapshot сохраняются в закрытом файле вне Git; пароли и cookie в отчёт не выводятся. Уменьшенный DPR — функциональная проверка, не замер FPS и не проверка физических контроллеров.

Перезапустить **оба** сервиса средствами Railway, дождаться их готовности и выполнить:

```bash
NEXUS_PUBLIC_URL=<тот-же-HTTPS-origin> npm run test:production -- after-restart /private/path/from-first-run/state.json
```

Скрипт требует смены server instance IDs и сравнивает сохранённые данные после нового входа. Вызов без реального перезапуска не считается успешной проверкой. После сохранения отчётов убрать только созданные тестовые аккаунты через доверенную консоль Web (в течение 24 часов):

```bash
node --import tsx scripts/cleanup-production-check.ts release_<тот-же-hex> <id-a-из-private-state> <id-b-из-private-state>
```

Cleanup требует ID из приватного ledger и проверяет точные имена, reserved email, роль и время создания; чужие матчи не удаляет. Затем удалить приватный тестовый state файл. В текущей среде эти PUBLIC проверки **ещё не выполнялись**, публичный URL отсутствует. Физические USB/Bluetooth-контроллеры требуют отдельной аппаратной проверки.

## Собственный домен

В Networking Web добавить принадлежащий владельцу домен; Multiplayer при необходимости получает отдельный поддомен. У DNS-провайдера добавить **именно записи, показанные Railway**; дождаться выпуска сертификатов. Обновить shared `NEXUS_WEB_ORIGIN` и `NEXUS_MULTIPLAYER_ORIGIN` реальными HTTPS/WSS origins. Выполнить полный rebuild Web, затем deploy Multiplayer: `NEXT_PUBLIC_MULTIPLAYER_URL` входит в сборку Next.js, а WS Origin — в серверную конфигурацию. Повторить публичные проверки. Исходный домен Railway не требует покупки собственного домена.

## Официальные источники

Документация сверена с репозиторием [railwayapp/docs](https://github.com/railwayapp/docs), snapshot `4bc46bc0ba1b27d50c5ef0393132753982b31112`: [IaC](https://docs.railway.com/infrastructure-as-code), [pre-deploy](https://docs.railway.com/deployments/pre-deploy-command), [volumes](https://docs.railway.com/volumes), [backups](https://docs.railway.com/volumes/backups), [GitHub CI](https://docs.railway.com/deployments/github-autodeploys). Сетевые обращения к самому Railway из текущей среды пока запрещены; локальная проверка SDK не заменяет live plan/apply.
