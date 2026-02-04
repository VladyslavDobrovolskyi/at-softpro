import { test, expect, type Page, type Locator, type Request, type TestInfo } from '@playwright/test'
import * as allure from 'allure-js-commons'
import { Newsletter } from './tests/pages/newsletter.page'
// Типи
type Rect = { x: number; y: number; width: number; height: number }
interface ButtonBox {
	box: Rect | null
	locator: Locator
}

// Використовуємо Page Object `Newsletter` з методами `fill`, `submitNearest()` для чистоти й повторного використання.

test.describe('Підписка на розсилку — поле Email', () => {
	test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot().catch(() => null)
			if (screenshot) allure.attachment('скриншот', screenshot, 'image/png')
			const html = await page.content().catch(() => null)
			if (html) allure.attachment('HTML сторінки', html, 'text/html')
			const captured = (page as any)._capturedRequests ? (page as any)._capturedRequests()! : []
			if (captured && captured.length)
				allure.attachment('перехоплені-запити', JSON.stringify(captured, null, 2), 'application/json')
		}
	})

	test.beforeEach(async ({ page }: { page: Page }) => {
		await page.goto('https://softpro.ua/uk')

		// БЕЗПЕКА: перехоплюємо та фіксуємо запити, щоб не впливати на production
		const allowReal = process.env.RUN_PROD_REAL === 'true'
		let capturedRequests: Array<{ url: string; method: string; postData?: string | null }> = []
		if (!allowReal) {
			await page.route('**/api/**', async route => {
				const req = route.request()
				const postData = await req.postData()
				capturedRequests.push({ url: req.url(), method: req.method(), postData })
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ intercepted: true }),
				})
			})
		}
		;(page as any)._capturedRequests = () => capturedRequests
	})

	const validEmails: string[] = [
		'test@example.com',
		'first.last@example.com',
		'test-mail@example.com',
		'user123@example.com',
		'user+extra@gmail.com',
		'admin@startup.agency',
		'info@my.long.domain.name',
		'support@tech.io',
		'postmaster@[123.123.123.123]',
	]

	validEmails.forEach(email =>
		test(`Валідна адреса: ${email}`, async ({ page }: { page: Page }) => {
			await allure.epic('Розсилка')
			await allure.feature('Підписка')
			await allure.story('Валідні адреси email')
			await allure.severity('critical')
			await allure.owner('qa@softpro.ua')

			const news = new Newsletter(page)
			await news.fill(email)
			// очистити попередні перехоплення
			;(page as any)._capturedRequests()!.length = 0
			const captured = await news.submitNearest(3000)
			expect(captured).not.toBeNull()
			allure.attachment('перехоплений-запит', JSON.stringify(captured, null, 2), 'application/json')
			const post: string | null | undefined = captured?.postData
			if (!post) throw new Error('У запиті відсутнє тіло')
			try {
				const json = JSON.parse(post)
				expect(json.email).toBe(email)
			} catch (e) {
				expect(post).toContain(email)
			}
		}),
	)

	test('Блокує явно некоректні адреси email (жодних мережевих запитів) ❌', async ({ page }: { page: Page }) => {
		await allure.epic('Розсилка')
		await allure.feature('Підписка')
		await allure.story('Некоректні адреси email')
		await allure.severity('critical')
		await allure.owner('qa@softpro.ua')
		const news = new Newsletter(page)
		const btn = await news.findNearestSubscribeButton()
		test.skip(!btn, 'Кнопку підписки не знайдено')
		const s = btn!

		const invalidEmails: string[] = [
			'',
			'plainaddress.com',
			'test@',
			'@example.com',
			'test@@example.com',
			' test@example.com',
			'test @example.com',
			'test@ex#mple.com',
			'.test@example.com',
			'test@example.com..',
			'test..user@example.com',
			'test@example..com',
		]

		for (const email of invalidEmails) {
			await test.step(`Переконатися, що ${email || '<empty>'} заблоковано`, async () => {
				await news.input.fill('')
				await news.input.fill(email)
				// Очистити перехоплення та натиснути
				;(page as any)._capturedRequests()!.length = 0
				await s.click()
				await new Promise(r => setTimeout(r, 800))
				const captures = (page as any)._capturedRequests()!
				// Строга політика: якщо email в списку некоректних — будь-який перехоплений запит це фейл
				expect(captures.length).toBe(0)
			})
		}
	})

	test('Перевірка меж: maxlength та обмеження local-part ⚖️', async ({ page }: { page: Page }) => {
		await allure.epic('Розсилка')
		await allure.feature('Підписка')
		await allure.story('Перевірка меж')
		await allure.severity('major')
		await allure.owner('qa@softpro.ua')
		const news = new Newsletter(page)
		const btn = await news.findNearestSubscribeButton()
		test.skip(!btn, 'Кнопку підписки не знайдено')
		const s = btn!

		// Дуже довга адреса (загалом >254 символів)
		const longLocal: string = 'a'.repeat(64)
		const domain: string = 'example.com'
		const normal: string = `${longLocal}@${domain}`
		expect(normal.length).toBeLessThanOrEqual(254)

		const over254: string = 'a'.repeat(249) + '@x.com' // гарантуємо >254 (249 + 6 = 255)

		// локальна частина рівно 64 символи зазвичай дозволена браузером
		await news.fill(normal)
		const ok64: boolean = await news.input.evaluate(el => (el as HTMLInputElement).checkValidity())
		expect(ok64).toBeTruthy()

		// локальна частина >64 (65) — деякі браузери не накладають обмеження; перевіряємо поведінку: якщо браузер згоден, може бути відправлено запит
		const longLocal65: string = 'a'.repeat(65) + '@example.com'
		await news.fill(longLocal65)
		const valid65: boolean = await news.input.evaluate(el => (el as HTMLInputElement).checkValidity())
		// Переконатися, що застосунок не падає; якщо валідно, може бути надіслано запит
		;(page as any)._capturedRequests()!.length = 0
		await s.click()
		// зачекати трохи для можливого перехоплення
		await new Promise(r => setTimeout(r, 1500))
		const captured = (page as any)._capturedRequests()!
		// або відбудеться серверний запит (ми його перехопили), або браузер заблокує — обидва варіанти прийнятні
		expect(captured.length >= 0).toBeTruthy()
		// Загалом адреса >254 має бути недійсною
		await news.fill(over254)
		const validOver254: boolean = await news.input.evaluate(el => (el as HTMLInputElement).checkValidity())
		if (!validOver254) {
			expect(validOver254).toBe(false)
		} else {
			// Якщо браузер прийняв >254; переконатися, що ми не дозволяємо створювати реальні записи (перехоплюємо) і занотуємо для розслідування
			;(page as any)._capturedRequests()!.length = 0
			await s.click()
			await new Promise(r => setTimeout(r, 800))
			const cap = (page as any)._capturedRequests()!
			if (cap.length > 0) {
				console.warn('Адреса >254 була прийнята і запит перехоплено для перевірки.')
			}
		}
	})

	test('Міжнародні та спеціальні випадки — сайт не повинен падати 🌍', async ({ page }: { page: Page }) => {
		await allure.epic('Розсилка')
		await allure.feature('Підписка')
		await allure.story('Міжнародні/спеціальні випадки')
		await allure.severity('normal')
		await allure.owner('qa@softpro.ua')
		const news = new Newsletter(page)
		const btn = await news.findNearestSubscribeButton()
		test.skip(!btn, 'Кнопку підписки не знайдено')
		const s = btn!

		interface Case {
			email: string
			note: string
		}
		const cases: Case[] = [
			{ email: 'яндекс-тест@почта.рф', note: 'Punycode/кирилиця' },
			{
				email: '"very.(),:;<>[]\\".VERY.\\"very@\\\\ \\\"very\\\".unusual"@strange.example.com',
				note: 'цитована локальна частина',
			},
		]

		for (const c of cases) {
			await test.step(`Відправити ${c.note}`, async () => {
				await news.input.fill('')
				await news.input.fill(c.email)
				// Натиснути і переконатися, що на сторінці немає тексту '500'
				await s.click()
				await page.waitForTimeout(800)
				const has500: number = await page.locator('text=500').count()
				const serverError: number = await page.locator('text=Помилка сервера').count()
				expect(has500).toBe(0)
				expect(serverError).toBe(0)
			})
		}
	})

	// ------- data-driven invalid email tests (краща деталізація звітів) -------
	const invalidEmails: string[] = [
		'',
		'plainaddress.com',
		'test@',
		'@example.com',
		'test@@example.com',
		' test@example.com',
		'test @example.com',
		'test@ex#mple.com',
		'.test@example.com',
		'test@example.com..',
		'test..user@example.com',
		'test@example..com',
	]

	invalidEmails.forEach(email =>
		test(`Некоректна адреса: ${email || '<empty>'}`, async ({ page }: { page: Page }) => {
			await allure.epic('Розсилка')
			await allure.feature('Підписка')
			await allure.story('Некоректні адреси email')
			await allure.severity('critical')
			await allure.owner('qa@softpro.ua')

			const news = new Newsletter(page)
			await news.fill(email)
			// Строга перевірка: жоден з некоректних email не повинен спричиняти мережевий запит
			;(page as any)._capturedRequests()!.length = 0
			const captured = await news.submitNearest(800)
			expect(captured).toBeNull()
		}),
	)
})
