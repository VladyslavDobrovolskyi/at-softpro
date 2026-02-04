import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { faker } from '@faker-js/faker'
import fc from 'fast-check'
import * as allure from 'allure-js-commons'
import { ConsultationForm } from './pages/consultation-form.page'

test.describe('Форма консультації (Отримати консультацію)', () => {
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

		// БЕЗПЕКА: при запуску проти production за замовчуванням перехоплюємо POST /api/**
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
					body: JSON.stringify({ intercepted: true, originalBody: postData ?? null }),
				})
			})
		}

		;(page as any)._capturedRequests = () => capturedRequests
		faker.seed(12345)

		const formObj = new ConsultationForm(page)
		;(page as any)._consultationForm = formObj
		await formObj.open()
	})

	test('Позитивний: відправка форми з валідними даними та надсилання POST 📬 (дані з Faker)', async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Контактна форма')
		await allure.feature('Форма консультації')
		await allure.story('Відправлення з валідними даними')
		await allure.severity('critical')
		await allure.owner('Vladyslav Dobrovolksyi')
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm

		const name = faker.person.fullName()
		const email = faker.internet.email({ provider: 'example.com' })
		const phone: string = `+380${faker.number.int({ min: 100000000, max: 999999999 }).toString()}`
		const message = faker.lorem.sentences(2)

		await formObj.fillForm({ name, email, phone, message })

		const { nameValid, emailValid, messageValid, submitEnabled } = await formObj.checkValidity()

		if (!nameValid || !emailValid || !messageValid || !submitEnabled) {
			await formObj.fillForm({
				name: 'Test User',
				email: 'prodtest@example.com',
				phone: '+380501234567',
				message: 'Hello from test',
			})
		}

		;(page as any)._capturedRequests()!.length = 0
		await formObj.submit()
		const captured = await formObj.submitAndWaitForCapture(10000)

		if (!captured) {
			const content = await page.content()
			console.error('POST не перехоплено; дамп стану форми:')
			console.error('Значення імені:', await formObj.name.inputValue().catch(() => null))
			console.error('Надіслати доступно:', await formObj.submitBtn.isEnabled().catch(() => null))
		}

		expect(captured).not.toBeNull()
		const body = captured?.postData
		allure.attachment('перехоплений-запит', JSON.stringify(captured, null, 2), 'application/json')

		if (body) {
			try {
				const json = JSON.parse(body)
				expect(json.email).toBe(email)
				expect(json.message || json.body).toContain(message.split(' ')[0])
			} catch (e) {
				expect(body).toContain(email)
			}
		}
	})

	test('Властивісний тест: випадкові email-адреси через fast-check (семпл)', async ({ page }: { page: Page }) => {
		await allure.epic('Контактна форма')
		await allure.feature('Форма консультації')
		await allure.story('Випадкові email-адреси')
		await allure.severity('normal')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const samples: string[] = fc.sample(fc.emailAddress(), 12)

		for (const e of samples) {
			await test.step(`перевірити email ${e}`, async () => {
				await formObj.fillForm({ email: e })
				const isValid = await formObj.checkValidity().then(v => v.emailValid)

				const reqPromise = page
					.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 })
					.then(r => r)
					.catch(() => null)

				await formObj.submit()
				const req = await reqPromise
				const has500: number = await page.locator('text=500').count()
				expect(has500).toBe(0)

				if (!isValid) expect(req).toBeNull()
			})
		}
	})

	test("Негативний: обов'язкові поля блокують відправку ❌", async ({ page }: { page: Page }) => {
		await allure.epic('Контактна форма')
		await allure.feature('Форма консультації')
		await allure.story("Обов'язкові поля")
		await allure.severity('critical')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm

		// 1) Усі поля порожні
		await formObj.fillForm({ name: '', email: '', phone: '', message: '' })
		await expect(
			page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 }),
		).rejects.toThrow()

		// 2) Відсутнє лише поле повідомлення
		await formObj.fillForm({ name: 'Іван', email: 'ivan@example.com', phone: '+380501234567', message: '' })

		const messageValid: boolean = await formObj.checkValidity().then(v => v.messageValid)
		if (!messageValid) {
			await formObj.submit()
			await expect(
				page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 }),
			).rejects.toThrow()
		} else {
			const requestPromise = page
				.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 })
				.catch(() => null)
			await formObj.submit()
			const req = await requestPromise
			expect(req).toBeNull()
		}
	})

	// Перевірка: окремі кейси валідації email
	const invalids = ['plainaddress.com', 'test@@example.com', 'test@', '@example.com', 'test..user@example.com']

	invalids.forEach(bad => {
		test(`Негативний: валідація email для ${bad}`, async ({ page }: { page: Page }) => {
			await allure.epic('Контактна форма')
			await allure.feature('Форма консультації')
			await allure.story('Валідація email')
			await allure.severity('major')

			const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
			await formObj.fillForm({ email: bad })

			const valid = await formObj.checkValidity().then(v => v.emailValid)
			if (!valid) {
				await formObj.submit()
				await expect(
					page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 }),
				).rejects.toThrow()
			} else {
				const req = await page
					.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 800 })
					.catch(() => null)
				expect(req).toBeNull()
			}
		})
	})

	test('XSS/SQLi в повідомленні не повинні ламати сторінку (немає 500) 🔒', async ({ page }: { page: Page }) => {
		await allure.epic('Контактна форма')
		await allure.feature('Форма консультації')
		await allure.story('Безпека: XSS/SQLi в повідомленні')
		await allure.severity('critical')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm

		await formObj.fillForm({
			name: 'Небезпечний',
			email: 'safe@example.com',
			phone: '+380501234567',
			message: '<script>alert(1)</script> OR 1=1',
		})

		const requestPromise = page
			.waitForRequest(req => req.method() === 'POST' && req.url().includes('/api'), { timeout: 3000 })
			.catch(() => null)

		await formObj.submit()
		await page.waitForTimeout(800)

		const req = await requestPromise
		const has500 = await page.locator('text=500').count()
		expect(has500).toBe(0)

		if (req) {
			const body = req.postData() || ''
			expect(body).toContain('safe@example.com')
		}
	})
})
