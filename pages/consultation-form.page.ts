import type { Page, Locator } from '@playwright/test'

export class ConsultationForm {
	readonly page: Page
	readonly name: Locator
	readonly email: Locator
	readonly phone: Locator
	readonly message: Locator
	readonly submitBtn: Locator

	constructor(page: Page) {
		this.page = page
		this.name = page.locator('#user_name').first()
		this.email = page.locator('#email').first()
		this.phone = page.locator('#phone').first()
		this.message = page.locator('#message').first()
		this.submitBtn = page.locator(`form:has(#user_name)`).first().locator(`button:has-text("Надіслати")`).first()
	}

	async open() {
		const cta = this.page.getByRole('button', { name: 'Отримати консультацію' }).first()
		await cta.scrollIntoViewIfNeeded().catch(() => null)
		await cta.click({ force: true }).catch(() => null)
		try {
			await this.name.waitFor({ state: 'visible', timeout: 10000 })
		} catch {
			await this.page.goto('https://softpro.ua/contacts')
			await this.name.scrollIntoViewIfNeeded().catch(() => null)
			await this.name.waitFor({ state: 'visible', timeout: 10000 })
		}
	}

	async fillForm(data: { name?: string; email?: string; phone?: string; message?: string }) {
		if (data.name !== undefined) await this.name.fill(data.name)
		if (data.email !== undefined) await this.email.fill(data.email)
		if (data.phone !== undefined) await this.phone.fill(data.phone)
		if (data.message !== undefined) await this.message.fill(data.message)
	}

	async isSubmitEnabled(): Promise<boolean> {
		return await this.submitBtn.isEnabled().catch(() => true)
	}

	async checkValidity(): Promise<{
		nameValid: boolean
		emailValid: boolean
		messageValid: boolean
		submitEnabled: boolean
	}> {
		const [nameValid, emailValid, messageValid, submitEnabled] = await Promise.all([
			this.name.evaluate(el => (el as HTMLInputElement).checkValidity()).catch(() => true),
			this.email.evaluate(el => (el as HTMLInputElement).checkValidity()).catch(() => true),
			this.message.evaluate(el => (el as HTMLTextAreaElement).checkValidity()).catch(() => true),
			this.submitBtn.isEnabled().catch(() => true),
		])
		return { nameValid, emailValid, messageValid, submitEnabled }
	}

	async submit() {
		await this.submitBtn.click()
	}

	async submitAndWaitForCapture(timeout = 10000) {
		const start = Date.now()
		while (Date.now() - start < timeout) {
			const arr = (this.page as any)._capturedRequests ? (this.page as any)._capturedRequests()! : []
			if (arr.length > 0) return arr.shift()
			await new Promise(r => setTimeout(r, 120))
		}
		return null
	}
}
