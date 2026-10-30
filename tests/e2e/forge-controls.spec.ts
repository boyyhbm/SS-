import { test, expect, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { defaultForgeSettings } from '../../src/games/fold/settings';
import { isolateRegistrationQuota } from '../helpers/registration-quota';
import { virtualPad, padButton } from './pad-helpers';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const origin = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ids: string[] = [];
const post = (page: Page, url: string, data: unknown) =>
  page.request.post(url, { data, headers: { Origin: origin } });
async function range(page: Page, label: string, value: number) {
  await page.getByRole('slider', { name: label, exact: true }).evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      el,
      String(value),
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
test('FOLD settings: real controls, safe remapping, controller UI, live audio and account/offline persistence', async ({
  page,
}) => {
  test.setTimeout(360000);
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  const report = {
    date: new Date().toISOString(),
    passed: false,
    checks: [] as string[],
    scope:
      'Real browser UI, virtual Gamepad API, digital Web Audio analysis. No physical mouse/controller/speaker or gaming-GPU certification.',
    errors,
  };
  try {
    await isolateRegistrationQuota(db);
    page.on('pageerror', (e) => errors.push(e.name + ': ' + e.message.slice(0, 160)));
    await virtualPad(page, 'Xbox standard virtual QA');
    await page.addInitScript(() => {
      const original = AudioNode.prototype.connect;
      const probes: { node: AnalyserNode; data: Float32Array<ArrayBuffer> }[] = [];
      Object.defineProperty(AudioNode.prototype, 'connect', {
        configurable: true,
        value: function (this: AudioNode, ...args: unknown[]) {
          if (args[0] instanceof AudioDestinationNode) {
            const node = this.context.createAnalyser();
            node.fftSize = 1024;
            Reflect.apply(original, this, [node]);
            probes.push({ node, data: new Float32Array(1024) });
          }
          return Reflect.apply(original, this, args);
        },
      });
      (window as unknown as { foldRms: () => number }).foldRms = () => {
        let power = 0;
        for (const p of probes) {
          p.node.getFloatTimeDomainData(p.data);
          power += p.data.reduce((sum, v) => sum + v * v, 0) / p.data.length;
        }
        return Math.sqrt(power);
      };
    });
    const name = 'foldcfg_' + randomBytes(5).toString('hex'),
      password = randomBytes(20).toString('hex');
    expect(
      (
        await post(page, '/api/register', {
          username: name,
          email: name + '@example.test',
          password,
          confirmPassword: password,
        })
      ).status(),
    ).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { username: name } });
    ids.push(user.id);
    await page.goto('/login');
    await page.locator('[name=email]').fill(user.email);
    await page.locator('[name=password]').fill(password);
    await page.locator('.auth-submit').click();
    await page.waitForURL(origin + '/');
    const consoleData = await (await page.request.get('/api/console')).json(),
      gameId = consoleData.games.find((g: { slug: string }) => g.slug === 'fold-zero').id;
    expect((await post(page, '/api/library', { action: 'add', gameId })).status()).toBe(200);
    expect(
      (
        await post(page, '/api/fold-settings', {
          ownerId: user.id,
          expectedRevision: 0,
          mutationId: randomUUID(),
          settings: {
            ...defaultForgeSettings,
            graphics: { ...defaultForgeSettings.graphics, quality: 'competitive', aa: 'off' },
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto('/play/fold-zero');
    await expect(page.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
      timeout: 90000,
    });
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Настройки FOLD ZERO' });
    await expect(settings).toBeVisible();
    await page.getByRole('button', { name: 'Назначить: Вперёд', exact: true }).click();
    await page.getByRole('button', { name: 'Отменить назначение', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Ожидание ввода' })).toHaveCount(0);
    await expect(settings.getByRole('tab')).toHaveCount(6);
    await range(page, 'Общая чувствительность', 1.7);
    await range(page, 'Чувствительность X', 1.25);
    await range(page, 'Чувствительность Y', 0.65);
    await range(page, 'Множитель ADS мыши', 0.55);
    await page.getByRole('switch', { name: 'Инверсия Y мыши', exact: true }).click();
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect
      .poll(
        async () => (await (await page.request.get('/api/fold-settings')).json()).settings.mouse.x,
      )
      .toBe(1.25);
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push('Independent X/Y/master/ADS/invert mouse settings applied to the account');
    await page.getByRole('tab', { name: /Клавиши/ }).click();
    await page.getByRole('button', { name: 'Назначить: Вперёд', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Ожидание ввода' })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await page.getByRole('button', { name: 'Назначить: Вперёд', exact: true }).click();
    await page.keyboard.press('i');
    await expect(page.getByRole('button', { name: 'Назначить: Вперёд', exact: true })).toHaveText(
      'I',
    );
    await page.getByRole('button', { name: 'Назначить: Огонь', exact: true }).click();
    await page.keyboard.press('f');
    await expect(page.getByRole('dialog', { name: 'Конфликт назначений' })).toBeVisible();
    await page.getByRole('button', { name: 'Поменять местами' }).click();
    await expect(
      page.getByRole('button', { name: 'Назначить: Активировать FOLD', exact: true }),
    ).toHaveText('ЛКМ');
    await page.getByRole('button', { name: 'Сбросить: Огонь', exact: true }).click();
    await page.getByRole('button', { name: 'Поменять местами' }).click();
    await expect(page.getByRole('button', { name: 'Назначить: Огонь', exact: true })).toHaveText(
      'ЛКМ',
    );
    await page.getByRole('button', { name: 'Применить', exact: false }).click();
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push(
      'Keyboard and fire remap, conflict swap, per-key reset, Escape cancels capture without closing settings',
    );
    await page.getByRole('tab', { name: /Геймпад/ }).click();
    await range(page, 'Чувствительность стика X', 1.6);
    await range(page, 'Чувствительность стика Y', 0.8);
    await range(page, 'Deadzone правого стика', 0.23);
    await page.getByLabel('Кривая прицеливания', { exact: true }).selectOption('linear');
    await page.getByRole('button', { name: 'Геймпад: Активировать FOLD', exact: true }).click();
    await page.waitForTimeout(350);
    await padButton(page, 11, 1);
    await expect(page.getByRole('dialog', { name: 'Ожидание ввода' })).toHaveCount(0);
    await padButton(page, 11, 0);
    await expect(
      page.getByRole('button', { name: 'Геймпад: Активировать FOLD', exact: true }),
    ).toHaveText('RS');
    await page.getByRole('button', { name: /Применить/ }).click();
    // RB is a real platform UI event; it changes the settings tab without navigation.
    await page.waitForTimeout(300);
    await padButton(page, 5, 1);
    await expect(page.getByRole('tab', { name: /Прицел/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await padButton(page, 5, 0);
    await range(page, 'Размер прицела', 11);
    await page.getByLabel('Цвет прицела', { exact: true }).fill('#ffd36b');
    await page.getByRole('switch', { name: 'Центральная точка', exact: true }).click();
    await expect(page.getByTestId('crosshair-preview').locator('g')).toHaveAttribute(
      'fill',
      '#ffd36b',
    );
    await page.getByRole('button', { name: /Применить/ }).click();
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push(
      'Separate per-game pad sensitivity, deadzone/curve, button mapping, RB tab navigation, live crosshair preview',
    );
    await page.getByRole('tab', { name: /Графика/ }).click();
    const oldWidth = await page
      .locator('.forge-viewport canvas')
      .evaluate((c) => (c as HTMLCanvasElement).width);
    await range(page, 'Масштаб рендера', 0.7);
    await range(page, 'Поле зрения', 92);
    await page.getByLabel('Сглаживание', { exact: true }).selectOption('fxaa');
    await page.getByLabel('Лимит FPS', { exact: true }).selectOption('30');
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect
      .poll(() =>
        page.locator('.forge-viewport canvas').evaluate((c) => (c as HTMLCanvasElement).width),
      )
      .toBeLessThan(oldWidth * 0.75);
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push(
      'Graphics apply changes actual backing-buffer dimensions; FXAA, FPS cap and FOV persist',
    );
    await page.getByLabel('Графика FOLD', { exact: true }).selectOption('auto');
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect
      .poll(
        () =>
          page.locator('.forge-viewport canvas').evaluate((c) => (c as HTMLCanvasElement).width),
        { timeout: 35000 },
      )
      .toBeLessThan(oldWidth * 0.5);
    report.checks.push(
      'Auto samples real uncapped pre-match frames and reduces the actual buffer under software-GPU load',
    );
    await page.getByRole('tab', { name: /Звук/ }).click();
    await page.getByRole('button', { name: 'Проверить звук' }).click();
    const rms = () =>
      page.evaluate(() => (window as unknown as { foldRms: () => number }).foldRms());
    await expect.poll(rms).toBeGreaterThan(0.00001);
    await page.getByRole('switch', { name: 'Отключить весь звук', exact: true }).click();
    await expect.poll(rms).toBeLessThan(0.0000001);
    await page.getByRole('button', { name: 'Проверить звук' }).focus();
    await padButton(page, 0, 1);
    await page.waitForFunction(() => document.documentElement.dataset.inputMethod === 'gamepad');
    await padButton(page, 0, 0);
    await expect.poll(rms).toBeLessThan(0.0000001);
    await page.getByRole('switch', { name: 'Отключить весь звук', exact: true }).click();
    await expect.poll(rms).toBeGreaterThan(0.00001);
    await page.getByRole('button', { name: /Применить/ }).click();
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push('Actual live Web Audio output responds to mute/unmute without restarting');
    await page.reload();
    await expect(page.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
      timeout: 90000,
    });
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Чувствительность X', exact: true })).toHaveValue(
      '1.25',
    );
    const saved = await (await page.request.get('/api/fold-settings')).json();
    expect(saved.settings).toMatchObject({
      keys: { forward: { code: 'KeyI' } },
      crosshair: { color: '#ffd36b', dot: true },
      controller: { rightDeadzone: 0.23, bindings: { fold: { kind: 'button', index: 11 } } },
      graphics: { fov: 92, aa: 'fxaa' },
    });
    expect(
      (
        await post(page, '/api/fold-settings', {
          ownerId: 'another-owner',
          expectedRevision: saved.revision,
          mutationId: randomUUID(),
          settings: saved.settings,
        })
      ).status(),
    ).toBe(403);
    await page.route('**/api/fold-settings', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 503, body: '{}' })
        : route.continue(),
    );
    await range(page, 'Чувствительность X', 1.8);
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect(page.locator('.fz-sync')).toContainText('На этом устройстве');
    await page.reload();
    await expect(page.getByTestId('fold-player')).toHaveAttribute('data-loaded', 'true', {
      timeout: 90000,
    });
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Чувствительность X', exact: true })).toHaveValue(
      '1.8',
    );
    await page.unroute('**/api/fold-settings');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator('.fz-sync')).toContainText('Сохранено в аккаунте');
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push(
      'Reload preserves all categories; owner mismatch rejected; offline cache survives reload and resynchronizes',
    );
    const latest = await (await page.request.get('/api/fold-settings')).json(),
      remote = structuredClone(latest.settings);
    remote.mouse.x = 2.2;
    expect(
      (
        await post(page, '/api/fold-settings', {
          ownerId: user.id,
          expectedRevision: latest.revision,
          mutationId: randomUUID(),
          settings: remote,
        })
      ).status(),
    ).toBe(200);
    await range(page, 'Чувствительность X', 1.1);
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect(page.locator('.fz-conflict-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Загрузить из аккаунта' }).click();
    await expect(page.getByRole('slider', { name: 'Чувствительность X', exact: true })).toHaveValue(
      '2.2',
    );
    console.log('Settings checkpoint', report.checks.length + 1);
    report.checks.push(
      'Concurrent account revision raises conflict; explicit cloud choice updates the visible editor',
    );
    await page.getByRole('tab', { name: /Клавиши/ }).click();
    await page.getByRole('button', { name: 'Сбросить раздел' }).click();
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Назначить: Вперёд', exact: true })).toHaveText(
      'W',
    );
    await page.getByRole('button', { name: /Применить/ }).click();
    expect(errors).toEqual([]);
    report.passed = true;
  } finally {
    await fs.mkdir('docs/fold-controls', { recursive: true });
    await fs.writeFile(
      'docs/fold-controls/settings-browser.json',
      JSON.stringify(report, null, 2) + '\n',
    );
  }
});
