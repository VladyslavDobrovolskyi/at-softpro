import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { faker } from '@faker-js/faker'

import * as allure from 'allure-js-commons'
import { ConsultationForm } from './pages/consultation-form.page'
export async function getAlertMessage(
	page: Page,
): Promise<{ type: 'success' | 'error' | 'other'; text: string } | null> {
	const alert = page.locator('div.absolute.flex.items-center .flex-1 > p').first()
	if (await alert.isVisible().catch(() => false)) {
		const text = (await alert.textContent())?.trim() || ''
		if (/успішн|дяку|thank|success|відправлен/i.test(text)) return { type: 'success', text }
		if (/помилк|error|невірн|некоректн|invalid|коректн/i.test(text)) return { type: 'error', text }
		return { type: 'other', text }
	}
	return null
}

export async function hasSuccessMessage(page: Page): Promise<boolean> {
	const alert = await getAlertMessage(page)
	return alert?.type === 'success'
}

function getCapturedRequests(page: Page): Array<{ url: string; method: string; postData?: string | null }> {
	return ((page as any)._capturedRequests ? (page as any)._capturedRequests() : []) || []
}

function clearCapturedRequests(page: Page) {
	const captured = getCapturedRequests(page)
	captured.length = 0
}

async function submitAndCollect(page: Page, formObj: ConsultationForm, waitMs = 1200) {
	clearCapturedRequests(page)
	await formObj.submit()
	const start = Date.now()
	while (Date.now() - start < waitMs) {
		if (getCapturedRequests(page).length > 0) break
		await page.waitForTimeout(100)
	}
	const requests = [...getCapturedRequests(page)]
	const alert = await getAlertMessage(page)
	const success = alert?.type === 'success'
	return { requests, alert, success }
}

type TableStatus = 'Пройдено' | 'Провалено'
type DataType = 'valid' | 'invalid'

function resolveTableStatusByUiSignals(params: {
	dataType: DataType
	hasValidationError: boolean
	hasSuccessSignal: boolean
}): TableStatus {
	const { dataType, hasValidationError, hasSuccessSignal } = params

	if (dataType === 'invalid') {
		if (hasSuccessSignal) return 'Провалено'
		if (hasValidationError) return 'Пройдено'
		return 'Провалено'
	}

	if (hasSuccessSignal && !hasValidationError) return 'Пройдено'
	return 'Провалено'
}

test.describe("Форма зворотнього зв'язку (Отримати консультацію)", () => {
	test.describe.configure({ timeout: 120000 })

	test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot().catch(() => null)
			if (screenshot) allure.attachment('скриншот', screenshot, 'image/png')
			const html = await page.content().catch(() => null)
			if (html) allure.attachment('HTML-код сторінки', html, 'text/html')
			const captured = (page as any)._capturedRequests ? (page as any)._capturedRequests()! : []
			if (captured && captured.length)
				allure.attachment('перехоплені-запити', JSON.stringify(captured, null, 2), 'application/json')
		}
	})

	test.beforeEach(async ({ page }: { page: Page }) => {
		const targetUrl = 'https://softpro.ua/uk'
		let opened = false
		let lastError: unknown = null
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
				opened = true
				break
			} catch (e) {
				lastError = e
				if (attempt < 3) {
					await page.waitForTimeout(1000)
				}
			}
		}
		if (!opened) throw lastError
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

	test("[TC-0] Відправка листа з форми для зворотнього зв'язку використовуючи валідні дані", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Контактна форма')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-0] Відправка листа з форми для зворотнього зв\'язку використовуючи валідні дані")
		await allure.severity('critical')
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm

		const name = faker.person.fullName()
		const email = faker.internet.email({ provider: 'example.com' })
		const phone: string = `+380${faker.number.int({ min: 100000000, max: 999999999 }).toString()}`
		const message = faker.lorem.sentences(2)

		await formObj.fillForm({ name, email, phone, message })

		const { nameValid, emailValid, messageValid, submitEnabled } = await formObj.checkValidity()
		if (!nameValid || !emailValid || !messageValid || !submitEnabled) {
			await formObj.fillForm({
				name: 'Тестовий Користувач',
				email: 'prodtest@example.com',
				phone: '+380501234567',
				message: 'Тестове повідомлення',
			})
		}

		;(page as any)._capturedRequests()!.length = 0
		await formObj.submit()
		const captured = await formObj.submitAndWaitForCapture(10000)

		expect(captured).not.toBeNull()
		allure.attachment('перехоплений-запит', JSON.stringify(captured, null, 2), 'application/json')

		const body = captured?.postData
		if (body) {
			try {
				const json = JSON.parse(body)
				expect(json.email).toBe(email)
				expect(json.message || json.body).toContain(message.split(' ')[0])
			} catch (e) {
				expect(body).toContain(email)
			}
		}
		await page.waitForTimeout(300)
		const start = Date.now()
		let ok = false
		while (Date.now() - start < 3000) {
			if (await hasSuccessMessage(page)) {
				ok = true
				break
			}
			await page.waitForTimeout(200)
		}
		expect(ok).toBeTruthy()
	})
	test("[TC-1] Наявність всіх елементів форми зворотнього зв'язку", async ({ page }: { page: Page }) => {
		await allure.epic('Макет')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-1] Наявність всіх елементів форми зворотнього зв'язку")
		await allure.severity('minor')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const inputsCount = await page.locator('form:has(#user_name) input').count()
		expect(inputsCount).toBeGreaterThanOrEqual(3)
		const textareaCount = await page.locator('form:has(#user_name) textarea').count()
		expect(textareaCount).toBeGreaterThanOrEqual(1)
		expect(await formObj.submitBtn.isVisible()).toBeTruthy()
		const closeBtn = page
			.locator('form:has(#user_name) button')
			.filter({ hasText: /^(х|×|закрити)/i })
			.first()
		if ((await closeBtn.count()) > 0) {
			expect(await closeBtn.isVisible()).toBeTruthy()
		}
	})
	const emailCases: Array<{
		id: string
		input: string
		note: string
		dataType: DataType
		expectedTableStatus: TableStatus
	}> = [
		{
			id: 'TC-6',
			input: 'usergmail.com',
			note: 'Відсутність символу @',
			dataType: 'invalid',
			expectedTableStatus: 'Пройдено',
		},
		{
			id: 'TC-7',
			input: 'user@',
			note: 'Відсутність домену',
			dataType: 'invalid',
			expectedTableStatus: 'Пройдено',
		},
		{
			id: 'TC-8',
			input: '@gmail.com',
			note: 'Відсутність імені користувача',
			dataType: 'invalid',
			expectedTableStatus: 'Пройдено',
		},
		{
			id: 'TC-9',
			input: 'user.@gmail.com',
			note: 'Крапка в кінці локальної частини',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-10',
			input: '.user@gmail.com',
			note: 'Крапка на початку локальної частини',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-11',
			input: 'user@gmail.com.',
			note: 'Крапка в кінці домену',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-12',
			input: 'use..r@gmail.com',
			note: 'Подвійна крапка в локальній частині',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-13',
			input: 'user@gm..il.com',
			note: 'Подвійна крапка в домені',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-14',
			input: 'user@.gmail.com',
			note: 'Крапка на початку домену',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-15',
			input: 'user@g_mail.com',
			note: 'Спецсимволи в домені',
			dataType: 'invalid',
			expectedTableStatus: 'Провалено',
		},
		{
			id: 'TC-16',
			input: 'use r@mail.com',
			note: 'Пробіли всередині email',
			dataType: 'invalid',
			expectedTableStatus: 'Пройдено',
		},
	]

	for (const c of emailCases) {
		test(`[${c.id}] ${c.note} у полі Email у формі зворотнього зв'язку`, async ({ page }: { page: Page }) => {
			await allure.epic('Валідація')
			await allure.feature("Форма зворотнього зв'язку")
			await allure.story(`[${c.id}] ${c.note} у полі Email у формі зворотнього зв'язку`)
			await allure.severity('critical')

			const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm

			await test.step('Заповнити форму тестовими даними', async () => {
				await formObj.fillForm({
					email: c.input,
					name: 'Тест Користувач',
					phone: '+380991234567',
					message: 'Валідне повідомлення для перевірки',
				})
			})

			await test.step('Валідація email та поведінка форми', async () => {
				const outcome = await submitAndCollect(page, formObj)
				if (c.dataType === 'invalid') {
					expect(
						outcome.alert?.type,
						`[${c.id}] Для невалідних даних alert має бути 'error', а не '${outcome.alert?.type || 'none'}'`,
					).toBe('error')
				} else {
					expect(
						outcome.alert?.type,
						`[${c.id}] Для валідних даних alert має бути 'success', а не '${outcome.alert?.type || 'none'}'`,
					).toBe('success')
				}
			})
		})
	}
	test("[TC-17] Телефон: нецифрові символи у полі Телефон у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-17] Нецифрові символи у полі Телефон у формі зворотнього зв'язку")
		await allure.severity('major')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const inputPhone = '380abc123421'
		await formObj.fillForm({ phone: inputPhone, name: 'Тест', email: 'test@example.com', message: 'Hi' })
		const phoneFieldValue = await formObj.phone.inputValue()
		const typedDigits = inputPhone.replace(/\D/g, '')
		const fieldDigits = phoneFieldValue.replace(/\D/g, '')
		if (typedDigits !== fieldDigits) {
			const expectedLen = 12
			if (typedDigits.length > expectedLen) {
				;(page as any)._capturedRequests()!.length = 0
				await formObj.submit()
				await page.waitForTimeout(800)
				const capturedAfter = (page as any)._capturedRequests() || []
				const successAfter = await hasSuccessMessage(page)
				if (capturedAfter.length > 0 && successAfter)
					throw new Error(
						`[TC-17] UI прийняв забагато цифр і відправив форму (введено=${typedDigits}, у полі=${fieldDigits})`,
					)
			}
		}

		const res = await formObj.checkValidity()
		if (!res.submitEnabled) {
			expect(res.submitEnabled).toBeFalsy()
			await formObj.submitBtn.click({ force: true })
			let phoneValidationVisible = false
			const waitForPhoneMsg = async (selector: string, t = 800) => {
				try {
					await page.locator(selector).waitFor({ state: 'visible', timeout: t })
					return true
				} catch {
					return false
				}
			}
			phoneValidationVisible =
				phoneValidationVisible ||
				(await waitForPhoneMsg('text=/Будь ласка, введіть коректний номер телефону/i', 1500))
			phoneValidationVisible =
				phoneValidationVisible ||
				(await waitForPhoneMsg(
					'form:has(#user_name) >> text=/Будь ласка, введіть коректний номер телефону/i',
					1200,
				))
			phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=/коректн.*номер/i', 800))
			phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=/у форматі\s*380/i', 800))
			phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=380XXXXXXXXX', 800))
			phoneValidationVisible =
				phoneValidationVisible || (await waitForPhoneMsg('text=/Please enter a valid phone number/i', 800))
			const phoneNativeValidation = await formObj.phone
				.evaluate(el => (el as HTMLInputElement).validationMessage || '')
				.catch(() => '')
			if (phoneNativeValidation && phoneNativeValidation.length) phoneValidationVisible = true
			expect(phoneValidationVisible).toBeTruthy()
			await page.waitForTimeout(500)
			expect(((page as any)._capturedRequests() || []).length).toBe(0)
		} else {
			;(page as any)._capturedRequests()!.length = 0
			await formObj.submit()
			await page.waitForTimeout(800)
			const captured = (page as any)._capturedRequests() || []
			const successAfter = await hasSuccessMessage(page)
			if (captured.length > 0) {
				throw new Error('[TC-17] Для невалідного телефону відправився POST запит')
			}
			expect(successAfter).toBeFalsy()
			expect(
				(await page
					.locator('form:has(#user_name) >> text=/Будь ласка, введіть коректний номер телефону/i')
					.count()) === 0 &&
					(await page
						.locator('form:has(#user_name) >> text=/Please enter a valid phone number/i')
						.count()) === 0,
			).toBeTruthy()
		}
	})
	test("[TC-18] Телефон: неправильний початок номера (не 380) у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-18] Некоректний початок номера у формі зворотнього зв'язку")
		await allure.severity('major')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const inputPhone = '99123456789'
		await formObj.fillForm({ phone: inputPhone, name: 'Тест', email: 'test@example.com', message: 'Hi' })
		const phoneFieldValue = await formObj.phone.inputValue()
		const typedDigits = inputPhone.replace(/\D/g, '')
		const fieldDigits = phoneFieldValue.replace(/\D/g, '')

		if (typedDigits !== fieldDigits) {
			const expectedLen = 12
			if (typedDigits.length > expectedLen) {
				;(page as any)._capturedRequests()!.length = 0
				await formObj.submit()
				await page.waitForTimeout(800)
				const capturedAfter = (page as any)._capturedRequests() || []
				const successAfter = await hasSuccessMessage(page)
				if (capturedAfter.length > 0 && successAfter)
					throw new Error(
						`[TC-18] UI прийняв забагато цифр і відправив форму (введено=${typedDigits}, у полі=${fieldDigits})`,
					)
			}
		}

		const res = await formObj.checkValidity()
		if (!res.submitEnabled) {
			expect(res.submitEnabled).toBeFalsy()
			await page.waitForTimeout(500)
			expect(((page as any)._capturedRequests() || []).length).toBe(0)
		} else {
			;(page as any)._capturedRequests()!.length = 0
			await formObj.submit()
			await page.waitForTimeout(800)
			const captured = (page as any)._capturedRequests() || []
			const success = await hasSuccessMessage(page)
			if (captured.length > 0 && success) {
				throw new Error("[TC-18] Для невалідного телефону відправився POST і з'явилось повідомлення про успіх")
			}

			if (captured.length > 0) {
				const body = captured[0].postData || ''
				expect(body).toContain(fieldDigits)
			}

			expect(success).toBeFalsy()
		}
	})
	test("[TC-2] Адаптивність поля для повідомлення у формі зворотнього зв'язку", async ({ page }: { page: Page }) => {
		await allure.epic('Макет')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-2] Адаптивність поля для повідомлення у формі зворотнього зв'язку")
		await allure.severity('minor')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const initialHeight = await formObj.message.evaluate(el => (el as HTMLElement).offsetHeight)
		const longMessage = Array.from({ length: 30 })
			.map(() => 'Line of text')
			.join('\n')
		await formObj.fillForm({ message: longMessage })
		await page.waitForTimeout(300)
		const newHeight = await formObj.message.evaluate(el => (el as HTMLElement).offsetHeight)
		expect(newHeight).toBeGreaterThanOrEqual(initialHeight)
	})
	test("[TC-19] Телефон: недостатня довжина у формі зворотнього зв'язку", async ({ page }: { page: Page }) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-19] Недостатня довжина номера у полі Телефон у формі зворотнього зв'язку")
		await allure.severity('major')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const inputPhone = '38099123456'
		await formObj.fillForm({ phone: inputPhone, name: 'Тест', email: 'test@example.com', message: 'Hi' })
		const phoneFieldValue = await formObj.phone.inputValue()
		const typedDigits = inputPhone.replace(/\D/g, '')
		const fieldDigits = phoneFieldValue.replace(/\D/g, '')

		if (typedDigits !== fieldDigits) {
			const expectedLen = 12
			if (typedDigits.length > expectedLen) {
				;(page as any)._capturedRequests()!.length = 0
				await formObj.submit()
				await page.waitForTimeout(800)
				const capturedAfter = (page as any)._capturedRequests() || []
				const successAfter = await hasSuccessMessage(page)
				if (capturedAfter.length > 0 && successAfter)
					throw new Error(
						`[TC-19] UI прийняв забагато цифр і відправив форму (введено=${typedDigits}, у полі=${fieldDigits})`,
					)
			}
		}

		let res = await formObj.checkValidity()
		expect(res.submitEnabled).toBeFalsy()
		await formObj.submitBtn.click({ force: true })
		let phoneValidationVisible = false
		const waitForPhoneMsg = async (selector: string, t = 800) => {
			try {
				await page.locator(selector).waitFor({ state: 'visible', timeout: t })
				return true
			} catch {
				return false
			}
		}
		phoneValidationVisible =
			phoneValidationVisible ||
			(await waitForPhoneMsg(
				'form:has(#user_name) >> text=/Будь ласка, введіть коректний номер телефону/i',
				1200,
			))
		phoneValidationVisible =
			phoneValidationVisible ||
			(await waitForPhoneMsg('text=/Будь ласка, введіть коректний номер телефону у форматі 380XXXXXXXXX/i', 1200))
		phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=/коректн.*номер/i', 800))
		phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=/у форматі\\s*380/i', 800))
		phoneValidationVisible = phoneValidationVisible || (await waitForPhoneMsg('text=380XXXXXXXXX', 800))
		phoneValidationVisible =
			phoneValidationVisible || (await waitForPhoneMsg('text=/Please enter a valid phone number/i', 800))
		const phoneNativeValidation = await formObj.phone
			.evaluate(el => (el as HTMLInputElement).validationMessage || '')
			.catch(() => '')
		if (phoneNativeValidation && phoneNativeValidation.length) phoneValidationVisible = true
		expect(phoneValidationVisible).toBeTruthy()
		await page.waitForTimeout(500)
		expect(((page as any)._capturedRequests() || []).length).toBe(0)
	})

	test("[TC-20] Телефон: надмірна довжина у формі зворотнього зв'язку", async ({ page }: { page: Page }) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-20] Надмірна довжина номера у полі Телефон у формі зворотнього зв'язку")
		await allure.severity('major')
		;(page as any)._capturedRequests()!.length = 0
		;(page as any)._capturedRequests()!.length = 0
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		const inputPhone = '3809912345612'
		await formObj.fillForm({ phone: inputPhone, name: 'Тест', email: 'test@example.com', message: 'Hi' })
		const phoneFieldValue = await formObj.phone.inputValue()
		const typedDigits = inputPhone.replace(/\D/g, '')
		const fieldDigits = phoneFieldValue.replace(/\D/g, '')

		if (typedDigits !== fieldDigits) {
			const expectedLen = 12
			if (typedDigits.length > expectedLen) {
				;(page as any)._capturedRequests()!.length = 0
				await formObj.submit()
				await page.waitForTimeout(800)
				const capturedAfter = (page as any)._capturedRequests() || []
				if (capturedAfter.length > 0) {
					console.warn(
						`[TC-20] Виявлено відправку для надмірної довжини телефону (введено=${typedDigits}, у полі=${fieldDigits})`,
					)
				}
			}
		}

		let res = await formObj.checkValidity()
		expect(res.submitEnabled).toBeFalsy()
		await page.waitForTimeout(500)
	})
	test("[TC-21] Недостатня кількість символів у багаторядковому полі Повідомлення у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story(
			"[TC-21] Недостатня кількість символів у багаторядковому полі Повідомлення у формі зворотнього зв'язку",
		)
		await allure.severity('major')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Тест Користувач',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'a'.repeat(9),
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-21] Для невалідних даних alert має бути "error", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('error')
	})
	test("[TC-22] Верхня границя кількості символів Повідомлення у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-22] Верхня границя кількості символів Повідомлення у формі зворотнього зв'язку")
		await allure.severity('normal')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Тест Користувач',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'a'.repeat(2000),
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-22] Для валідних даних alert має бути "success", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('success')
	})
	test("[TC-23] Надмірна кількість символів у полі Повідомлення у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-23] Надмірна кількість символів у полі Повідомлення у формі зворотнього зв'язку")
		await allure.severity('major')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Тест Користувач',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'a'.repeat(2001),
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-23] Для невалідних даних alert має бути "error", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('error')
	})
	test("[TC-24] Відправка порожньої форми для зворотнього зв'язку", async ({ page }: { page: Page }) => {
		await allure.epic('Контактна форма')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-24] Відправка порожньої форми для зворотнього зв'язку")
		await allure.severity('critical')

		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({ name: '', email: '', phone: '', message: '' })
		;(page as any)._capturedRequests()!.length = 0
		await formObj.submit()
		await page.waitForTimeout(800)
		const captured = (page as any)._capturedRequests() || []
		if (captured.length > 0) {
			throw new Error('[TC-24] Порожня форма відправила POST запит')
		}
		expect(captured.length).toBe(0)
	})
	test("[TC-3] Введення заборонених символів в полі ПІБ у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-3] Введення заборонених символів в полі ПІБ у формі зворотнього зв'язку")
		await allure.severity('major')
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Іван!@#123',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'Валідне повідомлення для перевірки',
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-3] Для невалідних даних alert має бути "error", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('error')
	})
	test("[TC-4] Нижня границя-1 кількості символів у полі ПІБ у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-4] Нижня границя-1 кількості символів у полі ПІБ у формі зворотнього зв'язку")
		await allure.severity('major')
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Я',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'Валідне повідомлення для перевірки',
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-4] Для невалідних даних alert має бути "error", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('error')
	})
	test("[TC-5] Нижня границя кількості символів у полі ПІБ у формі зворотнього зв'язку", async ({
		page,
	}: {
		page: Page
	}) => {
		await allure.epic('Валідація')
		await allure.feature("Форма зворотнього зв'язку")
		await allure.story("[TC-5] Нижня границя кількості символів у полі ПІБ у формі зворотнього зв'язку")
		await allure.severity('normal')
		const formObj: ConsultationForm = (page as any)._consultationForm as ConsultationForm
		await formObj.fillForm({
			name: 'Ян',
			email: 'test@example.com',
			phone: '+380501234567',
			message: 'Валідне повідомлення для перевірки',
		})
		const outcome = await submitAndCollect(page, formObj)
		expect(
			outcome.alert?.type,
			'[TC-5] Для валідних даних alert має бути "success", а не "' + (outcome.alert?.type || 'none') + '"',
		).toBe('success')
	})
})
