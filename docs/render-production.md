# NEXUS на Render

## Текущий шаг владельца

Откройте **https://dashboard.render.com/** и войдите через **GitHub**. Затем сообщите агенту, что вход выполнен. Дальше действия выполняются по одному; токены и пароли в чат не нужны.

## Конфигурация проекта

[`render.yaml`](../render.yaml) создаёт в Frankfurt:

| Ресурс            | Настройка                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- |
| nexus-web         | Платный Starter, 1 instance, Next.js production, HTTPS; диск `/var/data`, 1 GB            |
| nexus-multiplayer | Платный Starter, 1 instance, отдельный Colyseus, WSS                                      |
| nexus-database    | Платный basic-256mb, PostgreSQL 16, 5 GB; внешние подключения запрещены `ipAllowList: []` |

Free не используется: постоянно доступный игровой процесс и долговременная БД не должны зависеть от бесплатного trial. Актуальную сумму показывает Render перед созданием; оплаченные ресурсы в этой сессии не создавались. Первый проект должен быть новым, без уже существующих ресурсов с совпадающими именами. При подключении существующего проекта сначала сверить конфигурацию и сохранить его backup.

После входа: **New → Blueprint → Connect GitHub repository → boyyhbm/SS- → main**. Render прочитает `render.yaml` и покажет ресурсы/стоимость. Разрешение GitHub App ограничить этим репозиторием. Проверить два web services, одну PostgreSQL, один постоянный диск Web. Dashboard владельца выявил ограничение: `maxShutdownDelaySeconds` не поддерживается у сервиса с диском. Параметр удалён у Web и сохранён у Multiplayer; повторная проверка через **Retry** ещё ожидается. У агента нет авторизации Render, API блокируется сетевым proxy (CONNECT 403).

Образы уже имеют production-скрипты; пути `deploy/railway/Dockerfile.*` сохранены для повторного использования прежних Dockerfile. Имя каталога не меняет их работу на Render. Никаких серверов Node на телефоне или компьютере посетителя запускать не нужно.

## Первый deploy и сохранение данных

Первоначально ключ `NEXUS_LIVE` отсутствует. Серверы запускают **режим подготовки**: health для развёртывания отвечает 200 с `preparation: true`, все страницы и регистрация — 503. Миграции/seed не запускаются, игровая симуляция не стартует. Это ещё не готовый сайт. `/health` Multiplayer остаётся 503 до запуска настоящего игрового сервера.

Секреты создаются Render через `generateValue: true`; общий `MULTIPLAYER_SECRET` находится в группе `nexus-production`, отдельный `NEXTAUTH_SECRET` — только у Web. Никогда не помещать их в Git, публичные переменные или чат. `DATABASE_URL` берётся из **внутреннего** connectionString managed PostgreSQL, Web→Multiplayer — из private hostport. Production-проверка отклоняет внешний DB URL, публичный control URL и загрузки вне диска. Наличие настоящего mount `/var/data` проверяется по таблице монтирования Linux.

Перед включением перенести существующую локальную PostgreSQL и uploads. Приватная проверенная копия находится вне Git; сделать свежую перед переключением:

```bash
npm run production:backup -- /absolute/private/backup-directory
```

Render PostgreSQL нельзя открывать всему интернету ради переноса. Доверенный сопровождающий добавляет свой SSH public key в Render и открывает туннель через уже работающий подготовительный Web:

```bash
render ssh nexus-web --output text -- -N -L 127.0.0.1:55432:<actual-private-db-host>:5432
```

Приватные PG-параметры берутся только из защищённой конфигурации Render и сохраняются локально в отдельном env-файле с правами 600. Для клиента через туннель указать `PGHOST=127.0.0.1`, `PGPORT=55432`, имя базы/пользователя и пароль хостинга. Не отключать проверку host key SSH. Команды PostgreSQL 16 запускаются локально в Docker; нужен Linux host networking:

```bash
docker run --rm --network host --env-file /private/render-restore.env postgres:16-alpine psql -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
```

Восстанавливать только если целевая БД пуста (результат 0):

```bash
docker run --rm -i --network host --env-file /private/render-restore.env postgres:16-alpine pg_restore --no-owner --no-acl --single-transaction --exit-on-error < /private/backup/database.dump
```

Не применять `--clean`, reset или импорт поверх живой базы. Сохранить `_prisma_migrations`, все ID/password hashes, библиотеки, контроллеры, saves, друзей и результаты; проверить количество таблиц, число строк и отпечатки содержимого. Локальное восстановление всех 23 таблиц ранее проверено, но перенос в Render ещё **не выполнялся**.

Передать собственный архив uploads в постоянный диск через зашифрованный SSH stdin:

```bash
render ssh nexus-web --output text -- -T 'mkdir -p /var/data/uploads && tar -xzf - -C /var/data/uploads' < /private/backup/uploads.tar.gz
```

Команды SSH сверены с исходниками [официального CLI](https://github.com/render-oss/cli) `7129791ee688c7fb0622bef2f571298c1b682e9c`; на аккаунте Render они ещё не проверены. Если план ограничивает forwarding/SSH, сначала выяснить поддерживаемый private transfer, сохранив запрет внешней БД. Приватную исходную резервную копию не удалять.

## Включение NEXUS

После переноса в группе **nexus-production** добавить:

- `NEXUS_WEB_ORIGIN` — фактический HTTPS origin Web из Dashboard.
- `NEXUS_MULTIPLAYER_ORIGIN` — фактический HTTPS origin Multiplayer из Dashboard; код преобразует его в WSS для браузера.
- `NEXUS_LIVE=1`.

Эти значения не зашиты в Blueprint и не сбрасываются при обычном обновлении кода. Не угадывать `.onrender.com` адрес: Render может добавить суффикс. Для Web и Multiplayer выполнить **rebuild и deploy** после смены параметров. Web встраивает WSS origin в собранную CSP-политику; одного runtime restart недостаточно. SDK получает адрес подключения из подписанного сервером билета.

Pre-deploy сериализует `prisma migrate deploy` через PostgreSQL advisory lock; Web дополнительно выполняет идемпотентный seed без перезаписи пользовательских данных. Сбой останавливает развёртывание. После импорта существующих миграций остаются только действительно новые. Регистрация доступна только после живого запуска.

Health Web — `/api/health`, готовность Multiplayer — `/health`. `/live` используется для handover: новый процесс ждёт ownership, старый получает SIGTERM и освобождает lease. Внешний monitoring должен проверять `/health`, а не только `/live`. Один активный игровой процесс; данные завершённых матчей сохраняются, незавершённая гонка при перезапуске становится ABORTED без выдуманного победителя. Диск Web допускает краткое прерывание при обновлении.

## Публичные проверки и обновления

После запуска использовать только фактический HTTPS адрес:

```bash
NEXUS_PUBLIC_URL=<actual-Web-HTTPS-origin> npm run test:production -- before
```

Проверяются два независимых аккаунта, Secure cookie, библиотека/избранное, одиночный круг/save, друзья, приглашение, WSS-гонка и два серверных финиша. Затем **реально перезапустить оба сервиса** и выполнить `after-restart` с приватным state-файлом первого запуска. Тест требует смены обоих instance IDs и совпадения сохранённых данных. Скрипт/cleanup описаны в исходниках; state и секреты не входят в Git. Физические геймпады требуют отдельной проверки.

`autoDeployTrigger: checksPass` связывает публикацию main с проверками [GitHub Actions](../.github/workflows/ci.yml). Render GitHub App должен иметь разрешение читать результаты CI. Пока это не проверено на аккаунте, интеграция не считается действующей. База не пересоздаётся при обновлениях. Проверить доступные на выбранном плане автоматические backup/PITR PostgreSQL и снимки постоянного диска, затем провести пробное восстановление. Эти проверки хостинга пока не выполнялись.

Свой домен: добавить его в Settings → Custom Domains нужного сервиса, внести именно показанные Render DNS-записи и дождаться HTTPS. Изменить реальные origins в группе, пересобрать Web и развернуть оба сервиса; повторить публичные тесты.
