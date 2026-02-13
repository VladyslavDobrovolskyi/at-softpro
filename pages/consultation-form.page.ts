import type { Page, Locator } from '@playwright/test'

type ConsultationFormData = {
	name?: string
	email?: string
	phone?: string
	message?: string
}

type ConsultationValidationResult = {
	nameValid: boolean
	emailValid: boolean
	messageValid: boolean
	submitEnabled: boolean
}

type CapturedRequest = {
	url: string
	method: string
	postData?: string | null
}

export class ConsultationForm {
	readonly page: Page
	readonly name: Locator
	readonly email: Locator
	readonly phone: Locator
	readonly message: Locator
	readonly submitBtn: Locator
	readonly openFormBtn: Locator

	constructor(page: Page) {
		this.page = page
		this.openFormBtn = page.getByRole('button', { name: 'Отримати консультацію' }).first()
		this.name = page.locator('#user_name').first()
		this.email = page.locator('#email').first()
		this.phone = page.locator('#phone').first()
		this.message = page.locator('#message').first()
		this.submitBtn = page.locator(`form:has(#user_name)`).first().locator(`button:has-text("Надіслати")`).first()
	}

	async open() {
		await this.openFormBtn.scrollIntoViewIfNeeded().catch(() => null)
		await this.openFormBtn.click({ force: true }).catch(() => null)

		if (await this.isNameVisible(10000)) {
			return
		}

		await this.page.goto('https://softpro.ua/contacts')
		await this.name.scrollIntoViewIfNeeded().catch(() => null)
		await this.name.waitFor({ state: 'visible', timeout: 10000 })
	}

	async fillForm(data: ConsultationFormData) {
		if (data.name !== undefined) await this.name.fill(data.name)
		if (data.email !== undefined) await this.email.fill(data.email)
		if (data.phone !== undefined) await this.phone.fill(data.phone)
		if (data.message !== undefined) await this.message.fill(data.message)
	}

	async isSubmitEnabled(): Promise<boolean> {
		const v = await this.checkValidity()
		return v.submitEnabled
	}

	async checkValidity(): Promise<ConsultationValidationResult> {
		const [nameValid, emailValid, messageValid, phoneValid] = await Promise.all([
			this.validateName(),
			this.validateEmail(),
			this.validateMessage(),
			this.validatePhone(),
		])

		return {
			nameValid,
			emailValid,
			messageValid,
			submitEnabled: nameValid && emailValid && messageValid && phoneValid,
		}
	}

	async submit() {
		await this.submitBtn.click()
	}

	async submitAndWaitForCapture(timeout = 10000) {
		const pool = this.getCapturedRequests()
		if (!pool) return null

		const start = Date.now()
		while (Date.now() - start < timeout) {
			if (pool.length > 0) return pool.shift() ?? null
			await new Promise(r => setTimeout(r, 120))
		}
		return null
	}

	private async isNameVisible(timeout: number): Promise<boolean> {
		try {
			await this.name.waitFor({ state: 'visible', timeout })
			return true
		} catch {
			return false
		}
	}

	private getCapturedRequests(): CapturedRequest[] | null {
		if (!(this.page as any)._capturedRequests) return null
		return ((this.page as any)._capturedRequests() as CapturedRequest[]) ?? null
	}

	private async validateName(): Promise<boolean> {
		return this.name
			.evaluate(el => {
				const value = (el as HTMLInputElement).value || ''
				const nativeValid = (el as HTMLInputElement).checkValidity()
				try {
					return nativeValid && /^[\p{L}\s'\-]{2,}$/u.test(value.trim())
				} catch {
					return nativeValid && value.trim().length >= 2
				}
			})
			.catch(() => false)
	}

	private async validateEmail(): Promise<boolean> {
		return this.email
			.evaluate(el => {
				const value = ((el as HTMLInputElement).value || '').trim()
				const nativeValid = (el as HTMLInputElement).checkValidity()

				if (!value || value.includes(' ')) return false
				const parts = value.split('@')
				if (parts.length !== 2) return false

				const [local, domain] = parts
				if (!local || !domain) return false
				if (local.startsWith('.') || local.endsWith('.')) return false
				if (domain.startsWith('.') || domain.endsWith('.')) return false
				if (local.includes('..') || domain.includes('..')) return false
				if (!/^[A-Za-z0-9!#$%&'*+\/=\?^_`{|}~.\-]+$/.test(local)) return false
				if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) return false
				if (/[ _]/.test(domain)) return false

				return nativeValid
			})
			.catch(() => false)
	}

	private async validateMessage(): Promise<boolean> {
		return this.message
			.evaluate(el => {
				const value = (el as HTMLTextAreaElement).value || ''
				const trimmedLength = value.trim().length
				const nativeValid = (el as HTMLTextAreaElement).checkValidity()
				return nativeValid && trimmedLength >= 10 && value.length <= 2000
			})
			.catch(() => false)
	}

	private async validatePhone(): Promise<boolean> {
		const value = await this.phone
			.evaluate(el => ((el as HTMLInputElement).value || '').replace(/\s+/g, ''))
			.catch(() => '')
		return /^(?:\+?380)\d{9}$/.test(value)
	}
}
