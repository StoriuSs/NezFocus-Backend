import type { EmailLanguage } from '@/modules/auth/application/ports'

/**
 * The words of every auth email, in each language (D-132). One layout
 * (templates/email.hbs) shows them: a heading, paragraphs, an optional code
 * and button, and a footer. `EmailCopy` makes both languages carry every
 * email: one missing is a type error, not an English email in a Vietnamese
 * inbox.
 *
 * Vietnamese follows the web app's voice: "mình" for NezFocus, "mã OTP" for
 * the six digits (D-68).
 */

export interface EmailContent {
    subject: string
    /** The line a mail app shows next to the subject. */
    preheader: string
    heading: string
    /** Paragraphs above the code (or the only ones). */
    before: string[]
    code: string | null
    /** Paragraphs below the code. */
    after: string[]
    action: { url: string; label: string } | null
    footer: string
}

interface CodeVars {
    app: string
    code: string
    minutes: number
    /** The account's display name. */
    name?: string
}

interface LinkVars {
    app: string
    /** Where to reset the password, if this was not them. */
    resetUrl: string
}

export interface EmailCopy {
    /** A sign-in code for an address that has an account. */
    signInCode(v: CodeVars): EmailContent
    /** A sign-in code for an address with no account: the right code makes one. */
    createAccountCode(v: CodeVars): EmailContent
    resetCode(v: CodeVars): EmailContent
    /** A reset code for an account without a password: choosing one, not resetting it. */
    firstPasswordCode(v: CodeVars): EmailContent
    passwordChanged(v: LinkVars): EmailContent
    passwordAdded(v: LinkVars): EmailContent
    signInMethodAdded(v: LinkVars & { provider: string }): EmailContent
    accountDeleted(v: { app: string; days: number; support: string | null }): EmailContent
}

const vi: EmailCopy = (() => {
    const hello = (name?: string) => (name ? `Chào ${name},` : 'Chào bạn,')
    const lasts = (minutes: number) =>
        `Mã dùng được trong ${minutes} phút và chỉ một lần. Nếu bạn đã yêu cầu nhiều lần, chỉ mã mới nhất có hiệu lực.`
    const codeFooter = (app: string) =>
        `Email tự động từ ${app}. Không ai từ ${app} hỏi mã của bạn: đừng đưa mã cho bất kỳ ai.`
    const noticeFooter = (app: string) => `Email tự động từ ${app}, gửi tới địa chỉ gắn với tài khoản của bạn.`
    const resetAction = (url: string) => ({ url, label: 'Đặt lại mật khẩu' })

    return {
        signInCode: ({ app, code, minutes, name }) => ({
            subject: `Mã OTP đăng nhập ${app}`,
            preheader: `Mã OTP để đăng nhập ${app} của bạn.`,
            heading: 'Mã OTP đăng nhập',
            before: [hello(name), `Nhập mã này trên trang đăng nhập để vào tài khoản ${app} của bạn:`],
            code,
            after: [
                lasts(minutes),
                'Không phải bạn yêu cầu? Bỏ qua email này: không ai vào được tài khoản nếu không có mã.'
            ],
            action: null,
            footer: codeFooter(app)
        }),
        createAccountCode: ({ app, code, minutes }) => ({
            subject: `Mã OTP tạo tài khoản ${app}`,
            preheader: `Mã OTP để xác nhận email và tạo tài khoản ${app}.`,
            heading: `Tạo tài khoản ${app}`,
            before: [hello(), `Nhập mã này để xác nhận email và tạo tài khoản ${app}:`],
            code,
            after: [lasts(minutes), 'Không phải bạn yêu cầu? Bỏ qua email này: sẽ không có tài khoản nào được tạo.'],
            action: null,
            footer: codeFooter(app)
        }),
        resetCode: ({ app, code, minutes, name }) => ({
            subject: `Mã đặt lại mật khẩu ${app}`,
            preheader: `Mã để đặt lại mật khẩu ${app} của bạn.`,
            heading: 'Đặt lại mật khẩu',
            before: [hello(name), `Nhập mã này cùng mật khẩu mới để đặt lại mật khẩu ${app}:`],
            code,
            after: [
                lasts(minutes),
                'Đặt lại xong, mọi thiết bị đang đăng nhập tài khoản này sẽ bị đăng xuất.',
                'Không phải bạn yêu cầu? Bỏ qua email này: mật khẩu của bạn vẫn giữ nguyên.'
            ],
            action: null,
            footer: codeFooter(app)
        }),
        firstPasswordCode: ({ app, code, minutes, name }) => ({
            subject: `Mã đặt mật khẩu ${app}`,
            preheader: `Mã để đặt mật khẩu cho tài khoản ${app} của bạn.`,
            heading: 'Đặt mật khẩu',
            before: [hello(name), 'Tài khoản của bạn chưa có mật khẩu. Nhập mã này cùng mật khẩu bạn chọn:'],
            code,
            after: [lasts(minutes), 'Không phải bạn yêu cầu? Bỏ qua email này: tài khoản của bạn không đổi gì.'],
            action: null,
            footer: codeFooter(app)
        }),
        passwordChanged: ({ app, resetUrl }) => ({
            subject: `Mật khẩu ${app} của bạn vừa được đổi`,
            preheader: 'Nếu không phải bạn, hãy đặt lại mật khẩu ngay.',
            heading: 'Mật khẩu đã được đổi',
            before: [
                `Mật khẩu của tài khoản ${app} gắn với email này vừa được đổi, và các thiết bị khác đã bị đăng xuất.`,
                'Nếu là bạn, bạn không cần làm gì thêm. Nếu không phải bạn, hãy đặt lại mật khẩu ngay:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        passwordAdded: ({ app, resetUrl }) => ({
            subject: `Tài khoản ${app} của bạn vừa có mật khẩu`,
            preheader: 'Nếu không phải bạn, hãy đặt lại mật khẩu ngay.',
            heading: 'Đã thêm mật khẩu',
            before: [
                `Tài khoản ${app} gắn với email này vừa được đặt mật khẩu. Từ giờ bạn đăng nhập được bằng mật khẩu này hoặc bằng mã OTP.`,
                'Nếu không phải bạn, hãy đặt lại mật khẩu ngay:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        signInMethodAdded: ({ app, provider, resetUrl }) => ({
            subject: `Đã thêm đăng nhập bằng ${provider} vào tài khoản ${app}`,
            preheader: 'Nếu không phải bạn, hãy đặt lại mật khẩu ngay.',
            heading: `Đã thêm đăng nhập bằng ${provider}`,
            before: [
                `Tài khoản ${app} gắn với email này giờ đăng nhập được bằng ${provider}.`,
                'Nếu không phải bạn, hãy đặt lại mật khẩu ngay:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        accountDeleted: ({ app, days, support }) => ({
            subject: `Tài khoản ${app} của bạn đã bị xóa`,
            preheader: `Mọi phiên đăng nhập đã kết thúc.`,
            heading: 'Tài khoản đã bị xóa',
            before: [
                `Tài khoản ${app} gắn với email này đã bị xóa và mọi phiên đăng nhập đã kết thúc.`,
                `Thông tin cá nhân của tài khoản sẽ được xóa hẳn sau ${days} ngày.`,
                support
                    ? `Nếu không phải bạn, hãy liên hệ ${support} ngay.`
                    : 'Nếu không phải bạn, hãy trả lời email này ngay.'
            ],
            code: null,
            after: [],
            action: null,
            footer: noticeFooter(app)
        })
    }
})()

const en: EmailCopy = (() => {
    const hello = (name?: string) => (name ? `Hi ${name},` : 'Hi,')
    const lasts = (minutes: number) =>
        `The code works for ${minutes} minutes, once. If you asked more than once, only the newest code works.`
    const codeFooter = (app: string) =>
        `An automatic email from ${app}. Nobody from ${app} will ask for your code: never give it to anyone.`
    const noticeFooter = (app: string) => `An automatic email from ${app}, sent to the address of your account.`
    const resetAction = (url: string) => ({ url, label: 'Reset your password' })

    return {
        signInCode: ({ app, code, minutes, name }) => ({
            subject: `Your ${app} sign-in code`,
            preheader: `Your OTP code to sign in to ${app}.`,
            heading: 'Your sign-in code',
            before: [hello(name), `Enter this code on the sign-in page to get into your ${app} account:`],
            code,
            after: [
                lasts(minutes),
                'Didn’t ask for it? Ignore this email: nobody gets into your account without the code.'
            ],
            action: null,
            footer: codeFooter(app)
        }),
        createAccountCode: ({ app, code, minutes }) => ({
            subject: `Your code to create a ${app} account`,
            preheader: `Your OTP code to confirm your email and create a ${app} account.`,
            heading: `Create your ${app} account`,
            before: [hello(), `Enter this code to confirm your email and create your ${app} account:`],
            code,
            after: [lasts(minutes), 'Didn’t ask for it? Ignore this email: no account will be created.'],
            action: null,
            footer: codeFooter(app)
        }),
        resetCode: ({ app, code, minutes, name }) => ({
            subject: `Reset your ${app} password`,
            preheader: `Your code to reset your ${app} password.`,
            heading: 'Reset your password',
            before: [hello(name), `Enter this code with your new password to reset your ${app} password:`],
            code,
            after: [
                lasts(minutes),
                'Once it is reset, every device signed in to this account is signed out.',
                'Didn’t ask for it? Ignore this email: your password stays as it is.'
            ],
            action: null,
            footer: codeFooter(app)
        }),
        firstPasswordCode: ({ app, code, minutes, name }) => ({
            subject: `Choose a password for your ${app} account`,
            preheader: `Your code to choose a password for your ${app} account.`,
            heading: 'Choose a password',
            before: [hello(name), 'Your account has no password yet. Enter this code with the password you choose:'],
            code,
            after: [lasts(minutes), 'Didn’t ask for it? Ignore this email: nothing changes in your account.'],
            action: null,
            footer: codeFooter(app)
        }),
        passwordChanged: ({ app, resetUrl }) => ({
            subject: `Your ${app} password was changed`,
            preheader: 'If this wasn’t you, reset your password now.',
            heading: 'Your password was changed',
            before: [
                `The password of the ${app} account with this email was just changed, and other devices were signed out.`,
                'If this was you, there is nothing else to do. If it wasn’t, reset your password now:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        passwordAdded: ({ app, resetUrl }) => ({
            subject: `Your ${app} account now has a password`,
            preheader: 'If this wasn’t you, reset your password now.',
            heading: 'A password was added',
            before: [
                `A password was just set on the ${app} account with this email. You can now sign in with it, or with an OTP code.`,
                'If this wasn’t you, reset your password now:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        signInMethodAdded: ({ app, provider, resetUrl }) => ({
            subject: `${provider} sign-in was added to your ${app} account`,
            preheader: 'If this wasn’t you, reset your password now.',
            heading: `${provider} sign-in was added`,
            before: [
                `The ${app} account with this email can now sign in with ${provider}.`,
                'If this wasn’t you, reset your password now:'
            ],
            code: null,
            after: [],
            action: resetAction(resetUrl),
            footer: noticeFooter(app)
        }),
        accountDeleted: ({ app, days, support }) => ({
            subject: `Your ${app} account was deleted`,
            preheader: 'Every session has ended.',
            heading: 'Your account was deleted',
            before: [
                `The ${app} account with this email was deleted, and every session has ended.`,
                `Its personal details are erased for good after ${days} days.`,
                support ? `If this wasn’t you, contact ${support} now.` : 'If this wasn’t you, reply to this email now.'
            ],
            code: null,
            after: [],
            action: null,
            footer: noticeFooter(app)
        })
    }
})()

export const EMAIL_COPY: Record<EmailLanguage, EmailCopy> = { vi, en }
