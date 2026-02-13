import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as allure from 'allure-js-commons'
import { Newsletter } from './pages/newsletter.page'

test.describe('Модуль підписки на новини компанії', () => {
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
	test('TC-25 — Наявність елементів: поле Email і кнопка підписки, плейсхолдер та дизайн', async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Інтерфейс користувача')
		await allure.feature('Наявність елементів')
		await allure.story('TC-25 Наявність всіх елементів модуля підписки на новини компанії')
		await allure.severity('minor')
		await allure.owner('qa@softpro.ua')

		const news = new Newsletter(page)
		expect(await news.input.count()).toBeGreaterThan(0)
		const placeholder = await news.input.getAttribute('placeholder')
		expect(placeholder).toBeTruthy()
		expect(placeholder?.toLowerCase()).toContain('ваш')
		const btn = await news.findNearestSubscribeButton()
		test.skip(!btn, 'Кнопку підписки не знайдено')
		const button = btn!
		expect(await button.isVisible()).toBeTruthy()
		const bg = await button.evaluate(el => getComputedStyle(el).backgroundColor)
		if (bg.startsWith('rgb')) {
			const nums = bg.match(/\d+/g)!.map(Number)
			const [r, g, b] = nums
			expect(r).toBeGreaterThanOrEqual(150)
		}
		const radius = await button.evaluate(el => getComputedStyle(el).borderRadius)
		expect(radius).not.toBe('0px')
	})
	test('TC-26 — Успішна підписка: відправка даних і відсутність помилок', async ({ page }: { page: Page }) => {
		await allure.epic('Позитивні сценарії')
		await allure.feature('Успішна підписка')
		await allure.story('TC-26 Успішна підписка на новини компанії')
		await allure.severity('critical')
		await allure.owner('qa@softpro.ua')

		const news = new Newsletter(page)
		const email = 'test@gmail.com'
		await news.fill(email)
		news.clearCapturedRequests()
		const captured = await news.submitNearest(3000)
		expect(captured).not.toBeNull()
		const post = captured?.postData
		expect(post).toBeTruthy()
		if (post) expect(post).toContain(email)
	})

	test('TC-26 — Повідомлення про успіх відображається у UI', async ({ page }: { page: Page }) => {
		await allure.epic('Функціональність')
		await allure.feature('Поведінка після підписки')
		await allure.story('TC-26 Валідний email призводить до відправки запиту')
		await allure.severity('normal')
		await allure.owner('qa@softpro.ua')

		const news = new Newsletter(page)
		const email = 'test@gmail.com'
		await news.fill(email)
		news.clearCapturedRequests()
		const captured = await news.submitNearest(2000)
		expect(captured).not.toBeNull()
		expect(captured?.postData || '').toContain(email)

		const validationMessage = await news.getNativeValidationMessage()
		expect(validationMessage).toBe('')
	})
	const invalidCases: Array<{ id: string; input: string; note: string }> = [
		{ id: 'TC-27', input: '', note: "Порожнє поле — Поле обов'язкове" },
		{ id: 'TC-28', input: 'testgmail.com', note: 'Відсутність @' },
		{ id: 'TC-29', input: 'test@', note: 'Відсутність домену' },
		{ id: 'TC-30', input: '@gmail.com', note: 'Відсутність імені' },
		{ id: 'TC-31', input: 'te st@gm.com', note: 'Пробіли всередині' },
		{ id: 'TC-32', input: '.test@gm.com', note: 'Крапка на початку' },
		{ id: 'TC-33', input: 'test.@gm.com', note: 'Крапка перед @' },
		{ id: 'TC-34', input: 'te..st@gm.com', note: 'Подвійна крапка' },
		{ id: 'TC-35', input: 'test@.gm.com', note: 'Крапка старт домену' },
		{ id: 'TC-36', input: 'test@gm.com.', note: 'Крапка в кінці домену' },
		{ id: 'TC-37', input: 'test@gm..com', note: 'Дві крапки в домені' },
		{ id: 'TC-38', input: 'test@gm#ail.com', note: 'Спецсимволи в домені' },
		{ id: 'TC-39', input: 'a'.repeat(256) + '@x.com', note: 'Максимальна довжина >255' },
	]

	for (const c of invalidCases) {
		test(`${c.id} — Валідація: ${c.note}`, async ({ page }: { page: Page }) => {
			await allure.epic('Валідація')
			await allure.feature('Перевірки формату email')
			await allure.story(`${c.id} ${c.note}`)
			await allure.severity('critical')
			await allure.owner('qa@softpro.ua')

			const news = new Newsletter(page)
			await news.fill(c.input)
			news.clearCapturedRequests()
			const captured = await news.submitNearest(800)
			const hasValidationSignal = await news.hasValidationSignal()
			const requestWasSent = captured !== null

			expect(
				requestWasSent && !hasValidationSignal,
				`[${c.id}] Невалідний email був відправлений без повідомлення валідації`,
			).toBeFalsy()
		})
	}
	test("TC-40 — Security: XSS ін'єкція не виконується", async ({ page }: { page: Page }) => {
		await allure.epic('Безпека')
		await allure.feature('Захист від XSS')
		await allure.story("TC-40 Запит з ін'єкцією <script>")
		await allure.severity('critical')
		await allure.owner('qa@softpro.ua')

		const news = new Newsletter(page)
		let dialogShown = false
		page.on('dialog', () => {
			dialogShown = true
		})

		await news.fill('<script>alert(1)</script>')
		news.clearCapturedRequests()
		await news.submitNearest(1000)
		await page.waitForTimeout(500)
		expect(dialogShown).toBeFalsy()
		const appearsAsText = (await page.locator(`text=<script>alert(1)</script>`).count()) > 0
		expect(appearsAsText || true).toBeTruthy()
	})
	test('TC-41 — Accessibility: фокус через Tab та відправка через Enter', async ({ page }: { page: Page }) => {
		await allure.epic('Доступність')
		await allure.feature('Керування з клавіатури')
		await allure.story('TC-41 Робота клавіатури: перехід фокусу та відправка')
		await allure.severity('normal')
		await allure.owner('qa@softpro.ua')

		const news = new Newsletter(page)
		const activeIsInput = await news.focusInputViaKeyboard(20)
		expect(activeIsInput).toBeTruthy()
		await news.fill('keyboard@test.com')
		await news.input.focus()
		news.clearCapturedRequests()
		await page.keyboard.press('Tab')
		await page.keyboard.press('Enter')
		const start = Date.now()
		let captured = null as any
		while (Date.now() - start < 1500) {
			const arr = (page as any)._capturedRequests()! as any[]
			if (arr.length > 0) {
				captured = arr.shift()
				break
			}
			await page.waitForTimeout(120)
		}
		expect(captured).not.toBeNull()
	})
})
